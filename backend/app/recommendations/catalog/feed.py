"""Authorised-feed ingestion: the alternative to crawling.

Any source that can yield ``CatalogProduct``-shaped records (a retailer feed, an affiliate API export, a CSV
converted to JSON Lines) is ingested through the same validation, de-duplication and price-history path as
crawled pages.

    python -m app.recommendations.catalog.feed path/to/feed.jsonl
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError

from app.config import get_settings
from app.recommendations.catalog.attributes import extract, split_ingredients
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.taxonomy import CATEGORIES
from app.schemas.catalog import CatalogProduct


class FeedConnector(Protocol):
    name: str

    def products(self) -> Iterable[dict]: ...


class JsonLinesFeed:
    name = "jsonl"

    def __init__(self, path: Path):
        self.path = path

    def products(self) -> Iterator[dict]:
        with self.path.open() as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)


def ingest(store: CatalogStore, feed: FeedConnector) -> dict:
    stats = {"ok": 0, "invalid": 0, "errors": []}
    now = time.time() * 1000
    for raw in feed.products():
        try:
            raw = {**raw}
            raw.setdefault("first_seen", now)
            raw.setdefault("last_verified", now)
            raw.setdefault("retailer_categories", [])
            raw.setdefault("price_status", "listed" if raw.get("price") else "missing")
            cats = [c for c in raw.get("categories", []) if c in CATEGORIES]
            raw["categories"] = cats
            modes = {CATEGORIES[c].mode for c in cats}
            raw.setdefault("mode", "mixed" if len(modes) > 1 else (modes.pop() if modes else "skincare"))
            raw.setdefault("ingredients_list", split_ingredients(raw.get("ingredients")))
            raw.setdefault("completeness", 0.0)
            p = CatalogProduct.model_validate(raw)
            p.attributes, p.claims = extract(p.name, p.description, p.usage, p.ingredients)
            store.upsert(p)
            stats["ok"] += 1
        except (ValidationError, KeyError, TypeError) as exc:
            stats["invalid"] += 1
            stats["errors"].append(str(exc)[:200])
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    a = ap.parse_args()
    print(json.dumps(ingest(CatalogStore(get_settings()), JsonLinesFeed(a.path)), indent=2))


if __name__ == "__main__":
    main()
