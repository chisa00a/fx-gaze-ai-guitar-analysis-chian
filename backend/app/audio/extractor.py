"""Audio feature extraction (Phase 2 / FR-04) — Wide Sub-Type Edition.

Extracts deep acoustic signatures including:
- Pitch/Amplitude Modulation Depth -> detects Dream / Cloud / Modulated Reverb & Chorus
- Onset Softness / Swell Ratio     -> detects Reverse / Soft-Focus Shoegaze Reverb
- Tail Sustain Density             -> separates Ambient Dream Wash from standard Concert Hall
- Crest + Spectral Flatness + ZCR  -> separates Muff Fuzz, Velcro Fuzz, RAT/DS Distortion, TS/Bluesbreaker OD
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional, Tuple

import librosa
import numpy as np

try:  # pragma: no cover
    import soundfile as sf

    _SF_AVAILABLE = True
except Exception:  # pragma: no cover
    _SF_AVAILABLE = False


@dataclass
class AudioFeatures:
    """Numeric feature summary of an analysed audio snippet (FR-04)."""

    sample_rate: int
    duration_seconds: float
    zcr_mean: float
    rms_mean: float
    rms_peak: float
    rt60_seconds: Optional[float]
    spectral_centroid_mean_hz: float
    echo_similarity: float
    crest_factor_db: float
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("extra")
        return {"features": data, "notes": self.extra}

    def _sanitize(self) -> "AudioFeatures":
        for name in (
            "zcr_mean",
            "rms_mean",
            "rms_peak",
            "rt60_seconds",
            "spectral_centroid_mean_hz",
            "echo_similarity",
            "crest_factor_db",
        ):
            value = getattr(self, name)
            if value is not None and not np.isfinite(value):
                setattr(self, name, None if name == "rt60_seconds" else 0.0)
        return self


class AudioFeatureExtractor:
    """Extract physical descriptors from a mono waveform using librosa."""

    def __init__(self, target_sr: int = 22_050):
        self.target_sr = target_sr

    def load(self, path: str, start: float = 0.0, end: Optional[float] = None) -> np.ndarray:
        offset = max(0.0, start)
        duration = None if end is None else max(0.01, end - offset)
        try:
            y, sr = librosa.load(
                path, sr=self.target_sr, mono=True, offset=offset, duration=duration
            )
        except Exception:
            if not _SF_AVAILABLE:
                raise
            data, sr = sf.read(path, frames=-1, start=int(offset * self._file_sr(path)))
            y = np.asarray(data, dtype=np.float32)
            if y.ndim > 1:
                y = y.mean(axis=1)
            if end is not None:
                y = y[: int((end - offset) * self.target_sr)]

        if y.size == 0:
            raise ValueError("empty audio selection")
        return y

    @staticmethod
    def _file_sr(path: str) -> int:
        try:
            import wave

            with wave.open(path, "rb") as wf:
                return wf.getframerate()
        except Exception:
            return 44_100

    def extract(self, y: np.ndarray, sr: Optional[int] = None) -> AudioFeatures:
        sr = sr if sr is not None else self.target_sr
        if y.dtype != np.float32:
            y = y.astype(np.float32)

        frame = 2048
        hop = 512

        rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0]
        rms_mean = float(np.mean(rms))
        rms_peak = float(np.max(rms))

        peak_abs = float(np.max(np.abs(y)))
        y_norm = y / peak_abs if peak_abs > 1e-6 else y

        zcr = librosa.feature.zero_crossing_rate(y_norm, frame_length=frame, hop_length=hop)
        zcr_mean = float(np.mean(zcr))

        rt60 = self._estimate_rt60(rms, hop / sr)

        S = np.abs(librosa.stft(y_norm, n_fft=frame, hop_length=hop))
        centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
        centroid_mean = float(np.mean(centroid))

        rolloff = librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85)[0]
        rolloff_mean = float(np.mean(rolloff))

        flatness = librosa.feature.spectral_flatness(S=S)[0]
        flatness_mean = float(np.mean(flatness))

        freqs = librosa.fft_frequencies(sr=sr, n_fft=frame)
        total_spec_energy = float(np.sum(S)) + 1e-9
        hf_ratio = float(np.sum(S[freqs >= 3800.0, :]) / total_spec_energy)

        # --- ฟีเจอร์ใหม่สำหรับแยก Dream / Cloud / Shimmer / Reverse Reverb ---
        # 1. Spectral Centroid Modulation (การแกว่งของโทนเสียงจาก Chorus/Modulation ในหาง Dream Reverb)
        centroid_mod = float(np.std(centroid) / (centroid_mean + 1e-9))

        # 2. Tail Sustain Density (สัดส่วนเฟรมที่พลังงานอุ้มค้างไว้เกิน 25% ของ Peak -> บอกค่า Wet Mix & Cloud Wash)
        tail_density = float(np.mean(rms > (rms_peak * 0.25))) if rms_peak > 1e-6 else 0.0

        # 3. Attack Softness (อัตราส่วนหัวโน้ตคมชัดเทียบกับพลังงานรวม -> ถ้าต่ำแปลว่าหัวโน้ตละลายแบบ Dream/Reverse)
        onset_env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S, ref=np.max), sr=sr)
        attack_sharpness = float(np.max(onset_env) / (np.mean(onset_env) + 1e-5)) if onset_env.size else 5.0

        echo_sim, delay_ms = self._echo_analysis(y_norm, sr)

        if rms_peak <= 1e-9 or rms_mean <= 1e-9:
            crest_db = 0.0
            clipping_ratio = 0.0
        else:
            crest_db = float(20.0 * np.log10(max(peak_abs, 1e-9) / max(rms_mean, 1e-9)))
            clipping_ratio = float(np.mean(np.abs(y_norm) >= 0.82))

        features_obj = AudioFeatures(
            sample_rate=sr,
            duration_seconds=round(float(y.size / sr), 3),
            zcr_mean=round(zcr_mean, 5),
            rms_mean=round(rms_mean, 6),
            rms_peak=round(rms_peak, 6),
            rt60_seconds=None if rt60 is None else round(rt60, 3),
            spectral_centroid_mean_hz=round(centroid_mean, 1),
            echo_similarity=round(echo_sim, 4),
            crest_factor_db=round(crest_db, 2),
        )._sanitize()

        features_obj.extra = {
            "delay_ms": int(round(delay_ms)),
            "rolloff_hz": round(rolloff_mean, 1),
            "spectral_flatness": round(flatness_mean, 5),
            "hf_ratio": round(hf_ratio, 4),
            "clipping_ratio": round(clipping_ratio, 4),
            "centroid_mod": round(centroid_mod, 4),
            "tail_density": round(tail_density, 4),
            "attack_sharpness": round(attack_sharpness, 3),
        }
        features_obj.extra["sub_classification"] = classify_detailed_subtypes(features_obj)
        return features_obj

    @staticmethod
    def _estimate_rt60(rms: np.ndarray, frame_time: float) -> Optional[float]:
        if rms.size < 8:
            return None
        peak_idx = int(np.argmax(rms))
        peak_val = float(rms[peak_idx])
        if peak_val <= 1e-6:
            return None

        tail = rms[peak_idx:]
        if tail.size < 4:
            return None

        db = 20.0 * np.log10(np.maximum(tail, 1e-9) / peak_val)
        ref = db[0] - 60.0
        below = np.nonzero(db <= ref)[0]

        if below.size > 0 and below[0] > 0:
            i = int(below[0])
            db0, db1 = float(db[i - 1]), float(db[i])
            frac = (db0 - ref) / max(db0 - db1, 1e-9)
            rt60_direct = float((i - 1 + frac) * frame_time)
            return float(np.clip(rt60_direct, 0.05, 10.0))

        max_window_frames = max(6, int(4.5 / max(frame_time, 1e-4)))
        window_db = db[:max_window_frames]
        if window_db.size < 6:
            return None

        valid_mask = (window_db <= -2.0) & (window_db >= -25.0)
        if np.sum(valid_mask) >= 4:
            t = np.arange(window_db.size) * frame_time
            slope, _ = np.polyfit(t[valid_mask], window_db[valid_mask], 1)
            if slope < -2.0:
                est = -60.0 / float(slope)
                return float(np.clip(est, 0.15, 6.5))

        drop_db = float(window_db[-1] - window_db[0])
        if drop_db > -2.5:
            # กรณีเสียง Pad / Dream Reverb ที่อุ้มหางเสียงค้างยาวมากจนลดลงช้า
            sustained = float(np.mean(rms > peak_val * 0.35))
            if sustained > 0.55:
                return float(np.clip(sustained * 5.2, 2.4, 5.8))
            return None
        duration_win = (window_db.size - 1) * frame_time
        slope_sec = drop_db / max(duration_win, 1e-4)
        est = -60.0 / slope_sec
        return float(np.clip(est, 0.15, 6.5))

    @classmethod
    def _echo_analysis(cls, y: np.ndarray, sr: int) -> Tuple[float, float]:
        if y.size < int(sr * 0.25):
            return 0.0, 0.0

        best_wave_corr = 0.0
        best_wave_ms = 0.0
        for lag_ms in range(40, 551, 10):
            lag = int(sr * lag_ms / 1000)
            if lag >= y.size // 2:
                break
            a = y[: y.size - 2 * lag]
            b = y[lag : lag + a.size]
            denom = float(np.linalg.norm(a) * np.linalg.norm(b))
            if denom < 1e-9:
                continue
            corr = float(np.dot(a, b) / denom)
            if corr > best_wave_corr:
                best_wave_corr = corr
                best_wave_ms = float(lag_ms)

        hop = 256
        env = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
        onset_env = np.maximum(0.0, np.diff(env, prepend=env[0]))
        onset_env = onset_env - np.mean(onset_env)

        best_env_corr = 0.0
        best_env_ms = 0.0
        if np.std(onset_env) > 1e-6 and onset_env.size > 16:
            ac = np.correlate(onset_env, onset_env, mode="full")
            ac = ac[ac.size // 2 :]
            ac = ac / (ac[0] + 1e-9)

            min_lag = max(2, int(0.060 * sr / hop))
            max_lag = min(int(0.750 * sr / hop), ac.size - 1)
            if max_lag > min_lag:
                region = ac[min_lag:max_lag]
                idx = int(np.argmax(region)) + min_lag
                best_env_corr = float(ac[idx])
                best_env_ms = float(idx * hop / sr * 1000.0)

        if best_wave_corr >= best_env_corr:
            return max(0.0, best_wave_corr), best_wave_ms
        return max(0.0, best_env_corr), best_env_ms

    @classmethod
    def _echo_similarity(cls, y: np.ndarray, sr: int) -> float:
        sim, _ = cls._echo_analysis(y, sr)
        return sim


def classify_detailed_subtypes(f: AudioFeatures) -> dict:
    """จำแนก Sub-type เชิงลึกครอบคลุมสาย Shoegaze / Dream Pop / Ambient / Rock / Post-Rock"""
    if f.rms_mean < 1e-4 and f.rms_peak < 1e-3:
        return {
            "effect_type": "CLEAN",
            "sub_type": "Silent / No Signal",
            "parameters": {"GAIN": 0, "TONE": 50, "LEVEL": 0},
            "chain": [],
        }

    ext = f.extra or {}
    flatness = float(ext.get("spectral_flatness", 0.0))
    hf_ratio = float(ext.get("hf_ratio", 0.05))
    clip_ratio = float(ext.get("clipping_ratio", 0.0))
    delay_ms = int(ext.get("delay_ms", 320) or 320)
    centroid_mod = float(ext.get("centroid_mod", 0.0))
    tail_density = float(ext.get("tail_density", 0.3))
    attack_sharpness = float(ext.get("attack_sharpness", 5.0))

    zcr = f.zcr_mean
    crest = f.crest_factor_db
    centroid = f.spectral_centroid_mean_hz
    rt60 = f.rt60_seconds or 0.0
    echo = f.echo_similarity

    tone_knob = int(np.clip((centroid - 500.0) / 3000.0 * 100.0, 10, 95))
    chain = []

    # 1. หมวด Gain / Dirt (Fuzz / Distortion / Overdrive)
    if (zcr >= 0.135 and crest <= 8.8) or clip_ratio >= 0.14 or (zcr >= 0.175):
        if rt60 >= 1.8 or tail_density >= 0.55:
            sub = "Shoegaze Wall of Fuzz (Big Muff Style)"
        elif centroid >= 2200:
            sub = "Silicon Octave / Bright Fuzz"
        elif crest <= 5.5:
            sub = "Gated Velcro Fuzz"
        else:
            sub = "Vintage Warm Germanium Fuzz"
        chain.append({
            "effect_type": "FUZZ",
            "sub_type": sub,
            "parameters": {
                "FUZZ": int(np.clip(zcr / 0.22 * 100, 65, 100)),
                "TONE": tone_knob,
                "SUSTAIN": int(np.clip((12.5 - crest) * 10, 55, 100)),
            },
        })
    elif (zcr >= 0.092 and crest <= 11.5) or (flatness >= 0.024 and zcr >= 0.08):
        if centroid >= 2350:
            sub = "High-Gain Modern Distortion"
        elif centroid <= 1500:
            sub = "Thick Grunge / Doom Distortion"
        else:
            sub = "Hard-Clipping Rock Distortion (RAT / DS)"
        chain.append({
            "effect_type": "DISTORTION",
            "sub_type": sub,
            "parameters": {
                "GAIN": int(np.clip((13.0 - crest) * 10, 50, 95)),
                "TONE": tone_knob,
                "LEVEL": 75,
            },
        })
    elif zcr >= 0.060 and crest <= 13.5:
        if 1100 <= centroid <= 2000:
            sub = "Mid-Hump Tube Overdrive (TS-Style)"
        elif centroid > 2000:
            sub = "Klon / Treble-Boosted Overdrive"
        else:
            sub = "Transparent Warm Overdrive (Bluesbreaker)"
        chain.append({
            "effect_type": "OVERDRIVE",
            "sub_type": sub,
            "parameters": {
                "DRIVE": int(np.clip((14.5 - crest) * 8, 25, 70)),
                "TONE": tone_knob,
                "LEVEL": 72,
            },
        })

    # 2. หมวด Modulation (Chorus / Vibrato / Dream Mod)
    if centroid_mod >= 0.28 and zcr < 0.11 and rt60 < 1.8:
        chain.append({
            "effect_type": "CHORUS",
            "sub_type": "Lush Dream Pop Chorus / Vibrato",
            "parameters": {
                "MIX": int(np.clip(centroid_mod * 160, 35, 85)),
                "TONE": tone_knob,
                "LEVEL": 75,
            },
        })

    # 3. หมวด Delay (Slapback / Tape / Analog / Ambient Multi-tap)
    if echo >= 0.36:
        if delay_ms <= 140:
            d_sub = "Slapback Doubler Echo"
        elif rt60 >= 2.0 and centroid < 1900:
            d_sub = "Space Echo / Tape Wash Delay"
        elif centroid < 1750:
            d_sub = "Warm BBD Analog Delay"
        else:
            d_sub = "Crisp Dotted-8th Digital Delay"
        chain.append({
            "effect_type": "DELAY",
            "sub_type": d_sub,
            "parameters": {
                "TIME": int(np.clip(delay_ms, 60, 850)),
                "FEEDBACK": int(np.clip(echo * 95, 25, 88)),
                "MIX": int(np.clip(echo * 82, 25, 78)),
            },
        })

    # 4. หมวด Reverb เชิงลึก (Dream / Cloud / Soft-Focus / Shimmer / Reverse / Hall / Plate / Spring)
    if rt60 >= 0.70:
        if rt60 >= 2.3 and hf_ratio >= 0.12 and centroid >= 2100:
            r_sub = "Shimmer / Pitch-Octave Ambient Reverb"
        elif rt60 >= 2.0 and attack_sharpness <= 3.3:
            r_sub = "Soft-Focus / Reverse Shoegaze Reverb"
        elif rt60 >= 2.1 and (tail_density >= 0.48 or centroid < 1650 or centroid_mod >= 0.18):
            r_sub = "Dream / Cloud Lush Modulated Reverb"
        elif rt60 >= 2.8:
            r_sub = "Ambient Cathedral Reverb"
        elif rt60 >= 1.85:
            r_sub = "Large Concert Hall Reverb"
        elif rt60 >= 1.25:
            r_sub = "Studio Plate Reverb" if centroid >= 1950 else "Warm Chamber Reverb"
        else:
            r_sub = "Vintage Tank Spring Reverb" if centroid >= 2100 else "Natural Studio Room Reverb"

        decay_val = int(np.clip((rt60 / 4.5) * 100, 20, 98))
        mix_val = int(np.clip(tail_density * 95 + 15, 25, 88))
        chain.append({
            "effect_type": "REVERB",
            "sub_type": r_sub,
            "parameters": {
                "DECAY": decay_val,
                "MIX": mix_val,
                "TONE": tone_knob,
            },
        })

    if not chain:
        c_sub = "Dreamy Compressed Clean" if crest < 11.5 else ("Sparkling Bright Clean" if centroid >= 1950 else "Warm Jazz Neck Clean")
        chain.append({
            "effect_type": "CLEAN",
            "sub_type": c_sub,
            "parameters": {"GAIN": 22, "TONE": tone_knob, "LEVEL": 75},
        })

    primary = chain[0]
    return {
        "effect_type": primary["effect_type"],
        "sub_type": primary["sub_type"],
        "parameters": primary["parameters"],
        "chain": chain,
    }


def quick_classify(f: AudioFeatures) -> str:
    if f.rms_mean < 1e-4 and f.rms_peak < 1e-3:
        return "silence"
    if f.zcr_mean > 0.12 and f.crest_factor_db < 12.0:
        return "fuzz/distortion"
    if f.echo_similarity > 0.45:
        return "delay"
    if f.rt60_seconds is not None and f.rt60_seconds > 0.75:
        return "reverb"
    return "clean"