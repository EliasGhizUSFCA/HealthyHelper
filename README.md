# AI Health Mirror

An observable, extensible computer-vision + LLM system that looks at a webcam image and gives
**wellness-education feedback about visible facial features** — lip dryness, eye-white redness, redness
around the nose, skin flaking, acne-like spots/blemishes, irritated-looking (red) skin, skin shine and
darker-looking skin under the eyes — while being explicit about uncertainty.

> **Not a medical device.** It describes visible appearance in an image, never conditions. A camera cannot
> establish dehydration, infection, acne or any other condition — it can only say "spots are visible".
> `make demo-models` produces **DEMO-tier models trained only on synthetic images**; to get models trained on
> real faces, collect and label your own consented data in the app (`/collect`, `/label`) and run
> `make train-real` — those models are marked **experimental** until they pass a validation gate.

Two interfaces:

* **Health Mirror** (`/mirror`) — approachable, accessible UI: consented camera, positioning guidance,
  observation cards with plain-language uncertainty, symptom entry, grounded chat assistant, optional
  consented snapshots for side-by-side comparison (`/history`).
* **Collect & Label** (`/collect`, `/label`) — consented real-data collection (separate research consent,
  withdrawable) and a blind, keyboard-driven labelling tool with inter-annotator agreement and one-click
  export to a training manifest.
* **Model Lab** (`/lab`) — a dark, resizable six-panel developer dashboard driven entirely by live telemetry:
  detection overlays, model-input inspector (raw crop vs. de-normalised tensor), live probabilities with
  threshold control, Grad-CAM explainability, pipeline/performance monitor and LLM context + agent trace.

![Model Lab running on the labelled synthetic-input source: raw crop vs. model tensor, live DEMO-model
probabilities, Grad-CAM overlay, pipeline timeline and the structured observations sent to the LLM](docs/images/model-lab.png)

*Model Lab driven by the labelled **synthetic test input** source (no face/webcam in the build sandbox). Every
number on screen is a real measurement or a real model output; the models are DEMO tier.*

## Quick start

```bash
make setup          # CPU PyTorch, backend dev deps, frontend deps (+ MediaPipe WASM copy)
make demo-models    # synthetic datasets + 8 DEMO models (optional; ~20 min on 4 CPU cores)
make backend        # FastAPI on :8000
make frontend       # Next.js on :3000
make test           # backend pytest + frontend vitest + typecheck
```

Real data: open `/collect`, give consent, capture under varied conditions (ideally several people), label on
`/label` (ideally two annotators), then `make train-real MODEL=lip_dryness` (`GROUP=session_id` if fewer than
three people). Details and caveats: [docs/datasets.md](docs/datasets.md#collecting-and-training-on-real-data-built-into-the-app).

No GPU, LLM key or trained model is required to run: missing models report **unavailable** (no scores
are shown), and without `ANTHROPIC_API_KEY` the assistant uses a clearly labelled deterministic template
provider. Docker: `docker compose up --build` (backend + PostgreSQL). See [docs/deployment.md](docs/deployment.md).

## Architecture

```
Browser (camera rate)                                Backend (inference rate)
──────────────────────                               ─────────────────────────
getUserMedia → MediaPipe Face Landmarker (WASM)
  → client quality check → region crops ──(opt-in)──▶ /ws/inference  (latest-frame-wins, 1 slot)
  → overlays / telemetry store                          → crop quality gate
                                                        → shared preprocessing (= training code)
     ◀── InferenceResult · FrameDropped · Metrics ──    → batched CNN inference (torch | ONNX)
                                                        → accept / inconclusive / abstain
                                                        → temporal aggregation → StructuredObservations
     ── /api/chat ──────────────────────────────────▶   → safety triage → retrieval → Claude (structured)
     ◀── reply + AgentTrace ────────────────────────    → validation (+retry) → grounded fallback
```

Full diagram and design rationale: [docs/architecture.md](docs/architecture.md). Wire protocol:
[docs/api.md](docs/api.md), `backend/app/schemas/protocol.py` ↔ `frontend/lib/protocol.ts`
(contract-tested; JSON Schema in `shared/schemas/`).

Frontend core: one `AnalysisEngine` (`frontend/lib/engine.ts`) owns the camera, MediaPipe (GPU delegate with
CPU fallback), the WebSocket client and the telemetry store; Mirror and Lab are two views over it. Landmarks
run in a `requestAnimationFrame` loop; an independent sampler (0.5–10 Hz) crops the current frame and sends it
only when no frame is in flight. Server timestamps are aligned to the client clock with an offset estimated
from ping/pong, so the execution timeline is coherent across machines.

### Key technical decisions

| Decision | Why |
|---|---|
| Landmarks in the browser | Camera-rate tracking with no round-trip; raw frames never leave the device by default. |
| Only small region crops are uploaded, after explicit opt-in | Privacy and bandwidth; the full frame is only sent for an explicitly consented snapshot. |
| Inference sampler decoupled from rendering, 1 frame in flight; server mailbox drops stale frames | Smooth camera, bounded latency/memory, no accumulating queue. Camera FPS, landmark FPS and inference FPS are measured and shown separately. |
| Single `regions.json` for browser crops, server crops and alignment | Crops are identical wherever they are computed (tested). |
| Training imports the serving `preprocess()` | Train/serve parity by construction (tested). |
| Binary classes + calibrated abstention rather than a learned "inconclusive" class | Labels describe what annotators see; uncertainty is handled by temperature-scaled scores, thresholds and quality gates that are tunable without retraining. |
| Median over the last N usable frames before anything is "observed" | Single frames are noisy; Model Lab still shows raw per-frame output. |
| LLM receives only structured observations | It cannot invent visual findings; every claim is validated against accepted evidence. |
| Deterministic safety router before the LLM | Urgent complaints get a predetermined, reviewable response instead of a speculative answer. |

## Computer-vision & ML pipeline

`backend/training/` — `python -m training.train --model-id <id> --manifest <csv> --backbone resnet18 --pretrained`

1. **Data**: manifest CSV (`path,label,subject_id,…metadata`). **Subject-grouped** train/val/test split with a
   leakage assertion (several images per person never straddle splits).
2. **Augmentation** (webcam-realistic): exposure/contrast, white balance, defocus/motion blur, sensor noise,
   JPEG artefacts, rotation/scale jitter, flips; small hue shifts only (redness is colour-defined).
3. **Model**: torchvision transfer learning — ResNet-18/34, EfficientNet-B0, MobileNetV3-S (+ tiny CNN for tests).
4. **Training**: AdamW, cosine LR, label smoothing, early stopping on validation loss, best checkpoint.
5. **Calibration**: temperature scaling on the validation split.
6. **Evaluation** (`backend/evaluation/`): precision/recall/F1, confusion matrix, FPR/FNR, ECE/Brier/NLL with
   reliability bins, selective accuracy vs. coverage at the serving threshold, per-slice metrics (any
   metadata column, e.g. skin-tone group, lighting, blur, pose), controlled perturbations, latency p50/p95.
7. **Artifacts**: `models/<id>/<version>/{weights.pt, model.onnx, model_card.json, eval_report.{json,md}}`;
   tracked in MLflow (SQLite backend; JSON fallback). `make onnx` exports with a numerical parity check.

### Model tiers

| tier | trained on | how it is shown |
|---|---|---|
| `demo` | synthetic images only (`make demo-models`) | "Demonstration model" banner; assistant must say so |
| `experimental` | real consented crops from `/collect`, any size (`make train-real`) | "Experimental" badge; assistant must say it's not validated |
| `validated` | real data that passes the gate: ≥ 15 people / ≥ 100 images / ≥ 30 per class in the test split, person-grouped split, annotator κ ≥ 0.6 | normal display — still not clinically validated |

`training.train` refuses mismatches (e.g. `demo` on real data, `validated` without passing the gate) and
records contributors, agreement and split grouping in the model card.

### What is actually trained

There is no suitable public dataset with webcam-quality labels for these features (see
[docs/datasets.md](docs/datasets.md)). To exercise the whole pipeline honestly, `training/synthetic.py`
procedurally generates cartoon-like region patches across six skin-tone groups with per-subject appearance,
varied capture conditions and 3 % label noise. Eight ResNet-18 (ImageNet-pretrained) **DEMO** models were
trained on it. Held-out *synthetic* test results (from the generated model cards in
[docs/model-cards/](docs/model-cards/)):

| model | regions | test n | accuracy | macro-F1 | ECE |
|---|---|---|---|---|---|
| lip_dryness | lips | 200 | 0.945 | 0.945 | 0.029 |
| eye_redness | left/right eye | 200 | 0.930 | 0.930 | 0.052 |
| nasal_redness | nose | 200 | 0.955 | 0.955 | 0.029 |
| skin_flaking | forehead, cheeks | 200 | 0.900 | 0.900 | 0.035 |
| skin_blemishes | forehead, cheeks, chin | 200 | 0.930 | 0.930 | 0.029 |
| skin_redness | forehead, cheeks, chin | 200 | 0.950 | 0.950 | 0.032 |
| skin_shine | forehead, cheeks, chin | 200 | 0.920 | 0.920 | 0.039 |
| undereye_darkness | under left/right eye | 200 | 0.950 | 0.950 | 0.045 |

These numbers only show that the networks separate the synthetic patterns; **they say nothing about
real-world performance, fairness, or clinical value.** Weights are not committed (`make demo-models`
regenerates them deterministically from seeds).

## LLM assistant

`backend/app/llm/agent.py` is a code-orchestrated workflow, not an open-ended agent:

1. **Safety triage** (regex router, negation-aware) → urgent route returns a predetermined response from
   `app/safety/reviewed_responses.json` (marked *pending clinical review*) and skips the LLM.
2. **Evidence selection** — only `accepted` aggregated observations count as evidence; demo status and
   image quality travel with them.
3. **Sufficiency check** → `insufficient_evidence` route forbids describing any visual feature.
4. **Retrieval** from a small curated knowledge base (project-authored, not clinically reviewed).
5. **Generation** — Claude (`claude-opus-5-5`, effort `low`) via the Anthropic SDK with a Pydantic
   structured-output schema (`AssistantReply`), cached static system prompt, server-side refusal fallback.
6. **Validation** — no diagnostic language, no health scores, references ⊆ accepted evidence, visual
   claims grounded per region, demo disclosure, professional referral on diagnosis requests. One retry with
   the failures as feedback, then a grounded template fallback.

Model Lab shows the structured observations, selected evidence, redacted context preview, retrieval hits,
per-step timings, validation results, token usage and the final answer — not hidden reasoning.

## Performance (measured, this sandbox only)

4-vCPU container, CPU only, four ResNet-18 models at 128 px, `scripts/bench_ws.py` over localhost:
7 regions per frame → **p50 ≈ 77 ms round-trip with PyTorch, ≈ 64–68 ms with ONNX Runtime**; a single
region ≈ 14 ms. Details, per-stage timings and caveats (e.g. ONNX thread oversubscription) in
[docs/performance.md](docs/performance.md). Browser-side FPS/latency are measured live in Model Lab.

## Privacy & safety

Camera only on explicit click with a visible active indicator; nothing recorded; crops uploaded only after
opt-in and never persisted; snapshots only with separate consent and fully deletable; Mirror/Lab/snapshot
images never used for training — only Collect-page crops under a separate, withdrawable research consent;
chat not logged by default; secrets server-side. No HIPAA or medical-device claims.
See [docs/privacy-and-safety.md](docs/privacy-and-safety.md).

## Testing

* **Backend (pytest, 78 tests)**: crop alignment & clamping, face alignment, preprocessing parity, schema
  contract (Pydantic ↔ TS ↔ JSON Schema), classifier inference, inconclusive/abstain handling, Grad-CAM,
  ONNX parity, telemetry ordering, WebSocket consent/backpressure/reconnection/explain, safety routing,
  validator, agent retry/fallback, Anthropic provider request shape (mocked), consent + deletion, log
  hygiene, consented data collection/labelling/withdrawal, κ + consensus, tier and validation-gate enforcement, grouped-split leakage, metrics/calibration, end-to-end train → registry → inference, and an
  integration test image → crops → models → observations → grounded chat.
* **Frontend (vitest, 68 tests)**: region geometry (incl. a reference case shared with the backend test so
  browser and server crops are pinned to identical numbers), letterbox overlay transform, quality heuristics,
  camera permission/error mapping, WebSocket reconnect/backoff/session resume, telemetry ordering and bounds,
  `regions.json` copy in sync with `shared/`.
* **End-to-end (headless Chromium, manual script)**: Lab with synthetic input → real inference results in all
  six panels, Grad-CAM, Lab chat + agent trace; Mirror with a fake camera → active indicator, stop, urgent
  safety response; history compare/delete against the live API.
* CI: `.github/workflows/ci.yml` (lint, contract check, tests, training smoke, Next build, Docker build).

## Repository layout

```
backend/app/{api,cv,inference,llm,safety,schemas,storage,telemetry}   FastAPI service
backend/training/  backend/evaluation/  backend/tests/                ML pipeline + tests
frontend/app/{mirror,lab,history,privacy}                             Next.js routes
frontend/components/{CameraView,FaceOverlay,ModelLab,HeatmapViewer,PredictionCharts,PipelineTrace,ChatAssistant,Mirror,History}
frontend/lib/{engine,landmarker,regions,quality,crops,ws,telemetry,store,protocol}.ts   camera/MediaPipe/WS/telemetry core
shared/regions.json  shared/schemas/                                  cross-language contracts
models/  (generated, git-ignored)    scripts/    docker/    docs/
```

## Limitations & unfinished work

See [docs/status.md](docs/status.md) for the per-phase status, what was verified and what remains.
