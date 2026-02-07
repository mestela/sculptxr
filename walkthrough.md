# Walkthrough: VR Brush Performance Optimization (v0.6.4)

## Goal
Fix the significant slowdown (lag) experienced when using large brushes in VR, with robust "snapping" behavior.

## Problem Analysis
*   **Symptom**: Large brushes caused frame drops.
*   **Cause**: The picking logic used a search radius of `4.0 x Brush Radius`. For a large brush (e.g., 25cm), this triggered a search volume of 1 meter radius, checking thousands of triangles every frame.
*   **Complexity**: `O(R^3)` relative to brush size.

## Solution Iteration

### Attempt 1: 15cm Cap (v0.6.2)
*   **Change**: Capped search radius to `0.15` Units.
*   **Result**: Fast performance, but **Broken Usability**.
*   **Root Cause**: User reported "no stroke" unless extremely precise. `0.15` Engine Units != `0.15` Meters.
*   **Discovery**: `vrScale` is `0.008`. `0.15` units = **1.2mm**. The brush had to be within 1.2mm of the surface!

### Attempt 2: Unit Correction (v0.6.4)
*   **Change**: Defined cap in **Meters** (5cm) and scaled by `invScale` (~125).
*   **Math**: `0.05m * 125 = 6.25 Units`.
*   **Result**:
    *   **Performance**: Still blazing fast (<10ms).
    *   **Usability**: "Feels SO good", magnetic snapping restored.
    *   **Bonus**: Fixed "Invisible Mesh" issue in Move tool (likely due to invalid inputs from missed picks).

## Implementation Details
Modified `src/Scene.js` and `src/editing/tools/SculptBase.js`:

```javascript
// FIX v0.6.4: Unit-Corrected Cap (5cm Physical)
const vrScale = this._main._vrScale || 1.0;
const invScale = 1.0 / vrScale;
const MAX_SEARCH_METERS = 0.05; // 5cm
const MAX_SEARCH_RADIUS = MAX_SEARCH_METERS * invScale;

const searchRadius = Math.min(rWorld * 4.0, MAX_SEARCH_RADIUS);
picking.intersectionSphereMeshes(meshes, pos, searchRadius);
```

## Other Fixes (v0.6.5)
-   **VR Menu Depth**: Enabled Depth Test in `VRMenu.js` so it correctly hides behind the sculpt and controllers when appropriately positioned.

## Verification
*   **Log**: `Stroke` time < 10ms.
*   **Feel**: Consistent snapping.
*   **Move Tool**: Stable even at large radii.

# Walkthrough: VRLaser Implementation (v0.6.33)

## Goal
Provide clear visual feedback for UI interaction (Menu Pointing) without cluttering the view during sculpting.

## Approach
1.  **Geometry**: 8-sided Cylinder (Radius 1mm).
2.  **Shader**: `ShaderUnlit` (Solid Red `[1,0,0]`) to ensure visibility against all backgrounds without lighting artifacts.
3.  **Behavior**:
    *   **Conditional Visibility**: Only visible when `_isPointingAtMenu` is true.
    *   **Dynamic Length**: Stretches exactly to the menu intersection point (+5cm overshot) for precise depth cues.
    *   **Attachment**: Locked to `targetRaySpace` (or `gripSpace` fallback) of the Right Controller.

## Challenges
*   **Shader**: `ShaderFlat` forced "headlight" shading, making the laser look like a 3D pipe. Implemented `ShaderUnlit` for a clean "Laser" look.
*   **Caching**: Aggressive browser caching required manual cache-busting in `importmap` (`?v=...`) to force updates on Quest.

# Walkthrough: Modular VR Menu System (v0.6.70)

## Goal
Overhaul the limited "Proof of Concept" VR Tablet into a robust, extensible UI that matches the desktop application's feature set.

## Architecture Refactoring
*   **Modularization**: Split the monolithic `GuiXR.js` into feature-specific modules:
    *   `gui/vr/GuiVRTools.js`: Standard sculpting brushes and sliders.
    *   `gui/vr/GuiVRScene.js`: Scene management ("Add Primitive", Clear).
    *   `gui/vr/GuiVRRendering.js`: Visual settings (PBR, Wireframe, Passthrough).
    *   `gui/vr/GuiVRFiles.js`: Import/Export.
    *   `gui/vr/GuiVRHistory.js`: Undo/Redo/Subdivide.
*   **Resolution Boost**: Increased Canvas size from `512x512` to `1024x1024` for crisp text rendering.
*   **Tab System**: Implemented a "Category" header (TOOLS, SCENE, VIEW, ETC) that hot-swaps the visible widget set.

## Key Features Added
1.  **Primitives**: Users can now add Spheres, Cubes, Cylinders, and Tori directly in VR.
2.  **Rendering Control**: Toggle Wireframe, Flat Shading, and PBR/Matcap modes instantly.
3.  **Files**: Explicit Export/Import buttons (triggering browser downloads).
4.  **Extensibility**: Adding a new tool is now just adding an entry to `GuiVRTools.js` array.

## Technical Details
*   **Y-Coordinate Shift**: Adjusted layout start to `y=120` to accommodate the larger Header bar in the 1024px layout.
*   **Throttling**: Maintained the 30Hz draw/upload limit to ensure 90Hz headset tracking remains smooth.

# Walkthrough: VR Combobox Refinement (v0.6.77)

## Goal
Improve usability of the "Environment" and "Matcap" selection in VR by making the layout cleaner and the current selection visible at a glance.

## Changes
1.  **Layout Split**: Split the single "ENVIRONMENT & MATERIALS" header into two aligned headers: "ENVIRONMENT" and "MATCAP".
2.  **Dynamic Labels**: The combobox buttons now display the *name* of the currently selected environment or matcap (e.g., "clay", "studio_small_01") instead of the static generic labels.
3.  **Scoped Logic**: Ensure dynamic labeling only applies to `combobox` widgets to prevent accidental renaming of other buttons (like the main "Matcap" shading mode toggle).

## Verification
*   **Visuals**: Headers are aligned with their dropdowns.
*   **Feedback**: Changing the selection immediately updates the button text.
*   **Regression Check**: The top-level "Matcap" button (under Shading Mode) remains labeled "Matcap".

# Walkthrough: Radial Color Picker Refinement (v0.6.93)

## Goal
Improve the usability and accuracy of the VR Radial Color Picker based on user feedback.

## Changes
1.  **Geometry**:
    *   **Size**: Increased widget height from 150px to **300px** for easier interaction.
    *   **Ring Thickness**: Reduced from 50px to **20px** for a cleaner look.
    *   **Square**: Nested strictly inside the ring.
2.  **Color Mapping**:
    *   **Hue**: Corrected logic to match standard HSV (Red at 0/Right, Green at 120/Top, Blue at 240/Left).
    *   **Saturation/Value**: Clamped values to [0, 1] to prevent "out of bounds" drift.
3.  **Stability**:
    *   Fixed a `SyntaxError` caused by duplicate `cx`/`cy` variable declarations in the draw loop.

## Verification
*   **Visual**: Ring is thin and sharp. Colors match standard color wheels.
*   **Interaction**: Dragging on the ring changes Hue smoothly. Dragging inside the square changes S/V.

# Walkthrough: VR Menu Expansion (v0.6.98)

## Goal
Expand the VR Menu from a simple "Tools Only" interface to a comprehensive suite of controls matching the desktop application, including Topology, Scene, and View settings.

## Features Added
1.  **Topology Tab**:
    -   **Multiresolution**: Subdivide, Reverse, and Delete Levels.
    -   **Dynamic Topology**: Enable/Disable, Subdivision Factor (Slider), Decimation Factor (Slider).
    -   **Remesh**: Surface Remesh and Marching Cubes Remesh triggers.
2.  **Scene Settings Tab**:
    -   **Primitives**: Add Sphere, Cube, Cylinder, Torus directly into the scene.
    -   **Clear Scene**: Clean slate.
3.  **View Settings Tab**:
    -   **Wireframe**: Toggle on/off.
    -   **Flat Shading**: Toggle on/off.
    -   **PBR/Matcap**: Switch shader modes.
4.  **Files Tab**:
    -   **Import/Export**: OBJ/STL/PLY support (triggers browser download/upload dialogs).
5.  **History Tab**:
    -   **Undo/Redo**: Infinite history stack navigation.

## Desktop Preview (New Workflow)
To facilitate faster iteration on these complex layouts without constant headset toggling:
-   **Command**: `Shift + Alt + V` (or `app.guiXR.togglePreview()` in console).
-   **Behavior**: Renders the live VR Menu texture (1024x1024) as a DOM overlay on the desktop screen.
-   **Interaction**: Mouse clicks on the overlay simulate VR Pointer interactions (UV-based).

## Technical Details
-   **Widgets**: Standardized `GuiVR*.js` modules for each tab to keep `GuiXR.js` clean.
-   **Scrolling**: (Future) Currently menus are static pages; overflowing content may be clipped.
-   **Performance**: Menu redraws are throttled to 30Hz to preserve VR framerate.

## Verification
-   **Preview**: Use `Shift+Alt+V` to verify layout alignment.
-   **Function**: Verify "Subdivide" actually increases vertex count (visible in wireframe).

# Walkthrough: VR Dynamic Topology & Menu Completeness (v0.7.36)

## Goal
Achieve feature parity between Desktop and VR menus, specifically enabling **Dynamic Topology** and **Rendering Import** workflows in VR.

## Features Added
1.  **Dynamic Topology (VR)**:
    -   **Enabled Controls**: Activated functionality for "Subdivision", "Decimation", and "Linear" sliders/checkboxes in the VR Topology tab.
    -   **Multiresolution**: Wired up "Subdivide", "Reverse", "Del Lower", and "Del Higher" buttons to their respective core functions.
    -   **Integration**: Directly manipulates `MeshDynamic` static properties (`SUBDIVISION_FACTOR`, etc.) to align with desktop behavior.

2.  **Rendering Imports (VR)**:
    -   **Matcap Import**: Clicking "Import Matcap" in VR now triggers the browser's file dialog (via `document.getElementById('matcapopen').click()`).
    -   **UV Import**: Clicking "Import UV" triggers the texture file dialog.
    -   *Note*: In immersive VR, this may require the user to peek at the desktop or use a browser that supports overlay file pickers.

## Verification
-   **Dynamic Topology**:
    1.  Open VR Menu -> Topology.
    2.  Enable "Activated".
    3.  Adjust "Subdivision" slider.
    4.  Sculpt and observe mesh density changing dynamically.
-   **Imports**:
    1.  Open VR Menu -> Rendering.
    2.  Select "Matcap" mode.
    3.  Click "Import Matcap".
    4.  Verify file dialog opens.
