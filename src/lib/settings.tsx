import { createContext, useContext, useState } from "react"

export const functionKeys = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"] as const
export type FunctionKey = typeof functionKeys[number]

export interface ShortcutSettings {
  manualCapture: FunctionKey
  pauseResume: FunctionKey
  stopRecording: FunctionKey
}

export interface GlobalSettings {
  defaultAutoFocus: boolean
  autoFocusZoomPercent: number
  defaultStrokeWidth: number
  shortcuts: ShortcutSettings
}

export const defaultGlobalSettings: GlobalSettings = {
  defaultAutoFocus: false,
  autoFocusZoomPercent: 175,
  defaultStrokeWidth: 3,
  shortcuts: {
    manualCapture: "F8",
    pauseResume: "F9",
    stopRecording: "F10",
  },
}

const storageKey = "crumbtrail.settings"

function loadSettings(): GlobalSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<GlobalSettings> | null
    if (!parsed) return defaultGlobalSettings
    const shortcuts = { ...defaultGlobalSettings.shortcuts, ...parsed.shortcuts }
    const values = Object.values(shortcuts)
    if (values.some(value => !functionKeys.includes(value as FunctionKey)) || new Set(values).size !== values.length) {
      return { ...defaultGlobalSettings, ...parsed, shortcuts: defaultGlobalSettings.shortcuts }
    }
    return {
      defaultAutoFocus: parsed.defaultAutoFocus ?? defaultGlobalSettings.defaultAutoFocus,
      autoFocusZoomPercent: Math.max(125, Math.min(300, parsed.autoFocusZoomPercent ?? defaultGlobalSettings.autoFocusZoomPercent)),
      defaultStrokeWidth: Math.max(1, Math.min(12, parsed.defaultStrokeWidth ?? defaultGlobalSettings.defaultStrokeWidth)),
      shortcuts,
    }
  } catch {
    return defaultGlobalSettings
  }
}

interface SettingsValue {
  settings: GlobalSettings
  updateSettings(patch: Partial<GlobalSettings>): void
  updateShortcuts(patch: Partial<ShortcutSettings>): boolean
  resetSettings(): void
}

const SettingsContext = createContext<SettingsValue>({
  settings: defaultGlobalSettings,
  updateSettings: () => undefined,
  updateShortcuts: () => false,
  resetSettings: () => undefined,
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(loadSettings)

  function commit(next: GlobalSettings) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setSettings(next)
  }

  function updateSettings(patch: Partial<GlobalSettings>) {
    commit({ ...settings, ...patch })
  }

  function updateShortcuts(patch: Partial<ShortcutSettings>) {
    const shortcuts = { ...settings.shortcuts, ...patch }
    if (new Set(Object.values(shortcuts)).size !== 3) return false
    commit({ ...settings, shortcuts })
    return true
  }

  function resetSettings() {
    commit(defaultGlobalSettings)
  }

  return <SettingsContext.Provider value={{ settings, updateSettings, updateShortcuts, resetSettings }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function shortcutLabel(key: FunctionKey) {
  return `Ctrl + Shift + ${key}`
}

export function functionKeyCode(key: FunctionKey) {
  return 0x70 + functionKeys.indexOf(key)
}
