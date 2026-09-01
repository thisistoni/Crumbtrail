use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PROJECT_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub theme: ThemeSettings,
    pub capture: RecordingOptions,
    pub steps: Vec<Step>,
}

impl ProjectManifest {
    pub fn new(title: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            schema_version: PROJECT_SCHEMA_VERSION,
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            description: String::new(),
            author: String::new(),
            created_at: now.clone(),
            updated_at: now,
            theme: ThemeSettings::default(),
            capture: RecordingOptions::default(),
            steps: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub preset: ReportTheme,
    pub accent: String,
    pub typography: TypographyPreset,
    pub logo_asset: Option<String>,
    pub show_timestamps: bool,
    pub show_application_names: bool,
    #[serde(default = "default_show_icons")]
    pub show_icons: bool,
    #[serde(default = "default_show_crumbtrail_branding")]
    pub show_crumbtrail_branding: bool,
    #[serde(default = "default_report_locale")]
    pub report_locale: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            preset: ReportTheme::CrumbtrailLight,
            accent: "#E9A23B".to_string(),
            typography: TypographyPreset::Modern,
            logo_asset: None,
            show_timestamps: false,
            show_application_names: true,
            show_icons: default_show_icons(),
            show_crumbtrail_branding: default_show_crumbtrail_branding(),
            report_locale: default_report_locale(),
        }
    }
}

fn default_show_crumbtrail_branding() -> bool {
    true
}

fn default_show_icons() -> bool {
    true
}

fn default_report_locale() -> String {
    "en".to_string()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReportTheme {
    CrumbtrailLight,
    CrumbtrailDark,
    CleanPrint,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TypographyPreset {
    Modern,
    Editorial,
    Compact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingOptions {
    pub target_kind: CaptureTargetKind,
    pub capture_left_clicks: bool,
    pub capture_right_clicks: bool,
    pub capture_typing_groups: bool,
    pub redact_passwords: bool,
    pub stabilization_delay_ms: u64,
    pub stabilization_interval_ms: u64,
    pub stabilization_timeout_ms: u64,
    pub typing_idle_ms: u64,
    #[serde(default = "default_instruction_locale")]
    pub instruction_locale: String,
    #[serde(default)]
    pub default_focus_zoom: bool,
    #[serde(default = "default_focus_zoom_percent")]
    pub default_focus_zoom_percent: u32,
    #[serde(default = "default_stroke_width")]
    pub default_stroke_width: f64,
    #[serde(default = "default_manual_shortcut_key")]
    pub manual_shortcut_key: u32,
    #[serde(default = "default_pause_shortcut_key")]
    pub pause_shortcut_key: u32,
    #[serde(default = "default_stop_shortcut_key")]
    pub stop_shortcut_key: u32,
}

impl Default for RecordingOptions {
    fn default() -> Self {
        Self {
            target_kind: CaptureTargetKind::Monitor,
            capture_left_clicks: true,
            capture_right_clicks: true,
            capture_typing_groups: true,
            redact_passwords: true,
            stabilization_delay_ms: 250,
            stabilization_interval_ms: 100,
            stabilization_timeout_ms: 1_500,
            typing_idle_ms: 800,
            instruction_locale: default_instruction_locale(),
            default_focus_zoom: false,
            default_focus_zoom_percent: default_focus_zoom_percent(),
            default_stroke_width: default_stroke_width(),
            manual_shortcut_key: default_manual_shortcut_key(),
            pause_shortcut_key: default_pause_shortcut_key(),
            stop_shortcut_key: default_stop_shortcut_key(),
        }
    }
}

fn default_instruction_locale() -> String {
    "en".to_string()
}

fn default_stroke_width() -> f64 {
    3.0
}

fn default_focus_zoom_percent() -> u32 {
    175
}

fn default_manual_shortcut_key() -> u32 {
    0x77
}

fn default_pause_shortcut_key() -> u32 {
    0x78
}

fn default_stop_shortcut_key() -> u32 {
    0x79
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureTargetKind {
    Monitor,
    Window,
    Region,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTargetDescriptor {
    pub id: String,
    pub kind: CaptureTargetKind,
    pub label: String,
    pub bounds: PixelRect,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClickPulse {
    pub x: i32,
    pub y: i32,
    pub right: bool,
}

impl PixelRect {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && x < self.x.saturating_add(self.width as i32)
            && y < self.y.saturating_add(self.height as i32)
    }

    pub fn normalize(&self, rect: PixelRect) -> NormalizedRect {
        if self.width == 0 || self.height == 0 {
            return NormalizedRect::default();
        }
        NormalizedRect {
            x: (rect.x - self.x) as f64 / self.width as f64,
            y: (rect.y - self.y) as f64 / self.height as f64,
            width: rect.width as f64 / self.width as f64,
            height: rect.height as f64 / self.height as f64,
        }
        .clamped()
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl NormalizedRect {
    pub fn clamped(self) -> Self {
        let x = self.x.clamp(0.0, 1.0);
        let y = self.y.clamp(0.0, 1.0);
        Self {
            x,
            y,
            width: self.width.max(0.0).min(1.0 - x),
            height: self.height.max(0.0).min(1.0 - y),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub kind: StepKind,
    pub instruction: String,
    pub notes: String,
    pub created_at: String,
    pub included: bool,
    pub application: Option<String>,
    #[serde(default)]
    pub application_icon_asset: Option<String>,
    #[serde(default = "default_show_icons")]
    pub show_icon: bool,
    pub control: Option<ControlMetadata>,
    pub media: StepMedia,
    pub annotations: Vec<Annotation>,
    #[serde(default)]
    pub focus_zoom: Option<NormalizedRect>,
}

impl Step {
    pub fn manual(asset: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            kind: StepKind::Manual,
            instruction: "Describe this step".to_string(),
            notes: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            included: true,
            application: None,
            application_icon_asset: None,
            show_icon: default_show_icons(),
            control: None,
            media: StepMedia {
                before_asset: Some(asset),
                after_asset: None,
                selected: MediaVariant::Before,
            },
            annotations: Vec::new(),
            focus_zoom: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Click,
    TextEntry,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ControlMetadata {
    pub name: String,
    pub control_type: String,
    pub automation_id: String,
    pub is_password: bool,
    pub bounds: Option<NormalizedRect>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepMedia {
    pub before_asset: Option<String>,
    pub after_asset: Option<String>,
    pub selected: MediaVariant,
}

impl StepMedia {
    pub fn selected_asset(&self) -> Option<&str> {
        match self.selected {
            MediaVariant::Before => self.before_asset.as_deref().or(self.after_asset.as_deref()),
            MediaVariant::After => self.after_asset.as_deref().or(self.before_asset.as_deref()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaVariant {
    Before,
    After,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub kind: AnnotationKind,
    pub rect: NormalizedRect,
    pub color: String,
    pub label: Option<String>,
    pub stroke_width: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_marker_size")]
    pub marker_size: f64,
    #[serde(default)]
    pub protected: bool,
}

fn default_opacity() -> f64 {
    1.0
}

fn default_marker_size() -> f64 {
    22.0
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationKind {
    ClickMarker,
    ElementOutline,
    Arrow,
    Rectangle,
    Text,
    Blur,
    Crop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub step_count: usize,
    pub recoverable: bool,
    pub applications: Vec<ApplicationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSummary {
    pub name: String,
    pub icon_asset: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RecordingStatus {
    #[default]
    Idle,
    Selecting,
    Recording,
    Paused,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStateSnapshot {
    pub status: RecordingStatus,
    pub project_id: Option<String>,
    pub target: Option<CaptureTargetDescriptor>,
    pub step_count: usize,
    pub session_step_count: usize,
    pub elapsed_ms: u64,
    pub message: Option<String>,
}

impl Default for RecordingStateSnapshot {
    fn default() -> Self {
        Self {
            status: RecordingStatus::Idle,
            project_id: None,
            target: None,
            step_count: 0,
            session_step_count: 0,
            elapsed_ms: 0,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub project: ProjectManifest,
    pub format: ExportFormat,
    pub destination: String,
    pub include_annotated_images: bool,
    pub include_raw_images: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Html,
    Pdf,
    Images,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub destination: String,
    pub files_written: usize,
    pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_negative_desktop_coordinates() {
        let target = PixelRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let rect = PixelRect {
            x: -1440,
            y: 270,
            width: 480,
            height: 270,
        };
        assert_eq!(
            target.normalize(rect),
            NormalizedRect {
                x: 0.25,
                y: 0.25,
                width: 0.25,
                height: 0.25
            }
        );
    }

    #[test]
    fn selected_asset_falls_back_when_candidate_is_missing() {
        let media = StepMedia {
            before_asset: Some("media/before.png".into()),
            after_asset: None,
            selected: MediaVariant::After,
        };
        assert_eq!(media.selected_asset(), Some("media/before.png"));
    }
}
