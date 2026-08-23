// EDITING A MOTION PATH DIRECTLY, and pushing the result back onto the keys.
//
// The idea, from matt: see a control that is not moving right, expose its motion path, and use
// the sculpting tools on it — Move it into place, Smooth or Relax the noise out — then have the
// corrected curve become the corrected motion. Houdini's newer animation toolkit does the same
// round trip; this is the version that runs through a sculpting app's own gestures.
//
// FOUR DECISIONS HOLD THE WHOLE THING UP.
//
// 1. ONLY A CONTROL IS EDITABLE. An IK-driven bone's position is solver OUTPUT, constrained by
//    bone lengths; pushing an arbitrary curve onto a knee asks for something the limb cannot do,
//    and the result would quietly disagree with what was drawn. A pin is a free 6DOF control, so
//    any curve is reachable. MotionTrail already separates the two: the authored (control) curve
//    is the solid one, and only that one arrives here.
//
// 2. EVERY POINT OWNS ITS TIME, IMMUTABLY. A brush moves points in space; time never moves.
//    Editing is then a pure spatial displacement field over time, and push-back is well defined.
//    Retiming stays the dopesheet's job — one gesture meaning both "move it there" and "get
//    there sooner" is where this kind of tool usually goes bad.
//
// 3. FALLOFF RUNS ALONG THE STRAND, NOT THROUGH SPACE. This is the decision that makes real
//    animation editable. A walk cycle or a hand returning to the same spot passes NEAR ITSELF at
//    two very different times; a spherical brush would grab both passes and wreck frame 90 while
//    fixing frame 12. Measured along the curve, the other pass is far away, so it is untouched.
//
// 4. PUSH BACK A DELTA, NOT A POSITION. Each key moves by the residual at its own time, so
//    tangents, rotation, and every key that was not sculpted survive untouched. Only position
//    channels change, and only where the curve actually moved.

const MotionPathEdit = {};

// WHICH TOOL DOES WHAT, which is not a cosmetic choice — it decides what the falloff is for.
//
//   MOVE  moves vertices with falloff. On a strand that is a soft edit: grab the curve and the
//         neighbouring samples come with it, which is the gesture for sculpting a path into
//         place or easing a section over. The radius is the BRUSH radius, so the control and
//         the cursor ring the user already has are the ones that size the edit.
//   GRAB  moves an object. On a strand the object under the pointer is a single SAMPLE, so a
//         grab moves exactly one point and nothing else — a hard edit of one instant. That is
//         a radius of zero through the same machinery, not a separate path.
//
// The radius is measured in ARC LENGTH along the curve. A fast section therefore covers fewer
// frames than a slow one, which is a real trade and the first thing to revisit if editing a
// snappy move feels too broad.

// Cumulative arc length, so falloff can be measured in world units along the curve.
function arcLengths(points) {
  const s = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    s.push(s[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return s;
}

// SculptGL's own brush falloff, lifted from Move.move() rather than approximated. A Move on a
// motion path has to feel like a Move on a mesh, and two curves that are merely similar would
// diverge the first time either was tuned.
//
// Radius zero is the GRAB case: one sample, full weight, nothing else touched.
function falloff(d, radius) {
  if (!(radius > 0)) return d === 0 ? 1 : 0;
  const dist = Math.min(1, Math.abs(d) / radius);
  let f = dist * dist;
  f = 3.0 * f * f - 4.0 * f * dist + 1.0;
  return f;
}

// The weight each sample takes from a drag centred on `index`.
MotionPathEdit.weights = function (points, index, radius) {
  const s = arcLengths(points);
  const c = s[index];
  return s.map((si) => falloff(si - c, radius));
};

// The sample a click landed on: nearest in SCREEN space, since that is what "I clicked the
// curve" means. Returns -1 when nothing is within reach, so the click falls through to whatever
// it would otherwise have done.
MotionPathEdit.hit = function (points, project, x, y, radiusPx) {
  let best = -1;
  let bestD = radiusPx * radiusPx;
  for (let i = 0; i < points.length; i++) {
    const p = project(points[i]);
    if (!p) continue;
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
};

// Apply a drag: every sample moves by `delta` scaled by its weight. Pure, and returns new
// points, so the original stays available as the baseline the residual is measured against —
// re-reading a mutated curve as its own baseline is how a drag ends up applied twice.
MotionPathEdit.displace = function (points, index, delta, radius) {
  const w = MotionPathEdit.weights(points, index, radius);
  return points.map((p, i) => ({
    x: p.x + delta.x * w[i],
    y: p.y + delta.y * w[i],
    z: p.z + delta.z * w[i],
  }));
};

// The residual at an arbitrary time, from the sampled before/after curves. Samples land on key
// times (MotionTrail.sampleTimes), so a key is normally an exact hit; the interpolation is the
// honest fallback for a key that is not, rather than a silent snap to the nearest sample.
MotionPathEdit.residualAt = function (times, before, after, t) {
  if (!times.length) return null;
  if (t <= times[0]) return sub(after[0], before[0]);
  if (t >= times[times.length - 1]) {
    const n = times.length - 1;
    return sub(after[n], before[n]);
  }
  let i = 1;
  while (i < times.length && times[i] < t) i++;
  const t0 = times[i - 1], t1 = times[i];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = sub(after[i - 1], before[i - 1]);
  const b = sub(after[i], before[i]);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
};

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

// PUSH BACK. Every key of `track` inside the sampled span moves by the residual at its own time.
// Returns the number of keys moved, and mutates track.positions in place — the caller owns the
// undo step, because the edit is one gesture and has to undo as one.
//
// Keys OUTSIDE the sampled span are left alone: the curve makes no claim about them, and moving
// them would edit animation the user could not see while they were sculpting.
MotionPathEdit.pushBack = function (track, times, before, after) {
  if (!track || !track.times || !track.positions || !times.length) return 0;
  const lo = times[0], hi = times[times.length - 1];
  let moved = 0;
  for (let k = 0; k < track.times.length; k++) {
    const t = track.times[k];
    if (t < lo || t > hi) continue;
    const d = MotionPathEdit.residualAt(times, before, after, t);
    if (!d || (d.x === 0 && d.y === 0 && d.z === 0)) continue;
    track.positions[k * 3] += d.x;
    track.positions[k * 3 + 1] += d.y;
    track.positions[k * 3 + 2] += d.z;
    moved++;
  }
  if (moved) track.eulers = null;   // the registry rebuilds these from the written values
  return moved;
};

// A pin the outliner has parented is NOT editable this way, and the refusal is deliberate.
// Keys store the LOCAL matrix translation while the curve is drawn in model space, so with a
// parent between them the residual is in the wrong space — and the parent's own transform may
// be animated, which makes the conversion time-varying rather than a single matrix. Declining is
// honest; guessing would move the keys by a wrong amount that still looks plausible.
MotionPathEdit.editable = function (pin) {
  if (!pin) return false;
  const parent = pin.getParent ? pin.getParent() : pin._parent;
  return !parent;
};

// ── THE STROKE ────────────────────────────────────────────────────────────────────────────
//
// A session lives on `main._pathEdit` for the length of one drag. It holds the BASELINE curve —
// the points as they were when the drag started — because every frame's displacement is measured
// against that one baseline. Re-reading the curve that is already being dragged would compound
// the delta and the edit would run away under the cursor.

// The drag moves in the camera plane through the grabbed sample, which is what dragging a point
// on screen means. Depth is taken from the sample, so the point tracks the cursor rather than
// sliding toward or away from the eye.
function worldAt(camera, sampleScreenZ, x, y) {
  const w = camera.unproject(x, y, sampleScreenZ);
  return { x: w[0], y: w[1], z: w[2] };
}

// Try to take hold of the authored curve. Returns false when the pointer is not on it, so the
// stroke falls through to whatever it would have done — sculpting the mesh, usually.
MotionPathEdit.begin = function (main, x, y, radius, radiusPx) {
  const strand = main._trailStrand;
  if (!strand || !strand.points || strand.points.length < 2) return false;
  if (!MotionPathEdit.editable(strand.pin)) {
    console.log('[path] this pin is parented, so its motion path is not editable here');
    return false;
  }
  const camera = main.getCamera && main.getCamera();
  if (!camera) return false;

  const project = (p) => { const s = camera.project([p.x, p.y, p.z]); return { x: s[0], y: s[1] }; };
  const index = MotionPathEdit.hit(strand.points, project, x, y, radiusPx);
  if (index < 0) return false;

  const anchor = strand.points[index];
  const z = camera.project([anchor.x, anchor.y, anchor.z])[2];
  main._pathEdit = {
    strand: strand,
    index: index,
    radius: radius,
    screenZ: z,
    // Deep copy: the baseline must not be a view of the array the drag writes to.
    before: strand.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    startWorld: worldAt(camera, z, x, y),
    after: null,
  };
  return true;
};

MotionPathEdit.drag = function (main, x, y) {
  const e = main._pathEdit;
  if (!e) return false;
  const camera = main.getCamera && main.getCamera();
  if (!camera) return false;
  const now = worldAt(camera, e.screenZ, x, y);
  const delta = { x: now.x - e.startWorld.x, y: now.y - e.startWorld.y, z: now.z - e.startWorld.z };
  e.after = MotionPathEdit.displace(e.before, e.index, delta, e.radius);
  return true;
};

// Push back, as ONE undo step covering the keys the whole gesture moved. The strand itself is
// not undone: it is transient, and the next rebuild re-derives it from the keys — which is the
// real check that push-back did what the curve said.
MotionPathEdit.finish = function (main) {
  const e = main._pathEdit;
  main._pathEdit = null;
  if (!e || !e.after) return 0;

  const reg = window._animationRegistry;
  const track = reg && reg.tracks && reg.tracks.get(e.strand.pin.getID());
  if (!track) return 0;

  const beforePos = track.positions.slice();
  const moved = MotionPathEdit.pushBack(track, e.strand.times, e.before, e.after);
  if (!moved) return 0;

  const afterPos = track.positions.slice();
  const sm = main.getStateManager && main.getStateManager();
  const put = (arr) => {
    const t = reg.tracks.get(e.strand.pin.getID());
    if (!t) return;
    t.positions = arr.slice();
    t.eulers = null;
    reg.update(e.strand.pin, true);
  };
  if (sm && sm.pushStateCustom) {
    sm.pushStateCustom(() => put(beforePos), () => put(afterPos), false, 'Edit Motion Path');
  }
  reg.update(e.strand.pin, true);
  return moved;
};

MotionPathEdit.active = function (main) { return !!(main && main._pathEdit); };

export default MotionPathEdit;
