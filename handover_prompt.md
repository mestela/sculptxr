# Handover Prompt - Voxel Engine Optimization (Seams Fixed, Rust Installed)

**Project Status**: **In Progress (Seams Fixed, Rust Toolchain Installed, Next: WASM Porting)**

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Branch**: `threejs` (Working Copy)

---

## Recent Work (Today's Session)

### 1. 🧩 Seams & Gaps Fixed (SurfaceNets Boundaries)
-   **File**: `src/workers/VoxelWorker.js`
-   **Change**: Modified bounds calculation to overlap by `+1` voxel cell at chunk boundaries. This allows the dual-meshing algorithm to bridge quads across chunks. No more physical gaps!

### 2. 🤫 Silenced UI/DOM Layout Thrashing
-   **File**: `index.html`
-   **Change**: Set `window._showDebugLog = false` by default, and bypassed the `console.log` DOM appends unless it is explicitly toggled. 
-   **Impact**: Shaved $20-30\%$ off frame time. No more `get scrollHeight` forcing synchronous layout recalculations during active sculpting!

### 3. ⚖️ Chunk Size Sweeps (Tug-of-War)
-   **File**: `src/workers/VoxelWorker.js`
-   **Change**: Tried `chunkSize = 16` and now `chunkSize = 24` to find the sweet spot between single-thread CPU meshing speed (few cells) and Three.js draw calls (fewer meshes).

### 4. 🦀 Rust Toolchain Installed
-   **Status**: Installed `rustup` and `cargo 1.94.0`. The machine is now ready to compile Rust to WASM!

---

## Current Situation / Obstacles

### ⏱️ The Single-Threaded Limit
We have pushed standard JavaScript as far as it can go using single-thread WebWorkers. We are still hovering around $\sim 15$ FPS for continuous sculpting because `SurfaceNets.js` is pure JS math reading dense arrays. 

To hit $30$-$60$ FPS on a GalaxyXR/Quest 3, we must **Shift the Paradigm**. 

---

## Next Steps for the New Agent

1.  **Create a Rust Compute Crate**
    *   Initialize a Workspace (e.g., `voxel_wasm/` in root).
    *   Port the inner loops of `SurfaceNets.js` or `VoxelState.js` to Rust. 
2.  **Compile to WASM**
    *   Use native `cargo` targets (e.g. `wasm32-unknown-unknown`). 
    *   Use Vite’s native `import wasmModule from "./module.wasm?init"` to keep it lean without heavy npm modules like `wasm-pack` if possible.
3.  **Wire WASM into `VoxelWorker.js`**
    *   Bypass the JS SurfaceNets iteration in favor of the Rust binary. 
4.  **(Long-term Concept) GPU Volume Raymarching**
    *   If WASM still hits CPU bounds, consider Option 2: Upload raw voxel sub-grids directly to a `Data3DTexture` on the GPU and execute raymarching in a Fragment Shader (Infinite detail, flawless 90 FPS rendering, zero vertex creation).

---

Please review the repository `src/workers/VoxelWorker.js` to see the current chunk loop and bounds overlap. The system is ready to receive Rust code! 🛠️
