"""Catalogue persistence (SQLAlchemy Core; SQLite by default, PostgreSQL via DATABASE_URL).

Tables: ``catalog_products`` (one row per de-duplicated product, full record as JSON + indexed columns),
``catalog_price_history``, ``catalog_crawl_log`` (every request and its outcome, incl. policy denials and
rate limits), ``catalog_refresh_runs``.

De-duplication: the same product is often listed under several URLs (``…-concealer-11-2``). Records are
merged when they share a SKU, or the same normalised (brand, name, size) key; extra URLs go to ``alt_urls``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

from sqlalchemy import JSON, Column, Float, Integer, MetaData, String, Table, Text, create_engine, desc, func, or_, select, update

from app.config import Settings, get_settings
from app.schemas.catalog import CatalogProduct

metadata = MetaData()
products = Table(
    "catalog_products", metadata,
    Column("product_id", String(64), primary_key=True),
    Column("canonical_key", String(300), index=True, nullable=False),
    Column("sku", String(64), index=True),
    Column("url", String(500), unique=True, nullable=False),
    Column("brand", String(120), index=True),
    Column("name", String(300), nullable=False),
    Column("categories", JSON, nullable=False),
    Column("mode", String(16), nullable=False),
    Column("price", Float),
    Column("availability", String(16), nullable=False),
    Column("last_verified", Float, nullable=False),
    Column("content_hash", String(64), nullable=False),
    Column("data", JSON, nullable=False),
)
url_aliases = Table(
    "catalog_url_aliases", metadata,
    Column("url", String(500), primary_key=True),
    Column("product_id", String(64), index=True, nullable=False),
)
price_history = Table(
    "catalog_price_history", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("product_id", String(64), index=True, nullable=False),
    Column("price", Float), Column("list_price", Float), Column("currency", String(8)), Column("price_status", String(40)),
    Column("availability", String(16)), Column("observed_at", Float, nullable=False),
)
crawl_log = Table(
    "catalog_crawl_log", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("run_id", String(40), index=True),
    Column("at", Float, nullable=False),
    Column("url", String(600), nullable=False),
    Column("kind", String(20)),
    Column("status", Integer),
    Column("outcome", String(40), nullable=False),
    Column("error", Text),
    Column("elapsed_ms", Float),
    Column("bytes", Integer),
)
refresh_runs = Table(
    "catalog_refresh_runs", metadata,
    Column("run_id", String(40), primary_key=True),
    Column("started_at", Float, nullable=False),
    Column("finished_at", Float),
    Column("status", String(20), nullable=False),
    Column("params", JSON, nullable=False),
    Column("stats", JSON, nullable=False),
)


def canonical_key(p: CatalogProduct) -> str:
    def norm(s: str | None) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    return f"{norm(p.brand)}|{norm(p.name)}|{norm(p.size)}"


class CatalogStore:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        url = self.settings.resolved_database_url
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, future=True)
        metadata.create_all(self.engine)
        self.stale_after_h = float(os.getenv("CATALOG_STALE_AFTER_HOURS", "72"))

    # --------------------------------------------------------------- products
    def upsert(self, p: CatalogProduct) -> str:
        """Insert or merge; returns 'inserted' | 'updated' | 'unchanged' | 'merged_duplicate'."""
        key = canonical_key(p)
        h = hashlib.sha1(json.dumps([p.price, p.list_price, p.availability, p.description, p.ingredients, p.shades, p.usage, p.image_url],
                                    sort_keys=True).encode()).hexdigest()
        with self.engine.begin() as c:
            row = c.execute(select(products).where(products.c.url == p.url)).mappings().first()
            if row is None:
                cond = products.c.canonical_key == key
                if p.sku:
                    cond = or_(cond, products.c.sku == p.sku)
                row = c.execute(select(products).where(cond)).mappings().first()
                if row is not None:  # same product under another URL → merge
                    existing = CatalogProduct.model_validate(row["data"])
                    if p.url not in existing.alt_urls and p.url != existing.url:
                        existing.alt_urls.append(p.url)
                    existing.last_verified = max(existing.last_verified, p.last_verified)
                    c.execute(update(products).where(products.c.product_id == row["product_id"]).values(data=existing.model_dump(), last_verified=existing.last_verified))
                    if not c.execute(select(url_aliases.c.url).where(url_aliases.c.url == p.url)).first():
                        c.execute(url_aliases.insert().values(url=p.url, product_id=row["product_id"]))
                    return "merged_duplicate"
            if row is None:
                c.execute(products.insert().values(product_id=p.product_id, canonical_key=key, sku=p.sku, url=p.url, brand=p.brand, name=p.name,
                                                   categories=p.categories, mode=p.mode, price=p.price, availability=p.availability,
                                                   last_verified=p.last_verified, content_hash=h, data=p.model_dump()))
                self._price_point(c, p.product_id, p)
                return "inserted"
            prev = CatalogProduct.model_validate(row["data"])
            p.product_id, p.first_seen = row["product_id"], prev.first_seen
            p.alt_urls = sorted(set(prev.alt_urls) | set(p.alt_urls))
            changed = row["content_hash"] != h
            c.execute(update(products).where(products.c.product_id == row["product_id"]).values(
                canonical_key=key, sku=p.sku, brand=p.brand, name=p.name, categories=p.categories, mode=p.mode, price=p.price,
                availability=p.availability, last_verified=p.last_verified, content_hash=h, data=p.model_dump()))
            if (prev.price, prev.availability, prev.price_status) != (p.price, p.availability, p.price_status):
                self._price_point(c, row["product_id"], p)
            return "updated" if changed else "unchanged"

    def _price_point(self, c, pid: str, p: CatalogProduct) -> None:
        c.execute(price_history.insert().values(product_id=pid, price=p.price, list_price=p.list_price, currency=p.currency,
                                                price_status=p.price_status, availability=p.availability, observed_at=p.last_verified))

    def _with_staleness(self, data: dict) -> CatalogProduct:
        p = CatalogProduct.model_validate(data)
        p.stale = (time.time() * 1000 - p.last_verified) > self.stale_after_h * 3600 * 1000
        return p

    def get(self, product_id: str) -> CatalogProduct | None:
        with self.engine.connect() as c:
            r = c.execute(select(products.c.data).where(products.c.product_id == product_id)).first()
        return self._with_staleness(r[0]) if r else None

    def by_url(self, url: str) -> dict | None:
        """Freshness info for a URL — primary product URL or a merged duplicate's alias."""
        with self.engine.connect() as c:
            r = c.execute(select(products.c.last_verified, products.c.data).where(products.c.url == url)).first()
            if r is None:
                alias = c.execute(select(url_aliases.c.product_id).where(url_aliases.c.url == url)).first()
                if alias:
                    r = c.execute(select(products.c.last_verified, products.c.data).where(products.c.product_id == alias[0])).first()
        return {"last_verified": r[0], "sitemap_lastmod": r[1].get("sitemap_lastmod")} if r else None

    def all(self, categories: list[str] | None = None, mode: str | None = None) -> list[CatalogProduct]:
        q = select(products.c.data, products.c.categories)
        if mode:
            q = q.where(or_(products.c.mode == mode, products.c.mode == "mixed"))
        with self.engine.connect() as c:
            rows = c.execute(q).all()
        out = [self._with_staleness(d) for d, cats in rows if not categories or set(cats) & set(categories)]
        return out

    def history(self, product_id: str) -> list[dict]:
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(select(price_history).where(price_history.c.product_id == product_id).order_by(price_history.c.observed_at)).mappings()]

    def counts(self) -> dict:
        ps = self.all()
        by: dict[str, int] = {}
        for p in ps:
            for cat in p.categories:
                by[cat] = by.get(cat, 0) + 1
        return {"products": len(ps), "by_category": dict(sorted(by.items())), "stale": sum(p.stale for p in ps)}

    # --------------------------------------------------------------- logs / runs
    def log(self, run_id: str | None, e: dict) -> None:
        with self.engine.begin() as c:
            c.execute(crawl_log.insert().values(run_id=run_id, at=time.time() * 1000, url=e["url"][:600], kind=e.get("kind"), status=e.get("status"),
                                                outcome=e.get("outcome", "?"), error=(e.get("error") or None), elapsed_ms=e.get("elapsed_ms"), bytes=e.get("bytes")))

    def recent_log(self, limit: int = 200, run_id: str | None = None) -> list[dict]:
        q = select(crawl_log).order_by(desc(crawl_log.c.id)).limit(limit)
        if run_id:
            q = q.where(crawl_log.c.run_id == run_id)
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(q).mappings()]

    def log_summary(self, run_id: str | None = None) -> dict:
        q = select(crawl_log.c.outcome, func.count()).group_by(crawl_log.c.outcome)
        if run_id:
            q = q.where(crawl_log.c.run_id == run_id)
        with self.engine.connect() as c:
            return {k: v for k, v in c.execute(q).all()}

    def start_run(self, run_id: str, params: dict) -> None:
        with self.engine.begin() as c:
            c.execute(refresh_runs.insert().values(run_id=run_id, started_at=time.time() * 1000, status="running", params=params, stats={}))

    def finish_run(self, run_id: str, status: str, stats: dict) -> None:
        with self.engine.begin() as c:
            c.execute(update(refresh_runs).where(refresh_runs.c.run_id == run_id).values(finished_at=time.time() * 1000, status=status, stats=stats))

    def last_run(self) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(refresh_runs).order_by(desc(refresh_runs.c.started_at)).limit(1)).mappings().first()
        return dict(r) if r else None
