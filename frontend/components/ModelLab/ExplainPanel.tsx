"use client";

import { useEffect, useMemo, useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { compositePng, HeatmapViewer } from "@/components/HeatmapViewer/HeatmapViewer";
import { Badge, Empty, LabButton, LabCard, LabToggle } from "@/components/ui";
import { downloadBlob } from "@/lib/crops";
import { fmt, regionLabel } from "@/lib/format";
import type { RegionName } from "@/lib/protocol";

export function ExplainPanel() {
  const engine = useEngine();
  const { models, explanation, explainPending, explainError, frozen, settings, lastCrops } = useEngineState();
  const explainable = useMemo(() => models.filter((m) => m.explainable && m.tier !== "unavailable"), [models]);
  const [modelId, setModelId] = useState("");
  const [region, setRegion] = useState<RegionName | "">("");
  const [show, setShow] = useState(true);
  const [opacity, setOpacity] = useState(0.55);
  const model = explainable.find((m) => m.model_id === modelId) ?? explainable[0];
  const reg: RegionName | undefined = model ? (model.regions.includes(region as RegionName) ? (region as RegionName) : model.regions[0]) : undefined;

  useEffect(() => {
    engine.setAutoExplainTarget(model && reg ? { modelId: model.model_id, region: reg } : null);
  }, [engine, model, reg]);

  const save = async () => {
    if (!explanation) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const png = await compositePng(explanation.input_b64, explanation.heatmap_b64, opacity);
    downloadBlob(`ahm-gradcam-${explanation.model_id}-${explanation.region}-${stamp}.png`, png);
    const meta = { ...explanation, input_b64: "[see PNG]", heatmap_b64: "[see PNG]", opacity, saved_at: stamp, synthetic_input: settings.source === "synthetic" };
    downloadBlob(`ahm-gradcam-${stamp}.json`, new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }));
  };

  const crops = frozen?.crops ?? lastCrops;
  return (
    <LabCard
      id="p4"
      title="P4 · Visual explainability"
      subtitle="Grad-CAM — an approximate attribution visualisation, not proof of what caused a prediction"
      actions={
        <LabButton onClick={() => engine.toggleFreeze()} active={!!frozen} title="Freeze the current frame, crops and predictions">
          {frozen ? "Unfreeze" : "Freeze frame"}
        </LabButton>
      }
    >
      {!explainable.length ? (
        <Empty>No explainable model is loaded.</Empty>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <select aria-label="Model to explain" value={model?.model_id} onChange={(e) => setModelId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200">
              {explainable.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_id}
                </option>
              ))}
            </select>
            <select aria-label="Region" value={reg} onChange={(e) => setRegion(e.target.value as RegionName)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200">
              {model?.regions.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(r)}
                </option>
              ))}
            </select>
            <LabButton tone="primary" disabled={!model || !reg || !!explainPending || !crops[reg!]} onClick={() => model && reg && engine.requestExplain(model.model_id, reg)}>
              {explainPending ? "Computing…" : frozen ? "Explain frozen crop" : "Explain latest crop"}
            </LabButton>
            <label className="flex items-center gap-1 text-zinc-400">
              auto
              <select aria-label="Automatic explanation interval" value={settings.autoExplainSec} onChange={(e) => engine.updateSettings({ autoExplainSec: Number(e.target.value) })} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200">
                <option value={0}>off</option>
                <option value={2}>every 2 s</option>
                <option value={5}>every 5 s</option>
                <option value={10}>every 10 s</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <LabToggle label="Heatmap" checked={show} onChange={setShow} />
            <label className="flex items-center gap-1 text-zinc-400">
              opacity
              <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Heatmap opacity" className="w-24" />
              <span className="w-8 font-mono text-zinc-200">{opacity.toFixed(2)}</span>
            </label>
            <LabButton disabled={!explanation} onClick={() => void save()} title="Downloads a PNG + JSON to this device only; nothing is uploaded">
              Save diagnostic snapshot
            </LabButton>
          </div>
          {explainError && <p className="text-[11px] text-rose-300">{explainError}</p>}
          {!crops[reg!] && <p className="text-[11px] text-zinc-500">No crop for this region yet.</p>}
          {explanation ? (
            <div>
              <HeatmapViewer input={explanation.input_b64} heatmap={explanation.heatmap_b64} opacity={opacity} show={show} label={`${explanation.model_id} ${explanation.region}`} />
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-zinc-400">
                <span>{explanation.model_id} v{explanation.model_version}</span>
                <span>{regionLabel(explanation.region)}</span>
                <span>method {explanation.method}</span>
                <span>target {explanation.target_class} ({fmt(explanation.target_probability, 3)})</span>
                <span>{fmt(explanation.latency_ms)} ms</span>
                {settings.source === "synthetic" && <Badge tone="violet">simulated input</Badge>}
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">{explanation.caveat}</p>
            </div>
          ) : (
            <Empty>Choose a model and region, then request an explanation. Grad-CAM is computed on demand off the real-time path.</Empty>
          )}
        </div>
      )}
    </LabCard>
  );
}
