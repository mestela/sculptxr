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

## Other Fixes (v0.6.5)
-   **VR Menu Depth**: Enabled Depth Test in `VRMenu.js` so it correctly hides behind the sculpt and controllers when appropriately positioned.

## Verification
*   **Log**: `Stroke` time < 10ms.
*   **Feel**: Consistent snapping.
*   **Move Tool**: Stable even at large radii.

# Walkthrough: VRLaser Implementation (v0.6.33)

## Goal
Provide clear visual feedback for UI interaction (Menu Pointing) without cluttering the view during sculpting.

## Approach
1.  **Geometry**: 8-sided Cylinder (Radius 1mm).
2.  **Shader**: `ShaderUnlit` (Solid Red `[1,0,0]`) to ensure visibility against all backgrounds without lighting artifacts.
3.  **Behavior**:
    *   **Conditional Visibility**: Only visible when `_isPointingAtMenu` is true.
    *   **Dynamic Length**: Stretches exactly to the menu intersection point (+5cm overshot) for precise depth cues.
    *   **Attachment**: Locked to `targetRaySpace` (or `gripSpace` fallback) of the Right Controller.

## Challenges
*   **Shader**: `ShaderFlat` forced "headlight" shading, making the laser look like a 3D pipe. Implemented `ShaderUnlit` for a clean "Laser" look.
*   **Caching**: Aggressive browser caching required manual cache-busting in `importmap` (`?v=...`) to force updates on Quest.
