# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.80 (BETA) - Debugging Grab Tool & Reference Images
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:
- `sculptxr` (BETA): **v0.7.80** (Ref Img Crash Fixes, Grab Active Controller Fix)

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Debugging Core Tools
We are in the middle of debugging the **Grab Tool** (failed movement) and **Reference Images** (Texture/Crash issues).

### Recent Accomplishments (v0.7.75 - v0.7.80)
- **Reference Images**:
    - **FIXED**: Crash due to `Uint32Array` faces (switched to `Int32Array`).
    - **FIXED**: Crash due to `updateDuplicateGeometry` (overridden to no-op).
    - **FIXED**: Forced `Enums.Shader.TEXTURE` to avoid PBR/Red color issue.
    - **Note**: Texture might still fail if loading is async/broken. Check `sculptgl.getMesh().getTexture()`.
- **Grab Tool**:
    - **FIXED**: `_activeController` was missing, causing `debug.grab()` to fail.
    - **Debug**: Added `debug.grab()` console helper (Shows Active Controller Pos & Grab Status).
    - **Issue**: Movement logs showed `0,0,0` in v0.7.79. Needs verification in v0.7.80 (now that `_activeController` is set).

## Outstanding Issues (Next Session)
1.  **Grab Tool**:
    - Verify if `debug.grab()` now shows valid position (not 0,0,0).
    - Verify if tool moves object.
    - If still broken -> Inspect `Scene.js` raw controller input vs `Grab.js` logic.
2.  **Reference Images**:
    - Verify if texture appears (not Red).
    - If Red -> Texture loading issue (Async timing?).

## Debugging Commands
- `debug.grab()`: Prints active controller pos and grab status.
- `sculptgl.getMesh().getTexture()`: Check reference image texture.

## Recent Changes
*   **v0.7.80**: **Fix**: `Ref Image` Crash (DupGeom override) & `Grab` `_activeController` assignment.
*   **v0.7.79**: **Fix**: `Ref Image` Crash (Int32 faces) & `debug.grab()` helper.
*   **v0.7.78**: **Fix**: `Ref Image` forced Texture Shader & aliased `getTexture0`.

## Deployment
*   **PROD**: `./deploy.sh` (Deploys to tokeru.com/sculptxr)
*   **BETA**: `./deploy_beta.sh` (Deploys to tokeru.com/sculptxrbeta)

## Next Task
*   Verify v0.7.80 fixes.
*   Continue debugging Grab Tool movement if still broken.