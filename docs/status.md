# Implementation status by phase

Legend: ✅ implemented and verified by automated tests or measured runs · 🟡 implemented, verified manually
or partially · ⛔ not done (see "Open items").

## Phase 1 — Foundation, webcam, landmarks, crops, overlays
* ✅ Repository structure, typed protocol (Pydantic ↔ TS ↔ JSON Schema, contract-tested).
* ✅ Shared region geometry (`shared/regions.json`), server-side crop/clamp tests, face alignment tests.
* 🟡 Browser camera + MediaPipe landmarks + overlays: built and unit-tested (geometry, quality, camera
  errors); exercised in headless Chromium with a fake camera (no real face available in CI/sandbox), so
  live landmark tracking on a real face must be checked on a device with a webcam.

## Phase 2 — Model Lab with real telemetry
* ✅ Telemetry schema and server events with per-origin sequence numbers, ordering tests.
* ✅ WebSocket with consent gate, latest-frame-wins backpressure, metrics, reconnect (tests).
* ✅ Six-panel Model Lab driven by live data; verified end-to-end in headless Chromium using the labelled
  synthetic-input source (screenshots in `docs/images/`).
* Note: the Lab's synthetic generator (`frontend/lib/synthetic.ts`) is independent of the training generator,
  so DEMO models often disagree with the "simulated feature intensity" slider — a small, visible example of
  domain shift, and another reason demo outputs are never presented as observations.

## Phase 3 — Trainable PyTorch pipeline and real inference
* ✅ Manifest loader, grouped split + leakage check, augmentation, transfer learning, early stopping,
  checkpoints, temperature scaling, versioned artifacts, registry, batched inference.
* ✅ Four DEMO models trained (synthetic data); real weights serve live predictions.
* ✅ Real-data path: consented collection (`/collect`), blind multi-annotator labelling with Cohen's κ
  (`/label`), manifest export, `make train-real` → `experimental` tier; `validated` tier behind an enforced
  gate. Verified end-to-end in headless Chromium + `make train-real`, using stand-in crops (the sandbox has
  no face), which were then deleted via the withdrawal endpoint.
* ✅ Eight features: lip dryness, eye redness, nasal redness, skin flaking, spots/blemishes, skin redness,
  skin shine, under-eye darkness; ten regions (added chin and both under-eyes).
* ⛔ No model has been trained on real faces yet — that needs real contributors and labels (docs/datasets.md).
* ⛔ New regions (chin, under-eyes) use landmark indices chosen from the MediaPipe topology but not yet
  checked visually on a real face; check the boxes in Model Lab (P1, "Under-eye" and "Skin" layers).

## Phase 4 — Explainability, confidence visualisation, experiment tracking
* ✅ Grad-CAM (tested), async off the hot path; MLflow tracking (SQLite) with JSON fallback.
* ✅ Evaluation reports: P/R/F1, confusion, FPR/FNR, ECE/Brier/NLL, reliability, selective metrics,
  slices, perturbations, latency.

## Phase 5 — LLM assistant
* ✅ Safety triage, evidence selection, retrieval, structured generation, validation, retry, fallback, trace.
* 🟡 Anthropic provider verified against a mocked SDK client only — no API credentials were available in
  the build environment. The offline template provider was used for end-to-end runs.

## Phase 6 — Longitudinal comparison, testing, optimisation, deployment
* ✅ Consented snapshots, alignment, lighting checks, diff maps, comparison API, deletion (tests).
* ✅ ONNX export with parity check; measured torch vs ONNX latency (docs/performance.md).
* ✅ Dockerfile, compose (PostgreSQL, MLflow UI), CI workflow.
* 🟡 Docker image and CI workflow written but not executed in this sandbox (no Docker daemon / GitHub runner).

## Open items
1. Real data collection + annotation protocol, then train a `validated`-tier model (docs/datasets.md).
2. Clinical review of `reviewed_responses.json` and the educational knowledge base.
3. Live test of the Anthropic provider with credentials; prompt/validator tuning on real conversations
   (build an eval set of conversations with expected routes and validator outcomes).
4. Horizontal scaling: move in-memory `SessionStore` to Redis; Blob storage for snapshots.
5. Optional server-side landmarking for clients without WASM support.
6. Triage is keyword-based; a reviewed classifier would improve recall on paraphrases.
7. A committed Playwright E2E suite (the E2E checks so far were run as ad-hoc scripts).
