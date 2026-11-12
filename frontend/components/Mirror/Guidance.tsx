"use client";

import { useEngineState } from "@/hooks/useEngine";
import { ISSUE_GUIDANCE } from "@/lib/quality";

export function Guidance() {
  const { lastQuality, camera, settings, socket } = useEngineState();
  let lines: string[] = [];
  let tone: "ok" | "warn" | "info" = "info";
  if (camera !== "on") lines = ["Press “Start camera” when you're ready. Nothing is recorded."];
  else if (!settings.consentUpload) lines = ["Your face is tracked locally. To get observations, allow sending cropped regions below."];
  else if (socket.status !== "open") lines = ["Connecting to the analysis server…"];
  else if (!lastQuality) lines = ["Hold still, facing the camera, in even light."];
  else if (lastQuality.issues.length === 0) {
    lines = ["Good position and lighting. Hold still."];
    tone = "ok";
  } else {
    lines = lastQuality.issues.map((i) => ISSUE_GUIDANCE[i] ?? i);
    tone = "warn";
  }
  const cls =
    tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-base ${cls}`}>
      <span className="sr-only">Positioning guidance: </span>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
