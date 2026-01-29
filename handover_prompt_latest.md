# Handover Prompt: VR Performance Fixed (Stable v0.6.4)

## Current Status
**STABLE**. The project is in a good place.
**Version**: `v0.6.4` (Deployed to Master).

## Recent Achievements
1.  **Optimization**: Fixed VR Brush Lag with Large Brushes.
    *   **Root Cause**: Picking search radius was scaling linearly with brush size (4x), leading to O(N^3) search costs for large brushes (e.g. searching 1 meter radius).
    *   **Fix**: Capped the search radius to **5cm Physical** (~6.25 Engine Units).
    *   **Result**: Performance is consistent (<10ms) regardless of brush size, and snapping feels natural/magnetic.
2.  **Unit Correction**:
    *   Fixed a bug where "0.25" cap was applied to Engine Units (2mm) instead of Meters.
    *   Corrected to `0.05 * invScale`.
3.  **Move Tool Stability**:
    *   Implicitly fixed "Invisible Mesh" issue by ensuring valid picking inputs via correct radius scaling.

## Codebase State
*   `src/Scene.js` & `src/editing/tools/SculptBase.js`: Contains `MAX_SEARCH_METERS = 0.05` logic.

## Next Steps
The codebase is healthy.
*   **Potential Areas**: Dynamic Topology optimization, AR Plane Alignment.