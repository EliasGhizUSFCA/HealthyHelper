"""REST endpoints."""

from __future__ import annotations

import asyncio
import uuid

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Request

from app import __version__
from app.cv import quality as q
from app.cv.alignment import align_face, lighting_stats, region_difference
from app.cv.imaging import ImageDecodeError, colorize_heatmap, decode_data_url, encode_png_data_url
from app.cv.regions import crop_regions, validate_landmarks
from app.inference.aggregator import ObservationAggregator
from app.schemas.protocol import (
    PROTOCOL_VERSION,
    ChatRequest,
    ChatResponse,
    ClientExplain,
    ClientFrame,
    ComparisonResult,
    DeletionReport,
    Explanation,
    ImageInferenceRequest,
    ImageQuality,
    InferenceResult,
    ModelInfo,
    Observation,
    QualityMetrics,
    QualityStatus,
    RegionComparison,
    RegionCrop,
    SessionCreated,
    SnapshotCreate,
    SnapshotSummary,
)
from app.services import Services
from app.sessions import SessionState
from app.timeutil import now_ms, perf_ms

router = APIRouter(prefix="/api")
SNAPSHOT_REGION_SIZE = 128
LIGHTING_COMPARABLE_DELTA_L = 8.0

RETENTION_POLICY = {
    "camera_frames": "Processed in the browser. Never recorded or persisted.",
    "region_crops": "Sent to the server only after explicit opt-in, processed in memory, discarded after inference. Never written to disk or logs.",
    "observations": "Derived scores are held in server memory for the live session (TTL-evicted) and deleted with DELETE /api/sessions/{id}.",
    "snapshots": "Stored ONLY with explicit consent for longitudinal comparison: aligned region crops + derived metadata, until you delete them (DELETE /api/history/{history_id}).",
    "training_use": "Images from the Mirror, Model Lab and snapshots are never used for training. Only crops captured on the Collect page, under a separate research consent, are stored for training; withdrawing consent deletes all of them (DELETE /api/dataset/contributors/{id}).",
    "training_data": "Collected crops and labels are stored on the machine running the backend (DATA_DIR/dataset), are never uploaded elsewhere by this app, and are excluded from git.",
    "chat": "Conversation text is not logged by default (LOG_SENSITIVE_CONTENT=false).",
    "compliance": "This is a portfolio/education project. It has not been assessed for HIPAA or medical-device regulations and makes no such claims.",
}


def svc(request: Request) -> Services:
    return request.app.state.services


@router.get("/health")
def health(request: Request) -> dict:
    s = svc(request)
    return {"status": "ok", "version": __version__, "protocol_version": PROTOCOL_VERSION,
            "models_loaded": [m.card.model_id for m in s.registry.loaded()],
            "llm_provider": s.assistant.provider.name, "llm_model": getattr(s.assistant.provider, "model", "")}


@router.get("/models", response_model=list[ModelInfo])
def models(request: Request) -> list[ModelInfo]:
    return svc(request).registry.model_infos()


@router.post("/models/reload", response_model=list[ModelInfo])
def reload_models(request: Request) -> list[ModelInfo]:
    s = svc(request)
    s.registry.load_all()
    return s.registry.model_infos()


@router.get("/privacy")
def privacy() -> dict:
    return RETENTION_POLICY


@router.post("/sessions", response_model=SessionCreated)
def create_session(request: Request) -> SessionCreated:
    st = svc(request).sessions.get_or_create(None)
    return SessionCreated(session_id=st.session_id, created_at=st.created_at * 1000)


@router.delete("/sessions/{session_id}", response_model=DeletionReport)
def delete_session(session_id: str, request: Request) -> DeletionReport:
    return DeletionReport(deleted_snapshots=0, deleted_files=0, deleted_session_state=svc(request).sessions.delete(session_id))


def _frame_quality(image: np.ndarray, lm: np.ndarray) -> ImageQuality:
    h, w = image.shape[:2]
    x0, y0 = (lm[:, :2].min(0) * [w, h]).astype(int)
    x1, y1 = (lm[:, :2].max(0) * [w, h]).astype(int)
    face = image[max(0, y0):max(y0 + 1, y1), max(0, x0):max(x0 + 1, x1)]
    cq = q.assess_crop(face if face.size else image)
    area = max(0, (x1 - x0) * (y1 - y0)) / float(w * h)
    issues = list(cq.issues)
    if area < 0.04:
        issues.append("face_too_small")
    status = cq.status if not (area < 0.04 and cq.status == QualityStatus.acceptable.value) else QualityStatus.poor
    return ImageQuality(status=status, issues=issues, metrics=QualityMetrics(**{**cq.metrics.model_dump(), "face_area_fraction": round(area, 4), "face_count": 1}))


def _decode_or_422(data: str, max_bytes: int) -> np.ndarray:
    try:
        return decode_data_url(data, max_bytes)
    except ImageDecodeError as exc:
        raise HTTPException(422, f"image: {exc}") from exc


def _landmarks_or_422(lm) -> np.ndarray:
    try:
        return validate_landmarks(lm)
    except ValueError as exc:
        raise HTTPException(422, f"landmarks: {exc}") from exc


@router.post("/inference/image", response_model=InferenceResult)
async def infer_image(body: ImageInferenceRequest, request: Request) -> InferenceResult:
    s = svc(request)
    if not body.consent_upload:
        raise HTTPException(403, "consent_upload must be true to send an image")
    received = now_ms()
    t0 = perf_ms()
    image = _decode_or_422(body.image_b64, s.settings.max_image_bytes)
    lm = _landmarks_or_422(body.landmarks)
    crops = crop_regions(image, lm)
    frame = ClientFrame(
        frame_id=0, captured_at=received, quality=_frame_quality(image, lm), options=body.options,
        regions=[RegionCrop(region=n, bbox=bb, image_b64=encode_png_data_url(c)) for n, (c, bb) in crops.items()],
    )
    state = s.sessions.get_or_create(body.session_id)
    return await asyncio.to_thread(s.engine.process_frame, state, frame, received, perf_ms() - t0)


@router.post("/explain", response_model=Explanation)
async def explain(body: ClientExplain, request: Request) -> Explanation:
    try:
        return await asyncio.to_thread(svc(request).engine.explain, body)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (RuntimeError, ImageDecodeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request) -> ChatResponse:
    s = svc(request)
    if body.messages[-1].role != "user":
        raise HTTPException(422, "last message must be from the user")
    st = s.sessions.get(body.session_id)
    server_obs = st.latest_observations if st else None
    return await asyncio.to_thread(s.assistant.respond, body, server_obs)


# ------------------------------------------------------------------ history
def _summary(row: dict) -> SnapshotSummary:
    return SnapshotSummary(snapshot_id=row["snapshot_id"], history_id=row["history_id"], created_at=row["created_at"],
                           quality=ImageQuality.model_validate(row["quality"]), lighting=row["lighting"],
                           observations=[Observation.model_validate(o) for o in row["observations"]], regions=row["regions"])


@router.post("/history/snapshots", response_model=SnapshotSummary)
async def create_snapshot(body: SnapshotCreate, request: Request) -> SnapshotSummary:
    s = svc(request)
    if not body.consent_store_images:
        raise HTTPException(403, "explicit consent (consent_store_images=true) is required to store images")
    image = _decode_or_422(body.image_b64, s.settings.max_image_bytes)
    lm = _landmarks_or_422(body.landmarks)

    def work() -> dict:
        aligned, _, aligned_lm = align_face(image, lm)
        crops = crop_regions(aligned, aligned_lm)
        region_imgs = {n: cv2.resize(c, (SNAPSHOT_REGION_SIZE, SNAPSHOT_REGION_SIZE), interpolation=cv2.INTER_AREA) for n, (c, _) in crops.items()}
        quality = _frame_quality(image, lm)
        frame = ClientFrame(frame_id=0, captured_at=now_ms(), quality=quality,
                            regions=[RegionCrop(region=n, bbox=bb, image_b64=encode_png_data_url(c)) for n, (c, bb) in crops.items()])
        st = SessionState(session_id=uuid.uuid4().hex, aggregator=ObservationAggregator(window=1, min_frames=1))
        res = s.engine.process_frame(st, frame, now_ms(), 0.0)
        return s.history.save(body.history_id, body.consent_text_version, res.image_quality.model_dump(), lighting_stats(aligned),
                              [o.model_dump() for o in res.observations.observations], region_imgs)

    try:
        row = await asyncio.to_thread(work)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _summary(row)


@router.get("/history/{history_id}/snapshots", response_model=list[SnapshotSummary])
def list_snapshots(history_id: str, request: Request) -> list[SnapshotSummary]:
    try:
        return [_summary(r) for r in svc(request).history.list(history_id)]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/history/{history_id}/compare", response_model=ComparisonResult)
def compare(history_id: str, before: str, after: str, request: Request) -> ComparisonResult:
    h = svc(request).history
    try:
        b, a = h.get(history_id, before), h.get(history_id, after)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not b or not a:
        raise HTTPException(404, "snapshot not found")
    sb, sa = _summary(b), _summary(a)
    dl = float(sa.lighting.get("mean_L", 0) - sb.lighting.get("mean_L", 0))
    out: list[RegionComparison] = []
    for region in sorted(set(sb.regions) & set(sa.regions)):
        ib, ia = h.region_image(history_id, before, region), h.region_image(history_id, after, region)
        if ib is None or ia is None:
            continue
        d, mad = region_difference(ib, ia)
        ob = next((o for o in sb.observations if o.region == region), None)
        oa = next((o for o in sa.observations if o.region == region), None)
        out.append(RegionComparison(region=region, before_b64=encode_png_data_url(ib), after_b64=encode_png_data_url(ia),
                                    diff_b64=encode_png_data_url(colorize_heatmap(np.clip(d * 4, 0, 1))), mean_abs_diff=round(mad, 4),
                                    lighting_delta=round(dl, 2), lighting_comparable=abs(dl) < LIGHTING_COMPARABLE_DELTA_L,
                                    before_observation=ob, after_observation=oa))
    caveats = [
        "Visual differences can come from lighting, camera, distance, expression or makeup. They are not evidence of medical improvement or deterioration.",
        "Difference maps are lighting-normalised pixel differences after face alignment; small misalignments also appear as differences.",
    ]
    if abs(dl) >= LIGHTING_COMPARABLE_DELTA_L:
        caveats.insert(0, f"Lighting differs substantially between snapshots (ΔL* = {dl:.1f}); comparisons are unreliable.")
    if any(o.model_tier == "demo" for o in sa.observations + sb.observations):
        caveats.append("Observations come from demonstration models trained on synthetic data.")
    return ComparisonResult(before=sb, after=sa, regions=out, caveats=caveats)


@router.delete("/history/{history_id}", response_model=DeletionReport)
def delete_history(history_id: str, request: Request) -> DeletionReport:
    try:
        rows, files = svc(request).history.delete_history(history_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return DeletionReport(deleted_snapshots=rows, deleted_files=files, deleted_session_state=False)
