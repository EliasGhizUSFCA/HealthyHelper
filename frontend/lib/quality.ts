import type { ImageQuality, QualityMetrics, QualityStatus } from "./protocol";
import type { Point2 } from "./regions";

/** Thresholds are heuristic engineering defaults, documented in docs/ (not clinically derived). */
export const QUALITY_THRESHOLDS = {
  brightness: { unusableLow: 40, poorLow: 70, poorHigh: 195, unusableHigh: 225 },
  contrast: { poorLow: 15 },
  sharpness: { unusable: 12, poor: 35 },
  faceArea: { unusable: 0.03, poor: 0.07, poorHigh: 0.65 },
  yaw: { poor: 20, unusable: 35 },
  pitch: { poor: 20, unusable: 30 },
} as const;

export const ISSUE_GUIDANCE: Record<string, string> = {
  no_face: "We can't see a face. Center your face in the frame.",
  multiple_faces: "More than one face is visible. Only one person should be in view.",
  too_dark: "It's too dark to see clearly. Try facing a window or a lamp.",
  dim_lighting: "Lighting is a bit dim. More even, frontal light will help.",
  overexposed: "The image is overexposed. Move away from direct bright light.",
  bright_lighting: "Lighting is quite bright; reduce glare if you can.",
  low_contrast: "The image looks flat or washed out.",
  very_blurry: "The image is very blurry. Hold still and check the camera lens.",
  blurry: "The image is slightly blurry. Hold still for a moment.",
  face_too_small: "You're too far from the camera. Move closer.",
  move_closer: "Move a little closer to the camera.",
  too_close: "You're very close. Move back a little so your whole face fits.",
  head_turned: "Please face the camera directly.",
  face_camera_yaw: "Turn your head slightly toward the camera.",
  head_tilted: "Level your head so you are looking straight at the camera.",
  face_camera_pitch: "Tilt your head slightly so you look straight ahead.",
  synthetic_input: "Simulated input: no camera image is being analysed.",
};

/** Rec.601 luma from RGBA pixels. */
export function toGray(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return out;
}

export function meanStd(gray: Float32Array): { mean: number; std: number } {
  if (gray.length === 0) return { mean: 0, std: 0 };
  let s = 0;
  for (const v of gray) s += v;
  const mean = s / gray.length;
  let v2 = 0;
  for (const v of gray) v2 += (v - mean) * (v - mean);
  return { mean, std: Math.sqrt(v2 / gray.length) };
}

/** Variance of the 4-neighbour Laplacian (same kernel as cv2.Laplacian ksize=1). */
export function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  const n = (w - 2) * (h - 2);
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += l;
      sumSq += l * l;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Yaw/pitch/roll in degrees from MediaPipe's 4x4 column-major facial transformation matrix. */
export function poseFromMatrix(data: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const r = (row: number, col: number) => data[col * 4 + row];
  const sy = Math.sqrt(r(0, 0) ** 2 + r(1, 0) ** 2);
  const pitch = Math.atan2(r(2, 1), r(2, 2));
  const yaw = Math.atan2(-r(2, 0), sy);
  const roll = Math.atan2(r(1, 0), r(0, 0));
  const deg = 180 / Math.PI;
  return { yaw: yaw * deg, pitch: pitch * deg, roll: roll * deg };
}

/** Landmark-geometry fallback when no transformation matrix is available. */
export function poseFromLandmarks(lm: ReadonlyArray<Point2>): { yaw: number; pitch: number } {
  const le = lm[263];
  const re = lm[33];
  const nose = lm[1];
  const chin = lm[152];
  const brow = lm[168];
  if (!le || !re || !nose || !chin || !brow) return { yaw: 0, pitch: 0 };
  const eyeMidX = (le.x + re.x) / 2;
  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 1e-6;
  const yaw = Math.atan2(nose.x - eyeMidX, eyeDist * 0.9) * (180 / Math.PI);
  const faceH = Math.abs(chin.y - brow.y) || 1e-6;
  const ratio = (nose.y - brow.y) / faceH; // ~0.45 when level
  const pitch = (ratio - 0.45) * 120;
  return { yaw, pitch };
}

export function assessQuality(m: QualityMetrics, extraIssues: string[] = []): ImageQuality {
  const T = QUALITY_THRESHOLDS;
  const issues: string[] = [];
  let status: QualityStatus = "acceptable";
  const poor = (i: string) => {
    issues.push(i);
    if (status === "acceptable") status = "poor";
  };
  const unusable = (i: string) => {
    issues.push(i);
    status = "unusable";
  };

  if (m.face_count != null) {
    if (m.face_count === 0) unusable("no_face");
    else if (m.face_count > 1) unusable("multiple_faces");
  }
  if (m.brightness != null) {
    if (m.brightness < T.brightness.unusableLow) unusable("too_dark");
    else if (m.brightness < T.brightness.poorLow) poor("dim_lighting");
    else if (m.brightness > T.brightness.unusableHigh) unusable("overexposed");
    else if (m.brightness > T.brightness.poorHigh) poor("bright_lighting");
  }
  if (m.contrast != null && m.contrast < T.contrast.poorLow) poor("low_contrast");
  if (m.sharpness != null) {
    if (m.sharpness < T.sharpness.unusable) unusable("very_blurry");
    else if (m.sharpness < T.sharpness.poor) poor("blurry");
  }
  if (m.face_area_fraction != null) {
    if (m.face_area_fraction < T.faceArea.unusable) unusable("face_too_small");
    else if (m.face_area_fraction < T.faceArea.poor) poor("move_closer");
    else if (m.face_area_fraction > T.faceArea.poorHigh) poor("too_close");
  }
  if (m.yaw_deg != null) {
    const a = Math.abs(m.yaw_deg);
    if (a > T.yaw.unusable) unusable("head_turned");
    else if (a > T.yaw.poor) poor("face_camera_yaw");
  }
  if (m.pitch_deg != null) {
    const a = Math.abs(m.pitch_deg);
    if (a > T.pitch.unusable) unusable("head_tilted");
    else if (a > T.pitch.poor) poor("face_camera_pitch");
  }
  for (const i of extraIssues) issues.push(i);
  return { status, issues, metrics: m };
}

/** Compute luma metrics on an RGBA buffer (already downscaled face ROI). */
export function measureImage(data: Uint8ClampedArray, w: number, h: number) {
  const gray = toGray(data, w, h);
  const { mean, std } = meanStd(gray);
  return { brightness: mean, contrast: std, sharpness: laplacianVariance(gray, w, h) };
}
