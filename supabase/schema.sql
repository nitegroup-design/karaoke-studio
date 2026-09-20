-- ============================================================================
-- KARAOKE STUDIO - SUPABASE DATABASE SCHEMA
-- Hỗ trợ kiến trúc Decoupled GPU Worker (Google Colab / RunPod)
-- ============================================================================

-- 1. BẬT EXTENSIONS CẦN THIẾT
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. BẢNG SONGS (Quản lý các bài hát)
CREATE TABLE IF NOT EXISTS public.songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT 'Bài hát mới',
    original_filename TEXT NOT NULL DEFAULT 'audio.mp3',
    audio_path TEXT, -- Đường dẫn trong bucket audio-inputs
    youtube_url TEXT,
    duration NUMERIC,
    status JSONB NOT NULL DEFAULT '{"separation": "pending", "transcription": "pending", "render": "pending"}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. BẢNG LYRICS (Quản lý lời bài hát và mốc thời gian từng từ)
CREATE TABLE IF NOT EXISTS public.lyrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Bài hát',
    version INTEGER NOT NULL DEFAULT 1,
    canonical_text TEXT,
    lines JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_song_lyrics UNIQUE (song_id)
);

-- 4. BẢNG JOBS (Hàng đợi tác vụ cho GPU Worker)
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- 'process_all', 'separate', 'transcribe', 'align', 'export'
    status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'done', 'error'
    progress NUMERIC NOT NULL DEFAULT 0, -- 0 -> 100
    message TEXT DEFAULT 'Đang chờ GPU nhận việc...',
    error TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB DEFAULT '{}'::jsonb,
    stage TEXT DEFAULT 'init',
    checkpoint JSONB DEFAULT '{}'::jsonb,
    retry_count INTEGER DEFAULT 0,
    worker_id TEXT, -- ID của Colab hoặc RunPod instance
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. BẢNG SONG_STRUCTURES (Cấu trúc bài hát: Verse, Chorus, Hook, Repeats, Occurrences)
CREATE TABLE IF NOT EXISTS public.song_structures (
    song_id UUID PRIMARY KEY REFERENCES public.songs(id) ON DELETE CASCADE,
    structure JSONB NOT NULL DEFAULT '{"sections": []}'::jsonb,
    bpm NUMERIC,
    detected_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. BẢNG REVIEW_ITEMS (Trung tâm kiểm duyệt các nghi vấn AI & bất đồng thuận)
CREATE TABLE IF NOT EXISTS public.review_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    line_id TEXT,
    word_id TEXT,
    timestamp NUMERIC,
    reason TEXT NOT NULL,
    source_text TEXT,
    asr_text TEXT,
    ai_interpretation TEXT,
    confidence NUMERIC DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'resolved', 'ignored'
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. BẢNG REVIEW_HISTORY (Audit trail lịch sử can thiệp của con người)
CREATE TABLE IF NOT EXISTS public.review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. TẠO INDEX ĐỂ TRUY VẤN CỰC NHANH
CREATE INDEX IF NOT EXISTS idx_jobs_queued ON public.jobs (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_lyrics_song_id ON public.lyrics (song_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON public.songs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_items_song ON public.review_items (song_id, status);
CREATE INDEX IF NOT EXISTS idx_review_history_song ON public.review_history (song_id, created_at DESC);

-- 9. TỰ ĐỘNG CẬP NHẬT updated_at QUA TRIGGER
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_songs_updated_at ON public.songs;
CREATE TRIGGER tr_songs_updated_at BEFORE UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_jobs_updated_at ON public.jobs;
CREATE TRIGGER tr_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_lyrics_updated_at ON public.lyrics;
CREATE TRIGGER tr_lyrics_updated_at BEFORE UPDATE ON public.lyrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_song_structures_updated_at ON public.song_structures;
CREATE TRIGGER tr_song_structures_updated_at BEFORE UPDATE ON public.song_structures FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 10. KÍCH HOẠT SUPABASE REALTIME (Để Frontend nhận tiến độ live qua WebSocket)
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lyrics;
ALTER PUBLICATION supabase_realtime ADD TABLE public.songs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.song_structures;
ALTER PUBLICATION supabase_realtime ADD TABLE public.review_items;

-- 11. THIẾT LẬP BẢO MẬT ROW LEVEL SECURITY (RLS)
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lyrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access songs" ON public.songs;
CREATE POLICY "Public access songs" ON public.songs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access lyrics" ON public.lyrics;
CREATE POLICY "Public access lyrics" ON public.lyrics FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access jobs" ON public.jobs;
CREATE POLICY "Public access jobs" ON public.jobs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access song_structures" ON public.song_structures;
CREATE POLICY "Public access song_structures" ON public.song_structures FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access review_items" ON public.review_items;
CREATE POLICY "Public access review_items" ON public.review_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access review_history" ON public.review_history;
CREATE POLICY "Public access review_history" ON public.review_history FOR ALL USING (true) WITH CHECK (true);

-- 12. HƯỚNG DẪN TẠO STORAGE BUCKETS TRÊN SUPABASE DASHBOARD:
-- Bạn vào mục 'Storage' -> 'New Bucket' và tạo 3 bucket sau (Bật 'Public bucket'):
-- 1. audio-inputs   (Chứa file audio gốc tải lên từ web hoặc YouTube)
-- 2. audio-stems    (Chứa vocals.wav và no_vocals.wav sau khi GPU tách xong)
-- 3. video-exports  (Chứa video MP4 karaoke hoàn chỉnh đã xuất)

