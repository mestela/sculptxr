# SculptXR Handover Prompt

## Objective: Fix Tool Symmetry Failure after Voxel Mirror

You are picking up from a session where we successfully fixed the Voxel Mirror implementation (Vertex Compaction & Symmetry Plane Alignment), ensuring it generates a perfectly watertight and symmetrically aligned mesh. However, tools that rely on symmetry (like the Move brush) are currently failing to affect the mirrored side of the mesh after a Voxel Mirror operation.

## Current Findings

1. **Topological vs. Geometric Symmetry**: 
    - We theorized that `MeshSymmetry.computeSymmetryMapTopo()` correctly bails out after a voxel remesh because the topology is no longer a perfect graph mirror.
    - We wrote a standalone test script (`testGeoSym.js`) for the fallback `MeshSymmetry.computeSymmetryMapGeo()` array construction, and it **works perfectly**, matching even misaligned/un-mirrored vertices geographically to the nearest neighbor across the symmetry plane based on the `SNAP_RADIUS` (local radius * 0.1). 
    - Therefore, the issue *isn't* that the mesh has no symmetry map; `MeshSymmetry` is correctly identifying bilateral pairs geographically.

2. **Move Tool Symmetry Architecture (`Move.js`)**:
    - We analyzed `Move.js` and discovered that it **completely bypasses topological vertex snapping** (`pickingSym._pickedVertices`) during its `move()` function.
    - Instead, it pulls the bilateral pairs but applies a spatial blend called `symFactor` (`Factor = 0.5 + 0.5 * (VertexDist * BrushSide / Radius)`) to smoothly blend bilateral strokes across the seam, preventing the "bum crease" artifact.
    - In VR, `Move.js` heavily overrides `sculptStrokeXR` and explicitly processes the primary picking (`this._moveData`) and symmetric picking (`this._moveDataSym`) as two independent interactions, manually calculating local-space controller deltas (`qDeltaLocal`).

3. **Potential Culprits Found in `SculptBase.js` & `Picking.js`**:
    - **Backface Culling (`SculptBase.makeStrokeXR`)**: In `v0.6.49`, a fix was added to force surface-relative culling in VR. It negates the `PickedNormal` to use as the `EyeDirection` for `getFrontVertices()`. If the mirrored normal is calculated slightly off (due to geometric picking instead of topological picking), this aggressive culling might be discarding 100% of the mirrored stroke's vertices.
    - **Symmetric Sphere Intersection (`Picking.intersectionSphereMeshes`)**: In `SculptBase.makeStrokeXR`, the symmetry marker relies heavily on `pickingSym.intersectionSphereMeshes([mesh], symWorldPos, searchRadius);`. If `symWorldPos` isn't piercing the remeshed geometry due to slight dimensional rounding, the secondary picking sphere fails completely (`pick2 = pickingSym.getMesh()` evaluates to false), causing the tool to drop the bilateral stroke silently.

## Next Steps

1. Start by investigating `SculptBase.js` line `616` (`getFrontVertices()` backface culling) and determine if it masks out the mirrored stroke in geometric fallback situations. You can temporarily bypass the `vec3.negate(pickingSym.getEyeDirection(), nSym)` logic to test this.
2. Investigate whether `pickingSym.getMesh()` actually resolves to a valid mesh during `makeStrokeXR` the moment a tool is pressed down (`isPressed = true`) after a voxel remesh. If it's returning `null`, debug why `intersectionSphereMeshes` is failing to find a hit at `symWorldPos`.
3. Check `pickingSym.computePickedNormal()` to ensure it's not returning `NaN` or a wild angle on the remeshed side, which would corrupt the stroke vectors.