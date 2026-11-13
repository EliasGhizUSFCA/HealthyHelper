"""Wire types for the product catalogue and the recommendation engine.

Mirrored in ``frontend/lib/catalog.ts`` (field lists contract-tested like protocol.py).
Product text fields are retailer/brand data: untrusted, displayed as data, never as instructions.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


Tri = Literal["yes", "no", "unknown"]


class Claim(_M):
    attribute: str = Field(description="normalised attribute the claim supports, e.g. 'fragrance_free', 'for_dry_skin'")
    text: str = Field(description="verbatim snippet (≤ 160 chars) from the retailer page")
    source_field: Literal["name", "description", "usage", "ingredients", "category"]


class ProductAttributes(_M):
    fragrance_free_claimed: Tri = "unknown"
    contains_fragrance_ingredient: Tri = "unknown"
    non_comedogenic_claimed: Tri = "unknown"
    spf: float | None = None
    skin_types: list[str] = Field(default_factory=list, description="skin types the product is MARKETED for")
    benefits: list[str] = Field(default_factory=list, description="marketed benefits, e.g. hydrating, barrier, soothing")
    finish: list[str] = Field(default_factory=list)
    coverage: list[str] = Field(default_factory=list)
    texture: list[str] = Field(default_factory=list)


class CatalogProduct(_M):
    product_id: str
    source: Literal["ecosmetics"] = "ecosmetics"
    url: str
    alt_urls: list[str] = Field(default_factory=list)
    sku: str | None = None
    upc: str | None = None
    brand: str | None = None
    name: str
    categories: list[str]
    retailer_categories: list[str]
    mode: Literal["skincare", "makeup", "mixed"]
    description: str | None = None
    price: float | None = None
    list_price: float | None = None
    currency: str | None = None
    price_status: Literal["listed", "unavailable_variable_product", "missing", "invalid_zero"]
    size: str | None = None
    image_url: str | None = None
    availability: Literal["in_stock", "out_of_stock", "unknown"] = "unknown"
    shades: list[str] = Field(default_factory=list)
    ingredients: str | None = None
    ingredients_list: list[str] = Field(default_factory=list)
    usage: str | None = None
    attributes: ProductAttributes = Field(default_factory=ProductAttributes)
    claims: list[Claim] = Field(default_factory=list)
    first_seen: float
    last_verified: float
    sitemap_lastmod: str | None = None
    stale: bool = False
    completeness: float = Field(description="share of tracked fields present (0..1)")
    parse_warnings: list[str] = Field(default_factory=list)


class CatalogStatus(_M):
    crawl_enabled: bool
    policy: dict[str, Any]
    products: int
    by_category: dict[str, int]
    stale_products: int
    stale_after_hours: float
    last_refresh: dict[str, Any] | None
    refresh_running: bool
    source: str = "local catalogue (PostgreSQL/SQLite) populated from permitted eCosmetics product pages"


# --------------------------------------------------------------------------- recommendations


class RecommendationRequest(_M):
    session_id: str | None = None
    mode: Literal["skincare", "makeup"]
    concern: str | None = Field(None, description="user-selected concern, e.g. dry_lips, surface_dryness, sensitive_skin, blemish_prone, visible_redness")
    categories: list[str] = Field(default_factory=list, description="restrict to these categories (empty = default for concern)")
    query: str = Field("", max_length=200, description="free-text preference, e.g. 'lightweight gel'")
    include_observations: list[str] = Field(default_factory=list, description="'region:feature' keys the USER chose to include")
    budget_max: float | None = Field(None, ge=0)
    fragrance_free: bool = False
    exclude_ingredients: list[str] = Field(default_factory=list, max_length=20)
    finish: str | None = None
    coverage: str | None = None
    shade: str | None = None
    undertone: Literal["cool", "neutral", "warm", "olive"] | None = None
    brands: list[str] = Field(default_factory=list)
    in_stock_only: bool = False
    strict_ingredient_check: bool = Field(False, description="Exclude products whose ingredient list is unavailable when exclusions or fragrance-free are requested")
    confirmed_age_range: str | None = Field(None, description="ONLY a range the user confirmed; camera estimates are never accepted here")
    limit: int = Field(8, ge=1, le=30)
    explain: bool = True


class ScoreComponent(_M):
    name: str
    weight: float
    score: float | None = Field(description="0..1, or null when information is missing (excluded from the total, not counted against)")
    contribution: float = Field(description="weight * score / sum(weights of known components)")
    detail: str


class RankedProduct(_M):
    rank: int
    product: CatalogProduct
    total_score: float
    components: list[ScoreComponent]
    matched_claims: list[Claim]
    warnings: list[str]


class FilteredOut(_M):
    product_id: str
    name: str
    reason: str


class ProductExplanation(_M):
    product_id: str
    explanation: str


class ExplanationSet(_M):
    """Schema the LLM must return for product explanations."""
    summary: str
    products: list[ProductExplanation]


class RecommendationTrace(_M):
    retrieval_source: Literal["local_catalogue"] = "local_catalogue"
    live_requests: int = 0
    categories_searched: list[str]
    search_terms: list[str]
    candidates: int
    after_filters: int
    filtered_out: list[FilteredOut]
    weights: dict[str, float]
    age_used: bool
    age_note: str
    stale_in_results: int
    timings_ms: dict[str, float]
    llm: dict[str, Any] = Field(default_factory=dict)
    validation: list[dict[str, Any]] = Field(default_factory=list)


class RecommendationResponse(_M):
    request: RecommendationRequest
    results: list[RankedProduct]
    explanations: ExplanationSet | None
    trace: RecommendationTrace
    events: list[dict[str, Any]]
    disclaimer: str
