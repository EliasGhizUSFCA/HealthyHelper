"use client";

import { useEngineState, useTelemetry } from "@/hooks/useEngine";
import { MetricsCharts } from "@/components/PipelineTrace/MetricsCharts";
import { LabCard, Stat } from "@/components/ui";
import { fmt } from "@/lib/format";

export function PerformanceTab() {
  const tel = useTelemetry();
  const { recommendation, latestResult, chat } = useEngineState();
  const last = tel.series[tel.series.length - 1];
  const sm = tel.serverMetrics;
  const t = recommendation.response?.trace.timings_ms ?? {};
  const llm = Object.entries(t).filter(([k]) => k.startsWith("llm")).reduce((a, [, v]) => a + v, 0);
  const by = tel.lastByStage;
  return (
    <LabCard title="Performance monitor" subtitle="Measured values only — camera FPS ≠ landmark FPS ≠ inference FPS">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Webcam FPS" value={fmt(last?.cameraFps)} />
          <Stat label="Landmark FPS" value={fmt(last?.landmarkFps)} />
          <Stat label="Inference FPS" value={fmt(last?.inferenceFps, 2)} />
          <Stat label="Detection ms" value={fmt(by.face_detection?.duration_ms)} />
          <Stat label="Classifier ms" value={fmt(by.cv_inference?.duration_ms)} />
          <Stat label="Age model ms" value={fmt(latestResult?.age?.latency_ms)} />
          <Stat label="End-to-end ms" value={fmt(last?.e2eMs)} />
          <Stat label="Retrieval ms" value={fmt(t.retrieval)} title="local catalogue query" />
          <Stat label="Ranking ms" value={fmt(t.ranking)} />
          <Stat label="Rec. LLM ms" value={fmt(llm || null)} />
          <Stat label="Rec. round trip" value={fmt(recommendation.roundTripMs)} unit="ms" />
          <Stat label="Chat LLM ms" value={fmt(chat.lastResponse?.trace.latency_ms)} />
          <Stat label="Server CPU" value={fmt(sm?.cpu_percent)} unit="%" />
          <Stat label="Server RSS" value={fmt(sm?.rss_mb, 0)} unit="MB" />
          <Stat label="Device" value={sm?.device ?? "—"} />
          <Stat label="Dropped frames" value={tel.counters.framesDropped} />
          <Stat label="Rejected frames" value={tel.counters.framesRejected} />
          <Stat label="Model errors" value={tel.events.filter((e) => e.status === "error").length} title="error events in the telemetry buffer" />
        </div>
        <MetricsCharts series={tel.series} />
        <p className="text-[10px] text-zinc-500">
          GPU utilisation is not exposed by the browser or the backend metrics; “Device” shows where the backend runs models. Catalogue cache hit rate: sitemap cache status is in the eCosmetics tab; recommendations always read the local catalogue (no live retailer calls).
        </p>
      </div>
    </LabCard>
  );
}
