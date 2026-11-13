/**
 * TypeScript mirror of backend/app/schemas/catalog.py (product catalogue + recommendations).
 * Field lists in CATALOG_FIELDS are checked against Pydantic by backend/tests/test_schema_contract.py.
 * Product text is retailer data: render as text, never as HTML.
 */

export type Tri = "yes" | "no" | "unknown";

export interface Claim {
  attribute: string;
  text: string;
  source_field: "name" | "description" | "usage" | "ingredients" | "category";
}

export interface ProductAttributes {
  fragrance_free_claimed: Tri;
  contains_fragrance_ingredient: Tri;
  non_comedogenic_claimed: Tri;
  spf: number | null;
  skin_types: string[];
  benefits: string[];
  finish: string[];
  coverage: string[];
  texture: string[];
}

export interface CatalogProduct {
  product_id: string;
  source: "ecosmetics";
  url: string;
  alt_urls: string[];
  sku: string | null;
  upc: string | null;
  brand: string | null;
  name: string;
  categories: string[];
  retailer_categories: string[];
  mode: "skincare" | "makeup" | "mixed";
  description: string | null;
  price: number | null;
  list_price: number | null;
  currency: string | null;
  price_status: "listed" | "unavailable_variable_product" | "missing" | "invalid_zero";
  size: string | null;
  image_url: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  shades: string[];
  ingredients: string | null;
  ingredients_list: string[];
  usage: string | null;
  attributes: ProductAttributes;
  claims: Claim[];
  first_seen: number;
  last_verified: number;
  sitemap_lastmod: string | null;
  stale: boolean;
  completeness: number;
  parse_warnings: string[];
}

export interface CatalogStatus {
  crawl_enabled: boolean;
  policy: Record<string, unknown>;
  products: number;
  by_category: Record<string, number>;
  stale_products: number;
  stale_after_hours: number;
  last_refresh: Record<string, unknown> | null;
  refresh_running: boolean;
  source: string;
}

export interface CatalogCategory {
  key: string;
  mode: "skincare" | "makeup";
  label: string;
  retailer_paths: string[];
}

export interface RecommendationRequest {
  session_id?: string | null;
  mode: "skincare" | "makeup";
  concern?: string | null;
  categories?: string[];
  query?: string;
  include_observations?: string[];
  budget_max?: number | null;
  fragrance_free?: boolean;
  exclude_ingredients?: string[];
  finish?: string | null;
  coverage?: string | null;
  shade?: string | null;
  undertone?: "cool" | "neutral" | "warm" | "olive" | null;
  brands?: string[];
  in_stock_only?: boolean;
  /** Exclude products whose ingredient list is unavailable when exclusions / fragrance-free are requested. */
  strict_ingredient_check?: boolean;
  /** ONLY a range the user confirmed — never a camera estimate. */
  confirmed_age_range?: string | null;
  limit?: number;
  explain?: boolean;
}

export interface ScoreComponent {
  name: string;
  weight: number;
  score: number | null;
  contribution: number;
  detail: string;
}

export interface RankedProduct {
  rank: number;
  product: CatalogProduct;
  total_score: number;
  components: ScoreComponent[];
  matched_claims: Claim[];
  warnings: string[];
}

export interface FilteredOut {
  product_id: string;
  name: string;
  reason: string;
}

export interface ProductExplanation {
  product_id: string;
  explanation: string;
}

export interface ExplanationSet {
  summary: string;
  products: ProductExplanation[];
}

export interface RecommendationTrace {
  retrieval_source: "local_catalogue";
  live_requests: number;
  categories_searched: string[];
  search_terms: string[];
  candidates: number;
  after_filters: number;
  filtered_out: FilteredOut[];
  weights: Record<string, number>;
  age_used: boolean;
  age_note: string;
  stale_in_results: number;
  timings_ms: Record<string, number>;
  llm: Record<string, unknown>;
  validation: { name: string; passed: boolean; detail: string }[];
}

export interface RecommendationResponse {
  request: RecommendationRequest;
  results: RankedProduct[];
  explanations: ExplanationSet | null;
  trace: RecommendationTrace;
  events: Record<string, unknown>[];
  disclaimer: string;
}

/** Concerns understood by backend/app/recommendations/ranking/engine.py::CONCERNS. */
export const CONCERNS: { key: string; mode: "skincare" | "makeup"; label: string }[] = [
  { key: "dry_lips", mode: "skincare", label: "Dry-feeling lips" },
  { key: "surface_dryness", mode: "skincare", label: "Dry-feeling skin" },
  { key: "sensitive_skin", mode: "skincare", label: "Sensitive skin (self-reported)" },
  { key: "blemish_prone", mode: "skincare", label: "Blemish-prone skin" },
  { key: "visible_redness", mode: "skincare", label: "Redness-prone skin" },
  { key: "oiliness", mode: "skincare", label: "Oily-feeling skin" },
  { key: "sun_protection", mode: "skincare", label: "Sun protection" },
  { key: "general_moisture", mode: "skincare", label: "Everyday moisturiser" },
  { key: "under_eye_coverage", mode: "makeup", label: "Under-eye concealer" },
  { key: "spot_coverage", mode: "makeup", label: "Spot concealer" },
  { key: "redness_coverage", mode: "makeup", label: "Colour correction" },
  { key: "even_coverage", mode: "makeup", label: "Foundation" },
  { key: "light_coverage", mode: "makeup", label: "Skin tint / light coverage" },
  { key: "set_makeup", mode: "makeup", label: "Setting products" },
  { key: "lip_colour", mode: "makeup", label: "Lip colour" },
];

/** Ranges a user can CONFIRM (independent of the model's training bins). */
export const CONFIRMABLE_AGE_RANGES = ["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"] as const;

export const CATALOG_FIELDS: Record<string, string[]> = {
  CatalogProduct: ["product_id", "source", "url", "alt_urls", "sku", "upc", "brand", "name", "categories", "retailer_categories", "mode", "description", "price", "list_price", "currency", "price_status", "size", "image_url", "availability", "shades", "ingredients", "ingredients_list", "usage", "attributes", "claims", "first_seen", "last_verified", "sitemap_lastmod", "stale", "completeness", "parse_warnings"],
  RecommendationRequest: ["session_id", "mode", "concern", "categories", "query", "include_observations", "budget_max", "fragrance_free", "exclude_ingredients", "finish", "coverage", "shade", "undertone", "brands", "in_stock_only", "strict_ingredient_check", "confirmed_age_range", "limit", "explain"],
  RankedProduct: ["rank", "product", "total_score", "components", "matched_claims", "warnings"],
  ScoreComponent: ["name", "weight", "score", "contribution", "detail"],
  RecommendationTrace: ["retrieval_source", "live_requests", "categories_searched", "search_terms", "candidates", "after_filters", "filtered_out", "weights", "age_used", "age_note", "stale_in_results", "timings_ms", "llm", "validation"],
  RecommendationResponse: ["request", "results", "explanations", "trace", "events", "disclaimer"],
  CatalogStatus: ["crawl_enabled", "policy", "products", "by_category", "stale_products", "stale_after_hours", "last_refresh", "refresh_running", "source"],
};
