"""Single-worker queue for CPU/RAM intensive audio jobs."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from app.services.storage import StudioStore, store


logger = logging.getLogger(__name__)
ProgressCallback = Callable[[float, str], None]
JobCallable = Callable[[ProgressCallback], Optional[dict[str, Any]]]


class HeavyJobQueue:
    """Serialize Demucs, Whisper and FFmpeg work to avoid memory exhaustion."""

    def __init__(self, storage: StudioStore = store):
        self.storage = storage
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="karaoke-heavy")

    def submit(
        self,
        song_id: str,
        kind: str,
        payload: dict[str, Any],
        work: JobCallable,
        on_queued: Optional[Callable[[], None]] = None,
    ) -> dict[str, Any]:
        job = self.storage.create_job(song_id, kind, payload)
        if on_queued:
            on_queued()
        self.executor.submit(self._run, job["id"], work)
        return job

    def _run(self, job_id: str, work: JobCallable) -> None:
        self.storage.update_job(job_id, status="processing", progress=1.0, message="Starting")

        def report(progress: float, message: str) -> None:
            self.storage.update_job(
                job_id,
                status="processing",
                progress=max(1.0, min(99.0, progress * 100.0)),
                message=message,
            )

        try:
            result = work(report) or {}
            self.storage.update_job(
                job_id,
                status="done",
                progress=100.0,
                message="Completed",
                result=result,
            )
        except Exception as exc:
            logger.exception("Heavy job %s failed", job_id)
            self.storage.update_job(
                job_id,
                status="error",
                progress=100.0,
                message="Failed",
                error=str(exc),
            )

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=False)


heavy_jobs = HeavyJobQueue()
