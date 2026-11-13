/** Pure helpers for the Beauty Recommendations UI (unit-tested). */
import type { CatalogProduct, ScoreComponent } from "./catalog";

export const COMPARE_MAX = 3;

export function formatPrice(p: Pick<CatalogProduct, "price" | "currency" | "price_status">): string {
  if (p.price == null) return "Price not listed — see retailer";
  const cur = p.currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(p.price);
  } catch {
    return `${p.price.toFixed(2)} ${cur}`;
  }
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function availabilityLabel(a: CatalogProduct["availability"]): string {
  return a === "in_stock" ? "In stock (at last check)" : a === "out_of_stock" ? "Out of stock (at last check)" : "Availability unknown";
}

export function fragranceInfo(p: CatalogProduct): string {
  const a = p.attributes;
  if (a.fragrance_free_claimed === "yes") return "Marketed as fragrance-free";
  if (a.contains_fragrance_ingredient === "yes") return "Listing indicates fragrance";
  if (a.contains_fragrance_ingredient === "no") return "No fragrance/parfum in listed ingredients";
  return "Unknown (no ingredient list)";
}

/** Toggle a product in the comparison set; never more than COMPARE_MAX. */
export function toggleCompare(ids: string[], id: string, max = COMPARE_MAX): { ids: string[]; rejected: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), rejected: false };
  if (ids.length >= max) return { ids, rejected: true };
  return { ids: [...ids, id], rejected: false };
}

/** Stacked-bar segments for the ranking view: only KNOWN components contribute; missing ones are listed separately. */
export function contributionSegments(components: ScoreComponent[]): { known: { name: string; width: number; score: number; weight: number }[]; missing: string[]; total: number } {
  const known = components.filter((c) => c.score != null && c.weight > 0);
  const denom = known.reduce((a, c) => a + c.weight, 0) || 1;
  const segs = known.map((c) => ({ name: c.name, width: (c.weight * (c.score as number)) / denom, score: c.score as number, weight: c.weight }));
  return { known: segs, missing: components.filter((c) => c.score == null).map((c) => c.name), total: segs.reduce((a, s) => a + s.width, 0) };
}

export function missingFields(p: CatalogProduct): string[] {
  const m: string[] = [];
  if (!p.brand) m.push("brand");
  if (!p.description) m.push("description");
  if (p.price == null) m.push("price");
  if (!p.image_url) m.push("image");
  if (p.availability === "unknown") m.push("availability");
  if (!p.ingredients) m.push("ingredients");
  if (!p.size) m.push("size");
  if (!p.sku) m.push("sku");
  return m;
}
