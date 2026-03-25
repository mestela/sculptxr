# Handover Prompt - Transform Gizmo Port (Three.js)

**Project Status**: **Transform Gizmo Stabilized (Three.js) / WebXR Controllers Fixed**

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Branch**: `threejs_voxel_branch`

---

## Recent Work (Previous Session Recap)

1. **Transform Gizmo Port (Three.js)**: We successfully ported the legacy WebGL Transform Gizmo to the Three.js scene graph. It now correctly follows the selected mesh during translation, rotation, and scaling.
2. **Gizmo Scale & Selection**: Resolved issues where the gizmo disappeared or became misaligned by ensuring proper matrix updates (`_pickGeo.getMatrix()`) and adjusting picking radius (`radiusMeters = 0.02 * scaleFactor`). The gizmo now scales up and down with the world (double grip).
3. **Debug Console**: Added a global `window.debugGizmo` object for console-based inspection and toggling.

---

## Current Situation / Obstacles

The Transform Gizmo is now functional and synchronized with the Three.js scene graph. The application geometry and immersive mode are stable. A minor visual tweak might still be needed for the planes (transparency/opacity), but the core functionality is solid.

---

## Next Steps for the New Agent

1.  **Consult `docs/threejs_todo.md`**
    *   The user explicitly requested to pick the next task from the **"Todo misc"** section.
2.  **Top Candidates for Next Session:**
    *   **Paint Mode**: The standard object Vertex Painting mode is currently disabled and needs re-wiring.
    *   **Voxel Refine**: Restore auxiliary Voxel tools (bake, move, smooth normals, voxel paint).
    *   **Local Storage**: `IndexedDB` implementation for saving user preferences or local projects between sessions.
3.  **Review the Work Environment**
    *   Ensure Vite is running `npm run dev`.
    *   Wait for the user's direction on which specific `misc` Todo item to tackle first.

---

Good luck! 🛠️
