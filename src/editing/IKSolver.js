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
const _vReach = new THREE.Vector3();
const _vRestA = new THREE.Vector3(), _vRestB = new THREE.Vector3();
const _vNowA = new THREE.Vector3(), _vNowB = new THREE.Vector3();
const _vNormRest = new THREE.Vector3(), _vNormNow = new THREE.Vector3();
const _vAxis = new THREE.Vector3(), _vRel = new THREE.Vector3();
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

// A pin is a WORLD-SPACE anchor, captured once when the pin goes on and held there until it
// comes off. It is emphatically NOT "wherever this joint happens to be this frame": reading
// the joint's live position each solve made the pin follow the foot whenever the solve could
// not satisfy it. Lift the hips until the legs over-extend, the feet fall short of the pin,
// and the next frame adopts that shortfall as the new pin — so the pins climbed with the
// character instead of holding the ground. Nothing looked wrong on the way DOWN, where the
// legs have slack and the solve lands on the pin exactly, so re-reading it changed nothing.
//
// Held as a fixed point, an unreachable pin fails honestly: the foot aims at it and falls
// short, and snaps back onto it exactly as soon as the chain can reach again. That is what
// lets a character jump.
IKSolver.setPin = function (joint, mode) {
  if (!joint) return;
  const was = IKSolver.pinMode(joint);
  const now = (mode | 0) & 3;
  joint._boneIKPin = now;
  if (!now) { joint._boneIKPinAt = null; joint._boneIKPinQ = null; return; }
  // Only anchor on the way IN. Cycling 3DOF -> 6DOF must not re-anchor: if the joint has
  // drifted off an unreachable pin, re-reading it there would quietly move the pin to the
  // wrong place at the very moment the user asked for a STRONGER hold.
  if (!was || !joint._boneIKPinAt) {
    joint._boneIKPinAt = Skeleton.jointPos(joint, new THREE.Vector3()).toArray();
  }
  if (now === IKSolver.PIN_FULL && !joint._boneIKPinQ) {
    joint._boneIKPinQ = modelQuat(joint, new THREE.Quaternion()).toArray();
  }
};

// The anchor this joint is pinned to, in model space. Falls back to where the joint is now —
// which is what a rig loaded from a save file has, since the anchor is not persisted; the
// saved pose IS the pinned pose, so adopting it on first use is the right reading.
IKSolver.pinAnchor = function (joint, out) {
  out = out || new THREE.Vector3();
  if (!joint._boneIKPinAt) {
    joint._boneIKPinAt = Skeleton.jointPos(joint, new THREE.Vector3()).toArray();
  }
  return out.fromArray(joint._boneIKPinAt);
};

IKSolver.pinAnchorQuat = function (joint, out) {
  out = out || new THREE.Quaternion();
  if (!joint._boneIKPinQ) joint._boneIKPinQ = modelQuat(joint, new THREE.Quaternion()).toArray();
  return out.fromArray(joint._boneIKPinQ);
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
// ...including WHERE each was anchored. Restoring the mode alone would re-anchor every pin
// to wherever the rig happens to be sitting at undo time, which is the one moment it is least
// likely to be the place the pin was originally put.
IKSolver.capturePins = function (main) {
  return IKSolver.pinnedJoints(main).map((j) => [
    j, IKSolver.pinMode(j),
    j._boneIKPinAt ? j._boneIKPinAt.slice() : null,
    j._boneIKPinQ ? j._boneIKPinQ.slice() : null,
  ]);
};

IKSolver.restorePins = function (main, snapshot) {
  IKSolver.clearPins(main);
  for (const [j, mode, at, q] of snapshot) {
    IKSolver.setPin(j, mode);
    if (at) j._boneIKPinAt = at.slice();
    if (q) j._boneIKPinQ = q.slice();
  }
};

// Forget every remembered bend, so the next solve re-reads it from the rest pose. Called
// after the REST SKELETON is edited (Tweak mode) — moving a knee is how you change which way
// it should bend, and a preference captured before that edit would fight the new pose.
IKSolver.clearBendRefs = function (main) {
  for (const j of Skeleton.joints(main)) j._boneBendRef = null;
};

IKSolver.clearPins = function (main) {
  const had = IKSolver.pinnedJoints(main);
  for (const j of had) { j._boneIKPin = 0; j._boneIKPinAt = null; j._boneIKPinQ = null; }
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

// ---- reachability -------------------------------------------------------------
//
// The bone lengths along the path between two joints, through their common ancestor. Used to
// ask "how far apart CAN these two be?", which is the question a pin and a dragged joint are
// really arguing about.
function pathLengths(a, b) {
  const up = new Map();
  for (let n = a, d = 0; n; n = n.parent, d++) up.set(n, d);
  let common = null;
  for (let n = b; n; n = n.parent) if (up.has(n)) { common = n; break; }
  if (!common) return null;
  const lens = [];
  for (let n = a; n !== common; n = n.parent) lens.push(n.len);
  for (let n = b; n !== common; n = n.parent) lens.push(n.len);
  return lens;
}

// A chain of fixed-length bones can span anything from `min` to `max` apart, and nothing
// outside that. `max` is the obvious sum; `min` is what is left when the longest bone is
// folded back against all the others — for a SINGLE bone the two coincide, which is exactly
// the knee-and-planted-foot case.
function reachSpan(lens) {
  let sum = 0, longest = 0;
  for (const l of lens) { sum += l; if (l > longest) longest = l; }
  return { min: Math.max(0, longest * 2 - sum), max: sum };
}

// Pull `target` into the shell every pinned joint can actually reach.
//
// Dragging the KNEE with the foot pinned is the case that made this necessary: the knee and
// the foot are one rigid bone apart, so the knee can only ever sit on a sphere around the
// planted foot. Ask for anything off that sphere and the two constraints are not merely hard
// to satisfy, they are contradictory — and FABRIK resolves a contradiction by splitting the
// difference, which is why the foot slid off its pin. Clamping the DRAG instead keeps the pin
// exact and lets the knee swing around the planted foot, which is what the gesture means.
//
// Iterated, because with several pins the shells intersect and one clamp can push the target
// out of another's range. A few passes is enough for the cases a skeleton produces; it is a
// projection onto an intersection of shells, not an exact solve.
function clampToPins(eff, target, pinNodes) {
  if (!pinNodes.length) return;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const { node, anchor } of pinNodes) {
      const lens = pathLengths(eff, node);
      // ONE bone only. A single bone between the drag and a pin is a rigid identity — the
      // knee can be nowhere but on a sphere around the planted foot — so any violation is
      // pure contradiction and splitting the difference is unambiguously wrong.
      //
      // A longer path is a different situation: it has slack, and running out of it is
      // MEANINGFUL. Pulling the hips up until the legs straighten and the feet leave the
      // ground is a jump, and clamping there would pin the character to the floor for ever.
      // Falling short is the right failure for a limb; it is not a failure at all for a bone.
      if (!lens || lens.length !== 1) continue;
      const span = reachSpan(lens);
      _vReach.subVectors(target, anchor);
      const d = _vReach.length();
      if (d > span.max + 1e-9) {
        target.copy(anchor).addScaledVector(_vReach.divideScalar(d), span.max);
        moved = true;
      } else if (d < span.min - 1e-9) {
        // Inside the fold-back limit. At d ~ 0 there is no direction to push out along, so
        // any is as good as any other; keep the one the chain already has.
        if (d < 1e-9) _vReach.subVectors(node.pos, anchor).normalize();
        else _vReach.divideScalar(d);
        if (_vReach.lengthSq() < 1e-12) _vReach.set(0, 1, 0);
        target.copy(anchor).addScaledVector(_vReach, span.min);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// ---- preferred bend -------------------------------------------------------------
//
// A leg drawn with a slight bend in it IS the statement of which way the knee goes. FABRIK
// has no opinion — a knee bent backwards satisfies every bone length just as well as one
// bent forwards — so the solve is free to flip it, and that flip is the visible pop when
// dragging a limb around.
//
// So: read the bend the rig was drawn with, and refuse to invert it. For a joint with one
// parent and one child, the sign of cross(bone in, bone out) says which side the joint bends
// to. If the solve has changed that sign, reflect the joint back across the line joining its
// neighbours — a reflection, because it puts the joint on the correct side while leaving
// BOTH bone lengths exactly as they were.
//
// A joint drawn dead straight has no bend to preserve and is left alone, which is precisely
// why drawing the small bend in the first place is the thing that makes this work.
function fixBendDirection(byDepth, targets) {
  for (const n of byDepth) {
    if (targets.has(n) || !n.parent) continue;
    const kids = activeChildren(n);
    if (kids.length !== 1) continue;
    // The parent must be a simple link too. Where several branches meet, the solver places
    // them as ONE rigid cluster on purpose — their relative geometry is carried by a single
    // joint rotation — and reflecting one of them alone produces a pose no such rotation can
    // reproduce. The rotation-fitting stage then quietly discards the difference, which comes
    // out as pinned joints sliding off their pins. Knees and elbows are serial links anyway;
    // that is what makes them the joints with a bend direction worth preserving.
    if (activeChildren(n.parent).length !== 1) continue;
    const c = kids[0];
    _vNowA.subVectors(n.pos, n.parent.pos);
    _vNowB.subVectors(c.pos, n.pos);
    _vNormNow.crossVectors(_vNowA, _vNowB);
    // A limb that is momentarily STRAIGHT has no bend to read and none to correct: the knee
    // sits on the line between its neighbours, where every side is equally valid. Nothing to
    // do this frame — but the preference must not be forgotten, which is the whole reason it
    // is remembered rather than re-read from the pose each time.
    const nowMag2 = _vNormNow.lengthSq();
    const scale2 = Math.max(_vNowA.lengthSq() * _vNowB.lengthSq(), 1e-24);
    if (nowMag2 / scale2 < 1e-6) continue;

    // The remembered preference, taken ONCE from the pose the limb was drawn in and never
    // refreshed from a solve. Refreshing it on every frame that looked correct was a bad
    // mistake: it is self-confirming, so the first frame a knee happened to solve backwards
    // became the remembered preference and was then enforced for ever. On a symmetric rig
    // that showed up as one knee aiming forward and the other back, permanently.
    //
    // The drawn rest pose is the authority precisely because it is a deliberate statement —
    // it is why putting a pronounced bend in the knees is the way to say which way they go.
    // Storing it also means a limb that STRAIGHTENS (a jump) does not forget: there is
    // nothing to read off a straight leg, and now nothing needs to be.
    let ref = n.joint._boneBendRef;
    if (!ref) {
      _vRestA.copy(n.off);
      _vRestB.copy(c.off);
      _vNormRest.crossVectors(_vRestA, _vRestB);
      if (_vNormRest.lengthSq() < 1e-12) continue; // drawn dead straight: no preference at all
      ref = n.joint._boneBendRef = _vNormRest.clone().normalize().toArray();
    }
    _vNormRest.fromArray(ref);
    if (_vNormNow.dot(_vNormRest) >= 0) continue; // still bending the way it was drawn

    // Reflect n across the line parent->child. Distances to both neighbours are unchanged,
    // so the chain stays valid and nothing downstream needs re-imposing.
    _vAxis.subVectors(c.pos, n.parent.pos);
    const axLen = _vAxis.length();
    if (axLen < 1e-12) continue; // neighbours coincident: no line to reflect across
    _vAxis.divideScalar(axLen);
    _vRel.subVectors(n.pos, n.parent.pos);         // parent -> joint
    const along = _vRel.dot(_vAxis);               // its component along the line
    _vRel.addScaledVector(_vAxis, -along);         // ...leaving the perpendicular component
    // Mirror the perpendicular part: parent + parallel - perpendicular.
    n.pos.copy(n.parent.pos).addScaledVector(_vAxis, along).sub(_vRel);
  }
}

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

  // Last, once the positions have settled: put back any joint the solve flipped. Done here
  // rather than inside the loop because a reflection mid-iteration is a discontinuity the
  // next sweep would simply undo, and because it changes nothing the targets depend on —
  // both of the joint's bone lengths survive it exactly.
  if (window._ikPreferredBend !== false) fixBendDirection(byDepth, targets);
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

  const pinTargets = [];
  const pinList = pins || IKSolver.pinnedJoints(main);
  for (const j of pinList) {
    const n = nodes.get(j.getID());
    if (!n || n === eff) continue;
    if (rootOf(n) !== root) continue; // a pin on a different skeleton is not our business
    // The anchor, not the joint's current position — see setPin. This is the whole
    // difference between a pin that holds the ground and one that rides the character up.
    const anchor = IKSolver.pinAnchor(j, new THREE.Vector3());
    targets.set(n, anchor);
    pinTargets.push({ node: n, anchor: anchor });

    // A 6DOF pin also holds its ORIENTATION, through the same machinery as the driven
    // effector. The target is simply the orientation it has right now: the graph is rebuilt
    // each frame and the write-back lands on that value exactly, so the joint is its own
    // fixed point and cannot ratchet round over a long drag. `rot` is identity for the same
    // reason — relative to where it already is, a held orientation asks for no change, which
    // is precisely what keeps its children rigid with it while the chain above swings.
    if (IKSolver.pinMode(j) === IKSolver.PIN_FULL) {
      // Anchored the same way and for the same reason: an orientation re-read each frame
      // ratchets round exactly as the position did. `rot` carries the joint's CURRENT
      // offsets to the held orientation, so its children stay rigid with it.
      n.orient = IKSolver.pinAnchorQuat(j, new THREE.Quaternion());
      n.rot = n.orient.clone().multiply(modelQuat(j, _qNow).invert());
    }
  }

  // Pins are statements; a drag is continuous input. When the two are geometrically
  // irreconcilable the drag is the one that gives — otherwise the pin slides and the thing
  // the user explicitly nailed down is the thing that moves.
  if (window._ikClampToPins !== false && pinTargets.length) {
    const t = targets.get(eff);
    clampToPins(eff, t, pinTargets);
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
