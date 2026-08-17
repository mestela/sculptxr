import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';

// [Rigging POC#2 — FBIK] Full-body IK over the joint tree, with stop-motion pinning.
//
// The model is Nichimen Mirai's: you PIN the parts that should stay where they are and drag
// anything else, and the whole skeleton rearranges itself around the pins. A pin is not a
// separate kind of object — it is an effector whose target is "exactly where you already
// are", which is why one solver handles both the thing being dragged and the things being
// held still.
//
// SOLVER = FABRIK on a tree (Aristidou & Lasenby 2011). Position-based: no Jacobian, no
// matrix inverse, no linear algebra library, and bone lengths are preserved by construction
// rather than by a penalty term. Each iteration is a backward sweep (leaf anchors toward the
// root, subbases averaging the proposals of their branches) and a forward sweep (root
// outward, re-imposing every bone length).
//
// TWO STRUCTURAL COMMITMENTS, both about what the solver is allowed to write:
//
//  1. THE SOLVER PRODUCES POSITIONS; THE RIG STORES ROTATIONS. The solved positions are
//     never written to the joints. They are converted into a per-joint ROTATION that best
//     explains them, and only the rotation is stored (same rule Pose mode follows). So
//     posing physically cannot rewrite the rig's proportions, no matter how the solver
//     misbehaves or how hard you pull at an unreachable target. Every bone length is exactly
//     what it was, because nothing that could change one is ever written.
//
//  2. THE ROOT IS THE ONE EXCEPTION, and only when something else is pinned. Rotations alone
//     cannot translate a skeleton, so "pin the feet and pull the hips down into a crouch"
//     needs the root to move. With NO pins the root is held fixed instead — otherwise the
//     first drag on a fresh rig flings the whole character across the room after your hand,
//     which is true FBIK and a terrible default.
//
// Joint limits are deliberately absent for now (see the ranking in the rigging notes): the
// solver is worth feeling before deciding which constraint is worth building.

// Sweeps per solve. A simple reach converges in two or three and exits early on the tolerance
// check below; the number is set for the worst case that actually occurs — an INTERIOR anchor
// (a pinned hand with the elbow being dragged) near full extension, where the two ends of the
// chain negotiate slowly. 12 left a visible few-millimetre drift there, 40 does not. It costs
// nothing: a sweep is a few arithmetic ops per active joint, on a rig with tens of joints.
const MAX_ITERATIONS = 40;
// Convergence is measured against the scene unit, so the tolerance means the same thing on a
// 2cm sculpt and a 200-unit one.
const TOL_FRAC = 1e-4;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _vDir = new THREE.Vector3();
const _dCur = new THREE.Vector3(), _dTgt = new THREE.Vector3();
const _qFit = new THREE.Quaternion(), _qStep = new THREE.Quaternion();
const _qRigid = new THREE.Quaternion();
const _qPart = new THREE.Quaternion(), _qId = new THREE.Quaternion();
const _qParent = new THREE.Quaternion(), _qJoint = new THREE.Quaternion();
const _qNow = new THREE.Quaternion();
const _mTmp = new THREE.Matrix4(), _mLocal = new THREE.Matrix4();
const _vTmp = new THREE.Vector3(), _sTmp = new THREE.Vector3();

const IKSolver = {};

// Pins live on the joint itself, so they survive selection changes, undo of unrelated work,
// and the save file (packed into two spare bits of the SKEL hierarchy flags).
//
// THREE STATES, not two. A pin that holds POSITION lets the limb above it swivel — right for
// a hand resting on a surface, wrong for a foot on the ground, which should stay flat as well
// as stay put. Holding orientation as well is the difference between a pose that stands and
// one that skates, and it is the same mechanism as the driven orientation on the joint in
// your hand: an absolute orientation the solve has to work around.
IKSolver.PIN_NONE = 0;
IKSolver.PIN_POS = 1;   // 3DOF: position held, free to rotate
IKSolver.PIN_FULL = 2;  // 6DOF: position and orientation both held

// Older builds stored a boolean here; `true | 0` is 1, which is exactly the 3DOF pin.
IKSolver.pinMode = function (joint) { return joint ? ((joint._boneIKPin | 0) & 3) : 0; };
IKSolver.isPinned = function (joint) { return IKSolver.pinMode(joint) > 0; };

IKSolver.setPin = function (joint, mode) {
  if (joint) joint._boneIKPin = (mode | 0) & 3;
};

// none -> position -> position+rotation -> none. A cycle rather than two buttons: pinning is
// done by pointing at a joint and pressing one thing, and the marker says which state it is in.
IKSolver.cyclePin = function (joint) {
  const next = (IKSolver.pinMode(joint) + 1) % 3;
  IKSolver.setPin(joint, next);
  return next;
};

IKSolver.setPinned = function (joint, on) {
  IKSolver.setPin(joint, on ? IKSolver.PIN_POS : IKSolver.PIN_NONE);
};

IKSolver.pinnedJoints = function (main) {
  return Skeleton.joints(main).filter(IKSolver.isPinned);
};

// Pin states of every pinned joint, so an undo can put back WHICH KIND of pin each one was.
IKSolver.capturePins = function (main) {
  return IKSolver.pinnedJoints(main).map((j) => [j, IKSolver.pinMode(j)]);
};

IKSolver.restorePins = function (main, snapshot) {
  IKSolver.clearPins(main);
  for (const [j, mode] of snapshot) IKSolver.setPin(j, mode);
};

IKSolver.clearPins = function (main) {
  const had = IKSolver.pinnedJoints(main);
  for (const j of had) j._boneIKPin = 0;
  return had.length;
};

// ---- graph ---------------------------------------------------------------------

// Build the solver's view of the skeleton: every joint as a node with its model-space
// position, its parent/child links, and the length of the bone above it. Rebuilt per solve —
// it is a handful of nodes, and a cached graph that disagreed with the rig after an undo or a
// tweak would be a far more expensive bug than the allocation it saves.
function buildGraph(main) {
  const joints = Skeleton.joints(main);
  const nodes = new Map();
  for (const j of joints) {
    nodes.set(j.getID(), {
      joint: j,
      parent: null,
      children: [],
      pos: Skeleton.jointPos(j),
      off: new THREE.Vector3(), // offset from the parent BEFORE the solve, in model space
      len: 0,
      depth: 0,
      active: false,
      orient: null, // driven model-space orientation (the joint in your hand), if any
      rot: null,    // ...and the rotation from its pre-solve orientation to that one
    });
  }
  for (const n of nodes.values()) {
    const p = n.joint._parentMesh;
    const pn = Skeleton.isJoint(p) ? nodes.get(p.getID()) : null;
    if (!pn) continue;
    n.parent = pn;
    pn.children.push(n);
    n.off.subVectors(n.pos, pn.pos);
    n.len = n.off.length();
  }
  for (const n of nodes.values()) {
    let d = 0;
    for (let c = n.parent; c; c = c.parent) d++;
    n.depth = d;
  }
  return nodes;
}

function rootOf(node) {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

// The joints the solve is allowed to touch: everything on a path from an anchor up to the
// root. A joint off those paths is not solved at all — it simply rides its parent through
// the scene graph, which is both cheaper and more predictable than letting the solver nudge
// parts of the rig nobody asked it to move.
function markActive(anchors) {
  for (const a of anchors) {
    for (let n = a; n; n = n.parent) {
      if (n.active) break; // this path already joins one that was walked
      n.active = true;
    }
  }
}

function activeChildren(n) {
  const out = [];
  for (const c of n.children) if (c.active) out.push(c);
  return out;
}

// Move `to` onto the sphere of radius `len` around `from`, along the direction it already
// lies in. This is the whole of FABRIK: one length constraint, applied over and over.
// `out` may alias `to` (that is the common case), so the direction is held in a scratch of
// its own — writing `out` first would otherwise destroy the direction before it is used.
function towards(out, from, to, len) {
  _vDir.subVectors(to, from);
  const d = _vDir.length();
  if (d < 1e-12) {
    // Degenerate (a joint sitting exactly on its parent): any direction is as good as any
    // other, so keep the bone pointing where it pointed rather than inventing a new axis.
    _vDir.set(0, 1, 0);
  } else {
    _vDir.divideScalar(d);
  }
  return out.copy(from).addScaledVector(_vDir, len);
}

// Rotation that best carries each vector in `from` onto its partner in `to`.
//
// With one pair it is the exact minimal rotation. With several there is generally no rotation
// that satisfies all of them, so the residuals are averaged by repeated partial slerps — a
// cheap stand-in for a Kabsch fit that settles in three passes on the two or three children a
// real rig ever hangs off one joint. Only directions matter; lengths are handled elsewhere.
function alignVectors(from, to, n, out) {
  out.identity();
  if (!n) return out;
  const passes = n > 1 ? 3 : 1;
  const share = 1 / n;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      if (from[i].lengthSq() < 1e-18 || to[i].lengthSq() < 1e-18) continue;
      _dCur.copy(from[i]).normalize().applyQuaternion(out); // where it sits under the fit so far
      _dTgt.copy(to[i]).normalize();
      _qStep.setFromUnitVectors(_dCur, _dTgt);
      _qPart.copy(_qId).slerp(_qStep, share);
      out.premultiply(_qPart);
    }
  }
  return out;
}

// Reused scratch for the vector pairs handed to alignVectors — a joint has a handful of
// children, and this runs per joint per iteration.
const _fromBuf = [], _toBuf = [];
function scratchPair(i) {
  if (!_fromBuf[i]) { _fromBuf[i] = new THREE.Vector3(); _toBuf[i] = new THREE.Vector3(); }
  return i;
}

// ---- solve ---------------------------------------------------------------------

// Run FABRIK over the tree. `targets` maps node -> desired model-space position (the dragged
// joint and every pin). Returns the solved positions on the nodes themselves.
function fabrik(nodes, targets, root, rootFixed, tol) {
  const active = [];
  for (const n of nodes.values()) if (n.active) active.push(n);
  const byDepth = active.slice().sort((a, b) => a.depth - b.depth);
  const rootPos0 = root.pos.clone();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // BACKWARD: leaves toward the root. An anchor is hard — it takes its target outright and
    // does not average with what its branches would prefer, which is what makes a pin a pin
    // rather than a suggestion.
    for (let i = byDepth.length - 1; i >= 0; i--) {
      const n = byDepth[i];
      const t = targets.get(n);
      if (t) { n.pos.copy(t); continue; }
      const kids = activeChildren(n);
      if (!kids.length) continue;
      // A subbase (a joint where several solved branches meet) takes the centroid of what
      // each branch asks of it. Averaging is what lets two arms and a spine disagree and
      // still converge on one shoulder position.
      _v2.set(0, 0, 0);
      for (const c of kids) {
        towards(_v, c.pos, n.pos, c.len);
        _v2.add(_v);
      }
      n.pos.copy(_v2.divideScalar(kids.length));
    }

    // FORWARD: root outward, re-imposing every bone length. This is the pass that can pull an
    // anchor off its target — which is exactly right, because an unreachable pin should fail
    // by falling short, not by stretching a bone.
    if (rootFixed) root.pos.copy(rootPos0);
    for (const n of byDepth) {
      const kids = activeChildren(n);

      // A joint whose ORIENTATION is being driven (the joint in your hand, when you twist it
      // as well as move it) has no freedom left here: its children's directions follow from
      // that orientation, not from the solve. So they are placed through it outright — even a
      // single child, whose direction would otherwise be free. This is what makes "hold the
      // hips and turn them" swing the legs and spine instead of doing nothing.
      if (n.rot && kids.length) {
        for (const c of kids) c.pos.copy(n.pos).add(_v2.copy(c.off).applyQuaternion(n.rot));
        continue;
      }

      if (kids.length === 1) {
        // One child: the joint may rotate freely, so the only constraint is the bone length.
        towards(kids[0].pos, n.pos, kids[0].pos, kids[0].len);
        continue;
      }
      if (!kids.length) continue;

      // SEVERAL CHILDREN — place them RIGIDLY, not one bone at a time.
      //
      // Plain FABRIK treats every bone as an independent link, so two bones off the same
      // joint are free to change their angle to each other. A real hierarchy does not allow
      // that: both are carried by ONE joint rotation, and their relative geometry is fixed.
      // Left independent, the solver produces positions that no single joint rotation can
      // reproduce, and the rotation-fitting stage then quietly discards the difference —
      // which showed up as pinned joints drifting off their pins even after the solver had
      // fully converged. So the children of a subbase are moved as one rigid cluster: find
      // the rotation that best explains where the solve wants them, then place all of them
      // through it. Bone lengths and inter-bone angles are then both exact by construction,
      // and what the fitting stage writes is exactly what the solver computed.
      let k = 0;
      for (const c of kids) {
        scratchPair(k);
        _fromBuf[k].copy(c.off);
        _toBuf[k].subVectors(c.pos, n.pos);
        k++;
      }
      alignVectors(_fromBuf, _toBuf, k, _qRigid);
      k = 0;
      for (const c of kids) {
        c.pos.copy(n.pos).add(_v2.copy(c.off).applyQuaternion(_qRigid));
        k++;
      }
    }

    let worst = 0;
    for (const [n, t] of targets) worst = Math.max(worst, n.pos.distanceTo(t));
    if (worst < tol) break;
  }
}

// ---- writing the result back ---------------------------------------------------

// Model-space rotation that carries this joint's CURRENT child directions onto the solved
// ones. Because the forward pass placed multi-child joints rigidly, such a rotation really
// exists — this stage recovers it rather than approximating it away.
function fitRotation(node, kids, out) {
  Skeleton.jointPos(node.joint, _v2); // where the joint actually is, after its parents moved
  let k = 0;
  for (const c of kids) {
    scratchPair(k);
    _fromBuf[k].copy(Skeleton.jointPos(c.joint, _v)).sub(_v2);
    _toBuf[k].copy(c.pos).sub(_v2);
    k++;
  }
  return alignVectors(_fromBuf, _toBuf, k, out);
}

// A joint's orientation in model space.
function modelQuat(joint, out) {
  _mTmp.fromArray(joint.getModelSpaceMatrix());
  _mTmp.decompose(_vTmp, out, _sTmp);
  return out;
}

// Apply a MODEL-space rotation to a joint, about its own origin.
//
// The delta has to be carried into the joint's PARENT space first. A rotation applied to a
// joint deep in an already-posed chain is otherwise measured against the wrong frame and
// skews as the chain moves — the same trap Pose mode documents.
function rotateJoint(joint, qModel) {
  const parent = joint._parentMesh;
  _qStep.copy(qModel);
  if (parent && parent.getModelSpaceMatrix) {
    _mTmp.fromArray(parent.getModelSpaceMatrix());
    _mTmp.decompose(_vTmp, _qParent, _sTmp);
    _qStep.premultiply(_qParent.clone().invert()).multiply(_qParent);
  }
  _mLocal.fromArray(joint.getMatrix());
  _mLocal.decompose(_vTmp, _qJoint, _sTmp);
  _qJoint.premultiply(_qStep);
  _mLocal.compose(_vTmp, _qJoint, _sTmp);
  mat4.copy(joint.getMatrix(), _mLocal.elements);
  Skeleton.syncThree(joint);
}

// Turn solved positions into joint transforms, top-down. Order matters: a joint's fit is
// measured from where it ACTUALLY is, so every ancestor must already have been written.
function applyRotations(main, nodes, root, rootFixed) {
  if (!rootFixed) {
    // The one translation the solver is allowed. `false` = do not compensate the children:
    // they are supposed to travel with the root, that is what moving a root means.
    Skeleton.jointPos(root.joint, _v);
    if (_v.distanceToSquared(root.pos) > 1e-18) {
      Skeleton.moveJoint(main, root.joint, root.pos, false);
    }
  }

  const byDepth = [];
  for (const n of nodes.values()) if (n.active) byDepth.push(n);
  byDepth.sort((a, b) => a.depth - b.depth);

  const touched = [];
  for (const n of byDepth) {
    if (n.orient) {
      // A driven orientation is ABSOLUTE, so it is written as a correction from wherever the
      // joint has ended up to where it should be. Computing the correction here rather than
      // reusing the one from before the solve is what keeps it exact when an ancestor has
      // rotated in the meantime — and it means a LEAF effector gets a rotation too, which a
      // fit could never give it (nothing hangs off a hand to fit against).
      modelQuat(n.joint, _qNow);
      _qFit.copy(n.orient).multiply(_qNow.invert());
      rotateJoint(n.joint, _qFit);
      touched.push(n);
      continue;
    }
    const kids = activeChildren(n);
    if (!kids.length) continue; // a leaf's own rotation is not determined by any position
    fitRotation(n, kids, _qFit);
    rotateJoint(n.joint, _qFit);
    touched.push(n);
  }
  return touched;
}

// ---- entry point ---------------------------------------------------------------

// Drag `effector` to `target` (model space) with every pinned joint held where it currently
// is. Returns true when a solve actually ran.
//
// `pins` defaults to whatever is pinned on the rig; pass an explicit list for a transient
// pin (a joint held in the other hand) without touching the persistent state.
//
// `orientation` (optional) is the effector's desired MODEL-space orientation — the joint in
// your hand turning as well as travelling. It is a constraint on the solve, not a decoration
// applied afterwards: the joint's children are carried by it, so turning the hips swings the
// legs and spine, and the pinned feet then have to be re-solved against where they landed.
IKSolver.solve = function (main, effector, target, pins, orientation) {
  if (!effector || !target) return false;
  const nodes = buildGraph(main);
  const eff = nodes.get(effector.getID());
  if (!eff) return false;

  if (orientation) {
    eff.orient = orientation.clone();
    // The rotation that carries the joint's CURRENT offsets to where the driven orientation
    // wants them. Both halves are pre-solve, and the graph is rebuilt every frame, so this
    // never accumulates drift the way a per-frame delta would.
    eff.rot = orientation.clone().multiply(modelQuat(effector, _qNow).invert());
  }

  const root = rootOf(eff);
  const targets = new Map();
  // The dragged joint wins over its own pin: grabbing a pinned joint is an unambiguous
  // statement that you want it somewhere else, and refusing to move would read as a bug.
  targets.set(eff, target.clone());

  const pinList = pins || IKSolver.pinnedJoints(main);
  for (const j of pinList) {
    const n = nodes.get(j.getID());
    if (!n || n === eff) continue;
    if (rootOf(n) !== root) continue; // a pin on a different skeleton is not our business
    targets.set(n, n.pos.clone()); // "stay exactly where you are"

    // A 6DOF pin also holds its ORIENTATION, through the same machinery as the driven
    // effector. The target is simply the orientation it has right now: the graph is rebuilt
    // each frame and the write-back lands on that value exactly, so the joint is its own
    // fixed point and cannot ratchet round over a long drag. `rot` is identity for the same
    // reason — relative to where it already is, a held orientation asks for no change, which
    // is precisely what keeps its children rigid with it while the chain above swings.
    if (IKSolver.pinMode(j) === IKSolver.PIN_FULL) {
      n.orient = modelQuat(j, _qNow).clone();
      n.rot = new THREE.Quaternion();
    }
  }

  markActive(targets.keys());
  // With nothing else pinned the root is the anchor, or the whole character would follow
  // your hand on the very first drag.
  const rootFixed = targets.size <= 1;

  fabrik(nodes, targets, root, rootFixed, Skeleton.sceneUnit(main) * TOL_FRAC);
  const touched = applyRotations(main, nodes, root, rootFixed);
  return touched.length > 0 || !rootFixed;
};

// Every joint's local matrix, for undo. A solve can reach anywhere in the tree (that is the
// point of full-body IK), so the honest snapshot is all of them; it is one 16-float matrix
// per joint, which is nothing next to the vertex snapshots the sculpt tools push.
IKSolver.captureAll = function (main) {
  return Skeleton.joints(main).map((j) => [j, mat4.clone(j.getMatrix())]);
};

export default IKSolver;
