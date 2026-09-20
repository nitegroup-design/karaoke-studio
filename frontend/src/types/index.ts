export type TrackKind = 'original' | 'vocals' | 'instrumental';
export type KaraokePreset = 'classic' | 'modern';
export type ModelPreset = 'quality' | 'draft';
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';
export type ReviewReason =
  | 'missing_timing'
  | 'zero_duration'
  | 'overlap'
  | 'long_duration'
  | 'unaligned_text'
  | 'low_confidence'
  | 'variation_detected'
  | 'extra_vocal'
  | 'omitted_vocal';

export type SectionType =
  | 'INTRO'
  | 'HOOK'
  | 'OPENING_HOOK'
  | 'VERSE'
  | 'PRE_CHORUS'
  | 'CHORUS'
  | 'POST_CHORUS'
  | 'BRIDGE'
  | 'BREAK'
  | 'INSTRUMENTAL'
  | 'OUTRO'
  | 'SOLO'
  | 'UNKNOWN';

export type OccurrenceMatch = 'EXACT' | 'VARIATION' | 'PARTIAL' | 'OMITTED';

export type VocalActivityType =
  | 'SINGING'
  | 'SPEECH'
  | 'RAP'
  | 'ADLIB'
  | 'BACKGROUND_VOCAL'
  | 'INSTRUMENTAL'
  | 'SILENCE'
  | 'UNKNOWN';

export interface ConfidenceBreakdown {
  text: number;
  audio: number;
  timing: number;
  structure: number;
  speaker?: number;
  overall: number;
}

export interface LyricSyllable {
  id: string;
  text: string;
  start: number | null;
  end: number | null;
  phonemes?: string[];
  confidence?: number;
}

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
  confidence?: number;
  syllables?: LyricSyllable[];
  review_required: boolean;
  review_reasons: ReviewReason[];
}

export interface LyricLine {
  id: string;
  start: number | null;
  end: number | null;
  text: string;
  words: LyricWord[];
  speaker?: string;
  vocal_type?: VocalActivityType;
  confidence?: ConfidenceBreakdown;
  locked: boolean;
  review_required: boolean;
  review_reasons: ReviewReason[];
}

export interface SectionOccurrence {
  id: string;
  section_id: string;
  index: number;
  start: number | null;
  end: number | null;
  match_type: OccurrenceMatch;
  variation_notes?: string;
  lines: LyricLine[];
  confidence?: number;
}

export interface LyricSection {
  id: string;
  type: SectionType;
  label: string;
  canonical_lines: string[];
  occurrences: SectionOccurrence[];
}

export interface SongStructure {
  sections: LyricSection[];
  bpm?: number;
  key?: string;
  duration?: number;
}

export interface ReviewHistoryEntry {
  id: string;
  timestamp: string;
  user_id?: string;
  action: string;
  target_id: string;
  old_value?: unknown;
  new_value?: unknown;
}

export interface LyricsData {
  song_id: string;
  title: string;
  version: number;
  updated_at?: string;
  canonical_text?: string;
  lines: LyricLine[];
  structure?: SongStructure;
  speakers?: string[];
  adlibs?: LyricLine[];
  background_vocals?: LyricLine[];
  review_history?: ReviewHistoryEntry[];
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
  artifacts: Partial<Record<'mp4' | 'ass' | 'srt' | 'lrc' | 'wav', string>>;
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
