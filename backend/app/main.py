from __future__ import annotations

import importlib.util
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import upload, process, lyrics, export
from app.config import DATABASE_PATH, OUTPUTS_DIR, UPLOADS_DIR, FONTS_DIR
from app.services.jobs import heavy_jobs
from app.services.binaries import ffmpeg_binary
from app.services.storage import store


def _diagnostics(imported: dict[str, int]) -> dict:
    try:
        ffmpeg_path = ffmpeg_binary()
    except FileNotFoundError:
        ffmpeg_path = None
    return {
        "database": {"ok": DATABASE_PATH.exists(), "path": str(DATABASE_PATH)},
        "ffmpeg": {"ok": bool(ffmpeg_path), "path": ffmpeg_path},
        "demucs": {"ok": importlib.util.find_spec("demucs") is not None},
        "stable_whisper": {"ok": importlib.util.find_spec("stable_whisper") is not None},
        "legacy_import": imported,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.initialize()
    imported = store.import_existing_library()
    app.state.diagnostics = _diagnostics(imported)
    yield
    heavy_jobs.shutdown()


app = FastAPI(title="Karaoke Studio API", version="2.0.0", lifespan=lifespan)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static directories
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/api/fonts", StaticFiles(directory=str(FONTS_DIR)), name="fonts")

# Include routers
app.include_router(upload.router)
app.include_router(process.router)
app.include_router(lyrics.router)
app.include_router(export.router)

@app.get("/")
def read_root():
    return {"message": "Welcome to Karaoke Studio API", "version": app.version}


@app.get("/api/health")
def health():
    diagnostics = getattr(app.state, "diagnostics", None) or _diagnostics({"songs": 0, "lyrics": 0})
    required_ok = all(diagnostics[name]["ok"] for name in ("database", "ffmpeg"))
    return {"status": "ok" if required_ok else "degraded", "diagnostics": diagnostics}
