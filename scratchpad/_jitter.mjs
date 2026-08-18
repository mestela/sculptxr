import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';
const mod = await import('./_ik_gen.mjs?v=' + Date.now());
const { default: IK, makeJoint: J, makeMain, Skeleton } = mod;
const pos = (j) => Skeleton.jointPos(j);
globalThis.window = globalThis.window || {};

// Matt's standard test: a root hip joint with a pair of legs, ankles pinned, hips dragged.
function rig() {
  const hips = J([0, 1.8, 0]);
  const Z = globalThis.__kneeZ;
  const thL = J([0.28, 1.7, 0], hips), knL = J([0.36, 1.05, Z], thL), anL = J([0.28, 0.35, 0], knL);
  const thR = J([-0.28, 1.7, 0], hips), knR = J([-0.36, 1.05, Z], thR), anR = J([-0.28, 0.35, 0], knR);
  const r = { hips, knL, anL, knR, anR, joints: [hips, thL, knL, anL, thR, knR, anR] };
  r.main = makeMain(r.joints);
  IK.setPin(anL, IK.PIN_POS); IK.setPin(anR, IK.PIN_POS);
  r.aL = IK.pinAnchor(anL, new THREE.Vector3());
  r.aR = IK.pinAnchor(anR, new THREE.Vector3());
  return r;
}
const clear = (r) => { IK.setPin(r.anL, IK.PIN_NONE); IK.setPin(r.anR, IK.PIN_NONE); };

// A smooth drag: hips circling and bobbing, well inside what the legs can reach.
const path = (f) => new THREE.Vector3(Math.sin(f * Math.PI * 2) * 0.34,
  1.8 - 0.3 * (0.5 - 0.5 * Math.cos(f * Math.PI * 4)), Math.sin(f * Math.PI * 3) * 0.2);

function run(label, flags) {
  for (const k of ['_ikHinge', '_ikBranchRetry', '_ikIterations', '_ikAxisOnce', '_ikHingeMode']) delete globalThis.window[k];
  Object.assign(globalThis.window, flags);
  const r = rig();
  const N = 300;
  IK.solve(r.main, r.hips, path(0));
  let prevK = pos(r.knL).clone(), prevV = new THREE.Vector3();
  let jerk = 0, pinDrift = 0, hipErr = 0;
  for (let i = 1; i <= N; i++) {
    IK.solve(r.main, r.hips, path(i / N));
    const k = pos(r.knL).clone();
    const v = k.clone().sub(prevK);
    // Jitter is not speed, it is CHANGE of speed: a smooth input should give a smooth path,
    // so the frame-to-frame change in the knee's velocity is what reads as shake.
    if (i > 1) jerk = Math.max(jerk, v.clone().sub(prevV).length());
    prevV = v; prevK = k;
    pinDrift = Math.max(pinDrift, pos(r.anL).distanceTo(r.aL), pos(r.anR).distanceTo(r.aR));
    hipErr = Math.max(hipErr, pos(r.hips).distanceTo(path(i / N)));
  }
  // Drift: hold the target dead still and keep solving. A settled solver stops moving.
  const hold = path(0.5);
  for (let i = 0; i < 20; i++) IK.solve(r.main, r.hips, hold);
  const settled = pos(r.knL).clone();
  for (let i = 0; i < 40; i++) IK.solve(r.main, r.hips, hold);
  const creep = pos(r.knL).distanceTo(settled);
  clear(r);
  console.log(`  ${label.padEnd(24)} jitter ${jerk.toFixed(4)}   pin drift ${pinDrift.toFixed(4)}   hips err ${hipErr.toFixed(4)}   creep/40 solves ${creep.toFixed(5)}`);
}
for (const [label, Z] of [['slight bend (z=0.14)', 0.14], ['pronounced (z=0.30)', 0.30], ['very pronounced (z=0.45)', 0.45]]) {
  globalThis.__kneeZ = Z;
  const r0 = rig();
  const ext = pos(r0.joints[1]).distanceTo(r0.aL) /
    (pos(r0.joints[1]).distanceTo(pos(r0.knL)) + pos(r0.knL).distanceTo(pos(r0.anL)));
  clear(r0);
  console.log(`${label}  (${(ext * 100).toFixed(1)}% extended at rest)`);
  run('   clamp every sweep', {});
  run('   seed the branch only', { _ikHingeMode: 'seed' });
  run('   hinge off', { _ikHinge: false });
}
