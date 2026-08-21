import type { DesignTemplate, ProjectManifest, ThemeSettings } from "@/types"

const STORAGE_KEY = "crumbtrail.design-templates.v1"
const LEGACY_KEY = "crumbtrail.theme-presets.v1"

export function loadDesignTemplates(): DesignTemplate[] {
  const saved = parse(localStorage.getItem(STORAGE_KEY))
  if (saved.length) return saved

  const now = new Date().toISOString()
  const migrated = parseLegacy(localStorage.getItem(LEGACY_KEY)).map(item => ({
    id: item.id,
    name: item.name,
    author: "",
    description: "",
    theme: designTheme(item.theme),
    logoDataUrl: null,
    createdAt: now,
    updatedAt: now,
  }))
  if (migrated.length) persist(migrated)
  return migrated
}

export function designFromProject(name: string, project: ProjectManifest, logoDataUrl?: string | null, id = crypto.randomUUID()): DesignTemplate {
  const now = new Date().toISOString()
  return {
    id,
    name: name.trim() || "Design",
    author: project.author,
    description: project.description,
    theme: designTheme(project.theme),
    logoDataUrl: logoDataUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export function upsertDesignTemplate(template: DesignTemplate): DesignTemplate[] {
  const existing = loadDesignTemplates()
  const previous = existing.find(item => item.id === template.id)
  const nextTemplate = {
    ...structuredClone(template),
    name: template.name.trim() || "Design",
    createdAt: previous?.createdAt ?? template.createdAt,
    updatedAt: new Date().toISOString(),
    theme: designTheme(template.theme),
  }
  const next = previous ? existing.map(item => item.id === template.id ? nextTemplate : item) : [...existing, nextTemplate]
  persist(next)
  return next
}

export function deleteDesignTemplate(id: string): DesignTemplate[] {
  const next = loadDesignTemplates().filter(item => item.id !== id)
  persist(next)
  return next
}

function parse(value: string | null): DesignTemplate[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as DesignTemplate[]
    return parsed
      .filter(item => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.author === "string" && item.theme)
      .map(item => ({ ...item, theme: designTheme(item.theme) }))
  } catch { return [] }
}

function parseLegacy(value: string | null): { id: string; name: string; theme: DesignTemplate["theme"] }[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as { id: string; name: string; theme: DesignTemplate["theme"] }[]
    return parsed.filter(item => item && typeof item.id === "string" && typeof item.name === "string" && item.theme)
  } catch { return [] }
}

function persist(templates: DesignTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

function designTheme(theme: DesignTemplate["theme"] | ThemeSettings): DesignTemplate["theme"] {
  return {
    preset: theme.preset === "cleanPrint" ? "crumbtrailLight" : theme.preset,
    accent: theme.accent,
    typography: theme.typography,
    logoAsset: null,
    showTimestamps: theme.showTimestamps,
    showApplicationNames: theme.showApplicationNames,
    showCrumbtrailBranding: theme.showCrumbtrailBranding !== false,
  }
}
