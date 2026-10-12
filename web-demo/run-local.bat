@echo off
setlocal
cd /d "%~dp0"
set "TIMETABLE_DB_PATH=%~dp0..\timetable_db.sqlite3"
set "TIMETABLE_SEED_DEMO_DATA=0"
if not exist "%TIMETABLE_DB_PATH%" (
    echo Existing Timetable Scheduler Pro database not found:
    echo %TIMETABLE_DB_PATH%
    exit /b 1
)
set "TIMETABLE_ADMIN_USERNAME=admin"
set /p "TIMETABLE_ADMIN_PASSWORD=Choose a local demo password (12+ characters): "
if not defined TIMETABLE_ADMIN_PASSWORD (
    echo A password is required.
    exit /b 1
)
set "TIMETABLE_HOST=127.0.0.1"
set "PORT=8000"
set "TIMETABLE_COOKIE_SECURE=0"
for /f %%S in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()"') do set "TIMETABLE_SESSION_SECRET=%%S"
echo Starting Timetable Scheduler Pro at http://127.0.0.1:8000
echo Using the existing database: %TIMETABLE_DB_PATH%
echo Back up the database before running if you need a restore point.
echo Keep this window open.
start "" http://127.0.0.1:8000
py -3.14 server.py
endlocal
