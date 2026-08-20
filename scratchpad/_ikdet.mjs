// PROBE (not a test): does the solve carry history?
//
// Rebuilds the table in docs/ik_orientation_pin_findings.md "Still open". Same pins, same hip
// target, three different routes to the same frame — if the solve were a pure function of
// (rest skeleton, control values) all three would land in the same place.
//
// Run: node scratchpad/ik_test.mjs && node scratchpad/_ikdet.mjs
import IKSolver, { makeJoint as J, makeMain, Skeleton } from './_ik_gen.mjs';
import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';

// A body, not a leg: hips at the root with a spine above and two pinned legs below. The
// ambiguity the doc measures needs BOTH — a pinned ankle leaves the knee free on a circle,
// and two of them share one root, so where each knee settles depends on where it started.
function body() {
  const hips = J([0, 2, 0]);
  const spine = J([0, 2.5, 0], hips);
  const chest = J([0, 3.0, 0], spine);
  const mk = (sx) => {
    const hip = J([0.2 * sx, 1.9, 0], hips);
    const knee = J([0.22 * sx, 1.0, 0.06], hip);
    const ankle = J([0.2 * sx, 0.1, 0], knee);
    return { hip, knee, ankle };
  };
  const L = mk(-1), R = mk(1);
  const main = makeMain([hips, spine, chest, L.hip, L.knee, L.ankle, R.hip, R.knee, R.ankle]);
  IKSolver.setPin(L.ankle, IKSolver.PIN_POS, main);
  IKSolver.setPin(R.ankle, IKSolver.PIN_POS, main);
  // What the app does when a rig is drawn or tweaked: record the skeleton AS DRAWN.
  if (!globalThis.window._ikSeedOff) IKSolver.captureRest(main);
  return { main, hips, knee: R.knee, kneeL: L.knee, ankle: R.ankle, ankleL: L.ankle };
}
const leg = body;

// One evaluated frame: playback writes the keyed control (the hips), then the solver holds the
// pins. That is exactly the app's evaluation order.
function frame(rig, hipPos) {
  Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(hipPos[0], hipPos[1], hipPos[2]));
  // What playback does as it writes a keyed bone: name it as a control for this frame.
  if (!globalThis.window._ikSeedOff) {
    (window._ikWritten || (window._ikWritten = new Set())).add(rig.hips.getID());
  }
  IKSolver.holdPins(rig.main);
}

// A squat, a twisted lean, and the frame being evaluated. Big moves: the point is to make the
// legs genuinely ambiguous, which is when a seed matters.
const FRAMES = {
  A: [0.35, 1.55, 0.25],
  B: [-0.30, 1.45, -0.30],
  TARGET: [0.10, 1.70, 0.10],
};

function route(name, path) {
  const rig = leg();
  for (const f of path) frame(rig, FRAMES[f]);
  const k = Skeleton.jointPos(rig.knee);
  const a = Skeleton.jointPos(rig.ankle);
  const h = Skeleton.jointPos(rig.hips);
  const pinErr = a.distanceTo(new THREE.Vector3(0.2, 0.1, 0));
  const hipErr = h.distanceTo(new THREE.Vector3(...FRAMES.TARGET));
  return { name, knee: k, pinErr, hipErr };
}

function table(label) {
  const rows = [
    route('from rest', ['TARGET']),
    route('via one other frame', ['A', 'TARGET']),
    route('via two other frames', ['A', 'B', 'TARGET']),
  ];
  const base = rows[0].knee;
  console.log('\n  === %s ===', label);
  console.log('  route                    knee position                 dist from "from rest"   pin err   hip err');
  for (const r of rows) {
    console.log('  %s %s   %s   %s   %s',
      r.name.padEnd(22),
      ('(' + r.knee.toArray().map((v) => v.toFixed(3)).join(', ') + ')').padEnd(26),
      r.knee.distanceTo(base).toFixed(4).padStart(18),
      r.pinErr.toFixed(4), r.hipErr.toFixed(4));
  }
  const worst = Math.max(...rows.map((r) => r.knee.distanceTo(base)));
  console.log('  worst spread: %s', worst.toFixed(4));
  return worst;
}

// Does the answer depend on what the SESSION did before the scrub, as opposed to the route
// through the timeline? Pose the rig by hand first (no control names, so the old
// seeded-from-current path), then evaluate, and compare against a rig that was never touched.
function sessionHistory() {
  const fresh = leg();
  frame(fresh, FRAMES.TARGET);
  const a = Skeleton.jointPos(fresh.knee);

  const used = leg();
  // An interactive drag: nothing names a control, so this is the drag path.
  Skeleton.moveJoint(used.main, used.hips, new THREE.Vector3(-0.4, 1.4, -0.35));
  IKSolver.holdPins(used.main);
  Skeleton.moveJoint(used.main, used.hips, new THREE.Vector3(0.45, 1.5, 0.4));
  IKSolver.holdPins(used.main);
  frame(used, FRAMES.TARGET);
  const b = Skeleton.jointPos(used.knee);

  return a.distanceTo(b);
}

globalThis.window._ikSeedOff = true;
const before = table('seeded from the current pose (old behaviour)');
globalThis.window._ikSeedOff = false;
const after = table('seeded from rest for evaluation (new)');
console.log('\n  spread %s -> %s', before.toFixed(4), after.toFixed(4));

globalThis.window._ikSeedOff = true;
const histBefore = sessionHistory();
globalThis.window._ikSeedOff = false;
const histAfter = sessionHistory();
console.log('  same frame after posing by hand first, vs never touched: %s -> %s\n',
  histBefore.toFixed(4), histAfter.toFixed(4));


