// PLACE-IN-HAND — something just created follows the controller until the trigger says where it
// goes. Used by Duplicate, which is context-aware: what gets duplicated depends on what you are
// pointing at, but WHERE IT GOES is the same gesture every time.
//
// matt: "shouldn't duplicate be context aware? if a mesh is selected, go into the
// bound-to-controller-and-drag the mesh duplicate. if a joint is selected, duplicate its chain
// and do the behavior." So this module knows nothing about what it is placing — it takes a list
// of subjects and a pair of closures for finishing or abandoning the operation, and the caller
// owns the meaning. That is what lets one gesture serve a chain and a mesh without either
// knowing about the other.
//
// WHY THIS IS NOT PART OF Grab. The obvious implementation is to hand the new thing to the grab
// tool as though the user had reached out and taken it. Grab's VR path is a per-frame state
// machine keyed on the ACTUAL trigger: a hold begins when the trigger goes down over something
// and ends when it comes up, and there is a rule that releases anything held by a hand that
// stops reporting. A synthetic hold with no trigger held is a state that machine is written to
// end, not to maintain — and here the trigger means the OPPOSITE thing, since pressing it is
// what finishes the placement rather than what sustains it. So this is its own small mode.
//
// THE STATE LIVES ON `main`, following RigPending: the visuals and the tool gate both need to
// ask "is a modal gesture running", and a second copy of that flag in here would be a second
// source of truth. This module owns the transitions.
import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';

const RigPlacing = {};

const _p = new THREE.Vector3();
const _c = mat4.create();
const _c0i = mat4.create();
const _rel = mat4.create();
const _m = mat4.create();
const _mm = new THREE.Matrix4();

// The controller's pose in MODEL space. Not world: the scene lives under `_worldGroup`, which
// carries a scale of its own, so a world-space delta applied to a model-space subject moves it by
// the wrong amount — the further that scale is from 1, the more the copy lags or outruns the
// hand. Converting the whole MATRIX rather than just the position is what makes this 6DOF:
// turning the controller has to turn what it is carrying. matt: "it should also support 6 dof
// rotation."
function controllerModel(main, worldMat, out) {
  const g = main._worldGroup;
  if (!g) return mat4.copy(out, worldMat);
  g.updateWorldMatrix(true, false);
  mat4.invert(out, g.matrixWorld.elements);
  return mat4.multiply(out, out, worldMat);
}

// MOVE ONE SUBJECT to a model-space matrix, by the route its type needs.
//
// `setModelSpaceMatrix` is the setter that stays correct once a mesh is parented — writing the
// local matrix directly would place a parented copy in its PARENT's space and send it somewhere
// else entirely. It writes `_matrix` and stops there, so a joint needs the three-side matrix
// pushed through after it or the rig reads one transform and three.js draws another: the
// two-matrices trap, which shows up as things quietly changing size rather than as an error.
function setSubject(main, m, mat) {
  m.setModelSpaceMatrix(mat);
  if (Skeleton.isJoint(m)) Skeleton.syncThree(m);
}
RigPlacing.armed = function (main) {
  return !!(main && main._rigPlacing);
};

RigPlacing.subjects = function (main) {
  return ((main && main._rigPlacing && main._rigPlacing.subjects) || []).map((e) => e.mesh);
};

// True while a placement is running OR while the press that ended one is still held. Tools ask
// this rather than `armed`, because the press that confirms arrives one frame after the mode is
// gone. Reading it is what clears it, once the trigger is actually up.
RigPlacing.blocksTool = function (main, isPressed) {
  if (!main) return false;
  if (main._rigPlacing) return true;
  if (!main._rigPlacingSwallow) return false;
  if (!isPressed) { main._rigPlacingSwallow = false; return false; }
  return true;
};

// `subjects` is what moves; `finish` is { commit, cancel }, called with `main`, and owns the undo
// story — this module deliberately has no opinion about it, since a duplicated chain and a
// duplicated mesh record themselves in quite different ways.
//
// The hand's starting position is captured on the FIRST FRAME, not here. This is called from a
// menu command, which runs on the button RELEASE that picked the sector — the controller is
// mid-gesture and its pose is not to hand at that point. Deferring one frame costs nothing and
// keeps the caller from plumbing a pose through the command list.
RigPlacing.begin = function (main, subjects, finish) {
  const list = (subjects || []).filter((e) => e && e.mesh);
  if (!main || !list.length) return false;
  main._rigPlacing = {
    subjects: list,
    finish: finish || null,
    // WHERE THE HAND WAS AND WHAT EACH SUBJECT'S TRANSFORM WAS, so everything moves BY the
    // controller's motion rather than TO its pose. Snapping the copy into the palm would throw
    // away the offset it arrived with and put it somewhere it has to be dragged back out of —
    // and on a rig the size of a hand, that is most of the way across the model. Recording one
    // origin PER SUBJECT is also what keeps a multi-selection rigid: they all take the same
    // relative motion, so their spacing and their orientations survive the move.
    hand0: null,
    start: null,
    // The trigger is very often already down when this starts — the same press that committed
    // the menu sector. Confirming on its LEVEL would end the placement on the first frame, so
    // this waits for a fresh press: down is only a confirm once the trigger has been seen up.
    triggerArmed: false,
  };
  return true;
};

// Drive one frame. Returns 'placed' when the trigger confirmed, 'placing' while it continues.
RigPlacing.update = function (main, worldMat, triggerDown) {
  const st = main && main._rigPlacing;
  if (!st) return null;

  // A subject may have gone underneath us (an undo mid-gesture), and following something no
  // longer in the scene would write matrices into a detached mesh forever.
  st.subjects = st.subjects.filter((e) => main.getIndexMesh(e.mesh) >= 0);
  if (!st.subjects.length) { main._rigPlacing = null; return null; }

  controllerModel(main, worldMat, _c);
  if (!st.hand0) {
    st.hand0 = mat4.clone(_c);
    st.start = st.subjects.map((e) => mat4.clone(e.mesh.getModelSpaceMatrix()));
    return 'placing';
  }

  // RIGIDLY ATTACHED: new = C_now * inverse(C_start) * S_start. One expression covers position
  // and orientation together, which is what "parented to the controller" actually means — and it
  // is why this is not a position delta with a rotation bolted on. Both controller matrices are
  // in model space, so the world group's scale cancels out of the product rather than having to
  // be divided out by hand.
  mat4.invert(_c0i, st.hand0);
  mat4.multiply(_rel, _c, _c0i);
  const plane = Skeleton.symmetryPlane(main);

  for (let i = 0; i < st.subjects.length; i++) {
    const e = st.subjects[i];
    const s0 = st.start[i];
    if (!s0) continue;
    mat4.multiply(_m, _rel, s0);
    setSubject(main, e.mesh, _m);

    // THE TWIN FOLLOWS THE COPY, rather than being driven by its own reflected controller. It is
    // the same answer and a shorter route: reflect the transform that was just written. And it
    // goes through Skeleton's own mirror helper, which CONJUGATES (R·M·R) rather than merely
    // pre-multiplying — reflecting a frame once leaves a left-handed basis, which is not a
    // rotation and not something a joint can hold.
    if (!e.twin || main.getIndexMesh(e.twin) < 0 || !plane) continue;
    Skeleton.mirrorModelMatrix(e.mesh, plane, _mm);
    setSubject(main, e.twin, _mm.elements);
  }
  Skeleton.updateVisuals(main);

  if (!triggerDown) { st.triggerArmed = true; return 'placing'; }
  if (!st.triggerArmed) return 'placing';   // still the press that opened the menu

  RigPlacing.confirm(main);
  return 'placed';
};

RigPlacing.confirm = function (main) {
  const st = main && main._rigPlacing;
  if (!st) return false;
  main._rigPlacing = null;
  // SWALLOW THE REST OF THIS PRESS. The trigger that confirms a placement is still held on the
  // next frame, and by then the mode is over — so the active tool saw a fresh press and acted on
  // it. In Bone Draw, which is the tool you are most likely to be holding when you duplicate a
  // chain, that meant confirming the placement immediately started drawing a new chain from
  // there. matt: "it should disable the active tool until the duplicate task is done."
  //
  // The flag has to OUTLIVE the mode, which is why it is not just `armed()`: the whole problem is
  // the frame AFTER the mode ends. Cleared when the trigger is seen up — see SculptManager.
  main._rigPlacingSwallow = true;
  try { st.finish?.commit?.(main); } catch (e) { console.log('[place] commit failed', e); }
  Skeleton.updateVisuals(main);
  main.render?.();
  return true;
};

// Back out: whatever was being placed goes away and the undo stack never hears about it.
RigPlacing.cancel = function (main) {
  const st = main && main._rigPlacing;
  if (!st) return false;
  main._rigPlacing = null;
  try { st.finish?.cancel?.(main); } catch (e) { console.log('[place] cancel failed', e); }
  Skeleton.updateVisuals(main);
  main.render?.();
  return true;
};

export default RigPlacing;
