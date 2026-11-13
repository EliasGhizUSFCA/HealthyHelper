"use client";

import { useEffect } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { cx } from "@/components/ui";

/** Camera selector + mirror-display toggle (shared by Mirror, Beauty and Model Lab). */
export function CameraPicker({ dark = false }: { dark?: boolean }) {
  const engine = useEngine();
  const { cameras, settings, camera } = useEngineState();
  useEffect(() => {
    void engine.refreshCameras();
  }, [engine]);
  const sel = cx("rounded border px-1.5 py-1", dark ? "border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200" : "border-slate-300 bg-white text-sm text-slate-800");
  return (
    <div className={cx("flex flex-wrap items-center gap-2", dark ? "text-[11px] text-zinc-400" : "text-sm text-slate-700")}>
      <label className="flex items-center gap-1">
        Camera
        <select aria-label="Select camera" className={sel} value={settings.deviceId ?? ""} onChange={(e) => void engine.selectCamera(e.target.value || null)}>
          <option value="">Front camera (default)</option>
          {cameras.map((c) => (
            <option key={c.deviceId || c.label} value={c.deviceId}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {!cameras.some((c) => c.label && !c.label.startsWith("Camera ")) && camera !== "on" && (
        <span className={dark ? "text-zinc-500" : "text-slate-500"}>names appear after you allow camera access</span>
      )}
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={settings.mirrored} onChange={(e) => engine.updateSettings({ mirrored: e.target.checked })} className={dark ? "h-3.5 w-3.5 accent-cyan-400" : "h-4 w-4 accent-sky-700"} />
        Mirror display
      </label>
    </div>
  );
}
