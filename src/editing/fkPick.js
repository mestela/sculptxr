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

// POSE MODE takes more than FK can turn. A joint the pins own is still offered -- it was the reason
// most of a pinned body could not be picked at all (matt: "i can select the wrist pins, bones in the
// head, but everywhere else doesn't highlight") -- but it MOVES rather than turns: the drag is an IK
// drag with every pin holding, exactly what Grab does with it. And an animated prop (a bat in the
// hands) is offered too, so it can be posed and keyed beside the rig without leaving the mode. A
// prop is an object with transform keys that is not part of the rig and not the skinned body.
export function isPoseProp(main, m) {
  if (!m || m._isPinTarget || Skeleton.isJoint(m) || Skinning.isBound(m)) return false;
  if (m.isVisible && !m.isVisible()) return false;
  return !!window._animationRegistry?.tracks.get(m.getID())?.times?.length;
}

export function poseCandidates(main) {
  return main.getMeshes().filter((m) => m._isPinTarget || Skeleton.isJoint(m) || isPoseProp(main, m));
}

// The joint a pose-mode hover lights: the FK answer where there is one, else the owned joint itself.
export function poseTarget(node, bone, owned) {
  return fkTarget(node, bone, owned).joint || node;
}
