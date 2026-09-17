"""Isolated 12-second FFmpeg/API fixture; does not modify the user's library."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.validation' / 'smoke'
os.environ['KARAOKE_DATABASE_PATH'] = str(WORK / 'studio.db')
os.environ['KARAOKE_UPLOADS_DIR'] = str(WORK / 'uploads')
os.environ['KARAOKE_OUTPUTS_DIR'] = str(WORK / 'outputs')
sys.path.insert(0, str(ROOT / 'backend'))

from app.models.schemas import LyricsData, LyricLine, WordTimestamp, StyleOptions
from app.services.binaries import ffmpeg_binary
from app.services.storage import store
from app.services.renderer import render_video
from app.config import OUTPUTS_DIR, UPLOADS_DIR

def run(*args):
    return subprocess.run([ffmpeg_binary(), '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)], check=True, capture_output=True)

store.initialize()
try:
    store.get_song('smoke')
except Exception:
    store.create_song('smoke', 'Kiểm thử khoảng nghỉ và dấu Việt', 'smoke.wav')
song = OUTPUTS_DIR / 'smoke'
song.mkdir(parents=True, exist_ok=True)
run('-f', 'lavfi', '-i', 'sine=frequency=220:duration=12:sample_rate=44100', '-ac', '2', UPLOADS_DIR / 'smoke.wav')
run('-i', UPLOADS_DIR / 'smoke.wav', song / 'no_vocals.wav')
run('-f', 'lavfi', '-i', 'sine=frequency=440:duration=12:sample_rate=44100', '-ac', '2', song / 'vocals.wav')
run('-f', 'lavfi', '-i', 'color=c=0x577A96:s=640x360', '-frames:v', '1', song / 'background.jpg')
lines = [
    LyricLine(id='line-a', start=1, end=8.6, text='Ánh nắng vàng', words=[
        WordTimestamp(id='w-a',word='Ánh',start=1.1,end=1.6),
        WordTimestamp(id='w-b',word='nắng',start=5.64,end=6.5),
        WordTimestamp(id='w-c',word='vàng',start=7,end=8.6),
    ]),
    LyricLine(id='line-b', start=9, end=11.5, text='Mình hát cùng nhau', words=[
        WordTimestamp(id=f'w-{i+3}',word=w,start=9+i*.6,end=9.5+i*.6) for i,w in enumerate(['Mình','hát','cùng','nhau'])
    ]),
]
version = store.latest_lyrics_version('smoke')
lyrics = store.save_lyrics(LyricsData(song_id='smoke',title='Kiểm thử · khoảng nghỉ 4,04 giây',canonical_text='Ánh nắng vàng\n\nMình hát cùng nhau',lines=lines), expected_version=version, source='smoke')
store.materialize_latest_lyrics(lyrics)
for stage in ('separation', 'transcription'):
    store.update_stage('smoke',stage,'done',progress=100)

report = []
for preset in ('classic','modern'):
    progress = []
    artifacts = render_video('smoke',preset=preset,lyrics_version=lyrics.version,style=StyleOptions(font_family='Be Vietnam Pro'),report=lambda p,m: progress.append(round(p,2)))
    video = Path(artifacts['mp4'])
    probe = str(Path(ffmpeg_binary()).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe'))
    metadata = json.loads(subprocess.run([probe,'-v','error','-show_streams','-show_format','-of','json',str(video)],capture_output=True,text=True,check=True).stdout)
    streams=metadata['streams']; v=next(s for s in streams if s['codec_type']=='video'); a=next(s for s in streams if s['codec_type']=='audio')
    assert (v['width'],v['height'],v['r_frame_rate'],v['codec_name'],a['codec_name']) == (1920,1080,'30/1','h264','aac')
    assert abs(float(metadata['format']['duration'])-12)<.1
    assert len(set(progress))>3, progress
    decoded=run('-i',video,'-map','0:a:0','-f','s16le','-ac','1','-ar','4000','pipe:1').stdout
    reference=run('-i',song/'no_vocals.wav','-f','s16le','-ac','1','-ar','4000','pipe:1').stdout
    import array, math
    x=array.array('h',decoded); y=array.array('h',reference); n=min(len(x),len(y))
    corr=sum(x[i]*y[i] for i in range(n))/math.sqrt(sum(v*v for v in x[:n])*sum(v*v for v in y[:n]))
    assert corr>.95, corr
    for moment in (1.3,5.9,10.3):
        run('-ss',moment,'-i',video,'-frames:v','1',WORK/f'{preset}-{moment}.png')
    report.append({'preset':preset,'mp4':str(video),'duration':metadata['format']['duration'],'video':[v['width'],v['height'],v['r_frame_rate']],'audio':a['codec_name'],'instrumental_correlation':corr,'progress':progress})
(WORK/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(report,indent=2,ensure_ascii=False))
