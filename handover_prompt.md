# Handover Prompt (Protocol Enforced)

**Project Status**:
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.7.272` (Voxel Performance Optimized - `tightenBounds` implemented)

## 🚨 MANDATORY PROTOCOLS (READ FIRST)

> [!IMPORTANT]
> **YOU MUST FOLLOW THESE 3 RULES OR THE USER WILL TERMINATE THE SESSION.**

1.  **Step ID Prefix**:
    *   **EVERY RESPONSE** must start with `Step Id: {id}`.
    *   **NO EXCEPTIONS**. Check your response *before* sending. If you miss it, you fail.

2.  **Deployment Protocol**:
    *   **EVERY CODE CHANGE** requires a new version number (increment `index.html`).
    *   **EVERY CODE CHANGE** require a deployment to Beta (`./deploy_beta.sh`).
    *   **NEVER** ask the user to test without deploying first.
    *   **NEVER** leave the version number stale.

3.  **Debug Visibility**:
    *   **ALWAYS** log the Version + Build Description at the start of the session/app.
    *   Ensure `GuiXR.draw` (or equivalent) displays the current version on-screen for VR verification.
    *   Use `window.screenLog` for critical debug info (green text overlay).

## Project Rules
*   **CRITICAL**: Read `project_rules.md` immediately. It contains the detailed release strategy.
*   **Artifacts**: Keep `task.md` updated.
*   **Commits**: Commit changes with meaningful messages before handing over.

## Completed Tasks:
*   **Performance (Voxel)**: Optimized `SurfaceNets` (skip empty voxels) and added `tightenBounds` to `VoxelState` (v0.7.272). Worker time dropped from ~270ms to near-zero for sparse grids.
*   **Stability**: Fixed Syntax Errors in `GuiXR.js` (v0.7.270).
*   **Performance (GL)**: Fixed `GL_INVALID_OPERATION` 1282 (v0.7.259).

## Current Focus:
**Voxel Architecture Revamp (Greenfield)**
*   **Goal**: Move away from monolithic `SculptVoxel.js` + `VoxelWorker.js` to a clean, scalable async architecture.
*   **Status**: Performance Band-aid applied (`tightenBounds`). Ready for architecture redesign.
*   **Context**:
    *   Current Voxel implementation is a mix of old SculptGL code and new Worker logic.
    *   Need to support larger grids (infinite/chunked?) and cleaner state management.

## Deployment
*   **PROD**: `./deploy.sh`
*   **BETA**: `./deploy_beta.sh` (Use this for *every* change)

**Project Status**:
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.7.256` (Voxel Invisibility Fixed - Branch `fix/voxel-rendering`)

## 🚨 MANDATORY PROTOCOLS (READ FIRST)
1.  **Step ID Prefix**:
    *   **CRITICAL**: You **MUST** start every single response with `Step Id: {id}`.
    *   **NO EXCEPTIONS**. If you fail this, the user will be furious.
2.  **Project Rules**:
    *   **CRITICAL**: You **MUST** read `project_rules.md` immediately at the start of the session.
    *   **DO NOT** proceed without reading it. It contains strict release and commit protocols.
3.  **Release Strategy**:
    *   Update `docs/releases.md` (prepend new).
    *   Update `README.md` (keep latest 3).
    *   Increment `index.html` version.
    *   Use `./deploy.sh` (Production) or `./deploy_beta.sh` (Beta).

## Current Focus:
**Voxel Architecture Revamp (Greenfield)**
*   **Goal**: Move away from monolithic `SculptVoxel.js` + `VoxelWorker.js` to a clean, scalable async architecture.
*   **Status**: Planning.
*   **Context**:
    *   Current Voxel implementation is a mix of old SculptGL code and new Worker logic.
    *   Need to support larger grids (infinite/chunked?) and cleaner state management.
*   **Immediate Next Steps**:
    *   Refactor `SculptVoxel.js` to be a thin client.
    *   Design `VoxelEngine` (Worker-side) to handle chunks.

## Completed Tasks:
*   **Performance (GL)**: Fixed `GL_INVALID_OPERATION` 1282 and `Mesh.allocateArrays` bug (v0.7.259).
*   **Performance**: Optimized Voxel Mesh updates (v0.7.258).
*   **Offset**: Fixed Voxel Bake Offset (v0.7.257).
*   **Rendering**: Fixed Black Artifacts and GL Errors (v0.7.175).

## Outstanding Issues:
*   **Bounds**: Fixed grid (256^3) is too limiting.
*   **Memory**: Large grids consume too much RAM. Need sparse/chunked storage.

## Implementation Steps (Greenfield):
1.  **Design**: Define `Chunk` structure and `VoxelManager`.
2.  **Prototype**: Create `VoxelEngine` worker that manages chunks.
3.  **Migration**: Port `SculptVoxel` to use new engine.

## Deployment
*   **PROD**: `./deploy.sh`
*   **BETA**: `./deploy_beta.sh`