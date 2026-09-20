from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

import aiofiles
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app.services.separator import find_stem
from app.services.storage import SongNotFound, store
from app.services.waveform import waveform_data


router = APIRouter(prefix="/api", tags=["songs"])


def _audio_path(song_id: str, track: str) -> Path:
    try:
        song = store.get_song(song_id)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc
    if track == "original":
        stored = song.get("stored_filename")
        if stored:
            candidate = UPLOADS_DIR / Path(stored).name
            if candidate.exists():
                return candidate
    elif track == "vocals":
        candidate = find_stem(song_id, "vocals.wav")
        if candidate:
            return candidate
    elif track == "instrumental":
        candidate = find_stem(song_id, "no_vocals.wav")
        if candidate:
            return candidate
    else:
        raise HTTPException(status_code=400, detail="track must be original, vocals, or instrumental")
    raise HTTPException(status_code=404, detail=f"Track {track} not found")


@router.post("/upload")
async def upload_song(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")
    song_id = str(uuid4())
    extension = Path(file.filename).suffix.lower() or ".audio"
    stored_filename = f"{song_id}{extension}"
    destination = UPLOADS_DIR / stored_filename
    try:
        async with aiofiles.open(destination, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                await output.write(chunk)
        store.create_song(song_id, file.filename, stored_filename)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return {"song_id": song_id, "filename": file.filename}


class YouTubeRequest(BaseModel):
    url: str


@router.post("/upload/youtube")
async def upload_youtube(req: YouTubeRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp đường dẫn video")

    # Sanitize YouTube watch URLs to single video (strip playlist & mix parameters like &list=RDI)
    if "watch?v=" in url:
        from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query)
        if "v" in query_params:
            clean_query = urlencode({"v": query_params["v"][0]})
            url = urlunparse((parsed.scheme or "https", parsed.netloc or "www.youtube.com", parsed.path, parsed.params, clean_query, ""))

    import yt_dlp
    from app.services.binaries import ffmpeg_binary
    ffmpeg_path = ffmpeg_binary()

    song_id = str(uuid4())
    destination_base = UPLOADS_DIR / song_id
    outtmpl = str(destination_base) + ".%(ext)s"

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "ffmpeg_location": str(Path(ffmpeg_path).parent) if ffmpeg_path else None,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "ios"],
            },
        },
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "socket_timeout": 30,
    }

    def _download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title") or "YouTube Audio"
            return title

    try:
        title = await asyncio.to_thread(_download)
        import re
        safe_title = re.sub(r'[\\/*?:"<>|]', "", title).strip() or "YouTube Audio"
        stored_filename = f"{song_id}.mp3"
        filename = f"{safe_title}.mp3"
        store.create_song(song_id, filename, stored_filename)
        return {"song_id": song_id, "filename": filename, "title": safe_title}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tải video từ YouTube: {str(exc)}")


@router.get("/songs")
def list_songs():
    songs = []
    for song in store.list_songs():
        songs.append(
            {
                "song_id": song["id"],
                "filename": song["original_filename"],
                "created_at": song["created_at"],
                "updated_at": song["updated_at"],
                "lyrics_version": store.latest_lyrics_version(song["id"]),
                "status": song["status"],
            }
        )
    return songs


@router.delete("/songs/{song_id}")
def delete_song(song_id: str):
    try:
        store.delete_song(song_id)
        return {"status": "ok", "deleted": song_id}
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc


@router.get("/songs/{song_id}/audio/{track}")
def get_audio(song_id: str, track: str):
    path = _audio_path(song_id, track)
    return FileResponse(path, filename=path.name, headers={"Accept-Ranges": "bytes"})


@router.get("/songs/{song_id}/waveform")
def get_waveform(
    song_id: str,
    track: str = Query("original", pattern="^(original|vocals|instrumental)$"),
    points: int = Query(2000, ge=128, le=10000),
):
    path = _audio_path(song_id, track)
    cache_dir = OUTPUTS_DIR / song_id / "waveforms"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{track}-{points}.json"
    if cache_file.exists() and cache_file.stat().st_mtime >= path.stat().st_mtime:
        payload = json.loads(cache_file.read_text(encoding="utf-8"))
    else:
        try:
            payload = waveform_data(path, points)
        except (OSError, RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    payload.update(
        {
            "song_id": song_id,
            "track": track,
            "audio_url": f"/api/songs/{song_id}/audio/{track}",
        }
    )
    return payload


@router.post("/songs/{song_id}/background")
async def upload_background(song_id: str, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    target_dir = OUTPUTS_DIR / song_id
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = target_dir / "background.jpg"
    try:
        async with aiofiles.open(destination, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                await output.write(chunk)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save background image: {exc}")
    return {"message": "Background image uploaded", "url": f"/api/songs/{song_id}/background"}


@router.api_route("/songs/{song_id}/background", methods=["GET", "HEAD"])
def get_background(song_id: str):
    destination = OUTPUTS_DIR / song_id / "background.jpg"
    if not destination.exists():
        raise HTTPException(status_code=404, detail="No custom background found")
    return FileResponse(destination, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.delete("/songs/{song_id}/background")
def delete_background(song_id: str):
    destination = OUTPUTS_DIR / song_id / "background.jpg"
    if destination.exists():
        destination.unlink(missing_ok=True)
    return {"message": "Background image removed"}
