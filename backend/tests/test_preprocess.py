import numpy as np
import pytest

from app.inference.preprocess import PreprocessConfig, denormalize, preprocess, tensor_stats, to_square


def test_shape_dtype_and_normalisation():
    cfg = PreprocessConfig(64)
    img = np.full((100, 100, 3), 128, np.uint8)
    x = preprocess(img, cfg)
    assert x.shape == (3, 64, 64) and x.dtype == np.float32
    expected = (128 / 255 - np.array(cfg.mean)) / np.array(cfg.std)
    np.testing.assert_allclose(x.mean(axis=(1, 2)), expected, atol=1e-5)


def test_denormalize_round_trip():
    cfg = PreprocessConfig(32)
    img = np.random.default_rng(0).integers(0, 256, (32, 32, 3), dtype=np.uint8)
    back = denormalize(preprocess(img, cfg), cfg)
    assert np.abs(back.astype(int) - img.astype(int)).max() <= 1


def test_non_square_is_padded_not_stretched():
    img = np.zeros((40, 80, 3), np.uint8)
    img[:, :] = 200
    sq = to_square(img)
    assert sq.shape == (80, 80, 3)


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        preprocess(np.zeros((10, 10), np.uint8), PreprocessConfig())
    with pytest.raises(ValueError):
        preprocess(np.zeros((10, 10, 3), np.float32), PreprocessConfig())


def test_tensor_stats():
    s = tensor_stats(np.zeros((3, 4, 4), np.float32))
    assert s["shape"] == [1, 3, 4, 4] and s["min"] == 0 and s["channel_std"] == [0, 0, 0]


def test_training_uses_same_preprocessing():
    """Train/serve parity: the dataset must call app.inference.preprocess.preprocess."""
    import training.data as d

    assert d.preprocess is preprocess
