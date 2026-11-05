import { mat4, quat } from 'gl-matrix';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';
import PhysicsBones from './PhysicsBones.js';
import Skinning from './Skinning.js';
import PosedSymmetry from './PosedSymmetry.js';

// NAMED SKELETON POSES, the rig's version of the face tool's pose library (AnimationRegistry.savePose).
//
// A pose is each joint RELATIVE TO ITS REST: rest^-1 * local. Not the local matrix itself, because Tweak
// re-records the rest when a joint is moved, and an absolute matrix would put the joint back where it
// was when the pose was saved. A joint the pose doesn't know (drawn since) goes to its rest.
//
// Applying one is a macro over the joints, like Rest Pose: no keys or curves of its own. Pins stay as they
// are but move onto their joints, or the next solve would pull the pose straight back to the old anchors.
// On an animated rig it lasts until the playhead moves, unless keyed (IKSolver.beginPoseHold).
//
// `main._rigPoses` is name -> Map(joint -> relative matrix), in order. Saved in the SKEL block (v30).
const RigPoses = {};

const library = (main) => main._rigPoses || (main._rigPoses = new Map());

// A pose whose skeleton has gone (a cleared scene, say) isn't listed. Kept, not deleted: undoing the
// deletion of that skeleton brings the same joint objects, and so the pose, back.
RigPoses.names = function (main) {
  const joints = new Set(Skeleton.joints(main));
  const out = [];
  for (const [name, pose] of library(main)) {
    for (const j of pose.keys()) if (joints.has(j)) { out.push(name); break; }
  }
  return out;
};

RigPoses.nextName = function (main) {
  const names = RigPoses.names(main);
  let i = names.length + 1;
  while (names.includes('pose' + i)) i++;
  return 'pose' + i;
};

function capture(main) {
  const pose = new Map();
  const inv = mat4.create();
  for (const j of Skeleton.joints(main)) {
    if (!j._ikRest) continue;     // no rest recorded yet: nothing to be relative to, as for Rest Pose
    if (!mat4.invert(inv, j._ikRest)) continue;
    pose.set(j, mat4.multiply(new Float32Array(16), inv, j.getMatrix()));
  }
  return pose;
}

function edit(main, fn, label, doAlso, undoAlso) {
  const before = new Map(library(main));
  const after = new Map(before);
  fn(after);
  const put = (m, also) => { main._rigPoses = new Map(m); also?.(); window._refreshRigPoses?.(); };
  put(after, doAlso);
  main.getStateManager?.()?.pushStateCustom?.(() => put(before, undoAlso), () => put(after, doAlso), false, label);
}

// Map.set on an existing name keeps its place, so an update stays where it was in the list.
RigPoses.save = function (main, name, label = 'Save Rig Pose') {
  if (!name) return false;
  const pose = capture(main);
  if (!pose.size) return false;
  edit(main, (m) => m.set(name, pose), label);
  return true;
};

RigPoses.update = function (main, name) {
  return library(main).has(name) && RigPoses.save(main, name, 'Update Rig Pose');
};

// Same position in the list. False for an empty name or one already taken.
RigPoses.rename = function (main, oldName, newName) {
  const lib = library(main);
  if (!lib.has(oldName) || !newName || lib.has(newName)) return false;
  const was = layersOf(main, oldName);
  edit(main, (m) => {
    const entries = [...m.entries()].map(([n, p]) => [n === oldName ? newName : n, p]);
    m.clear();
    for (const [n, p] of entries) m.set(n, p);
  }, 'Rename Rig Pose', () => { dropLayers(main, oldName); putLayers(main, newName, was); },
  () => { dropLayers(main, newName); putLayers(main, oldName, was); });
  return true;
};

RigPoses.remove = function (main, name) {
  if (!library(main).has(name)) return false;
  const was = layersOf(main, name);
  edit(main, (m) => m.delete(name), 'Delete Rig Pose', () => dropLayers(main, name), () => putLayers(main, name, was));
  return true;
};

// One undo step, and the same steps Rest Pose takes to stop physics or a solve undoing it. Returns the
// joints set, or 0 for no such pose. Refused while the bind pose is held: that hold owns the rig.
RigPoses.apply = function (main, name) {
  const pose = library(main).get(name);
  if (!pose || window._bindPoseHold) return 0;
  const joints = Skeleton.joints(main);
  const pins = IKSolver.pinnedJoints(main)
    .map((j) => [j, IKSolver.pinObject(j)])
    .filter(([, p]) => !!p);
  const objects = joints.concat(pins.map(([, p]) => p));
  const before = objects.map((m) => [m, mat4.clone(m.getMatrix())]);

  PhysicsBones.clearRest(main);
  PhysicsBones.reset(main);
  let n = 0;
  for (const j of joints) {
    if (!j._ikRest) continue;
    const rel = pose.get(j);
    if (rel) mat4.multiply(j.getMatrix(), j._ikRest, rel);
    else mat4.copy(j.getMatrix(), j._ikRest);
    j._boneBendRef = null;
    Skeleton.syncThree(j);
    n++;
  }
  for (const [j, pin] of pins) {
    pin.setModelSpaceMatrix(j.getModelSpaceMatrix());
    Skeleton.syncThree(pin);
  }
  IKSolver.syncJointCache(main);
  IKSolver.syncPinCache(main);
  window._physicsNeedsInit = true;
  Skeleton.updateVisuals?.(main);

  const after = objects.map((m) => [m, mat4.clone(m.getMatrix())]);
  const hold = IKSolver.beginPoseHold(main, before);
  const put = (snap, h) => {
    Skeleton.restoreLocal(snap);
    IKSolver.setPoseHold(main, h);
    IKSolver.syncJointCache(main);
    IKSolver.syncPinCache(main);
    window._physicsNeedsInit = true;
    Skeleton.updateVisuals?.(main);
    main.render?.();
  };
  main.getStateManager?.()?.pushStateCustom?.(() => put(before, hold.was), () => put(after, hold.now), false, 'Apply Rig Pose');
  main.render?.();
  return n;
};

// KEY THE RIG AS IT STANDS, as one undo step: a pose just applied, or one nudged since. Every joint, as a
// joint with no key here drifts between its neighbours' keys and out of the pose. Every pin, as a pin with
// a keyed path pulls the limb back onto it, and one with none holds still while the joints key away from it.
RigPoses.keyRig = function (main, time) {
  const reg = window._animationRegistry;
  if (!reg) return 0;
  const pins = IKSolver.pinnedJoints(main).map((j) => IKSolver.pinObject(j)).filter(Boolean);
  return reg.addKeysForMeshes(Skeleton.joints(main).concat(pins), time, 'transform');
};

// ---- correctives ---------------------------------------------------------------------------
//
// SCULPT ON A SAVED POSE AND THE STROKE BELONGS TO THAT POSE. A pose's own crease can't be fixed in the
// rest shape: the fix is the opposite of the crease, which at rest is a dent. So strokes on a saved pose
// go into a shape layer whose weight comes from the rig (pose-space deformation).
//
// AN ORDINARY LAYER, `pose:<name>`, in rest space under the skin like any other, so the composite, the
// mush, undo and the .sxr all need nothing new. Only its weight is different.
//
// PLUS DETAILS OF ITS OWN ABOVE THE BOUND LEVEL. The layer has the bound level's vertices, and most of a
// fine stroke (Smooth kept .15 of .92) goes in the levels above. `track.correctiveDetails` is layer name ->
// level -> detail array, and `level._detailsFix` is their weighted sum, added to the level's own details
// when it draws and taken off when it measures. Kept apart, as details folded back through a sum would
// drift, and each stroke re-derives every detail on the level.
const LAYER = 'pose:';
RigPoses.LAYER = LAYER;
RigPoses.MAX_NAME = 32 - LAYER.length;   // a shape's name in the .sxr holds 32 characters
const layerName = (name) => LAYER + name;

// HOW FAR A JOINT HAS TO BE TURNED BY A POSE TO BE PART OF IT, in radians. The rest is solver settling.
const CHANGED = 0.03;
// WHEN YOU ARE "ON" A POSE: the weight it would get here. Relative to how far the pose turns each joint,
// not an angle: two keys holding a pose still bulge between them, and a joint a pose turns 2.53 drifted .50
// in the hold on skelpose_v03 and .096 one frame off the key. A limit of .06 said "rest" on all but the key
// frames. The worst share of a pose seen in a hold was .22, weight .87; .75 allows a share of about .33.
const ON_WEIGHT = 0.75;
// Weights this close count as level, and the pose with more joints wins.
const LEVEL = 0.05;
// A CHANGE IN A DETAIL THIS SMALL AGAINST THE LARGEST ONE ISN'T PART OF THE STROKE.
const NOISE = 1e-3;

const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(quat.dot(a, b))));
const _q = quat.create(), _inv = mat4.create(), _rel = mat4.create(), _none = quat.create();

const changedCache = new WeakMap();
function changedJoints(pose) {
  let rows = changedCache.get(pose);
  if (rows) return rows;
  rows = [];
  for (const [j, rel] of pose) {
    const q = mat4.getRotation(quat.create(), rel);
    quat.normalize(q, q);
    const a = angle(q, _none);
    if (a >= CHANGED) rows.push({ j, q, a });
  }
  changedCache.set(pose, rows);
  return rows;
}
function jointAngle(r) {
  if (!r.j._ikRest || !mat4.invert(_inv, r.j._ikRest)) return 0;
  mat4.multiply(_rel, _inv, r.j.getMatrix());
  mat4.getRotation(_q, _rel);
  quat.normalize(_q, _q);
  return angle(_q, r.q);
}

// 1 ON THE POSE, 0 AT REST, by the joints THIS POSE CHANGES and no others: bending a knee mustn't fade a
// shoulder's fix. The lowest of them, as a pose is all of its joints at once. Eased at both ends.
RigPoses.weight = function (pose) {
  const rows = changedJoints(pose);
  if (!rows.length) return 0;
  let w = 1;
  for (const r of rows) {
    const t = 1 - jointAngle(r) / r.a;
    if (t <= 0) return 0;
    w = Math.min(w, t * t * (3 - 2 * t));
  }
  return w;
};

// THE POSE THE RIG IS ON, or null. Null while the bind pose is held. The closest if several fit, and of
// those level, the one with most joints, as the fuller description of what's on screen.
RigPoses.active = function (main) {
  const lib = main._rigPoses;
  if (!lib || !lib.size || window._bindPoseHold) return null;
  let best = null, most = 0;
  for (const name of RigPoses.names(main)) {
    const pose = lib.get(name), n = changedJoints(pose).length;
    const w = RigPoses.weight(pose);
    if (w < ON_WEIGHT) continue;
    if (best && (w < best.w - LEVEL || (w <= best.w + LEVEL && n <= most))) continue;
    best = { name, w };
    most = n;
  }
  return best;
};

// The bound meshes' layers for a pose, for undo and for putting them back under another name.
function layersOf(main, name) {
  const reg = window._animationRegistry, out = [];
  if (!reg) return out;
  for (const m of main.getMeshes?.() || []) {
    const t = reg.tracks.get(m.getID());
    const d = t && t.blendshapes && t.blendshapes.get(layerName(name));
    if (d) out.push({ m, t, d, bt: t.blendshapeTracks.get(layerName(name)), fix: t.correctiveDetails?.get(layerName(name)) });
  }
  return out;
}
function refresh(m) { composeDetails(m); window._animationRegistry?.applyBlendshapes(m); }

// `level._detailsFix` from the fixes and their weights. Null where there's nothing to add.
function composeDetails(m) {
  const t = window._animationRegistry?.tracks?.get(m.getID());
  const all = t && t.correctiveDetails;
  for (const lvl of m._meshes || []) {
    let sum = null;
    for (const [key, levels] of all || []) {
      const arr = levels.get(lvl), w = t.correctiveW?.get(key) || 0;
      if (!arr || w <= 0) continue;
      if (!sum) { sum = lvl._detailsFix && lvl._detailsFix.length === arr.length ? lvl._detailsFix : new Float32Array(arr.length); sum.fill(0); }
      for (let i = 0; i < arr.length; i++) sum[i] += w * arr[i];
    }
    lvl._detailsFix = sum;
  }
  m._skinDirty = true;
}
Skinning.composeFixDetails = composeDetails;

// What a stroke on the pose changed in the details (Skinning's edit records) goes into the fix, at full
// weight as the composite multiplies it back. Returns the records for the stroke's undo, on the fix's arrays.
Skinning.addFixDetails = function (mesh, on, edits) {
  const t = window._animationRegistry.tracks.get(mesh.getID());
  const all = t.correctiveDetails || (t.correctiveDetails = new Map());
  const key = layerName(on.name);
  const levels = all.get(key) || new Map();
  all.set(key, levels);
  const out = edits.map((e) => {
    const arr = levels.get(e.lvl) || new Float32Array(e.lvl._detailsXYZ.length);
    levels.set(e.lvl, arr);
    // Re-deriving every detail on the level moves most of them a hair (under .0001 for 7000 of 9500 here).
    // That isn't the stroke, and a fix would collect it from each one.
    let most = 0;
    for (let k = 0; k < e.idx.length * 3; k++) most = Math.max(most, Math.abs(e.now[k] - e.was[k]));
    const idx = [], was = [], now = [];
    for (let k = 0; k < e.idx.length; k++) {
      const k3 = k * 3;
      const dx = e.now[k3] - e.was[k3], dy = e.now[k3 + 1] - e.was[k3 + 1], dz = e.now[k3 + 2] - e.was[k3 + 2];
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < most * NOISE) continue;
      const i = e.idx[k];
      idx.push(i);
      was.push(arr[i], arr[i + 1], arr[i + 2]);
      arr[i] += dx / on.w; arr[i + 1] += dy / on.w; arr[i + 2] += dz / on.w;
      now.push(arr[i], arr[i + 1], arr[i + 2]);
    }
    return { lvl: e.lvl, arr, idx, was, now };
  });
  (t.correctiveW || (t.correctiveW = new Map())).set(key, on.w);
  composeDetails(mesh);
  return out;
};
function dropLayers(main, name) {
  const key = layerName(name);
  for (const { m, t } of layersOf(main, name)) {
    t.blendshapes.delete(key);
    t.blendshapeTracks.delete(key);
    t.correctiveW?.delete(key);
    t.correctiveDetails?.delete(key);
    refresh(m);
  }
}
function putLayers(main, name, rows) {
  const key = layerName(name);
  for (const { m, t, d, bt, fix } of rows) {
    t.blendshapes.set(key, d);
    t.blendshapeTracks.set(key, bt);
    (t.correctiveW || (t.correctiveW = new Map())).set(key, -1);
    if (fix) (t.correctiveDetails || (t.correctiveDetails = new Map())).set(key, fix);
    refresh(m);
  }
}

RigPoses.hasCorrective = (main, name) => layersOf(main, name).length > 0;

// SET THE LAYERS' WEIGHTS FROM THE RIG, once a frame before the skin pass. Recomposes only a mesh whose
// weights moved, so a still rig costs a few quaternions. -1 means never set, which is how a loaded
// file gets its composite on the first frame.
RigPoses.drive = function (main) {
  const lib = main._rigPoses, reg = window._animationRegistry;
  const on = lib && lib.size ? RigPoses.active(main) : null;
  if (RigPoses._shownOn !== (on ? on.name : null)) {
    RigPoses._shownOn = on ? on.name : null;
    window._rigSculptInto?.(RigPoses._shownOn);
  }
  if (!lib || !lib.size || !reg) return;
  for (const m of main.getMeshes() || []) {
    if (!m._skinW) continue;
    const t = reg.tracks.get(m.getID());
    if (!t || !t.blendshapes) continue;
    let moved = false;
    for (const key of t.blendshapes.keys()) {
      if (!key.startsWith(LAYER)) continue;
      const pose = lib.get(key.slice(LAYER.length));
      const w = pose ? RigPoses.weight(pose) : 0;
      const W = t.correctiveW || (t.correctiveW = new Map());
      const was = W.has(key) ? W.get(key) : -1;
      if (Math.abs(w - was) > 1e-3) { W.set(key, w); moved = true; }
    }
    if (moved) refresh(m);
  }
};

// WHERE A STROKE ON THIS MESH GOES, for the commit. Null means rest.
function correctiveFor(main, mesh) {
  return mesh && mesh._skinW ? RigPoses.active(main) : null;
}

// The layer's array, made on first use. Not createBlendshape: that takes the base from what's on screen,
// which here is posed, and locks it, which would stop this skin being sculpted at rest.
function ensureLayer(main, mesh, on) {
  const reg = window._animationRegistry;
  if (!reg) return null;
  const id = mesh.getID();
  if (!reg.tracks.has(id)) {
    reg.tracks.set(id, { times: [], positions: [], quaternions: [], scales: [],
      shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now() });
  }
  const t = reg.tracks.get(id);
  if (!t.blendshapes) t.blendshapes = new Map();
  if (!t.blendshapeTracks) t.blendshapeTracks = new Map();
  if (!t.baseShape) {
    t.baseShape = new Float32Array(mesh._skinSrc);
    t._bsNbVertices = t.baseShape.length / 3;
  }
  const key = layerName(on.name);
  let d = t.blendshapes.get(key);
  if (!d) {
    d = new Float32Array(t.baseShape.length);
    t.blendshapes.set(key, d);
    t.blendshapeTracks.set(key, { times: [], values: [] });
    (t.correctiveW || (t.correctiveW = new Map())).set(key, on.w);
  }
  return { track: t, arr: d };
}
Skinning.correctiveFor = correctiveFor;
Skinning.ensureCorrective = ensureLayer;
Skinning.beforePass = RigPoses.drive;

// BAKE TO REST: the fix applies in every pose after all. The right escape from having sculpted on a pose
// when you meant the model, so a wrong choice costs one button. Undoable as one step.
RigPoses.bake = function (main, name) {
  const rows = layersOf(main, name);
  if (!rows.length) return 0;
  const snaps = rows.map((r) => ({ ...r, base: r.t.baseShape.slice(), rest: r.m._skinRest.slice(),
    details: [...(r.fix || new Map()).keys()].filter((l) => l._detailsXYZ).map((l) => [l, l._detailsXYZ.slice()]) }));
  const doIt = () => {
    for (const r of snaps) {
      const n = Math.min(r.t.baseShape.length, r.d.length);
      for (let i = 0; i < n; i++) {
        r.t.baseShape[i] += r.d[i];
        if (i < r.m._skinRest.length) r.m._skinRest[i] += r.d[i];
      }
      for (const [lvl] of r.details) {
        const from = r.fix.get(lvl);
        for (let i = 0; i < from.length; i++) lvl._detailsXYZ[i] += from[i];
      }
      r.t._bsRev = (r.t._bsRev | 0) + 1;
    }
    dropLayers(main, name);
    window._refreshRigPoses?.();
  };
  const undo = () => {
    for (const r of snaps) {
      r.t.baseShape.set(r.base);
      r.m._skinRest.set(r.rest);
      for (const [lvl, was] of r.details) lvl._detailsXYZ.set(was);
      r.t._bsRev = (r.t._bsRev | 0) + 1;
    }
    putLayers(main, name, snaps);
    window._refreshRigPoses?.();
  };
  doIt();
  main.getStateManager?.()?.pushStateCustom?.(undo, doIt, false, 'Bake Corrective to Rest');
  return rows.length;
};

// CLEAR: throw the fix away and keep the pose.
RigPoses.clear = function (main, name) {
  const rows = layersOf(main, name);
  if (!rows.length) return 0;
  const doIt = () => { dropLayers(main, name); window._refreshRigPoses?.(); };
  const undo = () => { putLayers(main, name, rows); window._refreshRigPoses?.(); };
  doIt();
  main.getStateManager?.()?.pushStateCustom?.(undo, doIt, false, 'Clear Corrective');
  return rows.length;
};

// A NEW POSE, THE REFLECTION OF THIS ONE, with its correctives reflected too. So a fix made on one side
// doesn't have to be sculpted again on the other. Each joint's model matrix is conjugated by the plane
// (P M P) and handed to its twin, as Skeleton.mirrorPose does, but computed without moving the rig.
function modelMatrices(pose, joints) {
  const out = new Map();
  const of = (j) => {
    if (out.has(j)) return out.get(j);
    const local = mat4.create();
    if (j._ikRest) mat4.multiply(local, j._ikRest, pose.get(j) || mat4.create());
    else mat4.copy(local, j.getMatrix());
    const p = j._parentMesh;
    const parent = joints.has(p) ? of(p) : (p && p.getModelSpaceMatrix ? p.getModelSpaceMatrix() : mat4.create());
    const m = mat4.multiply(mat4.create(), parent, local);
    out.set(j, m);
    return m;
  };
  for (const j of joints) of(j);
  return out;
}
function mirroredPose(pose, joints, P) {
  const model = modelMatrices(pose, joints);
  const mirrored = new Map();
  for (const t of joints) {
    const src = t._boneMirror && joints.has(t._boneMirror) ? t._boneMirror : t;
    const m = mat4.multiply(mat4.create(), P, model.get(src));
    mat4.multiply(m, m, P);
    mirrored.set(t, m);
  }
  const out = new Map();
  for (const t of joints) {
    if (!t._ikRest) continue;
    const p = t._parentMesh;
    const parent = joints.has(p) ? mirrored.get(p) : (p && p.getModelSpaceMatrix ? p.getModelSpaceMatrix() : mat4.create());
    const inv = mat4.invert(mat4.create(), parent), restInv = mat4.invert(mat4.create(), t._ikRest);
    if (!inv || !restInv) continue;
    const rel = mat4.multiply(new Float32Array(16), restInv, mat4.multiply(mat4.create(), inv, mirrored.get(t)));
    out.set(t, rel);
  }
  return out;
}
// EACH VERTEX ASKS WHAT ITS MIRROR POSITION HAS. Pushing each moved vertex across instead left holes: a
// rest shape is rarely exactly symmetric, so two can land on one and a neighbour gets nothing.
function nearestVertex(p) {
  const nb = (p.length / 3) | 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, top = 0;
  for (let i = 0; i < nb; i++) { x0 = Math.min(x0, p[i * 3]); y0 = Math.min(y0, p[i * 3 + 1]); z0 = Math.min(z0, p[i * 3 + 2]); }
  for (let i = 0; i < nb; i++) top = Math.max(top, p[i * 3] - x0, p[i * 3 + 1] - y0, p[i * 3 + 2] - z0);
  const cell = (top || 1) / Math.max(1, Math.cbrt(nb)), key = (a, b, c) => a + b * 4096 + c * 16777216;
  const cells = new Map();
  for (let i = 0; i < nb; i++) {
    const k = key(((p[i * 3] - x0) / cell) | 0, ((p[i * 3 + 1] - y0) / cell) | 0, ((p[i * 3 + 2] - z0) / cell) | 0);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  return (x, y, z) => {
    const cx = Math.floor((x - x0) / cell), cy = Math.floor((y - y0) / cell), cz = Math.floor((z - z0) / cell);
    let b = -1, bd = Infinity;
    // Out a shell at a time, until nothing further out can be nearer.
    for (let r = 0; r * cell <= top * 2 && (b < 0 || (r - 1) * (r - 1) * cell * cell < bd); r++) {
      for (let a = cx - r; a <= cx + r; a++) for (let c = cy - r; c <= cy + r; c++) for (let e = cz - r; e <= cz + r; e++) {
        if (Math.max(Math.abs(a - cx), Math.abs(c - cy), Math.abs(e - cz)) !== r || a < 0 || c < 0 || e < 0) continue;
        for (const i of cells.get(key(a, c, e)) || []) {
          const ax = p[i * 3] - x, ay = p[i * 3 + 1] - y, az = p[i * 3 + 2] - z, d = ax * ax + ay * ay + az * az;
          if (d < bd) { bd = d; b = i; }
        }
      }
    }
    return b;
  };
}
function mirrorDelta(n, o, base, d) {
  const out = new Float32Array(d.length), nb = (base.length / 3) | 0;
  // Only near what the fix moved.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let reach = 0;
  for (let i = 0; i < nb; i++) {
    const l = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
    if (l === 0) continue;
    reach = Math.max(reach, l);
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], base[i * 3 + c]); hi[c] = Math.max(hi[c], base[i * 3 + c]); }
  }
  if (!reach) return out;
  const nearest = nearestVertex(base);
  for (let k = 0; k < nb; k++) {
    const k3 = k * 3;
    const s = 2 * ((base[k3] - o[0]) * n[0] + (base[k3 + 1] - o[1]) * n[1] + (base[k3 + 2] - o[2]) * n[2]);
    const x = base[k3] - s * n[0], y = base[k3 + 1] - s * n[1], z = base[k3 + 2] - s * n[2];
    if (x < lo[0] - reach || x > hi[0] + reach || y < lo[1] - reach || y > hi[1] + reach || z < lo[2] - reach || z > hi[2] + reach) continue;
    const b3 = nearest(x, y, z) * 3, sd = 2 * (d[b3] * n[0] + d[b3 + 1] * n[1] + d[b3 + 2] * n[2]);
    out[k3] = d[b3] - sd * n[0]; out[k3 + 1] = d[b3 + 1] - sd * n[1]; out[k3 + 2] = d[b3 + 2] - sd * n[2];
  }
  return out;
}
function levelNormals(l) {
  l.updateFacesAabbAndNormal(undefined, true);
  l.updateVerticesNormal();
}
// A FIX'S DETAILS, REFLECTED. A detail is written in its own vertex's surface frame, and the frames either
// side of the plane aren't reflections of each other, so the numbers can't just be copied across. So do it
// as surfaces: build the levels at rest without the fix and with it, reflect the difference, and measure what
// details would make that. Everything the levels hold is put back after.
function mirrorDetails(r, n, o, md) {
  const m = r.m, stack = m._meshes, fix = r.fix;
  if (!stack || !fix || !fix.size) return null;
  const from = stack.indexOf(m._skinLevelMesh || stack[m._skinLevel | 0]);
  let to = from;
  for (const l of fix.keys()) to = Math.max(to, stack.indexOf(l));
  if (from < 0 || to <= from) return null;
  const rows = stack.slice(from, to + 1).map((l) => ({ l, v: l.getVertices().slice(), n: l.getNormals().slice(), f: l._detailsFix, d: l._detailsXYZ && l._detailsXYZ.slice() }));
  if (rows.some((x, i) => i && !x.d)) return null;
  const put = (a, b) => a.set(b);
  const build = (shape, withFix) => {
    put(rows[0].l.getVertices(), shape);
    levelNormals(rows[0].l);
    return rows.map((x, i) => {
      if (i) {
        x.l._detailsFix = withFix ? fix.get(x.l) || null : null;
        // twice, as details are oriented by the level's own normals
        for (let k = 0; k < 2; k++) { x.l.higherSynthesis(rows[i - 1].l); levelNormals(x.l); }
      }
      return x.l.getVertices().slice(0, x.l.getNbVertices() * 3);
    });
  };
  const nb0 = r.t.baseShape.length, on0 = new Float32Array(nb0), to0 = new Float32Array(nb0);
  for (let i = 0; i < nb0; i++) { on0[i] = r.t.baseShape[i] + r.d[i]; to0[i] = r.t.baseShape[i] + md[i]; }
  const off = build(r.t.baseShape, false);
  // What the same measurement reads with no fix at all, as it doesn't quite return the details it was given.
  const plain = rows.map((x, i) => {
    if (!i) return null;
    rows[i - 1].l.analyseUp(x.l);
    const got = x.l._detailsXYZ.slice();
    x.l._detailsXYZ.set(x.d);
    return got;
  });
  const on = build(on0, true);
  const out = new Map();
  put(rows[0].l.getVertices(), to0);
  levelNormals(rows[0].l);
  rows.forEach((x, i) => {
    if (!i) return;
    const delta = new Float32Array(off[i].length);
    let most = 0;
    for (let k = 0; k < delta.length; k++) { delta[k] = on[i][k] - off[i][k]; most = Math.max(most, Math.abs(delta[k])); }
    for (let k = 0; k < delta.length; k++) if (Math.abs(delta[k]) < most * NOISE) delta[k] = 0;
    const back = mirrorDelta(n, o, off[i], delta), v = x.l.getVertices();
    for (let k = 0; k < delta.length; k++) v[k] = off[i][k] + back[k];
    levelNormals(x.l);
    x.l._detailsFix = null;
    rows[i - 1].l.analyseUp(x.l);
    const got = new Float32Array(x.d.length);
    let big = 0;
    for (let k = 0; k < got.length; k++) { got[k] = x.l._detailsXYZ[k] - plain[i][k]; big = Math.max(big, Math.abs(got[k])); }
    for (let k = 0; k < got.length; k++) if (Math.abs(got[k]) < big * NOISE) got[k] = 0;
    if (big) out.set(x.l, got);
  });
  for (const x of rows) {
    put(x.l.getVertices(), x.v);
    // Kept, not recomputed: a level between the bound one and the one on screen keeps the normals it last
    // had on screen through every skin pass, and its details are drawn by them (.365 off across the body).
    put(x.l.getNormals(), x.n);
    x.l._detailsFix = x.f;
    if (x.d) x.l._detailsXYZ.set(x.d);
  }
  m._skinDirty = true;
  return out;
}
RigPoses.mirror = function (main, name) {
  const pose = library(main).get(name);
  const plane = Skeleton.symmetryPlane(main);
  if (!pose) return { ok: false, why: 'no such pose' };
  if (!plane) return { ok: false, why: 'symmetry is off: turn it on to mirror a pose' };
  const c = plane.normal, o = plane.origin, d = 2 * (c.x * o.x + c.y * o.y + c.z * o.z);
  const P = mat4.fromValues(
    1 - 2 * c.x * c.x, -2 * c.y * c.x, -2 * c.z * c.x, 0,
    -2 * c.x * c.y, 1 - 2 * c.y * c.y, -2 * c.z * c.y, 0,
    -2 * c.x * c.z, -2 * c.y * c.z, 1 - 2 * c.z * c.z, 0,
    c.x * d, c.y * d, c.z * d, 1);
  const rel = mirroredPose(pose, new Set(Skeleton.joints(main)), P);
  let made = (name + ' mirror').slice(0, RigPoses.MAX_NAME);
  for (let k = 2; library(main).has(made); k++) made = (name.slice(0, RigPoses.MAX_NAME - 10) + ' mirror ' + k);
  const rows = [];
  for (const r of layersOf(main, name)) {
    const n = r.m.getSymmetryNormal(), o = [0, 0, 0];
    if (!PosedSymmetry._restPlaneOrigin(r.m, n, o)) continue;
    const md = mirrorDelta(n, o, r.t.baseShape, r.d);
    rows.push({ m: r.m, t: r.t, d: md, bt: { times: [], values: [] }, fix: mirrorDetails(r, n, o, md) });
  }
  edit(main, (m) => m.set(made, rel), 'Mirror Rig Pose', () => putLayers(main, made, rows), () => dropLayers(main, made));
  return { ok: true, name: made, layers: rows.length };
};

export default RigPoses;
