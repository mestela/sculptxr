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

MotionPathEdit.displace = function (points, index, delta, radius, rotQuat, rotCenter) {
  const w = MotionPathEdit.weights(points, index, radius);
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
  const k = Math.max(0, Math.min(1, intensity == null ? 1 : intensity));
  if (k >= 0.999) return d;
  // Slerp from identity. Short-arc: without the sign flip a twist past a half turn unwinds the
  // long way round, which reads as the curve snapping backwards mid-drag.
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

// SMOOTH, which on a strand is a 1D Laplacian along it — each sample toward the average of its
// two neighbours, scaled by the same falloff. On a mesh "smooth" is ambiguous enough to need a
// whole tool; on a curve it has exactly one meaning, and it is precisely noise removal: the
// jitter of a hand-recorded take is high-frequency deviation from the curve its neighbours
// describe.
//
// The ENDS ARE PINNED. A Laplacian shortens a curve, so an unpinned end creeps inward every
// pass and the animation quietly loses its first and last poses — which look like keys drifting
// for no reason. Endpoints keep their positions and only the interior relaxes.
MotionPathEdit.smoothed = function (points, index, radius, strength) {
  const w = MotionPathEdit.weights(points, index, radius);
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

// One pass of smoothing per stroke frame, accumulating. Unlike a Move — which measures every
// frame against the baseline — smoothing is iterative by nature: holding the brush still should
// keep relaxing. So it reads the CURRENT curve and writes back, while `before` stays the
// baseline push-back measures against.
MotionPathEdit.smoothStep = function (main, strength) {
  const e = main._pathEdit;
  if (!e) return false;
  e.after = MotionPathEdit.smoothed(e.after || e.before, e.index, e.radius, strength);
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

  const project = (p) => { const s = camera.project([p.x, p.y, p.z]); return { x: s[0], y: s[1] }; };
  const index = MotionPathEdit.hit(strand.points, project, x, y, radiusPx);
  if (index < 0) return false;

  const anchor = strand.points[index];
  const s = camera.project([anchor.x, anchor.y, anchor.z]);
  const z = s[2];
  // The brush radius as a WORLD length, measured at the depth of the sample actually grabbed.
  // Measuring it anywhere else on the curve is wrong the moment the path recedes from the
  // camera: the same ring of pixels covers a different world distance at every depth, so the
  // reach stopped matching the cursor ring and the edit felt loose or dead by turns.
  const a = camera.unproject(s[0], s[1], z);
  const b = camera.unproject(s[0] + radiusPx, s[1], z);
  const rx = b[0] - a[0], ry = b[1] - a[1], rz = b[2] - a[2];
  const world = Math.sqrt(rx * rx + ry * ry + rz * rz);
  main._pathEdit = {
    strand: strand,
    index: index,
    radius: world,
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
  // Restore the keys, then make the rig and the drawing agree with them again.
  //
  // Writing the track alone is not enough: the pin's transform comes from the track, but every
  // joint the pin drives comes from the SOLVE, so without re-solving an undo would move the pin
  // and leave the limb where the edit had put it. The trail then re-derives itself from the
  // restored keys through its own fingerprint, which now notices a key that moved without
  // being retimed.
  const put = (arr) => {
    const t = reg.tracks.get(e.strand.pin.getID());
    if (!t) return;
    t.positions = arr.slice();
    t.eulers = null;
    reg.update(e.strand.pin, true);
    IKSolver.holdPins(main);
  };
  if (sm && sm.pushStateCustom) {
    sm.pushStateCustom(() => put(beforePos), () => put(afterPos), false, 'Edit Motion Path');
  }
  put(afterPos);
  return moved;
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
    startWorld: { x: tip[0], y: tip[1], z: tip[2] },
    after: null,
    xr: true,
    // Inverted at the grab, so every frame's twist is measured against that ONE pose. A delta
    // taken frame to frame would compose into a ratchet that never comes back to zero.
    startQuatInv: invert(main._vrControllerQuat),
  };
  return true;
};

function invert(q) {
  return q ? [-q[0], -q[1], -q[2], q[3]] : null;   // unit quaternion: conjugate is the inverse
}

MotionPathEdit.dragXR = function (main, tip, intensity) {
  const e = main._pathEdit;
  if (!e || !tip) return false;
  const delta = { x: tip[0] - e.startWorld.x, y: tip[1] - e.startWorld.y, z: tip[2] - e.startWorld.z };
  // The twist comes free with the hand that is already holding the curve. Without it the
  // controller's rotation is simply discarded, which is surprising in a way a missing feature
  // usually is not: you are already turning your wrist and nothing happens.
  const twist = twistSince(e.startQuatInv, main._vrControllerQuat, intensity);
  e.after = MotionPathEdit.displace(e.before, e.index, delta, e.radius, twist, e.startWorld);
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
  const project = (p) => { const s = camera.project([p.x, p.y, p.z]); return { x: s[0], y: s[1] }; };
  return MotionPathEdit.hit(strand.points, project, main._mouseX, main._mouseY,
                            tool.getScreenRadius());
};

MotionPathEdit.active = function (main) { return !!(main && main._pathEdit); };

// What every tool does at the end of a path stroke. Shared rather than repeated per tool: the
// same rule implemented in N places is this project's signature bug, and "push back, then force
// the curve to rebuild from what was written" is exactly the kind of two-step that gets half
// copied into the second tool.
MotionPathEdit.endStroke = function (main) {
  const moved = MotionPathEdit.finish(main);
  console.log('[path] motion path edit pushed back onto ' + moved + ' key(s)');
  // The strand is transient. Dropping the fingerprint forces a REBUILD from the keys just
  // written, which is the only honest check that push-back did what the curve said: if the
  // redrawn curve jumps, the keys and the drawing disagree.
  main._trailSig = null;
  main.render();
  return moved;
};

export default MotionPathEdit;
