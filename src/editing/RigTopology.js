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
import * as THREE from 'three';
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

  // SPLIT THE TWIN TOO. A rig is built symmetrically and stays that way only if every topology
  // edit is symmetric: splitting the left collarbone and not the right leaves a skeleton that no
  // longer mirrors, and every later feature that reads `_boneMirror` — pose mirroring, capsule
  // pairing, centreline rules — quietly stops working for that limb. matt: "if i split a bone,
  // it doesn't appear to mirror when it should."
  //
  // Only when the twin's own bone is splittable: a twin whose parent is not the mirror of this
  // one is not the same bone on the other side, and guessing there would be worse than not
  // mirroring at all.
  const twin = joint._boneMirror;
  const twinOk = !!(twin && RigTopology.canSplit(main, twin)
    && twin._parentMesh === (parent._boneMirror || parent));
  const targets = twinOk ? [joint, twin] : [joint];

  const before = snapshot(main, targets);
  const mids = [];

  for (const target of targets) {
    const tp = target._parentMesh;
    const ta = Skeleton.jointPos(tp);
    const tb = Skeleton.jointPos(target);
    const tpos = { x: ta.x + (tb.x - ta.x) * u, y: ta.y + (tb.y - ta.y) * u,
                   z: ta.z + (tb.z - ta.z) * u };

    // Created under the SAME parent, then the old child moves under it — so the chain reads
    // parent -> new -> joint and every joint below `joint` comes along untouched.
    const m = Skeleton.createJoint(main, tpos, tp, splitName(tp, target), { silent: true });
    // The radius is a property of the bone, and the new joint sits inside the old one — take the
    // interpolated value rather than the default, or the chain visibly pinches at the new joint.
    if (Number.isFinite(target._boneRadius) && Number.isFinite(tp._boneRadius)) {
      m._boneRadius = tp._boneRadius + (target._boneRadius - tp._boneRadius) * u;
    } else if (Number.isFinite(target._boneRadius)) {
      m._boneRadius = target._boneRadius;
    }
    main.setMeshParent(target.getID(), m.getID(), { silent: true });

    // Rest is the pose the solver seeds from; a joint created now has none, so give it the pose
    // it was created in. Without it the first solve adopts whatever pose the rig happens to be
    // in, which makes the new joint history-dependent inside a deterministic rig.
    m._ikRest = mat4.clone(m.getMatrix());
    mids.push(m);
  }

  // PAIR THE NEW JOINTS. Splitting both sides is only half of mirroring — without this link the
  // two new joints are strangers, and the next mirror-aware operation treats them as centreline
  // bones sitting improbably far off the plane.
  if (mids.length === 2) {
    mids[0]._boneMirror = mids[1];
    mids[1]._boneMirror = mids[0];
  }

  const after = snapshot(main, targets.concat(mids));
  // `before` has no entry for a joint that did not exist; add one marked absent so undo removes
  // it rather than leaving it orphaned in the scene.
  for (let i = 0; i < mids.length; i++) {
    before.push({ mesh: mids[i], parent: targets[i]._parentMesh, matrix: mat4.clone(mids[i].getMatrix()),
      rest: mids[i]._ikRest ? mat4.clone(mids[i]._ikRest) : null, present: false });
  }

  restore(main, after);   // one path for doing it and for redoing it
  commit(main, before, after, mids.length === 2 ? 'Split Bone (mirrored)' : 'Split Bone');
  return mids[0];
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

// ── DUPLICATE ────────────────────────────────────────────────────────────────
//
// Copy a joint and everything below it, under the SAME parent. Built for hands: draw one index
// finger, duplicate it three times, drag each copy into place. matt: "make one finger, copy it,
// paste paste paste to make the other fingers."
//
// THE WHOLE SUBTREE, not `chainFrom`. chainFrom deliberately stops at a fork, which is right for
// naming — a wrist that forks into fingers should name each finger separately. It is wrong here:
// duplicating a hand means duplicating its fingers too, and stopping at the fork would silently
// copy the palm alone.
//
// UNDER THE SAME PARENT, which is what makes it a sibling rather than a child. Duplicating the
// index finger's base joint has to produce a second finger off the palm; parenting the copy to
// the original would produce a finger growing out of the first finger's knuckle.
//
// MIRRORING, AND THE DISTINCTION I GOT WRONG FIRST TIME. The original version of this refused
// to mirror, reasoning that the four fingers of one hand are not each other's twins. That is
// true and it is not what mirroring means here. Two separate claims got conflated:
//
//   • "the copy is the twin of the ORIGINAL" — false, and still is. A duplicated finger is a
//     different bone, not the same bone seen from the other side. Copying `_boneMirror` across
//     would point the new finger's twin at the ORIGINAL finger's twin, and every mirror-aware
//     operation afterwards would move two unrelated joints together.
//   • "the copy gets its OWN twin on the other side" — true, and it is the whole convention of
//     this rig. With the symmetry plane on, everything you make appears on both sides; Bone Draw
//     places a mirrored joint with every joint. matt: "it should DEFINITELY support mirroring
//     like the rest of the skeleton tools."
//
// So a duplicate makes a mirrored subtree of its own, paired to the copy and to nothing else —
// exactly what Bone Draw does per joint, done per subtree.
//
// A CENTRELINE CHAIN IS NOT DUPLICATED TWICE. A joint on the plane is its own twin, so mirroring
// a spine would stack a second spine on top of the first. Same test Bone Draw uses: off-plane
// joints get a mirror, on-plane ones do not.
RigTopology.canDuplicate = function (main, joint) {
  return !!(joint && Skeleton.isJoint(joint) && main.getIndexMesh(joint) >= 0);
};

// Parents before children, so a copy's parent always exists by the time it is created.
function subtree(main, root) {
  const out = [];
  const walk = [root];
  while (walk.length) {
    const j = walk.shift();
    out.push(j);
    for (const k of Skeleton.childJoints(main, j)) if (Skeleton.isJoint(k)) walk.push(k);
    if (out.length > 4096) break;   // a cycle cannot happen, but this must not hang if one does
  }
  return out;
}

// WHERE THE COPY LANDS. Not on top of the original: two chains at identical positions cannot be
// told apart by eye OR by the pick, so the first thing you did would be to grab the wrong one.
// Offset by the bone's own thickness along world X, which is the symmetry normal and therefore
// the across-the-hand direction on a rig built the usual way — the direction the next finger
// goes. It is a starting position to drag from, not a guess at the answer.
function dupOffset(main, root) {
  const r = root._boneRadius || Skeleton.sceneUnit(main) * 0.05;
  return { x: r * 2, y: 0, z: 0 };
}

// `opts.defer` withholds the undo entry and hands the caller the two snapshots instead, so a
// duplicate that is about to be DRAGGED somewhere can be one undo step rather than two. Pressing
// undo once after "duplicate, place it" must remove the copy — landing on the intermediate state,
// a chain sitting at the arbitrary offset nobody chose, would be showing a rig nobody built.
// See RigPlacing, and commitDeferred / cancelDeferred below.
// One copied joint, with everything that makes it the same SHAPE as its source. createJoint
// measures a default radius from the new bone's length, which is the right default for a joint
// being drawn and the wrong one here — a duplicate that silently re-derives its own thickness is
// not a duplicate. The joint shape fields are the Tweak Joint work, and a finger shaped by hand
// is exactly the thing worth copying.
//
// `plane` mirrors the SHAPE for a twin: POSITIONS REFLECT, SIZES COPY, which is the rule the
// joint-shape work settled. `_jointScale` is three half-extents and copies unchanged; the offset
// is a direction from the joint centre and has to be reflected, or a joint nudged towards the
// thumb comes out nudged away from it on the other hand.
function copyJoint(main, src, pos, parent, name, plane) {
  const c = Skeleton.createJoint(main, pos, parent, name, { silent: true });
  if (Number.isFinite(src._boneRadius)) c._boneRadius = src._boneRadius;
  if (Number.isFinite(src._jointRadius)) c._jointRadius = src._jointRadius;
  if (src._jointScale) c._jointScale = src._jointScale.slice();
  if (src._jointOffset) {
    const o = src._jointOffset;
    if (plane) {
      const n = plane.normal;
      const d = 2 * (o[0] * n.x + o[1] * n.y + o[2] * n.z);
      c._jointOffset = [o[0] - d * n.x, o[1] - d * n.y, o[2] - d * n.z];
    } else {
      c._jointOffset = o.slice();
    }
  }
  // The pose the solver seeds from. A joint created now has none, and without it the first solve
  // adopts whatever pose the rig happens to be in — same reason as Split.
  c._ikRest = mat4.clone(c.getMatrix());
  return c;
}

// Swap the _L/_R a label carries, since the twin is on the other side. A name that keeps the
// source's suffix is a name that lies, and the suffix is load-bearing for mirror pairing.
function flipSide(name) {
  if (!name) return name;
  const m = /(_[LR])$/.exec(name);
  if (!m) return name + '_R';
  return name.slice(0, -2) + (m[1] === '_L' ? '_R' : '_L');
}

RigTopology.duplicate = function (main, joint, opts) {
  if (!RigTopology.canDuplicate(main, joint)) {
    console.log('[rig] duplicate refused: not a joint in the scene');
    return null;
  }
  const src = subtree(main, joint);
  const off = dupOffset(main, joint);
  const copies = new Map();   // original -> copy
  const twins = new Map();    // original -> mirrored copy
  const made = [];

  // MIRROR ONLY WHEN THE PLANE IS LIVE AND THE CHAIN IS OFF IT. `symmetryPlane` already returns
  // null when symmetry is switched off, so this one test covers both halves of the question.
  const plane = Skeleton.symmetryPlane(main);
  const rootAt = Skeleton.jointPos(joint);
  const doMirror = !!(plane && Math.abs(Skeleton.planeDistance(rootAt, plane)) > 1e-6);

  for (const s of src) {
    const p = Skeleton.jointPos(s);
    const at = { x: p.x + off.x, y: p.y + off.y, z: p.z + off.z };
    // The root's copy goes under the ROOT'S parent; everything else goes under its own copied
    // parent, which `copies` already holds because subtree() is parents-first.
    const parent = (s === joint) ? (s._parentMesh || null) : copies.get(s._parentMesh);
    const name = s._permanentStaticLabel || null;
    const c = copyJoint(main, s, at, parent, name, null);
    copies.set(s, c);
    made.push(c);

    if (!doMirror) continue;
    const mAt = Skeleton.mirrorPoint(new THREE.Vector3(at.x, at.y, at.z), plane);
    // The twin's parent is the twin of this joint's parent when there is one, and otherwise the
    // same parent the copy hangs off — which is what a chain rooted on the centreline needs, and
    // is the rule Bone Draw uses for the first mirrored joint of a chain.
    const tParent = (s === joint)
      ? ((parent && parent._boneMirror) || parent)
      : twins.get(s._parentMesh);
    const t = copyJoint(main, s, mAt, tParent, flipSide(name), plane);
    t._boneMirror = c;
    c._boneMirror = t;
    twins.set(s, t);
    made.push(t);
  }

  // Undo has to REMOVE joints that did not exist before, so `before` carries an absent entry for
  // each one; `after` is the live state of the copies. The originals are untouched by this
  // operation and so appear in neither.
  const before = made.map((c) => ({
    mesh: c, parent: c._parentMesh || null, matrix: mat4.clone(c.getMatrix()),
    rest: c._ikRest ? mat4.clone(c._ikRest) : null, present: false,
  }));
  const after = snapshot(main, made);

  restore(main, after);   // one path for doing it and for redoing it

  // SELECT THE COPY, so the very next thing you do acts on what you just made rather than on
  // what you made it from — you duplicated it in order to move it.
  const root = copies.get(joint);
  try { main.setMesh?.(root, true); } catch (_) {}

  if (opts && opts.defer) {
    return { root: root, twin: twins.get(joint) || null, before: before, made: made };
  }
  commit(main, before, after,
    (doMirror ? 'Duplicate Chain (mirrored)' : (made.length > 1 ? 'Duplicate Chain' : 'Duplicate Joint')));
  return root;
};

// Close a deferred duplicate, pushing ONE undo entry covering both the copy and wherever it was
// finally put. `after` is taken FRESH rather than reused from duplicate(): the whole point of
// deferring is that the joints have moved since, and redo has to land them where they ended up.
RigTopology.commitDeferred = function (main, pending, label) {
  if (!main || !pending || !pending.made) return false;
  const after = snapshot(main, pending.made);
  commit(main, pending.before, after, label || 'Duplicate Chain');
  return true;
};

// Abandon a deferred duplicate: put the world back and push NOTHING. An undo entry for an
// operation the user cancelled is an entry for an event that, as far as they are concerned,
// never happened — and it would sit on the stack shadowing the edit they actually want back.
RigTopology.cancelDeferred = function (main, pending) {
  if (!main || !pending || !pending.before) return false;
  restore(main, pending.before);
  return true;
};
