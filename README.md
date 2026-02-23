# SculptXR (v0.7.801)
- WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Try the latest build [here!](https://tokeru.com/sculptxr/)
*   **v0.7.801**: **Move Tool Symmetry Fix**:
    - **Fix**: **Symmetry Regression**: Resolved the issue where the Move tool pulled unevenly across the symmetry plane by removing the arbitrary 1000-triangle limit in `Picking.js`.
*   **v0.7.800**: **Voxel Stability & Performance Release**:
    - **Optimization**: **Ray Picking**: Switched SculptVoxel to use Ray Picking in VR, eliminating CPU stalls and display warping.
    - **Robustness**: Added triangle count safeguards (1000 tris) to prevent hangs on high-poly meshes.
    - **UI**: **Voxel Bounding Box**: Added a static orange wireframe representing maximum volume limits.
    - **UI**: **Depth Integration**: Fixed bounds to respect scene depth (no longer always on top).
    - **UX**: **Transform Lock**: Voxel meshes are now locked to prevent alignment drift.
*   **v0.7.693 - v0.7.696**: **Voxel Mirror Tool Symmetry Fix**:
    - **Fix**: **Symmetry Failure**: Resolved a critical issue where sculpting tools failed to apply symmetry after a mesh had undergone a Voxel Mirror operation. 
    - **System**: Forced `SculptBase` to cleanly fallback to pure mathematical plane projection and spatial Sphere picking when topological symmetry is broken (like after a Remesh).
    - **Fix**: **Move Tool Mirrors**: Fixed the Move Tool's VR symmetry origin projection math to use arbitrary plane points and normals.
*   **v0.7.691 - v0.7.692**: **VR Move Tool Symmetry**:
    - **Fix**: Reverted the Move tool's custom Master-Slave topological mirror logic back to vanilla SculptGL mathematical Dual Independent Evaluation alongside `symFactor`. This completely resolves the horizontal mesh tearing and crossover bug when dragging the center line.
*   **v0.7.688 - v0.7.690**: **Volume Intersect Default**:
    - **Feature**: Replaced default "Aim/Laser" picking with "Volume Intersect" sphere picking for more predictable brush behavior on surfaces.
    - **UI**: Added "Aim Picking Mode (Raycast)" toggle in VR Settings > Input to optionally revert.
    - **UI**: Added "Aim Picking Mode (Raycast)" toggle in VR Settings > Input to optionally revert to the old interaction style across all tools.
    - **UI**: Hidden "Local Scale" and "Transform" from the VR Tools menu.
*   **v0.7.687**: **Two-Handed Scale Fix**:
    - **Fix**: **Math Bug**: Corrected a vector math bug in `Scene.scaleWorld` that mistakenly divided the coordinate offset by the scale ratio instead of multiplying it. 
    - **UX**: **Dolly Zoom**: The held object now maintains its physical distance from the user during a two-handed scale.

Watch a demo of the Feb 4 build [here!](https://www.youtube.com/watch?v=0gq1ZNOeHDY)


## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 and Quest 3 browser in standalone
- Google Chrome on Windows PCVR via Meta Link and Quest 3

## Releases
*   **v0.7.685**: **Transform Gizmo Undo & Polish**:
    - **Feature**: **Undo/Redo for Gizmo**: Full support for undoing and redoing Translate, Rotate, and Scale operations performed with the Transform Gizmo.
    - **Fix**: **Rotation Alignment**: Handles are now correctly aligned with their respective axes using quaternion math.
    - **Fix**: **Rendering Crash**: Resolved a `ReferenceError` that occurred during stereo rendering of the Gizmo.
    - **Polish**: **Visual Cleanup**: Removed persistent green debug sphere and ensured backface visibility for gizmo planes.

*   **v0.7.619**: **Gizmo Rotation & Picking Fix**:
    - **Fix**: **Rotation Handles**: Corrected the orientation of X (Red) and Z (Blue) rotation rings in `GizmoVR.js`.
    - **Improvement**: **Thick Picking**: Increased the physical picking thickness of rotation rings to ~5-8cm, making them much easier to grab in VR.
*   **v0.7.602**: **Gizmo Scale Fix**:
    - **Fix**: **Scale**: Corrected Gizmo scale to 1.0 (was 4x too big).
    - **Fix**: **Visibility**: Resolved bug where Gizmo was invisible on load (`0.0` scale init override).
*   **v0.7.492** (Current): **Move Tool Crash & Symmetry Fix**:
    - **Fix**: **Crash**: Resolved persistent crash in Move Tool when mesh is null.
    - **Fix**: **Symmetry Normals**: Fixed "tide mark" artifacts by correctly updating normals for topologically mapped vertices.
    - **Cleanup**: Standardized imports and removed version hacks.
*   **v0.7.485***: **Symmetry & Undo Fixed**:
    - **Robust Undo/Redo**: Fixed state tracking for Symmetrize and Move with Symmetry, preventing "tearing" and "creases".
    - **Topological Snap**: Symmetry now correctly handles topological matches even when vertices have drifted slightly.
    - **Cached Mapping**: Optimized symmetry calculations by caching the topological map.
    - **True Centering**: Vertices on the symmetry plane are now correctly snapped and handled.
*   **v0.7.434**: **Tool Improvements**:
    - **Hide Drag**: Disabled unstable Drag tool.
    - **Crease Pull**: Sub Mode (Left Trigger) now pulls creases outward.
    - **Smooth**: Adjusted Sharpen intensity (Negative Smooth) to be safer, currently disabled by default.
    - **Bug Fix**: Fixed crash on launch related to Drag tool registration.
*   **v0.7.429**: Added **Drag-to-Scroll** for main panel, fixed Combobox highlights and interaction logic.
*   **v0.7.416**: **Hand Swap** support, Left Trigger Feedback (Sub Mode), and Universal Sub Mode visuals.
### Recent Updates
- **v0.7.443**: 6DOF Move Tool (Position + Rotation) with improved symmetry compensation.
- **v0.7.434**: UX Polish (Hidden Drag, Smooth tweaks).
- **v0.7.431**: Crease Tool "Pinch-Pull" mode.
- **v0.7.429**: UI Cleanup & Bug fixes.
- **v0.7.423**: **Universal Sub Mode & Visuals**:
    - **Feature**: **Universal Sub Mode**: Holding the **Left Trigger** now subtracts/inverts the brush action for ALL tools (Right Hand).
    - **Visual**: **Red Cursor**: The brush cursor turns **RED** when Sub Mode is active.
    - **Fix**: **Left Hand Sculpting Disabled**: The Left Hand can no longer accidentally sculpt; it is reserved for modifiers and future navigation.
    - **Fix**: **Left Hand Mode**: Added "Dominant Hand Swap" toggle in **Settings > Input**.
    - **Fix**: **Menu Alignment**: Fixed VR Menu offset to correctly appear on the inner side of the controller for both hands.

- **v0.7.401**: **VR Menu Refinement**:
    - **UI**: **Menu Cleanup**: Removed desktop-only menus (Camera, Tablet, Language) from VR view.
    - **UI**: **About & Help**: Added dynamic version, website/github links, credits, and a controls cheatsheet.
    - **Fix**: **Widget Rendering**: Fixed `info` widgets not rendering in overlays.

- **v0.7.389**: **VR Twist Brush (Drill Mode)**:
    - **Feature**: **Drill Mode**: Twist brush now works in VR! Point and twist to drill the mesh.
    - **Feature**: **Symmetry**: Fully supported with mirrored position and reversed rotation.
    - **Fix**: **Crash**: Resolved `mat4` and `center` access errors in VR.

- **v0.7.381**: **UI Polish & Voxel Symmetry**:
    - **UI**: **Flame Style**: Removed borders, added solid backgrounds, standardized heights/text sizes.
    - **UI**: **Overlay**: Fixed overflow in Files menu, exposed `window.guiXR.styles` for theming.
    - **Fix**: **Voxel Symmetry**: Fixed Inflate/Deflate ignoring symmetry.
    - **Feature**: **Trigger Modulation**: Added Analog Trigger support for Radius/Intensity (Rabbit/Turtle mode).

- **v0.7.261**: Voxel GC Optimization (Octree Pooling).
- **v0.7.260**: Voxel Normal Optimization (Skip expensive compute).

- **v0.7.259**: Fix GL Error 1282 (Buffer Mismatch).
    - **Fix**: **Mesh Allocation**: Resolved `GL_INVALID_OPERATION` by fixing buffer resizing logic.
    - **Optimization**: **Buffer Updates**: Optimized Dynamic Buffer updates.



[View Full Release History](docs/releases.md)

## Todo
- **Functionality**:

- post v1
    - Voxel straight line mode
    - Voxel smooth shading
    - Voxel smooth brush
    - Xray mode
    - Look at tricks from old Dreams demos (eg the potters wheel for painting and sculpting)
    - multiplayer

- **UI + UX** 

- Show Voxel Grid/Boundary Box (Users report drawing out of bounds)
(for post v1) 
    - nearly time to think about tider panel
    - panel tear off/pin in place?
    - show more heads up things?
    - toolbar/shortcut bar?
    - Lock selection
    - outliner? 
    - different undo queue for desktop vs standalone
    - Two-handed-grip pivot point needs an overlay icon, not the current purple cube
    - Really need to make 100% VR native dialog, filebrowser for import/export
    - Combobox for tool needs a rethink. separate panel? Stack of most recently used tools ala zbrush?
    

- **Desktop 6DOF (Beta Issues)**:
    - Symmetry behaves strangely in desktop mode (investigate).
    - Tools should work based on Sphere Radius intersection 'hit' (currently relies heavily on Ray direction).
    - Should re-enable mouse controls to adjust the screen offset.
    - Standard desktop mode should be able to work too. Maybe D can takeover the desktop view with the VR view, disable all the desktop UI, D again re-enables the desktop UI, stops the VR view being sent to desktop.


## Done
- ~~symmetry issues voxel remesh can't restore symmetry~~ **DONE v0.7.696**
- ~~symmetry issues, move will break symetry at center line~~ **DONE v0.7.692**
- ~~ tools sphere intersect based, aim as an option in settings.~~ **DONE v0.7.690**
- ~~fix two handed grip scale misalignment.~~ **DONE v0.7.687**
~~- Transform tool/gizmo missing~~ **DONE v0.7.644**
- ~~menus dont appear if scroll is low~~ - **DONE v0.7.493**
- ~~brush circle incorrectly oriented before first stroke~~ - **DONE v0.7.443**
- ~~Twist brush occasional console error~~ - **DONE v0.7.443**
- ~~Re-symmetrize function, choose left->right, right->left~~ - **DONE v0.7.434**
- ~~Drag and move tools should support 6dof rotation~~ - **DONE v0.7.443**
- ~~Crease in sub mode should pull out a crease~~ - **DONE v0.7.434**
- ~~Combobox for tool has misaligned highlight~~
- ~~Matcap misaligned; its upside down and slightly different in left/right eyes~~ - **DONE v0.7.429**
- ~~Drag on empty space of menu panel should scroll~~ - **DONE v0.7.429**
- ~~Trigger on left controller should always activate 'sub' mode~~ - **DONE v0.7.423**
- ~~Left handed mode~~ - **DONE v0.7.416**
- ~~Dynamic Topology (code path is active, but not working, unsure why)~~
- ~~Multiresolution not yet supported in VR~~
- ~~Add primitives menu missing~~
- ~~Symmetry for voxel tool~~ - **DONE v0.7.381**
- ~~Twist brush VR support (Drill Mode)~~ - **DONE v0.7.389**
- ~~Spectator Mode: Implement Desktop Mirroring for PCVR~~ - **DONE v0.6.293** (See `docs/feature_desktop_6dof.md`)
- ~~Drag tool not working correctly with symmetry~~ - **Stabilized v0.7.118**
- ~~Reference image support~~ - **Working v0.7.118**
- ~~Desktop mode with 6dof controllers! That should be possible to hack together!~~ **DONE v0.7.0**
- ~~Grab brush~~ - **DONE v0.7.118**
- ~~Voxel add, sub, inflate, deflate brushes~~ - **DONE v0.7.360**
- ~~Voxel Resampling~~ - **Stabilized v0.7.369**
- ~~Voxel Bake~~ - **DONE v0.7.360**
- ~~Voxel symmetry~~ - **DONE v0.7.360**
- ~~Voxel undo/redo~~ - **DONE v0.7.360**
- ~~Default move brush size is too big~~
- ~~Menu layout is clunky, but covers all desktop options now. slowly adding functionality.~~ - **Refined v0.7.401**
- ~~Default smooth strength too high~~
- ~~Sphere radius indicator too prominent; should be fresnel effect so you only percieve the edges~~
- ~~Trigger on left controller should invoke sub mode~~
- ~~Menus currently need a click to close, then a click to open the next one. A click on another menu should hide the current, show the next straight away.~~ - **DONE**
- ~~Double handed grip needs work, gets hard to control when the world has been scaled too large~~ - **Improved v0.7.118**
- ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
- ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**
- ~~idea! calibrate/adjust with grip controls. press C, go into 'move me' mode. normally grips move the world, controllers stay static in the view. in this mode, the world stays still, you move the controllers. tap C to exit out, now you're good to go.~~ **DONE v0.7.6**
- ~~Desktop mode is proof-of-concept; needs adjusting to feel comfortable (simulated seated view).~~ **DONE v0.7.0**

## Clear Browser Cache
When testing and freqently updating the project, I found Chrome on desktop and the Chrome derived browser on the Quest 3 love to cache JS files. 

There might be better ways, but here's what I do to ensure the build is clean, nothing is cached:

### Desktop Chrome

1. R.click on the page, Inspect
2. Network tab, 'Disable Cache' toggle, turn it on.

![Console Network](assets/console_network.jpg)

3. Application tab, Storage, 'Clear site data'

![](assets/console_application.jpg)

If the Inspect tab doesn't have enough room, the Network or Applications tab might be under the >> button in the top bar.

![](assets/console_hidden.jpg)

### Quest 3 browser

- Click the 3 dots button in the top right of the browser
- Clear Browsing Data
- Clear Data


## Quick Start
Note that these instructions are for SculptGl, not SculptXR. I'm just sending static files to my website atm.

1. Install dependencies:
   ```bash
   yarn
   ```
2. Run development server:
   ```bash
   yarn dev
   ```
3. Visit `http://localhost:8000` (or the URL provided).

Alternatively, you can use Python for a simple static server if you have built the source or are running pre-built files:
```bash
python3 -m http.server 8000
```

## Original Project Resources
- Live Demo: [stephaneginier.com/sculptgl](http://stephaneginier.com/sculptgl)
- Website: [stephaneginier.com](http://stephaneginier.com/)

## Tools
Node.js is required.

### Standalone Build
```bash
yarn add electron
yarn add electron-packager
yarn standalone
```

## Credits
- Original SculptGL by [Stéphane Ginier](http://stephaneginier.com/).
- Raw environments from [HDRI Haven](https://hdrihaven.com/hdris).
