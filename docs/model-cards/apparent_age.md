# Model card — `apparent_age`

> **EXPERIMENTAL tier — trained on real, consented images, but the dataset did not pass (or was not checked against) the validation gate** (enough held-out people, balanced classes, inter-annotator agreement). Treat the metrics as a rough indication on *this* dataset only.

| field | value |
|---|---|
| version | `0.5.0-experimental.20261113011308` |
| tier | experimental |
| feature | apparent_age_range — Broad APPARENT-age range (how old a face looks to annotators), opt-in only. Not chronological age, not for identity or access decisions. |
| regions | face |
| classes | under_20, 20_29, 30_39, 40_49, 50_59, 60_plus (positive: `under_20`) |
| abstention | 'inconclusive' when top score < threshold (0.5); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 112×112 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 1.061 (fitted on validation split) |
| data | fairface; train/val/test = 12749/2250/4000 images, grouped by subject_id (seed 42); contributors: 18999; label agreement (mean κ): n/a |
| training | 6 epochs (best 5), 1215.0 s on cpu, torch 2.15.0+cpu, tracker mlflow run `2977c241ccfa4cfaae1e5b95d8fef6fa` |

## Intended use

Wellness-education visual observation of a single facial region. Not a diagnostic device.

## Limitations

- EXPERIMENTAL: trained on FairFace (CC BY 4.0) face photos from Flickr; labels are crowd-annotated APPARENT-age bins, not verified ages.
- Domain shift: FairFace photos differ from webcam frames (lighting, resolution, pose) — expect lower accuracy live.
- The 'under_20' range merges 0–19, so the model cannot tell minors from young adults; only a user-confirmed range may be used for age-appropriateness.
- FairFace has no identity ids, so near-duplicate faces across splits cannot be ruled out; test metrics may be optimistic.
- Performance differs across gender and race groups — see the subgroup table. Never use for identity verification, age-gating or health statements.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 4000, accuracy = 0.578, macro-F1 = 0.544

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| under_20 | 0.796 | 0.777 | 0.786 | 0.066 | 0.223 | 999 |
| 20_29 | 0.603 | 0.595 | 0.599 | 0.169 | 0.405 | 1205 |
| 30_39 | 0.440 | 0.478 | 0.458 | 0.164 | 0.522 | 851 |
| 40_49 | 0.420 | 0.393 | 0.406 | 0.076 | 0.607 | 494 |
| 50_59 | 0.426 | 0.464 | 0.444 | 0.049 | 0.536 | 291 |
| 60_plus | 0.629 | 0.519 | 0.568 | 0.013 | 0.481 | 160 |

Calibration: ECE = 0.032, Brier = 0.532, NLL = 1.002
Selective @ threshold 0.5: coverage = 0.649, selective accuracy = 0.670

Confusion matrix (rows = true, cols = predicted): {"labels": ["under_20", "20_29", "30_39", "40_49", "50_59", "60_plus"], "matrix": [[776, 172, 36, 9, 4, 2], [148, 717, 296, 37, 6, 1], [39, 250, 407, 131, 23, 1], [8, 43, 152, 194, 90, 7], [3, 6, 32, 77, 135, 38], [1, 1, 2, 14, 59, 83]]}

### Slice: fairface_age_bin

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0-2 | 76 | 0.961 | 0.163 |
| 10-19 | 463 | 0.559 | 0.120 |
| 20-29 | 1205 | 0.595 | 0.124 |
| 3-9 | 460 | 0.965 | 0.164 |
| 30-39 | 851 | 0.478 | 0.108 |
| 40-49 | 494 | 0.393 | 0.094 |
| 50-59 | 291 | 0.464 | 0.106 |
| 60-69 | 114 | 0.421 | 0.099 |
| more than 70 | 46 | 0.761 | 0.144 |

### Slice: ff_split

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| test | 4000 | 0.578 | 0.544 |

### Slice: gender

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| female | 1922 | 0.567 | 0.516 |
| male | 2078 | 0.588 | 0.563 |

### Slice: race

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| black | 591 | 0.557 | 0.474 |
| east_asian | 543 | 0.608 | 0.518 |
| indian | 541 | 0.586 | 0.560 |
| latino_hispanic | 570 | 0.581 | 0.555 |
| middle_eastern | 445 | 0.613 | 0.611 |
| southeast_asian | 509 | 0.572 | 0.498 |
| white | 801 | 0.551 | 0.538 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.578 | 0.544 | 0.032 | 0.649 |
| gaussian_blur_s2 | 0.563 | 0.512 | 0.034 | 0.616 |
| underexposed_x0.5 | 0.559 | 0.516 | 0.037 | 0.603 |
| overexposed_x1.6 | 0.565 | 0.523 | 0.036 | 0.622 |
| sensor_noise_s12 | 0.557 | 0.520 | 0.037 | 0.587 |
| jpeg_q25 | 0.555 | 0.517 | 0.039 | 0.592 |

### Apparent-age metrics

range accuracy 0.578, within ±1 range 0.931, MAE (expected vs range midpoint) 5.8 y, 80% span coverage 0.882 (mean width 2.16 ranges), mean entropy 1.43 bits

MAE uses range midpoints; labels are annotated apparent-age bins, not verified ages.

### Subgroup: gender

| group | n | range acc | ±1 acc | MAE (y) |
|---|---|---|---|---|
| female | 1922 | 0.567 | 0.922 | 5.8 |
| male | 2078 | 0.588 | 0.939 | 5.8 |

Largest subgroup gap (gender): accuracy 0.021, MAE 0.1 y

### Subgroup: race

| group | n | range acc | ±1 acc | MAE (y) |
|---|---|---|---|---|
| black | 591 | 0.557 | 0.914 | 5.8 |
| east_asian | 543 | 0.608 | 0.926 | 5.4 |
| indian | 541 | 0.586 | 0.945 | 5.3 |
| latino_hispanic | 570 | 0.581 | 0.928 | 6.2 |
| middle_eastern | 445 | 0.613 | 0.964 | 5.5 |
| southeast_asian | 509 | 0.572 | 0.925 | 5.8 |
| white | 801 | 0.551 | 0.926 | 6.3 |

Largest subgroup gap (race): accuracy 0.063, MAE 1.0 y

Latency (batch 1, cpu, torch): p50 = 5.40 ms, p95 = 11.92 ms

