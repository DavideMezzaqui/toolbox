# Toolbox

Nine DAVFX tools in one Windows window: Flipbook Previewer, Video Comparison, Texture Prep, Frame Strip, Annotate, TexGen, Store Graphics, Scene Sync and Clip Joiner.

Open `Tools/Toolbox.lnk`: it starts in about half a second and reopens the last tool used. Ctrl+1–9 switches tabs, and the button at the right of the tab bar hides it (touch the top edge to bring it back); Ctrl+plus/minus adjusts UI scale. Tabs keep their documents and in-memory state when switching tools.

## Scene Sync

The eighth tab compares two saved Unity scenes, lets you pick which layout, text and prefab changes to take, applies them with a verified backup, and restores that backup on demand. The source scene is never written to.

Browse uses native Windows dialogs. Existing standalone Scene Sync profiles are imported on first use. Unity rendering still needs a look after a sync.

Package Prep was removed in 1.4.0; that job is done by a Unity Editor script instead.

## Clip Joiner

The ninth tab joins short clips into one MP4. Drop the clips anywhere: they line up in file-name order with a short fade to black between each one (the clip closes to black, the next opens from black). Everything else is optional:

- **Transitions** — fade through black (default), crossfade, push, wipe or cut; set once for the whole sequence, or per cut from the list.
- **Per clip** — trim, speed, volume, fade lengths, and a transform: zoom, pan, rotation, flip, crop, and an animated zoom from a start framing to an end framing.
- **Text** — any number of overlays per clip, in Turret Road or a system font, with shadow, outline, background box and a fade, rise or slide in. Drag them on the preview. One click copies a text to every clip.
- **Export** — every frame is decoded on its own, so none can be dropped. MP4 clips are read front to back by the hardware decoder: your 84 s showcase exports in about 12 s at 1080p. Sound is mixed with the same fades as the picture.

Settings per clip are remembered by file: drop the same clip again and its trim, framing and texts come back. Ctrl+Z / Ctrl+Y undo and redo.

## Git

The project is versioned with Git in this folder. Claude commits after each change, once the tests pass. Nothing is published online without asking first.

## Development

Use `build.ps1 -Run` to launch from source and `build.ps1` to build and install it to `Tools/_app/Toolbox` (`-Setup` adds an installer). Dependencies and caches follow the existing Tools layout. `npm run test:scene-sync`, `npm run test:ui` and `npm run test:workflow` verify the integrated tool. See **[CLAUDE.md](CLAUDE.md)** for architecture, file ownership, tests, runtime locations and rollback notes.
