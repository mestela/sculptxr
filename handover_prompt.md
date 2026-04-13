# Next Session Objectives: Reconstructing SXR Multiresolution & Animation Tracks

## Context & Current State
The native `.sxr` (SGL2) binary exporter successfully writes all multiresolution levels and animation tracks to disk without buffer overflows. However, upon re-import via `src/files/ImportSGL.js`, the topology and wireframe indexing logic for multiresolution stacks is failing to properly establish correct parent-child subdivision links, leading to miswired polygons and missing multires levels.

## Top Priorities for Next Developer:

1. **Fix SXR Multiresolution Topology Mismatch**:
   - **The Bug**: The parser currently attempts to use `mm.addLevel()` to rebuild level hierarchy, but because the face arrays saved to disk are already subdivided, dropping them back into the dynamic subdivider scrambles the index ring wiring.
   - **The Goal**: Implement a manual multi-level reconstruction pass in `ImportSGL.js` that perfectly assigns each level's `facesABCD` and `verticesXYZ` directly to a dedicated `MeshResolution` container without invoking standard re-subdivision calculations.

2. **Bind Outliner Names Correctly**:
   - The string labels (`_permanentStaticLabel`) parsed from the binary footer must be assigned directly to the topmost `Multimesh` container rather than the lower-level static meshes so they appear perfectly in the Outliner.

3. **Initialize the Animation Transport System**:
   - While shape keys and timeline snapshots successfully register into the global `AnimationRegistry`, the playback engine is currently not triggering due to a missing initialization trigger on load. Wire up an automated wake-up call to restart timeline execution after `.sxr` parsing completes.

## Core Implementation Files:
- `src/files/ImportSGL.js` (Main parsing and reconstruction loop)
- `src/files/ExportSGL.js` (Binary layout specification reference)
