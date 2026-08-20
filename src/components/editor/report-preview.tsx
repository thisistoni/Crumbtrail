import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bridge } from "@/lib/bridge"
import { useLocale } from "@/lib/i18n"
import type { ProjectManifest } from "@/types"

export function ReportPreview({ open, onOpenChange, project }: { open: boolean; onOpenChange(value: boolean): void; project: ProjectManifest }) {
  const [html, setHtml] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { locale, t } = useLocale()

  const render = useCallback(async () => {
    setBusy(true)
    setError("")
    try { setHtml(await bridge.renderPreview(project)) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }, [project])

  useEffect(() => { if (open) void render() }, [open, render])

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false} className="!top-0 !left-0 flex h-screen w-screen !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!max-w-none">
      <DialogHeader className="h-14 shrink-0 flex-row items-center gap-3 border-b px-4 py-0">
        <DialogTitle>{t("preview")}</DialogTitle>
        <Button className="ml-auto" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={locale === "de" ? "Schließen" : "Close"}><X /></Button>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/65">
        {busy && !html ? <div className="flex h-full items-center justify-center"><LoaderCircle className="animate-spin text-muted-foreground" /></div> : error ? <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div> : <FittedPreview html={html} title={t("preview")} />}
      </div>
    </DialogContent>
  </Dialog>
}

function FittedPreview({ html, title }: { html: string; title: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const dimensions = { width: 794, height: 1123 }
  const scale = available.width && available.height ? Math.max(.1, Math.min(1, (available.width - 48) / dimensions.width, (available.height - 48) / dimensions.height)) : 1

  useEffect(() => {
    const element = host.current
    if (!element) return
    const update = () => setAvailable({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={host} className="flex size-full items-center justify-center overflow-hidden p-6">
    <div className="relative shrink-0" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
      <iframe title={title} className="absolute left-0 top-0 block rounded-lg border bg-white shadow-xl" style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${scale})`, transformOrigin: "top left" }} sandbox="" srcDoc={html} />
    </div>
  </div>
}
