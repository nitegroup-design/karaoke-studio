"""SQLite persistence for songs, immutable lyric versions, jobs and exports."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional
from uuid import uuid4

from app.config import DATABASE_PATH, OUTPUTS_DIR, UPLOADS_DIR
from app.models.schemas import LyricsData, utc_now_iso


class StorageError(RuntimeError):
    pass


class SongNotFound(StorageError):
    pass


class VersionConflict(StorageError):
    pass


class DuplicateJob(StorageError):
    def __init__(self, job: dict[str, Any]):
        super().__init__(f"A {job['kind']} job is already active for this song")
        self.job = job


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class StudioStore:
    def __init__(self, database_path: Path = DATABASE_PATH):
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.RLock()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def initialize(self) -> None:
        with self._write_lock, self.connect() as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS songs (
                    id TEXT PRIMARY KEY,
                    original_filename TEXT NOT NULL,
                    stored_filename TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    status_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS lyric_versions (
                    song_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (song_id, version),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    song_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    message TEXT,
                    error TEXT,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    result_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_jobs_song ON jobs(song_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(song_id, kind, status);
                CREATE TABLE IF NOT EXISTS exports (
                    id TEXT PRIMARY KEY,
                    song_id TEXT NOT NULL,
                    lyrics_version INTEGER NOT NULL,
                    preset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    error TEXT,
                    artifacts_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_exports_song ON exports(song_id, created_at DESC);
                """
            )
            # Work interrupted by a process restart must not remain "running" forever.
            now = utc_now_iso()
            conn.execute(
                """UPDATE jobs SET status='error', error=?, message=?, updated_at=?, finished_at=?
                   WHERE status IN ('queued','processing')""",
                ("Application restarted before this job finished", "Interrupted", now, now),
            )
            conn.execute(
                """UPDATE exports SET status='error', error=?, updated_at=?
                   WHERE status IN ('queued','processing')""",
                ("Application restarted before this export finished", now),
            )

    @staticmethod
    def _row(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
        return dict(row) if row else None

    def create_song(self, song_id: str, original_filename: str, stored_filename: Optional[str]) -> dict[str, Any]:
        now = utc_now_iso()
        status = {"separation": "pending", "transcription": "pending", "render": "pending"}
        with self._write_lock, self.connect() as conn:
            conn.execute(
                """INSERT INTO songs(id,original_filename,stored_filename,created_at,updated_at,status_json)
                   VALUES(?,?,?,?,?,?)""",
                (song_id, original_filename, stored_filename, now, now, _json(status)),
            )
        return self.get_song(song_id)

    def upsert_imported_song(
        self,
        song_id: str,
        original_filename: str,
        stored_filename: Optional[str],
        status: dict[str, Any],
    ) -> bool:
        now = utc_now_iso()
        with self._write_lock, self.connect() as conn:
            exists = conn.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone()
            if exists:
                return False
            conn.execute(
                """INSERT INTO songs(id,original_filename,stored_filename,created_at,updated_at,status_json)
                   VALUES(?,?,?,?,?,?)""",
                (song_id, original_filename, stored_filename, now, now, _json(status)),
            )
            return True

    def get_song(self, song_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
        if not row:
            raise SongNotFound(song_id)
        result = dict(row)
        result["status"] = json.loads(result.pop("status_json") or "{}")
        return result

    def list_songs(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM songs ORDER BY created_at DESC").fetchall()
        result = []
        for row in rows:
            song = dict(row)
            song["status"] = json.loads(song.pop("status_json") or "{}")
            result.append(song)
        return result

    def delete_song(self, song_id: str) -> None:
        self.get_song(song_id)
        with self._write_lock, self.connect() as conn:
            conn.execute("DELETE FROM songs WHERE id=?", (song_id,))
        # Also clean up disk files if they exist
        import shutil
        out_dir = OUTPUTS_DIR / song_id
        if out_dir.exists():
            shutil.rmtree(out_dir, ignore_errors=True)

    def update_stage(
        self,
        song_id: str,
        stage: str,
        status: str,
        *,
        progress: Optional[float] = None,
        error: Optional[str] = None,
        message: Optional[str] = None,
    ) -> dict[str, Any]:
        song = self.get_song(song_id)
        state = song["status"]
        state[stage] = status
        details = state.setdefault("details", {})
        detail = details.setdefault(stage, {})
        if progress is not None:
            # Public API contract: progress is always a percentage in [0, 100].
            detail["progress"] = max(0.0, min(100.0, float(progress)))
        if error is not None:
            detail["error"] = error
        elif status != "error":
            detail.pop("error", None)
        if message is not None:
            detail["message"] = message
        detail["updated_at"] = utc_now_iso()
        with self._write_lock, self.connect() as conn:
            conn.execute(
                "UPDATE songs SET status_json=?, updated_at=? WHERE id=?",
                (_json(state), utc_now_iso(), song_id),
            )
        return state

    def latest_lyrics_version(self, song_id: str) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT MAX(version) AS version FROM lyric_versions WHERE song_id=?", (song_id,)
            ).fetchone()
        return int(row["version"] or 0)

    def save_lyrics(
        self,
        lyrics: LyricsData,
        *,
        expected_version: Optional[int],
        source: str,
    ) -> LyricsData:
        self.get_song(lyrics.song_id)
        with self._write_lock, self.connect() as conn:
            current_row = conn.execute(
                "SELECT MAX(version) AS version FROM lyric_versions WHERE song_id=?", (lyrics.song_id,)
            ).fetchone()
            current = int(current_row["version"] or 0)
            if expected_version is not None and expected_version != current:
                raise VersionConflict(f"Lyrics changed: expected version {expected_version}, current version {current}")
            saved = lyrics.model_copy(deep=True)
            saved.version = current + 1
            saved.updated_at = utc_now_iso()
            conn.execute(
                """INSERT INTO lyric_versions(song_id,version,title,data_json,source,created_at)
                   VALUES(?,?,?,?,?,?)""",
                (
                    saved.song_id,
                    saved.version,
                    saved.title,
                    saved.model_dump_json(),
                    source,
                    saved.updated_at,
                ),
            )
            conn.execute("UPDATE songs SET updated_at=? WHERE id=?", (saved.updated_at, saved.song_id))
        return saved

    def get_lyrics(self, song_id: str, version: Optional[int] = None) -> LyricsData:
        self.get_song(song_id)
        query = "SELECT data_json FROM lyric_versions WHERE song_id=?"
        params: tuple[Any, ...] = (song_id,)
        if version is None:
            query += " ORDER BY version DESC LIMIT 1"
        else:
            query += " AND version=?"
            params = (song_id, version)
        with self.connect() as conn:
            row = conn.execute(query, params).fetchone()
        if not row:
            raise StorageError("Lyrics not found")
        return LyricsData.model_validate_json(row["data_json"])

    def list_lyrics_versions(self, song_id: str) -> list[dict[str, Any]]:
        self.get_song(song_id)
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT version,title,source,created_at FROM lyric_versions
                   WHERE song_id=? ORDER BY version DESC""",
                (song_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def materialize_latest_lyrics(self, lyrics: LyricsData, outputs_dir: Path = OUTPUTS_DIR) -> Path:
        """Atomically update the legacy JSON mirror used by older project builds."""
        song_dir = outputs_dir / lyrics.song_id
        song_dir.mkdir(parents=True, exist_ok=True)
        destination = song_dir / "lyrics.json"
        temporary = song_dir / "lyrics.json.tmp"
        temporary.write_text(lyrics.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(destination)
        return destination

    def create_job(self, song_id: str, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.get_song(song_id)
        now = utc_now_iso()
        with self._write_lock, self.connect() as conn:
            active = conn.execute(
                """SELECT * FROM jobs WHERE song_id=? AND kind=?
                   AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1""",
                (song_id, kind),
            ).fetchone()
            if active:
                raise DuplicateJob(self._decode_job(active))
            job_id = str(uuid4())
            conn.execute(
                """INSERT INTO jobs(id,song_id,kind,status,progress,message,payload_json,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (job_id, song_id, kind, "queued", 0.0, "Queued", _json(payload), now, now),
            )
        return self.get_job(job_id)

    @staticmethod
    def _decode_job(row: sqlite3.Row) -> dict[str, Any]:
        job = dict(row)
        job["payload"] = json.loads(job.pop("payload_json") or "{}")
        raw_result = job.pop("result_json")
        job["result"] = json.loads(raw_result) if raw_result else None
        return job

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise StorageError("Job not found")
        return self._decode_job(row)

    def list_jobs(self, song_id: str, *, active_only: bool = False, limit: int = 20) -> list[dict[str, Any]]:
        query = "SELECT * FROM jobs WHERE song_id=?"
        if active_only:
            query += " AND status IN ('queued','processing')"
        query += " ORDER BY created_at DESC LIMIT ?"
        with self.connect() as conn:
            rows = conn.execute(query, (song_id, limit)).fetchall()
        return [self._decode_job(row) for row in rows]

    def update_job(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        result: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        current = self.get_job(job_id)
        now = utc_now_iso()
        fields = ["updated_at=?"]
        values: list[Any] = [now]
        if status is not None:
            fields.append("status=?")
            values.append(status)
            if status == "processing" and not current.get("started_at"):
                fields.append("started_at=?")
                values.append(now)
            if status in {"done", "error"}:
                fields.append("finished_at=?")
                values.append(now)
        for column, value in (("progress", progress), ("message", message), ("error", error)):
            if value is not None:
                fields.append(f"{column}=?")
                values.append(max(0.0, min(100.0, float(value))) if column == "progress" else value)
        if result is not None:
            fields.append("result_json=?")
            values.append(_json(result))
        values.append(job_id)
        with self._write_lock, self.connect() as conn:
            conn.execute(f"UPDATE jobs SET {','.join(fields)} WHERE id=?", values)
        return self.get_job(job_id)

    def create_export(self, song_id: str, lyrics_version: int, preset: str) -> dict[str, Any]:
        export_id = str(uuid4())
        now = utc_now_iso()
        with self._write_lock, self.connect() as conn:
            conn.execute(
                """INSERT INTO exports(id,song_id,lyrics_version,preset,status,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?)""",
                (export_id, song_id, lyrics_version, preset, "queued", now, now),
            )
        return self.get_export(export_id)

    def get_export(self, export_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM exports WHERE id=?", (export_id,)).fetchone()
        if not row:
            raise StorageError("Export not found")
        value = dict(row)
        value["artifacts"] = json.loads(value.pop("artifacts_json") or "{}")
        return value

    def latest_export(self, song_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM exports WHERE song_id=? ORDER BY created_at DESC LIMIT 1", (song_id,)
            ).fetchone()
        if not row:
            raise StorageError("Export not found")
        value = dict(row)
        value["artifacts"] = json.loads(value.pop("artifacts_json") or "{}")
        return value

    def update_export(
        self,
        export_id: str,
        *,
        status: Optional[str] = None,
        progress: Optional[float] = None,
        error: Optional[str] = None,
        artifacts: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        fields = ["updated_at=?"]
        values: list[Any] = [utc_now_iso()]
        for column, value in (("status", status), ("progress", progress), ("error", error)):
            if value is not None:
                fields.append(f"{column}=?")
                values.append(max(0.0, min(100.0, float(value))) if column == "progress" else value)
        if artifacts is not None:
            fields.append("artifacts_json=?")
            values.append(_json(artifacts))
        values.append(export_id)
        with self._write_lock, self.connect() as conn:
            conn.execute(f"UPDATE exports SET {','.join(fields)} WHERE id=?", values)
        return self.get_export(export_id)

    def import_existing_library(
        self,
        uploads_dir: Path = UPLOADS_DIR,
        outputs_dir: Path = OUTPUTS_DIR,
    ) -> dict[str, int]:
        """Index legacy files without moving, deleting, or rewriting any of them."""
        imported_songs = 0
        imported_lyrics = 0
        upload_by_stem = {
            path.stem: path for path in uploads_dir.iterdir() if path.is_file() and not path.name.startswith(".")
        }
        ids = set(upload_by_stem)
        ids.update(path.name for path in outputs_dir.iterdir() if path.is_dir())

        for song_id in sorted(ids):
            upload = upload_by_stem.get(song_id)
            song_dir = outputs_dir / song_id
            vocals = list(song_dir.glob("htdemucs/*/vocals.wav")) if song_dir.exists() else []
            instrumental = list(song_dir.glob("htdemucs/*/no_vocals.wav")) if song_dir.exists() else []
            lyrics_path = song_dir / "lyrics.json"
            status = {
                "separation": "done" if vocals and instrumental else "pending",
                "transcription": "done" if lyrics_path.exists() else "pending",
                "render": "done" if (song_dir / "karaoke_output.mp4").exists() else "pending",
            }
            if self.upsert_imported_song(
                song_id,
                upload.name if upload else song_id,
                upload.name if upload else None,
                status,
            ):
                imported_songs += 1

            if lyrics_path.exists() and self.latest_lyrics_version(song_id) == 0:
                try:
                    raw = json.loads(lyrics_path.read_text(encoding="utf-8"))
                    raw["song_id"] = song_id
                    raw.setdefault("title", upload.name if upload else song_id)
                    raw["version"] = 0
                    lyrics = LyricsData.model_validate(raw)
                    self.save_lyrics(lyrics, expected_version=0, source="legacy_import")
                    imported_lyrics += 1
                except (OSError, ValueError, json.JSONDecodeError):
                    self.update_stage(
                        song_id,
                        "transcription",
                        "error",
                        error="Existing lyrics.json could not be imported",
                    )
        return {"songs": imported_songs, "lyrics": imported_lyrics}


store = StudioStore()
