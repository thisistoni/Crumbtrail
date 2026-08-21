import { useEffect, useState, type SyntheticEvent } from "react"
import { AppWindow } from "lucide-react"
import { bridge } from "@/lib/bridge"
import { cn } from "@/lib/utils"

export type ApplicationIconTone = "light" | "dark" | "mixed"

interface ApplicationIconProps {
  projectId: string
  name?: string | null
  asset?: string | null
  size?: "sm" | "md" | "lg" | "xl"
  variant?: "framed" | "plain" | "adaptive"
  className?: string
}

export function ApplicationIcon({ projectId, name, asset, size = "md", variant = "framed", className }: ApplicationIconProps) {
  const [source, setSource] = useState("")
  const [tone, setTone] = useState<ApplicationIconTone>("mixed")

  useEffect(() => {
    let active = true
    setSource("")
    setTone("mixed")
    if (asset) bridge.assetUrl(projectId, asset).then(value => { if (active) setSource(value) }).catch(() => undefined)
    return () => { active = false }
  }, [asset, projectId])

  const label = applicationLabel(name)
  const inspectTone = (event: SyntheticEvent<HTMLImageElement>) => {
    if (variant !== "adaptive") return
    try { setTone(classifyApplicationIcon(event.currentTarget)) }
    catch { setTone("mixed") }
  }
  return (
    <span
      data-application-icon
      data-variant={variant}
      data-icon-tone={variant === "adaptive" ? tone : undefined}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden text-muted-foreground",
        variant === "framed"
          ? "rounded-lg border bg-card shadow-xs"
          : variant === "adaptive"
            ? "application-icon-adaptive rounded-full border"
            : "rounded-none border-0 bg-transparent shadow-none",
        size === "sm" ? "size-7" : size === "lg" ? "size-11" : size === "xl" ? "size-24" : "size-9",
        className,
      )}
    >
      {source ? <img src={source} alt={name || ""} className={cn("size-full object-contain", variant === "framed" && "p-1", variant === "adaptive" && "p-2")} draggable={false} onLoad={inspectTone} /> : label ? <span className={cn("font-semibold uppercase", size === "xl" ? "text-2xl" : "text-[10px]")}>{label}</span> : <AppWindow className={size === "sm" ? "size-3.5" : size === "xl" ? "size-10" : "size-4"} aria-hidden="true" />}
    </span>
  )
}

function classifyApplicationIcon(image: HTMLImageElement): ApplicationIconTone {
  const maximumSize = 64
  const ratio = Math.min(maximumSize / image.naturalWidth, maximumSize / image.naturalHeight, 1)
  const width = Math.max(1, Math.round(image.naturalWidth * ratio))
  const height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return "mixed"
  context.drawImage(image, 0, 0, width, height)
  return classifyIconPixels(context.getImageData(0, 0, width, height).data)
}

export function classifyIconPixels(pixels: Uint8ClampedArray): ApplicationIconTone {
  let visibleWeight = 0
  let luminanceTotal = 0
  let lightWeight = 0
  let darkWeight = 0

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255
    if (alpha < 0.08) continue
    const luminance = relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2])
    visibleWeight += alpha
    luminanceTotal += luminance * alpha
    if (luminance >= 0.62) lightWeight += alpha
    if (luminance <= 0.22) darkWeight += alpha
  }

  if (visibleWeight === 0) return "mixed"
  const average = luminanceTotal / visibleWeight
  if (average >= 0.62 && lightWeight / visibleWeight >= 0.58) return "light"
  if (average <= 0.24 && darkWeight / visibleWeight >= 0.58) return "dark"
  return "mixed"
}

function relativeLuminance(red: number, green: number, blue: number) {
  const linear = (value: number) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function applicationLabel(name?: string | null) {
  return name?.replace(/\.exe$/i, "").trim().slice(0, 2) || ""
}
