# Architectural Critique & Refactor Roadmap

This document captures the "brutal" critique of the current SculptXR architecture, identifying technical debt accumulated during organic growth and providing suggestions for future cleanup.

## The Core Issues (Technical Debt)

### 1. The "Frankenstein" Engine in VoxelWorker
*   **Status**: High performance but high maintenance.
*   **Critique**: `VoxelWorker.js` mixes standard JavaScript, C++ (via Manifold WASM), and Rust (via custom WASM). Tying these three memory spaces together in one file makes debugging extremely difficult.
*   **Risk**: If geometry gets corrupted, tracing the fault across three language boundaries is a nightmare.

### 2. The `Mesh.js` Bridge Performance Cliff
*   **Status**: Functional but inefficient.
*   **Critique**: The file fights Three.js rather than using it. Keeping legacy SculptGL flat arrays and constantly copying them to ThreeJS buffers (`updateDrawArrays`) creates a massive performance bottleneck on high-poly meshes.

### 3. Tool Inheritance Abuse (Subclassing for Convenience)
*   **Status**: Works by coincidence.
*   **Critique**: Low-poly tools (e.g., `SplitFace`, `FillHole`) inherit from `SculptBase` (designed for continuous brush strokes) but mock the behavior by putting all logic in `start()` and setting `continuous = false`.

### 4. Lack of Centralized State
*   **Status**: Spaghetti propagation.
*   **Critique**: UI files like `GuiVRTools.js` directly mutate properties on tool instances. There is no single source of truth, making state changes hard to trace.

---

## Bloated Files & Split Suggestions

Several files have grown too large and are handling too many responsibilities. Here are suggestions for refactoring them:

### 1. `Scene.js` (The "God Object")
*   **Why it's bloated**: It likely handles the core render loop, WebXR session management, desktop input, and VR controller polling.
*   **Split Strategy**:
    *   **`InputXR.js`**: Handle all WebXR controller polling, raycasting, and button state mapping.
    *   **`RenderLoop.js`**: Pure focus on the Three.js render call and timing.
    *   **`Scene.js`**: Keep as the high-level orchestrator holding the Three.js scene graph.

### 2. `VoxelWorker.js` (>1500 lines)
*   **Why it's bloated**: It handles worker message routing, distance field math, Manifold CSG, and Rust remeshing calls all in one file.
*   **Split Strategy**:
    *   **`VoxelCSG.js`**: Specific wrappers for Manifold C++ operations.
    *   **`VoxelRemesh.js`**: Specific wrappers for Rust WASM operations.
    *   **`VoxelWorker.js`**: Keep only as the message listener/router that delegates to the specialized files.

### 3. `GuiVRTools.js` (>1000 lines)
*   **Why it's bloated**: It is a factory for EVERY tool widget in the VR menu.
*   **Split Strategy**:
    *   Split by tool category: `GuiVRMeshTools.js` (standard brushes), `GuiVRVoxelTools.js` (voxel specific), and `GuiVRLowPolyTools.js`.

---

## Summary
The project is a successful **"Kitbash"**. It works well because the intuition was correct, but the abstractions leak. Addressing these points will be necessary before considering a large-scale release or inviting other developers to contribute.
