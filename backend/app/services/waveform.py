"""Waveform peak extraction for WaveSurfer without loading full audio in Python."""

from __future__ import annotations

import array
import subprocess
from pathlib import Path
from functools import lru_cache
from typing import Iterable

from app.services.binaries import ffmpeg_binary

def decode_mono_samples(path: Path, sample_rate: int = 4000) -> array.array:
    completed = subprocess.run(
        [
            ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "s16le",
            "pipe:1",
        ],
        capture_output=True,
        timeout=300,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"FFmpeg waveform decode failed: {completed.stderr.decode(errors='replace')[-2000:]}")
    samples = array.array("h")
    samples.frombytes(completed.stdout)
    return samples


def calculate_peaks(samples: Iterable[int], points: int) -> list[float]:
    values = samples if isinstance(samples, (list, tuple, array.array)) else list(samples)
    if not values:
        return []
    points = min(max(1, points), len(values))
    bucket_size = len(values) / points
    peaks: list[float] = []
    for index in range(points):
        start = int(index * bucket_size)
        end = max(start + 1, int((index + 1) * bucket_size))
        maximum = max(abs(value) for value in values[start:end])
        peaks.append(round(maximum / 32768.0, 5))
    return peaks


@lru_cache(maxsize=24)
def _cached_waveform(path: str, modified_ns: int, size: int, points: int) -> dict:
    # Only the small peak array is retained. File fingerprint invalidates replaced stems.
    sample_rate = 4000
    samples = decode_mono_samples(Path(path), sample_rate=sample_rate)
    peaks = calculate_peaks(samples, points)
    return {
        "duration": round(len(samples) / sample_rate, 3),
        "sample_rate": sample_rate,
        "points": peaks,
        "peaks": peaks,
    }


def waveform_data(path: Path, points: int) -> dict:
    resolved = path.resolve()
    stat = resolved.stat()
    return _cached_waveform(str(resolved), stat.st_mtime_ns, stat.st_size, min(20000, max(32, points)))
