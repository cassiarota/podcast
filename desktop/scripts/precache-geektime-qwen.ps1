param(
    [ValidateSet("resume", "status", "verify")]
    [string]$Mode = "resume",
    [string]$BooksDir = "D:\document\geektime-books",
    [int]$BatchSize = 8,
    [int]$BatchCharLimit = 900,
    [int]$RetryDelaySeconds = 20,
    [int]$MaxAttempts = 0,
    [int]$MaxNewSentences = 0
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TauriDir = Join-Path $RepoRoot "src-tauri"

Write-Host "Books: $BooksDir"
Write-Host "Tauri: $TauriDir"
Write-Host "Mode:  $Mode"
Write-Host "Batch: $BatchSize"
Write-Host "Chars: $BatchCharLimit"
Write-Host "Max new sentences: $(if ($MaxNewSentences -le 0) { 'unlimited' } else { $MaxNewSentences })"
Write-Host "Retry: $RetryDelaySeconds seconds; MaxAttempts: $(if ($MaxAttempts -le 0) { 'unlimited' } else { $MaxAttempts })"
Write-Host "resume = start Qwen and continue missing sentence audio."
Write-Host "status = print progress without starting Qwen."
Write-Host "verify = fail unless every target sentence has a WAV file."

Push-Location $TauriDir
try {
    $env:PRECACHE_BATCH_SIZE = [string]$BatchSize
    $env:PRECACHE_BATCH_CHAR_LIMIT = [string]$BatchCharLimit
    if ($MaxNewSentences -gt 0) {
        $env:PRECACHE_MAX_NEW_SENTENCES = [string]$MaxNewSentences
    }
    $attempt = 1
    while ($true) {
        Write-Host "Attempt $attempt started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        cargo run --bin precache_geektime -- $Mode $BooksDir
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            exit 0
        }
        if ($Mode -ne "resume") {
            exit $exitCode
        }
        if ($MaxAttempts -gt 0 -and $attempt -ge $MaxAttempts) {
            Write-Error "precache failed with exit code $exitCode after $attempt attempts."
            exit $exitCode
        }
        Write-Warning "precache exited with code $exitCode. Restarting from checkpoint in $RetryDelaySeconds seconds..."
        Start-Sleep -Seconds $RetryDelaySeconds
        $attempt += 1
    }
}
finally {
    Remove-Item Env:\PRECACHE_BATCH_SIZE -ErrorAction SilentlyContinue
    Remove-Item Env:\PRECACHE_BATCH_CHAR_LIMIT -ErrorAction SilentlyContinue
    Remove-Item Env:\PRECACHE_MAX_NEW_SENTENCES -ErrorAction SilentlyContinue
    Pop-Location
}
