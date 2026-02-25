# SculptXR Handover Prompt

## Objective: Revert v0.8.46 Regressions

The project has entered the **v0.8.0** release cycle. We are officially in a **Feature Freeze**, but a major series of regressions were introduced between `v0.8.40` (Desktop Spectator Basics) and `v0.8.46`. The absolute priority is to revert these regressions and restore desktop and VR stability.

### Current Status
- **Baseline**: `v0.8.46` is on Beta, but it is deeply broken.
- **Goal**: Read this document, apply the specific surgical fixes outlined, and bump to `v0.8.47`.

### Core Rules for this Phase
1. **NO NEW FEATURES**: Do not implement new tools or experimental features. 
2. **STABILITY FIRST**: Fix the syntax errors, desktop lockouts, and VR brush starvation immediately.
3. **VERSIONING**: 
    - The **Source of Truth** for the version is the `<title>` tag in `index.html`.
    - Every new deployment (Beta or Production) REQUIRES a version bump in `index.html`. 

### The Regressions & Fix Clues

**1. `quat is not defined` Error**
- **Symptom**: Console throws a ReferenceError during double-click in spectator mode.
- **Root Cause**: In `SculptGL.js`, `onDoubleTap()` uses `quat.identity()`, but `quat` is never imported at the top of the file.
- **Fix Clue**: Update the gl-matrix import at the top of `SculptGL.js`: `import { vec3, mat4, quat } from 'gl-matrix';`

**2. Desktop Interaction Broken (Post-VR)**
- **Symptom**: After taking the headset off and exiting VR, the desktop mouse cannot sculpt, pan, or zoom (UI is frozen).
- **Root Cause**: `SculptGL.js` mouse events have a guard: `if (this._vrSculpting && !this._desktopOffsetMode) return;`. When VR ends, `onXREnd()` in `Scene.js` fails to reset `_vrSculpting` to false, permanently locking out the mouse.
- **Fix Clue**: Add `this._vrSculpting = false;` to the `onXREnd()` cleanup block in `Scene.js`.

**3. VR Brushes Drawing Dots Instead of Strokes**
- **Symptom**: VR brushes no longer draw continuous lines; they stamp discrete dots because stroke interpolation is starving.
- **Root Cause**: In `Scene.js` `applyRender()`, a new fallback to prevent freezing during headset sleep is too aggressive:
  ```javascript
  if (this._xrSession && (performance.now() - (this._lastXRFrameTime || 0) < 200)) {
      if (this._sculptManager) this._sculptManager.postRender();
      return; // <-- DANGER! Starves the application layer!
  }
  ```
  By returning early, `applyRender` (driven by `requestAnimationFrame`) never finishes executing, depriving `SculptManager` of its background update pulse needed for continuous stroke math.
- **Fix Clue**: Remove the early `return;`. Instead, just skip the WebGL drawing phase `this._drawFullScene = false;` so the rest of the engine state can pump normally.

## Next Mission
Please systematically apply these three fixes, test standard desktop sculpting, enter and exit VR to test the "Swap Workflow", and ensure VR brushes draw continuous strokes. Once verified, deploy `v0.8.47`.