# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.132 (BETA) - STABLE BUT SLOW
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.132` deployed to `sculptxrbeta`.
**Last Successful Version**: `v0.6.132` (Flashing fixed, logic correct).

## Current Issue: SLOW MENU
**User Report**: "Flashing is fixed, but the menu feels slow."
**Status**:
*   **Fixed**: Flashing (caused by `ReferenceError: t0` in v0.6.131).
*   **Fixed**: Pipeline Stalls (caused by `gl.getError` in `Buffer.js` and `gl.getParameter` in `VRMenu.js`).
*   **Remaining**: Perceived slowness/lag in GUI interactions.

## Recent Changes (v0.6.132)
1.  **GuiXR.js Refactor**:
    *   Separated `_needsRedraw` (Canvas) from `_needsUpload` (Texture).
    *   **Throttling**: Texture upload is throttled to 15fps (`GuiXR.js:2174`). This might be the source of "slowness" if the user expects 90fps smoothness for UI updates.
    *   **Fix**: Restored `t0` variable which fixed the `ReferenceError`.
2.  **Buffer.js Optimization**: `gl.getError` loop removed.

## Debugging Leads for Next Agent
1.  **Investigate 15fps Throttle**:
    *   The `updateTexture()` method enforces a 66ms delay (15fps).
    *   *Hypothesis*: This is too slow for scroll/hover feedback, making it feel "laggy".
    *   *Experiment*: Try increasing throttle to 30fps (33ms) or 45fps (22ms) to see if responsiveness improves without tanking VR performance.
2.  **Canvas Performance**:
    *   Check `GuiXR.js` `draw()` time. If `ctx.fill()`/`ctx.stroke()` are slow, the 15fps throttle might mask it, or the main thread might be blocked.
3.  **Draw Count**:
    *   Ensure we aren't redrawing the canvas *every* frame unnecessarily. The `_needsRedraw` flag *should* prevent this, but verify it works as intended.

## Deployment
See [Deployment Protocol](#deployment-protocol) in `project_rules.md`.
*   **BETA**: `./deploy_beta.sh` (Current focus)
*   **PROD**: `./deploy.sh` (LOCKED until fix)

## Interactive Debugging Protocol
-   **Preference**: Use the browser console for immediate state inspection and manipulation whenever possible.
-   **Why**: It is faster, fun, and confirms "ground truth" state (CPU/GPU sync, variable values) without code-compile-reload cycles.
-   **Workflow**:
    1.  Provide copy-pasteable JavaScript snippets for the user to run in the console.
    2.  Use `app`, `app.getMesh()`, `app.getPicking()`, `app.getSculptManager()` entry points.
    3.  Analyze the return values to decide the next code fix.

## Communication Style
1.  **NO EMOJIS**: Do not use emojis in ANY response, title, task name, or commit message. Zero tolerance.
2.  **Professional Tone**: Keep all communication professional, concise, and sober.
3.  **No False Confidence**: Do not use words like "final", "real", "definitive", "corrected" to describe a solution. Use "updated", "new iteration", "attempt".