# Toolbox — working notes (last updated 2026-10-05, version 1.6.1)

Davide asked to integrate **the complete Scene Sync interface inside Toolbox**, not an external launcher.

**Package Prep was removed in 1.4.0, at his request** — he now prepares HDRP/URP package editions with his own Unity Editor script, so the tool had no reason to exist here. Removal was deliberate and complete: the tab, the UI, the engine modules, the Unity bridge scripts, the docs and the tests all went. Do not resurrect any of it from git history or from `Tools/_archive` unless he asks. What stayed is what Scene Sync itself needs.

## Preserve the existing Toolbox pattern

- `app/index.html` is still only the tab shell. All nine tabs are isolated same-origin iframes, created lazily and retained across tab switches. The seven original tool pages were not edited. A tab may name its own entry page through `page:`; nothing uses that now, but the mechanism is still there.
- Each page is independently editable. Scene Sync UI: `app/scene-sync/index.html`, `scene-sync.css`, `scene-sync.js`. Vanilla browser JS, local files only, English copy, dark neutral colors with small semantic accents. No emoji icons.
- `main.js` retains the original app://local origin, context isolation, sandbox, disabled renderer Node integration, zoom keys, saved window bounds and single-instance lock. The generic template in `Tools/_shared` was not changed.
- A narrow `desktop.sceneSync` API lives in `preload.js`. The parent lends the same bridge to its iframe through the existing `lendDesktop` mechanism. Do not enable Node in the renderer to work around a missing API.

## Files and responsibilities

| Location | Purpose |
|---|---|
| `app/scene-sync/*` | Scene Sync UI; native picker calls through preload |
| `scene-sync-host.cjs` | Validated IPC handlers, persistent settings, child-process runner |
| `scene-sync/backend/api.cjs` | The five accepted actions: `scenes`, `open-projects`, `compare`, `apply`, `restore` |
| `scene-sync/backend/core.cjs` | Scene comparison and merge |
| `scene-sync/backend/pipeline-isolation.cjs` | `auditScene` refuses a synced scene that would depend on the other pipeline. Kept for Scene Sync; its `audit` entry point is now only reached through `auditScene` |
| `scene-sync/backend/package-references.cjs` | GUID/reference parsing, used by the isolation audit |
| `scene-sync/runtime/` | Bundled Node and ripgrep; offline, no system Node needed at runtime |
| `scene-sync/licenses/`, `THIRD-PARTY.md` | Redistributed runtime notices |
| `prepare-scene-sync.cjs` | Generates the content-hash manifest before packaging |
| `build/icon.ico`, `build/make-icon.mjs` | The app icon and the script that draws it. Monochrome by request: near-black plate, four grey tiles lit from the top left. **Not a toolbox drawing**: he rejected two of those, then picked the tiles out of four options (tiles, hex nut, stacked cards, cut-corner frame) on 29 September 2026. Gaps widen below 32 px so the tiles do not merge. Bump the version whenever the icon changes: Windows caches icons by file path. Edit the geometry block at the top of the script and rerun `node build/make-icon.mjs build/icon.ico` rather than hand-editing the .ico. The purple original is in `Tools/_archive/toolbox-icon-purple-20260924.ico` |
| `app/clips/*` | Clip Joiner: `index.html`, `fonts.css` (Turret Road, OFL), `lib/mp4-muxer.mjs` |
| `tests/clips-check.cjs` | Clip Joiner end to end inside the real app |
| `tests/toolbox-ui.cjs` | Actual Electron/CDP integration checks and screenshots |
| `tests/user-workflow.cjs` | End-to-end scene sync through the real interface |
| `tests/scene-sync-host.test.cjs` | Adapter, unsupported requests, engine-cache checks |
| `scene-sync/tests/*` | Engine regressions; use temporary fixture projects |

## Build / run / verify

```powershell
.\build.ps1 -Run      # from source
.\build.ps1           # build, install to Tools\_app\Toolbox, point Tools\Toolbox.lnk at it
.\build.ps1 -Setup    # also an installer in dist\, only when another PC needs one
npm run test:scene-sync
npm run test:workflow
```

**Since 1.6.0 Toolbox runs from an unpacked folder, `Tools/_app/Toolbox`, not from a portable .exe.** Davide asked for a much faster start. Measured: the portable .exe took 3.3 to 5.0 s to show its window, because it unpacks the whole app to a temporary folder at every start; the unpacked copy shows it in 0.5 to 0.6 s (1.4 s on a cold first start). The folder is about 360 MB. User data stays in `%APPDATA%\Toolbox` either way, so nothing was lost in the switch. There is no portable target any more.

Electron remains **33.4.11**, locked by `package-lock.json`; electron-builder remains 25.1.8. Do not upgrade them as part of routine feature work. Build caches remain in `Tools/_cache`. Current version: **1.6.1**.

**A running Toolbox cannot be replaced.** `build.ps1` checks for it and stops with "Toolbox is open" instead of letting electron-builder hang.

## Git

The repository is this folder, `Tools/apps/Toolbox`: everything needed to rebuild the app is here, nothing else. Ignored: `node_modules`, `dist`, test output, `scene-sync/manifest.json` (generated) and `scene-sync/runtime/node.exe` (93 MB; `prepare-scene-sync.cjs` copies in the Node that runs the build - byte-identical to the bundled one, checked). Line endings: LF everywhere, CRLF for `.ps1`.

Remote since 5 October 2026: `origin` = https://github.com/DavideMezzaqui/toolbox (Davide created it; credentials are already stored in Git Credential Manager, the first push needed no login). Push after each commit once the tests pass.

Davide does not use Git himself. **Claude commits** at the end of each piece of work he asked for, after the tests pass, with a plain message saying what changed and why. Rules: never force-push, never rewrite history, `git pull --ff-only` before pushing, stop and tell him if anything would need merging. Check `git status` before starting work: changes not made in this session are his or another tool's, and must not be swept into a commit without saying so.

`npm run test:scene-sync` runs engine tests **before** the audit suite, since the latter consumes `test-results.json` fixtures. Do not parallelize that dependency.

For packaged UI QA, set `DAVFX_QA_PACKAGED` to `Tools/_app/Toolbox/Toolbox.exe`, then run `node tests/toolbox-ui.cjs`. QA uses `DAVFX_TOOLBOX_QA=1` and an isolated `DAVFX_TOOLBOX_QA_DATA` folder: no real Toolbox preferences or Unity scene assets should be changed by QA. Output is under `tests/screenshots` and `tests/*ui-results.json`.

## Store Graphics overlays are measured, not guessed

The overlay geometry in `app/store/index.html` comes from Davide's own Photoshop files, measured pixel by pixel, not from eyeballing. When he reports an overlay is off, **measure before changing a number**: serve `app/` and the reference images over a local static server, load the tool in an iframe on the same origin, call `renderTo(ctx, {..w,h}, state.layouts[id], false)` at the reference's exact pixel size, and compare orange-mask runs row by row. Deriving a value from another value is what produced the earlier wrong badges.

Two traps. The tool remembers `state.layouts` in IndexedDB (`davfx-store-graphics`), so **changed defaults do nothing until that store is wiped** - and the live page writes its old layouts back on unload, so park the frame on `about:blank` first, then wipe, then load. And a measurement from a hard colour threshold is only good to about half a pixel; read the raw channel values before trusting a 1 px difference.

As of 1.4.2 the Icon, Card, Asset page and YouTube overlays match his files exactly on badge boxes, logo frames, accent thickness and accent extent. What remains is 1 px on some 45-degree cut corners, which is where Photoshop and canvas simply round differently.

**Since 1.6.1 the reference is his Photoshop screenshots of 5 October 2026** (`Tools/_archive/overlay-references-20261005`), not the PSD of 21 September: they are newer and win where the two disagree. Master for the Asset page is the 1080p 6D Aerial one. Cover 1950, Asset 1920, Card and Icon now match them to about 1 px with the same title. Davide's standing rules: **the accent line always runs to the right edge**, the accent line is the same on Asset page and Cover (7 px at about 2K width), and consistency between packs matters more than any single file. Layouts saved before that pass are updated by `aggiornaMisure` (only values still equal to the old defaults, listed in `MISURE_PRIMA`). If a default changes again, add the old value there or saved work will keep it.

## Clip Joiner (1.5.0, export rewritten in 1.5.1)

`app/clips/index.html`, one page. Davide asked for it to join short clips of his work "super fast", with a short fade to black at each cut, text overlays per clip and a transform with zoom and crop. It was added as the **last** tab (Ctrl+9) so every existing Ctrl+N shortcut stayed where it was.

- **One renderer.** `renderAt(ctx, W, H, T)` draws the sequence at time T. The preview, the trim scrub and both export modes all call it, so the export is what the preview shows. Every size and position is a fraction of the output frame, which is what lets the preview draw at screen size and the export at full size with the same numbers.
- **Timeline.** `computeTimeline()` lays the clips end to end. A fade-through-black boundary does not overlap (plus an optional black hold); crossfade, push and wipe overlap by the overlap length, capped at 45% of either clip so three clips can never be on screen at once. Fades are a colour rectangle over the whole frame, so texts fade with their clip.
- **Export.** WebCodecs H.264 (VP9 fallback) into the bundled `lib/mp4-muxer.mjs`, a copy of the one in `app/video/lib`. There is one mode.
- **Why the export decodes instead of seeking (1.5.1).** 1.5.0 seeked a `<video>` to every output frame. That is only fast when keyframes are close together, and Davide's showcase clips (`Desktop/02-10-26 Showcase`: H.264, 60 fps, about 2000x1200, B-frames) have **one keyframe every 250 frames**, so every seek re-decoded up to 250 frames: 18.2 s to export 3 s of Javelin. My own test clips had dense keyframes and hid it. Now `readIndex()` parses the MP4 `moov` (stsd/avcC, stts, ctts, stsc, stsz, stco/co64, stss, **elst**) and `FrameReader` feeds each clip once, front to back, to a hardware `VideoDecoder`. Measured on his clips: 3 s of Javelin 18.2 s -> 0.9 s; his whole 84 s showcase at 1080p in 12.3 s. Files it cannot read (WebM, MKV, fragmented MP4, non-H.264) fall back to seeking, per clip.
  - **The edit list matters.** With B-frames the encoder starts presentation two frames in (`elst` media_time 512 at timescale 15360). Ignore it and every frame is two frames late against the preview.
  - **Never await the decoder while holding its frames.** The hardware decoder has a small pool of output frames. The first version awaited `flush()` at the end of a clip while frames kept arriving unread: the pool ran dry and the export froze at the end of Thinner Columns, with Cancel unable to reach it. `frameAt()` now fires `flush()` without waiting, keeps closing what is due, checks Cancel, and gives up with an error after 15 s without output.
  - Compared frame by frame with the seek path on moving sparks, the decoder picks the frame whose presentation time is the requested one; the seek path, landing exactly on a frame boundary, showed the one before. The preview still uses `<video>`, so it can be 1/60 s earlier than the export. Nothing to fix.
- The real-time capture modes of 1.5.0 were removed in 1.5.1: with decoding, they were slower in every case and only added a choice.
- **Sound.** Each file is decoded once with `decodeAudioData`, mixed in an `OfflineAudioContext` with gain ramps matching the fades and overlaps, and encoded AAC (Opus fallback). A clip with no sound track is simply silent.
- **Screen-recorder WebM** often has no duration. `loadVideo` seeks to 1e101 to make Chromium find the real one; without it those files were refused.
- **Persistence.** Sequence settings and the default text style in `localStorage`; per-clip settings remembered by `name|size|lastModified`, 200 most recent. Undo is a stack of JSON snapshots of `{seq, clips}`; sliders commit on release, not on every step.
- **Test.** `tests/clips-check.cjs` runs inside the real app from `toolbox-ui.cjs`: it records three clips in the page with MediaRecorder (`captureStream(0)` + `requestFrame()` — the timed version produced an empty file in the offscreen QA window), joins them, plays, exports with sound and reads the MP4 back. Those are WebM, so they take the seek path; the test then feeds the exported H.264 MP4 back in twice with a crossfade and asserts both clips went through the decoder.
- Not done, by choice: no project file that stores media paths (the sandboxed page cannot read paths back), no title cards or music track.

## Runtime state and portability

- Toolbox stores its Scene Sync settings in `<Electron userData>/scene-sync.json`. On first use, it reads the old `%LOCALAPPDATA%/DAVFX/SceneSync/settings.json`, preserving profiles and last backup paths. It then writes only its own state. The standalone app is not overwritten. A settings file written before 1.4.0 still holds a `package` section; the page drops it on load, so it disappears on the next save.
- Engine requests run in the bundled Node process, asynchronously. No shell command comes from page content. Only enumerated actions are accepted. Apply requires a plan created by this host session; backend validation also detects stale/dependent file changes.
- Toolbox warns before closing while a Scene Sync engine request is running, and offers **Wait / Close anyway**. Closing anyway leaves the worker to finish its write rather than killing it mid-apply. The escape exists because the "running" flag is cleared by the engine itself: without it, an engine that stopped responding would make the window impossible to close.
- Packaged builds copy the manifest-verified engine to `%LOCALAPPDATA%/DAVFX/Toolbox/scene-sync-engine/<hash>/` before use (a leftover from the portable days, harmless and cheap). Old cache versions are retained rather than deleted.
- `dist`, `node_modules` and build caches are disposable. `scene-sync/runtime/rg.exe` is source payload and lives in Git; `node.exe` next to it is restored by the build.

## Shell (1.6.0)

- No colour squares in the tab bar any more. The button at its right end hides the bar; touching the top edge of the window slides it back over the tool. The choice is remembered (`toolbox.barHidden`).
- The last tool used reopens at start (`toolbox.lastTab`). Tools that remember their own settings do so themselves; for the three that did not (Video Comparison beyond its collage options, Frame Strip, Annotate) the shell keeps the value of every control with an id under `toolbox.controls.<tool>` and puts it back on load, firing `input` and `change` like a hand would. Loaded media cannot come back.

## Store Graphics revision (1.6.0)

Davide's three revision documents are tracked in `REVISION-NOTES.md`. What changed in the code:
- **Panels own their transforms.** `shot.sc/px/py/rot/fh/fv` are lists with one entry per panel, panel 0 included; the old `scale/x/y` fields and `fx.rot/flipH/flipV` are migrated by `migraPannelli` on every load path. The screenshot as a canvas element is `vistaPannello()` - the selected panel - so drag, handle, wheel and arrow keys cannot touch another panel. Clicking the canvas selects the panel under the mouse (`pannelloSotto`). Root cause before: nothing ever set `shot.active`, so everything acted on panel 0.
- **Image strip** pinned on top of the right panel (`stripImmagini`), drag-and-drop reorder (`spostaImmagine`); `fissaPrincipale` turns the implicit "main image" into an explicit index before the list changes, so no panel changes image on its own.
- **Project files** carry the images (original bytes, base64) and the logo; Save writes straight to the same file through a File System Access handle remembered in IndexedDB; Save as picks a new one. Autosave writes only when something changed and says "Auto saved hh:mm" quietly next to Save.
- **Exports** go into a folder chosen once (handle remembered), short names (`{format}` by default) and the next free number from what is really in the folder.
- Removed: the multi-pack batch (pack list, batch export and preview, PageUp/PageDown, CSV), the dotted empty background. Scan Folder now takes every image in the folder and subfolders, dropping `Edit` copies when a `No Edit` folder exists.
- Colour rows show their HEX (click copies) and pairs get a swap button.
- Text-row spacing, separators and the rest of the overlays: done in the overlay pass, see "Store Graphics overlays are measured".
- **The Looks panel was removed** (1.6.1, Davide does not use it), with the automatic tidy-up passes only it used. Do not bring it back.

## User requirements / limits to preserve

- Scene sync matches hierarchy paths. Renamed/reparented objects can be additions. Shader/VFX appearance must still be validated in Unity. Dynamic Resources/Addressables strings and unsupported custom formats cannot be certified by serialized GUID checks.
- A target scene inside an `HDRP` or `URP` folder must not end up depending on the other pipeline's folder. `auditScene` refuses such a sync rather than writing it. A scene outside that folder convention is not checked, by design.
- Scene application requires closing the target Unity Editor, as enforced by the engine.
- Preview first, backups before writes, stale-preview checks, protected restore. Tooltips and native Windows file dialogs are intentional.

## Previous installation and rollback

The original Windows app remains at `C:/Users/david/Applicazioni/DAVFX Scene Sync`, including its C# UI source, executable and old tests. It is a separate earlier installation; editing it does not update Toolbox. Prefer this Toolbox project for future integrated UI/backend work.

Pre-integration Toolbox source, original 1.0.0 portable/setup and shortcut are preserved in `Tools/_archive/Toolbox-before-scene-sync-20260923-000734`. Restore those files and the saved shortcut to roll back.

See `tests/ui-results.json`, `tests/packaged-ui-results.json` and the engine test result files for the checks actually completed. Do not infer successful tests from this handoff alone.

`INTEGRATION-VALIDATION.md` (1.1.0) and `WORKFLOW-AUDIT.md` (1.1.1) are dated records of earlier versions. **They describe Package Prep, which no longer exists**; read them as history, not as a description of the current app.

Do not reintroduce suffix matching for project fields. Keep path selection transactional and invalidate previews before asynchronous discovery. Renderer path joins must preserve UNC prefixes. These regressions are covered by `tests/user-workflow.cjs` through the actual Electron interface.
