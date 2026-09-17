import type { KaraokePreset, LyricLine, LyricsData, VideoStyle } from '../types';

function hexToAssColor(hexStr?: string, alpha = 0): string {
  if (!hexStr) return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}000000&`;
  let cleaned = hexStr.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('');
  }
  if (cleaned.length !== 6) {
    return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}000000&`;
  }
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  const aHex = alpha.toString(16).padStart(2, '0').toUpperCase();
  const bHex = b.toString(16).padStart(2, '0').toUpperCase();
  const gHex = g.toString(16).padStart(2, '0').toUpperCase();
  const rHex = r.toString(16).padStart(2, '0').toUpperCase();
  return `&H${aHex}${bHex}${gHex}${rHex}&`;
}

export function buildAssHeader(style?: VideoStyle): string {
  const font = style?.font_family || 'Be Vietnam Pro';
  const primary = style?.primary_color ? hexToAssColor(style.primary_color, 0) : '&H00F7F3EB&';
  const secondary = style?.secondary_color ? hexToAssColor(style.secondary_color, 0) : '&H0000B7FF&';
  const outline = style?.outline_color ? hexToAssColor(style.outline_color, 0) : '&H00201810&';

  const isGlow = style?.effect === 'glow';
  const shadowVal = isGlow ? 2 : 1;
  const outlineVal = isGlow ? 3.5 : 3.0;

  return `[Script Info]
Title: Karaoke Studio
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ClassicTop,${font},64,${primary},${secondary},${outline},&H80000000,-1,0,0,0,100,100,0,0,1,${outlineVal},${shadowVal},2,100,100,190,1
Style: ClassicBottom,${font},64,${primary},${secondary},${outline},&H80000000,-1,0,0,0,100,100,0,0,1,${outlineVal},${shadowVal},2,100,100,100,1
Style: ClassicNext,${font},58,&H00BFB8AC,&H00BFB8AC,${outline},&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,100,100,100,1
Style: ModernFocus,${font},66,${primary},${secondary},${outline},&H60000000,-1,0,0,0,100,100,0,0,1,${outlineVal},${shadowVal},5,120,120,0,1
Style: ModernNear,${font},48,&H00CFC8BC,&H00CFC8BC,${outline},&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,140,140,0,1
Style: ModernFar,${font},40,&H00857F76,&H00857F76,${outline},&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,160,160,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

function toCentis(seconds: number): number {
  return Math.max(0, Math.round(seconds * 100));
}

export function formatAssTime(seconds: number): string {
  const totalCs = toCentis(seconds);
  const hours = Math.floor(totalCs / 360000);
  const rest1 = totalCs % 360000;
  const minutes = Math.floor(rest1 / 6000);
  const rest2 = rest1 % 6000;
  const secs = Math.floor(rest2 / 100);
  const centis = rest2 % 100;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

export function karaokePayload(line: LyricLine, eventStart?: number, eventEnd?: number): string {
  if (line.start === null || line.end === null) {
    return escapeAssText(line.text);
  }
  const startCs = toCentis(eventStart !== undefined ? eventStart : line.start);
  const endCs = toCentis(eventEnd !== undefined ? eventEnd : line.end);
  let cursor = startCs;
  const chunks: string[] = [];

  if (!line.words || line.words.length === 0) {
    return `{\\kf${Math.max(0, endCs - startCs)}}${escapeAssText(line.text)}`;
  }

  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    if (word.start === null || word.end === null) {
      chunks.push(`{\\kf0}${escapeAssText(word.word)}`);
    } else {
      // Smart melisma: bridge held note gaps up to 1.0s between words, or up to 2.2s at line end
      let effectiveEnd = word.end;
      const nextWord = line.words[i + 1];
      if (nextWord && nextWord.start !== null && nextWord.start > word.end) {
        const gap = nextWord.start - word.end;
        if (gap <= 1.0) effectiveEnd = nextWord.start - 0.03;
      } else if (!nextWord && line.end !== null && line.end > word.end) {
        const gap = line.end - word.end;
        if (gap <= 2.2) effectiveEnd = line.end - 0.04;
      }

      const wordStart = Math.min(endCs, Math.max(startCs, toCentis(word.start)));
      const wordEnd = Math.min(endCs, Math.max(wordStart, toCentis(effectiveEnd)));
      if (wordStart > cursor) {
        chunks.push(`{\\k${wordStart - cursor}}`);
        cursor = wordStart;
      }
      const duration = Math.max(0, wordEnd - cursor);
      chunks.push(`{\\kf${duration}}${escapeAssText(word.word)}`);
      cursor = Math.max(cursor, wordEnd);
    }
    if (i < line.words.length - 1) {
      chunks.push(' ');
    }
  }
  if (cursor < endCs) {
    chunks.push(`{\\k${endCs - cursor}}`);
  }
  return chunks.join('');
}

export function generateAssText(lyrics: LyricsData, preset: KaraokePreset = 'classic', style?: VideoStyle): string {
  const lines = lyrics.lines.filter((line) => line.start !== null && line.end !== null && line.end > line.start);
  const events: string[] = [];
  const header = buildAssHeader(style);
  const fadTag = '{\\fad(180,150)}';

  if (preset === 'classic') {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const styleName = index % 2 === 0 ? 'ClassicTop' : 'ClassicBottom';
      const start = line.start!;
      const end = line.end!;
      const payload = karaokePayload(line);
      events.push(`Dialogue: 1,${formatAssTime(start)},${formatAssTime(end)},${styleName},,0,0,0,,${fadTag}${payload}`);

      if (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const previewEnd = Math.min(end, nextLine.start!);
        if (previewEnd > start) {
          const nextStyle = index % 2 === 0 ? 'ClassicBottom' : 'ClassicTop';
          events.push(
            `Dialogue: 0,${formatAssTime(start)},${formatAssTime(previewEnd)},${nextStyle},,0,0,0,,${fadTag}{\\1c&H00BFB8AC&}${escapeAssText(nextLine.text)}`,
          );
        }
      }
    }
  } else {
    const yPositions = [270, 405, 540, 675, 810];
    for (let focus = 0; focus < lines.length; focus++) {
      const line = lines[focus];
      const intervalStart = line.start!;
      let intervalEnd = focus + 1 < lines.length ? lines[focus + 1].start! : line.end!;
      intervalEnd = Math.max(intervalStart + 0.01, intervalEnd);
      const first = Math.max(0, focus - 2);
      const last = Math.min(lines.length, focus + 3);

      for (let lineIndex = first; lineIndex < last; lineIndex++) {
        const relative = lineIndex - focus;
        const visible = lines[lineIndex];
        const styleName = relative === 0 ? 'ModernFocus' : (Math.abs(relative) === 1 ? 'ModernNear' : 'ModernFar');
        const y = yPositions[relative + 2];
        const motion = `{\\move(960,${y + 18},960,${y},0,280)}`;
        const text = relative === 0
          ? karaokePayload(visible, intervalStart, intervalEnd)
          : escapeAssText(visible.text);
        events.push(
          `Dialogue: ${relative === 0 ? 2 : 0},${formatAssTime(intervalStart)},${formatAssTime(intervalEnd)},${styleName},,0,0,0,,${motion}${fadTag}${text}`,
        );
      }
    }
  }

  return header + events.join('\n') + (events.length ? '\n' : '');
}
