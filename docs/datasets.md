# Dataset Research

**Status: no real training data has been used in this repository.** The shipped models are DEMO tier,
trained on procedurally generated synthetic images (`backend/training/synthetic.py`) solely to exercise
the training → evaluation → serving pipeline.

This document lists candidate sources and the gaps that would have to be closed before training a model
whose outputs could be shown to people as observations. Licences and access terms change — **verify the
current terms of every dataset before downloading or using it**; the notes below are starting points, not
legal advice.

## Key finding

No public dataset we are aware of provides reliable, consistently annotated labels for the four target
features (visibly dry lips, eye-white redness, external nasal redness, facial skin flaking) captured with
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
