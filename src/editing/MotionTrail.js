import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';

// Motion trails: the world-space path a joint takes over the timeline, drawn in the viewport.
//
// THIS FEATURE WAS BLOCKED, and it is worth saying why rather than just building it. A trail is
// a promise that the joint will pass through those points on playback. Until v3.19.94 the solve
// seeded from whatever pose the rig was already in, so an IK-driven joint's position depended on
// the ROUTE taken to a frame rather than on the frame — and a trail built by stepping the
// playhead would have been a curve the playback did not follow. Drawing it then would have been
// worse than not drawing it: a confident wrong answer. Now that evaluation is deterministic, a
// sampled path IS the path, and this is a few dozen lines.
//
// The sampling runs the app's OWN evaluation — write the keyed joints, then hold the pins —
// rather than reimplementing interpolation. Anything else would be a second evaluator to keep
// in step with the first, and the two disagreeing is exactly the bug this feature exists to
// visualise.

const SAMPLES = 48;      // along the whole range; the curve is smooth, not the motion
const TRAIL_ORDER = 9998;

function tune(key, dflt) {
  const v = window[key];
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const MotionTrail = {};

// The range to draw: the loop if one is set, otherwise the whole timeline.
function range() {
  const start = window._animLoopStart ?? 0;
  const end = window._animLoopEnd ?? window._animMasterDuration ?? 0;
  return end > start ? { start: start, end: end } : null;
}

// The joints to trail. The SELECTION, and only the selection: a trail per joint on a thirty-
// joint rig is a ball of wool, and the cost is a full evaluation per sample either way.
function trailed(main) {
  const sel = main.getMesh && main.getMesh();
  if (sel && Skeleton.isJoint(sel)) return [sel];
  // A pin is the other thing you hold while animating, and its joint is what you want to see.
  if (sel && sel._isPinTarget && sel._pinnedJoint) return [sel._pinnedJoint];
  return [];
}

// A cheap fingerprint of everything the curve depends on. Recomputed per frame and compared,
// rather than invalidated by callers: an invalidation hook has to be added to every path that
// can change a key, and the one that gets forgotten leaves a stale curve on screen that looks
// exactly like a correct one. Reading a few dozen key times per frame is nothing.
function signature(main, joints, r) {
  const reg = window._animationRegistry;
  let sig = joints.map((j) => j.getID()).join(',') + '|' + r.start + ',' + r.end + '|';
  if (!reg || !reg.tracks) return sig;
  for (const j of Skeleton.joints(main)) {
    const t = reg.tracks.get(j.getID());
    if (!t || !t.times || !t.times.length) continue;
    let acc = 0;
    for (let i = 0; i < t.times.length; i++) acc += t.times[i] * (i + 1);
    sig += j.getID() + ':' + t.times.length + ':' + acc.toFixed(4) + ';';
  }
  // Pins move the answer as much as keys do, and dragging one does not touch a track.
  for (const j of IKSolver.pinnedJoints(main)) {
    const p = IKSolver.pinObject(j);
    if (!p) continue;
    const m = p.getMatrix();
    sig += 'p' + j.getID() + ':' + m[12].toFixed(4) + ',' + m[13].toFixed(4) + ',' + m[14].toFixed(4) + ';';
  }
  return sig;
}

// Put the rig at time `t` exactly as a scrub does: every keyed joint written, then the pins
// held. The registry names each bone it writes, so holdPins seeds from rest and the answer does
// not depend on the order the samples were taken in — which is the whole reason this works.
function evaluateAt(main, reg, joints, t) {
  reg.globalPlaybackTime = t;
  window._animCurrentTime = t;
  // Joints only. Running the whole scene would drag every shape track and vertex snapshot
  // through the sampler for a curve that only needs transforms.
  for (const j of joints) reg.update(j, true);
  IKSolver.holdPins(main);
}

// Sample the path of each trailed joint over the range.
function samplePaths(main, targets) {
  const reg = window._animationRegistry;
  const r = range();
  if (!reg || !r) return null;
  const joints = Skeleton.joints(main).filter((j) => reg.tracks && reg.tracks.get(j.getID()));
  if (!joints.length) return null;

  const n = Math.max(2, Math.round(tune('_trailSamples', SAMPLES)));
  const paths = targets.map(() => []);
  const wasT = reg.globalPlaybackTime || 0;
  const wasPlaying = window._animPlaying;
  // Suppress playback for the duration: update() advances globalPlaybackTime by wall-clock dt
  // when it is on, so the sampler would fight the clock for the playhead and every sample after
  // the first would be taken at the wrong time.
  window._animPlaying = false;

  try {
    for (let i = 0; i < n; i++) {
      const t = r.start + (r.end - r.start) * (i / (n - 1));
      evaluateAt(main, reg, joints, t);
      targets.forEach((j, k) => paths[k].push(Skeleton.jointPos(j)));
    }
  } finally {
    // Put the rig back on the frame the user is actually on, through the same path, so the
    // viewport is never left showing the last sample.
    evaluateAt(main, reg, joints, wasT);
    window._animPlaying = wasPlaying;
  }
  return paths;
}

function disposeTrail(main) {
  const v = main._trailVis;
  if (!v) return;
  for (const o of [v.line]) {
    if (!o) continue;
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
  main._trailVis = null;
}

MotionTrail.clear = function (main) {
  disposeTrail(main);
  main._trailSig = null;
};

// Per-frame. Cheap when nothing changed: one fingerprint, one string compare.
MotionTrail.update = function (main) {
  if (!Skeleton.displayFlag('trails')) { MotionTrail.clear(main); return false; }
  const targets = trailed(main);
  const r = range();
  if (!targets.length || !r) { MotionTrail.clear(main); return false; }

  const sig = signature(main, targets, r);
  if (sig === main._trailSig && main._trailVis) return false;
  main._trailSig = sig;

  const paths = samplePaths(main, targets);
  if (!paths || !paths[0] || paths[0].length < 2) { MotionTrail.clear(main); return false; }

  const pts = paths[0];
  const col = Skeleton.boneColor(main, targets[0]);

  if (!main._trailVis) {
    const g = Skeleton.overlayGroup(main);
    const line = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }));
    line.frustumCulled = false;
    line.isPickable = false;
    line.renderOrder = TRAIL_ORDER;
    g.add(line);
    main._trailVis = { line: line };
  }

  const v = main._trailVis;
  v.line.geometry.setFromPoints(pts);
  v.line.material.color.setRGB(col.r, col.g, col.b);
  v.line.visible = true;

  return true;
};

export default MotionTrail;
