"use client";

import { useEngineState } from "@/hooks/useEngine";
import { featureLabel, regionLabel } from "@/lib/format";
import type { Observation } from "@/lib/protocol";
import { StaleNotice } from "@/components/StaleNotice";

export function describeObservation(o: Observation): { headline: string; detail: string; tone: "seen" | "clear" | "unsure" | "none" } {
  const region = regionLabel(o.region).toLowerCase();
  const feature = featureLabel(o.feature);
  switch (o.status) {
    case "accepted":
      return o.present
        ? {
            headline: `Your ${region} may show ${feature}`,
            detail: `The model flagged ${feature} in recent frames. Lighting, makeup and camera quality can change how this looks, so treat it as a visual impression, not a finding.`,
            tone: "seen",
          }
        : { headline: `No clearly visible ${feature}`, detail: `The model did not flag ${feature} on your ${region} in recent frames.`, tone: "clear" };
    case "inconclusive":
      return { headline: `Can't tell clearly`, detail: `The model's score for ${feature} on your ${region} is too uncertain to say either way.`, tone: "unsure" };
    case "abstained":
      return { headline: `Not analysed`, detail: `Image quality for your ${region} wasn't good enough to analyse. Try better lighting or facing the camera.`, tone: "none" };
    default:
      return { headline: `Not available`, detail: `No model is loaded for ${feature} on the ${region}.`, tone: "none" };
  }
}

const TONE_CLS = {
  seen: "border-amber-300 bg-amber-50",
  clear: "border-emerald-200 bg-emerald-50",
  unsure: "border-slate-300 bg-slate-50",
  none: "border-slate-200 bg-white",
};

export function ObservationCards() {
  const { latestResult, latestReceivedAt, settings } = useEngineState();
  const obs = latestResult?.observations;
  if (!settings.consentUpload) return <p className="text-slate-600">Observations appear here once you start the camera and allow analysis.</p>;
  if (!obs) return <p className="text-slate-600">Waiting for the first analysis…</p>;
  const demo = obs.demo_mode || obs.observations.some((o) => o.model_tier === "demo");
  return (
    <div className="space-y-3">
      <StaleNotice completedAt={latestReceivedAt} />
      {demo && (
        <div role="alert" className="rounded-lg border-2 border-fuchsia-500 bg-fuchsia-50 px-4 py-3 text-fuchsia-950">
          <p className="font-semibold">Demonstration model – trained on synthetic data, not a real observation</p>
          <p className="text-sm">The classifiers currently loaded were trained only on procedurally generated images to exercise the pipeline. Their outputs say nothing about your face.</p>
        </div>
      )}
      {obs.image_quality !== "acceptable" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Image quality is {obs.image_quality}; some results may be held back.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {obs.observations.map((o) => {
          const d = describeObservation(o);
          return (
            <li key={`${o.region}:${o.feature}`} className={`rounded-xl border p-4 ${TONE_CLS[d.tone]}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{regionLabel(o.region)}</p>
                {o.model_tier === "demo" && <span className="rounded bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Demo</span>}
              </div>
              <p className="mt-1 text-lg font-semibold text-slate-900">{d.headline}</p>
              <p className="mt-1 text-sm text-slate-700">{d.detail}</p>
              {o.confidence != null && o.status !== "abstained" && (
                <p className="mt-2 text-xs text-slate-500" title="How strongly the image classifier responded. This is not the probability of any health condition.">
                  Classifier score {o.confidence.toFixed(2)} over {o.frames_aggregated} frame{o.frames_aggregated === 1 ? "" : "s"} — not a medical probability
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-slate-500">These are descriptions of how the image looks, not diagnoses. A camera cannot tell whether you are dehydrated, ill or have any medical condition.</p>
    </div>
  );
}
