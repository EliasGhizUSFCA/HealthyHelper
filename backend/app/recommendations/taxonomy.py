"""Product taxonomy used by the catalogue and the recommender.

``RETAILER_PATHS`` maps eCosmetics category URL paths (from breadcrumbs / "Categories:" links on product
pages) to our categories. ``URL_KEYWORDS`` is only a *discovery pre-filter* over sitemap URLs so we fetch a
small, relevant subset; a product is kept only if its retailer categories map to one of ours.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    key: str
    mode: str  # "skincare" | "makeup"
    label: str
    retailer_paths: tuple[str, ...]
    url_keywords: tuple[str, ...]


CATEGORIES: dict[str, Category] = {c.key: c for c in [
    Category("moisturizer", "skincare", "Moisturizers",
             ("skincare/moisturizers/face-moisturizer", "skincare/moisturizers/night-creams", "skincare/moisturizers/face-oil",
              "skincare/moisturizers/face-mists", "men/skincare-men/moisturizers-treatments"),
             ("moistur", "cream", "lotion", "hydrat", "face-oil", "emulsion", "gel-cream")),
    Category("cleanser", "skincare", "Facial cleansers",
             ("skincare/cleansers/face-wash-cleanser", "skincare/cleansers/makeup-remover", "skincare/cleansers/toner"),
             ("cleanser", "face-wash", "cleansing", "micellar", "foaming", "wash")),
    Category("serum", "skincare", "Serums & treatments",
             ("skincare/treatments/face-serums", "skincare/treatments/face-masks"),
             ("serum", "essence", "ampoule", "concentrate", "booster")),
    Category("lip_care", "skincare", "Lip balms & lip care",
             ("skincare/lip-care/lip-balms-treatments", "skincare/lip-care/lip-sunscreen", "makeup/lips/lip-balm-treatment"),
             ("lip-balm", "lip-treatment", "lip-mask", "lip-butter", "lip-care", "lip-conditioner", "lip-repair", "lip-sleeping")),
    Category("sunscreen", "skincare", "Sunscreens",
             ("skincare/suncare/face-sunscreen",),
             ("sunscreen", "spf", "sun-cream", "uv-")),
    Category("blemish_care", "skincare", "Products marketed for blemish-prone skin",
             ("skincare/treatments/acne-blemish-treatments",),
             ("acne", "blemish", "spot-treatment", "pimple", "breakout", "clarifying", "salicylic", "pore")),
    Category("concealer", "makeup", "Concealers", ("makeup/face/concealer",), ("concealer",)),
    Category("color_corrector", "makeup", "Colour correctors", ("makeup/face/color-correct",), ("corrector", "color-correct", "colour-correct")),
    Category("foundation", "makeup", "Foundations", ("makeup/face/foundation",), ("foundation",)),
    Category("skin_tint", "makeup", "Skin tints, BB/CC & tinted moisturisers",
             ("makeup/face/tinted-moisturizer", "makeup/face/bb-cc-cream", "skincare/moisturizers/bb-cc-cream-moisturizers"),
             ("tinted", "skin-tint", "bb-cream", "cc-cream", "bb-", "cc-")),
    Category("setting_powder", "makeup", "Setting powders & sprays", ("makeup/face/face-powder", "makeup/face/setting-spray"),
             ("powder", "setting-spray", "setting")),
    Category("lip_product", "makeup", "Lip colour", ("makeup/lips/lipstick", "makeup/lips/lip-gloss", "makeup/lips/lip-stain", "makeup/lips/lip-oil"),
             ("lipstick", "lip-gloss", "lip-stain", "lip-oil", "lip-tint", "lip-color", "lip-colour")),
]}

# Categories where products are typically marketed as "anti-aging" / aggressive treatments.
# Used ONLY as an age-appropriateness filter for a user-CONFIRMED under-18 range, never as a recommendation driver.
AGE_SENSITIVE_RETAILER_PATHS = ("skincare/treatments/anti-aging-skincare-treatments", "skincare/treatments/facial-peels", "skincare/tools/anti-aging")


def map_retailer_categories(paths: list[str]) -> list[str]:
    """Map retailer category paths ('skincare/lip-care/lip-balms-treatments') to our category keys."""
    norm = [p.strip("/").removeprefix("product-category/") for p in paths]
    out = []
    for c in CATEGORIES.values():
        if any(any(n == rp or n.startswith(rp + "/") for rp in c.retailer_paths) for n in norm):
            out.append(c.key)
    return out


def url_matches_targets(url: str, categories: list[str] | None = None) -> list[str]:
    slug = url.rstrip("/").rsplit("/", 1)[-1].lower()
    cats = [CATEGORIES[k] for k in categories] if categories else list(CATEGORIES.values())
    return [c.key for c in cats if any(k in slug for k in c.url_keywords)]
