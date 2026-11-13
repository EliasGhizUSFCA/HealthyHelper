# Data source: eCosmetics product catalogue

**Use:** product discovery only (names, brands, prices, images, ingredients, usage text, availability, links).
No user data, images, ages or concerns are ever sent to the retailer — the connector requests public product
pages only, and recommendations are computed from the local catalogue.

## Access review (2026-11-13) — re-check before every deployment

| Check | Finding | Consequence |
|---|---|---|
| `robots.txt` | `User-agent: *` disallows `/wp-login.php`, `/wp-admin/`, `/my-account/`, `/cart/`, `/checkout/`, `/?wc-ajax=`, `/wp-admin/admin-ajax.php` | product pages allowed; ajax endpoints never requested; robots.txt is re-read every 6 h and enforced per request |
| `/terms-and-conditions/` | privacy-style notice; no clause on automated access, scraping or bots found | no prohibition found; **not legal advice** — ask the retailer or use an authorised feed for production |
| WordPress / WooCommerce REST (`/wp-json/...`) | HTTP 401 | access-controlled → never used (hard-blocked in `policy.py`) |
| Category listings | rendered by a third-party search service (Klevu) in the browser | not used (separate service, separate terms; front-end keys are not reused) |
| `wp-sitemap.xml` | public; 34 product sitemaps, ~68k product URLs with `lastmod` | used for discovery (cached 24 h) |
| Product pages | schema.org JSON-LD `Product`, `Offer`, `BreadcrumbList`; labelled description/ingredients/usage sections | JSON-LD preferred; HTML for remaining fields |
| Variable (multi-shade) products | JSON-LD price `0.00`; real prices load via `admin-ajax`/`wc-ajax` (disallowed) | price stored as **unavailable**, shown as "see retailer" — never as $0 |

## Connector behaviour (`backend/app/recommendations/scraper/`)

* Identifies itself: `AIHealthMirrorCatalogBot/0.2 (+repo URL; portfolio project; product catalog only)`.
* One request at a time, ≥ 2 s apart (or robots `Crawl-delay` if larger); 20 s timeout; ≤ 2 retries on 5xx.
* 403/429 → logged; the fetcher waits out `Retry-After` (or 30 s, 60 s, … up to 10 min), doubles its request
  spacing for the rest of the run (max 30 s), and three consecutive blocks open a circuit breaker that stops the run. Never retried
  around, never bypassed (no CAPTCHA solving, no rotating IPs/agents, no auth).
* Kill switch: `CATALOG_CRAWL_ENABLED=false` disables every request. If robots.txt cannot be fetched, nothing is crawled.
* Targeted: sitemap URLs are pre-filtered by category keywords, capped per category (default 25), newest first;
  a product is kept only if its retailer categories map to a target category. Unchanged pages (by `lastmod` /
  last verification) are skipped. A typical full refresh fetches ~350 pages (~12 min).
* Every request (including policy denials) is written to `catalog_crawl_log`; runs to `catalog_refresh_runs`.
* Page text is treated as untrusted data: HTML/scripts stripped, lengths capped, wrapped in `<product_data>`
  with an instruction to ignore embedded instructions when shown to the LLM.

## Measured catalogue (first refresh, 2026-11-13)

From `python -m evaluation.recommendations_eval` (see `docs/evaluation/recommendations.md`): 271 products in
12 categories; brand/image/SKU 100 %, description 94 %, price 86 % (the rest are multi-shade listings),
ingredients **38 %**, usage 41 %, size 38 %. The refresh run made 331 successful requests, received **one HTTP
429** (logged, not retried), skipped 61 pages outside the target categories and failed to parse 1.

## Authorised feed

`app/recommendations/catalog/feed.py` defines a `FeedConnector` interface and a JSON Lines importer
(`python -m app.recommendations.catalog.feed feed.jsonl`) that runs the same validation, attribute extraction,
de-duplication and price history as crawled pages (tested). If the retailer provides a feed or asks us not to crawl, set `CATALOG_CRAWL_ENABLED=false`
and import the feed instead.
