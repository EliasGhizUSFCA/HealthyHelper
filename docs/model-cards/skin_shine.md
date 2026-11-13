# Model card — `skin_shine`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261113004421` |
| tier | demo |
| feature | visible_shine — Visible shine/oiliness on facial skin (strongly lighting-dependent). |
| regions | skin_forehead, skin_left_cheek, skin_right_cheek, skin_chin |
| classes | visible_shine, no_clear_shine (positive: `visible_shine`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.889 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: 150; label agreement (mean κ): n/a |
| training | 5 epochs (best 4), 84.2 s on cpu, torch 2.15.0+cpu, tracker mlflow run `ff47c966c39b434d977d366d02c5a0de` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.920, macro-F1 = 0.920

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_shine | 0.925 | 0.925 | 0.925 | 0.085 | 0.075 | 106 |
| no_clear_shine | 0.915 | 0.915 | 0.915 | 0.075 | 0.085 | 94 |

Calibration: ECE = 0.039, Brier = 0.131, NLL = 0.219
Selective @ threshold 0.7: coverage = 0.950, selective accuracy = 0.926

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_shine", "no_clear_shine"], "matrix": [[98, 8], [8, 86]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 99 | 0.939 | 0.939 |
| tilted | 101 | 0.901 | 0.900 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 173 | 0.925 | 0.925 |
| 1 | 27 | 0.889 | 0.888 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 40 | 0.925 | 0.925 |
| dim | 39 | 0.923 | 0.922 |
| normal | 121 | 0.917 | 0.917 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.875 | 0.873 |
| tone_2 | 56 | 0.929 | 0.928 |
| tone_3 | 24 | 0.917 | 0.916 |
| tone_4 | 40 | 0.975 | 0.975 |
| tone_5 | 32 | 1.000 | 1.000 |
| tone_6 | 32 | 0.781 | 0.752 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.920 | 0.920 | 0.039 | 0.950 |
| gaussian_blur_s2 | 0.925 | 0.925 | 0.026 | 0.955 |
| underexposed_x0.5 | 0.890 | 0.890 | 0.037 | 0.935 |
| overexposed_x1.6 | 0.800 | 0.790 | 0.091 | 0.840 |
| sensor_noise_s12 | 0.895 | 0.895 | 0.035 | 0.940 |
| jpeg_q25 | 0.895 | 0.895 | 0.028 | 0.935 |

Latency (batch 1, cpu, torch): p50 = 5.68 ms, p95 = 16.64 ms

