# Handover Prompt: VR Menu Depth Fixed (Stable v0.6.5)

## Current Status
**STABLE**. The project is in a good place.
**Version**: `v0.6.5` (Deployed to Master).

## Recent Achievements
1.  **Fixed VR Menu Depth**:
    *   **Root Cause**: `VRMenu.js` was explicitly disabling Depth Testing, causing it to draw over everything (Painter's algo) but be overwritten by the Mesh (Depth "Far").
    *   **Fix**: Enabled `gl.DEPTH_TEST` for VR Menu rendering. Correctly sorts against Controllers and Mesh.
2.  **Optimization**: Fixed VR Brush Lag with Large Brushes (v0.6.4).
    *   Capped search radius to 5cm Physical (~6.25 Units).
3.  **Unit Correction**:
    *   Fixed Unit Mismatch in picking logic.
3.  **Move Tool Stability**:
    *   Implicitly fixed "Invisible Mesh" issue by ensuring valid picking inputs via correct radius scaling.

## Codebase State
*   `src/Scene.js` & `src/editing/tools/SculptBase.js`: Contains `MAX_SEARCH_METERS = 0.05` logic.

## Next Steps
The codebase is healthy.
*   **Potential Areas**: Dynamic Topology optimization, AR Plane Alignment.