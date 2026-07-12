# Face-groups + quad-remesh engine — handover

_Last session: 2026-07-08 → 07-09. Deep context in the auto-memory note
`project_sculptxr_quad_remesh.md` (single source of truth); this doc is the action-oriented
summary + next steps._

## TL;DR
- **Face-groups feature is DONE and working** (paint per-face groups → crisp display + wireframe
  → feeds the quad remesher). Shipped across ~15 files in `src/`.
- **The steering works but results are weak** — because the current engine (`quadrs` =
  Instant Meshes) is a field-smoothing method that can't hold hard guide loops. This is an
  engine ceiling, not a bug.
- **The fix = autoremesher's engine (QuadCover global parametrization).** Its one hard
  dependency is **geogram**, and we **PROVED geogram compiles to wasm32** (see below). No
  OpenVDB/CGAL (that was bad intel), no volumetric step.
- **DONE 2026-07-09: the autoremesher wasm module is built + wired** (unsteered). Proven in Node
  (sphere → 74 quads + 2 polar tris), lazy code-split in the Vite build, selectable via a desktop
  engine dropdown. **Next: guided steering** — feed our face-group seam edges into
  `quad_cover(constrain_hard_edges=true)`. See the DONE + Next-step sections below.

## What's done (face-groups feature)
Per-face group ids as genuine face data (`Mesh._facesGroups`), painted by a first-class
**Groups** sculpt tool (`src/editing/tools/PaintGroup.js`, `Enums.Tools.PAINT_GROUP`), shown as
a **crisp non-indexed overlay mesh** (`Mesh.updateGroupOverlay` — the main mesh stays indexed so
the wireframe works), and threaded into the quad-remesh FFI (`remesh_quads_wasm` in the forked
`voxel_wasm/vendor/quadrs`, via `SculptManager.remeshQuads` → `GeometryWorker`). Full file list
+ gotchas (three separate tool-list sources!, the draw-arrays/wireframe saga, etc.) are in the
memory note. Deferred: group survival through voxel-remesh / dynamic-topology (paint groups as
the last step before remeshing for now).

## The geogram → wasm result (the reason this dir exists)
`libgeogram.a` (7.3 MB, verified real wasm) builds cleanly and contains
`GEO::FrameField::create_from_surface_mesh` + `GEO::GlobalParam2d` (QuadCover) + OpenNL — the
exact modules autoremesher calls in `src/AutoRemesher/parameterizer.cpp`.

**Rebuild it:** `bash build_geogram_wasm.sh` (re-clones autoremesher, applies
`geogram_wasm_fixes.patch`, installs `tbb-shim/`, builds). Prebuilt copy: `./libgeogram.a`.
Toolchain: `brew install cmake emscripten` (done on this Mac). The 6 fixes (CMake 4.x policy,
stripped-copy refs, PoissonRecon exclude, AMGCL disable + typo, serial TBB shim) are all
mundane/mechanical — none algorithmic. Detail in the patch + memory note.

## DONE 2026-07-09 — autoremesher wasm engine built + wired (unsteered)
The module is built, proven in Node, and wired into the app as a second engine. **Verified:**
a welded UV sphere (800v/1536t) → **74 quads + 2 tris** (the 2 tris = polar singularities).
Vite prod build emits it as a lazy code-split chunk (`autoremesher-*.js` 47 kB + `.wasm` 1.1 MB),
loaded only when the user picks the engine. NOT yet clicked-through in-browser (headless preview
blocked by self-signed HTTPS cert), but the response path is byte-identical to the proven
`REMESH_QUADRS` path.

**Build it:** `bash wasm_build/build_autoremesher_wasm.sh` → `wasm_build/autoremesher.{js,wasm}`,
then copy both into `src/workers/`. Smoke-test: `bash wasm_build/build_test.sh && node wasm_build/test_ar.cjs`.

What the build does (all in `wasm_build/`):
- Compiles `ffi.cpp` (the `extern "C"` `remesh_autoremesher` — verts/4-padded-faces in →
  MeshResult-shaped 10×u32 out, same layout as voxel_wasm; splits input quads to tris) + autoremesher's
  `{autoremesher,parameterizer,quadextractor,isotropicremesher,meshseparator,positionkey}.cpp`
  + the two **exploragram** TUs the geogram lib excludes (`quad_cover.cpp`, `polygon.cpp`, `basic.cpp`
  for `plop_file`) + the vendored `thirdparty/isotropicremesher/*.cpp` + eigen headers, links `libgeogram.a`.
- Emits ES6/worker module (`-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker -sALLOW_MEMORY_GROWTH`).
- Shims: `wasm_build/shim/QDebug` (Qt stub → qDebug()→stderr), `tbb-shim/tbb/mutex.h` (added; serial).
- Applies `autoremesher_wasm_fixes.patch` (one fix: guard `std::this_thread::sleep_for` under
  `#ifndef __EMSCRIPTEN__` — no pthreads in the single-thread build; that spin loop is dead code there).

**Gotchas that cost time (don't re-learn):**
- `libgeogram.a` was built with EXPLORAGRAM=OFF, so it does **NOT** contain `quad_cover` — compile the
  exploragram TUs above alongside it. (The old note's "lib contains QuadCover" meant `GlobalParam2d::PGP`,
  not the `quad_cover` free fn.)
- **scaling MUST be ~1.0**, not 0. CLI default = `edgeScaling` = 1.0 (mainwindow: `parameters.scaling`).
  Leaving it 0 collapses the quad_cover UVs → 0 quads. FFI hardcodes `setScaling(1.0)`.
- **Input must be a welded/indexed mesh.** A vertex-soup (unshared verts) splits into hundreds of
  2-triangle islands → each too small to extract → 0 quads. SculptXR meshes are indexed, so fine.
- Node smoke test needs `-sFORCE_FILESYSTEM -lnodefs.js` (geogram init touches FS); browser uses MEMFS.

Wiring: `GeometryWorker.js` — `REMESH_AUTOREMESHER` case → `remeshAutoremesher()` (lazy `loadAutoremesher()`
imports `./autoremesher.js`, calls `_remesh_autoremesher`, replies `MESH_UPDATE_QUAD`).
`SculptManager.remeshQuads(target, weight, engine)` posts either message. Desktop UI: engine `<select>`
in `MainMenuPanel.js` topology section → `GuiTopology.setQuadEngine()`.

## DONE 2026-07-09 (part 2) — face-group steering, "fast proof" (skip-resample)
Steering is IMPLEMENTED end-to-end and has a **measurable effect** (Node icosphere test: a top/bottom
group split → equator seam pulls ~1.85× the vertices into the seam band vs unguided, 26 vs 15). The
worker now passes `msg.groups`, so painting groups + the QuadCover engine steers in-browser.

**Approach chosen (Matt): "fast proof, skip the resample".** When `face_groups_ptr` is non-null the FFI
takes a *separate* path: it parametrizes the **input mesh directly** (no isotropic resample → group ids
map 1:1, no seam-through-resample transfer problem) and feeds the group seams to quad_cover. The unguided
path is unchanged (full `AutoRemesher::remesh()`).

Three injection points, all in code we compile:
1. **`ffi.cpp`** guided path: split faces to tris keeping per-tri group; seam edges = internal edges whose
   two tris differ in group; derive `scaling` from `target_faces` (skipping resample means density would
   otherwise just follow input edge length); run `Parameterizer` + `QuadExtractor` directly.
2. **`parameterizer.cpp`** (`setSeamEdges`): mark seam facet-corners in an `Attribute<index_t> "seam"` on
   the geogram mesh, AND align the frame field `B` along each seam (project the seam-edge dir onto the
   facet) — the hard constraint alone does NOT steer flat borders; the field must flow along the seam.
3. **`quad_cover.cpp`** (our compiled copy): after `get_constraints`, for seam corners OR-in `CNSTR_U/V`
   (U/V picked by the same edge-vs-field alignment test as `get_edge_constraints`, minus the angle gate).
   `quad_cover_solve` then forces those corners' U/V to integers → an isoline snaps to the seam.

**Honest state / knobs tried:** the effect is real but *weak* — not yet a crisp single edge loop.
- `do_brush=false` (to stop quad_cover re-smoothing the seam-aligned B) made it *worse* (21 vs 26) — left on.
- `on_border` is NOT a usable lever: it's tied to quad_cover's ball/cut-graph topology; marking arbitrary
  seams there would corrupt it.
- Root of the weakness = global field consistency: B is forced only on the 2 facets touching each seam, and
  the solver/brush average it out. **Next levers for crispness:** propagate seam alignment into a wider band
  (or bias the frame-field solve); pin seam vertices with a soft position constraint; or do the full
  feature-preserved-resample version so resampled verts land exactly on the seam (see below).

Gotcha (cost time): a UV-sphere test mesh with coincident pole vertices is non-manifold → quad_cover
collapses to a tiny pole cap. Use an **icosphere** (test_main.cpp builds one). The earlier "74 quads"
looked fine but was that degenerate cap.

## DONE 2026-07-09 (part 3) — steering done RIGHT: seams as geogram feature edges
**This is the working approach.** Verified: guided icosphere (top/bottom groups) produces a CLEAN
continuous equator edge loop with the quad rows aligning to it (29 equator-loop edges vs 9 unguided) —
confirmed visually, not just by metric. The crude bolt-on constraints are gone.

**Key lessons that got us here (don't repeat):**
- The holes were NOT from irregular input (Option-B resample premise was wrong — guided had 71 holes on a
  *smooth* icosphere too). They came from the crude steering itself: (a) overriding B on only the seam
  facets made the field DISCONTINUOUS → singularities → holes; (b) manually forcing integer U/V constraints
  (`set_multiplicity`) over-constrained the solve.
- The RIGHT mechanism = make seams behave exactly like geometric feature edges, which geogram already
  handles hole-free: `FrameField::create_from_surface_mesh` LOCKS feature facets and `solve_PGP` propagates
  a SMOOTH aligned field; `get_edge_constraints` then picks them up naturally.

**Implementation (current):**
- `parameterizer.cpp` sets a `"seam"` facet-corner attribute on BOTH meshes (originalM for the frame field,
  M for constraints) from `m_seamEdges`. No B override, no manual constraints.
- **geogram patched** (`geogram_steering.patch`, compiled into libgeogram.a):
  - `mesh/mesh_frame_field.cpp` `create_from_surface_mesh`: a corner flagged in `"seam"` is treated as a
    feature (locked + field aligned to the edge) → smooth aligned field along the seam.
  - `parameterization/mesh_global_param.cpp` `get_edge_constraints`: a `"seam"` corner bypasses the
    dihedral-angle gate → becomes a hard iso-line constraint even when flat.
- `ffi.cpp` guided path unchanged in spirit (skip resample, exact input seams 1:1), just feeds seams to
  the Parameterizer. Density via `scaling` from target_faces.

**Rebuild:** the geogram patch means libgeogram.a must be rebuilt — `bash build_geogram_wasm.sh` now applies
`geogram_steering.patch` (step 2b) as well as the build fixes, then `bash wasm_build/build_autoremesher_wasm.sh`.
Two separate patches now: `autoremesher_wasm_fixes.patch` (3 autoremesher src files, applied at module build)
and `geogram_steering.patch` (2 geogram files, baked into libgeogram.a).

**Remaining rough edges (next):**
- Minor scattered holes remain (~a few small 1–2-quad cracks; unguided has some too — general QuadExtractor
  imperfection). A weld/cap post-process on the output, or the feature-preserved RESAMPLE below, should help.
- Guided still SKIPS the isotropic resample (exact seams but input-density base). To also get the clean
  uniform base: resample first, then carry seams through as preserved feature edges (the isotropic
  `featured` flag survives collapse/split — see B1 notes) and re-detect them post-resample. This is the last
  quality step. Proximity-based seam transfer was tried and is too lossy (jagged seam) — use feature
  preservation, not proximity.

### Watch-outs
- **Threading:** we built geogram single-threaded (TBB shims are serial). Fine for correctness;
  it'll be slower than native autoremesher. WASM threads (real TBB) need SharedArrayBuffer +
  COOP/COEP — defer.
- **Binary size:** `libgeogram.a` is 7.3 MB; the linked `.wasm` will be multi-MB. Lazy-load it
  only when the user picks the autoremesher engine.
- **Prefer STOCK geogram 1.8.3?** autoremesher's vendored geogram is stripped + TBB-patched
  (hence the fixes). Stock geogram 1.8.3 is serial and complete, so it avoids the strip/TBB
  fixes — BUT autoremesher's `parameterizer.cpp` calls `quad_cover` and may rely on their
  patched mesh_global_param behaviour. Check whether stock quad_cover gives the same result
  before switching; safest is to keep their vendored copy (what we proved).

## Files in this dir
- `build_geogram_wasm.sh` — reproducible geogram→wasm build (validated from clean clone).
- `geogram_wasm_fixes.patch` — the 6 fixes, applied to autoremesher's vendored geogram-1.8.3.
- `autoremesher_wasm_fixes.patch` — the one autoremesher source fix (sleep_for guard).
- `tbb-shim/tbb/*.h` — serial stubs for `parallel_for`/`blocked_range`/`combinable`/`mutex`.
- `libgeogram.a` — prebuilt wasm static lib (regenerable via the script).
- `wasm_build/` — the autoremesher engine build: `build_autoremesher_wasm.sh` (main build →
  `autoremesher.{js,wasm}`, copy to `src/workers/`), `ffi.cpp`, `shim/QDebug`, `build_test.sh` +
  `test_main.cpp` (Node smoke test → `test_ar.cjs`).
- `../quadrs_facegroup_steering.md` + `../quadrs_facegroup_steering.patch` — the current
  (quadrs) engine's face-group steering.
