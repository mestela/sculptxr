# Handover Prompt (Protocol Enforced)

**Project Status**: Active Development - Timeline Unification
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Timeline and Graph Editor Unification Completed (Desktop Verified)

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

## Outstanding Issues / Next Steps
- **VR Verification**: The refactored Dopesheet rendering and interaction logic in `GuiXR.js` needs to be verified in VR on device!
- **Further Unification**: Consider extracting more interaction state machines if needed.
