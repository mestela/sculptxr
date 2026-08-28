import getOptionsURL from '../misc/getOptionsURL.js';
import Enums from '../misc/Enums.js';
import IKSolver from './IKSolver.js';
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

// CONNECTIVITY, which is the only axis that matters here.
//
//   on  — distance measured ALONG the strand (arc length). Because a motion path is monotonic
//         in time, travelling along it IS travelling through time: near on the strand and near
//         in the animation are the same thing. So this is implicitly a time-ordered falloff,
//         and a path that passes near itself is not edited in two places at once.
//   off — plain Euclidean distance, ignoring the strand. This reaches EVERY pass through a
//         region, which is right when a hand keeps clipping the same table at four different
//         times, and wrong on a walk cycle, where it wrecks frame 90 while you fix frame 12.
//
// The same distinction the sculpt brushes draw between a connected falloff and a plain radius,
// which is why it is named the same thing.
MotionPathEdit.weights = function (points, index, radius, opts) {
  if (opts && opts.connected === false) {
    const c = points[index];
    return points.map((p) => {
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      return falloff(Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
    });
  }
  const s = arcLengths(points);
  const c = s[index];
  return s.map((si) => falloff(si - c, radius));
};

// Live value first, then the saved one — the same order every other persisted setting is read
// in, so a toggle takes effect on the current stroke.
MotionPathEdit.connected = function () {
  if (window._pathConnected != null) return !!window._pathConnected;
  const v = getOptionsURL().pathConnected;
  return v == null ? true : !!v;
};

// WHICH CHANNEL OF THE KEYS AN EDIT IS ALLOWED TO WRITE.
//
// A 6DOF grab produces both a translation and a rotation whether you wanted both or not — your
// hand cannot move without also turning a little. Once the twist reached the orientations that
// stopped being free: a drag meant to nudge a path sideways would also nod every gnomon it
// passed. matt: "i can see cases where i'll want to affect just positions, or just rotations, or
// both."
//
// GLOBAL, not per tool, following `connected` above: Move and Smooth both edit the same curve
// and "which channel am I editing" is a fact about the edit rather than about the brush. Two
// tools with separate answers would be two places to look when one of them surprises you.
//
// Live value first, then saved, then true — the same order every persisted setting is read in,
// so a toggle takes effect on the current stroke.
MotionPathEdit.channels = function () {
  const saved = getOptionsURL();
  const read = (liveKey, savedKey) => {
    const live = window[liveKey];
    if (live != null) return !!live;
    const v = saved[savedKey];
    return v == null ? true : !!v;
  };
  return {
    translate: read('_pathTranslate', 'pathTranslate'),
    rotate: read('_pathRotate', 'pathRotate'),
  };
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
// 6DOF. Twisting the controller turns the section you are holding, exactly as it does to
// vertices under a mesh Move — the behaviour is lifted from `Move.move()` rather than invented,
// because "the same as the move tool" is the whole requirement:
//
//   rotate the point about the GRAB POINT, take the displacement that produced, add it to the
//   translation, and scale the sum by the falloff.
//
// Rotating about the grab point rather than each point's own position is what makes a twist
// swing the curve around your hand instead of spinning every sample in place.
function rotateAbout(p, q, c, out) {
  const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
  // Standard quaternion-vector rotation: t = 2 * (q.xyz X v); v' = v + q.w * t + (q.xyz X t).
  const tx = 2 * (q[1] * z - q[2] * y);
  const ty = 2 * (q[2] * x - q[0] * z);
  const tz = 2 * (q[0] * y - q[1] * x);
  out.x = x + q[3] * tx + (q[1] * tz - q[2] * ty);
  out.y = y + q[3] * ty + (q[2] * tx - q[0] * tz);
  out.z = z + q[3] * tz + (q[0] * ty - q[1] * tx);
  // Returned as the DISPLACEMENT the rotation caused, not the rotated point, so the caller adds
  // it to the translation the same way move() does.
  out.x -= x; out.y -= y; out.z -= z;
  return out;
}

const _rot = { x: 0, y: 0, z: 0 };

// A gate is expressed as a zero delta rather than as a branch around displace: the curve still
// has to be rebuilt and redrawn every frame, or a Rotate-only drag would leave the path drawn
// from a stale array.
const ZERO = { x: 0, y: 0, z: 0 };

MotionPathEdit.displace = function (points, index, delta, radius, rotQuat, rotCenter, opts) {
  const w = MotionPathEdit.weights(points, index, radius, opts);
  const c = rotCenter || points[index];
  return points.map((p, i) => {
    let rx = 0, ry = 0, rz = 0;
    if (rotQuat) {
      rotateAbout(p, rotQuat, c, _rot);
      rx = _rot.x; ry = _rot.y; rz = _rot.z;
    }
    return {
      x: p.x + (delta.x + rx) * w[i],
      y: p.y + (delta.y + ry) * w[i],
      z: p.z + (delta.z + rz) * w[i],
    };
  });
};

// The controller's rotation since the grab, damped by the tool's intensity — the same slerp
// from identity that Move uses, so the strength slider means the same thing on a curve as it
// does on a mesh.
function twistSince(startInv, nowQ, intensity) {
  if (!startInv || !nowQ) return null;
  const x = nowQ[0], y = nowQ[1], z = nowQ[2], w = nowQ[3];
  const ax = startInv[0], ay = startInv[1], az = startInv[2], aw = startInv[3];
  const d = [
    w * ax + x * aw + y * az - z * ay,
    w * ay - x * az + y * aw + z * ax,
    w * az + x * ay - y * ax + z * aw,
    w * aw - x * ax - y * ay - z * az,
  ];
  return scaleQuat(d, intensity == null ? 1 : intensity);
}

// ── QUATERNION ARITHMETIC ─────────────────────────────────────────────────────────────────
//
// Four small functions rather than a THREE import: this module is loaded by the tools and by
// the harness, and the harness reads the real source with its imports stripped. Everything here
// is on plain [x, y, z, w] arrays; `readQ` is the one seam, because the sampled orientations
// arrive as THREE.Quaternion and the edited ones go back out as plain objects for the drawing.

// A rotation scaled to `k` of itself — the slerp from identity. THIS IS WHY A WEIGHT CANNOT
// JUST MULTIPLY A QUATERNION: scaling the components gives something that is not a rotation,
// and normalising it afterwards gives the wrong ANGLE. Lifted out of twistSince unchanged,
// because the falloff along the strand needs exactly the same operation the intensity slider
// needed, and two copies of a slerp is two chances to get the short-arc wrong.
function scaleQuat(d, intensity) {
  const k = Math.max(0, Math.min(1, intensity));
  if (k >= 0.999) return d;
  // Short-arc: without the sign flip a twist past a half turn unwinds the long way round,
  // which reads as the curve snapping backwards mid-drag.
  let cw = d[3];
  let sx = d[0], sy = d[1], sz = d[2];
  if (cw < 0) { cw = -cw; sx = -sx; sy = -sy; sz = -sz; }
  if (cw > 0.9995) return [sx * k, sy * k, sz * k, 1 - k + cw * k];
  const th = Math.acos(cw);
  const s = Math.sin(th);
  const a = Math.sin((1 - k) * th) / s;
  const b = Math.sin(k * th) / s;
  return [sx * b, sy * b, sz * b, a + cw * b];
}

function readQ(q) {
  if (!q) return null;
  return Array.isArray(q) ? q : [q.x, q.y, q.z, q.w];
}

function invQ(q) { return [-q[0], -q[1], -q[2], q[3]]; }   // unit: the conjugate is the inverse

function mulQ(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// Written back normalised. A key can be twisted repeatedly across many strokes, and each one is
// a multiply; without this the error compounds until the decompose that reads it starts
// reporting a scale as well as a rotation.
function normQ(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// THE TWIST AS A ROTATION, which is the other half of what a 6DOF grab means and the half that
// was missing. The positions already swung around the hand — `displace` has taken a rotation
// since v3.20.26 — but the ORIENTATIONS keyed at each key did not move at all, so the gnomons
// went on drawing the old rotation along the new path. matt: the gnomons "are not hooked into
// the grab tool to allow the user to twist and sculpt those keys".
//
// PREMULTIPLIED, because the twist happens in the world the curve is drawn in and not in each
// sample's own frame: `delta * q` turns the sample about the axis your wrist turned about, so a
// section swings together. `q * delta` would turn each one about its OWN axis, which reads as
// every gnomon spinning in place — the same distinction that makes `displace` rotate about the
// grab point rather than about each sample.
MotionPathEdit.twisted = function (points, quats, index, delta, radius, opts) {
  if (!quats || !delta || !points) return null;
  // From the same points, index, radius and falloff mode the positions used, so the two halves
  // of ONE gesture cannot disagree about how far the edit reaches.
  const w = MotionPathEdit.weights(points, index, radius, opts);
  return quats.map((q, i) => {
    const b = readQ(q);
    if (!b) return q;
    const r = normQ(mulQ(scaleQuat(delta, w[i]), b));
    return { x: r[0], y: r[1], z: r[2], w: r[3] };
  });
};

// SMOOTH, which on a strand is a 1D Laplacian along it — each sample toward the average of its
// two neighbours, scaled by the same falloff. On a mesh "smooth" is ambiguous enough to need a
// whole tool; on a curve it has exactly one meaning, and it is precisely noise removal: the
// jitter of a hand-recorded take is high-frequency deviation from the curve its neighbours
// describe.
//
// The ENDS ARE PINNED. A Laplacian shortens a curve, so an unpinned end creeps inward every
// pass and the animation quietly loses its first and last poses — which look like keys drifting
// for no reason. Endpoints keep their positions and only the interior relaxes.
MotionPathEdit.smoothed = function (points, index, radius, strength, opts) {
  const w = MotionPathEdit.weights(points, index, radius, opts);
  const k = Math.max(0, Math.min(1, strength == null ? 0.5 : strength));
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return { x: p.x, y: p.y, z: p.z };
    const a = points[i - 1], b = points[i + 1];
    const t = k * w[i];
    return {
      x: p.x + ((a.x + b.x) * 0.5 - p.x) * t,
      y: p.y + ((a.y + b.y) * 0.5 - p.y) * t,
      z: p.z + ((a.z + b.z) * 0.5 - p.z) * t,
    };
  });
};

// SMOOTH ON THE ROTATION CHANNEL. Each orientation is slerped toward the halfway rotation
// between its two neighbours, by the same falloff-scaled amount the positions use — the same
// 1D Laplacian, on the sphere instead of in space. A hand-recorded take jitters in rotation
// exactly as it does in position, and it is the same noise.
//
// The ENDS ARE PINNED for the same reason: a Laplacian pulls toward the middle, so an unpinned
// end would creep off its authored pose every pass.
MotionPathEdit.smoothedQuats = function (points, quats, index, radius, strength, opts) {
  if (!quats || !points) return null;
  const w = MotionPathEdit.weights(points, index, radius, opts);
  const k = Math.max(0, Math.min(1, strength == null ? 0.5 : strength));
  const out = quats.map((q) => {
    const a = readQ(q);
    return a ? { x: a[0], y: a[1], z: a[2], w: a[3] } : q;
  });
  for (let i = 1; i < quats.length - 1; i++) {
    const a = readQ(quats[i - 1]), b = readQ(quats[i + 1]), c = readQ(quats[i]);
    if (!a || !b || !c) continue;
    // The rotation halfway between the neighbours, then c moved toward it. Both are slerps,
    // for the reason a weight is: the average of two quaternions is not their midpoint.
    const mid = mulQ(a, scaleQuat(mulQ(invQ(a), b), 0.5));
    const r = normQ(mulQ(c, scaleQuat(mulQ(invQ(c), mid), k * w[i])));
    out[i] = { x: r[0], y: r[1], z: r[2], w: r[3] };
  }
  return out;
};

// One pass of smoothing per stroke frame, accumulating. Unlike a Move — which measures every
// frame against the baseline — smoothing is iterative by nature: holding the brush still should
// keep relaxing. So it reads the CURRENT curve and writes back, while `before` stays the
// baseline push-back measures against.
MotionPathEdit.smoothStep = function (main, strength) {
  const e = main._pathEdit;
  if (!e) return false;
  const ch = e.channels || { translate: true, rotate: true };
  // Both passes measure their falloff from the SAME positions, so a rotation-only smooth still
  // reaches exactly as far along the strand as a positional one would have.
  const pts = e.after || e.before;
  // `after` IS THE CURRENT CURVE, always — that is the invariant everything downstream reads,
  // including the redraw, which calls writeLine with it. Leaving it null when the positions are
  // not being smoothed broke that and crashed the stroke on the first frame:
  //   "Cannot read properties of null (reading 'length')" at MotionTrail.writeLine.
  // With Translate off the curve is unchanged, so the current curve is the baseline — but it
  // still has to be SAID, not left absent.
  e.after = ch.translate
    ? MotionPathEdit.smoothed(pts, e.index, e.radius, strength, e.falloff)
    : pts;
  if (ch.rotate && e.beforeQ) {
    e.afterQ = MotionPathEdit.smoothedQuats(pts, e.afterQ || e.beforeQ, e.index, e.radius,
      strength, e.falloff);
  }
  return true;
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

// THE ROTATION RESIDUAL, which is a RATIO rather than a difference: how much a sample turned is
// `after * inv(before)`, not `after - before`. Interpolated between the two bracketing samples by
// slerp, for the same reason the weight is a slerp — a lerp between two rotations passes through
// the inside of the sphere and comes out short.
function residualQ(beforeQ, afterQ, i) {
  const a = readQ(afterQ[i]), b = readQ(beforeQ[i]);
  if (!a || !b) return null;
  return mulQ(a, invQ(b));
}

MotionPathEdit.residualQuatAt = function (times, beforeQ, afterQ, t) {
  if (!times.length || !beforeQ || !afterQ) return null;
  if (t <= times[0]) return residualQ(beforeQ, afterQ, 0);
  const n = times.length - 1;
  if (t >= times[n]) return residualQ(beforeQ, afterQ, n);
  let i = 1;
  while (i < times.length && times[i] < t) i++;
  const t0 = times[i - 1], t1 = times[i];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = residualQ(beforeQ, afterQ, i - 1);
  const b = residualQ(beforeQ, afterQ, i);
  if (!a || !b) return a || b;
  // slerp(a, b, u), expressed with the pieces already here: travel u of the way along the
  // rotation that takes a to b.
  return mulQ(a, scaleQuat(mulQ(invQ(a), b), u));
};

// Every key's ROTATION inside the span turns by the residual at its own time — the same rule,
// the same span and the same "keys outside are left alone" as pushBack, on the other channel.
//
// A SEPARATE FUNCTION rather than a flag on pushBack, because a gesture can move a curve without
// twisting it at all: a mouse drag has no rotation to write, and a Smooth pass has none either.
// Returning 0 from a function nobody called is clearer than a branch inside one that did.
//
// Keys hold the pin's LOCAL rotation while the sampled quats are MODEL space. That is exactly
// the mismatch `editable()` refuses a parented pin over — with no parent between them the two
// are the same rotation, so the refusal is what makes this correct rather than lucky.
MotionPathEdit.pushBackQuats = function (track, times, beforeQ, afterQ) {
  if (!track || !track.times || !track.quaternions) return 0;
  if (!beforeQ || !afterQ || !times.length) return 0;
  const lo = times[0], hi = times[times.length - 1];
  let turned = 0;
  for (let k = 0; k < track.times.length; k++) {
    const t = track.times[k];
    if (t < lo || t > hi) continue;
    const d = MotionPathEdit.residualQuatAt(times, beforeQ, afterQ, t);
    // A residual of identity is a key the gesture did not reach — outside the falloff, or a
    // drag with no twist in it. Writing it would still cost an undo entry and a re-solve.
    if (!d || Math.abs(d[3]) > 0.999999) continue;
    const o = k * 4;
    const q = normQ(mulQ(d, [track.quaternions[o], track.quaternions[o + 1],
      track.quaternions[o + 2], track.quaternions[o + 3]]));
    track.quaternions[o] = q[0]; track.quaternions[o + 1] = q[1];
    track.quaternions[o + 2] = q[2]; track.quaternions[o + 3] = q[3];
    turned++;
  }
  if (turned) track.eulers = null;   // the registry rebuilds these from the written values
  return turned;
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
function worldAt(main, camera, sampleScreenZ, x, y, anchor) {
  // Through the renderer's own inverse when it is available, for the same reason the hit test
  // is: a drag measured in a space the screen does not use moves the curve at the wrong RATE
  // (here, by 1/0.701) as well as from the wrong place.
  if (MotionPathEdit.unprojectHook && anchor) {
    const p = MotionPathEdit.unprojectHook(main, x, y, anchor);
    if (p) return p;
  }
  const w = camera.unproject(x, y, sampleScreenZ);
  return { x: w[0], y: w[1], z: w[2] };
}

// The brush radius as a length in the curve's own space, measured at the depth of the sample
// actually grabbed. Same conversion as before; it just goes through the renderer's projection
// now, so the reach matches the ring that is drawn for it.
function reachAt(main, camera, x, y, z, anchor, radiusPx) {
  const a = worldAt(main, camera, z, x, y, anchor);
  const b = worldAt(main, camera, z, x + radiusPx, y, anchor);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

// Try to take hold of the authored curve. Returns false when the pointer is not on it, so the
// stroke falls through to whatever it would have done — sculpting the mesh, usually.
MotionPathEdit.begin = function (main, x, y, radiusPx) {
  // DESKTOP AND IPAD ONLY, and the guard is not defensive padding — it stops a live bug.
  //
  // SculptBase.start() is SHARED between the mouse and the headset, while sculptStroke() is
  // not: update() returns early in VR and the stroke goes through updateXR/sculptStrokeXR
  // instead. So without this, a VR stroke would reach begin() with a stale _mouseX/_mouseY from
  // whenever the mouse was last touched, occasionally land within radiusPx of a projected
  // sample, and SWALLOW the stroke — start() returns true, super.start() never runs, and the
  // sculpt simply does not happen. Intermittently, and only sometimes.
  //
  // The VR path is a separate wiring job, and a better one: a controller tip is already a 3D
  // point, so the hit test is a distance to the curve and the drag is a real 3D delta, with no
  // unprojection anywhere.
  if (main._vrSculpting || main._xrSession) return false;

  const strand = main._trailStrand;
  if (!strand || !strand.points || strand.points.length < 2) return false;
  if (!MotionPathEdit.editable(strand.pin)) {
    console.log('[path] this pin is parented, so its motion path is not editable here');
    return false;
  }
  const camera = main.getCamera && main.getCamera();
  if (!camera) return false;

  const project = (p) => screenOf(main, camera, p);
  const index = MotionPathEdit.hit(strand.points, project, x, y, radiusPx);
  if (index < 0) return false;

  const anchor = strand.points[index];
  const s = camera.project([anchor.x, anchor.y, anchor.z]);
  const z = s[2];
  // The brush radius as a WORLD length, measured at the depth of the sample actually grabbed.
  // Measuring it anywhere else on the curve is wrong the moment the path recedes from the
  // camera: the same ring of pixels covers a different world distance at every depth, so the
  // reach stopped matching the cursor ring and the edit felt loose or dead by turns.
  const sc = screenOf(main, camera, anchor);
  const world = reachAt(main, camera, sc.x, sc.y, z, anchor, radiusPx);
  main._pathEdit = {
    strand: strand,
    index: index,
    radius: world,
    screenZ: z,
    // Deep copy: the baseline must not be a view of the array the drag writes to.
    before: strand.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    anchorPt: { x: anchor.x, y: anchor.y, z: anchor.z },
    startX: x, startY: y,
    startWorld: worldAt(main, camera, z, x, y, anchor),
    after: null,
    // The baseline orientations, for a Smooth that is set to the rotation channel. The mouse
    // has no twist to give, so a desktop MOVE never writes them — but Smooth is the same
    // session on the same curve, and it does.
    beforeQ: strand.quats ? strand.quats.map((q) => readQ(q)) : null,
    afterQ: null,
    // Captured at the press: flipping the mode mid-drag would change what the displacement
    // already applied meant, and the curve would jump. Same for the channels — turning
    // Translate off halfway through a drag would leave the movement already applied stranded.
    falloff: { connected: MotionPathEdit.connected() },
    channels: MotionPathEdit.channels(),
  };
  return true;
};

// A TRACKBALL, FOR THE ROTATION CHANNEL ON A FLAT SCREEN.
//
// In the headset the twist comes free: the hand holding the curve is already turning. A mouse
// has no roll — matt's own Pencil Pro finding is that the barrel roll never reaches the web at
// all — so with Rotate on and no gesture to read, dragging did nothing. "move tool in rotation
// mode does nothing."
//
// So the drag itself becomes the rotation, the way every 3D app's trackball works: drag right
// and the section turns about the screen's UP axis, drag down and it turns about the screen's
// RIGHT axis. Both axes are read out of the renderer's own projection — unproject two screen
// points at the anchor's depth and subtract — so the gesture is in the same space as the curve
// and stays correct as the camera moves.
const PX_PER_TURN = 400;   // a full revolution per 400px of drag; taste, tune with _pathTurnPx
function trackball(main, camera, e, x, y) {
  const dx = x - e.startX, dy = y - e.startY;
  if (!dx && !dy) return null;
  const o = worldAt(main, camera, e.screenZ, e.startX, e.startY, e.anchorPt);
  const rx = worldAt(main, camera, e.screenZ, e.startX + 10, e.startY, e.anchorPt);
  const ry = worldAt(main, camera, e.screenZ, e.startX, e.startY + 10, e.anchorPt);
  const right = [rx.x - o.x, rx.y - o.y, rx.z - o.z];
  const down = [ry.x - o.x, ry.y - o.y, ry.z - o.z];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const R = norm(right), D = norm(down);
  // Screen-up is the negative of screen-down. Dragging right turns about UP; dragging down
  // turns about RIGHT — the axis is perpendicular to the drag, in the plane of the screen.
  const ax = [-D[0] * dx + R[0] * dy, -D[1] * dx + R[1] * dy, -D[2] * dx + R[2] * dy];
  const A = norm(ax);
  const px = Math.hypot(dx, dy);
  const turn = Math.max(40, tuneNum('_pathTurnPx', PX_PER_TURN));
  const ang = (px / turn) * Math.PI * 2;
  const h = ang / 2, sn = Math.sin(h);
  return [A[0] * sn, A[1] * sn, A[2] * sn, Math.cos(h)];
}

function tuneNum(key, dflt) {
  const v = window[key];
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

MotionPathEdit.drag = function (main, x, y) {
  const e = main._pathEdit;
  if (!e) return false;
  const camera = main.getCamera && main.getCamera();
  if (!camera) return false;
  const ch = e.channels || { translate: true, rotate: true };
  const now = worldAt(main, camera, e.screenZ, x, y, e.anchorPt);
  const moved = { x: now.x - e.startWorld.x, y: now.y - e.startWorld.y, z: now.z - e.startWorld.z };
  const delta = ch.translate ? moved : ZERO;
  e.after = MotionPathEdit.displace(e.before, e.index, delta, e.radius, null, null, e.falloff);

  // ONE DRAG, ONE MEANING. The trackball takes over only when Translate is OFF: with both on,
  // a single mouse drag would have to be a move and a turn at once, and neither would be
  // controllable. The two toggles pick the mode, which is why they are next to each other.
  e.afterQ = (ch.rotate && !ch.translate && e.beforeQ)
    ? MotionPathEdit.twisted(e.before, e.beforeQ, e.index,
        trackball(main, camera, e, x, y), e.radius, e.falloff)
    : null;
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
  const beforeQuat = track.quaternions ? track.quaternions.slice() : null;
  const moved = MotionPathEdit.pushBack(track, e.strand.times, e.before, e.after);
  // BOTH CHANNELS, ONE GESTURE, ONE UNDO. A twist that moved no key positionally still has to
  // land, so the two counts are summed rather than the rotation being gated behind the move.
  const turned = MotionPathEdit.pushBackQuats(track, e.strand.times, e.beforeQ, e.afterQ);
  if (!moved && !turned) return 0;

  const afterPos = track.positions.slice();
  const afterQuat = track.quaternions ? track.quaternions.slice() : null;
  const sm = main.getStateManager && main.getStateManager();
  // Restore the keys, then make the rig and the drawing agree with them again.
  //
  // Writing the track alone is not enough: the pin's transform comes from the track, but every
  // joint the pin drives comes from the SOLVE, so without re-solving an undo would move the pin
  // and leave the limb where the edit had put it. The trail then re-derives itself from the
  // restored keys through its own fingerprint, which now notices a key that moved without
  // being retimed.
  const put = (arr, quat) => {
    const t = reg.tracks.get(e.strand.pin.getID());
    if (!t) return;
    t.positions = arr.slice();
    if (quat && t.quaternions) t.quaternions = quat.slice();
    t.eulers = null;
    reg.update(e.strand.pin, true);
    IKSolver.holdPins(main);
  };
  if (sm && sm.pushStateCustom) {
    sm.pushStateCustom(() => put(beforePos, beforeQuat), () => put(afterPos, afterQuat),
      false, 'Edit Motion Path');
  }
  put(afterPos, afterQuat);
  return moved + turned;
};

// ── THE HEADSET ───────────────────────────────────────────────────────────────────────────
//
// The VR path is not a port of the desktop one — it is the honest version of it, and it is
// SHORTER. A controller tip is already a point in the world, so acquiring the curve is a plain
// distance and the drag is a real 3D delta. There is no projection, no depth plane, and none of
// the "which point's depth do I measure the radius at" question that caused two bugs on the
// mouse side. The desktop path is the awkward 2D shadow of this one, not the other way round.

// The brush radius as a world length, through the SAME fallback chain SculptBase uses for
// stroke spacing — the picking radius when a mesh was hit, the last known one otherwise. A
// motion path usually hangs in empty space, so the fallback is the normal case here, not the
// exception.
function vrRadius(main, picking) {
  let r = picking && picking._rWorld2 > 0 ? Math.sqrt(picking._rWorld2) : 0;
  if (r < 1e-5) r = main._vrLastPickingRadius || 0.05;
  return r;
}

// THE STYLUS TIP, not the controller pivot. This is a proximity gesture — you reach out and
// take hold of the curve — so its origin has to be the point you can SEE at the end of the
// spike. The pivot sits inside your hand, roughly a spike-length short, which reads as the
// curve being grabbed from behind where you are aiming.
//
// `origin` as handed to updateXR is enginePos, which comes from the controller POSE and is the
// pivot. The tip is already computed per controller in Scene.js as `rayOrigin` — the same value
// Grab's rig proximity uses, and in the same model space as the sampled curve. Read it rather
// than recomputing the offset/tilt/length maths here: that sum living in two places is exactly
// how the two would drift.
function xrTip(main, options) {
  const list = options && options.controllers;
  if (list && list.length) {
    const hand = options.handedness;
    const c = (hand && list.find((e) => e.handedness === hand)) || list[0];
    if (c && c.rayOrigin) return c.rayOrigin;
  }
  return main._vrControllerPos;
}

function dist2(a, b) {
  const dx = a.x - b[0], dy = a.y - b[1], dz = a.z - b[2];
  return dx * dx + dy * dy + dz * dz;
}

MotionPathEdit.beginXR = function (main, tip, radiusWorld) {
  const strand = main._trailStrand;
  if (!tip || !strand || !strand.points || strand.points.length < 2) return false;
  if (!MotionPathEdit.editable(strand.pin)) return false;

  let best = -1;
  let bestD = radiusWorld * radiusWorld;
  for (let i = 0; i < strand.points.length; i++) {
    const d = dist2(strand.points[i], tip);
    if (d <= bestD) { bestD = d; best = i; }
  }
  if (best < 0) return false;

  main._pathEdit = {
    strand: strand,
    index: best,
    radius: radiusWorld,
    before: strand.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    // The baseline ORIENTATIONS, copied for the same reason the positions are: every frame's
    // twist is measured from the pose at the grab, so the array the drag writes must not be a
    // view of the one it reads. Absent when the strand carries no orientations at all, which is
    // every curve that is not the authored one.
    beforeQ: strand.quats ? strand.quats.map((q) => readQ(q)) : null,
    startWorld: { x: tip[0], y: tip[1], z: tip[2] },
    after: null,
    afterQ: null,
    xr: true,
    // Inverted at the grab, so every frame's twist is measured against that ONE pose. A delta
    // taken frame to frame would compose into a ratchet that never comes back to zero.
    startQuatInv: invert(main._vrControllerQuat),
    falloff: { connected: MotionPathEdit.connected() },
    channels: MotionPathEdit.channels(),
  };
  return true;
};

function invert(q) {
  return q ? [-q[0], -q[1], -q[2], q[3]] : null;   // unit quaternion: conjugate is the inverse
}

MotionPathEdit.dragXR = function (main, tip, intensity) {
  const e = main._pathEdit;
  if (!e || !tip) return false;
  const ch = e.channels || { translate: true, rotate: true };
  const reach = { x: tip[0] - e.startWorld.x, y: tip[1] - e.startWorld.y, z: tip[2] - e.startWorld.z };
  const delta = ch.translate ? reach : ZERO;
  // The twist comes free with the hand that is already holding the curve. Without it the
  // controller's rotation is simply discarded, which is surprising in a way a missing feature
  // usually is not: you are already turning your wrist and nothing happens.
  const twist = twistSince(e.startQuatInv, main._vrControllerQuat, intensity);
  // THE TWIST FEEDS BOTH CHANNELS, AND EACH GATE OWNS ITS OWN HALF. Turning your wrist swings
  // the curve's POSITIONS around your hand as well as turning the orientations — the swing is a
  // positional edit driven by a rotation, so it belongs to Translate, not to Rotate. With
  // Translate off and Rotate on the path holds still and only the triads turn, which is what
  // "just rotations" has to mean for the button to be worth having.
  e.after = MotionPathEdit.displace(e.before, e.index, delta, e.radius,
    ch.translate ? twist : null, e.startWorld, e.falloff);
  // And the same twist onto the KEYED ORIENTATIONS. One delta drives both halves, so the section
  // you are holding swings and turns as one thing rather than as a path and a set of triads that
  // happen to be near each other.
  e.afterQ = ch.rotate
    ? MotionPathEdit.twisted(e.before, e.beforeQ, e.index, twist, e.radius, e.falloff)
    : null;
  return true;
};

// One frame of a VR stroke, for every tool. Returns true when the path edit consumed the frame,
// so the tool falls through to its ordinary sculpt otherwise.
//
// Shared rather than written twice: Move and Smooth differ by ONE line here (what a held
// trigger does to the curve), and the press-edge bookkeeping around it is exactly the part that
// gets subtly different second implementations.
MotionPathEdit.strokeXR = function (main, picking, isPressed, tool, mode, strength, options) {
  const tip = xrTip(main, options);
  // Stashed for preselection, which needs the tip on frames where nothing is pressed.
  main._pathXRTip = tip;
  if (MotionPathEdit.active(main)) {
    if (!isPressed) { MotionPathEdit.endStroke(main); tool._pathXRHeld = false; return true; }
    const ok = mode === 'smooth'
      ? MotionPathEdit.smoothStep(main, strength)
      : MotionPathEdit.dragXR(main, tip, strength);
    if (ok) { MotionPathEdit.redrawHook(main); main.render(); }
    return true;
  }
  // Only on the PRESS EDGE. Retrying every held frame would let the curve be snatched
  // mid-stroke the moment a sculpt happened to pass near it.
  const edge = isPressed && !tool._pathXRHeld;
  tool._pathXRHeld = isPressed;
  if (!edge) return false;
  return MotionPathEdit.beginXR(main, tip, vrRadius(main, picking));
};

// Set by MotionTrail at import time, so this module does not import the drawing back and close
// a cycle (module_load_test reports those as "Class extends value undefined").
MotionPathEdit.redrawHook = function () {};
// Set by MotionTrail, for the same reason redrawHook is: this module cannot import the drawing.
MotionPathEdit.drawnHoverHook = null;
// Set by MotionTrail. THE PROJECTION THE RENDERER USES — see the note there. Everything on the
// desktop side that turns a sample into screen pixels goes through this, because the editor and
// the screen disagreeing about where a dot is was the whole of the "misaligned preselection"
// bug: SculptGL's camera knows nothing about the overlay group's 0.701 scale.
MotionPathEdit.projectHook = null;
MotionPathEdit.unprojectHook = null;

// One place that answers "where is this sample on screen". Falls back to the SculptGL camera
// when the hook is not installed yet, which is the load-order case, not the normal one.
function screenOf(main, camera, p) {
  if (MotionPathEdit.projectHook) {
    const s = MotionPathEdit.projectHook(main, p);
    if (s) return s;
  }
  const c = camera.project([p.x, p.y, p.z]);
  return { x: c[0], y: c[1] };
}

// PRESELECTION — which sample a click would take. Samples are discrete and the nearest one may
// be a little off where you are pointing, so without this the curve appears to move from
// somewhere other than the cursor. Showing it in advance turns that from a mystery into an aim.
//
// Only for the tools that can act on a path: a highlight under a brush that will sculpt the
// mesh instead is a promise the click does not keep.
MotionPathEdit.hoverIndex = function (main) {
  if (main._pathEdit) return main._pathEdit.index;   // during a drag, the anchor is the answer
  const strand = main._trailStrand;
  if (!strand || !strand.points || strand.points.length < 2) return -1;

  const sm = main.getSculptManager && main.getSculptManager();
  const idx = sm && sm.getToolIndex && sm.getToolIndex();
  if (idx !== Enums.Tools.MOVE && idx !== Enums.Tools.SMOOTH) return -1;
  const tool = sm.getCurrentTool && sm.getCurrentTool();

  // In the headset the tip is a point in the world, so proximity answers it directly. The tip
  // is stashed by strokeXR, which runs every frame whether or not the trigger is down.
  if (main._vrSculpting || main._xrSession) {
    const tip = main._pathXRTip;
    if (!tip) return -1;
    const r = main._vrLastPickingRadius || 0.05;
    let best = -1, bestD = r * r;
    for (let i = 0; i < strand.points.length; i++) {
      const d = dist2(strand.points[i], tip);
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  const camera = main.getCamera && main.getCamera();
  if (!camera || !tool || !tool.getScreenRadius) return -1;
  const project = (p) => screenOf(main, camera, p);
  return MotionPathEdit.hit(strand.points, project, main._mouseX, main._mouseY,
                            tool.getScreenRadius());
};

// WHERE DOES THE HIT TEST THINK THE CURVE IS. Prints the cursor, and the projected screen
// position of the nearest few samples, with the delta between them.
//
// This exists because the shape of the error is the whole diagnosis and cannot be reasoned out
// from the source: a CONSTANT delta is an origin or a scroll offset; one that GROWS with
// distance from a corner is a scale (a device-pixel-ratio mismatch); a mirrored y is a flip; and
// a delta smaller than the sample spacing is not an error at all, just quantisation. I guessed
// quantisation once already and was wrong, which is what this is for.
//
// Hover the curve where the highlight should be and run it.
window.pathDiag = function () {
  const main = window.app;
  const strand = main && main._trailStrand;
  if (!strand || !strand.points || !strand.points.length) {
    console.log('[path] no strand — turn Trails on with a keyed pin selected');
    return null;
  }
  const camera = main.getCamera();
  const sm = main.getSculptManager && main.getSculptManager();
  const tool = sm && sm.getCurrentTool && sm.getCurrentTool();
  const mx = main._mouseX, my = main._mouseY;
  const reach = tool && tool.getScreenRadius ? tool.getScreenRadius() : -1;
  const rows = strand.points.map((p, i) => {
    const sc = camera.project([p.x, p.y, p.z]);
    return { i: i, x: sc[0], y: sc[1], d: Math.hypot(sc[0] - mx, sc[1] - my) };
  }).sort((a, b) => a.d - b.d).slice(0, 3);
  console.log('[path] cursor ' + mx.toFixed(0) + ',' + my.toFixed(0)
    + '   canvas ' + camera._width + 'x' + camera._height
    + '   devicePixelRatio ' + window.devicePixelRatio
    + '   reach ' + reach.toFixed(0) + 'px   samples ' + strand.points.length);
  for (const r of rows) {
    console.log('[path]   sample ' + r.i + ' projects to ' + r.x.toFixed(0) + ',' + r.y.toFixed(0)
      + '   delta ' + (r.x - mx).toFixed(0) + ',' + (r.y - my).toFixed(0)
      + '   distance ' + r.d.toFixed(0) + (r.d <= reach ? '  <- within reach' : ''));
  }
  // AND WHAT THE APP ITSELF DECIDED, through the real code path rather than this copy of it —
  // plus which dot the highlight would actually land on. The hit test being right does not mean
  // the right dot lights up: the samples are split into two clouds (plain and key) for drawing,
  // and the highlight has to find its way back through `slots` to the cloud its sample landed
  // in. An error THERE looks exactly like an offset hit test from the outside.
  const hv = MotionPathEdit.hoverIndex(main);
  const v = main._trailVis;
  const slot = v && v.slots && hv >= 0 ? v.slots[hv] : null;
  console.log('[path] hoverIndex=' + hv + ' (nearest by this probe: ' + (rows[0] && rows[0].i)
    + ')  slots=' + (v && v.slots ? v.slots.length : 'none')
    + '  points=' + strand.points.length
    + '  slot=' + (slot ? (slot.key ? 'key' : 'plain') + '[' + slot.i + ']' : 'none'));
  if (slot) {
    // Where the dot that WILL be tinted actually sits on screen.
    const cloud = slot.key ? v.keyDots : v.dots;
    const pos = cloud && cloud.geometry && cloud.geometry.getAttribute('position');
    if (pos && slot.i < pos.count) {
      const lit = camera.project([pos.getX(slot.i), pos.getY(slot.i), pos.getZ(slot.i)]);
      console.log('[path] the dot that lights up is at ' + lit[0].toFixed(0) + ','
        + lit[1].toFixed(0) + '  delta from cursor ' + (lit[0] - mx).toFixed(0) + ','
        + (lit[1] - my).toFixed(0)
        + '   -- if THIS delta is large while the sample delta above is small, the hit test is '
        + 'fine and the highlight is landing on the wrong dot.');
    } else {
      console.log('[path] slot ' + slot.i + ' is out of range for its cloud ('
        + (pos ? pos.count : 'no geometry') + ' dots) — the slot map and the drawn clouds '
        + 'disagree, which is the bug.');
    }
  }
  // THE DOT THAT IS ACTUALLY LIT ON SCREEN, read back out of the uploaded colour buffer.
  const drawn = MotionPathEdit.drawnHoverHook && MotionPathEdit.drawnHoverHook(main);
  if (drawn) {
    const ds = camera.project([drawn.x, drawn.y, drawn.z]);
    console.log('[path] LIT, by the SculptGL camera: ' + drawn.cloud + '[' + drawn.within
      + '] = sample ' + drawn.sample + ' at ' + ds[0].toFixed(0) + ',' + ds[1].toFixed(0)
      + '   delta from cursor ' + (ds[0] - mx).toFixed(0) + ',' + (ds[1] - my).toFixed(0));
    // THE MEASUREMENT THAT WAS MISSING. Everything above uses the projection the hit test uses,
    // so it can only ever confirm itself. This is where three actually puts the pixel.
    if (drawn.threeX != null) {
      console.log('[path] LIT, where THREE actually draws it: '
        + drawn.threeX.toFixed(0) + ',' + drawn.threeY.toFixed(0)
        + '   delta from cursor ' + (drawn.threeX - mx).toFixed(0) + ','
        + (drawn.threeY - my).toFixed(0)
        + '   -- THIS is the one that matches your eyes. If it disagrees with the line above, '
        + 'the hit test and the renderer are using different projections.');
    } else {
      console.log('[path] (no three camera reachable — cannot say where the pixel lands)');
    }
  } else {
    console.log('[path] LIT ON SCREEN: nothing carries the hover colour — the tint is not '
      + 'reaching the buffer at all, so what you are seeing highlighted is something else.');
  }
  console.log('[path] a CONSTANT delta is an origin offset; one that grows as you move away '
    + 'from a corner is a scale (pixel-ratio); a mirrored y is a flip; a delta under the '
    + 'sample spacing is just quantisation. Move to two different corners and compare.');
  return rows;
};

// A MOTION PATH IS NOT A MESH, AND THAT IS WHY THE HIGHLIGHT WAS STALE.
//
// Desktop renders on demand. The mouse-move path picks against meshes and requests a frame when
// something under the cursor changes — but a motion path hangs in empty space, hits no mesh, and
// so asked for nothing. `MotionTrail.update` runs inside render(), which means the preselection
// was only ever recoloured on frames drawn for some OTHER reason: the lit dot sat wherever the
// cursor happened to be when the last frame went out.
//
// From the outside that is indistinguishable from a broken hit test, and it cost three wrong
// diagnoses — quantisation, then a coordinate-space mismatch, then the slot map. Every one of
// those was measured and every measurement came back CORRECT, because a diagnostic computes
// fresh while the screen does not. matt, with the numbers in front of him: "the preselect
// highlight is still way off".
//
// Called from SculptBase.preUpdate, which runs on every mouse move. Self-guarding: hoverIndex
// returns -1 unless Move or Smooth is active and a strand exists, so this costs one early exit
// for every other tool.
MotionPathEdit.hoverTick = function (main) {
  if (!main || !main._trailStrand || main._pathEdit) return false;
  // NOT IN THE HEADSET. The whole reason this exists is that desktop renders on demand; the XR
  // loop already draws every frame, so calling render() here would be a redundant draw per
  // hover change on the surface that can least afford one.
  if (main._xrSession || main._vrSculpting) return false;
  const i = MotionPathEdit.hoverIndex(main);
  if (i === main._pathHoverLast) return false;   // only on CHANGE, never one frame per move
  main._pathHoverLast = i;
  main.render?.();
  return true;
};

MotionPathEdit.active = function (main) { return !!(main && main._pathEdit); };

// What every tool does at the end of a path stroke. Shared rather than repeated per tool: the
// same rule implemented in N places is this project's signature bug, and "push back, then force
// the curve to rebuild from what was written" is exactly the kind of two-step that gets half
// copied into the second tool.
MotionPathEdit.endStroke = function (main) {
  const moved = MotionPathEdit.finish(main);
  // The count is positions AND rotations, so a pure twist reports a number rather than the zero
  // that used to make a working edit look like a no-op.
  console.log('[path] motion path edit pushed back onto ' + moved + ' key channel(s)');
  // The strand is transient. Dropping the fingerprint forces a REBUILD from the keys just
  // written, which is the only honest check that push-back did what the curve said: if the
  // redrawn curve jumps, the keys and the drawing disagree.
  main._trailSig = null;
  main.render();
  return moved;
};

export default MotionPathEdit;
