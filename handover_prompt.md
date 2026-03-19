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
   - Fixed a bug where clicking "Tool" on the MiniHUD made the UI vanish entirely.
   - Corrected the `_vrPopup` orientation to match the MiniHUD.
   - Disabled the noisy interactive `window.debugRaycaster` axis lines.
   - **(v1.0.1)** Completely rewrote the `GuiXR` debounce architecture. Solved deep race conditions where 1-frame WebXR pose prediction jerks (during trigger pulls) would cause the UI to register a "miss", which then unfairly started the 250ms debounce lockout. Now, users can perform rapid sweep-clicks and tap accordions instantly without misfires.
   - **(v1.0.20)** Restored 1:1 parity for VR cursor visuals (volume sphere blending, intensity color saturation, stylus spike). Fixed the critical "cursor jumping to opposite side of mesh" bug by reverting to ultra-fast thin octree raycasts combined with mathematical backface-culling, allowing cursors to gracefully hide when the controller dips inside the mesh instead of choking the CPU with thick cylinder casts.
   - **(v1.0.21)** Fixed broken symmetry for the Move Tool. Resolved an underlying issue where the new raycast picking engine (introduced in v1.0.20) failed to set the `_isVRHit` flag, causing the VR Move tool to silently fall back to Desktop mouse symmetry coordinates.
   - **(v1.0.22)** Fixed major VR picking instability. Discovered that the raycaster was mistakenly receiving World Space coordinates instead of Local Space coordinates whenever a mesh was actively locked during a stroke. Reverting the direct method call to `intersectionRayMeshes([mesh], ...)` correctly processes the matrix inversion, restoring flawless sculptural responsiveness on translated/scaled meshes.
## Recent Work & Context (Updated)
1. **Material Swapping Fixed**: Resolved the blocker where clicking UI materials wouldn't update the Three.js mesh. Now `mesh.setShaderType(newType)` correctly sets the Three.js material instance.
2. **MatCap Texture Paths Fixed**: Prependied `app/` to Vite paths to ensure assets load (Status 200).
3. **Refactored Loader to Native TextureLoader (v1.0.36)**: Switched from manual `HTMLImageElement` load + `new THREE.Texture()` to Three.js's standard async `THREE.TextureLoader().load()`.
4. **Matched View Space Normal Bug (v1.0.38)**: Found the vertex shader was passing Object Space normal for static vertices instead of View Space (which MatCap expects). Fixed it to use View Space always.

## Current Working Blocker: MatCap Shaders Render Black
Despite valid images (Status 200 in Network tab), valid `THREE.Texture` objects in memory (accessible via `window.ShaderMatcap.textures`), and verified `vNormal` calculations, the MatCap sphere remains pitch black in the headset.

### Hypotheses to Test in Morning:
*   **Three.js State Leak in VR**: In `Scene.js` `_drawScene()`, `resetState()` is skipped if `isVR` is true (to prevent unbinding WebXR baseLayer). Could some other WebGL call be clobbering the texture unit 0 without Three.js knowing?
*   **NaN Normals**: Are the normals `NaN` for some other reason (divide-by-zero)?
*   **Fallback to Standard Material**: If custom WebGL hacks continue to choke, should we bite the bullet and use native `THREE.MeshMatcapMaterial` (which works perfectly with Three.js state trackers), even if it means losing the custom camera-horizon stabilization for a bit?

### Handy Debug Commands (Run in Console):
*   `window.app.getMesh().getMatcap()` -> Check active matcap index.
*   `window.app.getMesh().setAlbedo([1,1,1]); window.app.render();` -> Force Albedo to white to rule out black vertex painting.
*   `window.ShaderMatcap.textures` -> Inspect loaded `THREE.Texture` objects.

## Device Testing Strategy
*   **Current (Fast Iteration)**: Using GalaxyXR headset connected via ADB to Macbook. Debugging with Remote Chrome Console. Vite provides HMR, making the debug cycle ~1/3 the time.
*   **Future Validations**: Quest 3 (Standalone & PCVR), Quest 2. Beta testers on Valve Index, Pico VR, Apple Vision Pro. Relying on Three.js WebXR support to handle per-platform customizations automatically.
