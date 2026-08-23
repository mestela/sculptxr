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

// World distance along the curve that a drag reaches. Arc length rather than a frame count,
// because this is a sculpting gesture and it should feel like a brush radius. A fast section of
// the curve therefore covers fewer frames than a slow one, which is a real trade and the first
// thing to revisit if editing a snappy move feels too broad.
const DEFAULT_RADIUS = 0.35;

function tune(key, dflt) {
  const v = window[key];
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

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

// Smoothstep, so the edit blends into the untouched curve instead of ending in a corner.
function falloff(d, radius) {
  if (!(radius > 0)) return d === 0 ? 1 : 0;
  const x = Math.min(1, Math.abs(d) / radius);
  const inv = 1 - x;
  return inv * inv * (3 - 2 * inv);
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

MotionPathEdit.radius = function () { return tune('_pathEditRadius', DEFAULT_RADIUS); };

export default MotionPathEdit;
