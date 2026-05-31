pub mod cache;
pub mod db;
pub mod import_epub;
pub mod import_txt;
pub mod reader;
pub mod sidecar;
pub mod tts;

use std::sync::Arc;

use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::Connection;
use sidecar::SidecarState;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub sidecar: Arc<SidecarState>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir must be available");
            std::fs::create_dir_all(&data_dir).ok();
            std::fs::create_dir_all(data_dir.join("audio_cache")).ok();

            let db_path = data_dir.join("library.db");
            let conn = db::open(&db_path)?;
            db::migrate(&conn)?;

            let resource_dir = app.path().resource_dir().ok();
            let sidecar = Arc::new(SidecarState::new(data_dir.clone(), resource_dir));

            // LFS sanity check: warn if Kokoro pointer wasn't pulled.
            if let Some(rd) = sidecar.kokoro_model_path() {
                if let Ok(meta) = std::fs::metadata(&rd) {
                    if meta.len() < 1024 {
                        tracing::warn!(
                            "Kokoro model at {:?} looks like an LFS pointer ({} bytes). \
                             Run `git lfs pull` before generating audio.",
                            rd,
                            meta.len()
                        );
                    }
                }
            }

            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                sidecar,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reader::import_book,
            reader::list_books,
            reader::open_book,
            reader::get_page,
            reader::first_page_of_section,
            reader::get_reading_position,
            reader::save_reading_position,
            reader::get_reader_settings,
            reader::save_reader_settings,
            reader::get_tts_settings,
            reader::save_tts_settings,
            reader::list_engines,
            tts::start_tts_job,
            tts::cancel_tts_job,
            tts::play_cached_or_generate,
            tts::get_tts_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn handle_init_error(e: anyhow::Error) -> Result<()> {
    tracing::error!("init error: {e:?}");
    Err(e)
}
