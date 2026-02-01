# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.136 (BETA) - FEELING GOOD
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.136` deployed to `sculptxrbeta`.
**Last Successful Version**: `v0.6.136` (Responsive menu, no input lag).

## MANDATORY: Project Rules & Guidelines
**CRITICAL**: You MUST read and follow `project_rules.md` at the start of your session. It contains codebase-specific patterns, style guides, and forbidden actions (e.g., no emoji, specific git workflows).
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Issue: RESOLVED (Ready for Next Challenge)
**User Report**: "starting to feel really good!"
**Status**:
*   **Fixed**: Flashing (v0.6.131).
*   **Fixed**: Pipeline Stalls (v0.6.131).
*   **Fixed**: Menu Lag (v0.6.133 - 30fps throttle).
*   **Fixed**: Combobox Interaction (v0.6.134 - Hover vs Press).
*   **Fixed**: Stale Widgets (v0.6.135 - Refresh loop).
*   **Fixed**: Input Lag (v0.6.136 - Debounce fix).

## Recent Changes (v0.6.136)
1.  **Input Latency Fix**:
    *   **Root Cause**: Hover events were resetting the `_inputDebounce` timer, causing race conditions where Clicks were ignored if the user's hand was moving (which is always).
    *   **Fix**: `onInteract` now strictly ignores Hover events for debounce purposes. Only `isPressed` events reset the timer.
2.  **Stale Widgets Fix**:
    *   **Root Cause**: Widgets were cached once at startup.
    *   **Fix**: `_getWidgets` now regenerates widgets on every redraw using `_widgetGenerators`.
3.  **Combobox Fix**:
    *   **Root Cause**: Hover events triggered selection.
    *   **Fix**: Added `if (!isPressed) return;` guard to Dropdown/Overlay handlers.
4.  **Throttle Relaxed**:
    *   Texture upload increased from 15fps to 30fps (33ms).
## Debugging Leads for Next Agent
1.  **Canvas Performance**:
    *   Check `GuiXR.js` `draw()` time.
    *   *Note*: 30fps throttle seems stable, but future high-res UI might need WebGL-based UI rendering instead of 2D Canvas.
2.  **Draw Count**:
    *   Ensure we aren't redrawing the canvas *every* frame unnecessarily.

## Deployment
See [Deployment Protocol](#deployment-protocol) in `project_rules.md`.
*   **BETA**: `./deploy_beta.sh` (Current focus)
*   **PROD**: `./deploy.sh` (LOCKED until fix)

## Interactive Debugging Protocol
-   **Preference**: Use the browser console for immediate state inspection and manipulation whenever possible.
-   **Workflow**:
    1.  Provide copy-pasteable JavaScript snippets for the user to run in the console.
    2.  Use `app`, `app.getMesh()`, `app.getPicking()`, `app.getSculptManager()` entry points.
    3.  Analyze the return values to decide the next code fix.

## Communication Style
1.  **NO EMOJIS**: Do not use emojis in ANY response, title, task name, or commit message. Zero tolerance.
2.  **Professional Tone**: Keep all communication professional, concise, and sober.
3.  **No False Confidence**: Do not use words like "final", "real", "definitive", "corrected" to describe a solution. Use "updated", "new iteration", "attempt".