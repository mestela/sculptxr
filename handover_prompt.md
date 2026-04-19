# SculptXR Handover Prompt

## Current State & Focus
You are stepping into the **SculptXR** project, a WebXR-based sculpting and animation tool.

### 🚀 Active Objective
We just completed a pass on **Desktop Parity for Low Poly Tools**, stabilizing interactions and UI consistency between VR and Desktop modes.

### 🛠 Recent Achievements
- **Undo-Deadlock Resolution (v1.0.215)**: Fixed an issue where `Ctrl+Z` (undo) caused the active tool to revert to Masking by updating `getSelectedTool()` to query `SculptManager` directly.
- **Inset Tool Desktop Support**: Implemented a desktop-specific `sculptStroke()` in `Inset.js` to map vertical mouse drag to inset scale, resolving a runtime error.
- **UI Parity**: Added a "Keep Together" checkbox to the desktop Low Poly UI to match VR behavior for symmetry plane management.
- **Tool Cleanup**: Hidden non-functional or redundant tools (**Split Edge**, **Edge Create**, and **Snap and Weld to Center**) from both Desktop and VR UIs to reduce clutter and confusion.
- **Cut Tool UX**: Enabled the yellow preselection dot and red confirmed cut points on desktop by overriding `preUpdate()` in `CutTool.js`.

### 🔍 Next Steps
1. **Test Extrude with Mask**: The user noted that using Extrude while a mask is active "basically works" but needs more testing.
2. **Verify Other Low Poly Tools**: Further test tools like **Dissolve Vertex** and ensure they behave correctly on desktop.
3. **Resume WebXR Startup Latency Investigation**: Previous sessions were focused on the 5-second "gray void" issue upon entering VR, which might need to be picked up again.

## Context
- **Framework**: Custom framework (historically SculptGL) migrating to Three.js.
- **UI**: Category-based dropdowns on desktop; custom 3D UI (GuiXR) in VR.
- **Low Poly Workflow**: Destructive geometry operations (Extrude, Inset, Cut) supporting ngons (triangles/quads).
