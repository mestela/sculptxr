# Handover Prompt (Protocol Enforced)

**Project Status**: Stable. Voxel-to-Mesh Color Retention works! `bakeToMesh` now calls `setColors()` before `init()`, preventing Three.js from clearing manual vertex colors with default white backgrounds.

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Colors preserve happily between Mesh and Voxels and back! However, a **Performance Regression** has been introduced during `updateVoxelMesh` interaction (dropping from 30fps to 8fps).

---

## Deployed Version
- **Beta**: v1.0.65+ (Tested locally)
- **Prod**: Not yet deployed

---

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets. Navigate to `sculptxr` and run `npm run dev`.

---

## Current Situation / Obstacles

A performance regression has dropped the voxel tools from fluid 30fps+ to around 8fps. 

We added performance metrics to both the main thread (`SculptVoxel.js`) and the worker (`VoxelState.js`). 
- **Worker thread** (e.g. `addSphere` and `editSphere`) remains fast (few ms).
- **Main thread** message passing (`postMessage`) is also fast.
- The bottleneck is in the **UI rendering thread** (`WebGLRenderer.render` taking 500-900ms).

We hypothesis that either:
1. `initEdges()` was unconditionally rebuilding wireframes on every frame (we commented this out but it didn't solve it completely if wireframe was somehow enabled).
2. `updateOctree()` and `updateFacesAabb()` are being called on every frame during dragging inside `updateVoxelMesh`, which rebuilds the hierarchy for a massive single mesh (which is a heavy CPU operation).

---

## Next Steps for the New Agent

1. **Verify if `updateOctree()` is the culprit**:
   - Comment out `newMesh.updateOctree()` and `newMesh.updateFacesAabb()` in `updateVoxelMesh` in `SculptVoxel.js` (around line 1592) to see if frame rate jumps back up.
2. **Consult `docs/threejs_todo.md`** once performance is restored. 

---

Good luck! 🛠️
