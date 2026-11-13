"""Consented data collection + labelling endpoints (/api/dataset)."""

from __future__ import annotations

import base64

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.cv.imaging import ImageDecodeError, decode_data_url
from app.inference.catalog import CATALOG
from app.schemas.protocol import DatasetCapture, DatasetConsent, DatasetLabel, DatasetSample, DeletionReport

router = APIRouter(prefix="/api/dataset")
MAX_CROP_SIDE = 512


def store(request: Request):
    return request.app.state.services.dataset


def _sample(r: dict) -> DatasetSample:
    return DatasetSample(sample_id=r["sample_id"], contributor_id=r["contributor_id"], session_id=r["session_id"], created_at=r["created_at"],
                         region=r["region"], width=r["width"], height=r["height"], quality=r["quality"], metadata=r["meta"] or {},
                         labels=[DatasetLabel(**lb) for lb in r["labels"]])


@router.post("/consent")
def consent(body: DatasetConsent, request: Request) -> dict:
    if not body.consent_research:
        raise HTTPException(403, "explicit research consent is required to contribute training data")
    try:
        return store(request).register(body.contributor_id, body.consent_text_version)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/samples", response_model=list[DatasetSample])
def add_samples(body: DatasetCapture, request: Request) -> list[DatasetSample]:
    ds = store(request)
    try:
        if not ds.has_consent(body.contributor_id):
            raise HTTPException(403, "no active research consent for this contributor")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    out = []
    for crop in body.crops:
        try:
            img = decode_data_url(crop.image_b64, request.app.state.services.settings.max_crop_bytes * 2)
        except ImageDecodeError as exc:
            raise HTTPException(422, f"{crop.region}: {exc}") from exc
        h, w = img.shape[:2]
        if max(h, w) > MAX_CROP_SIDE or min(h, w) < 16:
            raise HTTPException(422, f"{crop.region}: crop size {w}x{h} outside 16..{MAX_CROP_SIDE}px")
        payload = crop.image_b64.split(",", 1)[1] if crop.image_b64.startswith("data:") else crop.image_b64
        raw = base64.b64decode(payload)
        if not raw.startswith(b"\xff\xd8"):  # store JPEG only (what the browser sends)
            import cv2

            raw = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
        meta = {k[:32]: v[:64] for k, v in list(body.metadata.items())[:10]}
        out.append(_sample({**ds.add_sample(body.contributor_id, body.session_id, crop.region, raw, w, h, body.quality.model_dump(), meta), "labels": []}))
    return out


@router.get("/samples", response_model=list[DatasetSample])
def list_samples(request: Request, model_id: str | None = None, contributor_id: str | None = None, limit: int = 500) -> list[DatasetSample]:
    if model_id and model_id not in CATALOG:
        raise HTTPException(404, "unknown model_id")
    regions = list(CATALOG[model_id].regions) if model_id else None
    return [_sample(r) for r in store(request).list_samples(regions, contributor_id, min(limit, 5000))]


@router.get("/samples/{sample_id}/image")
def sample_image(sample_id: str, request: Request):
    try:
        p = store(request).image_path(sample_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.put("/samples/{sample_id}/labels")
def put_label(sample_id: str, body: DatasetLabel, request: Request) -> dict:
    try:
        store(request).set_label(sample_id, body.model_id, body.annotator_id, body.label)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@router.delete("/samples/{sample_id}")
def delete_sample(sample_id: str, request: Request) -> dict:
    return {"deleted": store(request).delete_sample(sample_id)}


@router.delete("/contributors/{contributor_id}", response_model=DeletionReport)
def withdraw(contributor_id: str, request: Request) -> DeletionReport:
    try:
        n, files = store(request).withdraw(contributor_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return DeletionReport(deleted_snapshots=n, deleted_files=files, deleted_session_state=False)


@router.get("/stats")
def stats(request: Request) -> list[dict]:
    return [store(request).model_stats(m) for m in CATALOG]


@router.post("/export/{model_id}")
def export(model_id: str, request: Request) -> dict:
    if model_id not in CATALOG:
        raise HTTPException(404, "unknown model_id")
    card = store(request).export_manifest(model_id)
    card["train_command"] = (
        f"cd backend && python -m training.train --model-id {model_id} --manifest {card['manifest']} "
        f"--backbone resnet18 --pretrained --tier experimental --epochs 20"
        + (" --group-by session_id" if card["subjects"] < 3 else "")
    )
    return card
