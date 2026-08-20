import { useRef, useState } from "react"
import { ImagePlus, MoreHorizontal, Palette, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useLocale } from "@/lib/i18n"
import type { AppLocale, DesignTemplate, ReportTheme, TypographyPreset } from "@/types"

interface DesignLibraryProps {
  templates: DesignTemplate[]
  onSave(template: DesignTemplate): void
  onDelete(id: string): void
}

export function DesignLibrary({ templates, onSave, onDelete }: DesignLibraryProps) {
  const { locale, t } = useLocale()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DesignTemplate>(() => emptyDesign(locale))

  function create() {
    setDraft(emptyDesign(locale))
    setOpen(true)
  }

  function edit(template: DesignTemplate) {
    setDraft(structuredClone(template))
    setOpen(true)
  }

  function save() {
    if (!draft.name.trim()) return
    onSave({ ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString(), theme: { ...draft.theme, logoAsset: null } })
    setOpen(false)
  }

  return <div className="mx-auto max-w-[1180px] px-8 py-10">
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-semibold tracking-[-0.035em]">{t("themes")}</h1>
      <Button onClick={create}><Plus data-icon="inline-start" />{locale === "de" ? "Design erstellen" : "New design"}</Button>
    </div>

    {templates.length ? <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map(template => <DesignCard key={template.id} template={template} onEdit={edit} onDelete={onDelete} />)}
    </div> : <Empty className="mt-7 border bg-card/65">
      <EmptyHeader><EmptyMedia variant="icon"><Palette /></EmptyMedia><EmptyTitle>{locale === "de" ? "Noch keine Designs" : "No designs yet"}</EmptyTitle></EmptyHeader>
      <EmptyContent><Button onClick={create}><Plus data-icon="inline-start" />{locale === "de" ? "Design erstellen" : "New design"}</Button></EmptyContent>
    </Empty>}

    <DesignDialog open={open} onOpenChange={setOpen} draft={draft} onDraft={setDraft} onSave={save} />
  </div>
}

function DesignCard({ template, onEdit, onDelete }: { template: DesignTemplate; onEdit(template: DesignTemplate): void; onDelete(id: string): void }) {
  const { locale } = useLocale()
  return <Card className="overflow-hidden p-0">
    <div className="h-24 p-4" style={{ backgroundColor: template.theme.preset === "crumbtrailDark" ? "#1d1e21" : "#e9e7e1" }}>
      <div className="flex h-full items-center gap-3 rounded-lg bg-card px-4 shadow-sm">
        {template.logoDataUrl ? <img src={template.logoDataUrl} alt="" className="size-10 rounded-md object-contain" /> : <span className="size-10 rounded-md" style={{ backgroundColor: template.theme.accent }} />}
        <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: template.theme.accent }} />
      </div>
    </div>
    <CardHeader className="flex-row items-start gap-3 border-t">
      <div className="min-w-0 flex-1"><CardTitle className="truncate">{template.name}</CardTitle>{template.author && <p className="mt-1 truncate text-xs text-muted-foreground">{template.author}</p>}</div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={locale === "de" ? "Designaktionen" : "Design actions"} />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onEdit(template)}><Pencil />{locale === "de" ? "Bearbeiten" : "Edit"}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => onDelete(template.id)}><Trash2 />{locale === "de" ? "Löschen" : "Delete"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </CardHeader>
    <CardContent className="flex items-center justify-between gap-3 pb-4 text-xs text-muted-foreground"><span>{reportThemeName(template.theme.preset)} · {typographyName(template.theme.typography)}</span><Button size="sm" variant="outline" onClick={() => onEdit(template)}><Pencil data-icon="inline-start" />{locale === "de" ? "Bearbeiten" : "Edit"}</Button></CardContent>
  </Card>
}

function DesignDialog({ open, onOpenChange, draft, onDraft, onSave }: { open: boolean; onOpenChange(open: boolean): void; draft: DesignTemplate; onDraft(template: DesignTemplate): void; onSave(): void }) {
  const { locale } = useLocale()
  const logoInput = useRef<HTMLInputElement>(null)
  const patch = (value: Partial<DesignTemplate>) => onDraft({ ...draft, ...value })
  const patchTheme = (value: Partial<DesignTemplate["theme"]>) => patch({ theme: { ...draft.theme, ...value } })

  function readLogo(file?: File) {
    if (!file) return
    if (!(["image/png", "image/jpeg"].includes(file.type)) || file.size > 10 * 1024 * 1024) {
      toast.error(locale === "de" ? "Logo muss PNG oder JPEG und höchstens 10 MB groß sein" : "Logo must be a PNG or JPEG up to 10 MB")
      return
    }
    const reader = new FileReader()
    reader.onload = () => patch({ logoDataUrl: String(reader.result) })
    reader.readAsDataURL(file)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{locale === "de" ? "Design" : "Design"}</DialogTitle></DialogHeader>
      <FieldGroup>
        <Field><FieldLabel htmlFor="design-name">{locale === "de" ? "Name" : "Name"}</FieldLabel><Input id="design-name" autoFocus value={draft.name} onChange={event => patch({ name: event.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="design-author">{locale === "de" ? "Autor" : "Author"}</FieldLabel><Input id="design-author" value={draft.author} onChange={event => patch({ author: event.target.value })} /></Field>
          <Field><FieldLabel>{locale === "de" ? "Akzentfarbe" : "Accent color"}</FieldLabel><div className="flex gap-2"><input aria-label={locale === "de" ? "Akzentfarbe" : "Accent color"} type="color" value={draft.theme.accent} onChange={event => patchTheme({ accent: event.target.value })} className="size-9 rounded-lg border bg-transparent p-1" /><Input value={draft.theme.accent} onChange={event => /^#[0-9a-f]{0,6}$/i.test(event.target.value) && patchTheme({ accent: event.target.value })} /></div></Field>
        </div>
        <Field><FieldLabel htmlFor="design-description">{locale === "de" ? "Beschreibung" : "Description"}</FieldLabel><Textarea id="design-description" value={draft.description} onChange={event => patch({ description: event.target.value })} rows={3} /></Field>
        <Field><FieldLabel>{locale === "de" ? "Berichtsstil" : "Report style"}</FieldLabel><ToggleGroup value={[draft.theme.preset]} onValueChange={value => value[0] && patchTheme({ preset: value[0] as ReportTheme })} variant="outline" className="grid grid-cols-3"><ToggleGroupItem value="crumbtrailLight">Light</ToggleGroupItem><ToggleGroupItem value="crumbtrailDark">Dark</ToggleGroupItem><ToggleGroupItem value="cleanPrint">Print</ToggleGroupItem></ToggleGroup></Field>
        <Field><FieldLabel>{locale === "de" ? "Typografie" : "Typography"}</FieldLabel><ToggleGroup value={[draft.theme.typography]} onValueChange={value => value[0] && patchTheme({ typography: value[0] as TypographyPreset })} variant="outline" className="grid grid-cols-3"><ToggleGroupItem value="modern">Modern</ToggleGroupItem><ToggleGroupItem value="editorial">Editorial</ToggleGroupItem><ToggleGroupItem value="compact">Compact</ToggleGroupItem></ToggleGroup></Field>
        <Field><FieldLabel>Logo</FieldLabel><input ref={logoInput} className="hidden" type="file" accept="image/png,image/jpeg" onChange={event => readLogo(event.target.files?.[0])} /><div className="flex items-center gap-3">{draft.logoDataUrl && <img src={draft.logoDataUrl} alt="" className="size-12 rounded-lg border object-contain" />}<Button variant="outline" onClick={() => logoInput.current?.click()}><ImagePlus data-icon="inline-start" />{draft.logoDataUrl ? (locale === "de" ? "Logo ersetzen" : "Replace logo") : (locale === "de" ? "Logo hinzufügen" : "Add logo")}</Button>{draft.logoDataUrl && <Button variant="ghost" onClick={() => patch({ logoDataUrl: null })}><X data-icon="inline-start" />{locale === "de" ? "Entfernen" : "Remove"}</Button>}</div></Field>
        <Field><FieldLabel>{locale === "de" ? "Berichtssprache" : "Report language"}</FieldLabel><ToggleGroup value={[draft.theme.reportLocale]} onValueChange={value => value[0] && patchTheme({ reportLocale: value[0] as AppLocale })} variant="outline" className="grid grid-cols-2"><ToggleGroupItem value="en">English</ToggleGroupItem><ToggleGroupItem value="de">Deutsch</ToggleGroupItem></ToggleGroup></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field orientation="horizontal"><Switch checked={draft.theme.showApplicationNames} onCheckedChange={value => patchTheme({ showApplicationNames: value })} /><FieldLabel>{locale === "de" ? "Anwendungsnamen" : "Application names"}</FieldLabel></Field>
          <Field orientation="horizontal"><Switch checked={draft.theme.showTimestamps} onCheckedChange={value => patchTheme({ showTimestamps: value })} /><FieldLabel>{locale === "de" ? "Zeitstempel" : "Timestamps"}</FieldLabel></Field>
        </div>
      </FieldGroup>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{locale === "de" ? "Abbrechen" : "Cancel"}</Button><Button onClick={onSave} disabled={!draft.name.trim()}>{locale === "de" ? "Design speichern" : "Save design"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function emptyDesign(locale: AppLocale): DesignTemplate {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), name: "", author: "", description: "", logoDataUrl: null, createdAt: now, updatedAt: now, theme: { preset: "crumbtrailLight", accent: "#E9A23B", typography: "modern", logoAsset: null, showTimestamps: false, showApplicationNames: true, reportLocale: locale } }
}

function reportThemeName(theme: ReportTheme) { return theme === "crumbtrailLight" ? "Crumbtrail Light" : theme === "crumbtrailDark" ? "Crumbtrail Dark" : "Clean Print" }
function typographyName(typography: TypographyPreset) { return typography[0].toUpperCase() + typography.slice(1) }
