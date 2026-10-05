# Revision in progress (started 2026-10-04)

Three documents from Davide, all approved ("Applica tutto"): Store Graphics revision (13 points), Store Graphics images panel (second prompt), Toolbox changes (tab bar, startup, last tool, Git). Status 2026-10-05: Store Graphics points 2-11 and the second prompt are done (see CLAUDE.md, "Store Graphics revision"); the Toolbox shell, start-up and Git points are done. Still open: the text-row spacing from point 1 and the overlay pass below, both waiting for Davide, and putting the repository online (needs his OK).

## Findings so far (Store Graphics, `app/store/index.html`)

**PSD check (point 1).** Reference: `Desktop/Store Screenshots PSD.psd`. Its saved composite only covers the YouTube artboard (other artboards sit at negative coordinates); layer pixel bounds exist for all five. A PSD reader is in the session scratchpad (`psd-read.mjs`), not in the repo.
- YouTube at 3840x2160 against the composite: accent line identical (rows 1852-1871), logo frame and badges within 1 px.
- Accent lines, logo frames, title and version match within 1 px on Cover and YouTube.
- **Real difference: spacing in the text row after the title.** The app's gaps around the separators are too narrow:
  - YouTube 3840: PSD gaps 96/87/91/81 px (title|sep1|VFX Graph|sep2|DAVFX), app 64/62/63/62. DAVFX lands 101 px left of the PSD.
  - Cover 1950: PSD gaps 29/31/28/32 px, app 25/24/25/24. DAVFX 21 px left.
  - Asset page (PSD layer bounds, 3840): title ends 1197, sep1 1254, VFX 1310-1559, sep2 1605, DAVFX 1661. Not yet measured in the app.
  - Spacing comes from `row.gap` (line ~2320: `gap = r.gap*iPx`) and `row.sepSpace` (~2196). Fit per profile.

**Independent image transforms (point 2) - root cause found.** Panel 0 keeps its transform in `shot.scale/x/y`, panels 1+ in `shot.sc/px/py[i]`. Generic code only knows the panel-0 fields, so with several panels:
- the resize handle and Alt+wheel (`el[sizeKeyOf('shot')]` = `shot.scale`) always scale panel 0;
- arrow keys (`el[pk.x]`) always move panel 0;
- toolbar "Recentre" resets panel 0 only;
- rotation/flip live in `fx`, shared by every panel.
Fix planned: one per-panel transform list for all panels (migrate old saves), every move/scale path going through panel-aware accessors; rotation/flip per panel.

**Scan Folder (point 3).** `scanPackFolder` only accepts images under a folder named `Screenshots`/`Screenshot` with a pack folder above it, so a plain folder of PNGs yields nothing. It also fills the multi-pack batch list. Planned: take every image in the folder and subfolders (natural sort, all supported extensions, any case), and if a `No Edit` folder exists, drop the duplicates in its sibling `Edit` folder.

**Batch (point 8).** It is multi-pack export: CSV pack list, `batchExport`, batch preview (key B), PageUp/PageDown pack switching, `packLoad/packStore`, `pickShot`, `batchShots`, `fBatch`/`fShots` inputs, CSV paste/drop, the `Batch` section in Output, the `packpick` row in Pack data, and preflight checks on the list. Remove all of it.

**Other points, plan.** JSON (4): embed images in the project file (portable anywhere). Quick Save (5): File System Access handle (`fileSystem` is already allowed in `main.js`); Save writes to the same file, Save As picks a new one. Autosave notice (6): small fading label, not the toast. Dotted background (7): delete `sfondoAPuntini`. Export numbering (9): pick an export folder once (directory handle), write short names with the next free number. Colours (10): copy HEX and swap Colour 1/Colour 2 next to every colour pair.

**Second prompt.** Image list pinned at the top of the right panel, drag-and-drop reorder (replaces the arrow buttons in `.lib`, `shotMove`), clear selected/used states.

**Toolbox document.** Remove tab colour dots, collapsible tab bar, faster startup, reopen last tool with its state, local Git repository. Creating an online repository or pushing needs Davide's explicit OK first.

## Overlay references sent 2026-10-05 (do this LAST, ask before changing anything)

Copied to `Tools/_archive/overlay-references-20261005/`: bottom bars at 1920 and 2000 wide, the 1950 Cover, the 160 Icon, the 420 Card, from several packs (6D Aerial Explosions, Muzzle Flashes).
- The 4K overlay's accent line is slightly crooked (his mistake); the 1080p one should be right. Everything else should be right.
- He wants the accent line the **same size on the Asset page screenshots and the Cover** (his PSDs differed slightly).
- Goal: identical to his Photoshop overlays, plus fixing his small mistakes and missing finesse. Consistency across assets and packs is essential.
- **Ask him before making these changes**, and ask for the PSD again if needed.
