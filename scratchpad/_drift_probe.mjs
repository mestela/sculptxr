// matt: "a pinned bone gradually scaled away to nothing... the elbow, and the hand child both
// collapse". Gradual = COMPOUNDING, so the question is whether a solve is IDEMPOTENT over a
// closed loop: drive the rig round a circle back to exactly where it started and see whether
// the bone lengths came back with it. Bone length is the solver's own invariant, so any loss
// is the bug and not a tolerance.
import IKSolver, { makeJoint as J, makeMain, Skeleton, modelMat } from './_ik_gen.mjs';
const THREE = await import('/Users/mattestela/sculptxr/node_modules/three/build/three.module.js');

const pos = (j) => Skeleton.jointPos(j);
const lens = (r) => [pos(r.el).distanceTo(pos(r.sh)), pos(r.ha).distanceTo(pos(r.el))];

function arm() {
  const sh = J([0, 2, 0]);
  const el = J([0.05, 1, 0.05], sh);
  const ha = J([0, 0, 0], el);
  return { main: makeMain([sh, el, ha]), sh, el, ha };
}

// One closed loop: N steps round a small circle and back to the start.
function loop(r, step, turns = 4, N = 60) {
  for (let t = 0; t < turns * N; t++) {
    const a = (t / N) * Math.PI * 2;
    step(a);
    IKSolver.holdPins(r.main);
  }
}

const MODES = [['none', 0], ['pos', 1], ['full', 2], ['soft', 3], ['rot', 4]];

for (const [what, drive] of [
  ['root wiggles (posing the body under a pinned elbow)', (r) => {
    const p0 = pos(r.sh).clone();
    return (a) => Skeleton.moveJoint(r.main, r.sh,
      new THREE.Vector3(p0.x + 0.25 * Math.cos(a), p0.y + 0.25 * Math.sin(a), p0.z));
  }],
  ['the PIN itself is dragged round', (r) => {
    const pin = IKSolver.pinObject(r.el);
    if (!pin) return () => {};
    const e0 = Float64Array.from(pin._m.elements);
    return (a) => {
      pin._m.fromArray(e0);
      pin._m.elements[12] += 0.2 * Math.cos(a);
      pin._m.elements[13] += 0.2 * Math.sin(a);
    };
  }],
]) {
  console.log('\n=== ' + what + ' ===');
  for (const [name, mode] of MODES) {
    const r = arm();
    if (mode) IKSolver.setPin(r.el, mode, r.main);
    const L0 = lens(r);
    loop(r, drive(r));
    const L1 = lens(r);
    const worst = Math.max(...L0.map((l, i) => Math.abs(L1[i] - l) / l));
    console.log('  ' + name.padEnd(5) + ' ' + L0.map((v) => v.toFixed(5)).join(' / ')
      + '  ->  ' + L1.map((v) => v.toFixed(5)).join(' / ')
      + '   drift ' + (worst * 100).toFixed(4) + '%'
      + (worst > 1e-4 ? '   <<<< ' : ''));
  }
}

// The DRAG path is a different function from holdPins, and posing is dragging. Loop a grab of
// the hand round a circle and back, with a pin on the elbow, and see if the arm comes back.
console.log('\n=== the hand is DRAGGED round, elbow pinned ===');
for (const [name, mode] of MODES) {
  const r = arm();
  if (mode) IKSolver.setPin(r.el, mode, r.main);
  const L0 = lens(r);
  const c = pos(r.ha).clone();
  for (let t = 0; t < 4 * 60; t++) {
    const a = (t / 60) * Math.PI * 2;
    IKSolver.solve(r.main, r.ha,
      new THREE.Vector3(c.x + 0.4 * Math.cos(a), c.y + 0.4 * Math.sin(a), c.z));
  }
  const L1 = lens(r);
  const worst = Math.max(...L0.map((l, i) => Math.abs(L1[i] - l) / l));
  console.log('  ' + name.padEnd(5) + ' ' + L0.map((v) => v.toFixed(5)).join(' / ')
    + '  ->  ' + L1.map((v) => v.toFixed(5)).join(' / ')
    + '   drift ' + (worst * 100).toFixed(4) + '%' + (worst > 1e-4 ? '   <<<<' : ''));
}

// And the two INTERLEAVED, which is what actually happens: the tool drags on the frames you
// are pressing and holdPins runs on the frames you are not.
console.log('\n=== drag and hold interleaved ===');
for (const [name, mode] of MODES) {
  const r = arm();
  if (mode) IKSolver.setPin(r.el, mode, r.main);
  const L0 = lens(r);
  const c = pos(r.ha).clone();
  for (let t = 0; t < 4 * 60; t++) {
    const a = (t / 60) * Math.PI * 2;
    if (t % 3) IKSolver.solve(r.main, r.ha,
      new THREE.Vector3(c.x + 0.4 * Math.cos(a), c.y + 0.4 * Math.sin(a), c.z));
    else IKSolver.holdPins(r.main);
  }
  const L1 = lens(r);
  const worst = Math.max(...L0.map((l, i) => Math.abs(L1[i] - l) / l));
  console.log('  ' + name.padEnd(5) + ' ' + L0.map((v) => v.toFixed(5)).join(' / ')
    + '  ->  ' + L1.map((v) => v.toFixed(5)).join(' / ')
    + '   drift ' + (worst * 100).toFixed(4) + '%' + (worst > 1e-4 ? '   <<<<' : ''));
}
