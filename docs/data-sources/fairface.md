# Data source: FairFace (apparent-age model)

* **Dataset:** FairFace — Kärkkäinen, K. & Joo, J. (2021). *FairFace: Face Attribute Dataset for Balanced Race,
  Gender, and Age for Bias Measurement and Mitigation.* WACV 2021.
* **Licence:** CC BY 4.0 (attribution required). Images originate from the YFCC-100M Flickr collection.
* **Copy used:** Hugging Face mirror `HuggingFaceM4/FairFace`, config `0.25` (face crops with 25 % padding),
  downloaded to `data/external/fairface/` (git-ignored; never redistributed by this repo).
* **Subset:** 15,000 images from train shard 0 (stratified by age range) for training/validation and 4,000
  from the official validation split as our **test** split (`training/datasets/fairface.py`, seed 0).
* **Labels:** crowd-annotated *apparent* age bins (0–2, 3–9, 10–19, 20–29, …, 70+), merged into six ranges:
  under_20, 20_29, 30_39, 40_49, 50_59, 60_plus. Gender and race annotations are used **only** for subgroup
  evaluation, never as model inputs or outputs.

Known limitations: no identity ids (near-duplicate faces across splits cannot be excluded); Flickr photos differ
from webcam frames; the under_20 range merges minors and adults; annotator-perceived age is not true age.
The model is tier **experimental** and is never used for identity, age-gating, health statements or
recommendations (only a user-confirmed range can affect age-appropriateness filtering).
