import { useEffect, useRef, useState } from "react"
import { emit } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Check, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { bridge } from "@/lib/bridge"
import { useLocale } from "@/lib/i18n"
import type { PixelRect } from "@/types"

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Handle = "nw" | "ne" | "se" | "sw"

export function RegionSelector() {
  const [anchor, setAnchor] = useState<Point | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [complete, setComplete] = useState(false)
  const resize = useRef<{ handle: Handle; base: Rect; pointer: Point } | null>(null)
  const { t } = useLocale()
  const rectRef = useRef<Rect | null>(null)
  rectRef.current = rect

  useEffect(() => {
    void bridge.protectWindow()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void cancel()
      if (event.key === "Enter") void accept(rectRef.current)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function accept(selected = rect) {
    if (!selected || selected.width < 64 || selected.height < 64) return
    const current = getCurrentWindow()
    const position = await current.outerPosition()
    const scale = await current.scaleFactor()
    const physical: PixelRect = { x: position.x + Math.round(selected.x * scale), y: position.y + Math.round(selected.y * scale), width: Math.round(selected.width * scale), height: Math.round(selected.height * scale) }
    await emit("region://selected", physical)
    await current.close()
  }

  async function cancel() { await emit("region://cancelled"); await getCurrentWindow().close() }
  function restart() { setAnchor(null); setRect(null); setComplete(false); resize.current = null }

  function pointerDown(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("[data-controls], [data-handle]")) return
    if (complete) return
    const point = { x: event.clientX, y: event.clientY }
    if (!anchor) {
      setAnchor(point)
      setRect({ x: point.x, y: point.y, width: 0, height: 0 })
      return
    }
    setRect(normalize(anchor, point))
    setComplete(true)
  }

  function pointerMove(event: React.PointerEvent<HTMLElement>) {
    const point = { x: event.clientX, y: event.clientY }
    if (resize.current) {
      const { handle, base, pointer } = resize.current
      const dx = point.x - pointer.x
      const dy = point.y - pointer.y
      const next = {
        x: handle.includes("w") ? base.x + dx : base.x,
        y: handle.includes("n") ? base.y + dy : base.y,
        width: handle.includes("w") ? base.width - dx : base.width + dx,
        height: handle.includes("n") ? base.height - dy : base.height + dy,
      }
      setRect(normalize({ x: next.x, y: next.y }, { x: next.x + next.width, y: next.y + next.height }))
    } else if (anchor && !complete) {
      setRect(normalize(anchor, point))
    }
  }

  function beginResize(handle: Handle, event: React.PointerEvent) {
    if (!rect) return
    resize.current = { handle, base: rect, pointer: { x: event.clientX, y: event.clientY } }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.stopPropagation()
  }

  return (
    <main className="relative h-screen w-screen cursor-crosshair overflow-hidden bg-black/5 select-none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { resize.current = null }}>
      <div data-controls className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 rounded-xl bg-neutral-950/88 px-4 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur">{t("selectRegion")}</div>
      {rect && <>
        <Dim style={{ left: 0, top: 0, right: 0, height: rect.y }} />
        <Dim style={{ left: 0, top: rect.y, width: rect.x, height: rect.height }} />
        <Dim style={{ left: rect.x + rect.width, top: rect.y, right: 0, height: rect.height }} />
        <Dim style={{ left: 0, top: rect.y + rect.height, right: 0, bottom: 0 }} />
        <div className="absolute border-2 border-breadcrumb" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          {complete && <>{(["nw", "ne", "se", "sw"] as Handle[]).map(handle => <span key={handle} data-handle className="absolute size-3 rounded-full border-2 border-white bg-breadcrumb shadow" style={handleStyle(handle)} onPointerDown={event => beginResize(handle, event)} />)}</>}
          {rect.width > 130 && rect.height > 70 && <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-neutral-950/80 px-2 py-1 font-mono text-[11px] text-white">{Math.round(rect.width)} × {Math.round(rect.height)}</span>}
        </div>
      </>}
      <div data-controls className="absolute bottom-7 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border bg-background/96 p-2 shadow-xl backdrop-blur">
        <Button variant="ghost" onClick={cancel}><X data-icon="inline-start" />{t("cancel")}</Button>
        <Button variant="outline" onClick={restart} disabled={!rect}><RotateCcw data-icon="inline-start" />{t("restart")}</Button>
        <Button onClick={() => accept()} disabled={!complete || !rect || rect.width < 64 || rect.height < 64}><Check data-icon="inline-start" />{t("confirm")}</Button>
      </div>
    </main>
  )
}

function Dim({ style }: { style: React.CSSProperties }) { return <div className="pointer-events-none absolute bg-black/35" style={style} /> }
function normalize(a: Point, b: Point): Rect { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } }
function handleStyle(handle: Handle): React.CSSProperties {
  return {
    left: handle.includes("w") ? 0 : "100%",
    top: handle.includes("n") ? 0 : "100%",
    transform: "translate(-50%, -50%)",
    cursor: `${handle}-resize`,
  }
}
