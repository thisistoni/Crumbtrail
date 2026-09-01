use crate::{
    export,
    models::{
        CaptureTargetDescriptor, CaptureTargetKind, ExportRequest, ExportResult, PixelRect,
        ProjectManifest, ProjectSummary, RecordingOptions, RecordingStateSnapshot,
    },
    recorder::RecorderManager,
    storage::StorageService,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub struct AppState {
    pub storage: StorageService,
    pub recorder: RecorderManager,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    title: String,
) -> Result<ProjectManifest, String> {
    state
        .storage
        .create_project(if title.trim().is_empty() {
            "Untitled guide"
        } else {
            &title
        })
        .map_err(message)
}

#[tauri::command]
pub fn autosave_project(
    state: State<'_, AppState>,
    mut project: ProjectManifest,
) -> Result<ProjectManifest, String> {
    project.updated_at = chrono::Utc::now().to_rfc3339();
    state.storage.autosave(&project).map_err(message)?;
    Ok(project)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    state.storage.list_sessions().map_err(message)
}

#[tauri::command]
pub fn load_session(state: State<'_, AppState>, id: String) -> Result<ProjectManifest, String> {
    state.storage.load_session(&id).map_err(message)
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.delete_session(&id).map_err(message)
}

#[tauri::command]
pub fn restore_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.restore_session(&id).map_err(message)
}

#[tauri::command]
pub fn compact_session(state: State<'_, AppState>, id: String) -> Result<usize, String> {
    state.storage.compact_session(&id).map_err(message)
}

#[tauri::command]
pub fn open_project(state: State<'_, AppState>, source: String) -> Result<ProjectManifest, String> {
    state
        .storage
        .open_archive(Path::new(&source))
        .map_err(message)
}

#[tauri::command]
pub fn save_project(
    state: State<'_, AppState>,
    project: ProjectManifest,
    destination: String,
) -> Result<String, String> {
    let destination = ensure_extension(PathBuf::from(destination), "crumbtrail");
    state
        .storage
        .save_archive(&project, &destination)
        .map_err(message)?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn replace_image(
    state: State<'_, AppState>,
    project_id: String,
    source: String,
) -> Result<String, String> {
    state
        .storage
        .replace_asset(&project_id, Path::new(&source))
        .map_err(message)
}

#[tauri::command]
pub fn read_asset_data_url(
    state: State<'_, AppState>,
    project_id: String,
    asset: String,
) -> Result<String, String> {
    let bytes = state
        .storage
        .read_asset(&project_id, &asset)
        .map_err(message)?;
    let mime = match Path::new(&asset)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn import_asset_data_url(
    state: State<'_, AppState>,
    project_id: String,
    data_url: String,
) -> Result<String, String> {
    let (bytes, extension) = decode_design_logo(&data_url)?;
    state
        .storage
        .write_asset(
            &project_id,
            &format!("design-logo-{}.{}", Uuid::new_v4(), extension),
            &bytes,
        )
        .map_err(message)
}

fn decode_design_logo(data_url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (metadata, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid image data".to_string())?;
    let extension = match metadata {
        "data:image/png;base64" => "png",
        "data:image/jpeg;base64" | "data:image/jpg;base64" => "jpg",
        _ => return Err("Only PNG and JPEG design logos are supported".to_string()),
    };
    let bytes = STANDARD.decode(payload).map_err(message)?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("The design logo is larger than 10 MB".to_string());
    }
    image::load_from_memory(&bytes).map_err(message)?;
    Ok((bytes, extension))
}

#[tauri::command]
pub async fn export_project(
    state: State<'_, AppState>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        export::export(&storage, &request).map_err(message)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn render_report_preview(
    state: State<'_, AppState>,
    project: ProjectManifest,
) -> Result<String, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        export::render_html(&storage, &project)
            .map(|(html, _)| html)
            .map_err(message)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn list_capture_targets(
    state: State<'_, AppState>,
    kind: CaptureTargetKind,
) -> Result<Vec<CaptureTargetDescriptor>, String> {
    let recorder = state.recorder.clone();
    tauri::async_runtime::spawn_blocking(move || recorder.list_targets(kind).map_err(message))
        .await
        .map_err(message)?
}

#[tauri::command]
pub async fn select_capture_target(
    state: State<'_, AppState>,
    kind: CaptureTargetKind,
    target_id: Option<String>,
) -> Result<CaptureTargetDescriptor, String> {
    let recorder = state.recorder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        recorder.select_target(kind, target_id).map_err(message)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn capture_target_thumbnail(
    state: State<'_, AppState>,
    target_id: String,
) -> Result<String, String> {
    let recorder = state.recorder.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        recorder.target_thumbnail(&target_id).map_err(message)
    })
    .await
    .map_err(message)??;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    options: RecordingOptions,
    region: Option<PixelRect>,
) -> Result<RecordingStateSnapshot, String> {
    let snapshot = state
        .recorder
        .start(
            app.clone(),
            state.storage.clone(),
            project_id,
            options,
            region,
        )
        .map_err(message)?;
    let _ = app.emit("recording://state", &snapshot);
    conceal_main_window(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn pause_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordingStateSnapshot, String> {
    let snapshot = state.recorder.pause().map_err(message)?;
    let _ = app.emit("recording://state", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn resume_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordingStateSnapshot, String> {
    let snapshot = state.recorder.resume().map_err(message)?;
    let _ = app.emit("recording://state", &snapshot);
    conceal_main_window(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn capture_manual_step(state: State<'_, AppState>) -> Result<RecordingStateSnapshot, String> {
    state.recorder.manual_capture().map_err(message)
}

#[tauri::command]
pub fn undo_recorded_step(state: State<'_, AppState>) -> Result<(), String> {
    state.recorder.undo_last().map_err(message)
}

#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordingStateSnapshot, String> {
    let snapshot = state.recorder.stop().map_err(message)?;
    let _ = app.emit("recording://state", &snapshot);
    show_main_window(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn recording_state(state: State<'_, AppState>) -> RecordingStateSnapshot {
    state.recorder.state()
}

#[tauri::command]
pub fn protect_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE},
        };
        let raw = window.hwnd().map_err(message)?;
        unsafe { SetWindowDisplayAffinity(HWND(raw.0), WDA_EXCLUDEFROMCAPTURE) }
            .map_err(message)?;
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn conceal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
        let _ = window.hide();
    }
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map_or(true, |value| !value.eq_ignore_ascii_case(extension))
    {
        path.set_extension(extension);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use std::io::Cursor;

    #[test]
    fn portable_project_extension_is_added_once() {
        assert_eq!(
            ensure_extension(PathBuf::from("Guide"), "crumbtrail"),
            PathBuf::from("Guide.crumbtrail")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("Guide.crumbtrail"), "crumbtrail"),
            PathBuf::from("Guide.crumbtrail")
        );
    }

    #[test]
    fn design_logo_data_urls_are_image_validated() {
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(RgbaImage::new(2, 2))
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let data_url = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(encoded.into_inner())
        );
        let (decoded, extension) = decode_design_logo(&data_url).unwrap();
        assert!(!decoded.is_empty());
        assert_eq!(extension, "png");
        assert!(decode_design_logo("data:image/svg+xml;base64,PHN2Zy8+").is_err());
        assert!(decode_design_logo("data:image/png;base64,bm90LWEtcG5n").is_err());
    }
}
