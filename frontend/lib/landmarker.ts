import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { FACE_MODEL_LOCAL, FACE_MODEL_REMOTE, MEDIAPIPE_WASM } from "./config";

export interface LoadedLandmarker {
  landmarker: FaceLandmarker;
  delegate: "GPU" | "CPU";
  modelSource: "local" | "remote";
  loadMs: number;
}

async function localModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(FACE_MODEL_LOCAL, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * MediaPipe's WASM runtime writes routine INFO logs (e.g. "INFO: Created TensorFlow Lite XNNPACK
 * delegate for CPU.") to stderr, which Emscripten maps to console.error. Next.js dev then reports
 * them as "Console Error". Only those informational lines are dropped; real errors pass through.
 */
export function isBenignMediapipeLog(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== "string") return false;
  // "INFO: ..." from TFLite, or glog info lines like "I1113 00:08:54.094 ... file.cc:123] ..."
  return /^INFO: /.test(first) || /^I\d{4} \d{2}:\d{2}:\d{2}/.test(first);
}

let consoleFilterInstalled = false;
function installMediapipeLogFilter(): void {
  if (consoleFilterInstalled || typeof console === "undefined") return;
  consoleFilterInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (isBenignMediapipeLog(args)) {
      console.debug(...args);
      return;
    }
    original(...args);
  };
}

/** Load MediaPipe Face Landmarker in VIDEO mode. Tries GPU, falls back to CPU. Browser only. */
export async function loadFaceLandmarker(): Promise<LoadedLandmarker> {
  installMediapipeLogFilter();
  const t0 = performance.now();
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(new URL(MEDIAPIPE_WASM, window.location.origin).toString());
  const local = await localModelAvailable();
  const modelAssetPath = local ? FACE_MODEL_LOCAL : FACE_MODEL_REMOTE;
  const make = (delegate: "GPU" | "CPU") =>
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: "VIDEO",
      numFaces: 2, // detect up to 2 so the quality gate can reject multi-person frames
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  let landmarker: FaceLandmarker;
  let delegate: "GPU" | "CPU" = "GPU";
  try {
    landmarker = await make("GPU");
  } catch {
    delegate = "CPU";
    landmarker = await make("CPU");
  }
  return { landmarker, delegate, modelSource: local ? "local" : "remote", loadMs: performance.now() - t0 };
}

export type Connection = { start: number; end: number };

export async function meshConnections(): Promise<{ tesselation: Connection[]; contours: Connection[] }> {
  const vision = await import("@mediapipe/tasks-vision");
  const F = vision.FaceLandmarker;
  return {
    tesselation: F.FACE_LANDMARKS_TESSELATION,
    contours: [
      ...F.FACE_LANDMARKS_FACE_OVAL,
      ...F.FACE_LANDMARKS_LIPS,
      ...F.FACE_LANDMARKS_LEFT_EYE,
      ...F.FACE_LANDMARKS_RIGHT_EYE,
      ...F.FACE_LANDMARKS_LEFT_EYEBROW,
      ...F.FACE_LANDMARKS_RIGHT_EYEBROW,
    ],
  };
}
