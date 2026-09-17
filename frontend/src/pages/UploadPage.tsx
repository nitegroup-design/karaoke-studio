import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BackendModeBadge } from '../components/BackendModeBadge';
import { ProcessingTimeline } from '../components/ProcessingTimeline';
import { ThemeToggle } from '../components/ThemeToggle';
import type { ModelPreset, Song } from '../types';

type ProcessStep = 'upload' | 'separating' | 'transcribing' | 'done' | 'error';

const stateOf = (song: Song, key: 'separation' | 'transcription') => {
  const val = song.status[key] as any;
  if (typeof val === 'string') return val.toLowerCase();
  if (val && typeof val === 'object' && 'state' in val) return (val.state as string).toLowerCase();
  return 'pending';
};

const processingStep = (song: Song): ProcessStep => {
  const separation = stateOf(song, 'separation');
  const transcription = stateOf(song, 'transcription');
  if (['error', 'failed'].includes(separation) || ['error', 'failed'].includes(transcription)) return 'error';
  if (['done', 'completed', 'success'].includes(separation) && ['done', 'completed', 'success'].includes(transcription)) return 'done';
  if (!['done', 'completed', 'success'].includes(separation)) return 'separating';
  return 'transcribing';
};

const readableSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;

const cleanLyrics = (raw: string): string => {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[(?:Verse|Chorus|Intro|Outro|Pre-Chorus|Bridge|Refrain|Lời bài hát)[^\]]*\]/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
};

const hasMarkdownOrTags = (text: string) =>
  /\[([^\]]+)\]\([^)]+\)/.test(text) || /\[(?:Verse|Chorus|Intro|Outro|Pre-Chorus|Bridge|Refrain|Lời bài hát)/i.test(text);

export function UploadPage() {
  const navigate = useNavigate();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const lyricInputRef = useRef<HTMLInputElement>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [inputMode, setInputMode] = useState<'file' | 'youtube'>(() => {
    try {
      return (localStorage.getItem('karaoke-draft-mode') as 'file' | 'youtube') || 'file';
    } catch {
      return 'file';
    }
  });
  const [youtubeUrl, setYoutubeUrl] = useState(() => {
    try {
      return localStorage.getItem('karaoke-draft-youtube-url') || '';
    } catch {
      return '';
    }
  });
  const [audioFile, setAudioFile] = useState<File>();
  const [lyricsText, setLyricsText] = useState(() => {
    try {
      return localStorage.getItem('karaoke-draft-lyrics') || '';
    } catch {
      return '';
    }
  });
  const [lyricsFilename, setLyricsFilename] = useState('');
  const [modelPreset, setModelPreset] = useState<ModelPreset>('quality');
  const [isDragging, setIsDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [startError, setStartError] = useState('');

  const refreshSongs = useCallback(async () => {
    try {
      setSongs(await api.listSongs());
      setLibraryError('');
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Không tải được thư viện.');
    }
  }, []);

  useEffect(() => {
    void refreshSongs();
    const interval = window.setInterval(() => void refreshSongs(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshSongs]);

  useEffect(() => {
    try {
      localStorage.setItem('karaoke-draft-lyrics', lyricsText);
      localStorage.setItem('karaoke-draft-youtube-url', youtubeUrl);
      localStorage.setItem('karaoke-draft-mode', inputMode);
    } catch {
      /* quota exceeded or private mode */
    }
  }, [lyricsText, youtubeUrl, inputMode]);

  const readLyricFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setStartError('File lời phải là định dạng TXT UTF-8.');
      return;
    }
    try {
      setLyricsText(await file.text());
      setLyricsFilename(file.name);
      setStartError('');
    } catch {
      setStartError('Không đọc được file lời. Hãy lưu TXT ở định dạng UTF-8.');
    }
  };

  const handleDroppedFiles = (files: FileList) => {
    const lyric = Array.from(files).find((file) => file.name.toLowerCase().endsWith('.txt'));
    const audio = Array.from(files).find((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(file.name));
    if (audio) setAudioFile(audio);
    if (lyric) void readLyricFile(lyric);
    if (!audio && !lyric) setStartError('Hãy chọn một file âm thanh hoặc TXT.');
  };

  const startProcessing = async () => {
    if (inputMode === 'file' && !audioFile) return;
    if (inputMode === 'youtube' && !youtubeUrl.trim()) return;
    if (starting) return;
    setStarting(true);
    setStartError('');
    try {
      let songId = '';
      if (inputMode === 'youtube') {
        const ytRes = await api.uploadFromYouTube(youtubeUrl.trim());
        songId = ytRes.song_id;
      } else {
        songId = await api.uploadSong(audioFile!);
      }
      await api.processSong(songId, lyricsText.trim(), modelPreset);
      try {
        localStorage.removeItem('karaoke-draft-lyrics');
        localStorage.removeItem('karaoke-draft-youtube-url');
      } catch {}
      navigate(`/editor/${songId}`);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Không thể bắt đầu xử lý.');
      setStarting(false);
    }
  };

  return (
    <main className="home-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="home-header">
        <a className="brand" href="#/" aria-label="Karaoke Studio">
          <span className="brand-mark">K</span>
          <span><strong>Karaoke Studio</strong><small>LYRIC TIMING WORKSPACE</small></span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BackendModeBadge />
          <ThemeToggle />
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow" style={{ color: 'var(--gold)', letterSpacing: '0.14em' }}>● AI AUDIO → LYRICS</span>
          <h1>Đồng bộ lời bài hát<br /><em style={{ color: 'var(--gold)', fontStyle: 'normal', textShadow: '0 0 35px rgba(255,215,0,.19)' }}>đến từng âm tiết.</em></h1>
          <p>Pipeline tự động cho remix, cover, acoustic và live — tách vocal, ASR tiếng Việt, fuzzy alignment, nhận diện lặp lại và micro-alignment độ chính xác cao.</p>
          <div className="hero-points">
            <span><i style={{ color: 'var(--gold)' }}>01</i> So khớp cấu trúc tự động (Fuzzy)</span>
            <span><i style={{ color: 'var(--gold)' }}>02</i> Mốc thời gian chính xác mili-giây</span>
            <span><i style={{ color: 'var(--gold)' }}>03</i> Render Kinetic Typography siêu mượt</span>
          </div>
        </div>

        <div className="create-card">
          <div className="create-card-heading">
            <div><span className="eyebrow" style={{ color: 'var(--gold)' }}>WORKSPACE</span><h2>Khởi tạo tiến trình</h2></div>
            <span className="step-badge" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>GPU Ready</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <button
              type="button"
              className={inputMode === 'file' ? 'primary-button' : 'secondary-button'}
              onClick={() => setInputMode('file')}
              style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            >
              📁 Chọn file từ máy
            </button>
            <button
              type="button"
              className={inputMode === 'youtube' ? 'primary-button' : 'secondary-button'}
              onClick={() => setInputMode('youtube')}
              style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            >
              ▶️ Dán link YouTube
            </button>
          </div>

          {inputMode === 'youtube' ? (
            <div style={{ marginBottom: '1.25rem' }}>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="Dán link YouTube (https://www.youtube.com/watch?v=...)"
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Hệ thống tự động tải audio từ video YouTube về máy và tiến hành tách nhạc/căn lời.
              </small>
            </div>
          ) : (
            <div
              className={`audio-dropzone ${isDragging ? 'dragging' : ''} ${audioFile ? 'has-file' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); handleDroppedFiles(event.dataTransfer.files); }}
            >
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg"
                hidden
                onChange={(event) => { const file = event.target.files?.[0]; if (file) setAudioFile(file); }}
              />
              <button type="button" className="dropzone-button" onClick={() => audioInputRef.current?.click()}>
                <span className="upload-orbit">⌁</span>
                {audioFile ? (
                  <span className="file-summary"><strong>{audioFile.name}</strong><small>{readableSize(audioFile.size)} · Bấm để đổi file</small></span>
                ) : (
                  <span><strong>Kéo & thả file âm thanh vào đây</strong><small>MP3 • WAV • M4A • FLAC — hỗ trợ bản phối dài và live</small></span>
                )}
              </button>
            </div>
          )}

          <div className="lyrics-input-heading">
            <label htmlFor="lyrics-source"><strong>Lời bài hát</strong><small>Tùy chọn nhưng giúp đúng chữ hơn</small></label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {hasMarkdownOrTags(lyricsText) ? (
                <button type="button" className="text-button" style={{ color: 'var(--accent)' }} onClick={() => setLyricsText(cleanLyrics(lyricsText))}>
                  ✨ Làm sạch (bỏ link/thẻ)
                </button>
              ) : null}
              <input ref={lyricInputRef} type="file" accept=".txt,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void readLyricFile(file); }} />
              <button type="button" className="text-button" onClick={() => lyricInputRef.current?.click()}>＋ Nhập TXT</button>
            </div>
          </div>
          {lyricsFilename ? <div className="source-file-chip">TXT · {lyricsFilename}<button type="button" onClick={() => { setLyricsFilename(''); setLyricsText(''); }}>×</button></div> : null}
          <textarea
            id="lyrics-source"
            rows={7}
            value={lyricsText}
            onChange={(event) => { setLyricsText(event.target.value); setLyricsFilename(''); }}
            placeholder={'Dán nguyên lời tại đây…\nGiữ mỗi câu trên một dòng. Điệp khúc lặp vẫn giữ nguyên.'}
          />
          <div className="lyrics-stats">
            <span>{lyricsText.split(/\r?\n/).filter((line) => line.trim()).length} câu</span>
            <span>{lyricsText.trim() ? lyricsText.trim().split(/\s+/).length : 0} tiếng</span>
          </div>

          <div className="create-footer">
            <label className="model-select"><span>Mô hình</span><select value={modelPreset} onChange={(event) => setModelPreset(event.target.value as ModelPreset)}><option value="quality">Chuẩn · large-v3</option><option value="draft">Nháp nhanh · small</option></select></label>
            <button
              type="button"
              className="primary-button start-button"
              disabled={(inputMode === 'file' ? !audioFile : !youtubeUrl.trim()) || starting}
              onClick={() => void startProcessing()}
            >
              {starting ? (
                <><span className="spinner" /> {inputMode === 'youtube' ? 'Đang tải từ YouTube…' : 'Đang tải lên…'}</>
              ) : (
                <>Bắt đầu xử lý <span>→</span></>
              )}
            </button>
          </div>
          {startError ? (
            <div className="start-error-box" role="alert">
              <strong>Lỗi kết nối</strong>
              <p>{startError}</p>
            </div>
          ) : null}
          <p className="privacy-note">Tệp chỉ được xử lý trên máy của bạn. Lyric được dùng để căn chữ, không thay đổi nội dung.</p>
        </div>
      </section>

      <section className="library-section">
        <div className="section-heading"><div><span className="eyebrow">THƯ VIỆN CỤC BỘ</span><h2>Các bài gần đây</h2></div><span className="count-pill">{songs.length} bài</span></div>
        {libraryError ? <p className="library-error">Không kết nối được backend: {libraryError}</p> : null}
        <div className="song-grid">
          {songs.map((song) => {
            const step = processingStep(song);
            return (
              <article key={song.song_id} className="song-card" onClick={() => navigate(`/editor/${song.song_id}`)}>
                <div className="song-card-inner" aria-label={`Mở ${song.filename}`}>
                  <span className="song-art"><i /><i /><i /><i /></span>
                  <span className="song-info"><strong>{song.title || song.filename}</strong><small>{step === 'done' ? 'Sẵn sàng chỉnh sửa' : step === 'error' ? 'Có lỗi xử lý' : 'Đang xử lý…'}</small></span>
                  <span className={`song-status ${step}`}>{step === 'done' ? 'MỞ' : step === 'error' ? 'LỖI' : 'ĐANG CHẠY'}</span>
                  <button
                    type="button"
                    className="delete-song-btn"
                    title="Xóa bài hát"
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (window.confirm(`Bạn có chắc muốn xóa bài "${song.title || song.filename}" khỏi thư viện?`)) {
                        try {
                          await api.deleteSong(song.song_id);
                          setSongs((prev) => prev.filter((s) => s.song_id !== song.song_id));
                        } catch (err) {
                          alert('Lỗi xóa bài: ' + (err instanceof Error ? err.message : String(err)));
                        }
                      }
                    }}
                    style={{
                      marginLeft: '8px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted, #888)',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted, #888)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    🗑
                  </button>
                </div>
                {step !== 'done' && step !== 'error' ? <ProcessingTimeline currentStep={step} /> : null}
              </article>
            );
          })}
          {songs.length === 0 && !libraryError ? <div className="empty-library"><span>♫</span><strong>Chưa có bài hát</strong><p>Bài đầu tiên sẽ xuất hiện ở đây sau khi bạn bấm “Bắt đầu xử lý”.</p></div> : null}
        </div>
      </section>
    </main>
  );
}
