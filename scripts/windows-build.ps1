# windows-build.ps1 — build 随身听 Windows installer (.msi).
#
# Output:
#   desktop\src-tauri\target\release\bundle\msi\随身听_X.Y.Z_x64_en-US.msi
#
# Notes:
#   - First-time release build takes 5-10 minutes.
#   - The .msi includes the app + bundled Kokoro model weights (~330 MB)
#     + the sidecar Python scripts. It does NOT include the venv —
#     recipients run scripts\windows-setup.ps1 once to create their own.
#   - No code signing is configured. SmartScreen will show a "publisher
#     unknown" warning on first launch. For signing, configure a code
#     signing cert and update tauri.conf.json.

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$venv = Join-Path $repo "desktop\sidecar\.venv"

if (-not (Test-Path $venv)) {
    Write-Host -ForegroundColor Red "[x] Python venv missing. Run scripts\windows-setup.ps1 first."
    exit 1
}

$model = Join-Path $repo "models\Kokoro-82M\kokoro-v1_0.pth"
if (-not (Test-Path $model) -or (Get-Item $model).Length -lt 1048576) {
    Write-Host -ForegroundColor Red "[x] Kokoro model missing or is an LFS pointer. Run: git lfs pull"
    exit 1
}
Write-Host -ForegroundColor Green ("  [+] Kokoro model: " + [math]::Round((Get-Item $model).Length / 1MB) + " MB (bundled into .msi)")

# Ensure the right Rust target is installed.
$target = "x86_64-pc-windows-msvc"
$haveTarget = (rustup target list --installed 2>&1 | Select-String -SimpleMatch $target) -ne $null
if (-not $haveTarget) {
    Write-Host -ForegroundColor White "==> Installing Rust target: $target"
    rustup target add $target
}

Set-Location (Join-Path $repo "desktop")
Write-Host -ForegroundColor White "==> pnpm tauri build --target $target --bundles msi,nsis"
Write-Host "    First build takes 5-10 minutes. Patience."
Write-Host ""
pnpm tauri build --target $target --bundles msi,nsis

$bundle = Join-Path $repo "desktop\src-tauri\target\$target\release\bundle"
$msi = Get-ChildItem -Path (Join-Path $bundle "msi") -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
$nsis = Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host ""
Write-Host -ForegroundColor White "==> Done!"
if ($msi) {
    $size = [math]::Round((Get-Item $msi.FullName).Length / 1MB)
    Write-Host ("    .msi ($size MB): " + $msi.FullName)
}
if ($nsis) {
    $size = [math]::Round((Get-Item $nsis.FullName).Length / 1MB)
    Write-Host ("    NSIS setup ($size MB): " + $nsis.FullName)
}
Write-Host ""
Write-Host -ForegroundColor White "==> Recipient-machine flow:"
Write-Host "    1. Double-click .msi -> install -> Start menu has 随身听"
Write-Host "    2. First launch SmartScreen warns 'publisher unknown'"
Write-Host "       Right-click .msi -> Properties -> Unblock, OR click 'More info' -> 'Run anyway'"
Write-Host "    3. App runs, library + reader work. TTS needs Python 3.12 + a venv at"
Write-Host "       %APPDATA%\com.podcast.reader\sidecar-venv with the same kokoro install."
Write-Host "       The simplest way is to clone the source repo and run scripts\windows-setup.ps1."
