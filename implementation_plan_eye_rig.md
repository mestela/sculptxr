# Implementation Plan — Eye Rig (Scene Hierarchy + Constraints)

**Status:** Design / not started. Written 2026-06-18.
**Driving goal (matt):** be able to finish character heads — proper *eye* mirroring + simple eye animation. This is roadmap **#9 (live mirror)** sitting on **#10 (scene hierarchy / instancing)** and coupling to **#7 (outliner)**.

---

## 1. The target workflow (matt's vision)

A character eye is a **2-part model**:
- an **inner** surface with a sculpted iris + pupil,
- an **outer** transparent sphere (cornea / shiny surface), made a **child of the inner** so they move together.

The user transforms + scales this assembly to sit in the right socket, then:
1. Drops it under a **mirror node** ("smart group", Nomad-style) → anything child of that node is **mirrored across X**. For eyes this is a **positional mirror**: a transform `(1,3,0)` produces a mirrored instance at `(-1,3,0)` — the object is NOT negative-scaled, it's an instance at the mirrored position. Edits to the source (sculpt/move) propagate live to the mirror.
2. Creates a **null/locator**, floats it ~1 m in front of the head; both eyes get a **look-at constraint** aiming at it. Animating the eyes = animating the null.
3. **Procedural saccades** — small, time-varying random darts layered on the aim so the eyes feel alive.

---

## 2. What already exists (the Three.js move pays off)

The migration from raw-WebGL SculptGL to Three.js means **the scene graph is already here and in use** — we are NOT building hierarchy/transform-composition from scratch.

- Each SculptXR `Mesh` wraps a `THREE.Mesh` (`_renderData._threeMesh`, `userData.sculptMesh` links back). `Mesh.js:432`.
- Meshes are added under a **`_worldGroup`** (`THREE.Group`, scale ≈0.701, places/scales the model for VR; the headset roams the root scene). `Scene.js:1720`, `addNewMesh → _worldGroup.add(t)` `Scene.js:2146`.
- The render sync writes the SculptXR transform into the threeMesh's **local** matrix and calls `updateMatrixWorld(true)`, so **Three.js already composes world transforms through the hierarchy** (mesh local → worldGroup → scene). `Mesh.js:1794-1804`.
- **Transform animation already exists** per object: `AnimationRegistry` stores position/rotation/scale keyframes keyed by mesh ID. A null's motion can reuse this directly.
- **Duplication exists**: `Scene.duplicateSelection()` → `MeshStatic.copyData` + `addNewMesh`. `Scene.js:2355`.
- A **Scene-tab outliner** exists (desktop + VR) listing meshes flat.

### The one real gotcha: picking is split
`src/math3d/Picking.js` is inconsistent about local-vs-world:
- **Mouse** picking uses the composed world matrix — `intersectionMouseMesh` / `intersectionMouseMeshes` invert `mesh.getThreeMesh().matrixWorld` (`Picking.js:180,454`). **Parenting-safe.**
- **VR ray/sphere** picking — `intersectionRayMeshes` (`:230`) and `intersectionSphereMeshes` (`:294`, the VR brush's vertex pick) invert **`mesh.getMatrix()`** (the raw *local* `_transformData._matrix`). These assume every mesh is a **flat child of `_worldGroup`** so local == model-space-world. The VR input is pre-transformed into `_worldGroup` space, so today it lines up.

**The moment a mesh is parented under another mesh, `getMatrix()` is local-to-parent, not model-space — and VR sculpting on a parented mesh mis-picks.** This is the foundational fix (see Phase 0).

---

## 3. Data model

Lean on Three.js `Object3D` as the node; keep SculptXR `Mesh` as the wrapper. Introduce two new lightweight node types, both first-class in the outliner / selection / animation:

- **`NullNode`** — a transform-only node (a `THREE.Object3D`/`Group`, no geometry) with a gizmo for viz/manipulation. Selectable, transformable (reuse the `TransformVR` gizmo), animatable (transform keys via `AnimationRegistry`, keyed by a node id). Used as the look-at target and as group parents.
- **`MirrorGroup`** — a node that mirrors its children across X (a `NullNode` with a `mirror` flag, or a subclass). Holds source children; maintains mirrored **instances**.

**Transform source of truth stays `_transformData._matrix`, reinterpreted as LOCAL (relative to parent).** Render already composes it. Move/Transform tools already edit it → they edit local-to-parent, which is correct for a hierarchy. The fix is on the *read* side (picking), not the write side.

**Parenting API:** `setParent(node, parentNode|null)` = `parentObject3D.add(child.threeMesh)` (re-parents in Three.js, which preserves world transform if we use `THREE` attach semantics or recompute local). Keep `_meshes` as the flat registry of sculptable meshes; add a parallel registry of all scene nodes (meshes + nulls + groups) for the outliner.

---

## 4. Mirroring as a live instance

"Live instance" = the mirrored eye **shares the source's `BufferGeometry`** (reference, not copy). Sculpting the source mutates the shared buffer → the mirror re-renders for free.

- `MirrorGroup` watches its source children. For each source it creates/maintains a mirror `THREE.Mesh` that **reuses the source geometry** and whose **local transform = X-mirror(source.local)**: negate translation.x; mirror rotation about the YZ plane (quaternion conjugate on X), as needed so the mirror reads symmetric.
- Positional mirror only — **no negative scale**, so we dodge the winding/normal-flip gotcha entirely (the reason general geometry mirroring is hard). The eye is ~radially symmetric so shared geometry at a mirrored transform looks correct.
- When the source is re-parented/moved/scaled, the mirror updates. When the source geometry is swapped (voxel remesh, topology ops use the "wholistic object swap" pattern — see `overview.md`), the instance must **re-point at the new geometry** — a real hook to get right (Risk R2).

---

## 5. Constraints

A small per-frame (or on-change) **constraint evaluation pass**. Constraints stack in a defined order on a node:
- **Mirror** (group-level): sets the base local transform of mirrored children.
- **Look-at**: overrides the node's aim. `Object3D.lookAt(targetWorldPos)` exists; we compute the rotation and write it into the node's local transform (accounting for parent world). Eyes aim at the null; both the source eye and its mirror instance can carry a look-at to the same null (each converges independently — cleaner than mirroring the aim).
- **Saccades** (additive on look-at): a parametric noise rotation (frequency, amplitude, hold/dart profile) layered on the aim. Procedural at runtime; optionally bakeable to keys for export.

The null target itself animates via the **existing transform-keyframe system** — so "animate the eyes" = keyframe the null, and the look-at + saccades do the rest.

---

## 6. Outliner (#7 / #10)

Extend the Scene-tab outliner from a flat list to an **indented tree**: show parent/child, nulls, groups, and badge the mirror/look-at relationships (the dependency link matt flagged as coupling mirror-eyes to the outliner). Selection of a non-mesh node (null/group) must be handled (it's not sculptable; it IS transformable/animatable).

---

## 7. Phasing (MVP-first, each testable)

- **Phase 0 — VR picking reconciliation.** Make `intersectionRayMeshes` / `intersectionSphereMeshes` parent-aware: pick using the world-relative-to-`_worldGroup` matrix (derive from `threeMesh.matrixWorld`, strip the worldGroup) instead of raw `getMatrix()`. Add a `Mesh.getModelSpaceMatrix()` helper. **Test:** parent one mesh under another, sculpt the child in VR — picks correctly. *This unblocks everything; prove it first.*
- **Phase 1 — Node model + parenting + nulls + outliner tree.** `setParent`, `NullNode` (gizmo, selectable, transformable, animatable), outliner shows the tree. **Test:** build the 2-part eye (outer child of inner), move the inner — outer follows; create a null, place + keyframe it.
- **Phase 2 — Instancing + MirrorGroup.** Shared-geometry instance; positional X-mirror constraint, live. **Test:** drop an eye under a mirror group → mirrored eye appears; sculpt/move the source → mirror tracks.
- **Phase 3 — Look-at constraint.** Eyes aim at a null. **Test:** move the null → both eyes track it.
- **Phase 4 — Procedural saccades.** Parametric darts on the aim. **Test:** toggle on → eyes dart naturally.
- **Phase 5 — VR/desktop UX + polish.** Menu actions to create eye rig / mirror group / null / look-at; outliner management (re-parent, delete, badges); undo for all of it.

---

## 8. Risks / open questions

- **R1 — Picking reconciliation (Phase 0).** The VR paths assume flat-in-worldGroup. Must verify the worldGroup-relative transform is correct under VR world scale/offset AND symmetry sculpting. Highest-risk bit; do first.
- **R2 — Geometry-swap vs live instances.** Voxel remesh / topology ops swap the whole mesh object (wholistic swap). Mirror instances referencing the old geometry must re-point at the new one, or they go stale. Needs an explicit hook in the swap path.
- **R3 — Undo.** Parenting, null creation, constraint add/remove, mirror create — all need `pushStateCustom` pairs. The animation/undo notes in `overview.md` warn this area is fiddly.
- **R4 — Save/load + export.** Hierarchy + constraints must serialize (`.sxr`). GLB export: node hierarchy + parenting map cleanly, but **constraints don't** — look-at + saccades must be **baked to rotation keys**, and the mirror baked to a real second mesh, on export.
- **R5 — Selection model.** Active-mesh logic assumes the selection is sculptable. Nulls/groups are selectable but not sculptable — the tool/gate paths must tolerate a non-mesh active node.
- **R6 — `_matrix` reinterpretation.** Everywhere that reads `mesh.getMatrix()` as "world" (beyond picking — bounds, gizmo placement, symmetry plane) must be audited for parented meshes. Grep `getMatrix(` and classify each use as local vs world. (Likely small, but must be done before shipping parenting broadly.)

---

## 9. Decisions still open (for matt)

- **Mirror rotation:** mirror position only and let each eye's look-at drive aim (recommended), or mirror the full transform incl. rotation?
- **Saccade model:** pure runtime procedural (a toggle + params), or also a "bake to keys" button for deterministic export?
- **Scope of Phase 1 parenting:** general (any mesh under any node) right away, or gate parenting to the eye-rig construct first and generalize after Phase 0 proves the picking fix?
