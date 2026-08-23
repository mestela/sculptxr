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

// What to trail. The SELECTION, and only the selection: a trail per joint on a thirty-joint rig
// is a ball of wool, and the cost is a full evaluation per sample either way.
//
// A pin gets TWO curves, and the difference between them is the point.
//
//   control — the path you AUTHORED, sampled from the pin's own track. This is the curve that
//             is yours to edit; a pin is a free 6DOF control, so any shape is reachable.
//   output  — the path the JOINT actually takes, sampled from the solve. This is solver output,
//             constrained by bone lengths, and it is not directly editable.
//
// While IK reaches its target the two coincide and you see one curve. Where they separate, the
// gap IS the diagnosis: the control is asking for something the limb cannot do. That divergence
// is invisible today, because only the joint has ever been drawn.
//
// A pin with no track of its own has no authored path — just a stationary point — so only the
// output curve is drawn for it. Drawing a degenerate curve would be noise.
function trailed(main) {
  const sel = main.getMesh && main.getMesh();
  if (sel && Skeleton.isJoint(sel)) return [{ obj: sel, control: false }];
  if (sel && sel._isPinTarget && sel._pinnedJoint) {
    const reg = window._animationRegistry;
    const keyed = !!(reg && reg.tracks && reg.tracks.get(sel.getID()));
    const out = [{ obj: sel._pinnedJoint, control: false }];
    if (keyed) out.unshift({ obj: sel, control: true });
    return out;
  }
  return [];
}

// A cheap fingerprint of everything the curve depends on. Recomputed per frame and compared,
// rather than invalidated by callers: an invalidation hook has to be added to every path that
// can change a key, and the one that gets forgotten leaves a stale curve on screen that looks
// exactly like a correct one. Reading a few dozen key times per frame is nothing.
function trackSig(reg, obj, tag) {
  const t = reg.tracks.get(obj.getID());
  if (!t || !t.times || !t.times.length) return '';
  let acc = 0;
  for (let i = 0; i < t.times.length; i++) acc += t.times[i] * (i + 1);
  return tag + obj.getID() + ':' + t.times.length + ':' + acc.toFixed(4) + ';';
}

function signature(main, joints, r) {
  const reg = window._animationRegistry;
  let sig = joints.map((t) => (t.obj || t).getID() + (t.control ? 'c' : '')).join(',') + '|' + r.start + ',' + r.end + '|';
  if (!reg || !reg.tracks) return sig;
  for (const j of Skeleton.joints(main)) sig += trackSig(reg, j, '');
  // Pins move the answer as much as keys do — by being DRAGGED, which touches no track, and by
  // being KEYED, which is now the main way a rig is animated. Both have to be fingerprinted or
  // the curve goes stale in exactly the workflow it exists to serve.
  for (const j of IKSolver.pinnedJoints(main)) {
    const p = IKSolver.pinObject(j);
    if (!p) continue;
    const m = p.getMatrix();
    sig += 'p' + j.getID() + ':' + m[12].toFixed(4) + ',' + m[13].toFixed(4) + ',' + m[14].toFixed(4) + ';';
    sig += trackSig(reg, p, 'pk');
  }
  return sig;
}

// Everything the sampler must write before holding the pins: keyed BONES and keyed PINS.
//
// A pin is an ordinary keyable mesh — "everything a pin needs in order to be transformable and
// keyable comes free from being an ordinary object" (IKSolver.makePinObject) — so it carries a
// track of its own, and keyed pins are now the main way a rig is animated. holdPins reads each
// pin's TRANSFORM, so a pin left unevaluated anchors every sample to wherever it happens to be
// sitting: the trail becomes a curve playback does not follow, which is the exact failure this
// file's header says the feature was blocked on until evaluation became deterministic.
//
// Real playback iterates every mesh in the scene (Scene.js), so it never had this bug. This is
// the same set narrowed to the rig, because a curve that only needs transforms should not drag
// every vertex snapshot in the scene through the sampler.
function animated(main, reg) {
  if (!reg || !reg.tracks) return [];
  const out = [];
  for (const j of Skeleton.joints(main)) {
    if (reg.tracks.get(j.getID())) out.push(j);
    const p = IKSolver.pinObject(j);
    if (p && reg.tracks.get(p.getID())) out.push(p);
  }
  return out;
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
  const joints = animated(main, reg);
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
      // A pin reads the same way a joint does — both are meshes, and the path is the
      // translation of the model-space matrix either way.
      targets.forEach((tg, k) => paths[k].push(Skeleton.jointPos(tg.obj || tg)));
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
  for (const o of v.lines || []) {
    if (!o) continue;
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
  main._trailVis = null;
}

// One line per path. The AUTHORED curve is drawn solid; the SOLVED one is drawn faint, because
// it is a readout rather than something you can take hold of, and because the two coincide
// whenever the limb is reaching — a second curve at full strength would just thicken the first.
const CONTROL_OPACITY = 0.95;
const OUTPUT_OPACITY = 0.35;

function makeLine(main) {
  const g = Skeleton.overlayGroup(main);
  const line = new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
  line.frustumCulled = false;
  line.isPickable = false;
  line.renderOrder = TRAIL_ORDER;
  g.add(line);
  return line;
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

  // The count changes when the selection moves between a bone and a keyed pin, so rebuild
  // rather than trying to reconcile: two lines is not a pool worth managing.
  if (!main._trailVis || main._trailVis.lines.length !== paths.length) {
    disposeTrail(main);
    main._trailVis = { lines: paths.map(() => makeLine(main)) };
  }

  const v = main._trailVis;
  paths.forEach((pts, i) => {
    const line = v.lines[i];
    const tg = targets[i];
    // Both curves take the colour of the JOINT they describe, so a control and its output read
    // as one thing seen two ways rather than as two unrelated curves.
    const col = Skeleton.boneColor(main, tg.control ? tg.obj._pinnedJoint : tg.obj);
    line.geometry.setFromPoints(pts);
    line.material.color.setRGB(col.r, col.g, col.b);
    line.material.opacity = tg.control ? CONTROL_OPACITY : OUTPUT_OPACITY;
    line.visible = pts.length > 1;
  });

  return true;
};

export default MotionTrail;
