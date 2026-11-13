// Download the MediaPipe Face Landmarker model into public/models (gitignored).
// If this step is skipped the app falls back to Google's hosted model URL at runtime.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dst = join(root, "public", "models", "face_landmarker.task");
if (existsSync(dst)) {
  console.log("[fetch-face-model] already present");
  process.exit(0);
}
mkdirSync(dirname(dst), { recursive: true });
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`[fetch-face-model] saved ${dst}`);
} catch (err) {
  console.warn(`[fetch-face-model] download failed (${err}); runtime will use the hosted URL`);
}
