use crate::{
    models::{
        CaptureTargetDescriptor, CaptureTargetKind, PixelRect, RecordingOptions,
        RecordingStateSnapshot,
    },
    storage::StorageService,
};
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::AppHandle;
use thiserror::Error;

#[cfg(windows)]
mod windows;

#[derive(Debug, Error)]
pub enum RecorderError {
    #[cfg(not(windows))]
    #[error("Screen capture is only available in this platform build")]
    Unsupported,
    #[error("No capture target has been selected")]
    NoTarget,
    #[error("A recording is already active")]
    AlreadyRecording,
    #[error("Capture was cancelled")]
    Cancelled,
    #[error("Recorder error: {0}")]
    Platform(String),
}

pub type RecorderResult<T> = Result<T, RecorderError>;

/// Platform-neutral recording boundary. Native window/display handles never cross it.
pub trait CaptureBackend: Send {
    fn list_targets(&self, kind: CaptureTargetKind)
        -> RecorderResult<Vec<CaptureTargetDescriptor>>;
    fn select_target(
        &mut self,
        kind: CaptureTargetKind,
        target_id: Option<String>,
    ) -> RecorderResult<CaptureTargetDescriptor>;
    fn start(
        &mut self,
        app: AppHandle,
        storage: StorageService,
        project_id: String,
        options: RecordingOptions,
        region: Option<PixelRect>,
    ) -> RecorderResult<RecordingStateSnapshot>;
    fn pause(&mut self) -> RecorderResult<RecordingStateSnapshot>;
    fn resume(&mut self) -> RecorderResult<RecordingStateSnapshot>;
    fn manual_capture(&mut self) -> RecorderResult<RecordingStateSnapshot>;
    fn undo_last(&mut self) -> RecorderResult<()>;
    fn stop(&mut self) -> RecorderResult<RecordingStateSnapshot>;
    fn state(&self) -> RecordingStateSnapshot;
}

#[derive(Clone)]
pub struct RecorderManager {
    backend: Arc<Mutex<Box<dyn CaptureBackend>>>,
}

impl RecorderManager {
    pub fn new() -> Self {
        #[cfg(windows)]
        let backend: Box<dyn CaptureBackend> = Box::new(windows::WindowsCaptureBackend::new());
        #[cfg(not(windows))]
        let backend: Box<dyn CaptureBackend> = Box::new(UnsupportedBackend::default());
        Self {
            backend: Arc::new(Mutex::new(backend)),
        }
    }

    pub fn list_targets(
        &self,
        kind: CaptureTargetKind,
    ) -> RecorderResult<Vec<CaptureTargetDescriptor>> {
        self.backend.lock().list_targets(kind)
    }

    pub fn select_target(
        &self,
        kind: CaptureTargetKind,
        target_id: Option<String>,
    ) -> RecorderResult<CaptureTargetDescriptor> {
        self.backend.lock().select_target(kind, target_id)
    }

    pub fn target_thumbnail(&self, target_id: &str) -> RecorderResult<Vec<u8>> {
        #[cfg(windows)]
        {
            windows::capture_monitor_thumbnail(target_id)
        }
        #[cfg(not(windows))]
        {
            let _ = target_id;
            Err(RecorderError::Unsupported)
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        storage: StorageService,
        project_id: String,
        options: RecordingOptions,
        region: Option<PixelRect>,
    ) -> RecorderResult<RecordingStateSnapshot> {
        self.backend
            .lock()
            .start(app, storage, project_id, options, region)
    }

    pub fn pause(&self) -> RecorderResult<RecordingStateSnapshot> {
        self.backend.lock().pause()
    }
    pub fn resume(&self) -> RecorderResult<RecordingStateSnapshot> {
        self.backend.lock().resume()
    }
    pub fn manual_capture(&self) -> RecorderResult<RecordingStateSnapshot> {
        self.backend.lock().manual_capture()
    }
    pub fn undo_last(&self) -> RecorderResult<()> {
        self.backend.lock().undo_last()
    }
    pub fn stop(&self) -> RecorderResult<RecordingStateSnapshot> {
        self.backend.lock().stop()
    }
    pub fn state(&self) -> RecordingStateSnapshot {
        self.backend.lock().state()
    }
}

impl Default for RecorderManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(windows))]
#[derive(Default)]
struct UnsupportedBackend;

#[cfg(not(windows))]
impl CaptureBackend for UnsupportedBackend {
    fn list_targets(&self, _: CaptureTargetKind) -> RecorderResult<Vec<CaptureTargetDescriptor>> {
        Err(RecorderError::Unsupported)
    }
    fn select_target(
        &mut self,
        _: CaptureTargetKind,
        _: Option<String>,
    ) -> RecorderResult<CaptureTargetDescriptor> {
        Err(RecorderError::Unsupported)
    }
    fn start(
        &mut self,
        _: AppHandle,
        _: StorageService,
        _: String,
        _: RecordingOptions,
        _: Option<PixelRect>,
    ) -> RecorderResult<RecordingStateSnapshot> {
        Err(RecorderError::Unsupported)
    }
    fn pause(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        Err(RecorderError::Unsupported)
    }
    fn resume(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        Err(RecorderError::Unsupported)
    }
    fn manual_capture(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        Err(RecorderError::Unsupported)
    }
    fn undo_last(&mut self) -> RecorderResult<()> {
        Err(RecorderError::Unsupported)
    }
    fn stop(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        Err(RecorderError::Unsupported)
    }
    fn state(&self) -> RecordingStateSnapshot {
        RecordingStateSnapshot::default()
    }
}
