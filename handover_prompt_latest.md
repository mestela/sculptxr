# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.35 (PROD) - STABLE
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.7.35` deployed to `sculptxr` (Production).

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Polishing & Refinement
The **VR Overlay Menu** and **Desktop Preview** are now fully functional and polished.
- **Desktop Preview**: Shift-Alt-V to toggle a live preview of the VR menu on desktop for rapid iteration.
- **Overlay Highlighting**: Fixed "phantom" highlights, "clicked-through" tabs, and incorrect visual layering.
- **Spatial Blocking**: Overlay correctly blocks interaction with background tabs when active.

## Outstanding Issues (Next Session)
1.  **Menu Completeness**: Continue porting missing menu sections (only Sculpting/Rendering/About are largely done).
2.  **Performance Tuning**: General optimization for standalone VR.
3.  **Dynamic Topology in VR**: Still needs UI engagement validation.

## Recent Changes
*   **v0.7.35**: **Desktop Preview Polish**: Final cleanup, removed debug logs, polished hover states, fixed "phantom" tab highlighting.
*   **v0.7.33**: **Click Blocking**: Applied spatial blocking to clicks to prevent acting on background tabs through the overlay.
*   **v0.7.31**: **Spatial Hover Fix**: Applied spatial blocking to hover to prevent highlighting background tabs through the overlay.
*   **v0.7.0 -> v0.7.30**: Extensive work on **Desktop 6DOF Mode**, **Calibration**, and **Overlay Menu** architecture.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED - Use only when feature complete)