"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEngineState } from "@/hooks/useEngine";
import { AgeOptIn } from "@/components/Age/AgeOptIn";
import { Badge, Empty, LabCard, Stat, statusTone } from "@/components/ui";
import { confirmableLabel, modelRangeLabel, spanLabel, uncertaintyLabel } from "@/lib/age";
import { fmt } from "@/lib/format";

export function AgeTab() {
  const { latestResult, age, models, recommendation, lastCrops } = useEngineState();
  const est = latestResult?.age ?? null;
  const info = models.find((m) => m.model_id === "apparent_age");
  const trace = recommendation.response?.trace;
  const data = est ? est.classes.map((c, i) => ({ range: modelRangeLabel(c), p: est.probabilities[i] ?? 0 })) : [];
  return (
    <LabCard title="Age estimation (opt-in)" subtitle="Apparent-age RANGE only · never stored · never sent to the LLM · only a user-confirmed range reaches recommendations">
      <div className="space-y-3">
        <AgeOptIn dark />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span>model</span>
          <Badge tone="info">{info?.model_id ?? "apparent_age"}</Badge>
          <Badge tone={statusTone(info?.tier)}>{info?.tier ?? "unknown"}</Badge>
          <span className="font-mono">{info?.version ?? "—"}</span>
          <span className="font-mono">{info?.backbone}</span>
          <span className="text-zinc-500">{info?.status_message}</span>
        </div>
        {!age.enabled ? (
          <Empty>Disabled — enable apparent-age estimation above (default off). No face crop is sent while disabled.</Empty>
        ) : !est ? (
          <Empty>Enabled; waiting for an inference result (requires upload consent and a visible face).</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
            <figure className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {est.input?.raw_preview_b64 ? <img src={est.input.raw_preview_b64} alt="Face crop sent to the age model" className="w-full rounded border border-zinc-800" /> : lastCrops.face ? <img src={lastCrops.face.dataUrl} alt="Face crop" className="w-full rounded border border-zinc-800" /> : <Empty>no crop preview</Empty>}
              <figcaption className="text-[10px] text-zinc-500">raw face crop{est.input ? ` ${est.input.raw_size.join("×")} → tensor ${est.input.tensor.shape.join("×")}` : ""}</figcaption>
            </figure>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <Stat label="Decision" value={est.decision} />
                <Stat label="Plausible span" value={spanLabel(est.plausible_ranges)} />
                <Stat label="Top range p" value={fmt(est.top_probability, 2)} />
                <Stat label="Uncertainty" value={`${uncertaintyLabel(est.entropy_bits)} (${fmt(est.entropy_bits, 2)} bits)`} />
                <Stat label="Expected (approx.)" value={fmt(est.expected_age_years, 0)} unit="y" title="Probability-weighted range midpoints — coarse" />
                <Stat label="Latency" value={fmt(est.latency_ms, 1)} unit="ms" />
                <Stat label="Confirmed by user" value={age.confirmedRange ? confirmableLabel(age.confirmedRange) : age.status} />
                <Stat label="Used in last recs" value={trace ? (trace.age_used ? "yes" : "no") : "—"} title={trace?.age_note} />
              </div>
              <p className="text-[10px] text-zinc-500">{est.decision_reason}</p>
              <div className="h-36 rounded border border-zinc-800 bg-zinc-950/60 p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#a1a1aa" }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#71717a" }} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 10 }} formatter={(v) => [Number(v).toFixed(3), "probability"]} />
                    <Bar dataKey="p" fill="#e879f9" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {trace && <p className="text-[10px] text-zinc-400">Last recommendation: {trace.age_note}</p>}
              <p className="text-[10px] text-zinc-500">{est.disclaimer}</p>
            </div>
          </div>
        )}
      </div>
    </LabCard>
  );
}
