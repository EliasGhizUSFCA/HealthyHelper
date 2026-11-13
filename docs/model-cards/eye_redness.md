# Model card — `eye_redness`

> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be used to make any statement about a real person.

| field | value |
|---|---|
| version | `0.1.0-demo.20261112234132` |
| tier | demo |
| feature | visible_redness — Visible redness of the white of the eye. |
| regions | left_eye, right_eye |
| classes | visible_redness, no_clear_redness (positive: `visible_redness`) |
| abstention | 'inconclusive' when top score < threshold (0.7); 'abstained' when the quality gate fails |
| backbone | resnet18 (ImageNet-pretrained: True) |
| input | 128×128 RGB, ImageNet normalisation |
| calibration | temperature scaling, T = 1.062 (fitted on validation split) |
| data | synthetic; train/val/test = 840/160/200 images, grouped by subject_id (seed 42); contributors: n/a; label agreement (mean κ): n/a |
| training | 6 epochs (best 5), 89.3 s on cpu, torch 2.15.0+cpu, tracker mlflow run `945c17a6ef4b43ecbb2642018f7d560b` |

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
| visible_redness | 0.946 | 0.906 | 0.926 | 0.048 | 0.094 | 96 |
| no_clear_redness | 0.917 | 0.952 | 0.934 | 0.094 | 0.048 | 104 |

Calibration: ECE = 0.052, Brier = 0.099, NLL = 0.190
Selective @ threshold 0.7: coverage = 0.915, selective accuracy = 0.973

Confusion matrix (rows = true, cols = predicted): {"labels": ["visible_redness", "no_clear_redness"], "matrix": [[87, 9], [5, 99]]}

### Slice: angle_bucket

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| frontal | 100 | 0.930 | 0.928 |
| tilted | 100 | 0.930 | 0.930 |

### Slice: blur

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| 0 | 178 | 0.938 | 0.938 |
| 1 | 22 | 0.864 | 0.863 |

### Slice: lighting

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| bright | 39 | 0.872 | 0.871 |
| dim | 33 | 0.939 | 0.935 |
| normal | 128 | 0.945 | 0.945 |

### Slice: skin_tone_group

| group | n | accuracy | macro-F1 |
|---|---|---|---|
| tone_1 | 16 | 0.812 | 0.812 |
| tone_2 | 56 | 0.893 | 0.892 |
| tone_3 | 24 | 0.917 | 0.917 |
| tone_4 | 40 | 0.975 | 0.973 |
| tone_5 | 32 | 1.000 | 1.000 |
| tone_6 | 32 | 0.938 | 0.935 |

### Robustness (controlled perturbations)

| perturbation | accuracy | macro-F1 | ECE | coverage |
|---|---|---|---|---|
| none | 0.930 | 0.930 | 0.052 | 0.915 |
| gaussian_blur_s2 | 0.940 | 0.940 | 0.078 | 0.865 |
| underexposed_x0.5 | 0.910 | 0.909 | 0.037 | 0.935 |
| overexposed_x1.6 | 0.905 | 0.904 | 0.043 | 0.880 |
| sensor_noise_s12 | 0.915 | 0.915 | 0.043 | 0.915 |
| jpeg_q25 | 0.940 | 0.940 | 0.049 | 0.925 |

Latency (batch 1, cpu, torch): p50 = 6.92 ms, p95 = 11.58 ms

