"use client";

import type { FrameTrace } from "@/lib/telemetry";
import { STAGE_COLORS } from "./StageTable";
import { humanize } from "@/lib/format";

/** Gantt-style view of the last N frames. Server timestamps are shifted by the estimated clock offset. */
export function Timeline({ frames, clockOffsetMs, n = 10 }: { frames: FrameTrace[]; clockOffsetMs: number | null; n?: number }) {
  const shown = frames.filter((f) => f.events.length).slice(-n);
  if (!shown.length) return <div className="py-4 text-center text-[10px] text-zinc-600">No frame events yet.</div>;
  const off = clockOffsetMs ?? 0;
  const rel = (f: FrameTrace) =>
    f.events.map((e) => {
      const start = e.started_at - (e.origin === "server" ? off : 0) - f.capturedAt;
      return { e, start: Math.max(0, start), end: Math.max(0, start) + Math.max(e.duration_ms, 0.3) };
    });
  const span = Math.max(10, ...shown.flatMap((f) => [...rel(f).map((r) => r.end), f.e2eMs ?? 0]));
  const rowH = 14;
  const labelW = 64;
  const W = 600;
  return (
    <svg viewBox={`0 0 ${W} ${shown.length * rowH + 14}`} className="w-full" role="img" aria-label="Execution timeline of recent frames">
      {shown.map((f, i) => {
        const y = i * rowH;
        const x = (ms: number) => labelW + (ms / span) * (W - labelW - 4);
        return (
          <g key={f.frameId}>
            <text x={0} y={y + 10} fontSize={8} fill="#a1a1aa" fontFamily="monospace">
              #{f.frameId} {f.outcome === "result" ? "" : f.outcome}
            </text>
            <rect x={labelW} y={y + 2} width={W - labelW - 4} height={rowH - 4} fill="#18181b" />
            {rel(f).map(({ e, start, end }, k) => (
              <rect key={k} x={x(start)} y={y + 2} width={Math.max(1, x(end) - x(start))} height={rowH - 4} fill={e.status === "skipped" ? "#3f3f46" : STAGE_COLORS[e.stage]} opacity={e.status === "error" ? 1 : 0.85} stroke={e.status === "error" ? "#f43f5e" : "none"}>
                <title>{`${humanize(e.stage)} (${e.origin}) · ${e.status} · ${e.duration_ms.toFixed(2)} ms @ +${start.toFixed(1)} ms${e.message ? ` · ${e.message}` : ""}`}</title>
              </rect>
            ))}
            {f.e2eMs != null && <line x1={x(f.e2eMs)} x2={x(f.e2eMs)} y1={y + 1} y2={y + rowH - 1} stroke="#f4f4f5" strokeWidth={1} />}
          </g>
        );
      })}
      <text x={labelW} y={shown.length * rowH + 11} fontSize={8} fill="#71717a" fontFamily="monospace">
        0 ms (capture)
      </text>
      <text x={W - 4} y={shown.length * rowH + 11} fontSize={8} fill="#71717a" fontFamily="monospace" textAnchor="end">
        {span.toFixed(0)} ms · white tick = result received{clockOffsetMs == null ? " · clock offset unknown" : ` · server clock offset ${clockOffsetMs.toFixed(1)} ms`}
      </text>
    </svg>
  );
}
