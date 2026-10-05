# End-to-end workflow audit — Toolbox 1.1.1

Davide requested a realistic start-to-finish usage simulation. The scenario runs through the embedded Electron interface on disposable serialized Unity projects, with real engine operations and filesystem verification.

## Scenario

1. Paste `Assets/DAVFX/Workflow Pack/HDRP`, select a second project, then switch between same-project and two-project destinations. Verify all derived pipeline/Common paths.
2. Analyze, try an invalid project path, and verify the validated configuration stays visible while the previous preview is invalidated.
3. Analyze again, modify a source shader before Prepare, and verify the stale plan cannot create destination assets.
4. Prepare the URP edition. Check the demo's prefab GUID changes, scripts in Common, Universal Unlit Active Target, alpha clipping and additive blend settings. Original source scene stays unchanged.
5. Repeat analysis: zero changes, Prepare disabled.
6. Introduce a known reference to a different HDRP package in the target material. It blocks preparation even with Keep missing references enabled. Restore the fixture bytes.
7. Install Unity tools from the UI and request a report before Unity has generated one. Installation succeeds; missing report gives the next step.
8. Change source demo text and an existing object's position. Compare and apply to URP, retaining the prepared prefab references. Compare again: no differences.
9. Try restoring over a newer target edit: it refuses and preserves the edit. Restore after recovering the recorded bytes: exact original scene bytes return.
10. Change the source after Compare: Apply refuses without modifying the target. Invalid scene-project selection preserves working paths and shows its error.
11. Reverse direction and prepare a new HDRP project from the URP edition. Verify HDRP Unlit Active Target, alpha clipping and additive settings. Restore it.
12. Restore the first package operation. The URP demo is removed and newer edits in the source HDRP project remain intact.

## Bugs reproduced and fixed

- **Same-project checkbox dispatched as a project path.** The generic `endsWith('Project')` condition also matched `sameProject`. It could send a boolean to the project resolver and leave roots inconsistent. Project path handling now explicitly matches only `sourceProject` and `targetProject`.
- **Partial configuration after failed project discovery.** Typed paths were assigned before validation; native Browse could retain a previous preview if loading the new scene list failed. Related paths are now committed together only after discovery succeeds. A selected replacement invalidates the old preview before asynchronous discovery, and controls resync to the validated state on completion/error.
- **UNC prefix collapsed.** The renderer's path join removed one leading backslash in network paths. Suggestions now retain the UNC prefix. Tested as path manipulation, without connecting to a network share.
- Also kept the actual scene-list loading error visible instead of replacing it with an empty chooser.

## Repeat

```powershell
npm run test:workflow
$env:DAVFX_QA_PACKAGED = Join-Path (Get-Location) 'dist/Toolbox-1.1.1-portable.exe'
npm run test:workflow
Remove-Item Env:DAVFX_QA_PACKAGED
```

Evidence: `tests/workflow-ui-results.json` and `tests/workflow-packaged-ui-results.json`. This suite extends the existing interface checks with the workflow above. The older engine test fixtures must exist; `npm run test:scene-sync` generates them if needed.

**Completed:** all 25 checks passed both from source and against the final `Toolbox-1.1.1-portable.exe`. Portable and setup artifacts were built. `Tools/Toolbox.lnk` now targets 1.1.1; reopen Toolbox to use it. Test project writes stayed in temporary fixture directories. The real open-project selection check only read the scene list.

## Limits

Fixtures test serialized references, state transitions, file operations and supported Shader Graph settings. They are not a rendering/compilation test in a live Unity Editor. Native picker presentation, real network access, Play-mode interaction and shader appearance were not newly certified. The engine and Unity helper were not changed by this audit.

The original portable 1.1.0 remains in `dist`, and previous UI source/configuration/shortcut are backed up under `Tools/_archive/Toolbox-before-workflow-audit-20260923`.
