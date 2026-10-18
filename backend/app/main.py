"""FastAPI entrypoint for FxGaze (Phase 1).

Run:  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_analyze import router as analyze_router
from app.config import settings

app = FastAPI(
    title="FxGaze API",
    version="1.0.0",
    description="AI-Powered Guitar Effect Analyzer backend",
)

# The frontend runs on localhost (3000); per NFR-03 no external origins needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api")


@app.on_event("startup")
async def _startup() -> None:
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.results_dir).mkdir(parents=True, exist_ok=True)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "fxgaze", "version": "1.0.0"}
