import { describe, expect, it } from "vitest";
import { assessQuality, laplacianVariance, meanStd, poseFromMatrix, QUALITY_THRESHOLDS, toGray } from "@/lib/quality";

const good = { brightness: 130, contrast: 40, sharpness: 120, face_area_fraction: 0.2, yaw_deg: 3, pitch_deg: -2, face_count: 1 };

describe("assessQuality", () => {
  it("accepts a good frame", () => {
    const q = assessQuality(good);
    expect(q.status).toBe("acceptable");
    expect(q.issues).toEqual([]);
  });
  it.each([
    [{ face_count: 0 }, "unusable", "no_face"],
    [{ face_count: 2 }, "unusable", "multiple_faces"],
    [{ brightness: QUALITY_THRESHOLDS.brightness.unusableLow - 1 }, "unusable", "too_dark"],
    [{ brightness: QUALITY_THRESHOLDS.brightness.poorLow - 1 }, "poor", "dim_lighting"],
    [{ brightness: QUALITY_THRESHOLDS.brightness.unusableHigh + 1 }, "unusable", "overexposed"],
    [{ contrast: 5 }, "poor", "low_contrast"],
    [{ sharpness: QUALITY_THRESHOLDS.sharpness.unusable - 1 }, "unusable", "very_blurry"],
    [{ sharpness: QUALITY_THRESHOLDS.sharpness.poor - 1 }, "poor", "blurry"],
    [{ face_area_fraction: 0.01 }, "unusable", "face_too_small"],
    [{ face_area_fraction: 0.05 }, "poor", "move_closer"],
    [{ face_area_fraction: 0.8 }, "poor", "too_close"],
    [{ yaw_deg: 40 }, "unusable", "head_turned"],
    [{ yaw_deg: -25 }, "poor", "face_camera_yaw"],
    [{ pitch_deg: 35 }, "unusable", "head_tilted"],
  ])("%o -> %s (%s)", (patch, status, issue) => {
    const q = assessQuality({ ...good, ...patch });
    expect(q.status).toBe(status);
    expect(q.issues).toContain(issue);
  });
  it("unusable dominates poor regardless of order", () => {
    const q = assessQuality({ ...good, contrast: 5, face_count: 0 });
    expect(q.status).toBe("unusable");
  });
  it("threshold boundaries are inclusive of the acceptable side", () => {
    expect(assessQuality({ ...good, brightness: QUALITY_THRESHOLDS.brightness.poorLow }).status).toBe("acceptable");
    expect(assessQuality({ ...good, sharpness: QUALITY_THRESHOLDS.sharpness.poor }).status).toBe("acceptable");
  });
});

describe("image metrics", () => {
  it("laplacian variance is 0 for flat images and large for checkerboards", () => {
    const w = 16;
    const flat = new Float32Array(w * w).fill(128);
    expect(laplacianVariance(flat, w, w)).toBeCloseTo(0);
    const checker = new Float32Array(w * w).map((_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
    expect(laplacianVariance(checker, w, w)).toBeGreaterThan(10000);
  });
  it("gray conversion and mean/std", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const g = toGray(rgba, 2, 1);
    expect(g[0]).toBeCloseTo(255);
    expect(g[1]).toBe(0);
    expect(meanStd(g)).toEqual({ mean: 127.5, std: 127.5 });
  });
  it("pose from identity matrix is zero; yaw rotation recovered", () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const p = poseFromMatrix(id);
    expect(Math.abs(p.yaw)).toBeLessThan(1e-9);
    expect(Math.abs(p.pitch)).toBeLessThan(1e-9);
    const a = (30 * Math.PI) / 180;
    // rotation about Y, column-major
    const ry = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    expect(poseFromMatrix(ry).yaw).toBeCloseTo(30, 6);
  });
});
