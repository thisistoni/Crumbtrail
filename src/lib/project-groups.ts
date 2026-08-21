import type { ProjectSummary } from "@/types"

export function groupProjectsForHome(projects: ProjectSummary[], locale: "en" | "de") {
  const groups = new Map<string, { key: string; label: string; projects: ProjectSummary[] }>()
  const now = new Date()
  for (const project of projects) {
    const date = new Date(project.updatedAt)
    const sameWeek = startOfWeek(date).getTime() === startOfWeek(now).getTime()
    const sameMonth = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    const key = sameWeek ? "week" : sameMonth ? "month" : `${date.getFullYear()}-${date.getMonth()}`
    const label = sameWeek
      ? (locale === "de" ? "Diese Woche" : "This week")
      : sameMonth
        ? (locale === "de" ? "Dieser Monat" : "This month")
        : new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { month: "long", year: "numeric" }).format(date)
    const group = groups.get(key) ?? { key, label, projects: [] }
    group.projects.push(project)
    groups.set(key, group)
  }
  return Array.from(groups.values())
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date
}
