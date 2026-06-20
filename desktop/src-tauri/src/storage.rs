use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const DEFAULT_DATA_DIR: &str = r"D:\document\geektime-books";
const DEFAULT_AUDIO_DIR: &str = r"D:\document\geektime-books\audio";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    pub data_dir: String,
    pub audio_dir: String,
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            data_dir: DEFAULT_DATA_DIR.into(),
            audio_dir: DEFAULT_AUDIO_DIR.into(),
        }
    }
}

impl StorageSettings {
    pub fn data_dir_path(&self) -> PathBuf {
        normalized_or_default(&self.data_dir, DEFAULT_DATA_DIR)
    }

    pub fn audio_dir_path(&self) -> PathBuf {
        normalized_or_default(&self.audio_dir, DEFAULT_AUDIO_DIR)
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir_path().join("library.db")
    }
}

pub fn bootstrap_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").context("APPDATA is not set")?;
    Ok(PathBuf::from(appdata).join("com.podcast.reader"))
}

pub fn bootstrap_config_path() -> Result<PathBuf> {
    Ok(bootstrap_dir()?.join("storage.json"))
}

pub fn load_storage_settings() -> Result<StorageSettings> {
    let path = bootstrap_config_path()?;
    if !path.exists() {
        return Ok(StorageSettings::default());
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("read storage config {}", path.display()))?;
    let mut settings: StorageSettings = serde_json::from_str(&text)
        .with_context(|| format!("parse storage config {}", path.display()))?;
    if settings.data_dir.trim().is_empty() {
        settings.data_dir = DEFAULT_DATA_DIR.into();
    }
    if settings.audio_dir.trim().is_empty() {
        settings.audio_dir = DEFAULT_AUDIO_DIR.into();
    }
    Ok(settings)
}

pub fn save_storage_config(settings: &StorageSettings) -> Result<()> {
    let bootstrap = bootstrap_dir()?;
    std::fs::create_dir_all(&bootstrap)?;
    let data_dir = settings.data_dir_path();
    let audio_dir = settings.audio_dir_path();
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("create data dir {}", data_dir.display()))?;
    std::fs::create_dir_all(&audio_dir)
        .with_context(|| format!("create audio dir {}", audio_dir.display()))?;
    let normalized = StorageSettings {
        data_dir: data_dir.to_string_lossy().to_string(),
        audio_dir: audio_dir.to_string_lossy().to_string(),
    };
    let json = serde_json::to_string_pretty(&normalized)?;
    std::fs::write(bootstrap.join("storage.json"), json)?;
    Ok(())
}

#[tauri::command]
pub fn get_storage_settings() -> Result<StorageSettings, String> {
    load_storage_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_storage_settings(settings: StorageSettings) -> Result<(), String> {
    save_storage_config(&settings).map_err(|e| e.to_string())
}

fn normalized_or_default(value: &str, default: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        PathBuf::from(default)
    } else {
        Path::new(trimmed).to_path_buf()
    }
}
