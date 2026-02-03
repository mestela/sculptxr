# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.195 (BETA) - STABLE REVERT
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.195` deployed to `sculptxrbeta`.

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: VR Polishing & Bugfixes
**CRITICAL BUG REPORT (v0.6.195)**:
The user reports:
1.  **Controller Visuals**: Controller model visible, with spike and red half-sphere on tip.
2.  **Giant Sphere Glitch**:
    *   "When I get within sculpting distance, the half a sphere becomes huge."
    *   "I can sculpt fine, it's just with a huge half-sphere behind the sculpt."
    *   "If I lift the controller away from the surface, the half sphere returns to the spike tip at normal size."

## Outstanding Issues (Next Session)
1.  **Fix Giant Sphere Glitch**:
    *   **Goal**: Clamp the radius of the brush helper sphere.
    *   **Suspicion**: `Picking.computeWorldRadius2` likely returns a massive value when close to surface or hitting backfaces/bad intersection.
    *   **Solution**: **CLAMP** the radius in `Scene.js` or `Picking.js` to a reasonable max (e.g., 25cm).
    *   **WARNING**: Do **NOT** refactor the entire `renderVR` loop or add "Overlay Passes" blindly. A previous attempt to do this caused a "View Lock" bug where displays became desynchronized. **Make minimal, safe changes.**

2.  **Pointer Visibility**:
    *   The "Hidden Spike" issue seems mostly resolved or at least visible now (red half-sphere). If it clips into the controller, adjust offset slightly, but prioritize the Giant Sphere fix first.

## Recent Changes
*   **v0.6.195**: Reverted to safe state after v0.6.200 caused View Lock.
*   **v0.6.199**: Fixed `Scene.js` Syntax Errors (missing braces).
*   **v0.6.186**: Fixed VR Crash.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED)