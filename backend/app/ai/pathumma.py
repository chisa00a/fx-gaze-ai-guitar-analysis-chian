"""Pathumma 8B inference engine (Phase 3 / FR-05).

Ensures 100% parameter consistency between knob values, signal chain order
(Input -> Drive/Fuzz -> Modulation -> Delay -> Reverb -> Amp), and text insights.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import httpx
import numpy as np

from app.audio.extractor import (
    AudioFeatures,
    classify_detailed_subtypes,
    quick_classify,
)
from app.config import settings

# ลำดับการต่อก้อนเอฟเฟกต์มาตรฐานจากหน้าไปหลัง (Guitar In -> Amp Out)
CHAIN_ORDER = {
    "clean": 1,
    "overdrive": 2,
    "fuzz": 3,
    "distortion": 4,
    "chorus": 5,
    "delay": 6,
    "reverb": 7,
}

SYSTEM_PROMPT = """คุณคือวิศวกรเสียงกีตาร์ของระบบ FxGaze
คุณจะได้รับข้อมูล Signal Chain และค่าปุ่มหมุน (parameters) ที่คำนวณจาก DSP
หน้าที่ของคุณคือปรับแต่งคำอธิบาย (description) และคำแนะนำ (advice) ภาษาไทยให้กระชับ เข้าใจง่าย และตัวเลขต้องตรงกับค่าปุ่มหมุนที่ได้รับเท่านั้น

กติกา:
1. ตอบเป็น JSON เท่านั้น ห้ามใช้ markdown code fence
2. JSON ต้องมี key: effect_type, sub_type, parameters, description, advice
"""


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)


class PathummaAnalyzer:
    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout = settings.ollama_timeout

    def analyze(self, features: AudioFeatures) -> Dict[str, Any]:
        # คำนวณค่าจริงจาก DSP เป็นหลักเพื่อให้ตัวเลขปุ่มหมุนและ Signal Chain แม่นยำและตรงกันเสมอ
        dsp_result = self._heuristic_fallback(features)
        prompt = self._user_prompt(features, dsp_result)

        try:
            response = httpx.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                    "think": False,
                    "format": "json",
                    "options": {"temperature": 0.1, "num_predict": 400},
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            content = response.json()["message"]["content"]
            parsed = _extract_json(_strip_think(content)) or _extract_json(content)

            if parsed and self._validate(parsed):
                # ใช้ค่า parameters และ effect_chain จาก DSP เพื่อไม่ให้ AI แต่งตัวเลขขัดแย้งกับหน้าปัด
                dsp_result["description"] = parsed.get("description", dsp_result["description"])
                dsp_result["advice"] = parsed.get("advice", dsp_result["advice"])
                dsp_result["model_used"] = self.model
                dsp_result["source"] = "pathumma"
                dsp_result.pop("error", None)
                return dsp_result
        except Exception:
            pass

        dsp_result["model_used"] = "fallback-heuristic"
        dsp_result["source"] = "fallback"
        return dsp_result

    @staticmethod
    def _user_prompt(features: AudioFeatures, dsp_baseline: Dict[str, Any]) -> str:
        chain_desc = " -> ".join(
            f"{idx + 1}. {c['effect_type'].upper()} ({c['sub_type']}) ค่าปุ่ม={c['parameters']}"
            for idx, c in enumerate(dsp_baseline.get("effect_chain", []))
        )
        return (
            f"Signal Chain ที่ตรวจพบ (เรียงจากกีตาร์ไปแอมป์): {chain_desc}\n"
            f"ค่าฟิสิกส์: ZCR={features.zcr_mean}, RT60={features.rt60_seconds}s, "
            f"Centroid={features.spectral_centroid_mean_hz}Hz, Crest={features.crest_factor_db}dB\n"
            f"โปรดสรุป description และ advice สั้นๆ โดยอ้างอิงตัวเลขปุ่มหมุนข้างต้นตามจริง"
        )

    @staticmethod
    def _validate(data: Dict[str, Any]) -> bool:
        if not isinstance(data.get("effect_type"), str):
            return False
        if not isinstance(data.get("parameters"), dict):
            return False
        data["effect_type"] = data["effect_type"].strip().lower()
        cleaned: Dict[str, Any] = {}
        for key, value in data["parameters"].items():
            try:
                num = float(value)
            except (TypeError, ValueError):
                cleaned[key] = str(value)
                continue
            cleaned[key] = max(0, min(100, round(num)))
        data["parameters"] = cleaned
        return isinstance(data.get("description"), str) and isinstance(
            data.get("advice"), str
        )

    @classmethod
    def _heuristic_fallback(cls, f: AudioFeatures) -> Dict[str, Any]:
        if f.rms_mean < 1e-4 and f.rms_peak < 1e-3:
            return {
                "effect_type": "clean",
                "sub_type": "No Signal",
                "parameters": {},
                "effect_chain": [],
                "description": "สัญญาณเงียบเกินไป ไม่สามารถวิเคราะห์ได้",
                "advice": "เพิ่ม Gain บน Audio Interface แล้วลองอีกครั้ง",
                "error": "AI model offline — heuristic analysis used",
            }

        detailed = (f.extra or {}).get("sub_classification")
        if not detailed:
            detailed = classify_detailed_subtypes(f)

        quick_label = quick_classify(f)
        raw_chain: List[Dict[str, Any]] = detailed.get("chain", [])

        normalized_chain: List[Dict[str, Any]] = []
        for node in raw_chain:
            eff = node["effect_type"].lower()
            norm_params: Dict[str, int] = {}
            for k, v in node.get("parameters", {}).items():
                if k.upper() == "TIME" and v > 100:
                    norm_params["time"] = int(np.clip((v - 60) / 740 * 100, 5, 100))
                else:
                    norm_params[k.lower()] = int(np.clip(round(float(v)), 0, 100))
            normalized_chain.append({
                "effect_type": eff,
                "sub_type": node["sub_type"],
                "parameters": norm_params,
            })

        # เรียงลำดับก้อนจากหน้าไปหลัง (Guitar -> Drive/Fuzz -> Delay -> Reverb -> Amp)
        normalized_chain.sort(key=lambda item: CHAIN_ORDER.get(item["effect_type"], 99))

        if not (f.extra or {}).get("sub_classification") and normalized_chain:
            if quick_label == "fuzz/distortion" and normalized_chain[0]["effect_type"] not in ("fuzz", "distortion", "overdrive"):
                normalized_chain[0]["effect_type"] = "fuzz"
                normalized_chain[0]["sub_type"] = "Silicon Fuzz"
            elif quick_label == "delay" and normalized_chain[0]["effect_type"] != "delay":
                normalized_chain[0]["effect_type"] = "delay"
                normalized_chain[0]["sub_type"] = "Digital Delay"
            elif quick_label == "reverb" and normalized_chain[0]["effect_type"] != "reverb":
                normalized_chain[0]["effect_type"] = "reverb"
                normalized_chain[0]["sub_type"] = "Hall Reverb"

        primary = normalized_chain[0]
        description, advice = cls._craft_consistent_insights(normalized_chain, f)

        return {
            "effect_type": primary["effect_type"],
            "sub_type": primary["sub_type"],
            "parameters": primary["parameters"],
            "effect_chain": normalized_chain,
            "description": description,
            "advice": advice,
            "error": "AI model offline — heuristic analysis used",
        }

    @staticmethod
    def _craft_consistent_insights(
        chain: List[Dict[str, Any]], f: AudioFeatures
    ) -> tuple[str, str]:
        """สร้างคำอธิบายและคำแนะนำที่มีตัวเลขตรงกับค่าปุ่มหมุนใน chain ทุกก้อน 100%"""
        chain_steps = []
        advice_steps = []

        for idx, node in enumerate(chain, start=1):
            eff = node["effect_type"].upper()
            sub = node["sub_type"]
            params = node["parameters"]
            param_str = ", ".join(f"{k.upper()} {v}%" for k, v in params.items())
            chain_steps.append(f"[{idx}] {eff} ({sub}: {param_str})")

            if eff in ("FUZZ", "DISTORTION", "OVERDRIVE"):
                drive_key = "fuzz" if "fuzz" in params else ("gain" if "gain" in params else "drive")
                d_val = params.get(drive_key, 50)
                t_val = params.get("tone", 50)
                advice_steps.append(
                    f"ก้อนที่ {idx} ({sub}) ตั้ง {drive_key.upper()} ไว้ที่ {d_val}% และ TONE {t_val}%"
                )
            elif eff == "DELAY":
                t_val = params.get("time", 45)
                fb_val = params.get("feedback", 40)
                advice_steps.append(
                    f"ก้อนที่ {idx} ({sub}) ตั้ง TIME {t_val}% และ FEEDBACK {fb_val}%"
                )
            elif eff == "REVERB":
                dec_val = params.get("decay", 50)
                mix_val = params.get("mix", 40)
                advice_steps.append(
                    f"ก้อนที่ {idx} ({sub}) ปิดท้ายหางเสียงด้วย DECAY {dec_val}% และ MIX {mix_val}%"
                )
            else:
                advice_steps.append(f"ก้อนที่ {idx} ({sub}) ตั้งค่า {param_str}")

        desc = " ➔ ".join(chain_steps)
        adv = (
            "ลำดับการต่อบอร์ดจากหน้าไปหลัง: "
            + " ส่งต่อไปยัง ".join(advice_steps)
            + f" (วัดค่า RT60 ได้ {f.rt60_seconds:.2f}s, Centroid {f.spectral_centroid_mean_hz:.0f}Hz)"
            if f.rt60_seconds is not None
            else "ลำดับการต่อบอร์ด: " + " ส่งต่อไปยัง ".join(advice_steps)
        )
        return desc, adv