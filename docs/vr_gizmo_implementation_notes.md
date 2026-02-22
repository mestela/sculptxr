# VR Gizmo Implementation & State Management

This document details the implementation of the Transform Gizmo in VR, specifically focusing on the coordinate space logic and the robust Undo/Redo system implemented in v0.7.685.

## 1. Gizmo Architecture

The VR Gizmo (`GizmoVR.js`) is a simplified version of the standard desktop Gizmo, optimized for 6DOF interaction.

### Handle Alignment
In v0.7.685, we replaced hardcoded 90-degree rotations with proper quaternion-based alignment to ensure handles correctly match their logical axes:
- **Translate Arrows**: Aligned to X (Red), Y (Green), Z (Blue).
- **Rotate Rings**: Oriented perpendicular to their respective axes.
- **Scale Cubes**: Placed at the tips of the translation axes.

The alignment uses `quat.rotationTo` to derive the necessary rotation from a default up vector to the target axis direction.

## 2. Undo/Redo & State Management

A critical challenge with the Transform tool is that it modifies the mesh's **World Matrix** and **Center**, rather than just its vertex positions. Standard `StateGeometry` in SculptGL captures vertex indices but does not naturally handle matrix transformations for whole-mesh tools.

### The StateCustom Pattern
To ensure reliable Undo/Redo, we use `StateManager.pushStateCustom`. This allows us to define specific callbacks for both the `undo` and `redo` actions.

#### Implementation Flow (`TransformVR.js`):
1.  **Start of Gesture**:
    - Capture the current world matrix: `mat4.clone(mesh.getMatrix())`.
    - Capture the current mesh center: `vec3.clone(mesh.getCenter())`.
    - Store these as `this._undoMatrix` and `this._undoCenter`.
2.  **End of Gesture**:
    - Capture the *new* matrix and center.
    - Call `pushStateCustom(undoCB, redoCB)`.
    - **Undo Callback**: Sets the mesh matrix and center back to the saved "old" values and triggers a re-render.
    - **Redo Callback**: Sets the mesh matrix and center to the saved "new" values.

### Why not StateGeometry?
`StateGeometry` is ideal for localized brush strokes where only a subset of vertices change. When moving the entire mesh via a gizmo, vertex-level state tracking is either redundant (if only the matrix changes) or insufficient (if the matrix change isn't captured). By using `StateCustom`, we ensure the "pose" of the mesh is perfectly preserved in the undo stack.

## 3. Rendering & Visibility
The Gizmo uses a dedicated render pass with depth testing disabled to ensure it is always visible over the mesh. In v0.7.685, we also ensured that gizmo planes (XY, YZ, XZ) are visible from both sides by adjusting their rendering properties and culling settings.
