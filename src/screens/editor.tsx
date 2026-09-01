import { useEffect, useRef, useState } from "react"
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  ArrowLeft, ArrowRight, Blend, BoxSelect, ChevronDown, CircleDot, Copy, Crop, Download, Eye, FileArchive,
  FileCode2, FileImage, FileText, ImagePlus, LocateFixed, Merge, Minus, MonitorDot,
  MoreHorizontal, Paintbrush, PanelRight, Plus, RectangleHorizontal, Redo2, RotateCcw, Trash2,
  Type, Undo2, ZoomIn,
} from "lucide-react"
import { toast } from "sonner"
import { Brand } from "@/components/brand"
import { ReportPreview } from "@/components/editor/report-preview"
import { ScreenshotCanvas } from "@/components/editor/screenshot-canvas"
import { StepTimeline } from "@/components/editor/step-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bridge, isTauri } from "@/lib/bridge"
import { AutosaveQueue } from "@/lib/autosave-queue"
import { deleteDesignTemplate, designFromProject, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"
import { useLocale } from "@/lib/i18n"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import type { Annotation, AnnotationKind, DesignTemplate, ExportFormat, NormalizedRect, ProjectManifest, ReportTheme, Step, TypographyPreset } from "@/types"

interface EditorProps {
  project: ProjectManifest
  onProject(project: ProjectManifest): void
  onHome(): void
  onRecord(): void
}

const annotationTools: { kind: AnnotationKind; icon: typeof CircleDot }[] = [
  { kind: "clickMarker", icon: CircleDot }, { kind: "elementOutline", icon: BoxSelect },
  { kind: "arrow", icon: ArrowRight }, { kind: "rectangle", icon: RectangleHorizontal },
  { kind: "text", icon: Type }, { kind: "blur", icon: Blend }, { kind: "crop", icon: Crop },
]

const assetUrlCache = new Map<string, string>()
const FULL_VIEW: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 }

export function Editor({ project, onProject, onHome, onRecord }: EditorProps) {
  const [selectedId, setSelectedId] = useState(project.steps[0]?.id ?? null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState({ key: "", url: "" })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved")
  const [zoom, setZoom] = useState(1)
  const [cropMode, setCropMode] = useState(false)
  const undoStack = useRef<ProjectManifest[]>([])
  const redoStack = useRef<ProjectManifest[]>([])
  const canvasViewport = useRef<HTMLDivElement>(null)
  const manualZoom = useRef(false)
  const [canvasHot, setCanvasHot] = useState(false)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [canvasAspect, setCanvasAspect] = useState(16 / 9)
  const { locale, t } = useLocale()
  const { settings } = useSettings()
  const mounted = useRef(true)
  const onProjectRef = useRef(onProject)
  const localeRef = useRef(locale)
  const debounceTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const saveErrorReported = useRef(false)
  const compactSessionRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const autosaveQueue = useRef<AutosaveQueue<ProjectManifest> | null>(null)
  onProjectRef.current = onProject
  localeRef.current = locale
  if (!autosaveQueue.current) {
    autosaveQueue.current = new AutosaveQueue(bridge.autosave, savedProject => {
      if (!mounted.current) return
      saveErrorReported.current = false
      setSaveStatus("saved")
      onProjectRef.current(savedProject)
    })
  }
  const selectedIndex = Math.max(0, project.steps.findIndex(item => item.id === selectedId))
  const step = project.steps[selectedIndex]
  const cropAnnotation = step?.annotations.find(item => item.kind === "crop") ?? null
  const selectedAnnotation = step?.annotations.find(item => item.id === selectedAnnotationId && item.kind !== "crop") ?? null
  const selectedAsset = step ? (step.media.selected === "before" ? step.media.beforeAsset ?? step.media.afterAsset : step.media.afterAsset ?? step.media.beforeAsset) : null
  const selectedAssetKey = selectedAsset ? `${project.id}:${selectedAsset}` : ""
  const imageUrl = assetUrlCache.get(selectedAssetKey) ?? (loadedImage.key === selectedAssetKey ? loadedImage.url : "")

  useEffect(() => {
    if (!selectedAsset || !selectedAssetKey) { setLoadedImage({ key: "", url: "" }); return }
    const cached = assetUrlCache.get(selectedAssetKey)
    if (cached) { setLoadedImage({ key: selectedAssetKey, url: cached }); return }
    let active = true
    setLoadedImage({ key: selectedAssetKey, url: "" })
    bridge.assetUrl(project.id, selectedAsset).then(url => {
      if (!active) return
      assetUrlCache.set(selectedAssetKey, url)
      setLoadedImage({ key: selectedAssetKey, url })
    }).catch(() => { if (active) setLoadedImage({ key: selectedAssetKey, url: "" }) })
    return () => { active = false }
  }, [project.id, selectedAsset, selectedAssetKey])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      void autosaveQueue.current?.flush().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault()
      try {
        await persistAutosave()
        await compactSessionRef.current()
        await getCurrentWindow().destroy()
      } catch {
        // Keep the window open so the user can retry or copy their work.
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    setSelectedAnnotationId(null)
    setCropMode(false)
    setPanOffset({ x: 0, y: 0 })
    manualZoom.current = false
  }, [selectedId])

  useEffect(() => {
    const viewport = canvasViewport.current
    if (!viewport) return
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!manualZoom.current && viewportSize.width && viewportSize.height) setZoom(fittedZoom(viewportSize, canvasAspect))
  }, [canvasAspect, selectedId, viewportSize])

  function queueProject(next: ProjectManifest) {
    const normalized = { ...next, schemaVersion: 2 as const }
    autosaveQueue.current?.enqueue(normalized)
    setSaveStatus("saving")
    saveErrorReported.current = false
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null
      void persistAutosave().catch(() => undefined)
    }, 450)
    onProject(normalized)
  }

  async function persistAutosave() {
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    try {
      await autosaveQueue.current?.flush()
    } catch (error) {
      if (mounted.current) {
        setSaveStatus("error")
        if (!saveErrorReported.current) {
          saveErrorReported.current = true
          toast.error(localeRef.current === "de" ? "Automatisches Speichern fehlgeschlagen" : "Autosave failed", { description: String(error) })
        }
        if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null
          void persistAutosave().catch(() => undefined)
        }, 2000)
      }
      throw error
    }
  }

  async function leaveEditor(action: () => void) {
    try {
      await persistAutosave()
      await compactSession()
      action()
    } catch {
      // The failure is already visible and navigation must not discard the edit.
    }
  }

  async function compactSession() {
    try {
      await bridge.compactSession(project.id)
    } catch (error) {
      toast.warning(localeRef.current === "de" ? "Nicht verwendete Bilder konnten nicht bereinigt werden" : "Could not clean up unused images", { description: String(error) })
    }
  }
  compactSessionRef.current = compactSession

  function commit(next: ProjectManifest) {
    undoStack.current.push(project)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    queueProject(next)
  }
  const updateProject = (patch: Partial<ProjectManifest>) => commit({ ...project, ...patch })
  const updateStep = (patch: Partial<Step>) => {
    if (!step) return
    commit({ ...project, steps: project.steps.map(item => item.id === step.id ? { ...item, ...patch } : item) })
  }
  function undo() { const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push(project); queueProject(previous) }
  function redo() { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(project); queueProject(next) }

  function duplicateStep(id = step?.id) {
    const sourceIndex = project.steps.findIndex(item => item.id === id)
    const source = project.steps[sourceIndex]
    if (!source) return
    const copy = { ...structuredClone(source), id: crypto.randomUUID(), instruction: `${source.instruction} (${locale === "de" ? "Kopie" : "copy"})`, annotations: source.annotations.map(item => ({ ...item, id: crypto.randomUUID() })) }
    const steps = [...project.steps]
    steps.splice(sourceIndex + 1, 0, copy)
    commit({ ...project, steps })
    setSelectedId(copy.id)
  }
  function deleteStep(id = step?.id) {
    const sourceIndex = project.steps.findIndex(item => item.id === id)
    if (sourceIndex < 0) return
    const steps = project.steps.filter(item => item.id !== id)
    commit({ ...project, steps })
    setSelectedId(steps[Math.min(sourceIndex, steps.length - 1)]?.id ?? null)
  }
  function mergeNext(id = step?.id) {
    const sourceIndex = project.steps.findIndex(item => item.id === id)
    const source = project.steps[sourceIndex]
    const next = project.steps[sourceIndex + 1]
    if (!source || !next) return
    const merged: Step = { ...source, instruction: `${source.instruction}\n${next.instruction}`, notes: [source.notes, next.notes].filter(Boolean).join("\n"), annotations: [...source.annotations, ...next.annotations] }
    commit({ ...project, steps: project.steps.map(item => item.id === source.id ? merged : item).filter(item => item.id !== next.id) })
    setSelectedId(source.id)
  }

  function addAnnotation(kind: AnnotationKind) {
    if (!step) return
    const existingCrop = step.annotations.find(item => item.kind === "crop")
    if (cropMode && kind !== "crop") {
      setCropMode(false)
      setSelectedAnnotationId(null)
    }
    if (kind === "crop" && existingCrop) {
      if (step.focusZoom) updateStep({ focusZoom: null })
      setSelectedAnnotationId(existingCrop.id)
      setCropMode(true)
      return
    }
    const view = kind === "crop" ? FULL_VIEW : cropAnnotation?.rect ?? step.focusZoom ?? FULL_VIEW
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      kind,
      rect: annotationRectForView(kind, view),
      color: "#ef4444",
      label: kind === "text" ? "Text" : null,
      strokeWidth: settings.defaultStrokeWidth,
      rotation: 0,
      opacity: 1,
      zIndex: Math.max(-1, ...step.annotations.map(item => item.zIndex)) + 1,
      markerSize: 18,
      protected: false,
    }
    updateStep({ annotations: [...step.annotations, annotation], ...(kind === "crop" ? { focusZoom: null } : {}) })
    setSelectedAnnotationId(annotation.id)
    if (kind === "crop") setCropMode(true)
  }
  function updateAnnotation(id: string, patch: Partial<Annotation>) { if (step) updateStep({ annotations: step.annotations.map(item => item.id === id ? { ...item, ...patch } : item) }) }
  function deleteAnnotation(id: string) {
    if (!step) return
    const annotation = step.annotations.find(item => item.id === id)
    if (annotation?.protected) return
    updateStep({ annotations: step.annotations.filter(item => item.id !== id) })
    if (selectedAnnotationId === id) setSelectedAnnotationId(null)
    if (annotation?.kind === "crop") setCropMode(false)
  }
  function duplicateAnnotation(id: string) {
    if (!step) return
    const source = step.annotations.find(item => item.id === id)
    if (!source || source.protected) return
    const copy = { ...structuredClone(source), id: crypto.randomUUID(), rect: { ...source.rect, x: Math.min(1 - source.rect.width, source.rect.x + .02), y: Math.min(1 - source.rect.height, source.rect.y + .02) }, zIndex: source.zIndex + 1 }
    updateStep({ annotations: [...step.annotations, copy] })
    setSelectedAnnotationId(copy.id)
  }
  function resetCrop() {
    const crop = step?.annotations.find(item => item.kind === "crop")
    if (crop) deleteAnnotation(crop.id)
  }
  function toggleFocusZoom() {
    if (!step || cropAnnotation) return
    updateStep({ focusZoom: step.focusZoom ? null : focusRect(step, project.capture.defaultFocusZoomPercent) })
  }

  const queueProjectRef = useRef(queueProject)
  queueProjectRef.current = queueProject

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      const editing = target instanceof Element && target.matches("input, textarea, select, [contenteditable='true']")
      const deletePressed = ["Delete", "Backspace"].includes(event.key) || event.code === "Delete"
      if (deletePressed && selectedAnnotation && step && !selectedAnnotation.protected && !editing) {
        event.preventDefault()
        const next = { ...project, steps: project.steps.map(item => item.id === step.id ? { ...item, annotations: item.annotations.filter(annotation => annotation.id !== selectedAnnotation.id) } : item) }
        undoStack.current.push(project)
        redoStack.current = []
        setSelectedAnnotationId(null)
        queueProjectRef.current(next)
        return
      }
      if (selectedAnnotation && step && !selectedAnnotation.protected && !editing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault()
        const amount = event.shiftKey ? .01 : .002
        const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0
        const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0
        const rect = { ...selectedAnnotation.rect, x: Math.max(0, Math.min(1 - selectedAnnotation.rect.width, selectedAnnotation.rect.x + dx)), y: Math.max(0, Math.min(1 - selectedAnnotation.rect.height, selectedAnnotation.rect.y + dy)) }
        queueProjectRef.current({ ...project, steps: project.steps.map(item => item.id === step.id ? { ...item, annotations: item.annotations.map(annotation => annotation.id === selectedAnnotation.id ? { ...annotation, rect } : annotation) } : item) })
        return
      }
      if (!canvasHot || !event.ctrlKey || editing) return
      if (["+", "="].includes(event.key)) { event.preventDefault(); changeZoom(value => Math.min(4, value + .1)) }
      if (event.key === "-") { event.preventDefault(); changeZoom(value => Math.max(.25, value - .1)) }
      if (event.key === "0") { event.preventDefault(); changeZoom(() => 1) }
    }
    window.addEventListener("keydown", keydown, true)
    return () => window.removeEventListener("keydown", keydown, true)
  }, [canvasHot, onProject, project, selectedAnnotation, step])

  function beginCanvasPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    if ((event.target as HTMLElement).closest(".cursor-move, [data-handle], button, input")) return
    setSelectedAnnotationId(null)
    const viewport = canvasViewport.current
    if (!viewport) return
    event.preventDefault()
    viewport.focus({ preventScroll: true })
    const origin = { x: event.clientX, y: event.clientY, pan: panOffset }
    viewport.classList.add("cursor-grabbing")
    const move = (next: PointerEvent) => {
      const dx = next.clientX - origin.x
      const dy = next.clientY - origin.y
      setPanOffset({ x: origin.pan.x + dx, y: origin.pan.y + dy })
    }
    const up = () => { viewport.classList.remove("cursor-grabbing"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function changeZoom(update: (value: number) => number) {
    manualZoom.current = true
    setZoom(update)
  }

  function fitCanvas() {
    manualZoom.current = false
    setZoom(fittedZoom(viewportSize, canvasAspect))
    setPanOffset({ x: 0, y: 0 })
  }

  function centerCanvas() {
    setPanOffset({ x: 0, y: 0 })
  }

  async function replaceImage() {
    if (!step || !isTauri()) return toast.info(locale === "de" ? "Bildersatz ist in der Desktop-App verfügbar" : "Image replacement is available in the desktop build")
    const source = await openDialog({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }] })
    if (!source) return
    try {
      const asset = await bridge.replaceImage(project.id, source)
      updateStep({ media: { ...step.media, beforeAsset: step.media.selected === "before" ? asset : step.media.beforeAsset, afterAsset: step.media.selected === "after" ? asset : step.media.afterAsset } })
    } catch (error) { toast.error(locale === "de" ? "Bild konnte nicht ersetzt werden" : "Image could not be replaced", { description: String(error) }) }
  }
  async function replaceStepIcon() {
    if (!step || !isTauri()) return toast.info(locale === "de" ? "Eigene Symbole sind in der Desktop-App verfügbar" : "Custom icons are available in the desktop build")
    const source = await openDialog({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }] })
    if (!source) return
    try {
      const asset = await bridge.replaceImage(project.id, source)
      updateStep({ applicationIconAsset: asset, showIcon: true, ...(step.kind === "manual" ? { application: null } : {}) })
    } catch (error) { toast.error(locale === "de" ? "Symbol konnte nicht ersetzt werden" : "Could not replace the icon", { description: String(error) }) }
  }
  async function savePortable() {
    if (!isTauri()) return toast.info(locale === "de" ? "Portable Projekte sind in der Desktop-App verfügbar" : "Portable project files are available in the desktop build")
    const destination = await saveDialog({ defaultPath: `${safeName(project.title)}.crumbtrail`, filters: [{ name: "Crumbtrail", extensions: ["crumbtrail"] }] })
    if (!destination) return
    try { toast.success(locale === "de" ? "Projekt gespeichert" : "Portable project saved", { description: await bridge.saveProject(project, destination) }) }
    catch (error) { toast.error(locale === "de" ? "Projekt konnte nicht gespeichert werden" : "Project could not be saved", { description: String(error) }) }
  }

  return (
    <main className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-4">
        <Button variant="ghost" onClick={() => void leaveEditor(onHome)}><ArrowLeft data-icon="inline-start" />{t("back")}</Button>
        <Brand compact />
        <Separator orientation="vertical" className="mx-1" />
        <Input value={project.title} onChange={event => updateProject({ title: event.target.value })} className="h-8 max-w-[420px] flex-1 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:border-border focus:border-border" aria-label="Project title" />
        <Badge variant="secondary" className="font-normal">{saveStatus === "saved" ? (locale === "de" ? "Gespeichert" : "Saved") : saveStatus === "error" ? (locale === "de" ? "Speichern fehlgeschlagen" : "Save failed") : (locale === "de" ? "Speichert…" : "Saving…")}</Badge>
        <div className="flex items-center gap-1">
          <ToolButton label={t("undo")} onClick={undo} disabled={!undoStack.current.length}><Undo2 /></ToolButton>
          <ToolButton label={locale === "de" ? "Wiederholen" : "Redo"} onClick={redo} disabled={!redoStack.current.length}><Redo2 /></ToolButton>
        </div>
        <Separator orientation="vertical" className="mx-1" />
        <Sheet><SheetTrigger render={<Button variant="outline" />}><Paintbrush data-icon="inline-start" />{t("appearance")}</SheetTrigger><BrandingPanel project={project} update={updateProject} /></Sheet>
        <Button variant="outline" onClick={() => setPreviewOpen(true)}><Eye data-icon="inline-start" />{t("preview")}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button />}><Download data-icon="inline-start" />{t("export")}<ChevronDown data-icon="inline-end" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60"><DropdownMenuGroup><DropdownMenuItem className="whitespace-nowrap" onClick={() => setExportOpen(true)}><FileText />{locale === "de" ? "Exportieren als…" : "Export as…"}</DropdownMenuItem><DropdownMenuItem className="whitespace-nowrap" onClick={savePortable}><FileArchive />{locale === "de" ? "Projektdatei speichern" : "Save project file"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(420px,1fr)_340px]">
        <aside className="flex min-h-0 flex-col border-r bg-sidebar">
          <div className="flex h-14 items-center justify-between px-4"><p className="text-sm font-semibold">{t("steps")} <span className="ml-1 font-normal tabular-nums text-muted-foreground">{project.steps.filter(item => item.included).length}/{project.steps.length}</span></p><Button variant="ghost" size="icon-sm" onClick={() => void leaveEditor(onRecord)} aria-label={t("record")}><Plus /></Button></div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            {project.steps.length ? <StepTimeline projectId={project.id} showIcons={project.theme.showIcons} steps={project.steps} selectedId={step?.id ?? null} onSelect={setSelectedId} onReorder={steps => commit({ ...project, steps })} onDuplicate={duplicateStep} onMergeNext={mergeNext} onDelete={deleteStep} /> : <Empty className="border-0 py-16"><EmptyHeader><EmptyMedia variant="icon"><MonitorDot /></EmptyMedia><EmptyTitle>{locale === "de" ? "Noch keine Schritte" : "No steps yet"}</EmptyTitle></EmptyHeader></Empty>}
          </ScrollArea>
          <div className="border-t p-3"><Button variant="outline" className="w-full" onClick={() => void leaveEditor(onRecord)}><span className="size-2 rounded-full bg-red-500" />{t("record")}</Button></div>
        </aside>

        <section className="canvas-grid flex min-h-0 min-w-0 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b bg-card/85 px-3 backdrop-blur">
            <div className="flex items-center gap-1">
              {annotationTools.map(tool => <ToolButton key={tool.kind} label={tool.kind === "crop" ? t("crop") : annotationLabel(tool.kind, locale)} onClick={() => addAnnotation(tool.kind)} disabled={!step} active={tool.kind === "crop" && cropMode}><tool.icon /></ToolButton>)}
              {cropMode && <><Separator orientation="vertical" className="mx-1 h-6" /><Button size="sm" onClick={() => { setCropMode(false); setSelectedAnnotationId(null) }}>{t("confirmCrop")}</Button><Button size="sm" variant="ghost" onClick={resetCrop}><RotateCcw data-icon="inline-start" />{t("resetCrop")}</Button></>}
            </div>
            <div className="flex items-center gap-1">
              {step?.kind !== "manual" && <><Button variant={step?.focusZoom && !cropAnnotation ? "secondary" : "ghost"} size="sm" onClick={toggleFocusZoom} disabled={!step || Boolean(cropAnnotation)}><LocateFixed data-icon="inline-start" />{t("autoZoom")}</Button><Separator orientation="vertical" className="mx-1 h-6" /></>}
              <ToolButton label={locale === "de" ? "Verkleinern" : "Zoom out"} onClick={() => changeZoom(value => Math.max(.25, value - .1))}><Minus /></ToolButton>
              <button className="w-14 text-center text-xs tabular-nums text-muted-foreground" onClick={() => changeZoom(() => 1)}>{Math.round(zoom * 100)}%</button>
              <ToolButton label={locale === "de" ? "Vergrößern" : "Zoom in"} onClick={() => changeZoom(value => Math.min(4, value + .1))}><ZoomIn /></ToolButton>
            </div>
          </div>
          <div ref={canvasViewport} data-canvas-viewport tabIndex={0} className="relative min-h-0 flex-1 cursor-grab overflow-hidden p-8 outline-none" onPointerEnter={() => setCanvasHot(true)} onPointerLeave={() => setCanvasHot(false)} onPointerDown={beginCanvasPan} onWheel={event => { if (event.ctrlKey) { event.preventDefault(); changeZoom(value => Math.max(.25, Math.min(4, value - event.deltaY * .001))) } }}>
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div data-canvas-pan style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}>
                {step ? <ScreenshotCanvas imageUrl={imageUrl} annotations={step.annotations} focusZoom={step.focusZoom} zoom={zoom} cropMode={cropMode} selectedId={selectedAnnotationId} onSelect={setSelectedAnnotationId} onAnnotation={updateAnnotation} onDelete={deleteAnnotation} onDuplicate={duplicateAnnotation} onFit={fitCanvas} onActualSize={() => { changeZoom(() => 1); setPanOffset({ x: 0, y: 0 }) }} onAspectChange={setCanvasAspect} /> : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileImage /></EmptyMedia><EmptyTitle>{locale === "de" ? "Schritt auswählen" : "Select a step"}</EmptyTitle></EmptyHeader></Empty>}
              </div>
            </div>
            {(Math.abs(panOffset.x) > 2 || Math.abs(panOffset.y) > 2) && <Button variant="secondary" size="sm" className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-lg" onClick={centerCanvas}><LocateFixed data-icon="inline-start" />{locale === "de" ? "Zentrieren" : "Center"}</Button>}
          </div>
          {step && <div className="flex h-12 shrink-0 items-center justify-between border-t bg-card/90 px-4 text-xs text-muted-foreground"><span>{step.kind === "manual" ? (locale === "de" ? "Momentaufnahme" : "Snapshot") : step.media.selected === "before" ? (locale === "de" ? "Vor der Aktion" : "Before interaction") : (locale === "de" ? "Nach der Aktion" : "After interaction")}</span><Button variant="ghost" size="sm" onClick={replaceImage}><ImagePlus data-icon="inline-start" />{locale === "de" ? "Screenshot ersetzen" : "Replace screenshot"}</Button></div>}
        </section>

        <aside className="min-h-0 border-l bg-card">
          <ScrollArea className="h-full">
            {step ? <Inspector step={step} stepNumber={selectedIndex + 1} selectedAnnotation={selectedAnnotation} onSelectAnnotation={setSelectedAnnotationId} updateStep={updateStep} updateAnnotation={updateAnnotation} deleteAnnotation={deleteAnnotation} replaceStepIcon={replaceStepIcon} duplicateStep={duplicateStep} mergeNext={mergeNext} deleteStep={deleteStep} canMerge={Boolean(project.steps[selectedIndex + 1])} /> : <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><PanelRight /></EmptyMedia><EmptyTitle>{locale === "de" ? "Nichts ausgewählt" : "Nothing selected"}</EmptyTitle></EmptyHeader></Empty>}
          </ScrollArea>
        </aside>
      </div>

      <ReportPreview open={previewOpen} onOpenChange={setPreviewOpen} project={project} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} project={project} />
    </main>
  )
}

function ToolButton({ label, onClick, disabled, active, children }: { label: string; onClick(): void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button variant={active ? "secondary" : "ghost"} size="icon" onClick={onClick} disabled={disabled} aria-label={label} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

function Inspector({ step, stepNumber, selectedAnnotation, onSelectAnnotation, updateStep, updateAnnotation, deleteAnnotation, replaceStepIcon, duplicateStep, mergeNext, deleteStep, canMerge }: { step: Step; stepNumber: number; selectedAnnotation: Annotation | null; onSelectAnnotation(id: string): void; updateStep(patch: Partial<Step>): void; updateAnnotation(id: string, patch: Partial<Annotation>): void; deleteAnnotation(id: string): void; replaceStepIcon(): void; duplicateStep(): void; mergeNext(): void; deleteStep(): void; canMerge: boolean }) {
  const { locale, t } = useLocale()
  const markings = step.annotations.filter(annotation => annotation.kind !== "crop")
  return <div className="p-5">
    <div className="flex items-start justify-between gap-2"><div><Badge variant="secondary">{locale === "de" ? "Schritt" : "Step"} {stepNumber}</Badge><h2 className="mt-3 text-lg font-semibold">{t("instruction")}</h2></div><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={locale === "de" ? "Schrittaktionen" : "Step actions"} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60"><DropdownMenuGroup><DropdownMenuItem className="whitespace-nowrap" onClick={duplicateStep}><Copy />{t("duplicate")}</DropdownMenuItem><DropdownMenuItem className="whitespace-nowrap" onClick={mergeNext} disabled={!canMerge}><Merge />{locale === "de" ? "Mit nächstem verbinden" : "Merge with next"}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem className="whitespace-nowrap" variant="destructive" onClick={deleteStep}><Trash2 />{locale === "de" ? "Schritt löschen" : "Delete step"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div>
    <FieldGroup className="mt-5">
      <Field><FieldLabel htmlFor="instruction">{t("instruction")}</FieldLabel><Textarea id="instruction" rows={3} value={step.instruction} onChange={event => updateStep({ instruction: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor="notes">{t("notes")}</FieldLabel><Textarea id="notes" rows={4} value={step.notes} onChange={event => updateStep({ notes: event.target.value })} /></Field>
      {step.kind !== "manual" && <Field><FieldLabel htmlFor={`application-${step.id}`}>{locale === "de" ? "Anwendung" : "Application"}</FieldLabel><Input id={`application-${step.id}`} value={step.application ?? ""} onChange={event => updateStep({ application: event.target.value || null })} /></Field>}
      <Field orientation="horizontal"><Checkbox id="included" checked={step.included} onCheckedChange={value => updateStep({ included: value === true })} /><FieldLabel htmlFor="included">{locale === "de" ? "Im Bericht anzeigen" : "Include in report"}</FieldLabel></Field>
    </FieldGroup>
    <Separator className="my-6" />
    <div className="flex items-center justify-between gap-3"><Field orientation="horizontal"><Switch id={`step-icon-${step.id}`} checked={step.showIcon !== false} onCheckedChange={value => updateStep({ showIcon: value })} /><FieldLabel htmlFor={`step-icon-${step.id}`}>{locale === "de" ? "Schrittsymbol" : "Step icon"}</FieldLabel></Field><Button variant="outline" size="sm" onClick={replaceStepIcon}><ImagePlus data-icon="inline-start" />{locale === "de" ? "Ersetzen" : "Replace"}</Button></div>
    {step.kind !== "manual" && <><Separator className="my-6" /><p className="text-sm font-semibold">{locale === "de" ? "Screenshot-Zeitpunkt" : "Screenshot moment"}</p><Tabs value={step.media.selected} onValueChange={value => updateStep({ media: { ...step.media, selected: value as "before" | "after" } })} className="mt-3"><TabsList className="w-full"><TabsTrigger value="before" className="flex-1" disabled={!step.media.beforeAsset}>{locale === "de" ? "Vorher" : "Before"}</TabsTrigger><TabsTrigger value="after" className="flex-1" disabled={!step.media.afterAsset}>{locale === "de" ? "Nachher" : "After"}</TabsTrigger></TabsList></Tabs></>}
    <Separator className="my-6" />
    <div className="flex items-center justify-between"><p className="text-sm font-semibold">{t("annotations")}</p><span className="text-xs tabular-nums text-muted-foreground">{markings.length}</span></div>
    <div data-annotation-list className="mt-3 grid gap-2">{markings.map(annotation => <AnnotationRow key={annotation.id} annotation={annotation} selected={annotation.id === selectedAnnotation?.id} onSelect={() => onSelectAnnotation(annotation.id)} remove={() => deleteAnnotation(annotation.id)} />)}</div>
    {selectedAnnotation && <AnnotationProperties annotation={selectedAnnotation} update={patch => updateAnnotation(selectedAnnotation.id, patch)} remove={() => deleteAnnotation(selectedAnnotation.id)} />}
    {step.kind !== "manual" && step.control && <div className="mt-6 rounded-xl bg-muted/65 p-3 text-xs text-muted-foreground">{step.control.controlType}{step.control.name ? ` · ${step.control.name}` : ""}</div>}
  </div>
}

function AnnotationRow({ annotation, selected, onSelect, remove }: { annotation: Annotation; selected: boolean; onSelect(): void; remove(): void }) {
  const { locale } = useLocale()
  return <div data-annotation-row={annotation.kind} role="button" tabIndex={0} onClick={onSelect} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect() } }} className={cn("flex items-center gap-2 rounded-lg border p-2 text-left", selected && "border-breadcrumb bg-breadcrumb-soft/45")}><span className="size-3 rounded-full" style={{ backgroundColor: annotation.color }} /><span className="min-w-0 flex-1 truncate text-xs">{annotationLabel(annotation.kind, locale)}</span>{annotation.protected ? <Badge variant="secondary" className="px-1.5 text-[9px]">Locked</Badge> : <Button variant="ghost" size="icon-xs" onClick={event => { event.stopPropagation(); remove() }} aria-label={locale === "de" ? "Markierung entfernen" : "Remove annotation"}><Trash2 /></Button>}</div>
}

function AnnotationProperties({ annotation, update, remove }: { annotation: Annotation; update(patch: Partial<Annotation>): void; remove(): void }) {
  const { locale, t } = useLocale()
  const hasColor = annotation.kind !== "blur"
  const hasStroke = ["clickMarker", "elementOutline", "arrow", "rectangle"].includes(annotation.kind)
  const hasRotation = ["elementOutline", "arrow", "rectangle", "text"].includes(annotation.kind)
  return <FieldGroup data-annotation-properties={annotation.kind} className="mt-4 gap-4 rounded-xl border bg-muted/25 p-3">
    {annotation.kind === "text" && <Field><FieldLabel htmlFor={`annotation-text-${annotation.id}`}>{locale === "de" ? "Text" : "Text"}</FieldLabel><Input id={`annotation-text-${annotation.id}`} value={annotation.label ?? ""} onChange={event => update({ label: event.target.value })} /></Field>}
    {hasColor && <Field orientation="horizontal"><FieldLabel className="flex-1">{t("color")}</FieldLabel><input aria-label={t("color")} type="color" value={annotation.color} onChange={event => update({ color: event.target.value })} className="size-7 cursor-pointer rounded border bg-transparent p-0" /></Field>}
    {hasStroke && <SliderField label={t("stroke")} value={annotation.strokeWidth} min={1} max={12} step={1} suffix="px" onChange={value => update({ strokeWidth: value })} />}
    {hasRotation && <SliderField label={t("rotation")} value={annotation.rotation} min={-180} max={180} step={1} suffix="°" onChange={value => update({ rotation: value })} />}
    <SliderField label={t("opacity")} value={Math.round(annotation.opacity * 100)} min={10} max={100} step={1} suffix="%" onChange={value => update({ opacity: value / 100 })} />
    {annotation.kind === "clickMarker" && <SliderField label={t("size")} value={annotation.markerSize} min={8} max={64} step={1} suffix="px" onChange={value => update({ markerSize: value })} />}
    {annotation.kind === "text" && <SliderField label={t("size")} value={annotation.markerSize} min={10} max={72} step={1} suffix="px" onChange={value => update({ markerSize: value })} />}
    {!annotation.protected && <Button variant="outline" size="sm" onClick={remove}><Trash2 data-icon="inline-start" />{t("deleteShape")}</Button>}
  </FieldGroup>
}

function SliderField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange(value: number): void }) {
  return <Field><div className="flex items-center justify-between gap-2"><FieldLabel>{label}</FieldLabel><span className="text-xs tabular-nums text-muted-foreground">{Math.round(value)}{suffix}</span></div><Slider value={[value]} min={min} max={max} step={step} onValueChange={next => onChange(Array.isArray(next) ? next[0] : next)} /></Field>
}

function BrandingPanel({ project, update }: { project: ProjectManifest; update(patch: Partial<ProjectManifest>): void }) {
  const [designs, setDesigns] = useState<DesignTemplate[]>(loadDesignTemplates)
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState("")
  const { locale, t } = useLocale()
  const themeItems = [
    { value: "crumbtrailLight", label: "Crumbtrail Light" },
    { value: "crumbtrailDark", label: "Crumbtrail Dark" },
  ]
  const typographyItems = [
    { value: "modern", label: "Modern" },
    { value: "editorial", label: "Editorial" },
    { value: "compact", label: locale === "de" ? "Kompakt" : "Compact" },
  ]
  const patchTheme = (patch: Partial<ProjectManifest["theme"]>) => update({ theme: { ...project.theme, ...patch } })
  async function chooseLogo() {
    if (!isTauri()) return toast.info("Desktop only")
    const source = await openDialog({ multiple: false, filters: [{ name: "Logo", extensions: ["png", "jpg", "jpeg"] }] })
    if (!source) return
    try { patchTheme({ logoAsset: await bridge.replaceImage(project.id, source) }) }
    catch (error) { toast.error(String(error)) }
  }
  async function saveDesign() {
    const logoDataUrl = project.theme.logoAsset ? await bridge.assetUrl(project.id, project.theme.logoAsset) : null
    setDesigns(upsertDesignTemplate(designFromProject(name, project, logoDataUrl)))
    setName("")
    setSaveOpen(false)
  }
  async function applyDesign(design: DesignTemplate) {
    try {
      const logoAsset = design.logoDataUrl ? await bridge.importAssetDataUrl(project.id, design.logoDataUrl) : null
      update({ author: design.author, description: design.description, theme: { ...project.theme, ...design.theme, reportLocale: locale, logoAsset } })
    } catch (error) { toast.error(String(error)) }
  }
  return <>
    <SheetContent className="overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>{t("appearance")}</SheetTitle></SheetHeader><div className="grid gap-6 px-4 pb-6">
      <Field><FieldLabel htmlFor="description">{locale === "de" ? "Beschreibung" : "Description"}</FieldLabel><Textarea id="description" value={project.description} onChange={event => update({ description: event.target.value })} rows={3} /></Field>
      <Field><FieldLabel htmlFor="author">{locale === "de" ? "Autor" : "Author"}</FieldLabel><Input id="author" value={project.author} onChange={event => update({ author: event.target.value })} /></Field>
      <Field><FieldLabel>{t("theme")}</FieldLabel><Select items={themeItems} value={project.theme.preset} onValueChange={value => patchTheme({ preset: value as ReportTheme })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>{t("theme")}</SelectLabel>{themeItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel>Typography</FieldLabel><Select items={typographyItems} value={project.theme.typography} onValueChange={value => patchTheme({ typography: value as TypographyPreset })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Typography</SelectLabel>{typographyItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel>{t("color")}</FieldLabel><div className="flex gap-2"><input type="color" value={project.theme.accent} onChange={event => patchTheme({ accent: event.target.value })} className="size-9 rounded-lg border bg-transparent p-1" /><Input value={project.theme.accent} onChange={event => /^#[0-9a-f]{0,6}$/i.test(event.target.value) && patchTheme({ accent: event.target.value })} /></div></Field>
      <Field><FieldLabel>Logo</FieldLabel><div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={chooseLogo}><ImagePlus data-icon="inline-start" />{project.theme.logoAsset ? (locale === "de" ? "Logo ersetzen" : "Replace logo") : (locale === "de" ? "Logo hinzufügen" : "Add logo")}</Button>{project.theme.logoAsset && <Button variant="ghost" onClick={() => patchTheme({ logoAsset: null })}>{t("remove")}</Button>}</div></Field>
      <Field orientation="horizontal"><Switch checked={project.theme.showApplicationNames} onCheckedChange={value => patchTheme({ showApplicationNames: value })} /><FieldLabel>{locale === "de" ? "Anwendungsnamen" : "Application names"}</FieldLabel></Field>
      <Field orientation="horizontal"><Switch id="project-step-icons" checked={project.theme.showIcons} onCheckedChange={value => patchTheme({ showIcons: value })} /><FieldLabel htmlFor="project-step-icons">{locale === "de" ? "Schrittsymbole" : "Step icons"}</FieldLabel></Field>
      <Field orientation="horizontal"><Switch checked={project.theme.showTimestamps} onCheckedChange={value => patchTheme({ showTimestamps: value })} /><FieldLabel>{locale === "de" ? "Zeitstempel" : "Timestamps"}</FieldLabel></Field>
      <Field orientation="horizontal"><Switch id="project-crumbtrail-branding" checked={project.theme.showCrumbtrailBranding} onCheckedChange={value => patchTheme({ showCrumbtrailBranding: value })} /><FieldLabel htmlFor="project-crumbtrail-branding">{locale === "de" ? "„Erstellt mit Crumbtrail“ anzeigen" : "Show “Created with Crumbtrail”"}</FieldLabel></Field>
      <Separator />
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">{t("savedThemes")}</p><Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}><Plus data-icon="inline-start" />{locale === "de" ? "Als Design speichern" : "Save as design"}</Button></div>
      <div className="grid gap-2">{designs.map(design => <div key={design.id} className="flex items-center gap-2 rounded-lg border p-2"><Button variant="ghost" className="min-w-0 flex-1 justify-start truncate" onClick={() => void applyDesign(design)}>{design.name}</Button><Button variant="ghost" size="icon-xs" onClick={() => setDesigns(deleteDesignTemplate(design.id))} aria-label={locale === "de" ? "Design löschen" : "Delete design"}><Trash2 /></Button></div>)}</div>
    </div></SheetContent>
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent><DialogHeader><DialogTitle>{locale === "de" ? "Als Design speichern" : "Save as design"}</DialogTitle></DialogHeader><Field><FieldLabel htmlFor="saved-design-name">{locale === "de" ? "Name" : "Name"}</FieldLabel><Input id="saved-design-name" autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.key === "Enter" && void saveDesign()} /></Field><DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>{t("cancel")}</Button><Button onClick={() => void saveDesign()} disabled={!name.trim()}>{locale === "de" ? "Design speichern" : "Save design"}</Button></DialogFooter></DialogContent></Dialog>
  </>
}

function ExportDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange(value: boolean): void; project: ProjectManifest }) {
  const [format, setFormat] = useState<ExportFormat>("html")
  const [annotated, setAnnotated] = useState(true)
  const [raw, setRaw] = useState(false)
  const [busy, setBusy] = useState(false)
  const { locale, t } = useLocale()
  async function run() {
    if (!isTauri()) return toast.info(locale === "de" ? "Export ist in der Desktop-App verfügbar" : "Export is available in the desktop build")
    const extension = format === "html" ? "html" : format === "pdf" ? "pdf" : undefined
    const destination = extension ? await saveDialog({ defaultPath: `${safeName(project.title)}.${extension}`, filters: [{ name: format.toUpperCase(), extensions: [extension] }] }) : await openDialog({ directory: true, multiple: false })
    if (!destination) return
    setBusy(true)
    try { const result = await bridge.exportProject({ project, format, destination, includeAnnotatedImages: annotated, includeRawImages: raw }); toast.success(locale === "de" ? "Export abgeschlossen" : "Export complete", { description: result.destination }); onOpenChange(false) }
    catch (error) { toast.error(locale === "de" ? "Export fehlgeschlagen" : "Export failed", { description: String(error) }) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{locale === "de" ? "Exportieren als…" : "Export as…"}</DialogTitle></DialogHeader><div className="grid gap-5">
    <div className="grid grid-cols-3 gap-2">{([['html', FileCode2, 'HTML'], ['pdf', FileText, 'PDF'], ['images', FileImage, locale === "de" ? 'Bilder' : 'Images']] as const).map(([value, Icon, label]) => <button key={value} onClick={() => setFormat(value)} className={cn("rounded-xl border p-4 text-left transition", format === value ? "border-breadcrumb bg-breadcrumb-soft/65" : "hover:bg-muted")}><Icon className="mb-4 text-breadcrumb" /><p className="text-sm font-semibold">{label}</p></button>)}</div>
    {format === "images" && <div className="grid gap-3"><Field orientation="horizontal"><Checkbox checked={annotated} onCheckedChange={value => setAnnotated(value === true)} /><FieldLabel>{locale === "de" ? "Bearbeitete Bilder" : "Annotated images"}</FieldLabel></Field><Field orientation="horizontal"><Checkbox checked={raw} onCheckedChange={value => setRaw(value === true)} /><FieldLabel>{locale === "de" ? "Originale einschließen" : "Include originals"}</FieldLabel></Field></div>}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button onClick={run} disabled={busy}>{busy ? (locale === "de" ? "Exportiert…" : "Exporting…") : t("export")}<Download data-icon="inline-end" /></Button></DialogFooter></DialogContent></Dialog>
}

export function annotationRectForView(kind: AnnotationKind, view: NormalizedRect): NormalizedRect {
  const local = kind === "clickMarker"
    ? { x: .49, y: .49, width: .02, height: .02 }
    : kind === "crop"
      ? { x: .05, y: .05, width: .9, height: .9 }
      : { x: .34, y: .34, width: .32, height: .2 }
  return {
    x: view.x + local.x * view.width,
    y: view.y + local.y * view.height,
    width: local.width * view.width,
    height: local.height * view.height,
  }
}

export function focusRect(step: Step, zoomPercent = 175): NormalizedRect {
  const source = step.control?.bounds ?? step.annotations.find(item => item.kind === "clickMarker")?.rect ?? { x: .4, y: .4, width: .2, height: .2 }
  const centerX = source.x + source.width / 2
  const centerY = source.y + source.height / 2
  const fraction = 100 / Math.max(100, Math.min(400, zoomPercent))
  const width = Math.min(1, Math.max(fraction, source.width + .08))
  const height = Math.min(1, Math.max(fraction, source.height + .08))
  return { x: Math.max(0, Math.min(1 - width, centerX - width / 2)), y: Math.max(0, Math.min(1 - height, centerY - height / 2)), width, height }
}
function safeName(value: string) { return [...value.trim()].map(character => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character).join("").replace(/[. ]+$/g, "").slice(0, 80) || "Crumbtrail guide" }

function fittedZoom(viewport: { width: number; height: number }, aspect: number) {
  if (!viewport.width || !viewport.height || !Number.isFinite(aspect) || aspect <= 0) return 1
  const byWidth = Math.max(0, viewport.width - 64) / 900
  const byHeight = Math.max(0, viewport.height - 64) * aspect / 900
  return Math.max(.35, Math.min(1.6, byWidth, byHeight))
}

function annotationLabel(kind: AnnotationKind, locale: "en" | "de") {
  const german: Record<AnnotationKind, string> = { clickMarker: "Kreis", elementOutline: "Umriss", arrow: "Pfeil", rectangle: "Rechteck", text: "Text", blur: "Unschärfe", crop: "Zuschneiden" }
  const english: Record<AnnotationKind, string> = { clickMarker: "Circle", elementOutline: "Outline", arrow: "Arrow", rectangle: "Rectangle", text: "Text", blur: "Blur", crop: "Crop" }
  return (locale === "de" ? german : english)[kind]
}
