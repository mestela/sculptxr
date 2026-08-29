// SPLIT AND DISSOLVE — the two topology verbs the rig did not have.
//
// Split inserts a joint partway along an existing bone. Dissolve removes a joint and rejoins
// its neighbours. Both are ordinary modelling verbs, and both are TOPOLOGY edits rather than
// pose edits, which is where the actual work is: a joint appearing or disappearing has to say
// what happens to the things that referred to it.
//
// LIVES IN ITS OWN MODULE because it needs Skeleton AND IKSolver, and IKSolver imports
// Skeleton — putting these in Skeleton would close that cycle and leave the whole rig undefined
// at load (see the findings doc; module_load_test reports it as "Class extends value undefined").
//
// WHAT EACH VERB OWES, and what it currently does:
//   • PARENTAGE — handled. Dissolve reparents the children to the grandparent BEFORE removing
//     the joint, which is what makes it different from Delete: Delete cascades and takes the
//     limb with it, and that is right for Delete and wrong here.
//   • THE REST POSE — handled, via setMeshParent, which rebases `_ikRest` into the new parent's
//     space. That was the bug that made any reparent explode on the next solve.
//   • PINS — a dissolved joint's pin is removed with it. Moving it to the parent was the other
//     option and is worse: a pin is a control the user placed on a SPECIFIC joint, and silently
//     re-homing it changes what the animation does without saying so.
//   • ANIMATION TRACKS — deliberately left alone. The registry is keyed by mesh id, so a
//     dissolved joint's track simply stops being evaluated, and undo brings both back together.
//     A split joint arrives with no track, which is correct: it has never been posed.
//   • SKIN WEIGHTS — NOT handled. The bind is nearest-capsule and is recomputed by Make Skin,
//     so a topology change invalidates it and the rig must be re-bound. Interpolating weights
//     through a split is the real fix and belongs with the weight work (#50), not here.
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';

const RigTopology = {};

// Everything one of these operations can disturb, captured so the whole edit is ONE undo entry.
// Presence is part of it: a snapshot that only records transforms cannot bring back a joint.
function snapshot(main, meshes) {
  return meshes.filter(Boolean).map((m) => ({
    mesh: m,
    parent: m._parentMesh || null,
    matrix: mat4.clone(m.getMatrix()),
    rest: m._ikRest ? mat4.clone(m._ikRest) : null,
    present: main.getIndexMesh(m) >= 0,
    pinnedTo: m._pinnedJoint || null,
    pinMode: m._bonePinMode,
  }));
}

function restore(main, snap) {
  // PRESENCE FIRST. A reparent needs both ends in the scene, so re-adding has to happen before
  // any parent is set — otherwise restoring a dissolve reparents children onto a joint that is
  // not there yet and they silently fall to the world.
  for (const e of snap) {
    const has = main.getIndexMesh(e.mesh) >= 0;
    if (e.present && !has) main.addMeshSilent(e.mesh);
    else if (!e.present && has) main.removeMeshSilent(e.mesh);
  }
  // PARENTS BEFORE CHILDREN. `getModelSpaceMatrix` on a parented mesh reads back through the
  // THREE world matrix, so restoring a child before its parent computes the child's world from
  // a parent that has not been put back yet — the joint lands somewhere else, and in a rig with
  // no bound mesh the scene unit is measured from the JOINT EXTENT, so every marker in the
  // skeleton resizes with it. matt, after undoing a dissolve: "all the joint spheres doubled in
  // size." Depth is counted through the snapshot's target parents, not the live graph, because
  // the live graph is mid-restore and is exactly what cannot be trusted here.
  const depthOf = (e) => {
    let d = 0;
    for (let p = e.parent; p; d++) {
      const pe = snap.find((x) => x.mesh === p);
      p = pe ? pe.parent : p._parentMesh;
      if (d > 256) break;   // a cycle cannot happen, but a restore must not hang if one does
    }
    return d;
  };
  const ordered = snap.filter((e) => e.present).sort((a, b) => depthOf(a) - depthOf(b));
  for (const e of ordered) {
    main.setMeshParent(e.mesh.getID(), e.parent ? e.parent.getID() : null, { silent: true });
    // AFTER the reparent, not before: setMeshParent rewrites the local matrix to preserve the
    // world transform, so a matrix written first would be immediately overwritten.
    mat4.copy(e.mesh.getMatrix(), e.matrix);
    Skeleton.syncThree(e.mesh);
    e.mesh._ikRest = e.rest ? mat4.clone(e.rest) : null;
    e.mesh._boneBendRef = null;
    if (e.pinnedTo !== undefined) e.mesh._pinnedJoint = e.pinnedTo;
    if (e.pinMode !== undefined) e.mesh._bonePinMode = e.pinMode;
  }
  // One top-down pass once every local matrix is back, so anything reading a world matrix
  // afterwards — the scene unit included — sees the restored hierarchy rather than a half of it.
  (main._worldGroup || main._scene)?.updateMatrixWorld?.(true);
  IKSolver.syncJointCache(main);
  IKSolver.syncPinCache(main);
  Skeleton.updateVisuals(main);
  Skeleton.refreshOutliner(main);
  main.render?.();
}

function commit(main, before, after, label) {
  main.getStateManager?.()?.pushStateCustom?.(
    () => restore(main, before), () => restore(main, after), false, label);
}

// ── SPLIT ────────────────────────────────────────────────────────────────────
//
// A bone is the segment from a joint to its PARENT, so splitting joint J inserts a new joint
// between J and J's parent, and J becomes a child of the new one. A root has no incoming bone
// and so cannot be split — refused rather than fudged, because inventing a parent for a root is
// a different operation with a different name.
RigTopology.canSplit = function (main, joint) {
  return !!(joint && Skeleton.isJoint(joint) && joint._parentMesh
    && Skeleton.isJoint(joint._parentMesh) && main.getIndexMesh(joint) >= 0);
};

RigTopology.split = function (main, joint, t) {
  if (!RigTopology.canSplit(main, joint)) {
    console.log('[rig] split refused: a root joint has no bone above it to split');
    return null;
  }
  const parent = joint._parentMesh;
  const u = Number.isFinite(t) ? Math.max(0.05, Math.min(0.95, t)) : 0.5;

  const a = Skeleton.jointPos(parent);
  const b = Skeleton.jointPos(joint);
  const pos = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };

  const before = snapshot(main, [joint]);

  // Created under the SAME parent, then the old child moves under it — so the chain reads
  // parent -> new -> joint and every joint below `joint` comes along untouched.
  const mid = Skeleton.createJoint(main, pos, parent, splitName(parent, joint), { silent: true });
  // The radius is a property of the bone, and the new joint sits inside the old one — take the
  // interpolated value rather than the default, or the chain visibly pinches at the new joint.
  if (Number.isFinite(joint._boneRadius) && Number.isFinite(parent._boneRadius)) {
    mid._boneRadius = parent._boneRadius + (joint._boneRadius - parent._boneRadius) * u;
  } else if (Number.isFinite(joint._boneRadius)) {
    mid._boneRadius = joint._boneRadius;
  }
  main.setMeshParent(joint.getID(), mid.getID(), { silent: true });

  // Rest is the pose the solver seeds from; a joint created now has none, so give it the pose
  // it was created in. Without it the first solve adopts whatever pose the rig happens to be
  // in, which makes the new joint history-dependent inside a deterministic rig.
  mid._ikRest = mat4.clone(mid.getMatrix());

  const after = snapshot(main, [joint, mid]);
  // `before` has no entry for a joint that did not exist; add one marked absent so undo removes
  // it rather than leaving it orphaned in the scene.
  before.push({ mesh: mid, parent: parent, matrix: mat4.clone(mid.getMatrix()),
    rest: mid._ikRest ? mat4.clone(mid._ikRest) : null, present: false });

  restore(main, after);   // one path for doing it and for redoing it
  commit(main, before, after, 'Split Bone');
  return mid;
};

function splitName(parent, joint) {
  // Named off the joint below it, which is the bone being split, with the side suffix kept —
  // `_L`/`_R` is load-bearing for mirror pairing, so a new joint without one silently breaks it.
  const src = joint._permanentStaticLabel || parent._permanentStaticLabel || 'bone';
  const m = /(_[LR])$/.exec(src);
  return (m ? src.slice(0, -2) : src) + '_split' + (m ? m[1] : '');
}

// ── DISSOLVE ─────────────────────────────────────────────────────────────────
//
// Remove a joint and rejoin its neighbours: every child is reparented to the grandparent, then
// the joint goes. Reparenting FIRST is the whole difference from Delete, which cascades and
// takes the limb with it.
RigTopology.canDissolve = function (main, joint) {
  return !!(joint && Skeleton.isJoint(joint) && main.getIndexMesh(joint) >= 0);
};

RigTopology.dissolve = function (main, joint) {
  if (!RigTopology.canDissolve(main, joint)) return false;
  const parent = joint._parentMesh || null;
  const kids = Skeleton.childJoints(main, joint);

  // A LEAF WITH NO PARENT IS THE WHOLE SKELETON. Dissolving it is just a delete, and Delete
  // already means that — refuse rather than quietly become a second way to spell it.
  if (!parent && !kids.length) {
    console.log('[rig] dissolve refused: that is the only joint — use Delete');
    return false;
  }

  const pin = IKSolver.pinObject(joint) || null;
  const before = snapshot(main, [joint, pin, ...kids]);

  for (const k of kids) {
    main.setMeshParent(k.getID(), parent ? parent.getID() : null, { silent: true });
  }
  // The pin goes with the joint it held. See the note at the top of this file for why it is not
  // moved to the parent instead.
  if (pin) {
    main.removeMeshSilent(pin);
    joint._boneIKPinObj = null;
    joint._bonePinMode = 0;
  }
  main.removeMeshSilent(joint);

  const after = snapshot(main, [joint, pin, ...kids]);
  restore(main, after);
  commit(main, before, after, 'Dissolve Bone');
  return true;
};

export default RigTopology;
