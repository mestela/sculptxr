# Vertex performance recording ("keep alive" sculpting)

Shipped **v3.13.0**. Extends the transform performance-recorder (the #29 "tape recorder")
from the object matrix to **vertex deformation**: sculpt while the timeline loops and the
live deformation is captured as animation. Puppeteer a sculpt into motion — Move-brush a
hairstyle to wiggle in the wind, then loop it — and layer it up in waves.

## How to use

1. Open the Animation panel, set **Key mode → Shape** (VR: the ACP mode buttons).
2. Arm **Record**. The loop starts playing.
3. Hold the trigger (VR) / mouse (desktop) and sculpt with a constant-topology brush
   (Move, Drag, Inflate, Smooth, Crease). Keys are laid down **only while held**.
4. Release — the loop keeps playing your take. Hold again over another span/region to add
   another wave on top. Stop Record to finish.

## Design

Everything lives in `AnimationRegistry` + a few gate changes; storage reuses the existing
**ShotSculpt** shape-key path (`shapeTimes[]` + full-mesh `Float32Array` in `shapes[]`),
so playback interpolation, save/load, and undo came largely for free.

- **Capture** (unified into `update()`, v3.13.3): while a stroke is active, the same
  render-loop pass that rebases the display also captures the pose — one clock, no
  setInterval race. Keys **snap to a fixed frame grid** anchored at 0
  (`frameStep = round(captureRate × fps)` whole frames), written at most once per grid
  cell, so they land on the same frames every loop (no rolling drift) and re-passing a
  cell overwrites that exact slot. Keys are only laid while `_vrSculpting || _action ===
  SCULPT_EDIT`. The writer is `_captureShapeKeyGridded(track, keyTime, keyVerts)` — kept
  layer-generic for the planned per-layer recording.
- **Per-wave undo** (v3.13.3): on each trigger release, `_pushShapeWaveUndo` pushes a state
  that restores the shape track to its pre-stroke snapshot, with `squash = true` so it
  chains with the sculpt's own geometry state — one undo removes both the keys and the
  deformation of that wave. Shape takes therefore do NOT push a take-level undo in
  `stopRecording` (that's transform-only now).
- **Keep the loop playing during a take**: normally the mesh being recorded is skipped by
  playback (render-loop guards in `Scene.js` + `update()`'s early-return) and sculpting
  pauses playback (`SculptManager.start`). All three are exempted for a shape take so the
  transport keeps looping and you can puppeteer in waves.
- **Additive waves without freezing** (`update()` rebase): while a stroke is live, each
  frame re-lays the brush's contribution on top of the **prior waves' composite** at the
  current playhead: `verts[i] = priorComposite(t)[i] + (verts[i] − lastFrameBase[i])`,
  evaluated from a shallow snapshot of the pre-stroke track (`_evalShapeSnapshot`).
  Untouched verts keep following the earlier motion; the verts the brush pins (Move caches
  each grabbed vert's start position) ride your hand on top. Because the buffer is now the
  composite result, `captureTick` just snapshots it raw. The rebase is wrapped in
  try/catch — a per-frame deform in the render loop must never take down rendering.
- **Cursor**: the draw cursor is normally hidden during playback (`Selection.js` desktop,
  `Scene.js` cursorGroup for VR); both are exempted during a shape take.

## MVP limitations (deliberate — YAGNI)

- **Full-mesh snapshots.** Each key stores the whole vertex buffer, so a take on a dense
  mesh is large. Use on **lightweight sculpts** for now. The planned optimization is
  sparse deltas (moved verts only) with a delta playback branch — deferred until memory
  actually bites.
- **Fixed topology only.** dyntopo / voxel / a mid-take multires level switch changes the
  vertex count and is skipped with a warning. Turn dyntopo off before recording.
- **Grabbed-region fidelity during an active drag** is approximate (the pinned verts drift
  smoothly with the underlying motion rather than tracking it rigidly). Fine in practice;
  a candidate for tuning.
- **Non-Move brushes** (Inflate/Smooth/Drag/Crease) touch different verts each sub-step, so
  the rebase math is more approximate for them than for Move's clean grab model.

## Planned next step: animation layers (deferred — needs UX planning)

The current design records everything onto one shape track, compositing the live sculpt
onto the moving playback each frame (the rebase). That's stable now (grid-snap + single
clock), but it has a structural ceiling. The agreed next direction is **layers**: "define a
new layer, move the eyes; new layer, move the cheeks; new layer, move the hair." Each layer
is an independent time-varying shape track; while recording a new layer, the layers below
play **read-only** (never written), which removes the compositing fight by construction and
gives non-destructive edit/mute/solo/delete (reusing the blendshape stack panel UI). It's
also the natural home for sparse-delta storage (lifting the lightweight-sculpt limit).

The capture engine is already layer-ready — `_captureShapeKeyGridded` and the pre-stroke
snapshot both take/produce a track explicitly, so layers is "add a track stack + swap the
rebase base to 'composite of lower layers' + build the UI." **Deferred pending UX design**
(matt: layers needs planning on the interaction side). Tracked as roadmap **#34**.

### The motivating case: an edit that RIDES an earlier motion

matt 2026-07-06: record the jaw opening with a big Move brush (wave 1), then go in with a
small Move brush to pull the mouth corners into a smile. Today that fails — the moment you
grab the corner verts the Move tool pins them to their **grab-time positions** (`vProxy`),
so during the stroke they stop following the jaw and you get a chunk of face that no longer
rides the jaw, with a seam at the brush-radius edge. And it's baked into the recording,
because one **absolute** track can't express "this edit rides that motion."

**Layers fix this by construction.** Each layer stores a per-vertex **delta (offset)** and
playback is `base + jawLayer(t) + mouthLayer(t) + …`. A mouth-corner vertex that's also near
the chin resolves to `base + jaw_offset(t) + smile_offset(t)` — it rides the jaw *and*
carries the smile, automatically. The seam vanishes too: the smile is a smooth additive bump
(brush falloff → 0 across the radius) on top of a continuous jaw motion, so both sides of the
brush edge ride the jaw and differ only by the smooth falloff. This composition is the whole
reason to store deltas — the current absolute full-mesh model structurally cannot do it, so
**delta storage (finally the deferred sparse-delta representation) is part of the layers
build, not optional.**

### Two capture modes (a UX fork to decide when planning)

While you *record* a new layer, the layers below are playing underneath. The Move tool still
pins to a frozen grab-pose, so **during the stroke** the grabbed verts would again stop
following the lower motion (and seam) unless we rebase the tool's grab reference to the live
lower-composite each frame. That's the same rebase we already do, just feeding the tool a
moving base. It splits into two interactions — decide which (or both) to offer:

1. **"Pose that rides" (cheap; probably covers the smile case).** Park the playhead, sculpt
   the layer once as a *static* delta. Stored as an offset, it rides the moving lower layers
   automatically on playback. A constant expression over animated motion — no moving-reference
   machinery needed. Likely all you need for a fixed smile/frown/brow.
2. **"Perform on top" (the ambitious version).** Animate the layer *over time* while watching
   the lower layers move live. Requires the **moving-reference** fix: each frame, rebase the
   active tool's grab reference (`vProxy` for Move; the analogous anchor for other brushes) to
   the live lower-composite, so grabbed verts ride the underlying motion *during* the stroke
   and the captured delta stays clean (pure drag, not drag-minus-motion). More work, and the
   real layered-puppeteering experience.

**Open UX questions for planning:** how you create/enter/exit a layer and see which is
active; how the lower composite is presented while recording (ghost? full-opacity live?);
per-layer mute/solo/reorder/delete (reuse blendshape stack panel); whether "new layer" is a
distinct gesture or implied by starting to record; and whether mode (1) vs (2) is a toggle or
automatic (playhead parked → static, playhead rolling → performed).

## Known "exciting" issues (open)

- _(to be filled in as matt reports them — grabbed-region fidelity during a drag and
  non-Move brush accuracy are the current suspects; see MVP limitations above.)_

## Known "exciting" issues (open)

- _(to be filled in as matt reports them — grabbed-region fidelity during a drag and
  non-Move brush accuracy are the current suspects; see MVP limitations above.)_

## Related

- Transform performance recording (#29) — the tape recorder this extends.
- FrameGroup cel animation — the varying-topology counterpart (discrete frame swaps);
  vertex keep-alive is the fixed-topology continuous-motion partner.
- Future: hand-tracking puppetry (#28) records into these same tracks.
