import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl } from '../api/client';
import type { LyricsData, LyricLine, LyricWord, TrackKind } from '../types';
import { formatClock } from '../utils/lyrics';

interface TapSyncModalProps {
  songId: string;
  lyrics: LyricsData;
  initialLineId?: string;
  onApply: (updatedLyrics: LyricsData) => void;
  onClose: () => void;
}

interface FlatWord {
  lineIndex: number;
  wordIndex: number;
  id: string;
  text: string;
  start: number | null;
  end: number | null;
}

export const TapSyncModal: React.FC<TapSyncModalProps> = ({
  songId,
  lyrics,
  initialLineId,
  onApply,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAudioRef = useRef<{ time: number; playing: boolean } | null>(null);
  const [track, setTrack] = useState<TrackKind>('vocals');
  const [speed, setSpeed] = useState<number>(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Flatten words with their line coordinates
  const flatWords = useMemo<FlatWord[]>(() => {
    const list: FlatWord[] = [];
    lyrics.lines.forEach((line, lineIdx) => {
      if (line.locked) return;
      line.words.forEach((w, wordIdx) => {
        list.push({
          lineIndex: lineIdx,
          wordIndex: wordIdx,
          id: w.id,
          text: w.word,
          start: w.start,
          end: w.end,
        });
      });
    });
    return list;
  }, [lyrics]);

  // Find initial word index based on initialLineId
  const initialWordIdx = useMemo(() => {
    if (!initialLineId) return 0;
    const targetIdx = flatWords.findIndex(
      (w) => lyrics.lines[w.lineIndex]?.id === initialLineId
    );
    return targetIdx >= 0 ? targetIdx : 0;
  }, [flatWords, initialLineId, lyrics.lines]);

  const [tappedTimings, setTappedTimings] = useState<Map<number, { start: number; end: number }>>(new Map());
  const [activeWordIndex, setActiveWordIndex] = useState<number>(initialWordIdx);

  // Set audio initial time to the start of initial line or 0
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const firstWord = flatWords[initialWordIdx];
    if (firstWord && firstWord.start !== null && firstWord.start > 0) {
      audio.currentTime = Math.max(0, firstWord.start - 1.0);
    }
  }, [flatWords, initialWordIdx]);

  // Sync speed to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Update current time on audio timeupdate
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
      audioRef.current.playbackRate = speed;
      const pending = pendingAudioRef.current;
      if (pending) {
        audioRef.current.currentTime = Math.min(pending.time, audioRef.current.duration || pending.time);
        if (pending.playing) void audioRef.current.play();
        pendingAudioRef.current = null;
      }
    }
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  // Tap current word action
  const handleTap = useCallback(() => {
    const audio = audioRef.current;
    const now = audio ? audio.currentTime : currentTime;

    if (!audio || audio.paused || activeWordIndex >= flatWords.length) return;

    setTappedTimings((prev) => {
      const nextMap = new Map(prev);
      const prevWord = flatWords[activeWordIndex - 1];

      // Close previous word timing if it was still open or too long
      if (activeWordIndex > 0 && prevWord && nextMap.has(activeWordIndex - 1)) {
        const prevTiming = nextMap.get(activeWordIndex - 1)!;
        if (prevTiming.end > now || prevTiming.end <= prevTiming.start) {
          nextMap.set(activeWordIndex - 1, { ...prevTiming, end: Math.max(prevTiming.start + 0.05, now) });
        }
      }

      // Set start of current word, default estimated end
      nextMap.set(activeWordIndex, {
        start: Number(now.toFixed(3)),
        end: Number((now + 0.35).toFixed(3)),
      });

      return nextMap;
    });

    // Advance to next word
    setActiveWordIndex((prev) => Math.min(flatWords.length, prev + 1));
  }, [activeWordIndex, currentTime, flatWords]);

  // Backtrack 1 word action
  const handleBacktrack = useCallback(() => {
    if (activeWordIndex <= 0) return;
    const newIdx = activeWordIndex - 1;
    setActiveWordIndex(newIdx);

    // If possible, seek audio back slightly to re-tap
    const audio = audioRef.current;
    if (audio) {
      const targetTime = tappedTimings.get(newIdx)?.start ?? flatWords[newIdx]?.start;
      if (targetTime !== undefined && targetTime !== null) {
        audio.currentTime = Math.max(0, targetTime - 0.5);
      }
    }
  }, [activeWordIndex, flatWords, tappedTimings]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTap();
      } else if (e.code === 'Backspace' || e.code === 'ArrowLeft') {
        e.preventDefault();
        handleBacktrack();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Apply tapped timings back into LyricsData
  function handleSave() {
    if (tappedTimings.size === 0) {
      onClose();
      return;
    }

    const newLines: LyricLine[] = lyrics.lines.map((line, lIdx) => {
      if (line.locked) return line;
      const updatedWords: LyricWord[] = line.words.map((word, wIdx) => {
        // Find global word index in flatWords
        const globalIdx = flatWords.findIndex(
          (fw) => fw.lineIndex === lIdx && fw.wordIndex === wIdx
        );
        if (globalIdx >= 0 && tappedTimings.has(globalIdx)) {
          const timing = tappedTimings.get(globalIdx)!;
          return {
            ...word,
            start: timing.start,
            end: timing.end,
            review_required: false,
            review_reasons: [],
          };
        }
        return word;
      });

      const validStarts = updatedWords.map((w) => w.start).filter((t): t is number => t !== undefined && t !== null);
      const validEnds = updatedWords.map((w) => w.end).filter((t): t is number => t !== undefined && t !== null);

      const lineStart = validStarts.length ? Math.min(...validStarts) : line.start;
      const lineEnd = validEnds.length ? Math.max(...validEnds) : line.end;

      return {
        ...line,
        start: lineStart,
        end: lineEnd,
        words: updatedWords,
        review_required: updatedWords.some((w) => w.review_required),
      };
    });

    onApply({
      ...lyrics,
      lines: newLines,
    });
    onClose();
  }

  const switchTrack = (next: TrackKind) => {
    if (next === track) return;
    const audio = audioRef.current;
    if (audio && !pendingAudioRef.current) pendingAudioRef.current = { time: audio.currentTime, playing: !audio.paused };
    setTrack(next);
  };

  // Group active words for display
  const currentFlatWord = flatWords[activeWordIndex];
  const currentLineIdx = currentFlatWord ? currentFlatWord.lineIndex : -1;
  const currentLine = currentLineIdx >= 0 ? lyrics.lines[currentLineIdx] : null;
  const prevLine = currentLineIdx > 0 ? lyrics.lines[currentLineIdx - 1] : null;
  const nextLine = currentLineIdx >= 0 && currentLineIdx < lyrics.lines.length - 1 ? lyrics.lines[currentLineIdx + 1] : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Công cụ gõ nhịp" className="tap-sync-dialog fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <audio
        ref={audioRef}
        src={audioUrl(songId, track)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <div className="w-full max-w-4xl bg-stone-900 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 bg-stone-950/60">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg">⌨</span>
            <div>
              <h2 className="text-base font-semibold text-stone-100 flex items-center gap-2">
                Công cụ Gõ nhịp phím Space (Tap-to-Sync)
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-mono">
                  {tappedTimings.size} / {flatWords.length} từ đã gõ
                </span>
              </h2>
              <p className="text-xs text-stone-400">Bấm Play, nghe nhạc đến đâu thì nhấn phím Space theo nhịp từng từ.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Track Selector */}
            <div className="flex bg-stone-800 rounded-lg p-0.5 text-xs">
              <button
                type="button"
                className={`px-3 py-1 rounded-md font-medium transition-colors ${track === 'vocals' ? 'bg-amber-500 text-stone-950 shadow-sm' : 'text-stone-400 hover:text-stone-200'}`}
                onClick={() => switchTrack('vocals')}
              >
                Giọng hát
              </button>
              <button
                type="button"
                className={`px-3 py-1 rounded-md font-medium transition-colors ${track === 'original' ? 'bg-amber-500 text-stone-950 shadow-sm' : 'text-stone-400 hover:text-stone-200'}`}
                onClick={() => switchTrack('original')}
              >
                Bản gốc
              </button>
            </div>

            {/* Speed Selector */}
            <div className="flex bg-stone-800 rounded-lg p-0.5 text-xs">
              {[0.75, 0.85, 1.0].map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`px-2.5 py-1 rounded-md font-mono transition-colors ${speed === s ? 'bg-amber-500 text-stone-950 font-bold shadow-sm' : 'text-stone-400 hover:text-stone-200'}`}
                  onClick={() => setSpeed(s)}
                  title={`Tốc độ phát ${s}x`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-stone-400 hover:text-stone-100 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-stone-800 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Center Lyrics Focus Stage */}
        <div className="flex-1 overflow-y-auto px-8 py-8 flex flex-col items-center justify-center min-h-[260px] bg-gradient-to-b from-stone-900 to-stone-950 select-none">
          {/* Previous Line */}
          {prevLine && (
            <div className="text-stone-600 text-sm md:text-base font-medium mb-4 text-center line-clamp-1 transition-opacity opacity-50">
              {prevLine.text}
            </div>
          )}

          {/* Current Active Line */}
          {currentLine ? (
            <div className="flex flex-wrap gap-2.5 justify-center items-center max-w-2xl py-4 my-2">
              {currentLine.words.map((w, wIdx) => {
                const globalIdx = flatWords.findIndex(
                  (fw) => fw.lineIndex === currentLineIdx && fw.wordIndex === wIdx
                );
                const isTarget = globalIdx === activeWordIndex;
                const isTapped = tappedTimings.has(globalIdx);
                const timing = isTapped ? tappedTimings.get(globalIdx) : undefined;

                return (
                  <span
                    key={w.id}
                    onClick={() => {
                      setActiveWordIndex(globalIdx);
                      if (audioRef.current && (timing?.start || w.start)) {
                        audioRef.current.currentTime = Math.max(0, (timing?.start || w.start!) - 0.2);
                      }
                    }}
                    className={`cursor-pointer px-3.5 py-2 rounded-xl text-lg md:text-2xl font-semibold transition-all duration-150 transform ${
                      isTarget
                        ? 'bg-amber-500 text-stone-950 scale-110 shadow-lg shadow-amber-500/30 ring-4 ring-amber-400/40 animate-pulse'
                        : isTapped
                        ? 'bg-stone-800 text-emerald-400 border border-emerald-500/30'
                        : 'bg-stone-800/60 text-stone-300 hover:bg-stone-700/60'
                    }`}
                  >
                    {w.word}
                    {timing && (
                      <span className="block text-[10px] font-mono font-normal opacity-80 mt-0.5 text-center">
                        {timing.start.toFixed(2)}s
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-amber-400 font-medium text-lg">
              🎉 Đã gõ xong toàn bộ lời bài hát! Bấm &quot;Áp dụng&quot; bên dưới để lưu.
            </div>
          )}

          {/* Next Line */}
          {nextLine && (
            <div className="text-stone-500 text-sm md:text-base font-medium mt-4 text-center line-clamp-1 opacity-60">
              {nextLine.text}
            </div>
          )}
        </div>

        {/* Big Tap Controller Button */}
        <div className="px-6 py-5 bg-stone-950 border-t border-stone-800/80 flex flex-col items-center gap-4">
          <div className="flex items-center gap-6 w-full justify-center">
            {/* Play/Pause Button */}
            <button
              type="button"
              onClick={togglePlay}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 font-medium transition-colors"
            >
              {isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
              <span className="font-mono text-xs text-stone-400 ml-1">
                {formatClock(currentTime)} / {formatClock(duration)}
              </span>
            </button>

            {/* Giant TAP Button */}
            <button
              type="button"
              onClick={handleTap}
              disabled={!isPlaying || activeWordIndex >= flatWords.length}
              className="flex-1 max-w-md py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] text-stone-950 font-black text-xl md:text-2xl shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-3 tracking-wide"
            >
              <span>NHẤN SPACE ĐỂ GÕ NHỊP</span>
              {currentFlatWord && (
                <span className="text-base px-3 py-1 bg-stone-950/25 rounded-lg text-stone-900 font-bold">
                  &quot;{currentFlatWord.text}&quot;
                </span>
              )}
            </button>

            {/* Backtrack Button */}
            <button
              type="button"
              onClick={handleBacktrack}
              disabled={activeWordIndex <= 0}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Lùi 1 từ (Backspace hoặc ←)"
            >
              ↶ Lùi từ
            </button>
          </div>

          {/* Quick Shortcuts & Action Buttons */}
          <div className="flex items-center justify-between w-full pt-2 border-t border-stone-800/60 text-xs text-stone-400">
            <div className="flex items-center gap-3">
              <span>Phím tắt:</span>
              <kbd className="px-2 py-0.5 rounded bg-stone-800 border border-stone-700 font-mono text-stone-300">Space</kbd> Gõ nhịp
              <kbd className="px-2 py-0.5 rounded bg-stone-800 border border-stone-700 font-mono text-stone-300">Backspace</kbd> Lùi lại
              <kbd className="px-2 py-0.5 rounded bg-stone-800 border border-stone-700 font-mono text-stone-300">P</kbd> Play/Pause
              <kbd className="px-2 py-0.5 rounded bg-stone-800 border border-stone-700 font-mono text-stone-300">Enter</kbd> Áp dụng
              <kbd className="px-2 py-0.5 rounded bg-stone-800 border border-stone-700 font-mono text-stone-300">Esc</kbd> Hủy
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-stone-400 hover:text-stone-200 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={tappedTimings.size === 0}
                className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold transition-all disabled:opacity-40 shadow-md"
              >
                ✓ Áp dụng ({tappedTimings.size} từ)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
