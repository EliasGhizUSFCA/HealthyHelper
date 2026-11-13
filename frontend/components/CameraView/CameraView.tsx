"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { meshConnections, type Connection } from "@/lib/landmarker";
import { displayTransform } from "@/lib/regions";
import { drawOverlay, type OverlayLayers } from "@/components/FaceOverlay/drawOverlay";
import { regionLabel } from "@/lib/format";
import { cx } from "@/components/ui";

export function CameraView({
  layers,
  mirrored = true,
  fit = "contain",
  className,
  dark = true,
}: {
  layers: OverlayLayers;
  mirrored?: boolean;
  fit?: "contain" | "cover";
  className?: string;
  dark?: boolean;
}) {
  const engine = useEngine();
  const state = useEngineState();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef(layers);
  const [conns, setConns] = useState<{ tesselation: Connection[]; contours: Connection[] } | null>(null);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    engine.attachVideo(videoRef.current);
    return () => engine.attachVideo(null);
  }, [engine]);

  useEffect(() => {
    if (state.landmarker === "ready" && !conns) meshConnections().then(setConns).catch(() => undefined);
  }, [state.landmarker, conns]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const v = videoRef.current;
      const wrap = wrapRef.current;
      if (!c || !v || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (engine.getState().camera !== "on" || engine.getState().settings.source !== "camera") {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      const t = displayTransform(v.videoWidth, v.videoHeight, w, h, fit, mirrored);
      drawOverlay(ctx, engine.live, t, layersRef.current, conns, { w, h });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, conns, fit, mirrored]);

  const synthetic = state.settings.source === "synthetic";
  return (
    <div ref={wrapRef} className={cx("relative h-full w-full overflow-hidden", dark ? "bg-black" : "bg-slate-200", className)}>
      <video
        ref={videoRef}
        aria-label="Live camera preview"
        className={cx("absolute inset-0 h-full w-full", fit === "contain" ? "object-contain" : "object-cover", synthetic && "invisible")}
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      {synthetic && (
        <div className="absolute inset-0 flex flex-col gap-2 overflow-auto p-2">
          <div className="rounded border border-fuchsia-600 bg-fuchsia-950/80 px-2 py-1 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-fuchsia-200">
            Simulated input · procedurally generated crops · not a camera image
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Object.values(state.lastCrops).map((c) =>
              c ? (
                <figure key={c.region} className="rounded border border-fuchsia-800/60 bg-zinc-950 p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.dataUrl} alt={`Simulated ${regionLabel(c.region)} crop`} className="aspect-square w-full object-cover" />
                  <figcaption className="mt-0.5 text-center font-mono text-[9px] text-fuchsia-300">SIM · {regionLabel(c.region)}</figcaption>
                </figure>
              ) : null,
            )}
          </div>
          {!Object.keys(state.lastCrops).length && <p className="text-center text-xs text-zinc-400">Waiting for the sampler… (requires server connection + upload consent)</p>}
        </div>
      )}
      {!synthetic && state.camera !== "on" && (
        <div className={cx("absolute inset-0 flex items-center justify-center p-4 text-center text-sm", dark ? "text-zinc-500" : "text-slate-600")}>
          {state.camera === "starting" ? "Starting camera…" : state.camera === "error" ? state.cameraError?.message : "Camera is off"}
        </div>
      )}
      {!synthetic && state.camera === "on" && state.landmarker === "loading" && (
        <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-zinc-200">Loading face landmark model…</div>
      )}
      {state.landmarkerError && <div className="absolute bottom-2 left-2 right-2 rounded bg-rose-950/90 px-2 py-1 text-xs text-rose-200">{state.landmarkerError}</div>}
    </div>
  );
}
