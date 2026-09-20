"""
Karaoke Studio - Universal GPU Worker
Chạy được trên cả Google Colab (Free GPU T4) lẫn RunPod Serverless GPU.
"""

from __future__ import annotations

import os
import sys
import time
import json
import shutil
import tempfile
import traceback
from pathlib import Path
from typing import Any, Optional

try:
    from supabase import create_client, Client
except ImportError:
    print("Vui lòng cài đặt: pip install supabase demucs stable-ts yt-dlp")
    sys.exit(1)

# Cấu hình Supabase (qua biến môi trường hoặc nhập trực tiếp)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ.get("SUPABASE_KEY", ""))
WORKER_ID = os.environ.get("WORKER_ID", f"gpu-worker-{os.getpid()}")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("⚠️ CẢNH BÁO: Chưa cấu hình SUPABASE_URL hoặc SUPABASE_KEY!")


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def download_file_from_storage(supabase: Client, bucket: str, remote_path: str, local_path: Path):
    local_path.parent.mkdir(parents=True, exist_ok=True)
    res = supabase.storage.from_(bucket).download(remote_path)
    local_path.write_bytes(res)
    return local_path


def upload_file_to_storage(supabase: Client, bucket: str, remote_path: str, local_path: Path, content_type: str = "audio/wav"):
    with open(local_path, "rb") as f:
        supabase.storage.from_(bucket).upload(
            remote_path,
            f,
            file_options={"content-type": content_type, "upsert": "true"}
        )
    return remote_path


def run_demucs_gpu(input_audio: Path, output_dir: Path, report_callback=None) -> tuple[Path, Path]:
    """Tách giọng bằng Demucs sử dụng GPU CUDA."""
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🎸 Bắt đầu tách nhạc bằng Demucs trên thiết bị: {device.upper()}")
    if report_callback:
        report_callback(10, f"Đang tách nhạc trên GPU ({device})...")

    import subprocess
    cmd = [
        sys.executable,
        "-m", "demucs",
        "--two-stems", "vocals",
        "-n", "htdemucs",
        "-d", device,
        "-o", str(output_dir),
        str(input_audio),
    ]
    subprocess.run(cmd, check=True)

    # Tìm file kết quả
    stem_dir = list(output_dir.glob("htdemucs/*"))[0]
    vocals = stem_dir / "vocals.wav"
    no_vocals = stem_dir / "no_vocals.wav"

    if not vocals.exists() or not no_vocals.exists():
        raise RuntimeError("Demucs không tạo được file stems.")

    return vocals, no_vocals


def run_whisper_alignment_gpu(vocals_audio: Path, reference_text: Optional[str], report_callback=None) -> list[dict]:
    """Căn nhịp từng từ bằng stable-whisper trên GPU CUDA."""
    import torch
    import stable_whisper

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    print(f"🎙️ Bắt đầu nhận diện & căn lời bằng Whisper trên: {device.upper()} ({compute_type})")
    if report_callback:
        report_callback(50, f"Đang nhận diện giọng hát trên GPU ({device})...")

    model = stable_whisper.load_faster_whisper("large-v3", device=device, compute_type=compute_type)

    if reference_text and reference_text.strip():
        if report_callback:
            report_callback(70, "Đang so khớp bản lời chuẩn...")
        # Forced alignment trực tiếp với bản lời chuẩn, Whisper sẽ tự động nhận diện ngôn ngữ
        result = model.align(str(vocals_audio), reference_text.strip(), original_split=True)
    else:
        # Tự động nghe và bóc tách
        result = model.transcribe(
            str(vocals_audio),
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
        )

    lines = []
    for seg_idx, segment in enumerate(getattr(result, "segments", []) or []):
        words = []
        for word_idx, w in enumerate(getattr(segment, "words", []) or []):
            words.append({
                "id": f"word-{seg_idx}-{word_idx}",
                "word": str(getattr(w, "word", "")).strip(),
                "start": round(float(w.start), 3) if getattr(w, "start", None) is not None else None,
                "end": round(float(w.end), 3) if getattr(w, "end", None) is not None else None,
                "review_required": False,
                "review_reasons": []
            })
        lines.append({
            "id": f"line-{seg_idx}",
            "text": str(getattr(segment, "text", "")).strip(),
            "start": round(float(segment.start), 3) if getattr(segment, "start", None) is not None else None,
            "end": round(float(segment.end), 3) if getattr(segment, "end", None) is not None else None,
            "words": words,
            "locked": False,
            "review_required": False,
            "review_reasons": []
        })

    return lines


def process_export_job(supabase: Client, job: dict, report: Any):
    job_id = job["id"]
    song_id = job["song_id"]
    payload = job.get("payload") or {}
    preset = payload.get("preset", "modern")

    report(10, f"Đang chuẩn bị dữ liệu xuất video (Preset: {preset})...")

    # Add backend to sys.path
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app.models.schemas import LyricsData
    from app.services.renderer import generate_ass_text, generate_srt_text, generate_lrc_text
    from app.services.binaries import ffmpeg_binary
    import subprocess

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)

        # 1. Lấy lyrics
        lyrics_res = supabase.table("lyrics").select("*").eq("song_id", song_id).single().execute()
        if not lyrics_res.data:
            raise ValueError(f"Không tìm thấy lời bài hát cho song_id {song_id}")
        lyrics_data = LyricsData.model_validate(lyrics_res.data)

        # 2. Tải nhạc nền (WAV) từ bucket audio-stems (hoặc fallback audio-inputs)
        report(20, "Đang tải nhạc nền instrumental...")
        instrumental_path = temp_dir / "no_vocals.wav"
        try:
            download_file_from_storage(supabase, "audio-stems", f"{song_id}/no_vocals.wav", instrumental_path)
        except Exception:
            print("⚠️ Không tìm thấy no_vocals.wav, tải audio gốc...")
            download_file_from_storage(supabase, "audio-inputs", f"{song_id}/original.mp3", temp_dir / "original.mp3")
            instrumental_path = temp_dir / "original.mp3"

        # 3. Tạo ASS, SRT, LRC
        report(35, "Đang tạo phụ đề karaoke (ASS, SRT, LRC)...")
        ass_text = generate_ass_text(lyrics_data, preset=preset)
        srt_text = generate_srt_text(lyrics_data)
        lrc_text = generate_lrc_text(lyrics_data, enhanced=True)

        ass_path = temp_dir / f"karaoke_{preset}.ass"
        srt_path = temp_dir / f"karaoke_{preset}.srt"
        lrc_path = temp_dir / f"karaoke_{preset}.lrc"
        ass_path.write_text(ass_text, encoding="utf-8-sig")
        srt_path.write_text(srt_text, encoding="utf-8-sig")
        lrc_path.write_text(lrc_text, encoding="utf-8-sig")

        # 4. Kiểm tra ảnh nền nếu có
        bg_path = temp_dir / "background.jpg"
        has_bg = False
        try:
            download_file_from_storage(supabase, "audio-inputs", f"{song_id}/background.jpg", bg_path)
            has_bg = True
        except Exception:
            pass

        # 5. Dựng video MP4 bằng FFmpeg
        report(50, "Đang render video MP4 1080p bằng FFmpeg...")
        video_path = temp_dir / f"karaoke_{preset}.mp4"

        fontsdir = backend_dir / "assets" / "fonts"
        fontsdir_escaped = str(fontsdir).replace("\\", "/")
        ffmpeg_cmd = ffmpeg_binary()

        if has_bg:
            vf = f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,drawbox=color=0x0A0A0E@0.55:t=fill,subtitles={ass_path.name}:fontsdir='{fontsdir_escaped}'"
            args = [
                ffmpeg_cmd, "-y",
                "-loop", "1", "-framerate", "30",
                "-i", bg_path.name,
                "-i", instrumental_path.name,
                "-vf", vf,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest",
                video_path.name,
            ]
        else:
            vf = f"subtitles={ass_path.name}:fontsdir='{fontsdir_escaped}'"
            args = [
                ffmpeg_cmd, "-y",
                "-f", "lavfi", "-i", "color=c=0x111216:s=1920x1080:r=30",
                "-i", instrumental_path.name,
                "-vf", vf,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest",
                video_path.name,
            ]

        res = subprocess.run(args, cwd=str(temp_dir), capture_output=True, text=True)
        if res.returncode != 0:
            print("FFmpeg stderr:", res.stderr)
            raise RuntimeError(f"FFmpeg render thất bại: {res.stderr[-300:]}")

        # 6. Tải các file thành phẩm lên Supabase
        report(85, "Đang tải video MP4 và phụ đề lên Cloud...")
        upload_file_to_storage(supabase, "video-exports", f"{song_id}/karaoke.mp4", video_path, "video/mp4")
        upload_file_to_storage(supabase, "video-exports", f"{song_id}/lyrics.ass", ass_path, "text/x-ass")
        upload_file_to_storage(supabase, "video-exports", f"{song_id}/lyrics.srt", srt_path, "text/plain")
        upload_file_to_storage(supabase, "video-exports", f"{song_id}/lyrics.lrc", lrc_path, "text/plain")

        report(100, "Hoàn tất xuất video thành công!")
        supabase.table("jobs").update({
            "status": "done",
            "progress": 100,
            "message": "Hoàn tất xuất video thành công!",
            "result": {"video_url": f"{song_id}/karaoke.mp4"},
        }).eq("id", job_id).execute()
        print(f"✅ Hoàn thành xuất video MP4 cho bài hát [{song_id}]!")


def process_job(supabase: Client, job: dict):
    job_id = job["id"]
    song_id = job["song_id"]
    kind = job["kind"]
    payload = job.get("payload") or {}

    print(f"\n⚡ Đang nhận Job [{job_id}] cho bài hát [{song_id}] - Loại: {kind}")

    def report(progress: float, message: str):
        print(f"[{progress:.1f}%] {message}")
        supabase.table("jobs").update({
            "progress": progress,
            "message": message,
            "worker_id": WORKER_ID,
        }).eq("id", job_id).execute()

    if kind == "export":
        return process_export_job(supabase, job, report)

    # Lấy thông tin bài hát
    song_res = supabase.table("songs").select("*").eq("id", song_id).single().execute()
    song = song_res.data
    if not song:
        raise ValueError(f"Không tìm thấy bài hát với ID {song_id}")

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        local_audio = temp_dir / "input_audio.mp3"

        # 1. Tải audio đầu vào
        if song.get("audio_path"):
            report(5, "Đang tải audio từ Supabase Storage...")
            download_file_from_storage(supabase, "audio-inputs", song["audio_path"], local_audio)
        elif song.get("youtube_url"):
            report(5, f"Đang tải audio từ YouTube: {song['youtube_url']}...")
            import yt_dlp
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": str(temp_dir / "yt.%(ext)s"),
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                "extractor_args": {
                    "youtube": {
                        "player_client": ["android", "ios"],
                    },
                },
                "noplaylist": True,
                "quiet": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(song["youtube_url"], download=True)
                title = info.get("title") or song.get("title")
                supabase.table("songs").update({"title": title}).eq("id", song_id).execute()
            local_audio = temp_dir / "yt.mp3"
            # Lưu audio gốc lên storage để tái sử dụng
            upload_file_to_storage(supabase, "audio-inputs", f"{song_id}/original.mp3", local_audio, "audio/mpeg")
            supabase.table("songs").update({"audio_path": f"{song_id}/original.mp3"}).eq("id", song_id).execute()
        else:
            raise ValueError("Bài hát không có audio_path và youtube_url.")

        # 2. Tách nhạc (Demucs)
        stems_dir = temp_dir / "stems"
        vocals_path, no_vocals_path = run_demucs_gpu(local_audio, stems_dir, report)

        # 3. Đưa stems lên Supabase Storage
        report(40, "Đang lưu trữ file giọng hát và nhạc nền...")
        upload_file_to_storage(supabase, "audio-stems", f"{song_id}/vocals.wav", vocals_path, "audio/wav")
        upload_file_to_storage(supabase, "audio-stems", f"{song_id}/no_vocals.wav", no_vocals_path, "audio/wav")

        # 4. Nhận diện & Căn nhịp lời
        lyrics_text = payload.get("lyrics_text") or song.get("canonical_text")
        lines = run_whisper_alignment_gpu(vocals_path, lyrics_text, report)

        # 5. Lưu kết quả lời vào database
        report(90, "Đang lưu dữ liệu nhịp vào Database...")
        lyrics_payload = {
            "song_id": song_id,
            "title": song.get("title") or "Bài hát",
            "version": 1,
            "canonical_text": lyrics_text,
            "lines": lines,
        }
        supabase.table("lyrics").upsert(lyrics_payload, on_conflict="song_id").execute()

        # 6. Cập nhật trạng thái hoàn thành
        status = {
            "separation": "done",
            "transcription": "done",
            "render": "pending",
        }
        supabase.table("songs").update({"status": status}).eq("id", song_id).execute()
        supabase.table("jobs").update({
            "status": "done",
            "progress": 100,
            "message": "Hoàn tất xử lý thành công trên GPU!",
            "result": {"lines_count": len(lines)}
        }).eq("id", job_id).execute()

        print(f"✅ Hoàn thành Job [{job_id}] trong vài giây!")


def run_worker_loop():
    print("=" * 60)
    print(f"🚀 KARAOKE STUDIO GPU WORKER ĐANG CHẠY")
    print(f"ID: {WORKER_ID} | SUPABASE: {SUPABASE_URL}")
    print("=" * 60)
    supabase = get_supabase()

    while True:
        try:
            # Tìm job mới nhất đang xếp hàng
            jobs_res = supabase.table("jobs").select("*").eq("status", "queued").order("created_at").limit(1).execute()
            if jobs_res.data and len(jobs_res.data) > 0:
                job = jobs_res.data[0]
                job_id = job["id"]
                # Đánh dấu đang xử lý
                supabase.table("jobs").update({
                    "status": "processing",
                    "progress": 2,
                    "message": "GPU đã nhận tác vụ...",
                    "worker_id": WORKER_ID
                }).eq("id", job_id).execute()

                try:
                    process_job(supabase, job)
                except Exception as exc:
                    err_msg = f"{type(exc).__name__}: {str(exc)}\n{traceback.format_exc()}"
                    print(f"❌ Lỗi xử lý job [{job_id}]: {err_msg}")
                    supabase.table("jobs").update({
                        "status": "error",
                        "error": str(exc),
                        "message": f"Thất bại: {str(exc)}"
                    }).eq("id", job_id).execute()
            else:
                time.sleep(3)
        except KeyboardInterrupt:
            print("\nĐã dừng Worker.")
            break
        except Exception as exc:
            print(f"Lỗi vòng lặp worker: {exc}")
            time.sleep(5)


if __name__ == "__main__":
    run_worker_loop()
