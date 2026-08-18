import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';
const mod = await import('./_ik_gen.mjs?v=' + Date.now());
const { default: IK, makeJoint: J, makeMain, Skeleton, modelMat } = mod;
const pos = (j) => Skeleton.jointPos(j);
globalThis.window = globalThis.window || {};

// Swing-twist decomposition: how far a joint's frame has rotated ABOUT its own bone axis.
// Twist is the component of the rotation along the axis; swing is everything else.
const _q = new THREE.Quaternion();
function twistDeg(joint, child) {
  modelMat(joint).decompose(new THREE.Vector3(), _q, new THREE.Vector3());
  const axis = pos(child).clone().sub(pos(joint));
  if (axis.lengthSq() < 1e-12) return 0;
  axis.normalize();
  const v = new THREE.Vector3(_q.x, _q.y, _q.z);
  const proj = axis.clone().multiplyScalar(v.dot(axis));
  const t = new THREE.Quaternion(proj.x, proj.y, proj.z, _q.w).normalize();
  return 2 * Math.atan2(new THREE.Vector3(t.x, t.y, t.z).dot(axis), t.w) * 180 / Math.PI;
}

function run(label, flags) {
  for (const k of ['_ikHinge', '_ikHingeMode']) delete globalThis.window[k];
  Object.assign(globalThis.window, flags);
  const hips = J([0, 1.8, 0]);
  const thL = J([0.28, 1.7, 0], hips), knL = J([0.36, 1.05, 0.30], thL), anL = J([0.28, 0.35, 0], knL);
  const thR = J([-0.28, 1.7, 0], hips), knR = J([-0.36, 1.05, 0.30], thR), anR = J([-0.28, 0.35, 0], knR);
  const main = makeMain([hips, thL, knL, anL, thR, knR, anR]);
  IK.setPin(anL, IK.PIN_POS); IK.setPin(anR, IK.PIN_POS);

  // A CLOSED LOOP: the hips travel a circle and come back exactly where they started. If the
  // solver invents no twist, every bone must return to the twist it began with. Anything left
  // over is accumulated -- the classic holonomy of composing many small minimal-arc rotations
  // along a path, which is roll-free at every single step and yet rolls over a loop.
  const home = new THREE.Vector3(0, 1.8, 0);
  IK.solve(main, hips, home);
  const t0 = [twistDeg(thL, knL), twistDeg(knL, anL)];
  let peak = 0;
  const LOOPS = 4, N = 200;
  const after = [];
  for (let L = 1; L <= LOOPS; L++) {
    for (let i = 1; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      IK.solve(main, hips, new THREE.Vector3(Math.sin(a) * 0.3, 1.8 - 0.22 * (1 - Math.cos(a)), Math.cos(a) * 0.16 - 0.16));
      peak = Math.max(peak, Math.abs(twistDeg(thL, knL) - t0[0]));
    }
    IK.solve(main, hips, home);
    after.push((twistDeg(thL, knL) - t0[0]).toFixed(2));
  }
  console.log(`  ${label.padEnd(18)} peak thigh twist ${peak.toFixed(1)}deg   left over after each loop: ${after.join(', ')} deg`);
  IK.setPin(anL, IK.PIN_NONE); IK.setPin(anR, IK.PIN_NONE);
}
run('seed (shipped)', {});
run('clamp', { _ikHingeMode: 'clamp' });
run('hinge off', { _ikHinge: false });
