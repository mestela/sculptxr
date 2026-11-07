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
2. **Posed**: the stroke is a **delta**, carried back by the rotation between the mush's
   rest and posed frames at that vertex (`mushReturn`), or with mush off by the inverse of
   the per-vertex composite — `src += (Σw·B)⁻¹ · delta`. What's drawn near a joint is the
   mush's blend, and a rigid bind has a different inverse either side of a seam, so one
   bone's inverse tears a stroke across it. See pitfall 11.
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

### 11. Anything that writes the displayed level without the skin pass is a stroke

`strokeMask` finds what a stroke moved by **exact** comparison against `_skinDisp`, what the
pass last drew. So any other writer of that level reads as sculpting, and the fold writes the
difference into the rest shape. A synthesis is not exact against the last one (details orient
by the level's current normals), so `showWeightColors` carrying colours up moved 7576 of 9522
verts by 0.03; the next press, stroke or not, moved 1884 **rest** verts by up to 0.22 with
nothing left on the undo stack. Fixed by `coloursUp`.

**A missing snapshot is the same bug, bigger.** `strokeMask` answers "assume everything", so
a stroke after subdividing, before any pass, folded the whole surface: a one-vertex edit
moved all 2382 rest verts. `pushMesh` now queues a pass.

> Symptom: the rest shape changes where nobody sculpted. Compare `_skinSrc` before and after
> a press **with no stroke**.

### 13. A posed bound mesh is never read back as rest

`Mesh.updateGeometry` rebases a shape track's base from what's on screen, and on a posed bound
mesh that's the skin pass's output. Guarding only the pass's own refresh left every other
caller: a level step rebased the base to the posed verts, the next recomposite put that in
`_skinSrc`, and the skin posed it a second time. A rigged head with shapes, stepped down and
saved, reloaded off by a whole pose (2.68).

So `updateGeometry` skips the capture when `_skinW && _skinIsPosed` (set true on load until the
first pass), and `commitPosed` carries the stroke's rest delta into the edited layer or the
base (`strokeIntoShape`, on the undo entry too). A recomposite no longer analyses a bound mesh:
strokes are folded at their end, and analysing between a recomposite and its pass measures the
pose itself as detail.

### 12. A posed fix to a pose's own crease is stored at rest

Smooth a crumple that only exists because of the pose and the write-back does what it should:
it stores the opposite of the crumple, which at rest is a dent. No inverse can avoid that. The
surface has one rest shape, so a pose-specific correction needs a corrective shape.

**Correctives (`RigPoses.js`).** On a saved pose, status "name 100% | post", a stroke
goes into that pose's fix instead of the rest shape. The fix's weight comes from the rig,
not a key or slider: the minimum over the joints that pose changes of a smoothstep of how far the
joint is towards it. Joints the pose leaves alone don't count, so a bent knee doesn't fade a raised
arm. Anywhere else a stroke goes to rest, as before. Bake to Rest, Clear Fix and Mirror are in the
pose list's modes.

**A fix is an offset on top of the skin pass** (`track.correctivePost`, `Skinning.applyFixes`, SKEL
v32): drawn = skin + mush + weight x rotation x offset. Until v4.5.86 it was a shape layer under the
skin, and the mush doesn't draw that back. On `pose_crumple.sxr`, a straight forearm snapped .001 on
a .02 stroke, an elbow bent about 150 degrees .5 on .48, and up to 1.93 on .21 on top of an existing
fix, never settling. So hard bends crumpled and couldn't be repaired. Now nothing is inverted and
the snap is 0 on any bend, with no change to `_skinSrc` or the mush deltas.

- The rotation is a normalised quaternion blend of the vertex's joints. Blended matrices nearly
  collapse at a hard bend and have no usable inverse. Each joint is flipped to the near side of the
  vertex's heaviest: three.js returns canonical quaternions, so two can sit on far sides.
- The offset is stored turned back to rest, so it is exact on the pose and follows the limb off it.
- Files before v32 keep their layer `pose:<name>` under the skin, and a new stroke goes on top of
  it. Clear, Bake, Mirror and Rename handle both.
- **Bake to Rest is approximate**: it adds the offset to the rest shape, and the pass then draws it
  through the mush. .88 off at the elbow on that file (349 vertices).
- Above the bound level a fix's details lag when the rig jumps back to the pose, as details are
  oriented by normals of the last pass (`_skinSettle`). After a 6-unit stroke at level 1: .40, .22,
  .10, .10, .04 by pass; steady at .002 once there, exact at rest.
- **A level's own `updateGeometry` skips the posed guard in Mesh.js**, as `_skinW` lives on the
  Multimesh, and rebases `baseShape` from the posed surface (30 units, in a test). Go through the
  mesh. Direct level calls exist at `Scene.js` (`lvl.updateGeometry`) and Skinning's level rebuilds:
  not checked.
- **"Rest" covers two cases**, and `RigPoses.status` tells them apart for the bone panel, the
  desktop menu bar and the VR wrist panel. At bind a stroke is a copy, exact. On a posed rig off every saved pose it still
  goes back under the skin and can jump. That isn't refused, as gentle work on a straight limb is fine:
  the next pass measures it (`jumpCheck`) and warns over a quarter of the stroke. The wrist panel reads the
  status in its periodic sync, which already repaints, so it adds no paints.
- **A drag's far side is the near side's movement turned across, fixed at the press.** `mirrorPoint`
  takes the transform of the vertex nearest the point, so mirroring a drag's target every step changes
  transform when a different vertex is nearest, and across a shoulder that threw the far side 4.71 in
  one step among steps of .18 (Move, `postpose.sxr`; Drag 5.57 and 9.43). `PosedSymmetry.dragTurn` is a
  rotation, so the far side moves as far as the near one. Drag and Slide take it each step at the current
  point and keep their own far point. The selection is still gathered by `mirrorPoint`.
- **Revert works on a fix**: on a saved pose with no layer being edited, `Skinning.fixOnScreen` measures
  what the fix adds to the level on screen at the press, the brush takes that away, and `commitFix` takes
  the same out of the fix. Old `pose:` rest layers aren't reached: use Clear.
- Undoing a custom step must not commit (`StateManager`): the pose is on screen and not on the
  stack, so the commit stored the whole pose in rest.
- **A fix has details of its own above the bound level.** The layer only has the bound level's
  vertices, and most of a fine stroke goes in the levels above (Smooth kept .15 of .92 without
  them). `track.correctiveDetails` is layer -> level -> array; `level._detailsFix` is their
  weighted sum, added when a level draws (`applyDetails`) and taken off when it measures
  (`computeDetails`). So `_detailsXYZ` stays free of them through every fold, and nothing drifts.
- Each stroke re-derives every detail on the level, moving most by a hair, so a change under .1%
  of the stroke's largest stays out of the fix (7000 vertices of 9500 otherwise, every stroke).
- A saved level holds what was on screen, fixes included, and the load reads its details from
  that. So SKEL v31 stores each fix's weight at the save, and the load takes that share out.
- Mirror can't copy detail numbers across: each is in its own vertex's surface frame, and the
  frames either side aren't reflections. It builds the levels at rest with and without the fix,
  reflects the difference, and measures what details would make that.
- **A level between the bound one and the one on screen keeps stale normals** through every skin
  pass: only the displayed level gets a refresh, and details are drawn by normals. So a tool that
  borrows the levels has to put the normals back, not recompute them (.365 across the body).
  It's a likely cause of a file saved posed coming back .24 off at the bind pose with a level
  above the first: the load measures with fresh normals what was drawn with stale ones. That
  happens with no fix at all and isn't fixed.

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
- **A hidden Browser pane runs no frames.** The skin pass doesn't run and screenshots go
  stale: step `Skinning.update(app)` by hand, and pose a joint by writing **both**
  `getMatrix()` and `getThreeMesh().matrix`.
- **Compare both sides bone by bone at rest**, pairing each vertex with its mirror. A real
  stroke, driven by canvas events (the pick scanned for a pixel on the bone, as pins win it),
  showed in one run which tools mirror and which don't.

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
- **Detail elsewhere smooths away over repeated strokes.** Pitfall 11 fits this (a false mask
  folds whole limbs on every press) but it hasn't been confirmed as the same report.
  `Settings > Freeze Sculpt Fold (bisect)` (`window._skinNoFold`) still exists to test it.
- **`Slide` while posed is unmeasured**: converted, but it barely registered in the test and
  moves a lot at bind (9.9, snapping 3.5 on release). Its and `Twist`'s rotation/axis mirrors
  are still plain reflections.
- **A hard twist still snaps** (Move 1.4 at 1.2 + 1.3 rad on a 3-unit brush).
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

## Pose Fixes section

The blendshape panel lists every pose fix in the scene under a foldable `Pose Fixes (n)`, whatever is selected. Each row shows the weight the rig is giving it. The eye turns a fix off without losing it (`track.correctiveMuted`, SKEL v33): `RigPoses.drive` weighs it 0, so the offset, details above the bound level and an older file's layer all follow. The header's eye does them all. A stroke on a muted fix goes to the rest shape and the status reads `pre`. The bin is Clear Fix. Bake and Mirror stay in the bone panel.
