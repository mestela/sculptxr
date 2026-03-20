# Handover Prompt - Sculpt Stroke and Symmetry Fixes

**Project Status**: Fine-tuning sculpting responsiveness and symmetry in VR (Volume Intersect mode). We resolved the critical "No strokes" bug and the "Symmetry stuck in place" bug. The current focus is a 50% motion lag on the symmetry stroke.

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr/`

## Recent Work & Achievements (This Chat)

### 1. Fixed Critical "No Strokes" in VR Volume Intersect
Discovered that `sculptStrokeXR` was running a second, tighter `intersectionSphereMeshes` search inside the stroke loop. If this search missed (due to tiny radii or stale Octrees), it overwrote the valid picking with `null`, dropping the stroke.
-   **Fix**: Removed the redundant call. We now trust the successful picking state from `processVRSculpting` for that frame.
-   **Status**: Strokes register reliably! 🎉

### 2. Robust Fast Octree Over-Fetching
Tapping a tiny brush on a dense mesh would fail because the search radius was ~1cm and fell between stale Octree cell voids.
-   **Fix**: Modified `pickVerticesInSphere` to query candidates using a safe adaptive minimum radius (fraction of mesh size), then filter precisely using the actual brush size. 

### 3. Fixed Symmetry "Stuck in Place & Accumulating" Bug
When using the topological map (`symMap`) to set symmetrical vertices, we were not marking them with the active `Utils.SCULPT_FLAG`. 
-   **Fix**: Marked mapped symmetrical vertices with `Utils.SCULPT_FLAG` so `dynamicTopology` recognizes them instead of filtering them out as inactive!
-   **Status**: Symmetry sweeps along! 🎉

### 4. Pre-Compute Symmetry Before Main Stroke (Lag Reduction)
Previously, Dyntopo modified the mesh (creating new unmapped vertices) *before* symmetry was computed. This broke `symMap` and forced symmetry to fall back to the stale Octree.
-   **Fix**: Reordered `makeStrokeXR` so symmetry is computed on the *unmodified* mesh first.

---

## Current Working Blocker: Symmetry Skew and Skipping on Default Sphere

The symmetry stroke is skewed in direction (e.g., NE movements mirror to North instead of NW) and drops strokes during slow movements.

### Key Insights (For Next Session):
-   **Default Multi-res Sphere**: Tested on a standard sphere with scale 1.0 (no Dyntopo, no crazy mesh).
-   **Geometric Math is Correct in deltas**: Logs show `MainDelta` and `SymDelta` are perfect mirror flips in world space.
-   **Topological Symmetry is Brittle**: Disabling it didn't fix the skew, but it stabilized the vertex count. The issue seems to be in the hidden mesh transformation matrix or how the picking finds tilted faces if the mesh is slightly asymmetric.
-   **Master Branch Comparison**: Need to carefully compare `makeStrokeXR` in `SculptBase.js` with `tmp_master_sculptbase.js` to find the exact delta in the lifecycle for standard strokes.

-   **Porting Existing Logic**: The user emphasizes that we should **not reinvent the wheel**. The original WebGL codebase worked perfectly for standard multires symmetry. We need to find why the port is behaving differently (hidden rotations, scale double-transformations, or different lifecycle order).

### Next Steps:
-   **Direct Comparison**: Line-by-line comparison of `makeStrokeXR` in `SculptBase.js` vs `tmp_master_sculptbase.js` for standard multires (non-dyntopo).
-   Check if `eyeDir` or normal consistency checks are overriding normal directions inconsistently for standard multires meshes vs Dyntopo.

---
## Device & Server
-   **Server**: `npm run dev` (Vite)
-   **Testing**: Chrome Remote DevTools over USB on GalaxyXR.
