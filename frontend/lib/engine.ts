/**
 * AnalysisEngine: owns camera, in-browser face landmarking, the inference sampler, the WebSocket
 * and telemetry. Rendering (rAF, camera rate) is decoupled from inference (sampler, configurable Hz).
 */
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { api } from "./api";
import { mapCameraError, startCamera, stopStream, type CameraError } from "./camera";
import { WS_URL } from "./config";
import { captureFrame, cropToDataUrl, roiPixels } from "./crops";
import { loadFaceLandmarker } from "./landmarker";
import type {
  ChatMessage,
  ChatResponse,
  ClientFrame,
  Explanation,
  ImageQuality,
  InferenceResult,
  ModelInfo,
  PipelineStage,
  RegionCrop,
  RegionName,
  ServerMessage,
  StageStatus,
  TelemetryEvent,
} from "./protocol";
import { assessQuality, measureImage, poseFromLandmarks, poseFromMatrix } from "./quality";
import { computeAllRegions, faceBox, REGION_NAMES, type Point2, type RegionBox } from "./regions";
import { Store } from "./store";
import { SYNTHETIC_LAYOUT, syntheticCrop } from "./synthetic";
import { TelemetryStore } from "./telemetry";
import { epochNow, InferenceSocket, type SocketStats } from "./ws";

export type InputSource = "camera" | "synthetic";

export interface EngineSettings {
  source: InputSource;
  consentUpload: boolean;
  inferenceHz: number;
  paused: boolean;
  returnInputs: boolean;
  thresholds: Record<string, number>;
  syntheticIntensity: number;
  autoExplainSec: number; // 0 = off
}

export interface StoredCrop {
  region: RegionName;
  dataUrl: string;
  bbox: [number, number, number, number];
  frameId: number;
  synthetic: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  error: string | null;
  lastResponse: ChatResponse | null;
  symptoms: string[];
  /** Per assistant message (keyed by index in `messages`). */
  replyMeta: Record<number, { route: string; followUps: string[]; suggestsProfessional: boolean; provider: string }>;
}

export interface EngineState {
  camera: "off" | "starting" | "on" | "error";
  cameraError: CameraError | null;
  landmarker: "idle" | "loading" | "ready" | "error";
  landmarkerError: string | null;
  delegate: "GPU" | "CPU" | null;
  socket: SocketStats;
  models: ModelInfo[];
  modelsError: string | null;
  settings: EngineSettings;
  latestResult: InferenceResult | null;
  /** Client-clock epoch ms when latestResult arrived (server timestamps may be skewed). */
  latestReceivedAt: number | null;
  resultHistory: InferenceResult[];
  lastQuality: ImageQuality | null;
  lastCrops: Partial<Record<RegionName, StoredCrop>>;
  frozen: { result: InferenceResult | null; crops: Partial<Record<RegionName, StoredCrop>>; frameImage: string | null } | null;
  explanation: Explanation | null;
  explainPending: string | null;
  explainError: string | null;
  serverError: string | null;
  /** Estimated server_clock - client_clock (ms), from ping/pong (NTP-style, RTT/2 assumption). */
  clockOffsetMs: number | null;
  chat: ChatState;
}

/** Live (per-render) data, intentionally outside React state. */
export interface LiveFrame {
  landmarks: Point2[] | null;
  faces: number;
  frameW: number;
  frameH: number;
  regions: RegionBox[];
  detectMs: number;
  t: number;
  quality: ImageQuality | null;
}

const HISTORY_MAX = 90;

export const DEFAULT_SETTINGS: EngineSettings = {
  source: "camera",
  consentUpload: false,
  inferenceHz: 2,
  paused: false,
  returnInputs: false,
  thresholds: {},
  syntheticIntensity: 0.6,
  autoExplainSec: 0,
};

function stripPreviews(r: InferenceResult): InferenceResult {
  return { ...r, predictions: r.predictions.map((p) => ({ ...p, input: p.input ? { ...p.input, raw_preview_b64: null, tensor_preview_b64: null } : p.input })) };
}

export class AnalysisEngine extends Store<EngineState> {
  readonly telemetry = new TelemetryStore();
  readonly live: LiveFrame = { landmarks: null, faces: 0, frameW: 0, frameH: 0, regions: [], detectMs: 0, t: 0, quality: null };
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private socket: InferenceSocket;
  private rafId: number | null = null;
  private samplerTimer: ReturnType<typeof setInterval> | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private explainTimer: ReturnType<typeof setInterval> | null = null;
  private lastVideoTime = -1;
  private lastDetectTs = 0;
  private frameId = 0;
  private captureCanvas: HTMLCanvasElement | null = null;
  private sampling = false;
  private disposed = false;
  private mode: "mirror" | "lab";

  constructor(mode: "mirror" | "lab", initial: Partial<EngineSettings> = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...initial, returnInputs: initial.returnInputs ?? mode === "lab" };
    super({
      camera: "off",
      cameraError: null,
      landmarker: "idle",
      landmarkerError: null,
      delegate: null,
      socket: {
        status: "idle",
        sessionId: null,
        rttMs: null,
        reconnects: 0,
        framesSent: 0,
        framesSupersededLocally: 0,
        creditTimeouts: 0,
        inFlightFrameId: null,
        lastError: null,
        nextRetryInMs: null,
      },
      models: [],
      modelsError: null,
      settings,
      latestResult: null,
      latestReceivedAt: null,
      resultHistory: [],
      lastQuality: null,
      lastCrops: {},
      frozen: null,
      explanation: null,
      explainPending: null,
      explainError: null,
      serverError: null,
      clockOffsetMs: null,
      chat: { messages: [], pending: false, error: null, lastResponse: null, symptoms: [], replyMeta: {} },
    });
    this.mode = mode;
    this.socket = new InferenceSocket({ url: WS_URL, consent: settings.consentUpload });
    this.socket.onStatus((s) => this.setState({ socket: s }));
    this.socket.onMessage((m) => this.onServerMessage(m));
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.disposed = false;
    this.socket.connect();
    this.sampleTimer = setInterval(() => this.telemetry.sample(), 1000);
    this.restartSampler();
    this.loop();
    api
      .models()
      .then((models) => {
        if (!this.state.models.length) this.setState({ models, modelsError: null });
      })
      .catch((e) => this.setState({ modelsError: String(e.message ?? e) }));
  }

  dispose() {
    this.disposed = true;
    this.stopCamera();
    this.socket.close();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    if (this.samplerTimer) clearInterval(this.samplerTimer);
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.explainTimer) clearInterval(this.explainTimer);
    this.landmarker?.close();
    this.landmarker = null;
  }

  attachVideo(el: HTMLVideoElement | null) {
    this.video = el;
    if (el && this.stream && el.srcObject !== this.stream) {
      el.srcObject = this.stream;
      el.muted = true;
      void el.play().catch(() => undefined);
    }
  }

  get videoElement() {
    return this.video;
  }

  // ------------------------------------------------------------------ settings
  updateSettings(patch: Partial<EngineSettings>) {
    const prev = this.state.settings;
    const settings = { ...prev, ...patch };
    this.setState({ settings });
    if (patch.consentUpload !== undefined) this.socket.setConsent(settings.consentUpload);
    if (patch.inferenceHz !== undefined && patch.inferenceHz !== prev.inferenceHz) this.restartSampler();
    if (patch.autoExplainSec !== undefined) this.restartAutoExplain();
    if (patch.source && patch.source !== prev.source) {
      // Never show results from one input source under another (e.g. simulated crops as camera output).
      this.live.landmarks = null;
      this.live.regions = [];
      this.live.quality = null;
      this.setState({ latestResult: null, latestReceivedAt: null, resultHistory: [], lastCrops: {}, explanation: null, frozen: null, lastQuality: null });
    }
  }

  private restartSampler() {
    if (this.samplerTimer) clearInterval(this.samplerTimer);
    const hz = Math.min(10, Math.max(0.5, this.state.settings.inferenceHz));
    this.samplerTimer = setInterval(() => void this.sampleAndSend(), 1000 / hz);
  }

  private restartAutoExplain() {
    if (this.explainTimer) clearInterval(this.explainTimer);
    this.explainTimer = null;
    const sec = this.state.settings.autoExplainSec;
    if (sec > 0) this.explainTimer = setInterval(() => this.autoExplainTick(), sec * 1000);
  }

  private autoExplainTarget: { modelId: string; region: RegionName } | null = null;
  setAutoExplainTarget(t: { modelId: string; region: RegionName } | null) {
    this.autoExplainTarget = t;
  }
  private autoExplainTick() {
    if (this.autoExplainTarget && !this.state.explainPending && !this.state.frozen) {
      this.requestExplain(this.autoExplainTarget.modelId, this.autoExplainTarget.region);
    }
  }

  // ------------------------------------------------------------------ camera
  async startCamera() {
    if (!this.video) return;
    this.setState({ camera: "starting", cameraError: null });
    try {
      this.stream = await startCamera(this.video);
      this.setState({ camera: "on" });
      void this.ensureLandmarker();
    } catch (e) {
      this.setState({ camera: "error", cameraError: mapCameraError(e) });
    }
  }

  stopCamera() {
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.live.landmarks = null;
    this.live.regions = [];
    this.live.faces = 0;
    this.lastVideoTime = -1;
    if (!this.disposed) this.setState({ camera: "off" });
  }

  async ensureLandmarker() {
    if (this.landmarker || this.state.landmarker === "loading") return;
    this.setState({ landmarker: "loading", landmarkerError: null });
    try {
      const l = await loadFaceLandmarker();
      if (this.disposed) {
        l.landmarker.close();
        return;
      }
      this.landmarker = l.landmarker;
      this.setState({ landmarker: "ready", delegate: l.delegate });
    } catch (e) {
      this.setState({ landmarker: "error", landmarkerError: `Face landmark model failed to load: ${String((e as Error).message ?? e)}` });
    }
  }

  private detect(src: HTMLVideoElement | HTMLCanvasElement): { result: FaceLandmarkerResult; ms: number } | null {
    if (!this.landmarker) return null;
    // VIDEO mode requires strictly increasing timestamps across ALL calls.
    const ts = Math.max(performance.now(), this.lastDetectTs + 1);
    this.lastDetectTs = ts;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(src, ts);
    return { result, ms: performance.now() - t0 };
  }

  /** Render loop at display rate: counts camera frames and tracks landmarks for overlays. */
  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const v = this.video;
    if (this.state.settings.source !== "camera" || !v || this.state.camera !== "on" || v.readyState < 2) return;
    if (v.currentTime === this.lastVideoTime) return; // no new camera frame
    this.lastVideoTime = v.currentTime;
    this.telemetry.countCameraFrame();
    const d = this.detect(v);
    if (!d) return;
    this.telemetry.countLandmarkRun();
    this.updateLive(d.result, v.videoWidth, v.videoHeight, d.ms);
  };

  private updateLive(result: FaceLandmarkerResult, w: number, h: number, ms: number) {
    const faces = result.faceLandmarks?.length ?? 0;
    const lm = faces ? (result.faceLandmarks[0] as Point2[]) : null;
    this.live.faces = faces;
    this.live.landmarks = lm;
    this.live.frameW = w;
    this.live.frameH = h;
    this.live.detectMs = ms;
    this.live.t = epochNow();
    this.live.regions = lm ? computeAllRegions(lm, w, h) : [];
  }

  // ------------------------------------------------------------------ sampler
  private ev(frameId: number, stage: PipelineStage, status: StageStatus, startedPerf: number, durationMs: number, input: string, output: string, message?: string): TelemetryEvent {
    return {
      session_id: this.state.socket.sessionId ?? "pending",
      frame_id: frameId,
      stage,
      status,
      origin: "client",
      started_at: performance.timeOrigin + startedPerf,
      duration_ms: durationMs,
      input_type: input,
      output_type: output,
      message: message ?? null,
      seq: this.telemetry.nextClientSeq(),
    };
  }

  private async sampleAndSend() {
    const s = this.state.settings;
    if (this.sampling || s.paused || this.state.frozen) return;
    if (!s.consentUpload || !this.socket.ready) return;
    if (this.state.socket.inFlightFrameId != null) return; // backpressure at the source
    this.sampling = true;
    try {
      const frame = s.source === "synthetic" ? this.buildSyntheticFrame() : this.buildCameraFrame();
      if (!frame) return;
      const outcome = this.socket.offerFrame(frame);
      if (outcome !== "rejected") this.telemetry.frameSent(frame.frame_id, frame.captured_at);
    } finally {
      this.sampling = false;
    }
  }

  private buildCameraFrame(): ClientFrame | null {
    const v = this.video;
    if (!v || this.state.camera !== "on" || v.readyState < 2 || !this.landmarker) return null;
    const frameId = ++this.frameId;
    const events: TelemetryEvent[] = [];
    const t0 = performance.now();
    this.captureCanvas = captureFrame(v, this.captureCanvas ?? undefined);
    const canvas = this.captureCanvas;
    const capturedAt = performance.timeOrigin + t0;
    events.push(this.ev(frameId, "camera_capture", "ok", t0, performance.now() - t0, "MediaStreamTrack", `RGBA ${canvas.width}x${canvas.height}`));

    const t1 = performance.now();
    const d = this.detect(canvas);
    const faces = d?.result.faceLandmarks?.length ?? 0;
    events.push(
      this.ev(frameId, "face_detection", faces === 1 ? "ok" : "warning", t1, d?.ms ?? 0, "RGBA frame", `${faces} face(s)`, faces === 1 ? "MediaPipe Face Landmarker (detector + mesh, single call)" : faces === 0 ? "No face detected" : "Multiple faces detected"),
    );

    const t2 = performance.now();
    const lm = faces ? (d!.result.faceLandmarks[0] as Point2[]) : null;
    let pose = { yaw: 0, pitch: 0 };
    const matrix = d?.result.facialTransformationMatrixes?.[0]?.data;
    if (lm) pose = matrix ? poseFromMatrix(matrix) : poseFromLandmarks(lm);
    events.push(this.ev(frameId, "landmark_extraction", lm ? "ok" : "skipped", t2, performance.now() - t2, "FaceLandmarkerResult", lm ? `${lm.length} landmarks + pose` : "none", lm ? undefined : "no face"));

    const t3 = performance.now();
    const W = canvas.width;
    const H = canvas.height;
    let quality: ImageQuality;
    if (!lm) {
      quality = assessQuality({ face_count: faces });
    } else {
      const fb = faceBox(lm, W, H);
      const px = roiPixels(canvas, fb, 128);
      const m = measureImage(px.data, px.w, px.h);
      quality = assessQuality({
        brightness: m.brightness,
        contrast: m.contrast,
        sharpness: m.sharpness,
        face_area_fraction: (fb.w * fb.h) / (W * H),
        yaw_deg: pose.yaw,
        pitch_deg: pose.pitch,
        face_count: faces,
      });
    }
    events.push(this.ev(frameId, "image_quality", quality.status === "acceptable" ? "ok" : quality.status === "poor" ? "warning" : "error", t3, performance.now() - t3, "face ROI 128x128", `quality=${quality.status}`, quality.issues.join(", ") || undefined));
    this.live.quality = quality;
    this.setState({ lastQuality: quality });

    if (!lm || quality.status === "unusable") {
      const t4 = performance.now();
      events.push(this.ev(frameId, "region_cropping", "skipped", t4, 0, "landmarks", "none", lm ? "quality gate: unusable" : "no face"));
      this.telemetry.frameSkipped(frameId, capturedAt, events, lm ? "rejected" : "skipped");
      return null;
    }

    const t4 = performance.now();
    const boxes = computeAllRegions(lm, W, H);
    const regions: RegionCrop[] = [];
    const crops: Partial<Record<RegionName, StoredCrop>> = {};
    for (const b of boxes) {
      if (!b.valid) continue;
      const dataUrl = cropToDataUrl(canvas, b.px, 160, 0.9);
      regions.push({ region: b.region, bbox: b.norm, image_b64: dataUrl });
      crops[b.region] = { region: b.region, dataUrl, bbox: b.norm, frameId, synthetic: false };
    }
    events.push(this.ev(frameId, "region_cropping", regions.length ? "ok" : "warning", t4, performance.now() - t4, "RGBA frame + landmarks", `${regions.length} JPEG crops ≤160px`, regions.length < boxes.length ? `${boxes.length - regions.length} region(s) too small` : undefined));
    this.telemetry.recordEvents(events, capturedAt);
    this.setState({ lastCrops: { ...this.state.lastCrops, ...crops } });
    return this.makeFrame(frameId, capturedAt, quality, regions, events);
  }

  private buildSyntheticFrame(): ClientFrame {
    const frameId = ++this.frameId;
    const t0 = performance.now();
    const capturedAt = performance.timeOrigin + t0;
    const events: TelemetryEvent[] = [
      this.ev(frameId, "camera_capture", "skipped", t0, 0, "none", "none", "SIMULATED INPUT: camera not used"),
      this.ev(frameId, "face_detection", "skipped", t0, 0, "none", "none", "SIMULATED INPUT"),
      this.ev(frameId, "landmark_extraction", "skipped", t0, 0, "none", "none", "SIMULATED INPUT"),
    ];
    const quality: ImageQuality = { status: "acceptable", issues: ["synthetic_input"], metrics: { face_count: 1 } };
    events.push(this.ev(frameId, "image_quality", "skipped", t0, 0, "none", "quality=acceptable (assumed)", "SIMULATED INPUT: quality assumed acceptable"));
    const t1 = performance.now();
    const regions: RegionCrop[] = [];
    const crops: Partial<Record<RegionName, StoredCrop>> = {};
    const intensity = this.state.settings.syntheticIntensity;
    for (const r of REGION_NAMES) {
      const dataUrl = syntheticCrop(r, intensity, frameId * 31 + r.length);
      const bbox = SYNTHETIC_LAYOUT[r];
      regions.push({ region: r, bbox, image_b64: dataUrl });
      crops[r] = { region: r, dataUrl, bbox, frameId, synthetic: true };
    }
    events.push(this.ev(frameId, "region_cropping", "ok", t1, performance.now() - t1, "procedural generator", `${regions.length} SIMULATED crops`, "SIMULATED INPUT"));
    this.telemetry.recordEvents(events, capturedAt);
    this.live.quality = quality;
    this.setState({ lastCrops: crops, lastQuality: quality });
    return this.makeFrame(frameId, capturedAt, quality, regions, events);
  }

  private makeFrame(frameId: number, capturedAt: number, quality: ImageQuality, regions: RegionCrop[], events: TelemetryEvent[]): ClientFrame {
    const s = this.state.settings;
    return {
      type: "frame",
      frame_id: frameId,
      captured_at: capturedAt,
      quality,
      regions,
      client_events: events,
      options: { return_inputs: s.returnInputs, thresholds: s.thresholds, enabled_models: null },
    };
  }

  // ------------------------------------------------------------------ server messages
  private onServerMessage(m: ServerMessage) {
    switch (m.type) {
      case "hello_ack":
        this.setState({ models: m.models, modelsError: null, serverError: null });
        break;
      case "inference_result": {
        const receivedAt = epochNow();
        this.telemetry.frameResult(m.frame_id, m.captured_at, m.events, receivedAt);
        const history = [...this.state.resultHistory, stripPreviews(m)].slice(-HISTORY_MAX);
        const tRender = performance.now();
        this.setState({ latestResult: m, latestReceivedAt: Date.now(), resultHistory: history });
        requestAnimationFrame(() => {
          this.telemetry.recordEvents([
            this.ev(m.frame_id, "ui_render", "ok", tRender, performance.now() - tRender, "InferenceResult", "React commit + paint"),
          ]);
        });
        break;
      }
      case "frame_dropped":
        this.telemetry.frameDropped(m.frame_id);
        break;
      case "explanation":
        if (m.request_id === this.state.explainPending || !this.state.explainPending) this.setState({ explanation: m, explainPending: null, explainError: null });
        break;
      case "server_metrics":
        this.telemetry.setServerMetrics(m);
        break;
      case "pong": {
        const rtt = epochNow() - m.t;
        const offset = m.server_time - (m.t + rtt / 2);
        const prev = this.state.clockOffsetMs;
        this.setState({ clockOffsetMs: prev == null ? offset : prev * 0.7 + offset * 0.3 });
        break;
      }
      case "error":
        if (m.request_id && m.request_id === this.state.explainPending) this.setState({ explainPending: null, explainError: m.message });
        else this.setState({ serverError: `${m.code}: ${m.message}` });
        break;
    }
  }

  // ------------------------------------------------------------------ freeze / explain
  toggleFreeze() {
    if (this.state.frozen) {
      this.setState({ frozen: null });
      return;
    }
    let frameImage: string | null = null;
    if (this.state.settings.source === "camera" && this.video && this.state.camera === "on") {
      const c = captureFrame(this.video);
      frameImage = c.toDataURL("image/jpeg", 0.85);
    }
    this.setState({ frozen: { result: this.state.latestResult, crops: { ...this.state.lastCrops }, frameImage } });
  }

  requestExplain(modelId: string, region: RegionName) {
    const crops = this.state.frozen?.crops ?? this.state.lastCrops;
    const crop = crops[region];
    if (!crop) {
      this.setState({ explainError: "No crop available for this region yet. Start analysis first." });
      return;
    }
    if (!this.socket.ready) {
      this.setState({ explainError: "Not connected to the analysis server." });
      return;
    }
    const request_id = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.setState({ explainPending: request_id, explainError: null });
    this.socket.sendExplain({ type: "explain", request_id, model_id: modelId, region, image_b64: crop.dataUrl, target_class: null });
    setTimeout(() => {
      if (this.state.explainPending === request_id) this.setState({ explainPending: null, explainError: "Explanation timed out." });
    }, 15000);
  }

  // ------------------------------------------------------------------ snapshot for history
  /** Full-resolution frame + landmarks for a consented history snapshot. */
  captureSnapshot(): { image: string; landmarks: number[][] } | null {
    const v = this.video;
    if (!v || this.state.camera !== "on" || !this.landmarker) return null;
    const c = captureFrame(v);
    const d = this.detect(c);
    const lm = d?.result.faceLandmarks?.[0];
    if (!lm || d!.result.faceLandmarks.length !== 1) return null;
    return { image: c.toDataURL("image/jpeg", 0.92), landmarks: lm.map((p) => [p.x, p.y, p.z]) };
  }

  // ------------------------------------------------------------------ chat
  setSymptoms(symptoms: string[]) {
    this.setState({ chat: { ...this.state.chat, symptoms } });
  }

  clearChat() {
    this.setState({ chat: { ...this.state.chat, messages: [], lastResponse: null, error: null, replyMeta: {} } });
  }

  async sendChat(text: string) {
    const content = text.trim();
    if (!content || this.state.chat.pending) return;
    const messages: ChatMessage[] = [...this.state.chat.messages, { role: "user", content }];
    this.setState({ chat: { ...this.state.chat, messages, pending: true, error: null } });
    const t0 = performance.now();
    try {
      const res = await api.chat({
        session_id: this.state.socket.sessionId ?? "anonymous",
        messages: messages.slice(-20),
        user_reported_symptoms: this.state.chat.symptoms,
        observations: this.state.latestResult?.observations ?? null,
      });
      this.telemetry.recordEvents(res.events);
      this.telemetry.recordEvents([
        this.ev(-1, "ui_render", "ok", t0, performance.now() - t0, "ChatRequest", "ChatResponse rendered", "client round-trip (includes LLM)"),
      ]);
      const replyMeta = {
        ...this.state.chat.replyMeta,
        [messages.length]: {
          route: res.trace.route,
          followUps: res.reply.follow_up_questions,
          suggestsProfessional: res.reply.suggests_professional,
          provider: `${res.trace.provider}/${res.trace.model}`,
        },
      };
      this.setState({
        chat: { ...this.state.chat, messages: [...messages, { role: "assistant", content: res.reply.message }], pending: false, lastResponse: res, replyMeta },
      });
    } catch (e) {
      this.setState({ chat: { ...this.state.chat, pending: false, error: String((e as Error).message ?? e) } });
    }
  }

  get modeName() {
    return this.mode;
  }
}
