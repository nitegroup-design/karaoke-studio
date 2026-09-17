import { useEffect, useRef, useState } from 'react';
import JASSUB from 'jassub';
import { api } from '../api/client';
import { videoFonts } from '../utils/videoFonts';
import type { KaraokePreset, LyricsData, VideoStyle } from '../types';

interface AssPreviewCanvasProps {
  songId: string;
  lyrics: LyricsData;
  preset: KaraokePreset;
  currentTime: number;
  style?: VideoStyle;
  hasCustomBackground?: boolean;
  backgroundRevision?: number;
  onReadyChange?: (ready: boolean) => void;
}

const EMPTY_ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Be Vietnam Pro,56,&H00FFFFFF,&H0000A5FF,&H00111111,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,90,90,80,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;

export function AssPreviewCanvas({ songId, lyrics, preset, currentTime, style, hasCustomBackground, backgroundRevision = 0, onReadyChange }: AssPreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<JASSUB | null>(null);
  const latestTimeRef = useRef(currentTime);
  const documentRef = useRef(lyrics);
  const sizeRef = useRef({ width: 1920, height: 1080 });
  const [rendererReady, setRendererReady] = useState(false);
  const [trackReady, setTrackReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { latestTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { documentRef.current = lyrics; }, [lyrics]);
  useEffect(() => { onReadyChange?.(trackReady && !error); }, [trackReady, error, onReadyChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // Dynamically create a new canvas each time so transferControlToOffscreen never throws
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    const resize = new ResizeObserver(([entry]) => {
      const width = Math.min(1920, Math.max(320, Math.round(entry.contentRect.width * window.devicePixelRatio)));
      sizeRef.current = { width, height: Math.round(width * 9 / 16) };
      const instance = instanceRef.current;
      if (instance) void instance.ready.then(() => instance.manualRender({ expectedDisplayTime: performance.now(), ...sizeRef.current, mediaTime: latestTimeRef.current }, true)).catch(() => {});
    });
    resize.observe(container);

    try {
      const instance = new JASSUB({
        canvas,
        subContent: EMPTY_ASS,
        fonts: [videoFonts['Be Vietnam Pro']],
        availableFonts: videoFonts,
        defaultFont: 'Be Vietnam Pro',
        queryFonts: false,
        prescaleHeightLimit: 1080,
      });
      instanceRef.current = instance;
      void instance.ready.then(() => {
        if (cancelled) return;
        setRendererReady(true);
      }).catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Không khởi tạo được libass.');
      });
    } catch (err) {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Lỗi khởi tạo libass');
    }

    return () => {
      cancelled = true;
      resize.disconnect();
      if (instanceRef.current) {
        try {
          void instanceRef.current.destroy().catch(() => {});
        } catch { /* Canvas already released. */ }
        instanceRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []);

  useEffect(() => {
    if (!rendererReady) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const ass = (await api.previewAss(songId, documentRef.current, preset, style, controller.signal)).replace(/^\uFEFF/, '');
        if (cancelled || !instanceRef.current) return;
        await instanceRef.current.renderer.setTrack(ass);
        if (cancelled || !instanceRef.current) return;
        await instanceRef.current.manualRender({
          expectedDisplayTime: performance.now(),
          ...sizeRef.current,
          mediaTime: latestTimeRef.current,
        }, true);
        if (!cancelled) {
          setTrackReady(true);
          setError('');
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Không tạo được preview ASS.');
      }
    }, 450);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [lyrics.lines, preset, rendererReady, songId, style]);

  useEffect(() => {
    if (!rendererReady || !trackReady || !instanceRef.current) return;
    void instanceRef.current.manualRender({
        expectedDisplayTime: performance.now(),
        ...sizeRef.current,
        mediaTime: currentTime,
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không vẽ được preview.'));
  }, [currentTime, rendererReady, trackReady]);

  const bgStyle: React.CSSProperties = hasCustomBackground
    ? {
        backgroundImage: `linear-gradient(rgba(10, 10, 14, 0.55), rgba(10, 10, 14, 0.55)), url(${api.getBackgroundUrl(songId)}?v=${backgroundRevision})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {};

  return (
    <div className={`ass-preview ${trackReady && !error ? 'ready' : ''}`} style={bgStyle} aria-hidden="true">
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      {!trackReady && !error ? <span className="ass-status">Đang đồng bộ preview libass…</span> : null}
      {error ? <span className="ass-status error">CSS preview · {error}</span> : null}
    </div>
  );
}
