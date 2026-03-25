# Zero-Copy WASM Voxel Bridge

Our current web-worker has successfully fetched and compiled the Rust `voxel_wasm` module, but our Javascript thread is still doing 100% of the mesh generation CPU processing using `SurfaceNets.js`. We must natively wire the `VoxelState.js` memory buffers into the Rust Heap to unlock massive multi-threaded performance gains without serialization penalties.

## Proposed Changes

### 1. `src/workers/VoxelWorker.js`
- Pass the initialized `wasmModule` instance directly into the `VoxelState` constructor upon successful module load.
- Ensure the module exports its internal `memory` buffer properly.

### 2. `src/editing/VoxelState.js`
- **Zero-Copy Memory Allocation:** If `wasmModule` is present, `VoxelState` will abandon standard Javascript initialization for its heavy spatial arrays (`this._distanceField`).
- Instead, it will call `wasmModule.alloc(total_bytes)` to reserve strict spatial blocks *inside* the native Rust WebAssembly Heap. 
- It will wrap these heap pointers in native Javascript `Float32Array` overlays: `new Float32Array(wasmModule.memory.buffer, address, length)`.
- **Result:** Native JS sculpting operations (`addSphere`, `editSphere`) write directly into WASM RAM simultaneously, perfectly eliminating memory-copying serialization costs before mesh generation!
- **Compute Bypass:** In `computeMesh()`, bypass the obsolete `SurfaceNets.js` fallback completely if `wasmModule` is active. Instead, call the natively compiled `wasmModule.compute_surface_wasm(...)` C interface.
- Deconstruct the returned Rust `MeshResult` memory pointer, unwrap the `vertices`, `faces`, `colors`, and `materials` arrays, and then immediately call `wasmModule.free_mesh_result(ptr)` to safely garbage collect the Rust heap allocation.

### 3. Rust WASM Pipeline Setup (`build_wasm.sh`)
- Create a quick developer script to consistently compile the Rust `lib.rs` into `wasm32-unknown-unknown` ignoring standard OS-level allocators.
- The script will copy the compiled `.wasm` artifact directly into `/src/workers/` allowing Vite's hot module reload to immediately pipe it into the browser context.

## Verification Plan

### Automated Tests
- Run the new `build_wasm.sh` compiler pipeline in the terminal to verify no Rust syntax errors and successful artifact movement.

### Manual Verification
- Hard refresh the main application in Chrome PCVR or Desktop. 
- Expand a Voxel tool brush, activate `[Bake]` or hover preview.
- Ensure the spatial bounds (`min`, `max`) and dimensional scaling values match identically to the legacy Javascript output to ensure coordinate parity.
- Confirm zero browser memory leaks over sustained sculpting sweeps using Chrome's memory profiling tools.
