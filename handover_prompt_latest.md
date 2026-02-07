# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.57 (BETA) - VR Scene Menu & Desktop Debug
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
1.  **Desktop Mode Failure (WAITING FOR LOGS)**:
    *   **Symptom**: Tester clicks "Desktop Mode", button turns RED (state toggles), but VR view remains unchanged (no black background/desktop render).
    *   **Status**: Code reviewed. `Scene.js` logic depends on `pose.views`.
    *   **Action**: **DO NOT TOUCH CODE** until logs are received.
    *   **Required Log**: `Desktop Render: Active. Views=...`
2.  **VR Scene Menu**:
    *   **Multi-select/Merge/Isolate**: Logic verified in code, needs VR verification (Headset required).
    *   **Torus**: Parameters are missing. Need implementation (low priority).
3.  **Performance**: VR GUI optimization (Backlog).

## Recent Changes
*   **v0.7.57**: **Docs**: Updated `walkthrough.md` with investigation notes.
*   **v0.7.57**: **Fix**: Resolved Isolate issue where Voxel Debug Cube would appear.
*   **v0.7.56**: **Debug**: Added verbose logging to `onXRFrame` spectator path.

## Deployment
*   **PROD**: `./deploy.sh` (Deploys to tokeru.com/sculptxr)
*   **BETA**: `./deploy_beta.sh` (Deploys to tokeru.com/sculptxrbeta)

## Next Task
*   **WAIT** for beta tester logs regarding Desktop Mode.
*   **Verify** VR Scene Menu when headset is available.