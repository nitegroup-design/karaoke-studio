"""Whisper transcription and canonical-text forced alignment."""

from __future__ import annotations

import subprocess
import hashlib
import json
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from app.config import MODEL_PRESETS, UPLOADS_DIR, OUTPUTS_DIR
from app.models.schemas import LyricLine, LyricsData, ReviewReason, WordTimestamp
from app.services.alignment import clean_lyrics_text, hybrid_align_canonical_lyrics
from app.services.binaries import ffmpeg_binary
from app.services.separator import find_stem
from app.services.storage import StudioStore, StorageError, VersionConflict, store


_MODEL_CACHE: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()


def get_model(preset: str):
    """Lazily load and cache one CPU/int8 model for each supported preset."""
    model_name = MODEL_PRESETS.get(preset)
    if not model_name:
        raise ValueError(f"Unknown model preset: {preset}")
    with _MODEL_LOCK:
        if model_name not in _MODEL_CACHE:
            import stable_whisper

            _MODEL_CACHE[model_name] = stable_whisper.load_faster_whisper(
                model_name,
                device="cpu",
                compute_type="int8",
            )
        return _MODEL_CACHE[model_name]


def clear_model_cache() -> None:
    with _MODEL_LOCK:
        _MODEL_CACHE.clear()


def _float_or_none(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


def _word_from_result(raw: Any, *, offset: float = 0.0) -> WordTimestamp:
    start = _float_or_none(getattr(raw, "start", None))
    end = _float_or_none(getattr(raw, "end", None))
    if start is not None:
        start = round(start + offset, 3)
    if end is not None:
        end = round(end + offset, 3)
    return WordTimestamp(word=str(getattr(raw, "word", "")).strip(), start=start, end=end)


def _missing_line(text: str) -> LyricLine:
    words = [
        WordTimestamp(
            word=word,
            start=None,
            end=None,
            review_required=True,
            review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.UNALIGNED_TEXT],
        )
        for word in text.split()
    ]
    return LyricLine(
        text=text,
        start=None,
        end=None,
        words=words,
        review_required=True,
        review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.UNALIGNED_TEXT],
    )


def _result_segments(result: Any, *, offset: float = 0.0) -> list[LyricLine]:
    lines: list[LyricLine] = []
    for segment in getattr(result, "segments", []) or []:
        words = [_word_from_result(word, offset=offset) for word in (getattr(segment, "words", []) or [])]
        start = _float_or_none(getattr(segment, "start", None))
        end = _float_or_none(getattr(segment, "end", None))
        if start is not None:
            start = round(start + offset, 3)
        if end is not None:
            end = round(end + offset, 3)
        lines.append(
            LyricLine(
                start=start,
                end=end,
                text=str(getattr(segment, "text", "")).strip(),
                words=words,
            )
        )
    return lines


def _with_stable_ids(aligned: LyricLine, existing: Optional[LyricLine], canonical_text: str) -> LyricLine:
    aligned.text = canonical_text
    if existing is None:
        return aligned
    aligned.id = existing.id
    for index, word in enumerate(aligned.words):
        if index < len(existing.words) and existing.words[index].word == word.word:
            word.id = existing.words[index].id
    return aligned


def reconcile_canonical_lines(
    canonical_text: str,
    aligned_lines: list[LyricLine],
    existing: Optional[LyricsData] = None,
) -> list[LyricLine]:
    """Preserve every non-empty source line using hybrid fuzzy alignment."""
    return hybrid_align_canonical_lyrics(canonical_text, aligned_lines, existing)


def _input_audio(song_id: str, file_name: str) -> Path:
    return find_stem(song_id, "vocals.wav") or (UPLOADS_DIR / file_name)


def _align(model: Any, audio: Path, text: str) -> Any:
    return model.align(str(audio), text, language="vi", original_split=True)


def transcribed_vocal(song_id: str, audio: Path, preset: str) -> list[LyricLine]:
    """Reuse ASR when only the reference text changed (also after a restart)."""
    stat = audio.stat()
    fingerprint = f"v1|{audio.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{MODEL_PRESETS[preset]}|vi|400"
    key = hashlib.sha256(fingerprint.encode()).hexdigest()[:24]
    cache = OUTPUTS_DIR / song_id / "asr-cache" / f"{key}.json"
    try:
        return [LyricLine.model_validate(line) for line in json.loads(cache.read_text(encoding="utf-8"))]
    except (OSError, ValueError, TypeError):
        pass
    model = get_model(preset)
    result = model.transcribe(
        str(audio), language="vi", word_timestamps=True, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400}, condition_on_previous_text=False,
    )
    lines = _result_segments(result)
    cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache.with_suffix(".tmp")
    temporary.write_text(json.dumps([line.model_dump(mode="json") for line in lines], ensure_ascii=False), encoding="utf-8")
    temporary.replace(cache)
    return lines


def transcribe_audio(
    song_id: str,
    file_name: str,
    *,
    lyrics_text: Optional[str] = None,
    model_preset: str = "quality",
    base_version: Optional[int] = None,
    storage: StudioStore = store,
    report: Optional[Callable[[float, str], None]] = None,
) -> LyricsData:
    """Transcribe or align a whole song, guarded by an optimistic lyric version."""
    storage.update_stage(song_id, "transcription", "processing", progress=5, message="Loading model")
    if report:
        report(0.05, f"Loading {MODEL_PRESETS[model_preset]} on CPU")
    try:
        input_file = _input_audio(song_id, file_name)
        if not input_file.exists():
            raise FileNotFoundError(f"Audio not found: {input_file.name}")
        try:
            existing = storage.get_lyrics(song_id)
        except StorageError:
            existing = None
        expected_version = base_version if base_version is not None else (existing.version if existing else 0)
        if expected_version != (existing.version if existing else 0):
            raise VersionConflict("Lyric đã đổi sau khi xếp hàng; hãy căn lại từ phiên bản mới.")
        if report:
            report(0.25, "Transcribing vocal track with VAD filter")

        if lyrics_text and lyrics_text.strip():
            canonical = lyrics_text.replace("\r\n", "\n").replace("\r", "\n")
            asr_lines = transcribed_vocal(song_id, input_file, model_preset)
            if report:
                report(0.70, "Fuzzy-aligning reference lyrics to vocal timestamps")
            lines = hybrid_align_canonical_lyrics(canonical, asr_lines, existing)
        else:
            canonical = None
            lines = transcribed_vocal(song_id, input_file, model_preset)

        song_record = None
        try:
            song_record = storage.get_song(song_id)
        except Exception:
            pass
        fallback_title = song_record.get("original_filename") if song_record else file_name
        title = existing.title if existing and existing.title and not existing.title.endswith(".mp3") else Path(fallback_title).stem
        data = LyricsData(
            song_id=song_id,
            title=title,
            version=expected_version,
            canonical_text=canonical,
            lines=lines,
        )
        if report:
            report(0.9, "Saving aligned lyric version")
        saved = storage.save_lyrics(
            data,
            expected_version=expected_version,
            source="alignment" if canonical else "transcription",
        )
        storage.materialize_latest_lyrics(saved)
        storage.update_stage(song_id, "transcription", "done", progress=100, message="Lyrics ready")
        return saved
    except Exception as exc:
        storage.update_stage(
            song_id,
            "transcription",
            "error",
            progress=100,
            error=str(exc),
            message="Alignment failed",
        )
        raise


def _extract_clip(source: Path, start: float, end: float, destination: Path) -> None:
    command = [
        ffmpeg_binary(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(destination),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if completed.returncode != 0:
        raise RuntimeError(f"FFmpeg could not prepare alignment clip: {completed.stderr.strip()[-2000:]}")


def align_selected_lines(
    song_id: str,
    file_name: str,
    line_ids: Iterable[str],
    *,
    model_preset: str,
    base_version: Optional[int],
    storage: StudioStore = store,
    report: Optional[Callable[[float, str], None]] = None,
) -> LyricsData:
    """Realign selected, unlocked lines within their current audio windows."""
    current = storage.get_lyrics(song_id)
    expected_version = base_version if base_version is not None else current.version
    if expected_version != current.version:
        raise VersionConflict("Lyric đã đổi sau khi xếp hàng; hãy căn lại từ phiên bản mới.")
    wanted = set(line_ids)
    selected = [line for line in current.lines if line.id in wanted and not line.locked]
    unknown = wanted.difference(line.id for line in current.lines)
    if unknown:
        raise ValueError(f"Unknown lyric line IDs: {', '.join(sorted(unknown))}")
    if not selected:
        raise ValueError("No unlocked lyric lines selected")

    storage.update_stage(song_id, "transcription", "processing", progress=5, message="Realigning selected lines")
    replacements: dict[str, LyricLine] = {}
    try:
        source = _input_audio(song_id, file_name)
        if any(line.start is None or line.end is None or line.end <= line.start for line in selected):
            raise ValueError("Hãy đặt mốc đầu và cuối câu trước khi căn riêng câu đó.")
        model = get_model(model_preset)
        with tempfile.TemporaryDirectory(prefix="karaoke-align-") as temporary:
            temp_dir = Path(temporary)
            for index, line in enumerate(selected):
                offset = 0.0
                audio = source
                if line.start is not None and line.end is not None and line.end > line.start:
                    offset = max(0.0, line.start - 2.0)
                    clip_end = max(line.end + 2.0, offset + 0.25)
                    audio = temp_dir / f"{index}.wav"
                    _extract_clip(source, offset, clip_end, audio)
                result = _align(model, audio, line.text)
                segments = _result_segments(result, offset=offset)
                # A single sentence can produce multiple segments; retain every token.
                replacement = hybrid_align_canonical_lyrics(line.text, segments)[0] if segments else _missing_line(line.text)
                replacement = _with_stable_ids(replacement, line, line.text)
                replacement.locked = line.locked
                replacements[line.id] = replacement
                if report:
                    report(
                        0.1 + 0.75 * ((index + 1) / len(selected)),
                        f"Aligned {index + 1}/{len(selected)} lines",
                    )

        updated = current.model_copy(deep=True)
        updated.lines = [replacements.get(line.id, line) for line in current.lines]
        saved = storage.save_lyrics(updated, expected_version=expected_version, source="selected_alignment")
        storage.materialize_latest_lyrics(saved)
        storage.update_stage(song_id, "transcription", "done", progress=100, message="Selected lines aligned")
        return saved
    except Exception as exc:
        storage.update_stage(
            song_id,
            "transcription",
            "error",
            progress=100,
            error=str(exc),
            message="Selected alignment failed",
        )
        raise
