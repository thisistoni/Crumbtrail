# Privacy model

Crumbtrail is designed for local documentation, not surveillance or diagnostic collection.

## Data Crumbtrail stores

- Screenshots for completed steps, scoped to the selected monitor, window, or region.
- Editable instructions and notes.
- Application/control names, application icons, and UI Automation identifiers when Windows exposes them.
- Normalized annotation and crop geometry.
- Project branding, capture preferences, and creation/update times.

## Data Crumbtrail does not store

- Entered text, ordinary key codes, or raw keyboard logs.
- Mouse movement, wheel activity, middle clicks, or activity outside the target.
- Audio, video, clipboard contents, environment dumps, accounts, or cloud identifiers.
- Analytics, advertising IDs, crash telemetry, or background network events.

Low-level keyboard hooks classify only whether an eligible printable interaction occurred in the focused control. The key itself is not sent to the persistence worker. Hotkey combinations are recognized only for capture, pause/resume, and stop.

Application icons are extracted locally from the foreground process and stored as PNG assets. Executable paths and process identifiers are not written to project manifests.

## Password handling

If Windows UI Automation marks the focused control as a password field, its physical rectangle is converted to target-relative coordinates and blurred before either buffered candidate is written. Export flattening retains that redaction. Protected/UAC/DRM surfaces are reported as unsupported and are not bypassed.

## Local files and recovery

Active sessions live under `%LOCALAPPDATA%\Crumbtrail\sessions`. A completed edit is written to a temporary file and atomically moved into place. Empty recording drafts are excluded from the project library and removed when the user backs out. Sessions with recorded steps are retained until the user removes them.

Portable project archives and exports are written only to destinations selected by the user. Opening an archive never extracts over an existing session and rejects absolute, parent-relative, symlinked, oversized, or unsupported entries.

## Network access

The application has no accounts, telemetry, sharing service, or runtime API. The installer may download Microsoft's WebView2 bootstrapper when the runtime is absent. PDF export uses the locally installed Edge/WebView2 engine and does not upload report content.
