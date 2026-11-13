"""Parse an eCosmetics product page into a validated ``CatalogProduct``.

Sources, in priority order:
1. schema.org JSON-LD (``Product`` + ``Offer`` + ``BreadcrumbList``) — name, brand, SKU, image, price,
   currency, availability, category path.
2. Labelled HTML sections — ``.ecos-product-description``, the product meta accordion
   ("Ingredients", "How to use"), "Categories:" links, variation ``<select>`` options (shades).

Rules: page text is untrusted data (HTML stripped, lengths capped, never executed or followed). A JSON-LD
price of 0.00 on a variable product is NOT a price — it is recorded as unavailable. Missing fields stay None.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import time

from bs4 import BeautifulSoup

from app.recommendations.catalog.attributes import extract, split_ingredients
from app.recommendations.taxonomy import CATEGORIES, map_retailer_categories
from app.schemas.catalog import CatalogProduct

MAX_TEXT = 4000
SIZE_RE = re.compile(r"\b(\d+(?:\.\d+)?\s?(?:fl\.?\s?oz|oz|ml|mL|g|gm|grams?|lb|ct|count|pcs?))\b", re.I)
TRACKED = ("brand", "description", "price", "image_url", "availability", "ingredients", "size", "sku")


class ParseError(ValueError):
    pass


def _clean(s: str | None, limit: int = MAX_TEXT) -> str | None:
    if not s:
        return None
    s = html.unescape(html.unescape(s))
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit] or None


def _jsonld(soup: BeautifulSoup) -> tuple[dict | None, list[str]]:
    product, crumbs = None, []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in (data.get("@graph", [data]) if isinstance(data, dict) else data):
            if not isinstance(node, dict):
                continue
            t = node.get("@type")
            types = t if isinstance(t, list) else [t]
            if "Product" in types and product is None:
                product = node
            if "BreadcrumbList" in types:
                for el in node.get("itemListElement", []):
                    item = el.get("item", {}) if isinstance(el, dict) else {}
                    url = item.get("@id", "") if isinstance(item, dict) else ""
                    if "/product-category/" in url:
                        crumbs.append(url.split("/product-category/", 1)[1].strip("/"))
    return product, crumbs


def _price(product: dict, warnings: list[str], variable: bool) -> tuple[float | None, float | None, str | None, str]:
    offers = product.get("offers") or []
    offers = offers if isinstance(offers, list) else [offers]
    if not offers:
        return None, None, None, "missing"
    off = offers[0]
    cur = off.get("priceCurrency")
    price = list_price = None
    for spec in off.get("priceSpecification", []) or []:
        try:
            v = float(spec.get("price"))
        except (TypeError, ValueError):
            continue
        if spec.get("priceType", "").endswith("ListPrice"):
            list_price = v
        elif price is None:
            price = v
    if price is None:
        try:
            price = float(off.get("price"))
        except (TypeError, ValueError):
            price = None
    if price is not None and price <= 0:
        warnings.append("JSON-LD price is 0.00 — not a real price" + (" (variable product: per-shade prices load via ajax endpoints disallowed by robots.txt)" if variable else ""))
        return None, None, cur, "unavailable_variable_product" if variable else "invalid_zero"
    if price is None:
        return None, None, cur, "unavailable_variable_product" if variable else "missing"
    return price, (list_price if list_price and list_price > price else None), cur, "listed"


def _availability(product: dict) -> str:
    offers = product.get("offers") or []
    offers = offers if isinstance(offers, list) else [offers]
    a = (offers[0].get("availability", "") if offers else "") or ""
    if a.endswith("InStock"):
        return "in_stock"
    if a.endswith("OutOfStock") or a.endswith("SoldOut") or a.endswith("Discontinued"):
        return "out_of_stock"
    return "unknown"


def _accordion(soup: BeautifulSoup) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in soup.select("#ecosProductMetaAccordion .accordion-item"):
        btn = item.select_one(".accordion-button")
        body = item.select_one(".accordion-body")
        if btn and body:
            key = re.sub(r"\s+", " ", btn.get_text(" ", strip=True)).lower()
            out[key] = body.get_text(" ", strip=True)
    return out


def product_id_for(url: str, sku: str | None) -> str:
    return f"eco-{sku}" if sku and re.fullmatch(r"[A-Za-z0-9_-]{2,40}", sku) else "eco-u" + hashlib.sha1(url.encode()).hexdigest()[:16]


def parse_product(page_html: str, url: str, sitemap_lastmod: str | None = None, now: float | None = None) -> CatalogProduct:
    soup = BeautifulSoup(page_html, "lxml")
    warnings: list[str] = []
    ld, crumbs = _jsonld(soup)
    if ld is None:
        raise ParseError("no schema.org Product JSON-LD on page")
    name = _clean(ld.get("name"), 300)
    if not name:
        raise ParseError("product has no name")

    brand = None
    b = ld.get("brand")
    if isinstance(b, list) and b:
        b = b[0]
    if isinstance(b, dict):
        brand = _clean(b.get("name"), 120)
    elif isinstance(b, str):
        brand = _clean(b, 120)

    form = soup.select_one("form.variations_form")
    variable = bool(form) or bool(soup.select_one(".ecos-product-type-variable"))
    price, list_price, currency, price_status = _price(ld, warnings, variable)

    desc_el = soup.select_one(".ecos-product-description")
    description = _clean(desc_el.get_text(" ", strip=True) if desc_el else None)
    ld_desc = _clean(ld.get("description"), 400)
    if not description and ld_desc and not SIZE_RE.fullmatch(ld_desc or ""):
        description = ld_desc
    acc = _accordion(soup)
    ingredients = _clean(next((v for k, v in acc.items() if "ingredient" in k), None))
    usage = _clean(next((v for k, v in acc.items() if "how to" in k or "direction" in k or "usage" in k), None), 2000)

    size = None
    for txt in (ld_desc, name):
        m = SIZE_RE.search(txt or "")
        if m:
            size = m.group(1)
            break

    shades: list[str] = []
    if form:
        for sel in form.select("select"):
            if any(k in (sel.get("name") or "") for k in ("color", "colour", "shade")):
                shades += [o.get_text(strip=True) for o in sel.select("option") if o.get("value")]
    shades = list(dict.fromkeys(s[:80] for s in shades))[:120]
    if variable and not shades:
        warnings.append("variable product: shade/size options are not present in the static page")

    cat_links = [a.get("href", "") for a in soup.select(".posted_in a")]
    retailer_cats = list(dict.fromkeys(crumbs + [h.split("/product-category/", 1)[1].strip("/") for h in cat_links if "/product-category/" in h]))
    cats = map_retailer_categories(retailer_cats)
    modes = {CATEGORIES[c].mode for c in cats}
    mode = "mixed" if len(modes) > 1 else (modes.pop() if modes else "skincare")

    sku = _clean(str(ld.get("sku")) if ld.get("sku") else None, 40)
    upc = None
    m = re.search(r'"upc":"(\d{8,14})"', page_html)
    if m:
        upc = m.group(1)
    image = ld.get("image")
    if isinstance(image, list):
        image = image[0] if image else None
    if isinstance(image, dict):
        image = image.get("url")
    image = image if isinstance(image, str) and image.startswith("https://") else None

    attrs, claims = extract(name, description, usage, ingredients)
    ts = now or time.time() * 1000
    values = {"brand": brand, "description": description, "price": price, "image_url": image, "availability": _availability(ld) != "unknown",
              "ingredients": ingredients, "size": size, "sku": sku}
    completeness = sum(1 for k in TRACKED if values[k]) / len(TRACKED)
    if not ingredients:
        warnings.append("no ingredient list on page")
    return CatalogProduct(
        product_id=product_id_for(url, sku), url=url, sku=sku, upc=upc, brand=brand, name=name, categories=cats,
        retailer_categories=retailer_cats, mode=mode, description=description, price=price, list_price=list_price,
        currency=currency, price_status=price_status, size=size, image_url=image, availability=_availability(ld), shades=shades,
        ingredients=ingredients, ingredients_list=split_ingredients(ingredients), usage=usage, attributes=attrs, claims=claims,
        first_seen=ts, last_verified=ts, sitemap_lastmod=sitemap_lastmod, completeness=round(completeness, 3), parse_warnings=warnings,
    )
