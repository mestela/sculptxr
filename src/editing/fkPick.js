import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';
import Skinning from './Skinning.js';

// WHAT FK POSING MAY TAKE -- one answer for every tool that turns a limb by hand (Grab's
// rotate-only mode, Transform's Pin Pose mode), because two copies of "which joints can I turn"
// is how the two would drift apart.
//
// A joint under the influence of the pins -- anything on a path from an active pin to the root --
// is rewritten by the solver on the next solve, so an FK turn of it is thrown away. Those are not
// offered. The skinned body under the rig is not offered either: with the owned joints out of the
// way, a press on a leg would fall through to the mesh behind it and drag the whole character.

// The joints the solver owns right now (a Set of ids).
export function ownedIds(main) {
  return IKSolver.solverOwnedIds(main);
}

// What may be taken at a pick: { joint, bone } -- the joint to turn and the bone to aim along it --
// or { joint: null } when nothing there is FK's to turn. The bone under the cursor is named by its
// CHILD; turning it means turning its parent, provided the solver does not own that. With no bone
// (a point pick), or the parent owned, it falls back to the picked joint itself, again only if the
// solver does not own it.
export function fkTarget(node, bone, owned) {
  const par = bone && bone._parentMesh;
  if (bone && Skeleton.isJoint(par) && !owned.has(par.getID())) return { joint: par, bone: bone };
  if (!owned.has(node.getID())) return { joint: node, bone: null };
  return { joint: null, bone: null };
}

// The meshes an FK pick may consider. Everything except a joint whose bone AND whose own point are
// both the solver's (a joint whose parent is owned but which is free itself stays in: it can still
// be the picked joint when the bone above it is not offered), and except the skinned body.
// `onlyRig` narrows it to pins and joints, for a tool that must never select anything else.
export function fkCandidates(main, owned, onlyRig) {
  return main.getMeshes().filter((m) => {
    // Pins stay in the list: they are the controls for everything the solver owns, and with the
    // owned joints no longer offered they are the thing you reach for there.
    if (Skinning.isBound(m)) return false;
    if (m._isPinTarget) return true;
    if (!Skeleton.isJoint(m)) return !onlyRig;
    const p = m._parentMesh;
    const boneFree = Skeleton.isJoint(p) && !owned.has(p.getID());
    return boneFree || !owned.has(m.getID());
  });
}
