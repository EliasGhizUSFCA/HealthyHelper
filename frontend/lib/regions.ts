import regionsJson from "./generated/regions.json";
import type { RegionName } from "./protocol";

export interface RegionDef {
  label: string;
  landmarks: number[];
  margin: number;
  square: boolean;
  min_size_px: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RegionBox {
  region: RegionName;
  px: PixelBox;
  /** [x, y, w, h] normalised to the source frame */
  norm: [number, number, number, number];
  valid: boolean;
  reason?: string;
}

export const REGION_DEFS = regionsJson.regions as Record<RegionName, RegionDef>;
export const REGION_NAMES = Object.keys(REGION_DEFS) as RegionName[];
export const REGIONS_VERSION: string = regionsJson.version;

export const REGION_GROUPS: Record<"eyes" | "lips" | "nose" | "skin", RegionName[]> = {
  eyes: ["left_eye", "right_eye"],
  lips: ["lips"],
  nose: ["nose"],
  skin: ["skin_forehead", "skin_left_cheek", "skin_right_cheek"],
};

export const REGION_COLORS: Record<RegionName, string> = {
  lips: "#f472b6",
  left_eye: "#22d3ee",
  right_eye: "#38bdf8",
  nose: "#fbbf24",
  skin_forehead: "#a78bfa",
  skin_left_cheek: "#c084fc",
  skin_right_cheek: "#818cf8",
};

/**
 * Compute a (square) pixel bounding box for a facial region from normalised landmarks.
 * Mirrors backend/app/cv/regions.py::region_bbox_px — keep the maths identical
 * (parity pinned by the shared reference case in tests/regions.test.ts and backend/tests/test_regions_alignment.py).
 */
export function computeRegionBox(
  region: RegionName,
  landmarks: ReadonlyArray<Point2>,
  frameW: number,
  frameH: number,
  def: RegionDef = REGION_DEFS[region],
): RegionBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const idx of def.landmarks) {
    const p = landmarks[idx];
    if (!p) {
      return { region, px: { x: 0, y: 0, w: 0, h: 0 }, norm: [0, 0, 0, 0], valid: false, reason: "missing_landmark" };
    }
    const x = p.x * frameW;
    const y = p.y * frameH;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  let w = maxX - minX;
  let h = maxY - minY;
  const cx = minX + w / 2;
  const cy = minY + h / 2;
  w = w * (1 + 2 * def.margin);
  h = h * (1 + 2 * def.margin);
  if (def.square) {
    // square side is capped by the smaller frame dimension so the crop stays square
    const s = Math.min(Math.max(w, h), frameW, frameH);
    w = s;
    h = s;
  } else {
    w = Math.min(w, frameW);
    h = Math.min(h, frameH);
  }
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.min(Math.max(x, 0), frameW - w);
  y = Math.min(Math.max(y, 0), frameH - h);
  const valid = Math.min(w, h) >= def.min_size_px;
  return {
    region,
    px: { x, y, w, h },
    norm: [x / frameW, y / frameH, w / frameW, h / frameH],
    valid,
    reason: valid ? undefined : "region_too_small",
  };
}

export function computeAllRegions(
  landmarks: ReadonlyArray<Point2>,
  frameW: number,
  frameH: number,
  regions: RegionName[] = REGION_NAMES,
): RegionBox[] {
  return regions.map((r) => computeRegionBox(r, landmarks, frameW, frameH));
}

/** Face bounding box over all landmarks (pixels). */
export function faceBox(landmarks: ReadonlyArray<Point2>, frameW: number, frameH: number): PixelBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = Math.max(0, minX) * frameW;
  const y = Math.max(0, minY) * frameH;
  return { x, y, w: (Math.min(1, maxX) - Math.max(0, minX)) * frameW, h: (Math.min(1, maxY) - Math.max(0, minY)) * frameH };
}

/**
 * Transform from source-video pixel coordinates to on-screen element coordinates for an
 * `object-fit: contain | cover` video, optionally mirrored horizontally.
 */
export interface DisplayTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  mirrored: boolean;
  elementW: number;
}

export function displayTransform(
  videoW: number,
  videoH: number,
  elemW: number,
  elemH: number,
  fit: "contain" | "cover",
  mirrored: boolean,
): DisplayTransform {
  if (videoW <= 0 || videoH <= 0) return { scale: 1, offsetX: 0, offsetY: 0, mirrored, elementW: elemW };
  const sx = elemW / videoW;
  const sy = elemH / videoH;
  const scale = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  return {
    scale,
    offsetX: (elemW - videoW * scale) / 2,
    offsetY: (elemH - videoH * scale) / 2,
    mirrored,
    elementW: elemW,
  };
}

export function toDisplay(t: DisplayTransform, x: number, y: number): Point2 {
  const dx = t.offsetX + x * t.scale;
  return { x: t.mirrored ? t.elementW - dx : dx, y: t.offsetY + y * t.scale };
}

export function boxToDisplay(t: DisplayTransform, b: PixelBox): PixelBox {
  const a = toDisplay(t, b.x, b.y);
  const c = toDisplay(t, b.x + b.w, b.y + b.h);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}
