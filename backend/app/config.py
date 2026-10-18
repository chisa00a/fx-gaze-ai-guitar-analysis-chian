"""FxGaze backend configuration.

All settings come from environment variables so the same code runs both in
development and production. Per NFR-03 the default posture is: everything
local, no cloud calls.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # --- Storage -----------------------------------------------------------
    upload_dir: str = os.environ.get("FXGAZE_UPLOAD_DIR", ".uploads")
    results_dir: str = os.environ.get("FXGAZE_RESULTS_DIR", ".results")

    # --- Celery / Redis (NFR-02 asynchronous processing) --------------------
    broker_url: str = os.environ.get("FXGAZE_BROKER_URL", "redis://localhost:6379/0")
    result_backend: str = os.environ.get("FXGAZE_RESULT_BACKEND", "redis://localhost:6379/1")
    # When True (or when Redis is unreachable) Celery runs tasks eagerly in the
    # API process. Useful for smoke tests / machines without a Redis server.
    celery_eager: bool = _env_bool("FXGAZE_CELERY_EAGER", False)

    # --- Audio analysis limits (NFR-01: <= 15s clips) -----------------------
    max_audio_seconds: float = float(os.environ.get("FXGAZE_MAX_AUDIO_SECONDS", "15"))
    max_upload_bytes: int = int(os.environ.get("FXGAZE_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    allowed_audio_types: tuple[str, ...] = (".wav", ".mp3", ".webm", ".flac", ".ogg", ".m4a")

    # --- Ollama / Pathumma 8B (FR-05, NFR-03 local inference) ---------------
    ollama_base_url: str = os.environ.get("FXGAZE_OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.environ.get("FXGAZE_OLLAMA_MODEL", "pathumma-thaillm-8b-think:Q4_K_M")
    ollama_timeout: float = float(os.environ.get("FXGAZE_OLLAMA_TIMEOUT", "120"))

    # --- Optional stem separation (FR-03, demucs) ---------------------------
    enable_demucs: bool = _env_bool("FXGAZE_ENABLE_DEMUCS", False)


settings = Settings()
