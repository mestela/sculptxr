# Handover Prompt

**Project Status**: Mid-migration from custom raw WebGL rendering (SculptGL) to **Three.js v160**. Phase 1 (Engine Initialization) is complete. Phase 2 (Mesh Data Bridge) is currently in progress, focusing on stabilizing the dynamic BufferGeometry updates.

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr/`

## Critical Developer Instructions
[WARNING: DO NOT USE DEPLOY SCRIPTS. WE ARE EXCLUSIVELY USING A LOCAL PYTHON SERVER FOR DEVELOPMENT.]
* Read the codebase using `view_file` instead of grep where possible. 
* Do not attempt to run `npm run build` or `npm run deploy`. 
* **Local Server**: The user runs `python3 serve.py` to host the site locally with HTTPS (required for WebXR). It serves on `https://10.0.0.19:4433/` (or `localhost:4433`). There is NO hot-reloading; changes require a manual browser refresh.
* The user prefers small, incremental tests. When making geometry or rendering changes, ensure the base case (a simple 6-sided primitive cube) works before testing subdivided spheres.

## Recent Work & Context
1. **Three.js Migration**: Successfully replaced the custom VBO/VAO (`Buffer.js`/`Attribute.js`) implementation with `THREE.BufferGeometry`. The core render loop in `Scene.js` now uses `THREE.WebGLRenderer.setAnimationLoop()`.
2. **glDrawArrays Out-of-Bounds Error**: We are currently battling a `GL_INVALID_OPERATION : glDrawArrays: attempt to access out of range vertices in attribute 0` error.
3. **VAO State Corruption & Gizmo**: We discovered that legacy WebGL UI elements (like the Gizmo Tool) run in `postRender()` immediately after Three.js renders. The Gizmo creates a 24-byte (6-vertex) Line array (`Primitives.createLine2D`). Because Three.js leaves the sculpt mesh's VAO bound, the raw WebGL `gl.bindBuffer` calls from the Gizmo permanently hijack the sculpt mesh's Attribute 0, replacing the 1.7 million vertex buffer with a 24-byte buffer.
4. **Current Status**: We attempted to fix this by adding `gl.bindVertexArray(null)` inside `_drawScene` after Three.js renders, but the error persists even on a simple 6-sided cube.
5. **Latest Code Changes:**
   - Disabled subdivision in `Scene.js` `addSphere()` and `addCube()` so it boots with a clean primitive.
   - Added stack traces to `Mesh.js` to catch 6-vertex array allocations.
   - Intercepted `gl.drawArrays` in `Scene.js` to print out exhaustive buffer diagnostics (which proves the 24-byte buffer is bound during the Three.js render pass).

## Next Steps
Investigate why the VAO unbind in `_drawScene` and `_drawSceneVR` failed to prevent the 24-byte Gizmo buffer from corrupting Three.js's next frame. Check if `Gizmo`'s `MeshStatic` initialization is inadvertently registering a Three.js `BufferGeometry` that gets synced or cached globally, or if `Three.js`'s internal caching (`renderer.state`) is eagerly restoring a bad buffer.