import type { Connection } from "@/lib/landmarker";
import type { RegionName } from "@/lib/protocol";
import { boxToDisplay, REGION_COLORS, REGION_DEFS, REGION_GROUPS, toDisplay, type DisplayTransform } from "@/lib/regions";
import type { LiveFrame } from "@/lib/engine";
import { regionLabel } from "@/lib/format";

export interface OverlayLayers {
  points: boolean;
  mesh: boolean;
  eyes: boolean;
  lips: boolean;
  nose: boolean;
  skin: boolean;
  undereye: boolean;
  tracking: boolean;
  quality: boolean;
  /** Regions consumed by the currently selected model (highlighted). Empty = none. */
  modelRegions: RegionName[];
}

export const DEFAULT_LAYERS: OverlayLayers = {
  points: false,
  mesh: true,
  eyes: true,
  lips: true,
  nose: true,
  skin: true,
  undereye: true,
  tracking: true,
  quality: true,
  modelRegions: [],
};

export const MIRROR_LAYERS: OverlayLayers = { ...DEFAULT_LAYERS, mesh: false, eyes: false, lips: false, nose: false, skin: false, undereye: false, tracking: false, quality: false };

function regionEnabled(r: RegionName, layers: OverlayLayers) {
  if (REGION_GROUPS.eyes.includes(r)) return layers.eyes;
  if (REGION_GROUPS.lips.includes(r)) return layers.lips;
  if (REGION_GROUPS.nose.includes(r)) return layers.nose;
  if (REGION_GROUPS.undereye.includes(r)) return layers.undereye;
  return layers.skin;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  live: LiveFrame,
  t: DisplayTransform,
  layers: OverlayLayers,
  conns: { tesselation: Connection[]; contours: Connection[] } | null,
  dims: { w: number; h: number },
) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  const lm = live.landmarks;
  if (lm) {
    const pts = lm.map((p) => toDisplay(t, p.x * live.frameW, p.y * live.frameH));
    if (layers.mesh && conns) {
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const c of conns.tesselation) {
        const a = pts[c.start];
        const b = pts[c.end];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(34,211,238,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const c of conns.contours) {
        const a = pts[c.start];
        const b = pts[c.end];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    if (layers.points) {
      ctx.fillStyle = "rgba(250,250,250,0.85)";
      for (const p of pts) ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
    }
    ctx.font = "10px ui-monospace, monospace";
    for (const rb of live.regions) {
      const highlighted = layers.modelRegions.includes(rb.region);
      if (!regionEnabled(rb.region, layers) && !highlighted) continue;
      const b = boxToDisplay(t, rb.px);
      const color = REGION_COLORS[rb.region];
      ctx.strokeStyle = rb.valid ? color : "rgba(244,63,94,0.9)";
      ctx.lineWidth = highlighted ? 2.5 : 1.25;
      ctx.setLineDash(rb.region.startsWith("skin") ? [4, 3] : []);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      if (rb.region.startsWith("skin") && layers.skin) {
        // skin boundary: polygon of the defining landmarks
        ctx.beginPath();
        REGION_DEFS[rb.region].landmarks.forEach((i, k) => {
          const p = pts[i];
          if (!p) return;
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgba(167,139,250,0.12)";
        ctx.fill();
      }
      const label = `${regionLabel(rb.region)}${rb.valid ? "" : " (too small)"}`;
      ctx.fillStyle = "rgba(9,9,11,0.75)";
      const tw = ctx.measureText(label).width + 6;
      ctx.fillRect(b.x, b.y - 13, tw, 13);
      ctx.fillStyle = color;
      ctx.fillText(label, b.x + 3, b.y - 3);
    }
  }
  let y = 16;
  ctx.font = "11px ui-monospace, monospace";
  if (layers.tracking) {
    const txt = lm ? `TRACKING · ${live.faces} face${live.faces === 1 ? "" : "s"} · ${live.detectMs.toFixed(1)} ms` : "NO FACE";
    ctx.fillStyle = "rgba(9,9,11,0.7)";
    ctx.fillRect(6, y - 12, ctx.measureText(txt).width + 8, 16);
    ctx.fillStyle = lm ? (live.faces === 1 ? "#34d399" : "#fbbf24") : "#f43f5e";
    ctx.fillText(txt, 10, y);
    y += 18;
  }
  if (layers.quality && live.quality && live.quality.issues.length) {
    for (const issue of live.quality.issues.slice(0, 4)) {
      const txt = `⚠ ${issue}`;
      ctx.fillStyle = "rgba(9,9,11,0.7)";
      ctx.fillRect(6, y - 12, ctx.measureText(txt).width + 8, 16);
      ctx.fillStyle = live.quality.status === "unusable" ? "#f43f5e" : "#fbbf24";
      ctx.fillText(txt, 10, y);
      y += 18;
    }
  }
}
