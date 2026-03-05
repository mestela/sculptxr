# Slide Brush: Geometric Snapping Postmortem (March 2026)

## Objective
The goal was to fix the "stapling" artifact in SculptXR's `Slide` brush. During rapid brush strokes, vertices pushed across face boundaries would snap incorrectly to the nearest edge perimeter instead of sliding smoothly along the surface, creating tangled, straight-line geometric clumps.

## Previous Approach (Failure)
The original implementation relied on a Topological Mesh-Walking algorithm. While computationally cheap (O(1) relative to total mesh complexity as it only walked adjacent edges), it lacked true spatial awareness. When the brush delta pushed a vertex further than its immediate 1-ring neighbors, the topological anchor would fail, and geodesic sub-stepping caused vertices to collapse inwards towards the topological center of the pulled region.

## New Approach: True Geometric Snapping (Failure)
We attempted to replace topological mesh-walking with a pure Euclidean projection approach:
1. **Gather Proxy Faces:** Immediate neighborhood polygons (`mesh.getFacesFromVertices`) were gathered.
2. **AABB Culling:** A bounding sphere/box check was used to quickly cull the hundreds of proxy faces down to just the handful within the brush radius.
3. **Exact Projection:** The `vTarget` tangential position was projected onto the remaining proxy faces using `Geometry.distance2PointTriangle`, finding the true closest Euclidean point on the mathematical surface.

## What Went Wrong
Despite achieving theoretically "perfect" O(1) surface constraints (avoiding the 5+ second lockups of full-mesh O(V*F) brute force), the brush remained unstable. 

1. **Aggressive Culling & Origin Snapping:** The AABB culling logic frequently rejected *all* faces for a given projected `vTarget`. Because `Geometry.distance2PointTriangle` returns an initialized array (`[0,0,0, 0]`) for its `closest` out-parameter, vertices that failed the cull would aggressively snap to the global mesh origin (0,0,0).
2. **Tri_Index Out of Bounds:** A critical bug was found where `Utils.TRI_INDEX` (4,294,967,295) generated massive out-of-bounds indices when parsing quad geometry. This caused coordinate lookups to evaluate to `undefined` or `NaN`, permanently corrupting the `distSq` calculations.
3. **Persistent Collapse:** Even after implementing strict fallbacks (returning `vTarget` if no faces were hit) and fixing the index parsing, the vertices *still* collapsed to the origin on deployment (v0.9.132). 
4. **0.1s Lag Spike:** The nested loops for bounding box calculation and exact triangle distances still introduced a noticeable 0.1s lag spike at the initiation of the brush stroke.

## Conclusion and Next Steps
The geometric snapping logic was mathematically sound on paper but too fragile and error-prone in WebGL's typed, flat-array architectural environment. The constant conversion between face indices, vertex indices, flat-coordinate indices (`x3`), and AABB struct bounds created too many edge cases for the origin snap.

The `Slide` brush has been officially parked and hidden from the UI using the `Enums.js` tool list. Future attempts must either rely on the Octree for spatial lookups or explore a completely different Laplacian deformation strategy rather than strict closest-point constraint mapping.
