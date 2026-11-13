"use client";

import { useEffect, useRef } from "react";
import { useEngine } from "@/hooks/useEngine";
import { AR_LABEL, hexToRgba, lipPolygons, SWATCHES, tracePolygons, type BlendMode } from "@/lib/ar";
import { displayTransform, toDisplay, type Point2 } from "@/lib/regions";

export interface ARSettings {
  enabled: boolean;
  color: string;
  intensity: number; // 0..1
  blend: BlendMode;
  split: number; // 0..1, area right of this line shows the preview ("after")
  frozen: boolean;
}

export const DEFAULT_AR: ARSettings = { enabled: false, color: SWATCHES[0].hex, intensity: 0.45, blend: "multiply", split: 0, frozen: false };

export function ARBadge() {
  return (
    <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-semibold text-white" role="note">
      {AR_LABEL}
    </div>
  );
}

/** Controls (pure props). The preview is never applied unless the user switches it on. */
export function ARControls({ value, onChange, faceTracked }: { value: ARSettings; onChange: (v: ARSettings) => void; faceTracked: boolean }) {
  const set = (p: Partial<ARSettings>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">Try a lip colour (simulated)</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked, frozen: e.target.checked ? value.frozen : false })} className="h-4 w-4 accent-sky-700" />
          Preview {value.enabled ? "on" : "off"}
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {AR_LABEL}. You pick the colour — retailer pages don&apos;t provide shade colours — and lighting and your camera change how it looks.
      </p>
      {value.enabled && (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preview colour">
            {SWATCHES.map((s) => (
              <button
                key={s.hex}
                type="button"
                role="radio"
                aria-checked={value.color === s.hex}
                aria-label={s.name}
                title={s.name}
                onClick={() => set({ color: s.hex })}
                className={`h-8 w-8 rounded-full border-2 ${value.color === s.hex ? "border-slate-900" : "border-white shadow"}`}
                style={{ background: s.hex }}
              />
            ))}
            <label className="flex items-center gap-1 text-xs">
              custom
              <input type="color" value={value.color} onChange={(e) => set({ color: e.target.value })} aria-label="Custom preview colour" />
            </label>
          </div>
          <label className="flex items-center gap-2">
            Intensity
            <input type="range" min={0.1} max={0.9} step={0.05} value={value.intensity} onChange={(e) => set({ intensity: Number(e.target.value) })} className="flex-1" aria-label="Preview intensity" />
          </label>
          <label className="flex items-center gap-2">
            Before / after split
            <input type="range" min={0} max={0.9} step={0.05} value={value.split} onChange={(e) => set({ split: Number(e.target.value) })} className="flex-1" aria-label="Before and after split" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">
              Blend
              <select value={value.blend} onChange={(e) => set({ blend: e.target.value as BlendMode })} className="rounded border border-slate-300 px-1 py-0.5">
                <option value="multiply">multiply</option>
                <option value="soft-light">soft light</option>
              </select>
            </label>
            <button type="button" onClick={() => set({ frozen: !value.frozen })} className="rounded-lg border border-slate-300 px-3 py-1">
              {value.frozen ? "Unfreeze" : "Freeze frame"}
            </button>
          </div>
          {!faceTracked && <p className="text-xs text-amber-700">No face tracked yet — start the camera and face it.</p>}
        </>
      )}
    </div>
  );
}

/** Canvas layer placed inside <CameraView>; draws the tint over the lip polygon only. */
export function ARLayer({ value, fit, mirrored }: { value: ARSettings; fit: "contain" | "cover"; mirrored: boolean }) {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  const valRef = useRef(value);
  const frozenRef = useRef<{ frame: HTMLCanvasElement; landmarks: Point2[] | null; vw: number; vh: number } | null>(null);
  useEffect(() => {
    valRef.current = value;
    if (value.frozen && !frozenRef.current) {
      const v = engine.videoElement;
      if (v && v.videoWidth) {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d")?.drawImage(v, 0, 0);
        frozenRef.current = { frame: c, landmarks: engine.live.landmarks ? [...engine.live.landmarks] : null, vw: v.videoWidth, vh: v.videoHeight };
      }
    }
    if (!value.frozen) frozenRef.current = null;
  }, [value, engine]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const v = engine.videoElement;
      const parent = c?.parentElement;
      if (!c || !parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const s = valRef.current;
      if (!s.enabled) return;
      const fr = s.frozen ? frozenRef.current : null;
      const vw = fr?.vw ?? v?.videoWidth ?? 0;
      const vh = fr?.vh ?? v?.videoHeight ?? 0;
      if (!vw || !vh) return;
      const t = displayTransform(vw, vh, w, h, fit, mirrored);
      if (fr) {
        // frozen: paint the captured frame ourselves, then blend the tint on the canvas
        ctx.save();
        if (mirrored) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(fr.frame, t.offsetX, t.offsetY, vw * t.scale, vh * t.scale);
        ctx.restore();
      }
      const lm = fr ? fr.landmarks : engine.live.landmarks;
      const poly = lipPolygons(lm, (p) => toDisplay(t, p.x * vw, p.y * vh));
      const splitX = s.split * w;
      if (poly) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, w - splitX, h);
        ctx.clip();
        ctx.globalCompositeOperation = fr ? s.blend : "source-over";
        ctx.filter = "blur(1.5px)"; // soften edges so it doesn't look like a sticker
        ctx.fillStyle = hexToRgba(s.color, s.intensity);
        tracePolygons(ctx, poly);
        ctx.fill("evenodd");
        ctx.restore();
      }
      if (s.split > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(splitX - 1, 0, 2, h);
        ctx.font = "12px system-ui";
        ctx.fillText("before", Math.max(4, splitX - 52), h - 8);
        ctx.fillText("after", splitX + 6, h - 8);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, fit, mirrored]);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        // live mode: the browser blends our tint with the video pixels underneath (texture preserved)
        style={{ mixBlendMode: value.frozen ? "normal" : value.blend }}
      />
      {value.enabled && <ARBadge />}
    </>
  );
}
