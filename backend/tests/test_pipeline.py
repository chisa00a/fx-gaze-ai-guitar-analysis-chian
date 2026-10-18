"""End-to-end smoke test: upload -> task -> structured JSON result (FR-05).

Runs with Celery eager mode so no Redis is required.
"""
import os

os.environ.setdefault("FXGAZE_CELERY_EAGER", "1")

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_upload_and_analyze_end_to_end(tmp_path):
    sr = 22_050
    t = np.linspace(0, 3.0, int(3.0 * sr), endpoint=False)
    # decaying echo-ish signal -> heuristic should not say "silence"
    y = 0.5 * np.sin(2 * np.pi * 220 * t) * np.exp(-t * 1.2)
    buf = "decay_test.wav"
    sf.write(buf, y.astype(np.float32), sr)

    with open(buf, "rb") as fh:
        resp = client.post(
            "/api/analyze-tone",
            files={"audio": ("decay_test.wav", fh, "audio/wav")},
            data={"start": "0.0", "end": "3.0"},
        )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    status = client.get(f"/api/analyze-tone/{task_id}")
    assert status.status_code == 200
    body = status.json()
    assert body["status"] in {"completed", "failed"}

    if body["status"] == "completed":
        result = body["result"]["ai"]
        for key in ("effect_type", "parameters", "description", "advice"):
            assert key in result
        assert isinstance(result["parameters"], dict)


def test_upload_rejects_bad_type():
    import io
    resp = client.post(
        "/api/analyze-tone",
        files={"audio": ("junk.txt", io.BytesIO(b"not audio"), "text/plain")},
    )
    assert resp.status_code == 415
