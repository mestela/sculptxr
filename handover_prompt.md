# Handover Prompt - Voxel Engine: GPU Fallback and Coordinate Stabilization

**Project Status**: **Falling back to standard CPU SurfaceNets after GPU Volume Raymarching experiments**

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Branch**: `threejs` (Working Copy)

---

## Recent Work (Previous Session Recap)

We attempted a major architectural shift to **GPU Volume Raymarching** to bypass CPU bottlenecks, but encountered severe fill-rate issues on standalone VR and coordinate mapping artifacts. We have since attempted to revert back to standard **CPU SurfaceNets geometry extraction** to stabilize the interface.

---

## Current Situation / Obstacles

### 🚧 1. The "No Change" Grid Locking
We are currently stuck in a state where pulling the trigger emits messages to the worker, but the worker responds with `No Change`. 

-   **Symptoms**: 
    -   Hand coordinates are received correctly at the worker (e.g., $C \approx [8.4, 42.0, 35.9]$ meters).
    -   The logger prints `EditSphere: No Change` for every single stroke.
-   **Triage Steps Taken**:
    -   Removed temporary resolution divides in `VoxelWorker.js`.
    -   Removed scaling divides ($1.3\times$ hacks) in `SculptVoxel.js` to restore original unmodified JS state.
    -   Initialized `Float32Array` to $1.17$ in `VoxelState.js` constructor to prevent flat-field of zeros overriding edits.
    -   Flipped `isNegative` back to standard `isSub` to separate Add vs. Subtract mode correctly.

### ❓ 2. The Scaling Riddle
The workspace seems to operate at a very large scale (height $\approx 21.5$ to $42.0$ meters), while the Simulation workspace is defined as $150$ meters. If the user is standing inside $[-75, 75]$, drawing at $42$ meters height SHOULD fall within bounds, but it's still yields `No Change`.

---

## Next Steps for the New Agent

1.  **Review why `addSphere` in `VoxelState.js` rejects edits on empty space.**
    -   The logic is standard SDF min checks: `dist < oldDist`.
    -   If standard grid is initialized to $1.17$ (empty), and you write $0.0$ (solid), $0.0 < 1.17$ should fire! Why is it failing? Check `oldDist` values at runtime.
2.  **Verify Grid Distance Calculation Scales**
    -   Ensure `step` calculation ($150 / 128$) matches the spatial units of `center` meters perfectly. If $C = 42.0$ meters, verify index calculation translates to valid array index inside $[0, 128]$.
3.  **Ensure Geometry Updates are Sent Back to Main Thread**
    -   If `VoxelState.js` edits succeed, ensure `getTriangles()` is calling `postMessage` back to `SculptVoxel.js` to update the Three.js mesh visual.
4.  **Re-assess PCVR vs Mobile**
    -   If standard CPU SurfaceNets geometry works without lag on PCVR, assume voxel sculpting is a PCVR-only feature for this setup.

---

Please review `VoxelState.js` `addSphere` function (line $\sim 140$) to see exactly why `changed` remains false inside the cell loop! 🛠️
