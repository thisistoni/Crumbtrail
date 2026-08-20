mod commands;
mod export;
mod models;
mod recorder;
mod storage;

use commands::AppState;
use recorder::RecorderManager;
use storage::StorageService;
use tauri::Manager;

// The generated Tauri context embeds the production frontend into the release executable.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let local_data = if let Some(path) = std::env::var_os("CRUMBTRAIL_DATA_DIR") {
                std::path::PathBuf::from(path)
            } else {
                app.path().app_local_data_dir()?
            };
            let storage = StorageService::new(local_data).map_err(|error| error.to_string())?;
            app.manage(AppState {
                storage,
                recorder: RecorderManager::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::autosave_project,
            commands::list_sessions,
            commands::load_session,
            commands::delete_session,
            commands::open_project,
            commands::save_project,
            commands::replace_image,
            commands::read_asset_data_url,
            commands::import_asset_data_url,
            commands::export_project,
            commands::render_report_preview,
            commands::list_capture_targets,
            commands::select_capture_target,
            commands::capture_target_thumbnail,
            commands::start_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::capture_manual_step,
            commands::undo_recorded_step,
            commands::stop_recording,
            commands::recording_state,
            commands::protect_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
