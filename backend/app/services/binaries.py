"""Resolve media binaries for portable Windows/local development installs."""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from app.config import BASE_DIR


@lru_cache(maxsize=1)
def ffmpeg_binary() -> str:
    configured = os.getenv("KARAOKE_FFMPEG_PATH")
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))

    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
    except Exception:
        pass

    on_path = shutil.which("ffmpeg")
    if on_path:
        candidates.append(Path(on_path))
    candidates.extend([BASE_DIR / "bin" / "ffmpeg.exe", BASE_DIR / "ffmpeg.exe"])

    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        capcut = Path(local_app_data) / "CapCut" / "Apps"
        if capcut.exists():
            candidates.extend(
                sorted(capcut.glob("*/ffmpeg.exe"), key=lambda path: path.stat().st_mtime, reverse=True)
            )
    program_files = os.getenv("ProgramFiles")
    if program_files:
        candidates.append(Path(program_files) / "SteelSeries" / "GG" / "apps" / "moments" / "ffmpeg.exe")

    for candidate in candidates:
        if candidate.is_file():
            resolved = str(candidate.resolve())
            ffmpeg_dir = str(candidate.parent.resolve())
            if ffmpeg_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = f"{ffmpeg_dir};" + os.environ.get("PATH", "")
            return resolved
    raise FileNotFoundError(
        "FFmpeg was not found. Add it to PATH or set KARAOKE_FFMPEG_PATH to ffmpeg.exe."
    )


@lru_cache(maxsize=1)
def ffprobe_binary() -> Optional[str]:
    configured = os.getenv("KARAOKE_FFPROBE_PATH")
    if configured and Path(configured).is_file():
        return str(Path(configured).resolve())

    on_path = shutil.which("ffprobe")
    if on_path:
        return str(Path(on_path).resolve())

    # Try next to ffmpeg
    try:
        ffmpeg_path = Path(ffmpeg_binary())
        neighbor = ffmpeg_path.parent / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if neighbor.is_file():
            return str(neighbor.resolve())
    except Exception:
        pass
    return None


# Automatically configure PATH on module import
try:
    ffmpeg_binary()
except Exception:
    pass

