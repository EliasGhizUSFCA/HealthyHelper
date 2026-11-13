"use client";

import { useEngineState } from "@/hooks/useEngine";
import { featureLabel, regionLabel } from "@/lib/format";
import { describeObservation } from "./ObservationCards";
import { StaleNotice } from "@/components/StaleNotice";
import { cx } from "@/components/ui";

const PHRASE: Record<string, string> = {
  visible_dryness: "looks dry",
  visible_redness: "some redness",
  visible_flaking: "dry / flaky look",
  visible_blemishes: "some spots",
  visible_shine: "some shine",
  visible_darkness: "looks darker",
};

/** One short line per finding; everything else folded away. Appearance only — never a diagnosis. */
export function CompactObservations() {
  const { latestResult, latestReceivedAt, settings, camera } = useEngineState();
  const obs = latestResult?.observations;
  if (camera !== "on") return <p className="text-sm text-slate-500">Start the camera to see what the mirror notices.</p>;
  if (!settings.consentUpload) return <p className="text-sm text-slate-500">Analysis is off — turn it on to see observations.</p>;
  if (!obs) return <p className="text-sm text-slate-500">Looking…</p>;

  const rows = obs.observations.map((o) => ({ o, d: describeObservation(o) }));
  const seen = rows.filter((r) => r.d.tone === "seen");
  const unsure = rows.filter((r) => r.d.tone === "unsure");
  const demo = obs.observations.some((o) => o.model_tier === "demo");
  const experimental = !demo && obs.observations.some((o) => o.model_tier === "experimental");

  return (
    <div className="space-y-2" aria-live="polite">
      <StaleNotice completedAt={latestReceivedAt} />
      {seen.length === 0 ? (
        <p className="text-slate-700">Nothing stands out right now.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {seen.map(({ o }) => (
            <li
              key={`${o.region}:${o.feature}`}
              title={`Classifier score ${o.confidence?.toFixed(2) ?? "—"} over ${o.frames_aggregated} frames — not a medical probability`}
              className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-950"
            >
              <span className="font-medium">{regionLabel(o.region)}</span> · {PHRASE[o.feature] ?? featureLabel(o.feature)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        {unsure.length > 0 && `${unsure.length} unclear · `}
        {obs.image_quality !== "acceptable" && `image quality ${obs.image_quality} · `}
        {demo && <span className={cx("font-semibold text-fuchsia-700")}>demo models (synthetic training) · </span>}
        {experimental && <span className="font-semibold text-sky-700">experimental models · </span>}
        How the image looks, not a diagnosis.
      </p>
    </div>
  );
}
