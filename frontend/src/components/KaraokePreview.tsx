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
  const primaryColor = style?.primary_color || 'rgba(255,255,255,0.7)';
  const secondaryColor = style?.secondary_color || '#ffb547';
  const outlineColor = style?.outline_color || '#181109';
  const isGlow = style?.effect === 'glow';
  const isPop = style?.effect === 'pop';

  return (
    <p className={active ? 'preview-line preview-line-active' : 'preview-line preview-line-next'} style={{ fontFamily }}>
      {line.words.length > 0 ? line.words.map((word, index) => {
        const fill = index < wordIndex ? 100 : index === wordIndex ? progress * 100 : 0;
        const isCurrentWord = index === wordIndex;
        return (
          <span
            key={word.id}
            className="preview-word"
            style={{
              color: primaryColor,
              WebkitTextStroke: `1px ${outlineColor}`,
              textShadow: `0 2px 4px ${outlineColor}`,
              transform: isPop && isCurrentWord ? 'scale(1.08)' : undefined,
              transition: 'transform 0.1s ease',
            }}
          >
            <span>{word.word}</span>
            <span
              className="preview-word-fill"
              aria-hidden="true"
              style={{
                clipPath: `inset(0 ${100 - fill}% 0 0)`,
                color: secondaryColor,
                WebkitTextStroke: `1px ${outlineColor}`,
                textShadow: isGlow
                  ? `0 0 16px ${secondaryColor}, 0 0 24px ${secondaryColor}`
                  : `0 2px 4px ${outlineColor}`,
              }}
            >
              {word.word}
            </span>
          </span>
        );
      }) : line.text}
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
}: KaraokePreviewProps) {
  const state = useMemo(() => playbackStateAt(lyrics, currentTime), [lyrics, currentTime]);
  const { currentLineIndex, currentWordIndex, wordProgress } = state;

  const bgStyle: React.CSSProperties = hasCustomBackground && songId
    ? {
        backgroundImage: `linear-gradient(rgba(10, 10, 14, 0.55), rgba(10, 10, 14, 0.55)), url(${api.getBackgroundUrl(songId)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {};

  if (preset === 'classic') {
    const current = currentLineIndex >= 0 ? lyrics.lines[currentLineIndex] : undefined;
    const next = currentLineIndex >= 0 ? lyrics.lines[currentLineIndex + 1] : lyrics.lines[0];
    return (
      <div className="karaoke-stage" style={bgStyle} aria-label="Xem trước karaoke Classic">
        <div className="stage-grain" />
        <div className="stage-badge">CLASSIC · 2 DÒNG</div>
        <div className="classic-lines">
          {current ? (
            <HighlightedLine line={current} wordIndex={currentWordIndex} progress={wordProgress} active style={style} />
          ) : (
            <p className="preview-line preview-line-active preview-waiting" style={{ fontFamily: style?.font_family }}>
              Nhấn phát để kiểm tra nhịp
            </p>
          )}
          {next ? <HighlightedLine line={next} wordIndex={-1} progress={0} active={false} style={style} /> : <div className="preview-line-spacer" />}
        </div>
        <div className="safe-area" aria-hidden="true" />
      </div>
    );
  }

  const anchor = currentLineIndex >= 0 ? currentLineIndex : 0;
  const visible = lyrics.lines.slice(Math.max(0, anchor - 2), Math.min(lyrics.lines.length, anchor + 3));
  const offset = Math.max(0, anchor - 2);
  return (
    <div className="karaoke-stage modern-stage" style={bgStyle} aria-label="Xem trước karaoke Modern">
      <div className="stage-grain" />
      <div className="stage-badge">MODERN · CUỘN</div>
      <div className="modern-lines">
        {visible.map((line, localIndex) => {
          const absoluteIndex = localIndex + offset;
          const distance = Math.abs(absoluteIndex - anchor);
          const active = absoluteIndex === currentLineIndex;
          return (
            <div
              key={line.id}
              className={`modern-line ${active ? 'modern-line-active' : ''}`}
              style={{
                opacity: active ? 1 : Math.max(0.16, 0.54 - distance * 0.14),
                transform: `scale(${active ? 1 : 0.92 - distance * 0.03})`,
                fontFamily: style?.font_family,
              }}
            >
              {active ? (
                <HighlightedLine line={line} wordIndex={currentWordIndex} progress={wordProgress} active style={style} />
              ) : (
                <p style={{ color: style?.primary_color || 'inherit' }}>{line.text}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="safe-area" aria-hidden="true" />
    </div>
  );
}
