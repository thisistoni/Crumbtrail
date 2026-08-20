# UX polish pass

This checklist is the implementation contract for the August 2026 polish pass. Recording must continue to create click and typing steps throughout the work.

## Recording and defaults

- [x] Generate German instructions when the application language is German.
- [x] Persist global defaults for auto-focus and annotation line thickness.
- [x] Use one configurable auto-focus zoom percentage in recording and editing.
- [x] Persist editable `Ctrl+Shift+F-key` shortcuts for capture, pause, and stop.
- [x] Apply those shortcuts in the Windows hook and show the configured values in setup and the HUD.

## Editor

- [x] Give timeline steps the same duplicate, merge-next, and delete actions on right click as the properties menu.
- [x] Clear the selected annotation when clicking either the screenshot or empty canvas.
- [x] Hide canvas scrollbars and show a bottom-center recenter button only after panning.
- [x] Fit the screenshot responsively on first load and when changing steps; preserve manual zoom afterward.
- [x] Keep annotation creation tied to the global line-thickness default.

## Preview and export

- [x] Rename the export actions to “Exportieren als…” and “Projektdatei speichern” in German.
- [x] Show consistent display labels for language, paper size, theme, and typography selects.
- [x] Use a fixed A4 PDF layout without a redundant paper-format selector.
- [x] Open the real HTML preview as the fitted print document without format controls.
- [x] Remove the preview refresh action.

## Recording setup

- [x] Reduce target, source, capture-option, and ready-card height and empty space.
- [x] Keep privacy explanations only where omitting them could cause misunderstanding.

## Verification

- [x] Frontend tests, lint, and production build pass.
- [x] Rust formatting, unit tests, and clippy pass.
- [x] A Windows smoke recording still creates a step, stops, and returns to the editor.
- [x] Produce updated portable and per-user installer artifacts.
