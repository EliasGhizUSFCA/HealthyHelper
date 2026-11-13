"use client";

import { useEngineState } from "@/hooks/useEngine";
import { featureLabel, regionLabel } from "@/lib/format";
import type { Observation } from "@/lib/protocol";
import { StaleNotice } from "@/components/StaleNotice";
import { TierBadge } from "@/components/ui";

const FEATURE_PHRASES: Record<string, string> = {
  visible_dryness: "visible dryness",
  visible_redness: "visible redness",
  visible_flaking: "dry or flaky-looking skin",
  visible_blemishes: "spots or blemishes",
  visible_shine: "shine or oiliness",
  visible_darkness: "darker-looking skin",
};
const REGION_PHRASES: Record<string, string> = {
  left_undereye: "the area under your left eye",
  right_undereye: "the area under your right eye",
};

export function describeObservation(o: Observation): { headline: string; detail: string; tone: "seen" | "clear" | "unsure" | "none" } {
  const subject = REGION_PHRASES[o.region] ?? `your ${regionLabel(o.region).toLowerCase()}`;
  const Subject = subject[0].toUpperCase() + subject.slice(1);
  const feature = FEATURE_PHRASES[o.feature] ?? featureLabel(o.feature);
  switch (o.status) {
    case "accepted":
      return o.present
        ? {
            headline: `${Subject} may show ${feature}`,
            detail: `The model flagged ${feature} in recent frames. Lighting, makeup and camera quality can change how this looks, so treat it as a visual impression, not a finding.`,
            tone: "seen",
          }
        : { headline: `No clearly visible ${feature}`, detail: `The model did not flag ${feature} on ${subject} in recent frames.`, tone: "clear" };
    case "inconclusive":
      return { headline: `Can't tell clearly`, detail: `The model's score for ${feature} on ${subject} is too uncertain to say either way.`, tone: "unsure" };
    case "abstained":
      return { headline: `Not analysed`, detail: `Image quality for ${subject} wasn't good enough to analyse. Try better lighting or facing the camera.`, tone: "none" };
    default:
      return { headline: `Not available`, detail: `No model is loaded for ${feature} on ${subject}.`, tone: "none" };
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
  const experimental = !demo && obs.observations.some((o) => o.model_tier === "experimental" && o.status === "accepted");
  const described = obs.observations.map((o) => ({ o, d: describeObservation(o) }));
  const order = { seen: 0, unsure: 1, clear: 2, none: 3 } as const;
  const prominent = described.filter((x) => x.d.tone === "seen" || x.d.tone === "unsure").sort((a, b) => order[a.d.tone] - order[b.d.tone]);
  const quiet = described.filter((x) => x.d.tone === "clear" || x.d.tone === "none");
  return (
    <div className="space-y-3">
      <StaleNotice completedAt={latestReceivedAt} />
      {demo && (
        <div role="alert" className="rounded-lg border-2 border-fuchsia-500 bg-fuchsia-50 px-4 py-3 text-fuchsia-950">
          <p className="font-semibold">Demonstration model – trained on synthetic data, not a real observation</p>
          <p className="text-sm">The classifiers currently loaded were trained only on procedurally generated images to exercise the pipeline. Their outputs say nothing about your face.</p>
        </div>
      )}
      {experimental && (
        <div role="note" className="rounded-lg border-2 border-sky-500 bg-sky-50 px-4 py-3 text-sky-950">
          <p className="font-semibold">Experimental models – trained on a small set of real images</p>
          <p className="text-sm">These models haven&apos;t passed the validation checks yet (enough people, agreed labels). Treat what they flag as tentative.</p>
        </div>
      )}
      {obs.image_quality !== "acceptable" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Image quality is {obs.image_quality}; some results may be held back.</p>
      )}
      {prominent.length === 0 && <p className="text-slate-700">Nothing is flagged or uncertain right now.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {prominent.map(({ o, d }) => {
          return (
            <li key={`${o.region}:${o.feature}`} className={`rounded-xl border p-4 ${TONE_CLS[d.tone]}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{regionLabel(o.region)}</p>
                <TierBadge tier={o.model_tier} />
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
      {quiet.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            {quiet.length} other check{quiet.length === 1 ? "" : "s"} with nothing flagged or not available
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {quiet.map(({ o, d }) => (
              <li key={`${o.region}:${o.feature}`}>
                <span className="font-medium text-slate-800">{regionLabel(o.region)}</span> · {FEATURE_PHRASES[o.feature] ?? featureLabel(o.feature)}: {d.headline}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-sm text-slate-500">These are descriptions of how the image looks, not diagnoses. A camera cannot tell whether you are dehydrated, ill or have any medical condition.</p>
    </div>
  );
}
