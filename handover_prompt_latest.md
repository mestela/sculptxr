# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.221 (BETA) - STABLE
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.221` deployed to `sculptxrbeta`.

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: VR Polishing
The VR Brush Alignment issue is **RESOLVED** (v0.6.220).
We switched from Sphere Picking to **Ray Casting** for accurate laser-based alignment.

## Outstanding Issues (Next Session)
1.  **Dynamic Topology in VR**: It's "active" but not visibly engaged.
2.  **Performance Tuning**: Keep an eye on Ray Casting performance on standalone headsets (Quest 2/3).
3.  **UI Completeness**: Add missing primitives / menu items.

## Recent Changes
*   **v0.6.228**: Fixed Air Drawing offset for Standalone VR (was emitting from root/5cm instead of tip/10cm).
*   **v0.6.227**: Corrected lint errors in `Scene.js` introduced in v0.6.226.
*   **v0.6.226**: Implemented **Air Drawing** for Voxel Tool (Disabled surface snapping).
*   **v0.6.225**: Fixed ROOT CAUSE of VR Slider crash (initialized default radius/intensity in `SculptBase`).
*   **v0.6.224**: Added safety guard in `GuiXR` to prevent rendering crashes for undefined values.
*   **v0.6.223**: Added safety guards for Voxel Brush UI to prevent crashes if tool state is invalid.
*   **v0.6.222**: Fixed VR Combobox misalignment (was causing tool selection issues).
*   **v0.6.221**: Added Voxel Brush VR UI controls (Resolution, Bake, Wireframe).
*   **v0.6.220**: Implemented Ray-based picking for VR brush.
*   **v0.6.219**: Cleaned up logs.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED)