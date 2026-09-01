import { useEffect, useRef, useState } from "react"
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { bridge } from "@/lib/bridge"
import { whenNativeWindowReady } from "@/lib/native-window"
import { cn } from "@/lib/utils"
import type { CaptureTargetDescriptor, ClickPulse, RecordingStateSnapshot } from "@/types"

interface VisiblePulse extends ClickPulse {
  id: number
  left: number
  top: number
}

export function RecordingOverlay() {
  const snapshot = useRef<RecordingStateSnapshot>({ status: "recording", stepCount: 0, sessionStepCount: 0, elapsedMs: 0 })
  const pulseId = useRef(0)
  const [paused, setPaused] = useState(false)
  const [pulses, setPulses] = useState<VisiblePulse[]>([])

  useEffect(() => {
    const overlay = getCurrentWindow()
    const unlisteners: (() => void)[] = []
    let disposed = false

    async function applyState(next: RecordingStateSnapshot) {
      if (disposed) return
      snapshot.current = next
      setPaused(next.status === "paused")
      if (next.status === "idle") {
        await whenNativeWindowReady(() => overlay.close())
        return
      }
      const target = next.target
      if (target) {
        await whenNativeWindowReady(() =>
          overlay.setPosition(new PhysicalPosition(target.bounds.x, target.bounds.y)),
        )
        await whenNativeWindowReady(() =>
          overlay.setSize(new PhysicalSize(target.bounds.width, target.bounds.height)),
        )
      }
    }

    void (async () => {
      await whenNativeWindowReady(() => bridge.protectWindow())
      await whenNativeWindowReady(() => overlay.setIgnoreCursorEvents(true))
      await applyState(await bridge.recordingState())
      await whenNativeWindowReady(() => overlay.show())
    })().catch(() => undefined)
    void bridge.on<RecordingStateSnapshot>("recording://state", next => { void applyState(next) }).then(stop => unlisteners.push(stop))
    void bridge.on<ClickPulse>("recording://click-pulse", pulse => {
      const target = snapshot.current.target
      if (!target || snapshot.current.status !== "recording") return
      const position = clickPulsePosition(pulse, target)
      const id = ++pulseId.current
      setPulses(current => [...current.slice(-4), { ...pulse, ...position, id }])
      window.setTimeout(() => setPulses(current => current.filter(item => item.id !== id)), 700)
    }).then(stop => unlisteners.push(stop))
    const targetPoll = window.setInterval(() => { void bridge.recordingState().then(applyState) }, 350)
    return () => {
      disposed = true
      window.clearInterval(targetPoll)
      unlisteners.forEach(stop => stop())
    }
  }, [])

  return (
    <main className="pointer-events-none relative h-screen w-screen overflow-hidden bg-transparent" aria-hidden="true">
      <div className={cn(
        "absolute inset-0 rounded-sm border-[3px]",
        paused
          ? "border-breadcrumb/90 shadow-[inset_0_0_12px_color-mix(in_oklab,var(--breadcrumb)_28%,transparent)]"
          : "border-destructive/90 shadow-[inset_0_0_12px_color-mix(in_oklab,var(--destructive)_28%,transparent)]",
      )} />
      {pulses.map(pulse => (
        <span
          key={pulse.id}
          className="recording-click-pulse absolute size-8 rounded-full border-[3px] border-destructive bg-destructive/15 shadow-[0_0_0_3px_rgba(255,255,255,.88),0_4px_18px_color-mix(in_oklab,var(--destructive)_38%,transparent)]"
          style={{ left: pulse.left, top: pulse.top }}
        />
      ))}
    </main>
  )
}

export function clickPulsePosition(pulse: ClickPulse, target: CaptureTargetDescriptor) {
  const scale = target.scaleFactor > 0 ? target.scaleFactor : 1
  return {
    left: (pulse.x - target.bounds.x) / scale,
    top: (pulse.y - target.bounds.y) / scale,
  }
}
