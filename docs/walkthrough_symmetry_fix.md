# Walkthrough: VR Brush Symmetry Drift Fix (v0.6.49)

## Goal
Eliminate "Symmetry Drift" where the mirrored stroke on the negative X axis would wander away from the correct surface normal, especially on curved surfaces or when using large brushes.

## Problem Analysis
*   **Symptom**: The main brush stroke looked fine, but the symmetry stroke would often "slide" down the side of the mesh or become distorted.
*   **Cause**: The core `Picking.js` logic in SculptGL relies on `getEyeDirection()` (Camera Vector) to cull back-facing vertices (`getFrontVertices`).
*   **VR Issue**: In VR, the "Camera" is freely moving and often looking at the mesh from angles that don't align with the sculpting hand (e.g. sculpting the back of a head while looking at the side).
    *   **Result**: The default VR implementation had `EyeDir` as `[0,0,0]` or invalid.
    *   **Consequence**: Culling was effectively **disabled**, allowing the brush to grab vertices on the *opposite side* of the mesh (backfaces).
    *   **Drift**: Including backfaces in the average normal calculation pulled the stroke towards the center of the object, causing the "Drift".

## Solution Iteration

### Attempt 1: Explicit VR Camera Position
*   **Idea**: Pass the HMD position as `EyeDir`.
*   **Failure**: Users often look at surfaces from glancing angles. Standard "Backface Culling" (Dot(N, View) > 0) is too aggressive for sculpting tools, leading to broken strokes when reaching around curves.

### Attempt 2: Normal Consistency Check (v0.6.45)
*   **Idea**: Compare the Main Brush Normal with the Symmetry Brush Normal. If they diverge, ignore the symmetry stroke.
*   **Result**: Reduced valid strokes on curved surfaces but didn't fix the root cause (backface inclusion).

### Final Solution: Surface-Relative Culling (v0.6.49)
*   **Concept**: Instead of using the *Camera* as the reference for "Front", use the *Brush Itself*.
*   **Implementation**:
    *   Set `EyeDir = -PickedNormal` (The vector pointing *into* the surface).
    *   This tricks `getFrontVertices` into thinking the "Camera" is looking perfectly perpendicular to the surface point.
    *   **Math**: `Dot(VertexNormal, -PickedNormal) <= 0`.
    *   **Effect**: This creates a perfect 90-degree cone of influence around the stroke. Any vertex facing *away* from the stroke tangent is strictly culled.
*   **Benefit**:
    *   **View Independent**: Works regardless of where you look.
    *   **Drift Eliminated**: Backfaces are mathematically impossible to pick up.
    *   **Robust**: Works for both Main and Symmetry brushes (Symmetry uses its own mirrored normal).

## Code Changes
Modified `src/editing/tools/SculptBase.js`:

```javascript
// FIX v0.6.49: Force "Surface-Relative" Culling
if (!dynTopo && pick1) {
  // Main Brush: Use NEGATIVE Normal (pointing INTO surface)
  var nMain = picking.getPickedNormal();
  vec3.negate(picking.getEyeDirection(), nMain); 
  this.stroke(picking, false);
}
if (pick2) {
  // Symmetry Brush: Use NEGATIVE Normal
  var nSym = pickingSym.getPickedNormal();
  vec3.negate(pickingSym.getEyeDirection(), nSym);
  this.stroke(pickingSym, true);
}
```

## Verification
*   **Result**: Perfect symmetry mirroring on spheres and complex shapes. No more "sliding" or artifacts.
