# Model card — `lip_dryness`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261112233934` |
| tier | demo |
| feature | visible_dryness — Visibly dry or cracked-looking lips. |
| regions | lips |
| classes | visible_dryness, no_clear_dryness (positive: `visible_dryness`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 0.774 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, split by subject (seed 42) |
| training | 6 epochs (best 4), 95.7 s on cpu, torch 2.15.0+cpu, tracker mlflow run `3e9c85f18e5b48faa6df863a3653f08f` |

## Intended use

Educational demonstration of a region-classifier pipeline. Not for health assessment.

## Limitations

- Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.
- Synthetic skin-tone groups do not establish fairness on real people.
- Classifier scores are not probabilities of any medical condition.
- Not a medical device; no clinical validation has been performed.

## Held-out test metrics (from `eval_report.json`)


n = 200, accuracy = 0.945, macro-F1 = 0.945

| class | precision | recall | F1 | FPR | FNR | support |
|---|---|---|---|---|---|---|
| visible_dryness | 0.927 | 0.971 | 0.949 | 0.084 | 0.029 | 105 |
| no_clear_dryness | 0.967 | 0.916 | 0.941 | 0.029 | 0.084 | 95 |

Calibration: ECE = 0.029, Brier = 0.096, NLL = 0.188
Selective @ threshold 0.7: coverage = 0.985, selective accuracy = 0.949

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_dryness", "no_clear_dryness"], "matrix": [[102, 3], [8, 87]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 102 | 0.941 | 0.941 |
| tilted | 98 | 0.949 | 0.947 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 174 | 0.954 | 0.954 |
| 1 | 26 | 0.885 | 0.884 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 35 | 1.000 | 1.000 |
| dim | 48 | 0.938 | 0.937 |
| normal | 117 | 0.932 | 0.931 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.938 | 0.937 |
| tone_2 | 56 | 0.964 | 0.963 |
| tone_3 | 24 | 1.000 | 1.000 |
| tone_4 | 40 | 0.875 | 0.875 |
| tone_5 | 32 | 0.906 | 0.904 |
| tone_6 | 32 | 1.000 | 1.000 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.945 | 0.945 | 0.029 | 0.985 |
| gaussian_blur_s2 | 0.915 | 0.914 | 0.057 | 0.980 |
| underexposed_x0.5 | 0.940 | 0.940 | 0.019 | 0.950 |
| overexposed_x1.6 | 0.935 | 0.935 | 0.035 | 0.985 |
| sensor_noise_s12 | 0.930 | 0.929 | 0.047 | 0.985 |
| jpeg_q25 | 0.930 | 0.929 | 0.058 | 0.985 |

Latency (batch 1, cpu, torch): p50 = 5.55 ms, p95 = 8.23 ms

