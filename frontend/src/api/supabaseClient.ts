import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ExportJob,
  KaraokePreset,
  LyricsData,
  ModelPreset,
  ProcessingStatus,
  Song,
  TrackKind,
  VideoStyle,
  WaveformData,
} from '../types';
import { generateAssText } from '../utils/assGenerator';

export function getSupabaseCredentials() {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('karaoke_supabase_url') || '' : '';
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('karaoke_supabase_anon_key') || '' : '';

  const url = localUrl.trim() || envUrl.trim();
  const anonKey = localKey.trim() || envKey.trim();
  return { url, anonKey, isConfigured: Boolean(url && anonKey) };
}

export function setSupabaseCredentials(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('karaoke_supabase_url', url.trim());
    localStorage.setItem('karaoke_supabase_anon_key', anonKey.trim());
    supabaseInstance = null; // Reset instance so it recreates with new creds
  }
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!supabaseInstance) {
    if (!isConfigured) {
      throw new Error('Chưa cấu hình Supabase URL hoặc Supabase Anon Key. Vui lòng kiểm tra cấu hình.');
    }
    supabaseInstance = createClient(url, anonKey);
  }
  return supabaseInstance;
}

export const isSupabaseConfigured = () => getSupabaseCredentials().isConfigured;

export const supabaseApi = {
  async listSongs(): Promise<Song[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      song_id: row.id,
      filename: row.original_filename || row.title,
      title: row.title,
      created_at: row.created_at,
      duration: row.duration || undefined,
      status: row.status || { separation: 'pending', transcription: 'pending', render: 'pending' },
    }));
  },

  async uploadSong(file: File): Promise<string> {
    const supabase = getSupabase();
    const songId = crypto.randomUUID();
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
const filePath = `${songId}/original.${ext}`;

    // Upload audio to bucket 'audio-inputs'
    const { error: uploadError } = await supabase.storage
      .from('audio-inputs')
      .upload(filePath, file, { upsert: true });
    if (uploadError) throw new Error(`Lỗi tải nhạc: ${uploadError.message}`);

    // Create song row
    const { error: dbError } = await supabase.from('songs').insert({
      id: songId,
      title: file.name.replace(/\.[^/.]+$/, ''),
      original_filename: file.name,
      audio_path: filePath,
      status: { separation: 'pending', transcription: 'pending', render: 'pending' },
    });
    if (dbError) throw new Error(dbError.message);

    return songId;
  },

  async uploadFromYouTube(url: string): Promise<{ song_id: string; title: string; filename: string }> {
    const supabase = getSupabase();
    const songId = crypto.randomUUID();
    const title = 'YouTube Audio';

    const { error } = await supabase.from('songs').insert({
      id: songId,
      title,
      original_filename: `${title}.mp3`,
      youtube_url: url.trim(),
      status: { separation: 'pending', transcription: 'pending', render: 'pending' },
    });
    if (error) throw new Error(error.message);

    return { song_id: songId, title, filename: `${title}.mp3` };
  },

  async processSong(songId: string, lyricsText: string, modelPreset: ModelPreset) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('jobs').insert({
      song_id: songId,
      kind: 'process_all',
      status: 'queued',
      progress: 0,
      message: 'Tác vụ đã vào hàng đợi GPU...',
      payload: { lyrics_text: lyricsText, model_preset: modelPreset },
    }).select('id').single();

    if (error) throw new Error(error.message);
    return { job_id: data.id, song_id: songId, message: 'Đã đưa vào hàng đợi GPU' };
  },

  async getProcessStatus(songId: string): Promise<ProcessingStatus> {
    const supabase = getSupabase();
    const { data: song, error } = await supabase
      .from('songs')
      .select('status')
      .eq('id', songId)
      .single();

    if (error || !song) {
      return {
        separation: { state: 'pending' },
        transcription: { state: 'pending' },
      };
    }
    return song.status as ProcessingStatus;
  },

  async getJob(jobId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('jobs')
      .select('status, progress, message, error')
      .eq('id', jobId)
      .single();

    if (error) throw new Error(error.message);
    return {
      status: data.status,
      progress: Number(data.progress || 0),
      message: data.message,
      error: data.error,
    };
  },

  async getLyrics(songId: string): Promise<LyricsData> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('lyrics')
      .select('*')
      .eq('song_id', songId)
      .single();

    if (error || !data) {
      throw new Error('Chưa có dữ liệu lời bài hát.');
    }
    return {
      song_id: data.song_id,
      title: data.title,
      version: data.version,
      updated_at: data.updated_at,
      canonical_text: data.canonical_text,
      lines: data.lines || [],
    };
  },

  async saveLyrics(songId: string, lyrics: LyricsData): Promise<LyricsData> {
    const supabase = getSupabase();
    const nextVersion = lyrics.version + 1;
    const { error } = await supabase
      .from('lyrics')
      .upsert({
        song_id: songId,
        title: lyrics.title,
        version: nextVersion,
        canonical_text: lyrics.canonical_text,
        lines: lyrics.lines,
      }, { onConflict: 'song_id' });

    if (error) throw new Error(error.message);
    return { ...lyrics, version: nextVersion };
  },

  async alignLyrics(songId: string, lyricsText: string, modelPreset: ModelPreset, _baseVersion: number, lineIds?: string[]) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('jobs').insert({
      song_id: songId,
      kind: 'align',
      status: 'queued',
      progress: 0,
      message: 'Đang xếp hàng căn lời lại...',
      payload: { lyrics_text: lyricsText, model_preset: modelPreset, line_ids: lineIds },
    }).select('id').single();

    if (error) throw new Error(error.message);
    return { job_id: data.id, song_id: songId, message: 'Đã xếp hàng căn lời' };
  },

  // Client-side waveform (WaveSurfer decodes the audio URL in-browser when null)
  async getWaveform(_songId: string, _track: TrackKind, _points = 6000, _signal?: AbortSignal): Promise<WaveformData | null> {
    return null;
  },

  // Instant client-side ASS subtitle preview without backend dependency
  async previewAss(_songId: string, lyrics: LyricsData, preset: KaraokePreset, style?: VideoStyle, _signal?: AbortSignal): Promise<string> {
    return generateAssText(lyrics, preset, style);
  },

  async startExport(songId: string, _preset: string, _version: number, _style?: VideoStyle): Promise<ExportJob> {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('jobs').insert({
      song_id: songId,
      kind: 'export',
      status: 'queued',
      progress: 0,
      message: 'Đang chuẩn bị xuất video...',
    }).select('id').single();

    if (error) throw new Error(error.message);
    return {
      export_id: data.id,
      state: 'queued',
      progress: 0,
      message: 'Đang xếp hàng xuất video',
      artifacts: {},
    };
  },

  async getExportStatus(songId: string, exportId?: string): Promise<ExportJob> {
    const supabase = getSupabase();
    const { url } = getSupabaseCredentials();
    const query = supabase.from('jobs').select('*').eq('song_id', songId).eq('kind', 'export');
    if (exportId) query.eq('id', exportId);
    const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!data) return { state: 'idle', progress: 0, artifacts: {} };
    const videoUrl = `${url}/storage/v1/object/public/video-exports/${songId}/karaoke.mp4`;
    return {
      export_id: data.id,
      state: data.status,
      progress: Number(data.progress || 0),
      message: data.message,
      error: data.error,
      artifacts: data.status === 'done' ? { mp4: videoUrl } : {},
    };
  },

  async uploadBackground(songId: string, file: File): Promise<{ message: string; url: string }> {
    const supabase = getSupabase();
    const filePath = `${songId}/background.jpg`;
    const { error } = await supabase.storage.from('audio-inputs').upload(filePath, file, { upsert: true });
    if (error) throw new Error(`Lỗi tải ảnh nền: ${error.message}`);
    const { data } = supabase.storage.from('audio-inputs').getPublicUrl(filePath);
    return { message: 'Đã tải ảnh nền thành công', url: data.publicUrl };
  },

  getBackgroundUrl(songId: string): string {
    const { url, isConfigured } = getSupabaseCredentials();
    if (!isConfigured) return '';
    return `${url}/storage/v1/object/public/audio-inputs/${songId}/background.jpg`;
  },

  async deleteBackground(songId: string): Promise<{ message: string }> {
    const supabase = getSupabase();
    await supabase.storage.from('audio-inputs').remove([`${songId}/background.jpg`]);
    return { message: 'Đã xóa ảnh nền' };
  },

  async deleteSong(songId: string): Promise<{ message: string }> {
    const supabase = getSupabase();
    await supabase.from('jobs').delete().eq('song_id', songId);
    await supabase.from('lyrics').delete().eq('song_id', songId);
    await supabase.from('songs').delete().eq('id', songId);
    return { message: 'Đã xóa bài hát' };
  },

  audioUrl(songId: string, track: TrackKind): string {
    const supabase = getSupabase();
    if (track === 'vocals' || track === 'instrumental') {
      const stemFile = track === 'vocals' ? 'vocals.wav' : 'no_vocals.wav';
      const { data } = supabase.storage.from('audio-stems').getPublicUrl(`${songId}/${stemFile}`);
      return data.publicUrl;
    }
    const { data } = supabase.storage.from('audio-inputs').getPublicUrl(`${songId}/original.mp3`);
    return data.publicUrl;
  },
};
