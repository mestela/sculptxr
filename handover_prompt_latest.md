# Handover Prompt (Protocol Enforced)

**Current Status**: **v0.6.55** deployed to Beta.
**Current Working Directory**: `/usr/local/google/home/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Handover after robust VR Controller integration.
**Accomplishments**: 
- **Fixed Critical Crash**: Resolved "Cannot read properties of null (reading 'length')" by reordering mesh initialization (`init` before `setShaderType`).
- **Robust Loading**: Implemented ASCII PLY support with fallback handlers in `ImportPLY.js`.
- **Cache Busting**: Enforced cache busting (`?v=0.6.55`) on all modules to prevent version skews.
- **Pipeline**: Added `scripts/convert_controllers.py` and `scripts/fetch_controllers.sh`.

## Critical Instructions for Next Agent
1.  **Step ID Fatigue**: The previous session ran long (~330 steps), leading to "emoji creep" and overzealous auto-deployment. **STRICTLY FOLLOW `project_rules.md`**.
    *   **NO EMOJIS**.
    *   **NO AUTO-COMMIT**.
    *   **NO AUTO-DEPLOY TO PROD**.
- **v0.6.55** (Beta)
    - Robust, instrumented ASCII PLY loading.
    - `ImportPLY.js` now accepts strings directly.
    - `Scene.js` logs first 50 chars of PLY header to debug 404/Empty/Corrupt issues.
- **v0.6.54** (Beta)
    - Switched to **ASCII PLY** for controller models.
    - Reason: Binary PLY parsing in `ImportPLY.js` was crashing (`null` array access). ASCII PLY bypasses `ab2str` and binary offsets.
- **v0.6.53** (Beta)
    - Attempted Binary PLY (failed).
- **v0.6.52** (Beta)
    - Debug release (Import try/catch).
## Current State
Code is committed and pushed (`desktop_ui` branch).
-   **Production**: v0.6.50 (Stable).
-   **Beta**: v0.6.55 (Controllers + Fixes).
-   **Environment**: `project_rules.md` is active.

## Next High-Priority Tasks
1.  **Refine VR Controllers**: User validation indicates "things that need correcting" (likely pivot, scale, or material).
2.  **Voxel Grid Visualization**: Draw wireframe bounds for Voxel mode.
3.  **Matcap UI**: Add UI to swap matcaps/environments.

## Deployment
See `project_rules.md` for strict protocol.
-   **Beta**: `./deploy_beta.sh` (Auto-allowed for testing).
-   **Prod**: `./deploy.sh` (**FORBIDDEN** without explicit user request).

## Interactive Debugging Protocol
- **Preference**: Use the browser console for immediate state inspection and manipulation whenever possible.
- **Workflow**:
    1.  Provide copy-pasteable JavaScript snippets for the user to run in the console.
    2.  Use `app`, `app.getMesh()`, `app.getPicking()`, `app.getSculptManager()` entry points.
    3.  Analyze the return values to decide the next code fix.

## Communication Style
1.  **NO EMOJIS**: Do not use emojis in ANY response, title, task name, or commit message. Zero tolerance.
2.  **Professional Tone**: Keep all communication professional, concise, and sober.
3.  **No False Confidence**: Do not use words like "final", "real", "definitive", "corrected" to describe a solution. Use "updated", "new iteration", "attempt".