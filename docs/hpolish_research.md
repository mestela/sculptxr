# hPolish and Hard Surface Research Notes

**Date:** March 2026
**Topic:** Investigating the feasibility of adding ZBrush/Nomad style "hPolish" and "Facegroup" workflows to SculptXR.
**Status:** Research only. Development deferred pending data structure overhaul.

## 1. The "hPolish" Concept
The goal of hPolish is to create perfectly flat, sharply defined planar facets on an organic mesh, characteristic of hard-surface models.

### Key Implementation Requirements (Based on Nomad/ZBrush behavior)
*   **Plane Locking**: The core math. The brush calculates its projection plane (normal and center) exactly *once* when the stroke begins (`mousedown` or trigger pull). All subsequent projection during that stroke uses that initial, locked plane.
*   **Area Sampling radius**: Only a tiny fraction of the brush's total radius (e.g., 5%) is used to calculate that initial locked normal. This prevents the normal from being "averaged out" by surrounding curvature, making the cut extremely precise to the point of contact.
*   **Sharp Depth Falloff**: The falloff curve dictating how far vertices are pulled towards the plane should resemble a step function or a very steep exponential drop, ensuring sharp edges rather than smooth grading.
*   **Area Normal Filtering**: Filtering out vertices that face too far away from the locked normal prevents the brush from pulling geometry through thin meshes.

### Mathematical Inspiration
*   **Keenan Crane's "Developability of Triangle Meshes"**: While Crane's variational energy algorithm is global and too heavy for 90fps real-time stroke evaluation, his visual goal—creating perfectly flat, paper-like facets separated by razor-sharp seams—is exactly what the "Plane Lock + Sharp Falloff" approach aims to achieve locally under the brush radius.

## 2. Facegroups and "Global Operations"
To achieve a "machinery" look, workflows often involve tagging regions of faces (Facegroups) and applying flattening algorithms globally or strictly within those bounds.

### Challenges in WebXR
*   **True Global Operations**: Looping over every vertex in a high-resolution mesh to apply a smoothing or flattening algorithm in a single JavaScript frame is computationally prohibitive and will cause latency spikes in VR.
*   **Facegroup Data Structures**: The user correctly identified that true Facegroups require tagging the *faces* (polygons) with IDs, not just vertex colors or masks. 

### WebXR Mitigation Strategy (When Developed)
If/when implemented, rather than true global solves, SculptXR would need to rely on:
1.  **Face-Level Tagging**: Rewriting core data structures to support per-face integer IDs, distinct from vertex colors/materials.
2.  **Boundary-Restricted Brushes**: Tools like `HPolish` or `Smooth` would be updated to check the Facegroup ID of the initial contact point, and explicitly abort operations on any vertices belonging to a face with a different ID, allowing for massive brush strokes that mathematically halt at the painted boundaries.

## Conclusion
Implementation of true facegroups requires data structure changes beneath the current vertex-based painting/masking system. `HPolish` logic is mathematically ready (via duplicating and modifying `Flatten.js`), but is shelved until the broader hard-surface toolset and data requirements are tackled.
