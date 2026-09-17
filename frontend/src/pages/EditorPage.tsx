import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, normalizeLyrics } from '../api/client';
import { ExportPanel } from '../components/ExportPanel';
import { InspectorPanel } from '../components/InspectorPanel';
import { KaraokePreview } from '../components/KaraokePreview';
import { LyricsPanel } from '../components/LyricsPanel';
import { ProcessingTimeline } from '../components/ProcessingTimeline';
import { StudioTimeline, type StudioTimelineHandle } from '../components/StudioTimeline';
import { StyleModal } from '../components/StyleModal';
import { TapSyncModal } from '../components/TapSyncModal';
import { BackendModeBadge } from '../components/BackendModeBadge';
import { ThemeToggle } from '../components/ThemeToggle';
import type { ExportJob, KaraokePreset, LyricsData, LyricLine, LyricWord, ModelPreset, SaveState, TrackKind, VideoStyle } from '../types';
import { playbackStateAt, syncLineText, updateCanonicalLine } from '../utils/lyrics';
import { LyricsSession } from '../utils/lyricsSession';

type ProcessStep = 'upload' | 'separating' | 'transcribing' | 'done' | 'error';
type MobileTab = 'lyrics' | 'preview' | 'inspector';

const EMPTY_EXPORT: ExportJob = { state: 'idle', progress: 0, artifacts: {} };
const DONE_STATES = new Set(['done', 'completed', 'success']);
const ERROR_STATES = new Set(['error', 'failed']);
const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

const DEFAULT_STYLE: VideoStyle = {
  font_family: 'Be Vietnam Pro',
  primary_color: '#F7F3EB',
  secondary_color: '#FFB547',
  outline_color: '#181109',
  effect: 'smooth',
};

const readVideoStyle = (): VideoStyle => {
  try {
    const raw = JSON.parse(localStorage.getItem('karaoke-video-style:v1') || '{}') as Partial<VideoStyle>;
    return { ...DEFAULT_STYLE, ...raw };
  } catch {
    return DEFAULT_STYLE;
  }
};

const readVideoPreset = (): KaraokePreset => {
  try {
    const raw = JSON.parse(localStorage.getItem('karaoke-video-settings:v1') || '{}') as { preset?: KaraokePreset };
    return raw.preset === 'classic' ? 'classic' : 'modern';
  } catch {
    return 'modern';
  }
};

const statusLabel: Record<SaveState, string> = {
  saved: 'Đã lưu',
  unsaved: 'Chưa lưu',
  saving: 'Đang lưu…',
  conflict: 'Có phiên bản mới trên máy',
  error: 'Lỗi lưu',
};

export function EditorPage() {
  const { songId = '' } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const timelineRef = useRef<StudioTimelineHandle>(null);
  const session = useMemo(() => new LyricsSession(), [songId]);
  const { document: lyrics, revision: editRevision, status: saveState, canUndo, canRedo, error: saveError } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { commit, undo, redo } = session;
  const aliveRef = useRef(true);
  const [processStep, setProcessStep] = useState<ProcessStep>('upload');
  const [statusText, setStatusText] = useState('Đang kết nối với bộ xử lý…');
  const [selectedLineId, setSelectedLineId] = useState<string>();
  const [selectedWordId, setSelectedWordId] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [track, setTrack] = useState<TrackKind>('vocals');
  const [preset, setPreset] = useState<KaraokePreset>(readVideoPreset);
  const [videoStyle, setVideoStyle] = useState<VideoStyle>(readVideoStyle);
  const [hasCustomBackground, setHasCustomBackground] = useState(false);
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [modelPreset, setModelPreset] = useState<ModelPreset>('quality');
  const [aligning, setAligning] = useState(false);
  const [notice, setNotice] = useState('');
  const [exportJob, setExportJob] = useState<ExportJob>(EMPTY_EXPORT);
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview');
  const [showTapSync, setShowTapSync] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem('karaoke-video-settings:v1', JSON.stringify({ preset }));
  }, [preset]);

  useEffect(() => {
    localStorage.setItem('karaoke-video-style:v1', JSON.stringify(videoStyle));
  }, [videoStyle]);

  useEffect(() => {
    if (!songId) return;
    let cancelled = false;
    let timer = 0;

    const hydrateWhenReady = async () => {
      try {
        const status = await api.getProcessStatus(songId);
        if (cancelled) return;
        const separation = (status?.separation?.state || (typeof status?.separation === 'string' ? status.separation : 'pending')).toLowerCase();
        const transcription = (status?.transcription?.state || (typeof status?.transcription === 'string' ? status.transcription : 'pending')).toLowerCase();
        if (ERROR_STATES.has(separation) || ERROR_STATES.has(transcription)) {
          setProcessStep('error');
          setStatusText(status.separation.error || status.transcription.error || 'Xử lý bài hát thất bại.');
          return;
        }
        if (!DONE_STATES.has(separation)) {
          setProcessStep('separating');
          setStatusText('Đang tách giọng hát và nhạc nền…');
          timer = window.setTimeout(hydrateWhenReady, 2500);
          return;
        }
        if (!DONE_STATES.has(transcription)) {
          setProcessStep('transcribing');
          setStatusText('Đang nhận diện và căn lời theo từng tiếng…');
          timer = window.setTimeout(hydrateWhenReady, 2500);
          return;
        }
        const document = await api.getLyrics(songId);
        if (cancelled) return;
        session.load(document);
        setSelectedLineId(document.lines[0]?.id);
        setSelectedWordId(undefined);
        setProcessStep('done');
        setStatusText('');

        try {
          const existingExport = await api.getExportStatus(songId);
          if (!cancelled && existingExport && (existingExport.state === 'done' || existingExport.state === 'processing')) {
            setExportJob(existingExport);
          }
        } catch {
          // No prior export found, keep idle
        }

        try {
          const bgCheck = await fetch(api.getBackgroundUrl(songId), { method: 'HEAD' });
          if (!cancelled && bgCheck.ok) {
            setHasCustomBackground(true);
          }
        } catch {
          // No custom background, keep false
        }
      } catch (error) {
        if (cancelled) return;
        setStatusText(error instanceof Error ? error.message : 'Không kết nối được backend.');
        timer = window.setTimeout(hydrateWhenReady, 3000);
      }
    };

    void hydrateWhenReady();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [songId, session]);

  const saveLatest = useCallback(() => session.save((document) => api.saveLyrics(songId, document)), [session, songId]);

  useEffect(() => {
    if (saveState !== 'unsaved' || aligning) return;
    const timer = window.setTimeout(() => void saveLatest(), 1200);
    return () => window.clearTimeout(timer);
  }, [editRevision, saveState, saveLatest, aligning]);

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().status === 'saved') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [session]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || showTapSync || showStyleModal || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [redo, undo, showTapSync, showStyleModal]);

  const selectedLine = useMemo(() => lyrics?.lines.find((line) => line.id === selectedLineId), [lyrics, selectedLineId]);
  const selectedWord = useMemo(() => selectedLine?.words.find((word) => word.id === selectedWordId), [selectedLine, selectedWordId]);
  const playback = useMemo(() => lyrics ? playbackStateAt(lyrics, currentTime) : null, [lyrics, currentTime]);
  const activeLineId = playback && playback.currentLineIndex >= 0 ? lyrics?.lines[playback.currentLineIndex]?.id : undefined;

  const changeLine = useCallback((lineId: string, patch: Partial<LyricLine>) => {
    commit((document) => ({ ...document, lines: document.lines.map((line) => line.id === lineId && !line.locked ? { ...line, ...patch } : line) }));
  }, [commit]);

  const changeWord = useCallback((lineId: string, wordId: string, patch: Partial<LyricWord>) => {
    commit((document) => {
      const owner = document.lines.find((line) => line.id === lineId);
      if (!owner || owner.locked) return document;
      const lines = document.lines.map((line) => {
        if (line.id !== lineId) return line;
        const words = line.words.map((word) => word.id === wordId ? { ...word, ...patch } : word);
        if (patch.word !== undefined) return syncLineText(line, words.map((word) => word.word).join(' '));
        // A deliberate manual timestamp resolves the "new text" marker; validation
        // still reports missing endpoints, overlaps and unusually long syllables.
        return { ...line, words: words.map((word) => word.id === wordId
          ? { ...word, review_reasons: word.review_reasons.filter((reason) => reason !== 'unaligned_text') } : word) };
      });
      return { ...document, lines, canonical_text: patch.word === undefined ? document.canonical_text
        : updateCanonicalLine(document.canonical_text, document.lines, lineId, lines.find((line) => line.id === lineId)!.text) };
    });
  }, [commit]);

  const changeLineText = useCallback((lineId: string, text: string) => {
    commit((document) => document.lines.find((line) => line.id === lineId)?.locked ? document : ({
      ...document,
      canonical_text: updateCanonicalLine(document.canonical_text, document.lines, lineId, text),
      lines: document.lines.map((line) => line.id === lineId ? syncLineText(line, text) : line),
    }));
  }, [commit]);

  const toggleLock = useCallback((lineId: string) => {
    commit((document) => ({ ...document, lines: document.lines.map((line) => line.id === lineId ? { ...line, locked: !line.locked } : line) }));
  }, [commit]);

  const selectLine = useCallback((lineId: string) => {
    setSelectedLineId(lineId);
    setSelectedWordId(undefined);
  }, []);

  const seekTimeline = useCallback((time: number) => timelineRef.current?.seek(time), []);

  const handleRegionChange = useCallback(({ kind, id, start, end }: { kind: 'line' | 'word'; id: string; start: number; end: number }) => {
    if (kind === 'word') {
      const owner = session.getSnapshot().document?.lines.find((line) => line.words.some((word) => word.id === id));
      if (owner && !owner.locked) changeWord(owner.id, id, { start, end });
      return;
    }
    commit((document) => ({
      ...document,
      lines: document.lines.map((line) => {
        if (line.id !== id || line.locked) return line;
        const oldDuration = line.start !== null && line.end !== null ? line.end - line.start : 0;
        const newDuration = end - start;
        const isDrag = Math.abs(oldDuration - newDuration) < 0.012;
        const delta = start - (line.start ?? start);
        return {
          ...line,
          start,
          end,
          words: isDrag ? line.words.map((word) => ({ ...word, start: word.start === null ? null : Math.max(0, word.start + delta), end: word.end === null ? null : Math.max(0, word.end + delta) })) : line.words,
        };
      }),
    }));
  }, [changeWord, commit, session]);

  const nudgeSelected = useCallback((amount: number) => {
    if (!selectedLine || selectedLine.locked) return;
    if (selectedWord) {
      if (selectedWord.start === null || selectedWord.end === null) return;
      const safeAmount = Math.max(amount, -selectedWord.start);
      changeWord(selectedLine.id, selectedWord.id, { start: selectedWord.start + safeAmount, end: selectedWord.end + safeAmount });
      return;
    }
    if (selectedLine.start === null || selectedLine.end === null) return;
    const safeAmount = Math.max(amount, -selectedLine.start);
    changeLine(selectedLine.id, {
      start: selectedLine.start + safeAmount,
      end: selectedLine.end + safeAmount,
      words: selectedLine.words.map((word) => ({ ...word, start: word.start === null ? null : word.start + safeAmount, end: word.end === null ? null : word.end + safeAmount })),
    });
  }, [changeLine, changeWord, selectedLine, selectedWord]);

  const setBoundary = useCallback((boundary: 'start' | 'end') => {
    if (!selectedLine || selectedLine.locked) return;
    if (selectedWord) changeWord(selectedLine.id, selectedWord.id, { [boundary]: currentTime });
    else changeLine(selectedLine.id, { [boundary]: currentTime });
  }, [changeLine, changeWord, currentTime, selectedLine, selectedWord]);

  const applyAlignedDocument = useCallback((document: LyricsData, revisionAtStart: number) => {
    if (!session.applyAligned(document, revisionAtStart)) {
      setNotice('Căn nhịp đã xong nhưng chưa áp dụng vì bạn đã sửa lời trong lúc xử lý. Chỉnh sửa hiện tại vẫn nguyên vẹn.');
      return;
    }
    setSelectedLineId((id) => document.lines.some((line) => line.id === id) ? id : document.lines[0]?.id);
    setSelectedWordId(undefined);
    setNotice('Đã áp dụng kết quả căn nhịp mới.');
  }, [session]);

  const runAlignment = useCallback(async (lineIds?: string[], overrideLyricsText?: string) => {
    if (!session.getSnapshot().document || aligning) return;
    const saved = await saveLatest();
    if (!saved) return;
    const { document, revision: revisionAtStart } = session.getSnapshot();
    if (!document) return;
    setAligning(true);
    setNotice(overrideLyricsText ? 'Đang căn lại nhịp cho bản lời mới…' : lineIds ? 'Đang căn lại câu đã chọn trên vocal…' : 'Đang căn lại toàn bài trên vocal…');
    try {
      const lyricsText = overrideLyricsText
        ? overrideLyricsText
        : lineIds
          ? document.lines.filter((line) => lineIds.includes(line.id)).map((line) => line.text).join('\n')
          : document.canonical_text || document.lines.map((line) => line.text).join('\n');
      const response = await api.alignLyrics(songId, lyricsText, modelPreset, document.version, lineIds);
      const record = (response && typeof response === 'object' ? response : {}) as Record<string, unknown>;
      const possibleLyrics = (record.lyrics && typeof record.lyrics === 'object' ? record.lyrics : record) as Record<string, unknown>;
      if (Array.isArray(possibleLyrics.lines)) {
        applyAlignedDocument(normalizeLyrics(possibleLyrics, songId), revisionAtStart);
        return;
      }
      if (typeof record.job_id !== 'string') throw new Error('Backend không trả mã tác vụ căn lời.');
      while (aliveRef.current) {
        await wait(1500);
        if (!aliveRef.current) return;
        const job = await api.getJob(record.job_id);
        if (ERROR_STATES.has(job.status)) throw new Error(job.error || 'Căn nhịp thất bại.');
        if (DONE_STATES.has(job.status)) {
          const aligned = await api.getLyrics(songId);
          applyAlignedDocument(aligned, revisionAtStart);
          return;
        }
      }
    } catch (error) {
      setNotice(`Không thể căn lại: ${error instanceof Error ? error.message : 'lỗi không xác định'}`);
    } finally {
      if (aliveRef.current) setAligning(false);
    }
  }, [aligning, applyAlignedDocument, modelPreset, saveLatest, session, songId]);

  const startExport = useCallback(async () => {
    const saved = await saveLatest();
    if (!saved) return;
    try {
      let job = await api.startExport(songId, preset, session.getSnapshot().document!.version, videoStyle);
      setExportJob(job);
      for (let attempt = 0; attempt < 600 && aliveRef.current && (job.state === 'queued' || job.state === 'processing'); attempt += 1) {
        await wait(1500);
        job = await api.getExportStatus(songId, job.export_id);
        setExportJob(job);
      }
    } catch (error) {
      setExportJob({ state: 'error', progress: 0, artifacts: {}, error: error instanceof Error ? error.message : 'Xuất video thất bại.' });
    }
  }, [preset, saveLatest, session, songId, videoStyle]);

  if (processStep !== 'done' || !lyrics) {
    return (
      <main className="processing-page">
        <header className="simple-header">
          <button type="button" className="icon-button" onClick={() => navigate('/')} aria-label="Quay lại">←</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BackendModeBadge />
            <ThemeToggle />
          </div>
        </header>
        <section className="processing-card">
          <span className="processing-orbit">♫</span>
          <span className="eyebrow">KARAOKE STUDIO</span>
          <h1>{processStep === 'error' ? 'Cần kiểm tra lại' : 'Đang chuẩn bị studio'}</h1>
          <p>{statusText}</p>
          <ProcessingTimeline currentStep={processStep} />
        </section>
      </main>
    );
  }

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div className="header-title">
          <button type="button" className="icon-button" onClick={async () => { if (await saveLatest()) navigate('/'); }} aria-label="Về thư viện">←</button>
          <div><span className="eyebrow">KARAOKE STUDIO</span><h1>{lyrics.title}</h1></div>
        </div>
        <div className="header-actions">
          <span className={`save-indicator ${saveState}`}><i />{statusLabel[saveState]} · v{lyrics.version}</span>
          <button type="button" className="secondary-button icon-only-mobile" onClick={undo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)">↶ <span>Hoàn tác</span></button>
          <button type="button" className="secondary-button icon-only-mobile" onClick={redo} disabled={!canRedo} title="Làm lại (Ctrl+Y)">↷ <span>Làm lại</span></button>
          <button type="button" className="secondary-button" disabled={aligning} onClick={() => void saveLatest()}>Lưu ngay</button>
          <button type="button" className="secondary-button" disabled={aligning} onClick={() => void runAlignment()}>⌁ Căn lại toàn bài</button>
          <button
            type="button"
            className="secondary-button"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 600 }}
            onClick={() => { timelineRef.current?.pause(); setShowTapSync(true); }}
            title="Gõ nhịp phím Space theo bài hát (Tap-to-sync)"
          >
            ⌨ Gõ nhịp (Space)
          </button>
          <BackendModeBadge />
          <ThemeToggle />
        </div>
      </header>

      {notice ? <div className="studio-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button></div> : null}
      {saveError ? <div className="studio-notice" role="alert">{saveError} Chỉnh sửa vẫn được giữ trong trình sửa.</div> : null}

      <nav className="mobile-tabs" aria-label="Các bảng chỉnh sửa">
        {(['lyrics', 'preview', 'inspector'] as MobileTab[]).map((tab) => (
          <button type="button" key={tab} className={mobileTab === tab ? 'active' : ''} onClick={() => setMobileTab(tab)}>
            {tab === 'lyrics' ? 'Lời' : tab === 'preview' ? 'Preview' : 'Thuộc tính'}
          </button>
        ))}
      </nav>

      <div className="studio-workspace">
        <div className={`mobile-pane pane-lyrics ${mobileTab === 'lyrics' ? 'mobile-active' : ''}`}>
          <LyricsPanel
            lines={lyrics.lines}
            selectedLineId={selectedLineId}
            activeLineId={activeLineId}
            onSelect={selectLine}
            onSeek={seekTimeline}
            onTextChange={changeLineText}
            onToggleLock={toggleLock}
            onReplaceAllLyrics={(newText) => void runAlignment(undefined, newText)}
          />
        </div>

        <section className={`preview-column mobile-pane pane-preview ${mobileTab === 'preview' ? 'mobile-active' : ''}`}>
          <div className="preview-toolbar">
            <div><span className="eyebrow">LIVE PREVIEW</span><strong>Khung hình 16:9</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => setShowStyleModal(true)}
              >
                🎨 Tùy biến chữ & Nền
              </button>
              <div className="segmented-control">
                <button type="button" className={preset === 'modern' ? 'active' : ''} onClick={() => setPreset('modern')}> Apple Music</button>
                <button type="button" className={preset === 'classic' ? 'active' : ''} onClick={() => setPreset('classic')}>Classic KTV</button>
              </div>
              <button
                type="button"
                className="primary-button"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.35rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '999px',
                  fontWeight: 650,
                  boxShadow: '0 2px 10px rgba(245, 158, 11, 0.3)',
                }}
                onClick={async () => {
                  await saveLatest();
                  navigate(`/preview/${songId}`);
                }}
                title="Mở chế độ Sân khấu Karaoke toàn màn hình để hát"
              >
                🎤 Sân khấu (Stage)
              </button>
            </div>
          </div>
          <div className="preview-stack">
            <KaraokePreview
              lyrics={lyrics}
              currentTime={currentTime}
              preset={preset}
              songId={songId}
              style={videoStyle}
              hasCustomBackground={hasCustomBackground}
              backgroundRevision={backgroundRevision}
              onSeek={seekTimeline}
            />
          </div>
          <ExportPanel songId={songId} preset={preset} job={exportJob} disabled={saveState === 'conflict' || aligning} onStart={() => void startExport()} />
        </section>

        <div className={`mobile-pane pane-inspector ${mobileTab === 'inspector' ? 'mobile-active' : ''}`}>
          <InspectorPanel
            line={selectedLine}
            word={selectedWord}
            currentTime={currentTime}
            preset={preset}
            modelPreset={modelPreset}
            aligning={aligning}
            onPresetChange={setPreset}
            onModelPresetChange={setModelPreset}
            onLineChange={changeLine}
            onWordChange={changeWord}
            onSelectWord={setSelectedWordId}
            onPlayWord={(word) => { if (word.start !== null && word.end !== null) timelineRef.current?.playSegment(word.start, word.end); }}
            onToggleLock={toggleLock}
            onNudge={nudgeSelected}
            onSetBoundary={setBoundary}
            onRealignLine={(lineId) => void runAlignment([lineId])}
          />
        </div>
      </div>

      <StudioTimeline
        ref={timelineRef}
        songId={songId}
        lyrics={lyrics}
        track={track}
        suspendShortcuts={showTapSync || showStyleModal}
        selectedLineId={selectedLineId}
        selectedWordId={selectedWordId}
        onTrackChange={setTrack}
        onTimeChange={setCurrentTime}
        onSelectRegion={(kind, id) => {
          if (kind === 'line') selectLine(id);
          else {
            const owner = session.getSnapshot().document?.lines.find((line) => line.words.some((word) => word.id === id));
            if (owner) setSelectedLineId(owner.id);
            setSelectedWordId(id);
          }
        }}
        onRegionChange={handleRegionChange}
      />

      {showTapSync && lyrics ? (
        <TapSyncModal
          songId={songId}
          lyrics={lyrics}
          initialLineId={selectedLineId}
          onApply={(updatedLyrics) => {
            commit(() => updatedLyrics);
            setNotice('Đã cập nhật mốc nhịp mới từ công cụ Gõ nhịp!');
          }}
          onClose={() => setShowTapSync(false)}
        />
      ) : null}

      {showStyleModal ? (
        <StyleModal
          songId={songId}
          style={videoStyle}
          hasCustomBackground={hasCustomBackground}
          onStyleChange={setVideoStyle}
          onBackgroundUpdated={(hasBg) => { setHasCustomBackground(hasBg); setBackgroundRevision((version) => version + 1); }}
          onClose={() => setShowStyleModal(false)}
        />
      ) : null}
    </main>
  );
}
