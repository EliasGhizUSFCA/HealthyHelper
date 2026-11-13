"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnalysisEngine, type EngineSettings, type EngineState } from "@/lib/engine";
import type { TelemetrySnapshot } from "@/lib/telemetry";

const EngineContext = createContext<AnalysisEngine | null>(null);

export function EngineProvider({ mode, initial, children }: { mode: "mirror" | "lab"; initial?: Partial<EngineSettings>; children: ReactNode }) {
  const [engine] = useState(() => new AnalysisEngine(mode, initial));
  useEffect(() => {
    engine.start();
    return () => engine.dispose();
  }, [engine]);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): AnalysisEngine {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine must be used inside <EngineProvider>");
  return e;
}

export function useEngineState(): EngineState {
  const e = useEngine();
  return useSyncExternalStore(e.subscribe, e.getState, e.getState);
}

export function useTelemetry(): TelemetrySnapshot {
  const e = useEngine();
  return useSyncExternalStore(e.telemetry.subscribe, e.telemetry.getSnapshot, e.telemetry.getSnapshot);
}
