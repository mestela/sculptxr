# Handover: Debugging VR Voxel Buttons & Future Optimizations (v0.7.300)

## Current Status
- **Goal:** Fix VR Voxel Buttons (Add/Sub/Inflate) not switching modes or updating UI active state.
- **Latest Version:** `v0.7.300` (Deployed to Beta).
- **Behavior:**
  - Voxel Sculpting works (Add/Subtract via negative modifier).
  - **VR Buttons (Sub, Inflate) seem dead.** Users report "no logs" when pressing them.
  - Checkboxes/Sliders elsewhere work, but Voxel buttons are silent.

## Immediate Tasks (Next Session)
1.  **Debug VR Button Hit:** Investigated `GuiXR._getHoveredWidget` to see what is blocking the Voxel buttons.
2.  **Fix Interaction:** Ensure `setVoxelMode` is reachable.

## Future Optimizations (Discussed)
1.  **Voxel Smooth Shading:** Implementation plan ready (reuse `SurfaceNets` shared vertices + SDF gradient).
2.  **BVH Raycasting:** `three-mesh-bvh` for standard tools (huge speedup for high-poly non-voxel meshes).

## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
-   **Local:** `npm run dev` (running on port 8000).
-   **Files:** `src/gui/vr/GuiVRTools.js` (Buttons), `src/gui/GuiXR.js` (Interaction).