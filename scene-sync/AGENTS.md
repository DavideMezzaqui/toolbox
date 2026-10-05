# DAVFX Scene Sync requirements

- Pipeline isolation is a user requirement: a synced scene and its serialized dependencies must reference their own pipeline folder or Common, never the opposite pipeline. A sync that would break this is refused rather than written.
- Neutral Unity/package dependencies and Unity built-in resources are allowed; dependencies on the opposite render-pipeline package are not. Unknown/dynamic references must not be described as verified.
- Package Prep was removed in Toolbox 1.4.0 at the owner's request. Do not add package preparation, Unity Editor bridge or shader-target conversion back to this engine.
- Prefer standard Windows controls/dialogs when they reduce custom code and bug risk. UI stays English with a dark theme, simple drawn icons, and restrained semantic colors.
