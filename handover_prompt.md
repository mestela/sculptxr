# Handover: Debugging Voxel Undo/Redo (v0.7.314)

## Current Status
- **Goal:** Fix Voxel Undo/Redo (Per Stroke).
- **Latest Version:** `v0.7.314` (Deployed to Beta).
- **Implementation:**
  - `SculptVoxel.js`: Added `SNAPSHOT` logic to `updateXR` (lines 685+) to detect stroke start.
  - `SculptManager.js`: Enabled `pushStateVoxel` in `start()`.
  - `VoxelWorker.js`: Implemented `SNAPSHOT`, `UNDO`, `REDO` handlers.
- **Problem:**
  - User reports **NO LOGS** for "Voxel: VR Start (Snapshot)" when sculpting in VR.
  - Sculpting *works* (voxels change), but the snapshot trigger seems silent.
  - Code *is* present on disk in `src/editing/tools/SculptVoxel.js`.

## Hypotheses
1.  **Browser Caching:** The user might be running an old version despite the deploy. (Check `VERSION` global in their console?)
2.  **Logic Gap:** `updateXR` might not be called? Or `isPressed` is flaky?
    - If `updateXR` wasn't called, they wouldn't be able to sculpt (unless `Scene.js` calls something else?).
    - `Scene.js` calls `tool.updateXR` directly.
3.  **Condition Failure:** `!this._xrStrokeActive` check might be failing if it never resets? (It resets on `!isPressed`).

## Immediate Tasks (Next Session)
1.  **Verify Version:** Ask user to type `VERSION` in console to confirm v0.7.314.
2.  **Force Log:** Add a log to the *very top* of `updateXR` to see if it runs at all.
3.  **Check `isPressed`:** Log `isPressed` value in `updateXR`.

## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
-   **Local:** `npm run dev` (running on port 8000).
-   **Key Files:** `src/editing/tools/SculptVoxel.js`, `src/Scene.js`.