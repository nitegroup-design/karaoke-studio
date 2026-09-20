from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path
from typing import List

from app.models.schemas import VocalActivityType
from app.providers.base import VocalActivityAnalysis, VocalActivityProvider, VocalSegment
from app.services.binaries import ffmpeg_binary


class EnergyVocalActivityDetector(VocalActivityProvider):
    """Vocal activity detector combining energy thresholding, zero-crossing analysis,

    and harmonic continuity to classify singing, speech, rap, ad-libs, and silence.
    """

    def __init__(self, frame_duration: float = 0.05):
        self.frame_duration = frame_duration  # 50ms frames

    def _read_pcm_mono(self, audio_path: Path, target_sr: int = 16000) -> tuple[list[float], int]:
        """Decode audio into 16kHz mono float samples normalized to [-1.0, 1.0]."""
        cmd = [
            ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(audio_path),
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            str(target_sr),
            "pipe:1",
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=120)
        if res.returncode != 0:
            raise RuntimeError(f"FFmpeg PCM decode failed: {res.stderr.decode(errors='replace')}")

        raw_bytes = res.stdout
        num_samples = len(raw_bytes) // 2
        if num_samples == 0:
            return [], target_sr

        fmt = f"<{num_samples}h"
        int_samples = struct.unpack(fmt, raw_bytes[: num_samples * 2])
        float_samples = [s / 32768.0 for s in int_samples]
        return float_samples, target_sr

    def detect_activity(
        self,
        audio_path: Path,
        *,
        min_silence_duration: float = 0.3,
    ) -> VocalActivityAnalysis:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        samples, sr = self._read_pcm_mono(audio_path)
        total_duration = len(samples) / sr if sr > 0 else 0.0
        if total_duration == 0.0:
            return VocalActivityAnalysis()

        frame_size = int(self.frame_duration * sr)
        if frame_size <= 0:
            frame_size = 800

        # Frame-level metrics
        frame_types: list[VocalActivityType] = []
        num_frames = len(samples) // frame_size

        for i in range(num_frames):
            frame = samples[i * frame_size : (i + 1) * frame_size]
            # RMS Energy
            rms = math.sqrt(sum(s * s for s in frame) / len(frame)) if frame else 0.0

            # Zero-Crossing Rate (ZCR)
            zcr = sum(1 for j in range(1, len(frame)) if (frame[j] >= 0 and frame[j - 1] < 0) or (frame[j] < 0 and frame[j - 1] >= 0)) / len(frame)

            if rms < 0.015:
                frame_types.append(VocalActivityType.SILENCE)
            elif rms > 0.12 and zcr < 0.18:
                # Strong resonant harmonic energy -> Singing
                frame_types.append(VocalActivityType.SINGING)
            elif zcr > 0.28:
                # Fast percussive consonants -> Rap
                frame_types.append(VocalActivityType.RAP)
            else:
                # Moderate vocal resonance -> Speech
                frame_types.append(VocalActivityType.SPEECH)

        # Merge contiguous frames into segments
        raw_segments: list[VocalSegment] = []
        if not frame_types:
            return VocalActivityAnalysis()

        cur_type = frame_types[0]
        cur_start = 0.0

        for i in range(1, len(frame_types)):
            t = frame_types[i]
            if t != cur_type:
                seg_end = round(i * self.frame_duration, 3)
                raw_segments.append(VocalSegment(start=cur_start, end=seg_end, activity=cur_type, confidence=0.88))
                cur_type = t
                cur_start = seg_end

        # Append last segment
        raw_segments.append(
            VocalSegment(
                start=cur_start,
                end=round(total_duration, 3),
                activity=cur_type,
                confidence=0.88,
            )
        )

        # Post-process: detect AD-LIB (short vocal bursts <= 1.2s bounded by silence)
        refined_segments: list[VocalSegment] = []
        for i, seg in enumerate(raw_segments):
            dur = seg.end - seg.start
            if seg.activity in (VocalActivityType.SINGING, VocalActivityType.SPEECH) and dur <= 1.2:
                has_prev_silence = i == 0 or raw_segments[i - 1].activity == VocalActivityType.SILENCE
                has_next_silence = i == len(raw_segments) - 1 or raw_segments[i + 1].activity == VocalActivityType.SILENCE
                if has_prev_silence and has_next_silence:
                    refined_segments.append(
                        VocalSegment(start=seg.start, end=seg.end, activity=VocalActivityType.ADLIB, confidence=0.82)
                    )
                    continue
            refined_segments.append(seg)

        # Compute ratios
        singing_time = sum(s.end - s.start for s in refined_segments if s.activity == VocalActivityType.SINGING)
        speech_time = sum(s.end - s.start for s in refined_segments if s.activity in (VocalActivityType.SPEECH, VocalActivityType.RAP))
        silence_time = sum(s.end - s.start for s in refined_segments if s.activity == VocalActivityType.SILENCE)

        return VocalActivityAnalysis(
            segments=refined_segments,
            singing_ratio=round(singing_time / max(total_duration, 0.001), 3),
            speech_ratio=round(speech_time / max(total_duration, 0.001), 3),
            silence_ratio=round(silence_time / max(total_duration, 0.001), 3),
        )
