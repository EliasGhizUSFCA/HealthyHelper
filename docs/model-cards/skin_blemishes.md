# Model card — `skin_blemishes`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261113004020` |
| tier | demo |
| feature | visible_blemishes — Visible spots or blemishes (acne-like bumps) on facial skin. Describes appearance only, not acne as a condition. |
| regions | skin_forehead, skin_left_cheek, skin_right_cheek, skin_chin |
| classes | visible_blemishes, no_clear_blemishes (positive: `visible_blemishes`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.620 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: 150; label agreement (mean κ): n/a |
| training | 5 epochs (best 4), 105.1 s on cpu, torch 2.15.0+cpu, tracker mlflow run `d2034f22c61b498b9bfe9478b8dd041a` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.930, macro-F1 = 0.930

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_blemishes | 0.931 | 0.931 | 0.931 | 0.071 | 0.069 | 101 |
| no_clear_blemishes | 0.929 | 0.929 | 0.929 | 0.069 | 0.071 | 99 |

Calibration: ECE = 0.029, Brier = 0.114, NLL = 0.243
Selective @ threshold 0.7: coverage = 0.940, selective accuracy = 0.952

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_blemishes", "no_clear_blemishes"], "matrix": [[94, 7], [7, 92]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 108 | 0.917 | 0.915 |
| tilted | 92 | 0.946 | 0.945 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 162 | 0.932 | 0.932 |
| 1 | 38 | 0.921 | 0.920 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 54 | 1.000 | 1.000 |
| dim | 36 | 0.917 | 0.916 |
| normal | 110 | 0.900 | 0.900 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.938 | 0.937 |
| tone_2 | 56 | 0.929 | 0.926 |
| tone_3 | 24 | 0.958 | 0.958 |
| tone_4 | 40 | 0.900 | 0.898 |
| tone_5 | 32 | 0.938 | 0.938 |
| tone_6 | 32 | 0.938 | 0.935 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.930 | 0.930 | 0.029 | 0.940 |
| gaussian_blur_s2 | 0.880 | 0.880 | 0.045 | 0.920 |
| underexposed_x0.5 | 0.875 | 0.875 | 0.077 | 0.905 |
| overexposed_x1.6 | 0.835 | 0.834 | 0.055 | 0.835 |
| sensor_noise_s12 | 0.815 | 0.812 | 0.068 | 0.840 |
| jpeg_q25 | 0.825 | 0.823 | 0.074 | 0.865 |

Latency (batch 1, cpu, torch): p50 = 7.28 ms, p95 = 14.04 ms

