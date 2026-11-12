export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export function wsUrlFrom(apiUrl: string): string {
  return apiUrl.replace(/^http/, "ws") + "/ws/inference";
}

export const WS_URL = wsUrlFrom(API_URL);

export const FACE_MODEL_LOCAL = "/models/face_landmarker.task";
export const FACE_MODEL_REMOTE =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
export const MEDIAPIPE_WASM = "/mediapipe/wasm";
