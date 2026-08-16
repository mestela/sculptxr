# Rigging on multires level 0 (design)

Status: designed, not built. Written at the end of the v3.18.3 session.

Goal: bind and pose the LOWEST multires level and have the higher levels ride along, so a
rigged sculpt stays sculptable and the weight solve runs on a few thousand vertices instead of
a few hundred thousand. This is the "cage" from the rigging plan, except the cage already
exists — it is multires level 0.

## The important finding: the machinery is already there

`MeshResolution` already does exactly the propagation this feature needs.

- `higherSynthesis(meshDown)` = `computePartialSubdivision(...)` on the level below, then
  `applyDetails()` — re-applies each high-level vertex's stored `_detailsXYZ` displacement in
  its local frame. That IS "edit the low level, keep the sculpted detail above it".
- `lowerAnalysis(meshUp)` is the inverse, and `Multimesh.selectResolution(sel)` already walks
  the chain in either direction.

So there is no new deformation maths to invent. The work is plumbing plus one open question
about cost.

## What has to change

1. **Bind against level 0, not the displayed level.** `Skinning.bind` reads
   `mesh.getVertices()` / `getNbVertices()`, which on a `Multimesh` delegate to the CURRENT
   level. Binding while displaying level 3 therefore builds a weight map indexed by level-3
   vertices. Bind must explicitly target `multimesh._meshes[0]`, and `_skinRest` / `_skinSrc` /
   `_skinIdx` / `_skinW` must be understood as level-0 arrays.
2. **Skin level 0, then synthesise up.** `Skinning.apply` writes the posed vertices, then the
   stack has to be walked from 0 up to the displayed level (the `higherSynthesis` chain) before
   the render buffers are updated.
3. **Serialization.** The `SKEL` v2 block stores a vertex count and refuses a mismatch. That
   count becomes level 0's, not the displayed level's — a version bump or an explicit
   "weights are level-0" flag, so an old file cannot be misread.
4. **The topology freeze gets narrower, and better.** Today binding freezes ALL topology. With
   level-0 weights, sculpting at higher levels only writes details and must stay legal; only
   ops that change level-0 topology (or add/remove levels) need blocking. That is the actual
   prize here — "rig freezes your model" stops being true, which is the thing that made
   Morphin's rigging unpleasant.

## The open question: per-frame cost

`selectResolution` runs the synthesis chain on a level CHANGE. This feature runs it on every
posed frame. `computePartialSubdivision` + `applyDetails` touch every vertex of every level
above 0, so the cost is roughly one subdivision pass per level per frame, in JS, at 90Hz.

**Measure before building.** Paste in the console with a multires mesh selected:

```js
(() => {
  const m = window.app.getMesh(), n = m._meshes ? m._meshes.length : 0;
  if (!n) return console.log('not a multires mesh');
  const sel = m._sel;
  for (let lvl = 1; lvl < n; lvl++) {
    m.selectResolution(0);
    const t = performance.now();
    for (let i = 0; i < 10; i++) { m.selectResolution(0); m.selectResolution(lvl); }
    console.log(`level 0 -> ${lvl} (${m._meshes[lvl].getNbVertices()} verts):`,
      ((performance.now() - t) / 10).toFixed(1), 'ms per round trip');
  }
  m.selectResolution(sel);
})();
```

Round trip includes the downward analysis, so the upward-only cost is roughly half. Budget at
90Hz is 11ms for EVERYTHING, so anything over ~3ms per synthesis means the naive per-frame
version is not viable as the default.

Likely outcomes, in order of preference:

- **Cheap enough for 1-2 levels** (most likely): ship it, and pose at a display level the
  synthesis can afford. A "pose at level N" control is honest and matches how people work.
- **Too slow**: pose at level 0 (display the cage while posing, synthesise once on release).
  Cheap to implement, and it is what every DCC does with a proxy anyway.
- **Only the top level matters**: skip intermediate levels by composing the subdivision, a real
  optimisation and a bigger job.

## Order to build

1. Run the measurement above. It decides the shape of everything below.
2. Bind targets level 0 (isolated, testable without any per-frame work: bind at level 0,
   switch levels manually, confirm the weights still address the right vertices).
3. Per-frame synthesis behind a flag, defaulting to synthesise-on-release.
4. Narrow the topology gate to level-0-changing ops.
5. Serialization flag + refusal on mismatch.

## Trap to avoid

The eval order is already committed to: `posed = skin(base + blendshapeδ + layerδ)`, deltas in
REST space, with `Skinning.captureSource` hooked into `AnimationRegistry.applyBlendshapes` as
the single composite point. Level 0 becomes the space that composite lives in. Do not let the
synthesis chain write back into `_skinSrc` — the skin pass must keep reading a rest-space
source it does not own, or it will re-transform its own output every frame. That bug has been
hit once already in this system.
