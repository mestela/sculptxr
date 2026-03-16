# Handover Prompt

**Project Status**: Mid-migration from custom raw WebGL rendering (SculptGL) to **Three.js v160**. Phase 1 (Engine Initialization) is complete. Phase 2 (Mesh Data Bridge) is currently in progress, focusing on stabilizing the dynamic BufferGeometry updates.

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr/`

## Critical Developer Instructions
[WARNING: THE PROJECT NOW USES VITE FOR LOCAL DEVELOPMENT.]
* Read the codebase using `view_file` instead of grep where possible. 
* Do not attempt to run `npm run build` or `npm run deploy` unless publishing. 
* **Local Server**: The project uses Vite. Run `npm run dev` to start the local development server. It serves under `https://localhost:8084/`. WebXR requires HTTPS or localhost. Vite provides Hot Module Replacement (HMR) for faster iteration, though WebXR sessions may still require a manual refresh depending on the headset.


## Recent Work & Context
1. **Three.js WebXR Migration**: Successfully migrated `Scene.js` to use `renderer.xr` for session management and controller rendering. Controller poses and origin matrices are driving the existing sculpt logic.
2. **VR UI Render Chain**: We have successfully attached the custom `VRMenu` meshes (`_vrMenu` for the Main Menu, `_vrMiniHUD` for your left-hand tools, and `_vrPopup` for the Tool Picker) directly to the Three.js controller grip spaces.
3. **UI Laser Pointer Fixes**: Added visual laser pointers (Three.js Cylinders). The lines are clipped by mathematical intersections against the Three.js mesh surfaces. 
4. **Current Status & Fixes**: 
   - Fixed a bug where clicking "Tool" on the MiniHUD made the UI vanish entirely (the Tool Picker's `_vrPopup` mesh wasn't attached to the Scene).
   - Corrected the `_vrPopup` orientation to match the MiniHUD.
   - Disabled the noisy interactive `window.debugRaycaster` axis lines.

## Next Steps / Current Issues
1. **UI Interaction Failed**: The user reports they still cannot click or interact with any menu elements other than the 'tool' button (which appears to open the combobox). Nothing is detecting hover events or highlights.
2. **Mesh Intersection Failed**: The lasers still do not detect or intersect the actual Sculpt Mesh, preventing sculpting or geometry-based interactions.
3. **Debugging Need**: Investigate the Raycast origin/direction in `Scene.js`. `GuiXR._handleMenuInteract` might not be receiving the correct `currU` and `currV` coordinates, or `this._picking.intersectionRayMesh` might be failing due to coordinate space mismatches between the raw WebXR frame tracking and Three.js world matrices.