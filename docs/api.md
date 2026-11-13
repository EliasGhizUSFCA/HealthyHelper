# Backend API Reference

Types: `backend/app/schemas/protocol.py` + `backend/app/schemas/catalog.py` ↔ `frontend/lib/protocol.ts` + `frontend/lib/catalog.ts`.

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). All types are defined in
`backend/app/schemas/protocol.py` and mirrored in `frontend/lib/protocol.ts`.

## REST

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/health` | – | `{status, protocol_version, models_loaded, llm_provider}` | Liveness/readiness |
| GET | `/api/models` | – | `ModelInfo[]` | Cached; reflects `models/` on disk at startup or `/api/models/reload` |
| POST | `/api/models/reload` | – | `ModelInfo[]` | Rescan model registry |
| POST | `/api/sessions` | – | `SessionCreated` | Ephemeral in-memory session (no images stored) |
| DELETE | `/api/sessions/{session_id}` | – | `DeletionReport` | Drops in-memory observation history for the session |
| POST | `/api/inference/image` | `ImageInferenceRequest` | `InferenceResult` | Single image + landmarks; server crops regions. `consent_upload` must be true |
| POST | `/api/explain` | `ClientExplain` (without `type` requirement) | `Explanation` | Grad-CAM on one crop |
| POST | `/api/chat` | `ChatRequest` | `ChatResponse` | Grounded assistant |
| POST | `/api/history/snapshots` | `SnapshotCreate` | `SnapshotSummary` | **Stores aligned region crops.** Requires `consent_store_images: true` |
| GET | `/api/history/{history_id}/snapshots` | – | `SnapshotSummary[]` | Oldest first |
| GET | `/api/history/{history_id}/compare?before=ID&after=ID` | – | `ComparisonResult` | |
| DELETE | `/api/history/{history_id}` | – | `DeletionReport` | Deletes every snapshot, image file and DB row for that history |
| GET | `/api/privacy` | – | retention policy JSON | |
| POST | `/api/dataset/consent` · `/api/dataset/samples` … | see `app/api/dataset.py` | | consented training-data collection & labelling |
| GET | `/api/catalog/status` | – | `CatalogStatus` | product counts, stale counts, policy, sitemap cache, last refresh |
| GET | `/api/catalog/categories` | – | categories | our taxonomy ↔ retailer paths |
| GET | `/api/catalog/products?category&mode&brand&q` | – | `CatalogProduct[]` | local catalogue only |
| GET | `/api/catalog/products/{id}` | – | `{product, price_history}` | |
| GET | `/api/catalog/crawl-log` | – | `{entries, summary}` | dev token (`X-Dev-Token`) when `DEV_API_TOKEN` is set |
| POST | `/api/catalog/refresh?per_category&categories` | – | `{started}` | background job; dev token |
| GET | `/api/catalog/refresh/progress` | – | progress + last result | |
| POST | `/api/recommendations` | `RecommendationRequest` | `RecommendationResponse` | ranking + grounded explanations + trace + telemetry events |

## WebSocket `/ws/inference`

1. Client connects and sends `ClientHello`. `consent_upload_crops` must be `true`; otherwise the
   server replies `ServerError{code:"consent_required"}` and drops every frame with
   `FrameDropped{reason:"no_consent"}`.
2. Server replies `ServerHelloAck` (session id, model list, queue size).
3. Client sends `ClientFrame` messages at its **inference sampling rate** (not the camera rate),
   carrying small JPEG region crops plus the client-side telemetry events for that frame.
4. Server responds with `InferenceResult` per processed frame, or `FrameDropped` when a newer
   frame superseded a queued one (latest-frame-wins bounded queue, size 1).
5. `ClientExplain` → `Explanation` (computed off the hot path in a worker thread).
6. `ClientPing` → `ServerPong`. Server also pushes `ServerMetrics` every ~2 s.

Flow control: the client keeps at most **one** frame in flight (it waits for a result or
`frame_dropped` before sending another, with a timeout). The server additionally holds at most
one pending frame per connection, so stale work never accumulates.

Reconnection: the client reconnects with exponential backoff (0.5 s → 8 s, jittered) and resends
`ClientHello` with its previous `session_id` so aggregated observations survive.
