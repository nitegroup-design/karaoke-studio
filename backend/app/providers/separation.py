from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import List, Optional

from app.providers.base import SeparationProvider, SeparationResult


class DemucsSeparationProvider(SeparationProvider):
    """Vocal separation provider powered by Demucs (Hybrid Transformer Demucs)."""

    def __init__(self, model_name: str = "htdemucs"):
        self.model_name = model_name

    def separate(
        self,
        audio_path: Path,
        output_dir: Path,
        *,
        device: str = "cpu",
        stems: Optional[List[str]] = None,
    ) -> SeparationResult:
        if not audio_path.exists():
            raise FileNotFoundError(f"Input audio file not found: {audio_path}")

        output_dir.mkdir(parents=True, exist_ok=True)
        two_stems_flag = ["--two-stems", "vocals"] if stems == ["vocals"] or stems is None else []

        cmd = [
            sys.executable,
            "-m",
            "demucs",
            *two_stems_flag,
            "-n",
            self.model_name,
            "-d",
            device,
            "-o",
            str(output_dir),
            str(audio_path),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "Demucs separation failed").strip()
            raise RuntimeError(f"Demucs failed (code {result.returncode}): {err[-2000:]}")

        # Stems are stored in output_dir / model_name / audio_stem_name /
        stem_dirs = list(output_dir.glob(f"{self.model_name}/*"))
        if not stem_dirs:
            raise RuntimeError(f"Demucs finished but output directory {self.model_name} was not found")

        stem_dir = stem_dirs[0]
        vocals = stem_dir / "vocals.wav"
        instrumental = stem_dir / "no_vocals.wav"

        all_stems: dict[str, Path] = {}
        for f in stem_dir.glob("*.wav"):
            all_stems[f.stem] = f

        return SeparationResult(
            vocals_path=vocals,
            instrumental_path=instrumental,
            stems=all_stems,
            model_name=self.model_name,
        )
