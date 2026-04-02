# SculptXR Handover Prompt

---

## Current Situation / Obstacles

We have finalized the **Persistent Browser Gallery and Thumbnail Pipeline** for WebXR. The system now allows users to save sculpts to IndexedDB, view them in a standalone pop-out gallery, and see high-fidelity thumbnails framed auto-magically.

### Key Achievements this Session:

1.  **Visually Rich Browser Gallery**:
    *   Decoupled the load gallery from the main files menu. It now pops open as a beautiful floating overlay that stays open during interactions.
2.  **Auto-Fitting Smart Thumbnails in WebXR**:
    *   Implemented a transient central headset camera (no eye offsets) that looks directly at the bounding box center of your sculpt.
    *   **Auto-FOV**: Dynamically computes the distance to fit the max dimension of the object into frame with padding! 
    *   **UI Sweep**: Automatically sets `visible = false` for ALL scene children except the mesh and lights, ensuring ultra-clean screens snaps with no controllers or HUDs visible.
    *   **Synchronous Gamma Correction**: Feeds through an offscreen 2D canvas with CSS filters `contrast(1.4) brightness(0.8) saturate(1.2)` to fix linear export desaturation washouts!
3.  **UI State Restoration Fixes**:
    *   Resolved a legacy typo (reading from `main.getGui()._uiXR` vs `main.getGuiXR()`) that was resetting user sliders (Head Height, Opacity) back to defaults on redraw.
4.  **Deployment Resilience**:
    *   Solved `<DOCTYPE html>` 404 wasm streaming errors in subdirectories. The deploy script now copies `manifold.wasm` to the dist root, and the WebWorker finds it dynamically using relative parent URL math (`../manifold.wasm`).

---

## Next Steps / Backlog

The following items are ready to be picked up from `docs/threejs_todo.md`:

0. **Controler stylus tip adjust**: its too long and too far away for PCVR, it should be user configurable and pick a better default. Ask user for details. 
1.  **Desktop Modes & Spectator Cam**:
    *   Reimplement spectator views utilizing the multi-pass camera render tech we built for thumbnails.
2.  **UI Migration (`three-mesh-ui`)**:
    *   Begin moving the raw canvas overlays to true Three.js UI components.
3.  **Floating VR Keyboard Integration**.
4.  **Box Modeling Tools Integration** (Kokraf).

Good luck! 🛠️
