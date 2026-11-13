# Datasets: collecting real data, and research notes

**Status: no real training data is included in this repository.** `make demo-models` trains DEMO-tier models
on procedurally generated synthetic images (`backend/training/synthetic.py`) solely to exercise the pipeline.
Real data is collected and labelled with the app itself, as described below.

## Collecting and training on real data (built into the app)

1. **Collect** (`/collect`): each contributor gives a *separate research consent* (distinct from the Mirror's
   upload consent), then presses **Capture** with the camera on. One capture stores a crop of every face region
   (lips, eyes, under-eyes, nose, forehead, cheeks, chin; ≤ 256 px) from a single frame, plus optional
   self-reported conditions (lighting, glasses, makeup, device, Monk skin tone). Frames with no face, several
   faces, or unusable quality are refused. Contributors are identified only by a random browser ID and can
   **withdraw**, which deletes every crop and label they contributed.
2. **Label** (`/label`): choose a feature, label each crop **visible / not visible / can't judge** (keys 1/2/3),
   following the on-screen criteria. Labelling is blind (other annotators' labels are hidden). Have at least
   two people label the same crops so agreement can be measured.
3. **Export & train**: the Label page shows readiness checks and exports a manifest, or run
   `make train-real MODEL=<model_id>` (add `GROUP=session_id` if fewer than three people contributed).
   Labels are resolved by strict majority (ties and "can't judge" are dropped), the split is grouped by person,
   and the model is saved as tier **experimental**. Restart the backend or `POST /api/models/reload`.
4. **Validated tier**: `TIER=validated` only succeeds if the validation gate passes — ≥ 15 people and ≥ 100
   images in the held-out test split, ≥ 30 per class, subject-grouped split, mean Cohen's κ ≥ 0.6 between
   annotators (`backend/training/train.py::GATE`). These are project rules, not clinical standards.

Storage: `DATA_DIR/dataset/images/*.jpg` + tables `ds_contributors`, `ds_samples`, `ds_labels` in the app
database. Nothing is uploaded anywhere else; `data/` is git-ignored.

What to expect: a model trained on a few hundred crops from one or two people will mostly learn *those people,
that camera and that room*. Its test score (especially with `GROUP=session_id`) will look better than its
performance on anyone else. Variety (people, skin tones, lighting, cameras, days) matters far more than volume.
The model card generated next to each artifact (`MODEL_CARD.md`) records contributors, agreement and caveats.

This document lists candidate sources and the gaps that would have to be closed before training a model
whose outputs could be shown to people as observations. Licences and access terms change — **verify the
current terms of every dataset before downloading or using it**; the notes below are starting points, not
legal advice.

## Key finding

No public dataset we are aware of provides reliable, consistently annotated labels for the target
features (visibly dry lips, eye-white redness, external nasal redness, facial skin flaking, spots/blemishes,
skin redness, shine, under-eye darkness) captured with
ordinary webcams. General face datasets have identity/attribute labels, not dermatological or ophthalmic
ones, and must **not** be assumed to contain reliable health-related labels. A purpose-built, consented
dataset is the realistic path.

## Candidate sources

| Source (verify terms) | What it offers | Usefulness / caveats |
|---|---|---|
| FFHQ, CelebA / CelebA-HQ | Large face image collections | No health labels; licences restrict commercial use; scraped images — consent for health annotation is questionable. At most: unlabeled pretraining or landmark/crop QA. |
| FairFace | Faces balanced across demographic groups | Useful for checking crop/landmark behaviour across groups; no feature labels. |
| Meta "Casual Conversations" (v1/v2) | Consented videos with self-reported age/gender and annotated skin tone, varied lighting | Strong candidate for **robustness evaluation** across skin tone and lighting; restrictive research licence; no feature labels. |
| Google SCIN | Crowd-sourced, consented skin-condition images with skin-tone information and dermatologist labels | Dermatology-focused, mostly not faces, not webcam; could inform skin-texture work and skin-tone slicing. |
| Fitzpatrick17k, DDI (Diverse Dermatology Images) | Clinical/atlas dermatology images with skin-type labels | Lesion/condition classification, not "dryness"; research-only terms; domain gap to webcam. |
| Sclera / periocular datasets (e.g. SBVPI) | High-resolution eye images with sclera/vessel segmentation | Useful for sclera segmentation and vessel-visibility features; not redness grades; biometric data — handle carefully. |
| Clinical redness grading scales (e.g. Efron, CCLRU) | Reference images for grading bulbar redness | Scales, not datasets; can anchor an annotation protocol. |
| Monk Skin Tone (MST) scale & examples | Skin-tone annotation reference | For labelling evaluation slices, not for training features. |
| Acne grading datasets (e.g. ACNE04) | Facial photos with acne severity grades / lesion counts | Closest public match for the blemishes feature; clinical-style photos, not webcams; research licences; labels are severity grades of a condition — map carefully to "visible spots" and verify terms. |

## Recommended data plan

1. **Consent & governance.** Purpose-specific informed consent covering capture, annotation, model training
   and retention; ethics review where applicable; separate consent from any app usage (the app itself never
   trains on user images).
2. **Capture protocol.** Multiple consumer webcams/phones, controlled + uncontrolled lighting, frontal and
   ±20° yaw, with/without glasses/makeup; record device and lighting metadata.
3. **Annotation protocol.** Per-region crops labelled `visible_<feature>` / `no_clear_<feature>` /
   `cannot_judge` by ≥ 3 trained annotators with written criteria and reference images; report inter-rater
   agreement (Cohen/Fleiss κ). `cannot_judge` items are excluded from training but kept to evaluate abstention.
   Annotations describe **appearance only** — never diagnoses.
4. **Splits.** Split by **subject** (multiple images per person) — implemented in `training/data.py`
   (`grouped_split` + `assert_no_leakage`). Also hold out entire devices/sessions for a domain-shift test.
5. **Evaluation slices.** Monk/Fitzpatrick skin-tone group, lighting, blur, pose, device, glasses/makeup —
   the manifest's extra columns automatically become slices in `evaluation/evaluate.py`.
6. **Manifest format.** `path,label,subject_id,<any metadata columns>` (see `training/data.py`).

## Synthetic data (what is in the repo)

`training/synthetic.py` draws cartoon-like region patches. Each synthetic "subject" has fixed appearance
parameters (one of six skin-tone groups, lip hue, iris colour, shape) and contributes several images under
varied lighting, blur, rotation and noise, with 3 % label noise. This makes the grouped split meaningful and
lets slice/perturbation reports be exercised. It is **not** evidence of real-world performance or fairness.
