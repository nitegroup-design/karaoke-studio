import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { api } from '../api/client';
import type { KaraokePreset, LyricLine, LyricsData, VideoStyle } from '../types';
import { playbackStateAt } from '../utils/lyrics';

interface KaraokePreviewProps {
  songId?: string;
  lyrics: LyricsData;
  currentTime: number;
  preset: KaraokePreset;
  style?: VideoStyle;
  hasCustomBackground?: boolean;
  backgroundRevision?: number;
  onSeek?: (time: number) => void;
}


function LuxuryStageBackground({
  hasCustomBackground,
  songId,
  backgroundRevision = 0,
}: {
  hasCustomBackground?: boolean;
  songId?: string;
  backgroundRevision?: number;
}) {
  const bgUrl = hasCustomBackground && songId
    ? `${api.getBackgroundUrl(songId)}?v=${backgroundRevision}`
    : '';

  return (
    <div className="stage-backdrop" aria-hidden="true">
      {/* Custom background image if present */}
      {hasCustomBackground && bgUrl ? (
        <div
          className="stage-custom-image"
          style={{
            backgroundImage: `linear-gradient(rgba(10, 10, 15, 0.65), rgba(10, 10, 15, 0.7)), url(${bgUrl})`,
          }}
        />
      ) : (
        <>
          {/* Deep black base */}
          <div className="stage-base" style={{ position: 'absolute', inset: 0, background: '#020202' }} />

          {/* Animated colorful light spots (bokeh/orbs) */}
          <div className="stage-light-spot spot-1" />
          <div className="stage-light-spot spot-2" />
          <div className="stage-light-spot spot-3" />
          <div className="stage-light-spot spot-4" />

          {/* Frosted Glass overlay with subtle pulsing logo */}
          <div className="stage-glass-overlay">
            <div className="stage-logo-bg" />
          </div>

        </>
      )}

      {/* Subtle stage floor vignette and scanlines */}
      <div className="stage-vignette" />
    </div>
  );
}

function BeatCountdown({ secondsRemaining }: { secondsRemaining: number }) {
  const dots = Math.max(0, Math.min(4, Math.floor(secondsRemaining)));
  return (
    <div className="countdown-badge">
      <div className="countdown-dots" aria-hidden="true">
        {[4, 3, 2, 1].map((dot) => (
          <span key={dot} className={`countdown-dot ${dots >= dot ? 'active' : ''}`} />
        ))}
      </div>
      <span className="sr-only">Chuẩn bị hát...</span>
    </div>
  );
}

function LuxuryWord({
  word,
  fill,
  isCurrent,
  fontFamily,
  primaryColor,
  secondaryColor,
  outlineColor,
  effect,
}: {
  word: string;
  fill: number;
  isCurrent: boolean;
  fontFamily?: string;
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  effect?: 'smooth' | 'glow' | 'pop';
}) {
  const isGlow = effect === 'glow';
  const isPop = effect === 'pop';

  return (
    <span
      className="luxury-word"
      style={{
        display: 'inline-block',
        position: 'relative',
        margin: '0 0.14em',
        fontFamily,
        fontWeight: 800,
        letterSpacing: '0.015em',
        transform: isPop && isCurrent ? 'scale(1.08)' : isCurrent ? 'scale(1.02)' : 'scale(1)',
        transition: 'transform 0.12s cubic-bezier(0.2, 0, 0, 1)',
      }}
    >
      {/* Background/Base Text with outline and shadow */}
      <span
        style={{
          color: primaryColor,
          WebkitTextStroke: outlineColor && outlineColor !== 'transparent' ? `1.5px ${outlineColor}` : undefined,
          textShadow: outlineColor && outlineColor !== 'transparent'
            ? `0 3px 6px ${outlineColor}, 0 1px 2px rgba(0,0,0,0.8)`
            : '0 2px 8px rgba(0,0,0,0.15)', // Very soft, clean shadow for Apple mode
        }}
      >
        {word}
      </span>

      {/* Foreground Highlighted Fill */}
      <span
        className="luxury-word-fill"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          color: secondaryColor,
          clipPath: `inset(0 ${Math.max(0, 100 - fill)}% 0 0)`,
          WebkitTextStroke: outlineColor && outlineColor !== 'transparent' ? `1.5px ${outlineColor}` : undefined,
          textShadow: outlineColor && outlineColor !== 'transparent'
            ? (isGlow || isCurrent ? `0 0 12px ${secondaryColor}, 0 2px 4px ${outlineColor}` : `0 2px 4px ${outlineColor}`)
            : (isGlow ? `0 0 14px ${secondaryColor}` : '0 2px 8px rgba(0,0,0,0.15)'), // Clean glow without heavy drop shadow
          willChange: 'clip-path',
        }}
      >
        {word}
      </span>
    </span>
  );
}

function HighlightedLine({
  line,
  wordIndex,
  progress,
  active,
  style,
  align = 'center',
}: {
  line: LyricLine;
  wordIndex: number;
  progress: number;
  active: boolean;
  style?: VideoStyle;
  align?: 'left' | 'center' | 'right';
}) {
  const fontFamily = style?.font_family;
  const primaryColor = style?.primary_color || '#F7F3EB';
  const secondaryColor = style?.secondary_color || '#00B7FF';
  const outlineColor = style?.outline_color || '#181109';
  const effect = style?.effect || 'smooth';

  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!containerRef.current || !textRef.current) return;
    const updateScale = () => {
      const cWidth = containerRef.current?.clientWidth || 0;
      const tWidth = textRef.current?.scrollWidth || 0;
      // Allow a tiny margin, scale down if text is larger than 95% of container
      if (cWidth > 0 && tWidth > cWidth * 0.95) {
        setScale((cWidth * 0.95) / tWidth);
      } else {
        setScale(1);
      }
    };
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    if (textRef.current) observer.observe(textRef.current); // Catch font load size changes
    
    // Fallback: update on document fonts ready
    document.fonts?.ready.then(updateScale);
    
    updateScale();
    return () => observer.disconnect();
  }, [line.text]);

  // Adjust transformOrigin based on alignment so it scales gracefully
  const origin = align === 'left' ? 'left center' : align === 'right' ? 'right center' : 'center';

  return (
    <div
      ref={containerRef}
      className={`luxury-line ${active ? 'luxury-line-active' : 'luxury-line-inactive'}`}
      style={{
        fontFamily,
        margin: 0,
        width: '100%',
        maxWidth: '100%',
        display: 'flex',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        alignItems: 'center',
        opacity: active ? 1 : 0.45,
        transition: 'opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        ref={textRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          transform: `scale(${scale * (active ? 1 : 0.95)})`,
          transformOrigin: origin,
          transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {line.words.length > 0 ? (
          line.words.map((word, index) => {
            const fill = active
              ? index < wordIndex
                ? 100
                : index === wordIndex
                  ? progress * 100
                  : 0
              : 0;
            const isCurrentWord = active && index === wordIndex;

            return (
              <LuxuryWord
                key={word.id}
                word={word.word}
                fill={fill}
                isCurrent={isCurrentWord}
                fontFamily={fontFamily}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                outlineColor={outlineColor}
                effect={effect}
              />
            );
        })
      ) : (
        <span style={{ 
          color: primaryColor, 
          WebkitTextStroke: outlineColor && outlineColor !== 'transparent' ? `1.5px ${outlineColor}` : undefined,
          textShadow: outlineColor && outlineColor !== 'transparent' ? undefined : '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          {line.text}
        </span>
      )}
      </div>
    </div>
  );
}

export function KaraokePreview({
  songId,
  lyrics,
  currentTime,
  preset,
  style,
  hasCustomBackground,
  backgroundRevision,
  onSeek,
}: KaraokePreviewProps) {
  const state = playbackStateAt(lyrics, currentTime);
  const { currentLineIndex, currentWordIndex, wordProgress } = state;

  // Find upcoming line when in pause/intro
  const upcomingInfo = useMemo(() => {
    if (currentLineIndex >= 0) return null;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (line.start !== null && line.start > currentTime) {
        const prevLine = i > 0 ? lyrics.lines[i - 1] : null;
        const gapDuration = prevLine && prevLine.end !== null 
          ? line.start - prevLine.end 
          : line.start;

        return { 
          line, 
          index: i, 
          secondsUntil: line.start - currentTime,
          gapDuration
        };
      }
    }
    return null;
  }, [lyrics.lines, currentTime, currentLineIndex]);

  // Calculate anchor for kinetic scrolling
  const anchor = currentLineIndex >= 0
    ? currentLineIndex
    : upcomingInfo
      ? upcomingInfo.index
      : 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  useLayoutEffect(() => {
    if (preset !== 'modern' || !trackRef.current) return;
    const track = trackRef.current;
    if (anchor >= 0 && anchor < track.children.length) {
      const child = track.children[anchor] as HTMLElement;
      if (child) {
        setScrollOffset(child.offsetTop + child.offsetHeight / 2);
      }
    }
  }, [anchor, preset, lyrics.lines]);

  // =========================================================================
  // Classic Alternating 2-line KTV Preset (Phòng thu TV truyền thống)
  // =========================================================================
  if (preset === 'classic') {
    let topIndex = 0;
    let bottomIndex = 1;

    if (currentLineIndex >= 0) {
      if (currentLineIndex % 2 === 0) {
        topIndex = currentLineIndex;
        bottomIndex = currentLineIndex + 1;
      } else {
        bottomIndex = currentLineIndex;
        topIndex = currentLineIndex + 1;
      }
    } else if (upcomingInfo) {
      if (upcomingInfo.index % 2 === 0) {
        topIndex = upcomingInfo.index;
        bottomIndex = upcomingInfo.index + 1;
      } else {
        bottomIndex = upcomingInfo.index;
        topIndex = upcomingInfo.index + 1;
      }
    }

    const topLine = lyrics.lines[topIndex];
    const bottomLine = lyrics.lines[bottomIndex];
    const isTopActive = currentLineIndex === topIndex;
    const isBottomActive = currentLineIndex === bottomIndex;

    return (
      <div className="karaoke-stage" aria-label="Xem trước karaoke Classic KTV">
        <LuxuryStageBackground
          hasCustomBackground={hasCustomBackground}
          songId={songId}
          backgroundRevision={backgroundRevision}
        />

        <div className="stage-badge">CLASSIC KTV · 1080P</div>

        <div className="classic-lines-container">
          {/* Instrumental or Countdown Indicator */}
          {upcomingInfo && upcomingInfo.gapDuration >= 5 && upcomingInfo.secondsUntil <= 5 && upcomingInfo.secondsUntil > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <BeatCountdown secondsRemaining={upcomingInfo.secondsUntil} />
            </div>
          )}

          {/* Line 1 (Top Slot) */}
          <div
            className={`classic-slot slot-top ${isTopActive ? 'slot-active' : 'slot-waiting'}`}
            onClick={() => topLine?.start !== null && onSeek && onSeek(topLine.start)}
          >
            {topLine ? (
              <HighlightedLine
                line={topLine}
                wordIndex={isTopActive ? currentWordIndex : -1}
                progress={isTopActive ? wordProgress : 0}
                active={isTopActive}
                style={style}
                align="left"
              />
            ) : (
              <div style={{ minHeight: '2.5rem' }} />
            )}
          </div>

          {/* Line 2 (Bottom Slot) */}
          <div
            className={`classic-slot slot-bottom ${isBottomActive ? 'slot-active' : 'slot-waiting'}`}
            onClick={() => bottomLine?.start !== null && onSeek && onSeek(bottomLine.start)}
          >
            {bottomLine ? (
              <HighlightedLine
                line={bottomLine}
                wordIndex={isBottomActive ? currentWordIndex : -1}
                progress={isBottomActive ? wordProgress : 0}
                active={isBottomActive}
                style={style}
                align="right"
              />
            ) : (
              <div style={{ minHeight: '2.5rem' }} />
            )}
          </div>
        </div>

        <div className="safe-area" aria-hidden="true" />
      </div>
    );
  }

  // =========================================================================
  // Apple Music Sing Kinetic Spring Flow (Chuẩn Apple Music siêu mượt)
  // =========================================================================




  return (
    <div className="karaoke-stage apple-stage" aria-label="Xem trước Apple Music Sing">
      <LuxuryStageBackground
        hasCustomBackground={hasCustomBackground}
        songId={songId}
        backgroundRevision={backgroundRevision}
      />

      <div className="stage-badge"> APPLE MUSIC SING</div>

      {upcomingInfo && upcomingInfo.gapDuration >= 5 && upcomingInfo.secondsUntil <= 5 && upcomingInfo.secondsUntil > 0 && (
        <div className="apple-countdown-float">
          <BeatCountdown secondsRemaining={upcomingInfo.secondsUntil} />
        </div>
      )}

      {/* Continuous Kinetic Spring Scroll Viewport */}
      <div className="apple-lyrics-viewport">
        <div
          ref={trackRef}
          className="apple-lyrics-track"
          style={{
            top: '50%',
            transform: `translate3d(0, -${scrollOffset}px, 0)`,
            transition: 'transform 0.68s cubic-bezier(0.2, 0.9, 0.3, 1)',
          }}
        >
          {lyrics.lines.map((line, idx) => {
            const dist = Math.abs(idx - anchor);
            const isActive = idx === currentLineIndex;

            let depthClass = 'apple-line-active';
            if (dist === 1) depthClass = 'apple-line-adjacent';
            else if (dist === 2) depthClass = 'apple-line-mid';
            else if (dist >= 3) depthClass = 'apple-line-far';

            // Performance Culling: Render with visibility: hidden to preserve exact layout height
            // preventing the track from jumping around when items come into view.
            if (dist > 5) {
              return (
                <div
                  key={line.id}
                  className={`apple-line-slot apple-line-far`}
                  style={{ minHeight: '80px', padding: '16px 0', visibility: 'hidden' }}
                >
                  <HighlightedLine
                    line={line}
                    wordIndex={-1}
                    progress={0}
                    active={false}
                    style={style}
                  />
                </div>
              );
            }

            return (
              <div
                key={line.id}
                className={`apple-line-slot ${depthClass} ${isActive ? 'is-active' : ''}`}
                style={{ minHeight: '80px', padding: '16px 0' }}
                onClick={() => {
                  if (line.start !== null && onSeek) onSeek(line.start);
                }}
                title={line.start !== null ? `Nhấn để phát từ câu này (${line.start}s)` : undefined}
              >
                <HighlightedLine
                  line={line}
                  wordIndex={isActive ? currentWordIndex : -1}
                  progress={isActive ? wordProgress : 0}
                  active={isActive}
                  style={style}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="safe-area" aria-hidden="true" />
    </div>
  );
}
