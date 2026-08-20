import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, RotateCw, Trash2 } from "lucide-react"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Annotation, NormalizedRect } from "@/types"

const FULL: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 }
const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
type Handle = typeof handles[number]

interface ScreenshotCanvasProps {
  imageUrl: string
  annotations: Annotation[]
  focusZoom?: NormalizedRect | null
  zoom: number
  cropMode: boolean
  selectedId: string | null
  onSelect(id: string | null): void
  onAnnotation(id: string, patch: Partial<Annotation>): void
  onDelete(id: string): void
  onDuplicate(id: string): void
  onFit(): void
  onActualSize(): void
  onAspectChange(aspect: number): void
}

export function ScreenshotCanvas({ imageUrl, annotations, focusZoom, zoom, cropMode, selectedId, onSelect, onAnnotation, onDelete, onDuplicate, onFit, onActualSize, onAspectChange }: ScreenshotCanvasProps) {
  const { locale, t } = useLocale()
  const [imageSize, setImageSize] = useState({ width: 16, height: 9 })
  const [drafts, setDrafts] = useState<Record<string, Partial<Annotation>>>({})
  const stage = useRef<HTMLDivElement>(null)
  const renderedAnnotations = useMemo(() => annotations.map(item => ({ ...item, ...drafts[item.id] })), [annotations, drafts])
  const crop = useMemo(() => [...renderedAnnotations].reverse().find(item => item.kind === "crop"), [renderedAnnotations])
  const view = cropMode ? FULL : crop?.rect ?? focusZoom ?? FULL
  const selected = renderedAnnotations.find(item => item.id === selectedId) ?? null
  const width = Math.max(280, 900 * zoom)
  const aspect = (imageSize.width * view.width) / (imageSize.height * view.height)

  useEffect(() => { onAspectChange(aspect) }, [aspect, onAspectChange])

  function viewRect(rect: NormalizedRect): NormalizedRect {
    return { x: (rect.x - view.x) / view.width, y: (rect.y - view.y) / view.height, width: rect.width / view.width, height: rect.height / view.height }
  }

  function beginMove(event: React.PointerEvent, annotation: Annotation) {
    if (event.button !== 0) return
    if (annotation.protected || annotation.kind === "crop" && !cropMode) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(annotation.id)
    const bounds = stage.current?.getBoundingClientRect()
    if (!bounds) return
    const origin = { x: event.clientX, y: event.clientY, rect: annotation.rect }
    let latest = origin.rect
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - origin.x) / bounds.width * view.width
      const dy = (next.clientY - origin.y) / bounds.height * view.height
      latest = clampRect({ ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy })
      setDrafts(current => ({ ...current, [annotation.id]: { ...current[annotation.id], rect: latest } }))
    }
    listen(move, () => commitDraft(annotation.id, { rect: latest }))
  }

  function beginResize(event: React.PointerEvent, annotation: Annotation, handle: Handle) {
    event.preventDefault()
    event.stopPropagation()
    const bounds = stage.current?.getBoundingClientRect()
    if (!bounds) return
    const origin = { x: event.clientX, y: event.clientY, rect: annotation.rect }
    let latest = origin.rect
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - origin.x) / bounds.width * view.width
      const dy = (next.clientY - origin.y) / bounds.height * view.height
      let left = origin.rect.x
      let top = origin.rect.y
      let right = origin.rect.x + origin.rect.width
      let bottom = origin.rect.y + origin.rect.height
      if (handle.includes("w")) left += dx
      if (handle.includes("e")) right += dx
      if (handle.includes("n")) top += dy
      if (handle.includes("s")) bottom += dy
      if (right < left) [left, right] = [right, left]
      if (bottom < top) [top, bottom] = [bottom, top]
      latest = clampRect({ x: left, y: top, width: Math.max(.01, right - left), height: Math.max(.01, bottom - top) })
      setDrafts(current => ({ ...current, [annotation.id]: { ...current[annotation.id], rect: latest } }))
    }
    listen(move, () => commitDraft(annotation.id, { rect: latest }))
  }

  function beginRotate(event: React.PointerEvent, annotation: Annotation) {
    event.preventDefault()
    event.stopPropagation()
    const bounds = stage.current?.getBoundingClientRect()
    if (!bounds) return
    const center = { x: bounds.left + ((annotation.rect.x - view.x + annotation.rect.width / 2) / view.width) * bounds.width, y: bounds.top + ((annotation.rect.y - view.y + annotation.rect.height / 2) / view.height) * bounds.height }
    let latest = annotation.rotation
    const move = (next: PointerEvent) => {
      latest = Math.round(Math.atan2(next.clientY - center.y, next.clientX - center.x) * 180 / Math.PI + 90)
      setDrafts(current => ({ ...current, [annotation.id]: { ...current[annotation.id], rotation: latest } }))
    }
    listen(move, () => commitDraft(annotation.id, { rotation: latest }))
  }

  function commitDraft(id: string, patch: Partial<Annotation>) {
    setDrafts(current => { const next = { ...current }; delete next[id]; return next })
    onAnnotation(id, patch)
  }

  function listen(move: (event: PointerEvent) => void, finish: () => void) {
    const up = () => { finish(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up) }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <div ref={stage} data-canvas-stage className="crumb-shadow relative shrink-0 overflow-hidden rounded-xl border bg-card" style={{ width, aspectRatio: aspect }} onPointerDown={() => onSelect(null)}>
          {imageUrl ? <img src={imageUrl} alt="" className="pointer-events-none absolute select-none" draggable={false} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: `${100 / view.width}%`, maxWidth: "none", height: "auto", left: `${-view.x / view.width * 100}%`, top: `${-view.y / view.height * 100}%` }} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>}
          {renderedAnnotations.filter(annotation => annotation.kind !== "crop" && intersects(annotation.rect, view)).sort((a, b) => a.zIndex - b.zIndex).map(annotation => {
            const rect = viewRect(annotation.rect)
            const isSelected = annotation.id === selectedId
            return <AnnotationShape key={annotation.id} annotation={annotation} rect={rect} selected={isSelected} onPointerDown={event => beginMove(event, annotation)} onContextMenu={() => onSelect(annotation.id)}>
              {isSelected && !annotation.protected && <TransformHandles onResize={(event, handle) => beginResize(event, annotation, handle)} onRotate={event => beginRotate(event, annotation)} />}
            </AnnotationShape>
          })}
          {cropMode && crop && <CropOverlay crop={crop} selected={crop.id === selectedId} onPointerDown={event => beginMove(event, crop)} onResize={(event, handle) => beginResize(event, crop, handle)} onSelect={() => onSelect(crop.id)} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {selected ? <ContextMenuGroup>
          <ContextMenuItem disabled={selected.protected} onClick={() => onDuplicate(selected.id)}><Copy />{t("duplicate")}</ContextMenuItem>
          <ContextMenuItem disabled={selected.protected} onClick={() => onAnnotation(selected.id, { zIndex: selected.zIndex + 1 })}>{locale === "de" ? "Nach vorne" : "Bring forward"}</ContextMenuItem>
          <ContextMenuItem disabled={selected.protected} onClick={() => onAnnotation(selected.id, { zIndex: selected.zIndex - 1 })}>{locale === "de" ? "Nach hinten" : "Send backward"}</ContextMenuItem>
          <ContextMenuItem disabled={selected.protected} onClick={() => onAnnotation(selected.id, { rotation: 0 })}><RotateCw />{locale === "de" ? "Drehung zurücksetzen" : "Reset rotation"}</ContextMenuItem>
          <ContextMenuItem variant="destructive" disabled={selected.protected} onClick={() => onDelete(selected.id)}><Trash2 />{locale === "de" ? "Löschen" : "Delete"}</ContextMenuItem>
        </ContextMenuGroup> : <ContextMenuGroup><ContextMenuItem onClick={onFit}>{t("fit")}</ContextMenuItem><ContextMenuItem onClick={onActualSize}>100%</ContextMenuItem></ContextMenuGroup>}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function AnnotationShape({ annotation, rect, selected, onPointerDown, onContextMenu, children }: { annotation: Annotation; rect: NormalizedRect; selected: boolean; onPointerDown(event: React.PointerEvent): void; onContextMenu(): void; children?: React.ReactNode }) {
  const style: React.CSSProperties = { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, color: annotation.color, opacity: annotation.opacity, transform: `rotate(${annotation.rotation}deg)`, zIndex: annotation.zIndex + 10 }
  return <div className={cn("absolute cursor-move touch-none", selected && "outline outline-1 outline-offset-2 outline-blue-500", annotation.kind === "blur" && "bg-white/10 backdrop-blur-md")} style={style} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
    {annotation.kind === "clickMarker" && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-current/20 shadow-[0_0_0_2px_rgba(255,255,255,.8)]" style={{ width: annotation.markerSize, height: annotation.markerSize, borderWidth: annotation.strokeWidth, borderColor: annotation.color }} />}
    {["elementOutline", "rectangle"].includes(annotation.kind) && <span className="absolute inset-0 rounded-sm border" style={{ borderWidth: annotation.strokeWidth, borderColor: annotation.color }} />}
    {annotation.kind === "arrow" && <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current after:absolute after:right-0 after:top-1/2 after:size-3 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-t-2 after:border-current" />}
    {annotation.kind === "text" && <span className="absolute inset-0 flex items-center justify-center rounded-md bg-neutral-950/85 px-2 text-center text-xs font-semibold text-white shadow-lg">{annotation.label || "Text"}</span>}
    {children}
  </div>
}

function TransformHandles({ onResize, onRotate }: { onResize(event: React.PointerEvent, handle: Handle): void; onRotate(event: React.PointerEvent): void }) {
  return <>{handles.map(handle => <span key={handle} className="absolute z-30 size-2.5 rounded-[2px] border border-blue-600 bg-white shadow" style={handlePosition(handle)} onPointerDown={event => onResize(event, handle)} />)}<span className="absolute left-1/2 top-[-31px] z-30 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border border-blue-600 bg-white text-blue-600 shadow" onPointerDown={onRotate}><RotateCw className="size-3" /></span><span className="absolute left-1/2 top-[-12px] h-3 w-px -translate-x-1/2 bg-blue-600" /></>
}

function CropOverlay({ crop, selected, onPointerDown, onResize, onSelect }: { crop: Annotation; selected: boolean; onPointerDown(event: React.PointerEvent): void; onResize(event: React.PointerEvent, handle: Handle): void; onSelect(): void }) {
  const { rect } = crop
  return <>
    <div className="pointer-events-none absolute left-0 top-0 w-full bg-black/45" style={{ height: `${rect.y * 100}%` }} />
    <div className="pointer-events-none absolute left-0 bg-black/45" style={{ top: `${rect.y * 100}%`, width: `${rect.x * 100}%`, height: `${rect.height * 100}%` }} />
    <div className="pointer-events-none absolute right-0 bg-black/45" style={{ top: `${rect.y * 100}%`, width: `${Math.max(0, 1 - rect.x - rect.width) * 100}%`, height: `${rect.height * 100}%` }} />
    <div className="pointer-events-none absolute bottom-0 left-0 w-full bg-black/45" style={{ height: `${Math.max(0, 1 - rect.y - rect.height) * 100}%` }} />
    <div className={cn("absolute cursor-move border-2 border-white shadow-[0_0_0_1px_#000]", selected && "border-blue-500")} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} onPointerDown={event => { onSelect(); onPointerDown(event) }}>
      {handles.map(handle => <span key={handle} className="absolute size-3 rounded-[2px] border border-blue-600 bg-white shadow" style={handlePosition(handle)} onPointerDown={event => onResize(event, handle)} />)}
    </div>
  </>
}

function handlePosition(handle: Handle): React.CSSProperties {
  const horizontal = handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%"
  const vertical = handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%"
  const cursor = handle === "n" || handle === "s" ? "ns-resize" : handle === "e" || handle === "w" ? "ew-resize" : `${handle}-resize`
  return { left: horizontal, top: vertical, transform: "translate(-50%, -50%)", cursor }
}

function clampRect(rect: NormalizedRect): NormalizedRect {
  const width = Math.min(1, Math.max(.01, rect.width))
  const height = Math.min(1, Math.max(.01, rect.height))
  return { x: Math.max(0, Math.min(1 - width, rect.x)), y: Math.max(0, Math.min(1 - height, rect.y)), width, height }
}
function intersects(rect: NormalizedRect, view: NormalizedRect) { return rect.x + rect.width > view.x && rect.x < view.x + view.width && rect.y + rect.height > view.y && rect.y < view.y + view.height }
