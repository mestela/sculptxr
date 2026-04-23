# Handover Prompt (Protocol Enforced)

**Project Status**: Active Development - Timeline Unification
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Timeline and Graph Editor Unification - VR Dopesheet Multi-Move Issue

## MANDATORY reading
You MUST read `docs/overview.md` and `docs/code_summaries.md` for context on the overall project before responding. NO EXCEPTIONS.

## Deployed Version
- **Local**: v1.0.223
- **Beta**: v1.0.221
- **Prod**: v1.0.220

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.

## Accomplishments
- **Timeline Unification**: Created `src/gui/TimelineHelper.js` and extracted shared math, dopesheet rendering, key moving, tangent manipulation, and overlay drawing (Marquee, Transform Box).
- **Desktop Polish**: Fixed many issues in Desktop timeline (handles missing, wrong colors, live highlight failing, key popping).
- **Undo Support**: Added state-based Undo/Redo support to `addKeyframe` and `deleteKey` in `GuiAnimation.js`.
- **Interaction Refinement**: Added directional lock and vertical scaling to center handle of Transform Box in Graph Editor!
- **VR Fixes**:
  - Fixed VR Marquee live update by adding `w.x` offset.
  - Fixed Top/Bottom handles not scaling the box in VR (and Desktop) by extracting `scaleKeysVertical`.
  - Removed horizontal scale clamping in VR `scale_center`.
  - Added Dopesheet interaction branch to `_handleGraphTimelineInteraction` in `GuiXR.js` to support clicking keys in Dopesheet mode in VR.
  - Moved drag handling in `_handleGraphTimelineInteraction` outside `if (isRisingEdge)` to allow continuous dragging in VR.

## Outstanding Issues / Next Steps
- **VR Dopesheet Multi-Move**: The user reported that after marquee selecting multiple keys in Dopesheet mode in VR, going to drag them by clicking on one key only moves that specific key, even though they stay selected.
  - **Status**: The click is recognized (`inSel: true`), but it seems to fall back to moving only the active key on subsequent frames, or `keysToMove` is not populated correctly for all selected keys.
  - **Next Step**: Investigate why `this._animSelectedKeysInitialTimes` is not being used or is reset during the drag in Dopesheet mode in VR. Check if `onMouseMove` equivalent is overriding it or if scope issues still exist.
