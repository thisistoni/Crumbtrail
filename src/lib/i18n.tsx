import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { AppLocale } from "@/types"

const messages = {
  en: {
    back: "Back", cancel: "Cancel", continue: "Continue", remove: "Remove", duplicate: "Duplicate",
    home: "Home", projects: "Projects", themes: "Designs", settings: "Settings", record: "Record", export: "Export", preview: "Preview", edit: "Edit", steps: "Steps",
    newGuide: "New guide", openProject: "Open project", recent: "Recent",
    slogan: "Leave a trail anyone can follow.", noTrails: "No trails yet",
    nameGuide: "Name your new guide", guideTitle: "Guide title", creating: "Creating…",
    recordNewGuide: "Record a new guide", recordFirstGuide: "Record your first guide",
    recordingSetup: "Recording setup", chooseTarget: "Choose target", captureSteps: "Capture steps",
    display: "Display", window: "Window", region: "Region", noSource: "No source selected",
    chooseSource: "Choose source", chooseAgain: "Choose again", waitingWindows: "Waiting for Windows…",
    leftClicks: "Left clicks", rightClicks: "Right clicks", typingGroups: "Typing groups", passwordRedaction: "Password redaction",
    ready: "Ready", shortcuts: "Shortcuts", manualCapture: "Manual capture", pauseResume: "Pause / resume", stopRecording: "Stop recording",
    startRecording: "Start recording", selectContinue: "Select source & continue", chooseDisplay: "Choose a display",
    properties: "Properties", annotations: "Annotations", addAnnotation: "Add annotation", instruction: "Instruction", notes: "Notes",
    appearance: "Appearance", language: "Language", theme: "Theme", savedThemes: "Saved designs", saveTheme: "Save design",
    zoom: "Zoom", fit: "Fit", crop: "Crop", confirmCrop: "Apply crop", resetCrop: "Reset crop", autoZoom: "Auto focus",
    rotation: "Rotation", opacity: "Opacity", size: "Size", stroke: "Stroke", color: "Color", deleteShape: "Delete shape",
    recording: "Recording", paused: "Paused", pause: "Pause", resume: "Resume", stop: "Stop", undo: "Undo",
    selectRegion: "Select region", confirm: "Confirm", restart: "Restart",
  },
  de: {
    back: "Zurück", cancel: "Abbrechen", continue: "Weiter", remove: "Entfernen", duplicate: "Duplizieren",
    home: "Start", projects: "Projekte", themes: "Designs", settings: "Einstellungen", record: "Aufnehmen", export: "Exportieren", preview: "Vorschau", edit: "Bearbeiten", steps: "Schritte",
    newGuide: "Neue Anleitung", openProject: "Projekt öffnen", recent: "Zuletzt verwendet",
    slogan: "Hinterlasse eine Spur, der jeder folgen kann.", noTrails: "Noch keine Anleitungen",
    nameGuide: "Neue Anleitung benennen", guideTitle: "Titel", creating: "Wird erstellt…",
    recordNewGuide: "Neue Anleitung aufnehmen", recordFirstGuide: "Erste Anleitung aufnehmen",
    recordingSetup: "Aufnahme einrichten", chooseTarget: "Ziel auswählen", captureSteps: "Schritte erfassen",
    display: "Bildschirm", window: "Fenster", region: "Bereich", noSource: "Keine Quelle ausgewählt",
    chooseSource: "Quelle auswählen", chooseAgain: "Neu auswählen", waitingWindows: "Warte auf Windows…",
    leftClicks: "Linksklicks", rightClicks: "Rechtsklicks", typingGroups: "Texteingaben", passwordRedaction: "Passwörter schwärzen",
    ready: "Bereit", shortcuts: "Tastenkürzel", manualCapture: "Manuell erfassen", pauseResume: "Pause / Fortsetzen", stopRecording: "Aufnahme beenden",
    startRecording: "Aufnahme starten", selectContinue: "Quelle auswählen", chooseDisplay: "Bildschirm auswählen",
    properties: "Eigenschaften", annotations: "Markierungen", addAnnotation: "Markierung hinzufügen", instruction: "Anweisung", notes: "Notizen",
    appearance: "Darstellung", language: "Sprache", theme: "Design", savedThemes: "Gespeicherte Designs", saveTheme: "Design speichern",
    zoom: "Zoom", fit: "Einpassen", crop: "Zuschneiden", confirmCrop: "Zuschnitt anwenden", resetCrop: "Zuschnitt zurücksetzen", autoZoom: "Auto-Fokus",
    rotation: "Drehung", opacity: "Deckkraft", size: "Größe", stroke: "Linie", color: "Farbe", deleteShape: "Form löschen",
    recording: "Aufnahme", paused: "Pausiert", pause: "Pause", resume: "Fortsetzen", stop: "Beenden", undo: "Rückgängig",
    selectRegion: "Bereich auswählen", confirm: "Bestätigen", restart: "Neu beginnen",
  },
} as const

type MessageKey = keyof typeof messages.en
interface LocaleValue { locale: AppLocale; setLocale(locale: AppLocale): void; t(key: MessageKey): string }
const LocaleContext = createContext<LocaleValue>({ locale: "en", setLocale: () => undefined, t: key => messages.en[key] })

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    const saved = localStorage.getItem("crumbtrail.locale")
    if (saved === "en" || saved === "de") return saved
    return navigator.language.toLowerCase().startsWith("de") ? "de" : "en"
  })
  const setLocale = (next: AppLocale) => { localStorage.setItem("crumbtrail.locale", next); setLocaleState(next) }
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const value = useMemo(() => ({ locale, setLocale, t: (key: MessageKey) => messages[locale][key] }), [locale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  return useContext(LocaleContext)
}
