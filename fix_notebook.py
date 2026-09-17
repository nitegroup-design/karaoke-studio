import json

with open('worker/karaoke_colab_worker.ipynb', 'r', encoding='utf-8') as f:
    nb = json.load(f)

new_source = '''#@title 3. Khởi động GPU Worker (Chạy nhận việc tự động)
import os, time, sys, json, tempfile, traceback
from pathlib import Path
import torch, stable_whisper
import urllib.request

# Tải công cụ Render Video (FFmpeg + ASS) từ Github
print('🚀 Đang chuẩn bị môi trường render video...')
os.system('apt-get update && apt-get install -y ffmpeg fonts-noto-core fonts-noto-cjk')
if not os.path.exists('karaoke-studio'):
    os.system('git clone https://github.com/nitegroup-design/karaoke-studio.git')
    os.system('pip install -q pydantic')
if 'karaoke-studio/backend' not in sys.path:
    sys.path.append('karaoke-studio/backend')

from app.models.schemas import LyricsData
from app.services.renderer import generate_ass_text, generate_srt_text

print('⚡ GPU Worker đang lắng nghe hàng đợi từ Supabase...')

def process_export_job(job, p: Path):
    job_id = job['id']
    song_id = job['song_id']
    payload = job.get('payload') or {}
    preset = payload.get('preset', 'modern')
    
    print(f'📥 Đang chuẩn bị dữ liệu xuất video (Preset: {preset})...')
    supabase.table('jobs').update({'progress': 10, 'message': 'Đang tải tài nguyên...'}).eq('id', job_id).execute()
    
    # Lấy lyrics
    lyrics_res = supabase.table('lyrics').select('*').eq('song_id', song_id).single().execute().data
    if not lyrics_res:
        raise ValueError("Không tìm thấy lời bài hát.")
    lyrics_data = LyricsData.model_validate(lyrics_res)
    
    # Tải nhạc nền (WAV) từ bucket audio-stems
    instrumental_path = p / 'no_vocals.wav'
    print('📥 Đang tải nhạc nền...')
    stem_data = supabase.storage.from_('audio-stems').download(f'{song_id}/no_vocals.wav')
    with open(instrumental_path, 'wb') as f: f.write(stem_data)
    
    # Tạo ASS và SRT
    print('📝 Đang tạo file phụ đề ASS/SRT...')
    ass_text = generate_ass_text(lyrics_data, preset=preset)
    srt_text = generate_srt_text(lyrics_data)
    ass_path = p / f"karaoke_{preset}.ass"
    srt_path = p / f"karaoke_{preset}.srt"
    with open(ass_path, 'w', encoding='utf-8-sig') as f: f.write(ass_text)
    with open(srt_path, 'w', encoding='utf-8-sig') as f: f.write(srt_text)
    
    # Tải nền
    bg_path = p / 'background.jpg'
    has_bg = False
    try:
        bg_data = supabase.storage.from_('audio-inputs').download(f'{song_id}/background.jpg')
        with open(bg_path, 'wb') as f: f.write(bg_data)
        has_bg = True
    except:
        pass

    # Chạy FFmpeg
    print('🎬 Đang dựng video MP4 1080p bằng FFmpeg...')
    supabase.table('jobs').update({'progress': 30, 'message': 'Đang dựng video MP4 1080p...'}).eq('id', job_id).execute()
    video_path = p / f"karaoke_{preset}.mp4"
    
    fontsdir = 'karaoke-studio/backend/assets/fonts'
    if has_bg:
        cmd = f'ffmpeg -y -loop 1 -framerate 30 -i "{bg_path}" -i "{instrumental_path}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,drawbox=color=0x0A0A0E@0.55:t=fill,subtitles={ass_path.name}:fontsdir=\\'{fontsdir}\\'" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "{video_path}"'
    else:
        cmd = f'ffmpeg -y -f lavfi -i "color=c=0x111216:s=1920x1080:r=30" -i "{instrumental_path}" -vf "subtitles={ass_path.name}:fontsdir=\\'{fontsdir}\\'" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "{video_path}"'
        
    os.system(cmd)
    
    if not video_path.exists():
        raise RuntimeError("Lỗi khi gọi lệnh ffmpeg render video.")
        
    print('☁️ Đang tải Video, ASS, SRT lên Supabase Storage...')
    supabase.table('jobs').update({'progress': 80, 'message': 'Đang tải video lên Cloud...'}).eq('id', job_id).execute()
    
    with open(video_path, 'rb') as f:
        supabase.storage.from_('video-exports').upload(f'{song_id}/karaoke.mp4', f, {'content-type': 'video/mp4', 'upsert': 'true'})
    with open(ass_path, 'rb') as f:
        supabase.storage.from_('video-exports').upload(f'{song_id}/lyrics.ass', f, {'content-type': 'text/x-ass', 'upsert': 'true'})
    with open(srt_path, 'rb') as f:
        supabase.storage.from_('video-exports').upload(f'{song_id}/lyrics.srt', f, {'content-type': 'text/plain', 'upsert': 'true'})
        
    supabase.table('jobs').update({'status': 'done', 'progress': 100, 'message': 'Hoàn thành video!'}).eq('id', job_id).execute()
    print(f'✅ Xong xuất video MP4 cho bài hát {song_id}!')

def process_one_job(job):
    job_id = job['id']
    song_id = job['song_id']
    kind = job.get('kind', 'process')
    print(f'\\n⚡ Nhận tác vụ: {job_id} | Loại: {kind} | Bài hát: {song_id}')
    
    with tempfile.TemporaryDirectory() as td:
        p = Path(td)
        
        if kind == 'export':
            return process_export_job(job, p)
            
        # Process separation and transcription
        song = supabase.table('songs').select('*').eq('id', song_id).single().execute().data
        payload = job.get('payload') or {}
        audio_file = p / 'input.mp3'
        
        if song.get('audio_path'):
            print('📥 Đang tải audio từ Supabase Storage...')
            data = supabase.storage.from_('audio-inputs').download(song['audio_path'])
            audio_file.write_bytes(data)
        elif song.get('youtube_url'):
            print('📥 Đang tải audio từ YouTube...')
            import yt_dlp
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': str(p / 'yt.%(ext)s'),
                'noplaylist': True,
                'quiet': True,
                'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3'}],
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(song['youtube_url'], download=True)
                title = info.get('title') or song.get('title')
                supabase.table('songs').update({'title': title}).eq('id', song_id).execute()
            audio_file = p / 'yt.mp3'
            with open(audio_file, 'rb') as f:
                supabase.storage.from_('audio-inputs').upload(f'{song_id}/original.mp3', f, {'content-type': 'audio/mpeg', 'upsert': 'true'})
            supabase.table('songs').update({'audio_path': f'{song_id}/original.mp3'}).eq('id', song_id).execute()
        
        # 1. Tách nhạc
        print('🎵 Đang tách giọng hát bằng Demucs GPU...')
        supabase.table('jobs').update({'progress': 20, 'message': 'Đang tách nhạc trên GPU T4...'}).eq('id', job_id).execute()
        os.system(f'demucs --two-stems vocals -n htdemucs -d cuda -o {td} "{audio_file}" > /dev/null 2>&1')
        stems_dir = list(p.glob('htdemucs/*'))[0]
        vocals = stems_dir / 'vocals.wav'
        no_vocals = stems_dir / 'no_vocals.wav'
        
        print('☁️ Đang tải bản tách nhạc lên Supabase...')
        with open(vocals, 'rb') as f:
            supabase.storage.from_('audio-stems').upload(f'{song_id}/vocals.wav', f, {'content-type': 'audio/wav', 'upsert': 'true'})
        with open(no_vocals, 'rb') as f:
            supabase.storage.from_('audio-stems').upload(f'{song_id}/no_vocals.wav', f, {'content-type': 'audio/wav', 'upsert': 'true'})
        supabase.table('songs').update({'status': {'separation': 'done', 'transcription': 'processing', 'render': 'pending'}}).eq('id', song_id).execute()
        
        # 2. Căn nhịp
        print('🎤 Đang căn nhịp lời bài hát bằng Whisper large-v3 GPU...')
        supabase.table('jobs').update({'progress': 60, 'message': 'Đang căn nhịp lời bài hát trên GPU T4...'}).eq('id', job_id).execute()
        model = stable_whisper.load_faster_whisper('large-v3', device='cuda', compute_type='float16')
        ref_text = payload.get('lyrics_text') or song.get('canonical_text')
        if ref_text and ref_text.strip():
            res = model.align(str(vocals), ref_text.strip(), language='vi', original_split=True)
        else:
            res = model.transcribe(str(vocals), language='vi', word_timestamps=True, vad_filter=True)
        
        lines = []
        for s_idx, seg in enumerate(res.segments or []):
            raw_words = seg.words or []
            for i in range(len(raw_words) - 1):
                gap = float(raw_words[i+1].start) - float(raw_words[i].end)
                if 0.0 < gap <= 0.85:
                    raw_words[i].end = round(float(raw_words[i+1].start) - 0.03, 3)
            if raw_words and seg.end and float(raw_words[-1].end) < float(seg.end) and (float(seg.end) - float(raw_words[-1].end)) <= 2.2:
                raw_words[-1].end = round(float(seg.end) - 0.05, 3)
            words = [{'id': f'w-{s_idx}-{w_idx}', 'word': w.word.strip(), 'start': round(float(w.start), 3), 'end': round(float(w.end), 3), 'review_required': False, 'review_reasons': []} for w_idx, w in enumerate(raw_words)]
            lines.append({'id': f'l-{s_idx}', 'text': seg.text.strip(), 'start': round(float(seg.start), 3), 'end': round(float(seg.end), 3), 'words': words, 'locked': False, 'review_required': False, 'review_reasons': []})
        
        # 3. Cập nhật lời
        supabase.table('lyrics').upsert({'song_id': song_id, 'title': song.get('title') or 'Bài hát', 'version': 1, 'canonical_text': ref_text, 'lines': lines}, on_conflict='song_id').execute()
        supabase.table('songs').update({'status': {'separation': 'done', 'transcription': 'done', 'render': 'pending'}}).eq('id', song_id).execute()
        supabase.table('jobs').update({'status': 'done', 'progress': 100, 'message': 'Hoàn thành!'}).eq('id', job_id).execute()
        print(f'✅ Xong bài hát {song_id} với {len(lines)} câu hát!')

while True:
    try:
        jobs = supabase.table('jobs').select('*').eq('status', 'queued').order('created_at').limit(1).execute().data
        if jobs:
            j = jobs[0]
            supabase.table('jobs').update({'status': 'processing', 'progress': 5, 'message': 'GPU Colab đang xử lý...'}).eq('id', j['id']).execute()
            try:
                process_one_job(j)
            except Exception as e:
                traceback.print_exc()
                supabase.table('jobs').update({'status': 'error', 'error': str(e), 'message': f'Lỗi: {e}'}).eq('id', j['id']).execute()
        time.sleep(2)
    except KeyboardInterrupt:
        print('Dừng worker.')
        break
    except Exception as e:
        print('Lỗi vòng lặp:', e)
        time.sleep(3)
'''

lines = [line + '\n' for line in new_source.split('\n')]
lines[-1] = lines[-1].strip('\n')
nb['cells'][3]['source'] = lines

with open('worker/karaoke_colab_worker.ipynb', 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
