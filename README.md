# Crumbtrail

Crumbtrail records focused Windows interactions and turns them into polished, editable process guides. It is a modern, local-first alternative to Windows Steps Recorder: choose one monitor, one window, or an exact region; keep only useful interactions; refine the result; then export a report that looks intentionally designed.

> [!NOTE]
> Version 0.1.0 targets Windows 11 x64. The native boundary is portable, but macOS and Linux capture backends are not implemented yet.

## Highlights

- Windows Graphics Capture with an explicit monitor/window picker and region overlay.
- Cursor-free frames, capture-protected HUD/overlays, mixed-DPI and negative-coordinate handling.
- Click steps, privacy-safe grouped typing steps, and manual captures.
- Pre-action and visually stable post-action screenshot candidates.
- UI Automation captions, element bounds, and password redaction before disk persistence.
- Editable order, text, notes, inclusion, screenshot moment, crops, blur, markers, outlines, arrows, rectangles, and callouts.
- Three report themes with controlled branding and typography.
- Self-contained HTML, A4 PDF, numbered image folders, and portable `.crumbtrail` archives.
- Atomic local autosave and recovery, with no account, telemetry, or cloud service.

## Build from source

Requirements:

- Windows 11 x64
- Node.js 20+ and pnpm 10+
- Rust stable MSVC
- Visual Studio 2022 Build Tools with Desktop development with C++
- Microsoft Edge WebView2 Runtime

```powershell
pnpm install
pnpm tauri dev
```

Run the checks:

```powershell
pnpm lint
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Build the unsigned per-user installer:

```powershell
pnpm tauri build --bundles nsis
```

The installer is created under `src-tauri\target\release\bundle\nsis`. It includes uninstall and Start Menu integration and uses the WebView2 download bootstrapper when required. Version 0.1.0 is intentionally unsigned, so SmartScreen may show a reputation warning.

## Keyboard controls

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+F8` | Capture a manual step |
| `Ctrl+Shift+F9` | Pause or resume |
| `Ctrl+Shift+F10` | Stop recording |

Ordinary keys are classified only long enough to group activity in one focused control. Key codes and entered text are never persisted or logged.

## Project format

A `.crumbtrail` file is a validated ZIP archive with a schema-versioned `manifest.json`, source PNGs, thumbnails, optional logo, and separate annotation data. Schema `1` is accepted; newer versions are rejected without modifying the source archive.

See [architecture](docs/ARCHITECTURE.md), [privacy model](docs/PRIVACY.md), [contributing](CONTRIBUTING.md), and [Windows signing](docs/SIGNING.md).

## Known platform limits

Crumbtrail reports UAC secure desktop, DRM-protected content, inaccessible elevated surfaces, and unavailable UI Automation metadata as unsupported. Custom-rendered controls fall back to generic editable instructions and click-position highlighting.

## License

Licensed under either the [MIT License](LICENSE-MIT) or [Apache License 2.0](LICENSE-APACHE), at your option.
