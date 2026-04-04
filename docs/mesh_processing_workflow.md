# Mesh Processing Workflow Notes

When implementing custom geometry operations that recreate a mesh (like `subdivideFlow`), the following steps are required to ensure the mesh replacements correctly reflect application states and don't cause UI lockups or scale anomalies:

## Mesh Replacements Checklist:
1.  **Transform Data**: You must call `newMesh.copyTransformData(oldMesh)`. Otherwise, the new mesh reverts to world space zero scale/translation and becomes tiny or displaced.
2.  **Visual Settings**: Copy over:
    *   `setShaderType(oldMesh.getShaderType())`
    *   `setShowWireframe(oldMesh.getShowWireframe())`
    *   `_isVoxel = oldMesh._isVoxel`
3.  **Adjacency Updates**:
    *   Call `initFaceRings()`
    *   Initialize `initEdges()` **after allocating** `_faceEdges` arrays!
4.  **Buffer Recreations**:
    *   Call `updateGeometry()`
    *   **Crucially**, call `initThreeMesh()` to create a backing Three.js object!

## Gotchas and Edge Cases Encountered:
*   **Winding Order**: Inverting the connection order will result in inverted normals.
*   **Core Loop Dependencies**: Core functions assume `_faceEdges` exist before `initEdges` runs instead of safely initializing if vacant. Use `new Uint32Array(faceCount * 4)`.
