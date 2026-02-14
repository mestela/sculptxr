# Implementation Plan: Oculus Controller Visualization

**Objective**: Replace the placeholder "cube" controllers in WebXR mode with accurate 3D models of Oculus Touch (Quest) controllers.

**Strategy**: "Fetcher -> Converter -> Loader"
We will automate the retrieval of official controller assets from the [WebXR Input Profiles Registry](https://github.com/immersive-web/webxr-input-profiles), convert them from GLB to OBJ (using Blender), and load them into the engine.

## 1. Asset Pipeline Scripts

### A. Fetch Script (`scripts/fetch_controllers.sh`)
Downloads the precise GLB files for Oculus Touch v3 (Quest 3/Pro style or Quest 2) from the GitHub CDN.
*   **Source**: `https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/master/packages/assets/profiles/`
*   **Target**: `oculus-touch-v3` (Quest 2/3 standard).
*   **Files**: `left.glb`, `right.glb`.

### B. Conversion Script (`scripts/convert_controllers.py`)
Uses the local Blender (headless) to import GLB and export OBJ.
*   **Input**: `left.glb`, `right.glb`
*   **Output**: `controller_left.obj`, `controller_right.obj`
*   **Logic**:
    *   Import GLB.
    *   Join all meshes (buttons, sticks, body) into one static mesh per hand (MVP).
    *   Apply transforms (if necessary) to match SculptXR's coordinate system (Y-up, -Z forward?). *Correction*: WebXR Input Profiles usually point -Z. SculptXR generally respects this.
    *   Export as OBJ to `src/resources/controllers/`.

## 2. Engine Integration (`src/Scene.js`)

### A. Async Loading
Modify `initVRControllers()` to attempt loading the OBJ files.
*   **Fallback**: Keep the "Green/Blue Cube" logic until OBJs are loaded.
*   **Mechanism**: `XMLHttpRequest` -> `Import.importOBJ` -> `this._vrControllerLeft = meshes[0]`.

### B. Rendering
Update `updateVRControllerPose()` to handle the new meshes.
*   **Scaling**: The cubes were scaled `[0.02, 0.02, 0.02]` (2cm). The Input Profiles are usually in **meters** (1.0 = 1m).
*   **Adjustment**: We likely need to render them at scale `1.0` (if they are true-to-scale) or `1.0` relative to the metric world.
*   **Color**: The OBJs might not have vertex colors. We may need to assign a default material or texture (if we assume untextured for now, just flat grey).

## 3. Workflow Steps
1.  Create scripts.
2.  Run scripts to populate `src/resources/controllers/`.
3.  Modify `src/Scene.js`.
4.  Test in VR.

## 4. Verification
*   **Visual**: Controllers should look like Oculus Touch controllers.
*   **Alignment**: The "ray" (if visible) or "grip" point should match the physical controller.
*   **Performance**: Ensure high-poly controllers don't tank frame rate (OBJ should be reasonable).

