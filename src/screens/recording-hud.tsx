import { useEffect, useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Camera, CircleStop, Pause, Play, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bridge } from "@/lib/bridge"
import { useLocale } from "@/lib/i18n"
import { whenNativeWindowReady } from "@/lib/native-window"
import { shortcutLabel, useSettings } from "@/lib/settings"
import type { RecordingStateSnapshot } from "@/types"

export function RecordingHud() {
  const { t } = useLocale()
  const { settings } = useSettings()
  const [state, setState] = useState<RecordingStateSnapshot>({ status: "recording", stepCount: 0, sessionStepCount: 0, elapsedMs: 0 })
  const [manualBaseStepCount, setManualBaseStepCount] = useState<number | null>(null)
  const manualPending = useRef(false)
  const [localStart] = useState(Date.now())

  useEffect(() => {
    const hud = getCurrentWindow()
    void (async () => {
      await whenNativeWindowReady(() => bridge.protectWindow())
      await whenNativeWindowReady(() => hud.show())
    })().catch(() => undefined)
    const unlisteners: (() => void)[] = []
    bridge.recordingState().then(setState)
    bridge.on<RecordingStateSnapshot>("recording://state", next => { setState(next); if (next.status === "idle") void getCurrentWindow().close() }).then(stop => unlisteners.push(stop))
    bridge.on<string>("recording://recoverable-error", message => toast.error(message, { duration: 10000 })).then(stop => unlisteners.push(stop))
    const timer = window.setInterval(() => setState(current => ({ ...current, elapsedMs: current.status === "recording" ? Math.max(current.elapsedMs, Date.now() - localStart) : current.elapsedMs })), 500)
    return () => { clearInterval(timer); unlisteners.forEach(stop => stop()) }
  }, [localStart])

  const paused = state.status === "paused"
  const displayedStepCount = optimisticManualStepCount(state.stepCount, manualBaseStepCount)
  async function togglePause() { setState(paused ? await bridge.resume() : await bridge.pause()) }
  async function stop() { await bridge.stop(); await getCurrentWindow().close() }
  async function manualCapture() {
    if (paused || manualPending.current) return
    manualPending.current = true
    setManualBaseStepCount(state.stepCount)
    try {
      setState(await bridge.manual())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      manualPending.current = false
      setManualBaseStepCount(null)
    }
  }

  return (
    <main className="drag-region h-screen w-screen overflow-hidden rounded-[20px] bg-transparent">
      <div className="flex h-full w-full items-center gap-3 overflow-hidden rounded-[20px] border border-border bg-card px-3">
        <div className="flex items-center gap-2 px-2">
          <span className={`size-2.5 rounded-full ${paused ? "bg-breadcrumb" : "animate-pulse bg-red-500"}`} />
          <div><p className="text-xs font-semibold">{paused ? t("paused") : t("recording")}</p><p className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatDuration(state.elapsedMs)}</p></div>
        </div>
        <Separator orientation="vertical" data-hud-separator />
        <div className="min-w-16 text-center"><p className="text-lg font-semibold tabular-nums">{displayedStepCount}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("steps")}</p></div>
        <Separator orientation="vertical" data-hud-separator />
        <div className="no-drag flex items-center gap-1">
          <HudButton label={`${t("manualCapture")} · ${shortcutLabel(settings.shortcuts.manualCapture)}`} onClick={manualCapture} disabled={paused || manualBaseStepCount !== null}><Camera className={manualBaseStepCount !== null ? "animate-pulse" : undefined} /></HudButton>
          <HudButton label={t("undo")} onClick={() => bridge.undoRecorded()} disabled={state.sessionStepCount === 0}><RotateCcw /></HudButton>
          <HudButton label={`${paused ? t("resume") : t("pause")} · ${shortcutLabel(settings.shortcuts.pauseResume)}`} onClick={togglePause}>{paused ? <Play /> : <Pause />}</HudButton>
        </div>
        <div className="no-drag ml-auto"><Button variant="destructive" className="h-10 rounded-xl px-3" onClick={stop} title={shortcutLabel(settings.shortcuts.stopRecording)}><CircleStop data-icon="inline-start" />{t("stop")}</Button></div>
      </div>
    </main>
  )
}

function HudButton({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled?: boolean; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-lg" onClick={onClick} disabled={disabled} aria-label={label} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

export function optimisticManualStepCount(stepCount: number, pendingBaseStepCount: number | null) {
  return pendingBaseStepCount !== null && stepCount <= pendingBaseStepCount ? pendingBaseStepCount + 1 : stepCount
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000); const minutes = Math.floor(total / 60); const seconds = total % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
