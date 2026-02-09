# Handover Prompt (Protocol Enforced)

**Project Status**:
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:

## 🚨 MANDATORY PROTOCOLS (READ FIRST)
1.  **Step ID Prefix**: ALWAYS prefix your chat response with "Step Id: {id}".
2.  **Release Strategy**:
    -   Update `docs/releases.md` (prepend new).
    -   Update `README.md` (keep latest 3).
    -   Increment `index.html` version.
    -   Use `./deploy.sh` (Production) or `./deploy_beta.sh` (Beta).
3.  **Project Rules**: READ `project_rules.md` immediately.

## Current Focus:
## Current Focus:
**Implement Sparse Voxel Engine (Phase 1: Worker Infrastructure)**
*   **Goal**: Move Voxel Logic to Web Worker to unlock 90fps head tracking and enable "Boundless" sculpting.
*   **Context**: 
    *   Research confirmed current Single-Threaded Dense Grid is the bottleneck.
    *   Plan is to use a **Sparse Chunk System** (Hash Map of Chunks) running in a **Web Worker**.
    *   See `brain/implementation_plan.md` (or conversation history) for the full architectural breakdown.

## Outstanding Issues:
*   **Performance**: Voxel sculpting causes frame drops (Main thread blocking).
*   **Bounds**: Current fixed grid (256^3) is too small and memory-heavy for expansion.
*   **Greenfield**: SculptGL is 100% Pure JS. No existing Workers or WASM to leverage. We are building the async architecture from scratch.

## Implementation Steps (Phase 1):
1.  **Create `src/workers/VoxelWorker.js`**:
    -   Standard `Worker` (ES Module type).
    -   Implement `onmessage` handler for `init` and `edit`.
2.  **Move Logic**:
    -   Port `VoxelState` and `SurfaceNets` to run inside the Worker (no DOM/GUI deps).
3.  **Bridge in `SculptVoxel.js`**:
    -   Instantiate Worker.
    -   Send `addSphere` commands via `postMessage`.
    -   Receive vertex buffers via `onmessage` and update `_voxelMesh`.
4.  **Verify**:
    -   VR Head Tracking must theoretically remain smooth (90fps) even if mesh update lags.

## Deployment
*   **PROD**: `./deploy.sh`
*   **BETA**: `./deploy_beta.sh`