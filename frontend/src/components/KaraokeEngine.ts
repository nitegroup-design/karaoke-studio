import type { LyricsData } from '../types';

export interface KaraokeState {
  currentLineIndex: number;
  currentWordIndex: number;
  wordProgress: number; // 0 to 1
}

export class KaraokeEngine {
  private lyrics: LyricsData | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private onStateChange: (state: KaraokeState) => void = () => {};
  private animationFrameId: number | null = null;

  private state: KaraokeState = {
    currentLineIndex: -1,
    currentWordIndex: -1,
    wordProgress: 0,
  };

  constructor() {
    this.loop = this.loop.bind(this);
  }

  public init(lyrics: LyricsData, audioElement: HTMLAudioElement, onStateChange: (state: KaraokeState) => void) {
    this.lyrics = lyrics;
    this.audioElement = audioElement;
    this.onStateChange = onStateChange;
    this.start();
  }

  public start() {
    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.loop);
    }
  }

  public stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop() {
    if (!this.lyrics || !this.audioElement) return;

    const currentTime = this.audioElement.currentTime;
    let lineIndex = -1;
    let wordIndex = -1;
    let progress = 0;

    for (let i = 0; i < this.lyrics.lines.length; i++) {
      const line = this.lyrics.lines[i];
      if (line.start !== null && line.end !== null && currentTime >= line.start && currentTime <= line.end) {
        lineIndex = i;
        for (let j = 0; j < line.words.length; j++) {
          const word = line.words[j];
          if (word.start === null || word.end === null) continue;
          if (currentTime >= word.start && currentTime <= word.end) {
            wordIndex = j;
            const duration = word.end - word.start;
            if (duration > 0) {
              progress = (currentTime - word.start) / duration;
            } else {
              progress = 1;
            }
            break;
          } else if (currentTime > word.end) {
            // between words
            wordIndex = j;
            progress = 1;
          }
        }
        break;
      }
    }

    if (
      lineIndex !== this.state.currentLineIndex ||
      wordIndex !== this.state.currentWordIndex ||
      Math.abs(progress - this.state.wordProgress) > 0.01 // Avoid too many updates
    ) {
      this.state = {
        currentLineIndex: lineIndex,
        currentWordIndex: wordIndex,
        wordProgress: Math.max(0, Math.min(1, progress)),
      };
      this.onStateChange(this.state);
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }
}
