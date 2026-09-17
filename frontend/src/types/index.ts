export type TrackKind = 'original' | 'vocals' | 'instrumental';
export type KaraokePreset = 'classic' | 'modern';
export type ModelPreset = 'quality' | 'draft';
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';
export type ReviewReason = 'missing_timing' | 'zero_duration' | 'overlap' | 'long_duration' | 'unaligned_text';

export interface VideoStyle {
  font_family: string;
  primary_color: string;
  secondary_color: string;
  outline_color: string;
  effect: 'smooth' | 'glow' | 'pop';
}

export interface LyricWord {
  id: string;
  word: string;
  start: number | null;
  end: number | null;
  review_required: boolean;
  review_reasons: ReviewReason[];
}

export interface LyricLine {
  id: string;
  start: number | null;
  end: number | null;
  text: string;
  words: LyricWord[];
  locked: boolean;
  review_required: boolean;
  review_reasons: ReviewReason[];
}

export interface LyricsData {
  song_id: string;
  title: string;
  version: number;
  updated_at?: string;
  canonical_text?: string;
  lines: LyricLine[];
}

export interface StageStatus {
  state: string;
  progress?: number;
  error?: string;
}

export interface ProcessingStatus {
  separation: StageStatus;
  transcription: StageStatus;
  alignment?: StageStatus;
  render?: StageStatus;
}

export interface Song {
  song_id: string;
  filename: string;
  title?: string;
  created_at?: string;
  duration?: number;
  status: ProcessingStatus;
}

export interface ExportJob {
  export_id?: string;
  state: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  message?: string;
  error?: string;
  artifacts: Partial<Record<'mp4' | 'ass' | 'srt' | 'wav', string>>;
}

export interface WaveformData {
  duration: number;
  peaks: number[] | number[][];
}

export interface KaraokePlaybackState {
  currentLineIndex: number;
  currentWordIndex: number;
  wordProgress: number;
}
