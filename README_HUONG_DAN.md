# KARAOKE STUDIO - TOÀN BỘ MÃ NGUỒN & KIẾN TRÚC HYBRID (LOCAL + CLOUD)

Đây là gói mã nguồn hoàn chỉnh của hệ thống **Karaoke Studio** (Tách giọng Demucs, căn lời word-level tiếng Việt Whisper-large-v3, Waveform timeline trực quan và xuất video 1080p).

## Cấu trúc thư mục

```
KaraokeStudio-SourceCode/
├── backend/                  # Máy chủ FastAPI chạy Offline trên máy
│   ├── app/                 # Logic chính (routers, services, models)
│   │   ├── main.py          # FastAPI entry point & CORS
│   │   ├── config.py        # Cấu hình đường dẫn, FFmpeg, directories
│   │   ├── routers/         # Các API: upload, process, lyrics, export
│   │   └── services/        # Tách nhạc (Demucs), Căn lời (stable-ts), Render (FFmpeg + ASS)
│   ├── tests/               # 8 bộ test tự động
│   └── requirements.txt     # Danh sách thư viện Python
├── frontend/                 # Giao diện Studio React 19 + Vite + Tailwind
│   ├── src/                 # Toàn bộ mã nguồn giao diện
│   │   ├── pages/           # UploadPage, EditorPage, PreviewPage
│   │   ├── components/      # WaveSurfer timeline, JASSUB preview canvas, StyleModal...
│   │   ├── api/             # API client kép: Hỗ trợ cả Local FastAPI & Supabase Cloud
│   │   └── utils/           # Thuật toán căn nhịp, đồng bộ lyric, ASS generator client-side
│   ├── public/              # Font chữ Be Vietnam Pro, WASM subtitle worker
│   └── package.json         # Thư viện npm
├── supabase/                 # Database & Storage Cloud (BaaS)
│   └── schema.sql           # Toàn bộ SQL tables (songs, lyrics, jobs), triggers, RLS, buckets
├── worker/                   # GPU Workers cho AI Demucs & Whisper
│   ├── karaoke_colab_worker.ipynb # File Google Colab GPU (Nvidia T4 miễn phí, chạy trong 15-20s)
│   ├── worker.py            # Universal GPU Poller kết nối Supabase Realtime
│   ├── runpod_handler.py    # Serverless GPU handler cho RunPod khi mở rộng thương mại
│   └── Dockerfile           # Docker image cho RunPod Serverless
├── .github/workflows/       # Tự động hóa CI/CD
│   └── deploy.yml           # Tự động build & deploy Frontend lên GitHub Pages miễn phí
├── START_STUDIO.bat         # File click chạy ngay chế độ Local trên máy tính
├── SETUP_ENV.bat            # File cài đặt môi trường tự động (pip + npm)
└── README_HUONG_DAN.md      # Hướng dẫn chi tiết này
```

## 1. Chạy trên máy tính cá nhân (Local Mode)

1. **Cài đặt lần đầu**: Nhấp đúp chuột vào file `SETUP_ENV.bat`.
2. **Khởi động**: Nhấp đúp chuột vào file `START_STUDIO.bat`.
3. Trình duyệt tự động mở `http://localhost:5173`.

## 2. Triển khai Cloud hoàn toàn miễn phí (GitHub Pages + Supabase + Google Colab)

### Bước A: Tạo Database Supabase
1. Tạo tài khoản và project miễn phí tại [supabase.com](https://supabase.com).
2. Vào **SQL Editor** trên Supabase, mở file `supabase/schema.sql`, dán vào và bấm **Run**.
3. Lấy URL và Anon Key tại mục **Project Settings -> API**.

### Bước B: Chạy GPU Worker trên Google Colab
1. Mở [Google Colab](https://colab.research.google.com) và tải lên file `worker/karaoke_colab_worker.ipynb`.
2. Đổi môi trường thực thi sang **T4 GPU** (Runtime -> Change runtime type -> T4 GPU).
3. Điền Supabase URL & Key vào ô cấu hình và bấm **Run All**.
4. Colab sẽ tự động nhận bài hát từ Supabase, tách nhạc và căn lời với tốc độ siêu nhanh (15-20 giây)!

### Bước C: Đưa Frontend lên GitHub Pages
1. Push toàn bộ mã nguồn lên GitHub repository cá nhân.
2. GitHub Actions (`.github/workflows/deploy.yml`) sẽ tự động build và xuất bản website của bạn tại `https://<ten-user>.github.io/<ten-repo>/`.
3. Khi mở web trên GitHub Pages, nhấp vào nút `☁️ Cấu hình Cloud` ở góc trên để dán Supabase URL và Key.

## 3. Nâng cấp lên RunPod Serverless khi có đông người dùng
- Chỉ cần tạo Serverless Endpoint trên RunPod từ `worker/Dockerfile`.
- Frontend và Supabase giữ nguyên 100%, không cần sửa đổi bất kỳ dòng mã nào!
