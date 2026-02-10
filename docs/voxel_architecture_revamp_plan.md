# Voxel Architecture Revamp Implementation Plan

## Goal
Replace the current monolithic, fixed-grid Voxel implementation with a scalable, chunk-based architecture. This will enable larger/infinite worlds and better memory management.

## User Review Required
> [!IMPORTANT]
> This is a **Rewrite** of the Voxel System.
> -   **Current Status**: Fixed Grid (128^3), Single Mesh.
> -   **New Status**: Infinite/Chunked Grid, Multi-Mesh (per chunk).
> -   **Breaking Change**: The underlying data structure will change from a single `Float32Array` to a Map of Chunks.

## Proposed Architecture

### 1. `VoxelManager.js` (Main Thread)
-   **Responsibility**:
    -   Manages the `VoxelWorker`.
    -   Tracks active Chunks and their Meshes.
    -   Handles Mesh Updates (Creation/Update/Destruction) received from Worker.
    -   Provides API for `SculptVoxel` (`editSphere`, `raycast`, etc.).
-   **Location**: `src/editing/voxel/VoxelManager.js`

### 2. `VoxelEngine.js` (Worker Thread)
-   **Responsibility**:
    -   Manages the `ChunkManager`.
    -   Processes Edit Operations (Add/Subtract).
    -   Triggers Meshing for dirty chunks.
-   **Location**: `src/workers/VoxelEngine.js`

### 3. `ChunkManager.js` (Worker Thread)
-   **Responsibility**:
    -   Stores Chunks in a `Map<string, Chunk>`.
    -   Handles infinite grid coordinate mapping.
-   **Location**: `src/workers/voxel/ChunkManager.js`

### 4. `Chunk.js` (Shared/Worker)
-   **Responsibility**:
    -   Stores voxel data for a fixed size (e.g., 32^3).
    -   `Float32Array` for Distance Field.
    -   `Uint32Array` for Materials/Colors.
-   **Location**: `src/workers/voxel/Chunk.js`

## Proposed Changes

### Structure
```text
src/
  editing/
    voxel/
      VoxelManager.js   [NEW]
    tools/
      SculptVoxel.js    [MODIFY]
  workers/
    VoxelWorker.js      [MODIFY] -> Redirect to VoxelEngine
    voxel/
      VoxelEngine.js    [NEW]
      ChunkManager.js   [NEW]
      Chunk.js          [NEW]
```

### Steps

#### 1. Create Core Voxel Classes (`src/workers/voxel/`)
-   **[NEW]** `Chunk.js`: Basic data container.
-   **[NEW]** `ChunkManager.js`: Hash map of Chunks.
-   **[NEW]** `VoxelEngine.js`: Logic to edit chunks and run SurfaceNets.

#### 2. Create Manager (`src/editing/voxel/`)
-   **[NEW]** `VoxelManager.js`: Bridge between `SculptVoxel` and `VoxelEngine`.

#### 3. Update Worker
-   **[MODIFY]** `src/workers/VoxelWorker.js`: Switch to import `VoxelEngine` instead of `VoxelState`.

#### 4. Update Tool
-   **[MODIFY]** `src/editing/tools/SculptVoxel.js`: Use `VoxelManager`.

## Verification Plan

### Automated Tests
-   **Unit Tests**: Create a simple test file `tests/test_voxel_chunk.js` to verify Chunk index logic and memory allocation.
    -   *Command*: `node tests/test_voxel_chunk.js` (Need to ensure it runs in node or browser console).
    -   Actually, we can use the Browser Console to verify.

### Manual Verification
1.  **Load App**: Ensure no errors on startup.
2.  **Activate Voxel Tool**: Verify `VoxelManager` initializes.
3.  **Sculpt**:
    -   Draw a stroke.
    -   Verify Chunks are created.
    -   Verify Mesh is generated and visible.
    -   Verify performance (logs).
4.  **Chunk Crossing**: Sculpt across chunk boundaries to ensure seamless transition.

