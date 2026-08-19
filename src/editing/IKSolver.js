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
const _vNormRest = new THREE.Vector3();
const _vHu = new THREE.Vector3(), _vHv = new THREE.Vector3(), _vHa = new THREE.Vector3();
const _vHd = new THREE.Vector3(), _vHdir = new THREE.Vector3(), _vHw = new THREE.Vector3();
const _vHx = new THREE.Vector3(), _vHy = new THREE.Vector3();
const _qHinge = new THREE.Quaternion();
const _qPart = new THREE.Quaternion(), _qId = new THREE.Quaternion();
const _qParent = new THREE.Quaternion(), _qJoint = new THREE.Quaternion();
const _qPInv = new THREE.Quaternion(), _qLocal = new THREE.Quaternion();
const _qNow = new THREE.Quaternion();
const _mTmp = new THREE.Matrix4(), _mLocal = new THREE.Matrix4();
const _sOne = new THREE.Vector3(1, 1, 1);

// How different two matrices must be to count as "something moved it".
//
// NOT an epsilon: matrices are Float32Array, and near values of 1 to 2 the spacing between
// representable float32s is about 1.2e-7 — so a threshold below that reports a move on every
// comparison, whether or not anything moved. A drag moves things by orders of magnitude more
// than this, so the bar is set well clear of the noise rather than as tight as possible.
const MOVE_EPS = 1e-5;
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
// ---- pins as objects -------------------------------------------------------------
//
// A pin is a NULL IN THE SCENE that a joint is constrained to, not two bits of state on the
// joint. The joint holds a direct reference — the same shape `_boneMirror` already uses, and
// serialised the same way, as an index — so reading a pin needs no scene lookup.
//
// The pin's transform IS the anchor. That is the whole point: it makes a pin a thing you can
// select, drag with the gizmo and KEY, and it makes a class of bug unrepresentable. The old
// code carried careful "only anchor on the way IN" logic because re-reading the joint's live
// position let pins ratchet upward with a jumping character; with the anchor living in an
// object's transform there is nothing to re-read.

IKSolver.pinObject = function (joint) {
  const p = joint && joint._boneIKPinObj;
  // A pin whose object has been deleted from the scene is no pin at all. Checked here rather
  // than hunted down at every call site, so a dangling reference degrades to "unpinned".
  return p && p._isPinTarget ? p : null;
};

IKSolver.setPin = function (joint, mode, main) {
  if (!joint) return null;
  const now = (mode | 0) & 3;
  let pin = IKSolver.pinObject(joint);

  if (!now) {
    joint._boneIKPinObj = null;
    joint._boneIKPin = 0;
    return pin; // handed back so the caller can remove it from the scene and undo that
  }

  if (!pin) {
    pin = IKSolver.makePinObject(main, joint);
    if (!pin) return null; // no scene to put it in
    joint._boneIKPinObj = pin;
  }
  // Cycling 3DOF -> 6DOF must NOT re-place the pin: if the joint has drifted off an
  // unreachable pin, moving it to the joint would shift the pin at the very moment the user
  // asked for a stronger hold.
  pin._pinMode = now;
  joint._boneIKPin = now; // kept in step for the save format and for older readers
  return pin;
};

// The null itself. Built through the scene's own addNull so it arrives pickable, selectable,
// serialisable and in the outliner — everything a pin needs in order to be transformable and
// keyable comes free from being an ordinary object.
// The null itself. Built by SKELETON rather than here: the file loader has to make one
// during a pre-v3 migration, and IKSolver already imports Skeleton — owning it here would
// close an import cycle. One implementation, so the loader's pins and the tool's pins
// cannot drift apart.
IKSolver.makePinObject = function (main, joint) {
  return Skeleton.makePin ? Skeleton.makePin(main, joint) : null;
};

IKSolver.pinMode = function (joint) {
  const p = IKSolver.pinObject(joint);
  return p ? ((p._pinMode | 0) & 3) : 0;
};
IKSolver.isPinned = function (joint) { return IKSolver.pinMode(joint) > 0; };

// The anchor this joint is pinned to, in model space: the pin object's own transform.
IKSolver.pinAnchor = function (joint, out) {
  out = out || new THREE.Vector3();
  const p = IKSolver.pinObject(joint);
  if (!p) return Skeleton.jointPos(joint, out);
  _mTmp.fromArray(p.getModelSpaceMatrix());
  return out.set(_mTmp.elements[12], _mTmp.elements[13], _mTmp.elements[14]);
};

IKSolver.pinAnchorQuat = function (joint, out) {
  out = out || new THREE.Quaternion();
  const p = IKSolver.pinObject(joint);
  if (!p) return modelQuat(joint, out);
  _mTmp.fromArray(p.getModelSpaceMatrix());
  _mTmp.decompose(_vTmp, out, _sTmp);
  return out;
};

// none -> position -> position+rotation -> none. A cycle rather than two buttons: pinning is
// done by pointing at a joint and pressing one thing, and the marker says which state it is in.
// Returns { mode, pin, removed } so the caller can put the object in or out of the scene.
IKSolver.cyclePin = function (joint, main) {
  const next = (IKSolver.pinMode(joint) + 1) % 3;
  const before = IKSolver.pinObject(joint);
  const pin = IKSolver.setPin(joint, next, main);
  return { mode: next, pin: next ? pin : null, removed: next ? null : before };
};

IKSolver.setPinned = function (joint, on, main) {
  return IKSolver.setPin(joint, on ? IKSolver.PIN_POS : IKSolver.PIN_NONE, main);
};

IKSolver.pinnedJoints = function (main) {
  return Skeleton.joints(main).filter(IKSolver.isPinned);
};

// Pin states of every pinned joint, so an undo can put back WHICH KIND of pin each one was and
// WHERE it stood. The pin object is captured by reference along with its matrix: restoring the
// mode alone would re-place every pin at wherever the rig happens to be sitting at undo time,
// which is the one moment it is least likely to be where the pin was put.
IKSolver.capturePins = function (main) {
  return IKSolver.pinnedJoints(main).map((j) => {
    const p = IKSolver.pinObject(j);
    return [j, IKSolver.pinMode(j), p, p ? mat4.clone(p.getMatrix()) : null];
  });
};

IKSolver.restorePins = function (main, snapshot) {
  for (const [j, mode, pin, m] of snapshot) {
    IKSolver.attachPin(j, pin, mode, m);
  }
};

IKSolver.attachPin = function (joint, pin, mode, m) {
  if (!pin) return;
  joint._boneIKPinObj = pin;
  joint._boneIKPin = mode;
  pin._isPinTarget = true;
  pin._pinMode = mode;
  pin._pinnedJoint = joint;
  if (m) mat4.copy(pin.getMatrix(), m);
};

// Forget every remembered bend, so the next solve re-reads it from the rest pose. Called
// after the REST SKELETON is edited (Tweak mode) — moving a knee is how you change which way
// it should bend, and a preference captured before that edit would fight the new pose.
IKSolver.clearBendRefs = function (main) {
  for (const j of Skeleton.joints(main)) j._boneBendRef = null;
};

// Unpin everything, handing back the pin objects so the caller can take them out of the scene.
IKSolver.clearPins = function (main) {
  const had = IKSolver.pinnedJoints(main);
  const objs = [];
  for (const j of had) {
    const p = IKSolver.pinObject(j);
    if (p) objs.push(p);
    j._boneIKPinObj = null;
    j._boneIKPin = 0;
  }
  return objs;
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
      hinge: false, // is this joint constrained to one degree of freedom this solve?
      axis: new THREE.Vector3(), // ...and its hinge axis, refreshed once per iteration
      hkid: null,   // the single child the hinge governs
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

// ---- hinge constraint -----------------------------------------------------------
//
// A knee, an elbow and a finger are ONE degree of freedom. FABRIK has no such opinion — a
// knee bent backwards satisfies every bone length just as well as one bent forwards — so the
// solve is free to flip it, and that flip is the visible pop when swinging a limb around.
//
// The previous attempt corrected this AFTER convergence, reflecting the joint back across the
// line joining its neighbours. That is structurally poppy: the correction is a discrete jump,
// so a limb passing through straight crosses the boundary and gets snapped back. Measured on a
// sweep that drags the ankle up past the hip, the snap moved the knee 2.06 units in a single
// frame against an input step of 0.015.
//
// So the constraint is applied INSIDE the sweeps instead (Aristidou & Lasenby's constrained
// FABRIK). A solve that is never allowed to cross the boundary has nothing to snap back from,
// and the joint simply stops at straight and comes back the way it went.
//
// THE AXIS COMES FROM THE POSE THE RIG WAS DRAWN IN — the pronounced bend already drawn by
// habit. cross(bone in, bone out) at rest IS the hinge axis, which is why drawing the bend is
// the thing that turns this on and a joint drawn dead straight is left completely free.

// How far round the hinge a joint may swing, measured as deviation from dead straight. Wide on
// purpose: phase one is about removing the branch flip, not about making a knee anatomical.
// Per-joint ranges want the chain classification that is deliberately deferred.
//
// THE FLOOR IS NOT ZERO, and that matters more than its size. A perfectly straight limb is a
// degenerate FIXED POINT of the sweeps: with all three joints collinear the backward pass
// proposes a collinear knee and the forward pass clamps it back to collinear, so a leg that
// once goes dead straight stays dead straight for ever, whatever the target. Dragging an ankle
// up through the hip and out the other side hit exactly that and left the leg stuck straight
// with a 2.0-unit reach error for the rest of the drag. A couple of degrees of residual bend
// keeps the configuration non-degenerate, and real knees do not lock flat either.
const HINGE_MIN = 2 * Math.PI / 180;
const HINGE_MAX = 160 * Math.PI / 180;

// The remembered rest geometry: [axis, bone in, bone out], all unit, all model space, read
// ONCE and never refreshed from a solve.
//
// Refreshing it per frame was a bad mistake the last time round: it is self-confirming, so the
// first frame a knee happened to solve backwards became the remembered preference and was then
// enforced for ever — one knee aiming forward and the other back on a symmetric rig. It also
// means a limb that STRAIGHTENS (a jump) does not forget, which is the case where there is
// nothing to read off the live pose at all.
//
// `0` is the sentinel for "looked, and this joint was drawn straight": distinct from unset, so
// a straight joint is not re-measured every solve, and `clearBendRefs` (null) still forces a
// genuine re-read after the rest skeleton is edited.
function hingeRest(n) {
  const j = n.joint;
  let r = j._boneBendRef;
  if (r === 0) return null;
  if (!r) {
    _vRestA.copy(n.off);       // parent -> joint, model space, before the solve
    _vRestB.copy(n.hkid.off);  // joint -> child
    _vNormRest.crossVectors(_vRestA, _vRestB);
    if (_vNormRest.lengthSq() < 1e-14 || _vRestA.lengthSq() < 1e-18 || _vRestB.lengthSq() < 1e-18) {
      j._boneBendRef = 0; // drawn dead straight: no plane to read, so no hinge and no opinion
      return null;
    }
    r = j._boneBendRef = [
      ..._vNormRest.normalize().toArray(),
      ..._vRestA.normalize().toArray(),
      ..._vRestB.normalize().toArray(),
    ];
  }
  return r;
}

// Re-orthogonalise the hinge axis against a bone direction. The axis is carried along by the
// limb between iterations, so it drifts out of perpendicular within one; both the projection
// and the signed angle below assume the two are square, and a degenerate result means the bone
// has swung onto the axis itself, where there is no hinge plane to speak of.
function orthoAxis(axis, dir, out) {
  out.copy(axis).addScaledVector(dir, -axis.dot(dir));
  const d2 = out.lengthSq();
  if (d2 < 1e-12) return false;
  out.multiplyScalar(1 / Math.sqrt(d2));
  return true;
}

// Angle from `from` to `to` about `axis`, signed. Both are unit and perpendicular to the axis,
// so their cross product lies exactly along it and the sign is simply its component there.
function signedAngle(from, to, axis) {
  _vHx.crossVectors(from, to);
  return Math.atan2(_vHx.dot(axis), from.dot(to));
}

function clampAngle(a) {
  return a < HINGE_MIN ? HINGE_MIN : (a > HINGE_MAX ? HINGE_MAX : a);
}

// Which joints are hinged this solve, and where their axes point.
//
// Run ONCE at the top of each iteration, on purpose: both sweeps then constrain against the
// same axis, and an axis recomputed mid-sweep from half-updated positions would have the two
// passes arguing with each other. It lags the pose by one iteration and catches up as the
// solve converges, which is the same bargain FABRIK itself makes.
//
// A joint qualifies when it is a simple link one step below another simple link, has a bend to
// read, and has no driven orientation of its own to obey.
//
// THE PARENT TEST IS WHAT SEPARATES A KNEE FROM A SHOULDER, and it is the whole reason phase
// one needs no chain classification. A limb's ball joint hangs DIRECTLY off a branch point —
// the shoulders off the chest, the thighs off the hips — while the hinge is always the joint
// one step further down. Hinging the ball joint instead locks the arm into the plane it was
// drawn in, and the first thing that goes is the pins: with the shoulders hinged, this rig's
// pinned hands drifted 1.45 units off their anchors in the branch test.
//
// Structural children, not active ones, deliberately: whether a thigh is a ball joint is a
// fact about the skeleton, not about which limb the current drag happens to have woken up.
// Several branches meeting is not a hinge either — those children are placed as one rigid
// cluster, and there is no single outgoing bone for an axis to govern.
function updateHingeAxes(byDepth) {
  for (const n of byDepth) {
    n.hinge = false;
    if (!n.parent || n.rot) continue;
    if (n.parent.children.length !== 1) continue;
    const kids = activeChildren(n);
    if (kids.length !== 1) continue;
    n.hkid = kids[0];
    const rest = hingeRest(n);
    if (!rest) continue;

    // Carry the rest axis onto the bone's current direction by the minimal rotation between
    // the two. Minimal-arc because that is the rule the whole solver follows (see fitRotation):
    // no roll is ever invented, so a hinge does not acquire a twist the pose does not have.
    _vHu.subVectors(n.pos, n.parent.pos);
    if (_vHu.lengthSq() < 1e-18) continue;
    _vHu.normalize();
    _vRestA.set(rest[3], rest[4], rest[5]);
    _qHinge.setFromUnitVectors(_vRestA, _vHu);
    n.axis.set(rest[0], rest[1], rest[2]).applyQuaternion(_qHinge);
    n.hinge = true;
  }
}

// FORWARD SWEEP form: the joint and its parent are placed, so the incoming bone is known and
// the child's direction is what the hinge decides. `want` is where the unconstrained solve was
// heading; `out` receives the unit direction it is allowed to take.
function hingeOut(n, want, out) {
  _vHu.subVectors(n.pos, n.parent.pos);
  if (_vHu.lengthSq() < 1e-18) return false;
  _vHu.normalize();
  if (!orthoAxis(n.axis, _vHu, _vHa)) return false;
  // Fold the wanted direction into the hinge plane, then clamp how far round it may swing.
  _vHd.copy(want).addScaledVector(_vHa, -want.dot(_vHa));
  if (_vHd.lengthSq() < 1e-18) _vHd.copy(_vHu); // asked to point straight along the axis
  else _vHd.normalize();
  out.copy(_vHu).applyQuaternion(_qHinge.setFromAxisAngle(_vHa, clampAngle(signedAngle(_vHu, _vHd, _vHa))));
  return true;
}

// BACKWARD SWEEP form: the same constraint read the other way round. Here the child is placed
// and the PARENT is what we are proposing, so the outgoing bone is known and the hinge decides
// where the incoming one may come from. `out` receives the proposed parent position.
function hingeIn(c, parentPos, out) {
  _vHv.subVectors(c.hkid.pos, c.pos);
  if (_vHv.lengthSq() < 1e-18) return false;
  _vHv.normalize();
  if (!orthoAxis(c.axis, _vHv, _vHa)) return false;
  _vHu.subVectors(c.pos, parentPos);
  _vHu.addScaledVector(_vHa, -_vHu.dot(_vHa));
  if (_vHu.lengthSq() < 1e-18) return false;
  _vHu.normalize();
  // Rebuild the incoming direction FROM the outgoing one, rotating back by the allowed angle.
  // Going the other way would let an out-of-range angle survive the sweep untouched.
  _vHdir.copy(_vHv).applyQuaternion(_qHinge.setFromAxisAngle(_vHa, -clampAngle(signedAngle(_vHu, _vHv, _vHa))));
  out.copy(c.pos).addScaledVector(_vHdir, -c.len);
  return true;
}

function alignVectors(from, to, n, out, passReq) {
  out.identity();
  if (!n) return out;
  const passes = n > 1 ? (passReq || 3) : 1;
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
let _sweepHinge = true;

function fabrik(nodes, targets, root, rootFixed, tol) {
  let worst = Infinity;
  const active = [];
  for (const n of nodes.values()) if (n.active) active.push(n);
  const byDepth = active.slice().sort((a, b) => a.depth - b.depth);
  const rootPos0 = root.pos.clone();

  const maxIter = window._ikIterations || MAX_ITERATIONS;
  for (let iter = 0; iter < maxIter; iter++) {
    // Which joints are hinged, and where their axes point, for BOTH sweeps of this iteration.
    if (window._ikHinge !== false && _sweepHinge) updateHingeAxes(byDepth);

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
        // A hinged child does not propose freely: it proposes the parent position its own one
        // degree of freedom permits. `n.pos` is still last iteration's value here, which is
        // what the proposal is measured against — it is overwritten only after every branch
        // has had its say.
        if (!(c.hinge && _sweepHinge && hingeIn(c, n.pos, _v))) towards(_v, c.pos, n.pos, c.len);
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
        // One child. A free joint has only its bone length to satisfy; a hinged one also has
        // to keep the bone in its plane and inside its range.
        const c = kids[0];
        if (n.hinge && _sweepHinge) {
          _vHw.subVectors(c.pos, n.pos);
          if (hingeOut(n, _vHw, _vHdir)) { c.pos.copy(n.pos).addScaledVector(_vHdir, c.len); continue; }
        }
        towards(c.pos, n.pos, c.pos, c.len);
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

    worst = 0;
    for (const [n, t] of targets) worst = Math.max(worst, n.pos.distanceTo(t));
    if (worst < tol) break;
  }
  return worst;
}

// ---- the other branch -----------------------------------------------------------
//
// A hinge makes the set of poses a limb can hold NON-CONVEX, and the sweeps are local: they
// find the legal pose nearest the one the limb is already in and cannot cross to the other
// side. Nearest-branch is exactly what removes the pop, so that is a feature — right up to the
// point where the near branch cannot reach at all and the foot simply stops following your
// hand. Folding a leg to half its own span, an ordinary pose, missed by 1.74 units that way.
//
// So a solve that falls short is retried once from the OTHER branch. The other branch is not
// guessed at: for a hinge one bone above its goal the whole limb lies in a plane (both bones
// are perpendicular to the hinge axis), which makes it the two-bone problem with a closed
// form. Intersect the sphere of radius `n.len` about the parent with the sphere of radius
// `hkid.len` about the goal, and of the two solutions take the one the hinge actually permits.
//
// Being exact rather than approximate is what makes this safe to keep: the retry either lands
// on the legal pose or reports that there is not one, so it fires decisively instead of
// wandering. An earlier version reflected the joint across the line to the goal, which is the
// right mirror but says nothing about whether the result is legal, and it traded a wrong-way
// bend for a 1.2-unit jump.
function reseedBranches(byDepth, targets) {
  let any = false;
  for (const n of byDepth) {
    if (!n.hinge || !n.parent) continue;
    // One bone below the hinge, and pulled by something. A hinge with nothing asking anything
    // of it has no branch worth choosing, and a goal further down is not a two-bone problem.
    const goal = targets.get(n.hkid);
    if (!goal) continue;

    // Where the parent is HEADED, when it is an effector or a pin of its own: seeding against
    // a position it is about to leave poses the wrong two-bone problem.
    const base = targets.get(n.parent) || n.parent.pos;
    _vHd.subVectors(goal, base);
    const L = _vHd.length();
    if (L < 1e-9) continue;              // goal sits on the parent: no line to build a plane on
    _vHd.divideScalar(L);
    // The limb's plane contains the parent and the goal, so the axis square to it is the part
    // of the hinge axis perpendicular to that line.
    if (!orthoAxis(n.axis, _vHd, _vHa)) continue;

    const l1 = n.len, l2 = n.hkid.len;
    const x = (L * L + l1 * l1 - l2 * l2) / (2 * L);
    const h2 = l1 * l1 - x * x;
    if (h2 <= 1e-12) continue;           // the goal is out of the limb's range, or dead straight
    const h = Math.sqrt(h2);

    _vHv.crossVectors(_vHa, _vHd);       // unit: both are unit and square to each other
    _vHu.copy(base).addScaledVector(_vHd, x); // foot of the joint on the parent-goal line
    for (let sgn = 1; sgn >= -1; sgn -= 2) {
      _vHw.copy(_vHu).addScaledVector(_vHv, sgn * h);
      _vHdir.subVectors(_vHw, base).normalize();
      _vHy.subVectors(goal, _vHw).normalize(); // not _vHx: signedAngle uses that as its own scratch
      if (signedAngle(_vHdir, _vHy, _vHa) >= HINGE_MIN) { n.pos.copy(_vHw); any = true; break; }
    }
  }
  return any;
}

// The sweeps, plus the one retry from the other branch. Shared by the interactive solve and by
// the playback pin pass, which want identical behaviour — a foot that holds its pin while you
// drag it should hold the same pin when the take plays back.
function runSolve(nodes, targets, root, rootFixed, tol) {
  const active = [];
  for (const n of nodes.values()) if (n.active) active.push(n);

  // PICK THE BRANCH ONCE, UP FRONT, then let the sweeps run unconstrained.
  //
  // Clamping the hinge inside every sweep was the original plan, and it does remove the flip
  // completely — but on a rig with pinned ankles and the hips dragged about it made the sweeps
  // oscillate rather than settle. Measured against the same rig with the constraint off: 40x
  // the frame-to-frame jitter and 270x the pin drift, and MORE iterations made it worse, not
  // better, which is the signature of a limit cycle rather than slow convergence. Bend depth,
  // the hinge floor, letting the plane roll, and freezing the axis per solve were all tried and
  // none of them closed the gap.
  //
  // The realisation: the flip is a question of WHICH BRANCH, and a branch is chosen once, not
  // continuously. Seeding the legal branch and then leaving FABRIK alone gets the pose right
  // without a constraint for the sweeps to fight — pins land exactly, targets are reached
  // exactly, and the solver is as steady as it is with no hinge at all. The cost is that a
  // drag which genuinely crosses between branches switches once, visibly, instead of being
  // held; on the harsh synthetic sweeps that is three or four frames in four hundred, about
  // what the old post-hoc correction did, and with none of its 2-bone snap.
  //
  // `window._ikHingeMode = 'clamp'` puts the constraint back inside the sweeps.
  const seedOnly = window._ikHingeMode !== 'clamp';
  if (seedOnly && window._ikHinge !== false) {
    const bd = active.slice().sort((a, b) => a.depth - b.depth);
    _sweepHinge = true;
    updateHingeAxes(bd);
    reseedBranches(bd, targets);
    _sweepHinge = false;
  }

  let worst = fabrik(nodes, targets, root, rootFixed, tol);
  _sweepHinge = true;

  // Fell short? It may be the near branch that cannot reach rather than the target that is out
  // of range, so try once from the other side and keep whichever got closer. Only a DECISIVE
  // improvement counts: a branch switch is a visible jump, and accepting marginal ones would
  // have the limb flickering between two nearly equal poses from frame to frame. A genuinely
  // unreachable target improves by nothing and is left exactly as it was.
  if (window._ikHinge !== false && window._ikBranchRetry !== false && worst > tol * 10) {
    const best = active.map((n) => n.pos.clone());
    const byDepth = active.slice().sort((a, b) => a.depth - b.depth);
    // Reseeded from the CONVERGED pose, not the one the solve started in: everything above the
    // hinge has already gone where it is going, so the two-bone problem is posed against the
    // parent's real position rather than a stale one. Getting that backwards left the 6DOF-pin
    // rig placing its knee against hips that had not moved yet, and the pin drifted 0.64.
    updateHingeAxes(byDepth); // the seed needs to know which joints are hinged, before any sweep
    let keptRetry = false;
    if (reseedBranches(byDepth, targets)) {
      keptRetry = fabrik(nodes, targets, root, rootFixed, tol) < worst * 0.5;
    }
    if (!keptRetry) for (let i = 0; i < active.length; i++) active[i].pos.copy(best[i]);
  }
  return worst;
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

// ---- rotations without history --------------------------------------------------
//
// THE TWIST RATCHET. `fitRotation` above measures a DELTA from the joint's current
// orientation. Each such delta is minimal-arc, so no single frame invents any roll — and yet
// composing a long run of them along a path is parallel transport, which comes back rotated
// when the path closes. Drive the hips once round a circle and back to exactly where they
// started and the thigh keeps about 40 degrees of twist it did not have before; go round four
// times and it keeps 130. That is the candy-wrapper collapse at the top of the thigh, and the
// limbs spinning between keyframes, and the solve depending on which way you scrubbed: one
// cause wearing three hats. The pose was a function of how you got there, not of where you are.
//
// So the rotation is built ABSOLUTELY instead, from two things that carry no history:
//
//   * the child's offset in this joint's own frame, which is CONSTANT — the solver only ever
//     writes rotations, so a bone's local offset is the same in every pose it will ever hold;
//   * where the solve wants that child, expressed in the PARENT's frame.
//
// The rotation carrying one to the other IS the joint's local rotation, and it is written
// outright rather than accumulated onto what was there. With one child the fit is the minimal
// arc, which means zero twist relative to the parent — the convention a limb needs, and the
// reason identity now means "the rest pose" rather than "wherever this joint drifted to".
// With two or more children their directions pin the rotation down completely and there is no
// convention left to choose.
//
// `window._ikAbsoluteRotations = false` restores the accumulating behaviour.
function fitLocalRotation(n, kids, out) {
  const p = n.joint._parentMesh;
  if (p && p.getModelSpaceMatrix) modelQuat(p, _qPInv).invert();
  else _qPInv.identity(); // the root: its own frame IS model space
  Skeleton.jointPos(n.joint, _v2); // where the joint is, now that its parents are written
  let k = 0;
  for (const c of kids) {
    scratchPair(k);
    // The child's offset in THIS joint's frame. Constant across every pose, which is exactly
    // what makes the result independent of the poses that came before.
    const lm = c.joint.getMatrix();
    _fromBuf[k].set(lm[12], lm[13], lm[14]);
    _toBuf[k].subVectors(c.pos, _v2).applyQuaternion(_qPInv);
    k++;
  }
  return alignVectors(_fromBuf, _toBuf, k, out, window._ikFitPasses || 3);
}

// Write a joint's LOCAL rotation outright, leaving its offset and scale alone.
function setLocalRotation(joint, q) {
  _mLocal.fromArray(joint.getMatrix());
  _mLocal.decompose(_vTmp, _qJoint, _sTmp);
  _mLocal.compose(_vTmp, q, _sTmp);
  mat4.copy(joint.getMatrix(), _mLocal.elements);
  Skeleton.syncThree(joint);
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

    // ONLY WHERE THE ROLL IS ACTUALLY FREE, which is a joint with a single child.
    //
    // That is where the ratchet lives: one child direction leaves the twist about the bone
    // undetermined, so nothing stops it wandering, and the wander is what collapses the skin at
    // the top of a thigh. Two or more children pin the rotation down completely — there is no
    // free roll to accumulate — and those joints are better left on the delta form, because the
    // multi-child fit is a cheap approximation of a Kabsch solve rather than an exact one. Read
    // absolutely, that approximation is re-made from scratch every solve and never goes away;
    // read as a delta it is re-measured and corrected, and settles to machine precision. Making
    // every joint absolute cost exactly that: a fixed target stopped converging cleanly and
    // crept 5.8e-3 per twenty solves instead of 3.4e-15.
    //
    // So: absolute where the convention is needed, delta where the geometry already decides.
    const canBeAbsolute = n.parent || kids.length > 1;
    if (window._ikAbsoluteRotations !== false && canBeAbsolute) {
      fitLocalRotation(n, kids, _qLocal);
      setLocalRotation(n.joint, _qLocal);
    } else {
      fitRotation(n, kids, _qFit);
      rotateJoint(n.joint, _qFit);
    }
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
// Is one of these pinned joints a DIRECT CHILD of the effector?
//
// Direct child, not any descendant: a driven orientation rotates the effector's IMMEDIATE
// children rigidly with it, and deeper joints reach their positions through their own solved
// rotations, which stay free. So a pin one bone down is rigidly determined and has nothing left
// to give, while a pin further down has intervening joints to absorb the rotation. That is the
// difference between a knee with a pinned ankle (over-constrained: the foot is carried off its
// pin) and hips with pinned feet (fine, and the point of the feature — the feet stay planted
// while the body twists above them).
function pinnedChild(effector, pinList) {
  if (!effector || !pinList || !pinList.length) return null;
  const id = effector.getID();
  for (const j of pinList) {
    if (j !== effector && Skeleton.isJoint(j._parentMesh) && j._parentMesh.getID() === id) return j;
  }
  return null;
}

IKSolver.solve = function (main, effector, target, pins, orientation) {
  if (!effector || !target) return false;
  const nodes = buildGraph(main);
  const eff = nodes.get(effector.getID());
  if (!eff) return false;

  // A DRIVEN ORIENTATION MAKES THE EFFECTOR'S CHILDREN RIGID WITH IT — that is the point of
  // it, and for a hand or a foot it is exactly right: the limb keeps the orientation you are
  // holding it at. For a joint with a PINNED DESCENDANT it is wrong, and quietly so. With the
  // knee's position and orientation both driven, the ankle's position becomes a rigid function
  // of them, the pin has no freedom left to work with, and the foot is carried off it — the
  // whole leg below your hand moves as one piece, which reads as the solver having been
  // bypassed for plain FK. Measured: a pinned ankle holds to 0.0000 on position alone, and is
  // dragged 0.80 / 1.10 / 1.50 off its pin at 10 / 30 / 60 degrees of driven rotation.
  //
  // So the pin wins. A pin is an explicit statement about where something stays; the wrist
  // rotation that comes free with a 6DOF grab is not a statement about anything.
  const pinListEarly = pins || IKSolver.pinnedJoints(main);
  const blockingPin = orientation ? pinnedChild(effector, pinListEarly) : null;
  if (orientation && !blockingPin) {
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
  const pinList = pinListEarly;
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

  if (window._ikTrace) {
    console.log('[ik] solve eff=' + (effector._permanentStaticLabel || effector.getID())
      + ' targets=' + targets.size + ' pins=' + pinTargets.length
      + ' rootFixed=' + (targets.size <= 1 && eff !== root)
      + ' orient=' + (eff.orient ? 1 : 0)
      + (blockingPin ? ' (orientation dropped: pinned child '
          + (blockingPin._permanentStaticLabel || blockingPin.getID()) + ')' : ''));
  }

  markActive(targets.keys());
  // With nothing else pinned the root is the anchor, or the whole character would follow
  // your hand on the very first drag.
  //
  // UNLESS THE ROOT IS THE THING YOU GRABBED. Anchoring it then held the root against the
  // only input asking it to move, so with no pins set the root bone simply would not budge —
  // which reads as the root being locked rather than as anything being anchored. Taking hold
  // of the root IS the statement that the character should move.
  const rootFixed = targets.size <= 1 && eff !== root;

  runSolve(nodes, targets, root, rootFixed, Skeleton.sceneUnit(main) * TOL_FRAC);
  const touched = applyRotations(main, nodes, root, rootFixed);
  // The solver's OWN writes must not read back as someone having moved a joint, or the next
  // frame would re-solve to the pose it just produced, for ever.
  IKSolver.syncJointCache(main);
  return touched.length > 0 || !rootFixed;
};

// ---- holding pins through playback ----------------------------------------------
//
// A keyed pose does NOT re-run the solver: playback slerps each joint's stored LOCAL rotation
// straight back into its matrix. Pin satisfaction is not preserved by that, because where a
// foot ends up is a nonlinear function of the joint rotations above it — slerp between two
// poses that each sit on the pin and the foot cuts the chord instead of following the arc. It
// is exact AT the keys and worst between them; measured on a two-key leg it left the pin by
// 0.39 at the midpoint, about a quarter of the leg's length.
//
// This is Maya's behaviour too, and Maya says so outright: pinning "only affects your FBIK
// effectors during interaction — not during playback". Their answer is to promote a pin into a
// keyed IK effector that the solver evaluates every frame. This is the cheap half of that: the
// pins are treated as constant goals and re-solved once per frame after playback has written
// the interpolated pose. Right for a foot planted through a shot, wrong for a pin that is
// meant to travel — that needs keyable goals, which is the larger job.
//
// THE ROOT IS ALWAYS FIXED HERE, unlike an interactive drag. The root's motion is authored —
// it is what the take says the character does — so the legs bend to meet the pins rather than
// the character sliding to meet them. Letting the root move would have the pin pass quietly
// rewriting the animation.
// Has any pin been moved since the last look? Cheap enough to ask every frame — a rig has a
// handful of pins, and this is the only way a pin dragged with the GIZMO re-solves the rig.
// Watching the transforms rather than hooking the gizmo means undo, a keyed pin and a script
// setting the matrix all count as a move, without any of them knowing about the solver.
IKSolver.pinsMoved = function (main) {
  let moved = false;
  for (const j of IKSolver.pinnedJoints(main)) {
    const p = IKSolver.pinObject(j);
    if (!p) continue;
    const m = p.getMatrix();
    const last = p._pinLastM;
    if (!last) { p._pinLastM = mat4.clone(m); moved = true; continue; }
    for (let i = 0; i < 16; i++) {
      if (Math.abs(last[i] - m[i]) > MOVE_EPS) { moved = true; break; }
    }
    if (moved) mat4.copy(p._pinLastM, m);
  }
  return moved;
};

// Remember every joint's matrix as the solver last left it. Anything that differs afterwards
// was written by something ELSE — the gizmo, a script, an undo — which is the signal that a
// joint has been dragged and the rig should re-solve around it.
IKSolver.syncJointCache = function (main) {
  for (const j of Skeleton.joints(main)) j._ikLastM = mat4.clone(j.getMatrix());
};

// The joint someone moved behind the solver's back, or null. Only ONE is reported: a gizmo
// drags one thing, and re-solving to several contradictory effectors at once is not a pose.
IKSolver.externallyMovedJoint = function (main) {
  // Off by default while this is under suspicion: it runs every frame in the render loop for
  // EVERY tool, not just the gizmo, and restoring a joint's matrix before re-solving is exactly
  // the kind of thing that fights anything else writing joints. `window._ikGizmoPose = true`
  // turns gizmo-posing back on.
  if (window._ikGizmoPose !== true) return null;
  let found = null;
  for (const j of Skeleton.joints(main)) {
    const m = j.getMatrix();
    if (!j._ikLastM) { j._ikLastM = mat4.clone(m); continue; }
    if (found) continue;                       // still refresh the rest, but report the first
    const last = j._ikLastM;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(last[i] - m[i]) > MOVE_EPS) { found = j; break; }
    }
  }
  return found;
};

// Drag a joint to wherever it currently SITS — the entry point for anything that has already
// moved a joint directly, the transform gizmo above all. The joint is the effector and its
// present transform is the request; the solver then rearranges the chain and the pins around
// it, which is what makes the gizmo a posing tool rather than a way to edit bone lengths.
IKSolver.resolveToJoint = function (main, joint) {
  if (!joint) return false;
  // Read where it was PUT...
  _mTmp.fromArray(joint.getModelSpaceMatrix());
  _mTmp.decompose(_vTmp, _qNow, _sTmp);
  const target = _vTmp.clone(), orient = _qNow.clone();

  // ...then PUT IT BACK before solving. A joint's local translation IS its bone length, so a
  // gizmo drag has already lengthened the bone by the time we see it; solving from that state
  // would adopt the new length as the truth and the rig would stretch a little more with every
  // drag. Restoring first makes the gizmo's position a REQUEST — the solver reaches it by
  // rotating the chain, with every bone length exactly as it was, which is the whole difference
  // between posing and editing the rig's proportions.
  if (joint._ikLastM) {
    mat4.copy(joint.getMatrix(), joint._ikLastM);
    Skeleton.syncThree(joint);
  }

  const ok = IKSolver.solve(main, joint, target, null, orient);
  IKSolver.syncJointCache(main);
  return ok;
};

IKSolver.holdPins = function (main) {
  const pins = IKSolver.pinnedJoints(main);
  if (window._ikTrace) console.log('[ik] holdPins pins=' + pins.length);
  if (!pins.length) return false;
  const nodes = buildGraph(main);

  // Grouped by skeleton: two pinned characters are two independent problems, and throwing all
  // their pins at one solve would treat them as one body.
  const byRoot = new Map();
  for (const j of pins) {
    const n = nodes.get(j.getID());
    if (!n) continue;
    const root = rootOf(n);
    let g = byRoot.get(root);
    if (!g) byRoot.set(root, (g = []));
    g.push({ node: n, joint: j });
  }

  const tol = Skeleton.sceneUnit(main) * TOL_FRAC;
  let solved = false;
  for (const [root, group] of byRoot) {
    const targets = new Map();
    for (const { node, joint } of group) {
      targets.set(node, IKSolver.pinAnchor(joint, new THREE.Vector3()));
      // A 6DOF pin holds its orientation as well, through the same machinery the interactive
      // solve uses: the target is the orientation it already has, so the joint is its own fixed
      // point and its children stay rigid with it while the chain above swings.
      if (IKSolver.pinMode(joint) === IKSolver.PIN_FULL) {
        node.orient = IKSolver.pinAnchorQuat(joint, new THREE.Quaternion());
        node.rot = node.orient.clone().multiply(modelQuat(joint, _qNow).invert());
      }
    }
    markActive(targets.keys());
    runSolve(nodes, targets, root, true, tol);
    applyRotations(main, nodes, root, true);
    solved = true;
  }
  return solved;
};

// Every joint's local matrix, for undo. A solve can reach anywhere in the tree (that is the
// point of full-body IK), so the honest snapshot is all of them; it is one 16-float matrix
// per joint, which is nothing next to the vertex snapshots the sculpt tools push.
IKSolver.captureAll = function (main) {
  return Skeleton.joints(main).map((j) => [j, mat4.clone(j.getMatrix())]);
};

// PIN CYCLE: unpinned -> position -> position + rotation -> unpinned. Shared by every tool
// that binds it (bone draw, transform, grab) — one button, one meaning, one undo. Returns
// false when there was no joint to act on, so a caller can tell a miss from a press.
//
// The undo is the fiddly part and the reason this is not copied: unpinning takes the null OUT
// of the scene, so undo has to put THE SAME OBJECT back at the matrix it stood at, or the pin
// comes back somewhere else.
IKSolver.togglePin = function (main, joint) {
  if (!joint || !main) return false;
  const was = IKSolver.pinMode(joint);
  const wasPin = IKSolver.pinObject(joint);
  const wasM = wasPin ? mat4.clone(wasPin.getMatrix()) : null;
  const r = IKSolver.cyclePin(joint, main);
  const now = r.mode;
  if (r.removed) main.removeMeshSilent(r.removed);
  const nowPin = r.pin;
  const names = ['unpinned', 'pinned (position)', 'pinned (position + rotation)'];
  const sm = main.getStateManager && main.getStateManager();
  if (sm && sm.pushStateCustom) {
    const apply = (mode, pin, m) => {
      if (pin && mode) { main.addMeshSilent(pin); IKSolver.attachPin(joint, pin, mode, m); }
      else {
        const live = IKSolver.pinObject(joint);
        IKSolver.setPin(joint, 0, main);
        if (live) main.removeMeshSilent(live);
      }
      Skeleton.updateVisuals(main); main.render();
    };
    sm.pushStateCustom(() => apply(was, wasPin, wasM), () => apply(now, nowPin, null),
      false, 'Pin Joint');
  }
  if (window.screenLog) window.screenLog('Bones: ' + names[now], 'cyan');
  Skeleton.updateVisuals(main);
  main.render();
  // The mini panel's pin count is only refreshed when something asks it to, and pinning from
  // a face button is exactly the route that would otherwise leave it stale.
  try { main._miniPanel?.syncFromState?.(); } catch (_) {}
  return true;
};

// A PINS THE JOINT UNDER THE RAY, on the press EDGE. Bone draw, Transform and Grab all bind
// it, so it lives in ONE place: pointing at a joint and pressing one thing is the gesture, and
// it should not change meaning with the tool in your hand.
//
// The TOOL is passed in rather than imported. Putting this on SculptBase would have been the
// obvious home, but SculptBase cannot import IKSolver — Skeleton pulls in the mesh stack and
// the cycle leaves SculptBase undefined at the moment the tools extend it (module_load_test
// catches it as "Class extends value undefined"). Handing the tool in keeps the arrow
// pointing one way.
//
// `busy` is the tool's own mid-gesture flag: the press that starts a drag must not also
// re-pin the thing it is about to move.
IKSolver.pinOnA = function (tool, options, busy) {
  const a = tool._readButton(options, 4);
  const was = tool._wasAPressed;
  tool._wasAPressed = a;
  if (!a || was || busy) return false;
  return IKSolver.togglePin(tool._main, Skeleton.hoveredJoint(tool._main));
};

export default IKSolver;
