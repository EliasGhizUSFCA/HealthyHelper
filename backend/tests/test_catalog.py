"""eCosmetics connector: parsing, access policy, polite fetching, incremental refresh, de-duplication, freshness."""

import time

import httpx
import pytest

from app.recommendations.catalog.refresh import RefreshParams, run_refresh
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.scraper.fetcher import CircuitOpen, PoliteFetcher
from app.recommendations.scraper.parser import ParseError, parse_product
from app.recommendations.scraper.policy import AccessDenied, AccessPolicy
from tests.fixtures.eco_pages import ROBOTS, product_page, product_sitemap, sitemap_index

BASE = "https://www.ecosmetics.com"


def test_parse_simple_product_from_jsonld_and_html():
    p = parse_product(product_page(), f"{BASE}/product/test-repair-lip-balm/")
    assert (p.brand, p.name, p.sku, p.price, p.list_price, p.currency, p.availability) == ("TestBrand", "Test Repair Lip Balm", "TB100", 12.5, 15.0, "USD", "in_stock")
    assert p.categories == ["lip_care"] and p.size == "0.5oz" and p.price_status == "listed"
    assert p.ingredients_list == ["Petrolatum", "Shea Butter", "Ceramide NP", "Tocopherol"] and p.usage == "Apply to lips as needed."
    assert p.attributes.fragrance_free_claimed == "yes" and p.attributes.contains_fragrance_ingredient == "no"
    assert "lip_conditioning" in p.attributes.benefits and "dry" in p.attributes.skin_types
    assert "barrier" not in p.attributes.benefits  # ceramide is an ingredient FACT, not a marketing claim — benefits come only from marketing text
    assert "alert(1)" not in (p.description or "") and "<" not in (p.description or "")  # scripts/HTML stripped; text is data only
    assert p.completeness == 1.0


def test_variable_product_zero_price_is_not_a_price():
    p = parse_product(product_page(name="Soft Concealer", category="makeup/face/concealer", variable=True, shades=["Fair 01", "Deep 30"]),
                      f"{BASE}/product/soft-concealer/")
    assert p.price is None and p.price_status == "unavailable_variable_product"
    assert p.shades == ["Fair 01", "Deep 30"] and p.categories == ["concealer"] and p.mode == "makeup"
    assert any("0.00" in w for w in p.parse_warnings)


def test_missing_fields_stay_missing():
    p = parse_product(product_page(ingredients=None, usage=None, description=""), f"{BASE}/product/x/")
    assert p.ingredients is None and p.attributes.contains_fragrance_ingredient == "unknown" and p.attributes.fragrance_free_claimed == "unknown"
    assert p.completeness < 1 and "no ingredient list on page" in p.parse_warnings


def test_scented_name_counts_as_fragrance_evidence():
    p = parse_product(product_page(name="Coconut Scented Lip Balm", description="Moisturizing balm.", ingredients=None), f"{BASE}/product/y/")
    assert p.attributes.contains_fragrance_ingredient == "yes"


def test_no_jsonld_is_rejected():
    with pytest.raises(ParseError):
        parse_product(product_page(jsonld=False), f"{BASE}/product/z/")


def robots_policy(text=ROBOTS, enabled=True):
    pol = AccessPolicy(enabled=enabled, min_interval_s=0.0)
    pol.load_robots(lambda url: (200, text))
    return pol


@pytest.mark.parametrize("url,reason", [
    (f"{BASE}/wp-json/wp/v2/product", "blocked"),
    (f"{BASE}/?wc-ajax=get_variation", "blocked"),
    (f"{BASE}/wp-admin/admin-ajax.php", "blocked"),
    (f"{BASE}/product-category/makeup/", "outside"),
    ("https://evil.example.com/product/x/", "host"),
    (f"{BASE}/my-account/", "blocked"),
])
def test_policy_denies_out_of_scope(url, reason):
    with pytest.raises(AccessDenied, match=reason):
        robots_policy().check(url)


def test_policy_obeys_robots_and_kill_switch():
    pol = robots_policy("User-agent: *\nDisallow: /product/\n")
    with pytest.raises(AccessDenied, match="robots"):
        pol.check(f"{BASE}/product/a/")
    with pytest.raises(AccessDenied, match="disabled"):
        robots_policy(enabled=False).check(f"{BASE}/product/a/")
    robots_policy().check(f"{BASE}/product/a/")  # allowed


def test_policy_refuses_when_robots_unavailable():
    pol = AccessPolicy(min_interval_s=0)
    pol.load_robots(lambda url: (_ for _ in ()).throw(httpx.ConnectError("down")))
    with pytest.raises(AccessDenied, match="robots"):
        pol.check(f"{BASE}/product/a/")


class Site:
    """MockTransport-backed fake retailer that records every request."""

    def __init__(self, pages: dict[str, tuple[int, str]]):
        self.pages, self.requests = pages, []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        assert "AIHealthMirrorCatalogBot" in request.headers["user-agent"]
        status, body = self.pages.get(url, (404, "not found"))
        return httpx.Response(status, text=body, headers={"retry-after": "60"} if status == 429 else {})

    def client(self):
        return httpx.Client(transport=httpx.MockTransport(self.handler), headers={"User-Agent": "AIHealthMirrorCatalogBot/test"})


def test_fetcher_never_requests_denied_urls_and_logs_them():
    site = Site({f"{BASE}/robots.txt": (200, ROBOTS)})
    logs = []
    f = PoliteFetcher(AccessPolicy(min_interval_s=0), log=logs.append, client=site.client())
    with pytest.raises(AccessDenied):
        f.get(f"{BASE}/wp-json/wp/v2/product", "product")
    assert site.requests == [f"{BASE}/robots.txt"]
    assert logs[-1]["outcome"] == "denied_by_policy"


def test_fetcher_circuit_breaker_on_rate_limit():
    url = f"{BASE}/product/a/"
    site = Site({f"{BASE}/robots.txt": (200, ROBOTS), url: (429, "slow down")})
    logs = []
    f = PoliteFetcher(AccessPolicy(min_interval_s=0), log=logs.append, client=site.client(), breaker_threshold=2)
    with pytest.raises(httpx.HTTPStatusError):
        f.get(url, "product")
    with pytest.raises(CircuitOpen):
        f.get(url, "product")
    with pytest.raises(CircuitOpen):  # open breaker: no further requests at all
        f.get(url, "product")
    assert site.requests.count(url) == 2
    assert [e["outcome"] for e in logs if e["kind"] == "product"] == ["rate_limited", "rate_limited"]


def make_site(price="12.50"):
    a, b, c, d = (f"{BASE}/product/{s}/" for s in ("repair-lip-balm", "repair-lip-balm-2", "gentle-face-wash", "hair-shampoo"))
    lm = "2026-10-01T00:00:00+00:00"
    return Site({
        f"{BASE}/robots.txt": (200, ROBOTS),
        f"{BASE}/wp-sitemap.xml": (200, sitemap_index(1)),
        f"{BASE}/wp-sitemap-posts-product-1.xml": (200, product_sitemap([(a, lm), (b, lm), (c, lm), (d, lm)])),
        a: (200, product_page(price=price)),
        b: (200, product_page(price=price)),  # same SKU under a second URL → duplicate
        c: (200, product_page(name="Gentle Face Wash", sku="TB200", category="skincare/cleansers/face-wash-cleanser",
                              description="A gentle cleanser for sensitive skin.", ingredients="Water, Glycerin, Parfum")),
    }), (a, b, c, d)


def test_refresh_incremental_dedupe_and_price_history(settings):
    store = CatalogStore(settings)
    site, (a, b, c, d) = make_site()
    params = RefreshParams(categories=["lip_care", "cleanser"], per_category=10)
    s1 = run_refresh(store, params, AccessPolicy(min_interval_s=0), site.client())
    assert s1["status"] == "ok" and s1["inserted"] == 2 and s1["merged_duplicate"] == 1
    assert d not in site.requests  # 'shampoo' never matched a target category keyword → never fetched
    p = store.get("eco-TB100")
    assert p.alt_urls == [b]
    assert {e["outcome"] for e in store.recent_log()} <= {"ok"}

    s2 = run_refresh(store, params, AccessPolicy(min_interval_s=0), site.client())
    assert s2["skipped_fresh"] == 3 and s2["fetched"] == 0 and s2["sitemap_cache"] == "hit"

    site2, _ = make_site(price="9.99")
    run_refresh(store, RefreshParams(categories=["lip_care"], per_category=10, force=True), AccessPolicy(min_interval_s=0), site2.client())
    assert store.get("eco-TB100").price == 9.99
    assert [h["price"] for h in store.history("eco-TB100")] == [12.5, 9.99]


def test_refresh_disabled_makes_no_requests(settings):
    site, _ = make_site()
    s = run_refresh(CatalogStore(settings), RefreshParams(), AccessPolicy(enabled=False), site.client())
    assert s["status"] == "denied" and site.requests == []


def test_stale_listing_flagged(settings, monkeypatch):
    store = CatalogStore(settings)
    p = parse_product(product_page(), f"{BASE}/product/old/", now=(time.time() - 10 * 24 * 3600) * 1000)
    store.upsert(p)
    assert store.get(p.product_id).stale is True


def test_feed_ingest_validates_and_extracts(settings, tmp_path):
    import json as _json

    from app.recommendations.catalog.feed import JsonLinesFeed, ingest

    f = tmp_path / "feed.jsonl"
    f.write_text(_json.dumps({"product_id": "feed-1", "url": "https://www.ecosmetics.com/product/feed-1/", "name": "Feed Moisturizer", "brand": "B",
                              "categories": ["moisturizer"], "price": 20.0, "currency": "USD", "description": "A fragrance-free cream for dry skin."}) + "\n"
                 + _json.dumps({"name": "missing url"}) + "\n")
    store = CatalogStore(settings)
    s = ingest(store, JsonLinesFeed(f))
    assert s["ok"] == 1 and s["invalid"] == 1
    p = store.get("feed-1")
    assert p.attributes.fragrance_free_claimed == "yes" and "dry" in p.attributes.skin_types
