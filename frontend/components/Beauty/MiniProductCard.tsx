"use client";

import type { RankedProduct } from "@/lib/catalog";
import { formatPrice } from "@/lib/beauty";

/** Compact product row for the sidebar and for products shown inside chat replies. */
export function MiniProductCard({ ranked, why, dark = false, size = "sm" }: { ranked: RankedProduct; why?: string; dark?: boolean; size?: "sm" | "lg" }) {
  const p = ranked.product;
  const lg = size === "lg";
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${p.brand ?? ""} ${p.name} on eCosmetics (opens in a new tab)`}
      className={`flex ${lg ? "gap-3.5 rounded-xl p-3" : "gap-2.5 rounded-lg p-2"} border transition-colors ${dark ? "border-zinc-700 bg-zinc-900 hover:bg-zinc-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}
    >
      {p.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${lg ? "h-24 w-24 rounded-lg" : "h-14 w-14 rounded-md"} shrink-0 bg-white object-contain`} />
      ) : (
        <div className={`${lg ? "h-24 w-24 rounded-lg" : "h-14 w-14 rounded-md"} shrink-0 bg-slate-100`} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${lg ? "text-xs" : "text-[11px]"} font-semibold uppercase tracking-wide ${dark ? "text-zinc-400" : "text-slate-500"}`}>{p.brand ?? ""}</span>
        <span className={`line-clamp-2 ${lg ? "text-base" : "text-sm"} font-medium leading-snug ${dark ? "text-zinc-100" : "text-slate-900"}`}>{p.name}</span>
        <span className={`mt-0.5 block ${lg ? "text-base font-semibold" : "text-sm"} ${p.price == null ? "text-slate-500" : dark ? "text-zinc-200" : "text-slate-800"}`} data-testid="mini-price">
          {formatPrice(p)}
          {p.stale && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">stale</span>}
        </span>
        {lg && <span className="mt-1 inline-block rounded-md bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">View on eCosmetics ↗</span>}
        {why && <span className={`mt-1 ${lg ? "line-clamp-3 text-sm" : "line-clamp-2 text-xs"} ${dark ? "text-zinc-400" : "text-slate-500"}`}>{why}</span>}
      </span>
    </a>
  );
}
