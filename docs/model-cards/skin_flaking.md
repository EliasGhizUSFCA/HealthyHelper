# Model card — `skin_flaking`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261112234547` |
| tier | demo |
| feature | visible_flaking — Visible dryness/flaking texture on facial skin. |
| regions | skin_forehead, skin_left_cheek, skin_right_cheek |
| classes | visible_flaking, no_clear_flaking (positive: `visible_flaking`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.908 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: n/a; label agreement (mean κ): n/a |
| training | 6 epochs (best 5), 91.9 s on cpu, torch 2.15.0+cpu, tracker mlflow run `b6b19baf20a14085aa1b664c9b825ea9` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.900, macro-F1 = 0.900

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_flaking | 0.898 | 0.915 | 0.907 | 0.117 | 0.085 | 106 |
| no_clear_flaking | 0.902 | 0.883 | 0.892 | 0.085 | 0.117 | 94 |

Calibration: ECE = 0.035, Brier = 0.158, NLL = 0.297
Selective @ threshold 0.7: coverage = 0.925, selective accuracy = 0.930

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_flaking", "no_clear_flaking"], "matrix": [[97, 9], [11, 83]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 87 | 0.908 | 0.908 |
| tilted | 113 | 0.894 | 0.892 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 162 | 0.914 | 0.914 |
| 1 | 38 | 0.842 | 0.825 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 36 | 0.944 | 0.943 |
| dim | 33 | 0.909 | 0.909 |
| normal | 131 | 0.885 | 0.885 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.938 | 0.931 |
| tone_2 | 56 | 0.875 | 0.875 |
| tone_3 | 24 | 1.000 | 1.000 |
| tone_4 | 40 | 0.875 | 0.868 |
| tone_5 | 32 | 0.844 | 0.836 |
| tone_6 | 32 | 0.938 | 0.933 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.900 | 0.900 | 0.035 | 0.925 |
| gaussian_blur_s2 | 0.900 | 0.900 | 0.022 | 0.890 |
| underexposed_x0.5 | 0.930 | 0.930 | 0.042 | 0.870 |
| overexposed_x1.6 | 0.825 | 0.819 | 0.065 | 0.925 |
| sensor_noise_s12 | 0.860 | 0.857 | 0.041 | 0.835 |
| jpeg_q25 | 0.925 | 0.925 | 0.032 | 0.915 |

Latency (batch 1, cpu, torch): p50 = 5.82 ms, p95 = 11.02 ms

