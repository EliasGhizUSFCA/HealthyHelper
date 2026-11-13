"use client";

import type { CatalogStatus } from "@/lib/catalog";
import { relativeTime } from "@/lib/beauty";

export function CatalogBanner({ status, error }: { status: CatalogStatus | null; error: string | null }) {
  if (error) return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">Catalogue unavailable: {error}</p>;
  if (!status) return <p className="text-sm text-slate-500">Loading catalogue status…</p>;
  const last = status.last_refresh as { finished_at?: number; started_at?: number; status?: string } | null;
  if (status.products === 0)
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <p className="font-semibold">The local product catalogue is empty.</p>
        <p>
          Products come from permitted eCosmetics product pages, fetched by a background job. Run{" "}
          <code className="rounded bg-white px-1">cd backend && python -m app.recommendations.catalog.refresh</code> (or use the eCosmetics tab in Model Lab).
        </p>
      </div>
    );
  return (
    <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
      {status.products} products in the local catalogue
      {last?.finished_at ? ` · last refresh ${relativeTime(last.finished_at)} (${last.status})` : ""}
      {status.stale_products ? ` · ${status.stale_products} not re-checked in ${status.stale_after_hours} h (marked Stale)` : ""} · results come from listings, not
      product testing
    </p>
  );
}
