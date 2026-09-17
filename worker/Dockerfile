# Dockerfile cho RunPod Serverless GPU Worker
FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Cài đặt ffmpeg & git
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt thư viện Python AI
RUN pip install --no-cache-dir \
    demucs \
    stable-ts \
    supabase \
    runpod \
    yt-dlp

# Copy mã nguồn worker
COPY worker.py /app/worker.py
COPY runpod_handler.py /app/runpod_handler.py

CMD ["python", "-u", "/app/runpod_handler.py"]
