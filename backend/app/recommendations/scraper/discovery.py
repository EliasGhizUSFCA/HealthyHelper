"""Product discovery from the retailer's public WordPress sitemap (cached)."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from app.recommendations.scraper.fetcher import PoliteFetcher

SITEMAP_INDEX = "https://www.ecosmetics.com/wp-sitemap.xml"
LOC = re.compile(r"<loc>([^<]+)</loc>(?:\s*<lastmod>([^<]+)</lastmod>)?")


class SitemapCache:
    def __init__(self, path: Path, ttl_s: float = 24 * 3600):
        self.path, self.ttl_s = path, ttl_s

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        d = json.loads(self.path.read_text())
        return d if time.time() - d.get("fetched_at", 0) < self.ttl_s else None

    def info(self) -> dict:
        if not self.path.exists():
            return {"cached": False}
        d = json.loads(self.path.read_text())
        return {"cached": True, "fetched_at": d["fetched_at"] * 1000, "urls": len(d["urls"]), "fresh": time.time() - d["fetched_at"] < self.ttl_s}

    def save(self, urls: list[tuple[str, str | None]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"fetched_at": time.time(), "urls": urls}))


def discover(fetcher: PoliteFetcher, cache: SitemapCache, stats: dict) -> list[tuple[str, str | None]]:
    cached = cache.load()
    if cached:
        stats["sitemap_cache"] = "hit"
        return [tuple(u) for u in cached["urls"]]
    stats["sitemap_cache"] = "miss"
    index = fetcher.get(SITEMAP_INDEX, "sitemap")
    product_maps = [u for u, _ in LOC.findall(index.text) if "/wp-sitemap-posts-product-" in u]
    urls: list[tuple[str, str | None]] = []
    for sm in product_maps:
        r = fetcher.get(sm, "sitemap")
        urls += [(u, lm or None) for u, lm in LOC.findall(r.text) if "/product/" in u]
    cache.save(urls)
    stats["sitemaps_fetched"] = 1 + len(product_maps)
    return urls
