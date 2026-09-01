import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  ApplicationSummary, CaptureTargetDescriptor, CaptureTargetKind, ExportRequest, ExportResult, PixelRect, ProjectManifest,
  ProjectSummary, RecordingOptions, RecordingStateSnapshot, Step,
} from "@/types"
import { defaultRecordingOptions } from "@/types"

export const isTauri = () => "__TAURI_INTERNALS__" in window

const mockImage = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#fffaf0"/><stop offset="1" stop-color="#e9e2d5"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="58" fill="#292722"/>
  <circle cx="30" cy="29" r="9" fill="#e9a23b"/><text x="52" y="37" font-family="Segoe UI" font-size="22" fill="#faf8f2">Acme Settings</text>
  <rect x="70" y="105" width="1140" height="530" rx="20" fill="#fff" stroke="#d8d0c3"/>
  <text x="120" y="165" font-family="Segoe UI" font-weight="600" font-size="30" fill="#282621">Appearance</text>
  <text x="120" y="205" font-family="Segoe UI" font-size="18" fill="#746e64">Choose how the application looks on this device.</text>
  <rect x="120" y="255" width="480" height="210" rx="16" fill="#f6f2ea" stroke="#dfd7ca"/>
  <text x="155" y="310" font-family="Segoe UI" font-weight="600" font-size="20" fill="#282621">Theme</text>
  <rect x="155" y="345" width="390" height="64" rx="12" fill="#fff" stroke="#e9a23b" stroke-width="3"/>
  <circle cx="190" cy="377" r="10" fill="#e9a23b"/><text x="218" y="384" font-family="Segoe UI" font-size="18" fill="#282621">Dark mode</text>
  <rect x="912" y="545" width="210" height="54" rx="12" fill="#292722"/><text x="981" y="579" font-family="Segoe UI" font-size="18" fill="#fff">Save</text>
</svg>`)}`

const mockApplicationIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="22" fill="#292722"/>
  <path d="M25 67 45 25h9l18 42H60l-4-10H40l-4 10H25Zm19-20h9l-4-11-5 11Z" fill="#E9A23B"/>
</svg>`)}`

const makeSampleSteps = (): Step[] => [
  {
    id: crypto.randomUUID(), kind: "click", instruction: "Select Dark mode", notes: "Choose the darker appearance for this workspace.",
    createdAt: new Date().toISOString(), included: true, application: "Acme Settings", applicationIconAsset: "mock://application/acme", media: { beforeAsset: "mock://settings", afterAsset: "mock://settings", selected: "before" },
    control: { name: "Dark mode", controlType: "RadioButton", automationId: "theme-dark", isPassword: false, bounds: { x: .12, y: .47, width: .31, height: .09 } },
    annotations: [
      { id: crypto.randomUUID(), kind: "elementOutline", rect: { x: .12, y: .47, width: .31, height: .09 }, color: "#ef4444", strokeWidth: 3, rotation: 0, opacity: 1, zIndex: 0, markerSize: 18, protected: false },
    ],
  },
  {
    id: crypto.randomUUID(), kind: "click", instruction: "Click Save", notes: "", createdAt: new Date().toISOString(), included: true,
    application: "Acme Settings", applicationIconAsset: "mock://application/acme", media: { beforeAsset: "mock://settings", afterAsset: "mock://settings", selected: "before" },
    control: { name: "Save", controlType: "Button", automationId: "save", isPassword: false, bounds: { x: .71, y: .76, width: .17, height: .08 } },
    annotations: [{ id: crypto.randomUUID(), kind: "elementOutline", rect: { x: .71, y: .76, width: .17, height: .08 }, color: "#ef4444", strokeWidth: 3, rotation: 0, opacity: 1, zIndex: 0, markerSize: 22, protected: false }],
  },
]

export function createMockProject(title = "Workspace appearance guide"): ProjectManifest {
  const now = new Date().toISOString()
  return {
    schemaVersion: 2, id: crypto.randomUUID(), title, description: "A short, polished walkthrough recorded with Crumbtrail.", author: "",
    createdAt: now, updatedAt: now, capture: { ...defaultRecordingOptions }, steps: makeSampleSteps(),
    theme: { preset: "crumbtrailLight", accent: "#E9A23B", typography: "modern", logoAsset: null, showTimestamps: false, showApplicationNames: true, showIcons: true, showCrumbtrailBranding: true, reportLocale: "en" },
  }
}

let browserSessions: ProjectManifest[] = [createMockProject()]
let browserRecording: RecordingStateSnapshot = { status: "idle", stepCount: 0, sessionStepCount: 0, elapsedMs: 0 }
let browserTrash: ProjectManifest[] = []

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> { return invoke<T>(command, args) }

function summarizeApplications(steps: Step[]): ApplicationSummary[] {
  const applications = new Map<string, ApplicationSummary>()
  for (const step of steps) {
    if (!step.application) continue
    const key = step.application.toLocaleLowerCase()
    const existing = applications.get(key)
    if (existing) {
      if (!existing.iconAsset && step.applicationIconAsset) existing.iconAsset = step.applicationIconAsset
    } else {
      applications.set(key, { name: step.application, iconAsset: step.applicationIconAsset })
    }
  }
  return Array.from(applications.values())
}

export const bridge = {
  async createProject(title: string) {
    if (isTauri()) return call<ProjectManifest>("create_project", { title })
    const project = createMockProject(title || "Untitled guide"); project.steps = []; return project
  },
  async autosave(project: ProjectManifest) {
    if (isTauri()) return call<ProjectManifest>("autosave_project", { project })
    const saved = { ...project, updatedAt: new Date().toISOString() }; browserSessions = [saved, ...browserSessions.filter(item => item.id !== saved.id)]; return saved
  },
  async listSessions(): Promise<ProjectSummary[]> {
    if (isTauri()) return call("list_sessions")
    return browserSessions.filter(item => item.steps.length > 0).map(item => ({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      stepCount: item.steps.length,
      recoverable: true,
      applications: summarizeApplications(item.steps),
    }))
  },
  async loadSession(id: string) {
    if (isTauri()) return call<ProjectManifest>("load_session", { id })
    return structuredClone(browserSessions.find(item => item.id === id) ?? browserSessions[0])
  },
  async deleteSession(id: string) {
    if (isTauri()) return call<void>("delete_session", { id })
    const removed = browserSessions.find(item => item.id === id)
    if (removed) browserTrash = [removed, ...browserTrash.filter(item => item.id !== id)]
    browserSessions = browserSessions.filter(item => item.id !== id)
  },
  async restoreSession(id: string) {
    if (isTauri()) return call<void>("restore_session", { id })
    const restored = browserTrash.find(item => item.id === id)
    if (restored) browserSessions = [restored, ...browserSessions.filter(item => item.id !== id)]
    browserTrash = browserTrash.filter(item => item.id !== id)
  },
  async compactSession(id: string) {
    if (isTauri()) return call<number>("compact_session", { id })
    return 0
  },
  openProject: (source: string) => call<ProjectManifest>("open_project", { source }),
  saveProject: (project: ProjectManifest, destination: string) => call<string>("save_project", { project, destination }),
  replaceImage: (projectId: string, source: string) => call<string>("replace_image", { projectId, source }),
  async assetUrl(projectId: string, asset?: string | null) {
    if (asset?.startsWith("mock://application/")) return mockApplicationIcon
    if (!asset || asset.startsWith("mock://") || !isTauri()) return mockImage
    return call<string>("read_asset_data_url", { projectId, asset })
  },
  async importAssetDataUrl(projectId: string, dataUrl: string) {
    if (isTauri()) return call<string>("import_asset_data_url", { projectId, dataUrl })
    return "mock://design-logo"
  },
  exportProject: (request: ExportRequest) => call<ExportResult>("export_project", { request }),
  async renderPreview(project: ProjectManifest) {
    if (isTauri()) return call<string>("render_report_preview", { project })
    return `<html><body><main><h1>${project.title.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!)}</h1></main></body></html>`
  },
  async listTargets(kind: CaptureTargetKind) {
    if (isTauri()) return call<CaptureTargetDescriptor[]>("list_capture_targets", { kind })
    if (kind === "window") return []
    return [
      { id: "monitor:DISPLAY1", kind, label: "Display 1", bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25 },
      { id: "monitor:DISPLAY2", kind, label: "Display 2", bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    ]
  },
  async selectTarget(kind: CaptureTargetKind, targetId?: string) {
    if (isTauri()) return call<CaptureTargetDescriptor>("select_capture_target", { kind, targetId })
    if (targetId === "monitor:DISPLAY2") return { id: targetId, kind, label: "Display 2", bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
    return { id: `${kind}:preview`, kind, label: kind === "window" ? "Acme Settings" : "Display 1 · 2560 × 1440", bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25 }
  },
  async targetThumbnail(target: CaptureTargetDescriptor) {
    if (isTauri()) return call<string>("capture_target_thumbnail", { targetId: target.id })
    const number = target.id.endsWith("2") ? "2" : "1"
    const accent = number === "2" ? "%235b7cfa" : "%23e9a23b"
    return `data:image/svg+xml;charset=UTF-8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='%231b1d22'/><rect x='24' y='24' width='592' height='312' rx='14' fill='%23282b32'/><rect x='54' y='62' width='390' height='28' rx='6' fill='${accent}'/><rect x='54' y='116' width='530' height='170' rx='10' fill='%23383c45'/><text x='320' y='218' text-anchor='middle' fill='white' font-size='72' font-family='Segoe UI'>${number}</text></svg>`
  },
  async startRecording(projectId: string, options: RecordingOptions, region?: PixelRect | null) {
    if (isTauri()) return call<RecordingStateSnapshot>("start_recording", { projectId, options, region })
    browserRecording = { status: "recording", projectId, target: { id: "preview", kind: options.targetKind, label: "Preview target", bounds: region ?? { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1 }, stepCount: 0, sessionStepCount: 0, elapsedMs: 0 }; return browserRecording
  },
  async pause() { if (isTauri()) return call<RecordingStateSnapshot>("pause_recording"); return browserRecording = { ...browserRecording, status: "paused" } },
  async resume() { if (isTauri()) return call<RecordingStateSnapshot>("resume_recording"); return browserRecording = { ...browserRecording, status: "recording" } },
  manual: async () => {
    if (isTauri()) return call<RecordingStateSnapshot>("capture_manual_step")
    browserRecording = { ...browserRecording, stepCount: browserRecording.stepCount + 1, sessionStepCount: browserRecording.sessionStepCount + 1 }
    return browserRecording
  },
  undoRecorded: () => isTauri() ? call<void>("undo_recorded_step") : Promise.resolve(),
  async stop() { if (isTauri()) return call<RecordingStateSnapshot>("stop_recording"); return browserRecording = { ...browserRecording, status: "idle" } },
  async recordingState() { if (isTauri()) return call<RecordingStateSnapshot>("recording_state"); return browserRecording },
  protectWindow: () => isTauri() ? call<void>("protect_window") : Promise.resolve(),
  async on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined
    return listen<T>(event, event => handler(event.payload))
  },
}
