from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, HTTPException

from app.models.schemas import AlignmentRequest, JobResponse, ProcessOptions, StatusResponse
from app.services.jobs import heavy_jobs
from app.services.separator import separate_vocals
from app.services.storage import DuplicateJob, SongNotFound, StorageError, store
from app.services.transcriber import align_selected_lines, transcribe_audio


router = APIRouter(prefix="/api/process", tags=["process"])


def _song(song_id: str) -> dict:
    try:
        return store.get_song(song_id)
    except SongNotFound as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc


def _submit(
    song_id: str,
    kind: str,
    payload: dict,
    work: Callable,
    queued_stages: tuple[str, ...] = (),
) -> JobResponse:
    def mark_queued() -> None:
        for stage in queued_stages:
            store.update_stage(song_id, stage, "queued", progress=0, message="Queued")

    try:
        job = heavy_jobs.submit(song_id, kind, payload, work, on_queued=mark_queued)
    except DuplicateJob as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "job_id": exc.job["id"], "status": exc.job["status"]},
        ) from exc
    return JobResponse(message="Processing queued", song_id=song_id, job_id=job["id"])


@router.post("/{song_id}/all", response_model=JobResponse)
def start_all(song_id: str, options: ProcessOptions | None = None):
    song = _song(song_id)
    options = options or ProcessOptions()
    if options.base_version is None:
        options.base_version = store.latest_lyrics_version(song_id)
    filename = song.get("stored_filename")
    if not filename:
        raise HTTPException(status_code=404, detail="Original audio not found")
    payload = options.model_dump()

    def work(report):
        separate_vocals(
            song_id,
            filename,
            report=lambda progress, message: report(progress * 0.48, message),
        )
        result = transcribe_audio(
            song_id,
            filename,
            lyrics_text=options.lyrics_text,
            model_preset=options.model_preset,
            base_version=options.base_version,
            report=lambda progress, message: report(0.5 + progress * 0.49, message),
        )
        return {"lyrics_version": result.version}

    return _submit(
        song_id,
        "process_all",
        payload,
        work,
        queued_stages=("separation", "transcription"),
    )


@router.post("/{song_id}/separate", response_model=JobResponse)
def start_separation(song_id: str):
    song = _song(song_id)
    filename = song.get("stored_filename")
    if not filename:
        raise HTTPException(status_code=404, detail="Original audio not found")

    return _submit(
        song_id,
        "separation",
        {},
        lambda report: separate_vocals(song_id, filename, report=report),
        queued_stages=("separation",),
    )


@router.post("/{song_id}/transcribe", response_model=JobResponse)
def start_transcription(song_id: str, options: ProcessOptions | None = None):
    song = _song(song_id)
    options = options or ProcessOptions()
    if options.base_version is None:
        options.base_version = store.latest_lyrics_version(song_id)
    filename = song.get("stored_filename")
    if not filename:
        raise HTTPException(status_code=404, detail="Original audio not found")

    return _submit(
        song_id,
        "transcription",
        options.model_dump(),
        lambda report: {
            "lyrics_version": transcribe_audio(
                song_id,
                filename,
                lyrics_text=options.lyrics_text,
                model_preset=options.model_preset,
                base_version=options.base_version,
                report=report,
            ).version
        },
        queued_stages=("transcription",),
    )


@router.post("/{song_id}/align", response_model=JobResponse)
def start_alignment(song_id: str, request: AlignmentRequest):
    song = _song(song_id)
    filename = song.get("stored_filename")
    if not filename:
        raise HTTPException(status_code=404, detail="Original audio not found")
    try:
        current = store.get_lyrics(song_id)
    except StorageError:
        current = None

    version = current.version if current else 0
    if request.base_version is not None and request.base_version != version:
        raise HTTPException(status_code=409, detail={"message": "Lyric đã thay đổi. Hãy tải lại phiên bản mới trước khi căn.", "current_version": version})
    request.base_version = version

    if request.line_ids and current:
        selected = [line for line in current.lines if line.id in request.line_ids and not line.locked]
        if not selected or any(line.start is None or line.end is None or line.end <= line.start for line in selected):
            raise HTTPException(status_code=422, detail="Chọn câu chưa khóa và đặt mốc đầu/cuối trước khi căn riêng câu.")

    if request.line_ids:
        work = lambda report: {
            "lyrics_version": align_selected_lines(
                song_id,
                filename,
                request.line_ids or [],
                model_preset=request.model_preset,
                base_version=request.base_version,
                report=report,
            ).version
        }
    else:
        canonical = request.lyrics_text or (current.canonical_text if current else None)
        if not canonical and current:
            canonical = "\n".join(line.text for line in current.lines)
        if not canonical or not canonical.strip():
            raise HTTPException(status_code=422, detail="lyrics_text is required for full alignment")
        work = lambda report: {
            "lyrics_version": transcribe_audio(
                song_id,
                filename,
                lyrics_text=canonical,
                model_preset=request.model_preset,
                base_version=request.base_version,
                report=report,
            ).version
        }

    return _submit(
        song_id,
        "alignment",
        request.model_dump(),
        work,
        queued_stages=("transcription",),
    )


@router.get("/{song_id}/status", response_model=StatusResponse)
def get_status(song_id: str):
    song = _song(song_id)
    return StatusResponse(
        song_id=song_id,
        status=song["status"],
        active_jobs=store.list_jobs(song_id, active_only=True),
    )


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    try:
        return store.get_job(job_id)
    except StorageError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
