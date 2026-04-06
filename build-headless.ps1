#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "============================================"
Write-Host " FUXA: Build Headless (Windows x64)"
Write-Host "============================================"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Step 1: Server
Write-Host ""
Write-Host "[1/6] Installing server dependencies..."
Push-Location "$ROOT\server"
npm config set fetch-retry-maxtimeout 120000
npm config set fetch-retries 5
npm install --prefer-offline --no-audit
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed for server" }
Pop-Location

# Step 2: Client
Write-Host ""
Write-Host "[2/6] Installing client dependencies..."
Push-Location "$ROOT\client"
npm config set fetch-retry-maxtimeout 120000
npm config set fetch-retries 5
npm install --prefer-offline --no-audit
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed for client" }
Pop-Location

# Step 3: Build client
Write-Host ""
Write-Host "[3/6] Building client (production)..."
Push-Location "$ROOT\client"
npx ng build --configuration=production
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Client build failed" }
Pop-Location

# Step 4: Setup headless package directory
Write-Host ""
Write-Host "[4/6] Preparing headless package directory..."

$HEADLESS_DIR = "$ROOT\fuxa-headless"

if (Test-Path $HEADLESS_DIR) { Remove-Item $HEADLESS_DIR -Recurse -Force }
New-Item -ItemType Directory -Path "$HEADLESS_DIR\server" -Force | Out-Null
New-Item -ItemType Directory -Path "$HEADLESS_DIR\client\dist" -Force | Out-Null

# Copy server (excluding runtime dirs)
robocopy "$ROOT\server" "$HEADLESS_DIR\server" /E `
    /XD node_modules _appdata _db _logs _reports _webcam_snapshots _widgets _images .git `
    /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null

# Install production server deps inside headless copy
Write-Host "Installing server dependencies in fuxa-headless\server..."
Push-Location "$HEADLESS_DIR\server"
npm install --omit=dev --prefer-offline --no-audit
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed for headless server copy" }
Pop-Location

# Copy client dist
robocopy "$ROOT\client\dist" "$HEADLESS_DIR\client\dist" /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null

# Copy headless entry point
Copy-Item "$ROOT\app\headless\headless-entry.js" "$HEADLESS_DIR\main.js" -Force

# Step 5: Create package.json for pkg
Write-Host ""
Write-Host "[5/6] Creating package.json for pkg..."
$pkgJson = @{
    name    = "fuxa-headless"
    version = "1.0.0"
    bin     = "main.js"
    pkg     = @{
        assets      = @("server/**/*", "client/dist/**/*", "_reports/**/*")
        compression = "Brotli"
    }
} | ConvertTo-Json -Depth 3

Set-Content -Path "$HEADLESS_DIR\package.json" -Value $pkgJson -Encoding UTF8

# Step 6: Build standalone binary
Write-Host ""
Write-Host "[6/6] Building standalone binary (node20-win-x64)..."

$ARTIFACTS_DIR = "$ROOT\artifacts"
if (Test-Path $ARTIFACTS_DIR) { Remove-Item $ARTIFACTS_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $ARTIFACTS_DIR -Force | Out-Null

npx --yes @yao-pkg/pkg "$HEADLESS_DIR\package.json" --targets node20-win-x64 --out-path $ARTIFACTS_DIR
if ($LASTEXITCODE -ne 0) { throw "pkg build failed" }

# Rename artifact
$src = "$ARTIFACTS_DIR\fuxa-headless.exe"
$dst = "$ARTIFACTS_DIR\FUXA-headless-windows-x64.exe"
if (Test-Path $src) {
    Move-Item $src $dst -Force
}

Write-Host ""
Write-Host "============================================"
Write-Host " Headless build complete!"
Write-Host "============================================"
Write-Host " Binary: artifacts\FUXA-headless-windows-x64.exe"
Write-Host "============================================"
