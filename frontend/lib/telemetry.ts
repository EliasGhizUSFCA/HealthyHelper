import { RingBuffer } from "./ring";
import { PIPELINE_ORDER, type PipelineStage, type ServerMetrics, type TelemetryEvent } from "./protocol";

export interface SeriesPoint {
  t: number; // epoch ms
  cameraFps: number | null;
  landmarkFps: number | null;
  inferenceFps: number | null;
  faceDetectMs: number | null;
  classifierMs: number | null;
  llmMs: number | null;
  e2eMs: number | null;
  cpu: number | null;
  rssMb: number | null;
  dropped: number;
  rejected: number;
  skipped: number;
}

export interface FrameTrace {
  frameId: number;
  capturedAt: number;
  resultAt: number | null;
  e2eMs: number | null;
  events: TelemetryEvent[];
  outcome: "pending" | "result" | "dropped" | "skipped" | "rejected";
}

export interface TelemetrySnapshot {
  version: number;
  events: TelemetryEvent[];
  frames: FrameTrace[];
  series: SeriesPoint[];
  lastByStage: Partial<Record<PipelineStage, TelemetryEvent>>;
  counters: Counters;
  serverMetrics: ServerMetrics | null;
}

export interface Counters {
  cameraFrames: number;
  landmarkRuns: number;
  inferenceRequests: number;
  inferenceResults: number;
  framesDropped: number;
  framesRejected: number;
  framesSkipped: number;
  llmCalls: number;
}

/** Order events: by started_at, then by pipeline stage order, then by per-origin seq. */
export function orderEvents(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...events].sort(
    (a, b) =>
      a.started_at - b.started_at ||
      PIPELINE_ORDER.indexOf(a.stage) - PIPELINE_ORDER.indexOf(b.stage) ||
      (a.origin === b.origin ? a.seq - b.seq : a.origin === "client" ? -1 : 1),
  );
}

const zeroCounters = (): Counters => ({
  cameraFrames: 0,
  landmarkRuns: 0,
  inferenceRequests: 0,
  inferenceResults: 0,
  framesDropped: 0,
  framesRejected: 0,
  framesSkipped: 0,
  llmCalls: 0,
});

export interface TelemetryOptions {
  maxEvents?: number;
  maxFrames?: number;
  maxSeries?: number;
  notifyIntervalMs?: number;
  now?: () => number;
}

/**
 * Bounded telemetry store. Hot-path counters (camera frames, landmark runs) update without
 * notifying React; snapshots are published at most every `notifyIntervalMs`.
 */
export class TelemetryStore {
  private events: RingBuffer<TelemetryEvent>;
  private frames = new Map<number, FrameTrace>();
  private frameOrder: number[] = [];
  private series: RingBuffer<SeriesPoint>;
  private lastByStage: Partial<Record<PipelineStage, TelemetryEvent>> = {};
  private counters = zeroCounters();
  private prevCounters = zeroCounters();
  private prevSampleT: number | null = null;
  private window = {
    faceDetect: [] as number[],
    classifier: [] as number[],
    llm: [] as number[],
    e2e: [] as number[],
  };
  private serverMetrics: ServerMetrics | null = null;
  private listeners = new Set<() => void>();
  private snapshot: TelemetrySnapshot;
  private version = 0;
  private dirty = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private clientSeq = 0;
  readonly maxFrames: number;
  private notifyIntervalMs: number;
  private now: () => number;

  constructor(opts: TelemetryOptions = {}) {
    this.events = new RingBuffer(opts.maxEvents ?? 300);
    this.series = new RingBuffer(opts.maxSeries ?? 120);
    this.maxFrames = opts.maxFrames ?? 30;
    this.notifyIntervalMs = opts.notifyIntervalMs ?? 250;
    this.now = opts.now ?? (() => Date.now());
    this.snapshot = this.build();
  }

  nextClientSeq() {
    return ++this.clientSeq;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  private build(): TelemetrySnapshot {
    return {
      version: this.version,
      events: this.events.toArray(),
      frames: this.frameOrder.map((id) => this.frames.get(id)!).filter(Boolean),
      series: this.series.toArray(),
      lastByStage: { ...this.lastByStage },
      counters: { ...this.counters },
      serverMetrics: this.serverMetrics,
    };
  }

  private markDirty() {
    this.dirty = true;
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.flush();
    }, this.notifyIntervalMs);
  }

  /** Publish a new snapshot immediately (also used by tests). */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.version++;
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }

  countCameraFrame() {
    this.counters.cameraFrames++;
  }
  countLandmarkRun() {
    this.counters.landmarkRuns++;
  }

  private frame(frameId: number, capturedAt: number): FrameTrace {
    let f = this.frames.get(frameId);
    if (!f) {
      f = { frameId, capturedAt, resultAt: null, e2eMs: null, events: [], outcome: "pending" };
      this.frames.set(frameId, f);
      this.frameOrder.push(frameId);
      while (this.frameOrder.length > this.maxFrames) {
        const old = this.frameOrder.shift()!;
        this.frames.delete(old);
      }
    }
    return f;
  }

  recordEvents(events: TelemetryEvent[], capturedAt?: number) {
    for (const e of events) {
      this.events.push(e);
      this.lastByStage[e.stage] = e;
      if (e.frame_id >= 0) {
        const f = this.frame(e.frame_id, capturedAt ?? e.started_at);
        f.events = orderEvents([...f.events, e]);
      }
      if (e.status !== "skipped") {
        if (e.stage === "face_detection") this.window.faceDetect.push(e.duration_ms);
        else if (e.stage === "cv_inference") this.window.classifier.push(e.duration_ms);
        else if (e.stage === "llm_request") {
          this.window.llm.push(e.duration_ms);
          this.counters.llmCalls++;
        }
      }
    }
    this.markDirty();
  }

  /** Record a frame that was sampled but not sent (no face / unusable quality / no consent). */
  frameSkipped(frameId: number, capturedAt: number, events: TelemetryEvent[], reason: "skipped" | "rejected") {
    this.recordEvents(events, capturedAt);
    const f = this.frame(frameId, capturedAt);
    f.outcome = reason;
    if (reason === "skipped") this.counters.framesSkipped++;
    else this.counters.framesRejected++;
    this.markDirty();
  }

  frameSent(frameId: number, capturedAt: number) {
    this.frame(frameId, capturedAt);
    this.counters.inferenceRequests++;
    this.markDirty();
  }

  frameResult(frameId: number, capturedAt: number, events: TelemetryEvent[], receivedAt: number) {
    this.recordEvents(events, capturedAt);
    const f = this.frame(frameId, capturedAt);
    f.resultAt = receivedAt;
    f.e2eMs = receivedAt - capturedAt;
    f.outcome = "result";
    this.window.e2e.push(f.e2eMs);
    this.counters.inferenceResults++;
    this.markDirty();
  }

  frameDropped(frameId: number) {
    const f = this.frames.get(frameId);
    if (f) f.outcome = "dropped";
    this.counters.framesDropped++;
    this.markDirty();
  }

  setServerMetrics(m: ServerMetrics) {
    this.serverMetrics = m;
    this.markDirty();
  }

  /** Called on a fixed interval (≈1 s) to compute rates and push a chart sample. */
  sample(t = this.now()) {
    const c = this.counters;
    const p = this.prevCounters;
    const dt = this.prevSampleT == null ? null : (t - this.prevSampleT) / 1000;
    const rate = (a: number, b: number) => (dt && dt > 0 ? (a - b) / dt : null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    this.series.push({
      t,
      cameraFps: rate(c.cameraFrames, p.cameraFrames),
      landmarkFps: rate(c.landmarkRuns, p.landmarkRuns),
      inferenceFps: rate(c.inferenceResults, p.inferenceResults),
      faceDetectMs: avg(this.window.faceDetect),
      classifierMs: avg(this.window.classifier),
      llmMs: avg(this.window.llm),
      e2eMs: avg(this.window.e2e),
      cpu: this.serverMetrics?.cpu_percent ?? null,
      rssMb: this.serverMetrics?.rss_mb ?? null,
      dropped: c.framesDropped,
      rejected: c.framesRejected,
      skipped: c.framesSkipped,
    });
    this.window = { faceDetect: [], classifier: [], llm: [], e2e: [] };
    this.prevCounters = { ...c };
    this.prevSampleT = t;
    this.markDirty();
  }

  reset() {
    this.events.clear();
    this.series.clear();
    this.frames.clear();
    this.frameOrder = [];
    this.lastByStage = {};
    this.counters = zeroCounters();
    this.prevCounters = zeroCounters();
    this.prevSampleT = null;
    this.serverMetrics = null;
    this.dirty = true;
    this.flush();
  }
}
