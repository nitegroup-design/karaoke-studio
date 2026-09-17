import { useMemo } from 'react';
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

// 20 fixed star coordinates for consistent twinkling without re-rendering jitter
const STARS = [
  { top: '12%', left: '8%', size: 3, delay: '0s', duration: '2.5s' },
  { top: '18%', left: '24%', size: 2, delay: '0.7s', duration: '3.1s' },
  { top: '8%', left: '42%', size: 4, delay: '1.2s', duration: '2.8s' },
  { top: '22%', left: '62%', size: 2.5, delay: '0.3s', duration: '3.4s' },
  { top: '14%', left: '78%', size: 3, delay: '1.5s', duration: '2.9s' },
  { top: '10%', left: '92%', size: 2, delay: '0.9s', duration: '3.2s' },
  { top: '35%', left: '15%', size: 2.5, delay: '1.8s', duration: '3.5s' },
  { top: '48%', left: '5%', size: 3, delay: '0.4s', duration: '2.7s' },
  { top: '65%', left: '12%', size: 2, delay: '1.1s', duration: '3.3s' },
  { top: '78%', left: '22%', size: 3.5, delay: '0.6s', duration: '2.6s' },
  { top: '82%', left: '48%', size: 2, delay: '1.4s', duration: '3.6s' },
  { top: '72%', left: '68%', size: 2.5, delay: '0.2s', duration: '2.8s' },
  { top: '85%', left: '84%', size: 3, delay: '1.7s', duration: '3.0s' },
  { top: '60%', left: '94%', size: 2, delay: '0.8s', duration: '3.2s' },
  { top: '38%', left: '86%', size: 3.5, delay: '1.3s', duration: '2.9s' },
  { top: '28%', left: '35%', size: 2, delay: '2.0s', duration: '3.4s' },
];

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
          {/* Apple-style Living Ambient Aurora Orbs */}
          <div className="apple-aurora-orb orb-1" />
          <div className="apple-aurora-orb orb-2" />
          <div className="stage-glow-ambient" />
          <div className="stage-glow-spotlight" />

          {/* Golden embossed logo watermark in center */}
          <div className="stage-logo-watermark">
            <svg viewBox="0 0 100 100" className="stage-logo-svg">
              <defs>
                <linearGradient id="logoGold" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="44" stroke="url(#logoGold)" strokeWidth="1.5" fill="none" opacity="0.35" />
              <circle cx="50" cy="50" r="38" stroke="rgba(245, 158, 11, 0.3)" strokeWidth="1" strokeDasharray="4 4" fill="none" />
              {/* Stylized Microphone & Music Notes */}
              <rect x="44" y="24" width="12" height="24" rx="6" fill="url(#logoGold)" opacity="0.75" />
              <path d="M38 36 C38 48 62 48 62 36" stroke="url(#logoGold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85" />
              <line x1="50" y1="48" x2="50" y2="64" stroke="url(#logoGold)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
              <line x1="38" y1="64" x2="62" y2="64" stroke="url(#logoGold)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
              {/* Music Clef / Sparkle Accents */}
              <circle cx="70" cy="28" r="3" fill="url(#logoGold)" opacity="0.6" />
              <circle cx="30" cy="28" r="2" fill="url(#logoGold)" opacity="0.5" />
            </svg>
            <span className="stage-logo-text">KARAOKE STUDIO</span>
          </div>

          {/* Twinkling Starfield */}
          <div className="stage-stars-container">
            {STARS.map((star, idx) => (
              <div
                key={idx}
                className="stage-star"
                style={{
                  top: star.top,
                  left: star.left,
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  animationDelay: star.delay,
                  animationDuration: star.duration,
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Subtle stage floor vignette and scanlines */}
      <div className="stage-vignette" />
    </div>
  );
}

function BeatCountdown({ secondsRemaining }: { secondsRemaining: number }) {
  const dotsCount = Math.max(1, Math.min(4, Math.ceil(secondsRemaining)));

  return (
    <div className="countdown-badge" role="status" aria-label={`Chuẩn bị vào bài sau ${secondsRemaining.toFixed(1)} giây`}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.05em' }}>
        CHUẨN BỊ
      </span>
      <div className="countdown-dots">
        {[4, 3, 2, 1].map((dotIndex) => (
          <span
            key={dotIndex}
            className={`countdown-dot ${dotsCount >= dotIndex ? 'active' : ''}`}
          />
        ))}
      </div>
      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
        {secondsRemaining.toFixed(1)}s
      </span>
    </div>
  );
}

function InstrumentalNotice({ secondsRemaining }: { secondsRemaining: number }) {
  return (
    <div className="instrumental-badge">
      <div className="audio-bars-mini" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <span>♫ Đoạn dạo nhạc ({Math.ceil(secondsRemaining)}s)</span>
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
          WebkitTextStroke: `1.5px ${outlineColor}`,
          textShadow: `0 3px 8px ${outlineColor}, 0 1px 2px rgba(0,0,0,0.9)`,
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
          WebkitTextStroke: `1.5px ${outlineColor}`,
          textShadow: isGlow || isCurrent
            ? `0 0 14px ${secondaryColor}, 0 0 28px ${secondaryColor}, 0 2px 5px ${outlineColor}`
            : `0 2px 4px ${outlineColor}`,
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
}: {
  line: LyricLine;
  wordIndex: number;
  progress: number;
  active: boolean;
  style?: VideoStyle;
}) {
  const fontFamily = style?.font_family;
  const primaryColor = style?.primary_color || '#F7F3EB';
  const secondaryColor = style?.secondary_color || '#00B7FF';
  const outlineColor = style?.outline_color || '#181109';
  const effect = style?.effect || 'smooth';

  return (
    <p
      className={`luxury-line ${active ? 'luxury-line-active' : 'luxury-line-inactive'}`}
      style={{
        fontFamily,
        margin: 0,
        lineHeight: 1.45,
        opacity: active ? 1 : 0.45,
        transform: active ? 'scale(1)' : 'scale(0.95)',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
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
        <span style={{ color: primaryColor, WebkitTextStroke: `1.5px ${outlineColor}` }}>
          {line.text}
        </span>
      )}
    </p>
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
  const state = useMemo(() => playbackStateAt(lyrics, currentTime), [lyrics, currentTime]);
  const { currentLineIndex, currentWordIndex, wordProgress } = state;

  // Find upcoming line when in pause/intro
  const upcomingInfo = useMemo(() => {
    if (currentLineIndex >= 0) return null;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (line.start !== null && line.start > currentTime) {
        return { line, index: i, secondsUntil: line.start - currentTime };
      }
    }
    return null;
  }, [lyrics.lines, currentTime, currentLineIndex]);

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
          {upcomingInfo && upcomingInfo.secondsUntil > 0 && (
            <div style={{ marginBottom: '8px' }}>
              {upcomingInfo.secondsUntil <= 3.5 ? (
                <BeatCountdown secondsRemaining={upcomingInfo.secondsUntil} />
              ) : (
                <InstrumentalNotice secondsRemaining={upcomingInfo.secondsUntil} />
              )}
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
  const anchor = currentLineIndex >= 0
    ? currentLineIndex
    : upcomingInfo
      ? upcomingInfo.index
      : 0;

  const SLOT_HEIGHT = 70;

  return (
    <div className="karaoke-stage apple-stage" aria-label="Xem trước Apple Music Sing">
      <LuxuryStageBackground
        hasCustomBackground={hasCustomBackground}
        songId={songId}
        backgroundRevision={backgroundRevision}
      />

      <div className="stage-badge"> APPLE MUSIC SING</div>

      {upcomingInfo && upcomingInfo.secondsUntil > 0 && (
        <div className="apple-countdown-float">
          {upcomingInfo.secondsUntil <= 3.5 ? (
            <BeatCountdown secondsRemaining={upcomingInfo.secondsUntil} />
          ) : (
            <InstrumentalNotice secondsRemaining={upcomingInfo.secondsUntil} />
          )}
        </div>
      )}

      {/* Continuous Kinetic Spring Scroll Viewport */}
      <div className="apple-lyrics-viewport">
        <div
          className="apple-lyrics-track"
          style={{
            transform: `translate3d(0, calc(50% - ${anchor * SLOT_HEIGHT + SLOT_HEIGHT / 2}px), 0)`,
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

            return (
              <div
                key={line.id}
                className={`apple-line-slot ${depthClass} ${isActive ? 'is-active' : ''}`}
                style={{ height: `${SLOT_HEIGHT}px` }}
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
