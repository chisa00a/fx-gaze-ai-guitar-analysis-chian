"""Optional guitar stem separation (FR-03) using demucs.

Heavy dependency (torch); installed lazily only when FXGAZE_ENABLE_DEMUCS=1.
If demucs/torch is unavailable the caller falls back to analysing the full mix.
"""
from __future__ import annotations

import shutil
from pathlib import Path


def separate_guitar(input_path: str, out_dir: str) -> str:
    """Return path to the extracted guitar stem, or the original file on failure."""
    src = Path(input_path)
    try:
        import torch  # noqa: F401  (import check only)
        from demucs.api import Separator
    except Exception:
        return input_path

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    try:
        separator = Separator(model="htdemucs", progress=False)
        _, stems = separator.separate_audio_file(str(src))
        guitar = stems.get("guitar") or stems.get("other")
        if guitar is None:
            return input_path
        dest = out / f"{src.stem}_guitar.wav"
        separator.save_audio_file(dest, [list(stems.keys()).index(
            "guitar" if "guitar" in stems else "other")])
        shutil.rmtree(out / src.stem, ignore_errors=True)  # clean other stems
        return str(dest)
    except Exception:
        return input_path
