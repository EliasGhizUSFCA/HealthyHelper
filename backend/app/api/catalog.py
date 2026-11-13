"""Catalogue + recommendation endpoints.

Developer-only endpoints (crawl log, refresh trigger) require the ``X-Dev-Token`` header when
``DEV_API_TOKEN`` is set (always set it in deployment).
"""

from __future__ import annotations

import asyncio
import os
import secrets

from fastapi import APIRouter, Header, HTTPException, Request

from app.recommendations.catalog.refresh import RefreshParams
from app.recommendations.taxonomy import CATEGORIES
from app.schemas.catalog import CatalogProduct, CatalogStatus, RecommendationRequest, RecommendationResponse

router = APIRouter(prefix="/api")


def svc(request: Request):
    return request.app.state.services


def require_dev(token: str | None) -> None:
    expected = os.getenv("DEV_API_TOKEN")
    if expected and not (token and secrets.compare_digest(token, expected)):
        raise HTTPException(401, "developer token required (X-Dev-Token)")


@router.get("/catalog/categories")
def categories() -> list[dict]:
    return [{"key": c.key, "mode": c.mode, "label": c.label, "retailer_paths": list(c.retailer_paths)} for c in CATEGORIES.values()]


@router.get("/catalog/status", response_model=CatalogStatus)
def status(request: Request) -> CatalogStatus:
    s = svc(request)
    counts = s.catalog.counts()
    last = s.catalog.last_run()
    return CatalogStatus(crawl_enabled=s.catalog_policy.enabled, policy=s.catalog_policy.describe() | {"sitemap_cache": s.sitemap_cache.info()},
                         products=counts["products"], by_category=counts["by_category"], stale_products=counts["stale"],
                         stale_after_hours=s.catalog.stale_after_h, last_refresh=last, refresh_running=s.refresh_job.running)


@router.get("/catalog/products", response_model=list[CatalogProduct])
def list_products(request: Request, category: str | None = None, mode: str | None = None, brand: str | None = None, q: str | None = None,
                  limit: int = 200) -> list[CatalogProduct]:
    ps = svc(request).catalog.all(categories=[category] if category else None, mode=mode)
    if brand:
        ps = [p for p in ps if (p.brand or "").lower() == brand.lower()]
    if q:
        ql = q.lower()
        ps = [p for p in ps if ql in (p.name + " " + (p.brand or "") + " " + (p.description or "")).lower()]
    return sorted(ps, key=lambda p: (p.brand or "", p.name))[: min(limit, 1000)]


@router.get("/catalog/products/{product_id}")
def get_product(product_id: str, request: Request) -> dict:
    s = svc(request)
    p = s.catalog.get(product_id)
    if not p:
        raise HTTPException(404, "product not found")
    return {"product": p, "price_history": s.catalog.history(product_id)}


@router.get("/catalog/crawl-log")
def crawl_log(request: Request, limit: int = 200, run_id: str | None = None, x_dev_token: str | None = Header(None)) -> dict:
    require_dev(x_dev_token)
    s = svc(request)
    return {"entries": s.catalog.recent_log(min(limit, 1000), run_id), "summary": s.catalog.log_summary(run_id)}


@router.post("/catalog/refresh")
def refresh(request: Request, per_category: int = 10, categories: str | None = None, x_dev_token: str | None = Header(None)) -> dict:
    require_dev(x_dev_token)
    s = svc(request)
    cats = [c for c in (categories.split(",") if categories else CATEGORIES) if c in CATEGORIES]
    started = s.refresh_job.start(RefreshParams(cats, max(1, min(per_category, 50))))
    return {"started": started, "running": s.refresh_job.running, "note": None if started else "a refresh is already running"}


@router.get("/catalog/refresh/progress")
def refresh_progress(request: Request) -> dict:
    j = svc(request).refresh_job
    return {"running": j.running, "progress": j.progress, "last_result": j.last_result}


@router.post("/recommendations", response_model=RecommendationResponse)
async def recommend(body: RecommendationRequest, request: Request) -> RecommendationResponse:
    return await asyncio.to_thread(svc(request).recommender.recommend, body)
