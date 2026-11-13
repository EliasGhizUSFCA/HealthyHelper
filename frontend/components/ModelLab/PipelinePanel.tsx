"use client";

import { useEngine, useEngineState, useTelemetry } from "@/hooks/useEngine";
import { MetricsCharts } from "@/components/PipelineTrace/MetricsCharts";
import { StageTable } from "@/components/PipelineTrace/StageTable";
import { Timeline } from "@/components/PipelineTrace/Timeline";
import { LabButton, LabCard, Stat } from "@/components/ui";
import { fmt } from "@/lib/format";

export function PipelinePanel() {
  const engine = useEngine();
  const { settings, socket, clockOffsetMs } = useEngineState();
  const tel = useTelemetry();
  const sm = tel.serverMetrics;
  // `now` is derived from the latest event so render stays pure.
  const now = tel.events.length ? Math.max(...tel.events.map((e) => e.started_at)) : 0;
  return (
    <LabCard
      id="p5"
      title="P5 · Pipeline & performance monitor"
      subtitle="Camera frames ≠ inference calls: landmarks run every frame, classifiers run at the sampling rate"
      actions={
        <>
          <LabButton onClick={() => engine.updateSettings({ paused: !settings.paused })} active={settings.paused}>
            {settings.paused ? "Resume analysis" : "Pause analysis"}
          </LabButton>
          <LabButton onClick={() => engine.telemetry.reset()} title="Clear telemetry buffers">
            Reset
          </LabButton>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <label className="flex items-center gap-1">
            Inference sampling rate
            <input type="range" min={0.5} max={10} step={0.5} value={settings.inferenceHz} onChange={(e) => engine.updateSettings({ inferenceHz: Number(e.target.value) })} aria-label="Inference sampling rate (Hz)" className="w-28" />
            <span className="w-12 font-mono text-zinc-200">{settings.inferenceHz.toFixed(1)} Hz</span>
          </label>
          <span className="text-zinc-600">max 1 frame in flight · server queue {sm?.queue_depth ?? "—"}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-8">
          <Stat label="Sent" value={socket.framesSent} />
          <Stat label="Results" value={tel.counters.inferenceResults} />
          <Stat label="Dropped" value={tel.counters.framesDropped} title="frame_dropped from server" />
          <Stat label="Rejected" value={tel.counters.framesRejected} title="Client quality gate: unusable" />
          <Stat label="No face" value={tel.counters.framesSkipped} />
          <Stat label="Timeouts" value={socket.creditTimeouts} title="No result within 3 s; credit released" />
          <Stat label="RTT" value={fmt(socket.rttMs)} unit="ms" />
          <Stat label="Server CPU" value={fmt(sm?.cpu_percent)} unit="%" />
        </div>
        <StageTable lastByStage={tel.lastByStage} now={now} />
        <div>
          <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Execution timeline · last 10 frames</div>
          <Timeline frames={tel.frames} clockOffsetMs={clockOffsetMs} />
        </div>
        <MetricsCharts series={tel.series} />
      </div>
    </LabCard>
  );
}
