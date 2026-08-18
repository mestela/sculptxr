import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';
const mod = await import('./_ik_gen.mjs?v=' + Date.now());
const { default: IK, makeJoint: J, makeMain, Skeleton } = mod;
const pos = (j) => Skeleton.jointPos(j);
globalThis.window = globalThis.window || {};

// A flip, measured without reference to any remembered axis: the bend PLANE of the knee
// inverting from one frame to the next. That is what a pop physically is, and it is fair to
// every approach because it looks only at the motion produced.
function sweep(name, at, N, flags) {
  for (const k of ['_ikHinge','_ikHingeMode']) delete globalThis.window[k];
  Object.assign(globalThis.window, flags || {});
  const hip = J([0, 0, 0]);
  const knee = J([0.25, -1.0, 0], hip);
  const ankle = J([0, -2.0, 0], knee);
  const main = makeMain([hip, knee, ankle]);
  const bone = pos(hip).distanceTo(pos(knee));
  const norm = () => { const u = pos(knee).clone().sub(pos(hip));
    const v = pos(ankle).clone().sub(pos(knee)); return u.cross(v); };
  for (let k = 0; k < 12; k++) IK.solve(main, ankle, at(1 / N, 2 * bone)); // settle first
  let pn = norm().normalize(), pk = pos(knee).clone();
  let flips = 0, jump = 0, err = 0;
  for (let i = 1; i <= N; i++) {
    const t = at(i / N, 2 * bone);
    IK.solve(main, ankle, t);
    const n = norm();
    if (n.length() > 1e-6) { n.normalize(); if (n.dot(pn) < 0) flips++; pn = n.clone(); }
    jump = Math.max(jump, pos(knee).distanceTo(pk)); pk = pos(knee).clone();
    if (t.length() < 2 * bone * 0.97) err = Math.max(err, pos(ankle).distanceTo(t));
  }
  console.log(`  ${name.padEnd(26)} plane flips ${String(flips).padStart(3)}/${N}   worst knee jump ${(jump / bone).toFixed(3)} bone   worst reach err ${err.toFixed(4)}`);
}

// (a) posing a leg: straighten right out and bend again, swinging, slight out-of-plane drift.
const posing = (f, reach) => { const a = -Math.PI / 2 + Math.sin(f * Math.PI * 2) * 1.0;
  const r = reach * (0.55 + 0.449 * (0.5 - 0.5 * Math.cos(f * Math.PI * 6)));
  return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(f * Math.PI * 3) * 0.35); };
// (b) harsher: wider swing, over-extension, more out-of-plane.
const harsh = (f, reach) => { const a = -Math.PI / 2 + Math.sin(f * Math.PI * 2) * 1.4;
  const r = reach * (0.5 + 0.55 * (0.5 + 0.5 * Math.cos(f * Math.PI * 8)));
  return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(f * Math.PI * 5) * 0.5); };
// (c) the singular one: straight up through the hip and out the other side.
const through = (f) => new THREE.Vector3(0.02, -1.9 + 3.6 * f, 0);

for (const [label, flags] of [['CLAMP', {}], ['SEED', { _ikHingeMode: 'seed' }], ['OFF', { _ikHinge: false }]]) {
  console.log(label);
  sweep('(a) posing a leg', posing, 400, flags);
  sweep('(b) harsh swing', harsh, 400, flags);
  sweep('(c) up through the hip', through, 240, flags);
}
