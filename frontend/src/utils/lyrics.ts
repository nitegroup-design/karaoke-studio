import type { KaraokePlaybackState, LyricsData, LyricLine, LyricWord, ReviewReason } from '../types';

const TOKEN_PATTERN = /\s+/;

export const tokenizeLyric = (text: string) => text.trim().split(TOKEN_PATTERN).filter(Boolean);

const lcsMatches = (previous: string[], next: string[]) => {
  const table = Array.from({ length: previous.length + 1 }, () => Array<number>(next.length + 1).fill(0));
  for (let oldIndex = previous.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = next.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = previous[oldIndex] === next[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }
  const matches = new Map<number, number>();
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < previous.length && newIndex < next.length) {
    if (previous[oldIndex] === next[newIndex]) {
      matches.set(newIndex, oldIndex);
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return matches;
};

export const syncLineText = (line: LyricLine, text: string): LyricLine => {
  const tokens = tokenizeLyric(text);
  const matches = lcsMatches(line.words.map((word) => word.word), tokens);
  const words = tokens.map((token, index): LyricWord => {
    const existingIndex = matches.get(index);
    const existing = existingIndex === undefined ? undefined : line.words[existingIndex];
    if (existing) return { ...existing, word: token };
    return {
      id: `${line.id}-word-${crypto.randomUUID()}`,
      word: token,
      start: null,
      end: null,
      review_required: true,
      review_reasons: ['missing_timing', 'unaligned_text'],
    };
  });
  const removedOrAdded = words.length !== line.words.length || words.some((word) => word.review_reasons.includes('unaligned_text'));
  const reasons: ReviewReason[] = removedOrAdded
    ? Array.from(new Set<ReviewReason>([...line.review_reasons, 'unaligned_text']))
    : line.review_reasons;
  return {
    ...line,
    text,
    words,
    review_required: line.review_required || removedOrAdded || words.some((word) => word.review_required),
    review_reasons: reasons,
  };
};

export const getReviewReasons = (line: LyricLine): string[] => {
  const labels: Record<ReviewReason, string> = {
    missing_timing: 'Có tiếng chưa có mốc thời gian',
    zero_duration: 'Có tiếng có thời lượng bằng 0',
    overlap: 'Có mốc chồng lên nhau',
    long_duration: 'Có tiếng kéo dài bất thường',
    unaligned_text: 'Nội dung đã đổi và cần căn lại',
  };
  const reasons = new Set(line.review_reasons.map((reason) => labels[reason]));
  if (line.start === null || line.end === null) reasons.add('Câu chưa có đủ mốc thời gian');
  else if (line.end <= line.start) reasons.add('Mốc kết thúc không hợp lệ');
  let previousEnd = line.start ?? 0;
  line.words.forEach((word) => {
    word.review_reasons.forEach((reason) => reasons.add(labels[reason]));
    if (word.start === null || word.end === null) { reasons.add(`“${word.word}” chưa có mốc thời gian`); return; }
    if (word.end <= word.start) reasons.add(`“${word.word}” chưa có thời lượng`);
    if (word.start < previousEnd - 0.005) reasons.add(`“${word.word}” chồng mốc trước`);
    if (word.end - word.start > 4) reasons.add(`“${word.word}” dài bất thường`);
    previousEnd = Math.max(previousEnd, word.end);
  });
  return [...reasons];
};

export const updateCanonicalLine = (canonicalText: string | undefined, lines: LyricLine[], lineId: string, text: string) => {
  if (!canonicalText) return lines.map((line) => line.id === lineId ? text : line.text).join('\n');
  const targetIndex = lines.findIndex((line) => line.id === lineId);
  if (targetIndex < 0) return canonicalText;
  const sourceLines = canonicalText.split(/\r?\n/);
  const sectionHeader = /^\s*(?:\[.*\]|\((?:verse|chorus|bridge|intro|outro|điệp khúc|đk).*\))\s*$/i;
  const contentIndexes = sourceLines.flatMap((line, index) => line.trim() && !sectionHeader.test(line) ? [index] : []);
  if (contentIndexes.length === lines.length && contentIndexes[targetIndex] !== undefined) {
    sourceLines[contentIndexes[targetIndex]] = text;
    return sourceLines.join('\n');
  }
  return lines.map((line) => line.id === lineId ? text : line.text).join('\n');
};

export const playbackStateAt = (lyrics: LyricsData, currentTime: number): KaraokePlaybackState => {
  let currentLineIndex = -1;
  let currentWordIndex = -1;
  let wordProgress = 0;

  for (let lineIndex = 0; lineIndex < lyrics.lines.length; lineIndex += 1) {
    const line = lyrics.lines[lineIndex];
    if (line.start === null || line.end === null) continue;

    // Provide a brief inter-line grace window if next line is close so transition is seamless
    const nextLine = lyrics.lines[lineIndex + 1];
    const lineGrace = (nextLine && nextLine.start !== null && nextLine.start > line.end && (nextLine.start - line.end <= 1.2))
      ? nextLine.start - 0.08
      : line.end;

    if (currentTime < line.start || currentTime >= lineGrace) continue;

    currentLineIndex = lineIndex;

    for (let wordIndex = 0; wordIndex < line.words.length; wordIndex += 1) {
      const word = line.words[wordIndex];
      if (word.start === null || word.end === null) continue;

      // Smart Melisma: Bridge gaps between words for sustained / held notes (ngân dài)
      const nextWord = line.words[wordIndex + 1];
      let effectiveWordEnd = word.end;
      if (nextWord && nextWord.start !== null && nextWord.start > word.end) {
        const gap = nextWord.start - word.end;
        if (gap <= 1.0) {
          effectiveWordEnd = nextWord.start - 0.03;
        }
      } else if (!nextWord && line.end !== null && line.end > word.end) {
        const gap = line.end - word.end;
        if (gap <= 2.2) {
          effectiveWordEnd = line.end - 0.04;
        }
      }

      if (currentTime >= word.start && currentTime <= effectiveWordEnd) {
        currentWordIndex = wordIndex;
        wordProgress = effectiveWordEnd > word.start ? (currentTime - word.start) / (effectiveWordEnd - word.start) : 1;
        break;
      }
      if (currentTime > effectiveWordEnd) {
        currentWordIndex = wordIndex;
        wordProgress = 1;
      }
    }
    break;
  }
  return { currentLineIndex, currentWordIndex, wordProgress: Math.max(0, Math.min(1, wordProgress)) };
};

export const formatClock = (time: number | null, milliseconds = false) => {
  if (time === null) return '—';
  const safe = Number.isFinite(time) ? Math.max(0, time) : 0;
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  if (!milliseconds) return `${minutes}:${seconds}`;
  const ms = Math.floor((safe % 1) * 1000).toString().padStart(3, '0');
  return `${minutes}:${seconds}.${ms}`;
};

export const parseClock = (value: string) => {
  const parts = value.trim().split(':');
  const seconds = parts.length === 1
    ? Number(parts[0])
    : Number(parts.at(-2)) * 60 + Number(parts.at(-1));
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
};
