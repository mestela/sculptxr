# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.41 (PROD) - STABLE
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.7.41` deployed to `sculptxr` (PROD).

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Polish & Refinement
The **VR Overlay Menu** is feature-complete relative to Desktop.
- **Dynamic Topology**: Fully functional controls in VR.
- **Rendering**: Import Matcap/UV enabled.

## Outstanding Issues (Next Session)
1.  **Performance Tuning**: General optimization for standalone VR.
2.  **Scrolling**: VR Scrollbar drag works, but content clipping/masking could be smoother.
3.  **File Dialogs in VR**: Known limitation - file inputs require OS-level interaction (switching to Meta menu).

## Recent Changes
*   **v0.7.41**: **Tweak**: Changed default **Move Brush** radius from 150 to 80.
*   **v0.7.40**: **Bug Fix**: Fixed "Level -" and "Level +" buttons in VR.
*   **v0.7.39**: **UX Refinement**: Replaced Multiresolution "Level" slider with buttons.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED - Use only when feature complete)