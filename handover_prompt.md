# SculptXR Handover Prompt - Split Edge Tool Debugging

---

## Current Situation / Obstacles

We were working on implementing the **Split Edge** tool for low-poly modeling in VR. The goal is to insert a vertex at the midpoint of a shared edge and reconstruct the adjacent faces (quads or triangles) while maintaining manifold integrity and winding order.

### Completed:
1.  **Tool Execution**: Fixed a crash where `getPickedIntersection()` was called instead of `getIntersectionPoint()`. The tool now executes correctly in VR.
2.  **Topology Reconstruction**: Fixed the winding order for quad splitting. It no longer creates twisted "bow-tie" geometry.
3.  **Buffer Resizing**: Defensively expanded `DuplicateStartCount` and `texCoordsST` arrays to support UV-enabled meshes.
4.  **UV Face Mapping**: Updated `facesTexCoord` alongside `facesABCD` to preserve UV indices for old vertices in the new faces.

### Current Blocker:
*   **Dark Shading on Split Edge**: The new center vertex renders as dark/black in the Normals material from all angles. Smoothing or relaxing the mesh causes the dark color to spread to neighbors.
*   **Logs**: The CPU calculates a perfectly valid, normalized normal vector (e.g., `[0.175, 0.565, 0.805]`).
*   **Hypothesis**: The issue lies in how the duplicate vertex pointers are handled when a mesh has UV seams. If the new vertex or split faces fail to map correctly to the duplicate normal array space, the GPU falls back to zeroed normals.

---

## Next Steps / Backlog

*   **UV Seam Investigation**: Trace how duplicates are registered when expanding the topology. If the split edge falls on a UV seam, we might need to duplicate the new vertex in the UV array as well.
*   **Three.js Buffer Sync**: Verify if Three.js fully updates the normals buffer when the attribute array grows in size dynamically.
*   **Fallback Testing**: Try testing the tool on a mesh *without* UVs (like a purely procedural sphere or box without UV mapping) to see if the dark shading persists. If it works there, the issue is strictly in the UV duplicate mapping logic.

Good luck! 🛠️
