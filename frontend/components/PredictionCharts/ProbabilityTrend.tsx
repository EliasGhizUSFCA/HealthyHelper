"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { InferenceResult } from "@/lib/protocol";

export function ProbabilityTrend({ history, modelId, region, threshold }: { history: InferenceResult[]; modelId: string; region: string; threshold: number }) {
  const data = history
    .map((r) => {
      const p = r.predictions.find((x) => x.model_id === modelId && x.region === region);
      return p ? { frame: r.frame_id, score: p.positive_probability, decision: p.decision } : null;
    })
    .filter(Boolean) as { frame: number; score: number | null; decision: string }[];
  if (data.length < 2) return <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">collecting…</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -24 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="2 3" />
        <XAxis dataKey="frame" tick={{ fontSize: 9, fill: "#71717a" }} />
        <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tick={{ fontSize: 9, fill: "#71717a" }} />
        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} labelFormatter={(f) => `frame #${f}`} formatter={(v) => [typeof v === "number" ? v.toFixed(3) : String(v), "positive-class score"]} />
        <ReferenceLine y={threshold} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: `thr ${threshold.toFixed(2)}`, fill: "#f59e0b", fontSize: 9, position: "insideTopRight" }} />
        <Line type="monotone" dataKey="score" stroke="#22d3ee" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
