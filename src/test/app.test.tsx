import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "@/App"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createMockProject } from "@/lib/bridge"
import { designFromProject, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"
import { LocaleProvider } from "@/lib/i18n"
import { SettingsProvider } from "@/lib/settings"
import { Editor, focusRect } from "@/screens/editor"
import { RecordingSetup } from "@/screens/recording-setup"

function providers(node: React.ReactNode) {
  return <ThemeProvider attribute="class"><LocaleProvider><SettingsProvider><TooltipProvider>{node}</TooltipProvider></SettingsProvider></LocaleProvider></ThemeProvider>
}

describe("Crumbtrail experience", () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it("opens with structured project and design navigation", async () => {
    render(<App />)
    expect(screen.getByRole("heading", { name: /leave a trail/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Designs" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Workspace appearance guide")).toBeInTheDocument())
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

  it("creates a reusable design with author and branding settings", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: "Designs" }))
    await user.click(screen.getAllByRole("button", { name: "New design" })[0])
    await user.type(screen.getByLabelText("Name"), "Support handbook")
    await user.type(screen.getByLabelText("Author"), "Ada Lovelace")
    await user.click(screen.getByRole("button", { name: "Save design" }))
    expect(screen.getByText("Support handbook")).toBeInTheDocument()
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
  })

  it("applies and saves reusable designs inside Appearance", async () => {
    const user = userEvent.setup()
    const project = createMockProject()
    const reusable = designFromProject("Red handbook", { ...project, theme: { ...project.theme, accent: "#dc2626" } })
    upsertDesignTemplate(reusable)
    const onProject = vi.fn()
    render(providers(<Editor project={project} onProject={onProject} onHome={vi.fn()} onRecord={vi.fn()} />))

    await user.click(screen.getByRole("button", { name: "Appearance" }))
    await user.click(await screen.findByRole("button", { name: "Red handbook" }))
    expect(onProject.mock.calls.at(-1)?.[0].theme.accent).toBe("#dc2626")

    await user.click(screen.getByRole("button", { name: "Save as design" }))
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Current project")
    await user.click(screen.getByRole("button", { name: "Save design" }))
    expect(loadDesignTemplates().some(design => design.name === "Current project")).toBe(true)
  })

  it("selects one source in recording setup", async () => {
    const user = userEvent.setup(); const project = createMockProject(); project.steps = []
    render(providers(<RecordingSetup project={project} onBack={vi.fn()} onProject={vi.fn()} onStarted={vi.fn()} />))
    await user.click(screen.getByRole("button", { name: /window/i }))
    await user.click(screen.getByRole("button", { name: "Choose source" }))
    expect(await screen.findByText("Acme Settings")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start recording/i })).toBeEnabled()
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
