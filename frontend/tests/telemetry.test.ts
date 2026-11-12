import { describe, expect, it } from "vitest";
import { orderEvents, TelemetryStore } from "@/lib/telemetry";
import type { PipelineStage, TelemetryEvent } from "@/lib/protocol";

const ev = (frame: number, stage: PipelineStage, started: number, origin: "client" | "server" = "client", seq = 0, dur = 1): TelemetryEvent => ({
  session_id: "s",
  frame_id: frame,
  stage,
  status: "ok",
  origin,
  started_at: started,
  duration_ms: dur,
  input_type: "a",
  output_type: "b",
  seq,
});

describe("orderEvents", () => {
  it("orders by time, then pipeline order, then seq", () => {
    const out = orderEvents([ev(1, "cv_inference", 10, "server", 2), ev(1, "camera_capture", 0), ev(1, "preprocessing", 10, "server", 1), ev(1, "image_quality", 5, "client", 2), ev(1, "face_detection", 5, "client", 1)]);
    expect(out.map((e) => e.stage)).toEqual(["camera_capture", "image_quality", "face_detection", "preprocessing", "cv_inference"]);
  });
});

describe("TelemetryStore", () => {
  it("bounds events, frames and series", () => {
    const t = new TelemetryStore({ maxEvents: 5, maxFrames: 3, maxSeries: 4 });
    for (let i = 0; i < 10; i++) t.recordEvents([ev(i, "camera_capture", i)]);
    for (let i = 0; i < 10; i++) t.sample(i * 1000);
    t.flush();
    const s = t.getSnapshot();
    expect(s.events).toHaveLength(5);
    expect(s.events.map((e) => e.frame_id)).toEqual([5, 6, 7, 8, 9]);
    expect(s.frames.map((f) => f.frameId)).toEqual([7, 8, 9]);
    expect(s.series).toHaveLength(4);
  });

  it("merges client and server events per frame and computes end-to-end latency", () => {
    const t = new TelemetryStore();
    t.recordEvents([ev(1, "camera_capture", 100), ev(1, "region_cropping", 105)], 100);
    t.frameSent(1, 100);
    t.frameResult(1, 100, [ev(1, "cv_inference", 120, "server", 2), ev(1, "preprocessing", 110, "server", 1)], 150);
    t.flush();
    const f = t.getSnapshot().frames[0];
    expect(f.events.map((e) => e.stage)).toEqual(["camera_capture", "region_cropping", "preprocessing", "cv_inference"]);
    expect(f.e2eMs).toBe(50);
    expect(f.outcome).toBe("result");
    expect(t.getSnapshot().counters.inferenceResults).toBe(1);
  });

  it("computes camera FPS separately from inference FPS", () => {
    const t = new TelemetryStore();
    t.sample(0);
    for (let i = 0; i < 30; i++) t.countCameraFrame();
    for (let i = 0; i < 30; i++) t.countLandmarkRun();
    t.frameResult(1, 0, [], 10);
    t.frameResult(2, 0, [], 10);
    t.sample(1000);
    t.flush();
    const last = t.getSnapshot().series.at(-1)!;
    expect(last.cameraFps).toBe(30);
    expect(last.landmarkFps).toBe(30);
    expect(last.inferenceFps).toBe(2);
  });

  it("counts dropped, rejected and skipped frames", () => {
    const t = new TelemetryStore();
    t.frameSent(1, 0);
    t.frameDropped(1);
    t.frameSkipped(2, 0, [], "rejected");
    t.frameSkipped(3, 0, [], "skipped");
    t.flush();
    const c = t.getSnapshot().counters;
    expect([c.framesDropped, c.framesRejected, c.framesSkipped]).toEqual([1, 1, 1]);
    expect(t.getSnapshot().frames.find((f) => f.frameId === 1)?.outcome).toBe("dropped");
  });

  it("notifies subscribers with a new snapshot on flush", () => {
    const t = new TelemetryStore();
    let n = 0;
    t.subscribe(() => n++);
    const before = t.getSnapshot();
    t.recordEvents([ev(1, "ui_render", 0)]);
    t.flush();
    expect(n).toBe(1);
    expect(t.getSnapshot()).not.toBe(before);
    expect(t.getSnapshot().lastByStage.ui_render).toBeDefined();
  });
});
