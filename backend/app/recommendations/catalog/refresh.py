"""Incremental, targeted catalogue refresh (CLI + background job).

    python -m app.recommendations.catalog.refresh --per-category 25
    python -m app.recommendations.catalog.refresh --categories lip_care moisturizer --per-category 10

1. robots.txt + policy check (inside the fetcher, for every URL)
2. sitemap discovery (24 h cache) → URL keyword pre-filter per target category
3. newest-first, capped per category; skip pages not modified since our last verification
4. fetch + parse (JSON-LD first) → keep only products whose retailer categories map to a target category
5. upsert with de-duplication, price history, crawl log; run statistics stored in catalog_refresh_runs
"""

from __future__ import annotations

import argparse
import json
import threading
import time
import uuid
from dataclasses import dataclass, field

import httpx

from app.config import get_settings
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.scraper.discovery import SitemapCache, discover
from app.recommendations.scraper.fetcher import CircuitOpen, PoliteFetcher
from app.recommendations.scraper.parser import ParseError, parse_product
from app.recommendations.scraper.policy import AccessDenied, AccessPolicy
from app.recommendations.taxonomy import CATEGORIES, url_matches_targets


@dataclass
class RefreshParams:
    categories: list[str] = field(default_factory=lambda: list(CATEGORIES))
    per_category: int = 25
    max_age_hours: float = 72.0
    force: bool = False


def _lastmod_ms(s: str | None) -> float:
    if not s:
        return 0.0
    try:
        from datetime import datetime

        return datetime.fromisoformat(s).timestamp() * 1000
    except ValueError:
        return 0.0


def run_refresh(store: CatalogStore, params: RefreshParams, policy: AccessPolicy | None = None, client: httpx.Client | None = None,
                progress=None) -> dict:
    run_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    policy = policy or AccessPolicy()
    stats: dict = {"run_id": run_id, "fetched": 0, "inserted": 0, "updated": 0, "unchanged": 0, "merged_duplicate": 0, "skipped_fresh": 0,
                   "not_target_category": 0, "parse_errors": 0, "denied": 0, "errors": 0, "per_category": {}}
    store.start_run(run_id, params.__dict__)
    fetcher = PoliteFetcher(policy, log=lambda e: store.log(run_id, e), client=client)
    status = "ok"
    try:
        if not policy.enabled:
            raise AccessDenied("-", "crawling disabled (CATALOG_CRAWL_ENABLED=false)")
        cache = SitemapCache(store.settings.data_dir / "catalog_cache" / "sitemap.json")
        urls = discover(fetcher, cache, stats)
        stats["sitemap_urls"] = len(urls)
        plan: dict[str, list[tuple[str, str | None]]] = {c: [] for c in params.categories}
        for u, lm in sorted(urls, key=lambda x: x[1] or "", reverse=True):
            for c in url_matches_targets(u, params.categories):
                if len(plan[c]) < params.per_category:
                    plan[c].append((u, lm))
        seen: set[str] = set()
        queue = [(c, u, lm) for c, items in plan.items() for u, lm in items]
        stats["planned"] = len({u for _, u, _ in queue})
        for i, (_cat, u, lm) in enumerate(queue):
            if u in seen:
                continue
            seen.add(u)
            known = store.by_url(u)
            if known and not params.force:
                fresh = time.time() * 1000 - known["last_verified"] < params.max_age_hours * 3600 * 1000
                unchanged = _lastmod_ms(lm) and _lastmod_ms(lm) <= known["last_verified"]
                if fresh or unchanged:
                    stats["skipped_fresh"] += 1
                    continue
            if progress:
                progress({"i": i + 1, "of": len(queue), "url": u})
            try:
                r = fetcher.get(u, "product")
            except AccessDenied:
                stats["denied"] += 1
                continue
            except CircuitOpen:
                raise
            except httpx.HTTPError:
                stats["errors"] += 1
                continue
            stats["fetched"] += 1
            if r.status != 200:
                stats["errors"] += 1
                continue
            try:
                p = parse_product(r.text, u, sitemap_lastmod=lm)
            except ParseError as exc:
                stats["parse_errors"] += 1
                store.log(run_id, {"url": u, "kind": "parse", "outcome": "parse_error", "error": str(exc)})
                continue
            if not set(p.categories) & set(params.categories):
                stats["not_target_category"] += 1
                store.log(run_id, {"url": u, "kind": "parse", "outcome": "not_target_category", "error": ",".join(p.retailer_categories)[:300]})
                continue
            res = store.upsert(p)
            stats[res] += 1
            for c in p.categories:
                stats["per_category"][c] = stats["per_category"].get(c, 0) + 1
    except CircuitOpen as exc:
        status, stats["stopped"] = "stopped_rate_limited", str(exc)
    except AccessDenied as exc:
        status, stats["stopped"] = "denied", exc.reason
    except Exception as exc:  # noqa: BLE001
        status, stats["stopped"] = "error", f"{type(exc).__name__}: {exc}"
    stats["log"] = store.log_summary(run_id)
    store.finish_run(run_id, status, stats)
    stats["status"] = status
    return stats


class RefreshJob:
    """At most one refresh at a time, in a background thread (FastAPI stays responsive)."""

    def __init__(self, store: CatalogStore):
        self.store = store
        self._thread: threading.Thread | None = None
        self.progress: dict | None = None
        self.last_result: dict | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self, params: RefreshParams) -> bool:
        if self.running:
            return False

        def work():
            self.last_result = run_refresh(self.store, params, progress=lambda p: setattr(self, "progress", p))
            self.progress = None

        self._thread = threading.Thread(target=work, name="catalog-refresh", daemon=True)
        self._thread.start()
        return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--categories", nargs="*", default=list(CATEGORIES), choices=list(CATEGORIES))
    ap.add_argument("--per-category", type=int, default=25)
    ap.add_argument("--max-age-hours", type=float, default=72.0)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    store = CatalogStore(get_settings())
    stats = run_refresh(store, RefreshParams(a.categories, a.per_category, a.max_age_hours, a.force),
                        progress=lambda p: print(f"[{p['i']}/{p['of']}] {p['url']}", flush=True))
    print(json.dumps({k: v for k, v in stats.items()}, indent=2))


if __name__ == "__main__":
    main()
