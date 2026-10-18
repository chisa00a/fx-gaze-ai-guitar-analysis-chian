"""Pydantic schemas shared by the API routes."""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class AnalyzeAccepted(BaseModel):
    task_id: str = Field(..., examples=["c0a80101-7e..."])
    status: str = "queued"


class AnalysisStatus(BaseModel):
    task_id: str
    status: str  # queued | processing | completed | failed
    result: Optional[Dict[str, Any]] = None
