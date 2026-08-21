// Node harness for Skeleton.mirrorPose.
//
// The whole feature is one matrix expression, and the expression is the thing that is easy to
// get plausibly wrong: reflecting an orthonormal frame gives an IMPROPER one, which is not a
// rotation and which a joint cannot hold, so the pose has to be conjugated (P·M·P) rather than
// reflected (P·M). Both look identical on a joint that has only been translated, and only the
// conjugated one is right the moment there is a twist anywhere in the chain. So the rig here
// is posed with a rotation about an axis that is deliberately not aligned with the mirror
// plane or with the bones.
//
// The acceptance check is positional and covers the DESCENDANTS: a wrong rotation on the
// shoulder still puts the shoulder in the right place and throws the hand somewhere else
// entirely. Real three.js here, not the proxy the serialisation harness uses — the maths is
// the code under test.
//
// Run: node scratchpad/mirrorpose_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

// Standing lesson 1: a passing test proves nothing until it has been seen to fail.
//   MIRROR_INJECT=copy      reflect the pose instead of conjugating it (P·M, not P·M·P)
//   MIRROR_INJECT=posonly   mirror only the position and copy the rotation outright
let src = SRC;
if (process.env.MIRROR_INJECT === 'copy') {
  const a = 'return new THREE.Matrix4().multiplyMatrices(_mMirror, _mSrc).multiply(_mMirror);';
  if (!src.includes(a)) throw new Error('inject copy: anchor moved');
  src = src.replace(a, 'return new THREE.Matrix4().multiplyMatrices(_mMirror, _mSrc);');
} else if (process.env.MIRROR_INJECT === 'pinsnap') {
  // The first version of this: move a pin that already exists onto its joint's new position,
  // create nothing, remove nothing. It looks right on a rig pinned symmetrically and posed
  // within reach, which is why it survived review and not the harness.
  const a = 'const m = new THREE.Matrix4().multiplyMatrices(_mMirror, was.m).multiply(_mMirror);';
  if (!src.includes(a)) throw new Error('inject pinsnap: anchor moved');
  src = src.replace(a, 'const m = new THREE.Matrix4().fromArray(dst.getModelSpaceMatrix());');
} else if (process.env.MIRROR_INJECT === 'posonly') {
  const a = 'return new THREE.Matrix4().multiplyMatrices(_mMirror, _mSrc).multiply(_mMirror);';
  if (!src.includes(a)) throw new Error('inject posonly: anchor moved');
  src = src.replace(a, `{
    const out = _mSrc.clone();
    const p = new THREE.Vector3().setFromMatrixPosition(_mSrc);
    const r = Skeleton.mirrorPoint(p, { origin: new THREE.Vector3(), normal: new THREE.Vector3(1,0,0) });
    out.elements[12] = r.x; out.elements[13] = r.y; out.elements[14] = r.z;
    return out;
  }`);
}

const body = src.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
const Multimesh = class {};
const Primitives = { createSphere: () => ({}) };
const Enums = { Shader: { FLAT: 0 } };
const getOptionsURL = () => ({});
getOptionsURL.saveOption = () => {};
const mat4 = { clone: (m) => m.slice(), copy: (a, b) => { for (let i = 0; i < 16; i++) a[i] = b[i]; return a; } };
globalThis.window = globalThis.window || {};
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_mirrorpose_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default Skeleton;\n');
const Skeleton = (await import(outPath + '?v=' + Date.now())).default;
const THREE = await import(THREE_PATH);

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A joint: a local matrix and a parent link, with model space as the composed chain — the same
// contract the real Mesh gives a parented mesh.
let nextId = 1;
function J(pos, parent, label) {
  const j = {
    _isBone: true, _isNull: true, _parentMesh: parent || null, _id: nextId++,
    _permanentStaticLabel: label,
    _m: new THREE.Matrix4(),
    getID() { return this._id; },
    getMatrix() { return this._m.elements; },
    getThreeMesh() { return null; },
    getModelSpaceMatrix() { return model(this).elements; },
    setModelSpaceMatrix(e) {
      const m = new THREE.Matrix4().fromArray(e);
      if (this._parentMesh) m.premultiply(model(this._parentMesh).clone().invert());
      this._m.copy(m);
    },
  };
  const w = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]);
  if (parent) w.premultiply(model(parent).clone().invert());
  j._m.copy(w);
  return j;
}
function model(j) {
  const m = j._m.clone();
  return j._parentMesh ? m.premultiply(model(j._parentMesh)) : m;
}
const pos = (j) => new THREE.Vector3().setFromMatrixPosition(model(j));

// Symmetry ON, and no sculpt in the scene — which is the case Skeleton answers with the world
// centreline, exactly the plane this rig is drawn about.
function rig() {
  const chest = J([0, 3, 0], null, 'chest');
  const arm = (sx, tag) => {
    const sh = J([0.5 * sx, 3, 0], chest, 'shoulder' + tag);
    const el = J([1.0 * sx, 3, 0], sh, 'elbow' + tag);
    const hd = J([1.5 * sx, 3, 0.0], el, 'hand' + tag);
    // A TIP WITH NO TWIN LINK, offset off every axis of symmetry. It is never written by the
    // mirror, so it rides its parent's frame — which makes it the only thing here that can
    // tell a conjugated rotation from a copied one. Every joint in a twin PAIR is written
    // directly, so its position comes out reflected either way and proves nothing.
    // Mirror-symmetric in the REST pose, like every rig drawn with Snap Plane on: the X
    // offset flips with the side and the in-plane offsets do not. `1.5 * sx + 0.2` instead of
    // `1.7 * sx` makes the two sides different lengths, and then no mirror on earth can put
    // one on top of the other.
    const tip = J([1.7 * sx, 3.15, 0.25], hd, 'tip' + tag);
    return { sh, el, hd, tip };
  };
  const L = arm(-1, 'L'), R = arm(1, 'R');
  L.sh._boneMirror = R.sh; R.sh._boneMirror = L.sh;
  L.el._boneMirror = R.el; R.el._boneMirror = L.el;
  L.hd._boneMirror = R.hd; R.hd._boneMirror = L.hd;
  const meshes = [chest, L.sh, L.el, L.hd, L.tip, R.sh, R.el, R.hd, R.tip];
  const main = {
    getMeshes: () => meshes,
    getMesh: () => null,
    getSculptManager: () => ({ getSymmetry: () => true }),
  };
  return { main, chest, L, R, meshes };
}

// Rotate a joint about its own position, carrying its descendants — an FK pose, which is what
// a mirror is supposed to reproduce on the other side.
function poseJoint(j, axis, angle) {
  const p = pos(j);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle);
  const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z))
    .multiply(model(j));
  j.setModelSpaceMatrix(m.elements);
}

const PLANE = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
const reflect = (v) => v.clone().addScaledVector(PLANE.normal, -2 * v.dot(PLANE.normal));

// --- 1. a mirrored pose is the reflection of the pose it came from ------------------
{
  const r = rig();
  // An axis aligned with nothing in particular: a mirror that merely COPIES the rotation
  // survives an axis lying in the plane, and fails here.
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  poseJoint(r.L.el, [1, 0.2, -0.4], -0.7);

  // `side` names the SOURCE. The posed arm is at -X, so asking for +1 drives from the
  // UNPOSED right arm and overwrites the pose — which is the direction being asserted here.
  // Getting this backwards is a real hazard for the user (it silently discards the work), so
  // it gets its own check rather than being folded into the maths one below.
  const rightBefore = [r.R.sh, r.R.el, r.R.hd].map((j) => pos(j));
  const res = Skeleton.mirrorPose(r.main, 1);
  check('mirror: it ran', res.ok, res.why);

  const srcUnmoved = [r.R.sh, r.R.el, r.R.hd]
    .every((j, i) => pos(j).distanceTo(rightBefore[i]) < 1e-6);
  check('mirror: the source side is not itself moved', srcUnmoved);
  const wantL = rightBefore.map(reflect);
  const worst = Math.max(...[r.L.sh, r.L.el, r.L.hd]
    .map((j, i) => pos(j).distanceTo(wantL[i])));
  check('mirror: side picks which arm drives', worst < 1e-6,
    'worst ' + worst.toExponential(2) + ' — driving from the wrong side discards the pose');
}

// --- 2. drive explicitly from the posed side ---------------------------------------
{
  const r = rig();
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  poseJoint(r.L.el, [1, 0.2, -0.4], -0.7);
  const want = [r.L.sh, r.L.el, r.L.hd].map((j) => reflect(pos(j)));
  const tipWant = reflect(pos(r.L.tip));

  const side = Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1;
  Skeleton.mirrorPose(r.main, side);

  const errs = [r.R.sh, r.R.el, r.R.hd].map((j, i) => pos(j).distanceTo(want[i]));
  const worst = Math.max(...errs);
  check('the whole chain lands on the reflected pose, not just the joint driven',
    worst < 1e-6, 'worst ' + worst.toExponential(2));

  // The one that catches a copied rotation. The tip has no twin, so nothing writes it — it can
  // only arrive in the right place if its parent's mirrored FRAME is right, not merely its
  // parent's position.
  const tipErr = pos(r.R.tip).distanceTo(tipWant);
  check('a child with no twin of its own is still mirrored, through its parent frame',
    tipErr < 1e-6, 'off by ' + tipErr.toExponential(2) +
    ' — the rotation was copied rather than conjugated');
}

// --- 3. the mirrored frame is still a rotation --------------------------------------
{
  const r = rig();
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  Skeleton.mirrorPose(r.main, Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1);
  const m = model(r.R.sh);
  const e = m.elements;
  const c0 = new THREE.Vector3(e[0], e[1], e[2]);
  const c1 = new THREE.Vector3(e[4], e[5], e[6]);
  const c2 = new THREE.Vector3(e[8], e[9], e[10]);
  const det = c0.dot(new THREE.Vector3().crossVectors(c1, c2));
  check('the mirrored basis is right-handed (a reflection alone would be improper)',
    det > 0, 'det ' + det.toFixed(4));
  check('and stays orthonormal', Math.abs(c0.length() - 1) < 1e-6
    && Math.abs(c0.dot(c1)) < 1e-6, 'len ' + c0.length().toFixed(6));
}

// --- 4. swap mode is an involution --------------------------------------------------
{
  const r = rig();
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  poseJoint(r.R.el, [0.5, -1, 0.2], 0.6);
  const before = r.meshes.map((j) => pos(j));

  Skeleton.mirrorPose(r.main, 0);
  const swapped = r.meshes.map((j) => pos(j));
  let moved = 0;
  before.forEach((p, i) => { moved = Math.max(moved, p.distanceTo(swapped[i])); });
  check('swap: it actually swapped something', moved > 1e-3, 'moved ' + moved.toExponential(2));

  Skeleton.mirrorPose(r.main, 0);
  let back = 0;
  before.forEach((p, i) => { back = Math.max(back, p.distanceTo(pos(r.meshes[i]))); });
  check('swap twice returns the original pose', back < 1e-6, 'drift ' + back.toExponential(2));
}

// --- 5. trunk controls reflect in place ----------------------------------------------
{
  const r = rig();
  poseJoint(r.chest, [0.2, 0.3, 1], 0.4);
  // Array.from, NOT Float32Array.from: three.js keeps matrix elements in a plain (float64)
  // array, and rounding the copy to float32 fakes a delta of about 1e-8 all by itself.
  const chestBefore = Array.from(r.chest.getMatrix());
  const chestWant = new THREE.Matrix4().fromArray(chestBefore);
  const P = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0,
    0, 0, 1, 0, 0, 0, 0, 1);
  chestWant.premultiply(P).multiply(P);
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  Skeleton.mirrorPose(r.main, Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1);
  const now = r.chest.getMatrix();
  let worst = 0;
  for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(now[k] - chestWant.elements[k]));
  check('an unpaired trunk control reflects its position and orientation in place', worst < 1e-9,
    'an asymmetric hip or spine is part of the pose, even when it has no twin');
}

// Sparse animation mirrors only authored controls. An unkeyed limb is solver output and must
// not be baked just because it happened to be in the evaluated pose when the button was hit.
{
  const r = rig();
  poseJoint(r.chest, [0.2, 0.3, 1], 0.4);
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  const leftBefore = Array.from(r.L.sh.getMatrix());
  Skeleton.mirrorPose(r.main, 0, new Set([r.chest]));
  let limbDelta = 0;
  for (let k = 0; k < 16; k++) limbDelta = Math.max(limbDelta,
    Math.abs(r.L.sh.getMatrix()[k] - leftBefore[k]));
  check('sparse mirror leaves unkeyed solver-owned limbs alone', limbDelta < 1e-9);
}

// --- PINS. Mirroring a pose that does not mirror its pins is a mirror that undoes itself on
// the next solve: the twin leg swings across and the old anchor drags it straight back.
//
// The mock has to be able to BUILD a pin, because "the source is pinned and the twin is not"
// is the case that matters most and it cannot be handled by moving something that exists.
function pinnable(r) {
  const list = r.meshes;
  r.main.buildNull = () => {
    const n = { _isNull: true, _id: nextId++, _m: new THREE.Matrix4(), _parentMesh: null,
      getID() { return this._id; }, getMatrix() { return this._m.elements; },
      getThreeMesh() { return null; },
      getModelSpaceMatrix() { return this._m.elements; },
      setModelSpaceMatrix(e) { this._m.fromArray(e); } };
    return n;
  };
  r.main.addMeshSilent = (m) => { if (!list.includes(m)) list.push(m); return m; };
  r.main.decorateNull = () => {};
  return r;
}

function pinAt(r, joint, xyz, mode) {
  const pin = Skeleton.makePin(r.main, joint);
  pin._m.makeTranslation(xyz[0], xyz[1], xyz[2]);
  pin._pinMode = mode || 1;
  joint._boneIKPinObj = pin;
  joint._boneIKPin = mode || 1;
  return pin;
}

// Both sides pinned: the twin's anchor becomes the reflection of the SOURCE's anchor — NOT the
// twin joint's own position. A pin the joint falls short of is the case that tells these two
// apart, so the anchor here is deliberately somewhere the hand is not.
{
  const r = pinnable(rig());
  poseJoint(r.L.sh, [0.3, 1, 0.6], 0.9);
  const srcPin = pinAt(r, r.L.hd, [-2.2, 3.4, 0.7]);
  const dstPin = pinAt(r, r.R.hd, [1.1, 2.0, -0.3]);
  const want = reflect(new THREE.Vector3(-2.2, 3.4, 0.7));

  Skeleton.mirrorPose(r.main, Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1);

  const got = new THREE.Vector3().setFromMatrixPosition(dstPin._m);
  check('a pinned twin takes the reflection of the SOURCE anchor', got.distanceTo(want) < 1e-6,
    'landed ' + got.toArray().map((v) => v.toFixed(2)).join(',') +
    ' — snapping the pin onto the joint loses an anchor the joint falls short of');
  const srcNow = new THREE.Vector3().setFromMatrixPosition(srcPin._m);
  check('and the source anchor is left alone',
    srcNow.distanceTo(new THREE.Vector3(-2.2, 3.4, 0.7)) < 1e-9);
}

// Full Mirror Pose swaps both side controls and reflects an unpaired hip/root pin in place.
// This is the pin-only animation contract: IK owns the bones and rebuilds them afterwards.
{
  const r = pinnable(rig());
  const leftAt = new THREE.Vector3(-2.2, 3.4, 0.7);
  const rightAt = new THREE.Vector3(1.1, 2.0, -0.3);
  const hipAt = new THREE.Vector3(-0.35, 2.7, 0.25);
  const lp = pinAt(r, r.L.hd, leftAt.toArray(), 1);
  const rp = pinAt(r, r.R.hd, rightAt.toArray(), 2);
  const hp = pinAt(r, r.chest, hipAt.toArray(), 2);

  Skeleton.mirrorPose(r.main, 0, new Set());

  const at = (p) => new THREE.Vector3().setFromMatrixPosition(p._m);
  check('full pin mirror sends left to reflected right', at(lp).distanceTo(reflect(rightAt)) < 1e-6);
  check('full pin mirror sends right to reflected left', at(rp).distanceTo(reflect(leftAt)) < 1e-6);
  check('full pin mirror reflects the hip/root pin in place', at(hp).distanceTo(reflect(hipAt)) < 1e-6);
  check('full pin mirror swaps side pin modes',
    r.L.hd._boneIKPin === 2 && r.R.hd._boneIKPin === 1,
    r.L.hd._boneIKPin + '/' + r.R.hd._boneIKPin);
}

// Source pinned, twin not: the twin has to GAIN one, or the mirrored leg is not held at all.
{
  const r = pinnable(rig());
  pinAt(r, r.L.hd, [-2.2, 3.4, 0.7], 2);   // a 6DOF pin, so the mode has to carry too
  const res = Skeleton.mirrorPose(r.main, Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1);

  check('an unpinned twin gains a pin', !!r.R.hd._boneIKPinObj);
  check('and the new pin is handed back for the caller to add and to undo',
    res.added.length === 1 && res.added[0] === r.R.hd._boneIKPinObj, 'added ' + res.added.length);
  check('and it carries the source pin MODE, not a default',
    r.R.hd._boneIKPin === 2 && r.R.hd._boneIKPinObj._pinMode === 2, r.R.hd._boneIKPin);
  if (r.R.hd._boneIKPinObj) {
    const got = new THREE.Vector3().setFromMatrixPosition(r.R.hd._boneIKPinObj._m);
    check('and it lands on the reflected anchor',
      got.distanceTo(reflect(new THREE.Vector3(-2.2, 3.4, 0.7))) < 1e-6);
  }
}

// A pin remains a control in a sparse animated pose, but its attached bone does not become
// one. Mirror the anchor while leaving the evaluated limb for IK to reconstruct.
{
  const r = pinnable(rig());
  const srcPin = pinAt(r, r.L.hd, [-2.2, 3.4, 0.7]);
  const leftBefore = Array.from(r.L.hd.getMatrix());
  const res = Skeleton.mirrorPose(r.main,
    Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1, new Set([r.chest]));
  const dstPin = r.R.hd._boneIKPinObj;
  check('a static pin mirrors even when its bone has no animation track',
    !!dstPin && pos(dstPin).distanceTo(reflect(pos(srcPin))) < 1e-6);
  let boneDelta = 0;
  for (let k = 0; k < 16; k++) boneDelta = Math.max(boneDelta,
    Math.abs(r.L.hd.getMatrix()[k] - leftBefore[k]));
  check('mirroring that pin does not bake its solver-owned bone', boneDelta < 1e-9);
  check('the sparse result reports only the authored trunk bone',
    res.controls.length === 1 && res.controls[0] === r.chest, res.controls.length);
}

// Twin pinned, source not: that pin has to GO. The pose being copied does not have one, and
// leaving it behind holds the mirrored limb somewhere the original was never held.
{
  const r = pinnable(rig());
  const stale = pinAt(r, r.R.hd, [1.1, 2.0, -0.3]);
  const res = Skeleton.mirrorPose(r.main, Skeleton.planeDistance(pos(r.L.sh), PLANE) > 0 ? 1 : -1);
  check('a twin pinned where the source is not loses its pin', !r.R.hd._boneIKPinObj);
  check('and it is handed back to be removed from the scene and undone',
    res.removed.length === 1 && res.removed[0] === stale, 'removed ' + res.removed.length);
  check('and the joint no longer claims a pin mode', !r.R.hd._boneIKPin);
}

// --- 6. symmetry off is a refusal with a reason, not a silent no-op -------------------
{
  const r = rig();
  r.main.getSculptManager = () => ({ getSymmetry: () => false });
  const res = Skeleton.mirrorPose(r.main, 1);
  check('symmetry off refuses and says why', !res.ok && /symmetry/i.test(res.why), res.why);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
