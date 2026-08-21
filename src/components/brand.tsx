import { cn } from "@/lib/utils"
import crumbtrailLogo from "@/assets/brand/crumbtrail-logo.png"

export function CrumbMark({ className }: { className?: string }) {
  return <img data-crumbtrail-mark src={crumbtrailLogo} alt="" className={cn("size-9 shrink-0 object-contain", className)} aria-hidden="true" />
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <CrumbMark />
      {!compact && <span className="text-[17px] font-semibold tracking-[-0.025em]">Crumbtrail</span>}
    </div>
  )
}
