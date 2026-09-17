"""Application paths and runtime defaults."""

from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
FONTS_DIR = BASE_DIR / "assets" / "fonts"
UPLOADS_DIR = Path(os.getenv("KARAOKE_UPLOADS_DIR", BASE_DIR / "uploads")).resolve()
OUTPUTS_DIR = Path(os.getenv("KARAOKE_OUTPUTS_DIR", BASE_DIR / "outputs")).resolve()
DATABASE_PATH = Path(
    os.getenv("KARAOKE_DATABASE_PATH", BASE_DIR / "karaoke_studio.db")
).resolve()

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PRESETS = {"quality": "large-v3", "draft": "small"}

# Compatibility for old imports. Runtime state now lives in SQLite.
PROCESSING_STATUS: dict[str, dict] = {}
