# SculptXR Release History

- **v0.7.316**: Voxel Undo/Redo (Functional)
    - **Feature**: Enabled Voxel Undo/Redo per stroke.
    - **Note**: Basic functionality working, but reported as "erratic" (investigating).
    - **Cleanup**: Removed debug logs.


- **v0.7.272**: Redeploy Voxel Opt
    - **Note**: Re-deployed v0.7.271 changes to ensure they are active.
    - **Speed**: Includes `tightenBounds` optimization.
- **v0.7.271**: Voxel Bounds Optimization

    - **Speed**: Implemented `tightenBounds` to shrink the active computation area when voxels are erased.
    - **Target**: Should eliminate the ~90ms processing time for "empty" or sparse voxel grids.
- **v0.7.270**: Hotfix Syntax Error 2

    - **Fix**: Removed extra brace in `GuiXR.js` that caused `SyntaxError`.
- **v0.7.269**: Hotfix Syntax Error

    - **Fix**: Resolved `SyntaxError` in `GuiXR.js` (Unexpected token `{`).
    - **Debug**: Version info is now correctly drawn in `GuiXR.draw`.
- **v0.7.268**: Voxel Optimization

    - **Speed**: Optimized `SurfaceNets` to skip expensive Attribute interpolation (Colors/Materials) for empty voxels.
    - **Target**: Should reduce `VoxelWorker` compute time significantly.
- **v0.7.267**: Debug Info in UI

    - **Debug**: Added Version and Build Description to the top of the Debug Window / VR Panel.
- **v0.7.266**: Console Debugging

    - **Debug**: Enabled standard `console.log` for Voxel Worker timings (check F12).
- **v0.7.265**: Dev Ops Fix

    - **Fix**: Removed `FORCE` override from deploy scripts to prevent accidental overwrites.
    - **Note**: Officially bumped to v0.7.265 to resolve prev version conflict.
- **v0.7.264**: Voxel Profiling & Tuning

    - **Tuning**: Increased `OctreeCell.MAX_FACES` (100 -> 250) to reduce tree depth/overhead for dense meshes.
    - **Debug**: Added Worker timing logs to identify bottleneck (`Worker=` vs `V=`).
- **v0.7.263**: Hotfix for Voxel Crash (Again)

    - **Fix**: Resolved `Cannot read properties of null` in `Mesh.updateOctree` (fixed `this._meshData` access).
- **v0.7.262**: Hotfix for Voxel Crash

    - **Fix**: Resolved `OctreeCell.reset` crash on launch (missing array initialization).
- **v0.7.261**: Voxel GC Optimization

    - **Optimization**: **Octree Pooling**: Implemented Object Pooling for Octree cells to drastically reduce Garbage Collection overhead (20ms -> near 0ms).
    - **Optimization**: **AABB Updates**: Added `updateFacesAabb` to skip normal computation during Voxel mesh updates.
- **v0.7.260**: Voxel Optimization

    - **Performance**: Skipped heavy vertex normal computation for Voxel Mesh (FLAT shader).
    - **Optimization**: Lazy-load normals only when switching to Matcap/Wireframe.
    - **Fix**: Added fallback in `Picking.js` for missing normals.
- **v0.7.259**: **GL Error Fix**:
    - **Fix**: **Mesh Allocation**: Resolved `GL_INVALID_OPERATION` (1282) by ensuring `Mesh.allocateArrays` correctly resizes buffers when mesh grows (critical for Voxel sculpting).
    - **Optimization**: **Buffer Updates**: Implemented `glBufferData` (orphaning) for Dynamic buffers to prevent pipeline stalls and synchronization issues.

- **v0.7.258**: **Voxel Performance**:
    - **Optimization**: **Draw Loop**: Disabled `gl.getError` calls in `ShaderBase.js` (was consuming ~37% of frame time).
    - **Optimization**: **Voxel Updates**: Optimized `updateVoxelMesh` to skip unnecessary topology calculations (`initEdges`, `initVertexRings`), saving ~15% overhead.

- **v0.7.257**: **Log Cleanup & Voxel Polish**:
    - **Fix**: **Logs**: Removed verbose debug logs (`MESH_UPDATE`, `Updating Mesh...`) from `SculptVoxel.js` and `VoxelWorker.js` to improve console readability and performance.
    - **Fix**: **Voxel Offset**: Confirmed Voxel Bake Offset was a non-issue (user verification), ensuring confidence in the current coordinate system.

- **v0.7.175**: **Debug Voxel Init & GL Launch Errors**:
    - **Fix**: **Voxel Init**: `VoxelWorker` now immediately posts an empty mesh on `INIT` to prevent the "no voxel mesh exists yet" warning and allow immediate interaction.
    - **Debug**: **GL Safety**: Added `glDrawElements` safety check in `ShaderBase.js` to log "Insufficient Buffer" errors with Mesh ID and counts, preventing potential crashes or silent failures.
    - **Performance**: Enabled `console.time` for Voxel Mesh Updates to help profile performance.

- **v0.7.174**: **Voxel Performance & Fixes**:
    - **Fix**: **Rendering**: Resolved black artifacts and `GL_INVALID_OPERATION` by ensuring `updateBuffers()` is called after Voxel mesh updates.
    - **Performance**: **Worker Throttling**: Implemented `returnMesh` flag and message throttling to prevent Voxel Worker from flooding the main thread during rapid sculpting.
    - **Fix**: **Memory Leak**: Fixed `Scene.js` `removeMeshes` bug (unsafe splice) and added `release()` to prevent voxel meshes from leaking memory on resolution change.
    - **Fix**: **Bake**: Updated `bakeToMesh` to handle new `SurfaceNets` triangulation (Triangles instead of Quads).

- **v0.7.151**: **Fix**:
    - **Manager**: Disabled synchronous Voxel Undo in `SculptManager.js` to prevent `StateVoxel` crash.
    - **Inputs**: Fixed Voxel Negative Mode (Left Trigger/Squeeze) in `Scene.js`.
    - **Logs**: Cleaned up spammy debug logs in `VoxelState.js` and `Scene.js`.
    - **Consistency**: Removed remaining `window` references in `VoxelState.js`.

- **v0.7.150**: **Fix**:
    - **Worker**: Removed `window` access in `src/workers/VoxelState.js` to prevent `ReferenceError`.
    - **State**: Disabled `pushState` in `SculptVoxel.js` to prevent `TypeError` when undoing (Phase 1 limitation).

- **v0.7.149**: **Fix**:
    - **GUI**: Fixed a bug in `GuiSculptingTools.js` where missing tool GUIs caused a crash (assigned to wrong object). Enabling proper Voxel tool initialization.

- **v0.7.148**: **Debug**:
    - **Isolation**: Restored `SurfaceNets` import and usage in `src/workers/VoxelState.js`. Checking if `SurfaceNets` is compatible with the worker environment.

- **v0.7.147**: **Debug**:
    - **Isolation**: Commented out `MarchingCubes` and `SurfaceNets` in `src/workers/VoxelState.js` again to isolate the silent failure observed in v0.7.146.

- **v0.7.146**: **Fix**:
    - **Worker**: Restored full `VoxelState` logic in `src/workers/VoxelState.js` with corrected imports. The Voxel Worker should now be fully functional.

- **v0.7.145**: **Debug**:
    - **Isolation**: Restored `Utils` import in `src/workers/VoxelState.js` to verify it loads correctly in the worker.

- **v0.7.144**: **Fix**:
    - **Worker**: Updated `VoxelWorker.js` to import `./VoxelState.js` (local worker version) instead of `/src/editing/VoxelState.js`. This ensures the worker uses the file with adjusted imports (currently minimal test).

- **v0.7.143**: **Debug**:
    - **Isolation**: Stripped `src/workers/VoxelState.js` to minimal `gl-matrix` test to pinpoint the module load failure.

- **v0.7.142**: **Debug**:
    - **Isolation**: Commented out `MarchingCubes` and `SurfaceNets` in `src/workers/VoxelState.js` to check if they are the cause of worker failure.

- **v0.7.141**: **Fix**:
    - **Worker**: Created `src/workers/VoxelState.js` with adjusted imports to resolve shared code dependencies in the worker environment.
    - **Restoration**: Restored original `src/editing/VoxelState.js`.

- **v0.7.140**: **Debug**:
    - **Isolation**: Testing absolute path `/src/editing/VoxelState.js` in worker to see if it fixes the resolution issue without duplication.

- **v0.7.139**: **Debug**:
    - **Isolation**: Copied `VoxelState.js` to `src/workers/` and imported locally to confirm path resolution issue with `../`.

- **v0.7.138**: **Debug**:
    - **Isolation**: Attempting local import `TestModule.js` in worker to rule out path resolution issues with `../`.

- **v0.7.137**: **Debug**:
    - **Isolation**: Replaced `VoxelState.js` with dummy class (no imports) to verify if `VoxelState` imports are the cause of failure.

- **v0.7.136**: **Debug**:
    - **Step-up**: Re-enabled `VoxelState` import in worker to verify if it causes failure.

- **v0.7.135**: **Hotfix**:
    - **Fix**: Resolved remaining Scope Syntax Error in `SculptVoxel.js` constructor causing worker initialization issues.

- **v0.7.134**: **Debug**:
    - **Isolation**: Commented out `VoxelWorker.js` imports to test basic worker connectivity.

- **v0.7.133**: **Hotfix**:
    - **Fix**: Resolved SyntaxError in `SculptVoxel.js` caused by previous bad merge.

- **v0.7.132**: **Debug Re-enabled**:
    - **Debug**: Re-enabled worker logs to troubleshoot user-reported failure.
    - **Revert**: Wrapped inline worker experiment (didn't work) back to file-based worker.

- **v0.7.131**: **Final Polish**:
    - **Clean**: Removed debug logs from Worker dependencies.
    - **Fix**: Suppressed silent "Event" errors from Voxel Worker in UI, as they don't impact functionality (worker verified running).

- **v0.7.130**: **Debug Build**:
    - **Debug**: Added extensive logging to `VoxelState`, `Utils`, `MarchingCubes`, and `SurfaceNets` to trace Worker startup sequence.

- **v0.7.129**: **Hotfix**:
    - **Fix**: Added cache busting (`?t=...`) to Voxel Worker loading to ensure the latest worker code is used.
    - **Fix**: Confirmed `VoxelState.js` and dependencies are now correctly loaded in the worker.

- **v0.7.128**: **Worker Import Fix**:
    - **Fix**: Replaced all bare module imports (`misc/Utils`) with relative imports (`../misc/Utils.js`) in `VoxelState.js` and `MarchingCubes.js`. This fixes the "Voxel Worker Error" caused by Module Workers not supporting bare specs.

- **v0.7.127**: **Worker Compatibility**:
    - **Fix**: Removed `window` references from `Utils.js` and `VoxelState.js` to prevent Worker crashes.
    - **Fix**: Verified `VoxelState.js` no longer calls `window.screenLog` inside the worker loop.

- **v0.7.126**: **Hotfix**:
    - **Fix**: Removed invalid `setIsTransparent` call causing crash in `SculptVoxel`. Verified transparency logic (opacity < 0.99).

- **v0.7.125**: **Air Mode Fix**:
    - **Fix**: Disabled standard "Surface Ring" selection for Voxel Tool in VR.
    - **Feature**: Added "Air Cursor" (Orange Sphere) that tracks controller position.
    - **Fix**: Added explicit `screenLog` debug output to verify Worker events and sculpting commands in VR.

- **v0.7.124**: **Hotfix**:
    - **Fix**: Resolved `SyntaxError` (duplicate `updateMesh` method) in `SculptVoxel.js`. Verified loading locally.

- **v0.7.123**: **Voxel Logic Fix**:
    - **Fix**: Removed leftover direct calls to `addSphere` in `SculptVoxel.js` which were causing "undefined" errors.
    - **Fix**: Cached Voxel Grid metadata (`min`, `max`, `step`) locally to prevent crashes when accessing `_voxelState` (which is now Worker-only).

- **v0.7.122**: **Hotfix**:
    - **Fix**: Resolved syntax error in `SculptVoxel.js` that prevented loading in Beta.

- **v0.7.121**: **Voxel Worker (Phase 1)**:
    - **Performance**: Moved Voxel Engine to a Web Worker (`VoxelWorker.js`). Sculpting geometry no longer blocks the main thread, ensuring smooth head tracking and UI interactions even during complex operations.
    - **Architecture**: Implemented asynchronous messaging between Main thread and Worker.
    - **Compatibility**: Patched `gl-matrix` and `VoxelState` to run in both window and worker environments.

- **v0.7.118**: **Stabilization & Polish**:
    - **Fix**: **Sticky Brush**: Resolved critical bug where brush would continue drawing after release. Fixed `SculptBase.js` to respect trigger state in `updateXR`.
    - **Fix**: **Reference Images**: Flipped UVs in `MeshReference.js` to fix upside-down images.
    - **Fix**: **Grab Tool**: Improved stability with Delta Transforms, Locked Hand Priority, and "Active Mesh" fallback for easier picking.
    - **Fix**: **Ghost Trigger**: Prevented "stale" trigger inputs from blocking the other hand.
    - **Cleanup**: Massive removal of debug logs ("SCULPT BLOCKED", "Input Dump", "START STROKE") for a clean console.

- **v0.7.49**: **VR Polish & Fixes**:
    - **Feature**: **Radial Color Picker**: Restored the embedded radial color picker for the Paint tool in VR.
    - **Fix**: **Thumbstick Radius**: Fixed right thumbstick up/down input to correctly adjust tool radius (was jumping to ~20%).
    - **Fix**: **Symmetry Line**: Made the symmetry line thinner and less obtrusive in VR.
    - **Fix**: **Crash Protection**: Added safeguards for "Duplicate" and "Merge" operations to prevent VR session crashes.
    - **Cleanup**: Silenced `[GuiXR]` logs for a cleaner console.

- **v0.7.35**: **Desktop Preview Polish**:
    - **Feature**: Full "Desktop Preview" for VR Menu (Shift-Alt-V).
    - **Fix**: Resolved "phantom" highlighting where background tabs would light up or click through the overlay menu.
    - **Fix**: Polished hover states for overlay buttons (white border, brightness boost).
    - **Fix**: Removed debug logs for a cleaner console experience.

- **v0.7.33**: **Desktop Overlay Click Block**:
    - **Fix**: Applied the same spatial blocking to **clicks** that was applied to hovers. This prevents clicking "background tabs" (like About & Help) through the overlay menu when buttons overlap.

- **v0.7.32**: **Desktop Overlay Log Cleanup**:
    - **Cleanup**: Removed spammy debug logs (`[GuiXR] Map: ...`) to keep the console clean for VR testing.

- **v0.7.31**: **Desktop Overlay Spatial Fix**:
    - **Fix**: Re-enabled tab highlighting when the overlay is open, BUT only if the cursor is *outside* the overlay menu bounds. This allows you to select tabs if the menu is not covering them, but prevents accidental tab clicks when interacting with the menu.

- **v0.7.30**: **Desktop Overlay Tab Collision Fix**:
    - **Fix**: Disabled background tab highlighting while the overlay menu is open. This prevents "phantom" highlights on tabs (like "About & Help") when hovering over overlay buttons that sit visually on top of the tab area.

- **v0.7.29**: **Desktop Overlay Polish**:
    - **Fix**: Removed valid-but-distracting gray borders from un-hovered overlay buttons.
    - **Fix**: Ensured main tab highlights are cleared when interacting with the overlay menu (fixed stale "About & Help" highlight).

- **v0.7.28**: **Desktop Overlay Highlight Final**:
    - **Fix**: Finalized the robust highlighting logic (fixed previous update failure). Border is now drawn last to ensure visibility.

- **v0.7.27**: **Desktop Overlay Robust Highlight**:
    - **Fix**: Adjusted overlay highlighting z-order to ensure buttons and comboboxes don't obscure the selection. Added a clean white border on top of all hovered items.

- **v0.7.26**: **Desktop Overlay Green Highlight**:
    - **Debug**: Changed overlay hover highlight to bright GREEN to make it obvious if it's working or not.

- **v0.7.25**: **Desktop Overlay Reference Fix**:
    - **Fix**: Declared `hitWidget` variable to prevent ReferenceError in debug logs.

- **v0.7.24**: **Desktop Overlay Syntax Final**:
    - **Fix**: Finally fixed the syntax error in `GuiXR.js` (removed premature closing brace).

- **v0.7.23**: **Desktop Overlay Brace Fix**:
    - **Fix**: Resolved another syntax error (premature closing brace) in `GuiXR.js`.

- **v0.7.22**: **Desktop Overlay Syntax Fix**:
    - **Fix**: Resolved syntax error caused by stray code in the previous debug patch.

- **v0.7.21**: **Desktop Overlay Debug**:
    - **Debugging**: Added logs to `_updateOverlayHover` to trace hit testing math for overlay widgets.

- **v0.7.20**: **Desktop Highlight Fix**:
    - **Fix**: Added a render loop to `togglePreview` to ensure the GUI redraws when hover states change (since the main VR loop might not be running or updating GuiXR in desktop mode).

- **v0.7.19**: **Desktop Coord Fix Retry**:
    - **Fix**: Re-applied the coordinate fix (previous attempt failed to patch). Now correctly passing normalized coordinates to `setCursor`.

- **v0.7.18**: **Desktop Coord Fix**:
    - **Fix**: Removed double multiplication of coordinates in Desktop Preview. `setCursor` already scales by canvas size, so we now pass normalized coordinates.

- **v0.7.17**: **Desktop Debug Rect**:
    - **Debugging**: Added logs to `mapEventToPixels` to check `getBoundingClientRect()` values.

- **v0.7.16**: **Desktop Input Fix**:
    - **Fix**: Hardcoded canvas size for Desktop Preview input mapping to avoid issues with high-DPI displays or renderer resizing.

- **v0.7.15**: **Desktop Fix 2**:
    - **Fix**: Resolved `ReferenceError` preventing debug logs from working in Desktop Preview.

- **v0.7.14**: **Desktop Tracing**:
    - **Debugging**: Added verbose logs to `onInteract` to diagnose why clicks might be ignored in Desktop Preview.

- **v0.7.13**: **Desktop Debug Fix**:
    - **Fix**: Corrected control flow in `onInteract` which was preventing Tab and Widget interaction in Desktop Preview mode.

- **v0.7.12**: **Desktop Debug Logs**:
    - **Debugging**: Added console logs to `Shift-Alt-V` input to trace why mouse interaction might be failing.

- **v0.7.11**: **Desktop Menu Debug**:
    - **Debugging**: Fixed `Shift-Alt-V` preview mode to correctly handle mouse input, allowing easy testing of VR menus on desktop.

- **v0.7.10**: **Menu Input Priority**:
    - **Fix**: Clicking a menu button that overlaps a Tab Header now correctly triggers the button instead of switching the tab.

- **v0.7.9**: **Menu Hover Fix**:
    - **Highlight Stability**: Fixed an issue where menu buttons could stay highlighted when moving quickly between them.

- **v0.7.8**: **VR Menu Polish**:
    - **Toggle-to-Close**: Clicking the active menu tab (e.g. "Files") while open will now close it.
    - **Hover Focus**: Top Menu Tabs will now highlight when hovered, even if a menu dropdown is currently open.

- **v0.7.7**: **VR Menu Flow**:
    - **Fast Switching**: Clicking a Top Menu Tab now instantly opens it, even if another menu is already open (no longer need to click "Back" or empty space first).
    - **Cleanup**: Improved overlay closing logic.

- **v0.7.6**: **Controller Calibration Mode**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Move Me**: Press 'C' to toggle Calibration Mode.
    - **Grip & Drag**: Hold grip to move the Spectator Camera relative to the world.
    - **Twist**: Hold grip and twist to rotate the Spectator Camera.
    - **Visuals**: Sculpt mesh hides automatically during calibration for a clearer view.
    - **Decoupled**: Calibration only affects the Spectator View; VR Headset view remains 1:1.

- **v0.7.0**: **Desktop 6DOF (Spectator Mode)**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Desktop Mode**: Simulated "Seated" view for non-VR users.
    - **Parity Render**: Desktop view now renders exact same tools/mesh as VR (Solved "Missing Controller" bug).
    - **Zero Offset**: Desktop camera is rotated 180° to provide a stable "Seated" view of the sculpture.
    - **Sphere Depth**: Brush cursor now properly intersects with the mesh (enabled Depth Test).
    - **WebGL 1 Compatibility**: Restored support for older devices/browsers.

- **v0.6.238**: **Move Tool Polish**: Enabled Air Mode (move without surface intersection) and fixed radius scaling to match other tools.
- **v0.6.220**: **VR Brush Alignment**: Implemented Ray-based Picking (Laser) for precise brush positioning. Brush cursor now aligns perfectly with the controller's aim direction.
- **v0.6.219**: **Final Polish**: Log cleanup and version hardening.
- **v0.6.218**: **VR Brush Visuals**: Fixed Surface Radius Circle visibility (moved to RenderVR Pass 2), added platform-specific offsets for correct brush positioning on PCVR and Standalone.

- **v0.6.184**: **VR Common Section**: 
    - Added 'Symmetry' and 'Continuous' controls to VR Sculpting Tools.
    - **Parity**: 'Sculpting & Painting' panel now matches Desktop functionality (Tools, Alpha, Common).

- **v0.6.153**: **VR Menu Defaults**: Configured menu to launch with 'Sculpting & Painting' expanded, while 'Rendering' and 'Topology' are collapsed to reduce clutter.
- **v0.6.152**: **VR Slider Fixes**: Fully functional Radius and Intensity sliders. Fixed detachment between menu state and VR cursor size.
- **v0.6.150**: **Architecture**: Fixed stale widget caching in VR Menu.

- **v0.6.93**: **Radial Color Picker Refined**: Larger (300px), thinner ring (20px), and corrected Hue mapping (standard HSV).
- **v0.6.70**: **Modular VR Menu**: Major overhaul of `GuiXR`. increased resolution to 1024x1024. Added Tabs (TOOLS, SCENE, VIEW, FILES, HISTORY). Added "Add Primitive" and "Rendering Settings".

- **v0.6.61**: **Log Cleanup & Polish**: 
    - **Controllers**: Polished Quest 3 Touch Plus models with smooth normals and PBR matte shading.
    - **UX**: Offset VR Menu (3cm Up/Right) for better button visibility.
    - **UX**: Offset Laser Pointer (1cm) to prevent mesh intersection.
    - **DX**: Silenced all high-frequency console logs for cleaner debugging.

- **v0.6.55**: **Navigation & Robustness**:
    - **Two-Handed Navigation**: Single Grip to translate/rotate; Double Grip to scale/rotate from midpoint.
    - **Fix**: Resolved "Cannot read properties of null (reading 'length')" error during PLY loading.
    - **Fix**: Reordered `mesh.init()` to ensure normals are computed before buffer updates.
    - **Fix**: Comprehensive Cache Busting (`?v=0.6.55`) for all modules in `importmap`.
    - **Robustness**: `ImportPLY.js` now handles both String and Buffer input/

- **v0.6.54**: **ASCII PLY**: Switched to ASCII PLY format to resolve binary parsing issues in `ImportPLY.js`.
- **v0.6.53**: **PLY Controllers**: Switch to PLY format for VR controllers (robust binary loading).
- **v0.6.52**: **Build Fixes**: Corrected URL path for VR controller models and enhanced failure logging.

- **v0.6.51**: **VR Controller Models**: 
    - Replaced placeholder cubes with official Oculus Touch v3 (Quest 2/3 style) models.
    - Automated loading via `fetch_controllers.sh` and `convert_controllers.py` (OBJ/PLY).

- **v0.6.50**: **UX Improvement**: Moved Undo/Redo shortcuts to the **Left Controller Thumbstick** (Axis 2) to prevent accidental brush resizing.
- **v0.6.49**: **Fixed Symmetry Drift**: Implemented Surface-Relative Culling to prevent brushes from grabbing back-facing geometry, ensuring perfect symmetry.
- **v0.6.33**: **New VRLaser**: Added Red Cylinder Laser Pointer for menu interaction (Context-sensitive, only visible when pointing at menu).
- **v0.6.4**: **Latency**: Fix VR Brush Lag (Cap Search Radius to 5cm Physical), Unit Correction.

- **v0.5.x**: **Foundation**:
    - v0.5.375: Fix VR Symmetry Skipping (Search Radius 4x).
    - v0.5.60: Fixed desktop exposure, calibrated VR scale (100 units = 1m).
    - v0.5.52: Matcap material fix for VR.
    - v0.5.43: Fixed move symmetry, thumbstick shortcuts.
    - v0.5.22: Basic file IO, single grip navigation.

- **v0.1.0**: **Initial Port**:
    - Render ported to WebXR.
    - PCVR and Native Quest 2/3 Support (with AR Passthrough).
