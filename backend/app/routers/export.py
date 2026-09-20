from __future__ import annotations

from pathlib import Path
import json
import shutil
import threading

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import OUTPUTS_DIR
from app.models.schemas import ExportRequest, JobResponse
from app.services.jobs import heavy_jobs
from app.services.renderer import render_video
from app.services.storage import DuplicateJob, SongNotFound, StorageError, store


router = APIRouter(prefix="/api/export", tags=["export"])
_submission_lock = threading.Lock()


@router.post("/{song_id}", response_model=JobResponse)
def start_export(song_id: str, request: ExportRequest | None = None):
    # Keep duplicate requests from creating an orphan export that hides the active one.
    with _submission_lock:
        for active in store.list_jobs(song_id, active_only=True):
            if active['kind'] == 'export':
                raise HTTPException(status_code=409, detail={"message": "Bài hát đang có tác vụ xuất video.", "job_id": active['id']})
        return _start_export(song_id, request)


def _start_export(song_id: str, request: ExportRequest | None = None):
    request = request or ExportRequest()
    try:
        lyrics = store.get_lyrics(song_id, request.lyrics_version)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Requested lyric version not found") from exc

    export_row = store.create_export(song_id, lyrics.version, request.preset)
    export_id = export_row["id"]
    export_dir = OUTPUTS_DIR / song_id / "exports" / export_id
    export_dir.mkdir(parents=True, exist_ok=True)
    for extension in ("jpg", "png"):
        background = OUTPUTS_DIR / song_id / f"background.{extension}"
        if background.exists():
            shutil.copy2(background, export_dir / background.name)
            break
    (export_dir / 'video-settings.json').write_text(json.dumps(request.model_dump(), ensure_ascii=False, indent=2), encoding='utf-8')

    def work(report):
        return render_video(
            song_id,
            export_id,
            preset=request.preset,
            lyrics_version=lyrics.version,
            style=request.style,
            report=report,
            background_snapshot=True,
        )

    try:
        job = heavy_jobs.submit(
            song_id,
            "export",
            {
                "export_id": export_id,
                "preset": request.preset,
                "lyrics_version": lyrics.version,
            },
            work,
            on_queued=lambda: store.update_stage(
                song_id, "render", "queued", progress=0, message="Export queued"
            ),
        )
    except DuplicateJob as exc:
        store.update_export(export_id, status="error", progress=100, error="Another export is already active")
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "job_id": exc.job["id"], "status": exc.job["status"]},
        ) from exc
    return JobResponse(
        message="Export queued",
        song_id=song_id,
        job_id=job["id"],
        export_id=export_id,
    )


@router.get("/{song_id}/status")
def export_status(song_id: str, export_id: str | None = None):
    try:
        export_row = store.get_export(export_id) if export_id else store.latest_export(song_id)
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Export not found") from exc
    if export_row["song_id"] != song_id:
        raise HTTPException(status_code=404, detail="Export not found for this song")
    return export_row


@router.get("/{song_id}/download")
def download_export(
    song_id: str,
    artifact: str = Query("mp4", pattern="^(mp4|ass|srt|lrc|wav|lyrics)$"),
    export_id: str | None = None,
):
    try:
        export_row = store.get_export(export_id) if export_id else store.latest_export(song_id)
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Export not found") from exc
    if export_row["song_id"] != song_id:
        raise HTTPException(status_code=404, detail="Export not found for this song")
    raw_path = export_row["artifacts"].get(artifact)
    if not raw_path:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact} is not ready")
    path = Path(raw_path).resolve()
    if not path.is_relative_to(OUTPUTS_DIR.resolve()) or not path.exists():
        raise HTTPException(status_code=404, detail=f"Artifact {artifact} not found")
    media_types = {
        "mp4": "video/mp4",
        "ass": "text/x-ass",
        "srt": "application/x-subrip",
        "lrc": "text/plain",
        "wav": "audio/wav",
        "lyrics": "application/json",
    }
    return FileResponse(
        path,
        media_type=media_types[artifact],
        filename=f"karaoke_{song_id}_{export_row['preset']}.{path.suffix.lstrip('.')}",
    )
