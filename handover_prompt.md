# Handover Prompt

**Project Status**: Successfully completed the core migration from custom raw WebGL rendering (SculptGL) to **Three.js v160** over the weekend. The project is currently on a branch and functioning in the GalaxyXR headset. The focus has now shifted to "fit and finish" - refining the implementation, restoring parity with the WebGL version, and preparing to merge back to `master`.

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr/`

## Critical Developer Instructions
[WARNING: THE PROJECT NOW USES VITE FOR LOCAL DEVELOPMENT.]
* Read the codebase using `view_file` instead of grep where possible. 
* Do not attempt to run `npm run build` or `npm run deploy` unless publishing. 
* **Local Server**: The project uses Vite. Run `npm run dev` to start the local development server. It serves under `https://localhost:8084/`. WebXR requires HTTPS or localhost. Vite provides Hot Module Replacement (HMR) for faster iteration, though WebXR sessions may still require a manual refresh depending on the headset.

## Recent Work & Context
1. **Three.js WebXR Migration**: Successfully migrated `Scene.js` to use `renderer.xr` for session management and controller rendering. Controller poses and origin matrices are driving the existing sculpt logic.
2. **VR UI Render Chain**: Attached the custom `VRMenu` meshes (`_vrMenu` for the Main Menu, `_vrMiniHUD` for left-hand tools, and `_vrPopup` for the Tool Picker) directly to the Three.js controller grip spaces. Most tools are working.
3. **UI Laser Pointer Fixes**: Added visual laser pointers (Three.js Cylinders). The lines are clipped by mathematical intersections against the Three.js mesh surfaces. 
4. **Current Status & Fixes**: 
   - Fixed a bug where clicking "Tool" on the MiniHUD made the UI vanish entirely (the Tool Picker's `_vrPopup` mesh wasn't attached to the Scene).
   - Corrected the `_vrPopup` orientation to match the MiniHUD.
   - Disabled the noisy interactive `window.debugRaycaster` axis lines.

## Next Steps: Phase 3 (Fit and Finish Priorities)
* **Controller Visuals & Logic**: Implement missing sphere and circle radius indicators on the tools. Investigate volume select logic (suspect it isn't fully ported).
* **Symmetry**: Currently broken, especially for the Move Tool. Needs debugging.
* **Rendering Modes**: Restore wireframe overlays, matcaps, normals, and other missing rendering modes.
* **VR Menu Completion**: "Tools" section works, but "Wireframe/Materials" are broken. Need to audit and test the rest of the VR menu.
* **Sculpting "Feel"**: Tune the sculpting feel to match the tactile feel of the original WebGL version.
* **Voxel Mode**: Needs a complete review and testing to see what broke during the port.
* **Other Features**: Identify and reimplement any other missing legacy features.

## Device Testing Strategy
* **Current (Fast Iteration)**: Using GalaxyXR headset connected via ADB to Macbook. Debugging with Remote Chrome Console. Vite provides HMR, making the debug cycle ~1/3 the time.
* **Future Validations**: Quest 3 (Standalone & PCVR), Quest 2. Beta testers on Valve Index, Pico VR, Apple Vision Pro. Relying on Three.js WebXR support to handle per-platform customizations automatically.
