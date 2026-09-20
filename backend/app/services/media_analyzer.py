from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.services.binaries import ffmpeg_binary, ffprobe_binary


@dataclass
class MediaAnalysisResult:
    duration: float
    sample_rate: int = 44100
    channels: int = 2
    bitrate: Optional[int] = None
    codec: str = "unknown"
    format_name: str = "unknown"
    fps: Optional[float] = None
    resolution: Optional[str] = None
    has_video: bool = False
    audio_tracks_count: int = 1
    subtitle_tracks_count: int = 0


def analyze_media(media_path: Path) -> MediaAnalysisResult:
    """Analyze media container, streams, codecs, and durations using FFprobe or FFmpeg."""
    if not media_path.exists():
        raise FileNotFoundError(f"Media file does not exist: {media_path}")

    probe_exe = ffprobe_binary()
    if probe_exe:
        cmd = [
            probe_exe,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(media_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if res.returncode == 0 and res.stdout.strip():
            try:
                data = json.loads(res.stdout)
                fmt = data.get("format", {})
                duration = float(fmt.get("duration", 0.0))
                bitrate = int(fmt.get("bit_rate")) if fmt.get("bit_rate") else None
                format_name = fmt.get("format_name", "unknown")

                streams = data.get("streams", [])
                audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
                video_streams = [s for s in streams if s.get("codec_type") == "video"]
                sub_streams = [s for s in streams if s.get("codec_type") == "subtitle"]

                sample_rate = 44100
                channels = 2
                codec = "unknown"
                if audio_streams:
                    first_a = audio_streams[0]
                    sample_rate = int(first_a.get("sample_rate", 44100))
                    channels = int(first_a.get("channels", 2))
                    codec = first_a.get("codec_name", "unknown")

                has_video = len(video_streams) > 0
                fps = None
                resolution = None
                if has_video:
                    v = video_streams[0]
                    w = v.get("width")
                    h = v.get("height")
                    if w and h:
                        resolution = f"{w}x{h}"
                    r_frame_rate = v.get("r_frame_rate", "")
                    if "/" in r_frame_rate:
                        num, den = r_frame_rate.split("/", 1)
                        try:
                            if float(den) > 0:
                                fps = round(float(num) / float(den), 2)
                        except (ValueError, ZeroDivisionError):
                            pass

                return MediaAnalysisResult(
                    duration=duration,
                    sample_rate=sample_rate,
                    channels=channels,
                    bitrate=bitrate,
                    codec=codec,
                    format_name=format_name,
                    fps=fps,
                    resolution=resolution,
                    has_video=has_video,
                    audio_tracks_count=len(audio_streams),
                    subtitle_tracks_count=len(sub_streams),
                )
            except Exception:
                pass

    # Fallback to ffmpeg -i probe
    cmd = [ffmpeg_binary(), "-hide_banner", "-i", str(media_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    err = res.stderr or ""

    duration = 0.0
    dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", err)
    if dur_match:
        h, m, s = dur_match.groups()
        duration = int(h) * 3600 + int(m) * 60 + float(s)

    sample_rate = 44100
    sr_match = re.search(r"(\d{4,6})\s*Hz", err)
    if sr_match:
        sample_rate = int(sr_match.group(1))

    has_video = "Video:" in err
    resolution = None
    res_match = re.search(r"Video:.*?(\d{3,4}x\d{3,4})", err)
    if res_match:
        resolution = res_match.group(1)

    return MediaAnalysisResult(
        duration=duration,
        sample_rate=sample_rate,
        channels=2,
        has_video=has_video,
        resolution=resolution,
    )


def normalize_audio(
    input_path: Path,
    output_path: Path,
    target_lufs: float = -14.0,
    target_sample_rate: int = 44100,
) -> Path:
    """Normalize audio level to target LUFS and convert to pristine WAV format without modifying original."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    filter_expr = f"loudnorm=I={target_lufs}:LRA=11:TP=-1.5,aformat=sample_rates={target_sample_rate}:channel_layouts=stereo"
    cmd = [
        ffmpeg_binary(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(input_path),
        "-af",
        filter_expr,
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if res.returncode != 0:
        # Fallback to simple volume auto-adjust if loudnorm fails
        fallback_cmd = [
            ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(input_path),
            "-ar",
            str(target_sample_rate),
            "-ac",
            "2",
            str(output_path),
        ]
        subprocess.run(fallback_cmd, check=True, timeout=300)
    return output_path
