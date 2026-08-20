import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Copy, EyeOff, GripVertical, Merge, Trash2 } from "lucide-react"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Step } from "@/types"

interface StepTimelineProps {
  steps: Step[]
  selectedId: string | null
  onSelect(id: string): void
  onReorder(steps: Step[]): void
  onDuplicate(id: string): void
  onMergeNext(id: string): void
  onDelete(id: string): void
}

export function StepTimeline({ steps, selectedId, onSelect, onReorder, onDuplicate, onMergeNext, onDelete }: StepTimelineProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function end(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return
    const from = steps.findIndex(step => step.id === event.active.id)
    const to = steps.findIndex(step => step.id === event.over?.id)
    if (from >= 0 && to >= 0) onReorder(arrayMove(steps, from, to))
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
    <SortableContext items={steps.map(step => step.id)} strategy={verticalListSortingStrategy}>
      <div className="grid gap-2 p-3">{steps.map((step, index) => <SortableStep key={step.id} step={step} index={index} selected={step.id === selectedId} canMerge={index < steps.length - 1} onSelect={() => onSelect(step.id)} onDuplicate={() => onDuplicate(step.id)} onMergeNext={() => onMergeNext(step.id)} onDelete={() => onDelete(step.id)} />)}</div>
    </SortableContext>
  </DndContext>
}

function SortableStep({ step, index, selected, canMerge, onSelect, onDuplicate, onMergeNext, onDelete }: { step: Step; index: number; selected: boolean; canMerge: boolean; onSelect(): void; onDuplicate(): void; onMergeNext(): void; onDelete(): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const { locale } = useLocale()
  const kind = step.kind === "textEntry" ? (locale === "de" ? "Texteingabe" : "Typing") : step.kind === "manual" ? (locale === "de" ? "Manuell" : "Manual") : (locale === "de" ? "Klick" : "Click")
  return <ContextMenu>
    <ContextMenuTrigger className="block" onContextMenu={onSelect}>
      <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group grid grid-cols-[28px_28px_minmax(0,1fr)] items-center gap-2 rounded-xl border bg-sidebar p-2 transition-colors", selected ? "border-breadcrumb bg-breadcrumb-soft/55 shadow-sm" : "border-transparent hover:border-border hover:bg-card", isDragging && "z-50 opacity-80 shadow-xl")}>
        <button type="button" className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-background active:cursor-grabbing" aria-label="Reorder step" {...attributes} {...listeners}><GripVertical className="size-4" /></button>
        <button type="button" className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums", selected ? "bg-breadcrumb text-white" : "bg-muted text-muted-foreground")} onClick={onSelect} aria-label={`Select step ${index + 1}`}>{index + 1}</button>
        <button type="button" className="min-w-0 text-left" onClick={onSelect}>
          <span className="flex items-center gap-2"><span className={cn("min-w-0 flex-1 truncate text-xs font-medium", !step.included && "text-muted-foreground line-through")}>{step.instruction || (locale === "de" ? "Unbenannter Schritt" : "Untitled step")}</span>{!step.included && <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />}</span>
          <span className="mt-1.5 block truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{step.application || kind}</span>
        </button>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-56">
      <ContextMenuGroup>
        <ContextMenuItem onClick={onDuplicate}><Copy />{locale === "de" ? "Duplizieren" : "Duplicate"}</ContextMenuItem>
        <ContextMenuItem onClick={onMergeNext} disabled={!canMerge}><Merge />{locale === "de" ? "Mit nächstem verbinden" : "Merge with next"}</ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup><ContextMenuItem variant="destructive" onClick={onDelete}><Trash2 />{locale === "de" ? "Schritt löschen" : "Delete step"}</ContextMenuItem></ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
}
