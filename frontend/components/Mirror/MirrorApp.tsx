"use client";

import { EngineProvider, useEngineState } from "@/hooks/useEngine";
import { CameraView } from "@/components/CameraView/CameraView";
import { MIRROR_LAYERS } from "@/components/FaceOverlay/drawOverlay";
import { ChatAssistant } from "@/components/ChatAssistant/ChatAssistant";
import { SiteNav } from "@/components/SiteNav";
import { CameraActiveIndicator } from "./CameraControls";
import { AnalysisControls } from "./AnalysisControls";
import { CompactObservations } from "./CompactObservations";
import { Guidance } from "./Guidance";
import { SymptomInput } from "./SymptomInput";
import { SnapshotButton } from "./SnapshotButton";
import { CameraPicker } from "@/components/CameraView/CameraPicker";
import { AgeOptIn } from "@/components/Age/AgeOptIn";
import { ProductSidebar } from "@/components/Beauty/ProductSidebar";
import { useState } from "react";

function MirrorInner() {
  const { cameraError, socket, settings } = useEngineState();
  const [ideas, setIdeas] = useState(false);
  const width = ideas ? "max-w-[1440px]" : "max-w-6xl";
  return (
    <div className="min-h-full">
      <header className={`mx-auto flex ${width} flex-wrap items-center justify-between gap-3 px-6 py-4`}>
        <SiteNav current="/mirror" />
        <CameraActiveIndicator />
      </header>
      <main id="main" className={`mx-auto grid ${width} grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] ${ideas ? "xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]" : ""}`}>
        <section aria-label="Camera" className="space-y-4">
          <div className={ideas ? "grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]" : ""}>
            <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm ${ideas ? "aspect-[4/3] md:aspect-auto md:h-full md:min-h-[36rem]" : "aspect-[4/3]"}`}>
              <CameraView layers={MIRROR_LAYERS} mirrored={settings.mirrored} fit="cover" dark={false} />
            </div>
            {ideas && (
              <div className="relative h-[34rem] md:h-auto md:min-h-[36rem]">
                <div className="h-full md:absolute md:inset-0">
                  <ProductSidebar onClose={() => setIdeas(false)} />
                </div>
              </div>
            )}
          </div>
          <AnalysisControls />
          <div className="flex flex-wrap items-center gap-2">
            <SnapshotButton />
            <button
              type="button"
              onClick={() => setIdeas((v) => !v)}
              aria-pressed={ideas}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${ideas ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
            >
              {ideas ? "Hide product ideas" : "🛍 Product ideas"}
            </button>
            <span className="text-xs text-slate-500">Server: {socket.status === "open" ? "connected" : socket.status}</span>
          </div>
          {cameraError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
              {cameraError.message}
            </p>
          )}
          <CameraPicker />
          <Guidance />
        </section>
        <section aria-label="Observations and assistant" className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">What the mirror notices</h1>
            <div className="mt-2 space-y-3">
              <CompactObservations />
              <AgeOptIn compact />
            </div>
          </div>
          <SymptomInput />
          <div className="flex h-[28rem] flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Assistant</h2>
            <ChatAssistant variant="light" />
          </div>
        </section>
      </main>
    </div>
  );
}

export function MirrorApp() {
  return (
    <EngineProvider mode="mirror" initial={{ inferenceHz: 2, returnInputs: false }}>
      <MirrorInner />
    </EngineProvider>
  );
}
