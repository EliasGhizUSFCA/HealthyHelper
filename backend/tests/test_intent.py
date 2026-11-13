import pytest

from app.recommendations.intent import parse
from tests.test_recommendations import catalog


@pytest.mark.parametrize("text,mode,concern,cats", [
    ("Can you recommend a fragrance-free moisturizer under $25?", "skincare", "general_moisture", ["moisturizer"]),
    ("I need a lip balm, my lips are chapped", "skincare", "dry_lips", ["lip_care"]),
    ("suggest a full coverage concealer for dark circles", "makeup", "under_eye_coverage", ["concealer", "color_corrector"]),
    ("what sunscreen should I buy", "skincare", "sun_protection", ["sunscreen"]),
    ("show me foundation with a matte finish", "makeup", "even_coverage", ["foundation"]),
    ("looking for something for blemish-prone skin without alcohol", "skincare", "blemish_prone", []),
])
def test_parse_product_requests(text, mode, concern, cats):
    r = parse(text)
    assert r is not None and (r.mode, r.concern, r.categories) == (mode, concern, cats)


def test_parse_details():
    r = parse("Recommend a fragrance-free moisturizer under $25 without lanolin, in stock")
    assert r.fragrance_free and r.budget_max == 25 and r.exclude_ingredients == ["lanolin"] and r.in_stock_only
    assert parse("show me foundation with a matte finish, full coverage").finish == "matte"
    assert parse("show me foundation, full coverage").coverage == "full"


@pytest.mark.parametrize("text", ["How do my lips look?", "Am I dehydrated?", "hello", "what does SPF mean"])
def test_non_product_messages_are_not_hijacked(text):
    assert parse(text) is None


def test_chat_returns_products_inline(client, services):
    for p in catalog():
        services.catalog.upsert(p)
    r = client.post("/api/chat", json={"session_id": "sess-int1", "messages": [{"role": "user", "content": "Can you recommend a fragrance-free lip balm?"}]}).json()
    rec = r["recommendations"]
    assert rec and rec["results"] and all(x["product"]["attributes"]["contains_fragrance_ingredient"] != "yes" for x in rec["results"])
    assert "options from eCosmetics" in r["reply"]["message"]
    assert {"product_intent", "recommendations"} <= {s["name"] for s in r["trace"]["steps"]}
    assert all(c["passed"] for c in r["trace"]["validation"])


def test_urgent_message_never_becomes_product_request(client, services):
    r = client.post("/api/chat", json={"session_id": "sess-int2", "messages": [{"role": "user", "content": "recommend eye drops, I have severe eye pain"}]}).json()
    assert r["trace"]["route"] == "urgent_safety" and r["recommendations"] is None


def test_search_box_does_not_need_asking_words():
    assert parse("fragrance-free moisturiser under $25") is None
    r = parse("fragrance-free moisturiser under $25", require_ask=False)
    assert r and r.concern == "general_moisture" and r.fragrance_free and r.budget_max == 25
    assert parse("something gentle", require_ask=False).query == "something gentle"
