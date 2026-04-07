# Implementation Plan - Ray-Plane / Sutherland-Hodgman Edge Slicer

## Objective
Implement a pure custom JavaScript Ray-Plane edge slicer to calculate perfect segment intersections across the $X = 0$ mirror plane for self-intersecting or non-planar quads.

## 1. Intersection Algorithm (Sutherland-Hodgman clipping)
- For each face that spans across the $X = 0$ plane, clip the polygon against the mirror plane.
- **Input**: Face vertices $(v_1, v_2, \dots, v_n)$.
- **Process**: Traverse edges. If an edge crosses $X = 0$, compute the exact intersection point via linear interpolation along the edge.
- **Output**: A new set of vertices defining the polygon strictly on one side of the plane.

## 2. Epsilon and Tolerance
- Calculate a dynamic epsilon based on `mesh.computeLocalRadius() * 1e-5`.
- Any vertex within this epsilon to the $X = 0$ plane is snapped perfectly to $X = 0$ to prevent zero-length or non-manifold sliver triangles.

## 3. Topology Resolution (No-N-gon Policy)
- When clipping a non-planar quad, the output may form a 5-sided or 6-sided N-gon.
- The slicer will invoke the standard greedy quadrangulation error metric to split the N-gon into valid quads or triangles.

## 4. Asynchronous Worker Integration
- The slicer logic will be embedded or invoked via `GeometryWorker.js` to prevent stalling the main thread during dense mesh operations.
- The final sliced and welded geometry is passed back to the main thread for buffer synchronization and rendering.

## 5. Verification and Testing
- Test with standard non-planar deformed faces crossing the mirror boundary.
- Ensure the version is updated and displayed via `#log`.
