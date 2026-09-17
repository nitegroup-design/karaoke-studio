@echo off
chcp 65001 > nul
echo ====================================================
echo       KARAOKE STUDIO - CÀI ĐẶT MÔI TRƯỜNG
echo ====================================================
echo [1/2] Cài đặt Backend Python...
cd backend
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..
echo [2/2] Cài đặt Frontend Node.js...
cd frontend
npm install
cd ..
echo ====================================================
echo CÀI ĐẶT HOÀN TẤT! Bạn có thể chạy START_STUDIO.bat để mở ứng dụng.
echo ====================================================
pause
