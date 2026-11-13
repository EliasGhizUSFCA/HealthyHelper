"""Consented data collection → labelling → export → training (experimental tier) → gate."""

import json

import numpy as np
import pytest

from app.storage.dataset import cohen_kappa, consensus
from tests.conftest import data_url


def crop(positive: bool, seed: int) -> str:
    rng = np.random.default_rng(seed)
    img = np.full((96, 96, 3), (200, 120, 120) if positive else (150, 150, 150), np.float32) + rng.normal(0, 18, (96, 96, 3))
    return data_url(np.clip(img, 0, 255).astype(np.uint8))


def capture(client, cid, session, positive, seed, region="lips"):
    r = client.post("/api/dataset/samples", json={
        "contributor_id": cid, "session_id": session, "quality": {"status": "acceptable", "issues": [], "metrics": {}},
        "metadata": {"lighting": "indoor", "device": "test-cam"}, "crops": [{"region": region, "image_b64": crop(positive, seed)}]})
    assert r.status_code == 200, r.text
    return r.json()[0]["sample_id"]


def test_consensus_and_kappa():
    assert consensus(["positive", "positive", "negative"]) == "positive"
    assert consensus(["positive", "negative"]) is None
    assert consensus(["cannot_judge", "cannot_judge", "positive"]) is None
    assert consensus([]) is None
    assert cohen_kappa(["p", "n", "p", "n"], ["p", "n", "p", "n"]) == 1.0
    assert cohen_kappa(["p", "p", "n", "n"], ["p", "n", "p", "n"]) == pytest.approx(0.0)


def test_collection_requires_research_consent(client):
    cid = "contrib-0001"
    r = client.post("/api/dataset/samples", json={"contributor_id": cid, "session_id": "sess-1", "quality": {"status": "acceptable"},
                                                  "crops": [{"region": "lips", "image_b64": crop(True, 0)}]})
    assert r.status_code == 403
    assert client.post("/api/dataset/consent", json={"contributor_id": cid, "consent_research": False, "consent_text_version": "r1"}).status_code == 403
    assert client.post("/api/dataset/consent", json={"contributor_id": cid, "consent_research": True, "consent_text_version": "r1"}).status_code == 200
    sid = capture(client, cid, "sess-1", True, 1)
    assert client.get(f"/api/dataset/samples/{sid}/image").headers["content-type"] == "image/jpeg"


def test_label_validation(client):
    cid = "contrib-0002"
    client.post("/api/dataset/consent", json={"contributor_id": cid, "consent_research": True, "consent_text_version": "r1"})
    sid = capture(client, cid, "sess-1", True, 2)
    assert client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "eye_redness", "annotator_id": "ann-1", "label": "positive"}).status_code == 422
    assert client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "lip_dryness", "annotator_id": "ann-1", "label": "maybe"}).status_code == 422
    assert client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "lip_dryness", "annotator_id": "ann-1", "label": "positive"}).status_code == 200
    # relabel replaces, not duplicates
    client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "lip_dryness", "annotator_id": "ann-1", "label": "negative"})
    (s,) = [x for x in client.get("/api/dataset/samples", params={"model_id": "lip_dryness"}).json() if x["sample_id"] == sid]
    assert s["labels"] == [{"model_id": "lip_dryness", "annotator_id": "ann-1", "label": "negative"}]


def test_export_train_experimental_gate_and_withdraw(client, services, tmp_path):
    rng = np.random.default_rng(0)
    ids = []
    for p in range(4):
        cid = f"person-{p:04d}"
        client.post("/api/dataset/consent", json={"contributor_id": cid, "consent_research": True, "consent_text_version": "r1"})
        for k in range(16):
            pos = bool(k % 2)
            sid = capture(client, cid, f"{cid}-sess{k % 2}", pos, p * 100 + k)
            ids.append(sid)
            for ann in ("ann-a", "ann-b"):
                lab = ("positive" if pos else "negative") if rng.random() > 0.05 else "cannot_judge"
                client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "lip_dryness", "annotator_id": ann, "label": lab})
    stats = {s["model_id"]: s for s in client.get("/api/dataset/stats").json()}["lip_dryness"]
    assert stats["samples"] == 64 and stats["subjects"] == 4 and stats["mean_kappa"] > 0.6
    card = client.post("/api/dataset/export/lip_dryness").json()
    assert card["rows"] == stats["usable"] and "--tier experimental" in card["train_command"]
    manifest = card["manifest"]
    header = open(manifest).readline().strip().split(",")
    assert header[:3] == ["path", "label", "subject_id"]

    from training.train import TrainConfig, run

    base = dict(model_id="lip_dryness", manifest=manifest, backbone="small_cnn", input_size=48, epochs=1, batch_size=16,
                out_dir=str(tmp_path / "models"), runs_dir=str(tmp_path / "runs"), tracker="json")
    with pytest.raises(ValueError, match="reserved for synthetic"):
        run(TrainConfig(**base, tier="demo"))
    with pytest.raises(ValueError, match="validation gate failed"):
        run(TrainConfig(**base, tier="validated"))
    out = run(TrainConfig(**base, tier="experimental", class_weighted=True))
    card = json.loads((out / "model_card.json").read_text())
    assert card["tier"] == "experimental" and card["dataset"]["source"] == ["real-consented"]
    assert any("EXPERIMENTAL" in x for x in card["limitations"])
    assert (out / "MODEL_CARD.md").exists() and "EXPERIMENTAL tier" in (out / "MODEL_CARD.md").read_text()

    # withdrawal deletes everything from that person
    rep = client.delete("/api/dataset/contributors/person-0000").json()
    assert rep["deleted_snapshots"] == 16 and rep["deleted_files"] == 16
    left = client.get("/api/dataset/samples", params={"contributor_id": "person-0000"}).json()
    assert left == []
    assert client.post("/api/dataset/samples", json={"contributor_id": "person-0000", "session_id": "sess-9", "quality": {"status": "acceptable"},
                                                     "crops": [{"region": "lips", "image_b64": crop(True, 9)}]}).status_code == 403


def test_single_person_requires_session_grouping(client, tmp_path):
    cid = "solo-00001"
    client.post("/api/dataset/consent", json={"contributor_id": cid, "consent_research": True, "consent_text_version": "r1"})
    for k in range(30):
        sid = capture(client, cid, f"sess-{k % 5}", bool(k % 2), 500 + k)
        client.put(f"/api/dataset/samples/{sid}/labels", json={"model_id": "lip_dryness", "annotator_id": "me-0001", "label": "positive" if k % 2 else "negative"})
    card = client.post("/api/dataset/export/lip_dryness").json()
    assert "--group-by session_id" in card["train_command"]
    from training.train import TrainConfig, run

    base = dict(model_id="lip_dryness", manifest=card["manifest"], backbone="small_cnn", input_size=48, epochs=1, batch_size=16,
                out_dir=str(tmp_path / "m"), runs_dir=str(tmp_path / "r"), tracker="json", tier="experimental")
    with pytest.raises(ValueError, match="subject-grouped split is impossible"):
        run(TrainConfig(**base))
    out = run(TrainConfig(**base, group_by="session_id"))
    card = json.loads((out / "model_card.json").read_text())
    assert any("overestimate" in x for x in card["limitations"])


def test_experimental_disclosure_enforced():
    from app.safety.validator import validate_reply
    from app.schemas.protocol import AssistantReply, Observation, StructuredObservations

    obs = StructuredObservations(image_quality="acceptable", observations=[Observation(
        region="skin_chin", feature="visible_blemishes", confidence=0.9, status="accepted", present=True, model_id="skin_blemishes",
        model_version="x", model_tier="experimental", frames_aggregated=5)], demo_mode=False, validation_status="experimental", generated_at=0)
    bad = AssistantReply(message="I can see some visible spots on your chin in this image; lighting can affect this.",
                         referenced_observations=["skin_chin:visible_blemishes"], evidence_sufficient=True, suggests_professional=False)
    good = bad.model_copy(update={"message": bad.message + " This comes from an experimental model that isn't validated yet."})
    acne = bad.model_copy(update={"message": "You have acne on your chin (experimental model)."})
    assert {c.name: c.passed for c in validate_reply(bad, obs, False)}["experimental_model_disclosed"] is False
    assert all(c.passed for c in validate_reply(good, obs, False))
    assert {c.name: c.passed for c in validate_reply(acne, obs, False)}["no_diagnostic_language"] is False


def test_aggregator_reports_weakest_tier():
    from app.inference.aggregator import weakest_tier
    from app.schemas.protocol import Observation

    mk = lambda t, s="accepted": Observation(region="lips", feature="f", confidence=0.9, status=s, present=True, model_id="m",  # noqa: E731
                                            model_version="v", model_tier=t, frames_aggregated=3)
    assert weakest_tier([mk("validated"), mk("experimental")]) == "experimental"
    assert weakest_tier([mk("validated"), mk("demo", "inconclusive")]) == "validated"
    assert weakest_tier([]) == "none"
