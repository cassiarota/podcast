# Activate the Windows TTS sidecar venv.
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here "..\..\desktop\sidecar\.venv"

if (-not (Test-Path $venv)) {
    Write-Host "Creating venv at $venv"
    py -3.12 -m venv $venv
}

& (Join-Path $venv "Scripts\Activate.ps1")
Write-Host "Installing requirements (use --index-url https://download.pytorch.org/whl/cu121 for CUDA torch)"
pip install -r (Join-Path $here "requirements.txt")
