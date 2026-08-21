<p align="center">
  <img src="src/assets/brand/crumbtrail-logo.png" width="144" alt="Crumbtrail logo">
</p>

<h1 align="center">Crumbtrail</h1>

<p align="center"><strong>A modern, open-source Windows Steps Recorder (PSR) alternative.</strong></p>

<p align="center">Record clicks and typing actions, edit every step, and export a polished process guide.</p>

<p align="center">
  <a href="https://github.com/thisistoni/Crumbtrail/releases/latest"><strong>Download Crumbtrail for Windows</strong></a>
  ·
  <a href="docs/PRIVACY.md">Privacy</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Crumbtrail replaces the classic Windows Problem Steps Recorder (`psr.exe`) with a focused, customizable workflow. Choose one monitor, one window, or an exact region; capture only useful interactions; edit the instructions and screenshots; then export an HTML, PDF, or image-based guide that is ready to share.

Everything is processed locally. Crumbtrail has no account, telemetry, cloud service, or stored keystrokes.

> [!IMPORTANT]
> Crumbtrail 0.1.0 supports Windows 11 x64. The release is currently unsigned, so Microsoft Defender SmartScreen may show an unrecognized-app warning. Review the source and SHA-256 checksums on the release page before running it.

## Why use Crumbtrail instead of Windows Steps Recorder?

| | Crumbtrail | Windows Steps Recorder / PSR |
|---|---|---|
| Capture target | One monitor, window, or region | Captures the full desktop across monitors |
| Editing | Edit, reorder, duplicate, merge, crop, annotate, or remove steps | Limited report editing |
| Screenshots | Before/after candidates with manual selection | Automatic screenshots only |
| Highlights | UI element outlines, arrows, rectangles, blur, crop, and callouts | Basic click indication |
| Reports | Styled HTML, compressed A4 PDF, image folders, and `.crumbtrail` projects | MHTML report |
| Branding | Reusable designs, logo, accent, typography, author, and visibility controls | Fixed appearance |
| Privacy | Local-only, no stored text or ordinary key codes, password redaction | Diagnostic-oriented output |
| Availability | Open source and actively developed | Deprecated by Microsoft |

## Features

- Windows Graphics Capture with visual monitor selection, window selection, and a region overlay.
- Capture-protected recording border, click feedback, cursor-free frames, and mixed-DPI support.
- Automatic click steps, privacy-safe grouped typing steps, and manual captures.
- Pre-action and visually stable post-action screenshot candidates.
- Windows UI Automation captions, element borders, application icons, and password redaction before persistence.
- Editable steps, instructions, notes, order, inclusion, screenshot moment, crops, blur, markers, outlines, arrows, rectangles, and callouts.
- Reusable report designs with logo, accent color, typography, author, and optional Crumbtrail branding.
- Self-contained HTML, compressed A4 PDF, numbered image folders, and portable `.crumbtrail` archives.
- Atomic local autosave and recovery.
- German and English interface.

## Download

Download the latest portable app or per-user installer from [GitHub Releases](https://github.com/thisistoni/Crumbtrail/releases/latest).

- **Portable:** download the portable `.exe` and run it from any folder.
- **Installer:** installs for the current Windows user and adds Start Menu and uninstall entries.

No administrator privileges are required. Microsoft Edge WebView2 is required; the installer can download its bootstrapper when it is missing.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+F8` | Capture a manual step |
| `Ctrl+Shift+F9` | Pause or resume |
| `Ctrl+Shift+F10` | Stop recording |

Shortcuts can be changed in Settings. Ordinary keys are classified only long enough to group activity in one focused control. Key codes and entered text are never persisted or logged.

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
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Build the unsigned per-user installer:

```powershell
pnpm tauri build --bundles nsis
```

The installer is created under `src-tauri\target\release\bundle\nsis`.

## Project format

A `.crumbtrail` project is a validated ZIP archive containing a schema-versioned `manifest.json`, source images, application icons, thumbnails, an optional logo, and separate annotation data. Schema `2` is current. Supported older versions are migrated in memory; newer versions are rejected without modifying the source archive.

See the [architecture](docs/ARCHITECTURE.md), [privacy model](docs/PRIVACY.md), [contributing guide](CONTRIBUTING.md), and [Windows signing notes](docs/SIGNING.md).

## Platform limits

Crumbtrail reports UAC secure desktop, DRM-protected content, inaccessible elevated surfaces, and unavailable UI Automation metadata as unsupported. Custom-rendered controls fall back to generic editable instructions and position-based highlighting. Windows 10, ARM64, macOS, Linux, video, audio, OCR, cloud sharing, collaboration, and auto-update are not supported in 0.1.0.

## Frequently asked questions

### Is Crumbtrail an alternative to `psr.exe`?

Yes. Crumbtrail records Windows interactions and turns them into step-by-step documentation, but adds target selection, editable screenshots and instructions, annotations, reusable designs, and modern export formats.

### Does Crumbtrail record what I type?

No. It detects printable keyboard activity only to create a generic text-entry step. Entered text and ordinary key codes are not written to projects or logs.

### Is Crumbtrail a screen or video recorder?

Crumbtrail is a process-documentation recorder. It captures selected screenshots around actions rather than continuous video or audio.

### Is Crumbtrail affiliated with Microsoft?

No. Crumbtrail is an independent open-source project. Windows, Microsoft Edge, and Steps Recorder are trademarks or products of Microsoft Corporation.

## License

Licensed under either the [MIT License](LICENSE-MIT) or [Apache License 2.0](LICENSE-APACHE), at your option.
