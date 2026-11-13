"use client";

import { useEngine, useEngineState } from "@/hooks/useEngine";
import { cx } from "@/components/ui";

export function CameraActiveIndicator({ dark = false }: { dark?: boolean }) {
  const engine = useEngine();
  const { camera } = useEngineState();
  if (camera !== "on") return null;
  return (
    <div role="status" aria-live="polite" className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium", dark ? "bg-rose-950 text-rose-200 text-xs" : "bg-rose-50 text-rose-800")}>
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600" />
      </span>
      Camera active
      <button type="button" onClick={() => engine.stopCamera()} className={cx("ml-1 rounded-full px-2 py-0.5 font-semibold", dark ? "bg-rose-800 text-white" : "bg-rose-700 text-white hover:bg-rose-800")}>
        Stop
      </button>
    </div>
  );
}

export function ConsentToggle({ dark = false }: { dark?: boolean }) {
  const engine = useEngine();
  const { settings } = useEngineState();
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-lg border p-3", dark ? "border-zinc-800 bg-zinc-950 text-xs text-zinc-300" : "border-slate-200 bg-white text-sm text-slate-700")}>
      <input
        type="checkbox"
        className={cx("mt-0.5", dark ? "h-3.5 w-3.5 accent-cyan-400" : "h-5 w-5 accent-sky-700")}
        checked={settings.consentUpload}
        onChange={(e) => engine.updateSettings({ consentUpload: e.target.checked })}
      />
      <span>
        <span className={cx("font-semibold", dark ? "text-zinc-100" : "text-slate-900")}>Send small cropped face regions to the analysis server</span>
        <span className="block">
          Needed for visual observations. Only ≤160 px crops of lips, eyes, under-eyes, nose and skin are sent; they are processed in memory and not stored or used for training.
        </span>
      </span>
    </label>
  );
}
