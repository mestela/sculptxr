# SculptXR Handover Prompt

## Objective: Resolve Remaining VR Quirks (Stationary Scale Teardown)

The project is currently at `v0.8.182` (which functionally reverted the matrices back to `v0.8.178`). We successfully resolved the Crease brush infinite accumulation spikes and centerline symmetry over-accumulation. 

The user reported one critical remaining issue that needs a fresh approach in the next session:

### Issue 1: Stationary Mode UI / Controller Scaling
In `STATIONARY` (Desktop 6DOF) mode, the VR menu and the controller models themselves are scaling up and down visually on the desktop monitor when the user 2-grip scales the world. The goal is to keep them exactly 1:1 scale on the desktop screen.

**The Complexity (What we learned mathematically):**
1. **The Double-Inverse Loop**: In `processVRTwoHanded`, scaling the mesh *down* physically means `vrScale` gets smaller. This pushes the spectator trackball camera (`specView`) physically backwards (to track the offset). 
2. **The View Tear (`v0.8.180`)**: To render the controllers, `specViewPhys` is constructed as `specView * invScaleMat * invWorldMat`. I attempted to decouple the matrix from `specView` entirely to stop the local scaling. This failed because `specView` contains `scaledPanPos` (the panning tracking vector). Stripping it caused the controllers to completely tear off the screen when the user translated their body.
3. **The Global Scale Injection (`v0.8.181`)**: I attempted to inject a pure geometric counter-scale (`Scale(vrScale)`) dynamically into the `specViewPhys` global matrix to counteract `invScaleMat`. Because matrix multiplication order scaled the translation vector *before* the tracking offset was applied, the controllers drifted entirely off the screen again.
4. **The Local Mesh Injection (`v0.8.182`)**: I attempted to surgically inject the counter-scale (`Scale(vrScale)`) directly into the `mesh.getMatrix()` of the VR Controllers, and into the `_cacheMVP` of the `VRMenu` explicitly inside `_renderSceneVR` (just a millisecond before WebGL `render()` calls), instantly restoring the matrices afterwards to protect the `_cacheWorld` from raycaster hit-testing corruption. This *also* failed to make the controllers visible.

**Next Session Mission**
1. Review the physical matrix pipeline (`Scene.js` lines ~2370-2450) and understand why the controllers vanished during the Local Mesh Injection (`v0.8.182`).
2. Identify a geometrically safe method for forcing `Multimesh` and `VRMenu` drawables to counteract the `invScaleMat` camera squish without breaking their physical coordinates or completely detonating the raycaster intersection array.
3. Keep the user in the loop. Deploy to Beta iteratively.