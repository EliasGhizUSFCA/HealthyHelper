import type { EngineState } from "./engine";
import type { TelemetrySnapshot } from "./telemetry";
import { PROTOCOL_VERSION } from "./protocol";

/**
 * Privacy-safe diagnostics export. Excludes chat text and images unless explicitly requested
 * (images). Chat content is never included: only route/validation metadata.
 */
export function buildDiagnostics(state: EngineState, tel: TelemetrySnapshot, includeImages: boolean) {
  const strip = <T extends { input?: unknown }>(p: T) =>
    includeImages
      ? p
      : {
          ...p,
          input: p.input ? { ...(p.input as object), raw_preview_b64: null, tensor_preview_b64: null } : p.input,
        };
  const tr = state.chat.lastResponse?.trace;
  return {
    kind: "ai-health-mirror-diagnostics",
    exported_at: new Date().toISOString(),
    protocol_version: PROTOCOL_VERSION,
    includes_images: includeImages,
    synthetic_input: state.settings.source === "synthetic",
    settings: state.settings,
    socket: { ...state.socket, sessionId: state.socket.sessionId ? "[redacted]" : null },
    clock_offset_ms: state.clockOffsetMs,
    landmarker: { status: state.landmarker, delegate: state.delegate },
    models: state.models,
    telemetry: {
      counters: tel.counters,
      series: tel.series,
      events: tel.events.map((e) => ({ ...e, session_id: "[redacted]" })),
      server_metrics: tel.serverMetrics,
    },
    latest_result: state.latestResult
      ? { ...state.latestResult, session_id: "[redacted]", predictions: state.latestResult.predictions.map(strip), events: [] }
      : null,
    last_agent_trace: tr
      ? { provider: tr.provider, model: tr.model, route: tr.route, steps: tr.steps, validation: tr.validation, attempts: tr.attempts, latency_ms: tr.latency_ms, usage: tr.usage }
      : null,
  };
}
