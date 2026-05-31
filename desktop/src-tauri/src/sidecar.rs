use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::time::Duration;

use anyhow::{anyhow, Result};
use parking_lot::Mutex;

const DEFAULT_PORT: u16 = 38219;
const HEALTH_TIMEOUT_MS: u64 = 8_000;

/// Holds the lifecycle of the Python TTS sidecar.
///
/// We do NOT start the sidecar at app boot — `ensure_running` is what kicks
/// it off, called from inside TTS commands (`start_tts_job`, `play_cached_or_generate`).
pub struct SidecarState {
    pub data_dir: PathBuf,
    pub resource_dir: Option<PathBuf>,
    child: Mutex<Option<Child>>,
    port: AtomicU16,
    starting: AtomicBool,
}

impl SidecarState {
    pub fn new(data_dir: PathBuf, resource_dir: Option<PathBuf>) -> Self {
        Self {
            data_dir,
            resource_dir,
            child: Mutex::new(None),
            port: AtomicU16::new(DEFAULT_PORT),
            starting: AtomicBool::new(false),
        }
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => true,
                _ => {
                    *guard = None;
                    false
                }
            }
        } else {
            false
        }
    }

    pub fn audio_cache_dir(&self) -> PathBuf {
        self.data_dir.join("audio_cache")
    }

    /// Returns the absolute path of the bundled Kokoro `.pth` file on macOS,
    /// or `None` on Windows / if resources weren't bundled.
    pub fn kokoro_model_path(&self) -> Option<PathBuf> {
        // The bundled location on macOS will be inside the resource dir;
        // in dev we fall back to repo-relative `models/Kokoro-82M/...`.
        let bundled = self
            .resource_dir
            .as_ref()
            .map(|r| r.join("Kokoro-82M").join("kokoro-v1_0.pth"));
        let dev = std::env::current_dir()
            .ok()
            .map(|d| d.join("../../models/Kokoro-82M/kokoro-v1_0.pth"));
        bundled
            .into_iter()
            .chain(dev)
            .find(|p| p.exists())
    }

    pub fn engine_for_platform(&self) -> &'static str {
        if cfg!(target_os = "windows") {
            "qwen"
        } else {
            "kokoro"
        }
    }

    pub async fn ensure_running(&self) -> Result<()> {
        if self.is_running() {
            return Ok(());
        }
        // Prevent concurrent starts.
        if self
            .starting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            // Another task is starting; wait briefly.
            for _ in 0..40 {
                tokio::time::sleep(Duration::from_millis(200)).await;
                if self.is_running() {
                    return Ok(());
                }
            }
            return Err(anyhow!("sidecar still starting"));
        }

        let result = self.spawn_and_wait().await;
        self.starting.store(false, Ordering::SeqCst);
        result
    }

    async fn spawn_and_wait(&self) -> Result<()> {
        let sidecar_dir = self.locate_sidecar_dir()?;
        let main_py = sidecar_dir.join("main.py");
        if !main_py.exists() {
            return Err(anyhow!("sidecar entrypoint missing: {main_py:?}"));
        }
        let python = which_python(&sidecar_dir, &self.data_dir)?;
        tracing::info!("starting Python TTS sidecar: {python:?} {main_py:?}");

        let port = self.port();
        let audio_cache = self.audio_cache_dir();
        std::fs::create_dir_all(&audio_cache).ok();

        let engine = self.engine_for_platform();
        let kokoro_path = self
            .kokoro_model_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut cmd = Command::new(python);
        cmd.arg(main_py)
            .arg("--port")
            .arg(port.to_string())
            .arg("--audio-cache")
            .arg(&audio_cache)
            .arg("--engine")
            .arg(engine);
        if !kokoro_path.is_empty() {
            cmd.arg("--kokoro-model").arg(&kokoro_path);
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        let child = cmd.spawn().map_err(|e| anyhow!("spawn sidecar: {e}"))?;
        *self.child.lock() = Some(child);

        // Poll /healthz until ready or timeout.
        let url = format!("http://127.0.0.1:{port}/healthz");
        let start = std::time::Instant::now();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        loop {
            if start.elapsed().as_millis() as u64 > HEALTH_TIMEOUT_MS {
                self.stop();
                return Err(anyhow!("sidecar /healthz did not become ready"));
            }
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!("sidecar ready on port {port}");
                    return Ok(());
                }
                _ => tokio::time::sleep(Duration::from_millis(200)).await,
            }
        }
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn locate_sidecar_dir(&self) -> Result<PathBuf> {
        // In bundled builds we expect `<resource_dir>/sidecar/`.
        if let Some(rd) = &self.resource_dir {
            let candidate = rd.join("sidecar");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
        // Dev: from the repo we run from `desktop/src-tauri` → `../sidecar`.
        let dev = std::env::current_dir()?.join("../sidecar");
        if dev.exists() {
            return Ok(dev);
        }
        Err(anyhow!("could not locate sidecar/ directory"))
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Pick a Python interpreter for the sidecar.
///
/// Lookup order:
///   1. The dev venv next to the sidecar dir (`<sidecar>/.venv/bin/python`) —
///      this is what `scripts/macos-setup.sh` creates.
///   2. A per-user venv at `<app_data_dir>/sidecar-venv/bin/python` —
///      this is what users of the bundled .dmg / .app would set up.
///   3. `python3.12` / `python3` / `python` on PATH (last resort — engine load
///      will fail at runtime if `kokoro` isn't available, which surfaces a
///      `kokoro_not_installed` error in the UI).
fn which_python(sidecar_dir: &std::path::Path, data_dir: &std::path::Path) -> Result<PathBuf> {
    let bin_subdir = if cfg!(target_os = "windows") {
        "Scripts"
    } else {
        "bin"
    };
    let exe = if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "python"
    };

    let dev_venv = sidecar_dir.join(".venv").join(bin_subdir).join(exe);
    if dev_venv.exists() {
        return Ok(dev_venv);
    }
    let user_venv = data_dir.join("sidecar-venv").join(bin_subdir).join(exe);
    if user_venv.exists() {
        return Ok(user_venv);
    }
    for candidate in ["python3.12", "python3", "python"] {
        if let Ok(out) = Command::new(candidate).arg("--version").output() {
            if out.status.success() {
                return Ok(PathBuf::from(candidate));
            }
        }
    }
    Err(anyhow!(
        "no Python interpreter found; install Python 3.12+ or create a venv at {sidecar_dir:?}/.venv \
         (or {data_dir:?}/sidecar-venv for bundled installs)"
    ))
}
