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

- **Capture** (`captureTick`, shape branch): while a stroke is active it snapshots
  `mesh.getVertices()` into the shape track at `_animCaptureRate`, clocked off the visible
  playhead (`globalPlaybackTime`) so keys land under the playhead. Punch-in overwrite is a
  narrow ±½-rate window around the playhead, so re-performing one span leaves other waves
  untouched. Keys are only laid while `_vrSculpting || _action === SCULPT_EDIT`.
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

## Known "exciting" issues (open)

- _(to be filled in as matt reports them — the feature shipped v3.13.0 with matt noting
  "issues, but exciting cool issues")_

## Related

- Transform performance recording (#29) — the tape recorder this extends.
- FrameGroup cel animation — the varying-topology counterpart (discrete frame swaps);
  vertex keep-alive is the fixed-topology continuous-motion partner.
- Future: hand-tracking puppetry (#28) records into these same tracks.
