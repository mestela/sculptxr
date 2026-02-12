# Handover: VR Twist & Voxel Polish (v0.7.389)

## Current Status
- **Goal:** VR Tool parity and Voxel improvements.
- **Latest Version:** `v0.7.389` (Deployed to Production).
- **Status:** **STABLE** (Reverted Voxel Line Tool changes).
  - **Twist Brush**: Now works in VR (Drill Mode) with correct symmetry.
  - **Voxel Line Tool**: Attempted but reverted due to UX issues (Grip vs Trigger).
  - **Voxel Resampling**: Stabilized.

## Solutions Implemented
1.  **VR Twist**: Implemented `strokeXR` in `Twist.js` using `updateXR` override, fixing `mat4` and center access.
2.  **Symmetry**: Fixed VR symmetry for Twist and Voxel Inflate.
3.  **Deploy**: Automated deployment script `deploy_beta.sh` is reliable.

## Next Steps
Ask user

## Environment
-   **URL:** `https://tokeru.com/sculptxr/`
-   **Beta:** `https://tokeru.com/sculptxrbeta/`
