# SculptXR: Codebase Structure & Post-v1 Analysis

## 1. Overall Codebase Structure

SculptXR is a specialized WebXR fork of the open-source WebGL sculpting app, SculptGL. Because it is highly optimized for real-time vertex manipulation over general-purpose 3D rendering, it operates on a completely bespoke WebGL engine rather than using a popular framework.

The `src/` directory is logically separated by function, though some core files have grown to encompass too many responsibilities.

### Core Architecture
- **`main.js` & `Sculptgl.js`**: The application entry points. `Sculptgl.js` acts as the primary orchestrator, handling high-level UI interactions (Desktop/Mobile), tool switching, keyboard shortcuts, and file loading.
- **`Scene.js` (The God Class)**: At 3,200+ lines, this is the heart of the engine. It manages the WebGL context, the WebXR render loop (`processVRSculpting`, `_renderSceneVR`), scene graph traversal, and input polling from VR controllers.
- **`mesh/`**: Contains the highly-optimized spatial and vertex structures. Features custom classes like `Mesh.js`, `MeshSymmetry.js`, and `Multimesh.js`. Uses flat typed arrays (`Float32Array`) to bypass object-allocation overhead during sculpting.
- **`editing/`**: The sculpting tool logic. `SculptManager.js` delegates to individual tools (e.g., `Brush.js`, `Move.js`, `TransformVR.js`). Voxel remeshing is primarily handled here and offloaded via Web Workers.
- **`math3d/`**: Contains core matrix/vector helpers (`Geometry.js`) and the vital `Picking.js`, which handles all spatial intersection (Raycasting, Octree Sphere intersections) for UX targeting.
- **`render/`**: The bespoke WebGL wrapper (`ShaderBase.js`, `Buffer.js`) and raw GLSL shader code for PBR, Matcaps, and wireframes. 
- **`states/`**: Implements the Undo/Redo stack, saving discrete vertex or topological differences rather than full mesh copies for memory efficiency.
- **`workers/`**: Off-main-thread processing, most notably `VoxelWorker.js` which performs heavy marching-cubes volume recalculations without hanging the VR headset.

---

## 2. Bespoke Setup vs. Standard Three.js

### Pros of this Setup
1. **Raw Performance**: Every byte of memory is accounted for. By using raw typed arrays (e.g., `vAr`, `nAr`, `cAr`) directly, the engine avoids the massive Javascript garbage collection overhead that a typical hierarchical Three.js scene graph would trigger during millions of vertex updates per second.
2. **Specialized Tools**: Because the engine and the tools are unified, complex systems like Topological Symmetry mapping, localized Octree rebuilding, and Voxel surface extraction do not need to fight against an intermediary generic abstraction layer.
3. **Instantaneous Render Updates**: When a vertex is moved in memory, the bespoke `render/Buffer.js` can perform ultra-fast localized `gl.bufferSubData` uploads to the GPU without dirty-flag checking an entire scene tree.

### Cons of this Setup
1. **Steep Learning Curve**: Because $100$% of the matrix math, GL state management, and projection math is manual, diagnosing coordinate space bugs (e.g., Controller vs. Model Space) requires diving deep into linear algebra.
2. **No Ecosystem / Reinventing the Wheel**: Basic features like importing new file formats (GLTF), adding post-processing (Bloom, MSAA), or managing basic textures require writing everything from scratch.
3. **God Classes & Tight Coupling**: `Scene.js` and `Sculptgl.js` are monolithic. State is often shared globally or explicitly passed down immense call chains, making the codebase fragile.

---

## 3. Post-v1 Improvements & Tech Debt

Once the v1.0 milestone (stability & bugfixes) is achieved, the architecture should be modernized to increase maintainability.

### A. Modularize the Monoliths
- **Split `Scene.js`**: `Scene.js` handles too much. It should be refactored into distinct managers:
    - `XREngine.js`: Handles XR session lifecycle, controller polling, and projection matrices.
    - `RenderPipeline.js`: Handles the discrete render passes (Opaque, Transparent, Gizmo overlays).
    - `InputManager.js`: Harmonizes desktop mouse raycasting and VR laser raycasting.
- **Dependency Injection**: Stop hardcoding `this._main._scene` lookups deep inside tools.

### B. Technical Debt Cleanup
- **Stray Files**: There are backup files cluttering the `src/` directory (`Scene_master.js`, `Scene_v74.js`, `Scene_v75.js`, `Scene.chk.mjs`). These need to be deleted as Git handles version control.
- **Unify Transform Tools**: `Transform.js` (Desktop) and `TransformVR.js` (XR) and `Gizmo.js` / `GizmoVR.js` have overlapping but disjointed logic. They should be unified behind a single `TransformController` that consumes generic pointer inputs regardless of the device.

---

## 4. Low Hanging Fruit (Immediate Post-v1 Attacks)

1. **Delete Dead Code**: Purge all the rogue `Scene_*.js` backups. Remove dead, commented-out debugging blocks (like the hundreds of `window.screenLog` iterations we disabled).
2. **Types & Tooling**: 
    - The project uses Webpack to bundle raw JS. Converting the files to **TypeScript** (or adding JSDoc types) is the highest priority. It would catch 90% of the runtime `cannot read property of undefined` bugs we encountered during the VR port.
    - Migrate from older Webpack to **Vite** for near-instant hot module reloading during development.
3. **Centralized Logger**: Replace manual `console.log` and `window.screenLog` calls with a dedicated `Logger.js` utility. This allows for verbose debugging in development and zero overhead in production, without needing to manually comment out lines.
4. **Standardize Naming**: The codebase switches between `picking`, `pickingSym`, `picker`, and `intersect`. A brief naming standardization pass would dramatically improve readability for future edge-case debugging.
