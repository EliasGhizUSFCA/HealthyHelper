"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine, useEngineState, useTelemetry } from "@/hooks/useEngine";
import { Badge, Empty, LabButton, LabCard, LabToggle, statusTone } from "@/components/ui";
import { ContributionBar } from "@/components/ModelLab/RankingTab";
import { CONCERNS, type RecommendationResponse } from "@/lib/catalog";
import { REGION_COLORS, type Point2, type RegionBox } from "@/lib/regions";
import type { InferenceResult, TelemetryEvent } from "@/lib/protocol";
import type { StoredCrop } from "@/lib/engine";
import { downloadBlob } from "@/lib/crops";
import { fmt, humanize, regionLabel } from "@/lib/format";

const STEPS = [
  "Captured frame",
  "Face detection",
  "Landmarks & regions",
  "Preprocessing",
  "Model predictions",
  "Explainability",
  "Recommendation retrieval",
  "Ranking",
  "LLM context",
  "Final response",
] as const;

interface Snapshot {
  result: InferenceResult;
  frameImage: string | null;
  landmarks: Point2[] | null;
  regions: RegionBox[];
  frameW: number;
  frameH: number;
  faces: number;
  clientEvents: TelemetryEvent[];
  crops: Partial<Record<string, StoredCrop>>;
  synthetic: boolean;
  frozenAt: number;
}

/** Draws landmarks + region boxes on the frozen frame (same pixels the crops came from). */
function AnnotatedFrame({ snap, landmarks: showLm, boxes }: { snap: Snapshot; landmarks: boolean; boxes: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !snap.frameImage) return;
    const img = new Image();
    img.onload = () => {
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      if (showLm && snap.landmarks) {
        ctx.fillStyle = "rgba(34,211,238,0.9)";
        for (const p of snap.landmarks) ctx.fillRect(p.x * img.width - 1, p.y * img.height - 1, 2, 2);
      }
      if (boxes) {
        ctx.lineWidth = Math.max(2, img.width / 400);
        ctx.font = `${Math.max(12, img.width / 70)}px system-ui`;
        for (const r of snap.regions) {
          if (!r.valid) continue;
          ctx.strokeStyle = REGION_COLORS[r.region];
          ctx.strokeRect(r.px.x, r.px.y, r.px.w, r.px.h);
          ctx.fillStyle = REGION_COLORS[r.region];
          ctx.fillText(regionLabel(r.region), r.px.x, Math.max(12, r.px.y - 4));
        }
      }
    };
    img.src = snap.frameImage;
  }, [snap, showLm, boxes]);
  if (!snap.frameImage) return <Empty>{snap.synthetic ? "SIMULATED INPUT — no camera frame (procedural crops only)." : "Frame pixels not retained for this event (only the last 4 sent frames are kept)."}</Empty>;
  return <canvas ref={ref} className="max-h-[50vh] w-full rounded border border-zinc-800 object-contain" aria-label="Frozen frame with annotations" />;
}

export function FrameInspector() {
  const engine = useEngine();
  const state = useEngineState();
  const tel = useTelemetry();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [step, setStep] = useState(0);
  const [rec, setRec] = useState<RecommendationResponse | null>(null);
  const [mode, setMode] = useState<"skincare" | "makeup">("skincare");
  const [concern, setConcern] = useState<string>("");
  const [includeImages, setIncludeImages] = useState(false);
  const [explainTarget, setExplainTarget] = useState<string>("");

  const capture = () => {
    const result = state.frozen?.result ?? state.latestResult;
    if (!result) return;
    const record = engine.frameRecord(result.frame_id);
    const frame = tel.frames.find((f) => f.frameId === result.frame_id);
    setSnap({
      result,
      frameImage: record ? record.canvas.toDataURL("image/jpeg", 0.85) : null,
      landmarks: record?.landmarks ?? null,
      regions: record?.regions ?? [],
      frameW: record?.canvas.width ?? 0,
      frameH: record?.canvas.height ?? 0,
      faces: record?.faces ?? 0,
      clientEvents: (frame?.events ?? []).filter((e) => e.origin === "client"),
      crops: { ...(state.frozen?.crops ?? state.lastCrops) },
      synthetic: state.settings.source === "synthetic",
      frozenAt: Date.now(),
    });
    setRec(null);
    setStep(0);
  };

  const acceptedKeys = useMemo(
    () => (snap?.result.observations.observations ?? []).filter((o) => o.status === "accepted" && o.present).map((o) => `${o.region}:${o.feature}`),
    [snap],
  );

  const runRec = async () => {
    const r = await engine.recommend({ mode, concern: concern || null, include_observations: acceptedKeys, explain: true, limit: 6 });
    if (r) setRec(r);
  };

  const exportTrace = () => {
    if (!snap) return;
    const strip = (r: InferenceResult) => ({
      ...r,
      predictions: r.predictions.map((p) => ({ ...p, input: p.input ? { ...p.input, raw_preview_b64: includeImages ? p.input.raw_preview_b64 : null, tensor_preview_b64: includeImages ? p.input.tensor_preview_b64 : null } : p.input })),
      age: r.age ? { ...r.age, input: null } : r.age,
    });
    const trace = {
      exported_at: new Date().toISOString(),
      note: "Privacy-safe Frame Inspector trace. Images and landmark coordinates are excluded unless 'include images' was ticked.",
      frame_id: snap.result.frame_id,
      synthetic_input: snap.synthetic,
      client_events: snap.clientEvents.map((e) => ({ ...e, session_id: "redacted" })),
      inference: { ...strip(snap.result), session_id: "redacted", events: snap.result.events.map((e) => ({ ...e, session_id: "redacted" })) },
      frame_image: includeImages ? snap.frameImage : null,
      landmarks: includeImages ? snap.landmarks : null,
      recommendation: rec ? { ...rec, request: { ...rec.request, session_id: null } } : null,
      chat_reply: state.chat.lastResponse ? { route: state.chat.lastResponse.trace.route, validation: state.chat.lastResponse.trace.validation } : null,
    };
    downloadBlob(`ahm-frame-${snap.result.frame_id}.json`, new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" }));
  };

  const r = snap?.result;
  const exp = state.explanation;
  return (
    <LabCard
      title="Frame inspector"
      subtitle="Freeze one inference event and step through its full processing history"
      actions={
        <>
          <LabButton tone="primary" onClick={capture} disabled={!(state.frozen?.result ?? state.latestResult)}>
            {snap ? "Inspect latest event" : "Freeze & inspect latest event"}
          </LabButton>
          <LabButton onClick={() => engine.toggleFreeze()} active={!!state.frozen} title="Pause sampling so the latest event stays put">
            {state.frozen ? "Resume sampling" : "Pause sampling"}
          </LabButton>
        </>
      }
    >
      {!snap || !r ? (
        <Empty>No event frozen. Start the camera (or synthetic input) with upload consent, then press “Freeze & inspect”.</Empty>
      ) : (
        <div className="space-y-2 text-[11px]">
          <nav aria-label="Inspector steps" className="flex flex-wrap gap-1">
            {STEPS.map((s, i) => (
              <button key={s} type="button" onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`rounded px-1.5 py-0.5 text-[10px] ${step === i ? "bg-cyan-800 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-100"}`}>
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          <div className="flex items-center justify-between">
            <LabButton onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              ← Back
            </LabButton>
            <span className="font-mono text-zinc-400">
              frame #{r.frame_id} · step {step + 1}/{STEPS.length} · {snap.synthetic ? "SIMULATED INPUT" : "camera"} · frozen {new Date(snap.frozenAt).toLocaleTimeString()}
            </span>
            <LabButton onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>
              Next →
            </LabButton>
          </div>

          {step === 0 && (
            <div className="space-y-1">
              <AnnotatedFrame snap={snap} landmarks={false} boxes={false} />
              <p className="text-zinc-400">
                {snap.frameW ? `${snap.frameW}×${snap.frameH} px` : ""} · captured {new Date(r.captured_at).toLocaleTimeString()} · server received +{fmt(r.received_at - r.captured_at, 0)} ms · queue wait {fmt(r.queue_wait_ms, 1)} ms
              </p>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-1">
              <p>
                Faces detected: <strong>{snap.synthetic ? "n/a (simulated)" : snap.faces}</strong> · overall image quality <Badge tone={statusTone(r.image_quality.status)}>{r.image_quality.status}</Badge>{" "}
                {r.image_quality.issues.join(", ")}
              </p>
              <EventList events={snap.clientEvents.filter((e) => ["camera_capture", "image_quality", "face_detection"].includes(e.stage))} />
            </div>
          )}
          {step === 2 && (
            <div className="space-y-1">
              <AnnotatedFrame snap={snap} landmarks boxes />
              <p className="text-zinc-400">{snap.landmarks ? `${snap.landmarks.length} landmarks` : "no landmarks"} · {snap.regions.filter((b) => b.valid).length} valid regions</p>
              <EventList events={snap.clientEvents.filter((e) => ["landmark_extraction", "region_cropping"].includes(e.stage))} />
            </div>
          )}
          {step === 3 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {r.predictions.filter((p) => p.input).length === 0 && <Empty>No model inputs returned (enable “Inputs” in the toolbar before freezing).</Empty>}
              {r.predictions
                .filter((p) => p.input)
                .map((p) => (
                  <figure key={p.model_id + p.region} className="rounded border border-zinc-800 p-1">
                    <figcaption className="mb-1 text-[10px] text-zinc-400">
                      {p.model_id} · {regionLabel(p.region)}
                    </figcaption>
                    <div className="grid grid-cols-2 gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.input?.raw_preview_b64 && <img src={p.input.raw_preview_b64} alt="raw crop" className="w-full" />}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.input?.tensor_preview_b64 && <img src={p.input.tensor_preview_b64} alt="model tensor" className="w-full" />}
                    </div>
                    <p className="font-mono text-[9px] text-zinc-500">
                      {p.input!.tensor.shape.join("×")} μ {p.input!.tensor.channel_mean.map((v) => v.toFixed(2)).join("/")}
                    </p>
                  </figure>
                ))}
            </div>
          )}
          {step === 4 && (
            <table className="w-full table-fixed">
              <thead className="text-left text-[9px] uppercase text-zinc-500">
                <tr>
                  <th>model · region</th>
                  <th className="w-24">top</th>
                  <th className="w-14">p</th>
                  <th className="w-12">thr</th>
                  <th className="w-24">decision</th>
                  <th>reason</th>
                </tr>
              </thead>
              <tbody>
                {r.predictions.map((p) => (
                  <tr key={p.model_id + p.region} className="border-t border-zinc-800">
                    <td>
                      {p.model_id} · {regionLabel(p.region)} <Badge tone={statusTone(p.model_tier)}>{p.model_tier}</Badge>
                    </td>
                    <td>{p.top_class ? humanize(p.top_class) : "—"}</td>
                    <td className="font-mono">{fmt(p.top_probability, 2)}</td>
                    <td className="font-mono">{p.threshold.toFixed(2)}</td>
                    <td>
                      <Badge tone={statusTone(p.decision)}>{p.decision}</Badge>
                    </td>
                    <td className="text-zinc-400">{p.decision_reason}</td>
                  </tr>
                ))}
                {r.age && (
                  <tr className="border-t border-zinc-800">
                    <td>apparent_age · face</td>
                    <td>{r.age.plausible_ranges.join("…") || "—"}</td>
                    <td className="font-mono">{fmt(r.age.top_probability, 2)}</td>
                    <td />
                    <td>
                      <Badge tone={statusTone(r.age.decision)}>{r.age.decision}</Badge>
                    </td>
                    <td className="text-zinc-400">{r.age.decision_reason}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {step === 5 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select value={explainTarget} onChange={(e) => setExplainTarget(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" aria-label="Model and region to explain">
                  <option value="">choose model · region</option>
                  {r.predictions
                    .filter((p) => p.decision !== "unavailable" && snap.crops[p.region])
                    .map((p) => (
                      <option key={p.model_id + p.region} value={`${p.model_id}|${p.region}`}>
                        {p.model_id} · {regionLabel(p.region)}
                      </option>
                    ))}
                </select>
                <LabButton
                  tone="primary"
                  disabled={!explainTarget || !!state.explainPending}
                  onClick={() => {
                    const [m, reg] = explainTarget.split("|");
                    const crop = snap.crops[reg];
                    if (crop) engine.requestExplain(m, crop.region, crop.dataUrl);
                  }}
                >
                  {state.explainPending ? "Computing…" : "Generate Grad-CAM for this frame's crop"}
                </LabButton>
              </div>
              {state.explainError && <p className="text-rose-300">{state.explainError}</p>}
              {exp && (
                <div className="grid grid-cols-2 gap-2 md:w-2/3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={exp.input_b64} alt="model input" className="w-full rounded" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={exp.heatmap_b64} alt="approximate attribution heatmap" className="w-full rounded" />
                  <p className="col-span-2 text-[10px] text-zinc-500">
                    {exp.model_id} → {humanize(exp.target_class)} ({exp.target_probability.toFixed(2)}) · {exp.method} · {fmt(exp.latency_ms, 0)} ms. {exp.caveat}
                  </p>
                </div>
              )}
            </div>
          )}
          {(step === 6 || step === 7 || step === 8 || step === 9) && !rec && (
            <div className="space-y-2 rounded border border-zinc-800 p-2">
              <p>Product steps run only when you ask. This uses the frozen frame&apos;s accepted observations ({acceptedKeys.join(", ") || "none"}) as optional search terms — never images.</p>
              <div className="flex flex-wrap items-center gap-2">
                <select value={mode} onChange={(e) => setMode(e.target.value as "skincare" | "makeup")} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" aria-label="Mode">
                  <option value="skincare">skincare</option>
                  <option value="makeup">makeup</option>
                </select>
                <select value={concern} onChange={(e) => setConcern(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" aria-label="Concern">
                  <option value="">(no concern)</option>
                  {CONCERNS.filter((c) => c.mode === mode).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <LabButton tone="primary" onClick={() => void runRec()} disabled={state.recommendation.pending}>
                  {state.recommendation.pending ? "Running…" : "Run recommendation for this frame"}
                </LabButton>
              </div>
            </div>
          )}
          {step === 6 && rec && (
            <div className="space-y-1">
              <p>
                Source: <Badge tone="info">{rec.trace.retrieval_source}</Badge> · live retailer requests {rec.trace.live_requests} · candidates {rec.trace.candidates}
              </p>
              <p className="text-zinc-400">categories: {rec.trace.categories_searched.join(", ")}</p>
              <p className="text-zinc-400">terms: {rec.trace.search_terms.join(" | ") || "—"}</p>
              <EventList events={rec.events as unknown as TelemetryEvent[]} />
            </div>
          )}
          {step === 7 && rec && (
            <div className="space-y-1">
              {rec.results.map((x) => (
                <div key={x.product.product_id}>
                  <p>
                    #{x.rank} {x.product.name} <span className="font-mono text-zinc-500">{x.total_score.toFixed(3)}</span>
                  </p>
                  <ContributionBar r={x} />
                </div>
              ))}
              <p className="text-zinc-500">{rec.trace.filtered_out.length} filtered out · {rec.trace.age_note}</p>
            </div>
          )}
          {step === 8 && (
            <div className="space-y-1">
              <p className="text-[9px] uppercase text-zinc-500">Validated observations available to the LLM (server-aggregated)</p>
              <pre className="max-h-48 overflow-auto rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">{JSON.stringify(r.observations, null, 1)}</pre>
              {rec && (
                <>
                  <p className="text-[9px] uppercase text-zinc-500">Product-explanation call</p>
                  <pre className="max-h-32 overflow-auto rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">{JSON.stringify(rec.trace.llm, null, 1)}</pre>
                </>
              )}
              {state.chat.lastResponse && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">{state.chat.lastResponse.trace.context_preview}</pre>}
            </div>
          )}
          {step === 9 && (
            <div className="space-y-1">
              {rec?.explanations && <p className="text-zinc-200">{rec.explanations.summary}</p>}
              {rec?.explanations?.products.map((e) => (
                <p key={e.product_id} className="text-zinc-300">
                  <span className="font-mono text-zinc-500">{e.product_id}</span> {e.explanation}
                </p>
              ))}
              {rec && (
                <ul>
                  {rec.trace.validation.map((v) => (
                    <li key={v.name}>
                      <Badge tone={v.passed ? "ok" : "error"}>{v.passed ? "pass" : "fail"}</Badge> {v.name}
                    </li>
                  ))}
                </ul>
              )}
              {state.chat.messages.length > 0 && <p className="text-zinc-400">Last assistant reply: {state.chat.messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content}</p>}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
            <LabToggle label="include images & landmarks" checked={includeImages} onChange={setIncludeImages} title="Off by default" />
            <LabButton onClick={exportTrace}>Export privacy-safe trace</LabButton>
          </div>
        </div>
      )}
    </LabCard>
  );
}

function EventList({ events }: { events: TelemetryEvent[] }) {
  if (!events.length) return <p className="text-zinc-500">no events recorded</p>;
  return (
    <ul className="space-y-0.5 font-mono text-[10px]">
      {events.map((e, i) => (
        <li key={(e.event_id ?? "") + i}>
          <Badge tone={statusTone(e.status)}>{e.status}</Badge> {e.stage} · {fmt(e.duration_ms, 2)} ms · {e.input_type} → {e.output_type}
          {e.message ? <span className="text-zinc-500"> · {e.message}</span> : null}
        </li>
      ))}
    </ul>
  );
}
