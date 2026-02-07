# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.56 (BETA) - VR Scene Menu & Desktop Debug
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:
- `sculptxr` (BETA): **v0.7.56** (VR Scene Menu, Desktop Mode Button + Debug Logs)

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: VR Menu Polish & Desktop Mode Debugging
We have recently implemented major VR UI updates and are currently debugging a specific issue with the "Desktop Mode" feature for a beta tester.

### Recent Accomplishments
- **VR Scene Menu**: Implemented **Multi-select**, **Merge**, and **Isolate** functionalities in VR, delegating logic to the robust Desktop `GuiScene.js`.
- **Desktop Mode Button**: Added a dedicated "Desktop Mode" button to the main UI (`index.html`) to toggle 6DOF Spectator Mode without keyboard shortcuts.
- **VR Files Menu**: Fixed texture size sliders and export handlers.

## Outstanding Issues (Next Session)
1.  **Desktop Mode Failure (Beta Tester)**:
    *   **Symptom**: Tester clicks "Desktop Mode", button turns RED (state toggles), but VR view remains unchanged (no black background/desktop render).
    *   **Status**: Deployed `v0.7.56` with verbose logging in `Scene.js` (`onXRFrame`) to verify if `pose.views` yields any data during the spectator render pass.
    *   **Next Step**: Wait for tester logs to confirm if `Desktop Render: Active` appears and what `Views=` count is.
2.  **Verify VR Scene Menu**: Multi-select and Merge/Isolate implementations need field verification in VR.
3.  **Torus Parameters**: VR Scene Menu lacks Torus parameter sliders (skipped for now).
4.  **Performance**: VR GUI rendering optimization still relevant.

## Recent Changes
*   **v0.7.57**: **Fix**: Resolved Isolate issue where Voxel Debug Cube would appear.
*   **v0.7.56**: **Debug**: Added verbose logging to `onXRFrame` spectator path to diagnose missing desktop render.
*   **v0.7.55**: **Debug**: Added logging to "Desktop Mode" button and `toggleDesktopOffset`.
*   **v0.7.54**: **Feature**: Added "Desktop Mode" button to `index.html`.
*   **v0.7.53**: **Feature**: VR Scene Menu Update (Multi-select, Merge, Isolate).
*   **v0.7.50**: **Feature**: VR Files Menu Polish (Texture Export, Checkbox Persistence).

## Deployment
*   **PROD**: `./deploy.sh` (Deploys to tokeru.com/sculptxr)
*   **BETA**: `./deploy_beta.sh` (Deploys to tokeru.com/sculptxrbeta)

## Next Task
*   Review logs from beta tester regarding Desktop Mode failure.
*   Verify VR Scene Menu functionality.