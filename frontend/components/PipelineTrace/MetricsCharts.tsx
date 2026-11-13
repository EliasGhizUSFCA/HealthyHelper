"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SeriesPoint } from "@/lib/telemetry";

type Key = keyof SeriesPoint;

function Mini({ title, data, lines, unit }: { title: string; data: SeriesPoint[]; lines: { key: Key; color: string; name: string }[]; unit?: string }) {
  const hasData = data.some((d) => lines.some((l) => d[l.key] != null));
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
      <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
        {title}
        {unit && <span className="normal-case text-zinc-600"> ({unit})</span>}
      </div>
      <div className="h-20">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -26 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="2 3" />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: 8, fill: "#71717a" }} allowDecimals />
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 10 }} labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()} formatter={(v, n) => [typeof v === "number" ? v.toFixed(2) : "—", n]} />
              {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 8 }} iconSize={6} />}
              {lines.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={1.25} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">no measurements</div>
        )}
      </div>
    </div>
  );
}

export function MetricsCharts({ series }: { series: SeriesPoint[] }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
      <Mini
        title="Rates"
        unit="per s"
        data={series}
        lines={[
          { key: "cameraFps", color: "#64748b", name: "camera frames" },
          { key: "landmarkFps", color: "#22d3ee", name: "landmark runs" },
          { key: "inferenceFps", color: "#f472b6", name: "inference results" },
        ]}
      />
      <Mini title="Face detection + mesh (browser)" unit="ms" data={series} lines={[{ key: "faceDetectMs", color: "#22d3ee", name: "face detection" }]} />
      <Mini title="Classifier inference (server)" unit="ms" data={series} lines={[{ key: "classifierMs", color: "#f472b6", name: "cv inference" }]} />
      <Mini title="LLM response" unit="ms" data={series} lines={[{ key: "llmMs", color: "#facc15", name: "llm" }]} />
      <Mini title="End-to-end (capture → result)" unit="ms" data={series} lines={[{ key: "e2eMs", color: "#f4f4f5", name: "e2e" }]} />
      <Mini
        title="Server resources"
        data={series}
        lines={[
          { key: "cpu", color: "#fb923c", name: "CPU %" },
          { key: "rssMb", color: "#a78bfa", name: "RSS MB" },
        ]}
      />
      <Mini
        title="Not processed (cumulative)"
        data={series}
        lines={[
          { key: "dropped", color: "#f43f5e", name: "dropped by server" },
          { key: "rejected", color: "#f59e0b", name: "rejected by quality gate" },
          { key: "skipped", color: "#71717a", name: "skipped (no face)" },
        ]}
      />
    </div>
  );
}
