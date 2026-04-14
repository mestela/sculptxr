# SculptXR SGL/SXR Multi-Resolution Specification

## 1. Binary Format Overview (`VERSION 5`)
The `.sxr` (SculptXR) and `.sgl` (legacy SculptGL) binary formats pack sequential levels of detail inside a linear block of `Float32Array`/`Uint32Array` data. 
Each multi-resolution mesh saves the base level (`L = 0`) up to the highest level (`L = max`), writing flat attributes directly from runtime variables.

### 1.1 Block Sequence per Level
For each detail layer within an array, exactly these fields are sequenced:
1. **Visual Overrides (4 words):** `shaderType`, `matcap`, `showWireframe`, `flatShading`.
2. **Opacity (1 float):** `opacity`.
3. **Center (3 floats):** `center [x, y, z]`.
4. **Transform Matrix (16 floats):** `matrixWorld`.
5. **Scale (1 float):** Global scale coefficient.
6. **Position Buffer:** `nbVertices` followed immediately by `nbVertices * 3` floats.
7. **Vertex Colors:** `hasColors` count, and if present, `nbVertices * 3` floats.
8. **Materials (PBR roughness/metallic):** `hasMaterials` count, and if present, `nbVertices * 3` floats.
9. **Topology:** `nbFaces` followed by `nbFaces * 4` integers (supporting quad meshes).

## 2. The Heuristic Optimization Trap
In original architectures, `initTopology()` dynamically runs a cache sorting step (`Mesh.optimize()`) to shuffle indices. **Crucial Discovery:** Saving these modified values into external binaries desynchronizes geometric order during automated multi-resolution reconstruction!

> **MANDATORY RULE FOR DEVELOPERS:**
> "Before tackling multiresolution pipeline issues, instruct me to verify the byte layout against an external offline diagnostic script immediately (using `Node.js`). Always demand that I map where parent vertices physically drift in dense index arrays during Catmull-Clark splits before overriding any visualization buffer."

## 3. Proxy Wireframe Construction on Displacement
In visual rendering, proxy levels mapping to top-tier displacement require special edge caching. Instead of updating physical point variables, proxy anchors strictly inject lower-detail topological edges (`getTessellatedWireframe(0)`) onto the physical floating-point positions of the top layer to ensure local advection tracking.
