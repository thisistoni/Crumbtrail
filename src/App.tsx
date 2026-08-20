import { useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { ThemeProvider } from "next-themes"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { bridge, isTauri } from "@/lib/bridge"
import { LocaleProvider, useLocale } from "@/lib/i18n"
import { SettingsProvider } from "@/lib/settings"
import { Editor } from "@/screens/editor"
import { Home } from "@/screens/home"
import { RecordingHud } from "@/screens/recording-hud"
import { RecordingSetup } from "@/screens/recording-setup"
import { RegionSelector } from "@/screens/region-selector"
import type { ProjectManifest, RecordingStateSnapshot, Step } from "@/types"

type View = "home" | "setup" | "recording" | "editor"

export default function App() {
  const surface = new URLSearchParams(window.location.search).get("surface")
  document.documentElement.dataset.surface = surface ?? "app"
  if (surface === "hud") return <Providers><RecordingHud /></Providers>
  if (surface === "region") return <Providers><RegionSelector /></Providers>
  return <Providers><MainApp /></Providers>
}

function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const suppressWebMenu = (event: MouseEvent) => event.preventDefault()
    document.addEventListener("contextmenu", suppressWebMenu)
    return () => document.removeEventListener("contextmenu", suppressWebMenu)
  }, [])
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange><LocaleProvider><SettingsProvider><TooltipProvider delay={350}>{children}<Toaster richColors closeButton /></TooltipProvider></SettingsProvider></LocaleProvider></ThemeProvider>
}

function MainApp() {
  const { locale } = useLocale()
  const [navigation, setNavigation] = useState<{ view: View; back: View[] }>({ view: "home", back: [] })
  const [project, setProject] = useState<ProjectManifest | null>(null)

  function navigate(view: View) {
    setNavigation(current => current.view === view ? current : { view, back: [...current.back, current.view] })
  }

  function replace(view: View) {
    setNavigation(current => ({ ...current, view }))
  }

  function back() {
    setNavigation(current => ({ view: current.back.at(-1) ?? "home", back: current.back.slice(0, -1) }))
  }

  function finishRecording() {
    setNavigation(current => ({ view: "editor", back: current.back.at(-1) === "editor" ? current.back.slice(0, -1) : current.back }))
  }

  useEffect(() => {
    const unlisteners: (() => void)[] = []
    bridge.on<Step>("recording://step-created", step => {
      setProject(current => current && !current.steps.some(item => item.id === step.id) ? { ...current, steps: [...current.steps, step], updatedAt: new Date().toISOString() } : current)
    }).then(stop => unlisteners.push(stop))
    bridge.on<ProjectManifest>("recording://project-updated", updated => {
      setProject(current => current?.id === updated.id ? updated : current)
    }).then(stop => unlisteners.push(stop))
    bridge.on<RecordingStateSnapshot>("recording://state", snapshot => {
      if (snapshot.status === "recording" || snapshot.status === "paused") {
        replace("recording")
      } else if (snapshot.status === "idle") {
        finishRecording()
        void showMainWindow()
      }
    }).then(stop => unlisteners.push(stop))
    bridge.on<void>("recording://stopped", () => { finishRecording(); void showMainWindow() }).then(stop => unlisteners.push(stop))
    bridge.on<string>("recording://recoverable-error", message => {
      toast.warning(locale === "de" ? "Aufnahme pausiert" : "Recording paused", { description: message, duration: 9000 })
    }).then(stop => unlisteners.push(stop))
    return () => unlisteners.forEach(stop => stop())
  }, [locale])

  if (navigation.view === "home" || !project) return <Home onOpen={opened => { setProject(opened); navigate("editor") }} onNew={created => { setProject(created); navigate("setup") }} />
  if (navigation.view === "setup") return <RecordingSetup project={project} onBack={back} onProject={setProject} onStarted={() => replace("recording")} />
  if (navigation.view === "recording") return <main className="grid h-screen place-items-center bg-background"><span className="sr-only">Recording</span></main>
  return <Editor project={project} onProject={setProject} onHome={back} onRecord={() => navigate("setup")} />
}

async function showMainWindow() {
  if (!isTauri()) return
  const window = getCurrentWindow()
  await window.unminimize()
  await window.show()
  await window.setFocus()
}
