import { vec3, mat4 } from 'gl-matrix';
import { gizmoBasis } from './gizmoMath.js';

// A JOINT'S LOCAL ROTATION FRAME, GUESSED FROM THE CHAIN IT SITS IN.
//
// A joint drawn by clicking has whatever orientation the click gave it -- usually none, so its
// own axes are the world's and mean nothing about the limb. What a rotation handle should offer
// is the axes a person would reach for: ALONG the bone, and ABOUT the hinge it bends on.
//
//   X  = down the bone, towards the child. Rotating about it twists the limb.
//   Z  = the normal of the plane parent -> joint -> child. Rotating about it is the bend itself
//        (elbow, knee, neck nod). Signed so that a positive turn bends further the way the chain
//        already bends.
//   Y  = Z x X, completing a right-handed frame.
//
// A chain with a pre-made bend therefore answers by itself, which is the point: the bend IS the
// hinge, and nothing needs to be told. Where the chain is straight there is no plane, so the
// hinge is taken across the limb and across the way the character faces (+Z). A leaf has no
// outgoing bone, so it continues the incoming one and carries its parent's hinge down it.

// Below this the three joints are close enough to a line that their plane is noise. sin(8 deg).
export const BEND_MIN = Math.sin(8 * Math.PI / 180);

const norm = (v) => { const l = vec3.length(v); return l > 1e-12 ? vec3.scale(v, v, 1 / l) : null; };
const dirTo = (a, b) => norm(vec3.sub(vec3.create(), b, a));

// `tree` is the whole abstraction: { pos(id) -> vec3, parent(id) -> id | null, children(id) -> [id] }.
// Everything below is a pure function of it, so it is tested without a scene.
export function jointFrame(tree, id, memo, opts) {
  memo = memo || new Map();
  return frameOf(tree, id, memo, new Set(), opts);
}

function depth(tree, id, seen = new Set()) {
  if (seen.has(id)) return 0;
  seen.add(id);
  let d = 0;
  for (const k of tree.children(id)) d = Math.max(d, 1 + depth(tree, k, seen));
  return d;
}

// The child the chain CONTINUES to: the one that bends least from the incoming bone, or, with
// nothing coming in (a root), the one leading to the longest chain.
function primaryChild(tree, id, a) {
  const kids = tree.children(id);
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  let best = null, bestScore = -Infinity;
  for (const k of kids) {
    const d = dirTo(tree.pos(id), tree.pos(k));
    const score = a && d ? vec3.dot(a, d) : depth(tree, k);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}

function frameOf(tree, id, memo, stack, opts) {
  if (memo.has(id)) return memo.get(id);
  if (stack.has(id)) return null;
  stack.add(id);

  const p = tree.parent(id);
  const a = p != null ? dirTo(tree.pos(p), tree.pos(id)) : null;
  const k = primaryChild(tree, id, a);
  const b = k != null ? dirTo(tree.pos(id), tree.pos(k)) : null;

  const X = b || a || vec3.fromValues(1, 0, 0);

  // 1. the bend at this joint
  let Z = null, source = 'bend';
  if (a && b) {
    const n = vec3.cross(vec3.create(), a, b);
    const l = vec3.length(n);
    if (l >= BEND_MIN) Z = vec3.scale(n, n, 1 / l);
  }
  // 2. a LEAF has no outgoing bone, so it carries its parent's frame on down the same bone
  if (!Z && b == null && p != null) {
    const pf = frameOf(tree, p, memo, stack, opts);
    if (pf) { Z = vec3.clone(pf.z); source = 'inherited'; }
  }
  if (Z) {
    vec3.scaleAndAdd(Z, Z, X, -vec3.dot(Z, X));
    Z = norm(Z);
  }
  // 3. a straight joint has no plane to read, and INHERITING ONE IS WRONG HERE: the bend above a
  //    straight knee is the hip's, which is the leg swinging out sideways, not the knee's flex.
  //    So the hinge is across the limb and across the way the character faces (+Z by default):
  //    a standing leg or arm flexes about the side axis, a T-posed arm about the vertical.
  if (!Z) {
    const fwd = (opts && opts.forward) || [0, 0, 1];
    let n = vec3.cross(vec3.create(), X, fwd);
    if (vec3.length(n) < 0.2) n = vec3.cross(vec3.create(), X, [0, 1, 0]);   // limb points along forward
    Z = norm(n);
    source = 'reference';
  }
  const Y = vec3.cross(vec3.create(), Z, X);
  const out = { x: vec3.clone(X), y: Y, z: Z, source };
  memo.set(id, out);
  return out;
}

export function frameToMat4(f, out) {
  out = out || mat4.create();
  mat4.identity(out);
  out[0] = f.x[0]; out[1] = f.x[1]; out[2] = f.x[2];
  out[4] = f.y[0]; out[5] = f.y[1]; out[6] = f.y[2];
  out[8] = f.z[0]; out[9] = f.z[1]; out[10] = f.z[2];
  return out;
}

// ── the scene side ────────────────────────────────────────────────────────────────────────
//
// The frame is worked out in the REST pose (every joint's `_ikRest`, composed up the chain),
// so it does not swing about as the limb is posed -- a straightened elbow would otherwise lose
// its hinge. It is then carried to the node's CURRENT orientation through the rotation that
// joint has relative to its own rest, so it turns with the limb.

export function restModelMatrices(Skeleton, joints) {
  const memo = new Map();
  const rest = (j) => {
    if (memo.has(j)) return memo.get(j);
    const local = j._ikRest || j.getMatrix();
    let base;
    const par = j._parentMesh;
    if (par && Skeleton.isJoint(par)) base = rest(par);
    else if (par && par.getModelSpaceMatrix) base = par.getModelSpaceMatrix(mat4.create());
    else base = mat4.create();
    const m = mat4.multiply(mat4.create(), base, local);
    memo.set(j, m);
    return m;
  };
  for (const j of joints) rest(j);
  return memo;
}

// The orientation a rotation handle should be drawn in for `node` (a joint, or a pin on one),
// as a model-space mat4, or null when the node is not part of a rig.
export function gizmoFrameFor(main, node, Skeleton) {
  const joint = node && node._isPinTarget ? node._pinnedJoint : (node && Skeleton.isJoint(node) ? node : null);
  if (!joint || !Skeleton.isJoint(joint)) return null;
  const joints = Skeleton.joints(main).filter(Boolean);
  const set = new Set(joints);
  const restM = restModelMatrices(Skeleton, joints);

  const tree = {
    pos: (j) => { const m = restM.get(j); return vec3.fromValues(m[12], m[13], m[14]); },
    parent: (j) => (j._parentMesh && set.has(j._parentMesh) ? j._parentMesh : null),
    children: (j) => joints.filter((c) => c._parentMesh === j),
  };
  const f = jointFrame(tree, joint);
  if (!f) return null;

  // joint-local frame = inverse(rest orientation) * rest frame, then onto the current pose
  const Rrest = gizmoBasis(restM.get(joint));
  const Gloc = mat4.multiply(mat4.create(), mat4.invert(mat4.create(), Rrest), frameToMat4(f));
  const cur = gizmoBasis(node.getModelSpaceMatrix ? node.getModelSpaceMatrix() : node.getMatrix());
  return mat4.multiply(mat4.create(), cur, Gloc);
}

// THE BONE A JOINT AIMS ALONG, in the CURRENT pose: the child the chain continues to (least bend
// from the incoming bone; with nothing coming in, the longest chain), or null for a leaf.
// Used by the Grab tool's rotate mode, where "the selected bone" has to mean one specific child.
export function aimChild(main, joint, Skeleton) {
  const kids = Skeleton.childJoints(main, joint);
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  const pos = (j) => { const m = j.getModelSpaceMatrix(); return vec3.fromValues(m[12], m[13], m[14]); };
  const par = joint._parentMesh && Skeleton.isJoint(joint._parentMesh) ? joint._parentMesh : null;
  const here = pos(joint);
  const inc = par ? norm(vec3.sub(vec3.create(), here, pos(par))) : null;
  const depthOf = (j, seen = new Set()) => {
    if (seen.has(j)) return 0; seen.add(j);
    let d = 0; for (const c of Skeleton.childJoints(main, j)) d = Math.max(d, 1 + depthOf(c, seen)); return d;
  };
  let best = null, bestScore = -Infinity;
  for (const k of kids) {
    const d = norm(vec3.sub(vec3.create(), pos(k), here));
    const score = inc && d ? vec3.dot(inc, d) : depthOf(k);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}
