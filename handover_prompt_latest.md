# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.282 (BETA) - Experimental 6DOF (Work In Progress)
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.282` deployed to `sculptxrbeta`.

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Refining Desktop 6DOF Mode (Spectator Mirror)
We are refining the **Desktop 6DOF Mode** (Spectator View).
The goal is to allow a user to use the VR controllers while looking at their monitor (headset on desk).
We have implemented:
1.  **Spectator View**: Renders the scene from an orbit camera on the desktop while VR is active.
2.  **Toggle**: 'D' key toggles this mode.
3.  **Basic Controls**: Single-grip rotation (pivoted on controller) and zoom/pan.
4.  **Sensitivity Tuning**: 1:1 Rotation and distance-based Pan/Zoom.
5.  **Clipping Fix**: Reduced near plane to `0.01` to help visibility.

## Critical Issues (Immediate Attention Required)
> [!CRITICAL]
> **VR INTERACTION BROKEN**: The user reports that setting up Desktop 6DOF has **broken VR interaction**. This is the highest priority fix.

The user has reported the following issues in v0.6.282:

1.  **Rotation Pivots**: 
    *   "Getting closer, but still not right."
    *   Pivots are still incorrect (likely not perfectly centered on the controller grip point).
2.  **Translation Tilt**: 
    *   "Translation seems tilted somehow." 
    *   Movement might not be aligned with the camera's view plane or horizon correctly.
3.  **Missing Visuals**:
    *   **Surface Radius Indicator**: Missing.
    *   **Volume Sphere**: Missing.
    *   *Note*: Verify if `ShaderSelection` or specific VR tool overlays are being rendered in this mode.
4.  **VR Menu**:
    *   "I can't operate the VR menu at all."
    *   Input might be consumed by the camera controls or raycasting is failing in this mode.

## Next Steps
1.  **Debug Pivot**: Visualize the exact pivot point (e.g., small sphere at `origin`) to see where it is relative to the controller.
2.  **Fix Tilt**: Check the coordinate space used for translation (View vs World).
3.  **Restore Visuals**: Investigate `_renderVRToolOverlays` and why indicators aren't showing (depth test? shader uniform?).
4.  **Enable VR Menu**: Ensure VR UI interaction logic runs even when Desktop 6DOF camera control is active.

## Recent Changes
*   **v0.6.282**: **1:1 Rotation & Clipping**: Tuned rotation sensitivity to ~2.2, set pivot to controller origin, reduced near clip to 0.01.
*   **v0.6.280**: **Sensitivity**: Distance-based scaling for Pan/Zoom.
*   **v0.6.261**: **Drift Fix & Visuals**: Added Green Calibration Cube, Disabled VR Grip Nav in Desktop Mode.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED)