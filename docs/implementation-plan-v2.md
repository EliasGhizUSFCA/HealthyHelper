# Implementation plan — v2 (age estimation, eCosmetics catalog, recommendations)

## Inspection of the current repository (before v2)

| Area | State | Reuse |
|---|---|---|
| Browser CV (MediaPipe landmarks, quality checks, 10 regions, overlays, sampler) | implemented, unit-tested | as is; add a `face` region for age, camera selection |
| Backend inference (registry, batched torch/ONNX, abstention, aggregation, Grad-CAM) | implemented, tested | generalise catalogue to N-class models (age) |
| Training / evaluation (grouped splits, augmentation, calibration, MLflow, tiers, gate) | implemented, tested | add multiclass + ordinal metrics (MAE) for age |
| Consented data collection + labelling | implemented, tested | add self-reported age range |
| LLM assistant (triage, grounding validator, structured output, trace) | implemented, tested | add product-explanation task + open-weight provider |
| Model Lab (6 panels), Mirror, Comparisons, Privacy | implemented | add tabs: Age, Catalog inspector, Ranking, Frame Inspector |
| Product catalogue / recommendations / age model | **missing** | new modules |

The existing module layout (`backend/app/{cv,inference,llm,safety,storage,telemetry}`) is kept; new code goes
into `backend/app/recommendations/{scraper,catalog,ranking}` and `backend/app/age/`. Renaming existing
packages to the suggested layout would add churn without changing behaviour; the mapping is in the README.

## eCosmetics access review (performed 2026-11-13)

* `robots.txt`: `User-agent: *` disallows only `/wp-login.php`, `/wp-admin/`, `/my-account/`, `/cart/`,
  `/checkout/`, `/?wc-ajax=`, `/wp-admin/admin-ajax.php`. Product (`/product/…`) and category pages are allowed.
* `/terms-and-conditions/`: contains a privacy-style notice; no clause on automated access, scraping or bots
  was found. (Not legal advice — the owner should confirm with the retailer or use an authorised feed.)
* WordPress/WooCommerce REST APIs (`/wp-json/wp/v2/product`, `/wp-json/wc/v3/products`) return **401** →
  treated as access-controlled and **never used**.
* Category listings are rendered client-side by a third-party search service (Klevu) → **not used** (it is a
  separate service with its own terms; we do not reuse embedded front-end keys).
* `wp-sitemap.xml` (public, intended for crawlers) lists all product URLs with `lastmod` → used for discovery.
* Product pages expose **schema.org JSON-LD** (`Product`, `Offer`, `BreadcrumbList`) → preferred source for
  name, brand, SKU, image, price, currency, availability, categories. Description, ingredients and usage come
  from labelled HTML sections.
* Variable (multi-shade) products load prices from `admin-ajax`/`wc-ajax`, which robots.txt disallows; their
  JSON-LD price is `0.00`. → price recorded as **unavailable**, never as 0.

Decision: polite, robots-checked crawling of product pages for the target categories only, discovered via the
sitemap + URL keyword pre-filter + category verification from breadcrumbs. ≥ 2 s between requests, honest
User-Agent, conditional refresh by `lastmod`, circuit breaker on 403/429. Switchable off with
`CATALOG_CRAWL_ENABLED=false`; a `FeedConnector` interface allows an authorised feed later.

## Phases (v2)

| # | Phase | Deliverable |
|---|---|---|
| 5 | Age estimation | `face` region, N-class catalogue, FairFace (CC BY 4.0) training, MAE / range accuracy / calibration / subgroup report, opt-in + confirm/correct/skip/disable |
| 7 | eCosmetics catalogue | policy gate, sitemap discovery, JSON-LD + HTML parser, PostgreSQL/SQLite tables, dedupe, price history, crawl log, freshness |
| 8 | Recommendation engine | hard filters + weighted, transparent scoring, missing = neutral, age only as confirmed-age appropriateness filter, grounded LLM explanations with validation |
| 6+ | LLM | product-explanation schema + validator, open-weight provider (Ollama) |
| 9 | Beauty UI | three-panel page, filters, comparison, retailer links, freshness badges |
| 10 | Advanced Model Lab | tabs: Age, Catalog inspector, Ranking, LLM trace, Performance; Frame Inspector |
| 11 | AR preview (optional) | user-selected lip/cheek tint preview, labelled simulated |

Redis is not added: a single backend process with in-memory caches is sufficient at this scale.
pgvector is not added: a few hundred products are searched with TF-IDF + structured filters; the retriever
interface allows an embedding index later.
