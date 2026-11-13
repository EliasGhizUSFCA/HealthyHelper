"""Ranking engine, grounded explanations, recommendation API, product-aware chat."""

import pytest

from app.recommendations import explain as X
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.ranking.engine import DEFAULT_WEIGHTS, rank
from app.recommendations.scraper.parser import parse_product
from app.schemas.catalog import ExplanationSet, ProductExplanation, RecommendationRequest
from tests.fixtures.eco_pages import product_page

B = "https://www.ecosmetics.com/product/"


def catalog():
    return [
        parse_product(product_page(), B + "a/"),  # fragrance-free claim, $12.50, in stock
        parse_product(product_page(name="Scented Lip Butter", sku="L2", price="8.00", description="Rich butter for dry lips with a fresh scent.",
                                   ingredients="Shea Butter, Parfum, Beeswax"), B + "b/"),
        parse_product(product_page(name="Mystery Lip Balm", sku="L3", price="30.00", description="A nourishing balm for chapped lips.", ingredients=None), B + "c/"),
        parse_product(product_page(name="Peptide Lip Plumper", sku="L4", price="25.00", description="Anti-aging lip treatment that targets fine lines.",
                                   ingredients="Water, Palmitoyl Tripeptide"), B + "d/"),
        parse_product(product_page(name="Out Of Stock Balm", sku="L5", price="5.00", availability="OutOfStock", description="Moisturizing lip balm."), B + "e/"),
    ]


def req(**kw):
    return RecommendationRequest(**{"mode": "skincare", "concern": "dry_lips", "explain": False, **kw})


def test_hard_filters_record_reasons():
    ranked, removed, _ = rank(req(fragrance_free=True, budget_max=20, exclude_ingredients=["beeswax"]), catalog())
    reasons = {r.name: r.reason for r in removed}
    assert "Scented Lip Butter" in reasons and "beeswax" in reasons["Scented Lip Butter"].lower() or "fragrance" in reasons["Scented Lip Butter"]
    assert "above budget" in reasons["Mystery Lip Balm"] and "above budget" in reasons["Peptide Lip Plumper"]
    assert {r.product.name for r in ranked} == {"Test Repair Lip Balm", "Out Of Stock Balm"}


def test_missing_information_is_neutral_and_flagged():
    ranked, _, _ = rank(req(fragrance_free=True), catalog())
    mystery = next(r for r in ranked if r.product.name == "Mystery Lip Balm")
    comp = {c.name: c for c in mystery.components}
    assert comp["ingredient_preference"].score is None and comp["ingredient_preference"].contribution == 0.0
    assert any("fragrance-free could not be verified" in w for w in mystery.warnings)
    known = [c for c in mystery.components if c.score is not None]
    total = sum(c.weight * c.score for c in known) / sum(c.weight for c in known)
    assert mystery.total_score == pytest.approx(total, abs=1e-4)
    assert sum(c.contribution for c in mystery.components) == pytest.approx(mystery.total_score, abs=1e-3)


def test_ranking_is_deterministic_and_explainable():
    a = rank(req(), catalog())[0]
    b = rank(req(), list(reversed(catalog())))[0]
    assert [r.product.product_id for r in a] == [r.product.product_id for r in b]
    top = a[0]
    assert {c.name for c in top.components} >= {"category_relevance", "concern_match", "text_relevance", "availability", "data_reliability"}
    assert all(c.weight == DEFAULT_WEIGHTS[c.name] for c in top.components)


def test_in_stock_filter_and_availability_component():
    ranked, removed, _ = rank(req(in_stock_only=True), catalog())
    assert "Out Of Stock Balm" in {r.name for r in removed}
    ranked_all, _, _ = rank(req(), catalog())
    oos = next(r for r in ranked_all if r.product.name == "Out Of Stock Balm")
    assert {c.name: c.score for c in oos.components}["availability"] == 0.2


def test_age_only_used_when_confirmed_under_18():
    _, removed, meta = rank(req(confirmed_age_range="under_18"), catalog())
    assert meta["age_used"] is True and any("age-appropriateness" in r.reason for r in removed)
    _, removed_adult, meta_adult = rank(req(confirmed_age_range="25_34"), catalog())
    assert meta_adult["age_used"] is False and not any("age" in r.reason for r in removed_adult)
    ranked_none, _, meta_none = rank(req(), catalog())
    assert meta_none["age_used"] is False and "Peptide Lip Plumper" in {r.product.name for r in ranked_none}  # anti-aging NOT pushed or removed for adults


def test_estimated_age_is_not_an_accepted_input():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RecommendationRequest(mode="skincare", estimated_age_range="30_39")


def ctx_for(ranked):
    return X.build_context(req(), ranked, age_used=False)


def test_explanation_validator_catches_hallucinations():
    ranked, _, _ = rank(req(), catalog())
    ctx = ctx_for(ranked[:2])
    ids = [p["product_id"] for p in ctx["ranked"]]
    good = X.template_explanations(ctx)
    assert all(c["passed"] for c in X.validate(good, ctx))
    bad = ExplanationSet(summary="This cures chapped lips.", products=[
        ProductExplanation(product_id=ids[0], explanation="Costs $1.00 and is perfect for your age."),
        ProductExplanation(product_id="eco-INVENTED", explanation="A great product."),
    ])
    failed = {c["name"] for c in X.validate(bad, ctx) if not c["passed"]}
    assert failed == {"only_retrieved_products", "every_product_explained", "prices_match_records", "no_medical_or_appearance_claims", "age_not_mentioned_unless_used"}


def test_template_never_invents_a_price():
    ranked, _, _ = rank(RecommendationRequest(mode="makeup", concern="spot_coverage", explain=False),
                        [parse_product(product_page(name="Soft Concealer", category="makeup/face/concealer", variable=True), B + "v/")])
    exp = X.template_explanations(X.build_context(req(), ranked, False))
    assert "$" not in exp.products[0].explanation and "price wasn't available" in exp.products[0].explanation


@pytest.fixture()
def seeded(services):
    store: CatalogStore = services.catalog
    for p in catalog():
        store.upsert(p)
    return services


def test_recommendation_api_end_to_end(client, seeded):
    r = client.post("/api/recommendations", json={"mode": "skincare", "concern": "dry_lips", "fragrance_free": True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["results"] and d["explanations"]["products"] and all(c["passed"] for c in d["trace"]["validation"])
    assert d["trace"]["retrieval_source"] == "local_catalogue" and d["trace"]["live_requests"] == 0
    assert [e["stage"] for e in d["events"]][:3] == ["user_preferences", "product_retrieval", "product_ranking"]
    assert {"llm_request", "response_validation"} <= {e["stage"] for e in d["events"]}
    assert all(e["event_id"] for e in d["events"])
    names = {x["product"]["name"] for x in d["results"]}
    assert "Scented Lip Butter" not in names  # lists Parfum → filtered


def test_catalog_endpoints_and_dev_token(client, seeded, monkeypatch):
    st = client.get("/api/catalog/status").json()
    assert st["products"] == 5 and st["by_category"]["lip_care"] == 5
    assert len(client.get("/api/catalog/products", params={"q": "butter"}).json()) == 1
    detail = client.get("/api/catalog/products/eco-TB100").json()
    assert detail["product"]["name"] == "Test Repair Lip Balm" and len(detail["price_history"]) == 1
    monkeypatch.setenv("DEV_API_TOKEN", "s3cret")
    assert client.get("/api/catalog/crawl-log").status_code == 401
    assert client.get("/api/catalog/crawl-log", headers={"X-Dev-Token": "s3cret"}).status_code == 200
    assert client.post("/api/catalog/refresh").status_code == 401


def test_chat_with_selected_products_is_grounded(client, seeded):
    r = client.post("/api/chat", json={"session_id": "sess-prod1", "product_ids": ["eco-TB100", "eco-L2"],
                                       "messages": [{"role": "user", "content": "Which of these has fragrance in the ingredients?"}]}).json()
    steps = {s["name"]: s for s in r["trace"]["steps"]}
    assert steps["product_context"]["detail"]["found"] == 2
    assert "<product_data>" in r["trace"]["context_preview"]
    checks = {c["name"]: c["passed"] for c in r["trace"]["validation"]}
    assert checks["product_prices_match_records"] and checks["no_product_efficacy_claims"] and checks["no_appearance_judgement"]
    assert "$12.50" in r["reply"]["message"] and "fragrance" in r["reply"]["message"].lower()


def test_appearance_judgement_blocked():
    from app.safety.validator import validate_reply
    from app.schemas.protocol import AssistantReply

    r = AssistantReply(message="You need concealer to hide your dark circles and look better.", evidence_sufficient=False, suggests_professional=False)
    assert {c.name: c.passed for c in validate_reply(r, None, False)}["no_appearance_judgement"] is False


def test_strict_ingredient_check_drops_unverifiable():
    ranked, removed, _ = rank(req(fragrance_free=True, strict_ingredient_check=True), catalog())
    assert "Mystery Lip Balm" in {r.name for r in removed if "strict" in r.reason}
    assert all(r.product.attributes.fragrance_free_claimed == "yes" or r.product.attributes.contains_fragrance_ingredient == "no" for r in ranked)


def test_banned_retailer_claims_are_never_quoted_or_returned(services):
    from app.recommendations.service import RecommendationService

    p = parse_product(product_page(name="Proven Lip Balm", sku="CP1", description="Clinically proven to heal chapped lips in one day. A moisturizing balm for dry lips."), B + "cp/")
    services.catalog.upsert(p)
    r = RecommendationService(services.catalog, services.assistant.provider).recommend(RecommendationRequest(mode="skincare", concern="dry_lips"))
    assert r.explanations is not None and all(c["passed"] for c in r.trace.validation)
    assert "clinically proven" not in " ".join(e.explanation.lower() for e in r.explanations.products)


def test_verified_matches_listed_before_unverifiable_ones():
    extra = parse_product(product_page(name="Shade Balm", sku="V9", category="skincare/lip-care/lip-balms-treatments", variable=True,
                                       description="A moisturizing balm for dry, chapped lips."), B + "v9/")
    ranked, _, meta = rank(req(budget_max=40), catalog() + [extra])
    prices = [r.product.price for r in ranked]
    first_none = prices.index(None)
    assert all(p is None for p in prices[first_none:]) and "verified matches first" in meta["ordering"]
