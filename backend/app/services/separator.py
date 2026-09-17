from __future__ import annotations

import subprocess
import sys
from typing import Callable, Optional

from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app.services.storage import StudioStore, store


def find_stem(song_id: str, name: str):
    song_dir = OUTPUTS_DIR / song_id
    matches = list(song_dir.glob(f"htdemucs/*/{name}")) if song_dir.exists() else []
    return matches[0] if matches else None


def separate_vocals(
    song_id: str,
    file_name: str,
    *,
    storage: StudioStore = store,
    report: Optional[Callable[[float, str], None]] = None,
) -> dict[str, str]:
    """Run Demucs once, reusing existing valid stems on subsequent requests."""
    existing_vocals = find_stem(song_id, "vocals.wav")
    existing_instrumental = find_stem(song_id, "no_vocals.wav")
    if existing_vocals and existing_instrumental:
        storage.update_stage(song_id, "separation", "done", progress=100, message="Using existing stems")
        return {"vocals": str(existing_vocals), "instrumental": str(existing_instrumental), "reused": "true"}

    storage.update_stage(song_id, "separation", "processing", progress=5, message="Starting Demucs")
    if report:
        report(0.05, "Separating vocals with Demucs")
    try:
        input_file = UPLOADS_DIR / file_name
        if not input_file.exists():
            raise FileNotFoundError(f"Uploaded audio not found: {file_name}")
        output_dir = OUTPUTS_DIR / song_id
        output_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            sys.executable,
            "-m",
            "demucs",
            "--two-stems",
            "vocals",
            "-n",
            "htdemucs",
            "-o",
            str(output_dir),
            str(input_file),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if result.returncode != 0:
            error_msg = (result.stderr or result.stdout or "unknown Demucs error").strip()
            raise RuntimeError(f"Demucs failed (code {result.returncode}): {error_msg[-4000:]}")

        vocals = find_stem(song_id, "vocals.wav")
        instrumental = find_stem(song_id, "no_vocals.wav")
        if not vocals or not instrumental:
            raise RuntimeError("Demucs completed but expected stem files were not created")
        storage.update_stage(song_id, "separation", "done", progress=100, message="Stems ready")
        if report:
            report(1.0, "Vocal separation complete")
        return {"vocals": str(vocals), "instrumental": str(instrumental), "reused": "false"}
    except Exception as exc:
        storage.update_stage(song_id, "separation", "error", progress=100, error=str(exc), message="Demucs failed")
        raise
