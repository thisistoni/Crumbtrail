use super::{CaptureBackend, RecorderError, RecorderResult};
use crate::{
    export::render_annotated_png,
    models::{
        Annotation, AnnotationKind, CaptureTargetDescriptor, CaptureTargetKind, ClickPulse,
        ControlMetadata, MediaVariant, NormalizedRect, PixelRect, ProjectManifest,
        RecordingOptions, RecordingStateSnapshot, RecordingStatus, Step, StepKind, StepMedia,
    },
    storage::StorageService,
};
use image::{DynamicImage, ImageFormat, RgbaImage};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use uiautomation::{types::Point, UIAutomation};
use uuid::Uuid;
use windows::{
    Graphics::Capture::GraphicsCaptureItem,
    Win32::{
        Foundation::{LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI},
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_CONTROL, VK_LBUTTON, VK_MENU, VK_RBUTTON, VK_SHIFT,
            },
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetAncestor, GetCursorPos,
                GetWindowThreadProcessId, PeekMessageW, SetWindowsHookExW, TranslateMessage,
                UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
                MSLLHOOKSTRUCT, PM_REMOVE, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN,
                WM_RBUTTONDOWN, WM_SYSKEYDOWN,
            },
        },
    },
};
use windows_capture::{
    capture::GraphicsCaptureApiHandler,
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    graphics_capture_picker::GraphicsCapturePicker,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};
use windows_icons::{get_icon_by_process_id_with_size, IconSize};

#[derive(Clone)]
struct FrameSnapshot {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    sequence: u64,
}

#[derive(Default)]
struct CaptureShared {
    latest: Mutex<Option<FrameSnapshot>>,
    sequence: AtomicU64,
    stop: AtomicBool,
    closed: AtomicBool,
}

#[derive(Clone)]
struct CaptureFlags(Arc<CaptureShared>);

struct FrameHandler {
    shared: Arc<CaptureShared>,
    scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for FrameHandler {
    type Flags = CaptureFlags;
    type Error = String;

    fn new(ctx: windows_capture::capture::Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            shared: ctx.flags.0,
            scratch: Vec::new(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.shared.stop.load(Ordering::Relaxed) {
            capture_control.stop();
            return Ok(());
        }

        let width = frame.width();
        let height = frame.height();
        let buffer = frame.buffer().map_err(|error| error.to_string())?;
        let rgba = buffer.as_nopadding_buffer(&mut self.scratch).to_vec();
        let sequence = self.shared.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        *self.shared.latest.lock() = Some(FrameSnapshot {
            rgba,
            width,
            height,
            sequence,
        });
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.shared.closed.store(true, Ordering::Relaxed);
        Ok(())
    }
}

fn run_capture<T>(item: T, shared: Arc<CaptureShared>) -> Result<(), String>
where
    T: TryInto<GraphicsCaptureItemType>,
{
    let settings = Settings::new(
        item,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Include,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(50)),
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        CaptureFlags(shared),
    );
    FrameHandler::start(settings).map_err(|error| error.to_string())
}

pub(crate) fn capture_monitor_thumbnail(target_id: &str) -> RecorderResult<Vec<u8>> {
    let monitor = resolve_monitor(target_id).map_err(RecorderError::Platform)?;
    let shared = Arc::new(CaptureShared::default());
    let worker_shared = Arc::clone(&shared);
    let worker = thread::spawn(move || run_capture(monitor, worker_shared));
    let deadline = Instant::now() + Duration::from_secs(3);
    let frame = loop {
        if let Some(frame) = shared.latest.lock().clone() {
            break frame;
        }
        if shared.closed.load(Ordering::Relaxed) || Instant::now() >= deadline {
            shared.stop.store(true, Ordering::Relaxed);
            let _ = worker.join();
            return Err(RecorderError::Platform(
                "The display preview could not be captured.".to_string(),
            ));
        }
        thread::sleep(Duration::from_millis(25));
    };
    shared.stop.store(true, Ordering::Relaxed);
    let _ = worker.join();

    let image = RgbaImage::from_raw(frame.width, frame.height, frame.rgba)
        .ok_or_else(|| RecorderError::Platform("Invalid display preview frame.".to_string()))?;
    let thumbnail = DynamicImage::ImageRgba8(image).thumbnail(640, 360);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| RecorderError::Platform(error.to_string()))?;
    Ok(output.into_inner())
}

#[derive(Debug, Clone, Copy)]
enum InputEvent {
    Click {
        x: i32,
        y: i32,
        right: bool,
        at: Instant,
    },
    Typing,
    Manual,
    TogglePause,
    Stop,
}

static INPUT_SENDER: OnceLock<std::sync::Mutex<Option<Sender<InputEvent>>>> = OnceLock::new();
static MANUAL_SHORTCUT_KEY: AtomicU32 = AtomicU32::new(0x77);
static PAUSE_SHORTCUT_KEY: AtomicU32 = AtomicU32::new(0x78);
static STOP_SHORTCUT_KEY: AtomicU32 = AtomicU32::new(0x79);

fn input_sender() -> &'static std::sync::Mutex<Option<Sender<InputEvent>>> {
    INPUT_SENDER.get_or_init(|| std::sync::Mutex::new(None))
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32
        && (wparam.0 as u32 == WM_LBUTTONDOWN || wparam.0 as u32 == WM_RBUTTONDOWN)
    {
        // SAFETY: Windows guarantees lparam points to an MSLLHOOKSTRUCT for WH_MOUSE_LL callbacks.
        let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if let Ok(guard) = input_sender().try_lock() {
            if let Some(sender) = guard.as_ref() {
                let _ = sender.send(InputEvent::Click {
                    x: event.pt.x,
                    y: event.pt.y,
                    right: wparam.0 as u32 == WM_RBUTTONDOWN,
                    at: Instant::now(),
                });
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32
        && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN)
    {
        // SAFETY: Windows guarantees lparam points to a KBDLLHOOKSTRUCT for WH_KEYBOARD_LL callbacks.
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let ctrl = unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } < 0;
        let shift = unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } < 0;
        let alt = unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } < 0;
        let classified =
            if ctrl && shift && event.vkCode == MANUAL_SHORTCUT_KEY.load(Ordering::Relaxed) {
                Some(InputEvent::Manual)
            } else if ctrl && shift && event.vkCode == PAUSE_SHORTCUT_KEY.load(Ordering::Relaxed) {
                Some(InputEvent::TogglePause)
            } else if ctrl && shift && event.vkCode == STOP_SHORTCUT_KEY.load(Ordering::Relaxed) {
                Some(InputEvent::Stop)
            } else if !ctrl && !alt && is_typing_key(event.vkCode) {
                Some(InputEvent::Typing)
            } else {
                None
            };

        if let Some(classified) = classified {
            if let Ok(guard) = input_sender().try_lock() {
                if let Some(sender) = guard.as_ref() {
                    let _ = sender.send(classified);
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn is_typing_key(vk: u32) -> bool {
    matches!(vk, 0x08 | 0x20 | 0x2E | 0x30..=0x39 | 0x41..=0x5A | 0x60..=0x6F | 0xBA..=0xE2)
}

#[derive(Clone, Copy)]
enum NativeTarget {
    Window(isize),
    Monitor(isize),
}

pub struct WindowsCaptureBackend {
    state: Arc<Mutex<RecordingStateSnapshot>>,
    selected_source: Option<CaptureTargetDescriptor>,
    selected_native: Option<NativeTarget>,
    shared: Arc<CaptureShared>,
    paused: Arc<AtomicBool>,
    started_at: Option<Instant>,
    input_tx: Option<Sender<InputEvent>>,
    capture_thread: Option<JoinHandle<()>>,
    hook_thread: Option<JoinHandle<()>>,
    input_poll_thread: Option<JoinHandle<()>>,
    processor_thread: Option<JoinHandle<()>>,
}

impl WindowsCaptureBackend {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(RecordingStateSnapshot::default())),
            selected_source: None,
            selected_native: None,
            shared: Arc::new(CaptureShared::default()),
            paused: Arc::new(AtomicBool::new(false)),
            started_at: None,
            input_tx: None,
            capture_thread: None,
            hook_thread: None,
            input_poll_thread: None,
            processor_thread: None,
        }
    }

    fn snapshot(&self) -> RecordingStateSnapshot {
        let mut snapshot = self.state.lock().clone();
        if matches!(
            snapshot.status,
            RecordingStatus::Recording | RecordingStatus::Paused
        ) {
            snapshot.elapsed_ms = self
                .started_at
                .map_or(0, |started| started.elapsed().as_millis() as u64);
        }
        snapshot
    }
}

impl Default for WindowsCaptureBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureBackend for WindowsCaptureBackend {
    fn list_targets(
        &self,
        kind: CaptureTargetKind,
    ) -> RecorderResult<Vec<CaptureTargetDescriptor>> {
        if kind == CaptureTargetKind::Window {
            return Ok(Vec::new());
        }
        enumerate_monitor_targets(kind).map_err(RecorderError::Platform)
    }

    fn select_target(
        &mut self,
        kind: CaptureTargetKind,
        target_id: Option<String>,
    ) -> RecorderResult<CaptureTargetDescriptor> {
        if matches!(
            self.state.lock().status,
            RecordingStatus::Recording | RecordingStatus::Paused
        ) {
            return Err(RecorderError::AlreadyRecording);
        }
        self.shared.stop.store(true, Ordering::Relaxed);
        self.shared = Arc::new(CaptureShared::default());
        self.state.lock().status = RecordingStatus::Selecting;

        let shared = Arc::clone(&self.shared);
        let (result_tx, result_rx) = mpsc::sync_channel(1);
        self.capture_thread = Some(thread::spawn(move || {
            let result = (|| -> Result<_, String> {
                if kind != CaptureTargetKind::Window {
                    let target_id = target_id.ok_or_else(|| {
                        "Choose a display from the Crumbtrail display list.".to_string()
                    })?;
                    let monitor = resolve_monitor(&target_id)?;
                    let selected = describe_monitor(monitor, kind)?;
                    result_tx
                        .send(Ok(selected))
                        .map_err(|_| "Selection channel closed".to_string())?;
                    return run_capture(monitor, Arc::clone(&shared));
                }

                let picked = GraphicsCapturePicker::pick_item()
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| "Capture selection was cancelled".to_string())?;
                let selected = describe_item(&picked.item, kind)?;
                result_tx
                    .send(Ok(selected))
                    .map_err(|_| "Selection channel closed".to_string())?;
                run_capture(picked, Arc::clone(&shared))
            })();
            if let Err(error) = result {
                if !shared.stop.load(Ordering::Relaxed) {
                    shared.closed.store(true, Ordering::Relaxed);
                }
                let _ = result_tx.send(Err(error));
            }
        }));

        let (descriptor, native) = result_rx
            .recv()
            .map_err(|_| RecorderError::Platform("Capture picker stopped unexpectedly".into()))?
            .map_err(|error| {
                if error.contains("cancel") {
                    RecorderError::Cancelled
                } else {
                    RecorderError::Platform(error)
                }
            })?;
        self.selected_source = Some(descriptor.clone());
        self.selected_native = Some(native);
        *self.state.lock() = RecordingStateSnapshot {
            status: RecordingStatus::Idle,
            target: Some(descriptor.clone()),
            ..RecordingStateSnapshot::default()
        };
        Ok(descriptor)
    }

    fn start(
        &mut self,
        app: AppHandle,
        storage: StorageService,
        project_id: String,
        options: RecordingOptions,
        region: Option<PixelRect>,
    ) -> RecorderResult<RecordingStateSnapshot> {
        if matches!(
            self.state.lock().status,
            RecordingStatus::Recording | RecordingStatus::Paused
        ) {
            return Err(RecorderError::AlreadyRecording);
        }
        let source = self
            .selected_source
            .clone()
            .ok_or(RecorderError::NoTarget)?;
        let native = self.selected_native.ok_or(RecorderError::NoTarget)?;
        let target = effective_target(&source, region)?;
        let frame_deadline = Instant::now() + Duration::from_secs(2);
        while self.shared.latest.lock().is_none() && Instant::now() < frame_deadline {
            thread::sleep(Duration::from_millis(40));
        }
        if self.shared.latest.lock().is_none() {
            return Err(RecorderError::Platform(
                "The selected target has not produced a frame yet. Try again in a moment.".into(),
            ));
        }

        let step_count = storage
            .load_session(&project_id)
            .map_err(|error| RecorderError::Platform(error.to_string()))?
            .steps
            .len();
        let snapshot = RecordingStateSnapshot {
            status: RecordingStatus::Recording,
            project_id: Some(project_id.clone()),
            target: Some(target.clone()),
            step_count,
            elapsed_ms: 0,
            message: None,
        };
        *self.state.lock() = snapshot.clone();
        self.paused.store(false, Ordering::Relaxed);
        self.started_at = Some(Instant::now());
        MANUAL_SHORTCUT_KEY.store(options.manual_shortcut_key, Ordering::Relaxed);
        PAUSE_SHORTCUT_KEY.store(options.pause_shortcut_key, Ordering::Relaxed);
        STOP_SHORTCUT_KEY.store(options.stop_shortcut_key, Ordering::Relaxed);

        let (input_tx, input_rx) = mpsc::channel();
        let poll_tx = input_tx.clone();
        *input_sender()
            .lock()
            .map_err(|_| RecorderError::Platform("Input hook lock failed".into()))? =
            Some(input_tx.clone());
        self.input_tx = Some(input_tx);

        let state = Arc::clone(&self.state);
        let paused = Arc::clone(&self.paused);
        let shared = Arc::clone(&self.shared);
        let source_for_worker = source.clone();
        let target_for_worker = target.clone();
        let poll_app = app.clone();
        let poll_options = options.clone();
        self.processor_thread = Some(thread::spawn(move || {
            process_events(
                input_rx,
                app,
                storage,
                project_id,
                options,
                source_for_worker,
                target_for_worker,
                native,
                shared,
                paused,
                state,
            );
        }));

        let poll_shared = Arc::clone(&self.shared);
        let poll_state = Arc::clone(&self.state);
        self.input_poll_thread = Some(thread::spawn(move || {
            poll_mouse_input(poll_tx, poll_shared, poll_app, poll_state, poll_options)
        }));
        self.hook_thread = Some(thread::spawn(install_hooks));
        Ok(snapshot)
    }

    fn pause(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        let mut state = self.state.lock();
        if state.status == RecordingStatus::Recording {
            self.paused.store(true, Ordering::Relaxed);
            state.status = RecordingStatus::Paused;
            state.message =
                Some("Recording is paused. Existing frames remain only in memory.".into());
        }
        drop(state);
        Ok(self.snapshot())
    }

    fn resume(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        let mut state = self.state.lock();
        if state.status == RecordingStatus::Paused {
            self.paused.store(false, Ordering::Relaxed);
            state.status = RecordingStatus::Recording;
            state.message = None;
        }
        drop(state);
        Ok(self.snapshot())
    }

    fn manual_capture(&mut self) -> RecorderResult<()> {
        self.input_tx
            .as_ref()
            .ok_or(RecorderError::NoTarget)?
            .send(InputEvent::Manual)
            .map_err(|_| RecorderError::Platform("Recording worker is unavailable".into()))
    }

    fn undo_last(&mut self, storage: &StorageService) -> RecorderResult<()> {
        let project_id = self
            .state
            .lock()
            .project_id
            .clone()
            .ok_or(RecorderError::NoTarget)?;
        let mut project = storage
            .load_session(&project_id)
            .map_err(|error| RecorderError::Platform(error.to_string()))?;
        project.steps.pop();
        project.updated_at = chrono::Utc::now().to_rfc3339();
        storage
            .autosave(&project)
            .map_err(|error| RecorderError::Platform(error.to_string()))?;
        self.state.lock().step_count = project.steps.len();
        Ok(())
    }

    fn stop(&mut self) -> RecorderResult<RecordingStateSnapshot> {
        let previous = self.snapshot();
        self.state.lock().status = RecordingStatus::Stopping;
        let _ = self
            .input_tx
            .as_ref()
            .map(|sender| sender.send(InputEvent::Stop));
        self.shared.stop.store(true, Ordering::Relaxed);
        self.paused.store(false, Ordering::Relaxed);
        self.input_tx = None;
        if let Ok(mut sender) = input_sender().lock() {
            *sender = None;
        }
        *self.state.lock() = RecordingStateSnapshot {
            status: RecordingStatus::Idle,
            step_count: previous.step_count,
            elapsed_ms: previous.elapsed_ms,
            ..RecordingStateSnapshot::default()
        };
        Ok(self.snapshot())
    }

    fn state(&self) -> RecordingStateSnapshot {
        self.snapshot()
    }
}

fn enumerate_monitor_targets(
    kind: CaptureTargetKind,
) -> Result<Vec<CaptureTargetDescriptor>, String> {
    Monitor::enumerate()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|monitor| describe_monitor(monitor, kind).map(|(descriptor, _)| descriptor))
        .collect()
}

fn resolve_monitor(target_id: &str) -> Result<Monitor, String> {
    let device_name = monitor_device_name_from_id(target_id)?;
    Monitor::enumerate()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|monitor| monitor.device_name().ok().as_deref() == Some(device_name))
        .ok_or_else(|| "The selected display is no longer connected.".to_string())
}

fn monitor_device_name_from_id(target_id: &str) -> Result<&str, String> {
    target_id
        .strip_prefix("monitor:")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The selected display ID is invalid.".to_string())
}

fn describe_monitor(
    monitor: Monitor,
    kind: CaptureTargetKind,
) -> Result<(CaptureTargetDescriptor, NativeTarget), String> {
    let device_name = monitor.device_name().map_err(|error| error.to_string())?;
    let display_number = monitor.index().ok();
    let friendly_name = monitor.name().unwrap_or_default();
    let label = match (display_number, friendly_name.trim()) {
        (Some(number), "") => format!("Display {number}"),
        (Some(number), name) => format!("Display {number} · {name}"),
        (None, "") => "Display".to_string(),
        (None, name) => name.to_string(),
    };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let native_monitor = windows::Win32::Graphics::Gdi::HMONITOR(monitor.as_raw_hmonitor());
    if !unsafe { GetMonitorInfoW(native_monitor, &mut info) }.as_bool() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut dpi_x = 96;
    let mut dpi_y = 96;
    let _ = unsafe { GetDpiForMonitor(native_monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    Ok((
        CaptureTargetDescriptor {
            id: format!("monitor:{device_name}"),
            kind,
            label,
            bounds: PixelRect {
                x: info.rcMonitor.left,
                y: info.rcMonitor.top,
                width: (info.rcMonitor.right - info.rcMonitor.left).max(1) as u32,
                height: (info.rcMonitor.bottom - info.rcMonitor.top).max(1) as u32,
            },
            scale_factor: if dpi_x == 0 { 1.0 } else { dpi_x as f64 / 96.0 },
        },
        NativeTarget::Monitor(monitor.as_raw_hmonitor() as isize),
    ))
}

fn describe_item(
    item: &GraphicsCaptureItem,
    requested: CaptureTargetKind,
) -> Result<(CaptureTargetDescriptor, NativeTarget), String> {
    let size = item.Size().map_err(|error| error.to_string())?;
    let display_name = item
        .DisplayName()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let width = size.Width.max(1) as u32;
    let height = size.Height.max(1) as u32;

    match requested {
        CaptureTargetKind::Window => {
            let candidates = Window::enumerate()
                .map_err(|error| error.to_string())?
                .into_iter()
                .filter(|window| {
                    window.width().is_ok_and(|value| value == size.Width)
                        && window.height().is_ok_and(|value| value == size.Height)
                        && (display_name.is_empty()
                            || window.title().is_ok_and(|title| title == display_name))
                })
                .collect::<Vec<_>>();
            let window = if candidates.len() == 1 {
                candidates[0]
            } else {
                return Err(if candidates.is_empty() {
                    "The selected item is not a capturable window. Choose a window in the Windows picker.".to_string()
                } else {
                    "Several windows have the same title and size, so the chosen one cannot be resolved safely.".to_string()
                });
            };
            let rect = window.rect().map_err(|error| error.to_string())?;
            let dpi =
                unsafe { GetDpiForWindow(windows::Win32::Foundation::HWND(window.as_raw_hwnd())) };
            Ok((
                CaptureTargetDescriptor {
                    id: Uuid::new_v4().to_string(),
                    kind: requested,
                    label: window
                        .title()
                        .ok()
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| "Application window".into()),
                    bounds: PixelRect {
                        x: rect.left,
                        y: rect.top,
                        width,
                        height,
                    },
                    scale_factor: if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 },
                },
                NativeTarget::Window(window.as_raw_hwnd() as isize),
            ))
        }
        CaptureTargetKind::Monitor | CaptureTargetKind::Region => {
            Err("Display targets must be selected from the Crumbtrail display list.".to_string())
        }
    }
}

fn effective_target(
    source: &CaptureTargetDescriptor,
    region: Option<PixelRect>,
) -> RecorderResult<CaptureTargetDescriptor> {
    if source.kind != CaptureTargetKind::Region {
        return Ok(source.clone());
    }
    let region = region.ok_or_else(|| {
        RecorderError::Platform("Select a rectangular region before recording".into())
    })?;
    let right = region
        .x
        .saturating_add(region.width as i32)
        .saturating_sub(1);
    let bottom = region
        .y
        .saturating_add(region.height as i32)
        .saturating_sub(1);
    if region.width < 64
        || region.height < 64
        || !source.bounds.contains(region.x, region.y)
        || !source.bounds.contains(right, bottom)
    {
        return Err(RecorderError::Platform(
            "The selected region must remain inside the chosen monitor".into(),
        ));
    }
    Ok(CaptureTargetDescriptor {
        bounds: region,
        label: format!("Region on {}", source.label),
        ..source.clone()
    })
}

fn install_hooks() {
    // The callbacks enqueue only classified events, keeping the global hook thread non-blocking.
    let module = unsafe { GetModuleHandleW(None) }.ok().map(Into::into);
    let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0) };
    let keyboard = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module, 0) };
    let (Ok(mouse), Ok(keyboard)) = (mouse, keyboard) else {
        return;
    };
    loop {
        if input_sender()
            .lock()
            .map_or(true, |sender| sender.is_none())
        {
            break;
        }
        let mut message = MSG::default();
        unsafe {
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        thread::sleep(Duration::from_millis(8));
    }
    unsafe {
        let _ = UnhookWindowsHookEx(mouse);
        let _ = UnhookWindowsHookEx(keyboard);
    }
}

fn poll_mouse_input(
    sender: Sender<InputEvent>,
    shared: Arc<CaptureShared>,
    app: AppHandle,
    state: Arc<Mutex<RecordingStateSnapshot>>,
    options: RecordingOptions,
) {
    let mut left_down = key_is_down(VK_LBUTTON.0 as i32);
    let mut right_down = key_is_down(VK_RBUTTON.0 as i32);
    while !shared.stop.load(Ordering::Relaxed) && !shared.closed.load(Ordering::Relaxed) {
        let next_left = key_is_down(VK_LBUTTON.0 as i32);
        let next_right = key_is_down(VK_RBUTTON.0 as i32);
        if (next_left && !left_down) || (next_right && !right_down) {
            let mut point = POINT::default();
            if unsafe { GetCursorPos(&mut point) }.is_ok() {
                let right = next_right && !right_down;
                let snapshot = state.lock().clone();
                if snapshot.status == RecordingStatus::Recording
                    && snapshot.target.as_ref().is_some_and(|target| {
                        should_capture_click(&target.bounds, point.x, point.y, right, &options)
                    })
                    && !point_belongs_to_crumbtrail(point.x, point.y)
                {
                    let _ = app.emit(
                        "recording://click-pulse",
                        ClickPulse {
                            x: point.x,
                            y: point.y,
                            right,
                        },
                    );
                }
                if sender
                    .send(InputEvent::Click {
                        x: point.x,
                        y: point.y,
                        right,
                        at: Instant::now(),
                    })
                    .is_err()
                {
                    break;
                }
            }
        }
        left_down = next_left;
        right_down = next_right;
        thread::sleep(Duration::from_millis(3));
    }
}

fn key_is_down(virtual_key: i32) -> bool {
    (unsafe { GetAsyncKeyState(virtual_key) }) < 0
}

#[allow(clippy::too_many_arguments)]
fn process_events(
    receiver: Receiver<InputEvent>,
    app: AppHandle,
    storage: StorageService,
    project_id: String,
    options: RecordingOptions,
    source: CaptureTargetDescriptor,
    target: CaptureTargetDescriptor,
    native: NativeTarget,
    shared: Arc<CaptureShared>,
    paused: Arc<AtomicBool>,
    state: Arc<Mutex<RecordingStateSnapshot>>,
) {
    let mut typing: Option<TypingGroup> = None;
    let mut last_click: Option<(Instant, i32, i32, bool)> = None;
    let mut application_processes = HashMap::<String, (String, u32)>::new();
    loop {
        if state.lock().status == RecordingStatus::Paused {
            paused.store(true, Ordering::Relaxed);
        }
        let source = refresh_source(&source, native);
        let target = if target.kind == CaptureTargetKind::Region {
            target.clone()
        } else {
            CaptureTargetDescriptor {
                bounds: source.bounds,
                scale_factor: source.scale_factor,
                ..target.clone()
            }
        };
        state.lock().target = Some(target.clone());
        if shared.closed.load(Ordering::Relaxed) {
            recoverable_error(
                &app,
                &state,
                "The selected target closed. Your completed steps are safe.",
            );
            break;
        }

        let wait = typing.as_ref().map_or(Duration::from_millis(250), |group| {
            Duration::from_millis(options.typing_idle_ms).saturating_sub(group.last_event.elapsed())
        });
        match receiver.recv_timeout(wait) {
            Ok(InputEvent::Stop) => {
                finalize_typing(
                    &mut typing,
                    &app,
                    &storage,
                    &project_id,
                    &options,
                    &source,
                    &target,
                    &shared,
                    &state,
                );
                schedule_application_icon_enrichment(
                    app.clone(),
                    storage.clone(),
                    project_id.clone(),
                    application_processes.clone(),
                );
                shared.stop.store(true, Ordering::Relaxed);
                if let Ok(mut sender) = input_sender().lock() {
                    *sender = None;
                }
                {
                    let mut snapshot = state.lock();
                    snapshot.status = RecordingStatus::Idle;
                    snapshot.target = None;
                    snapshot.message = None;
                }
                emit_state(&app, &state);
                let _ = app.emit("recording://stopped", ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                break;
            }
            Ok(InputEvent::TogglePause) => {
                let now_paused = !paused.fetch_xor(true, Ordering::Relaxed);
                state.lock().status = if now_paused {
                    RecordingStatus::Paused
                } else {
                    RecordingStatus::Recording
                };
                emit_state(&app, &state);
            }
            Ok(_) if paused.load(Ordering::Relaxed) => {}
            Ok(InputEvent::Manual) => {
                finalize_typing(
                    &mut typing,
                    &app,
                    &storage,
                    &project_id,
                    &options,
                    &source,
                    &target,
                    &shared,
                    &state,
                );
                let Some(frame) = latest_frame(&shared) else {
                    recoverable_error(&app, &state, "No capture frame is available.");
                    continue;
                };
                let mut step = Step::manual(String::new());
                step.instruction = if options.instruction_locale == "de" {
                    "Beschreibe diesen Schritt".into()
                } else {
                    "Describe this step".into()
                };
                let application = foreground_application();
                remember_application(&application, &mut application_processes);
                step.application = application.name;
                step.application_icon_asset = None;
                match persist_frame(&storage, &project_id, &source, &target, &frame, None) {
                    Ok(asset) => {
                        step.media.before_asset = Some(asset);
                        append_step(&app, &storage, &project_id, step, &state);
                    }
                    Err(error) => recoverable_error(
                        &app,
                        &state,
                        &format!("The screenshot could not be saved: {error}"),
                    ),
                }
            }
            Ok(InputEvent::Click { x, y, right, at }) => {
                if last_click.as_ref().is_some_and(
                    |(previous_at, previous_x, previous_y, previous_right)| {
                        instant_distance(at, *previous_at) < Duration::from_millis(40)
                            && previous_x.abs_diff(x) <= 2
                            && previous_y.abs_diff(y) <= 2
                            && *previous_right == right
                    },
                ) {
                    continue;
                }
                last_click = Some((at, x, y, right));
                finalize_typing(
                    &mut typing,
                    &app,
                    &storage,
                    &project_id,
                    &options,
                    &source,
                    &target,
                    &shared,
                    &state,
                );
                if !should_capture_click(&target.bounds, x, y, right, &options) {
                    continue;
                }
                if point_belongs_to_crumbtrail(x, y) {
                    continue;
                }
                let Some(before) = latest_frame(&shared) else {
                    continue;
                };
                let application = foreground_application();
                remember_application(&application, &mut application_processes);
                let control = inspect_point_with_timeout(x, y, target.bounds);
                let after = stable_after(&shared, &before, &options);
                let redaction = control
                    .as_ref()
                    .filter(|metadata| metadata.is_password && options.redact_passwords)
                    .and_then(|metadata| metadata.bounds)
                    .map(blur_annotation);
                let before_result = persist_frame(
                    &storage,
                    &project_id,
                    &source,
                    &target,
                    &before,
                    redaction.as_ref(),
                );
                let after_result = persist_frame(
                    &storage,
                    &project_id,
                    &source,
                    &target,
                    &after,
                    redaction.as_ref(),
                );
                let before_asset = before_result.as_ref().ok().cloned();
                let after_asset = after_result.as_ref().ok().cloned();
                if before_asset.is_none() && after_asset.is_none() {
                    let error = before_result
                        .err()
                        .or_else(|| after_result.err())
                        .unwrap_or_else(|| "unknown image error".into());
                    recoverable_error(
                        &app,
                        &state,
                        &format!("The screenshot could not be saved: {error}"),
                    );
                    continue;
                }
                let mut annotations = Vec::new();
                if let Some(bounds) = control.as_ref().and_then(|value| value.bounds) {
                    annotations.push(element_outline(bounds, options.default_stroke_width));
                } else {
                    annotations.push(fallback_click_outline(
                        target.bounds.normalize(PixelRect {
                            x: x - 24,
                            y: y - 18,
                            width: 48,
                            height: 36,
                        }),
                        options.default_stroke_width,
                    ));
                }
                let instruction =
                    click_caption(control.as_ref(), right, &options.instruction_locale);
                let focus_zoom = options
                    .default_focus_zoom
                    .then(|| {
                        annotations.first().map(|annotation| {
                            focus_rect(annotation.rect, options.default_focus_zoom_percent)
                        })
                    })
                    .flatten();
                append_step(
                    &app,
                    &storage,
                    &project_id,
                    Step {
                        id: Uuid::new_v4().to_string(),
                        kind: StepKind::Click,
                        instruction,
                        notes: String::new(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        included: true,
                        application: application.name,
                        application_icon_asset: None,
                        control,
                        media: StepMedia {
                            before_asset,
                            after_asset,
                            selected: MediaVariant::Before,
                        },
                        annotations,
                        focus_zoom,
                    },
                    &state,
                );
            }
            Ok(InputEvent::Typing) if options.capture_typing_groups => {
                let focused = inspect_focused_with_timeout(target.bounds);
                if focused.is_none() && !foreground_belongs_to_target(native, &target) {
                    continue;
                }
                let focus_key = focused
                    .as_ref()
                    .map(|value| format!("{}:{}", value.automation_id, value.name))
                    .unwrap_or_default();
                if typing
                    .as_ref()
                    .is_some_and(|group| group.focus_key != focus_key)
                {
                    finalize_typing(
                        &mut typing,
                        &app,
                        &storage,
                        &project_id,
                        &options,
                        &source,
                        &target,
                        &shared,
                        &state,
                    );
                }
                if typing.is_none() {
                    if let Some(before) = latest_frame(&shared) {
                        let application = foreground_application();
                        remember_application(&application, &mut application_processes);
                        typing = Some(TypingGroup {
                            before,
                            control: focused,
                            focus_key,
                            last_event: Instant::now(),
                            application,
                        });
                    }
                } else if let Some(group) = typing.as_mut() {
                    group.last_event = Instant::now();
                }
            }
            Ok(InputEvent::Typing) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if typing.as_ref().is_some_and(|group| {
                    group.last_event.elapsed() >= Duration::from_millis(options.typing_idle_ms)
                }) {
                    finalize_typing(
                        &mut typing,
                        &app,
                        &storage,
                        &project_id,
                        &options,
                        &source,
                        &target,
                        &shared,
                        &state,
                    );
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn instant_distance(left: Instant, right: Instant) -> Duration {
    if left >= right {
        left.duration_since(right)
    } else {
        right.duration_since(left)
    }
}

fn refresh_source(
    source: &CaptureTargetDescriptor,
    native: NativeTarget,
) -> CaptureTargetDescriptor {
    match native {
        NativeTarget::Window(raw) => {
            let window = Window::from_raw_hwnd(raw as *mut std::ffi::c_void);
            let Ok(rect) = window.rect() else {
                return source.clone();
            };
            let width = (rect.right - rect.left).max(1) as u32;
            let height = (rect.bottom - rect.top).max(1) as u32;
            let dpi =
                unsafe { GetDpiForWindow(windows::Win32::Foundation::HWND(window.as_raw_hwnd())) };
            CaptureTargetDescriptor {
                bounds: PixelRect {
                    x: rect.left,
                    y: rect.top,
                    width,
                    height,
                },
                scale_factor: if dpi == 0 {
                    source.scale_factor
                } else {
                    dpi as f64 / 96.0
                },
                ..source.clone()
            }
        }
        NativeTarget::Monitor(raw) => {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let monitor = windows::Win32::Graphics::Gdi::HMONITOR(raw as *mut std::ffi::c_void);
            if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
                return source.clone();
            }
            CaptureTargetDescriptor {
                bounds: PixelRect {
                    x: info.rcMonitor.left,
                    y: info.rcMonitor.top,
                    width: (info.rcMonitor.right - info.rcMonitor.left).max(1) as u32,
                    height: (info.rcMonitor.bottom - info.rcMonitor.top).max(1) as u32,
                },
                ..source.clone()
            }
        }
    }
}

struct TypingGroup {
    before: FrameSnapshot,
    control: Option<ControlMetadata>,
    focus_key: String,
    last_event: Instant,
    application: ForegroundApplication,
}

#[allow(clippy::too_many_arguments)]
fn finalize_typing(
    group: &mut Option<TypingGroup>,
    app: &AppHandle,
    storage: &StorageService,
    project_id: &str,
    options: &RecordingOptions,
    source: &CaptureTargetDescriptor,
    target: &CaptureTargetDescriptor,
    shared: &CaptureShared,
    state: &Arc<Mutex<RecordingStateSnapshot>>,
) {
    let Some(group) = group.take() else { return };
    let after = stable_after(shared, &group.before, options);
    let redaction = group
        .control
        .as_ref()
        .filter(|metadata| metadata.is_password && options.redact_passwords)
        .and_then(|metadata| metadata.bounds)
        .map(blur_annotation);
    let before_result = persist_frame(
        storage,
        project_id,
        source,
        target,
        &group.before,
        redaction.as_ref(),
    );
    let after_result = persist_frame(
        storage,
        project_id,
        source,
        target,
        &after,
        redaction.as_ref(),
    );
    let before_asset = before_result.as_ref().ok().cloned();
    let after_asset = after_result.as_ref().ok().cloned();
    if before_asset.is_none() && after_asset.is_none() {
        let error = before_result
            .err()
            .or_else(|| after_result.err())
            .unwrap_or_else(|| "unknown image error".into());
        recoverable_error(
            app,
            state,
            &format!("The screenshot could not be saved: {error}"),
        );
        return;
    }
    let instruction = typing_caption(group.control.as_ref(), &options.instruction_locale);
    let annotations = group
        .control
        .as_ref()
        .and_then(|control| control.bounds)
        .map(|rect| element_outline(rect, options.default_stroke_width))
        .into_iter()
        .collect::<Vec<_>>();
    let focus_zoom = options
        .default_focus_zoom
        .then(|| {
            annotations
                .first()
                .map(|annotation| focus_rect(annotation.rect, options.default_focus_zoom_percent))
        })
        .flatten();
    append_step(
        app,
        storage,
        project_id,
        Step {
            id: Uuid::new_v4().to_string(),
            kind: StepKind::TextEntry,
            instruction,
            notes: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            included: true,
            application: group.application.name,
            application_icon_asset: None,
            control: group.control,
            media: StepMedia {
                before_asset,
                after_asset,
                selected: MediaVariant::After,
            },
            annotations,
            focus_zoom,
        },
        state,
    );
}

struct ForegroundApplication {
    name: Option<String>,
    process_id: u32,
}

fn foreground_application() -> ForegroundApplication {
    let Ok(window) = Window::foreground() else {
        return ForegroundApplication {
            name: None,
            process_id: 0,
        };
    };
    let name = window.process_name().ok();
    let mut process_id = 0;
    unsafe {
        GetWindowThreadProcessId(
            windows::Win32::Foundation::HWND(window.as_raw_hwnd()),
            Some(&mut process_id),
        )
    };
    ForegroundApplication { name, process_id }
}

fn remember_application(
    application: &ForegroundApplication,
    processes: &mut HashMap<String, (String, u32)>,
) {
    let Some(name) = application.name.as_deref().filter(|name| !name.is_empty()) else {
        return;
    };
    if application.process_id == 0 {
        return;
    }
    processes
        .entry(name.to_lowercase())
        .or_insert_with(|| (name.to_string(), application.process_id));
}

fn schedule_application_icon_enrichment(
    app: AppHandle,
    storage: StorageService,
    project_id: String,
    processes: HashMap<String, (String, u32)>,
) {
    if processes.is_empty() {
        return;
    }
    thread::spawn(move || {
        let mut icons = HashMap::<String, String>::new();
        for (key, (_, process_id)) in processes {
            if let Some(asset) = persist_application_icon(&storage, &project_id, process_id) {
                icons.insert(key, asset);
            }
        }
        if icons.is_empty() {
            return;
        }
        let Ok(mut project) = storage.load_session(&project_id) else {
            return;
        };
        if !attach_application_icons(&mut project, &icons) {
            return;
        }
        project.updated_at = chrono::Utc::now().to_rfc3339();
        if storage.autosave(&project).is_ok() {
            let _ = app.emit("recording://project-updated", &project);
        }
    });
}

fn attach_application_icons(
    project: &mut ProjectManifest,
    icons: &HashMap<String, String>,
) -> bool {
    let mut changed = false;
    for step in &mut project.steps {
        let Some(asset) = step
            .application
            .as_deref()
            .and_then(|name| icons.get(&name.to_lowercase()))
        else {
            continue;
        };
        if step.application_icon_asset.as_ref() != Some(asset) {
            step.application_icon_asset = Some(asset.clone());
            changed = true;
        }
    }
    changed
}

fn persist_application_icon(
    storage: &StorageService,
    project_id: &str,
    process_id: u32,
) -> Option<String> {
    let icon = get_icon_by_process_id_with_size(process_id, IconSize::Large).ok()?;
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(icon)
        .write_to(&mut encoded, ImageFormat::Png)
        .ok()?;
    storage
        .write_asset(
            project_id,
            &format!("application-{process_id}.png"),
            encoded.get_ref(),
        )
        .ok()
}

fn inspect_point(x: i32, y: i32, target: &PixelRect) -> Option<ControlMetadata> {
    let automation = UIAutomation::new().ok()?;
    metadata_from_element(
        automation.element_from_point(Point::new(x, y)).ok()?,
        target,
    )
}

fn inspect_point_with_timeout(x: i32, y: i32, target: PixelRect) -> Option<ControlMetadata> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(inspect_point(x, y, &target));
    });
    receiver
        .recv_timeout(Duration::from_millis(350))
        .ok()
        .flatten()
}

fn inspect_focused(target: &PixelRect) -> Option<ControlMetadata> {
    let automation = UIAutomation::new().ok()?;
    let metadata = metadata_from_element(automation.get_focused_element().ok()?, target)?;
    metadata.bounds?;
    Some(metadata)
}

fn inspect_focused_with_timeout(target: PixelRect) -> Option<ControlMetadata> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(inspect_focused(&target));
    });
    receiver
        .recv_timeout(Duration::from_millis(350))
        .ok()
        .flatten()
}

fn point_belongs_to_crumbtrail(x: i32, y: i32) -> bool {
    let window = unsafe { WindowFromPoint(POINT { x, y }) };
    if window.is_invalid() {
        return false;
    }
    let root = unsafe { GetAncestor(window, GA_ROOT) };
    let process_window = if root.is_invalid() { window } else { root };
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(process_window, Some(&mut process_id)) };
    process_id == std::process::id()
}

fn foreground_belongs_to_target(native: NativeTarget, target: &CaptureTargetDescriptor) -> bool {
    let Ok(window) = Window::foreground() else {
        return false;
    };
    match native {
        NativeTarget::Window(raw) => return window.as_raw_hwnd() as isize == raw,
        NativeTarget::Monitor(expected) if target.kind == CaptureTargetKind::Monitor => {
            let actual = unsafe {
                MonitorFromWindow(
                    windows::Win32::Foundation::HWND(window.as_raw_hwnd()),
                    MONITOR_DEFAULTTONULL,
                )
            };
            if actual.0 as isize == expected {
                return true;
            }
        }
        NativeTarget::Monitor(_) => {}
    }
    let Ok(rect) = window.rect() else {
        return false;
    };
    let center_x = rect.left + (rect.right - rect.left) / 2;
    let center_y = rect.top + (rect.bottom - rect.top) / 2;
    target.bounds.contains(center_x, center_y)
}

fn metadata_from_element(
    element: uiautomation::UIElement,
    target: &PixelRect,
) -> Option<ControlMetadata> {
    let rect = element.get_bounding_rectangle().ok();
    let pixel_rect = rect.map(|rect| PixelRect {
        x: rect.get_left(),
        y: rect.get_top(),
        width: rect.get_width().max(0) as u32,
        height: rect.get_height().max(0) as u32,
    });
    if pixel_rect.is_some_and(|rect| {
        !target.contains(
            rect.x + (rect.width / 2) as i32,
            rect.y + (rect.height / 2) as i32,
        )
    }) {
        return None;
    }
    Some(ControlMetadata {
        name: element.get_name().unwrap_or_default(),
        control_type: element
            .get_control_type()
            .map(|value| format!("{value:?}"))
            .unwrap_or_else(|_| "Control".into()),
        automation_id: element.get_automation_id().unwrap_or_default(),
        is_password: element.is_password().unwrap_or(false),
        bounds: pixel_rect.map(|rect| target.normalize(rect)),
    })
}

fn click_caption(control: Option<&ControlMetadata>, right: bool, locale: &str) -> String {
    let Some(control) = control else {
        return if locale == "de" {
            if right {
                "Klicke mit der rechten Maustaste auf den markierten Bereich".into()
            } else {
                "Klicke auf den markierten Bereich".into()
            }
        } else if right {
            "Right-click the highlighted area".into()
        } else {
            "Click the highlighted area".into()
        };
    };
    let selectable = matches!(
        control.control_type.as_str(),
        "CheckBox" | "ComboBox" | "ListItem" | "MenuItem" | "RadioButton" | "TabItem"
    );
    let action = if locale == "de" {
        if right {
            "Klicke mit der rechten Maustaste auf"
        } else if selectable {
            "Wähle"
        } else {
            "Klicke auf"
        }
    } else if right {
        "Right-click"
    } else if selectable {
        "Select"
    } else {
        "Click"
    };
    if control.name.trim().is_empty() {
        if locale == "de" {
            format!("{action} das markierte Element")
        } else {
            format!("{action} the highlighted control")
        }
    } else {
        format!("{action} {}", control.name.trim())
    }
}

fn typing_caption(control: Option<&ControlMetadata>, locale: &str) -> String {
    if locale == "de" {
        control.filter(|value| !value.name.is_empty()).map_or_else(
            || "Gib Text ein".into(),
            |value| format!("Gib Text in {} ein", value.name),
        )
    } else {
        control.filter(|value| !value.name.is_empty()).map_or_else(
            || "Enter text".into(),
            |value| format!("Enter text in {}", value.name),
        )
    }
}

fn should_capture_click(
    bounds: &PixelRect,
    x: i32,
    y: i32,
    right: bool,
    options: &RecordingOptions,
) -> bool {
    bounds.contains(x, y)
        && if right {
            options.capture_right_clicks
        } else {
            options.capture_left_clicks
        }
}

fn latest_frame(shared: &CaptureShared) -> Option<FrameSnapshot> {
    shared.latest.lock().clone()
}

fn stable_after(
    shared: &CaptureShared,
    before: &FrameSnapshot,
    options: &RecordingOptions,
) -> FrameSnapshot {
    thread::sleep(Duration::from_millis(options.stabilization_delay_ms));
    let started = Instant::now();
    let mut prior = latest_frame(shared).unwrap_or_else(|| before.clone());
    let mut stable_samples = 0;
    while started.elapsed() < Duration::from_millis(options.stabilization_timeout_ms) {
        thread::sleep(Duration::from_millis(
            options.stabilization_interval_ms.max(20),
        ));
        let current = latest_frame(shared).unwrap_or_else(|| prior.clone());
        if current.sequence == prior.sequence || visual_difference(&prior, &current) < 0.006 {
            stable_samples += 1;
            if stable_samples >= 2 {
                return current;
            }
        } else {
            stable_samples = 0;
        }
        prior = current;
    }
    prior
}

fn visual_difference(a: &FrameSnapshot, b: &FrameSnapshot) -> f64 {
    if a.width != b.width
        || a.height != b.height
        || a.rgba.len() != b.rgba.len()
        || a.rgba.is_empty()
    {
        return 1.0;
    }
    let stride = ((a.rgba.len() / 4096).max(4) / 4) * 4;
    let mut sum = 0_u64;
    let mut samples = 0_u64;
    for index in (0..a.rgba.len()).step_by(stride.max(4)) {
        sum += a.rgba[index].abs_diff(b.rgba[index]) as u64;
        samples += 1;
    }
    sum as f64 / (samples.max(1) * 255) as f64
}

fn persist_frame(
    storage: &StorageService,
    project_id: &str,
    source: &CaptureTargetDescriptor,
    target: &CaptureTargetDescriptor,
    frame: &FrameSnapshot,
    redaction: Option<&Annotation>,
) -> Result<String, String> {
    let image = RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone())
        .ok_or_else(|| "Invalid frame buffer".to_string())?;
    let x = target.bounds.x.saturating_sub(source.bounds.x).max(0) as u32;
    let y = target.bounds.y.saturating_sub(source.bounds.y).max(0) as u32;
    let width = target.bounds.width.min(frame.width.saturating_sub(x));
    let height = target.bounds.height.min(frame.height.saturating_sub(y));
    let cropped = DynamicImage::ImageRgba8(image).crop_imm(x, y, width, height);
    let mut cursor = Cursor::new(Vec::new());
    cropped
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let bytes = if let Some(redaction) = redaction {
        render_annotated_png(cursor.get_ref(), std::slice::from_ref(redaction))
            .map_err(|error| error.to_string())?
    } else {
        cursor.into_inner()
    };
    storage
        .write_asset(project_id, &format!("step-{}.png", Uuid::new_v4()), &bytes)
        .map_err(|error| error.to_string())
}

fn blur_annotation(rect: NormalizedRect) -> Annotation {
    Annotation {
        id: Uuid::new_v4().to_string(),
        kind: AnnotationKind::Blur,
        rect,
        color: "#000000".into(),
        label: None,
        stroke_width: 0.0,
        rotation: 0.0,
        opacity: 1.0,
        z_index: -1,
        marker_size: 22.0,
        protected: true,
    }
}

fn element_outline(rect: NormalizedRect, stroke_width: f64) -> Annotation {
    Annotation {
        id: Uuid::new_v4().to_string(),
        kind: AnnotationKind::ElementOutline,
        rect,
        color: "#EF4444".into(),
        label: None,
        stroke_width: stroke_width.clamp(1.0, 12.0),
        rotation: 0.0,
        opacity: 1.0,
        z_index: 0,
        marker_size: 18.0,
        protected: false,
    }
}

fn fallback_click_outline(rect: NormalizedRect, stroke_width: f64) -> Annotation {
    Annotation {
        kind: AnnotationKind::Rectangle,
        ..element_outline(rect, stroke_width)
    }
}

fn focus_rect(rect: NormalizedRect, zoom_percent: u32) -> NormalizedRect {
    let fraction = 100.0 / f64::from(zoom_percent.clamp(100, 400));
    let width = fraction.max(rect.width + 0.08).min(1.0);
    let height = fraction.max(rect.height + 0.08).min(1.0);
    let center_x = rect.x + rect.width / 2.0;
    let center_y = rect.y + rect.height / 2.0;
    NormalizedRect {
        x: (center_x - width / 2.0).clamp(0.0, 1.0 - width),
        y: (center_y - height / 2.0).clamp(0.0, 1.0 - height),
        width,
        height,
    }
}

fn append_step(
    app: &AppHandle,
    storage: &StorageService,
    project_id: &str,
    step: Step,
    state: &Arc<Mutex<RecordingStateSnapshot>>,
) {
    let result = persist_step(storage, project_id, step, state);
    match result {
        Ok((step, project)) => {
            let _ = app.emit("recording://step-created", &step);
            let _ = app.emit("recording://project-updated", &project);
            emit_state(app, state);
        }
        Err(error) => recoverable_error(app, state, &format!("A step could not be saved: {error}")),
    }
}

fn persist_step(
    storage: &StorageService,
    project_id: &str,
    step: Step,
    state: &Arc<Mutex<RecordingStateSnapshot>>,
) -> Result<(Step, ProjectManifest), String> {
    let mut project = storage
        .load_session(project_id)
        .map_err(|error| error.to_string())?;
    maybe_name_project_from_step(&mut project, &step);
    project.steps.push(step.clone());
    project.updated_at = chrono::Utc::now().to_rfc3339();
    storage
        .autosave(&project)
        .map_err(|error| error.to_string())?;
    state.lock().step_count = project.steps.len();
    Ok((step, project))
}

fn maybe_name_project_from_step(project: &mut ProjectManifest, step: &Step) {
    if !is_placeholder_title(&project.title) {
        return;
    }
    let Some(application) = step
        .application
        .as_deref()
        .and_then(application_display_name)
    else {
        return;
    };
    project.title = if project.theme.report_locale.eq_ignore_ascii_case("de") {
        format!("{application} Anleitung")
    } else {
        format!("{application} Guide")
    };
}

fn is_placeholder_title(title: &str) -> bool {
    matches!(
        title.trim().to_ascii_lowercase().as_str(),
        "" | "untitled guide" | "unnamed guide" | "neue anleitung" | "unbenannte anleitung"
    )
}

fn application_display_name(value: &str) -> Option<String> {
    let value = value
        .trim()
        .strip_suffix(".exe")
        .or_else(|| value.trim().strip_suffix(".EXE"))
        .unwrap_or(value.trim())
        .replace(['-', '_'], " ");
    if value.is_empty() || value.eq_ignore_ascii_case("crumbtrail") {
        return None;
    }
    let mut chars = value.chars();
    let first = chars.next()?;
    Some(first.to_uppercase().collect::<String>() + chars.as_str())
}

fn emit_state(app: &AppHandle, state: &Arc<Mutex<RecordingStateSnapshot>>) {
    let _ = app.emit("recording://state", state.lock().clone());
}

fn recoverable_error(app: &AppHandle, state: &Arc<Mutex<RecordingStateSnapshot>>, message: &str) {
    {
        let mut snapshot = state.lock();
        snapshot.status = RecordingStatus::Paused;
        snapshot.message = Some(message.into());
    }
    let _ = app.emit("recording://recoverable-error", message);
    emit_state(app, state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_must_be_inside_source_with_negative_coordinates() {
        let source = CaptureTargetDescriptor {
            id: "monitor:2".into(),
            kind: CaptureTargetKind::Region,
            label: "Display 2".into(),
            bounds: PixelRect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
            scale_factor: 1.5,
        };
        assert!(effective_target(
            &source,
            Some(PixelRect {
                x: -1800,
                y: 100,
                width: 800,
                height: 600
            })
        )
        .is_ok());
        assert!(effective_target(
            &source,
            Some(PixelRect {
                x: -100,
                y: 100,
                width: 800,
                height: 600
            })
        )
        .is_err());
    }

    #[test]
    fn captions_are_deterministic() {
        let control = ControlMetadata {
            name: "Dark mode".into(),
            control_type: "RadioButton".into(),
            automation_id: String::new(),
            is_password: false,
            bounds: None,
        };
        assert_eq!(
            click_caption(Some(&control), false, "en"),
            "Select Dark mode"
        );
        assert_eq!(
            click_caption(None, true, "en"),
            "Right-click the highlighted area"
        );
        assert_eq!(
            typing_caption(Some(&control), "en"),
            "Enter text in Dark mode"
        );
        assert_eq!(typing_caption(None, "en"), "Enter text");
        assert_eq!(
            click_caption(Some(&control), false, "de"),
            "Wähle Dark mode"
        );
        assert_eq!(
            typing_caption(Some(&control), "de"),
            "Gib Text in Dark mode ein"
        );
    }

    #[test]
    fn click_filter_excludes_outside_and_disabled_categories() {
        let target = CaptureTargetDescriptor {
            id: "region:test".into(),
            kind: CaptureTargetKind::Region,
            label: "Region".into(),
            bounds: PixelRect {
                x: -1200,
                y: 40,
                width: 800,
                height: 600,
            },
            scale_factor: 1.0,
        };
        let mut options = RecordingOptions::default();
        assert!(should_capture_click(
            &target.bounds,
            -800,
            300,
            false,
            &options
        ));
        assert!(!should_capture_click(
            &target.bounds,
            20,
            300,
            false,
            &options
        ));
        options.capture_right_clicks = false;
        assert!(!should_capture_click(
            &target.bounds,
            -800,
            300,
            true,
            &options
        ));
        options.capture_left_clicks = false;
        assert!(!should_capture_click(
            &target.bounds,
            -800,
            300,
            false,
            &options
        ));
    }

    #[test]
    fn password_redaction_is_a_normalized_blur() {
        let rect = NormalizedRect {
            x: 0.2,
            y: 0.3,
            width: 0.4,
            height: 0.1,
        };
        let annotation = blur_annotation(rect);
        assert_eq!(annotation.kind, AnnotationKind::Blur);
        assert_eq!(annotation.rect, rect);
        assert!(annotation.label.is_none());
    }

    #[test]
    fn automatic_click_highlights_never_use_a_circle() {
        let rect = NormalizedRect {
            x: 0.2,
            y: 0.3,
            width: 0.04,
            height: 0.05,
        };
        assert_eq!(
            element_outline(rect, 3.0).kind,
            AnnotationKind::ElementOutline
        );
        assert_eq!(
            fallback_click_outline(rect, 3.0).kind,
            AnnotationKind::Rectangle
        );
    }

    #[test]
    fn focus_zoom_uses_the_configured_percentage_and_preserves_its_size_at_edges() {
        let centered = NormalizedRect {
            x: 0.45,
            y: 0.45,
            width: 0.1,
            height: 0.1,
        };
        assert_eq!(
            focus_rect(centered, 200),
            NormalizedRect {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            }
        );
        assert_eq!(
            focus_rect(centered, 250),
            NormalizedRect {
                x: 0.3,
                y: 0.3,
                width: 0.4,
                height: 0.4,
            }
        );

        let edge = focus_rect(
            NormalizedRect {
                x: 0.0,
                y: 0.0,
                width: 0.05,
                height: 0.05,
            },
            200,
        );
        assert_eq!(edge.x, 0.0);
        assert_eq!(edge.y, 0.0);
        assert_eq!(edge.width, 0.5);
        assert_eq!(edge.height, 0.5);
    }

    #[test]
    fn visual_stability_uses_sampled_pixels() {
        let frame = FrameSnapshot {
            rgba: vec![12; 400],
            width: 10,
            height: 10,
            sequence: 1,
        };
        assert_eq!(visual_difference(&frame, &frame), 0.0);
        let changed = FrameSnapshot {
            rgba: vec![255; 400],
            sequence: 2,
            ..frame.clone()
        };
        assert!(visual_difference(&frame, &changed) > 0.5);
    }

    #[test]
    fn captured_monitor_frame_becomes_a_saved_step() {
        let temporary = tempfile::tempdir().unwrap();
        let storage = StorageService::new(temporary.path().to_path_buf()).unwrap();
        let project = storage.create_project("Untitled guide").unwrap();
        storage.autosave(&project).unwrap();
        let target = CaptureTargetDescriptor {
            id: "monitor:test".into(),
            kind: CaptureTargetKind::Monitor,
            label: "Display".into(),
            bounds: PixelRect {
                x: -2,
                y: 0,
                width: 2,
                height: 2,
            },
            scale_factor: 1.0,
        };
        let frame = FrameSnapshot {
            rgba: vec![255; 16],
            width: 2,
            height: 2,
            sequence: 1,
        };

        let asset = persist_frame(&storage, &project.id, &target, &target, &frame, None).unwrap();

        assert!(!storage.read_asset(&project.id, &asset).unwrap().is_empty());
        let mut step = Step::manual("Capture".into());
        step.application = Some("notepad.exe".into());
        step.media.before_asset = Some(asset);
        let state = Arc::new(Mutex::new(RecordingStateSnapshot::default()));

        persist_step(&storage, &project.id, step, &state).unwrap();

        let saved = storage.load_session(&project.id).unwrap();
        assert_eq!(saved.steps.len(), 1);
        assert_eq!(saved.title, "Notepad Guide");
        assert_eq!(state.lock().step_count, 1);
    }

    #[test]
    fn monitor_ids_preserve_the_windows_device_identity() {
        assert_eq!(
            monitor_device_name_from_id(r"monitor:\\.\DISPLAY2").unwrap(),
            r"\\.\DISPLAY2"
        );
        assert!(monitor_device_name_from_id("monitor:").is_err());
        assert!(monitor_device_name_from_id("window:DISPLAY2").is_err());
    }

    #[test]
    fn first_application_names_an_untitled_project() {
        let mut project = ProjectManifest::new("Neue Anleitung");
        project.theme.report_locale = "de".into();
        let mut step = Step::manual(String::new());
        step.application = Some("notepad.exe".into());

        maybe_name_project_from_step(&mut project, &step);

        assert_eq!(project.title, "Notepad Anleitung");
    }

    #[test]
    fn application_does_not_replace_a_user_title() {
        let mut project = ProjectManifest::new("Release checklist");
        let mut step = Step::manual(String::new());
        step.application = Some("chrome.exe".into());

        maybe_name_project_from_step(&mut project, &step);

        assert_eq!(project.title, "Release checklist");
    }

    #[test]
    fn post_recording_icon_enrichment_updates_matching_steps_only() {
        let mut project = ProjectManifest::new("Browser guide");
        let mut browser_step = Step::manual(String::new());
        browser_step.application = Some("chrome.exe".into());
        let mut editor_step = Step::manual(String::new());
        editor_step.application = Some("notepad.exe".into());
        project.steps.extend([browser_step, editor_step]);
        let icons = HashMap::from([("chrome.exe".into(), "media/chrome.png".into())]);

        assert!(attach_application_icons(&mut project, &icons));
        assert_eq!(
            project.steps[0].application_icon_asset.as_deref(),
            Some("media/chrome.png")
        );
        assert!(project.steps[1].application_icon_asset.is_none());
        assert!(!attach_application_icons(&mut project, &icons));
    }
}
