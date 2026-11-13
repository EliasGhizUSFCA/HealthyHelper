/**
 * Simulated lip-colour preview geometry. The colour is chosen by the user (product pages carry no colour values),
 * blended with the camera image (multiply / soft-light) so lip texture shows through. Always labelled simulated.
 */
import type { Point2 } from "./regions";

export const AR_LABEL = "Simulated preview — not how the product will look";

export const LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

export const SWATCHES: { name: string; hex: string }[] = [
  { name: "Sheer rose", hex: "#c75b7a" },
  { name: "Berry", hex: "#8e2f4f" },
  { name: "Coral", hex: "#e2694f" },
  { name: "Brick", hex: "#9c3b2a" },
  { name: "Nude", hex: "#b9806b" },
  { name: "Deep plum", hex: "#5b2340" },
];

export type BlendMode = "multiply" | "soft-light";

/** Outer lip polygon and inner mouth polygon (to be cut out with even-odd fill), mapped through `map`. */
export function lipPolygons(landmarks: ReadonlyArray<Point2> | null, map: (p: Point2) => Point2 = (p) => p): { outer: Point2[]; inner: Point2[] } | null {
  if (!landmarks) return null;
  const pick = (idx: number[]) => idx.map((i) => landmarks[i]).filter(Boolean).map(map);
  const outer = pick(LIP_OUTER);
  const inner = pick(LIP_INNER);
  if (outer.length !== LIP_OUTER.length || inner.length !== LIP_INNER.length) return null;
  return { outer, inner };
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.min(1, Math.max(0, alpha))})`;
}

export function tracePolygons(ctx: CanvasRenderingContext2D, poly: { outer: Point2[]; inner: Point2[] }) {
  ctx.beginPath();
  for (const ring of [poly.outer, poly.inner]) {
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
}
