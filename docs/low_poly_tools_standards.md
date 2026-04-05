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
When adding new vertices in a mesh with UVs (`activeMesh.hasUV()`), you must grow the UV buffer (`texCoordsST`) and duplicate count buffer (`verticesDuplicateStartCount`) to match the new vertex count, even if it was smaller before. Failure to do so will cause `allocateArrays()` to throw `RangeError: offset is out of bounds` due to internal size assumptions.

Example:
```javascript
if (activeMesh.hasUV()) {
  const texCoordsST = activeMesh.getTexCoords();
  if (texCoordsST) {
    const newTexCoordsST = new Float32Array(texCoordsST.length + 2);
    newTexCoordsST.set(texCoordsST);
    newTexCoordsST[newVIdx * 2] = 0;
    newTexCoordsST[newVIdx * 2 + 1] = 0;
    activeMesh.setTexCoords(newTexCoordsST);

    const dupCW = activeMesh.getVerticesDuplicateStartCount();
    if (dupCW) {
      const newDupCW = new Uint32Array(dupCW.length + 2);
      newDupCW.set(dupCW);
      activeMesh.setVerticesDuplicateStartCount(newDupCW);
    }
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
```
