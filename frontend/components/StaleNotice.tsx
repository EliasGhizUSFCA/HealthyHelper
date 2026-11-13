"use client";

import { useNow } from "@/hooks/useNow";

/** Shows how old a result is once it exceeds `afterMs`, so stale outputs are never mistaken for live ones. */
export function StaleNotice({ completedAt, afterMs = 4000, dark = false }: { completedAt: number | null | undefined; afterMs?: number; dark?: boolean }) {
  const now = useNow(1000);
  if (completedAt == null) return null;
  const age = now - completedAt;
  if (age < afterMs) return null;
  return (
    <p role="status" className={dark ? "rounded border border-amber-800 bg-amber-950/50 px-2 py-0.5 text-[10px] text-amber-200" : "rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600"}>
      Not live — last result is {Math.round(age / 1000)} s old{dark ? "" : ". Results update only while your face is clearly visible and analysis is on."}
    </p>
  );
}
