"use client";

import type { CatalogProduct } from "@/lib/catalog";
import { formatPrice, fragranceInfo } from "@/lib/beauty";

export function CompareTable({ products, onRemove }: { products: CatalogProduct[]; onRemove: (id: string) => void }) {
  if (!products.length) return null;
  const rows: [string, (p: CatalogProduct) => string][] = [
    ["Price", (p) => formatPrice(p)],
    ["Size", (p) => p.size ?? "not listed"],
    ["Categories", (p) => p.categories.join(", ").replace(/_/g, " ")],
    ["Fragrance", (p) => fragranceInfo(p)],
    ["Finish (as described)", (p) => p.attributes.finish.join(", ") || "not stated"],
    ["Coverage (as described)", (p) => p.attributes.coverage.join(", ") || "not stated"],
    ["SPF", (p) => (p.attributes.spf != null ? String(p.attributes.spf) : "not stated")],
    ["Ingredients", (p) => (p.ingredients_list.length ? p.ingredients_list.slice(0, 12).join(", ") + (p.ingredients_list.length > 12 ? "…" : "") : "not listed")],
  ];
  return (
    <section aria-label="Product comparison" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[480px] table-fixed text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="w-28 p-2 text-slate-500">Compare</th>
            {products.map((p) => (
              <th key={p.product_id} className="p-2 align-top">
                <p className="font-semibold text-slate-900">{p.name}</p>
                <p className="text-slate-500">{p.brand}</p>
                <button type="button" onClick={() => onRemove(p.product_id)} className="mt-1 text-sky-700 underline">
                  remove
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-b border-slate-100 align-top">
              <th className="p-2 font-medium text-slate-500">{label}</th>
              {products.map((p) => (
                <td key={p.product_id} className="p-2 text-slate-700">
                  {f(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-2 text-[11px] text-slate-500">All values come from the retailer listings; “not stated” means the listing doesn&apos;t say, not that the product lacks it.</p>
    </section>
  );
}
