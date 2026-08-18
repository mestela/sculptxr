import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';
const mod = await import('./_ik_gen.mjs?v=' + Date.now());
const { default: IK, makeJoint: J, makeMain, Skeleton } = mod;
const pos = (j) => Skeleton.jointPos(j);
globalThis.window = globalThis.window || {};
function run(label, flags) {
  Object.assign(globalThis.window, flags);
  const hips = J([0, 1.8, 0]);
  const thL = J([0.28,1.7,0],hips), knL = J([0.36,1.05,0.30],thL), anL = J([0.28,0.35,0],knL);
  const thR = J([-0.28,1.7,0],hips), knR = J([-0.36,1.05,0.30],thR), anR = J([-0.28,0.35,0],knR);
  const main = makeMain([hips,thL,knL,anL,thR,knR,anR]);
  IK.setPin(anL, IK.PIN_POS); IK.setPin(anR, IK.PIN_POS);
  const t = new THREE.Vector3(0.22, 1.55, 0.1);
  // Hold the target dead still and keep solving. Report how far the knee still moves in each
  // successive window: a settling solver's windows shrink toward nothing.
  let prev = null; const out = [];
  for (let w = 0; w < 6; w++) {
    for (let i = 0; i < 20; i++) IK.solve(main, hips, t);
    const p = pos(knL).clone();
    if (prev) out.push(p.distanceTo(prev).toExponential(1));
    prev = p;
  }
  console.log(`  ${label.padEnd(22)} knee movement per 20 further solves: ${out.join('  ')}`);
  IK.setPin(anL, IK.PIN_NONE); IK.setPin(anR, IK.PIN_NONE);
}
run('absolute (new)', { _ikAbsoluteRotations: undefined });
run('accumulating (old)', { _ikAbsoluteRotations: false });
