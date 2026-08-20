import { cn } from "@/lib/utils"

export function CrumbMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative block size-8 shrink-0", className)} aria-hidden="true">
      <span className="absolute left-0 top-3.5 size-2 rounded-full bg-breadcrumb" />
      <span className="absolute left-2.5 top-1.5 size-2.5 rounded-full bg-breadcrumb" />
      <span className="absolute bottom-0 right-0 size-3.5 rounded-full bg-foreground" />
    </span>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <CrumbMark />
      {!compact && <span className="text-[17px] font-semibold tracking-[-0.025em]">Crumbtrail</span>}
    </div>
  )
}
