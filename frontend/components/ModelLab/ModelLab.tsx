"use client";

import { useState, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { EngineProvider } from "@/hooks/useEngine";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SiteNav } from "@/components/SiteNav";
import { LabToolbar } from "./LabToolbar";
import { LivePanel } from "./LivePanel";
import { InputInspector } from "./InputInspector";
import { PredictionsPanel } from "@/components/PredictionCharts/PredictionsPanel";
import { ExplainPanel } from "./ExplainPanel";
import { PipelinePanel } from "./PipelinePanel";
import { LLMTracePanel } from "./LLMTracePanel";
import { AgeTab } from "./AgeTab";
import { CatalogInspector } from "./CatalogInspector";
import { RankingTab } from "./RankingTab";
import { PerformanceTab } from "./PerformanceTab";
import { FrameInspector } from "@/components/FrameInspector/FrameInspector";

function HHandle() {
  return <PanelResizeHandle className="w-1.5 rounded bg-transparent transition hover:bg-cyan-800/60 data-[resize-handle-state=drag]:bg-cyan-600" />;
}
function VHandle() {
  return <PanelResizeHandle className="h-1.5 rounded bg-transparent transition hover:bg-cyan-800/60 data-[resize-handle-state=drag]:bg-cyan-600" />;
}

function Overview() {
  return (
    <PanelGroup direction="horizontal" autoSaveId="ahm-lab-overview">
      <Panel defaultSize={50} minSize={25}>
        <PanelGroup direction="vertical" autoSaveId="ahm-lab-ov1">
          <Panel defaultSize={55} minSize={15}>
            <PredictionsPanel />
          </Panel>
          <VHandle />
          <Panel minSize={15}>
            <ExplainPanel />
          </Panel>
        </PanelGroup>
      </Panel>
      <HHandle />
      <Panel minSize={25}>
        <PanelGroup direction="vertical" autoSaveId="ahm-lab-ov2">
          <Panel defaultSize={55} minSize={15}>
            <PipelinePanel />
          </Panel>
          <VHandle />
          <Panel minSize={15}>
            <LLMTracePanel />
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}

/** Tabs render to the right of the always-visible Live CV column (one <video>, never unmounted). */
export const LAB_TABS: { key: string; label: string; render: () => ReactNode }[] = [
  { key: "overview", label: "Overview", render: () => <Overview /> },
  { key: "inputs", label: "Model inputs", render: () => <InputInspector /> },
  { key: "predictions", label: "Live predictions", render: () => <PredictionsPanel /> },
  { key: "age", label: "Age estimation", render: () => <AgeTab /> },
  { key: "explain", label: "Explainability", render: () => <ExplainPanel /> },
  { key: "pipeline", label: "Pipeline monitor", render: () => <PipelinePanel /> },
  { key: "catalog", label: "eCosmetics data", render: () => <CatalogInspector /> },
  { key: "ranking", label: "Recommendation ranking", render: () => <RankingTab /> },
  { key: "llm", label: "LLM context & trace", render: () => <LLMTracePanel /> },
  { key: "performance", label: "Performance", render: () => <PerformanceTab /> },
  { key: "inspector", label: "Frame inspector", render: () => <FrameInspector /> },
];

function TabBar({ tab, setTab }: { tab: string; setTab: (k: string) => void }) {
  return (
    <div role="tablist" aria-label="Model Lab views" className="flex min-w-0 max-w-full gap-1 overflow-x-auto border-b border-zinc-800 pb-1">
      {LAB_TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={tab === t.key}
          onClick={() => setTab(t.key)}
          className={`shrink-0 rounded px-2 py-1 text-[11px] ${tab === t.key ? "bg-cyan-900/70 text-cyan-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TabContent({ tab }: { tab: string }) {
  // Keep visited tabs mounted (hidden) so form state / inspector snapshots survive tab switches.
  const [visited, setVisited] = useState<string[]>([tab]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  return (
    <div className="relative min-h-0 flex-1">
      {LAB_TABS.filter((t) => visited.includes(t.key)).map((t) => (
        <div key={t.key} role="tabpanel" aria-label={t.label} hidden={tab !== t.key} className="h-full min-h-[60vh] lg:min-h-0">
          {t.render()}
        </div>
      ))}
    </div>
  );
}

export function ModelLab() {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState("overview");
  return (
    <EngineProvider mode="lab" initial={{ inferenceHz: 2, returnInputs: true }}>
      <div className="lab-root flex min-h-dvh flex-col lg:h-dvh lg:min-h-[640px]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
          <SiteNav dark current="/lab" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Model Lab · developer view</span>
        </header>
        <LabToolbar />
        <main id="main" className="min-h-0 flex-1 p-1.5">
          {wide ? (
            <PanelGroup direction="horizontal" autoSaveId="ahm-lab-v2">
              <Panel defaultSize={34} minSize={20}>
                <LivePanel />
              </Panel>
              <HHandle />
              <Panel minSize={30}>
                <div className="flex h-full min-h-0 flex-col gap-1.5">
                  <TabBar tab={tab} setTab={setTab} />
                  <TabContent tab={tab} />
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="h-[60vh]">
                <LivePanel />
              </div>
              <TabBar tab={tab} setTab={setTab} />
              <TabContent tab={tab} />
            </div>
          )}
        </main>
      </div>
    </EngineProvider>
  );
}
