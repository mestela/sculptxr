# The Quadrangulation and Symmetry Mirror Journey

This document captures the journey of stabilizing the voxel-to-mesh symmetry and quadrangulation pipeline in SculptXR, transitioning from heuristic greedy merging to a robust, Blender-grade error metrics system.

## 🏁 The Objective
To replace a fast-but-crude triangle-to-quad greedy merger with a high-fidelity system that:
1.  Maintains **quad-dominant** geometry where possible (especially on voxel grids).
2.  Ensures **manifold** output (no self-intersections or twisted quads).
3.  Smoothly bridges across the **Symmetry Mirror** centerline.

---

## 🛠️ Step 1: The Heuristic Era
Initially, we used a greedy loop that looked at adjacent triangles and merged them if their normals were close (dot product threshold).
*   **The Issue**: There was no tie-breaking or prioritization. On flat voxel faces, all quads evaluated to "perfect". The algorithm would grab the first neighbor it saw, scrambling the grid into diagonals or staggered bricks. 

## ⚖️ Step 2: Porting the Blender Error Metric
We decided to adopt the gold standard: Blender's BMesh error metric (`bmo_join_triangles.cc`). We ported the 3-part metric into `VoxelWorker.js`:
1.  **Planarity (Normal Difference)**: Measures how tilted the two triangles are relative to each other.
2.  **Squareness (Edge Angles)**: Compares the 4 corner angles to 90 degrees.
3.  **Concavity (Area Symmetry)**: Compares the areas of the two candidate triangles to ensure they are even and convex.

We moved from a fast find-and-merge sweep to a **Candidate Priority Queue** (collect all valid pairs, sort by error, merge best first).

---

## 🏔️ Step 3: Curvature vs Flat Faces
On organic sculpts (a sphere), the curvature means pairs have distinct error scores. The priority queue works beautifully.
On flat faces, everything scores `0.0`, resulting in arbitrary grid scramble.
*   **The Fix**: To make the mesh quad-dominant on curves, we **loosened the planarity threshold** from `0.8` (36° tilt limit) down to `0.2` (~78° tilt limit). 
*   Because we sort by error, flatter pairs always merge first. The loosened threshold allows curved pairs to merge as a last resort, sweeping the sphere clean of triangles.

---

## 🪚 Step 4: Manifold-3D and the Symmetry Seam
For the Symmetry Mirror, we use `Manifold-3D` (WASM) to split the mesh by plane and union it with its mirror. 

### Artifact 1: Slivers and Scale
To avoid WASM numerical precision errors, the pipeline used to **scale the mesh up by 1000** before passing it to Manifold-3D. 
*   **The Side Effect**: Tiny vertex separations (e.g., `0.001`) became `1.0` unit wide! `Manifold-3D` saw them as distinct separate surfaces and didn't weld them, leaving double surfaces and slivers on the centerline. 
*   **The Fix**: We removed the 1000x scaling and let `Manifold-3D` weld centerline vertices natively at their real un-magnified scale.

### Artifact 2: Missing Centerline Quads
Even with unscaled vertices, `Manifold-3D` union can leave duplicates at the seam. 
*   **The Fix**: We added a `weldVertices` pass **immediately after the Manifold Union** before quadrangulating. By collapsing the seam vertices, the Priority Queue could finally see valid shared edges bridging left and right. 

### Artifact 3: Pre-Snapping Vertices to Plane
Slicing through triangle *faces* creates thin slivers. Slicing through a vertex creates *zero* new geometry!
*   **The Fix**: We added a loop **before** `splitByPlane` to find vertices within a `1e-3` (1mm) threshold of the symmetry plane and snap them exactly onto it. This ensures that when the CSG slicer runs, it only hits existing vertices and edges, leaving the centerline perfectly clean and watertight!

---

## 🚦 Current Status
The mesh is now **90%+ Quad Dominant** on default spheres, with Blender’s error metrics ensuring visually clean topology. 
Remaining challenges:
-   **Centerline Slivering**: Some CSG slicing artifacts remain at the exact cutting plane (a side-effect of using boolean cuts). 
-   **Flat Face Preservation**: Without an axial/grid bias, flat faces can still wobble if they aren't guided by feature lines.

The system is now "Almost Usable" and a massive leap forward from the early heuristic sweeps!
