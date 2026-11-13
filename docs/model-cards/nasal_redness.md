# Model card — `nasal_redness`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261112234320` |
| tier | demo |
| feature | visible_redness — Visible redness or irritation on the external nose. |
| regions | nose |
| classes | visible_redness, no_clear_redness (positive: `visible_redness`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.920 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: n/a; label agreement (mean κ): n/a |
| training | 6 epochs (best 3), 112.6 s on cpu, torch 2.15.0+cpu, tracker mlflow run `1311f6b0e9504a4d9381bf48691f1b74` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.955, macro-F1 = 0.955

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_redness | 0.962 | 0.952 | 0.957 | 0.042 | 0.048 | 105 |
| no_clear_redness | 0.948 | 0.958 | 0.953 | 0.048 | 0.042 | 95 |

Calibration: ECE = 0.029, Brier = 0.083, NLL = 0.167
Selective @ threshold 0.7: coverage = 0.955, selective accuracy = 0.969

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_redness", "no_clear_redness"], "matrix": [[100, 5], [4, 91]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 92 | 0.913 | 0.912 |
| tilted | 108 | 0.991 | 0.991 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 175 | 0.949 | 0.949 |
| 1 | 25 | 1.000 | 1.000 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 51 | 1.000 | 1.000 |
| dim | 33 | 0.970 | 0.969 |
| normal | 116 | 0.931 | 0.931 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 1.000 | 1.000 |
| tone_2 | 56 | 0.964 | 0.964 |
| tone_3 | 24 | 1.000 | 1.000 |
| tone_4 | 40 | 0.975 | 0.975 |
| tone_5 | 32 | 0.938 | 0.931 |
| tone_6 | 32 | 0.875 | 0.875 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.955 | 0.955 | 0.029 | 0.955 |
| gaussian_blur_s2 | 0.950 | 0.950 | 0.018 | 0.960 |
| underexposed_x0.5 | 0.920 | 0.920 | 0.041 | 0.930 |
| overexposed_x1.6 | 0.945 | 0.945 | 0.045 | 0.950 |
| sensor_noise_s12 | 0.885 | 0.885 | 0.052 | 0.900 |
| jpeg_q25 | 0.935 | 0.935 | 0.020 | 0.935 |

Latency (batch 1, cpu, torch): p50 = 6.21 ms, p95 = 161.19 ms

