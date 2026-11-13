# Model card — `skin_redness`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261113004246` |
| tier | demo |
| feature | visible_redness — Visible redness or irritated-looking patches on facial skin. |
| regions | skin_forehead, skin_left_cheek, skin_right_cheek, skin_chin |
| classes | visible_redness, no_clear_redness (positive: `visible_redness`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.792 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: 150; label agreement (mean κ): n/a |
| training | 5 epochs (best 4), 74.8 s on cpu, torch 2.15.0+cpu, tracker mlflow run `97da8e48c1b64e2eb338df55a60699ea` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.950, macro-F1 = 0.950

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_redness | 0.932 | 0.970 | 0.950 | 0.069 | 0.030 | 99 |
| no_clear_redness | 0.969 | 0.931 | 0.949 | 0.030 | 0.069 | 101 |

Calibration: ECE = 0.032, Brier = 0.097, NLL = 0.195
Selective @ threshold 0.7: coverage = 0.925, selective accuracy = 0.962

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_redness", "no_clear_redness"], "matrix": [[96, 3], [7, 94]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 91 | 0.978 | 0.978 |
| tilted | 109 | 0.927 | 0.927 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 170 | 0.941 | 0.941 |
| 1 | 30 | 1.000 | 1.000 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 47 | 0.915 | 0.913 |
| dim | 44 | 0.977 | 0.976 |
| normal | 109 | 0.954 | 0.953 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.938 | 0.923 |
| tone_2 | 56 | 0.982 | 0.982 |
| tone_3 | 24 | 1.000 | 1.000 |
| tone_4 | 40 | 0.925 | 0.924 |
| tone_5 | 32 | 0.938 | 0.927 |
| tone_6 | 32 | 0.906 | 0.904 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.950 | 0.950 | 0.032 | 0.925 |
| gaussian_blur_s2 | 0.940 | 0.940 | 0.029 | 0.940 |
| underexposed_x0.5 | 0.850 | 0.848 | 0.062 | 0.900 |
| overexposed_x1.6 | 0.880 | 0.880 | 0.032 | 0.825 |
| sensor_noise_s12 | 0.910 | 0.910 | 0.030 | 0.890 |
| jpeg_q25 | 0.885 | 0.885 | 0.019 | 0.915 |

Latency (batch 1, cpu, torch): p50 = 6.24 ms, p95 = 32.10 ms

