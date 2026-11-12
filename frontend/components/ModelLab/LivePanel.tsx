"use client";

import { useMemo, useState } from "react";
import { useEngine, useEngineState, useTelemetry } from "@/hooks/useEngine";
import { CameraView } from "@/components/CameraView/CameraView";
import { DEFAULT_LAYERS, type OverlayLayers } from "@/components/FaceOverlay/drawOverlay";
import { Badge, LabCard, LabToggle, Stat, statusTone } from "@/components/ui";
import { fmt } from "@/lib/format";

const LAYER_LABELS: [keyof Omit<OverlayLayers, "modelRegions">, string][] = [
  ["points", "Points"],
  ["mesh", "Mesh"],
  ["eyes", "Eyes"],
  ["lips", "Lips"],
  ["nose", "Nose"],
  ["skin", "Skin"],
  ["tracking", "Tracking"],
  ["quality", "Quality"],
];

export function LivePanel() {
  const engine = useEngine();
  const state = useEngineState();
  const tel = useTelemetry();
  const [layers, setLayers] = useState<OverlayLayers>(DEFAULT_LAYERS);
  const [modelSel, setModelSel] = useState<string>("");
  const [mirrored, setMirrored] = useState(true);
  const modelRegions = useMemo(() => state.models.find((m) => m.model_id === modelSel)?.regions ?? [], [state.models, modelSel]);
  const effLayers = useMemo(() => ({ ...layers, modelRegions }), [layers, modelRegions]);
  const last = tel.series[tel.series.length - 1];
  const lastInfer = tel.lastByStage.cv_inference;
  const synthetic = state.settings.source === "synthetic";

  return (
    <LabCard
      id="p1"
      title="P1 · Live camera & detection overlay"
      subtitle={synthetic ? "SIMULATED INPUT — camera not in use" : "Landmarks run in-browser at camera rate; boxes use the same transform as the displayed video"}
      actions={
        <>
          <Badge tone={statusTone(state.camera === "on" ? "ok" : state.camera === "error" ? "error" : "idle")}>cam {state.camera}</Badge>
          <Badge tone={state.landmarker === "ready" ? "ok" : state.landmarker === "error" ? "error" : "skip"}>
            mp {state.landmarker}
            {state.delegate ? `·${state.delegate}` : ""}
          </Badge>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {LAYER_LABELS.map(([k, label]) => (
            <LabToggle key={k} label={label} checked={layers[k]} onChange={(v) => setLayers((l) => ({ ...l, [k]: v }))} />
          ))}
          <LabToggle label="Mirror" checked={mirrored} onChange={setMirrored} title="Display only; crops always come from the unmirrored frame" />
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            Model regions
            <select value={modelSel} onChange={(e) => setModelSel(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-200">
              <option value="">none</option>
              {state.models.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="relative min-h-40 flex-1 overflow-hidden rounded border border-zinc-800">
          <CameraView layers={effLayers} mirrored={mirrored} fit="contain" />
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <Stat label="Camera frames" value={tel.counters.cameraFrames} title="Distinct video frames rendered (not inference calls)" />
          <Stat label="Camera FPS" value={fmt(last?.cameraFps)} />
          <Stat label="Landmark ms" value={synthetic ? "—" : fmt(engine.live.detectMs)} title="Last in-browser detectForVideo duration" />
          <Stat label="Inference calls" value={tel.counters.inferenceResults} title="Server classifier results received" />
          <Stat label="Inference FPS" value={fmt(last?.inferenceFps, 2)} />
          <Stat label="Server CV ms" value={fmt(lastInfer?.duration_ms)} />
        </div>
        {state.camera !== "on" && !synthetic && (
          <div className="flex gap-2">
            <button type="button" onClick={() => engine.startCamera()} className="rounded border border-cyan-600 bg-cyan-900/60 px-2 py-1 text-xs text-cyan-100">
              Start camera
            </button>
            {state.cameraError && <span className="text-xs text-rose-300">{state.cameraError.message}</span>}
          </div>
        )}
      </div>
    </LabCard>
  );
}
