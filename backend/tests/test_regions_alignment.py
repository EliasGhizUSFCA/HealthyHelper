import numpy as np

from app.cv.alignment import align_face, canonical_anchors, region_difference
from app.cv.regions import crop_regions, region_bbox_px, region_specs
from tests.conftest import synthetic_landmarks


def test_bbox_contains_all_region_landmarks_and_is_square():
    lm = synthetic_landmarks()
    W, H = 640, 480
    for name, spec in region_specs().items():
        x, y, w, h = region_bbox_px(lm, spec, W, H)
        pts = lm[list(spec.landmarks), :2] * [W, H]
        assert (pts[:, 0] >= x - 1).all() and (pts[:, 0] <= x + w + 1).all(), name
        assert (pts[:, 1] >= y - 1).all() and (pts[:, 1] <= y + h + 1).all(), name
        assert abs(w - h) <= 2, f"{name} not square: {w}x{h}"


def test_bbox_clamped_to_frame():
    lm = synthetic_landmarks(cx=0.02, cy=0.02)  # face hanging off the top-left corner
    for spec in region_specs().values():
        x, y, w, h = region_bbox_px(lm, spec, 320, 240)
        assert x >= 0 and y >= 0 and x + w <= 320 and y + h <= 240


def test_crop_pixels_come_from_the_region():
    """Paint each region's landmark centroid a unique colour; the crop centre must have that colour."""
    W, H = 800, 600
    lm = synthetic_landmarks()
    img = np.zeros((H, W, 3), np.uint8)
    colors = {}
    for i, (name, spec) in enumerate(region_specs().items()):
        c = (lm[list(spec.landmarks), :2].mean(0) * [W, H]).astype(int)
        col = (30 * (i + 1), 255 - 30 * i, 100)
        colors[name] = col
        img[c[1] - 3 : c[1] + 4, c[0] - 3 : c[0] + 4] = col
    crops = crop_regions(img, lm)
    assert set(crops) == set(region_specs())
    for name, (crop, bbox) in crops.items():
        h, w = crop.shape[:2]
        assert tuple(crop[h // 2, w // 2]) == colors[name], name
        assert all(0 <= v <= 1 for v in bbox)


def test_alignment_maps_anchors_to_canonical_positions():
    idx, dst, size = canonical_anchors()
    W, H = 640, 480
    lm = synthetic_landmarks()
    # place anchors at a known similarity transform (rot 15°, scale 1.3, shift) of the canonical template
    a = np.deg2rad(15)
    R = 1.3 * np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    src_px = dst @ R.T + [150, 90]
    lm[idx, :2] = src_px / [W, H]
    img = np.random.default_rng(0).integers(0, 255, (H, W, 3), dtype=np.uint8)
    aligned, M, aligned_lm = align_face(img, lm)
    assert aligned.shape == (size, size, 3)
    got = aligned_lm[idx, :2] * size
    assert np.abs(got - dst).max() < 0.5  # exact similarity → sub-pixel residual


def test_region_difference_is_lighting_normalised():
    rng = np.random.default_rng(0)
    a = rng.integers(60, 200, (64, 64, 3), dtype=np.uint8)
    brighter = np.clip(a.astype(int) + 30, 0, 255).astype(np.uint8)
    _, same = region_difference(a, a)
    _, lit = region_difference(a, brighter)
    other = rng.integers(60, 200, (64, 64, 3), dtype=np.uint8)
    _, diff = region_difference(a, other)
    assert same == 0.0
    assert lit < diff / 3  # uniform exposure change ≪ structural change
