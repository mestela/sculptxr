# SculptXR Handover Prompt

---

## Current Situation / Obstacles

We have successfully overhauled the **Symmetry Mirror and Triangle-to-Quad Merging** pipeline!

### Key Achievements Today:
1.  **Blender Error Metric Port**: Replaced crude heuristics with Blender's `quad_calc_error` (Planarity, Squareness, Area Concavity).
2.  **Triangle Candidate Priority Queue**: We collect all adjacent candidates and sort by error value, merging the best (flattest) quads first.
3.  **No Scale Multipliers**: Removed legacy `x1000` scaling loops from the Manifold-3D WASM pipeline.
4.  **Weld Pass after Compose**: Added `weldVertices` immediately *after* boolean union so quads can merge across the centerline seam.
5.  **Pre-Snapping vertices to Plane**: Pushed vertices within 1mm onto the symmetry plane *before* `splitByPlane` runs to eliminate slivers. Centerline is now watertight and perfect!
6.  **Manual Topology Repair Tools (DeleteFace and FillHole)**:
    -   *DeleteFace*: Synchronous mesh replacement with single-click face deletion. Fixed XR-loop continuous stroke crashes.
    -   *FillHole*: Lightweight generic 2D Parametric Grid Re-Mesher. Auto-dimensions rectangular holes (1x1, 2x1, 3x1, 2x2, 3x2, 2x3, 3x3) and weaves clean, untangled quads using local flat-plane PCA projection and geometrical bottom-left corner alignment.
7.  **History Stability**: Ported mesh tracking to use state object swapping rather than heap memory reallocations. 100% memory-stable undos.

All fixes are pushed to `manifold_branch` on GitHub.

---

## Next Steps / Backlog

### Immediate Priorities (Fit & Finish)
1.  **Quad Remesh (`quadrs`) Garbage Output**:
    -   *Problem*: When using the automated Rust `quadrs` WebAssembly remesher (Instant Meshes port), it occasionally outputs bad non manifold geo, a handful of polys floating in space. Need to run `console.log` and verify being passed.
2.  **Selective Edge/Face Dissolve (Manual Topology)**:
    -   *Approach*: Allow the user to selectively delete an edge between two triangles (or combine them) to form a quad manually.
3.  **Quadrangulation Completeness**: Investigate why the priority queue still misses a few obvious edges. Check if sorting locks out candidates.

### Future Roadmap
1.  **Transform Gizmo Rethink (Fix Skewing/Wobble)**: Switch to standard Three.js **TRS Component Tracking** (`position`, `quaternion`, `scale`) instead of direct matrix multiplication.
2.  **Local Storage (IndexedDB)**: Persist user options and local projects.

Good luck! 🛠️
