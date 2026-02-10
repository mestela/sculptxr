# Investigation: Left-Handed Mode Support

## Status
**Feasible**, but requires careful refactoring of input handling logic.

## Current Implementation
The codebase currently hardcodes "Right Hand" as the Dominant/Active hand for:
1.  **Menu Interaction**: Raycasting and clicking UI.
2.  **Sculpting**: Brush position tracks the Right Controller.
3.  **Tool Shortcuts**: 
    -   Right Joystick (Up/Down) = Radius Adjustment.
    -   Left Joystick (Left/Right) = Undo/Redo.

## Required Changes
To support a user-toggleable "Left-Handed Mode", we need to abstract the handedness checks.

### 1. State Management
-   Add `this._primaryHand` (defaults to `'right'`) and `this._secondaryHand` (defaults to `'left'`).
-   Add a UI toggle in `GuiXR` (Settings tab) to swap these values.

### 2. Input Handling (`Scene.js`)
Replace hardcoded checks in `handleXRInput`:

```javascript
// BEFORE
if (source.handedness === 'right') { /* Raycasting, Sculpting */ }
if (source.handedness === 'left') { /* Undo/Redo */ }

// AFTER
if (source.handedness === this._primaryHand) { /* Raycasting, Sculpting */ }
if (source.handedness === this._secondaryHand) { /* Undo/Redo */ }
```

### 3. Controller Visualization
-   The *models* should stay matching physical hands (Left model on Left hand).
-   But the *tool tip* (brush cursor) must attach to the `_primaryHand` mesh.
-   Currently, `_vrControllerRight` is assumed to be the brush. We might need a logical alias `_vrControllerActive`.

### 4. Tool Logic
-   Audit `SculptVoxel.js` and `SculptBase.js` for references to `_vrControllerRight`.
-   Replace with `_main.getActiveController()` or similar accessor.

## Risk & Effort
-   **Risk**: Moderate. Regression potential for Right-Handed users if abstraction leaks or logical/physical mismatch occurs.
-   **Effort**: ~2-4 hours to implement and verify (especially testing all tool interactions).

## Recommendation
Implement as a dedicated task after QoL fixes are stable.
