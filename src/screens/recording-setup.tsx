import { useState } from "react"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { LogicalSize } from "@tauri-apps/api/dpi"
import { ArrowLeft, ArrowRight, Check, EyeOff, Keyboard, LoaderCircle, Monitor, MousePointer2, RectangleHorizontal, SquareDashedMousePointer, AppWindow } from "lucide-react"
import { toast } from "sonner"
import { Brand } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { bridge, isTauri } from "@/lib/bridge"
import { useLocale } from "@/lib/i18n"
import { functionKeyCode, shortcutLabel, useSettings } from "@/lib/settings"
import type { CaptureTargetDescriptor, CaptureTargetKind, PixelRect, ProjectManifest, RecordingOptions } from "@/types"

interface SetupProps {
  project: ProjectManifest
  onBack(): void
  onProject(project: ProjectManifest): void
  onStarted(): void
}

const targets: { kind: CaptureTargetKind; icon: typeof Monitor }[] = [
  { kind: "monitor", icon: Monitor },
  { kind: "window", icon: AppWindow },
  { kind: "region", icon: SquareDashedMousePointer },
]

export function RecordingSetup({ project, onBack, onProject, onStarted }: SetupProps) {
  const { locale, t } = useLocale()
  const { settings } = useSettings()
  const [options, setOptions] = useState<RecordingOptions>(() => ({
    ...project.capture,
    instructionLocale: locale,
    defaultFocusZoom: settings.defaultAutoFocus,
    defaultFocusZoomPercent: settings.autoFocusZoomPercent,
    defaultStrokeWidth: settings.defaultStrokeWidth,
    manualShortcutKey: functionKeyCode(settings.shortcuts.manualCapture),
    pauseShortcutKey: functionKeyCode(settings.shortcuts.pauseResume),
    stopShortcutKey: functionKeyCode(settings.shortcuts.stopRecording),
  }))
  const [target, setTarget] = useState<CaptureTargetDescriptor | null>(null)
  const [region, setRegion] = useState<PixelRect | null>(null)
  const [displayChoices, setDisplayChoices] = useState<CaptureTargetDescriptor[]>([])
  const [displayPreviews, setDisplayPreviews] = useState<Record<string, string>>({})
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [starting, setStarting] = useState(false)

  const patchOption = <K extends keyof RecordingOptions>(key: K, value: RecordingOptions[K]) => setOptions(current => ({ ...current, [key]: value }))

  function changeTargetKind(kind: CaptureTargetKind) {
    patchOption("targetKind", kind)
    setTarget(null)
    setRegion(null)
    setDisplayPickerOpen(false)
  }

  async function chooseTarget() {
    setSelecting(true)
    try {
      if (options.targetKind !== "window") {
        const displays = await bridge.listTargets(options.targetKind)
        if (!displays.length) throw new Error(locale === "de" ? "Keine aktiven Bildschirme gefunden" : "No active displays were found")
        setDisplayChoices(displays)
        setDisplayPreviews({})
        setDisplayPickerOpen(true)
        void Promise.all(displays.map(async display => {
          try {
            const preview = await bridge.targetThumbnail(display)
            setDisplayPreviews(current => ({ ...current, [display.id]: preview }))
          } catch {
            setDisplayPreviews(current => ({ ...current, [display.id]: "" }))
          }
        }))
        return
      }
      await applyTarget(await bridge.selectTarget(options.targetKind))
    } catch (error) {
      if (!String(error).toLowerCase().includes("cancel")) toast.error(locale === "de" ? "Quelle konnte nicht ausgewählt werden" : "Could not select that source", { description: String(error) })
    } finally { setSelecting(false) }
  }

  async function chooseDisplay(display: CaptureTargetDescriptor) {
    setDisplayPickerOpen(false)
    setSelecting(true)
    try { await applyTarget(await bridge.selectTarget(options.targetKind, display.id)) }
    catch (error) { toast.error(locale === "de" ? "Bildschirm konnte nicht ausgewählt werden" : "Could not select that display", { description: String(error) }) }
    finally { setSelecting(false) }
  }

  async function applyTarget(selected: CaptureTargetDescriptor) {
    setTarget(selected)
    if (options.targetKind === "region") setRegion(await selectRegion(selected))
    else setRegion(null)
  }

  async function start() {
    if (!target) return chooseTarget()
    setStarting(true)
    let recorderStarted = false
    try {
      const updated = await bridge.autosave({ ...project, capture: options })
      onProject(updated)
      await bridge.startRecording(project.id, options, region)
      recorderStarted = true
      await openHud()
      onStarted()
    } catch (error) {
      if (recorderStarted) await bridge.stop().catch(() => undefined)
      toast.error(locale === "de" ? "Aufnahme konnte nicht gestartet werden" : "Recording could not start", { description: String(error) })
    }
    finally { setStarting(false) }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3"><Button variant="ghost" onClick={onBack}><ArrowLeft data-icon="inline-start" />{t("back")}</Button><Separator orientation="vertical" className="h-5" /><Brand /></div>
        <span className="text-sm font-medium">{t("recordingSetup")}</span>
      </header>
      <div className="mx-auto grid max-w-[1120px] gap-6 px-8 py-7 lg:grid-cols-[1fr_340px]">
        <section>
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">{t("chooseTarget")}</h1>

          <ToggleGroup value={[options.targetKind]} onValueChange={value => value[0] && changeTargetKind(value[0] as CaptureTargetKind)} className="mt-5 grid w-full grid-cols-3 gap-3" aria-label="Capture target type">
            {targets.map(item => {
              const Icon = item.icon
              const active = options.targetKind === item.kind
              return (
                <ToggleGroupItem key={item.kind} value={item.kind} variant="outline" className="h-20 items-center justify-start gap-3 rounded-xl px-4 text-left whitespace-normal data-pressed:border-breadcrumb data-pressed:bg-breadcrumb-soft/70">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-breadcrumb text-white" : "bg-muted text-muted-foreground"}`}><Icon /></span>
                  <span className="font-semibold">{item.kind === "monitor" ? t("display") : item.kind === "window" ? t("window") : t("region")}</span>
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>

          <Card className="mt-5 overflow-hidden border-dashed">
            <CardContent className="flex min-h-20 items-center justify-between gap-4 py-3">
              {target ? (
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-breadcrumb-soft text-breadcrumb"><Check /></div>
                  <div className="min-w-0"><p className="truncate font-medium">{target.label}</p><p className="mt-1 text-xs text-muted-foreground">{region ? `${region.width} × ${region.height} region` : `${target.bounds.width} × ${target.bounds.height}`} · {Math.round(target.scaleFactor * 100)}% scaling</p></div>
                </div>
              ) : (
                <p className="font-medium">{t("noSource")}</p>
              )}
              <Button variant={target ? "outline" : "default"} onClick={chooseTarget} disabled={selecting}>
                {selecting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RectangleHorizontal data-icon="inline-start" />}
                {selecting ? t("waitingWindows") : target ? t("chooseAgain") : t("chooseSource")}
              </Button>
            </CardContent>
          </Card>

          <div className="mt-7">
            <h2 className="mb-3 text-xl font-semibold tracking-tight">{t("captureSteps")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <OptionCard icon={MousePointer2} title={t("leftClicks")} checked={options.captureLeftClicks} onChecked={value => patchOption("captureLeftClicks", value)} />
              <OptionCard icon={MousePointer2} title={t("rightClicks")} checked={options.captureRightClicks} onChecked={value => patchOption("captureRightClicks", value)} />
              <OptionCard icon={Keyboard} title={t("typingGroups")} description={locale === "de" ? "Eingetippter Text wird nie gespeichert." : "Entered text is never stored."} checked={options.captureTypingGroups} onChecked={value => patchOption("captureTypingGroups", value)} />
              <OptionCard icon={EyeOff} title={t("passwordRedaction")} description={locale === "de" ? "Passwortfelder werden vor dem Speichern geschwärzt." : "Password fields are redacted before saving."} checked={options.redactPasswords} onChecked={value => patchOption("redactPasswords", value)} locked />
            </div>
          </div>
        </section>

        <aside>
          <Card className="sticky top-8 border-breadcrumb/25 bg-card/95 shadow-lg">
            <CardHeader className="pb-1"><CardTitle>{t("ready")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="rounded-xl bg-muted/70 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("shortcuts")}</p>
                <Shortcut keys={shortcutLabel(settings.shortcuts.manualCapture)} label={t("manualCapture")} />
                <Shortcut keys={shortcutLabel(settings.shortcuts.pauseResume)} label={t("pauseResume")} />
                <Shortcut keys={shortcutLabel(settings.shortcuts.stopRecording)} label={t("stopRecording")} />
              </div>
              <Button size="lg" className="h-11" onClick={start} disabled={starting || selecting}>
                {starting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <span className="size-2 rounded-full bg-red-400" />}
                {target ? t("startRecording") : t("selectContinue")}<ArrowRight data-icon="inline-end" />
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
      <Dialog open={displayPickerOpen} onOpenChange={setDisplayPickerOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>{t("chooseDisplay")}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {displayChoices.map(display => (
              <Button key={display.id} variant="outline" className="h-auto min-w-0 flex-col items-stretch gap-0 overflow-hidden p-0 text-left" onClick={() => chooseDisplay(display)}>
                <span className="aspect-video w-full overflow-hidden bg-muted">
                  {displayPreviews[display.id] ? <img src={displayPreviews[display.id]} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center"><LoaderCircle className="animate-spin text-muted-foreground" /></span>}
                </span>
                <span className="flex min-w-0 items-center justify-between gap-3 border-t px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2"><Monitor className="size-4 shrink-0" /><span className="truncate font-medium">{display.label}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{display.bounds.width} × {display.bounds.height}</span>
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function OptionCard({ icon: Icon, title, description, checked, onChecked, locked = false }: { icon: typeof Keyboard; title: string; description?: string; checked: boolean; onChecked(value: boolean): void; locked?: boolean }) {
  return <Card><CardContent className="flex items-start gap-3 py-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><Field className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><FieldLabel>{title}</FieldLabel><Switch checked={checked} onCheckedChange={onChecked} disabled={locked} /></div>{description && <FieldDescription className="text-xs">{description}</FieldDescription>}</Field></CardContent></Card>
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{label}</span><kbd className="rounded-md border bg-card px-2 py-1 font-mono text-[10px] shadow-sm">{keys}</kbd></div>
}

async function openHud() {
  if (!isTauri()) return
  const existing = await WebviewWindow.getByLabel("recorder-hud")
  if (existing) { await existing.setSize(new LogicalSize(554, 68)); await existing.show(); return }
  const hud = new WebviewWindow("recorder-hud", { url: "/?surface=hud", title: "Crumbtrail recorder", width: 554, height: 68, x: 520, y: 24, decorations: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focus: true, shadow: false })
  await new Promise<void>((resolve, reject) => {
    void hud.once("tauri://created", () => resolve())
    void hud.once("tauri://error", event => reject(event.payload))
  })
}

async function selectRegion(target: CaptureTargetDescriptor): Promise<PixelRect> {
  if (!isTauri()) return { x: target.bounds.x + 180, y: target.bounds.y + 120, width: target.bounds.width - 360, height: target.bounds.height - 240 }
  let resolveSelection: (value: PixelRect) => void = () => undefined
  let rejectSelection: (reason: Error) => void = () => undefined
  const selection = new Promise<PixelRect>((resolve, reject) => { resolveSelection = resolve; rejectSelection = reject })
  let stopSelected: () => void = () => undefined
  let stopCancelled: () => void = () => undefined
  stopSelected = await bridge.on<PixelRect>("region://selected", payload => { stopSelected(); stopCancelled(); resolveSelection(payload) })
  stopCancelled = await bridge.on<void>("region://cancelled", () => { stopSelected(); stopCancelled(); rejectSelection(new Error("Region selection was cancelled")) })
  const scale = target.scaleFactor || 1
  const existing = await WebviewWindow.getByLabel("region-selector"); if (existing) await existing.close()
  new WebviewWindow("region-selector", {
    url: "/?surface=region", title: "Select a Crumbtrail region",
    x: target.bounds.x / scale, y: target.bounds.y / scale, width: target.bounds.width / scale, height: target.bounds.height / scale,
    decorations: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focus: true,
  })
  return selection
}
