# Handover Prompt (Protocol Enforced)

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
**Performance Optimization (Voxel Sculpting)**
*   **Goal**: Reduce frame drops during voxel strokes.
*   **Status**: Initial optimizations deployed (v0.7.258). Pending user verification.
*   **Optimizations Applied**:
    *   Disabled `gl.getError` (37% frame time).
    *   Skipped `initEdges`/`initVertexRings` in Voxel Mesh updates (~15% frame time).
*   **Next Steps**:
    *   Profile again. If still slow, investigate `updateFacesAabbAndNormal` (next hotspot).

## Outstanding Issues:
*   **Bounds**: Current fixed grid (256^3) is too small and memory-heavy for expansion.
*   **Greenfield**: SculptGL is 100% Pure JS. No existing Workers or WASM to leverage. We are building the async architecture from scratch.

## Implementation Steps (Performance):
1.  **Verify**: Check if v0.7.258 resolves frame drops.
2.  **Optimize**:
    *   Avoid re-uploading unchanged buffers? (Dynamic Draw is already set).
    *   Throttle `MESH_UPDATE` frequency?
    *   Offload Normal computation to Worker? (SurfaceNets produces faces, but normals are computed on Main Thread).
3.  **Verify**: Ensure 72/90Hz consistency in VR.

## Deployment
*   **PROD**: `./deploy.sh`
*   **BETA**: `./deploy_beta.sh`