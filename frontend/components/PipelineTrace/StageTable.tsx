"use client";

import { PIPELINE_ORDER, type PipelineStage, type TelemetryEvent } from "@/lib/protocol";
import { Badge, statusTone } from "@/components/ui";
import { fmt, humanize } from "@/lib/format";

export const STAGE_COLORS: Record<PipelineStage, string> = {
  camera_capture: "#64748b",
  image_quality: "#a3e635",
  face_detection: "#22d3ee",
  landmark_extraction: "#38bdf8",
  region_cropping: "#818cf8",
  preprocessing: "#c084fc",
  age_estimation: "#e879f9",
  cv_inference: "#f472b6",
  structured_observations: "#fb923c",
  user_preferences: "#fdba74",
  product_retrieval: "#2dd4bf",
  product_ranking: "#5eead4",
  llm_request: "#facc15",
  response_validation: "#4ade80",
  ui_render: "#94a3b8",
};

export function StageTable({ lastByStage, now }: { lastByStage: Partial<Record<PipelineStage, TelemetryEvent>>; now: number }) {
  return (
    <table className="w-full table-fixed text-[10px]">
      <thead className="text-left text-[9px] uppercase tracking-wider text-zinc-500">
        <tr>
          <th className="w-[26%] py-0.5">Stage</th>
          <th className="w-[11%]">State</th>
          <th className="w-[19%]">Input</th>
          <th className="w-[19%]">Output</th>
          <th className="w-[9%] text-right">ms</th>
          <th className="w-[16%] pl-2">Note</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {PIPELINE_ORDER.map((s, i) => {
          const e = lastByStage[s];
          const age = e ? (now - e.started_at) / 1000 : null;
          return (
            <tr key={s} className="border-t border-zinc-800/70 align-top">
              <td className="truncate py-0.5 text-zinc-200" title={s}>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: STAGE_COLORS[s] }} />
                {i + 1}. {humanize(s)}
                {e && <span className="ml-1 text-zinc-600">{e.origin === "client" ? "browser" : "server"}</span>}
              </td>
              <td>{e ? <Badge tone={statusTone(e.status)}>{e.status}</Badge> : <span className="text-zinc-600">idle</span>}</td>
              <td className="truncate text-zinc-400" title={e?.input_type}>
                {e?.input_type ?? "—"}
              </td>
              <td className="truncate text-zinc-400" title={e?.output_type}>
                {e?.output_type ?? "—"}
              </td>
              <td className="text-right tabular-nums text-zinc-200">{e ? fmt(e.duration_ms, 1) : "—"}</td>
              <td className="truncate pl-2 text-zinc-500" title={e?.message ?? undefined}>
                {e?.message ?? (age != null && age > 5 ? `${age.toFixed(0)}s ago` : "")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
