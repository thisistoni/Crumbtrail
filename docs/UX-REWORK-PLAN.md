# Crumbtrail UX Rework Plan

Status: primary UX rework implemented, verified, and packaged for Windows

## Implementation update — 2026-08-16

Follow-up completed on 2026-08-19:

- The native Start command hides the main window; Pause keeps it hidden; Stop and the stop hotkey restore the editor.
- Back navigation uses screen history, including the editor-to-recording-setup path.
- Home Designs are complete reusable configurations rather than report-style swatches.
- Designs include author, description, logo, accent, typography, report style, report language, timestamps, and application-name visibility.
- New guides open target selection immediately with a temporary title that is replaced by the first recorded application.
- Designs are chosen only in the editor, where the current appearance can also be saved as a reusable Design.
- Windows click capture includes duplicate suppression and a fallback for systems that suppress low-level hook delivery.

Completed in the current iteration:

- Structured Home workspace with Projects/Themes navigation and a localized, single-line slogan.
- Real pointer and keyboard step reordering with aligned rows and no unexplained status dot.
- Canvas zoom from 25–400%, Fit, 100%, Ctrl+/Ctrl−/Ctrl+0, Ctrl+wheel, and grab-to-pan.
- Shared canvas/inspector selection, eight resize handles, rotation, drag, arrow-key nudging, and Delete.
- Red annotations, UI Automation outlines for click and typing steps, and no automatic click circle.
- Crumbtrail shape context menus and suppression of native WebView context menus.
- Reversible crop editing with visible source pixels, outside dimming, handles, and a non-distorting applied view.
- Full-window canonical HTML preview using the fixed print layout.
- Live monitor thumbnails, recording-only lifecycle, and editor display only after recording stops.
- Solid HUD surface with transparent corners, two-click region selection, adjustable region corners, and top-left Back navigation.
- English/German app and report language selection.
- Local reusable report-theme presets and optional automatic focus zoom.
- Schema-1 to schema-2 in-memory migration with compatibility tests.

Latest hands-on feedback incorporated:

- Step numbers and drag handles share the same vertical alignment.
- The decorative yellow step-row dot was removed.
- The screenshot workspace pans like an image editor instead of behaving like a static web image.
- Crop sizing no longer inherits the browser image max-width constraint that caused stretching.
- Delete removes the selected unprotected annotation.
- The project editor has an explicit Back button and uninterrupted section separators.
- German labels no longer fall back to the English slogan on Home.
- Step and export action menus use single-line items with sufficient width.

This document records the UX issues found during hands-on testing and turns them into an ordered implementation plan. It is the source of truth for the next Crumbtrail iteration.

## Product direction

- Keep the line: **“Leave a trail anyone can follow.”**
- Preserve the editor’s right inspector as the visual quality bar.
- Make the application feel like a focused Windows desktop tool, not a website in a window.
- Do not add subtitles, helper text, or descriptive copy by default. Use supporting copy only when it prevents an error or explains a privacy-sensitive action.
- Keep all edits non-destructive. Source screenshots remain immutable.

## Feedback inventory

| Area | Problem | Required outcome |
| --- | --- | --- |
| Home | The starting screen feels random and lacks hierarchy. | A structured, professional workspace with obvious primary actions and project organization. |
| Home | The strongest part is the slogan. | Retain “Leave a trail anyone can follow.” as the only prominent marketing line. |
| Step list | The drag affordance does not drag. | Real pointer and keyboard reordering with autosave and undo. |
| Step list | Rows feel unorganized and the click icon is weak. | Clear alignment, stronger hierarchy, better selected state, and a cleaner step-type treatment. |
| Canvas | No zoom controls. | Zoom, fit, 100%, wheel zoom, and panning while editing. |
| Canvas | Click marker and shapes use the theme accent. | New annotations default to red independently of the report theme. |
| Canvas | Click marker is too large. | A smaller screen-consistent marker with an adjustable size. |
| Canvas | Shapes can move but cannot be selected, resized, or rotated. | Selection box, resize handles, rotation, dragging, keyboard nudging, and inspector controls. |
| Canvas | Browser/WebView context menus appear. | Suppress native web context menus and provide Crumbtrail context actions. |
| Canvas | Canvas and annotation list selection are disconnected. | One shared selected-annotation state across canvas and inspector. |
| Crop | Crop only becomes visible in export. | Crop affects the editing canvas immediately after confirmation. |
| Crop | Crop interaction is not image-editor quality. | Reversible Photoshop-style crop mode with a dimmed outside area and adjustable handles. |
| Preview | Preview is a separate approximation and omits crops/shapes. | Render the exact HTML generated for export in the preview. |
| HUD | A rounded HUD is shown inside a rectangular webview background. | Only the rounded HUD surface is visible; all surrounding pixels are transparent. |
| Region | The screen becomes opaque/black. | The selected display remains visible beneath a translucent mask. |
| Region | The second click starts a new selection. | First click sets corner A, second click sets corner B, then the selection can be refined and confirmed. |
| Setup | The back action is labelled “Home” and placed on the right. | A conventional top-left **Back** action. |
| Language | German is missing. | Complete English and German application localization. |
| Reports | Reusable themes are missing. | Save, apply, duplicate, import, and export constrained theme presets. |
| Reports | No automatic focus on the action area. | Optional non-destructive focus zoom calculated from the clicked control or click point. |

## Implementation phases

### Phase 1 — Desktop interaction fixes

- [ ] Disable the WebView2/browser context menu at the application root.
- [ ] Add a Crumbtrail canvas context menu using the installed shadcn context-menu component.
- [ ] Right-clicking a shape selects it and offers Delete, Duplicate, Bring forward, Send backward, and Reset transform.
- [ ] Right-clicking empty canvas offers Fit to screen, 100%, and Paste annotation when applicable.
- [ ] Move the recording-setup navigation to the top-left and label it **Back**.
- [ ] Make `html`, `body`, and `#root` transparent for HUD and region surfaces only.
- [ ] Resize the HUD window to the visible pill and remove every rectangular background layer around it.
- [ ] Rebuild region selection as an explicit state machine: `idle → firstCorner → selected → confirmed`.
- [ ] Render region dimming with four outside panels so the chosen area stays truly clear.
- [ ] After the second click, keep the rectangle fixed and expose corner/edge handles for adjustment.
- [ ] Escape cancels; Enter confirms; confirmation remains disabled below the minimum capture size.

Acceptance:

- No standard Print, Save as, or Save image as menu appears anywhere in Crumbtrail.
- The HUD has transparent corners in Windows screenshots and never shows a rectangular backing window.
- Region selection remains visibly aligned at 100%, 125%, 150%, and 200% scaling.
- Two clicks create one stable region and never restart the selection.

### Phase 2 — Professional Home workspace

- [ ] Keep the Crumbtrail brand and the slogan **“Leave a trail anyone can follow.”**
- [ ] Replace the current promotional composition with a clear application workspace:
  - compact title/header area;
  - primary **New recording** action;
  - secondary **Open project** action;
  - recent projects as the main content area;
  - recovered sessions shown as an explicit state, not a decorative feature card.
- [ ] Give recent projects consistent columns for title, steps, last edited, and recovery state.
- [ ] Add sorting and search only when the project count makes them useful.
- [ ] Make every project row keyboard-accessible and visibly actionable.
- [ ] Remove decorative cards or copy that does not help the user choose an action.

Acceptance:

- A first-time user can identify how to record, open, or recover a guide without scanning unrelated cards.
- Returning users see their recent work immediately.
- The slogan remains visually prominent but does not compete with the project actions.

### Phase 3 — Step timeline rebuild

- [ ] Replace the fake grip with real sortable behavior using a maintained accessible drag-and-drop library.
- [ ] Support pointer drag, keyboard reorder, auto-scroll, cancellation, and a visible insertion position.
- [ ] Commit one undoable project change when a drag completes; do not autosave every pointer movement.
- [ ] Redesign each row around a stable grid:
  - drag handle;
  - step number;
  - instruction title;
  - compact metadata/status;
  - inclusion state.
- [ ] Remove the current click-circle icon. Use a subtle step-type label or a clearer `MousePointerClick` icon only when it adds information.
- [ ] Add a small screenshot thumbnail if it improves scanning without making the column noisy.
- [ ] Keep selected, hover, focus, excluded, and dragging states visually distinct.
- [ ] Preserve the existing Earlier/Later buttons as an accessible fallback.

Acceptance:

- Dragging step 8 above step 3 updates the manifest order, editor selection, undo stack, autosave, preview, and export.
- Keyboard users can perform the same reorder.
- A 50-step list remains responsive and easy to scan.

### Phase 4 — Canvas viewport and annotation model

- [ ] Introduce a dedicated canvas viewport state separate from project data:
  - zoom range 25–400%;
  - Fit;
  - 100%;
  - centered zoom around the cursor;
  - Space-drag or middle-drag panning;
  - Ctrl+mouse-wheel zoom.
- [ ] Keep annotation coordinates image-relative regardless of zoom, pan, crop, or window DPI.
- [ ] Add `selectedAnnotationId` and keep canvas selection synchronized with the annotation inspector.
- [ ] Clicking a shape selects it; clicking empty canvas clears selection.
- [ ] Draw an editor-only transform box with eight resize handles and one rotation handle.
- [ ] Support dragging, proportional resize when appropriate, rotation, keyboard nudging, and Delete.
- [ ] Add optional inspector controls for X, Y, width, height, rotation, stroke, color, opacity, and marker size.
- [ ] Add z-order to annotations and context-menu actions for changing it.
- [ ] Default click markers, outlines, arrows, and rectangles to `#ef4444` rather than the report accent.
- [ ] Reduce the default click marker to approximately 16 physical pixels at 100% zoom.
- [ ] Make marker size screen-consistent in the editor and explicitly stored for export.
- [ ] Preserve password redactions as protected annotations that cannot accidentally be deleted or made transparent.

Data model:

- Migrate project schema 1 to schema 2 on open without modifying the original archive until save.
- Add optional annotation fields with safe defaults: `rotation`, `opacity`, `zIndex`, and `markerSize`.
- Keep normalized geometry as the persisted source of truth.

Acceptance:

- Shapes remain aligned within three physical pixels across zoom levels and mixed-DPI monitors.
- Every manipulation is undoable and autosaved only at interaction boundaries.
- Canvas selection, right inspector selection, and context-menu selection always agree.
- Export output matches the selected annotation transforms.

### Phase 5 — Reversible crop workflow

- [ ] Treat crop as a single viewport operation per step rather than an ordinary visible shape.
- [ ] Entering Crop shows the full immutable source image.
- [ ] Initialize the crop frame from the existing crop or the full image.
- [ ] Dim only the area outside the crop frame.
- [ ] Provide corner and edge handles, rule-of-thirds guides, minimum size, and boundary constraints.
- [ ] **Apply** stores the normalized crop; **Cancel** restores the previous crop.
- [ ] Outside crop mode, the canvas displays only the cropped result and remaps annotations exactly as export does.
- [ ] Re-entering Crop reveals the hidden image area and allows expansion back toward the original bounds.
- [ ] Add Reset crop.

Acceptance:

- Canvas, actual HTML preview, HTML export, PDF export, and image export show the same crop.
- Reopening Crop never destroys pixels or prevents restoring previously hidden areas.
- Shapes crossing a crop edge clip consistently in every renderer.

### Phase 6 — One canonical report renderer

- [ ] Expose a backend command that calls the existing Rust `render_html` path and returns the exact self-contained report HTML.
- [ ] Replace the React approximation in `ReportPreview` with a sandboxed iframe/webview rendering that HTML.
- [ ] Refresh preview after project edits without maintaining a second report layout.
- [ ] Keep HTML, PDF, and preview on the same render function and annotated-image flattener.
- [x] Show the fixed print layout without redundant paper-format controls.
- [ ] Test crops, rotations, z-order, text, blur, page breaks, themes, and localization through the canonical renderer.

Acceptance:

- Saving the preview HTML and exporting HTML produces byte-equivalent report markup apart from preview-only transport details.
- A crop or annotation changed in the editor appears identically in preview and export.
- The old `PreviewStep` approximation is removed.

### Phase 7 — German localization

- [ ] Add a typed message catalog with `en` and `de` locales.
- [ ] Default to the Windows locale on first launch and provide a language setting.
- [ ] Translate Home, setup, HUD, editor, dialogs, menus, errors, accessibility labels, export UI, and generated generic instructions.
- [ ] Localize relative dates, timestamps, number formatting, paper labels, and report boilerplate.
- [ ] Store report language per project so a German UI can still export an English guide and vice versa.
- [ ] Never translate user-entered project titles, instructions, notes, control names, or imported content.
- [ ] Set the exported HTML `lang` attribute correctly.

Acceptance:

- Switching language updates every open Crumbtrail surface, including the HUD.
- No hard-coded English UI strings remain outside tests and translation catalogs.
- English and German reports use the same layout and renderer.

### Phase 8 — Reusable report themes

- [ ] Add a local theme-preset library separate from individual projects.
- [ ] A preset contains constrained branding values only: name, base theme, accent, typography, logo, metadata visibility, spacing, and report language defaults.
- [ ] Support Save as preset, Apply, Duplicate, Rename, Delete, Export, and Import.
- [ ] Use a versioned `.crumbtheme` JSON format with validated assets and no arbitrary HTML/CSS.
- [ ] Keep the three built-in themes immutable; user presets can derive from them.
- [ ] Preview a preset through the canonical report renderer before applying it.

Acceptance:

- Applying the same preset to two projects produces consistent report styling.
- Invalid, newer, or unsafe theme files are rejected without changing the project.

### Phase 9 — Automatic focus zoom

- [ ] Add an optional per-step **Focus zoom** treatment.
- [ ] Seed its focus region from the UI Automation element bounds; fall back to the click point.
- [ ] Add configurable padding and a minimum context area so the result remains understandable.
- [ ] Let the user reposition, resize, disable, or reset the suggested region.
- [ ] Keep it non-destructive and independent from the editor’s temporary viewport zoom.
- [ ] Apply it consistently in canonical preview and all annotated exports.

Acceptance:

- A small control can be emphasized without losing the original screenshot.
- Focus zoom never exposes pixels outside an existing crop or password redaction.

## Shared engineering requirements

- [ ] Use one tested geometry module for selection, resize, rotation, crop remapping, hit testing, and export transforms.
- [ ] Keep pointer-move state transient and commit project updates on pointer-up.
- [ ] Preserve undo/redo across reorder, resize, rotate, crop, z-order, and theme application.
- [ ] Prevent default browser dragging, selection, image saving, and context menus on editor surfaces.
- [ ] Maintain keyboard access and visible focus for every operation.
- [ ] Add tests for negative monitor coordinates and 100%, 125%, 150%, and 200% DPI.
- [ ] Add visual fixtures covering click markers, every shape type, crop, rotation, blur, German copy, and long step lists.
- [ ] Verify a 50-step project stays responsive.
- [ ] Rebuild and smoke-test both the portable executable and installer after each release milestone.

## Recommended delivery order

1. Desktop interaction fixes and region selector.
2. Home workspace and step timeline.
3. Schema 2 migration and shared geometry.
4. Canvas zoom, selection, transforms, and context menus.
5. Reversible crop.
6. Canonical HTML preview.
7. German localization.
8. Reusable themes.
9. Automatic focus zoom.

This order fixes the broken interactions first, then establishes the geometry and rendering foundations required for the larger editor features.
