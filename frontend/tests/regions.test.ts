import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxToDisplay, computeAllRegions, computeRegionBox, displayTransform, REGION_DEFS, REGION_NAMES, toDisplay, type Point2 } from "@/lib/regions";

function fakeLandmarks(fill: (i: number) => Point2): Point2[] {
  return Array.from({ length: 478 }, (_, i) => fill(i));
}

describe("regions.json sync", () => {
  it("frontend copy is byte-identical to shared/regions.json", () => {
    const shared = join(__dirname, "..", "..", "shared", "regions.json");
    const local = join(__dirname, "..", "lib", "generated", "regions.json");
    if (!existsSync(shared)) return; // standalone frontend checkout (e.g. Vercel)
    expect(readFileSync(local, "utf8")).toBe(readFileSync(shared, "utf8"));
  });
  it("defines all seven regions", () => {
    expect(REGION_NAMES.sort()).toEqual(["left_eye", "lips", "nose", "right_eye", "skin_forehead", "skin_left_cheek", "skin_right_cheek"]);
  });
});

describe("computeRegionBox", () => {
  const W = 640;
  const H = 480;
  it("computes a square box with margin around the defining landmarks", () => {
    // put all lip landmarks on a 100x40 px rectangle centred at (320, 300)
    const lm = fakeLandmarks(() => ({ x: 0.5, y: 0.5 }));
    const lips = REGION_DEFS.lips.landmarks;
    lips.forEach((idx, k) => {
      lm[idx] = { x: (270 + (k % 2) * 100) / W, y: (280 + (k % 3 === 0 ? 0 : 40)) / H };
    });
    const b = computeRegionBox("lips", lm, W, H);
    expect(b.valid).toBe(true);
    const side = 100 * (1 + 2 * REGION_DEFS.lips.margin);
    expect(b.px.w).toBeCloseTo(side, 5);
    expect(b.px.h).toBeCloseTo(side, 5);
    expect(b.px.x + b.px.w / 2).toBeCloseTo(320, 5);
    expect(b.px.y + b.px.h / 2).toBeCloseTo(300, 5);
    expect(b.norm[0]).toBeCloseTo(b.px.x / W, 9);
    expect(b.norm[3]).toBeCloseTo(b.px.h / H, 9);
  });

  it("clamps boxes to the frame by shifting, not shrinking, when possible", () => {
    const lm = fakeLandmarks(() => ({ x: 0.5, y: 0.5 }));
    REGION_DEFS.right_eye.landmarks.forEach((idx, k) => {
      lm[idx] = { x: (k % 2) * (60 / W), y: 0.01 + (k % 2) * (30 / H) };
    });
    const b = computeRegionBox("right_eye", lm, W, H);
    expect(b.px.x).toBeGreaterThanOrEqual(0);
    expect(b.px.y).toBeGreaterThanOrEqual(0);
    expect(b.px.x + b.px.w).toBeLessThanOrEqual(W);
    expect(b.px.w).toBeCloseTo(60 * (1 + 2 * REGION_DEFS.right_eye.margin), 5);
  });

  it("caps the box at the frame size", () => {
    const lm = fakeLandmarks((i) => ({ x: i % 2, y: i % 3 === 0 ? 0 : 1 }));
    const b = computeRegionBox("nose", lm, W, H);
    expect(b.px.w).toBeLessThanOrEqual(H);
    expect(b.px.y).toBe(0);
  });

  it("marks tiny regions invalid", () => {
    const lm = fakeLandmarks(() => ({ x: 0.5, y: 0.5 }));
    const b = computeRegionBox("lips", lm, W, H);
    expect(b.valid).toBe(false);
    expect(b.reason).toBe("region_too_small");
  });

  it("reports missing landmarks", () => {
    const b = computeRegionBox("lips", [], W, H);
    expect(b.valid).toBe(false);
    expect(b.reason).toBe("missing_landmark");
  });

  it("computes every region", () => {
    const lm = fakeLandmarks((i) => ({ x: 0.2 + ((i * 37) % 100) / 200, y: 0.2 + ((i * 53) % 100) / 200 }));
    expect(computeAllRegions(lm, W, H)).toHaveLength(7);
  });
});

describe("displayTransform", () => {
  it("letterboxes object-fit: contain", () => {
    const t = displayTransform(1280, 720, 400, 400, "contain", false);
    expect(t.scale).toBeCloseTo(400 / 1280);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo((400 - 720 * (400 / 1280)) / 2);
    const p = toDisplay(t, 1280, 720);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(400 - t.offsetY);
  });
  it("crops object-fit: cover and mirrors x", () => {
    const t = displayTransform(1280, 720, 400, 400, "cover", true);
    expect(t.scale).toBeCloseTo(400 / 720);
    const p = toDisplay(t, 640, 360);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(200);
    const left = toDisplay(t, 0, 0);
    expect(left.x).toBeGreaterThan(400); // mirrored: source-left lands on the right
    const b = boxToDisplay(t, { x: 600, y: 300, w: 80, h: 60 });
    expect(b.w).toBeCloseTo(80 * t.scale);
    expect(b.x + b.w).toBeCloseTo(400 - (t.offsetX + 600 * t.scale));
  });
});

describe("backend parity", () => {
  it("matches the reference case in backend/tests/test_regions_alignment.py", () => {
    // landmarks spanning x 100..140, y 50..60 px in a 200x100 frame, margin 0.25 → (90, 25, 60, 60)
    const lm: Point2[] = [
      { x: 100 / 200, y: 50 / 100 },
      { x: 140 / 200, y: 60 / 100 },
    ];
    const b = computeRegionBox("lips", lm, 200, 100, { label: "t", landmarks: [0, 1], margin: 0.25, square: true, min_size_px: 10 });
    expect(b.px).toEqual({ x: 90, y: 25, w: 60, h: 60 });
  });
});
