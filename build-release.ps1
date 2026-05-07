#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RELEASE_DIR = Join-Path $ROOT "release"
$DATE = Get-Date -Format "ddMMyy"

New-Item -ItemType Directory -Path $RELEASE_DIR -Force | Out-Null

# Headless
$ARTIFACTS_DIR = Join-Path $ROOT "artifacts"
$HEADLESS_ZIP = Join-Path $RELEASE_DIR "headless$DATE.zip"
if (-not (Test-Path $ARTIFACTS_DIR)) {
    Write-Error "artifacts\ not found. Run build-headless.ps1 first."
    exit 1
}
Write-Host "Archiving Headless -> release\headless$DATE.zip ..."
Compress-Archive -Path "$ARTIFACTS_DIR\*" -DestinationPath $HEADLESS_ZIP -Force

# Electron
$ELECTRON_UNPACKED = Join-Path $ROOT "app\electron\dist\win-unpacked"
$ELECTRON_ZIP = Join-Path $RELEASE_DIR "electron$DATE.zip"
if (-not (Test-Path $ELECTRON_UNPACKED)) {
    Write-Error "app\electron\dist\win-unpacked\ not found. Run build-electron.bat first."
    exit 1
}
Write-Host "Archiving Electron -> release\electron$DATE.zip ..."
Compress-Archive -Path "$ELECTRON_UNPACKED\*" -DestinationPath $ELECTRON_ZIP -Force

Write-Host ""
Write-Host "============================================"
Write-Host " Release archives created:"
Write-Host "   $HEADLESS_ZIP"
Write-Host "   $ELECTRON_ZIP"
Write-Host "============================================"
