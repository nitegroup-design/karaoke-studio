"""Shared ASS/SRT generation and FFmpeg export pipeline."""

from __future__ import annotations

import json
import re
import subprocess
import wave
import os
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional

from app.config import OUTPUTS_DIR, FONTS_DIR
from app.models.schemas import LyricLine, LyricsData, StyleOptions
from app.services.binaries import ffmpeg_binary
from app.services.separator import find_stem
from app.services.storage import StudioStore, store


def hex_to_ass_color(hex_str: str, alpha: int = 0) -> str:
    """Convert #RRGGBB hex color to ASS &HAABBGGRR& format."""
    cleaned = hex_str.strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(c * 2 for c in cleaned)
    if len(cleaned) != 6:
        return f"&H{alpha:02X}000000&"
    r = int(cleaned[0:2], 16)
    g = int(cleaned[2:4], 16)
    b = int(cleaned[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}&"


def build_ass_header(style: Optional[StyleOptions] = None) -> str:
    """Build dynamic ASS header based on selected font family, colors, and effects."""
    font = style.font_family if style and style.font_family else "Be Vietnam Pro"
    primary = hex_to_ass_color(style.primary_color, 0) if style else "&H00F7F3EB&"
    secondary = hex_to_ass_color(style.secondary_color, 0) if style else "&H0000B7FF&"
    outline = hex_to_ass_color(style.outline_color, 0) if style else "&H00201810&"
    
    is_glow = style is not None and style.effect == "glow"
    shadow_val = 2 if is_glow else 1
    outline_val = 3.5 if is_glow else 3.0

    return f"""[Script Info]
Title: Karaoke Studio
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ClassicTop,{font},64,{primary},{secondary},{outline},&H80000000,-1,0,0,0,100,100,0,0,1,{outline_val},{shadow_val},2,100,100,190,1
Style: ClassicBottom,{font},64,{primary},{secondary},{outline},&H80000000,-1,0,0,0,100,100,0,0,1,{outline_val},{shadow_val},2,100,100,100,1
Style: ClassicNext,{font},58,&H00BFB8AC,&H00BFB8AC,{outline},&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,100,100,100,1
Style: ModernFocus,{font},66,{primary},{secondary},{outline},&H60000000,-1,0,0,0,100,100,0,0,1,{outline_val},{shadow_val},5,120,120,0,1
Style: ModernNear,{font},48,&H00CFC8BC,&H00CFC8BC,{outline},&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,140,140,0,1
Style: ModernFar,{font},40,&H00857F76,&H00857F76,{outline},&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,160,160,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _cs(value: float) -> int:
    return max(0, int(round(value * 100)))


def format_ass_time(seconds: float) -> str:
    total_cs = _cs(seconds)
    hours, rest = divmod(total_cs, 360000)
    minutes, rest = divmod(rest, 6000)
    secs, centis = divmod(rest, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def format_srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, rest = divmod(total_ms, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def escape_ass_text(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\r\n", r"\N")
        .replace("\r", r"\N")
        .replace("\n", r"\N")
    )


def karaoke_payload(line: LyricLine, event_start: Optional[float] = None, event_end: Optional[float] = None) -> str:
    r"""Create \kf text whose tokens cover the event's absolute time span.

    Gaps are emitted as timing-only ``\k`` tags, so a 4.04 second pause stays
    a 404-centisecond pause instead of being collapsed into the next word.
    """
    if line.start is None or line.end is None:
        return escape_ass_text(line.text)
    start_cs = _cs(line.start if event_start is None else event_start)
    end_cs = _cs(line.end if event_end is None else event_end)
    cursor = start_cs
    chunks: list[str] = []
    if not line.words:
        return f"{{\\kf{max(0, end_cs - start_cs)}}}{escape_ass_text(line.text)}"

    for index, word in enumerate(line.words):
        if word.start is None or word.end is None:
            # Preserve canonical text without inventing a timestamp. Editors can
            # highlight the accompanying review flag and align it later.
            chunks.append(f"{{\\kf0}}{escape_ass_text(word.word)}")
        else:
            effective_end = word.end
            next_word = line.words[index + 1] if index + 1 < len(line.words) else None
            if next_word and next_word.start is not None and next_word.start > word.end:
                gap = next_word.start - word.end
                if gap <= 1.0:
                    effective_end = next_word.start - 0.03
            elif not next_word and line.end is not None and line.end > word.end:
                gap = line.end - word.end
                if gap <= 2.2:
                    effective_end = line.end - 0.04

            word_start = min(end_cs, max(start_cs, _cs(word.start)))
            word_end = min(end_cs, max(word_start, _cs(effective_end)))
            if word_start > cursor:
                chunks.append(f"{{\\k{word_start - cursor}}}")
                cursor = word_start
            duration = max(0, word_end - cursor)
            chunks.append(f"{{\\kf{duration}}}{escape_ass_text(word.word)}")
            cursor = max(cursor, word_end)
        if index < len(line.words) - 1:
            chunks.append(" ")
    if cursor < end_cs:
        chunks.append(f"{{\\k{end_cs - cursor}}}")
    return "".join(chunks)


def _timed_lines(lyrics: LyricsData) -> list[LyricLine]:
    return [line for line in lyrics.lines if line.start is not None and line.end is not None and line.end > line.start]


def generate_ass_text(lyrics: LyricsData, preset: str = "classic", style: Optional[StyleOptions] = None) -> str:
    valid_presets = {"classic", "modern", "neon", "cinema"}
    if preset not in valid_presets:
        preset = "classic"

    # Preset-specific style overrides if not provided
    if style is None:
        if preset == "neon":
            style = StyleOptions(
                font_family="Be Vietnam Pro",
                primary_color="#F0F8FF",
                secondary_color="#00FFFF",
                outline_color="#FF007F",
                effect="glow",
            )
        elif preset == "cinema":
            style = StyleOptions(
                font_family="Be Vietnam Pro",
                primary_color="#FFF8E7",
                secondary_color="#FFD700",
                outline_color="#1A1815",
                effect="smooth",
            )

    lines = _timed_lines(lyrics)
    events: list[str] = []
    header = build_ass_header(style)
    fad_tag = r"{\fad(180,150)}"

    if preset in ("classic", "cinema"):
        margin_v_top = 220 if preset == "cinema" else 190
        margin_v_bot = 130 if preset == "cinema" else 100
        for index, line in enumerate(lines):
            style_name = "ClassicTop" if index % 2 == 0 else "ClassicBottom"
            start = float(line.start)
            end = float(line.end)
            payload = karaoke_payload(line)
            events.append(
                f"Dialogue: 1,{format_ass_time(start)},{format_ass_time(end)},{style_name},,0,0,0,,{fad_tag}{payload}"
            )
            if index + 1 < len(lines):
                next_line = lines[index + 1]
                preview_end = min(end, float(next_line.start))
                if preview_end > start:
                    next_style = "ClassicBottom" if index % 2 == 0 else "ClassicTop"
                    events.append(
                        f"Dialogue: 0,{format_ass_time(start)},{format_ass_time(preview_end)},{next_style},,0,0,0,,"
                        f"{fad_tag}{{\\1c&H00BFB8AC&}}{escape_ass_text(next_line.text)}"
                    )
    else:
        # Modern Apple Music or Neon flow
        y_positions = [270, 405, 540, 675, 810]
        for focus, line in enumerate(lines):
            interval_start = float(line.start)
            interval_end = float(lines[focus + 1].start) if focus + 1 < len(lines) else float(line.end)
            interval_end = max(interval_start + 0.01, interval_end)
            first = max(0, focus - 2)
            last = min(len(lines), focus + 3)
            for line_index in range(first, last):
                relative = line_index - focus
                visible = lines[line_index]
                style_name = "ModernFocus" if relative == 0 else ("ModernNear" if abs(relative) == 1 else "ModernFar")
                y = y_positions[relative + 2]
                motion = f"{{\\move(960,{y + 18},960,{y},0,280)}}"
                text = (
                    karaoke_payload(visible, event_start=interval_start, event_end=interval_end)
                    if relative == 0
                    else escape_ass_text(visible.text)
                )
                events.append(
                    f"Dialogue: {2 if relative == 0 else 0},{format_ass_time(interval_start)},"
                    f"{format_ass_time(interval_end)},{style_name},,0,0,0,,{motion}{fad_tag}{text}"
                )
    return header + "\n".join(events) + ("\n" if events else "")


def format_lrc_time(seconds: float) -> str:
    clamped = max(0.0, seconds)
    minutes = int(clamped // 60)
    secs = clamped % 60
    return f"{minutes:02d}:{secs:05.2f}"


def generate_lrc_text(lyrics: LyricsData, enhanced: bool = False) -> str:
    lines = _timed_lines(lyrics)
    out = [f"[ti:{lyrics.title}]", "[by:Karaoke AI Studio]", ""]
    for line in lines:
        start_tag = f"[{format_lrc_time(float(line.start))}]"
        if not enhanced or not line.words:
            out.append(f"{start_tag}{line.text}")
        else:
            word_parts = []
            for w in line.words:
                w_start = float(w.start) if w.start is not None else float(line.start)
                word_parts.append(f"<{format_lrc_time(w_start)}>{w.word}")
            out.append(f"{start_tag}{' '.join(word_parts)}")
    return "\n".join(out)


def generate_srt_text(lyrics: LyricsData) -> str:
    blocks = []
    for index, line in enumerate(_timed_lines(lyrics), start=1):
        blocks.append(
            f"{index}\n{format_srt_time(float(line.start))} --> {format_srt_time(float(line.end))}\n{line.text}\n"
        )
    return "\n".join(blocks)


def write_subtitles(
    lyrics: LyricsData,
    ass_path: Path,
    srt_path: Path,
    preset: str,
    style: Optional[StyleOptions] = None,
    lrc_path: Optional[Path] = None,
) -> None:
    ass_path.write_text(generate_ass_text(lyrics, preset, style), encoding="utf-8-sig")
    srt_path.write_text(generate_srt_text(lyrics), encoding="utf-8-sig")
    if lrc_path:
        lrc_path.write_text(generate_lrc_text(lyrics, enhanced=True), encoding="utf-8-sig")



# Backwards-compatible public helper used by the earlier backend.
def generate_ass(
    lyrics_data: dict,
    output_ass: Path,
    preset: str = "classic",
    style: Optional[StyleOptions] = None,
) -> None:
    output_ass.write_text(
        generate_ass_text(LyricsData.model_validate(lyrics_data), preset, style),
        encoding="utf-8-sig",
    )


def _probe_duration(audio_path: Path) -> float:
    if audio_path.suffix.lower() == ".wav":
        with wave.open(str(audio_path), "rb") as audio:
            return audio.getnframes() / float(audio.getframerate())
    # Export normally consumes Demucs WAV. This fallback decodes other formats
    # once and derives duration without requiring a separate ffprobe install.
    completed = subprocess.run(
        [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-i", str(audio_path), "-f", "s16le", "-ac", "1", "-ar", "4000", "pipe:1"],
        capture_output=True,
        timeout=300,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"FFmpeg duration probe failed: {completed.stderr.decode(errors='replace')[-2000:]}")
    return len(completed.stdout) / 2 / 4000


def render_video(
    song_id: str,
    export_id: Optional[str] = None,
    *,
    preset: str = "classic",
    lyrics_version: Optional[int] = None,
    style: Optional[StyleOptions] = None,
    storage: StudioStore = store,
    report: Optional[Callable[[float, str], None]] = None,
    background_snapshot: bool = False,
) -> dict[str, str]:
    """Render an immutable lyric-version snapshot and its companion files."""
    lyrics = storage.get_lyrics(song_id, lyrics_version)
    version = lyrics.version
    if export_id is None:
        export_row = storage.create_export(song_id, version, preset)
        export_id = export_row["id"]
    storage.update_stage(song_id, "render", "processing", progress=5, message="Preparing subtitles")
    storage.update_export(export_id, status="processing", progress=5)
    try:
        instrumental = find_stem(song_id, "no_vocals.wav")
        if not instrumental:
            raise FileNotFoundError("Instrumental file not found. Run separation first.")

        export_dir = OUTPUTS_DIR / song_id / "exports" / export_id
        export_dir.mkdir(parents=True, exist_ok=True)
        ass_path = export_dir / f"karaoke_{preset}.ass"
        srt_path = export_dir / f"karaoke_{preset}.srt"
        lrc_path = export_dir / f"karaoke_{preset}.lrc"
        snapshot_path = export_dir / "lyrics.snapshot.json"
        video_path = export_dir / f"karaoke_{preset}.mp4"
        temporary_video = export_dir / f"karaoke_{preset}.partial.mp4"
        write_subtitles(lyrics, ass_path, srt_path, preset, style, lrc_path=lrc_path)
        snapshot_path.write_text(lyrics.model_dump_json(indent=2), encoding="utf-8")
        if report:
            report(0.2, "Subtitles generated")
        storage.update_export(export_id, progress=20)

        duration = _probe_duration(instrumental)

        # Check for custom background image
        bg_root = export_dir if background_snapshot else OUTPUTS_DIR / song_id
        bg_candidate = bg_root / "background.jpg"
        if not bg_candidate.exists():
            bg_candidate = bg_root / "background.png"

        # Relative filter paths avoid drive-letter escaping on Windows.
        font_directory = Path(os.path.relpath(FONTS_DIR, export_dir)).as_posix().replace("'", "'\\''")
        subtitle_filter = f"subtitles={ass_path.name}:fontsdir='{font_directory}'"

        if bg_candidate.exists():
            frozen_background = export_dir / bg_candidate.name
            if bg_candidate != frozen_background:
                shutil.copy2(bg_candidate, frozen_background)
            input_args = ["-loop", "1", "-framerate", "30", "-i", str(frozen_background), "-i", str(instrumental)]
            video_filter = (
                f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,"
                f"drawbox=color=0x0A0A0E@0.55:t=fill,{subtitle_filter}"
            )
        else:
            input_args = ["-f", "lavfi", "-i", "color=c=0x111216:s=1920x1080:r=30", "-i", str(instrumental)]
            video_filter = subtitle_filter

        command = [
            ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-nostats", "-progress", "pipe:1", "-stats_period", "0.5",
            *input_args,
            "-vf",
            video_filter,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-r", "30",
            str(temporary_video),
        ]
        if report:
            report(0.3, "Rendering 1080p video")
        with tempfile.TemporaryFile(mode="w+b") as errors:
            process = subprocess.Popen(command, cwd=export_dir, stdout=subprocess.PIPE, stderr=errors, text=True)
            timeout = threading.Timer(7200, process.kill)
            timeout.start()
            try:
                last_progress = 20
                for entry in process.stdout:
                    key, _, value = entry.strip().partition("=")
                    if key != "out_time_us":
                        continue
                    try:
                        progress = min(98, 20 + int(float(value) / 1_000_000 / max(duration, 0.001) * 78))
                    except ValueError:
                        continue
                    if progress > last_progress:
                        last_progress = progress
                        storage.update_export(export_id, progress=progress)
                        storage.update_stage(song_id, "render", "processing", progress=progress, message="Rendering video")
                        if report:
                            report(progress / 100, "Rendering 1080p video")
                process.wait()
                if process.returncode != 0:
                    errors.seek(0)
                    raise RuntimeError(f"FFmpeg render failed: {errors.read().decode(errors='replace')[-4000:]}")
            finally:
                timeout.cancel()
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
        temporary_video.replace(video_path)

        artifacts = {
            "mp4": str(video_path),
            "ass": str(ass_path),
            "srt": str(srt_path),
            "lrc": str(lrc_path),
            "wav": str(instrumental),
            "lyrics": str(snapshot_path),
        }
        storage.update_export(export_id, status="done", progress=100, artifacts=artifacts)
        storage.update_stage(song_id, "render", "done", progress=100, message="Export ready")
        if report:
            report(1.0, "Export complete")
        return {"export_id": export_id, "lyrics_version": str(version), **artifacts}
    except Exception as exc:
        if 'temporary_video' in locals():
            temporary_video.unlink(missing_ok=True)
        storage.update_export(export_id, status="error", progress=100, error=str(exc))
        storage.update_stage(song_id, "render", "error", progress=100, error=str(exc), message="Export failed")
        raise
