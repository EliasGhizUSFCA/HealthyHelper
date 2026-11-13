# Model card — `undereye_darkness`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261113004603` |
| tier | demo |
| feature | visible_darkness — Visibly darker skin under the eyes (dark circles); strongly affected by lighting and natural skin tone. |
| regions | left_undereye, right_undereye |
| classes | visible_darkness, no_clear_darkness (positive: `visible_darkness`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 1.012 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: 150; label agreement (mean κ): n/a |
| training | 5 epochs (best 4), 68.0 s on cpu, torch 2.15.0+cpu, tracker mlflow run `428ecf2eb847431cb162fa7502bbb8a1` |

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
| visible_darkness | 0.968 | 0.929 | 0.948 | 0.030 | 0.071 | 99 |
| no_clear_darkness | 0.933 | 0.970 | 0.951 | 0.071 | 0.030 | 101 |

Calibration: ECE = 0.045, Brier = 0.083, NLL = 0.168
Selective @ threshold 0.7: coverage = 0.960, selective accuracy = 0.969

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_darkness", "no_clear_darkness"], "matrix": [[92, 7], [3, 98]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 105 | 0.962 | 0.962 |
| tilted | 95 | 0.937 | 0.937 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 169 | 0.941 | 0.940 |
| 1 | 31 | 1.000 | 1.000 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 35 | 0.971 | 0.971 |
| dim | 35 | 0.943 | 0.942 |
| normal | 130 | 0.946 | 0.946 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.938 | 0.937 |
| tone_2 | 56 | 0.964 | 0.964 |
| tone_3 | 24 | 1.000 | 1.000 |
| tone_4 | 40 | 0.975 | 0.974 |
| tone_5 | 32 | 0.938 | 0.938 |
| tone_6 | 32 | 0.875 | 0.873 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.950 | 0.950 | 0.045 | 0.960 |
| gaussian_blur_s2 | 0.960 | 0.960 | 0.027 | 0.965 |
| underexposed_x0.5 | 0.920 | 0.920 | 0.021 | 0.960 |
| overexposed_x1.6 | 0.915 | 0.915 | 0.071 | 0.780 |
| sensor_noise_s12 | 0.950 | 0.950 | 0.097 | 0.895 |
| jpeg_q25 | 0.870 | 0.869 | 0.067 | 0.910 |

Latency (batch 1, cpu, torch): p50 = 6.80 ms, p95 = 9.22 ms

