import { useEffect, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTheme } from "next-themes"
import { ArrowRight, FileArchive, FolderKanban, FolderOpen, Languages, LoaderCircle, Moon, MoreHorizontal, Palette, Plus, Settings, Sun } from "lucide-react"
import { toast } from "sonner"
import { Brand } from "@/components/brand"
import { DesignLibrary } from "@/components/design-library"
import { GlobalSettingsPanel } from "@/components/global-settings"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bridge, isTauri } from "@/lib/bridge"
import { deleteDesignTemplate, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"
import { useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { DesignTemplate, ProjectManifest, ProjectSummary } from "@/types"

interface HomeProps {
  onOpen(project: ProjectManifest): void
  onNew(project: ProjectManifest): void
}

type HomeSection = "projects" | "themes" | "settings"

export function Home({ onOpen, onNew }: HomeProps) {
  const [section, setSection] = useState<HomeSection>("projects")
  const [sessions, setSessions] = useState<ProjectSummary[]>([])
  const [designs, setDesigns] = useState<DesignTemplate[]>(() => loadDesignTemplates())
  const [busy, setBusy] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, setLocale, t } = useLocale()

  const refresh = () => bridge.listSessions().then(setSessions).catch(error => toast.error(String(error)))
  useEffect(() => { void refresh() }, [])

  async function create() {
    if (busy) return
    setBusy(true)
    try {
      const project = await bridge.createProject(locale === "de" ? "Neue Anleitung" : "Untitled guide")
      const configured = { ...project, theme: { ...project.theme, reportLocale: locale } }
      const saved = await bridge.autosave(configured)
      onNew(saved)
    } catch (error) {
      toast.error(locale === "de" ? "Anleitung konnte nicht erstellt werden" : "Could not create the guide", { description: String(error) })
    } finally { setBusy(false) }
  }

  async function importProject() {
    if (!isTauri()) return toast.info(locale === "de" ? "Import ist in der Desktop-App verfügbar" : "Import is available in the desktop build")
    const source = await open({ multiple: false, filters: [{ name: "Crumbtrail", extensions: ["crumbtrail"] }] })
    if (!source) return
    try { onOpen(await bridge.openProject(source)) }
    catch (error) { toast.error(locale === "de" ? "Projekt konnte nicht geöffnet werden" : "This project could not be opened", { description: String(error) }) }
  }

  function saveDesign(template: DesignTemplate) {
    setDesigns(upsertDesignTemplate(template))
  }

  function removeDesign(id: string) {
    setDesigns(deleteDesignTemplate(id))
  }

  return (
    <main className="app-noise flex h-screen min-h-[640px] overflow-hidden bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4">
        <div className="px-2 pb-5"><Brand /></div>
        <nav className="grid gap-1">
          <NavButton active={section === "projects"} icon={FolderKanban} onClick={() => setSection("projects")}>{t("projects")}</NavButton>
          <NavButton active={section === "themes"} icon={Palette} onClick={() => setSection("themes")}>{t("themes")}</NavButton>
          <NavButton active={section === "settings"} icon={Settings} onClick={() => setSection("settings")}>{t("settings")}</NavButton>
        </nav>
        <div className="mt-auto">
          <Separator className="mb-3" />
          <div className="flex items-center gap-1 px-1">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("language")} />}><Languages /></DropdownMenuTrigger>
              <DropdownMenuContent align="start"><DropdownMenuGroup><DropdownMenuItem onClick={() => setLocale("en")}>English {locale === "en" && "✓"}</DropdownMenuItem><DropdownMenuItem onClick={() => setLocale("de")}>Deutsch {locale === "de" && "✓"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t("appearance")} />}>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</TooltipTrigger>
              <TooltipContent>{t("appearance")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {section === "projects" ? (
          <div className="mx-auto max-w-[1180px] px-8 py-10">
            <section className="border-b pb-10">
              <h1 className="whitespace-nowrap text-[clamp(1.75rem,3vw,3.4rem)] font-semibold leading-none tracking-[-0.05em]">{t("slogan")}</h1>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" className="h-11 rounded-xl" onClick={() => void create()} disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}{t("newGuide")}</Button>
                <Button size="lg" variant="outline" className="h-11 rounded-xl" onClick={importProject}><FolderOpen data-icon="inline-start" />{t("openProject")}</Button>
              </div>
            </section>

            <section className="pt-8">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">{t("recent")}</h2>
                {sessions.length > 0 && <span className="text-sm tabular-nums text-muted-foreground">{sessions.length}</span>}
              </div>

              {sessions.length ? (
                <Card className="mt-4 overflow-hidden p-0">
                  <CardContent className="divide-y p-0">
                    {sessions.map(project => (
                      <div key={project.id} role="button" tabIndex={0} className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/55" onClick={() => bridge.loadSession(project.id).then(onOpen).catch(error => toast.error(String(error)))} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void bridge.loadSession(project.id).then(onOpen) } }}>
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground group-hover:border-breadcrumb/50 group-hover:text-breadcrumb"><FileArchive /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{project.title || (locale === "de" ? "Unbenannte Anleitung" : "Untitled guide")}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{project.stepCount} {project.stepCount === 1 ? (locale === "de" ? "Schritt" : "step") : t("steps")} · {relativeDate(project.updatedAt, locale)}</span>
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={event => event.stopPropagation()} />}><MoreHorizontal /></DropdownMenuTrigger>
                          <DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={event => { event.stopPropagation(); void bridge.deleteSession(project.id).then(refresh) }}>{t("remove")}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
                        </DropdownMenu>
                        <ArrowRight className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <Empty className="mt-4 border bg-card/65">
                  <EmptyHeader><EmptyMedia variant="icon"><FileArchive /></EmptyMedia><EmptyTitle>{t("noTrails")}</EmptyTitle></EmptyHeader>
                  <EmptyContent><Button onClick={() => void create()} disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}{t("recordFirstGuide")}</Button></EmptyContent>
                </Empty>
              )}
            </section>
          </div>
        ) : section === "themes" ? (
          <DesignLibrary templates={designs} onSave={saveDesign} onDelete={removeDesign} />
        ) : (
          <GlobalSettingsPanel />
        )}
      </section>
    </main>
  )
}

function NavButton({ active, icon: Icon, onClick, children }: { active: boolean; icon: typeof FolderKanban; onClick(): void; children: React.ReactNode }) {
  return <Button variant="ghost" className={cn("justify-start", active && "bg-sidebar-accent text-sidebar-accent-foreground")} onClick={onClick}><Icon data-icon="inline-start" />{children}</Button>
}

function relativeDate(value: string, locale: "en" | "de") {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60_000) return locale === "de" ? "gerade eben" : "just now"
  if (elapsed < 3_600_000) return locale === "de" ? `vor ${Math.floor(elapsed / 60_000)} Min.` : `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return locale === "de" ? `vor ${Math.floor(elapsed / 3_600_000)} Std.` : `${Math.floor(elapsed / 3_600_000)}h ago`
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { month: "short", day: "numeric" }).format(new Date(value))
}
