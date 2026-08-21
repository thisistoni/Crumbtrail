import { useEffect, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTheme } from "next-themes"
import { ArrowRight, FileArchive, FolderKanban, FolderOpen, Languages, LoaderCircle, Moon, MoreHorizontal, Palette, Pencil, Plus, Settings, Sun } from "lucide-react"
import { toast } from "sonner"
import { ApplicationIcon } from "@/components/application-icon"
import { AvatarGroup, AvatarGroupTooltip } from "@/components/animate-ui/components/animate/avatar-group"
import { Brand } from "@/components/brand"
import { DesignLibrary } from "@/components/design-library"
import { GlobalSettingsPanel } from "@/components/global-settings"
import { ProjectFolder } from "@/components/project-folder"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bridge, isTauri } from "@/lib/bridge"
import { deleteDesignTemplate, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"
import { useLocale } from "@/lib/i18n"
import { groupProjectsForHome } from "@/lib/project-groups"
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
      onNew(configured)
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
              </div>

              {sessions.length ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {sessions.slice(0, 3).map(project => <ProjectCard key={project.id} project={project} locale={locale} dark={resolvedTheme === "dark"} onOpen={onOpen} onChanged={refresh} />)}
                </div>
              ) : (
                <Empty className="mt-4 border bg-card/65">
                  <EmptyHeader><EmptyMedia variant="icon"><FileArchive /></EmptyMedia><EmptyTitle>{t("noTrails")}</EmptyTitle></EmptyHeader>
                  <EmptyContent><Button onClick={() => void create()} disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}{t("recordFirstGuide")}</Button></EmptyContent>
                </Empty>
              )}
            </section>

            {groupProjectsForHome(sessions.slice(3), locale).map(group => (
              <section key={group.key} className="pt-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold tracking-tight">{group.label}</h2>
                  <span className="text-sm tabular-nums text-muted-foreground">{group.projects.length}</span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {group.projects.map(project => <ProjectCard key={project.id} project={project} locale={locale} dark={resolvedTheme === "dark"} onOpen={onOpen} onChanged={refresh} />)}
                </div>
              </section>
            ))}
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

function ProjectCard({ project, locale, dark, onOpen, onChanged }: { project: ProjectSummary; locale: "en" | "de"; dark: boolean; onOpen(project: ProjectManifest): void; onChanged(): void }) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(project.title)
  const [renaming, setRenaming] = useState(false)
  const openProject = () => bridge.loadSession(project.id).then(onOpen).catch(error => toast.error(String(error)))
  const openRename = () => {
    setTitle(project.title)
    setRenameOpen(true)
  }
  async function renameProject() {
    const nextTitle = title.trim()
    if (!nextTitle || renaming) return
    setRenaming(true)
    try {
      const manifest = await bridge.loadSession(project.id)
      await bridge.autosave({ ...manifest, title: nextTitle })
      setRenameOpen(false)
      onChanged()
    } catch (error) {
      toast.error(locale === "de" ? "Projekt konnte nicht umbenannt werden" : "Could not rename the project", { description: String(error) })
    } finally {
      setRenaming(false)
    }
  }
  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        data-project-card
        className="group gap-0 overflow-hidden p-0 transition-colors hover:bg-muted hover:ring-breadcrumb/45"
        onClick={() => void openProject()}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openProject() } }}
      >
        <CardHeader className="relative grid min-h-32 grid-cols-[auto_1fr] items-center gap-7 px-5 py-5 pr-12">
          <ProjectFolder projectId={project.id} applications={project.applications ?? []} dark={dark} />
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-base leading-5">{project.title || (locale === "de" ? "Unbenannte Anleitung" : "Untitled guide")}</CardTitle>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{project.stepCount} {project.stepCount === 1 ? (locale === "de" ? "Schritt" : "step") : (locale === "de" ? "Schritte" : "steps")}</span>
              <span aria-hidden="true">·</span>
              <span>{relativeDate(project.updatedAt, locale)}</span>
            </div>
          </div>
          <CardAction data-project-menu className="absolute right-4 top-4">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={locale === "de" ? "Projektmenü" : "Project menu"} onClick={event => event.stopPropagation()} />}><MoreHorizontal /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={event => event.stopPropagation()}>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={openRename}><Pencil />{locale === "de" ? "Umbenennen" : "Rename"}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => void bridge.deleteSession(project.id).then(onChanged)}>{locale === "de" ? "Entfernen" : "Remove"}</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
          <ArrowRight className="absolute bottom-5 right-5 size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardHeader>
      </Card>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form className="contents" onSubmit={event => { event.preventDefault(); void renameProject() }}>
            <DialogHeader><DialogTitle>{locale === "de" ? "Projekt umbenennen" : "Rename project"}</DialogTitle></DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`project-name-${project.id}`}>{locale === "de" ? "Name" : "Name"}</FieldLabel>
                <Input id={`project-name-${project.id}`} autoFocus value={title} onChange={event => setTitle(event.target.value)} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>{locale === "de" ? "Abbrechen" : "Cancel"}</Button>
              <Button type="submit" disabled={!title.trim() || renaming}>{renaming ? (locale === "de" ? "Wird umbenannt…" : "Renaming…") : (locale === "de" ? "Umbenennen" : "Rename")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ApplicationStack({ project }: { project: ProjectSummary }) {
  const applications = project.applications ?? []
  const visibleApplications = applications.slice(0, 6)
  if (!applications.length) return <ApplicationIcon projectId={project.id} size="lg" />
  return (
    <div className="flex items-center">
      <AvatarGroup
        className="h-11"
        overlap={12}
        translate="-20%"
        sideOffset={14}
      >
        {visibleApplications.map(application => (
          <div key={application.name}>
            <ApplicationIcon projectId={project.id} name={application.name} asset={application.iconAsset} size="lg" variant="plain" />
            <AvatarGroupTooltip>{application.name.replace(/\.exe$/i, "")}</AvatarGroupTooltip>
          </div>
        ))}
      </AvatarGroup>
      {applications.length > visibleApplications.length && <Badge variant="secondary" className="-ml-2 h-7 rounded-full px-2">+{applications.length - visibleApplications.length}</Badge>}
    </div>
  )
}

function NavButton({ active, icon: Icon, onClick, children }: { active: boolean; icon: typeof FolderKanban; onClick(): void; children: React.ReactNode }) {
  return <Button variant="ghost" className={cn("justify-start", active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-breadcrumb-soft hover:text-foreground")} onClick={onClick}><Icon data-icon="inline-start" />{children}</Button>
}

function relativeDate(value: string, locale: "en" | "de") {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60_000) return locale === "de" ? "gerade eben" : "just now"
  if (elapsed < 3_600_000) return locale === "de" ? `vor ${Math.floor(elapsed / 60_000)} Min.` : `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return locale === "de" ? `vor ${Math.floor(elapsed / 3_600_000)} Std.` : `${Math.floor(elapsed / 3_600_000)}h ago`
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { month: "short", day: "numeric" }).format(new Date(value))
}
