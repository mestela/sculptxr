# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.220 (BETA) - STABLE
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.220` deployed to `sculptxrbeta`.

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
*   **v0.6.220**: Implemented Ray-based picking for VR brush.
*   **v0.6.219**: Cleaned up logs.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED)