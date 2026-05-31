# windows-setup.ps1 — one-shot env setup for 随身听 on Windows.
# Mirrors scripts/macos-setup.sh.
#
# Run from PowerShell (Admin not required):
#   bash> nothing
#   PowerShell> .\scripts\windows-setup.ps1
#
# Does:
#   1. Checks prerequisites (VS Build Tools, Rust, Node/pnpm, Python 3.12, Git LFS).
#   2. git lfs pull (Kokoro model ~330 MB).
#   3. Creates desktop\sidecar\.venv and installs Kokoro + Chinese phonemizer
#      + FastAPI deps.
#   4. pnpm install.
#
# Re-running is safe.

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $repo

function Bold($s) { Write-Host -ForegroundColor White $s }
function Ok($s)   { Write-Host -ForegroundColor Green "  [+] $s" }
function Warn($s) { Write-Host -ForegroundColor Yellow "  [!] $s" }
function Fail($s) { Write-Host -ForegroundColor Red "  [x] $s"; exit 1 }

Bold "==> 随身听 - Windows setup"
Write-Host "    Repo: $repo"
Write-Host ""

# ---- 1. system prerequisites ----
Bold "==> 1/4 Check toolchain"

# Visual Studio Build Tools (needs MSVC for Rust)
$vsExists = (Get-Command cl.exe -ErrorAction SilentlyContinue) -ne $null
if (-not $vsExists) {
    Warn "MSVC (cl.exe) not found. Install Visual Studio 2022 Build Tools with the"
    Warn "  'Desktop development with C++' workload before continuing:"
    Warn "  winget install Microsoft.VisualStudio.2022.BuildTools --override '--passive --add Microsoft.VisualStudio.Workload.VCTools'"
}
else { Ok "MSVC found" }

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Fail "Rust not installed. Run: winget install Rustlang.Rustup; rustup default stable"
}
Ok ("Rust: " + (cargo --version))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js not installed. Run: winget install OpenJS.NodeJS.LTS"
}
Ok ("Node: " + (node --version))

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Warn "pnpm not installed, installing via npm..."
    npm install -g pnpm@10
}
Ok ("pnpm: " + (pnpm --version))

$py = $null
foreach ($cand in @('py -3.12', 'python3.12', 'python')) {
    try {
        $ver = & cmd /c "$cand --version 2>&1"
        if ($ver -match 'Python 3\.1[2-9]') {
            $py = $cand
            break
        }
    } catch {}
}
if (-not $py) {
    Fail "Python 3.12+ not found. Run: winget install Python.Python.3.12"
}
Ok "Python: $py"

if (-not (Get-Command git-lfs -ErrorAction SilentlyContinue)) {
    Warn "Git LFS not installed, installing..."
    winget install GitHub.GitLFS
}
Ok ("Git LFS: " + ((git lfs version) -split "`n")[0])

# ---- 2. LFS pull (Kokoro model) ----
Write-Host ""
Bold "==> 2/4 Pull Kokoro model (~330 MB)"
git lfs install | Out-Null
$model = "models\Kokoro-82M\kokoro-v1_0.pth"
if (Test-Path $model) {
    $size = (Get-Item $model).Length
    if ($size -lt 1048576) {
        Warn "Model is only $size bytes (LFS pointer). Pulling..."
        git lfs pull
    }
}
git lfs pull
$size = (Get-Item $model).Length
if ($size -lt 1048576) {
    Fail "Kokoro model is still $size bytes. Check LFS quota or network."
}
Ok ("Kokoro model: " + [math]::Round($size / 1MB) + " MB")

# ---- 3. Python venv + Kokoro deps ----
Write-Host ""
Bold "==> 3/4 Create Python sidecar venv + install Kokoro"
$venv = Join-Path $repo "desktop\sidecar\.venv"
if (-not (Test-Path $venv)) {
    Write-Host "  Creating venv at desktop\sidecar\.venv ..."
    & cmd /c "$py -m venv `"$venv`""
}

$venvPy = Join-Path $venv "Scripts\python.exe"
& $venvPy -m pip install --upgrade pip --quiet
Write-Host "  pip install (kokoro + misaki[zh] + fastapi ...)  -- first run takes 3-5 minutes"
& $venvPy -m pip install -r (Join-Path $repo "windows\sidecar-env\requirements.txt")

# Quick smoke test
$smoke = & $venvPy -c "import kokoro; print('kokoro', kokoro.__version__)" 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "kokoro import failed: $smoke"
}
Ok "Python deps installed"

# ---- 4. JS deps ----
Write-Host ""
Bold "==> 4/4 Install JS deps"
Push-Location (Join-Path $repo "desktop")
pnpm install
Pop-Location
Ok "pnpm install complete"

# ---- summary ----
Write-Host ""
Bold "==> Done. Next steps:"
Write-Host ""
Write-Host "    Dev mode (recommended first run):"
Write-Host "        .\scripts\windows-dev.ps1"
Write-Host ""
Write-Host "    Build .msi installer:"
Write-Host "        .\scripts\windows-build.ps1"
Write-Host ""
Write-Host "    In the app:"
Write-Host "        Right-top -> Settings -> TTS -> Engine = Kokoro 82M -> Language = 中文 (Mandarin) -> Voice = zf_xiaoxiao"
Write-Host ""
