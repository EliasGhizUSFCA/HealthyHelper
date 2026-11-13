"use client";

import type { RankedProduct } from "@/lib/catalog";
import { availabilityLabel, formatPrice, relativeTime } from "@/lib/beauty";
import { cx } from "@/components/ui";

export function ProductCard({
  ranked,
  explanation,
  comparing,
  compareFull,
  discussing,
  onCompare,
  onDiscuss,
  now,
}: {
  ranked: RankedProduct;
  explanation?: string;
  comparing: boolean;
  compareFull: boolean;
  discussing: boolean;
  onCompare: () => void;
  onDiscuss: () => void;
  now?: number;
}) {
  const p = ranked.product;
  return (
    <article className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label={`${p.brand ?? ""} ${p.name}`}>
      <div className="w-20 shrink-0 sm:w-24">
        {p.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt={p.name} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-lg bg-slate-100 object-contain" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">no image</div>
        )}
        <p className="mt-1 text-center text-[11px] text-slate-400">#{ranked.rank} · match {ranked.total_score.toFixed(2)}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.brand ?? "Brand not listed"}</p>
        <h3 className="font-semibold leading-snug text-slate-900">{p.name}</h3>
        <p className="text-sm">
          <span className={cx("font-semibold", p.price == null ? "text-slate-500" : "text-slate-900")} data-testid="price">
            {formatPrice(p)}
          </span>
          {p.list_price != null && p.price != null && <span className="ml-1 text-xs text-slate-400 line-through">{formatPrice({ ...p, price: p.list_price })}</span>}
          {p.size && <span className="ml-2 text-xs text-slate-500">{p.size}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{availabilityLabel(p.availability)}</span>
          <span>· Last checked {relativeTime(p.last_verified, now)}</span>
          {p.stale && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900" title="Price/availability may have changed since the last check">
              Stale
            </span>
          )}
        </p>
        {p.shades.length > 0 && (
          <p className="text-xs text-slate-600">
            Shades: {p.shades.slice(0, 6).join(", ")}
            {p.shades.length > 6 ? ` +${p.shades.length - 6} more` : ""}
          </p>
        )}
        {ranked.matched_claims.length > 0 && (
          <ul className="space-y-0.5 text-xs text-slate-600">
            {ranked.matched_claims.slice(0, 2).map((c) => (
              <li key={c.attribute + c.text}>
                <span className="font-medium text-slate-700">Retailer says:</span> “{c.text}”
              </li>
            ))}
          </ul>
        )}
        {explanation && <p className="text-sm text-slate-700">{explanation}</p>}
        {ranked.warnings.length > 0 && <p className="text-xs text-amber-800">{ranked.warnings.join(" · ")}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-700">
            View on eCosmetics ↗
          </a>
          <label className={cx("flex items-center gap-1", compareFull && !comparing && "opacity-50")}>
            <input type="checkbox" checked={comparing} disabled={compareFull && !comparing} onChange={onCompare} className="h-4 w-4" />
            Compare
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={discussing} onChange={onDiscuss} className="h-4 w-4" />
            Ask the assistant
          </label>
        </div>
      </div>
    </article>
  );
}
