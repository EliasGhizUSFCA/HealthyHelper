"""Catalogue of the visual-feature models the system knows about.

A catalogue entry exists even when no weights are available, so the UI can show
"model not loaded" instead of silently omitting a region. Adding a new model =
add an entry here + train it with ``python -m training.train --model-id ...``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CatalogEntry:
    model_id: str
    feature: str
    regions: tuple[str, ...]
    classes: tuple[str, ...]  # binary features: (positive, negative); age: ordered ranges
    description: str
    default_threshold: float = 0.7
    input_size: int = 128
    task: str = "binary_feature"  # "binary_feature" | "age_range"


AGE_RANGES = ("under_20", "20_29", "30_39", "40_49", "50_59", "60_plus")
AGE_MIDPOINTS = {"under_20": 14.0, "20_29": 25.0, "30_39": 35.0, "40_49": 45.0, "50_59": 55.0, "60_plus": 67.0}

SKIN = ("skin_forehead", "skin_left_cheek", "skin_right_cheek", "skin_chin")

def feature_models() -> list[str]:
    return [m for m, e in CATALOG.items() if e.task == "binary_feature"]


CATALOG: dict[str, CatalogEntry] = {
    e.model_id: e
    for e in [
        CatalogEntry(
            "lip_dryness", "visible_dryness", ("lips",),
            ("visible_dryness", "no_clear_dryness"),
            "Visibly dry or cracked-looking lips.",
        ),
        CatalogEntry(
            "eye_redness", "visible_redness", ("left_eye", "right_eye"),
            ("visible_redness", "no_clear_redness"),
            "Visible redness of the white of the eye.",
        ),
        CatalogEntry(
            "nasal_redness", "visible_redness", ("nose",),
            ("visible_redness", "no_clear_redness"),
            "Visible redness or irritation on the external nose.",
        ),
        CatalogEntry(
            "skin_flaking", "visible_flaking", SKIN,
            ("visible_flaking", "no_clear_flaking"),
            "Visible dryness/flaking texture on facial skin.",
        ),
        CatalogEntry(
            "skin_blemishes", "visible_blemishes", SKIN,
            ("visible_blemishes", "no_clear_blemishes"),
            "Visible spots or blemishes (acne-like bumps) on facial skin. Describes appearance only, not acne as a condition.",
        ),
        CatalogEntry(
            "skin_redness", "visible_redness", SKIN,
            ("visible_redness", "no_clear_redness"),
            "Visible redness or irritated-looking patches on facial skin.",
        ),
        CatalogEntry(
            "skin_shine", "visible_shine", SKIN,
            ("visible_shine", "no_clear_shine"),
            "Visible shine/oiliness on facial skin (strongly lighting-dependent).",
        ),
        CatalogEntry(
            "undereye_darkness", "visible_darkness", ("left_undereye", "right_undereye"),
            ("visible_darkness", "no_clear_darkness"),
            "Visibly darker skin under the eyes (dark circles); strongly affected by lighting and natural skin tone.",
        ),
        CatalogEntry(
            "apparent_age", "apparent_age_range", ("face",),
            AGE_RANGES,
            "Broad APPARENT-age range (how old a face looks to annotators), opt-in only. Not chronological age, not for identity or access decisions.",
            default_threshold=0.5, input_size=112, task="age_range",
        ),
    ]
}
