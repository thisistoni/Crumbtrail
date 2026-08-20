# Windows packaging

The release path is Tauri's unsigned, current-user NSIS target:

```powershell
pnpm tauri build --bundles nsis
```

`build-bootstrapper.ps1` creates an unsigned IExpress-based current-user bootstrapper when the Tauri CLI or NSIS toolchain is unavailable locally. It installs to `%LOCALAPPDATA%\Programs\Crumbtrail`, creates a Start Menu shortcut, and registers an uninstaller without administrator rights.
