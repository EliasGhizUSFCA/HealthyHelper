"use client";

import { useEngine, useEngineState } from "@/hooks/useEngine";
import { Badge, Empty, LabCard, statusTone } from "@/components/ui";
import { fmt, humanize, regionLabel } from "@/lib/format";
import { ProbabilityTrend } from "./ProbabilityTrend";
import { StaleNotice } from "@/components/StaleNotice";

export function PredictionsPanel() {
  const engine = useEngine();
  const { latestResult, latestReceivedAt, frozen, resultHistory, models, settings } = useEngineState();
  const result = frozen?.result ?? latestResult;
  const setThr = (modelId: string, v: number) => engine.updateSettings({ thresholds: { ...settings.thresholds, [modelId]: v } });

  return (
    <LabCard id="p3" title="P3 · Predictions & confidence" subtitle="Classifier scores — not the probability that you have any medical condition">
      <div className="mb-2 flex flex-wrap gap-2">
        {models.map((m) => {
          const thr = settings.thresholds[m.model_id] ?? m.default_threshold;
          return (
            <label key={m.model_id} className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">
              <span className="font-mono text-zinc-300">{m.model_id}</span> thr
              <input type="range" min={0.5} max={0.99} step={0.01} value={thr} onChange={(e) => setThr(m.model_id, Number(e.target.value))} aria-label={`Confidence threshold for ${m.model_id}`} className="w-20" />
              <span className="w-8 font-mono text-zinc-200">{thr.toFixed(2)}</span>
              {settings.thresholds[m.model_id] != null && (
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-200"
                  title="Reset to model default"
                  onClick={() => {
                    const t = { ...settings.thresholds };
                    delete t[m.model_id];
                    engine.updateSettings({ thresholds: t });
                  }}
                >
                  ↺
                </button>
              )}
            </label>
          );
        })}
      </div>
      {!frozen && <StaleNotice completedAt={latestReceivedAt} dark />}
      {!result ? (
        <Empty>No predictions yet.</Empty>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {result.predictions.map((p) => (
            <article key={`${p.model_id}:${p.region}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <header className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-zinc-100">{p.model_id}</span>
                <span className="font-mono text-[10px] text-zinc-500">v{p.model_version}</span>
                <Badge tone={statusTone(p.model_tier)}>{p.model_tier}</Badge>
                <Badge tone="info">{regionLabel(p.region)}</Badge>
                <span className="ml-auto">
                  <Badge tone={statusTone(p.decision)} title={p.decision_reason}>
                    {p.decision}
                  </Badge>
                </span>
              </header>
              <div className="mt-1.5 space-y-0.5">
                {p.classes.map((c, i) => {
                  const prob = p.probabilities[i] ?? 0;
                  const top = c === p.top_class;
                  return (
                    <div key={c} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-36 truncate font-mono ${top ? "text-zinc-100" : "text-zinc-500"}`} title={c}>
                        {humanize(c)}
                      </span>
                      <div className="relative h-2.5 flex-1 rounded-sm bg-zinc-800">
                        <div className={`absolute inset-y-0 left-0 rounded-sm ${top ? "bg-cyan-400" : "bg-zinc-600"}`} style={{ width: `${prob * 100}%` }} />
                        <div className="absolute inset-y-[-2px] w-px bg-amber-400" style={{ left: `${p.threshold * 100}%` }} title={`threshold ${p.threshold}`} />
                      </div>
                      <span className="w-10 text-right font-mono tabular-nums text-zinc-300">{fmt(prob, 3)}</span>
                    </div>
                  );
                })}
                {p.classes.length === 0 && <p className="text-[10px] text-zinc-500">No class outputs ({p.decision_reason}).</p>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-zinc-500">
                <span>top: {p.top_class ? humanize(p.top_class) : "—"}</span>
                <span>thr {p.threshold.toFixed(2)}</span>
                <span>{fmt(p.latency_ms, 1)} ms</span>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-500">{p.decision_reason}</p>
              <div className="mt-1 h-16">
                <ProbabilityTrend history={resultHistory} modelId={p.model_id} region={p.region} threshold={p.threshold} />
              </div>
            </article>
          ))}
        </div>
      )}
    </LabCard>
  );
}
