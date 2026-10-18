"""HTTP API for tone analysis (Phase 1 / FR-01, NFR-02).

POST /api/analyze-tone        -> accept upload or recorded blob, queue task
GET  /api/analyze-tone/{id}   -> poll task status/result
"""
from __future__ import annotations

import pathlib
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.celery_app import app as celery_app
from app.config import settings
from app.schemas import AnalyzeAccepted, AnalysisStatus
from app.tasks import pipeline as pipeline_module

router = APIRouter()

# In eager (Redis-less) mode tasks finish synchronously inside the API
# process; their results never reach a shared backend, so we memoize them
# here. With a real broker/worker the AsyncResult lookup below is used.
_EAGER_RESULTS: dict[str, dict] = {}


def _persist_upload(audio: UploadFile) -> str:
    suffix = pathlib.Path(audio.filename or "").suffix.lower() or ".wav"
    if suffix not in settings.allowed_audio_types:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported audio type '{suffix}'. allowed: {', '.join(settings.allowed_audio_types)}",
        )
    task_id = str(uuid.uuid4())
    upload_dir = pathlib.Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    pathlib.Path(settings.results_dir).mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"{task_id}{suffix}"
    size = 0
    with dest.open("wb") as fh:
        while chunk := audio.file.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_bytes:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file too large")
            fh.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="empty upload")
    audio.file.close()
    return dest.name


@router.post("/analyze-tone", response_model=AnalyzeAccepted, status_code=202)
async def analyze_tone(
    audio: UploadFile = File(...),
    start: Optional[float] = Form(None),
    end: Optional[float] = Form(None),
) -> AnalyzeAccepted:
    """Queue an analysis job. Frontend polls the returned task id (NFR-02)."""
    filename = _persist_upload(audio)
    task = pipeline_module.analyze_pipeline.apply_async(
        args=[filename], kwargs={"start": float(start or 0.0), "end": end}
    )
    if task.ready():
        _EAGER_RESULTS[str(task.id)] = task.result
    return AnalyzeAccepted(task_id=task.id, status="queued")


@router.get("/analyze-tone/{task_id}", response_model=AnalysisStatus)
async def analyze_status(task_id: str) -> AnalysisStatus:
    if task_id in _EAGER_RESULTS:
        payload = _EAGER_RESULTS[task_id]
        status = "completed"
        if isinstance(payload, dict) and payload.get("status") == "failed":
            status = "failed"
        return AnalysisStatus(task_id=task_id, status=status, result=payload)

    result = celery_app.AsyncResult(task_id)
    state_map = {"PENDING": "queued", "STARTED": "processing", "SUCCESS": "completed",
                 "FAILURE": "failed", "RETRY": "processing"}
    status = state_map.get(result.state, result.state.lower())
    payload = None
    if result.successful():
        payload = result.result if isinstance(result.result, dict) else None
        if payload and payload.get("status") == "failed":
            status = "failed"
    elif result.failed():
        payload = {"error": str(result.result)}
    return AnalysisStatus(task_id=task_id, status=status, result=payload)
