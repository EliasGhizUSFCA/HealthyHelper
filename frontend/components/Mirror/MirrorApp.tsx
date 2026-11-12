"use client";

import { EngineProvider, useEngine, useEngineState } from "@/hooks/useEngine";
import { CameraView } from "@/components/CameraView/CameraView";
import { MIRROR_LAYERS } from "@/components/FaceOverlay/drawOverlay";
import { ChatAssistant } from "@/components/ChatAssistant/ChatAssistant";
import { SiteNav } from "@/components/SiteNav";
import { CameraActiveIndicator, ConsentToggle } from "./CameraControls";
import { Guidance } from "./Guidance";
import { ObservationCards } from "./ObservationCards";
import { SymptomInput } from "./SymptomInput";
import { SnapshotButton } from "./SnapshotButton";

function MirrorInner() {
  const engine = useEngine();
  const { camera, cameraError, socket } = useEngineState();
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <SiteNav current="/mirror" />
        <CameraActiveIndicator />
      </header>
      <main id="main" className="mx-auto grid max-w-6xl gap-6 px-6 pb-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-label="Camera" className="space-y-4">
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm">
            <CameraView layers={MIRROR_LAYERS} mirrored fit="cover" dark={false} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {camera !== "on" ? (
              <button type="button" onClick={() => engine.startCamera()} disabled={camera === "starting"} className="rounded-lg bg-sky-700 px-5 py-2.5 text-base font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                {camera === "starting" ? "Starting…" : "Start camera"}
              </button>
            ) : (
              <button type="button" onClick={() => engine.stopCamera()} className="rounded-lg bg-rose-700 px-5 py-2.5 text-base font-medium text-white hover:bg-rose-800">
                Stop camera
              </button>
            )}
            <SnapshotButton />
            <span className="text-sm text-slate-500">Server: {socket.status === "open" ? "connected" : socket.status}</span>
          </div>
          {cameraError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
              {cameraError.message}
            </p>
          )}
          <Guidance />
          <ConsentToggle />
        </section>
        <section aria-label="Observations and assistant" className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">What the mirror can see</h1>
            <div className="mt-3">
              <ObservationCards />
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
