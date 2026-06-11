# Handover Prompt (Protocol Enforced)

**Project Status**: Low-poly tool bug-fix session complete. v2.0.5 deployed to beta.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Branch**: `feature/html-in-vr`
**Checkpoint**: v2.0.4 committed to git (3dc052cd), deployed as v2.0.5 by deploy script.

## MANDATORY reading
You MUST read `overview.md` and `docs/releases.md` for context before responding. NO EXCEPTIONS.

## Deployed Version
- **Beta**: v2.0.5
- **Prod**: v2.0.2 (not updated this session)

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.
- **iPad**: Use Safari remote debug or `window.screenLog()` for on-device logging.

## What was fixed this session (shipped as v2.0.4/v2.0.5)
See `docs/releases.md` # v2.0.4 for full detail. Summary:

### SpinEdge lock-up fix (`src/editing/tools/SpinEdge.js`)
SpinEdge locked after 2–3 spins because the winding of the produced triangles
alternated each spin, making them back-facing and invisible to the face picker.
Fixed by a cross-product winding consistency check before writing the new face
data — if the proposed triangle faces away from the original, `vC`/`vD` are
swapped. `vC`/`vD` changed from `const` to `let` to allow the swap.
Spinning now works indefinitely.

### Extrude double-fire on iPad (`src/SculptGL.js`)
iPad fires events in order `pointerdown` → `touchstart` → `touchmove`.
`touchstart` was unconditionally resetting `_ptrDownHandledThisTouch = false`
*after* `pointerdown` had already set it to `true`, causing the `touchmove`
fallback to fire a second `onMouseDown`. Fixed: `touchstart` only resets the
flag when `_action !== SCULPT_EDIT`.

### Extrude normals — hard-edge correction (`src/editing/tools/Extrude.js`)
After extrude, `updateVerticesNormal()` blended side-wall face normals into the
cap vertices and original base vertices, making the extrusion look soft/rounded
in smooth shaded mode. Added `_applyHardEdgeNormals(activeMesh)`:
- Runs after every `updateGeometry()` in `sculptStroke`, `sculptStrokeXR`, and `end()`
- Re-computes vertex normals for cap verts and base verts using **only face
  indices < `originalNbFaces`** (pre-extrude face count). Side walls are always
  appended at index >= originalNbFaces, so they're cleanly excluded.
- Calls `updateDrawArrays()` after to propagate corrected normals into the DA buffer
- Result: hard edges at cap boundary and base junction in smooth mode, matching
  expected low-poly hard-surface look.
- Also clears `_newToOldMap` in `end()` (was a memory leak).

## Key files touched this session
- `src/editing/tools/SpinEdge.js` — winding-flip detection, vC/vD swap
- `src/editing/tools/Extrude.js` — `_applyHardEdgeNormals()`, double-fire guard, `_allAffectedVerts`
- `src/SculptGL.js` — `touchstart` conditional reset, pen debounce tuning, `[dbl]` screenLog
- `src/editing/SculptManager.js` — supporting changes
- `src/editing/tools/CutTool.js` — supporting changes
- `src/gui/htmlvr/MainMenuPanel.js` — supporting changes
- `docs/releases.md` — v2.0.4 entry added

## Next session priorities

### Timeline polish (only remaining item)
- Timeline canvas scroll gesture (2-finger scroll within panel)
- Graph editor: follow selected keying mode (blendshape vs transform)
- Autokey toggle not working — check `window._animAutoKey` binding
- Timeline icons and grid polish

## Workflow rules (non-negotiable)
- NO auto-commit — always ask before committing
- VR-first design: all features must work in WebXR before desktop polish
- Step Id prefix on all code changes (e.g. `// [Step 3]`)
- Use `window.screenLog(msg, color)` for on-device debug logging
- Low-poly tools follow `docs/low_poly_tools_standards.md` undo/snapshot pattern
