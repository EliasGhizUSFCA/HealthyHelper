"use client";

import type { RankedProduct } from "@/lib/catalog";
import { formatPrice } from "@/lib/beauty";

/** Compact product row for the sidebar and for products shown inside chat replies. */
export function MiniProductCard({ ranked, why, dark = false }: { ranked: RankedProduct; why?: string; dark?: boolean }) {
  const p = ranked.product;
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${p.brand ?? ""} ${p.name} on eCosmetics (opens in a new tab)`}
      className={`flex gap-2.5 rounded-lg border p-2 transition-colors ${dark ? "border-zinc-700 bg-zinc-900 hover:bg-zinc-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}
    >
      {p.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-md bg-slate-100 object-contain" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded-md bg-slate-100" />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-zinc-400" : "text-slate-500"}`}>{p.brand ?? ""}</span>
        <span className={`line-clamp-2 text-sm font-medium leading-snug ${dark ? "text-zinc-100" : "text-slate-900"}`}>{p.name}</span>
        <span className={`block text-sm ${p.price == null ? "text-slate-500" : dark ? "text-zinc-200" : "text-slate-800"}`} data-testid="mini-price">
          {formatPrice(p)}
          {p.stale && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">stale</span>}
        </span>
        {why && <span className={`mt-0.5 line-clamp-2 text-xs ${dark ? "text-zinc-400" : "text-slate-500"}`}>{why}</span>}
      </span>
    </a>
  );
}
