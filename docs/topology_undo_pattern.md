# Topology Undo/Redo Stable Patterns (SculptGL Context)

When writing tools that wholistically modify a mesh's topology (such as **Symmetry Mirroring**, **Weld and Union**, or **Voxel Remeshing**), standard in-place property mutations can lead to scrambled geometry on successive Undo/Redo cycles.

Here is a guide on how to avoid this behavior and implement stable **Wholistic Object Swapping** Undo stacks.

---

## 🛑 The Hidden Pitfalls of In-Place Mutation

In-place mutations (where you overwrite `mesh.setVertices` and `mesh.setFaces` directly on the active object) are prone to data corruption because SculptGL's `.init()` method has hidden side-effects:
1. **Index Reordering (`Mesh.OPTIMIZE`)**: If optimization is active, `.init()` rearranges face indices cache-friendly. When you press *Redo* again later, your saved faces apply to shuffled vertices — yielding scrambled geometry!
2. **Buffer Splitting (UV Islands)**: If you possess UV splits, `.init()` pads arrays to match split islands. If you later overwrite positions with worker-exact coordinate lengths, you break these island offsets.
3. **Array Resizing (Colors/Materials)**: Overwriting vertices alters pointer length bounds. Other traits (like Vertex Colors) assume the old length schema and can cause WebGL read violations.

---

## ✅ The Solution: Wholistic Object Swapping

Instead of injecting array pointers into the existing object, **create a fresh one and swap references** within standard scenes. This allows both objects to remain deep-history independent in memory.

### Step 1: Initialize a Fresh Workspace
When receiving worker data, do not overwrite `mesh._meshData`. Instead, create a deep-copy object.

```javascript
// Inside SculptManager.js handler:

const newMesh = new MeshStatic(this._main._gl);
newMesh.setVertices(data.v);
newMesh.setNbVertices(data.v.length / 3);
newMesh.setFaces(data.f);
newMesh.setNbFaces(data.f.length / 4);
newMesh.isQuad = true;

newMesh.init();
newMesh.initRender();

// Inherit stylistic parameters
if (mesh.getMaterial) newMesh.setMaterial(mesh.getMaterial());
newMesh.visible = mesh.visible;
```

### Step 2: Define and Push Swap Closures

SculptGL uses custom `pushStateCustom(undo, redo)` to swap objects inside `_meshes` scene pools without duplicate references.

```javascript
const undoReplace = () => {
  this._main.replaceMesh(newMesh, mesh); // Swap new back to old
  if (this._main.guiXR) this._main.guiXR.refreshSceneWidget();
};

const redoReplace = () => {
  this._main.replaceMesh(mesh, newMesh); // Swap old forward to new
  if (this._main.guiXR) this._main.guiXR.refreshSceneWidget();
};

// Execute Immediately
redoReplace();

// Push to Stack
this._main.getStateManager().pushStateCustom(undoReplace, redoReplace);
```

---

## 🔍 How to Debug Shifts

If you encounter successive scrambling, **Telemetry** is your friend. Read exact lengths determined by `.getNbVertices()` and `.getNbFaces()` to skip WebGL padding reads:

```javascript
const oldFaces = new Uint32Array(mesh.getFaces().subarray(0, mesh.getNbFaces() * 4));
const oldVerts = new Float32Array(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));

console.log(`[UndoPattern] Captured: v=${oldVerts.length/3} f=${oldFaces.length/4}`);
```
