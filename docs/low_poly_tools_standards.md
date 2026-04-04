# Low-Poly Tool Conformation Standards
This document outlines the standard patterns required for all low-poly topology editing tools in SculptXR to ensure Undo/Redo stability and artifact-free rendering.

## 1. Multi-Mesh Resolution Targeting
Always target the base `activeMesh` at the current resolution level rather than the top-level `Multimesh` wrapper:
```javascript
const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
```

## 2. Snapshot-Based Undo/Redo
Replace custom array cloning with the global snapshot methods provided by `SculptBase`:
```javascript
const undoSnapshot = this.captureMeshSnapshot(activeMesh);
// ... mutate mesh ...
const redoSnapshot = this.captureMeshSnapshot(activeMesh);

this._main.getStateManager().pushStateCustom(
  () => this.applyMeshSnapshot(activeMesh, undoSnapshot),
  () => this.applyMeshSnapshot(activeMesh, redoSnapshot)
);
```

## 3. Wireframe Cache Invalidation
Clear the WebGL wireframe caches on both execution and snapshot application to force Three.js to rebuild edges:
```javascript
if (activeMesh._meshData) {
  activeMesh._meshData._drawElementsWireframe = null;
  activeMesh._meshData._drawArraysWireframe = null;
}
```

## 4. Defensive UV Resizing
Before calling `allocateArrays()`, always ensure the UV buffer (`texCoordsST`) is at least as long as `nbVertices * 2` to prevent `RangeError: offset is out of bounds` when copying array data:
```javascript
if (activeMesh.hasUV()) {
  const nbVerts = activeMesh.getNbVertices();
  const nbTex = activeMesh.getTexCoords().length / 2;
  if (nbVerts > nbTex) {
    const newTex = new Float32Array(nbVerts * 2);
    newTex.set(activeMesh.getTexCoords());
    activeMesh.setTexCoords(newTex);
  }
}
```
