/**
 * Procedural SIMULATED region crops so the full pipeline can be exercised without a webcam.
 * These are not images of anyone; anything computed from them is not an observation.
 */
import type { RegionName } from "./protocol";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function fillNoise(ctx: Ctx, size: number, base: [number, number, number], amp: number, rnd: () => number) {
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    img.data[i] = base[0] + n;
    img.data[i + 1] = base[1] + n;
    img.data[i + 2] = base[2] + n;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function lines(ctx: Ctx, size: number, n: number, color: string, width: number, rnd: () => number, region?: [number, number, number, number]) {
  const [x0, y0, x1, y1] = region ?? [0, 0, size, size];
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    let x = x0 + rnd() * (x1 - x0);
    let y = y0 + rnd() * (y1 - y0);
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rnd() - 0.5) * size * 0.15;
      y += (rnd() - 0.3) * size * 0.12;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawRegion(ctx: Ctx, region: RegionName, size: number, intensity: number, rnd: () => number) {
  const skin: [number, number, number] = [196 + rnd() * 20, 150 + rnd() * 20, 125 + rnd() * 20];
  if (region === "lips") {
    fillNoise(ctx, size, skin, 14, rnd);
    ctx.fillStyle = `rgb(${185 - intensity * 30},${90 + intensity * 30},${100 + intensity * 20})`;
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, size * 0.38, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    lines(ctx, size, Math.round(intensity * 14), "rgba(240,220,215,0.85)", 1.2, rnd, [size * 0.2, size * 0.38, size * 0.8, size * 0.62]);
  } else if (region === "left_eye" || region === "right_eye") {
    fillNoise(ctx, size, skin, 12, rnd);
    ctx.fillStyle = `rgb(245,${235 - intensity * 50},${230 - intensity * 60})`;
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, size * 0.36, size * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    lines(ctx, size, Math.round(intensity * 12), "rgba(200,40,40,0.7)", 1, rnd, [size * 0.18, size * 0.4, size * 0.82, size * 0.6]);
    ctx.fillStyle = "#5b3a24";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else if (region === "nose") {
    fillNoise(ctx, size, [skin[0] + intensity * 25, skin[1] - intensity * 25, skin[2] - intensity * 20], 12, rnd);
    ctx.fillStyle = "rgba(90,50,40,0.6)";
    ctx.beginPath();
    ctx.ellipse(size * 0.38, size * 0.75, size * 0.07, size * 0.04, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.62, size * 0.75, size * 0.07, size * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (region === "left_undereye" || region === "right_undereye") {
    fillNoise(ctx, size, skin, 12, rnd);
    ctx.fillStyle = `rgba(70,45,60,${0.15 + intensity * 0.45})`;
    ctx.filter = "blur(6px)";
    ctx.beginPath();
    ctx.ellipse(size / 2, size * 0.3, size * 0.36, size * 0.18, 0, 0, Math.PI);
    ctx.fill();
    ctx.filter = "none";
    ctx.strokeStyle = "rgba(60,40,30,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(size / 2, size * 0.18, size * 0.4, size * 0.1, 0, 0, Math.PI);
    ctx.stroke();
  } else {
    fillNoise(ctx, size, skin, 16, rnd);
    const flakes = Math.round(intensity * 60);
    for (let i = 0; i < flakes; i++) {
      ctx.fillStyle = `rgba(245,240,235,${0.5 + rnd() * 0.4})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 4, 1 + rnd() * 3);
    }
  }
}

/** Render one SIMULATED crop as a JPEG data URL. */
export function syntheticCrop(region: RegionName, intensity: number, seed: number, size = 160): string {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  drawRegion(ctx, region, size, Math.min(1, Math.max(0, intensity)), mulberry32(seed));
  return c.toDataURL("image/jpeg", 0.9);
}

/** Fixed layout of synthetic regions within a notional 1x1 frame (for bbox fields). */
export const SYNTHETIC_LAYOUT: Record<RegionName, [number, number, number, number]> = {
  skin_forehead: [0.4, 0.1, 0.2, 0.2],
  right_eye: [0.25, 0.3, 0.15, 0.15],
  left_eye: [0.6, 0.3, 0.15, 0.15],
  nose: [0.42, 0.42, 0.16, 0.16],
  skin_right_cheek: [0.2, 0.5, 0.18, 0.18],
  skin_left_cheek: [0.62, 0.5, 0.18, 0.18],
  lips: [0.38, 0.68, 0.24, 0.16],
  right_undereye: [0.25, 0.42, 0.14, 0.1],
  left_undereye: [0.61, 0.42, 0.14, 0.1],
  skin_chin: [0.43, 0.84, 0.14, 0.12],
};
