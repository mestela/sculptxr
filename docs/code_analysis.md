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
## 5. Feasibility of a Three.js Port

Given the goal of stabilizing for v1 and looking forward to the future architecture, a major question is: **Should SculptXR be ported to Three.js?**

The short answer is: **No, it is highly undesirable for a sculpting app targeting standalone VR.**

Here is a breakdown of why sticking with the bespoke engine, despite its tech debt, is the correct choice for this specific class of application.

### The Core Conflict: Scene Graph vs. Immediate Mode

Three.js is a general-purpose 3D rendering framework built around a **Scene Graph**. It excels at managing hierarchies of objects, complex material pipelines, and rendering static or rigidly animating meshes.

SculptXR is an **immediate-mode vertex editor**. The "mesh" is not a static asset; it is a highly volatile array of hundreds of thousands of floats that is mutating 90 times a second.

#### 1. The Cost of Abstraction (Garbage Collection)
In Three.js, updating a mesh typically involves modifying a `BufferGeometry` object. While Three.js allows you to update the underlying `Float32Array` attributes and flag them with `needsUpdate = true`, the framework's internal architecture still performs significant overhead:
*   **Bounding Box/Sphere Recalculation:** Three.js automatically recalculates bounding volumes for frustum culling when geometry changes. For a 1-million polygon mesh being sculpted, doing this every frame in JavaScript is devastating. SculptXR handles this by only loosely updating localized Octree nodes.
*   **Raycasting Overhead:** Three.js's built-in `Raycaster` builds a BVH (Bounding Volume Hierarchy) or iterates through triangles. On a mutating mesh, rebuilding a standard Three.js BVH every frame is impossible on a Quest 3. SculptXR uses a highly specialized, localized Octree that updates only the sculpted regions.
*   **Memory Churn:** Three.js creates many small objects (Vector3s, Quaternions, Matrices) internally during its render loop and updates. In a 90Hz VR environment, this constant object allocation triggers JavaScript Garbage Collection (GC) pauses. A 5ms GC pause in VR is visually perceived as a jarring stutter or "dropped frame." SculptXR mitigates this by aggressively reusing pre-allocated `Float32Array` buffers for all mathematical operations.

#### 2. The Bottleneck: CPU-to-GPU Uploads
When transferring modifying geometry to the GPU, minimizing bandwidth is critical.
*   **Three.js:** When you flag `geometry.attributes.position.needsUpdate = true`, Three.js (typically) uploads the *entire* vertex buffer to the GPU via `gl.bufferData`. If you have a 500k vertex mesh, you are transferring ~6MB of data 90 times a second, which will instantly choke a mobile GPU's memory bus.
*   **SculptXR:** The bespoke `render/Buffer.js` is optimized for **localized updates**. It calculates the exact byte offset and length of the vertices that were modified during the current stroke and uses `gl.bufferSubData` to upload only that tiny chunk (e.g., 50 vertices). This is the secret sauce that makes high-poly sculpting possible on a mobile chipset.

#### 3. WebGL State Management
Three.js abstracts WebGL state (depth testing, blending, culling). While powerful, this abstraction comes with CPU overhead as the renderer traverses the scene graph and determines state changes. SculptXR's rendering pipeline (`processVRSculpting`, `_renderSceneVR`) explicitly hardcodes the GL state machine for maximum efficiency.

### Conclusion: The Standalone VR Reality

PCVR has the brute-force CPU power and memory bandwidth to potentially overcome the overhead of a Three.js port. However, standalone headsets like the Meta Quest 3 and GalaxyXR operate within strict thermal and power limits. They rely heavily on fixed-function hardware and specialized rendering paths (like Application SpaceWarp).

A general-purpose framework like Three.js adds a layer of abstraction that, while fantastic for traditional games or architectural visualizers, fundamentally conflicts with the micro-second tolerances required for real-time vertex displacement on lower-power mobile SOCs.

The tech debt in SculptXR (`Scene.js` monolith, lack of typescript) should be addressed by refactoring the *existing* engine into cleaner, modular components, rather than throwing the engine away for a framework that isn't built for this niche use case.
