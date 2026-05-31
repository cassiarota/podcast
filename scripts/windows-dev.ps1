# windows-dev.ps1 — start 随身听 in dev mode.

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$venv = Join-Path $repo "desktop\sidecar\.venv"

if (-not (Test-Path $venv)) {
    Write-Host -ForegroundColor Red "[x] Python venv missing. Run scripts\windows-setup.ps1 first."
    exit 1
}
$nodeModules = Join-Path $repo "desktop\node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host -ForegroundColor Red "[x] node_modules missing. Run scripts\windows-setup.ps1 first."
    exit 1
}

$model = Join-Path $repo "models\Kokoro-82M\kokoro-v1_0.pth"
if ((Test-Path $model) -and ((Get-Item $model).Length -lt 1048576)) {
    Write-Host -ForegroundColor Red "[x] Kokoro model is an LFS pointer. Run: git lfs pull"
    exit 1
}

$env:RUST_LOG = if ($env:RUST_LOG) { $env:RUST_LOG } else { "info,podcast_reader_lib=debug" }

Set-Location (Join-Path $repo "desktop")
Write-Host -ForegroundColor White "==> pnpm tauri dev"
Write-Host "    First build takes 3-5 minutes (200+ Rust crates)."
Write-Host "    Quit: Ctrl-C"
Write-Host ""
pnpm tauri dev
