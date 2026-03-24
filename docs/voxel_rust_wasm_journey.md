# Voxel Rust WASM Journey

## Objective
To massively improve performance of `SculptXR`'s dense voxel sculpting operations, we embarked on a journey to port the core SDF processing, chunk management, and mesh generation algorithms from Javascript to WebAssembly using Rust.

## Phase 1: Toolchain and Environment Setup
The project lacked a compiler ecosystem required to compile native Rust into `.wasm`.
- Handled via `cargo`, the standard package and build manager.
- Added `wasm-pack` specifically targeting the `wasm32-unknown-unknown` standard, stripping out standard library dependencies and wrapping outputs automatically with an ES Module javascript loader to be seamlessly imported into `Vite`.
- Initialized `voxel_wasm` as the core crate, enabling `wasm-bindgen` to export direct memory blocks from Rust to `Float32Array` buffers on the Main Javascript thread to prevent expensive serialization/deserialization penalties.

## Phase 2: Core Algorithm Porting (Surface Nets)
The first computational target was replacing the Javascript implementation of `SurfaceNets.js`.
- Javascript's dynamic typing and garbage collection penalties created noticeable latency spikes on every frame during dense voxel sweeps (particularly around 64^3 arrays and larger).
- The rust implementation centered on passing the raw `Uint8Array` of voxel data and its respective 3D dimensions to a deeply optimized spatial layout algorithm.
- Implemented `Float32Array` outputs for vertices, normals, and colors tightly packed together, mirroring the WebGL expected buffer structures explicitly so they could be fed cleanly into `Three.js` `BufferAttribute` constructs without data shifting.

## Phase 3: Infinite Chunking & Thread Management
Processing one gigantic grid caused massive memory and latency walls. We migrated the logic to "Chunks":
- Chunk boundaries are strictly evaluated in `Rust`.
- Rather than calculating every chunk 90 times a second, a strict `dirty` flag and `throttle` mechanic was added in JS. This allows fast localized topological updates: sculpting only touches the chunk immediately beneath the radius cursor.

### Coordinate Synchronization Debugging
The largest architectural barrier faced was resolving coordinate mapping between the `Rust` computational space (Grid Space integers) and the `Three.js` visual space (World Space meters).
- **The Offset Bug:** Voxel meshes initially rendered completely offset from the VR controllers and their own bounding boxes because the Voxel array intrinsically started at `[0,0,0]`, whereas the visual mesh physically sat at `[-0.5, -0.5, -0.5]` offset in relation to the brush pivot. 
- **The NaN Errors:** `computeBoundingSphere` threw repetitive NaN errors after we injected `Infinity` boundaries for `NaN` safeguards. The fix was normalizing scaling operations and mathematically validating all Brush forces `1.0` and radii sizes before they entered the `.editSphere()` matrix parameters.
- **The Solution:** The scaling and translational bounds are now strictly aligned. The Javascript thread calculates physical world-space intersection points, applies the `mesh.matrixWorld` inversion, and parses the localized floating-point position into pure voxel coordinates directly evaluated by the `VoxelWorker` and extrapolated to `Rust`.

## Present Status & Future Directions
With memory bound correctly, voxel performance is now limited entirely by the visual transfer threshold. Future updates will focus heavily on GPU Compute Shaders for entirely bypassing the CPU boundary, but `Rust` provides flawless cross-platform fallback with multi-threaded optimizations previously completely impossible natively in `WebXR` browsers.
