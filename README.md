# 🎤 Karaoke Studio

Web app tạo nhạc karaoke tự động: upload nhạc → tách lời → đồng bộ lyrics → preview & export video.

## Tính năng

- **Tách lời tự động** — Demucs (Meta AI) tách vocal/instrumental
- **Nhận diện lyrics** — Whisper (OpenAI) nhận diện tiếng Việt + word-level timestamps
- **2 chế độ karaoke**:
  - 🎤 **Classic** — chữ chạy từng từ, highlight wipe effect
  - 🎵 **Modern** — Apple Music style, nhiều dòng, scroll mượt
- **Editor lyrics** — chỉnh sửa timing từng từ/dòng
- **Export video** — FFmpeg render video MP4 với beat + lyrics

## Yêu cầu hệ thống

- Python 3.11+
- Node.js 18+
- FFmpeg (phải cài và có trong PATH)

## Cài đặt

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

## Chạy ứng dụng

### 1. Khởi động Backend (terminal 1)

```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Khởi động Frontend (terminal 2)

```bash
cd frontend
npm run dev
```

Mở trình duyệt tại: **http://localhost:5173**

## Hướng dẫn sử dụng

1. **Upload nhạc** — Kéo thả file nhạc vào trang chủ
2. **Chờ xử lý** — Hệ thống tự động tách nhạc + nhận diện lyrics
3. **Chỉnh sửa** — Click vào bài hát → Editor, chỉnh timing lyrics
4. **Preview** — Xem trước karaoke (2 chế độ: Classic/Modern)
5. **Export** — Xuất video MP4 sẵn sàng upload YouTube

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Python, FastAPI, Demucs, faster-whisper |
| Frontend | React 19, TypeScript, Vite, TailwindCSS |
| Audio | Web Audio API, Canvas API |
| Video | FFmpeg, ASS Subtitles |
| GPU | AMD via onnxruntime-directml (Whisper) |
