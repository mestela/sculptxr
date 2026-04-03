# SculptXR Architectural Overview

This document provides a high-level summary of the SculptXR codebase, focusing on the interactions between core systems, the Three.js rendering pipeline, and WebXR integration.

## Architecture & Data Flow

SculptXR follows a top-down delegation pattern for handling interactions, especially in VR:

1.  **Input Gathering (`Scene.js`)**: Captures WebXR controller poses, handles raycasting against the UI, and packages controller button states.
2.  **Dispatch (`SculptGL.js` & `SculptManager.js`)**: Forwards input data to the active tool instance.
3.  **Execution (`SculptBase.js` & Subclasses)**: The active tool processes the input.
    *   **Continuous Stroke Tools**: (e.g., Brush, Smooth) Sample positions along the controller path and apply localized deformation.
    *   **One-Shot Click Tools**: (e.g., SplitFace, Weld) Execute their logic entirely within the `start()` method on initial trigger press, ignoring the continuous stroke.
4.  **Heavy Lifting (`VoxelWorker.js`)**: Complex operations (Voxel remeshing, CSG Booleans, Symmetry Mirroring) are offloaded to a worker thread to maintain high frame rates in VR.
5.  **Rendering Bridge (`Mesh.js`)**: Converts the internal quad/triangle data structures into flat arrays suitable for Three.js GPU buffers and handles matrix synchronization with WebXR.

---

## Tool Registry & VR Status

Instead of listing all 25 tools individually, they are categorized by their architectural behavior in VR.

### Standard Stroke Tools
These tools inherit the default continuous stroke behavior from `SculptBase` without modification. They work reliably by sampling the controller path in physical space.
*   `Brush`, `Inflate`, `Smooth`, `Flatten`, `Pinch`, `Crease`, `Relax`, `Masking`, `LocalScale`.

### One-Shot Click Tools (Low-Poly)
These tools inherit from `SculptBase` but set `_continuous = false` and do not implement `stroke()`. They execute their operation once on trigger press based on the picked element.
*   `DeleteFace`, `FillHole`, `DissolveEdge`, `SplitFace`, `SpinEdge`, `CollapseEdge`, `DissolveVertex`, `Weld`.

### Special Cases (Overridden `updateXR`)

| Tool | Status | Key Behavior / Complexity |
| :--- | :--- | :--- |
| **`Twist`** | VR Supported | Overrides `updateXR` for a continuous "Drill Mode" rotation effect. |
| **`Drag`** | VR Supported | Calculates 3D delta from controller movement. Uses symmetry plane blending to prevent tearing. |
| **`Paint`** | VR Supported | Manages a state machine for the VR Eyedropper and live color sampling. |
| **`Move`** | VR Supported | Full 6DOF movement. Forces full octree rebuilds on completion. |
| **`TransformVR`** | VR Supported | Provides a dedicated 3D gizmo for precise Translate/Rotate/Scale in VR. |
| **`SculptVoxel`** | VR Supported | Communicates with `VoxelWorker`. Handles volume advection and custom trigger pressure curves. See modes below. |
| **`Transform`** | **Desktop Only** | The VR update method is a safety stub to prevent crashes. |

---

## The Voxel Sculpting Tool (`SculptVoxel.js`)

Unlike standard mesh brushes, the `Voxel` tool operates as a multi-mode sub-engine within a single tool slot. It delegates heavy lifting to `VoxelWorker.js` and supports the following modes (selectable in the VR HUD):

*   **Add / Subtract**: Mutates the distance field by combining sphere or cube signed distance functions (SDFs).
*   **Inflate / Deflate**: Shifts the isosurface outwards or inwards along the gradient.
*   **Smooth**: Applies a localized 3D blur to the distance field to soften edges.
*   **Move**: The most complex mode. It uses **Volumetric Advection** (multi-step ODE Euler integration) to shift volume according to controller movement without losing mass or causing tearing.

---

## Core System Summaries

### VR UI: `GuiVRTools.js`
*   **Role**: A factory that generates UI controls (buttons, sliders, comboboxes) for the active tool in VR.
*   **Key Logic**:
    *   **Dynamic HUD**: Exposes specialized controls based on the active tool (e.g., axis constraints for `TransformVR`, resolution settings for `Voxel`).
    *   **Mini-HUD Support**: Contains optimized, compact layouts for controller-attached UI.
    *   **Direct Mutation**: Callbacks directly set properties on the active tool instance.

### Mesh Pipeline: `Mesh.js`
*   **Role**: Bridges SculptGL data structures with Three.js rendering.
*   **Key Logic**:
    *   **Three.js Integration**: Constructs `THREE.Mesh` and implements a custom wireframe shader using `gl_FragDepth` to stop depth fighting.
    *   **Matrix Sync**: Disables Three.js `matrixAutoUpdate` and manually pushes engine transforms to ensure WebXR alignment.

### Voxel & Topology Pipeline: `VoxelWorker.js`
*   **Role**: Asynchronous engine for heavy geometry operations.
*   **Key Logic**:
    *   **Hybrid Engine**: Uses `manifold-3d` (C++ via WASM) for robust booleans and a custom Rust module for advanced quad remeshing.
    *   **Greedy Quadrangulation**: Contains a custom port of Blender's `quad_calc_error` metric to merge triangles back into clean quads after destructive operations.
    *   **Worker History**: Maintains a local stack of distance fields to allow instant Undo/Redo of voxel operations without main-thread roundtrips.
