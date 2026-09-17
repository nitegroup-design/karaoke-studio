@echo off
chcp 65001 > nul
echo ====================================================
echo       KARAOKE STUDIO - KHỞI ĐỘNG HỆ THỐNG
echo ====================================================
echo [1/2] Đang khởi động Backend FastAPI (Port 8000)...
start "Karaoke Studio - Backend" cmd /k "cd backend && if exist venv\Scripts\activate (call venv\Scripts\activate) else (echo Vui long chay SETUP_ENV.bat truoc && pause && exit) && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
timeout /t 3 /nobreak > nul
echo [2/2] Đang khởi động Frontend Vite (Port 5173)...
start "Karaoke Studio - Frontend" cmd /k "cd frontend && npm run dev -- --host 127.0.0.1 --port 5173"
timeout /t 3 /nobreak > nul
echo [3/3] Đang mở trình duyệt...
start http://localhost:5173
echo Hoàn tất! Studio đang chạy tại http://localhost:5173
pause
