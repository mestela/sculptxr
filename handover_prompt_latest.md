# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.49 (PROD) - VR Polish Release
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:
- `sculptxr` (PROD): **v0.7.49** (Includes Radial Color Picker, VR Fixes, Log Cleanup)

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: VR Polish & Stability
The **VR Experience** has been significantly polished with v0.7.49.
- **Radial Color Picker**: Restored for intuitve color selection in Paint mode.
- **Input Fixes**: Right Thumbstick correctly scales brush radius. Move Brush radius jump fixed.
- **Visuals**: Symmetry line is thinner.
- **Stability**: Added crash protection for Selection operations.

## Outstanding Issues (Next Session)
1.  **Quest 3 Crash on Reload**: Clearing cache and reloading often crashes the browser on standalone Quest 3. Needs investigation potentially involving memory usage or WebGL context loss handling.
2.  **Dynamic Topology**: Code path active but functional status in VR needs deep verification.
3.  **Multiresolution**: UI exists but VR support needs implementation/verification.
4.  **Performance**: Continue optimizing VR rendering loop.

## Recent Changes
*   **v0.7.49**: **VR Polish**: Restored Radial Color Picker, Fixed Thumbstick Radius, Thinner Symmetry Line, Improved Crash Stability.
*   **v0.7.48**: **Fix**: Fixed Move Brush radius jump (80->20%) and silenced logs.
*   **v0.7.47**: **Cleanup**: Silenced `[GuiXR]` debug logs.

## Deployment
*   **PROD**: `./deploy.sh` (Deploys to tokeru.com/sculptxr)
*   **BETA**: `./deploy_beta.sh` (Deploys to tokeru.com/sculptxrbeta)

## Next task
* Ask user.