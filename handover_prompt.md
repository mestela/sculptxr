# SculptXR Handover Prompt

## Objective: Fix VR Stroke Wavy Artifacts and Restore Topo-Symmetry

The project is currently at `v0.8.132`. The user reported that VR strokes (especially with raycast tools like Crease) produce horrible zigzagging waves. Furthermore, symmetry is completely broken again, drawing only single dots on the mirrored side.

### What Happened in `v0.8.130` - `v0.8.132`?

We attempted to fix the zigzagging wavy lines in VR by applying "Lazy Mouse" smoothing and modifying the stroke interpolation logic in `src/editing/tools/SculptBase.js`.

1. **The Core Issue:** `sculptStrokeXR` interpolates the physical controller's 3D position (`worldPos` floating in the air) using a step loop, and then forcefully drops a collision sphere (`intersectionSphereMeshes`) straight down onto the geometry to find the nearest vertex. For raycast tools like Crease, where the controller is far from the mesh, this "air drop" hit point shifts wildly away from the laser line, snapping randomly to different ridges on the surface.
2. **Failed Attempt 1 (`v0.8.131`):** I tried changing `sculptStrokeXR` to interpolate the *surface intersection point* (`strokePos`) instead of the controller's `worldPos`. This completely broke all tools (returned to drawing dots) because the `minSpacing` calculation, required to step the loop, fundamentally relies on the physical distance the controller has traveled in 3D space (`dist = vec3.dist(worldPos, this._lastVRPos)`).
3. **Failed Attempt 2 (`v0.8.132`):** I reverted the stroke interpolation loop back to using `worldPos`. I then enabled VR Lazy Mouse smoothing (`vec3.lerp`) universally for **all** VR modes, hoping that smoothing the physical controller input itself would eliminate the waves. 

**The Result:** The user reported `v0.8.132` still has wavy strokes on the Crease tool, and **symmetry is completely broken again** doing the single-dot error.

### The True Root Cause

The wavy strokes are caused by `intersectionSphereMeshes` being used blindly for all VR tools during the interpolation step. For tools like `Crease` and `TransformVR` that require precise laser-aimed raycasting (`intersectionRayMesh`), switching to a spherical "closest point" fallback dynamically snaps the stroke to whatever geometry is physically closest to the floating controller's interpolated position.

**Why did Symmetry Break?**
In `v0.8.132`, the VR Lazy Mouse interpolation was enabled globally:
```javascript
const smoothedPos = vec3.create();
vec3.lerp(smoothedPos, this._lastVRPos, worldPos, 0.15); // 85% old, 15% new
vec3.copy(worldPos, smoothedPos);
```
Because `worldPos` is the reference to `main._vrControllerPos` that `Scene.js` also uses, mathematically squeezing the controller's delta to 15% velocity in the tool logic seems to have decoupled or desynced the physical controller matrix from the logical surface hit, completely breaking the Topological Symmetry threshold checks or the mirroring matrix.

### Next Session Mission

When the user returns, you must deeply investigate how to stabilize VR laser strokes without corrupting `worldPos` or symmetry.

#### The Fix Strategy:

1. **Revert the Global Smoothing:** Remove the global 15% `vec3.lerp` hack in `SculptBase.js` that was added in `v0.8.132`. Put the smoothing restriction back behind tracking so standard VR mode strokes aren't choked by artificial velocity limits.
2. **Identify Raycast vs Volume Intersection:** In `Scene.js`, we use `this._picking.intersectionRayMesh(..., rayOrigin, engineDir)` for Crease. In `SculptBase.js`, the `for(...)` stroke loop blindly calls `picking.intersectionSphereMeshes([mesh], lerpedPos, rWorld)`.
   * You must figure out how to maintain a true *raycast* intersection during the interpolation frame loop for tools that require aiming, rather than dropping a generic sphere.
3. **Investigate the Symmetry Dotting:** 
   * Review `makeStrokeXR` and the `pickingSym.setIntersectionPoint(symWorldPos)` bypass that was implemented in v0.8.130. 
   * Figure out why it is aborting or rendering empty spheres again. The Lazy Mouse smoothing applied in `v0.8.132` likely destroyed the `dist` thresholds required for the mirror to fire successfully.

Start by examining `src/editing/tools/SculptBase.js` around line 430 and strip out the failed smoothing!