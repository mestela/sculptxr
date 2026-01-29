# Walkthrough: VR Brush Performance Optimization (v0.6.4)

## Goal
Fix the significant slowdown (lag) experienced when using large brushes in VR, while maintaining robust "snapping" behavior.

## Problem Analysis
*   **Symptom**: Large brushes caused frame drops.
*   **Cause**: The picking logic used a search radius of `4.0 x Brush Radius`. For a large brush (e.g., 25cm), this triggered a search volume of 1 meter radius, checking thousands of triangles every frame.
*   **Complexity**: `O(R^3)` relative to brush size.

## Solution Iteration

### Attempt 1: 15cm Cap (v0.6.2)
*   **Change**: Capped search radius to `0.15` Units.
*   **Result**: Fast performance, but **Broken Usability**.
*   **Root Cause**: User reported "no stroke" unless extremely precise. `0.15` Engine Units != `0.15` Meters.
*   **Discovery**: `vrScale` is `0.008`. `0.15` units = **1.2mm**. The brush had to be within 1.2mm of the surface!

### Attempt 2: Unit Correction (v0.6.4)
*   **Change**: Defined cap in **Meters** (5cm) and scaled by `invScale` (~125).
*   **Math**: `0.05m * 125 = 6.25 Units`.
*   **Result**:
    *   **Performance**: Still blazing fast (<10ms).
    *   **Usability**: "Feels SO good", magnetic snapping restored.
    *   **Bonus**: Fixed "Invisible Mesh" issue in Move tool (likely due to invalid inputs from missed picks).

## Implementation Details
Modified `src/Scene.js` and `src/editing/tools/SculptBase.js`:

```javascript
// FIX v0.6.4: Unit-Corrected Cap (5cm Physical)
const vrScale = this._main._vrScale || 1.0;
const invScale = 1.0 / vrScale;
const MAX_SEARCH_METERS = 0.05; // 5cm
const MAX_SEARCH_RADIUS = MAX_SEARCH_METERS * invScale;

const searchRadius = Math.min(rWorld * 4.0, MAX_SEARCH_RADIUS);
picking.intersectionSphereMeshes(meshes, pos, searchRadius);
```

## Verification
*   **Log**: `Stroke` time < 10ms.
*   **Feel**: Consistent snapping.
*   **Move Tool**: Stable even at large radii.
