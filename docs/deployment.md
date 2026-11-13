# Deployment

## Local development

```bash
make setup                    # CPU torch + backend dev deps + frontend npm ci
make demo-models              # optional: synthetic data + 4 DEMO models (~2–3 min each on 4 CPU cores)
make backend                  # http://localhost:8000  (docs at /docs)
make frontend                 # http://localhost:3000
make test                     # backend pytest + frontend vitest/typecheck
```

Without `make demo-models` the app still runs: every model reports **unavailable** and no scores are shown.
Without `ANTHROPIC_API_KEY` the assistant uses the clearly labelled offline template provider.

## Backend container

```bash
docker build -f docker/backend.Dockerfile -t health-mirror-backend .                       # CPU, no models
docker build -f docker/backend.Dockerfile --build-arg DEMO_MODELS=1 -t health-mirror-backend:demo .
docker compose up --build                                                                   # + PostgreSQL
docker compose --profile mlops up mlflow                                                    # MLflow UI on :5000
```

Environment variables (see `backend/app/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `MODELS_DIR` | `models/` | Model registry root |
| `DATABASE_URL` | SQLite in `DATA_DIR` | e.g. `postgresql+psycopg://user:pw@host/db` |
| `DATA_DIR` | `data/runtime` | Consented snapshot files |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated frontend origins |
| `INFERENCE_DEVICE` | `auto` | `auto` / `cpu` / `cuda` (GPU with CPU fallback) |
| `INFERENCE_RUNTIME` | `torch` | `onnx` to serve `model.onnx` (run `make onnx` first) |
| `TORCH_THREADS` | `2` | intra-op threads per worker |
| `LLM_PROVIDER` | `auto` | `anthropic` / `offline` / `auto` (anthropic if credentials exist) |
| `LLM_MODEL` | `claude-opus-5-5` | |
| `LLM_EFFORT` | `low` | Claude effort level for chat replies |
| `ANTHROPIC_API_KEY` | – | server-side only |
| `LOG_SENSITIVE_CONTENT` | `false` | never enable in production |
| `LLM_PROVIDER=ollama`, `OLLAMA_MODEL`, `OLLAMA_URL` | `llama3.1`, `http://localhost:11434` | open-weight alternative (structured JSON output via Ollama) |
| `CATALOG_CRAWL_ENABLED` | `true` | kill switch for every retailer request |
| `CATALOG_MIN_INTERVAL_S` | `2.0` | minimum seconds between retailer requests (robots Crawl-delay wins if larger) |
| `CATALOG_STALE_AFTER_HOURS` | `72` | listings older than this are flagged stale |
| `RECOMMENDER_WEIGHTS` | – | JSON overrides for ranking weights, e.g. `{"concern_match": 3}` |
| `DEV_API_TOKEN` | – | **set in deployment**: required (`X-Dev-Token`) for crawl log and refresh endpoints |

## Catalogue refresh

```bash
cd backend
python -m app.recommendations.catalog.refresh --per-category 25     # polite, robots-checked, ~12 min
python -m app.recommendations.catalog.reextract                    # re-run attribute rules on stored products (no network)
python -m app.recommendations.catalog.feed products.jsonl          # or ingest an authorised feed instead
```

Schedule the refresh at most daily (e.g. an Azure Container Apps job or cron) — incremental runs skip pages
whose sitemap `lastmod` hasn't changed. It can also be triggered from Model Lab (needs the dev token).

## Age model

```bash
cd backend
python -m training.datasets.fairface --src ../data/external/fairface --out ../data/age/fairface   # after downloading FairFace (CC BY 4.0)
python -m training.train --model-id apparent_age --manifest ../data/age/fairface/manifest.csv --backbone resnet18 --pretrained \
  --tier experimental --input-size 112 --epochs 6 --split-column ff_split
```

## Azure (example: Container Apps)

```bash
az acr build -r <registry> -f docker/backend.Dockerfile --build-arg DEMO_MODELS=1 -t health-mirror-backend:demo .
az containerapp create -n health-mirror-api -g <rg> --environment <env> \
  --image <registry>.azurecr.io/health-mirror-backend:demo --target-port 8000 --ingress external \
  --cpu 2 --memory 4Gi --min-replicas 1 \
  --secrets anthropic-key=<key> pg-url=<url> \
  --env-vars ANTHROPIC_API_KEY=secretref:anthropic-key DATABASE_URL=secretref:pg-url CORS_ORIGINS=https://<app>.vercel.app
```

Container Apps ingress supports WebSockets and terminates TLS (use `wss://`). Session state is in memory,
so either keep one replica or enable session affinity; for horizontal scale, move `SessionStore` to Redis
(the interface is small: `get_or_create/get/delete`). Mount Azure Files (or switch snapshot storage to Blob)
for `DATA_DIR`. Any container host with WebSocket support (Cloud Run, Fly.io, ECS) works the same way.

GPU: build with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124` on a GPU host and set
`INFERENCE_DEVICE=auto`; the registry falls back to CPU if CUDA is unavailable.

## Frontend on Vercel

* Project root: `frontend/`. Framework preset: Next.js.
* Env: `NEXT_PUBLIC_API_URL=https://<backend-host>` (the WebSocket URL is derived, `https→wss`).
* The MediaPipe WASM files are copied into `public/` at install time and the face model is fetched by
  `scripts/fetch-face-model.mjs`; if the model file is missing the app falls back to Google's hosted copy.
* Camera access requires a secure context (HTTPS or localhost).
