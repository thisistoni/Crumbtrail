export type CaptureTargetKind = "monitor" | "window" | "region"
export type RecordingStatus = "idle" | "selecting" | "recording" | "paused" | "stopping" | "error"
export type StepKind = "click" | "textEntry" | "manual"
export type MediaVariant = "before" | "after"
export type AnnotationKind = "clickMarker" | "elementOutline" | "arrow" | "rectangle" | "text" | "blur" | "crop"
export type ReportTheme = "crumbtrailLight" | "crumbtrailDark" | "cleanPrint"
export type TypographyPreset = "modern" | "editorial" | "compact"
export type ExportFormat = "html" | "pdf" | "images"
export type AppLocale = "en" | "de"

export interface PixelRect { x: number; y: number; width: number; height: number }
export interface ClickPulse { x: number; y: number; right: boolean }
export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface CaptureTargetDescriptor { id: string; kind: CaptureTargetKind; label: string; bounds: PixelRect; scaleFactor: number }
export interface RecordingOptions {
  targetKind: CaptureTargetKind
  captureLeftClicks: boolean
  captureRightClicks: boolean
  captureTypingGroups: boolean
  redactPasswords: boolean
  stabilizationDelayMs: number
  stabilizationIntervalMs: number
  stabilizationTimeoutMs: number
  typingIdleMs: number
  instructionLocale: AppLocale
  defaultFocusZoom: boolean
  defaultFocusZoomPercent: number
  defaultStrokeWidth: number
  manualShortcutKey: number
  pauseShortcutKey: number
  stopShortcutKey: number
}
export interface ThemeSettings {
  preset: ReportTheme
  accent: string
  typography: TypographyPreset
  logoAsset?: string | null
  showTimestamps: boolean
  showApplicationNames: boolean
  showIcons: boolean
  showCrumbtrailBranding: boolean
  reportLocale: AppLocale
}
export type DesignThemeSettings = Omit<ThemeSettings, "reportLocale">
export interface ControlMetadata {
  name: string
  controlType: string
  automationId: string
  isPassword: boolean
  bounds?: NormalizedRect | null
}
export interface Annotation {
  id: string
  kind: AnnotationKind
  rect: NormalizedRect
  color: string
  label?: string | null
  strokeWidth: number
  rotation: number
  opacity: number
  zIndex: number
  markerSize: number
  protected: boolean
}
export interface Step {
  id: string
  kind: StepKind
  instruction: string
  notes: string
  createdAt: string
  included: boolean
  application?: string | null
  applicationIconAsset?: string | null
  showIcon?: boolean
  control?: ControlMetadata | null
  media: { beforeAsset?: string | null; afterAsset?: string | null; selected: MediaVariant }
  annotations: Annotation[]
  focusZoom?: NormalizedRect | null
}
export interface ProjectManifest {
  schemaVersion: number
  id: string
  title: string
  description: string
  author: string
  createdAt: string
  updatedAt: string
  theme: ThemeSettings
  capture: RecordingOptions
  steps: Step[]
}
export interface ApplicationSummary { name: string; iconAsset?: string | null }
export interface ProjectSummary { id: string; title: string; updatedAt: string; stepCount: number; recoverable: boolean; applications: ApplicationSummary[] }
export interface RecordingStateSnapshot {
  status: RecordingStatus
  projectId?: string | null
  target?: CaptureTargetDescriptor | null
  stepCount: number
  sessionStepCount: number
  elapsedMs: number
  message?: string | null
}
export interface ExportRequest {
  project: ProjectManifest
  format: ExportFormat
  destination: string
  includeAnnotatedImages: boolean
  includeRawImages: boolean
}
export interface ExportResult { destination: string; filesWritten: number; warnings: string[] }
export interface DesignTemplate {
  id: string
  name: string
  author: string
  description: string
  theme: DesignThemeSettings
  logoDataUrl?: string | null
  createdAt: string
  updatedAt: string
}


export const defaultRecordingOptions: RecordingOptions = {
  targetKind: "monitor", captureLeftClicks: true, captureRightClicks: true, captureTypingGroups: true,
  redactPasswords: true, stabilizationDelayMs: 250, stabilizationIntervalMs: 100,
  stabilizationTimeoutMs: 1500, typingIdleMs: 800, instructionLocale: "en",
  defaultFocusZoom: false, defaultFocusZoomPercent: 175, defaultStrokeWidth: 3,
  manualShortcutKey: 0x77, pauseShortcutKey: 0x78, stopShortcutKey: 0x79,
}
