# Windows capture fixture

Run this per-monitor-DPI-aware WinForms app when manually verifying capture, UI Automation metadata, password redaction, transient menus, dialogs, and resizing.

```powershell
dotnet run --project fixtures/windows-capture-fixture/Crumbtrail.CaptureFixture.csproj
```

The standard controls expose accessible names and physical bounds through Windows UI Automation. The password field uses the native protected-input flag.
