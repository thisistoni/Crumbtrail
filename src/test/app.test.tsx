import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App, { projectWithAppLocale } from "@/App"
import { classifyIconPixels } from "@/components/application-icon"
import { TooltipProvider } from "@/components/ui/tooltip"
import { bridge, createMockProject } from "@/lib/bridge"
import { designFromProject, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"
import { LocaleProvider } from "@/lib/i18n"
import { SettingsProvider } from "@/lib/settings"
import { groupProjectsForHome } from "@/lib/project-groups"
import { whenNativeWindowReady } from "@/lib/native-window"
import { annotationRectForView, Editor, focusRect } from "@/screens/editor"
import { Home } from "@/screens/home"
import { RecordingSetup } from "@/screens/recording-setup"
import { clickPulsePosition } from "@/screens/recording-overlay"
import type { ProjectSummary } from "@/types"

function providers(node: React.ReactNode) {
  return <ThemeProvider attribute="class"><LocaleProvider><SettingsProvider><TooltipProvider>{node}</TooltipProvider></SettingsProvider></LocaleProvider></ThemeProvider>
}

describe("Crumbtrail experience", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it("opens with structured project and design navigation", async () => {
    render(<App />)
    expect(screen.getByRole("heading", { name: /leave a trail/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Designs" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
    expect(document.querySelector("[data-crumbtrail-mark]")).toHaveAttribute("src", expect.stringContaining("crumbtrail-logo"))
    await waitFor(() => expect(screen.getByText("Workspace appearance guide")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("img", { name: "Acme Settings" })).toBeInTheDocument())
    expect(document.querySelector("[data-project-folder]")).not.toBeNull()
  })

  it("groups older projects by month instead of one endless recent list", () => {
    const project = (id: string, updatedAt: string): ProjectSummary => ({ id, updatedAt, title: id, stepCount: 1, recoverable: true, applications: [] })
    const groups = groupProjectsForHome([
      project("january", "2024-01-18T10:00:00.000Z"),
      project("january-two", "2024-01-02T10:00:00.000Z"),
      project("december", "2023-12-20T10:00:00.000Z"),
    ], "en")
    expect(groups.map(group => group.label)).toEqual(["January 2024", "December 2023"])
    expect(groups[0].projects).toHaveLength(2)
  })

  it("shows up to six large adaptive application icons inside project folders", async () => {
    const applications = Array.from({ length: 7 }, (_, index) => ({ name: `App ${index + 1}.exe`, iconAsset: null }))
    vi.spyOn(bridge, "listSessions").mockResolvedValue([{
      id: "apps-project",
      title: "Application guide",
      updatedAt: new Date().toISOString(),
      stepCount: 7,
      recoverable: true,
      applications,
    }])
    const { container } = render(providers(<Home onOpen={vi.fn()} onNew={vi.fn()} />))

    await screen.findByText("Application guide")
    const icons = container.querySelectorAll("[data-application-icon]")
    const folder = container.querySelector("[data-project-folder]")
    const folderApps = container.querySelectorAll("[data-project-folder-app]")
    expect(icons).toHaveLength(6)
    expect(icons[0]).toHaveAttribute("data-variant", "adaptive")
    expect(icons[0]).toHaveAttribute("data-icon-tone", "mixed")
    expect(icons[0]).toHaveClass("size-24", "application-icon-adaptive")
    expect(folder).not.toBeNull()
    expect(Number.parseFloat((folder as HTMLElement).style.width)).toBeGreaterThan(100)
    expect(folderApps).toHaveLength(6)
    expect(container.querySelector("[data-project-menu]")).toHaveClass("absolute", "right-4", "top-4")
    expect(container.querySelector("[data-project-card]")).toHaveClass("hover:bg-muted")
    expect(screen.getByRole("button", { name: "Projects" })).toHaveClass("hover:bg-breadcrumb-soft")
    expect(screen.getByText("+1")).toBeInTheDocument()
  })

  it("chooses contrasting icon backplates from visible pixels", () => {
    expect(classifyIconPixels(new Uint8ClampedArray([
      255, 255, 255, 255,
      245, 245, 245, 255,
      255, 255, 255, 0,
    ]))).toBe("light")
    expect(classifyIconPixels(new Uint8ClampedArray([
      0, 0, 0, 255,
      18, 18, 18, 255,
      255, 255, 255, 0,
    ]))).toBe("dark")
    expect(classifyIconPixels(new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
      29, 185, 84, 255,
    ]))).toBe("mixed")
  })

  it("renames a project from its card menu", async () => {
    const user = userEvent.setup()
    let title = "Original project"
    const project = createMockProject(title)
    vi.spyOn(bridge, "listSessions").mockImplementation(async () => [{
      id: project.id,
      title,
      updatedAt: project.updatedAt,
      stepCount: project.steps.length,
      recoverable: true,
      applications: [],
    }])
    vi.spyOn(bridge, "loadSession").mockResolvedValue(project)
    const autosave = vi.spyOn(bridge, "autosave").mockImplementation(async value => {
      title = value.title
      return value
    })
    render(providers(<Home onOpen={vi.fn()} onNew={vi.fn()} />))

    await screen.findByText("Original project")
    await user.click(screen.getByRole("button", { name: "Project menu" }))
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }))
    const name = screen.getByRole("textbox", { name: "Name" })
    await user.clear(name)
    await user.type(name, "Renamed project")
    await user.click(screen.getByRole("button", { name: "Rename" }))

    await waitFor(() => expect(autosave).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed project" })))
    expect(await screen.findByText("Renamed project")).toBeInTheDocument()
  })

  it("renders the global auto-focus zoom percentage control", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getByText("175%")).toBeInTheDocument()
    expect(document.getElementById("auto-focus-zoom")?.querySelectorAll("[data-slot='slider-thumb']")).toHaveLength(1)
  })

  it("returns to the actual previous screen", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText("Workspace appearance guide"))
    await user.click(screen.getAllByRole("button", { name: "Record" })[0])
    expect(screen.getByRole("heading", { name: "Choose target" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByLabelText("Project title")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("heading", { name: /leave a trail/i })).toBeInTheDocument()
  })

  it("opens target selection immediately for a new guide", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole("button", { name: "New guide" }))

    expect(await screen.findByRole("heading", { name: "Choose target" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: /name/i })).not.toBeInTheDocument()
  })

  it("discards a new guide when the user backs out before recording a step", async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText("Workspace appearance guide")

    await user.click(screen.getByRole("button", { name: "New guide" }))
    await user.click(await screen.findByRole("button", { name: "Back" }))

    expect(await screen.findByRole("heading", { name: /leave a trail/i })).toBeInTheDocument()
    expect(screen.queryByText("Untitled guide")).not.toBeInTheDocument()
  })

  it("creates a reusable design with author and branding settings", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: "Designs" }))
    await user.click(screen.getAllByRole("button", { name: "New design" })[0])
    expect(screen.queryByText("Report language")).not.toBeInTheDocument()
    const branding = screen.getByRole("switch", { name: "Show “Created with Crumbtrail”" })
    expect(branding).toBeChecked()
    await user.click(branding)
    await user.type(screen.getByLabelText("Name"), "Support handbook")
    await user.type(screen.getByLabelText("Author"), "Ada Lovelace")
    await user.click(screen.getByRole("button", { name: "Save design" }))
    expect(screen.getByText("Support handbook")).toBeInTheDocument()
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
    expect(loadDesignTemplates()[0].theme.showCrumbtrailBranding).toBe(false)
  })

  it("applies and saves reusable designs inside Appearance", async () => {
    const user = userEvent.setup()
    const project = createMockProject()
    const reusable = designFromProject("Red handbook", { ...project, theme: { ...project.theme, accent: "#dc2626" } })
    upsertDesignTemplate(reusable)
    const onProject = vi.fn()
    render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))

    await user.click(screen.getByRole("button", { name: "Appearance" }))
    const branding = await screen.findByRole("switch", { name: "Show “Created with Crumbtrail”" })
    expect(branding).toBeChecked()
    await user.click(branding)
    expect(onProject.mock.calls.at(-1)?.[0].theme.showCrumbtrailBranding).toBe(false)
    await user.click(await screen.findByRole("button", { name: "Red handbook" }))
    expect(onProject.mock.calls.at(-1)?.[0].theme.accent).toBe("#dc2626")

    await user.click(screen.getByRole("button", { name: "Save as design" }))
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Current project")
    await user.click(screen.getByRole("button", { name: "Save design" }))
    expect(loadDesignTemplates().some(design => design.name === "Current project")).toBe(true)
    expect("reportLocale" in designFromProject("No language", project).theme).toBe(false)
  })

  it("derives project and recording language from the app language", () => {
    const project = createMockProject()
    const localized = projectWithAppLocale(project, "de")
    expect(localized.theme.reportLocale).toBe("de")
    expect(localized.capture.instructionLocale).toBe("de")
  })

  it("removes stored language from older reusable designs", () => {
    const project = createMockProject()
    const design = designFromProject("Legacy", project) as ReturnType<typeof designFromProject> & { theme: { reportLocale?: string } }
    design.theme.reportLocale = "de"
    design.theme.preset = "cleanPrint"
    localStorage.setItem("crumbtrail.design-templates.v1", JSON.stringify([design]))
    const migrated = loadDesignTemplates()[0]
    expect("reportLocale" in migrated.theme).toBe(false)
    expect(migrated.theme.preset).toBe("crumbtrailLight")
  })

  it("maps the retired Print report style to Light", () => {
    const project = createMockProject()
    project.theme.preset = "cleanPrint"
    expect(projectWithAppLocale(project, "en").theme.preset).toBe("crumbtrailLight")
  })

  it("selects one source in recording setup", async () => {
    const user = userEvent.setup(); const project = createMockProject(); project.steps = []
    render(providers(<RecordingSetup project={project} onBack={vi.fn()} onProject={vi.fn()} onStarted={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: /window/i }))
    await user.click(screen.getByRole("button", { name: "Choose source" }))
    expect(await screen.findByText("Acme Settings")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start recording/i })).toBeEnabled()
  })

  it("positions recording click pulses across mixed-DPI and negative-coordinate displays", () => {
    expect(clickPulsePosition(
      { x: -1440, y: 450, right: false },
      { id: "monitor:2", kind: "monitor", label: "Display 2", bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 },
    )).toEqual({ left: 320, top: 300 })
  })

  it("waits for a native overlay handle without failing recording setup", async () => {
    let attempts = 0
    await expect(whenNativeWindowReady(async () => {
      attempts += 1
      if (attempts < 3) throw new Error("The underlying handle is not available")
      return "ready"
    })).resolves.toBe("ready")
    expect(attempts).toBe(3)
  })

  it("distinguishes displays with the same monitor characteristics", async () => {
    const user = userEvent.setup(); const project = createMockProject(); project.steps = []
    render(providers(<RecordingSetup project={project} onBack={vi.fn()} onProject={vi.fn()} onStarted={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: "Choose source" }))
    expect(await screen.findByRole("heading", { name: "Choose a display" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Display 2/ }))
    expect(await screen.findByText("Display 2")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /start recording/i }).at(-1)).toBeEnabled()
  })

  it("edits instructions and creates non-destructive annotations", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    const { rerender } = render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    const instruction = screen.getByLabelText("Instruction")
    await user.clear(instruction); await user.type(instruction, "Choose the dark theme")
    expect(onProject).toHaveBeenCalled()
    const edited = onProject.mock.calls.at(-1)?.[0]
    rerender(providers(<Editor project={edited} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: "Text" }))
    const annotated = onProject.mock.calls.at(-1)?.[0]
    expect(annotated.steps[0].annotations.some((annotation: { kind: string }) => annotation.kind === "text")).toBe(true)
  })

  it("deletes the selected canvas annotation with Delete", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    const { container } = render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    const shape = container.querySelector("[data-canvas-stage] .cursor-move")
    expect(shape).not.toBeNull()
    fireEvent.contextMenu(shape!)
    await user.keyboard("{Delete}")
    const changed = onProject.mock.calls.at(-1)?.[0]
    expect(changed.steps[0].annotations).toHaveLength(project.steps[0].annotations.length - 1)
  })

  it("deletes the selected annotation with Backspace outside text editing", () => {
    const project = createMockProject(); const onProject = vi.fn()
    const { container } = render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    fireEvent.click(container.querySelector("[data-annotation-row]")!)
    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" })
    const changed = onProject.mock.calls.at(-1)?.[0]
    expect(changed.steps[0].annotations).toHaveLength(project.steps[0].annotations.length - 1)
  })

  it("keeps crop out of markings, clears autofocus, and exits crop when another tool is chosen", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    project.steps[0].focusZoom = { x: .25, y: .25, width: .5, height: .5 }
    const { container, rerender } = render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))

    await user.click(screen.getByRole("button", { name: "Crop" }))
    const cropped = onProject.mock.calls.at(-1)?.[0]
    expect(cropped.steps[0].focusZoom).toBeNull()
    rerender(providers(<Editor project={cropped} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    expect(container.querySelectorAll("[data-annotation-row]")).toHaveLength(project.steps[0].annotations.length)
    expect(container.querySelector("[data-annotation-row='crop']")).toBeNull()
    expect(screen.getByRole("button", { name: "Auto focus" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Fit" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Rectangle" }))
    expect(screen.queryByRole("button", { name: "Apply crop" })).not.toBeInTheDocument()
    const changed = onProject.mock.calls.at(-1)?.[0]
    const crop = changed.steps[0].annotations.find((annotation: { kind: string }) => annotation.kind === "crop")
    const rectangle = changed.steps[0].annotations.find((annotation: { kind: string }) => annotation.kind === "rectangle")
    expect(rectangle.rect).toEqual(annotationRectForView("rectangle", crop.rect))
  })

  it("places a new marking inside the current autofocus view", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    const view = { x: .25, y: .2, width: .5, height: .6 }
    project.steps[0].focusZoom = view
    render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: "Rectangle" }))
    const changed = onProject.mock.calls.at(-1)?.[0]
    const rectangle = changed.steps[0].annotations.find((annotation: { kind: string }) => annotation.kind === "rectangle")
    expect(rectangle.rect).toEqual(annotationRectForView("rectangle", view))
  })

  it("renders adjustable arrow thickness and text-specific controls", () => {
    const project = createMockProject()
    project.steps[0].annotations = [
      { id: "arrow", kind: "arrow", rect: { x: .2, y: .2, width: .35, height: .12 }, color: "#ef4444", strokeWidth: 7, rotation: 0, opacity: 1, zIndex: 0, markerSize: 18, protected: false },
      { id: "text", kind: "text", rect: { x: .3, y: .4, width: .3, height: .15 }, color: "#ef4444", label: "Hello", strokeWidth: 3, rotation: 0, opacity: 1, zIndex: 1, markerSize: 24, protected: false },
    ]
    const { container } = render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    expect(container.querySelector("[data-annotation-kind='arrow'] [data-arrow-line]")).toHaveStyle({ height: "7px" })

    fireEvent.click(container.querySelector("[data-annotation-row='text']")!)
    const textProperties = container.querySelector("[data-annotation-properties='text']")!
    expect(within(textProperties as HTMLElement).getByLabelText("Text")).toHaveValue("Hello")
    expect(within(textProperties as HTMLElement).getByText("Size")).toBeInTheDocument()
    expect(within(textProperties as HTMLElement).queryByText("Stroke")).not.toBeInTheDocument()

    fireEvent.click(container.querySelector("[data-annotation-row='arrow']")!)
    const arrowProperties = container.querySelector("[data-annotation-properties='arrow']")!
    expect(within(arrowProperties as HTMLElement).getByText("Stroke")).toBeInTheDocument()
  })

  it("repositions the screenshot by dragging the canvas", () => {
    const project = createMockProject()
    const { container } = render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    const viewport = container.querySelector("[data-canvas-viewport]")!
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 165, clientY: 140 })
    fireEvent.pointerUp(window)
    expect(container.querySelector("[data-canvas-pan]")).toHaveStyle({ transform: "translate(65px, 40px)" })
  })

  it("offers the inspector step actions from the timeline context menu", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    fireEvent.contextMenu(screen.getAllByText("Select Dark mode")[0])
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }))
    expect(onProject.mock.calls.at(-1)?.[0].steps).toHaveLength(project.steps.length + 1)
  })

  it("uses the recorded application icon in the step timeline", async () => {
    const project = createMockProject()
    render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    await waitFor(() => expect(screen.getAllByRole("img", { name: "Acme Settings" }).length).toBeGreaterThan(0))
    expect(screen.queryByRole("button", { name: "Select step 1" })).toContainElement(screen.getAllByRole("img", { name: "Acme Settings" })[0])
  })

  it("selects a step from the full hovered row", () => {
    const project = createMockProject()
    const { container } = render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    const secondStep = project.steps[1]
    fireEvent.click(container.querySelector(`[data-step-row="${secondStep.id}"]`)!)
    expect(screen.getByLabelText("Instruction")).toHaveValue(secondStep.instruction)
  })

  it("never shows the previous step image while a selected asset changes", async () => {
    const project = createMockProject()
    project.steps[0].media = { beforeAsset: "step-one-before.png", afterAsset: "step-one-after.png", selected: "before" }
    project.steps[1].media = { beforeAsset: "step-two-before.png", afterAsset: "step-two-after.png", selected: "before" }
    vi.spyOn(bridge, "assetUrl").mockImplementation(async (_projectId, asset) => `asset://${asset}`)
    const { container } = render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))

    await waitFor(() => expect(container.querySelector("[data-canvas-image]")).toHaveAttribute("src", "asset://step-one-before.png"))
    fireEvent.click(container.querySelector(`[data-step-row="${project.steps[1].id}"]`)!)
    await waitFor(() => expect(container.querySelector("[data-canvas-image]")).toHaveAttribute("src", "asset://step-two-before.png"))
    fireEvent.click(container.querySelector(`[data-step-row="${project.steps[0].id}"]`)!)
    expect(container.querySelector("[data-canvas-image]")).toHaveAttribute("src", "asset://step-one-before.png")
  })

  it("clears the selected annotation when the empty canvas is clicked", async () => {
    const user = userEvent.setup(); const project = createMockProject(); const onProject = vi.fn()
    const { container } = render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))
    const shape = container.querySelector("[data-canvas-stage] .cursor-move")!
    const viewport = container.querySelector("[data-canvas-viewport]")!
    fireEvent.pointerDown(shape, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window)
    onProject.mockClear()
    fireEvent.pointerDown(viewport, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window)
    await user.keyboard("{Delete}")
    expect(onProject).not.toHaveBeenCalled()
  })

  it("uses explicit export action names without a paper-size choice", async () => {
    const user = userEvent.setup(); const project = createMockProject()
    render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: /^Export/ }))
    expect(await screen.findByRole("menuitem", { name: "Export as…" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Save project file" })).toBeInTheDocument()
    await user.click(screen.getByRole("menuitem", { name: "Export as…" }))
    await user.click(screen.getByRole("button", { name: "PDF" }))
    expect(screen.queryByText(/A4|Letter/)).not.toBeInTheDocument()
  })

  it("uses the configured percentage for a stable auto-focus frame", () => {
    const project = createMockProject()
    const step = {
      ...project.steps[0],
      control: { name: "Save", controlType: "Button", automationId: "save", isPassword: false, bounds: { x: .45, y: .45, width: .1, height: .1 } },
    }
    expect(focusRect(step, 200)).toEqual({ x: .25, y: .25, width: .5, height: .5 })
    expect(focusRect(step, 250)).toEqual({ x: .3, y: .3, width: .4, height: .4 })
    const annotation = annotationRectForView("rectangle", { x: .25, y: .25, width: .5, height: .5 })
    expect(annotation.x).toBeCloseTo(.42)
    expect(annotation.y).toBeCloseTo(.42)
    expect(annotation.width).toBeCloseTo(.16)
    expect(annotation.height).toBeCloseTo(.1)
  })

  it("shows one fixed print preview without format controls", async () => {
    const user = userEvent.setup(); const project = createMockProject()
    render(providers(<Editor project={project} onProject={vi.fn()} onHome={vi.fn()} onRecord={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: "Preview" }))
    expect(await screen.findByRole("dialog", { name: "Preview" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Screen" })).not.toBeInTheDocument()
    expect(screen.queryByText(/^(A4|Letter)/)).not.toBeInTheDocument()
  })
})
