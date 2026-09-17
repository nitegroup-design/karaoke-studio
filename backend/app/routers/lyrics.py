from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models.schemas import LyricsData, PreviewAssRequest, ReviewReason
from app.services.renderer import generate_ass_text
from app.services.storage import SongNotFound, StorageError, VersionConflict, store


router = APIRouter(prefix="/api/lyrics", tags=["lyrics"])


def _normalized_words(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _mark_text_timing_mismatches(lyrics: LyricsData) -> LyricsData:
    updated = lyrics.model_copy(deep=True)
    for line in updated.lines:
        reasons = [reason for reason in line.review_reasons if reason != ReviewReason.UNALIGNED_TEXT]
        timed_text = " ".join(word.word for word in line.words)
        if _normalized_words(timed_text) != _normalized_words(line.text):
            reasons.append(ReviewReason.UNALIGNED_TEXT)
        line.review_reasons = list(dict.fromkeys(reasons))
        line.review_required = bool(line.review_reasons) or any(word.review_required for word in line.words)
    # Pasted lyrics are the canonical source. Keep their exact blank lines and
    # repeated choruses; only synthesize text when migrating a legacy payload.
    if updated.canonical_text is None:
        updated.canonical_text = "\n".join(line.text for line in updated.lines)
    return LyricsData.model_validate(updated.model_dump())


@router.get("/{song_id}", response_model=LyricsData)
def get_lyrics(song_id: str, version: int | None = Query(None, ge=1)):
    try:
        return store.get_lyrics(song_id, version)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Lyrics not found") from exc


@router.get("/{song_id}/versions")
def get_versions(song_id: str):
    try:
        return store.list_lyrics_versions(song_id)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc


@router.put("/{song_id}", response_model=LyricsData)
def update_lyrics(song_id: str, lyrics: LyricsData):
    if lyrics.song_id != song_id:
        raise HTTPException(status_code=422, detail="song_id in the body must match the URL")
    prepared = _mark_text_timing_mismatches(lyrics)
    try:
        saved = store.save_lyrics(
            prepared,
            expected_version=lyrics.version,
            source="editor",
        )
        store.materialize_latest_lyrics(saved)
        return saved
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc
    except VersionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_version": store.latest_lyrics_version(song_id),
            },
        ) from exc


@router.post("/{song_id}/preview-ass")
def preview_ass(song_id: str, request: PreviewAssRequest | None = None):
    request = request or PreviewAssRequest()
    try:
        lyrics = request.lyrics or store.get_lyrics(song_id)
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Lyrics not found") from exc
    if lyrics.song_id != song_id:
        raise HTTPException(status_code=422, detail="song_id in preview lyrics must match the URL")
    content = generate_ass_text(lyrics, request.preset, style=request.style)
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/x-ass",
        headers={"X-Lyrics-Version": str(lyrics.version), "X-Karaoke-Preset": request.preset},
    )
