# Task: Shift Voxel Engine to Rust/WASM

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Plan Rust Workspace and WASM compilation strategy <!-- id: 0 -->
- [x] Initialize Rust crate for voxel computation <!-- id: 1 -->
- [x] Port inner loops of SurfaceNets to Rust <!-- id: 2 -->
- [x] Compile Rust to WASM <!-- id: 3 -->
- [x] Integrate WASM into VoxelWorker.js <!-- id: 4 -->
- [x] Modify `src/editing/VoxelState.js` to fix `tightenBounds` for inverted bounds.
- [x] Modify `src/workers/VoxelWorker.js` to restore tight bounds extraction.
- `[x]` Revert `src/editing/SculptManager.js` to use `cx - maxExtent/2` (bottom-left-rear).
- `[x]` Revert `src/editing/tools/SculptVoxel.js` `updateXR` to use standard shift.
- `[x]` Fix `this._res` staleness in `updateVoxelMesh` to make standard shift work for tight meshes.
- `[x]` Fix color channel shift in `SculptManager.js` `meshToVoxel`.
- `[ ]` Verify local build performance (HMR automatically updates).
- `[ ]` Create walkthrough artifact.
