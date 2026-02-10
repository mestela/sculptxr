# Handover: Voxel Undo/Redo Polish (v0.7.316)

## Current Status
- **Goal:** Polish Voxel Undo/Redo (Fix Erratic Behavior).
- **Latest Version:** `v0.7.316` (Deployed to Beta).
- **Status:**
  - **Undo/Redo Works**: User confirmed it basically works.
  - **Issues**: Behavior is "erratic" (sometimes skips, sometimes double undos).
  - **Code**: `SculptVoxel.js` has `SNAPSHOT` logic. `VoxelWorker.js` deals with history.

## Known Issues
- **Erratic Undo**: detailed by user as "sometimes it doesn't undo, then it will undo 2 steps".
  - *Hypothesis*: Race condition between `SNAPSHOT` and worker processing?
  - *Hypothesis*: `SNAPSHOT` trigger in `updateXR` might be firing multiple times or missed?
  - *Hypothesis*: Circular buffer index logic in `VoxelWorker` might be off-by-one?

## Immediate Tasks
1.  **Investigate Worker Logic**: Review `VoxelWorker.js` history management.
2.  **Debounce Snapshot**: Ensure `SNAPSHOT` isn't sent multiple times per stroke (though `_xrStrokeActive` should prevent this).
3.  **Visual Feedback**: Maybe add a sound or visual cue when Undo happens?

## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
-   **Local:** `npm run dev` (port 8000).