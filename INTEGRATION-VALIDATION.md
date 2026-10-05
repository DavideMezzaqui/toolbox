# Integration validation — 2026-09-23

Final artifacts: `dist/Toolbox-1.1.0-portable.exe` and `dist/Toolbox-1.1.0-setup.exe`. The existing `Tools/Toolbox.lnk` now points to the 1.1.0 portable artifact. The installer was built but not installed over the user's setup.

## Completed checks

- `npm run test:scene-sync`: all passed. Scene engine 14, audit 13, CLI 4, package preparation 47, Unity helper 7, open-project detection 10, Toolbox adapter 5 checks.
- `node scene-sync/tests/shader-target-tests.cjs`: 10 passed, including HDRP / Universal Lit and Unlit target settings in both directions. Real source shader files remained unchanged.
- Source Electron interface: 10 integration checks passed before packaging.
- **Final portable executable**: 11 integration checks passed. See `tests/packaged-ui-results.json`.
- Portable UI checks include actual Compare / Apply and Analyze / Prepare button clicks, backup creation, exact scene restore, Common resource movement, VFX-to-shader remapping and package restore, all on disposable fixture copies.
- Open Unity project selection was clicked through the embedded UI and loaded the detected project's scene list without an exception. This step was read-only.
- UI rendered at 1700×1000 and 1000×760, with no document-level horizontal overflow. Row selection, issue search, blocked preparation and retained iframe state were exercised. Screenshots are in `tests/screenshots/`.
- All seven pre-existing tool pages loaded. Their individual image/video export workflows were not retested; their page files were not changed.
- Backend, bundled runtime and Unity helper payload hashes exactly match the original standalone installation.
- Manifest-verified engine cache remained present after the actual portable executable exited, so Editor bridge job paths do not rely on portable extraction lifetime.

## Scope of the evidence

No preparation or scene synchronization was applied to Davide's real projects during integration QA. Live Unity rendering, compilation of converted shaders and acceptance of a preparation job by an open Editor were not repeated for this UI port. Existing engine safeguards and helper code are unchanged. The tests demonstrate reference transfer on fixtures, not universal rendering equivalence across pipelines.

The package issue screenshot displays a saved isolation report; the scene screenshot uses a disposable fixture. They are screenshots of the actual packaged interface, not design mockups.

## Handoff

Continue in this Toolbox project using `CLAUDE.md`. Original standalone app and pre-integration Toolbox backup remain available. The old standalone UI is not the source for the embedded page.
