// Node harness for src/editing/IKSolver.js.
//
// The real module cannot be imported here (gl-matrix is UMD, Skeleton drags in the whole
// mesh stack), so the ACTUAL source text is read, its imports stripped, and stubs prepended.
// That means the code under test is the shipped code, not a copy of it.
//
// Run: node scratchpad/ik_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';

const mat4 = {
  clone: (m) => Float32Array.from(m),
  copy: (out, m) => { for (let i = 0; i < 16; i++) out[i] = m[i]; return out; },
};

// --- mock rig -------------------------------------------------------------------
// A joint is a local matrix plus a parent link. Model space is the composed chain, which is
// exactly what the real Mesh.getModelSpaceMatrix returns for a parented mesh.
let _nextId = 1;
export function makeJoint(pos, parent) {
  const j = {
    _isBone: true,
    _parentMesh: parent || null,
    _id: _nextId++,
    _m: new THREE.Matrix4(),
    getID() { return this._id; },
    getMatrix() { return this._m.elements; },
    getModelSpaceMatrix() { return modelMat(this).elements; },
  };
  // Position is given in MODEL space; store the local that produces it.
  const world = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]);
  if (parent) world.premultiply(modelMat(parent).clone().invert());
  j._m.copy(world);
  return j;
}

function modelMat(j) {
  const m = j._m.clone();
  return j._parentMesh ? m.premultiply(modelMat(j._parentMesh)) : m;
}

export function makeMain(joints) {
  return { getMeshes: () => joints };
}

const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  joints: (main) => main.getMeshes().filter((m) => m._isBone),
  jointPos(j, out) {
    const m = modelMat(j);
    out = out || new THREE.Vector3();
    return out.set(m.elements[12], m.elements[13], m.elements[14]);
  },
  sceneUnit: () => 1,
  syncThree() {},
  moveJoint(main, joint, pos) {
    const m = modelMat(joint);
    m.elements[12] = pos.x; m.elements[13] = pos.y; m.elements[14] = pos.z;
    if (joint._parentMesh) m.premultiply(modelMat(joint._parentMesh).clone().invert());
    joint._m.copy(m);
  },
};

export { Skeleton, modelMat };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_ik_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default IKSolver;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { default: IKSolver, makeJoint: J, makeMain, Skeleton, modelMat } = mod;
const THREE = await import(THREE_PATH);

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

function pos(j) { return Skeleton.jointPos(j); }

function lengths(joints) {
  return joints.filter((j) => j._parentMesh)
    .map((j) => pos(j).distanceTo(pos(j._parentMesh)));
}

function lengthsPreserved(name, joints, before) {
  const after = lengths(joints);
  let worst = 0;
  for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(after[i] - before[i]));
  check(name + ': bone lengths preserved', worst < 1e-6, 'worst drift ' + worst.toExponential(2));
}

// --- 1. reachable target on a straight chain ------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const d = J([0, 3, 0], c);
  const joints = [a, b, c, d];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(1.5, 1.5, 0);
  IKSolver.solve(main, d, target);

  check('reachable: effector hits the target', pos(d).distanceTo(target) < 1e-3,
    'err ' + pos(d).distanceTo(target).toExponential(2));
  check('reachable: root did not move (nothing pinned)', pos(a).length() < 1e-9);
  lengthsPreserved('reachable', joints, L0);
}

// --- 2. unreachable target -------------------------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const joints = [a, b, c];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(50, 0, 0);
  IKSolver.solve(main, c, target);

  // The chain should straighten toward the target and stop at its own reach, NOT stretch.
  check('unreachable: chain reaches its own limit', Math.abs(pos(c).length() - 2) < 1e-3,
    'reach ' + pos(c).length().toFixed(4));
  check('unreachable: chain points at the target',
    pos(c).clone().normalize().dot(target.clone().normalize()) > 0.999);
  lengthsPreserved('unreachable', joints, L0);
}

// --- 3. a pin holds while something else is dragged ------------------------------
{
  const root = J([0, 0, 0]);
  const s1 = J([0, 1, 0], root);
  const s2 = J([0, 2, 0], s1);
  const s3 = J([0, 3, 0], s2);
  const s4 = J([0, 4, 0], s3);
  const joints = [root, s1, s2, s3, s4];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(s4, true);
  const tipBefore = pos(s4).clone();

  // Kept inside the pin's reach on purpose: s2 -> s4 is two bones of length 1, so a target
  // further than 2 from the pin is unsatisfiable and the pin SHOULD fall short.
  const target = new THREE.Vector3(0.3, 2.1, 0);
  IKSolver.solve(main, s2, target);

  check('pinned: the pin stayed put', pos(s4).distanceTo(tipBefore) < 1e-3,
    'moved ' + pos(s4).distanceTo(tipBefore).toExponential(2));
  check('pinned: dragged joint reached its target', pos(s2).distanceTo(target) < 1e-2,
    'err ' + pos(s2).distanceTo(target).toExponential(2));
  check('pinned: the root was free to move', pos(root).length() > 1e-6);
  lengthsPreserved('pinned', joints, L0);
  IKSolver.setPinned(s4, false);
}

// --- 4. branching tree, two pins --------------------------------------------------
{
  // Arms drawn BENT, so the chain has slack. Straight limbs are already at full extension:
  // any movement of the body is then unreachable and the pins must fall short by definition.
  const hips = J([0, 0, 0]);
  const chest = J([0, 1, 0], hips);
  const shL = J([0.5, 1, 0], chest);
  const elL = J([0.9, 0.6, 0], shL);
  const haL = J([1.1, 0.1, 0], elL);
  const shR = J([-0.5, 1, 0], chest);
  const elR = J([-0.9, 0.6, 0], shR);
  const haR = J([-1.1, 0.1, 0], elR);
  const joints = [hips, chest, shL, elL, haL, shR, elR, haR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(haL, true);
  IKSolver.setPinned(haR, true);
  const handL = pos(haL).clone(), handR = pos(haR).clone();

  // Pull the hips down: the classic "hands pinned, body crouches" case.
  IKSolver.solve(main, hips, new THREE.Vector3(0, -0.3, 0));

  check('branch: left pin held', pos(haL).distanceTo(handL) < 1e-2,
    'moved ' + pos(haL).distanceTo(handL).toFixed(4));
  check('branch: right pin held', pos(haR).distanceTo(handR) < 1e-2,
    'moved ' + pos(haR).distanceTo(handR).toFixed(4));
  check('branch: hips actually moved down', pos(hips).y < -0.2,
    'y ' + pos(hips).y.toFixed(3));
  lengthsPreserved('branch', joints, L0);
  IKSolver.setPinned(haL, false);
  IKSolver.setPinned(haR, false);
}

// --- 5. what the solver is allowed to touch ---------------------------------------
// An unsolved branch of the SAME skeleton still rides its ancestors — that is what a
// hierarchy means, and a rotated root must carry everything under it. A different skeleton
// entirely must not move at all.
{
  const root = J([0, 0, 0]);
  const spine = J([0, 1, 0], root);
  const arm = J([1, 1, 0], spine);
  const tail = J([0, -1, 0], root);   // same tree, off the solved path
  const other = J([9, 0, 0]);          // a separate skeleton
  const otherKid = J([9, 1, 0], other);
  const joints = [root, spine, arm, tail, other, otherKid];
  const main = makeMain(joints);
  const otherBefore = pos(otherKid).clone();
  const tailOffset = pos(tail).clone().sub(pos(root)).length();
  const L0 = lengths(joints);

  IKSolver.solve(main, arm, new THREE.Vector3(0.7, 1.6, 0));

  check('scope: a separate skeleton is untouched', pos(otherKid).distanceTo(otherBefore) < 1e-9);
  check('scope: an unsolved branch rides its parent rigidly',
    Math.abs(pos(tail).clone().sub(pos(root)).length() - tailOffset) < 1e-9);
  lengthsPreserved('scope', joints, L0);
}

// --- 6. the grabbed joint's ORIENTATION is a constraint, not a decoration -----------
{
  // Hips with two legs and a spine, feet pinned: twist the hips and the legs must be carried
  // by that twist, with the pinned feet re-solved against where they end up.
  const hips = J([0, 0, 0]);
  const spine = J([0, 1, 0], hips);
  const thighL = J([0.3, -0.2, 0], hips);
  const kneeL = J([0.35, -0.9, 0.1], thighL);
  const footL = J([0.4, -1.6, 0], kneeL);
  const thighR = J([-0.3, -0.2, 0], hips);
  const kneeR = J([-0.35, -0.9, 0.1], thighR);
  const footR = J([-0.4, -1.6, 0], kneeR);
  const joints = [hips, spine, thighL, kneeL, footL, thighR, kneeR, footR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(footL, true);
  IKSolver.setPinned(footR, true);
  const fL = pos(footL).clone(), fR = pos(footR).clone();
  const thighLBefore = pos(thighL).clone();

  // Turn the hips 30 degrees about Y while leaving them where they are.
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);
  IKSolver.solve(main, hips, pos(hips).clone(), null, twist);

  const q = new THREE.Quaternion();
  modelMat(hips).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  check('twist: hips reached the driven orientation', q.angleTo(twist) < 1e-4,
    'off by ' + (q.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  // The spine sits ON the twist axis, so its POSITION is invariant under a Y twist — its
  // orientation is what has to follow. The thighs are off-axis, so they must actually move.
  const qs = new THREE.Quaternion();
  modelMat(spine).decompose(new THREE.Vector3(), qs, new THREE.Vector3());
  check('twist: the spine was carried by the twist', qs.angleTo(twist) < 1e-4,
    'off by ' + (qs.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  check('twist: the thighs swung with the hips', pos(thighL).distanceTo(thighLBefore) > 1e-2,
    'moved ' + pos(thighL).distanceTo(thighLBefore).toFixed(4));
  check('twist: left foot still pinned', pos(footL).distanceTo(fL) < 1e-2,
    'moved ' + pos(footL).distanceTo(fL).toFixed(4));
  check('twist: right foot still pinned', pos(footR).distanceTo(fR) < 1e-2,
    'moved ' + pos(footR).distanceTo(fR).toFixed(4));
  lengthsPreserved('twist', joints, L0);
  IKSolver.setPinned(footL, false);
  IKSolver.setPinned(footR, false);
}

// --- 7. a LEAF effector can be rotated (nothing hangs off it to fit against) --------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const joints = [a, b, c];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
  IKSolver.solve(main, c, new THREE.Vector3(0.5, 1.5, 0), null, twist);

  const q = new THREE.Quaternion();
  modelMat(c).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  check('leaf twist: orientation reached', q.angleTo(twist) < 1e-4,
    'off by ' + (q.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  lengthsPreserved('leaf twist', joints, L0);
}

// --- 8. a 6DOF pin holds ORIENTATION as well as position ---------------------------
{
  // A leg with a foot on the ground. Pull the hips sideways: a 3DOF pin lets the foot tip
  // over as the shin swings, a 6DOF pin keeps it flat.
  const build = () => {
    const hips = J([0, 2, 0]);
    const knee = J([0.1, 1, 0], hips);
    const ankle = J([0, 0.2, 0], knee);
    const toe = J([0, 0.2, 0.3], ankle); // sticks forward, so a tilt is visible as motion
    return { hips, knee, ankle, toe, joints: [hips, knee, ankle, toe] };
  };

  const q = new THREE.Quaternion();
  const orientOf = (j) => { modelMat(j).decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q.clone(); };

  const a = build();
  const mainA = makeMain(a.joints);
  IKSolver.setPin(a.ankle, IKSolver.PIN_POS);
  const o3 = orientOf(a.ankle);
  IKSolver.solve(mainA, a.hips, new THREE.Vector3(0.5, 1.8, 0));
  const drift3 = orientOf(a.ankle).angleTo(o3);

  const b = build();
  const mainB = makeMain(b.joints);
  const L0 = lengths(b.joints);
  IKSolver.setPin(b.ankle, IKSolver.PIN_FULL);
  const o6 = orientOf(b.ankle);
  const p6 = pos(b.ankle).clone();
  IKSolver.solve(mainB, b.hips, new THREE.Vector3(0.5, 1.8, 0));

  check('6dof pin: orientation held', orientOf(b.ankle).angleTo(o6) < 1e-4,
    'drifted ' + (orientOf(b.ankle).angleTo(o6) * 180 / Math.PI).toFixed(3) + ' deg');
  check('6dof pin: position still held', pos(b.ankle).distanceTo(p6) < 1e-2);
  check('6dof pin: a 3dof pin does NOT hold orientation', drift3 > 1e-3,
    'rotated ' + (drift3 * 180 / Math.PI).toFixed(2) + ' deg');
  lengthsPreserved('6dof pin', b.joints, L0);

  // Repeated solves must not let a held orientation ratchet round over a long drag.
  for (let i = 0; i < 60; i++) {
    IKSolver.solve(mainB, b.hips, new THREE.Vector3(0.5 + 0.002 * i, 1.8, 0));
  }
  check('6dof pin: no orientation drift over 60 solves', orientOf(b.ankle).angleTo(o6) < 1e-3,
    'drifted ' + (orientOf(b.ankle).angleTo(o6) * 180 / Math.PI).toFixed(4) + ' deg');
  IKSolver.setPin(b.ankle, IKSolver.PIN_NONE);
  IKSolver.setPin(a.ankle, IKSolver.PIN_NONE);
}

// --- 9. pin state cycles and reads back --------------------------------------------
{
  const j = J([0, 0, 0]);
  check('cycle: none -> position', IKSolver.cyclePin(j) === IKSolver.PIN_POS);
  check('cycle: position -> full', IKSolver.cyclePin(j) === IKSolver.PIN_FULL);
  check('cycle: full -> none', IKSolver.cyclePin(j) === IKSolver.PIN_NONE);
  // Files written before pins had modes stored a boolean.
  j._boneIKPin = true;
  check('legacy: a boolean pin reads as a position pin', IKSolver.pinMode(j) === IKSolver.PIN_POS);
  j._boneIKPin = 0;
}

// --- 10. no NaNs anywhere after a degenerate drag ----------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const joints = [a, b];
  const main = makeMain(joints);
  IKSolver.solve(main, b, new THREE.Vector3(0, 0, 0)); // target ON the parent
  const finite = joints.every((j) => Array.from(j.getMatrix()).every(Number.isFinite));
  check('degenerate: no NaN in any joint matrix', finite);
  lengthsPreserved('degenerate', joints, [1]);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
