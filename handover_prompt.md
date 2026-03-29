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

We are debugging a persistent **color channel shift (Red ➡️ Purple, Yellow ➡️ White)** when converting a painted standard mesh to voxels. 

The diagnostic command `window.debugVoxelColors()` revealed a crucial clue:
- `Min: R=0.34, G=0.00, B=1.00`
- `Max: R=1.00, G=1.00, B=1.00`

The **Blue channel is fixed at 1.0 everywhere**! This explains why Red (1,0,0) looks Purple (1,0,1) and Green (0,1,0) looks Cyan (0,1,1). We are reading from a field that is `1.0` everywhere. 

### Hypothesis
The shifting is occurs inside `VoxelState.js` `addMeshSDF` during mesh-to-voxel writing:
1. Three.js `color` attribute array might have elements we are misaligning (e.g., length `nbVertices * 4` instead of `nbVertices * 3`, or using an implicit Alpha channel).
2. The index `iv1 = index * 3` is assuming regular size 3 but reading from a size 4 or misaligned `getTriangles()` index.

At runtime `cAr` (color array sent to worker) is length size 3 output by `debugVoxelColors()`, but it could be generated size 3 output from a size 4 source. 

---

## Next Steps for the New Agent

1. **Verify if `cAr` length inside `addMeshSDF` matches `vAr` length** (i.e. length is `/3` or `/4`). 
2. **Log `cAr` values exactly** when reading `iv1` to see if it is reading Alpha values as Blue!
3. Check `SculptManager.js` `meshToVoxel` to see if the `THREE.BufferAttribute` length fits the `itemSize`.

---

Good luck! 🛠️
