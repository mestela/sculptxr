# Implementation Plan: Graph Editor VR Parity

This document outlines the inventory of features in the Desktop Graph Editor and the plan to achieve full parity in the VR interface.

## Inventory of Desktop Graph Editor Features

*   [*] **Decoupled View Bounds**: `_viewStart` and `_viewDuration` are separate from loop bounds, allowing zooming in on specific time segments.
*   [*] **2D Pivot Zoom**: Scaling around the click position in both time and value axes.
*   [*] **Panning**: Moving the view in both time and value axes.
*   [*] **Curve Rendering**: Smooth cubic Bezier interpolation for position channels (X, Y, Z) with a binary search solver for even time stepping.
*   [*] **Key Rendering**: Dots at keyframes, color-coded for selection (Yellow) and hover (Cyan).
*   [x] **Tangent Handles**: Rendering and interactive editing of handles to adjust curve slopes.
*   [x] **Marquee Selection**: 2D box selection with live highlight of keys during drag. (Selection undo implemented).
*   [x] **2D Transform Box**: Scaling and translating selected keys in both time and value.
*   [*] **Auto Fit**: Automatically scaling and panning the view to fit all keys of the active mesh.
*   [*] **Undo/Redo Support**: Custom undo states for selection changes and transform operations to handle index shifting. (Transform and Marquee Selection undo implemented).

## Current Status in VR

*   **Decoupled View Bounds**: Implemented (uses `window._animViewStart` and `window._animViewDuration`).
*   **2D Pivot Zoom**: Implemented and verified working by user.
*   **Panning**: Implemented and verified working by user (using A button). Works for both left and right-handed modes.
*   **Curve Rendering**: Implemented in `_drawGraphTimeline`.
*   **Key Rendering**: Implemented, including hover highlight (Cyan) added recently.
*   **Tangent Handles**: Rendering implemented. Basic hit-testing and dragging added but needs verification.
*   **Marquee Selection**: Implemented in 2D. Respects mode (Add/Remove). Live highlight during drag is missing. Selection undo implemented.
*   **2D Transform Box**: Bounds computation on marquee finalize added. Hit-testing for handles and dragging logic added but needs verification.
*   **Auto Fit**: Implemented recently (`autoFitGraphTimeline`) and wired to mode switch.
*   **Undo/Redo Support**: Full support for key moves and marquee selection in Graph mode, using time-based lookups and state snapshots to prevent index corruption.

## Action Plan for Full Parity

1.  **Verify Transform Box**: Ensure that the 2D transform box handles are easily grabbable in VR and that scaling in both axes works correctly.
2.  **Add Live Highlight to Marquee**: Update `_drawGraphTimeline` to highlight keys in yellow *during* the marquee drag if they are inside the current marquee bounds.
3.  **Add Selection Undo**: Push custom undo states when selection changes via click or marquee.
