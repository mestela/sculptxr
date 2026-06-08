# Handover Prompt (Protocol Enforced)

**Project Status**: iPad input overhaul complete. v2.0.3 deployed to beta. Several timeline/blendshape/iPad issues queued for next session.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: v2.0.3 released and pushed to GitHub branch `feature/html-in-vr`.

## MANDATORY reading
You MUST read `overview.md` and `docs/releases.md` for context before responding. NO EXCEPTIONS.

## Deployed Version
- **Beta**: v2.0.3
- **Prod**: v2.0.2 (not updated this session)

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.
- **iPad**: Use Safari remote debug or `window.screenLog()` for on-device logging.

## What was fixed in v2.0.3 (this session)
See `docs/releases.md` # v2.0.3 for full detail. Summary:
- Apple Pencil / finger pointer conflict resolved
- 2-finger pan speed corrected (DPR double-scaling bug in `getSpeedFactor`)
- 2-finger zoom oscillation fixed (EMA smoothing on pinch distance)
- Back-face brush stamping fixed (front-face-only Möller-Trumbore, `Geometry.js`)
- Pen duplicate strokes fixed (50ms debounce + Map dedup, `SculptGL.js`)
- 2-finger tap = undo, 3-finger tap = redo (peak finger count, `SculptGL.js`)
- Gesture engine stuck-state recovery on pen `pointerdown`
- Timeline querySelector selector bug fixed (`.gui-sidebar` -> `#gui-sidebar`)
- Timeline touch/pen support (Pointer Events replacing mouse listeners, `GuiTimeline.js`)
- Blendshape input Scribble prevention (hidden-until-tap, `GuiBlendshapes.js`)

## Key files touched this session
- `src/SculptGL.js` — pen debounce, gesture engine, multi-finger tap undo/redo
- `src/math3d/Geometry.js` — front-face-only Möller-Trumbore
- `src/gui/htmlvr/HTMLVRPanel.js` — pen event isolation
- `src/gui/GuiTimeline.js` — Pointer Events, touch-action, selector fix
- `src/gui/GuiBlendshapes.js` — Scribble prevention, hidden input pattern

## Next session priorities
1. **iPad still sticky** — pen/gesture still gets stuck in camera mode, tools skip for 2-3 strokes.
   Likely `_action` or `_gestureActive` not clearing on rapid pen↔gesture alternation.
   Add `screenLog` tracing of `_action` transitions to find the stuck path.

2. **Timeline scrolling** — no scroll gesture inside the timeline canvas on iPad.

3. **Graph editor follows keying mode** — filter displayed tracks by `window._animKeyMode`
   (blendshape vs transform).

4. **Autokey toggle broken** — appears always-on; check `window._animAutoKey` binding in
   `GuiAnimation.js` and `AnimationControlPanel.js`.

5. **Blendshape workflow polish** — end-to-end UX for create → weight → keyframe → playback.

6. **SXR save/restore anim range** — serialise `window._animLoopStart`, `_animLoopEnd`,
   `_animMasterDuration` into .sxr files.

7. **Safari fullscreen on iPad** — Safari 16.4+ supports `document.documentElement.requestFullscreen()`.
   Add a button (topbar or xr-ui row). Also add `apple-mobile-web-app-capable` meta so
   "Add to Home Screen" gives chrome-free mode. Check `navigator.standalone` to hide button
   when already in standalone/fullscreen.
