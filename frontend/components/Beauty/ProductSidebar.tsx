"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { chipRequest, chipsFromObservations, QUICK_CHIPS, type Chip } from "@/lib/suggest";
import { cx } from "@/components/ui";
import { MiniProductCard } from "./MiniProductCard";

/**
 * A slim product panel that sits next to the live camera. Off until the user switches it on. Once on, it
 * follows what the mirror notices (accepted observations) or whatever chip the user taps, and refreshes on
 * its own — at most when the suggestion actually changes, never per frame.
 */
export function ProductSidebar({ onClose }: { onClose?: () => void }) {
  const engine = useEngine();
  const { latestResult, recommendation } = useEngineState();
  const noticed = useMemo(() => chipsFromObservations(latestResult?.observations.observations), [latestResult]);
  const [picked, setPicked] = useState<Chip | null>(null);
  const [fragranceFree, setFragranceFree] = useState(false);
  const [budget, setBudget] = useState<string>("");
  const active = picked ?? noticed[0] ?? null;
  const reqKey = active ? `${active.key}|${fragranceFree}|${budget}` : "";
  const lastKey = useRef("");

  useEffect(() => {
    if (!active || reqKey === lastKey.current) return;
    const t = setTimeout(() => {
      lastKey.current = reqKey;
      const b = parseFloat(budget);
      void engine.recommend(chipRequest(active, { fragranceFree, budget: Number.isFinite(b) && b > 0 ? b : null }));
    }, picked ? 0 : 1500); // follow observations calmly; react instantly to taps
    return () => clearTimeout(t);
  }, [reqKey, active, engine, fragranceFree, budget, picked]);

  const res = recommendation.response;
  const why = useMemo(() => new Map((res?.explanations?.products ?? []).map((e) => [e.product_id, e.explanation])), [res]);
  const chips = [...noticed, ...QUICK_CHIPS.filter((q) => !noticed.some((n) => n.concern === q.concern))];

  return (
    <aside aria-label="Product ideas" className="flex h-full max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Product ideas</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded px-1.5 text-slate-500 hover:bg-slate-200" aria-label="Hide product ideas">
            ✕
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What would you like?">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setPicked(c)}
            aria-pressed={active?.key === c.key}
            className={cx(
              "rounded-full border px-3 py-1.5 text-sm",
              active?.key === c.key ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-sky-400",
            )}
            title={c.fromObservation ? "Based on what the mirror noticed in this image" : undefined}
          >
            {c.fromObservation && <span aria-hidden>👁 </span>}
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-sm text-slate-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={fragranceFree} onChange={(e) => setFragranceFree(e.target.checked)} className="h-4 w-4" />
          Fragrance-free
        </label>
        <label className="flex items-center gap-1">
          Max $
          <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="w-16 rounded border border-slate-300 px-1.5 py-0.5" aria-label="Maximum price" />
        </label>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
        {!active && <p className="text-xs text-slate-500">Tap what you&apos;re looking for{noticed.length === 0 ? " — or turn on analysis and ideas will follow what the mirror notices" : ""}.</p>}
        {active && active.fromObservation && !picked && (
          <p className="text-xs text-slate-500">Following what the mirror noticed ({active.label.toLowerCase()}). Tap another option any time.</p>
        )}
        {recommendation.pending && <p className="text-xs text-slate-500">Finding products…</p>}
        {recommendation.error && <p role="alert" className="text-xs text-rose-700">{recommendation.error}</p>}
        {res && !recommendation.pending && res.results.length === 0 && <p className="text-xs text-slate-500">No matching listings — try another option or remove filters.</p>}
        {res?.results.map((r) => <MiniProductCard key={r.product.product_id} ranked={r} why={why.get(r.product.product_id)} size="lg" />)}
        {res && res.results.length > 0 && (
          <p className="pt-1 text-[11px] leading-snug text-slate-400">From eCosmetics listings; ranked by your choices, not product testing. Opens the retailer site.</p>
        )}
      </div>
    </aside>
  );
}
