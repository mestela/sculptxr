# Implementation Plan - Unify Timeline and Graph Editor Code

## Objective
Unify the timeline and graph editor logic between Desktop (`GuiTimeline.js`) and VR (`GuiXR.js`) to reduce code replication and improve maintainability.

## 1. Analysis of Duplication
- **Coordinate Mapping**: Math for translating time/value to 2D space (`valueToY`, `yToValue`) is identical in structure.
- **Bezier Curve Evaluation**: The binary search for Bezier `t` and curve drawing loops are duplicated.
- **Interaction Orchestration**: 
    - Key dragging (`dt` and `dVal` calculations).
    - Tangent handle manipulation.
- **State Machines & Overlays**:
    - Hover highlighting for keys and tangents.
    - Marquee selection box logic.
    - Transform box (scaling/moving groups of keys).
- **Dopesheet Rendering**: Drawing track lanes, keyframes (dots/diamonds), and labels on a 2D canvas.

## 2. Proposed Architecture
Create a new utility file `src/gui/TimelineHelper.js` that exposes:
- **Pure Math Functions**: `getBezierT`, `evaluateBezier`, `valueToY`, `yToValue`.
- **Interaction State Helpers**: Methods to handle selection state, calculate drag deltas, and manage the transform box state.
- **Shared Rendering Functions**: `drawDopeSheet(ctx, tracks, options)` to draw the dopesheet view.

## 3. Step-by-Step Plan
1.  **Create `src/gui/TimelineHelper.js`**: Implement shared math, core interaction logic, and dopesheet rendering.
2.  **Refactor `GuiTimeline.js` (Desktop)**: Use the helper for rendering and interaction.
3.  **Refactor `GuiXR.js` (VR)**: Use the helper in `_drawGraphTimeline` and dopesheet branch.
4.  **Verification**: Test both modes for visual and functional regressions.

## 4. Constraints
- **PLANNING MODE**: This plan must be approved before implementation.
- **No Emojis**: Commit messages and docs must not contain emojis.
- **Step Id**: Responses must start with `Step Id: {id}`.
