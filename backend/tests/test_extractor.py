import numpy as np
import pytest

from app.audio.extractor import AudioFeatureExtractor, quick_classify


SR = 22_050


@pytest.fixture
def extractor():
    return AudioFeatureExtractor(target_sr=SR)


def _save(path, y, sr=SR):
    import soundfile as sf
    sf.write(path, y.astype(np.float32), sr)
    return path


def test_extract_clean_signal(extractor, tmp_path):
    rng = np.random.default_rng(0)
    t = np.linspace(0, 2.0, int(2.0 * SR), endpoint=False)
    # Clean bowed sine -> smooth envelope, low ZCR contribution from noise only
    y = 0.5 * np.sign(np.sin(2 * np.pi * 220 * t)) * np.exp(-t * 0.5)
    y += rng.normal(0, 0.001, y.size)
    f = extractor.extract(y)
    assert f.sample_rate == SR
    assert 1.9 <= f.duration_seconds <= 2.1
    assert 0 <= f.zcr_mean <= 1.0
    assert f.rms_peak >= f.rms_mean


def test_rt60_shorter_for_fast_decay_than_sustained(extractor, tmp_path):
    t = np.linspace(0, 3.0, int(3.0 * SR), endpoint=False)
    fast = 0.5 * np.sin(2 * np.pi * 220 * t) * np.exp(-t * 6.0)
    slow = 0.5 * np.sin(2 * np.pi * 220 * t) * np.exp(-t * 0.5)
    f_fast = extractor.extract(fast)
    f_slow = extractor.extract(slow)
    assert f_fast.rt60_seconds is not None and f_slow.rt60_seconds is not None
    assert f_fast.rt60_seconds < f_slow.rt60_seconds


def test_zcr_higher_for_grainy_signal(extractor):
    rng = np.random.default_rng(7)
    grainy = np.clip(3 * rng.standard_normal(int(2.0 * SR)), -1, 1) * 0.5
    t = np.arange(int(2.0 * SR)) / SR
    warm = 0.5 * np.sin(2 * np.pi * 110 * t)
    f_grainy = extractor.extract(grainy)
    f_warm = extractor.extract(warm)
    assert f_grainy.zcr_mean > f_warm.zcr_mean
    assert f_grainy.spectral_centroid_mean_hz > f_warm.spectral_centroid_mean_hz


def test_silence_classifies_as_silence(extractor):
    y = np.zeros(int(SR * 1.5), dtype=np.float32)
    f = extractor.extract(y)
    assert quick_classify(f) == "silence"


def test_load_crops_with_start_end(extractor, tmp_path):
    t = np.linspace(0, 2.0, int(2.0 * SR), endpoint=False)
    y = np.sin(2 * np.pi * 220 * t)
    path = _save(tmp_path / "tone.wav", y)
    cropped = extractor.load(str(path), start=0.5, end=1.0)
    assert cropped.size == int(0.5 * SR)
