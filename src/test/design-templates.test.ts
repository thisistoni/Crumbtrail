import { beforeEach, describe, expect, it } from "vitest"
import { createMockProject } from "@/lib/bridge"
import { designFromProject, loadDesignTemplates, upsertDesignTemplate } from "@/lib/design-templates"

describe("design templates", () => {
  beforeEach(() => localStorage.clear())

  it("stores the complete reusable report configuration", () => {
    const project = createMockProject()
    project.author = "Ada Lovelace"
    project.description = "Operations handbook"
    project.theme.accent = "#b42318"
    project.theme.showCrumbtrailBranding = false
    const template = designFromProject("Support", project, "data:image/png;base64,AA==")
    upsertDesignTemplate(template)

    expect(loadDesignTemplates()).toEqual([expect.objectContaining({
      name: "Support",
      author: "Ada Lovelace",
      description: "Operations handbook",
      logoDataUrl: "data:image/png;base64,AA==",
      theme: expect.objectContaining({ accent: "#b42318", logoAsset: null, showCrumbtrailBranding: false }),
    })])
  })

  it("migrates early theme-only presets", () => {
    const project = createMockProject()
    localStorage.setItem("crumbtrail.theme-presets.v1", JSON.stringify([{ id: "legacy", name: "Legacy", theme: project.theme }]))
    expect(loadDesignTemplates()[0]).toEqual(expect.objectContaining({ id: "legacy", name: "Legacy", author: "", description: "" }))
  })

  it("shows Crumbtrail branding by default in older saved designs", () => {
    const project = createMockProject()
    const template = designFromProject("Older", project)
    const theme = { ...template.theme } as Partial<typeof template.theme>
    delete theme.showCrumbtrailBranding
    localStorage.setItem("crumbtrail.design-templates.v1", JSON.stringify([{ ...template, theme }]))
    expect(loadDesignTemplates()[0].theme.showCrumbtrailBranding).toBe(true)
  })
})
