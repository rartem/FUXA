@echo off
setlocal
echo ============================================
echo  FUXA: Build Server (Node.js)
echo ============================================

cd /d "%~dp0server"

echo [1/1] Installing server dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed for server
    exit /b 1
)

echo.
echo ============================================
echo  Server build complete: server\
echo ============================================
