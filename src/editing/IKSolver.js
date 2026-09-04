import { VERSION } from '../Version.js';
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

// Sweeps per solve. Complex full-body pin arrangements often cannot meet every target exactly;
// letting those cases run to 40 merely repeated a stalled solve and made immersive playback
// several times slower. Ten is visually indistinguishable in normal posing and keeps XR live.
const MAX_ITERATIONS = 10;

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
// Its own scratch: pinAnchorQuat decomposes into _vTmp/_sTmp on the line above, so reusing
// either for the weighted slerp would overwrite the value being read.
const _qWeight = new THREE.Quaternion();
// ...and likewise for the position lerp. Every caller today passes a fresh vector as `out`, but
// `out` is the caller's to choose: if one ever hands in _vTmp, `here` and `out` become the same
// object and the lerp reads the value it is writing.
const _vWeight = new THREE.Vector3();
const _vRoll = new THREE.Vector3();
const _qRoll = new THREE.Quaternion();

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
// A STEERING GOAL, not a constraint — the pole vector, expressed as a priority rather than as
// a separate kind of object. See the swivel section below for what it does and why it costs
// the hard pins nothing. Value 3 is the last free pattern in the two-bit field the pin already
// rides in, so it saves and loads with no file format change at all.
IKSolver.PIN_SOFT = 3;
// ORIENTATION ONLY: the joint's rotation is held, its position is free. The other half of
// PIN_FULL, and useful wherever a limb should keep pointing the same way while the body it
// hangs off moves — a head that keeps facing forward, a foot that stays flat while the hips
// travel. APPENDED rather than inserted on purpose: every value below it keeps the meaning it
// already has, so no SKEL file written by an older build changes behaviour when read by this
// one. It costs a third bit in the field, which is why it could not simply take a low slot.
IKSolver.PIN_ROT = 4;

// Older builds stored a boolean here; `true | 0` is 1, which is exactly the 3DOF pin.
IKSolver.pinMode = function (joint) { return joint ? ((joint._boneIKPin | 0) & 7) : 0; };
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

// Resolve a pinned joint to its driving control only where a caller explicitly needs the
// driven target. General selection deliberately does not use this: bones remain selectable
// for rig setup and for editing/deleting legacy bone animation.
IKSolver.controlFor = function (mesh, main) {
  if (!mesh?._isBone) return mesh;
  const pin = IKSolver.pinObject(mesh);
  return pin && (!main?.getMeshes || main.getMeshes().includes(pin)) ? pin : mesh;
};

IKSolver.setPin = function (joint, mode, main) {
  if (!joint) return null;
  const now = (mode | 0) & 7;
  let pin = IKSolver.pinObject(joint);

  if (!now) {
    // REMEMBERED, NOT FORGOTTEN. A pin is an ordinary object and carries an ordinary animation
    // track — its keyed path, and its weight keys. Unpinning takes the object out of the scene,
    // and re-pinning used to build a brand new one with a new id, which left every key the user
    // had put on the old one orphaned on a track belonging to nothing.
    //
    // Silent, and expensive: matt keyed a wrist pin to activate over two frames, cycled the pin
    // with the A button somewhere along the way, and the fade simply stopped existing. The pin
    // read as hard-on at weight 1 from frame 0, so the wrist snapped to it instead of blending —
    // "instead it made the rig explode". The keys were still in his file, on object 418, which
    // is not in the scene.
    joint._boneIKPinPrev = pin || joint._boneIKPinPrev || null;
    joint._boneIKPinObj = null;
    joint._boneIKPin = 0;
    return pin; // handed back so the caller can remove it from the scene and undo that
  }

  if (!pin) {
    // The one this joint had before, if it still exists — so its keys come back with it. A pin
    // toggled off and on is the same pin, which is what the gesture says and what the undo path
    // has always done (see attachPin).
    const prev = joint._boneIKPinPrev;
    if (prev && main && main.addMeshSilent && !(main.getMeshes() || []).includes(prev)) {
      main.addMeshSilent(prev);
      pin = prev;
      joint._boneIKPinObj = pin;
    }
  }

  if (!pin) {
    pin = IKSolver.makePinObject(main, joint);
    if (!pin) return null; // no scene to put it in
    joint._boneIKPinObj = pin;
  }
  joint._boneIKPinPrev = pin;
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
  return p ? ((p._pinMode | 0) & 7) : 0;
};
IKSolver.isPinned = function (joint) { return IKSolver.pinMode(joint) > 0; };

// HOW MUCH THIS PIN APPLIES, 0..1, at the current playback time.
//
// Unkeyed reads as 1. That default is load-bearing: every rig that already exists has no such
// channel, and any other default would silently deactivate every pin in every saved scene the
// moment this shipped.
// SWING-TWIST: how much of `q` is a rotation ABOUT `axis`, in radians.
//
// A hand rotating a joint produces a rotation with two parts: the SWING, which points the bone
// somewhere else, and the TWIST about the bone itself. On a solver-owned joint the swing is not
// the animator's to keep -- the solve decides where the bone points -- but the twist is, because
// nothing in the solve determines it. So the gesture is split and only the half that survives is
// stored. Standard decomposition: project the quaternion's vector part onto the axis and keep
// the axis-aligned remainder.
IKSolver.twistAbout = function (q, axis) {
  const ax = axis.x, ay = axis.y, az = axis.z;
  const d = q.x * ax + q.y * ay + q.z * az;
  const px = ax * d, py = ay * d, pz = az * d;
  const len = Math.hypot(px, py, pz, q.w);
  if (len < 1e-12) return 0;                     // a half-turn of pure swing: no twist to read
  const w = q.w / len;
  // The sign comes from whether the projection points along the axis or against it.
  const s = Math.hypot(px, py, pz) / len * (d < 0 ? -1 : 1);
  return 2 * Math.atan2(s, w);
};

// The joints this solve will WRITE -- everything on a path from an active pin to the root. A
// joint outside that set keeps whatever pose it is given, which is why FK already works there
// (roadmap #59, Tier 1) and why the roll is only needed inside it.
IKSolver.solverOwnedIds = function (main) {
  const pins = IKSolver.activePins(main);
  if (!pins.length) return new Set();
  return solverOwned(main, pins);
};

// Add to a joint's free roll, in radians. The angle accumulates, because a twist gesture is a
// series of small additions and each one has to build on the last rather than replace it.
IKSolver.addFkRoll = function (joint, radians) {
  if (!joint || !radians) return false;
  joint._fkRoll = (joint._fkRoll || 0) + radians;
  return true;
};

IKSolver.fkRoll = function (joint) { return (joint && joint._fkRoll) || 0; };

IKSolver.clearFkRoll = function (joint) {
  if (!joint) return false;
  joint._fkRoll = 0;
  return true;
};

IKSolver.PIN_WEIGHT = 'pinWeight';
const PIN_W_EPS = 0.01;

IKSolver.pinWeight = function (joint) {
  const p = IKSolver.pinObject(joint);
  if (!p) return 0;
  const reg = window._animationRegistry;
  if (!reg || !reg.scalarAt) return 1;
  const t = reg.globalPlaybackTime || 0;
  const w = reg.scalarAt(p, IKSolver.PIN_WEIGHT, t, 1);
  if (w == null) return 1;
  // SNAP THE ENDS. The scalar evaluator is a Bezier solved iteratively, so a key valued
  // exactly 1.0 evaluates to about 0.9990 AT ITS OWN KEY TIME. Left alone that is a pin an
  // animator keyed as fully on which is fractionally loose forever, and it also means the
  // w >= 1 fast path below never fires. The error is ~1e-3, so anything inside 1e-2 of an end
  // is that end.
  if (w >= 1 - PIN_W_EPS) return 1;
  if (w <= PIN_W_EPS) return 0;
  return Math.min(1, Math.max(0, w));
};

// The anchor this joint is pinned to, in model space: the pin object's own transform, LERPED
// toward the joint's own position by the pin's weight.
//
// WHY THE TARGET AND NOT THE SOLVER. Weighting the constraint inside FABRIK interacts with the
// iteration count -- the same weight converges differently at 8 iterations than at 20 -- so
// "half pinned" would mean something slightly different depending on solver settings, which is
// not a thing an animator can hold in their head. Moving the TARGET is exact at every value and
// costs nothing: at w=1 it is the pin, at w=0 it is where the joint already is, so the
// constraint asks for no change and is a no-op without needing a branch to disable it.
//
// NOTE this does NOT by itself solve the activation POP. Ramping 0->1 over a few frames still
// drags the joint the whole distance, just faster than a jump. What solves that is matching on
// transition -- keying the pin to where the joint already is at the activation frame -- which
// is Phase B and is needed whether the channel is continuous or a boolean.
IKSolver.pinAnchor = function (joint, out) {
  out = out || new THREE.Vector3();
  const p = IKSolver.pinObject(joint);
  if (!p) return Skeleton.jointPos(joint, out);
  _mTmp.fromArray(p.getModelSpaceMatrix());
  out.set(_mTmp.elements[12], _mTmp.elements[13], _mTmp.elements[14]);
  const w = IKSolver.pinWeight(joint);
  if (w >= 1) return out;
  // lerp(jointPos, pinPos, w)
  const here = Skeleton.jointPos(joint, _vWeight);
  return out.set(here.x + (out.x - here.x) * w,
                 here.y + (out.y - here.y) * w,
                 here.z + (out.z - here.z) * w);
};

// The same weight on the ORIENTATION half, or a 6DOF pin at w=0 would release its position and
// keep holding its rotation -- half a pin, which is not one of the modes and not what "off"
// means. Slerped from the joint's own orientation, so w=0 asks for no change.
IKSolver.pinAnchorQuat = function (joint, out) {
  out = out || new THREE.Quaternion();
  const p = IKSolver.pinObject(joint);
  if (!p) return modelQuat(joint, out);
  _mTmp.fromArray(p.getModelSpaceMatrix());
  _mTmp.decompose(_vTmp, out, _sTmp);
  const w = IKSolver.pinWeight(joint);
  if (w >= 1) return out;
  const here = modelQuat(joint, _qWeight);
  return out.copy(here).slerp(out, w);
};

// none -> position -> position+rotation -> none. A cycle rather than two buttons: pinning is
// done by pointing at a joint and pressing one thing, and the marker says which state it is in.
// Returns { mode, pin, removed } so the caller can put the object in or out of the scene.
// The order the A button walks, written out rather than computed: PIN_ROT is 4 for file
// compatibility, so the cycle is no longer the mode numbers in sequence and a modulo cannot
// express it. Position and 6DOF lead because they are the common two; rotation-only sits next
// to 6DOF because it is the same idea minus a half; steer is last because it is a hint rather
// than a constraint and reads as the odd one out.
IKSolver.PIN_CYCLE = [IKSolver.PIN_POS, IKSolver.PIN_FULL, IKSolver.PIN_ROT,
                      IKSolver.PIN_SOFT, IKSolver.PIN_NONE];

IKSolver.cyclePin = function (joint, main) {
  const ring = IKSolver.PIN_CYCLE;
  const at = ring.indexOf(IKSolver.pinMode(joint));
  // An unrecognised mode (a file from a newer build, say) lands at -1 and so steps to the
  // front of the ring rather than off the end of it.
  const next = ring[(at + 1) % ring.length];
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

// THE PINS THAT ACTUALLY APPLY THIS FRAME. A pin at weight 0 is not a weak pin, it is not a pin
// at all, and it must drop out of the solve entirely rather than merely asking for nothing.
//
// This is the whole of matt's second report. Deactivating a wrist pin at frame 11 made "the body
// and arm snap away to a different position", and he read it as the other pins re-solving the
// arm from scratch. Almost: the arm was still SOLVER-OWNED, because the pin object still
// existed, so `seedFromRest` reset the whole chain to its rest pose before every solve. A joint
// off every path from a pin to the root is deliberately left alone -- its transform is not
// solver output -- and that is exactly the behaviour a deactivated pin should get.
//
// So this is NOT a limit of FABRIK, and the stop-motion expectation is the right one: with the
// pin excluded, the arm stops being owned and simply keeps the pose it was in, until something
// else claims it.
IKSolver.activePins = function (main) {
  return IKSolver.pinnedJoints(main).filter((j) => IKSolver.pinWeight(j) > 0);
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
  // Restoring a pin's matrix on undo has to SYNC it, like every other matrix write in this
  // file. Writing the SculptGL local and leaving the three-side matrix behind leaves the two
  // disagreeing until something happens to refresh them, and the next world-preserving read
  // then measures the stale one. FrameGroup carries a note about the same mistake shrinking a
  // duplicated mesh; a pin read through a stale world matrix reports the wrong anchor, and
  // the solve chases it.
  if (m) { mat4.copy(pin.getMatrix(), m); Skeleton.syncThree(pin); }
};

// Forget every remembered bend, so the next solve re-reads it from the rest pose. Called
// after the REST SKELETON is edited (Tweak mode) — moving a knee is how you change which way
// it should bend, and a preference captured before that edit would fight the new pose.
IKSolver.clearBendRefs = function (main) {
  for (const j of Skeleton.joints(main)) j._boneBendRef = null;
};

// ---- the rest pose, and why evaluation needs one ---------------------------------
//
// FABRIK seeds every solve from the pose the rig is ALREADY in. For an interactive drag that
// is exactly right — continuity between frames is most of why dragging feels smooth. For
// EVALUATION it is a bug, and a bad one: it makes the solved pose a function of the route
// taken to the frame rather than of the frame itself. Same pins, same hip target, three
// different routes, measured on a two-legged rig with both ankles pinned:
//
//   from rest             knee (0.406, 0.808, 0.519)
//   via one other frame        (0.384, 0.809, 0.526)   0.0230 away
//   via two other frames       (0.441, 0.807, 0.506)   0.0375 away
//
// Every control is satisfied in every row — the hips land exactly, the pins hold to 1e-9 —
// and the knee still lands a good fraction of a bone apart. So a scrub and a playback
// disagree, and a pose keyed through controls does not reproduce. That is what the rest pose
// below fixes: evaluation restores every joint the solver OWNS back to rest first, so the
// answer depends on (rest skeleton, control values) and nothing else.
//
// THE REST POSE IS THE SKELETON AS DRAWN. It is captured when the rig is built or tweaked —
// the same moments that invalidate a bend reference, and for the same reason: both describe
// the shape the solver should reason from, and editing that shape invalidates both.
// Record rest for joints that have none — a joint is born at rest, so drawing one is the
// moment to record it. Deliberately NOT a whole-rig overwrite by default: draw a new finger
// onto a character that is currently posed and a blanket capture would enshrine that pose as
// the rest skeleton for every joint in the body.
//
// `only` forces a re-capture for a named set, which is what a Tweak edit needs: tweak moves a
// joint IN the rest skeleton, so the joints it touched have a new rest and the rest of the rig
// does not.
IKSolver.captureRest = function (main, only) {
  const joints = only || Skeleton.joints(main);
  let n = 0;
  for (const j of joints) {
    if (!j || (!only && j._ikRest)) continue;
    j._ikRest = mat4.clone(j.getMatrix());
    j._boneBendRef = null; // the bend is a fact about the rest shape, which just changed
    n++;
  }
  return n;
};

// BACK TO THE SKELETON AS BUILT. The rest pose is recorded when a bone is drawn and re-recorded
// when a Tweak edit moves one — those are the two ways the rig's SHAPE changes — while posing,
// grabbing and IK only ever write the pose. So there is always something to come back to, from
// the first bone onward.
//
// This used to be reachable only through the bind pose, which does not exist until a mesh is
// bound. matt: "i noticed that there's no rest pose/bind pose until a skeleton is bound to a
// mesh... meaning if required i could go back to the rest pose at any time."
//
// Roots first: `_ikRest` is a LOCAL matrix, so a child is only meaningful once its ancestors are
// back — the same ordering the loader needs, and the same trap that made re-parenting detonate
// the rig on the next solve rather than on the reparent.
IKSolver.restoreRest = function (main) {
  const joints = Skeleton.joints(main).filter((j) => j && j._ikRest);
  if (!joints.length) return 0;
  const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
  joints.sort((a, b) => depth(a) - depth(b));
  for (const j of joints) {
    mat4.copy(j.getMatrix(), j._ikRest);
    Skeleton.syncThree(j);
  }
  return joints.length;
};

// Put every joint back to rest EXCEPT the ones named in `keep` — the controls for this frame.
// A pinned joint is NOT a control: the pin object carries the control, and the joint itself is
// something the solver moves onto it.
//
// A joint with no rest recorded adopts its current transform as rest rather than being left
// out. That is the honest fallback for a rig built before this existed: the first evaluation
// defines rest, and every one after it agrees. Silently skipping it instead would leave one
// joint history-dependent inside an otherwise deterministic solve, which is the worst of both.
function seedFromRest(main, keep, owned) {
  let restored = 0, adopted = 0;
  for (const j of Skeleton.joints(main)) {
    if (keep && keep.has(j.getID())) continue;
    // ONLY THE JOINTS THIS SOLVE WILL WRITE. A joint off every path from a pin to the root is
    // never touched by the solver, so its current transform is not solver output — it is
    // either keyed, or something the user posed by hand. Resetting those too would make a
    // scrub quietly undo hand-posed parts of the rig, which is a far worse bug than the one
    // being fixed.
    if (owned && !owned.has(j.getID())) continue;
    if (!j._ikRest) { j._ikRest = mat4.clone(j.getMatrix()); adopted++; continue; }
    mat4.copy(j.getMatrix(), j._ikRest);
    Skeleton.syncThree(j);
    // THE BEND REFERENCE IS THE OTHER HISTORY CHANNEL, and it is quieter than the seed. It is
    // read once and cached for ever, from whatever pose the rig happened to be in at the first
    // solve that needed it — so it does not vary by route (a constant cannot), but it does vary
    // by SESSION: pose interactively before you ever scrub, and the remembered bend is taken
    // from that pose instead of from the skeleton as drawn. Cleared here for the joints we just
    // put back, so it is re-read from the rest offsets buildGraph is about to compute. Constant
    // input, constant answer, and the same one after a reload.
    //
    // Only for joints that were RESTORED: a control joint is not at rest, and clearing its
    // reference would have it re-read from the posed offsets, which is the mistake this is
    // avoiding everywhere else.
    j._boneBendRef = null;
    restored++;
  }
  if (window._ikTrace) console.log('[ik] seed from rest: %d restored, %d adopted', restored, adopted);
}

// The joints this solve is going to write: everything on a path from a pin up to its root,
// which is exactly what markActive lights. Built on a throwaway graph because the answer is
// needed BEFORE the real one is built — the reset changes the positions the real graph reads.
// A few nodes and a walk per pin; the graph is rebuilt every solve anyway.
function solverOwned(main, pins) {
  const nodes = buildGraph(main);
  const anchors = [];
  for (const j of pins) {
    const n = nodes.get(j.getID());
    if (n) anchors.push(n);
  }
  markActive(anchors);
  const ids = new Set();
  for (const n of nodes.values()) if (n.active) ids.add(n.joint.getID());
  return ids;
}

// The joints something OTHER than the solver wrote this frame — playback and scrubbing set
// this as they write each keyed bone. Consumed (and cleared) by holdPins, which is what makes
// its presence mean "this is an evaluation" and its absence mean "a pin is being dragged".
function consumeWritten() {
  const w = window._ikWritten;
  window._ikWritten = null;
  // An explicitly empty set is still an evaluation: pin-only mirror/flip has no authored
  // bone to preserve, and therefore wants every solver-owned joint restored before solving.
  // `null` alone means an interactive drag that should seed from the live pose.
  return w instanceof Set ? w : null;
}

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
      activeKids: null, // lazily cached once activation paths have been marked
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
// MARKING A NODE ACTIVE BEFORE markActive RUNS WOULD SEVER THE CHAIN ABOVE IT: the walk stops
// at the first node it finds already lit, on the assumption that everything above it was lit by
// the same walk. So rotation-only pins are collected and switched on AFTER the anchors have
// been walked, never during. Found by injecting the defect this mode is meant not to have and
// watching the injected build solve nothing at all — the target was there, the chain leading
// up to it was not.
function markActive(anchors) {
  for (const a of anchors) {
    for (let n = a; n; n = n.parent) {
      if (n.active) break; // this path already joins one that was walked
      n.active = true;
    }
  }
}

function activeChildren(n) {
  if (n.activeKids) return n.activeKids;
  const out = [];
  for (const c of n.children) if (c.active) out.push(c);
  return (n.activeKids = out);
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

function fabrik(nodes, targets, root, rootFixed, tol, active, byDepth) {
  let worst = Infinity;
  const rootPos0 = root.pos.clone();

  const maxIter = window._ikIterations || MAX_ITERATIONS;
  let iterations = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
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
  if (window._ikProfile) {
    const stats = window._ikPerf || (window._ikPerf = { fabrikCalls: 0, sweeps: 0, retries: 0 });
    stats.fabrikCalls++;
    stats.sweeps += iterations;
    stats.lastSweeps = iterations;
    stats.lastError = worst;
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
  // Activation is fixed for the duration of a solve. Build its traversal order and each
  // node's filtered child list once; the old path allocated them again on every sweep.
  const byDepth = active.slice().sort((a, b) => a.depth - b.depth);
  for (const n of active) activeChildren(n);

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
    _sweepHinge = true;
    updateHingeAxes(byDepth);
    reseedBranches(byDepth, targets);
    _sweepHinge = false;
  }

  let worst = fabrik(nodes, targets, root, rootFixed, tol, active, byDepth);
  _sweepHinge = true;

  // Fell short? It may be the near branch that cannot reach rather than the target that is out
  // of range, so try once from the other side and keep whichever got closer. Only a DECISIVE
  // improvement counts: a branch switch is a visible jump, and accepting marginal ones would
  // have the limb flickering between two nearly equal poses from frame to frame. A genuinely
  // unreachable target improves by nothing and is left exactly as it was.
  // The alternate-branch retry is deliberately opt-in. On constrained animation it was firing
  // on virtually every frame and performing a second complete solve without improving the pose.
  if (window._ikHinge !== false && window._ikBranchRetry === true && worst > tol * 10) {
    if (window._ikProfile) {
      const stats = window._ikPerf || (window._ikPerf = { fabrikCalls: 0, sweeps: 0, retries: 0 });
      stats.retries++;
    }
    const best = active.map((n) => n.pos.clone());
    // Reseeded from the CONVERGED pose, not the one the solve started in: everything above the
    // hinge has already gone where it is going, so the two-bone problem is posed against the
    // parent's real position rather than a stale one. Getting that backwards left the 6DOF-pin
    // rig placing its knee against hips that had not moved yet, and the pin drifted 0.64.
    updateHingeAxes(byDepth); // the seed needs to know which joints are hinged, before any sweep
    let keptRetry = false;
    if (reseedBranches(byDepth, targets)) {
      keptRetry = fabrik(nodes, targets, root, rootFixed, tol, active, byDepth) < worst * 0.5;
    }
    if (!keptRetry) for (let i = 0; i < active.length; i++) active[i].pos.copy(best[i]);
  }
  return worst;
}

// ---- the swivel: a steering goal in the freedom the hard pins leave ---------------
//
// matt's design, and better than a dedicated pole-vector object: per-joint PRIORITY rather
// than a separate mechanism. A hard ankle goal and a soft knee goal, so the knee only steers
// the freedom the ankle leaves.
//
// That freedom is not a metaphor, it is a circle, and the findings doc measured it: a pinned
// ankle is one bone below the knee, so it confines the knee to a SPHERE about the pin; fix the
// hip as well and the knee lies on the intersection of two spheres, which is a circle about
// the hip-to-ankle axis. Nothing steered where on that circle the knee rested — the solver
// simply left it wherever FABRIK put it.
//
// So the implementation is not a weighted solve at all. It is a ROTATION ABOUT THAT AXIS, and
// that is the whole trick: every point of the axis is fixed by it, so both hard anchors are
// preserved EXACTLY — not approximately, not to a tolerance — and every bone length with them,
// because a rigid rotation cannot change a distance. The hard goals therefore cost nothing to
// respect and there is no priority weighting to tune, no second solve to converge, and no way
// for the steering to pull a foot off the floor.
//
// It runs AFTER the sweeps, on the solved positions, and needs no iteration of its own: the
// closest point of the circle to a goal is one angle, computed directly.

// Everything strictly between two nodes on the same chain, from `below` up to (not including)
// `above`. Null when they are not on one chain — a soft goal that does not lie between two
// anchors has no circle to slide around and is left alone rather than being approximated.
function chainBetween(above, below) {
  const out = [];
  for (let n = below; n; n = n.parent) {
    if (n === above) return out;
    out.push(n);
  }
  return null;
}

// The limb root immediately above the steered joint. A pole adjustment runs after FABRIK, so
// this point is already solved and may be treated as fixed for the swivel without requiring a
// hard pin of its own. Searching upward for a hard target made an elbow with pinned hips use
// the HIP-to-wrist axis and rotate the shoulder/torso along with it; the intended axis is always
// shoulder-to-wrist (or hip-to-ankle for a knee).
function anchorAbove(n) {
  return n.parent || null;
}

// The nearest hard target BELOW, down the active branch. Stops at a fork: with two pinned feet
// under one node there is no single axis, and picking one of them would silently steer against
// the other.
function anchorBelow(n, targets) {
  let cur = n;
  for (let guard = 0; guard < 64; guard++) {
    const kids = activeChildren(cur);
    if (kids.length !== 1) return null;
    cur = kids[0];
    if (targets.has(cur)) return cur;
  }
  return null;
}

const _vAx = new THREE.Vector3(), _vPu = new THREE.Vector3(), _vPv = new THREE.Vector3();
const _vRel = new THREE.Vector3(), _qSw = new THREE.Quaternion();

// Rotate the chain between its two anchors about the axis joining them, to bring `n` as close
// to `goal` as that rotation can. Returns the angle applied, or 0 if there was nothing to do.
function swivelToward(n, goal, targets, root, rootFixed, rate) {
  const above = anchorAbove(n);
  const below = anchorBelow(n, targets);
  if (!above || !below) return 0;
  const between = chainBetween(above, below);
  if (!between || !between.length) return 0;

  _vAx.subVectors(below.pos, above.pos);
  const axLen = _vAx.length();
  if (axLen < 1e-9) return 0;   // the two anchors coincide: no axis, no circle
  _vAx.divideScalar(axLen);

  // Both the joint and its goal, measured perpendicular to the axis. The component ALONG the
  // axis is untouchable by this rotation, so including it would ask for an angle that cannot
  // be delivered and land the joint short of the closest point rather than on it.
  _vPu.subVectors(n.pos, above.pos);
  _vPu.addScaledVector(_vAx, -_vPu.dot(_vAx));
  _vPv.subVectors(goal, above.pos);
  _vPv.addScaledVector(_vAx, -_vPv.dot(_vAx));
  if (_vPu.lengthSq() < 1e-12 || _vPv.lengthSq() < 1e-12) return 0; // one of them is ON the axis
  _vPu.normalize(); _vPv.normalize();

  let ang = signedAngle(_vPu, _vPv, _vAx) * rate;
  if (!Number.isFinite(ang) || Math.abs(ang) < 1e-9) return 0;

  _qSw.setFromAxisAngle(_vAx, ang);
  for (const m of between) {
    _vRel.subVectors(m.pos, above.pos).applyQuaternion(_qSw);
    m.pos.copy(above.pos).add(_vRel);
  }
  return ang;
}

// Apply every steering goal. Deepest first: a soft goal further down the chain sits inside the
// span of one further up, so steering the outer one first and the inner one second leaves both
// satisfied, while the other order has the outer rotation carry the inner joint back off its
// goal.
function applySwivels(nodes, soft, targets, root, rootFixed) {
  if (!soft || !soft.size) return 0;
  const rate = Number.isFinite(window._ikSwivelRate) ? window._ikSwivelRate : 1;
  if (rate <= 0) return 0;
  let n = 0;
  const order = Array.from(soft.keys()).sort((a, b) => a.depth - b.depth);
  for (const node of order) {
    if (swivelToward(node, soft.get(node), targets, root, rootFixed, rate)) n++;
  }
  if (window._ikTrace && soft.size) {
    console.log('[ik] swivel: %d of %d steering goals had a circle to slide on', n, soft.size);
  }
  return n;
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

// ── FK ROLL: THE ONE ROTATION THE SOLVE DOES NOT OWN ──────────────────────────────────
//
// FABRIK is POSITIONAL. It decides where joints go, and rotations are derived from that -- so a
// joint with ONE child has its twist about the bone left completely undetermined by the maths.
// The solver already knows this: `fitLocalRotation` exists to pick a stable convention for that
// free roll, because otherwise it wanders and collapses the skin at the top of a thigh.
//
// Which means the roll is available. Rotating a joint ABOUT THE AXIS THAT POINTS AT ITS CHILD
// does not move the child at all, so the solve is undisturbed -- the position constraint is
// satisfied exactly as before, and everything below the joint turns. That is forearm twist and
// wrist roll, which is where FK-on-an-IK-rig is actually wanted, and it costs the solver
// nothing. See roadmap #59: this is Tier 2, and the reason to try it before the far larger job
// of making the whole seed pose keyable.
//
// Stored per joint as a plain angle in radians. NOT a matrix: it has to survive the solve
// rewriting the joint's rotation every frame, so it cannot live in the rotation it modifies.
function applyFkRoll(n, kids, q) {
  const roll = n.joint._fkRoll || 0;
  // ONLY a single-child joint. With two or more children the geometry pins the rotation down
  // completely -- there is no free roll, and forcing one would fight the fit and lose.
  if (!roll || kids.length !== 1) return false;
  const lm = kids[0].joint.getMatrix();
  _vRoll.set(lm[12], lm[13], lm[14]);
  if (_vRoll.lengthSq() < 1e-12) return false;   // child sits on top of the joint: no axis
  _vRoll.normalize();
  _qRoll.setFromAxisAngle(_vRoll, roll);
  // POST-multiply: the axis is the child's offset in THIS joint's own frame, so the roll is
  // about the bone rather than about some world axis.
  q.multiply(_qRoll);
  return true;
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
      applyFkRoll(n, kids, _qLocal);
      setLocalRotation(n.joint, _qLocal);
    } else {
      fitRotation(n, kids, _qFit);
      rotateJoint(n.joint, _qFit);
      // The delta branch rewrites the joint from where it already is, so the roll is applied
      // as its own local step rather than folded into the fit.
      if (n.joint._fkRoll) {
        _mLocal.fromArray(n.joint.getMatrix());
        _mLocal.decompose(_vTmp, _qJoint, _sTmp);
        if (applyFkRoll(n, kids, _qJoint)) {
          _mLocal.compose(_vTmp, _qJoint, _sTmp);
          mat4.copy(n.joint.getMatrix(), _mLocal.elements);
          Skeleton.syncThree(n.joint);
        }
      }
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
  const pinListEarly = pins || IKSolver.activePins(main);
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
  const rotHeld = [];
  const pinList = pinListEarly;
  for (const j of pinList) {
    const n = nodes.get(j.getID());
    if (!n || n === eff) continue;
    if (rootOf(n) !== root) continue; // a pin on a different skeleton is not our business
    // The anchor, not the joint's current position — see setPin. This is the whole
    // difference between a pin that holds the ground and one that rides the character up.
    // Rotation-only pins hold no ground, so they are not something to hold the drag against:
    // no target, no entry in pinTargets, and no say in clampToPins — just the orientation and
    // a live node for applyRotations to reach. Same reasoning as in holdPins below.
    if (IKSolver.pinMode(j) === IKSolver.PIN_ROT) {
      n.orient = IKSolver.pinAnchorQuat(j, new THREE.Quaternion());
      n.rot = n.orient.clone().multiply(modelQuat(j, _qNow).invert());
      rotHeld.push(n);   // woken after markActive, not here — see the note by markActive
      continue;
    }
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
  for (const n of rotHeld) n.active = true;
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
// SOLVE ACCOUNTING. `window._ikPerf = true` prints one line a second: how many solves ran, what
// asked for them, and how long they took. Nothing else here tells you whether a solve happened
// because something genuinely moved or because the last solve's own output looked like a move —
// and those two have completely different fixes.
//
// Deliberately a COUNTER rather than a per-solve log: at 72Hz a line per solve is unreadable and
// changes the timing it is trying to report.
IKSolver.perf = { solves: 0, ms: 0, byRegistry: 0, byWatcher: 0, at: 0 };

IKSolver.perfNote = function (why) {
  if (window._ikPerf) IKSolver.perf[why] = (IKSolver.perf[why] || 0) + 1;
};

// A SWITCH THAT ANSWERS BACK. `window._ikPerf = true` is silent if the page is running older
// code — you cannot tell "no solves" from "the flag is not wired here", and those look identical
// from the console. Call `ikPerf()` instead: if it is undefined the page is stale, and if it
// replies you know the instrument is live before you go looking for its output.
// The frame-pacing twin of ikPerf. Lives here so the two switches are found together; the
// sampling itself is in Scene, which is the only place that knows when a frame began.
window.xrPerf = function (on) {
  window._xrPerf = on !== false;
  if (window.app) window.app._xrPerf = null;
  console.log('[xrPerf] ' + (window._xrPerf ? 'ON' : 'off') + ' — ' + VERSION +
    (window._xrPerf ? '. One line a second: frames, our work, and the gap between frames.' : ''));
  return window._xrPerf;
};

window.ikPerf = function (on) {
  window._ikPerf = on !== false;
  IKSolver.perf.at = 0;
  window._ikPerfRegistry = 0;
  console.log('[ikPerf] ' + (window._ikPerf ? 'ON' : 'off') + ' — ' + VERSION +
    (window._ikPerf ? '. One line a second from here, even if it is all zeros.' : ''));
  return window._ikPerf;
};

IKSolver.perfTick = function () {
  if (!window._ikPerf) return;
  const p = IKSolver.perf;
  const now = performance.now();
  if (!p.at) { p.at = now; return; }
  if (now - p.at < 1000) return;
  const reg = window._ikPerfRegistry | 0;
  console.log('[ikPerf] ' + p.solves + ' solves/s, ' + p.ms.toFixed(1) + 'ms total (' +
    (p.solves ? (p.ms / p.solves).toFixed(2) : '0') + 'ms each)' +
    ' | asked by: registry ' + reg + ', pin-watcher ' + p.byWatcher);
  p.solves = 0; p.ms = 0; p.byWatcher = 0; window._ikPerfRegistry = 0; p.at = now;
};

// Scratch for the watcher below. It runs once per pin per frame, and getModelSpaceMatrix
// allocates a fresh matrix when it is not handed one.
const _mWatch = mat4.create();

IKSolver.pinsMoved = function (main) {
  let moved = false;
  // Active only: moving a deactivated pin changes no pose, so it is not a reason to re-solve.
  for (const j of IKSolver.activePins(main)) {
    const p = IKSolver.pinObject(j);
    if (!p) continue;
    // MODEL SPACE, BECAUSE THAT IS WHAT THE SOLVE READS.
    //
    // The anchor a pin contributes is `pinAnchor`, which is its MODEL-space transform — so the
    // question this watcher asks has to be "has the thing the solver consumes changed", not
    // "has this object's own local matrix changed". They are the same number for an unparented
    // pin, which is why reading the local one was invisible: every pin was top-level.
    //
    // Parent a pin to another pin and they come apart. Drag the parent and the child's LOCAL
    // matrix does not move at all, so the watcher reports nothing, no solve is scheduled, and
    // a control handle built out of pins looks simply dead. `syncPinCache` was already writing
    // the model-space matrix into the same cache this compared against, so the two halves
    // disagreed about what they were storing the moment anything had a parent.
    const m = p.getModelSpaceMatrix ? p.getModelSpaceMatrix(_mWatch) : p.getMatrix();
    const last = p._pinLastM;
    if (!last) { p._pinLastM = mat4.clone(m); moved = true; continue; }
    // A ROTATION-ONLY PIN IS WATCHED FOR ROTATION ONLY. Its translation is not an input to the
    // solve — solve() never puts it in `targets` — so treating a moved one as a change would
    // schedule a full solve that could not possibly produce a different pose. That matters
    // rather than being merely tidy: this marker sits on a joint that the animation moves, so
    // watching all sixteen elements would report a change on every frame of playback and put
    // the whole rig through an IK solve per frame. The basis is elements 0-2, 4-6 and 8-10;
    // 12-14 are the translation and 3, 7, 11, 15 are the constant bottom row.
    const rotOnly = IKSolver.pinMode(j) === IKSolver.PIN_ROT;
    for (let i = 0; i < 16; i++) {
      if (rotOnly && (i > 10 || (i & 3) === 3)) continue;
      if (Math.abs(last[i] - m[i]) > MOVE_EPS) { moved = true; break; }
    }
    if (moved) mat4.copy(p._pinLastM, m);
  }
  return moved;
};

// A tool that deliberately moved pin controls and solved them in the same frame can
// acknowledge those matrices here. This prevents Scene's generic external-pin watcher
// from scheduling a redundant second solve on the following frame.
IKSolver.syncPinCache = function (main) {
  for (const joint of IKSolver.pinnedJoints(main)) {
    const pin = IKSolver.pinObject(joint);
    if (!pin) continue;
    // The same reading pinsMoved takes, which is the whole contract of this cache.
    const m = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix(_mWatch) : pin.getMatrix();
    if (pin._pinLastM) mat4.copy(pin._pinLastM, m);
    else pin._pinLastM = mat4.clone(m);
  }
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
  const _t0 = window._ikPerf ? performance.now() : 0;
  try {
  // Consumed FIRST, before any early return: a set left behind would be read by a later solve
  // as that frame's controls, and the joints it names would then be held at values from a
  // frame nobody is on any more.
  const written = consumeWritten();
  // ACTIVE pins only. This list decides solverOwned(), and a zero-weight pin left in it keeps
  // its whole chain owned -- so seedFromRest resets that chain to rest before every solve, and
  // the limb snaps to its rest pose the moment the pin is deactivated. Excluded, the chain is
  // simply not the solver's business and keeps the pose it was in.
  const pins = IKSolver.activePins(main);
  if (window._ikTrace) {
    console.log('[ik] holdPins pins=%d seed=%s', pins.length, written ? 'rest' : 'current');
  }
  if (!pins.length) return false;

  // TWO SEEDING MODES, and the difference is the caller, not a setting. Playback and scrubbing
  // name the joints they wrote, so everything else goes back to rest and the frame evaluates
  // to the same pose however it was reached. A pin dragged by hand names nothing, so the solve
  // seeds from the live pose and keeps the frame-to-frame continuity that makes a drag feel
  // attached to your controller. `window._ikSeedFromRest = false` forces the old behaviour.
  if (written && window._ikSeedFromRest !== false) {
    seedFromRest(main, written, solverOwned(main, pins));
  }

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
    // A steering goal is NOT a target: handing it to FABRIK as one would make it compete with
    // the hard pins on equal terms, which is precisely the arrangement it exists to replace.
    const soft = new Map();
    const rotHeld = [];
    for (const { node, joint } of group) {
      const pm = IKSolver.pinMode(joint);
      if (pm === IKSolver.PIN_SOFT) {
        soft.set(node, IKSolver.pinAnchor(joint, new THREE.Vector3()));
        continue;
      }
      // ROTATION ONLY: the orientation half of a 6DOF pin without the position half. It sets
      // `orient` exactly as PIN_FULL does, but it must NOT enter `targets` — a target is a
      // position goal, and handing FABRIK one is precisely the thing this mode exists not to
      // do. It still has to be marked active, or applyRotations never visits it and the held
      // orientation is silently dropped. Only the node itself, not its ancestors: nothing
      // above it is being asked to move, so waking the chain would put joints through a
      // rotation fit for a solve that never touched their positions.
      if (pm === IKSolver.PIN_ROT) {
        node.orient = IKSolver.pinAnchorQuat(joint, new THREE.Quaternion());
        node.rot = node.orient.clone().multiply(modelQuat(joint, _qNow).invert());
        rotHeld.push(node);   // woken after markActive, not here — see the markActive note
        continue;
      }
      targets.set(node, IKSolver.pinAnchor(joint, new THREE.Vector3()));
      // A 6DOF pin holds its orientation as well, through the same machinery the interactive
      // solve uses: the target is the orientation it already has, so the joint is its own fixed
      // point and its children stay rigid with it while the chain above swings.
      if (pm === IKSolver.PIN_FULL) {
        node.orient = IKSolver.pinAnchorQuat(joint, new THREE.Quaternion());
        node.rot = node.orient.clone().multiply(modelQuat(joint, _qNow).invert());
      }
    }
    // A steering goal still has to WAKE its chain, or the joints between the anchors are never
    // marked active and the swivel has nothing it is allowed to move.
    markActive(targets.keys());
    markActive(soft.keys());
    // Last, and only the nodes themselves: nothing above a rotation-only pin is being asked to
    // move, and lighting one before the walks above would have stopped them dead.
    for (const n of rotHeld) n.active = true;
    // Ordinarily holdPins anchors the root while limbs settle onto their goals. A hard pin ON
    // the root is the exception: fixing the root to its pre-solve position immediately after
    // assigning its target discarded the pin's translation, while its orientation still ran
    // through `node.orient` — exactly the confusing rotate-but-don't-move behaviour.
    const rootFixed = !targets.has(root);
    runSolve(nodes, targets, root, rootFixed, tol);
    // After the sweeps and before the rotations are fitted: the swivel moves POSITIONS, and
    // applyRotations is what turns positions back into joint transforms.
    applySwivels(nodes, soft, targets, root, rootFixed);
    applyRotations(main, nodes, root, rootFixed);
    solved = true;
  }
  return solved;
  } finally {
    if (window._ikPerf) {
      IKSolver.perf.solves++;
      IKSolver.perf.ms += performance.now() - _t0;
    }
  }
};

// Every joint's local matrix, for undo. A solve can reach anywhere in the tree (that is the
// point of full-body IK), so the honest snapshot is all of them; it is one 16-float matrix
// per joint, which is nothing next to the vertex snapshots the sculpt tools push.
IKSolver.captureAll = function (main) {
  return Skeleton.joints(main).map((j) => [j, mat4.clone(j.getMatrix())]);
};

// Return the rig and every active pin control to the solver rest pose. Pins are moved onto
// their joints AFTER the local rest matrices are restored, so a hip pin, feet and pole goals
// all return to the same coherent frame rather than immediately pulling the reset rig apart.
IKSolver.resetRigAndPins = function (main) {
  if (!main) return 0;
  const joints = Skeleton.joints(main);
  const pins = IKSolver.pinnedJoints(main)
    .map((j) => [j, IKSolver.pinObject(j)])
    .filter(([, p]) => !!p);
  const objects = joints.concat(pins.map(([, p]) => p));
  const before = objects.map((m) => [m, mat4.clone(m.getMatrix())]);

  let restored = 0;
  for (const j of joints) {
    if (!j._ikRest) continue;
    mat4.copy(j.getMatrix(), j._ikRest);
    j._boneBendRef = null;
    Skeleton.syncThree(j);
    restored++;
  }
  for (const [j, pin] of pins) {
    pin.setModelSpaceMatrix(j.getModelSpaceMatrix());
    Skeleton.syncThree(pin);
  }
  IKSolver.syncJointCache(main);
  Skeleton.updateVisuals?.(main);
  const after = objects.map((m) => [m, mat4.clone(m.getMatrix())]);
  const apply = (snap) => {
    Skeleton.restoreLocal(snap);
    IKSolver.syncJointCache(main);
    Skeleton.updateVisuals?.(main);
    main.render?.();
  };
  main.getStateManager?.()?.pushStateCustom?.(
    () => apply(before), () => apply(after), false, 'Reset Rig and Pins');
  main.render?.();
  return restored;
};

// PIN CYCLE: unpinned -> position -> position + rotation -> unpinned. Shared by every tool
// that binds it (bone draw, transform, grab) — one button, one meaning, one undo. Returns
// false when there was no joint to act on, so a caller can tell a miss from a press.
//
// The undo is the fiddly part and the reason this is not copied: unpinning takes the null OUT
// of the scene, so undo has to put THE SAME OBJECT back at the matrix it stood at, or the pin
// comes back somewhere else.
IKSolver.togglePin = function (main, joint) {
  return IKSolver.applyPinMode(main, joint, null);
};

// SET A SPECIFIC MODE, sharing every scrap of the cycle's bookkeeping.
//
// The cycle and the ring want the same thing done -- change the mode, put the pin object in or
// out of the scene, and record ONE undo entry that can restore the pin at the matrix it stood
// at. Only the choice of the next mode differs, so that is the only thing parameterised:
// `mode === null` means "the next one round the ring", which is what the A button used to do
// and what togglePin still means.
//
// Written this way rather than as a second copy because the undo here is the fiddly part: the
// pin is a real scene object, so an undo has to put THE SAME OBJECT back at THE SAME matrix,
// and a second implementation of that is a second chance to get it subtly wrong.
IKSolver.applyPinMode = function (main, joint, mode) {
  if (!joint || !main) return false;
  const was = IKSolver.pinMode(joint);
  if (mode != null && mode === was) return false;   // nothing to do, and no undo entry for it
  const wasPin = IKSolver.pinObject(joint);
  const wasM = wasPin ? mat4.clone(wasPin.getMatrix()) : null;
  const r = mode == null
    ? IKSolver.cyclePin(joint, main)
    : (() => {
        const before = IKSolver.pinObject(joint);
        const pin = IKSolver.setPin(joint, mode, main);
        return { mode: mode, pin: mode ? pin : null, removed: mode ? null : before };
      })();
  const now = r.mode;
  if (r.removed) main.removeMeshSilent(r.removed);
  const nowPin = r.pin;
  const names = ['unpinned', 'pinned (position)', 'pinned (position + rotation)',
                 'pinned (aim)', 'pinned (rotation)'];
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

// The ring's entry point: name the mode you want.
IKSolver.setPinMode = function (main, joint, mode) {
  return IKSolver.applyPinMode(main, joint, mode);
};

// ── ACTIVATE / DEACTIVATE, WITHOUT THE POP ────────────────────────────────────────────────
//
// THE POP IS NOT SOLVED BY A WEIGHT RAMP. When a pin activates, the joint is somewhere the pin
// is not, so it lurches across that gap -- and ramping the weight over a few frames only turns
// the jump into a fast slide down the same wrong path. Making the ramp long enough to hide it
// defeats the point of switching at a moment.
//
// What solves it is MATCHING ON TRANSITION, which is what every DCC does: at the activation
// frame, put the pin where the joint ALREADY IS and key it there. The weight then rises with
// the target already coincident, so nothing moves, and the animator moves the pin from there.
// This is needed whether the channel is continuous or a boolean, which is why it is its own
// phase rather than a property of the scalar.

// Put the pin on its joint, position and orientation both.
IKSolver.matchPinToJoint = function (main, joint) {
  const pin = IKSolver.pinObject(joint);
  if (!pin || !pin.setModelSpaceMatrix) return false;
  const p = Skeleton.jointPos(joint, new THREE.Vector3());
  const q = modelQuat(joint, new THREE.Quaternion());
  const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
  pin.setModelSpaceMatrix(m.toArray());
  // The three-side matrix has to follow, or the two disagree and the next world-preserving
  // read shrinks the thing it reads -- the trap v3.20.70 was written to close.
  Skeleton.syncThree(pin);
  return true;
};

// MATCH THE PIN TO ITS JOINT, HERE, AND KEY IT THERE. A command in its own right, not just the
// first half of activating.
//
// The handoff frame moves. Retime the FK walk and the frame where the hand should take the
// handle is somewhere else, with the arm in a different pose -- so the pin has to be re-matched,
// and re-running Activate would rewrite the weight keys you had already shaped. matt: "you could
// move to a frame where the handoff has to start, select the pin and say 'match to target', and
// it would snap to the wrist position."
//
// Position AND orientation, because a 6DOF pin that matched only position would still snap the
// wrist's rotation at the handoff.
IKSolver.matchPinHere = function (main, joint) {
  const pin = IKSolver.pinObject(joint);
  const reg = window._animationRegistry;
  if (!pin || !main) return false;
  const beforeM = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix().slice() : null;
  const track = reg && reg.tracks ? reg.tracks.get(pin.getID()) : null;
  const before = track && reg._snapshotTrack ? reg._snapshotTrack(track) : null;

  IKSolver.matchPinToJoint(main, joint);
  // Keyed at the playhead, or a pin with a track is pulled straight back to its keyed path on
  // the next evaluation and the match lasts exactly one frame.
  if (reg && reg.keyTransforms) {
    reg.keyTransforms([pin], reg.globalPlaybackTime || 0, 'Match Pin', false);
  }

  const afterM = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix().slice() : null;
  const after = reg && reg.tracks && reg.tracks.get(pin.getID()) && reg._snapshotTrack
    ? reg._snapshotTrack(reg.tracks.get(pin.getID())) : null;
  const sm = main.getStateManager && main.getStateManager();
  if (sm && sm.pushStateCustom) {
    const apply = (snap, m) => {
      const tr = reg && reg.tracks ? reg.tracks.get(pin.getID()) : null;
      if (tr && snap) reg._restoreTrack(tr, snap, null);
      if (m && pin.setModelSpaceMatrix) { pin.setModelSpaceMatrix(m); Skeleton.syncThree(pin); }
      Skeleton.updateVisuals(main);
      if (main.render) main.render();
    };
    sm.pushStateCustom(() => apply(before, beforeM), () => apply(after, afterM),
      false, 'Match Pin');
  }
  if (window.screenLog) window.screenLog('Pin matched to joint here', 'cyan');
  Skeleton.updateVisuals(main);
  if (main.render) main.render();
  return true;
};

// One frame of hold before the change. Per-key STEP interpolation does not exist yet (backlog
// #7 -- the scalar evaluator interpolates with tangents), so an on/off transition is written as
// two keys one frame apart: the old value held until the frame before, the new value now. That
// is a one-frame ramp, which reads as a step at any sane frame rate. When #7 lands this becomes
// a single stepped key and this constant goes away.
const PIN_STEP_FRAMES = 1;

IKSolver.setPinActive = function (main, joint, on) {
  const pin = IKSolver.pinObject(joint);
  const reg = window._animationRegistry;
  if (!pin || !reg || !reg.setScalarKey) return false;
  const t = reg.globalPlaybackTime || 0;
  const fps = window._animFPS || 24;
  const tPrev = Math.max(0, t - PIN_STEP_FRAMES / fps);

  const sm = main && main.getStateManager && main.getStateManager();
  const track = reg.tracks && reg.tracks.get(pin.getID());
  const before = track ? reg._snapshotTrack(track) : null;
  const beforeM = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix().slice() : null;

  if (on) {
    // MATCH FIRST, so the weight rises with the target already coincident and nothing moves.
    // The same two steps Match Here does, which is why they share them -- and why Match Here
    // exists separately: a retimed handoff needs the match again WITHOUT rewriting the weight.
    IKSolver.matchPinToJoint(main, joint);
    if (reg.keyTransforms) reg.keyTransforms([pin], t, 'Activate Pin', false);
  }

  // Hold whatever the channel said a frame ago, then state the new value. Reading the previous
  // value rather than assuming it means re-activating an already-active pin writes 1 -> 1 and
  // changes nothing, instead of inventing a dip.
  const prev = reg.scalarAt(pin, IKSolver.PIN_WEIGHT, tPrev, on ? 0 : 1);
  reg.setScalarKey(pin, IKSolver.PIN_WEIGHT, tPrev, prev);
  reg.setScalarKey(pin, IKSolver.PIN_WEIGHT, t, on ? 1 : 0);

  const after = reg.tracks && reg.tracks.get(pin.getID())
    ? reg._snapshotTrack(reg.tracks.get(pin.getID())) : null;
  const afterM = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix().slice() : null;
  if (sm && sm.pushStateCustom) {
    // ONE entry covering the match AND both keys: they are one act, and undoing half of it
    // leaves a pin keyed on at a position it was never matched to -- which is the pop, put
    // back by the undo that was supposed to remove it.
    const apply = (snap, m) => {
      const tr = reg.tracks && reg.tracks.get(pin.getID());
      if (tr && snap) reg._restoreTrack(tr, snap, null);
      if (m && pin.setModelSpaceMatrix) {
        pin.setModelSpaceMatrix(m);
        Skeleton.syncThree(pin);
      }
      Skeleton.updateVisuals(main);
      if (main.render) main.render();
    };
    sm.pushStateCustom(() => apply(before, beforeM), () => apply(after, afterM),
      false, on ? 'Activate Pin' : 'Deactivate Pin');
  }
  if (window.screenLog) {
    window.screenLog('Pin ' + (on ? 'activated' : 'deactivated') + ' here', 'cyan');
  }
  Skeleton.updateVisuals(main);
  if (main.render) main.render();
  return true;
};

// Back to no channel at all, which is NOT the same as keying 1: an unkeyed pin is fully on with
// no curve, which is the state every rig starts in and the one to be able to return to.
IKSolver.clearPinWeight = function (main, joint) {
  const pin = IKSolver.pinObject(joint);
  const reg = window._animationRegistry;
  const track = pin && reg && reg.tracks ? reg.tracks.get(pin.getID()) : null;
  if (!track || !track.scalarTracks) return false;
  const before = reg._snapshotTrack(track);
  track.scalarTracks.delete(IKSolver.PIN_WEIGHT);
  if (!track.scalarTracks.size) track.scalarTracks = null;
  const after = reg._snapshotTrack(track);
  const sm = main && main.getStateManager && main.getStateManager();
  if (sm && sm.pushStateCustom) {
    const apply = (snap) => {
      const tr = reg.tracks.get(pin.getID());
      if (tr && snap) reg._restoreTrack(tr, snap, null);
      Skeleton.updateVisuals(main);
      if (main.render) main.render();
    };
    sm.pushStateCustom(() => apply(before), () => apply(after), false, 'Clear Pin Weight');
  }
  Skeleton.updateVisuals(main);
  if (main.render) main.render();
  return true;
};

// A weight straight out, for the animator who wants a specific partial value rather than a
// transition. Keyed at the playhead like anything else.
IKSolver.setPinWeightKey = function (main, joint, w) {
  const pin = IKSolver.pinObject(joint);
  const reg = window._animationRegistry;
  if (!pin || !reg || !reg.setScalarKey) return false;
  const t = reg.globalPlaybackTime || 0;
  const track = reg.tracks && reg.tracks.get(pin.getID());
  const before = track ? reg._snapshotTrack(track) : null;
  reg.setScalarKey(pin, IKSolver.PIN_WEIGHT, t, Math.min(1, Math.max(0, w)));
  const after = reg.tracks && reg.tracks.get(pin.getID())
    ? reg._snapshotTrack(reg.tracks.get(pin.getID())) : null;
  const sm = main && main.getStateManager && main.getStateManager();
  if (sm && sm.pushStateCustom) {
    const apply = (snap) => {
      const tr = reg.tracks && reg.tracks.get(pin.getID());
      if (tr && snap) reg._restoreTrack(tr, snap, null);
      Skeleton.updateVisuals(main);
      if (main.render) main.render();
    };
    sm.pushStateCustom(() => apply(before), () => apply(after), false, 'Key Pin Weight');
  }
  Skeleton.updateVisuals(main);
  if (main.render) main.render();
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
  // A NOW OPENS THE PIN RING (Scene drives it from the same button), so the old press-edge
  // CYCLE must stand down or one press would both open the wheel and step the mode behind it --
  // and the wheel would then be showing, and acting on, a state that changed underneath it.
  //
  // Left in place rather than deleted: the ring needs a scene and an XR session, and this is
  // still the path on anything that has neither. It is the fallback, not the gesture.
  if (tool._main && tool._main._vrPinRadial) return false;
  return IKSolver.togglePin(tool._main, Skeleton.hoveredJoint(tool._main));
};

// Shared with PhysicsBones, which has the same job to do — turn a solved POSITION into a joint
// rotation — and must do it the same way. Writing `_matrix` without syncThree leaves the three
// side stale, which is a trap this rig has already paid for once (see the rigging notes).
IKSolver.rotateJoint = rotateJoint;

export default IKSolver;
