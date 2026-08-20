import { RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useLocale } from "@/lib/i18n"
import { functionKeys, shortcutLabel, type FunctionKey, useSettings } from "@/lib/settings"

export function GlobalSettingsPanel() {
  const { locale, t } = useLocale()
  const { settings, updateSettings, updateShortcuts, resetSettings } = useSettings()

  function setShortcut(field: "manualCapture" | "pauseResume" | "stopRecording", value: FunctionKey) {
    if (!updateShortcuts({ [field]: value })) {
      toast.error(locale === "de" ? "Tastenkürzel müssen eindeutig sein" : "Shortcuts must be unique")
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings")}</h1>
        <Button variant="outline" onClick={resetSettings}><RotateCcw data-icon="inline-start" />{locale === "de" ? "Zurücksetzen" : "Reset"}</Button>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>{locale === "de" ? "Editor" : "Editor"}</CardTitle></CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="default-auto-focus">{locale === "de" ? "Auto-Fokus standardmäßig" : "Auto focus by default"}</FieldLabel>
              <Switch id="default-auto-focus" checked={settings.defaultAutoFocus} onCheckedChange={checked => updateSettings({ defaultAutoFocus: checked })} />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="auto-focus-zoom">{locale === "de" ? "Auto-Fokus-Zoom" : "Auto focus zoom"}</FieldLabel>
                <span className="text-sm tabular-nums text-muted-foreground">{settings.autoFocusZoomPercent}%</span>
              </div>
              <Slider id="auto-focus-zoom" value={settings.autoFocusZoomPercent} min={125} max={300} step={25} onValueChange={value => updateSettings({ autoFocusZoomPercent: value as number })} />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="default-stroke-width">{locale === "de" ? "Standard-Linienstärke" : "Default line thickness"}</FieldLabel>
                <span className="text-sm tabular-nums text-muted-foreground">{settings.defaultStrokeWidth}px</span>
              </div>
              <Slider id="default-stroke-width" value={settings.defaultStrokeWidth} min={1} max={12} step={1} onValueChange={value => updateSettings({ defaultStrokeWidth: value as number })} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>{t("shortcuts")}</CardTitle></CardHeader>
        <CardContent>
          <FieldGroup>
            <ShortcutField label={t("manualCapture")} value={settings.shortcuts.manualCapture} onValueChange={value => setShortcut("manualCapture", value)} />
            <ShortcutField label={t("pauseResume")} value={settings.shortcuts.pauseResume} onValueChange={value => setShortcut("pauseResume", value)} />
            <ShortcutField label={t("stopRecording")} value={settings.shortcuts.stopRecording} onValueChange={value => setShortcut("stopRecording", value)} />
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}

function ShortcutField({ label, value, onValueChange }: { label: string; value: FunctionKey; onValueChange(value: FunctionKey): void }) {
  const items = functionKeys.map(key => ({ value: key, label: shortcutLabel(key) }))
  return (
    <Field orientation="responsive">
      <FieldLabel>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={next => onValueChange(next as FunctionKey)}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
  )
}
