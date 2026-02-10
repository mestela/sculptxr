# SculptXR - WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Try the latest build [here!](https://tokeru.com/sculptxr/)

Watch a demo of the Feb 4 build [here!](https://www.youtube.com/watch?v=0gq1ZNOeHDY)

The VR Interface is a Work In Progress. Not all menus and UI elements from the desktop version are fully functional or present in VR yet. We are actively porting them over. 

## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 native browser
- Quest 3 native browser
- Google Chrome on Windows PCVR via Meta Link and Quest 3

## Releases

- **v0.7.258**: **Voxel Performance**:
    - **Optimization**: **Draw Loop**: Disabled `gl.getError` calls in `ShaderBase.js` (was consuming ~37% of frame time).
    - **Optimization**: **Voxel Updates**: Optimized `updateVoxelMesh` to skip unnecessary topology calculations.

- **v0.7.257**: **Log Cleanup & Voxel Polish**:
    - **Fix**: **Logs**: Removed verbose debug logs (`MESH_UPDATE`, `Updating Mesh...`) from `SculptVoxel.js` and `VoxelWorker.js`.
    - **Fix**: **Voxel Offset**: Confirmed Voxel Bake Offset was a non-issue.

- **v0.7.175**: **Debug Voxel Init & GL Launch Errors**:
    - **Fix**: **Voxel Init**: `VoxelWorker` now immediately posts an empty mesh on `INIT` to prevent the "no voxel mesh exists yet" warning.
    - **Debug**: **GL Safety**: Added `glDrawElements` safety check in `ShaderBase.js` to log "Insufficient Buffer" errors.

- **v0.7.174**: **Voxel Performance & Fixes**:
    - **Fix**: **Rendering**: Resolved black artifacts and `GL_INVALID_OPERATION` by ensuring `updateBuffers()` is called after Voxel mesh updates.
    - **Performance**: **Worker Throttling**: Implemented `returnMesh` flag and message throttling to prevent Voxel Worker from flooding the main thread during rapid sculpting.
    - **Fix**: **Memory Leak**: Fixed `Scene.js` `removeMeshes` bug (unsafe splice) and added `release()` to prevent voxel meshes from leaking memory on resolution change.

- **v0.7.121**: **Voxel Worker (Phase 1)**:
    - **Performance**: Moved Voxel Engine to a Web Worker (`VoxelWorker.js`).
    - **Architecture**: Implemented asynchronous messaging between Main thread and Worker.
    - **Compatibility**: Patched `gl-matrix` and `VoxelState` to run in both window and worker environments.

- **v0.7.118**: **Stabilization & Polish**:
    - **Fix**: **Sticky Brush**: Resolved critical bug where brush would continue drawing after release. Fixed `SculptBase.js` to respect trigger state in `updateXR`.
    - **Fix**: **Reference Images**: Flipped UVs in `MeshReference.js` to fix upside-down images.
    - **Fix**: **Grab Tool**: Improved stability with Delta Transforms, Locked Hand Priority, and "Active Mesh" fallback for easier picking.
    - **Fix**: **Ghost Trigger**: Prevented "stale" trigger inputs from blocking the other hand.
    - **Cleanup**: Massive removal of debug logs ("SCULPT BLOCKED", "Input Dump", "START STROKE") for a clean console.

[View Full Release History](docs/releases.md)

## Todo
- **Functionality**:
    - Dynamic Topology (code path is active, but not working, unsure why)
    - Multiresolution not yet supported in VR
    - Add primitives menu missing
    - Transform tool/gizmo missing
    - Re-symmetrize function, choose left->right, right->left
    - Drag and move tools should support 6dof rotation
    - Look at tricks from old Dreams demos (eg the potters wheel for painting and sculpting)
    - Symmetry for voxel tool
    - Straight line mode for voxel tool
    - Paint is a bit glitchy after 0.7.118
    - Left handed mode
    - Symmetry is really glitchy, needs to be reimplemented
    - ~~Spectator Mode: Implement Desktop Mirroring for PCVR~~ - **DONE v0.6.293** (See `docs/feature_desktop_6dof.md`)
    - ~~Drag tool not working correctly with symmetry~~ - **Stabilized v0.7.118**
    - ~~Reference image support~~ - **Working v0.7.118**
    - ~~Desktop mode with 6dof controllers! That should be possible to hack together!~~ **DONE v0.7.0**
    - ~~Grab brush~~ - **DONE v0.7.118**

- **UI + UX**  
    - Two-handed-grip pivot point needs an overlay icon, not the current purple cube
    - Menu layout is clunky, but covers all desktop options now. slowly adding functionality.
    - Jump between passthrough (AR) and immersive (VR) modes is janky
    - Really need to make 100% native dialog for inport/export. Ie the panel should show popups, have a file browser. Tricky.
    - **Visual Feedback**: Show Voxel Grid/Boundary Box (Users report drawing out of bounds)
    - Matcap misaligned; its upside down and slightly different in left/right eyes
    - Default move brush size is too big
    - Sphere radius indicator too prominent; should be fresnel effect so you only percieve the edges
    - Trigger on left controller should invoke sub mode
    - Drag on empty space of menu panel should scroll
    - Combobox for tool has misaligned highlight
    - Combobox for tool too slow; revert back to button panel i think
    - Default smooth strength too high
    - Menus currently need a click to close, then a click to open the next one. A click on another menu should hide the current, show the next straight away.
    - Trigger on left controller should activate 'sub' mode (and change colour of circle radius indicator)
    - ~~Double handed grip needs work, gets hard to control when the world has been scaled too large~~ - **Improved v0.7.118**
    - ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
    - ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**


- **Desktop 6DOF (Beta Issues)**:
    - ~~Desktop mode is proof-of-concept; needs adjusting to feel comfortable (simulated seated view).~~ **DONE v0.7.0**
    - Symmetry behaves strangely in desktop mode (investigate).
    - Tools should work based on Sphere Radius intersection 'hit' (currently relies heavily on Ray direction).
    - Should re-enable mouse controls to adjust the screen offset, eaier than using the consoel commands. Also just standard desktop mode should be able to work too. Maybe D can takeover the desktop view with the VR view, disable all the desktop UI, D again re-enables the desktop UI, stops the VR view being sent to desktop.
    - ~~idea! calibrate/adjust with grip controls. press C, go into 'move me' mode. normally grips move the world, controllers stay static in the view. in this mode, the world stays still, you move the controllers. tap C to exit out, now you're good to go.~~ **DONE v0.7.6**

- **Known Issues**:
    - **Quest 3 Crash on Reload**: Clearing cache and reloading the page on Quest 3 often crashes the browser. This is under investigation but difficult to debug without direct device access. Workaround: Close the tab or browser window and reopen if it hangs.


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
