@echo off
setlocal
echo ============================================
echo  FUXA: Build Client (Angular)
echo ============================================

cd /d "%~dp0client"

echo [1/2] Installing client dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed for client
    exit /b 1
)

echo [2/2] Building client (production)...
call npx ng build --configuration=production
if %ERRORLEVEL% neq 0 (
    echo ERROR: Client build failed
    exit /b 1
)

echo.
echo ============================================
echo  Client build complete: client\dist\
echo ============================================
