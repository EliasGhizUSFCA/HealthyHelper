import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
import { ageForRecommendation, ageReducer, filterRegionsForAge, INITIAL_AGE, spanLabel, suggestConfirmable } from "@/lib/age";
import { COMPARE_MAX, contributionSegments, formatPrice, toggleCompare } from "@/lib/beauty";
import { AR_LABEL, lipPolygons, LIP_INNER, LIP_OUTER } from "@/lib/ar";
import { ARControls, DEFAULT_AR } from "@/components/Beauty/ARPreview";
import { ProductCard } from "@/components/Beauty/ProductCard";
import { TierBadge } from "@/components/ui";
import { videoConstraints } from "@/lib/camera";
import type { CatalogProduct, RankedProduct, ScoreComponent } from "@/lib/catalog";
import type { RegionCrop } from "@/lib/protocol";

const crop = (region: RegionCrop["region"]): RegionCrop => ({ region, bbox: [0, 0, 0.1, 0.1], image_b64: "data:image/jpeg;base64,AA" });

describe("face-crop gating", () => {
  const regions = [crop("lips"), crop("face"), crop("nose")];
  it("never sends the whole-face crop unless age estimation is enabled", () => {
    expect(filterRegionsForAge(regions, false).map((r) => r.region)).toEqual(["lips", "nose"]);
    expect(filterRegionsForAge(regions, true).map((r) => r.region)).toEqual(["lips", "face", "nose"]);
  });
});

describe("age reducer", () => {
  it("is off by default and sends no age", () => {
    expect(INITIAL_AGE.enabled).toBe(false);
    expect(ageForRecommendation(INITIAL_AGE)).toBeNull();
  });
  it("confirm / correct / skip / disable", () => {
    let s = ageReducer(INITIAL_AGE, { type: "enable" });
    s = ageReducer(s, { type: "confirm", range: "25_34" });
    expect(ageForRecommendation(s)).toBe("25_34");
    s = ageReducer(s, { type: "correct", range: "35_44" });
    expect(s.status).toBe("corrected");
    expect(ageForRecommendation(s)).toBe("35_44");
    s = ageReducer(s, { type: "skip" });
    expect(ageForRecommendation(s)).toBeNull();
    s = ageReducer(ageReducer(s, { type: "confirm", range: "18_24" }), { type: "disable" });
    expect(s).toEqual(INITIAL_AGE); // disabling forgets the confirmed range too
  });
  it("rejects ranges that are not user-confirmable (e.g. model bins)", () => {
    const s = ageReducer({ ...INITIAL_AGE, enabled: true }, { type: "confirm", range: "20_29" as never });
    expect(s.confirmedRange).toBeNull();
  });
  it("never suggests a minor range from the camera and shows broad spans", () => {
    expect(suggestConfirmable(16)).toBeNull();
    expect(suggestConfirmable(30)).toBe("25_34");
    expect(spanLabel(["20_29", "30_39"])).toBe("20–39");
  });
});

describe("camera constraints", () => {
  it("uses the front camera by default and an exact device when chosen", () => {
    expect(videoConstraints(null).facingMode).toBe("user");
    expect(videoConstraints("abc").deviceId).toEqual({ exact: "abc" });
  });
});

const product = (p: Partial<CatalogProduct> = {}): CatalogProduct => ({
  product_id: "eco-1", source: "ecosmetics", url: "https://www.ecosmetics.com/product/x/", alt_urls: [], sku: "1", upc: null, brand: "B", name: "Balm",
  categories: ["lip_care"], retailer_categories: [], mode: "skincare", description: null, price: null, list_price: null, currency: "USD",
  price_status: "unavailable_variable_product", size: null, image_url: null, availability: "unknown", shades: [], ingredients: null, ingredients_list: [],
  usage: null, attributes: { fragrance_free_claimed: "unknown", contains_fragrance_ingredient: "unknown", non_comedogenic_claimed: "unknown", spf: null, skin_types: [], benefits: [], finish: [], coverage: [], texture: [] },
  claims: [], first_seen: 0, last_verified: Date.now() - 5 * 86400_000, sitemap_lastmod: null, stale: true, completeness: 0.5, parse_warnings: [], ...p,
});
const ranked = (p: CatalogProduct): RankedProduct => ({ rank: 1, product: p, total_score: 0.7, components: [], matched_claims: [{ attribute: "hydrating", text: "Hydrating balm", source_field: "description" }], warnings: [] });

describe("ProductCard", () => {
  it("shows 'not listed' for a null price, a Stale badge and a safe retailer link", () => {
    render(<ProductCard ranked={ranked(product())} comparing={false} compareFull={false} discussing={false} onCompare={() => {}} onDiscuss={() => {}} />);
    expect(screen.getByTestId("price").textContent).toBe("Price not listed — see retailer");
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText(/Retailer says:/)).toBeTruthy();
    const a = screen.getByRole("link", { name: /eCosmetics/ });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
  it("formats real prices and never shows 0.00 for missing ones", () => {
    expect(formatPrice({ price: 12.5, currency: "USD", price_status: "listed" })).toBe("$12.50");
    expect(formatPrice({ price: null, currency: "USD", price_status: "invalid_zero" })).not.toMatch(/0\.00/);
  });
});

describe("compare limit", () => {
  it(`allows at most ${COMPARE_MAX} products`, () => {
    let ids: string[] = [];
    for (const id of ["a", "b", "c"]) ids = toggleCompare(ids, id).ids;
    const r = toggleCompare(ids, "d");
    expect(r.rejected).toBe(true);
    expect(r.ids).toEqual(["a", "b", "c"]);
    expect(toggleCompare(ids, "b").ids).toEqual(["a", "c"]);
  });
});

describe("AR preview", () => {
  it("is off by default and labelled simulated when on", () => {
    expect(DEFAULT_AR.enabled).toBe(false);
    const onChange = vi.fn();
    const { rerender, container } = render(<ARControls value={DEFAULT_AR} onChange={onChange} faceTracked />);
    fireEvent.click(within(container).getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    rerender(<ARControls value={{ ...DEFAULT_AR, enabled: true }} onChange={onChange} faceTracked />);
    expect(screen.getAllByText(new RegExp(AR_LABEL.split(" — ")[0])).length).toBeGreaterThan(0);
  });
  it("builds outer and inner lip polygons from landmarks", () => {
    const lm = Array.from({ length: 478 }, (_, i) => ({ x: i / 478, y: 0.5 }));
    const poly = lipPolygons(lm)!;
    expect(poly.outer).toHaveLength(LIP_OUTER.length);
    expect(poly.inner).toHaveLength(LIP_INNER.length);
    expect(lipPolygons(null)).toBeNull();
  });
});

describe("tier badges", () => {
  it("demo and experimental outputs always carry a badge", () => {
    const { container, rerender } = render(<TierBadge tier="demo" />);
    expect(container.textContent).toBe("Demo");
    rerender(<TierBadge tier="experimental" />);
    expect(container.textContent).toBe("Experimental");
    rerender(<TierBadge tier="validated" />);
    expect(container.textContent).toBe("");
  });
});

describe("ranking contribution bars", () => {
  it("exclude missing components and re-normalise known ones", () => {
    const comps: ScoreComponent[] = [
      { name: "concern_match", weight: 2, score: 1, contribution: 0, detail: "" },
      { name: "budget_fit", weight: 1, score: null, contribution: 0, detail: "price unavailable" },
      { name: "availability", weight: 1, score: 0.5, contribution: 0, detail: "" },
    ];
    const s = contributionSegments(comps);
    expect(s.missing).toEqual(["budget_fit"]);
    expect(s.known.map((k) => k.name)).toEqual(["concern_match", "availability"]);
    expect(s.total).toBeCloseTo((2 * 1 + 1 * 0.5) / 3);
  });
});
