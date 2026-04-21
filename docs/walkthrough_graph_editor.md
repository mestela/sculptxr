# Walkthrough: Graph Editor Overhaul (v1.0.220)

## Objective
Upgrade the SculptXR desktop graph editor from a basic read-only preview to a fully functional animation editing tool, achieving feature parity with professional animation software for basic keyframe manipulation.

## Key Features & Implementation Details

### 1. Decoupled View Bounds & 2D Pivot Zoom
*   **Problem**: The graph editor view was locked to the loop range (`window._animLoopStart` to `window._animLoopEnd`), making it impossible to zoom in on specific segments.
*   **Solution**: Decoupled the view coordinates from the loop bounds by introducing `this._viewStart` and `this._viewDuration` in `GuiTimeline.js`.
*   **Pivot Zoom Math**: 
    *   In `onMouseDown`, if right-clicking, capture `zoomPivotTime` and `zoomPivotValue` based on click position.
    *   In `onMouseMove`, compute `factorX` and `factorY` based on drag distance.
    *   Update `_viewDuration = _zoomStartDuration / factorX`.
    *   Update `_viewStart = _zoomPivotTime - (_zoomPivotTime - _zoomStartViewStart) * (newDuration / _zoomStartDuration)`.
    *   This keeps the time at the click position locked on screen while the rest scales around it.

### 2. Marquee Selection with Live Highlight
*   **Problem**: Selecting multiple keys was only possible in Dopesheet mode.
*   **Solution**: Enabled marquee selection in Graph mode.
    *   In `handleGraphMouseDown`, if no key or handle is clicked, set `this._isDraggingMarquee = true`.
    *   In `drawGraph`, if `_isDraggingMarquee` is true, draw the turquoise marquee box on top.
    *   **Live Highlight**: In the key drawing loop in `drawGraph`, check if the key's pixel position `(x, y)` is inside the marquee rectangle. If so, draw it highlighted (Yellow) even before mouse release.
    *   In `finalizeMarquee`, filter keys by time range (`tMin` to `tMax`) and value range (`vMin` to `vMax`) computed via `yToValue` and add to `window._animSelectedKeys`.

### 3. 2D Transform Box
*   **Problem**: No batch manipulation of keys in value space.
*   **Solution**: Implemented a full 2D Transform Box around selected keys.
    *   **Bounds**: Compute `minT`, `maxT`, `minV`, `maxV` across all selected keys and channels.
    *   **Drawing**: Draw a yellow box around these bounds with handles on all 4 edges and in the center.
    *   **Interaction**:
        *   **Top/Bottom Handles**: Scale values relative to the opposite edge. Compute `factor = (targetVal - minV) / (maxV - minV)` and scale values inline.
        *   **Left/Right Handles**: Scale times relative to the opposite edge.
        *   **Center Scale Handle**: Scale times around the center.
        *   **Translate Box**: Dragging inside the box moves keys in both time and value by applying the same `dt` and `dVal` to all selected keys.

### 4. Undo Support for Selection and Transforms
*   **Selection Undo**: In `finalizeMarquee` and `handleGraphMouseDown` (when selection changes), clone the `window._animSelectedKeys` array and push a custom undo state named `"graph editor multikeys selection"`.
*   **Transform Undo**: In `handleGraphMouseDown` when starting to drag any handle, deep-clone all tracks in `AnimationRegistry.tracks` using a new helper `this.cloneTrack(track)`. In `onMouseUp`, push a custom undo state named `"graph editor transform box"`.

### 5. Polish & Fixes
*   **Colors**: Changed selected keys to Yellow (`#ffff00`) and hovered keys to Cyan (`#00ffff`) to avoid conflict with the green Y channel.
*   **Clipping**: Added `ctx.clip()` in `drawGraph` restricted to the graph area to prevent curves and handles from drawing over the header.
*   **Playhead**: Fixed playhead scrubbing in Graph mode to use view bounds instead of loop bounds for time calculation, and added calls to update meshes and render the 3D view live during scrub.

## Files Modified
*   `src/gui/GuiTimeline.js`: Core implementation of UI, interaction, and drawing.
*   `src/files/ImportSGL.js`: Removed auto-play on load.
*   `src/gui/GuiAnimation.js`: Added playback speed persistence.
