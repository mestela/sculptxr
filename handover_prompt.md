# Handover: Voxel Undo/Redo FIXED (v0.7.335)

## Current Status
- **Goal:** Polish Voxel Undo/Redo (Fix Erratic Behavior).
- **Latest Version:** `v0.7.335` (Deployed to Beta).
- **Status:** **FIXED**.
  - **Undo/Redo**: Works reliably.
  - **Input**: Left Thumbstick Left/Right (No Debounce).
  - **Logic**: "Smart Undo" handles both Reset and Step Back. Active strokes are auto-saved to Redo stack.

## Solutions Implemented
1.  **Smart Undo**: Distinguishes between "Reset Active Stroke" and "Step Back History".
2.  **Snapshot-on-Dirty**: Undoing an active stroke saves it first, allowing Redo.
3.  **Correct Pointer Arithmetic**: Fixed off-by-one error in `historyPtr` management.

## Next Steps
-   **Voxel Features**: Brush Shapes? Smooth Tool?
-   **Rendering**: improve voxel mesh shading?
-   **Performance**: optimize meshing for large volumes?

## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
-   **Local:** `npm run dev` (port 8000).