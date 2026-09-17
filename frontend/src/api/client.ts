import type {
  ExportJob,
  KaraokePreset,
  LyricsData,
  LyricLine,
  LyricWord,
  ModelPreset,
  ProcessingStatus,
  ReviewReason,
  Song,
  StageStatus,
  TrackKind,
  VideoStyle,
  WaveformData,
} from '../types';
import {
  getSupabaseCredentials,
  isSupabaseConfigured,
  setSupabaseCredentials,
  supabaseApi,
} from './supabaseClient.ts';

export type BackendMode = 'local' | 'supabase';

export function getBackendMode(): BackendMode {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('karaoke_backend_mode') as BackendMode;
    if (saved === 'supabase' || saved === 'local') return saved;
    // Auto-detect GitHub Pages or domain host
    if (window.location.hostname.includes('github.io') && isSupabaseConfigured()) {
      return 'supabase';
    }
  }
  if (import.meta.env?.VITE_BACKEND_MODE === 'supabase' && isSupabaseConfigured()) {
    return 'supabase';
  }
  return 'local';
}

export function setBackendMode(mode: BackendMode) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('karaoke_backend_mode', mode);
  }
}

export { isSupabaseConfigured, getSupabaseCredentials, setSupabaseCredentials };

export const API_BASE_URL = (
  import.meta.env?.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && window.location.port === '5173'
    ? ''
    : typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : 'http://127.0.0.1:8000')
).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const makeId = (songId: string, kind: 'line' | 'word', lineIndex: number, wordIndex?: number) =>
  `${songId}-${kind}-${lineIndex}${wordIndex === undefined ? '' : `-${wordIndex}`}`;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asTime = (value: unknown): number | null => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;

const REVIEW_REASONS = new Set<ReviewReason>(['missing_timing', 'zero_duration', 'overlap', 'long_duration', 'unaligned_text']);
const asReasons = (value: unknown): ReviewReason[] =>
  Array.isArray(value) ? value.filter((item): item is ReviewReason => typeof item === 'string' && REVIEW_REASONS.has(item as ReviewReason)) : [];

const normalizeWord = (raw: Partial<LyricWord> & Record<string, unknown>, songId: string, lineIndex: number, wordIndex: number): LyricWord => {
  const start = asTime(raw.start);
  const end = asTime(raw.end);
  const reasons = asReasons(raw.review_reasons);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(songId, 'word', lineIndex, wordIndex),
    word: typeof raw.word === 'string' ? raw.word : '',
    start,
    end,
    review_required: Boolean(raw.review_required) || reasons.length > 0 || start === null || end === null || end <= start,
    review_reasons: reasons,
  };
};

const normalizeLine = (raw: Partial<LyricLine> & Record<string, unknown>, songId: string, lineIndex: number): LyricLine => {
  const start = asTime(raw.start);
  const end = asTime(raw.end);
  const rawWords = Array.isArray(raw.words) ? raw.words : [];
  const words = rawWords.map((word, wordIndex) =>
    normalizeWord((word || {}) as Partial<LyricWord> & Record<string, unknown>, songId, lineIndex, wordIndex),
  );
  const reasons = asReasons(raw.review_reasons);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(songId, 'line', lineIndex),
    start,
    end,
    text: typeof raw.text === 'string' ? raw.text : words.map((word) => word.word).join(' '),
    words,
    locked: Boolean(raw.locked),
    review_required: Boolean(raw.review_required) || reasons.length > 0 || start === null || end === null || end <= start || words.some((word) => word.review_required),
    review_reasons: reasons,
  };
};

export function normalizeLyrics(raw: unknown, fallbackSongId = ''): LyricsData {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const songId = typeof data.song_id === 'string' ? data.song_id : fallbackSongId;
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  return {
    song_id: songId,
    title: typeof data.title === 'string' ? data.title : 'Bài hát chưa đặt tên',
    version: Math.max(1, Math.floor(asNumber(data.version, 1))),
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : undefined,
    canonical_text: typeof data.canonical_text === 'string' ? data.canonical_text : rawLines.map((line) => {
      const record = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    }).join('\n'),
    lines: rawLines.map((line, index) => normalizeLine((line || {}) as Partial<LyricLine> & Record<string, unknown>, songId, index)),
  };
}

const normalizeStage = (value: unknown): StageStatus => {
  if (typeof value === 'string') return { state: value };
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    state: typeof raw.state === 'string' ? raw.state : typeof raw.status === 'string' ? raw.status : 'pending',
    progress: raw.progress === undefined ? undefined : asNumber(raw.progress),
    error: typeof raw.error === 'string' ? raw.error : undefined,
  };
};

export function normalizeStatus(raw: unknown): ProcessingStatus {
  const envelope = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const value = (envelope.status && typeof envelope.status === 'object' ? envelope.status : envelope) as Record<string, unknown>;
  return {
    separation: normalizeStage(value.separation),
    transcription: normalizeStage(value.transcription),
    alignment: value.alignment === undefined ? undefined : normalizeStage(value.alignment),
    render: value.render === undefined ? undefined : normalizeStage(value.render),
  };
}

const request = async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const detail = record.detail || record.message || payload;
      const message = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
          : detail && typeof detail === 'object' && 'message' in detail ? String(detail.message)
            : `HTTP ${response.status}`;
      throw new ApiError(message, response.status, payload);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
      throw new ApiError('Không thể kết nối đến máy chủ Backend (Colab / Ngrok / Port 8000). Vui lòng kiểm tra lại xem Google Colab còn đang chạy không, hoặc ngrok đã hết hạn.', 0, error);
    }
    throw error;
  }
};

const postJson = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const audioUrl = (songId: string, track: TrackKind) => {
  if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
    return supabaseApi.audioUrl(songId, track);
  }
  return `${API_BASE_URL}/api/songs/${encodeURIComponent(songId)}/audio/${track}`;
};

export const artifactUrl = (songId: string, artifact: 'mp4' | 'ass' | 'srt' | 'wav', exportId?: string) => {
  if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
    const { url } = getSupabaseCredentials();
    const ext = artifact === 'mp4' ? 'mp4' : artifact;
    const prefix = artifact === 'mp4' ? 'karaoke' : 'lyrics';
    if (artifact === 'wav') return `${url}/storage/v1/object/public/stems/${encodeURIComponent(songId)}/vocals.wav?download=`;
    return `${url}/storage/v1/object/public/video-exports/${encodeURIComponent(songId)}/${prefix}.${ext}?download=`;
  }
  const query = new URLSearchParams({ artifact });
  if (exportId) query.set('export_id', exportId);
  return `${API_BASE_URL}/api/export/${encodeURIComponent(songId)}/download?${query}`;
};

export const normalizeExport = (raw: Record<string, unknown>, fallbackState: ExportJob['state'] = 'idle'): ExportJob => {
  const stateValue = String(raw.state || raw.status || fallbackState).toLowerCase();
  const state: ExportJob['state'] = ['queued', 'processing', 'done', 'error'].includes(stateValue)
    ? stateValue as ExportJob['state']
    : fallbackState;
  const exportId = typeof raw.export_id === 'string'
    ? raw.export_id
    : typeof raw.job_id === 'string'
      ? raw.job_id
      : typeof raw.id === 'string'
        ? raw.id
        : undefined;
  const artifactsRaw = (raw.artifacts && typeof raw.artifacts === 'object' ? raw.artifacts : {}) as ExportJob['artifacts'];
  const rawProgress = asNumber(raw.progress, state === 'done' ? 100 : 0);
  return {
    export_id: exportId,
    state,
    progress: Math.max(0, Math.min(100, rawProgress)),
    message: typeof raw.message === 'string' ? raw.message : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    artifacts: artifactsRaw,
  };
};

export const api = {
  async listSongs(): Promise<Song[]> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.listSongs();
    }
    const raw = await request<unknown>('/api/songs');
    const items = Array.isArray(raw) ? raw : ((raw as { songs?: unknown[] })?.songs || []);
    return items.map((item) => {
      const value = item as Record<string, unknown>;
      return {
        song_id: String(value.song_id || value.id || ''),
        filename: String(value.filename || value.title || 'Bài hát'),
        title: typeof value.title === 'string' ? value.title : undefined,
        created_at: typeof value.created_at === 'string' ? value.created_at : undefined,
        duration: value.duration === undefined ? undefined : asNumber(value.duration),
        status: normalizeStatus(value.status || {}),
      };
    });
  },

  async uploadSong(file: File): Promise<string> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.uploadSong(file);
    }
    const form = new FormData();
    form.append('file', file);
    const raw = await request<{ song_id?: string; id?: string }>('/api/upload', { method: 'POST', body: form });
    const songId = raw.song_id || raw.id;
    if (!songId) throw new ApiError('Backend không trả về mã bài hát.', 500, raw);
    return songId;
  },

  async uploadFromYouTube(url: string): Promise<{ song_id: string; title: string; filename: string }> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.uploadFromYouTube(url);
    }
    const raw = await request<{ song_id: string; title: string; filename: string }>('/api/upload/youtube', postJson({ url }));
    if (!raw.song_id) throw new ApiError('Backend không tải được video từ YouTube.', 500, raw);
    return raw;
  },

  processSong(songId: string, lyricsText: string, modelPreset: ModelPreset) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.processSong(songId, lyricsText, modelPreset);
    }
    return request(`/api/process/${encodeURIComponent(songId)}/all`, postJson({
      lyrics_text: lyricsText || undefined,
      model_preset: modelPreset,
    }));
  },

  getProcessStatus(songId: string) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getProcessStatus(songId);
    }
    return request(`/api/process/${encodeURIComponent(songId)}/status`).then(normalizeStatus);
  },

  getJob(jobId: string) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getJob(jobId);
    }
    return request<{ status: string; progress: number; error?: string }>(`/api/process/jobs/${encodeURIComponent(jobId)}`);
  },

  getLyrics(songId: string) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getLyrics(songId);
    }
    return request(`/api/lyrics/${encodeURIComponent(songId)}`).then((raw) => normalizeLyrics(raw, songId));
  },

  async saveLyrics(songId: string, lyrics: LyricsData) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.saveLyrics(songId, lyrics);
    }
    const raw = await request(`/api/lyrics/${encodeURIComponent(songId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lyrics),
    });
    const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (Array.isArray(record.lines)) return normalizeLyrics(record, songId);
    return { ...lyrics, version: Math.max(lyrics.version + 1, asNumber(record.version, lyrics.version + 1)) };
  },

  alignLyrics(songId: string, lyricsText: string, modelPreset: ModelPreset, baseVersion: number, lineIds?: string[]) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.alignLyrics(songId, lyricsText, modelPreset, baseVersion, lineIds);
    }
    return request(`/api/process/${encodeURIComponent(songId)}/align`, postJson({
      lyrics_text: lyricsText,
      model_preset: modelPreset,
      base_version: baseVersion,
      line_ids: lineIds,
    }));
  },

  async getWaveform(songId: string, track: TrackKind, points = 6000, signal?: AbortSignal): Promise<WaveformData | null> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getWaveform(songId, track, points, signal);
    }
    try {
      const raw = await request<Record<string, unknown>>(`/api/songs/${encodeURIComponent(songId)}/waveform?track=${track}&points=${points}`, { signal });
      return { duration: asNumber(raw.duration), peaks: ((raw.peaks || raw.points) as number[] | number[][]) || [] };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  previewAss(songId: string, lyrics: LyricsData, preset: KaraokePreset, style?: VideoStyle, signal?: AbortSignal) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.previewAss(songId, lyrics, preset, style, signal);
    }
    return request<string>(`/api/lyrics/${encodeURIComponent(songId)}/preview-ass`, { ...postJson({ lyrics, preset, style }), signal });
  },

  async startExport(songId: string, preset: KaraokePreset, lyricsVersion: number, style?: VideoStyle): Promise<ExportJob> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.startExport(songId, preset, lyricsVersion, style);
    }
    const raw = await request<Record<string, unknown>>(`/api/export/${encodeURIComponent(songId)}`, postJson({
      preset,
      lyrics_version: lyricsVersion,
      style,
    }));
    return normalizeExport(raw, 'queued');
  },

  async uploadBackground(songId: string, file: File): Promise<{ message: string; url: string }> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.uploadBackground(songId, file);
    }
    const form = new FormData();
    form.append('file', file);
    return request<{ message: string; url: string }>(`/api/songs/${encodeURIComponent(songId)}/background`, {
      method: 'POST',
      body: form,
    });
  },

  getBackgroundUrl(songId: string): string {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getBackgroundUrl(songId);
    }
    return `${API_BASE_URL}/api/songs/${encodeURIComponent(songId)}/background`;
  },

  deleteBackground(songId: string): Promise<{ message: string }> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.deleteBackground(songId);
    }
    return request<{ message: string }>(`/api/songs/${encodeURIComponent(songId)}/background`, {
      method: 'DELETE',
    });
  },

  async getExportStatus(songId: string, exportId?: string): Promise<ExportJob> {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.getExportStatus(songId, exportId);
    }
    const query = exportId ? `?export_id=${encodeURIComponent(exportId)}` : '';
    const raw = await request<Record<string, unknown>>(`/api/export/${encodeURIComponent(songId)}/status${query}`);
    return normalizeExport(raw);
  },

  deleteSong(songId: string) {
    if (getBackendMode() === 'supabase' && isSupabaseConfigured()) {
      return supabaseApi.deleteSong(songId);
    }
    return request(`/api/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  },
};
