"""End-to-end analysis pipeline running inside a Celery task.

upload -> (guitar stem separation, optional) -> feature extraction (librosa)
       -> Pathumma 8B inference (Ollama) -> structured JSON result
"""
from __future__ import annotations

import traceback
from pathlib import Path

from app.celery_app import app
from app.ai.pathumma import PathummaAnalyzer
from app.audio.extractor import AudioFeatureExtractor
from app.config import settings


@app.task(name="fxgaze.analyze_pipeline", bind=True, max_retries=1)
def analyze_pipeline(
    self,
    filename: str,
    start: float = 0.0,
    end: float | None = None,
) -> dict:
    path = Path(settings.upload_dir) / filename
    try:
        if not path.exists():
            return {"status": "failed", "error": f"file not found: {filename}"}

        working = str(path)
        if settings.enable_demucs:
            from app.audio.stem import separate_guitar  # lazy heavy import

            working = separate_guitar(working, settings.results_dir)

        extractor = AudioFeatureExtractor()
        y = extractor.load(working, start=start, end=end)
        features = extractor.extract(y)

        analyzer = PathummaAnalyzer()
        verdict = analyzer.analyze(features)

        return {"status": "completed", "features": features.to_dict(), "ai": verdict}
    except Exception as exc:  # keep the API answer structured (Phase 6)
        return {
            "status": "failed",
            "error": str(exc),
            "traceback": traceback.format_exc(limit=3),
        }
