import { mat4 } from 'gl-matrix';
import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import Skinning from './Skinning.js';
import IKSolver from './IKSolver.js';
import { jointFrame, frameToMat4, restModelMatrices } from './JointFrame.js';
import { gizmoBasis } from './gizmoMath.js';

// ORIENT JOINTS: make each joint's ACTUAL rotation the frame JointFrame guesses from the chain
// (X down the bone, Z about the bend), instead of leaving it world-aligned.
//
// It is a RELABELLING of each joint's local axes, not a pose: every joint stays where it is, and
// everything that hangs off it stays where it is. That is what makes it safe, and it is also the
// whole of the bookkeeping. With R the rotation applied to a joint's local axes:
//
//   joint        local' = Rparent^-1 . local . Rjoint     (so  model' = model . Rjoint, in ANY pose)
//   other child  local' = Rjoint^-1 . local               (cages and the like: same world place)
//   its pin      model' = model . Rjoint                  (a held orientation stays the joint's own)
//   skin         invBind' = Rjoint^-1 . invBind           (J' . invBind' = J . invBind: no deformation)
//   rest         _ikRest gets the same treatment as the local matrix it mirrors
//
// The joint SHAPE (`_jointRot/_jointScale/_jointOffset`) is already a model-space rest property
// that says nothing about the joint's matrix, so it needs nothing.
//
// IDEMPOTENT: a joint already on its frame has R = identity and is not touched, so running this
// after every edit costs a comparison for each joint that did not change -- which is what lets
// Draw and Tweak simply call it, and have only the joints whose chain changed turn.
//
// REFUSED WHEN THE RIG IS KEYED. A keyframe is a joint-local (or, for a pin, absolute) value read
// against the axes the joint had when it was keyed; relabelling the axes under it would play the
// animation back wrong. The honest options are remapping every key or declining, and declining
// is the one that cannot corrupt a take.

const EPS = 1e-4;
const _I = mat4.create();

function isIdentityRot(m) {
  for (let i = 0; i < 16; i++) if (Math.abs(m[i] - _I[i]) > EPS) return false;
  return true;
}
const inv = (m) => mat4.invert(mat4.create(), m);
const mul = (a, b) => mat4.multiply(mat4.create(), a, b);
const live = (m) => !!(m && m.getThreeMesh && m.getThreeMesh() && m.getThreeMesh().parent);

function keyedMeshes(main, joints, extra) {
  const reg = window._animationRegistry;
  if (!reg || !reg.tracks || !reg.tracks.size) return [];
  const out = [];
  for (const m of joints.concat(extra)) if (m && reg.tracks.has(m.getID())) out.push(m);
  return out;
}

// What would change: a Map joint -> rotation (mat4), only for joints that are not already on
// their frame. Pure of side effects.
export function planOrientation(main) {
  const joints = Skeleton.joints(main).filter(Boolean);
  const set = new Set(joints);
  const restM = restModelMatrices(Skeleton, joints);
  const tree = {
    pos: (j) => { const m = restM.get(j); return [m[12], m[13], m[14]]; },
    parent: (j) => (j._parentMesh && set.has(j._parentMesh) ? j._parentMesh : null),
    children: (j) => joints.filter((c) => c._parentMesh === j),
  };
  const memo = new Map();
  const plan = new Map();
  for (const j of joints) {
    const f = jointFrame(tree, j, memo);
    if (!f) continue;
    const R = mul(inv(gizmoBasis(restM.get(j))), frameToMat4(f));
    if (!isIdentityRot(R)) plan.set(j, R);
  }
  return { joints, plan };
}

function snapshot(main, joints) {
  const mats = new Map();      // mesh -> mat4 (local)
  const rests = new Map();     // joint -> mat4 | null
  const binds = [];            // [{mesh, inv: [THREE.Matrix4]}]
  for (const j of joints) {
    mats.set(j, mat4.clone(j.getMatrix()));
    rests.set(j, j._ikRest ? mat4.clone(j._ikRest) : null);
    for (const c of main.getMeshes()) if (c._parentMesh === j && !Skeleton.isJoint(c)) mats.set(c, mat4.clone(c.getMatrix()));
    const pin = IKSolver.pinObject(j);
    if (pin) mats.set(pin, mat4.clone(pin.getMatrix()));
  }
  for (const m of main.getMeshes()) {
    if (Skinning.isBound(m) && m._skinInvBind) binds.push({ mesh: m, inv: m._skinInvBind.map((x) => x.clone()) });
  }
  return { mats, rests, binds };
}

function restore(main, snap) {
  main._rigRestEdit = true;
  for (const [m, mat] of snap.mats) { mat4.copy(m.getMatrix(), mat); Skeleton.syncThree(m); }
  for (const [j, r] of snap.rests) j._ikRest = r ? mat4.clone(r) : null;
  for (const b of snap.binds) { b.mesh._skinInvBind = b.inv.map((x) => x.clone()); b.mesh._skinDirty = true; }
  (main._worldGroup || main._scene)?.updateMatrixWorld?.(true);
  IKSolver.clearBendRefs(main);
  IKSolver.syncPinCache?.(main);
  IKSolver.syncJointCache?.(main);
  main._rigRestEdit = false;
  Skeleton.updateVisuals(main);
  main.render?.();
}

// Returns { ok, changed, reason }. `squash` joins the undo step to the one pushed just before it
// (a Draw or a Tweak), so one action is one undo.
export function orientJoints(main, { squash = false, name = 'Orient Joints' } = {}) {
  const { joints, plan } = planOrientation(main);
  if (!plan.size) return { ok: true, changed: 0 };

  const pins = joints.map((j) => IKSolver.pinObject(j)).filter(Boolean);
  const kids = [];
  for (const m of main.getMeshes()) if (m._parentMesh && Skeleton.isJoint(m._parentMesh) && !Skeleton.isJoint(m)) kids.push(m);
  const keyed = keyedMeshes(main, joints, pins.concat(kids));
  if (keyed.length) {
    return { ok: false, changed: 0,
      reason: 'the rig is keyed (' + keyed.length + ' animated node' + (keyed.length > 1 ? 's' : '') + '); orienting would change what the keys mean' };
  }

  const before = snapshot(main, joints);
  main._rigRestEdit = true;

  const Rof = (j) => plan.get(j) || null;
  const rotOf = (j) => Rof(j) || _I;

  // joints: local' = Rparent^-1 . local . Rjoint, for the live matrix and the rest it mirrors
  for (const j of joints) {
    const Rj = rotOf(j);
    const par = j._parentMesh && Skeleton.isJoint(j._parentMesh) ? j._parentMesh : null;
    const Rpi = par ? inv(rotOf(par)) : _I;
    mat4.copy(j.getMatrix(), mul(mul(Rpi, j.getMatrix()), Rj));
    if (j._ikRest) j._ikRest = mul(mul(Rpi, j._ikRest), Rj);
  }
  // everything else under an oriented joint keeps its place
  for (const c of kids) {
    const R = Rof(c._parentMesh);
    if (R) mat4.copy(c.getMatrix(), mul(inv(R), c.getMatrix()));
  }
  // pins: a held orientation is the joint's own, so it turns with it
  for (const j of joints) {
    const R = Rof(j), pin = IKSolver.pinObject(j);
    if (!R || !pin) continue;
    const model = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix(mat4.create()) : mat4.clone(pin.getMatrix());
    const next = mul(model, R);
    if (pin.setModelSpaceMatrix) pin.setModelSpaceMatrix(next); else mat4.copy(pin.getMatrix(), next);
  }
  // skin: J' = J . R, so the inverse bind takes R^-1 and nothing deforms
  for (const m of main.getMeshes()) {
    if (!Skinning.isBound(m) || !m._skinInvBind || !m._skinJoints) continue;
    m._skinJoints.forEach((id, a) => {
      const j = joints.find((x) => x.getID() === id);
      const R = j && Rof(j);
      if (!R) return;
      const Ri = new THREE.Matrix4().fromArray(inv(R));
      m._skinInvBind[a].premultiply(Ri);
    });
    m._skinDirty = true;
  }

  for (const j of joints) Skeleton.syncThree(j);
  for (const c of kids) Skeleton.syncThree(c);
  for (const p of pins) Skeleton.syncThree(p);
  (main._worldGroup || main._scene)?.updateMatrixWorld?.(true);
  IKSolver.clearBendRefs(main);
  IKSolver.syncPinCache?.(main);
  IKSolver.syncJointCache?.(main);
  main._rigRestEdit = false;
  Skeleton.updateVisuals(main);
  main.render?.();

  const after = snapshot(main, joints);
  main.getStateManager?.()?.pushStateCustom?.(
    () => restore(main, before), () => restore(main, after), squash, name);
  return { ok: true, changed: plan.size };
}

// What Draw and Tweak call: quiet, joined to the step they follow, and it never throws into the
// edit that triggered it. A refusal (keyed rig) is logged, not shown -- the edit itself worked.
export function autoOrient(main) {
  try {
    const r = orientJoints(main, { squash: true, name: 'Orient Joints' });
    if (!r.ok) console.log('[orient] skipped: ' + r.reason);
    return r;
  } catch (e) {
    console.error('[orient] failed', e);
    main._rigRestEdit = false;
    return { ok: false, changed: 0, reason: String(e && e.message || e) };
  }
}
