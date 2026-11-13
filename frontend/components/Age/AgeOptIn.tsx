"use client";

import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { CONFIRMABLE_AGE_RANGES } from "@/lib/catalog";
import { confirmableLabel, spanLabel, suggestConfirmable, uncertaintyLabel, type ConfirmableRange } from "@/lib/age";
import { cx } from "@/components/ui";

/** User-facing apparent-age opt-in + confirm / correct / skip / disable. Nothing here is persisted. */
export function AgeOptIn({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const engine = useEngine();
  const { age, latestResult, settings } = useEngineState();
  const [correcting, setCorrecting] = useState(false);
  const [pick, setPick] = useState<ConfirmableRange | "">("");
  const est = latestResult?.age ?? null;
  const box = compact ? "text-sm text-slate-700" : cx("rounded-xl border p-4", dark ? "border-zinc-800 bg-zinc-950 text-xs text-zinc-300" : "border-slate-200 bg-white text-sm text-slate-700");
  const btn = cx("rounded-lg px-3 py-1.5 font-medium", dark ? "border border-zinc-700 bg-zinc-900 text-zinc-100" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50");
  const primary = cx("rounded-lg px-3 py-1.5 font-medium text-white", dark ? "bg-cyan-800" : "bg-sky-700 hover:bg-sky-800");
  const suggested = suggestConfirmable(est?.expected_age_years);

  const toggle = (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={age.enabled}
        onChange={(e) => engine.dispatchAge({ type: e.target.checked ? "enable" : "disable" })}
        className={dark ? "mt-0.5 h-3.5 w-3.5 accent-cyan-400" : "mt-1 h-5 w-5 accent-sky-700"}
        aria-describedby="age-optin-help"
      />
      <span>
        <span className={cx("font-semibold", dark ? "text-zinc-100" : "text-slate-900")}>Estimate my apparent age range (optional, off by default)</span>
        <span id="age-optin-help" className="block">
          Sends one small whole-face crop per analysis to the server for this purpose only. The estimate is broad, often wrong, never stored, never used for
          health statements — and product suggestions only use an age range <em>you</em> confirm. Unticking turns it off and forgets any confirmed range.
        </span>
      </span>
    </label>
  );

  if (!age.enabled) return compact ? null : <div className={box}>{toggle}</div>;
  if (compact && !age.confirmedRange && age.status !== "skipped" && (!est || est.decision === "unavailable" || est.decision === "abstained")) return null;

  return (
    <div className={box} aria-live="polite">
      {!compact && toggle}
      {!settings.consentUpload && <p className="mt-2">Age estimation needs the “send small cropped regions” option above.</p>}
      {settings.consentUpload && !est && <p className="mt-2">Waiting for the next analysis…</p>}
      {est && est.decision === "unavailable" && <p className="mt-2">No age model is installed on the server, so no estimate is available.</p>}
      {est && est.decision === "abstained" && <p className="mt-2">Not estimated: {est.decision_reason}. Try even lighting and face the camera.</p>}
      {est && (est.decision === "accepted" || est.decision === "inconclusive") && (
        <div className="mt-2 space-y-1">
          <p>
            You may <strong>appear</strong> roughly <strong>{spanLabel(est.plausible_ranges)}</strong> in this image{" "}
            <span className={dark ? "text-zinc-500" : "text-slate-500"}>(uncertainty: {uncertaintyLabel(est.entropy_bits)})</span>.
          </p>
          {est.model_tier !== "validated" && (
            <p className={cx("inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase", est.model_tier === "demo" ? "bg-fuchsia-600 text-white" : "bg-sky-600 text-white")}>
              {est.model_tier === "demo" ? "Demo model" : "Experimental model"}
            </p>
          )}
          <p className={cx(dark ? "text-zinc-500" : "text-slate-500", compact && "text-xs")} title={compact ? est.disclaimer : undefined}>
            {compact ? "How old the face looks to the model — broad, often wrong, never stored." : est.disclaimer}
          </p>
        </div>
      )}
      <div className={cx("flex flex-wrap items-center gap-2", compact ? "mt-1.5 text-xs" : "mt-3")}>
        {age.confirmedRange ? (
          <>
            <span>
              Using your {age.status === "corrected" ? "corrected" : "confirmed"} range <strong>{confirmableLabel(age.confirmedRange)}</strong> (age-appropriateness checks only).
            </span>
            <button type="button" className={btn} onClick={() => setCorrecting(true)}>
              Change
            </button>
            <button type="button" className={btn} onClick={() => engine.dispatchAge({ type: "reset" })}>
              Forget
            </button>
          </>
        ) : age.status === "skipped" ? (
          <>
            <span>Skipped — no age will be used.</span>
            <button type="button" className={btn} onClick={() => engine.dispatchAge({ type: "reset" })}>
              Undo
            </button>
          </>
        ) : (
          <>
            {suggested && est && est.decision !== "unavailable" && (
              <button type="button" className={primary} onClick={() => engine.dispatchAge({ type: "confirm", range: suggested })}>
                Confirm {confirmableLabel(suggested)}
              </button>
            )}
            <button type="button" className={btn} onClick={() => setCorrecting(true)}>
              {suggested ? "Correct…" : "Choose my range…"}
            </button>
            <button type="button" className={btn} onClick={() => engine.dispatchAge({ type: "skip" })}>
              Skip
            </button>
          </>
        )}
      </div>
      {correcting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            My age range
            <select aria-label="Choose your age range" value={pick} onChange={(e) => setPick(e.target.value as ConfirmableRange)} className={cx("rounded border px-2 py-1", dark ? "border-zinc-700 bg-zinc-900" : "border-slate-300 bg-white")}>
              <option value="">choose…</option>
              {CONFIRMABLE_AGE_RANGES.map((r) => (
                <option key={r} value={r}>
                  {confirmableLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={primary}
            disabled={!pick}
            onClick={() => {
              if (pick) engine.dispatchAge({ type: age.confirmedRange || suggested ? "correct" : "confirm", range: pick });
              setCorrecting(false);
            }}
          >
            Save
          </button>
          <button type="button" className={btn} onClick={() => setCorrecting(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
