# Changelog

All notable changes to Crumbtrail are documented here.

## 0.1.0 - 2026-08-21

### Recording

- Capture one monitor, one window, or a rectangular region through Windows Graphics Capture.
- Record left and right clicks, grouped text-entry actions, and manual steps without persisting entered text or ordinary key codes.
- Keep before-action and visually stable after-action frames for every recorded interaction.
- Generate editable instructions and element outlines from Windows UI Automation metadata.
- Redact password fields before either screenshot candidate reaches disk.
- Show a capture-excluded recording border, click feedback, and compact HUD without blocking recorder startup when a native window handle is delayed.
- Handle mixed DPI, negative monitor coordinates, duplicate mouse messages, and application icons outside the capture event worker.

### Editing

- Edit, reorder, duplicate, merge, include, exclude, replace, or delete recorded steps.
- Crop non-destructively and add editable outlines, arrows, rectangles, blur regions, markers, and text callouts.
- Pan and zoom the screenshot canvas with crop-aware annotation placement and autofocus controls.
- Use application icons in the project library, step timeline, and exported reports.
- Reuse Designs containing logo, accent color, typography, author, report style, and visibility preferences.
- Use the English or German interface; report language follows the application language.

### Export and storage

- Export self-contained HTML, compressed A4 PDF, annotated or raw image folders, and portable `.crumbtrail` projects.
- Render full-page Light or Dark PDF backgrounds with consistent page spacing and locally compressed screenshots.
- Autosave sessions atomically and recover unfinished work after interruption.
- Validate archive paths, sizes, schema versions, and assets before opening portable projects.

### Distribution

- Ship an unsigned Windows 11 x64 portable executable and per-user NSIS installer.
- License the project under MIT OR Apache-2.0.
