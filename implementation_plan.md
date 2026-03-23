# Implementation Plan: Rust/WASM Mesh Generation

## Goal
Port the surface meshing logic (SurfaceNets) from JavaScript to Rust compiled to WebAssembly to bypass single-thread CPU limits and improve FPS.

## Strategy
We will use bare `wasm32-unknown-unknown` target to keep it lean, avoiding heavy runtimes. We will manage memory manually by passing pointers between JS and Rust.

## Architecture

### 1. Rust Crate (`voxel_wasm/`)
-   **Structure**: Flat library crate.
-   **Functions**:
    -   `alloc(size) -> *mut u8`: Allocate memory in WASM heap.
    -   `dealloc(ptr, size)`: Free memory in WASM heap.
    -   `compute_surface_wasm(...) -> *const Result`: Mesh generation entry find.
-   **Result Struct**: Pointers to output arrays (vertices, faces, normals, colors, materials) and their lengths.

### 2. ABI Details
We will pass:
-   `distance_field_ptr`
-   `color_field_ptr`
-   `material_field_ptr`
-   `dims` (width, height, depth)
-   `bounds` (min_x, min_y, min_z, max_x, max_y, max_z)

We will return a pointer to a struct containing:
-   `vertices_ptr`, `vertices_len`
-   `faces_ptr`, `faces_len`
-   `normals_ptr`, `normals_len`
-   `colors_ptr`, `colors_len`
-   `materials_ptr`, `materials_len`

### 3. JS Integration (`VoxelWorker.js`)
-   Load WASM using Vite: `import initWasm from "./voxel_wasm.wasm?init"`.
-   Instantiate and hold the memory.
-   For each chunk:
    1.  Allocate space in WASM memory for inputs.
    2.  Copy JS TypedArrays into WASM memory.
    3.  Call `compute_surface_wasm`.
    4.  Read outputs from WASM memory.
    5.  Free inputs/outputs.

## Verification
-   Rely on `npm run dev` for HMR testing.
-   Verify seams and visual fidelity match the JS version.

## Versioning
-   Update version in `index.html` to `v0.9.288 - Rust WASM Plan`.
