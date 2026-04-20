# SculptXR Handover Prompt

## Current State & Focus
You are stepping into the **SculptXR** project, a WebXR-based sculpting and animation tool.

MANDATORY: You MUST read `docs/overview.md` and `docs/code_summaries.md` for context on the overall project before responding. NO EXCEPTIONS.

### 🚀 Active Objective
We just completed a pass on **Wireframe Rendering Controls on Desktop**, adding live sliders for opacity and bias, and fixing the z-fighting issue with a geometric bias approach.

### 🛠 Recent Achievements
- **Geometric Wireframe Bias (v1.0.216)**: Replaced the unreliable shader-based clip-space bias with a geometric vertex offset along normals, successfully preventing z-fighting on desktop.
- **Wireframe Opacity Slider**: Added a live wireframe opacity slider to the desktop rendering menu and grouped all wireframe controls together.
- **Desktop Defaults**: Set default wireframe opacity to 0.25 and bias to 0.001 for desktop interface.
- **Undo-Deadlock Resolution (v1.0.215)**: Fixed an issue where `Ctrl+Z` (undo) caused the active tool to revert to Masking by updating `getSelectedTool()` to query `SculptManager` directly.
- **Inset Tool Desktop Support**: Implemented a desktop-specific `sculptStroke()` in `Inset.js` to map vertical mouse drag to inset scale, resolving a runtime error.
- **UI Parity**: Added a "Keep Together" checkbox to the desktop Low Poly UI to match VR behavior for symmetry plane management.
- **Tool Cleanup**: Hidden non-functional or redundant tools (**Split Edge**, **Edge Create**, and **Snap and Weld to Center**) from both Desktop and VR UIs to reduce clutter and confusion.

### 🔍 Next Steps
no agenda

## Context
- **Framework**: Custom framework (historically SculptGL) migrating to Three.js.
- **UI**: Category-based dropdowns on desktop; custom 3D UI (GuiXR) in VR.
- **Low Poly Workflow**: Destructive geometry operations (Extrude, Inset, Cut) supporting ngons (triangles/quads).
