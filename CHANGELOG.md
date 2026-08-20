# Changelog

All notable changes to Crumbtrail are documented here.

## Unreleased

- Hide the main window throughout active and paused recordings; restore the editor only after Stop.
- Track real screen history for Back navigation.
- Replace theme swatches with reusable Designs containing author, description, logo, accent, typography, report style, language, and visibility settings.
- Start a new guide directly in target selection without asking for a title or Design.
- Name untitled guides from the first recorded application while keeping the title editable.
- Apply saved Designs and save the current appearance as a Design from the editor.
- Run duplicate-safe Windows mouse polling on a verified worker independent from the low-level hook message pump.
- Surface frame and screenshot persistence failures instead of silently dropping recording steps.

## 0.1.0 - 2026-08-14

- Initial Windows 11 x64 MVP.
- Monitor, window, and rectangular-region capture through Windows Graphics Capture.
- Click, grouped typing, and manual steps with before/after frame candidates.
- UI Automation captions, element outlines, and pre-persistence password redaction.
- Crash-safe local sessions and validated portable `.crumbtrail` archives.
- Editable steps, annotations, crops, branding, and three report themes.
- Self-contained HTML, PDF, and annotated/raw image-folder export.
- Per-user unsigned NSIS installer with WebView2 bootstrap fallback.
