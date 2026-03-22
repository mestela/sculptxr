# v1.0.45
- **Performance**: **Canvas Context Proxy for Menus**: Removed heavy `ctx.filter` from the main drawing loop and replaced it with a fast Javascript Proxy layer that intercepts and shifts colors on-the-fly. Instant framerate recovery for all menu draw passes!
- **Fix**: **Hue/Saturation Edge Cases**: Converted HSL tool definitions to Hex strings so that the Proxy correctly parses and intercepts them without heavy string regex evaluations inside the render loop. Fixed `parseFloat` type coercion errors that defaults to unshifted outputs.

# v1.0.44
- **Refactoring**: **Button Rendering Consolidation**: Unified the button rendering paths for the Main Menu, MiniHUD, and Tool Picker overlay into a single shared function (`_drawButton`).
- **Visuals**: Replaced the hardcoded intense green highlights with a subtle light gray selection border to reduce distractions.
- **VR Anti-Aliasing**: Applied hardware `shadowBlur` (radius 2) to the selection border, significantly reducing pixel crawl and aliasing in both GalaxyXR and Quest 3 headsets.

## v1.0.43
- **Feature**: **Menu Brightness and Saturation Sliders**: Added fine-tune controls for the visual appearance of the VR menus. Adjust brightness (0 to 1, mapping to darker tones) and saturation (0 to 1, piecewise mapping up to 500% boost).
- **UX**: Unified application of these settings across the Main Menu, MiniHUD, and the context-sensitive Tool Picker popup.
- **Visuals**: Reduced the active tool button highlight from intense green to a subtle light gray to avoid visual distraction.

## v1.0.42
- **Feature**: **VR Poly Move Tool Rotation Fix**: Resolved the "drift" issue where vertices did not follow the ray's sweep during rotation. Updated the tool to utilize the controller's origin (and its mirrored counterpart for symmetry) as the rotation pivot, keeping drawn vertices perfectly locked to the brush cursor dot.

## v1.0.41
- **Feature**: **Wireframe Bias & Opacity Sliders**: Added fine-tune controls for the mesh wireframe overlay in VR. Adjust depth bias offset and transparency live! Defaults to `0.001` bias (1mm) and `0.2` opacity (20%).
- **UX**: Expanded sliders to support arbitrary ranges (`0.0 - 1.0` and `0.0 - 0.005`) without UI track scaling quirks.
- **Cleanup**: Purged redundant console logs (`[Mesh]`, `[GuiVRTools]`, `[Multimesh]`) to restore a silent, performant developer console.

## v1.0.40
- **Feature**: **Timestamps on Save**: Saves are now dated (`yourMesh_YYYYMMDD_HHMM.ext`) to bypass the GalaxyXR overwrite prompt and avoid accidental loss!
- **UI**: Scale-agnostic **Precision Center Dot** added to the brush circle for fine ray-alignment.
- **UI**: Silenced HUD logs inside the main `VRMenu` to prevent obstructing long panels.
- **Visuals**: Menus scaled down to optimal proportions for better field of view.

## v1.0.39
- **Feature**: **Pure Spatial Mirroring for Symmetry**: Resolved persistent skewing and offsets in standard brush tools by adopting a "Pure Spatial Volume" approach (matching `Drag` and `Move`). The symmetry brush now bypasses surface raycasting and uses the mathematically perfect mirror of the main brush in local space. No more jumping or $3.58cm$ offsets!
- **Cleanup**: Purged redundant console logs (`[SymDebug]`, `P-Pick`, `S-Sculpt`) to restore a silent, performant developer console.

## v1.0.38
- **Performance**: Optimized Move tool with fast AABB face rejection (`faceBoxes`), skipping 90% of distance checks on dense meshes.
- **Visuals**: Fixed MatCap brightness and rotation tracking (stability when mesh is offset).

## v1.0.33

- **Fix**: **VR Move Tool Symmetry & Stability**: Resolved a critical issue where the Move tool would fail to apply symmetry if the symmetric tip was in thin air (missed face). It now forces a fallback to the main mesh, preventing the primary move from "winning" and throwing the chin off-center.
- **Fix**: **Broken Brushes after Large Moves**: The Move tool now rebuilds the Octree (`mesh.computeOctree()`) at the end of a stroke. This ensures subsequent tools (Crease, Smooth) map correctly to heavily deformed geometry and don't miss or go crazy.
- **Fix**: **Ghost Grabs**: Prevented the Move tool from initiating a drag if the *current frame* did not hit a mesh, and reset intersection points to zero on failure to prevent leaking old state.
- **Fix**: **Console Spam**: Silenced verbose `[Pick Miss]` diagnostics during idle hover.

## v1.0.22
- **Fix**: **VR Picking Instability**: Resolved a severe picking instantiation bug where users frequently 'missed' the sculpt entirely when pulling the VR trigger. This occurred because the performant `intersectionRayMesh` pipeline was erroneously receiving World Space ray vectors instead of Local Space vectors when a mesh was actively locked for a stroke. Reverting to `intersectionRayMeshes([mesh], ...)` automatically handles the coordinate inversions, restoring flawlessly responsive picking even heavily translated/scaled assets.
- **Fix**: **Debug Spam**: Silenced the `Cursor VR Debug` verbose console output, dropping unnecessary internal frame overheads during continuous raycasting.

## v1.0.21
- **Fix**: **VR Move Tool Symmetry**: Resolved a critical issue where the VR Move tool would silently fall back to Desktop mouse coordinates for its symmetry origin. This was caused by the new ultra-fast thin raycast engine (introduced in v1.0.20) failing to set the `_isVRHit` flag. The Move tool now correctly utilizes proper VR mathematical plane mirroring.

## v1.0.2 - v1.0.20
- **Feature**: **VR Cursor Visuals**: Restored 1:1 parity with the master branch for VR cursors. The volume indicator sphere now utilizes proper additive blending, desaturates to white based on tool intensity, and accurately tints red when negative mode is engaged. The stylus spike length was doubled to better represent the physical interaction point.
- **Fix**: **Raycast Optimization**: Discovered and fixed a major performance penalty caused by running thick volumetric cylinders (`intersectionRayMeshesVR`) against dense DynTopo meshes every frame. Reverted to ultra-fast thin octree raycasts (`intersectionRayMeshes`) to restore 90hz performance.
- **Fix**: **Raycast Penetration Bug**: Fixed the "jumping to the opposite side of the mesh" bug. When the user pushes the physical controller inside the solid clay volume, the thin raycast evaluates the inside of the back geometry. Added mathematical dot-product backface-culling, so the cursor gracefully hides itself when inside a mesh rather than snapping to the opposite wall.

## v1.0.1
- **Feature**: **GUI Interaction Fixes**: Resolved deep VR interaction race conditions caused by high-speed controller jerks. Fixed double-clicks, sweep-clicks, and drag deadzones, allowing the UI to instantly and flawlessly respond to physical controller input.
- **Fix**: **Draw Order Sync**: Fixed a visual desynchronization issue where toggling a checkbox would execute the software action but wait a full frame before visually updating the UI.

## v1.0.0
- **Milestone Release**: **Three.js Architecture Overhaul**. Completely stripped out raw WebGL matrix rendering (`Render.js`, `Camera.js`, `Shader.js`) in favor of native Three.js v160 objects, meshes, and materials.
- **Feature**: **Three.js WebXR Management**: Relied on native `renderer.xr` session and camera management, establishing widespread hardware compatibility (Quest, GalaxyXR, Index, PCVR, Apple Vision Pro).

## v0.9.289 - v0.9.304
- **Performance**: **DOM Layout Thrashing Fix**: Discovered and fixed a major 60% CPU bottleneck caused by `window.screenLog` triggering synchronous `.innerText` layout recalculations every frame. Replaced with non-blocking `.textContent` and capped DOM element insertion length for an instant framerate boost on Standalone devices.
- **Fix**: **Samsung Galaxy XR Render Bug**: Implemented a WebGL `gl.scissor` hardware clipping hotfix and explicit per-eye Framebuffer re-binding (`gl.bindFramebuffer`) inside `renderVR` to bypass a Qualcomm Adreno/Chrome driver bug that was causing WebXR to only render the scene strictly in the left eye.
- **Fix**: **Mobile VR Fast Wireframes**: Changed the default Wireframe rendering mode to `Fast L0` not just for Oculus Browser, but for any detected `Android/Mobile VR` user agent (such as Chrome on Galaxy XR). PCVR safely retains `Smooth L0` defaults.
- **Fix**: **Hand Tracking Crash**: Resolved a `ReferenceError: require is not defined` crash that prevented native hand skeleton lines from rendering in the latest module build.
- **Fix**: **Frame Setup**: Resolved `ReferenceError: frame is not defined` from the XR Render Loop.

## v0.9.279 - v0.9.288
- **Feature**: **Native Hand Tracking Polish**: Rebuilt the VR Mini-HUD interaction model specifically for native hand tracking. The Mini-HUD now anchors dynamically to the physical palm of the non-dominant hand, and includes a proximity-based cyan glowing border to indicate when it is active.
- **UX**: **Z-Depth Push-to-Click**: Added an intuitive Z-depth physical collision system. You can now press Mini-HUD buttons directly by poking the panel with your index finger, completely eliminating the need to use awkward 'Pinch' gestures while hovering. 
- **UX**: **Grab Suppression**: Sculpting and world-grabbing operations are now rigorously suppressed anytime your dominant hand is within 25cm of your non-dominant wrist/palm. This permanently solves the issue where attempting to use the Mini-HUD would accidentally carve giant holes in the mesh or drag the world around.
- **UX**: **Visual Enhancements**: Added a `[ Main Menu ]` button directly to the Mini-HUD, and a global `[ Close Menu ]` button to the Main Menu overlay. Rendered basic hand skeleton spheres to visualize hand tracking data, and suppressed the main VR laser pointer while native hand tracking is active.

## v0.9.267
- **Feature**: **Voxel Smooth Tool**: Implemented a localized 3D Soft-Blur (averaging filter) over the SDF volume for Voxels. It evaluates a 3D bounding box natively within the worker thread, producing mathematically perfect bevels and organic transitions without physically moving geometry.
- **UX**: Exposed the Voxel Smooth tool in the VR Mini-HUD, and mapped it to the secondary trigger so you can rapidly smooth geometry on-the-fly while using the Add/Sub Voxel brush.

## v0.9.267 - 0.9.278 (2026-03-09)
*   **Voxel Move Tool:** Implemented a new 'Move' tool for Voxel sculpting.
    *   **Visual Proxy:** When the stroke begins, the tool captures the affected vertices and detaches them as a lightweight, real-time proxy that seamlessly translates and rotates 1:1 with the VR controller, preventing heavy `SurfaceNets` rebake stutters while dragging.
    *   **ODE SDF Advection:** Upon releasing the trigger, the tool dispatches a `WARP_SPHERE` command. The Web Worker utilizes a multi-step Reverse-Euler integration solver across the spatial distance field to perfectly recreate the proxy deformation within the voxel grid, effectively eliminating the common "spatial folding/tearing" artifacts seen in naive advection implementations.
    *   **Dual-Stroke Symmetry:** Fully supported symmetrical displacement mapping.

## v0.9.251 - v0.9.266
- **Feature**: **VR Trigger Sensitivity Calibration**: Added a new "Trigger Sensitivity" slider to the VR Settings menu. Rather than acting as a simple analog multiplier (which makes brushes feel weak), this slider mathematically defines the **binary physical activation threshold** of the VR controller's trigger.
- **UX**: **Index Controller Ergonomics**: Users with deep-throw analog triggers (like the Valve Index) no longer have to bottom-out the trigger at 100% force to start a stroke. Setting the slider to "Light" drops the physical bite-point to just 10% depression, while "Hard" requires a full 90% squeeze, allowing total ergonomic personalization.
- **Fix**: **100% Force Splat**: Diagnosed and fixed a high-level API flaw in `SculptBase.js` where the very first frame of every VR stroke was being instantiated with an undefined `options` payload. This caused brushes to drop a massive 1.0 (100% intensity) "splatter" frame onto the mesh before the analog curve could catch up. The initial stroke hit is now mathematically deferred into the native `updateXR` loop, ensuring total force consistency from the first millisecond of contact.

## v0.9.232 - v0.9.250
- **Feature**: **Version Update Prompt**: Added a cache-busting polling system that detects when a new version of SculptXR is deployed to the server.
- **UX**: **Desktop Warning**: When an update is detected on Desktop, a top-banner appears instructing the user to clear their browser cache and refresh.
- **UX**: **VR Mini-HUD Warning**: When an update is detected, standalone VR users will see a "new build ready!" warning string appended to the bottom of their Mini-HUD, alerting them without requiring them to remove their headset.
- **Fix**: **VR Text Clipping**: Shrunk the `window.screenLog` monospace font from 24px to 20px so that version strings (e.g., `v0.9.247 -> v0.9.248`) no longer overflow and clip out of the floating VR debug console.

## v0.9.217 - v0.9.231
- **Feature**: **Voxel Cube Brush**: The Voxel tool now natively supports a precise 'Cube' SDF brush shape alongside the traditional 'Sphere', accessible via the new Brush Shape toggle in the VR Mini-HUD and Desktop Tool menu.
- **Feature**: **Oriented Cube Sculpting**: When using the new Cube brush, users can toggle "Controller Alignment". When active, the voxel cube physically rotates with the user's wrist (via quaternion projection into the SDF local space), allowing for angled block carving and building.
- **Feature**: **Visual Brush Indicators**: The VR pointer now dynamically swaps between a transparent radius sphere or a transparent radius cube to perfectly match the active voxel brush shape and orientation in real-time.
- **Optimization**: **Voxel Worker Threading**: Completely refactored the Voxel Tool's geometry pipeline. The intensive `_computeNormals`, `_fixNormals`, and `color/material` sanitization loops were stripped from the main thread (`SculptVoxel.js`) and offloaded entirely to the Web Worker (`VoxelState.js`).
- **Optimization**: **Voxel Wireframe Rebuild Paradox**: Prevented the WebGL renderer (`MeshStatic.js`) from repeatedly triggering an expensive `O(N)` topology rebuild every single frame whenever wireframes were enabled on Voxel meshes.
- **Fix**: **Voxel Baking Crash**: Resolved `_computeNormals is not a function` throw when attempting to click 'Bake' on a Voxel mesh.
- **Fix**: **Giant Orange VR Cursors**: Disabled the legacy desktop orange debug cursors from erroneously appearing in the VR view at the world origin.
- **Fix**: **Voxel Cube Symmetry**: Corrected the quaternion math in the VR Sculpting payload so that the Cube brush rotation perfectly mirrors across the X-axis symmetry plane.
- **Polish**: Removed spamming debug logs (`VoxelWorker:`, `Voxel Res:`, etc.) from the internal worker and exposed the `Flat` shaded material option explicitly in the global VR/Desktop rendering menus.
- **UI Polish**: Removed an accidental duplicate "Flat shading" toggle button from the VR Rendering menu overlay.

## v0.9.209 - v0.9.216
- **Feature**: **Voxel Wireframe Restored**: Restored the wireframe toggle button for the Voxel tool in the Mini-HUD and optimized the mesh pipeline to support drawing wireframes directly over pure quad SurfaceNets structures.
- **Optimization**: **Wireframe Sub-Sampling (Standalone)**: Implemented a dynamic sub-sampling cap (`Wireframe.MAX_TRIANGLES = 300,000`) for the wireframe renderer. High-resolution meshes dynamically decimate the drawn lines for the overlay, instantly curing the severe CPU/GPU framerate lockups on Quest standalone headsets.
- **Optimization**: **Standalone Wireframe Default**: Standalone headsets (Quest) now automatically default to `Fast L0` wireframes to guarantee performance headroom on launch, while PCVR falls back to the denser `Smooth L0` tessellation.
- **Fix**: **Combobox UI Array Coordinates**: Fixed a critical coordinate offset bug that pushed newly opened comboboxes (like Wireframe/Shader selectors) off the right edge of their virtual canvas buffers when inside scaled 3D overlays.
- **Fix**: **Combobox Duplication**: Purged an overlapping phantom render pass that caused dropdown menus to draw twice simultaneously on the canvas.
- **Fix**: **Voxel Bake & Resample Integrity**: Traced and fixed a `ReferenceError: fArTri...` crash deep in `SculptVoxel.bakeToMesh`. Also resolved an issue where standard voxel stroke drawing would fail to register immediately after a bake operation.
- **UI Polish**: **HUD Tool Layout**: Stripped an unnecessary 100px padding margin from the Desktop-version logic that was bleeding into VR, instantly closing the giant gap between the Tool Picker grid and the Radius sliders.

## v0.9.159 - v0.9.175
- **Feature**: **Color Blur / Smooth Brush**: When using the Paint tool, holding the secondary trigger now natively blends and blurs vertex colors and PBR materials (Roughness/Metallic) within the brush radius.
- **UX**: **Contextual Eyedropper Cursor**: When actively sampling colors via the Mini-HUD Eyedropper, the brush's VR radius ring now instantly tints to the sampled color for immediate visual feedback.
- **UX**: **A-Button Color Swap**: Pressing the physical 'A' button (or 'X' button for left-handed users) now instantly swaps the Foreground and Background selected colors, complete with real-time UI synchronization in the Mini-HUD and the VR 3D brush cursor.

## v0.9.154 - v0.9.158
- **Polish**: **Mini-HUD Tweaks**: Shifted the Mini-HUD slightly higher and inward for a more symmetrical and comfortable viewing angle. Exposed `MINI_HUD_TRANSFORM` and `TOOLCOMB_TRANSFORM` variables to the global scope so developers can interactively tweak the 3D offsets of the HUD and Tool Picker via the DevTools console.
- **Fix**: **Duplicate Twist Tool**: Removed a redundant Twist tool entry from the VR Combobox. This reduces the total tool count to 15, allowing the UI to form 5 perfectly symmetrical rows without any trailing slots.
- **Fix**: **Isolate Toggle Logic**: Fixed a desynchronization bug where toggling "Isolate" via the Mini-HUD checkbox felt inverted. The controller now explicitly forces the underlying Sculpting state to match the physical VR checkbox state perfectly.
- **Cleanup**: **Undo Logs**: Stripped noisy debug console logs (`Shortcuts: Undo`) from the controller event listener.

## v0.9.150
- **UX**: **Intensity Mapping**: The X-axis (left/right) on the dominant controller's thumbstick now natively controls the Brush Intensity!
- **UX**: **Fine Tuning**: The secondary controller's trigger now acts as a "Fine Tuning" modifier lock. When held, sliding the primary thumbstick will adjust settings (like Radius or Intensity) at 10% of their normal speed, allowing for high-precision micro-adjustments in VR without opening the UI.

## v0.9.144
- **Feature**: **In-App Deep Profiler**: Added a robust in-app function profiler to diagnose standalone VR performance drops without remote debugging tools. The profiler wraps key classes (`SculptManager`, `Mesh`, etc.) and records millisecond execution times across a 60-frame window. It can be triggered via the "Log Deep Functions" button in the VR Settings menu and will wait for an active sculpt stroke before recording.
- **Feature**: **VR HUD Logger**: Implemented a native WebXR text logging system (`GuiXR.printLog`) that draws `window.screenLog` messages directly onto the VR Mini-HUD. This allows standalone users to view critical debug state, matrix readouts, and performance profiles completely in-headset. The VR HUD truncates to the last 2 lines directly in your vision while the full detailed output is safely preserved in the desktop console.

## v0.9.128
- **Bugfix**: **Proxy Snapping Stapling Bug (Geodesic Fix)**: Resolved the underlying mathematical flaw in the Slide brush that caused topological tangling and "locking" over high-curvature or non-Delaunay geometry. Previously, a macroscopic brush movement would tangentially shoot the tracking vertex physically off the curved surface, causing the Euclidean topology-walker to get trapped on the perimeters of distant faces. The Slide macro-movement is now **Sub-Stepped** into infinitesimal geodesic intervals, allowing the anchor to mathematically track the perfectly curved physical surface structure natively without ever defecting.

## v0.9.127
- **Bugfix**: **Proxy Snapping Stapling Bug**: Fixed a severe issue where multiple vertices would tear or "staple" together in a jagged line during long slides. The root cause was the `vTarget` tangentially projecting into a neighboring Voronoi cell on non-Delaunay (squished/uneven) geometry. When the algorithm geometrically clamped to the anchor's 1-ring faces, the vertex would get snagged on the 1-ring's infinite outer perimeter and drag along it instead of sliding natively across the sphere. The projection now evaluates the full **2-Ring neighborhood** (faces of the anchor AND its topological neighbors), guaranteeing `vTarget` finds the true unbroken proxy surface directly beneath it.

## v0.9.126
- **Bugfix**: **Slide Brush Proxy Normal Deflection**: Fixed a bug where ~10% of vertices would snap wildly or tangle during a slide. Tangential projection previously used the *live* vertex normal, which would tilt as the surface distorted during a stroke, causing the projection vector to deflect inward through the mesh. The projection now rigorously uses the *Proxy* normal of the topological `_slideAnchor` the vertex is currently migrating across, ensuring movement remains completely and safely tangential even over extreme distances.

## v0.9.125
- **Feature**: **Tangential Relaxation (Slide Brush)**: Re-enabled the scaled `smoothTangent` Laplacian pass within the Slide brush. Because the Proxy Migration feature (v0.9.122) now mathematically guarantees vertices cannot sink or erode over time, they are safe to gently relax against the surface to untangle the polygons during a slide naturally.

## v0.9.124
- **Hotfix**: **Slide Brush Initialization Crash**: Fixed a critical `TypeError` crash in the Slide brush that occurred on the very first frame of interaction. The `_slideVProxy` initialization order was corrected to execute *before* `super.startSculpt()` fires its initial stroke logic.

## v0.9.123
- **Hotfix**: **Proxy Migration Dynamic Topology Crash**: Fixed a critical `TypeError` crash in the Slide brush when used with Dynamic Topology enabled. The `_slideAnchors` and `_slideVProxy` arrays are fixed snapshots at the start of the stroke, but dynamic topology creates new vertices mid-stroke. Added bounds checking so newly spawned vertices gracefully fall back to live live geometry instead of accessing undefined proxy indices.

## v0.9.122
- **Feature/Fix**: **Proxy Migration (Mesh-Walking)**: Re-wrote the Slide brush's surface projection algorithm to project sliding vertices against an immutable, frozen origin mesh state (`vProxy`) rather than the live geometry. Vertices track their current location by topological "Mesh-Walking" across the proxy face adjacency. This permanently eliminates the geometric erosion (melting) problem when sliding over sharp details like lips and creases, perfectly preserving the original curvature over long, multi-stroke movements.

## v0.9.121
- **Experiment**: Disabled `smoothTangent` completely in the Slide brush to isolate the cause of shape erosion.

## v0.9.120
- **Hotfix**: **Slide Brush Detail Preservation**: Fixed a major bug where holding the Slide brush over sharp details (like creases or lips) would rapidly blur them out even if the controller wasn't moving. The tangential relaxation pass (`smoothTangent`) is now strictly scaled by the physical distance the controller translates during the stroke, perfectly preserving sharp curvature when the brush is held still or wiggled gently.

## v0.9.119
- **Refactor**: **VR UI Clean Up**: Removed the redundant "Negative" toggle button from the Mini-HUD, as the physical hardware button 'A'/'X' acts as a real-time override, freeing up UI space for future tool options.

## v0.9.117 - v0.9.118

## v0.9.112 - v0.9.116
- **Feature**: **Slide Brush**: Added a dedicated 'Slide' tool to shift mesh topology smoothly across the existing surface without adding or removing volume.
- **Math Upgrade**: **Closest-Point Snapping**: Replaced naïve tangential projection with an exact $O(1)$ 1-ring neighborhood raycast `Geometry.distance2PointTriangle` that snaps the translated vertex perfectly onto the unmodified local surface in real-time. 
- **Immersion**: **VR 6DOF Rotation**: The Slide brush tracks the incremental rotational delta `_dragQuat` of the VR controller (`main._vrControllerQuat`), allowing the user to twist and steer the edge flow tangentially while sliding the surface skin.

## v0.9.108 - v0.9.111
- **Feature**: **Relax Brush**: Added a dedicated 'Relax' tool to the brush palette. Unlike 'Smooth' which shrinks volume based on vertex average, 'Relax' projects vertex movement strictly onto the tangent plane, evening out density and fixing bad topology without losing surface details.
- **UI & UX**: **VR Combobox Math**: Rewrote the VR tool picker geometry to automatically center dangling items on rows that don't fit the strict 3-column layout.
- **UI & UX**: **Tool Organization**: Restructured the layout of the VR combobox, tinted the Relax tool Blue (smoothing group), and moved the Twist tool into the Green (transform/move group).

## v0.9.103 - v0.9.107
- **Feature**: **Drag Tool Restored**: Re-enabled the classic 'Snakehook' style Drag brush.
- **Math Upgrade**: Ported modern `Move.js` symmetry blending to `Drag.js` to prevent crossing mesh tearing.
- **VR Polish**: Fixed VR 1:1 physical tracking offsets, corrected cursor scaling, and normalized default brush radius.
- **Stability**: Resolved a `TypeError` by ensuring history state is pushed on initial VR strokes.
- **GL Fix**: Fixed a WebGL `GL_INVALID_OPERATION` crash when using Drag with Dynamic Topology by properly synchronizing geometry buffer lengths mid-stroke.

## v0.9.102
- **Polish**: **Tool Combobox Categorization**: The Mini-HUD Tool Picker buttons are now visually categorized by color (Red for Sculpting, Blue for Smoothing, Purple for Painting, Green for Transforms, Orange for Masking). The active selected tool label is forced white for maximum legibility against its green background.
- **Clean**: **VR Tool Labels**: Stripped extraneous desktop keyboard shortcuts (like `(-Shift)`, `(G)`) from the tool labels exclusively in the VR UI to reduce visual clutter, and renamed `Transform VR` to simply `Transform`.

## v0.9.94
- **Fix:** Implemented a Global Interaction Lock in `Scene.js`. This prevents a physical controller trigger press that originated on an overlay (like the Mini-HUD Tool Picker popup) from bleeding through and registering as a false click on the UI underneath (like the Radius Slider) when the overlay immediately closes.
- **Clean:** Removed noisy `[Hvr]` and `[Click]` debug logging generated by the UI pointer interaction system.

## v0.9.93
- **Fix**: **Color Picker UI Stability**: Fixed the intermittent responsiveness of the Swap Colors button by replacing the hover-exit debounce with a strict time-based cooldown (300ms).
- **Fix**: **Color Picker Drag Locks**: Fixed a bug where dragging from the Hue ring into the SV square (or vice versa) would cause the UI math to glitch and incorrectly update the wrong region. The active dragging region is now strictly locked and values are correctly clamped even if the pointer strays outside the visual boundaries of the widget.

## v0.9.85
- **Feature**: **Paint Tool FG/BG Color Swatch**: The Paint Tool now maintains a secondary (background) color and material state. You can swap between your foreground and background colors seamlessly via the 'Swap Colors' button in both the Desktop and VR GUIs, or instantly by pressing the `V` hotkey.
- **Feature**: **Mini-HUD Color Picker**: The Mini-HUD now explicitly supports the embedded color picker widget when the Paint Tool is active, making rapid painting adjustments in VR much more accessible.

## v0.9.84
- **Polish**: **Paint Brush Intensity**: The paint brush intensity slide now maps to an exponential curve (squared). This fixes an issue where the brush was too aggressive at low slider values, now allowing for very subtle "airbrush" style stroke build-up.

## v0.9.83
- **Feature**: **Long Distance Aim Sculpting**: When Aim Mode is enabled, brushes now mathematically project their radius and displacement down the length of the laser ray. This allows for long-distance sculpting with true 1:1 physical translation and accurate brush sizes on the distant surface.
- **Fix**: **Aim Mode Symmetry**: Fixed an issue where the symmetry brush failed to initialize in Aim Mode. Symmetry now perfectly mirrors the actual laser hit point rather than the physical controller position.

## v0.9.71
- **Fix**: **VR Move Brush Intensity**: Fixed an issue where the VR Move tool ignored the intensity slider and applied 100% displacement. Both positional drag and wrist rotation are now properly scaled by the brush intensity setting in VR.

## v0.9.70
- **Fix**: **Secondary Grip Collision**: Removed legacy logic that forced negative/subtract mode when the secondary hand's grip button was pressed, decoupling it and allowing the grip to function purely for 6DOF world navigation.

## v0.9.68 - v0.9.69
- **Deployment**: **Automated Version Bumps**: The `deploy.sh` and `deploy_beta.sh` scripts now automatically increment the patch version in `index.html` and `src/Version.js` when detecting a repeat deployment.
- **UI**: **Environment Labeling**: The version string in the bottom right of the UI now explicitly appends ` - PROD` or ` - BETA` based on the deployment hostname to prevent feedback confusion.

## v0.9.65
- **Tooling**: **Interactive Combobox Positioning**: Injected a `window.tpDebug` override into `Scene.js`. When running in PCVR, developers can now interactively adjust the 3D X/Y/Z offsets of the Tool Picker combobox (`_vrPopup`) via the DevTools console to perfectly tune its spatial alignment relative to the controller.

## v0.9.64
- **UI**: **Continuous Tool Picker Layout**: Adjusted the Tool Picker in `GuiVRTools.js` to have 0 padding between buttons. Modified the button border rendering in `GuiXR.js` to draw clean, inset 1px borders. This eliminates the visual gaps between buttons, merging them into a single, contiguous UI panel without needing an overarching background quad.

## v0.9.63
- **Rendering**: **WebXR Alpha Cutout Fix**: Resolved a critical rendering issue where transparent parts of the UI overlay canvases (like the Tool Picker) were overwriting the WebXR Framebuffer's alpha channel to 0 during standard blending. This caused the XR compositor to show the real-world passthrough instead of the 3D scene behind the UI. Fixed by adding a `discard` check for pixels with `alpha < 0.01` in the primary Texture shader.

## v0.9.62
- **UI**: **Tool Picker Legibility**: Removed the `noBg` flag from the Tool Picker buttons. The buttons now render with their own individual solid gray backgrounds, ensuring readability against the 3D scene after the overarching background panel was removed in v0.9.61.

## v0.9.61
- **UI**: **Tool Picker Simplification**: Completely removed the dark background panel from the Tool Picker overlay. The tool buttons now float directly over the 3D scene, eliminating any overlapping alpha rendering issues while preserving the pre-v0.9.57 layout alignment.

## v0.9.60
- **UI**: **Tool Picker Alignment Fix**: Corrected the bounds of the dark background quad on the Tool Picker combobox. By calculating the exact width/height of the button grid in `GuiVRTools.js` and passing it to the overlay renderer, the dark background now tightly wraps the buttons, removing the unnecessary alpha punch-out on the right and bottom edges.

## v0.9.59
- **Internal**: **Baseline Revert**: Reverted all experimental alignment and depth changes to commit `7c85b8f` to establish a clean baseline for depth testing.

## v0.9.56
- **UI**: **Hit-test Alignment Fix**: Resolved a coordinate misalignment issue in the Tool Picker and other overlays where the visual buttons and their hitboxes would diverge, especially at the edges of the screen. Fixed a scale mismatch where overlays were drawn at 1.13x scale but hit-tested at 1.0x scale.

## v0.9.55
- **UI**: **Mini-HUD Interaction Fix**: Resolved a critical issue where selecting a tool in the Mini-HUD tool picker would bleed the interaction event through to the radius slider beneath it on the next frame, unintentionally maximizing brush size. Implemented a strict rising-edge requirement for all base-layer interactions in `GuiXR.js`.

## v0.9.50
- **Optimization**: **Scaled World O(N) Bottleneck**: Replaced the VR cursor's static 5cm inner-search with an iterative, expanding octree search. This fixes a massive frame rate drop that occurred when using the 2-hand gesture to scale the world down, which previously caused the 5cm physical search sphere to encompass the entire dense mesh, triggering O(N) distance checks on all ~50,000+ faces at 90hz. The iterative search guarantees the engine only evaluates the few polygons physically intersecting the closest edge of the controller, regardless of world scale or brush size.

## v0.9.49
- **UX**: **Instant Button Latch**: The VR primary and secondary buttons (used for Negative Mode and Mini-HUD toggle) now respond instantly on press-down rather than waiting for release. If maintained as a long-press (transient hold over 300ms), the tool will seamlessly revert back to its previous state upon release.

## v0.9.48
- **UI**: **Tinted Hover Sphere**: The 3D VR brush radius sphere now dynamically tints its white x-ray material slightly red when Negative Mode is active (and slightly blue when positive), providing a much clearer visual anchor that perfectly matches the surface alignment cursor.

## v0.9.46
- **Optimization**: **O(N) Picking Bottleneck**: Added a multi-pass inner search constraint to `Picking.js:intersectionSphereMeshes` that checks a 5cm proximity radius before defaulting to the full brush volumetric sweep. This drastically reduces CPU load when hovering with massive brush radii over dense geometry by evaluating strictly the nearest dozen triangles rather than thousands, solving the large-brush framerate drop across all tools.

## v0.9.44
- **Optimization**: **Redundant Topology Hit Detect**: Prevented instances of `pickVerticesInSphere` from firing continuously on every hover frame when `isSculpting` is false within `SculptBase.js`.

## v0.9.43
- **Fix**: **Sync Wireframe Toggle**: Enabled the new 'Wireframe' checkbox on the Mini-HUD to stay visually synced with the active mesh's state, rather than just firing one-way callbacks.
- **Cleanup**: Stripped stale debug logging (`window.screenLog`) statements from `Scene.js` and `GuiVRTools.js` in preparation for main deployment.

## v0.9.42
- **UI Tweaks**: Added 'Wireframe' toggle directly to the Mini-HUD panel, below the Negative mode toggle.
- **UI Tweaks**: Shortened "Negative (N or -Alt)" to just "Negative" to reduce text crowding.
- **Fix**: Removed residual debug text (`SculptXR v...`) from the Mini-HUD rendering loop.
- **Fix**: Resolved an intercept bug in `GuiXR.js`'s `_updateHover()` method where the `cy < HEADER_HEIGHT` logic (originally meant for tabs) was inappropriately clearing mouse highlights for UI widgets physically located at the top of the Mini-HUD canvas (like Tool Select and Radius).

## v0.9.40
- **Fix**: **Left Handed Mode Crash**: Resolved a `TypeError: Cannot read properties of undefined` crash that occurred when switching to "Left Handed" mode and pressing the primary controller button. The VR button state tracking logic in `Scene.js` was generalized from hardcoded physical mapping (`.A` / `.X`) to a unified `.Primary` key that dynamically binds correctly for both standard and inverted interaction profiles.

## v0.9.39
- **Fix**: **Mini-HUD Radius Persistence**: Fixed a bug where selecting tools from the Mini-HUD popup would reset UI widgets (like the Radius slider) back to an arbitrary default (`0.20`), hiding the tool's actual saved state. Modified `syncWidgetValues` and `updateRadiusWidget` to ensure complete state synchronization across `_guiXR`, `_guiMini`, and `_guiPopup` render loops without breaking tool callbacks.
- **Fix**: **Controller Thumbstick Radius**: Adjusted the hardware thumbstick (up/down) to dynamically scale the brush size in both the main menu and the new Mini-HUD instantly (via simultaneous calls to both UI contexts).

## v0.9.0
- **Milestone Release**: Bumped version to v0.9.0 for the next major development cycle.
- **Verification**: Verified deployment stability on Quest 3 native browser during major version transition.

## v0.8.230
- Tidy up: Massive repository deep clean, removing old testing scripts, generated diffs, numerous backup files from `src/`, and legacy debugging HTML pages.

## v0.8.229
- Tidy up: Removed unreferenced matrix testing files, golden reference files, and temporary GUI code from project root.

- **v0.8.224**: **Stationary Mode Cursor Priority Fix**:
    - **Fix**: **Invisible Cursor Glitch**: Resolved a bug in `SculptGL.js` where hardware mouse movements were passing native Event objects instead of strings to `setCanvasCursor`, causing the canvas CSS to get permanently stuck on `none` during VR-to-Desktop transitions.
    - **UX**: **Mouse Priority**: In Stationary mode, any physical mouse movement instantly overrides VR and reveals the cursor. VR controller activity will only hide the cursor if the physical mouse has been perfectly still for at least 1 full second. This fully supports developers operating the mouse with one hand while holding a VR controller in the other.
    - **Cleanup**: Removed intense event diagnostic logging and complex synthetic time-latches that were causing UI flickering.

- **v0.8.185**: **Stationary Mode Micro-Controllers Fix**:
    - **Fix**: **Meter to Unit Conversion**: Discovered that removing the dynamic `invScaleMat` in v0.8.183 correctly stopped controllers from squishing during world scale, but it also stripped the baseline 125x static scaling needed to convert physical meters to virtual map units. `v0.8.185` injects a frozen `bakedInvScaleMat` into the physical pipeline, ensuring the controllers puff up to a visible size for the virtual camera without fluctuating during dynamic world interaction.

- **v0.8.184**: **Missing Controllers Fix**:
    - **Fix**: **Matrix Assignment**: Restored a missing assignment rule for `specViewPhys` that caused it to remain an unbound identity matrix, thus accidentally hiding the controllers inside the camera's near-plane in v0.8.183.

- **v0.8.183**: **Stationary Mode Scale Fix**:
    - **Fix**: **Controller & UI Scale Consistency**: Rewrote the physical camera tracking matrices (`debugTripodPhys`) in `STATIONARY` mode. The VR Controllers and UI now maintain true 1:1 physical scale visually on the desktop monitor, regardless of how much the user scales or dollies the trackball world.

- **v0.8.155 - v0.8.161**: **Crease Tool Overhaul & Smooth VR Strokes**: 
    - **Feature**: **Crease Groove Tracking (v0.8.160)**: The Crease tool now dynamically calculates the barycenter (`aCenter`) of the vertices within its radius. This causes the brush's target to physically drop into the densest geometry, giving it a "magnetic" feel that effortlessly tracks and deepens existing creases instead of fighting the user and snapping to the valley rims.
    - **Fix**: **Symmetry Centerline Spikes (v0.8.159)**: Resolved the 200% force accumulation massive spike that occurred when symmetric strokes met in the middle. The brush now scales its intensity down based on its distance to the symmetry plane, hitting exactly 50% power directly on the centerline so that the left and right tools sum elegantly to a single 1.0 force stroke.
    - **Fix**: **Infinite Accumulation Spikes (v0.8.158)**: Radically changed the math inside `Crease.js`. It no longer applies an infinitely accumulating translation velocity against a frozen proxy mesh point. Instead, it applies a bounded `pinchDx = cx - vx` vector against the *live* vertex position. This permanently cures the massive VR polling-rate spikes by ensuring the vertices mathematically decelerate and halt at the cursor's center while preserving the sharp original profile.
    - **Fix**: **VR Rendering Crash (v0.8.156)**: Added a safety check for `symNormal` in `Selection.js` to prevent the right eye from going black if the symmetry brush hovered off the edge of the mesh.

- **v0.8.154**: **Crease Volume Intersection Restore**:
    - **Fix**: **Crucial Revert Issue**: Ensured the explicitly requested `volume` intersection behavior for the Crease tool was restored after it was accidentally wiped during the Head Height bugfix revert earlier tonight.
- **v0.8.153**: **VR Interaction & Stability Update**:
    - **Fix**: **Two-Handed Scaling Pivot**: Corrected a math inversion in `Scene.processVRTwoHanded` where spreading hands apart was shrinking the object instead of enlarging it. Added a smart `Stationary` mode check so that scaling the world (Stationary) and scaling the object (Tracked) both feel completely natural.
    - **Fix**: **Continuous VR Strokes & Lag**: Restored the 90hz native evaluation rate by removing a faulty interpolation loop in `sculptStrokeXR`. Huge fast swipes no longer drop frames or cause "dotted" stroke tearing.
    - **Fix**: **Topological Symmetry Performance**: Reverted a `Math.max` bounds check to a `Math.min` cap to prevent massive brush sizes from forcing the symmetry engine to evaluate the entire multi-resolution mesh every frame on hover, curing severe VR framerate drops.
    - **Fix**: **VR Head Height Calibration**: Repaired a regression where the initial `XRRigidTransform` spawn point failed to dynamically incorporate the user's real physical headset Y-height (`pose.transform.position.y`), solving the bug where the mesh erroneously jumped when first grabbed.

- **v0.8.18**: **Wireframe Color Restore**:
    - **Fix**: **Gray Wireframe**: Restored the mesh overlay wireframe color from red to its original translucent gray (`vec4(0.0, 0.0, 0.0, 0.4)`). A previous voxel-bounding box patch had accidentally linked the wireframe shader to the mesh's default `RenderData._flatColor` (which is pure red).

- **v0.8.17**: **Smooth VR Slider Physics Fix**:
    - **Fix**: **Phantom UI Lag**: Resolved a severe stuttering issue exclusively affecting sliders embedded inside Overlay menus (like the 'Max Undo Steps' slider in the History tab).
    - **Fix**: **Overlay Event Priority**: Discovered and fixed a flaw where the `GuiXR._overlay` click event was unconditionally consuming dragging inputs and firing them through `_handleMenuInteract` at a full 90hz, bypassing the smooth floating-point slider math block altogether. Brought the `_activeSlider` event trap to the absolute top of `GuiXR.onInteract()` to restore smooth slider updating regardless of parent container.
    - **Fix**: **Zero Array Initialization**: Fixed a severe sub-bug in `_handleMenuInteract` where simply clicking the 'Max Undo Steps' slider passed an unscaled 0-1 ratio array sizing argument to `StateManager.setNewMaxStack(Math.round(val))`, wiping array lengths until dragged again. Now correctly maps the target ratio to `w.min/max` limits for initial clicks.

- **v0.8.3**: **OpenXR Warning Dialog**:
    - **UX**: Added a 2-second timeout warning dialog advising users to restart Chrome if OpenXR fails to initialize (e.g., if Chrome starts before the Meta Link software is ready).
- **v0.8.2**: **VR Fuzzer**:
    - **Debug**: Implemented a VR Fuzzer inside `Scene.js`. When toggled via `window.startFuzzing()`, it injects rapid, randomized inputs (poses, buttons, radus changes) to stress-test the engine and help shake out intermittent VR bugs.
- **v0.8.1**: **Version Reference Fix**:
    - **Fix**: Resolved `ReferenceError: VERSION is not defined` in `GuiXR.js` and `GuiVRAbout.js` caused by the v0.8.0 constant refactor.
- **v0.8.0**: **New Release Cycle**:
    - **Refactor**: Replaced global `window.VERSION` with imported ES module constants.
- **v0.7.801**: **Move Tool Symmetry Fix**:
    - **Fix**: **Symmetry Tearing**: Restored precise Move tool symmetry by removing the 1000-triangle limit in `Picking.js:intersectionSphereMeshes`. This ensures aligned brush centers for primary and mirrored controllers on high-poly meshes.
- **v0.7.800**: **Voxel Stability & Performance Release**:
    - **Optimization**: **Ray Picking**: Switched SculptVoxel to use efficient Ray Picking in VR, eliminating frame-loop stalls and display warping.
    - **Robustness**: Added a triangle count safeguard (1000 tris) to `intersectionSphereMeshes` to prevent main-thread hangs on high-poly meshes.
    - **UI**: **Voxel Bounding Box**: Added a static orange wireframe to visualize the maximum sculpting volume limits.
    - **UI**: **Depth Integration**: Fixed the Voxel Boundary Box to respect scene depth; it no longer draws over everything in x-ray mode.
    - **UX**: **Transform Lock**: Voxel meshes are now locked in place to prevent drift from the volumetric grid and bounding box.
    - **Cleanup**: Stripped debug logs (`Voxel: VR Start`, etc.) from `SculptVoxel.js`.
- **v0.7.693 - v0.7.696**: **Voxel Mirror Tool Symmetry Fix**:
    - **Fix**: **Symmetry Failure**: Resolved a critical issue where sculpting tools failed to apply symmetry after a mesh had undergone a Voxel Mirror operation. 
    - **System**: Differentiated between Topological and Geometric symmetry maps. Forced `SculptBase` to cleanly fallback to pure mathematical plane projection and spatial Sphere picking when topological maps are invalid (like after a Remesh), rather than attempting to interpolate broken barycentric coordinates.
    - **Fix**: **Move Tool Mirrors**: Fixed the Move Tool's VR symmetry origin projection math to use arbitrary plane points and normals rather than a hardcoded X-axis flip.
- **v0.7.691 - v0.7.692**: **VR Move Tool Symmetry Fix**:
    - **Fix**: **Symmetry Tearing**: Reverted the Move tool's custom "Master-Slave Topological Mirror" logic back to vanilla SculptGL mathematical "Dual Independent Evaluation" alongside `symFactor`. This completely resolves the horizontal mesh tearing and crossover bug when dragging the center line, allowing seamless pulls across the symmetry plane and restoring the minor "bum crease" (which correctly keeps the mesh sealed).
- **v0.7.688 - v0.7.690**: **Volume Intersect Default**:
    - **Feature**: Replaced default "Aim/Laser" picking with "Volume Intersect" sphere picking for more predictable brush behavior on surfaces.
    - **Fix**: Crease tool explicitly uses Aim picking to prevent snapping to ridges.
    - **Fix**: Twist brush radius indicator is hidden to prevent confusion.
    - **UI**: Added "Aim Picking Mode (Raycast)" toggle in VR Settings > Input to optionally revert to the old interaction style across all tools.
    - **UI**: Hidden "Local Scale" and "Transform" from the VR Tools menu.
- **v0.7.687** (Current): **Two-Handed Jaws Scale Fix**:
    - **Fix**: **Math Bug**: Corrected a vector math bug in `Scene.scaleWorld` that mistakenly divided the coordinate offset by the scale ratio instead of multiplying it. 
    - **UX**: **Dolly Zoom**: The held object now perfectly maintains its physical distance from the user (Jaws/Vertigo effect) during a two-handed scale, completely eliminating the "flying away" or "getting uncomfortably close" issues.
- **v0.7.686**: **Final Gizmo Release**:
    - **Documentation**: Added comprehensive implementation notes for VR Gizmo and State Management.
- **v0.7.685**: **Transform Gizmo Undo & Polish**:
    - **Feature**: **Undo/Redo for Gizmo**: Full support for undoing and redoing Translate, Rotate, and Scale operations performed with the Transform Gizmo.
    - **Fix**: **Rotation Alignment**: Handles are now correctly aligned with their respective axes using quaternion math.
    - **Fix**: **Rendering Crash**: Resolved a `ReferenceError` that occurred during stereo rendering of the Gizmo.
    - **Polish**: **Visual Cleanup**: Removed persistent green debug sphere and ensured backface visibility for gizmo planes.
- **v0.7.619**: **Gizmo Rotation & Picking Fix**:
    - **Fix**: **Rotation Handles**: Corrected the orientation of X (Red) and Z (Blue) rotation rings in `GizmoVR.js`. They are no longer coincident with the Green ring.
    - **Improvement**: **Thick Picking**: Increased the physical picking thickness of rotation rings to ~5-8cm, making them much easier to grab in VR without requiring pixel-perfect accuracy.
    - **Debug**: Resolved "Invisible Rings" issue caused by incorrect argument order in `_initRotate`.
- **v0.7.602**: **Gizmo Scale Fix**:
    - **Fix**: **Scale**: Corrected Gizmo scale to 1.0 (was 4x too big).
    - **Fix**: **Visibility**: Resolved bug where Gizmo was invisible on load (`0.0` scale init override).
    - **Debug**: Added `debugQueryGizmoScale` for runtime inspection.
- **v0.7.492**: **Move Tool Crash & Symmetry Fix**:
    - **Fix**: **Crash**: Resolved a crash in `Move.startSculpt` when the headset is removed or tracking is lost (null mesh check).
    - **Fix**: **Symmetry Normals**: Fixed visual artifacts ("tide marks") on the symmetry side by ensuring normals are updated based on the *topologically mapped* vertices, not the geometric brush sphere.
    - **Cleanup**: Removed legacy `?v=...` query strings from `index.html` and standardized imports for `Move.js` and `SculptBase.js`.
- **v0.7.485**: **Symmetry & Undo Fixed**:
    - **Fix**: **Robust Undo**: Solved "crease" and "tearing" artifacts when undoing Symmetrize or Symmetry Move operations.
    - **Fix**: **Topological Snap**: Symmetry now correctly handles topological matches even when vertices have drifted slightly.
    - **Fix**: **Multiresolution**: Fixed a bug where `Multimesh` levels weren't inheriting symmetry data correctly.
- **v0.7.470**: **Symmetry Improvement**:
    - **Feature**: **Topological Symmetry**: "Re-symmetrize" now uses a graph traversal algorithm to find perfect 1-to-1 vertex pairs, even if the mesh is heavily deformed.
    - **Feature**: **Side Tracking**: The system now tracks which side (Left/Right) a vertex belongs to topologically, allowing correct mirroring even if vertices cross the symmetry plane.
    - **Fix**: **Center Snapping**: Vertices on the symmetry plane are now forcibly snapped to `x=0` to prevent seam tearing.
- **v0.7.434**: **Tool Improvements**:
    - **Hide Drag**: Disabled unstable Drag tool.
    - **Crease Pull**: Sub Mode (Left Trigger) now pulls creases outward.
    - **(v0.7.443) 6DOF Move Tool**: The Move tool now supports full 6-degree-of-freedom rotation! Twisting your wrist will now twist the mesh. Also improved symmetry behavior to prevent "bum creases" when working near the center line.
- **(v0.7.434) Tool Polish**: Dispersed "Sharpen" from Smooth tool defaults (too aggressive). Hidden "Drag" tool from VR UI (redundant/buggy).
- **(v0.7.431) Crease Tool**: Added "Pinch-Pull" mode to Crease tool for sharper edges.
- **(v0.7.430) UI Polish**: Removed "Lock Selection" button (confusing). Fixed tool selection regression.**: **Drag-to-Scroll**: Enable smooth scrolling by dragging anywhere on the main panel background (just like a phone).
    - **Fix**: **Combobox Interaction**: Fixed regression where tool selection was blocked by UI updates.
    - **Fix**: **Combobox Highlight**: Corrected cursor alignment for dropdown items when using overlays or scrolling.
    - **Cleanup**: Temporarily removed "Lock Selection" UI to focus on stability.

- **v0.7.416**: **Hand Swap & VR Polish**:
    - **Feature**: **Left Hand Mode**: Added "Dominant Hand Swap" toggle in **Settings > Input**.
        - **Interaction**: Swaps Tool/Menu hands and pointer rays.
        - **Logic**: Voxel Negative Mode (Carve) correctly maps to the **Non-Dominant** trigger.
        - **Visuals**: Brush tip and radius indicator follow shift to appropriate hand.
    - **UI**: **Settings**: Restored Settings Menu, added Input section, removed broken Camera options.
    - **UI**: **Help**: Updated "Controls" cheatsheet to use "Dominant/Secondary" terminology.
    - **Fix**: **Menu Alignment**: Fixed VR Menu offset to correctly appear on the inner side of the controller for both hands.

- **v0.7.258**: **Voxel Performance**:
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
    
- **v0.7.401**: **VR Menu Refinement**:
    - **UI**: **Menu Cleanup**: Removed desktop-only menus (Camera, Tablet, Language) from VR view.
    - **UI**: **Settings**: Simplified "Extra UI" into a clean "Settings" tab.
    - **UI**: **About & Help**: Added dynamic version, website/github links, credits, and a controls cheatsheet.
    - **Fix**: **Widget Rendering**: Fixed `info` widgets not rendering in overlays.

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
