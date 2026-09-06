# Sculpting on a posed mesh

What it took to make sculpting, symmetry and persistence work while a character is
*posed* rather than at bind pose. Written down because most of these cost several
versions each, and most of them look like something else when they fail.

Code: `src/editing/Skinning.js`, `src/editing/PosedSymmetry.js`,
`src/math3d/Picking.js`, `src/mesh/multiresolution/MeshResolution.js`.
Harnesses: `scratchpad/restwrite_test.mjs`, `posedsym_test.mjs`, `multires_test.mjs`,
`octreedefer_test.mjs`, `skin_level_test.mjs`, `skellock_test.mjs`.

---

## The model

Three spaces, and nearly every bug below is one of them being used in another's place.

- **Rest space** — `mesh._skinSrc` / `_skinRest`, at the **bound level**. What the skin
  pass reads. The symmetric space: the mirror plane only means what it says here.
- **Posed space** — the bound level's vertex array after `Skinning.apply`. What the skin
  pass *writes*, and what a brush touches.
- **The displayed level** — posed space carried up through **detail vectors**, which are
  stored in each vertex's normal/tangent frame and re-added every frame by
  `applyDetails`. This is why fine detail survives posing for free.

`apply()` treats the bound level's vertex array as an **output buffer**. Anything written
there that does not reach `_skinSrc` is deleted by the next frame that deforms.

## The write-back, in three grades

1. **At bind pose** every skin matrix is the identity, so the level's vertices *are*
   rest-space vertices and the commit is a copy.
2. **Posed**: the stroke is a **delta**, carried back by the inverse of the per-vertex
   composite — `src += (Σw·B)⁻¹ · delta`. Delta mush cancels in the difference, which is
   what makes this tractable; only the linear part survives.
3. **Above the bound level**: `lowerAnalysis` splits the stroke into a coarse part (which
   the commit takes) and detail vectors (which the skin pass already re-adds). No new
   arithmetic — that split already existed, it was only ever reached by stepping down a
   level by hand.

---

## Pitfalls

### 1. Symmetry is not one implementation — it is about ten

`Move`, `Drag`, `Slide`, `Twist` and `SculptBase` each carry their own reflection across
the plane. **Fixing one reaches only the tools that use it.** Two versions of posed
symmetry landed in `SculptBase`'s generic path and Picking's ray path; grab-and-pull is
`Move`, which has its own copy, so none of it ran in the user's test — while the logs, in
the paths that *were* patched, looked healthy.

`posedsym_test.mjs` now **counts** the remaining copies (14 point mirrors, 6 direction
mirrors). The number falling is progress; rising means somebody wrote a new copy instead
of calling `Picking.mirrorLocalPoint`.

> Before debugging any symmetry behaviour, find out **which tool's** mirror is running.

### 2. The symmetry plane is measured in posed space

`mesh.getSymmetryOrigin()` is `_center`: the midpoint of the **local bound**, recomputed
from the geometry as it currently is. Reflecting rest-space points across it shifts every
result sideways by the offset between the posed and rest centres — about a hand's
thickness on a character.

**It is invisible at bind pose**, where the two centres coincide. A bug that only appears
posed, inside the feature that only runs posed. `PosedSymmetry` measures its own plane
from `_skinRest`.

### 3. Normals are not points

Forward they take the inverse-transpose; **backward they take `Mᵀ`**, which is the normal
matrix of the *inverse*.

Under a pure rotation the inverse-transpose and the plain inverse are **the same matrix**,
so a rotation-only fixture passes with the wrong one. Fixtures need **non-uniform scale**
on the joints or they cannot see this at all.

### 4. A wrong normal deletes the stroke — it does not merely aim it badly

`SculptBase` forces the symmetric normal to the plain mirror of the main one, and
`getFrontVertices()` culls every vertex behind that normal's tangent plane. Posed, the far
limb has rotated, the forced normal does not match the surface, and **the whole mirrored
selection is discarded**.

> Symptom: *"nothing gets mirrored"*. Not *"mirrored to the wrong place"*. Those are
> different bugs and the difference is diagnostic.

### 5. `MeshSymmetry`'s topological map is seeded geometrically

Centre vertices are found by distance to the plane, and the first left/right pair by a
nearest-mirror hint — both from the **live** vertices. Built while posed, one bad seed
propagates *consistently* through the topological walk, so it does not look like noise; it
looks like symmetry working somewhere else (index→pinky across a whole hand).

A map built at bind pose stays valid while posed — topology does not move. So the question
is **when it was built**, not what the pose is now (`mapIsPoseSafe()`).

**And an unbuilt map is not a safe map.** `_mapPosed` is `undefined` before the first
build, and `!undefined` is `true`, so the guard vouched for a map it had never seen: the
caller trusted it, `getMap()` built a bad one on the spot, and the *next* stroke was
refused. Symmetry on odd strokes, none on even ones.

> An alternating symptom means cached state flipping. No throttled sample can show it —
> measure once per stroke, in order.

### 6. Use ownership, not proximity — the bind is **rigid**

`nearestCapsuleWeights` and `WeightCage.weights` both write **one influence with weight 1**.
`MAX_INFLUENCES = 4` is the array's width, not what is in it, and `SMOOTH_ITERATIONS = 0`:
*"The bind is rigid — one bone per vertex — and that is the point."* Delta mush handles the
borders. (I misread the width as the data once; matt corrected it.)

So a vertex names exactly one joint, and `_boneMirror` names that joint's twin — set when a
rig is drawn with symmetry on, serialised in the SKEL block, restored on load, with
`joint._boneMirror || joint` as the centreline idiom. The far side's deformation is then

```
out = ( Σ wₖ · M[ twin(jointₖ) ] ) · mirror(restPoint)
```

Nothing measured. Written as a weighted sum so it stays correct if smoothing is ever turned
on; with a rigid bind the sum has one term and it is a matrix copy.

This replaced a rest-space **cage pair map** (build a pairing by reflecting every cage vertex
and taking the nearest match). That worked, but it answered a spatial question —

### 6b. …and "nearest vertex" is a spatial question with an anatomical answer

Both hops of the mirror once used nearest-cage-vertex lookups. Where two unrelated parts
touch — hands resting on hips — the nearest vertex to a mirrored hand point is a **hip**
vertex, and the stroke pulls the hip.

First fixed by pairing the cage to itself in rest space; then replaced outright by the
ownership route above, which cannot make the mistake at all rather than avoiding it by
tolerance. The geometric search survives as the fallback for a rig with no twins to read.

### 7. The mirrored *selection* is also spatial

Getting the point right is half of it. The far-side vertices are gathered with a **sphere**,
and where the far side rests against another part a large brush takes both — while the near
side, in free space, takes only what you meant. The asymmetry belongs to the pose.

`PosedSymmetry.pruneMirrored` carries each candidate back to rest space **by its own
deformation** and keeps only those landing near the mirrored point there.

> **Its own.** Carrying every candidate through the *same* matrix cannot work: a rigid
> transform preserves distance, so the test collapses into the posed-space sphere it was
> meant to replace.

### 8. The fold must be regional

Grade 3 folds at every stroke end, and `copyDataFromHigherRes` copied the **whole** level —
so a stroke on the hips rewrote every cage vertex in the model, including the ones carrying
the ears. It now copies only what the stroke moved, found by exact comparison against a
snapshot of what the skin pass last drew. Detail vectors need no restoring:
`computeDetails` re-derives them from the cage it is given.

### 9. Persistence: the weights belong to one *level*

A weight map is indexed by vertex, so it is meaningful for exactly one resolution — and
which one was never written. The loader compared the saved count against
`mesh.getNbVertices()`, which on a `Multimesh` reports the **displayed** level. Bind at the
base cage, subdivide, save: the counts disagree and the bind is silently dropped.

SKEL **v12** writes the bound level. Older files resolve it by matching level size, and
refuse when two levels are the same size rather than guess.

### 10. Performance: a posed frame is not a picked frame

Posing a bound, subdivided mesh regenerates the whole display level every frame. Measured
at 49,666 displayed vertices: **29.3 ms → 11.3 ms**, all of it outside the deformation
(which is ~2 ms).

- the **octree** was rebuilt from scratch every frame, for queries nobody was making —
  now marked stale and rebuilt by the first `intersectRay`/`intersectSphere`.
  **Not** in `getOctree()`: Gizmo reads that every frame for a loose bound, and rebuilding
  there hands back every millisecond saved.
- **face boxes and centres** are only read by the octree and by Picking — skipped too.
  Face *normals* are not optional; a pose changes them.
- `updateResolution()` uploaded colours, materials, texcoords and the index buffer.
  Posing changes vertices and normals only.
- `lowerAnalysis` and `computePartialSubdivision` allocated fresh arrays per call. The
  second runs per level **per frame** while posing.

---

## Instrument pitfalls (these cost more time than the bugs)

- **In-place mirroring aliases the trace.** `mirrorLocal` passes the same array as input
  and output, so anything read afterwards prints the *result* as the input. The trace could
  not tell a working mirror from a no-op — the one distinction it existed to make.
- **`isSculpting` is a parameter of `_makeStrokeXRInner`**
  (`main._action === Enums.Action.SCULPT_EDIT`), **not** `main._vrSculpting`. Three
  versions of a trace gate asked the wrong flag and answered "not a stroke" on every frame.
  The silence was then read as evidence about the feature.
- **Hover frames are almost all frames.** In VR the mirror runs every frame the controller
  is near the mesh. A trace throttled to once a second samples hover, essentially always.
  Burst per stroke instead.
- **One definition of "a stroke", published once per frame.** Three nearly-identical
  conditions disagreed and produced a log with one line where the interesting two should
  have been.
- A trace that is itself conditional on the thing being asked about cannot answer it.

## Testing pitfalls

- **Round trips, not re-derivations.** Sculpt → commit → re-run the real pass → check the
  vertex is where it was left. A test that agrees with a re-derivation of the same maths
  passes while being wrong in the way that matters.
- **Two levels cannot see fold order** — with two, folding down and folding up are the same
  single step and a reversed loop passes. Use three.
- **Rotation-only fixtures cannot see normal transforms** (see 3).
- **A fixture centred on the origin cannot see a wrong plane centre**; the rest shape must
  sit somewhere else.
- **A detail on a midpoint vertex cannot see the fold**, which only copies shared vertices.
- **Mirroring a vertex onto its own pair cannot see a bad pairing** — the answer is exact
  either way. Offset the probe so proximity gives the wrong answer.
- Injection-verify every rule. Several of these were found *only* because the injected
  defect failed to fail.

---

## Mirroring is three primitives, copy-pasted ~22 times

Counted 2026-09-07. It is not ~10 designs, which was the first (wrong) reading — it is
**three operations**, repeated:

| primitive | sites | where |
|---|---|---|
| mirror a **position** | 8 → 5 | `intersectionPoint`, `symPos`, `localPos`, Twist's `center` |
| …the same, applied to a **ray**'s two ends | 6 → 4 | Drag, Slide — each a copy of `Picking.intersectionRayMesh`'s own `_xSym` block |
| mirror a **direction** | 6 | `_dragDirSym` ×2, `nSym` ×2, `symANormal`, Twist's `axisSym` (all pass `[0,0,0]` as the plane origin) |
| mirror a **rotation** | 2 | `qDeltaSym[1] = -qDeltaSym[1]` in Move and Slide — hand-written, and hardcoded to an X-axis plane |

Only the position primitive is shared so far (`Picking.mirrorLocalPoint`). **`Move` is fully
converted** (2026-09-07) and has no posed-space mirror left — VR pick, both ends of the VR
drag, the VR sphere fallback, and the desktop drag.

**A ray is not the thing to mirror.** The desktop drag reflected the whole pick ray and used
where it passed; posed, that aims at where the far limb *would have been*, and the error grows
with the asymmetry of the pose — "fine at rest pose, wacky in an asymmetrical pose". What
should travel is the **point the drag is aiming at**, measured from the *near* centre against
the *unmirrored* ray. The same correction applies to the four remaining ray copies.

**Unifying is not a separate cleanup — it is the remaining fix.** Drag, Slide and Twist are
*incorrect while posed* until they route through rest space, so "convert by hand now, share
later" is two passes over the same lines, and the by-hand pass is exactly where a fix once
landed in a copy nobody used.

### Two layers, same primitive shapes

Do not conflate them:

- **Rig space** — mirroring joints about the rig's symmetry plane. No skinning. The right
  answer is conjugation: `P M P` (`Skeleton.mirrorModelMatrix`).
- **Mesh space, posed** — mirroring a brush on a deformed surface. Needs the rest-space
  round trip (`PosedSymmetry`).

## Open

- **Large brush inverts the stroke on the mirror side.** Reported 2026-09-07, not
  diagnosed. Suspicion is the mirrored stroke *direction* rather than its position or
  selection — direction mirrors (`Geometry.mirrorPoint(v, [0,0,0], n)`) are still
  posed-space everywhere, including `moveDataSym.dir`.
- **Crossover at large radius** persists in reduced form: the rest-space prune uses one
  radius for a brush whose two ends sit in different neighbourhoods.
- **Detail elsewhere smooths away over repeated strokes.** Mechanism **unknown**. The fold
  is the suspect but the harness could not reproduce it, and delta mush is shape-preserving
  by construction, so the obvious theory does not hold. `Settings > Freeze Sculpt Fold
  (bisect)` (`window._skinNoFold`) refuses the fold entirely to test whether it is
  implicated at all.
- **`Drag`, `Slide` and `Twist` still mirror in posed space.** Convert them the way `Move`
  was converted: `pickingSym.mirrorLocalPoint(...)`.
- Sculpting **below** the bound level is refused rather than synthesised up.
- **The three ray-mirror copies** duplicate `Picking.intersectionRayMesh`'s `_xSym` block
  and should just call it.

## Fixed since

- **FK/Tweak twin mirrored position but not rotation** (v3.30.64). Not an oversight — a
  documented deferral: *"a mirrored rotation is not the same rotation, and guessing which
  reflection was meant is how a symmetric rig comes back asymmetric."* True when written,
  and stale by the time `Skeleton.mirrorPose` learned to conjugate the full transform by
  the reflection plane. The answer was a few hundred lines away being used by a menu
  command while the live drag still did half the job — **and a harness rule was pinning the
  old behaviour**, so the bug had a test defending it. matt found it by using the tool.
