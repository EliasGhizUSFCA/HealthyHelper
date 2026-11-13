"use client";

import Link from "next/link";
import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { useClientValue } from "@/hooks/useClientValue";
import { loadPrefs, normalise, savePrefs, type MirrorPrefs } from "@/lib/mirrorPrefs";
import { cx } from "@/components/ui";

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm disabled:opacity-40", on ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-600")}
    >
      <span className={cx("relative inline-block h-4 w-7 rounded-full transition-colors", on ? "bg-sky-700" : "bg-slate-300")}>
        <span className={cx("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

/** Start/stop plus the two analysis switches. "Start camera & analysis" applies the remembered choices. */
export function AnalysisControls() {
  const engine = useEngine();
  const { camera, settings, age } = useEngineState();
  const storedJson = useClientValue(() => JSON.stringify(loadPrefs()), JSON.stringify({ analysis: true, age: true }));
  const [override, setOverride] = useState<MirrorPrefs | null>(null);
  const prefs: MirrorPrefs = override ?? JSON.parse(storedJson);

  const apply = (p: MirrorPrefs) => {
    const n = normalise(p);
    savePrefs(n);
    setOverride(n);
    engine.updateSettings({ consentUpload: n.analysis });
    if (n.age !== age.enabled) engine.dispatchAge({ type: n.age ? "enable" : "disable" });
  };

  const start = async () => {
    await engine.startCamera();
    apply(prefs);
  };

  const analysisOn = camera === "on" ? settings.consentUpload : prefs.analysis;
  const ageOn = camera === "on" ? age.enabled : normalise(prefs).age;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {camera !== "on" ? (
          <button type="button" onClick={start} disabled={camera === "starting"} className="rounded-lg bg-sky-700 px-5 py-2.5 text-base font-medium text-white hover:bg-sky-800 disabled:opacity-50">
            {camera === "starting" ? "Starting…" : analysisOn ? "Start camera & analysis" : "Start camera"}
          </button>
        ) : (
          <button type="button" onClick={() => engine.stopCamera()} className="rounded-lg bg-rose-700 px-5 py-2.5 text-base font-medium text-white hover:bg-rose-800">
            Stop camera
          </button>
        )}
        <Switch label="Analysis" on={analysisOn} onChange={(v) => apply({ analysis: v, age: v ? ageOn : false })} />
        <Switch label="Apparent age" on={ageOn} disabled={!analysisOn} onChange={(v) => apply({ analysis: analysisOn, age: v })} />
      </div>
      <p className="text-xs text-slate-500">
        {analysisOn
          ? "Small crops of your lips, eyes, nose and skin" + (ageOn ? " (plus one face crop for the age estimate)" : "") + " are sent for analysis, processed in memory and never stored. "
          : "Analysis is off: your face is tracked only in this browser and nothing is sent. "}
        <Link href="/privacy" className="underline">
          Privacy
        </Link>
      </p>
    </div>
  );
}
