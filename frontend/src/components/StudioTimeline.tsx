import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { api, audioUrl } from '../api/client';
import type { LyricsData, TrackKind } from '../types';
import { formatClock } from '../utils/lyrics';

export interface StudioTimelineHandle {
  seek: (time: number) => void;
  playSegment: (start: number, end: number) => void;
  togglePlay: () => void;
  pause: () => void;
}

interface RegionChange {
  kind: 'line' | 'word';
  id: string;
  start: number;
  end: number;
}

interface StudioTimelineProps {
  songId: string;
  lyrics: LyricsData;
  track: TrackKind;
  suspendShortcuts?: boolean;
  selectedLineId?: string;
  selectedWordId?: string;
  onTrackChange: (track: TrackKind) => void;
  onTimeChange: (time: number) => void;
  onSelectRegion: (kind: 'line' | 'word', id: string) => void;
  onRegionChange: (change: RegionChange) => void;
}

const TRACK_LABELS: Record<TrackKind, string> = {
  original: 'Bản gốc',
  vocals: 'Giọng hát',
  instrumental: 'Nhạc nền',
};

const regionIdentity = (region: Region) => {
  if (region.id.startsWith('line::')) return { kind: 'line' as const, id: region.id.slice(6) };
  if (region.id.startsWith('word::')) return { kind: 'word' as const, id: region.id.slice(6) };
  return null;
};

export const StudioTimeline = forwardRef<StudioTimelineHandle, StudioTimelineProps>(function StudioTimeline({
  songId,
  lyrics,
  track,
  suspendShortcuts = false,
  selectedLineId,
  selectedWordId,
  onTrackChange,
  onTimeChange,
  onSelectRegion,
  onRegionChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const callbackRef = useRef({ onTimeChange, onSelectRegion, onRegionChange });
  const loopRef = useRef({ enabled: false, start: 0, end: 0 });
  const settingsRef = useRef({ speed: 1, suspendShortcuts: false });
  const pendingTrackRef = useRef<{ time: number; playing: boolean } | null>(null);
  const initializedTrackRef = useRef<TrackKind | null>(null);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(32);
  const [loading, setLoading] = useState(0);
  const [audioError, setAudioError] = useState('');
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);

  useEffect(() => {
    callbackRef.current = { onTimeChange, onSelectRegion, onRegionChange };
  }, [onTimeChange, onSelectRegion, onRegionChange]);

  useEffect(() => {
    loopRef.current = { enabled: loopEnabled, start: loopStart, end: loopEnd };
  }, [loopEnabled, loopStart, loopEnd]);

  useEffect(() => { settingsRef.current = { speed, suspendShortcuts }; }, [speed, suspendShortcuts]);

  useImperativeHandle(ref, () => ({
    seek(time) {
      const wave = waveRef.current;
      if (!wave) return;
      wave.setTime(Math.max(0, Math.min(time, wave.getDuration() || time)));
    },
    playSegment(start, end) {
      const wave = waveRef.current;
      if (!wave) return;
      void wave.play(Math.max(0, start), Math.max(start + 0.03, end));
    },
    togglePlay() {
      void waveRef.current?.playPause().catch((error: Error) => setAudioError(error.message));
    },
    pause() { waveRef.current?.pause(); },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      height: 22,
      insertPosition: 'beforebegin',
      style: { color: '#8b8175', fontSize: '10px' },
    });
    const wave = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#a89e91',
      progressColor: '#f59e0b',
      cursorColor: '#ff7a18',
      cursorWidth: 2,
      height: 132,
      normalize: true,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      minPxPerSec: 32,
      autoCenter: true,
      autoScroll: true,
      hideScrollbar: false,
      plugins: [timeline, regions],
    });
    waveRef.current = wave;
    regionsRef.current = regions;

    const unsubscribers = [
      wave.on('ready', (nextDuration) => {
        setReady(true);
        setDuration(nextDuration);
        setLoading(100);
        setAudioError('');
        wave.setPlaybackRate(settingsRef.current.speed, true);
        const pending = pendingTrackRef.current;
        if (pending) {
          wave.setTime(Math.min(pending.time, nextDuration));
          if (pending.playing) void wave.play();
          pendingTrackRef.current = null;
        }
      }),
      wave.on('loading', setLoading),
      wave.on('play', () => setIsPlaying(true)),
      wave.on('pause', () => setIsPlaying(false)),
      wave.on('finish', () => setIsPlaying(false)),
      wave.on('error', (error) => setAudioError(error.message || 'Không tải được audio.')),
      wave.on('timeupdate', (time) => {
        const loop = loopRef.current;
        if (loop.enabled && loop.end > loop.start && time >= loop.end) {
          wave.setTime(loop.start);
          if (!wave.isPlaying()) void wave.play();
          return;
        }
        setCurrentTime(time);
        callbackRef.current.onTimeChange(time);
      }),
      regions.on('region-clicked', (region, event) => {
        event.stopPropagation();
        const identity = regionIdentity(region);
        if (!identity) return;
        callbackRef.current.onSelectRegion(identity.kind, identity.id);
        if (identity.kind === 'word') void region.play(true);
        else wave.setTime(region.start);
      }),
      regions.on('region-updated', (region) => {
        const identity = regionIdentity(region);
        if (!identity) return;
        callbackRef.current.onRegionChange({ ...identity, start: region.start, end: region.end });
      }),
    ];

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (event.code === 'Space' && !typing && !event.defaultPrevented && !event.repeat && !settingsRef.current.suspendShortcuts && !target?.closest('button, [role="dialog"]')) {
        event.preventDefault();
        void wave.playPause().catch((error: Error) => setAudioError(error.message));
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      try {
        wave.destroy();
      } catch {
        /* Abort errors or unmount race conditions are harmless */
      }
      waveRef.current = null;
      regionsRef.current = null;
      initializedTrackRef.current = null;
    };
  }, [songId]);

  useEffect(() => {
    const wave = waveRef.current;
    if (!wave) return;
    if (initializedTrackRef.current === track) return;
    const switching = initializedTrackRef.current !== null;
    if (switching && !pendingTrackRef.current) {
      pendingTrackRef.current = { time: wave.getCurrentTime(), playing: wave.isPlaying() };
    }
    wave.pause();
    initializedTrackRef.current = track;
    setReady(false);
    setLoading(0);
    setAudioError('');
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await api.getWaveform(songId, track, 6000, controller.signal);
        if (controller.signal.aborted) return;
        const peaks = data?.peaks;
        const channels = peaks?.length ? (typeof peaks[0] === 'number' ? [peaks as number[]] : peaks as number[][]) : undefined;
        // With peaks + duration, WaveSurfer streams the media instead of decoding a full WAV.
        await wave.load(audioUrl(songId, track), channels, data?.duration || undefined);
      } catch (error) {
        const isAbort = controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort')));
        if (!isAbort) setAudioError(error instanceof Error ? error.message : 'Không tải được audio.');
      }
    };
    void load();
    return () => { controller.abort(); };
  }, [songId, track]);

  useEffect(() => {
    const wave = waveRef.current;
    if (!wave) return;
    wave.setPlaybackRate(speed, true);
  }, [speed]);

  useEffect(() => {
    const wave = waveRef.current;
    if (!wave || !ready) return;
    wave.zoom(zoom);
  }, [zoom, ready]);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !ready) return;
    regions.clearRegions();
    lyrics.lines.forEach((line, index) => {
      if (line.start === null || line.end === null || line.end <= line.start) return;
      const selected = line.id === selectedLineId;
      const content = document.createElement('span');
      content.className = 'region-label';
      content.textContent = `${index + 1}`;
      content.style.cssText = 'font:700 10px Be Vietnam Pro,sans-serif;color:#fff;background:rgba(17,18,22,.7);padding:2px 5px;border-radius:5px;margin:3px;display:inline-block';
      regions.addRegion({
        id: `line::${line.id}`,
        start: Math.max(0, line.start),
        end: Math.max(line.start + 0.03, line.end),
        color: selected ? 'rgba(194,65,12,.30)' : line.review_required ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
        drag: !line.locked,
        resize: !line.locked,
        minLength: 0.03,
        content,
      });
    });
    const selectedLine = lyrics.lines.find((line) => line.id === selectedLineId);
    if (selectedLine) {
      selectedLine.words.forEach((word) => {
        if (word.start === null || word.end === null || word.end <= word.start) return;
        const content = document.createElement('span');
        content.textContent = word.word;
        content.style.cssText = `font:600 10px Be Vietnam Pro,sans-serif;color:#241f19;background:${word.id === selectedWordId ? '#ffb547' : 'rgba(255,248,238,.86)'};padding:2px 5px;border-radius:5px;margin:52px 2px 0;display:inline-block;white-space:nowrap`;
        regions.addRegion({
          id: `word::${word.id}`,
          start: Math.max(0, word.start),
          end: Math.max(word.start + 0.03, word.end),
          color: word.id === selectedWordId ? 'rgba(255,181,71,.48)' : 'rgba(255,181,71,.22)',
          drag: !selectedLine.locked,
          resize: !selectedLine.locked,
          minLength: 0.03,
          content,
        });
      });
    }
  }, [lyrics.lines, ready, selectedLineId, selectedWordId]);

  return (
    <section className="timeline-dock" aria-label="Timeline âm thanh và lời">
      <div className="timeline-toolbar">
        <div className="transport-controls">
          <button type="button" className="play-button" onClick={() => waveRef.current?.playPause()} disabled={!ready} aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}>
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <time>{formatClock(currentTime, true)} <span>/ {formatClock(duration, true)}</span></time>
        </div>
        <div className="track-switcher segmented-control">
          {(Object.keys(TRACK_LABELS) as TrackKind[]).map((item) => (
            <button type="button" key={item} className={track === item ? 'active' : ''} onClick={() => onTrackChange(item)}>{TRACK_LABELS[item]}</button>
          ))}
        </div>
        <div className="timeline-tools">
          <label className="zoom-control">Zoom <input type="range" min={12} max={160} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
          <div className="segmented-control speed-control">
            {[0.5, 0.75, 1].map((rate) => <button type="button" key={rate} className={speed === rate ? 'active' : ''} onClick={() => setSpeed(rate)}>{rate}×</button>)}
          </div>
          <button type="button" className={loopEnabled ? 'tool-active' : ''} onClick={() => setLoopStart(currentTime)}>A {formatClock(loopStart)}</button>
          <button type="button" className={loopEnabled ? 'tool-active' : ''} onClick={() => setLoopEnd(currentTime)}>B {formatClock(loopEnd)}</button>
          <button type="button" disabled={!loopEnabled && loopEnd <= loopStart} className={loopEnabled ? 'tool-active' : ''} onClick={() => setLoopEnabled((value) => !value)}>↻ {loopEnabled ? 'Lặp' : 'A–B'}</button>
        </div>
      </div>
      <div className="waveform-shell">
        {!ready && !audioError ? <div className="wave-loading"><span style={{ width: `${loading}%` }} />Đang tải waveform… {loading}%</div> : null}
        {audioError ? <div className="wave-error">{audioError}</div> : null}
        <div ref={containerRef} className="waveform-canvas" />
      </div>
      <div className="timeline-legend">
        <span><i className="legend-line" /> Vùng câu</span>
        <span><i className="legend-word" /> Vùng tiếng trong câu đang chọn</span>
        <span>Kéo để dịch · kéo cạnh để đổi độ dài · Space để phát/dừng</span>
      </div>
    </section>
  );
});
