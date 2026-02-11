# Handover: Voxel Subtract Fix (v0.7.339)

## Current Status
- **Goal:** Fix Voxel Subtraction Error.
- **Latest Version:** `v0.7.339` (Deployed to Beta).
- **Status:** **VERIFICATION NEEDED**.
  - **Fix**: Corrected typo `d` -> `dist` in `src/workers/VoxelState.js`.
  - **Note**: There were *two* `VoxelState.js` files. The worker was using a duplicate in `src/workers/`.

## Solutions Implemented
1.  **Bug Fix**: Resolved `ReferenceError: d is not defined` in the worker file.
2.  **Symmetry**: Dual dispatch for VR voxel tools.

## Next Steps
Ask user to choose:
1. could we add smooth shading to the voxel object during sculpting? if its going to be a huge performance degredation, don't bother.
2. when i change the voxel res, the current voxel object gets deleted. can it  be resampled into the new voxel grid?
3. symmetry in voxel mode would be good
4. a smooth brush for voxel mode would be good.
5. inflate/dilate for voxel would be good
6. smooth shading mode for voxel?
7. Undo doesn't work in the new voxel system


## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
