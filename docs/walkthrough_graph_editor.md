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

## VR Parity & Polish (v1.0.221)

### Objective
Port the graph editor features from desktop to VR, achieving parity and polishing the VR UI for better usability.

### Key Fixes & Implementation Details

#### 1. Key Dragging Math Fix
*   **Problem**: Dragging keys in VR graph mode was scale-dependent (faster when zoomed in, slower when zoomed out).
*   **Solution**: Removed the incorrect scaling factor `* (tlW / 1000.0)` in `GuiXR.js`. Now it uses raw canvas delta mapped to time via `visibleDuration / tlW`.
*   **Event Stealing**: Prevented dopesheet interaction code from stealing drag events in graph mode by adding an early check for graph mode in `onInteract`.

#### 2. Tangent Handles in VR
*   **Feature**: Added support for drawing and manipulating tangent handles in VR graph mode.
*   **Display**: Broken tangents are drawn as squares, tied tangents as circles.
*   **Interaction**: Added "Tie/Break Tangent" button in VR UI.

#### 3. Tangent Scrambling on Key Deletion/Insertion
*   **Problem**: Deleting or inserting keys scrambled tangents because they were stored by index (e.g., `trans_3_right_dt`).
*   **Solution**: Added index-shifting logic in `AnimationRegistry.js` (`deleteSelectedKeys`, `addTransformKey`, etc.) to update tangent keys when indices change.

#### 4. Transform Box Fixes in VR
*   **Undo**: Added missing state capturing for undo when clicking transform handles.
*   **NaN Fix**: Set `_keyDragStartVal` when clicking the center handle to prevent `NaN` results during translation.
*   **Scale Limit**: Added `Math.max(0.05, ...)` to `scaleCenter` to prevent keys from collapsing to 0 or flipping order.

#### 5. UI Polish & Layout
*   **Width Expansion**: Expanded widgets to fill panel width (compensated for scrollbar by using `944` max width).
*   **Unification**: Unified text color to `#ccc` for all VR UI elements. Made stop button a flat square instead of a small font character. Drawn transport icons with paths instead of font characters to ensure consistency between desktop and headset.
*   **Layout**: Reorganized layout to put "Timeline Mode", "Op: Select", "Show Tangents", and "Tie/Break" on a single row at the bottom. Made tangent buttons conditional on graph mode.

### Files Modified
*   `src/gui/GuiXR.js`: Core VR UI and interaction implementation.
*   `src/gui/vr/GuiVRAnimation.js`: VR Animation panel layout and widgets.
*   `src/editing/AnimationRegistry.js`: Key deletion and insertion logic.
