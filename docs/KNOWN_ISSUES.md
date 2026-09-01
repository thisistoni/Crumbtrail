# Known product issues

This is the working backlog from the 2026-08-30 end-to-end review. An item is only marked complete after the relevant focused tests and the full affected test suite pass. Partial mitigations stay open and are noted under the item.

## P0 — data safety and privacy

- [x] Closing the application from an open project must flush changes and actually quit.
  - Current issue: the editor calls the restricted window `destroy` API without the corresponding capability, catches the rejection, and leaves the app open.
- [x] Recording Undo must only remove a step created in the current recording session, run on the recorder event queue, and immediately update the HUD and editor.
  - Current risk: it can delete a step from an earlier session, race a recorder write, and leave stale UI state that can restore the deleted step through autosave.
  - Areas: `src-tauri/src/recorder`, `src-tauri/src/commands.rs`, recording state and HUD.
- [x] Editor autosave must flush before navigation or close, serialize writes, reject stale completions, and retry/report failures.
  - Current risk: Back cancels the debounce and an older in-flight save can overwrite a newer edit.
  - Areas: `src/screens/editor.tsx`, app/window lifecycle, persistence tests.
- [x] Project deletion must be recoverable and clearly confirmed.
  - Current risk: the `Remove` action recursively deletes the session immediately.
  - Areas: Home project menu and storage service.
- [x] Orphaned media must not accumulate indefinitely or be included in portable archives.
  - Current evidence: a reviewed session had six unreferenced media files totaling 13,195,652 bytes, all eligible for inclusion by the current archive writer.
  - Areas: autosave/session compaction and `save_archive`.
- [x] A recoverable recorder error must set the actual pause flag as well as the visible state.
  - Current risk: the UI says Paused while event processing can continue.
  - Area: `src-tauri/src/recorder/windows.rs`.
- [x] Privacy wording must accurately describe what screenshots can contain.
  - Current issue: “Entered text is never stored” is too absolute because an after-action screenshot can visibly contain entered text.
  - Areas: setup UI, architecture/privacy documentation.

## P1 — step semantics and editing

- [x] Manual snapshots must use manual-snapshot semantics throughout the UI.
  - Use a camera icon and a “Snapshot” identity, not the Crumbtrail application icon/name.
  - Do not show interaction-only controls such as screenshot timing or Auto focus; provide an explicit focus-area action if useful.
  - Areas: recorder output, step timeline, step editor, report preview/export.
- [x] Application icons must be fully designable.
  - Allow a per-step icon override or no icon, and a guide-level setting to hide application icons everywhere.
  - Keep application name visibility independent from icon visibility.
  - Areas: project schema, design settings, timeline, editor, preview, exporters.
- [x] Step type must remain visible when an application name is present.
  - Current issue: the timeline’s secondary line replaces the kind with the application.
- [ ] Merge must reject or explicitly resolve incompatible steps.
  - Current risk: merging different applications, step kinds, screenshots, focus areas, or media silently keeps only the first step’s semantics while combining annotations.
- [ ] Generated captions must bound and sanitize UI Automation control names.
  - Current evidence: a control name containing a command transcript became the generated instruction.
- [ ] Replacing a screenshot must offer to reset or validate crop, focus area, and annotations.
  - Current risk: geometry from the old image is silently reused on a different image.
- [ ] Undo/redo must group text editing meaningfully and include keyboard annotation movement.
  - Current issue: text is undone one character at a time and keyboard nudges are not undoable.
- [ ] Report/instruction language must be an explicit project setting.
  - Current issue: export language silently follows the current application locale.

## P1 — recording flow

- [x] Click and typing screenshots must use the frame from the input event, not whichever frame is current when the processing queue catches up.
  - Current issue: 4K image encoding can delay the worker by seconds, causing a step's “before” screenshot to visibly postdate the click.
- [x] Clicking Crumbtrail recording controls must never create a step for the window underneath the HUD.
  - Current issue: HUD ownership is checked after queued processing; once Stop closes the HUD, the same coordinates resolve to Chrome and can become a false address-bar step with no application icon.
- [x] Recorded steps must use the application under the click at event time.
  - Previous issue: coordinates were captured immediately but the foreground process was queried later on the slower image-processing thread, so a focus change could falsely label an unrelated step `Crumbtrail.exe`.
- [x] Manual capture must have one consistent paused-state policy.
  - The HUD now disables manual capture while paused and the backend rejects paused hotkey/IPC requests instead of silently discarding them.
- [x] HUD actions must expose busy state and failures, and prevent duplicate requests.
  - Manual capture now acknowledges immediately in the counter, permits one in-flight request, disables/pulses the camera while saving, and reports failures.
- [ ] Starting a recording must fail visibly if the HUD or recording overlay cannot open.
  - Current issue: `Promise.allSettled` ignores both failures.
- [ ] Canceling region selection must restore the previous target selection.
  - Current issue: the new target is committed before the region picker succeeds.
- [ ] Imported privacy settings must not produce a locked contradictory control.
  - Current issue: an imported project can have password redaction off while the UI switch is disabled.

## P1 — export and design

- [ ] Image export must require at least one output and report actual files and warnings.
  - Current issue: both outputs can be off, Export remains enabled, zero files are written, and the UI still reports success.
- [ ] Hiding application names must not leave an unexplained application icon marker.
- [ ] Exported metadata must use friendly application names and localized human-readable dates instead of raw `.exe` names and RFC 3339 timestamps.
- [ ] Applying a design must not silently overwrite guide content such as author and description.
- [ ] Design deletion must be confirmed or recoverable.

## P2 — layout, accessibility, and polish

- [x] Project-card actions must be consistently positioned and available from the card context menu.
  - The three-dot trigger is anchored to the card's top-right corner, and right-clicking anywhere on the card opens Rename and Remove at the pointer position.
- [ ] The editor must fit its declared minimum window width or the minimum width must be raised.
  - Current issue: the three columns require 1060 px before gaps/controls while the window minimum is 1040 px, so the toolbar clips.
- [ ] Every switch, icon button, checkbox, slider, and select must have an accessible name.
  - Confirmed gaps include recording setup, appearance, export, and settings controls.
- [ ] Setup metadata must be localized completely.
  - Current issue: words such as “region” and “scaling” remain in English in the German UI.

## Verification record

- 2026-08-30 audit baseline: `pnpm test` 37/37 passed; `cargo test` 37 passed and 1 ignored; `pnpm lint`, `pnpm build`, and `cargo fmt --check` passed.
- 2026-08-30 recording Undo: focused cross-session regression passed; full `cargo test` 38 passed and 1 ignored; `pnpm test` 37/37 passed; `pnpm lint`, `pnpm build`, and `cargo fmt --check` passed.
- 2026-08-30 autosave durability: serialization/retry and pre-navigation flush regressions passed; full `pnpm test` 40/40 passed; `pnpm lint` and `pnpm build` passed.
- 2026-08-30 data retention, pause synchronization, privacy, manual snapshots, and editable icons: focused storage, recorder, editor, and report regressions passed; final `cargo test` 42 passed and 1 ignored; final `pnpm test` 42/42 passed; `pnpm lint`, `pnpm build`, and `cargo fmt --check` passed.
- 2026-08-30 manual-capture responsiveness and HUD separators: native 4K capture completed once while duplicate requests were blocked; the project was restored to its original 7 steps after QA; optimistic-count, coalescing, and full-height separator regressions passed; final `cargo test` 43 passed and 1 ignored; final `pnpm test` 44/44 passed; `pnpm lint`, `pnpm build`, `cargo fmt --check`, and `git diff --check` passed.
- 2026-08-30 application attribution: click and typing events now retain their application identity at input time instead of querying the later foreground window; the saved Spotify step was corrected and native readback showed `KLICK · SPOTIFY.EXE` plus the editable `Anwendung` field; final `cargo test` 44 passed and 1 ignored; final `pnpm test` 45/45 passed; `pnpm lint`, `pnpm build`, `cargo fmt --check`, and `git diff --check` passed.
- 2026-08-30 capture timing, HUD exclusion, and project close: queued click/typing/manual events now retain the capture-time frame through shared pixel buffers; HUD clicks retain Crumbtrail ownership after the HUD closes; the missing window-destroy capability is enabled and native close-from-project ended the process; the two bogus address-bar steps were removed from “Chrome Anleitung,” leaving its other 8 steps; the optimized release launched with one app window and no terminal; final `cargo test` 46 passed and 1 ignored; final `pnpm test` 45/45 passed; `pnpm lint`, `pnpm build`, `cargo fmt --check`, and `git diff --check` passed.
- 2026-08-30 project-card actions: the menu trigger is positioned against the card rather than its header, and the same Rename/Remove actions open from a pointer-position context menu anywhere on the card; native release QA confirmed the context menu at the clicked card coordinates and the top-right trigger opened both actions; focused and full regressions passed; final `pnpm test` 46/46 passed; `pnpm lint`, `pnpm build`, and `git diff --check` passed.
- Completion evidence for each fixed item will be appended here before its checkbox is marked.
