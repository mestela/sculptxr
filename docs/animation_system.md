# SculptXR Animation System (DAW)

## 1. Architectural Overview
The VR timeline operates as a **multi-track non-linear mocap sequencer** supporting individual track loops, morph-shape delta overlays, and complete hierarchical scene modifications.

### Core Singletons
- **`window._animationRegistry`**: Main track state store (`Map<MeshID, Track>`). 
- **`GuiVRAnimation` & `GuiXR`**: Render visualization for absolute and real-time transport loop states (`_animLoopStart`, `_animLoopEnd`).

## 2. The `Track` Data Interface
Each mapped internal track supports up to two core keyframe definitions:
```javascript
{
  // --- Shape Key Morph Data ---
  shapeTimes: [0.0, 1.0, ...],     // Array of sequential trigger seconds
  shapes: [Float32Array(..), ...], // Exact Vertex-buffer snapshots

  // --- Matrix Translation Data ---
  times: [0.0, 1.0, ...],
  positions: [x,y,z, ...],
  quaternions: [qx,qy,qz,qw, ...],
  scales: [sx,sy,sz, ...],

  // --- Resting Scene Position ---
  restPos: [x,y,z],
  restQuat: [qx,qy,qz,qw],
  restScale: [sx,sy,sz]
}
```

## 3. Binary Formats (`.sxr`/`.sgl`)
We encode real-time data purely inline via version masks (`hasAnimMask`) inside `ExportSGL.js`:
*   **`Mask & 1` (Shape Keys)**: Extracts floating delta subsets.
*   **`Mask & 2` (Transform Keys)**: Extracts spatial timeline blocks directly appended to the export tail stream.

### Reading Safely
- Import sub-mesh loops gracefully accept minimum available continuous array steps (`minLen >= reqLen`), eliminating optimization mismatches across different LOD stack depths.

## 4. Timeline Editing & Transform Box Interactions
Advanced keyframe editing is facilitated using custom drag handles (`left`, `right`, `center`, `scale_center`) layered natively inside `GuiXR.js`:
- **State Serialization**: Interaction offsets rely explicitly on cached reference snapshots (`this._animTransformInitialBox`, `this._animTransformBoxInitialTimes`). These pointers are strictly purged on pointer release to eliminate frame jumps.
- **Safety Synchronization**: The editing lifecycle dynamically locks tool indexes (`Enums.Tools.GRAB`) continuously to protect complex coordinate projections.
