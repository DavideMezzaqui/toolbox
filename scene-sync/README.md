# DAVFX Scene Sync

Integrated Toolbox workspace for syncing saved Unity scene layouts between two projects.
Open the **Scene Sync** tab (Ctrl+8) in Toolbox.

## Quick start

**Folder selection:** Browse opens the modern Windows folder picker, with its address bar and search. Paste a path in the address bar (Ctrl+L). **Open projects** beside each project heading separately suggests currently open Unity projects, with their names and full paths. Each click refreshes detection in the background without changing project files.

1. Choose the source project and scene, then the target project and scene.
2. Set **Asset names**, for example **HDRP → URP**. Leave both fields empty when asset paths match. Save a profile to reuse these choices.
Click a scene field to search by scene name or folder. Sync options and backups are in the left sidebar.

3. Choose the categories to sync and click **Compare scenes**.
4. Review changes. **Current · target** and **Incoming · source** show the values side by side. Select the objects to update. The filter and selection buttons work on visible rows.
5. Save your work and close the target project in Unity. Click **Apply selected**. A verified backup is created before writing.
6. Reopen the target scene in Unity and check the result.

## Sync options

- **Transforms & layout:** positions, rotations, scale and RectTransform layout of existing objects.
- **Text & Canvas:** text content and matching UI component properties.
- **Missing objects:** selected new objects and their required missing parents. New objects receive source placement even when existing transform updates are disabled.
- **Active state:** object activation.
- **Hierarchy order:** source order for selected containers.
- **Camera placement:** camera transforms; target rendering components are preserved.
- **Shared prefab references:** object references in prefab instances sharing the same GUID across projects, such as the demo tester. Include referenced objects if required, or turn this option off.

To exclude a group and its descendants, enter its full hierarchy path in **Exclude hierarchy paths**. Separate multiple paths with `;`.
Rotation values may use Unity's stored quaternion X/Y/Z/W components. Fields marked **degrees** are Inspector angles.

## Matching and supported scenes

Objects match by their full hierarchy path. Renamed or reparented objects are considered new, so review the preview for unwanted duplicates.
Prefab counterparts must already exist in the target project. Matching uses the asset path name rule, then a shared GUID. Prefab placement sync applies to the instance root.

The app preserves target-only objects, scene lighting and rendering settings, existing materials and VFX properties on existing prefab instances. Lights and common HDRP lighting/volume objects are excluded.

Scenes must use Unity text YAML serialization. This tool does not convert shaders, materials, VFX Graphs or scripts. Missing dependencies, ambiguous names, prefab variants and child transform overrides may stop an operation with an error.
Comparisons use files saved on disk. Changed files require a fresh comparison before applying.

## Backups and restore

Backups are stored under `SceneSyncBackups` in the target project root, outside `Assets`. Each contains `original.unity`, scene metadata when present, and `manifest.json`.

**Open latest backup** opens the latest backup folder. **Restore backup…** lets you select a manifest. Restoring also backs up the current scene. If the scene has newer edits, automatic restore stops; the original remains available in the backup folder.

## Toolbox integration

The frontend is in `app/scene-sync` and uses a sandboxed desktop bridge. Node.js and ripgrep are bundled for offline use. Existing standalone profiles are read on first use, then preferences are saved separately in Toolbox.

The backend and its reference/backup checks are preserved. See the Toolbox root `CLAUDE.md` for developer notes and portable engine cache details.
