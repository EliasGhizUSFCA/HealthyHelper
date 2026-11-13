"use client";

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

function HHandle() {
  return <PanelResizeHandle className="w-1.5 rounded bg-transparent transition hover:bg-cyan-800/60 data-[resize-handle-state=drag]:bg-cyan-600" />;
}
function VHandle() {
  return <PanelResizeHandle className="h-1.5 rounded bg-transparent transition hover:bg-cyan-800/60 data-[resize-handle-state=drag]:bg-cyan-600" />;
}

export function ModelLab() {
  // Only one layout may mount: both would attach the same <video> to the engine.
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <EngineProvider mode="lab" initial={{ inferenceHz: 2, returnInputs: true }}>
      <div className="lab-root flex h-dvh min-h-[640px] flex-col">
        <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
          <SiteNav dark current="/lab" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Model Lab · developer view</span>
        </header>
        <LabToolbar />
        <main id="main" className="min-h-0 flex-1 p-1.5">
          {/* Desktop: resizable 3x2 grid. Narrow screens: stacked. */}
          {wide ? (
          <div className="h-full">
            <PanelGroup direction="horizontal" autoSaveId="ahm-lab-cols">
              <Panel defaultSize={36} minSize={20}>
                <PanelGroup direction="vertical" autoSaveId="ahm-lab-col1">
                  <Panel defaultSize={58} minSize={20}>
                    <LivePanel />
                  </Panel>
                  <VHandle />
                  <Panel minSize={15}>
                    <InputInspector />
                  </Panel>
                </PanelGroup>
              </Panel>
              <HHandle />
              <Panel defaultSize={32} minSize={20}>
                <PanelGroup direction="vertical" autoSaveId="ahm-lab-col2">
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
              <Panel defaultSize={32} minSize={20}>
                <PanelGroup direction="vertical" autoSaveId="ahm-lab-col3">
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
          </div>
          ) : (
          <div className="flex h-full flex-col gap-2 overflow-auto">
            <div className="h-[70vh]">
              <LivePanel />
            </div>
            <InputInspector />
            <PredictionsPanel />
            <ExplainPanel />
            <PipelinePanel />
            <div className="h-[70vh]">
              <LLMTracePanel />
            </div>
          </div>
          )}
        </main>
      </div>
    </EngineProvider>
  );
}
