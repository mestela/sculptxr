# Low-Poly Tool Conformation Standards
This document outlines the standard patterns required for all low-poly topology editing tools in SculptXR to ensure Undo/Redo stability and artifact-free rendering.

## 1. Multi-Mesh Resolution Targeting
Always target the base `activeMesh` at the current resolution level rather than the top-level `Multimesh` wrapper:
```javascript
const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
```

## 2. Snapshot-Based Undo/Redo
Replace custom array cloning with the global snapshot methods provided by `SculptBase` when possible. **However, beware the Garbage Pitfall**:

*   **The Garbage Pitfall**: `captureMeshSnapshot` copies the *entire physical buffer* of the mesh arrays (faces, vertices, etc.). SculptXR uses large pre-allocated capacity buffers that often contain garbage data at the end (beyond `nbFaces` or `nbVertices`). If you capture a snapshot of a grown mesh and then restore it, this garbage data can leak back into active use by systems that rely on array length (like wireframe generation), causing ghost geometry or collapses to the origin.

*   **Best Practice for Growing Meshes**: If your tool adds vertices or faces, manually capture the snapshot by slicing the arrays to only include the active ranges:
```javascript
const undoSnapshot = {
  faces: new Uint32Array(activeMesh.getFaces().subarray(0, activeMesh.getNbFaces() * 4)),
  vertices: new Float32Array(activeMesh.getVertices().subarray(0, activeMesh.getNbVertices() * 3)),
  colors: activeMesh.getColors() ? new Float32Array(activeMesh.getColors().subarray(0, activeMesh.getNbVertices() * 3)) : null,
  materials: activeMesh.getMaterials() ? new Float32Array(activeMesh.getMaterials().subarray(0, activeMesh.getNbVertices() * 3)) : null,
  facesTexCoord: activeMesh.getFacesTexCoord() ? new Uint32Array(activeMesh.getFacesTexCoord().subarray(0, activeMesh.getNbFaces() * 4)) : null,
  nbFaces: activeMesh.getNbFaces(),
  nbVertices: activeMesh.getNbVertices()
};
// Save UVs too if applicable!
if (activeMesh.getTexCoords()) {
  undoSnapshot.texCoords = new Float32Array(activeMesh.getTexCoords().subarray(0, activeMesh.getNbTexCoords() * 2));
}
```
Then restore manually or via custom callbacks.

## 3. Wireframe Cache Invalidation
Clear the WebGL wireframe caches on both execution and snapshot application to force Three.js to rebuild edges. Crucially, you must also clear or reset the `_edges` array to prevent stale edges from referencing non-existent vertices on undo:
```javascript
if (activeMesh._meshData) {
  activeMesh._meshData._drawElementsWireframe = null;
  activeMesh._meshData._drawArraysWireframe = null;
  // Force computeWireframe to see that edges need rebuilding!
  activeMesh._meshData._edges = new Uint8ClampedArray(0);
}
```

## 4. Defensive UV Resizing & Synchronization
When adding new vertices in a mesh with UVs (`activeMesh.hasUV()`), you must grow the UV buffer (`texCoordsST`) synchronously with the vertex buffer to match the new vertex count. 

*   **The Truncation Pitfall**: Historically, `Mesh.allocateArrays()` would truncate the physical vertex storage arrays to match the size of the UV array if UVs existed. If you added 4 vertices but didn't add 4 UVs, the physical storage for those vertices was discarded, leading to out-of-bounds WebGL errors and mesh blackouts. While we have patched `allocateArrays` to use the maximum of both counts, keeping them in sync avoids undefined behavior.
*   **GPU Alignment**: WebGL expects aligned attribute buffers. Always ensure new vertices get valid (even if default `[0,0]`) UV coordinates.

Example of synchronous expansion:
```javascript
if (activeMesh.hasUV()) {
  const texCoordsST = activeMesh.getTexCoords();
  if (texCoordsST) {
    const newTexCoordsST = new Float32Array((oldNb + newCount) * 2);
    newTexCoordsST.set(texCoordsST);
    // Fill new UVs...
    activeMesh.setTexCoords(newTexCoordsST);
  }
}
```

## 5. Translation Strings
Always add the appropriate translation string in `src/gui/tr/english.js` for the tool's `uiName` (defined in `Tools.js`). Failure to do so will flood the logs with warnings from `GuiTR.js`.

## 6. Helper Geometry
In the Three.js port of SculptXR, meshes are typically added to `this._main._worldGroup` to inherit the world transform (position, rotation, scale) applied by the user in VR. When adding helper geometry (like indicators), you should add them to `_worldGroup` if available, otherwise fallback to the Three.js scene.

Example:
```javascript
const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
let targetScene = sceneApp;
if (sceneApp && sceneApp._scene) {
  targetScene = sceneApp._scene;
}

// Add to worldGroup if available to inherit transform
let parentNode = targetScene;
if (this._main._worldGroup) {
  parentNode = this._main._worldGroup;
}

parentNode.add(helperMesh);
```
If you add to the root scene directly while the local coordinates are in `_worldGroup` space, the helper will appear way off in the distance due to missing offset transforms!
## 7. Accurate Vertex Counting
When modifying topology, avoid relying on relative additions like `setNbVertices(getNbVertices() + newCount)` at the end of long operations. Stale references or concurrent state reads can cause this addition to result in the wrong final count.

*   **Best Practice**: Store the initial count (e.g., `let nbVertices = activeMesh.getNbVertices()`) at the start, increment it strictly as you create new vertices, and pass that absolute counter directly to `activeMesh.setNbVertices(nbVertices)`. This ensures that you are setting exactly what you tracked, ignoring potential background changes.
