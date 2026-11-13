"use client";

import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { CameraActiveIndicator, ConsentToggle } from "@/components/Mirror/CameraControls";
import { Badge, LabButton, LabToggle, SimulatedBanner, statusTone } from "@/components/ui";
import { buildDiagnostics } from "@/lib/diagnostics";
import { downloadBlob } from "@/lib/crops";
import { fmt } from "@/lib/format";
import { CameraPicker } from "@/components/CameraView/CameraPicker";

export const PERFORMANCE_MODES = [
  { key: "saver", label: "Power saver", hz: 0.5, inputs: false },
  { key: "balanced", label: "Balanced", hz: 2, inputs: true },
  { key: "responsive", label: "Responsive", hz: 5, inputs: true },
] as const;

export function LabToolbar() {
  const engine = useEngine();
  const state = useEngineState();
  const [includeImages, setIncludeImages] = useState(false);
  const s = state.settings;
  const exportDiag = () => {
    const d = buildDiagnostics(engine.getState(), engine.telemetry.getSnapshot(), includeImages);
    downloadBlob(`ahm-diagnostics-${Date.now()}.json`, new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
  };
  return (
    <div className="space-y-1.5 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Input source" className="flex overflow-hidden rounded border border-zinc-700">
          {(["camera", "synthetic"] as const).map((src) => (
            <button
              key={src}
              type="button"
              role="radio"
              aria-checked={s.source === src}
              onClick={() => {
                if (src === "synthetic") engine.stopCamera();
                engine.updateSettings({ source: src });
              }}
              className={`px-2 py-0.5 text-[11px] ${s.source === src ? (src === "synthetic" ? "bg-fuchsia-800 text-white" : "bg-cyan-800 text-white") : "bg-zinc-900 text-zinc-400"}`}
            >
              {src === "camera" ? "Camera" : "Synthetic test input"}
            </button>
          ))}
        </div>
        {s.source === "camera" &&
          (state.camera === "on" ? (
            <LabButton tone="danger" onClick={() => engine.stopCamera()}>
              Stop camera
            </LabButton>
          ) : (
            <LabButton tone="primary" onClick={() => engine.startCamera()} disabled={state.camera === "starting"}>
              Start camera
            </LabButton>
          ))}
        {s.source === "synthetic" && (
          <label className="flex items-center gap-1 text-[11px] text-fuchsia-300">
            simulated feature intensity
            <input type="range" min={0} max={1} step={0.05} value={s.syntheticIntensity} onChange={(e) => engine.updateSettings({ syntheticIntensity: Number(e.target.value) })} aria-label="Simulated feature intensity" className="w-20" />
            <span className="font-mono">{s.syntheticIntensity.toFixed(2)}</span>
          </label>
        )}
        <LabButton onClick={() => engine.updateSettings({ paused: !s.paused })} active={s.paused}>
          {s.paused ? "▶ Resume" : "❚❚ Pause"}
        </LabButton>
        <LabButton onClick={() => engine.toggleFreeze()} active={!!state.frozen}>
          {state.frozen ? "Unfreeze" : "Freeze"}
        </LabButton>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          rate
          <input type="range" min={0.5} max={10} step={0.5} value={s.inferenceHz} onChange={(e) => engine.updateSettings({ inferenceHz: Number(e.target.value) })} aria-label="Inference sampling rate" className="w-20" />
          <span className="w-11 font-mono text-zinc-200">{s.inferenceHz.toFixed(1)}Hz</span>
        </label>
        <LabToggle label="Inputs" checked={s.returnInputs} onChange={(v) => engine.updateSettings({ returnInputs: v })} title="Ask the server to return raw/tensor previews" />
        <div role="radiogroup" aria-label="Performance mode" className="flex overflow-hidden rounded border border-zinc-700">
          {PERFORMANCE_MODES.map((m) => {
            const active = s.inferenceHz === m.hz && s.returnInputs === m.inputs;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={active}
                title={`${m.hz} Hz inference${m.inputs ? ", model-input previews" : ", no previews"}`}
                onClick={() => engine.updateSettings({ inferenceHz: m.hz, returnInputs: m.inputs })}
                className={`px-2 py-0.5 text-[11px] ${active ? "bg-cyan-800 text-white" : "bg-zinc-900 text-zinc-400"}`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {s.source === "camera" && <CameraPicker dark />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CameraActiveIndicator dark />
          <Badge tone={statusTone(state.socket.status)} title={state.socket.lastError ?? undefined}>
            ws {state.socket.status}
            {state.socket.nextRetryInMs != null ? ` (${(state.socket.nextRetryInMs / 1000).toFixed(1)}s)` : ""}
          </Badge>
          <span className="font-mono text-[10px] text-zinc-500">
            rtt {fmt(state.socket.rttMs)}ms · sess {state.socket.sessionId?.slice(0, 8) ?? "—"} · reconnects {state.socket.reconnects}
          </span>
          <LabToggle label="include images" checked={includeImages} onChange={setIncludeImages} title="Off by default for privacy" />
          <LabButton onClick={exportDiag} title="Download a JSON of telemetry and model info (no chat text; no images unless ticked)">
            Export diagnostics
          </LabButton>
        </div>
      </div>
      <div className="max-w-3xl">
        <ConsentToggle dark />
      </div>
      {s.source === "synthetic" && <SimulatedBanner />}
      {state.frozen && <div className="rounded border border-sky-700 bg-sky-950/60 px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-widest text-sky-200">Frame frozen — panels show the frozen frame; sampling paused</div>}
      {state.serverError && <div className="rounded border border-rose-800 bg-rose-950/60 px-2 py-0.5 text-[11px] text-rose-200">Server: {state.serverError}</div>}
      {state.modelsError && !state.models.length && <div className="rounded border border-amber-800 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-200">Model registry unavailable: {state.modelsError}</div>}
    </div>
  );
}
