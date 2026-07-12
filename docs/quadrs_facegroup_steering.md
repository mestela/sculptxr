# Face-group steering for quad remeshing (quadrs fork)

Exploratory work (2026-07-08): add ZRemesher/Exoside-style "keep polygroups" edge-flow
steering to our existing quad remesher, so remeshed topology aligns to face-group borders.
This matters for the **deformation / consistent-topology** animation path (rigging,
blendshapes) — NOT the frame-by-frame voxel path, which is considered done.

## Key finding

`quadrs` (the crate we already call from `voxel_wasm/src/lib.rs::remesh_quads_wasm`) **is a
Rust port of Instant Meshes**, and it already contains the full per-vertex field-constraint
machinery (`BoundaryConstraint`) needed for steering — it's just wired to fire only on open
mesh boundaries. Face-group steering = fire that same mechanism on **interior edges whose two
faces belong to different groups**, aligning the field along the seam so quad loops follow the
border. No new remesher, no C++/WASM port needed — just a small fork.

## Status: PROVEN-COMPILING

A forked copy of `quadrs` 1.0.0 with these changes was built and tested:
- `cargo test` → 14 passed (incl. 3 seam-detection + 3 end-to-end/propagation tests added).
- `cargo build --lib --target wasm32-unknown-unknown` → clean (stays WASM-compatible).

The full change is in `quadrs_facegroup_steering.patch` (apply against a vendored
`quadrs` 1.0.0 `src/`). ~40 lines of real logic; the rest is tests/comments.

## What the patch does (5 touch points)

1. **`topology.rs`** — add `groups: Vec<u32>` (one per face) to `TriMesh`, plus a
   `TriMesh::ungrouped()` helper for call sites that don't care.
2. **`preprocess.rs`** — carry group ids through preprocessing. `subdivide_to_max_edge` only
   *appends* faces (splits f0→f0,f3 and f1→f1,f2), so each child inherits its parent's group;
   `compact_mesh` preserves face order. This means new midpoint verts on a seam edge get
   constrained too (same quality the open-boundary path already gets).
3. **`boundary.rs`** — new `build_group_seam_constraints()`: a twin of
   `build_boundary_constraints` that triggers on `groups[a] != groups[b]` across an interior
   edge instead of "no opposite edge". Overlays onto the existing constraint buffer without
   clobbering real open-boundary constraints.
4. **`api.rs`** — new `remesh_with_groups(mesh, face_groups, options)` (old `remesh` becomes a
   thin shim passing `None`). Adds `RemeshOptions.steering_weight` (0.0 = ignore groups,
   1.0 = as hard as a boundary). `triangulated_mesh` expands per-polygon groups to per-triangle
   (a fan of `len-2` tris inherits one group).
5. **`voxel_wasm/src/lib.rs`** (NOT in patch — our repo side) — thread a `face_groups` pointer
   (one u32 per input face, or null) + `steering_weight` through the `remesh_quads_wasm` FFI and
   call `remesh_with_groups`. Null/0.0 = byte-identical to today.

## Remaining blocker

SculptXR has **no face-groups yet**. They are the data source that feeds step 3/5. This work is
the easy half; per-face group ids on the sculpt mesh are the prerequisite.

## Sharp edges to remember

- Corners where 3+ groups meet: first-wins per vertex (matches existing boundary code; not
  averaged). May nudge a singularity slightly. Refine later if needed.
- `steering_weight` is the knob worth exposing in UI — start ~0.5–1.0. Too hard forces
  singularities into ugly spots; too soft and loops drift off the border.
- Forking means owning `quadrs` (one-author, experimental, v1.0.0). It's small and readable.
