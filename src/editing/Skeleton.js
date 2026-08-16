import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';

// [Rigging POC#2 — phase 1] Skeleton nodes.
//
// A JOINT is a transform-only locator, built exactly like Scene.addNull(): a tiny
// non-sculptable mesh so it inherits selection / gizmo / outliner / parent-aware
// transforms / transform-animation for free. FK therefore costs nothing — a joint is
// parented to its parent joint through the ordinary scene graph, so rotating a shoulder
// already carries the whole arm. Joints carry `_isBone = true` plus `_boneRadius` (the
// capsule radius used by the phase-2 bind).
//
// BONE VISUALS are NOT parented to the joints. They live in one flat group under the
// worldGroup and are rebuilt from the joints' MODEL-space matrices every frame. Parenting
// the visual to the joint would inherit the joint's own scale and make the geometry
// stretch with it; a flat group keeps every bone in the same units, which matters because
// the whole point of drawing a skeleton is that the proportions read truthfully.
//
// Each bone draws TWICE: the solid pass, and an xray ghost with depthFunc GreaterDepth
// that appears ONLY where the bone is behind geometry. That is not decoration — a joint
// lives inside a solid arm, so without the ghost you are placing it blind (stereo gives
// you depth perception of surfaces, not of things buried in them).

const JOINT_COLOR = 0x33e0ff;
const BONE_COLOR = 0xf0c674;
const BONE_EDGE = 0x1e1e2e;
const HILITE_COLOR = 0xffe066;
const SELECT_COLOR = 0xa6e3a1; // outliner selection, distinct from the amber preselect
const PLANE_COLOR = 0x89b4fa;
const PLANE_HOT = 0xa6e3a1;
const GHOST_OPACITY = 0.35;

const _mTmp = new THREE.Matrix4();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
// Scratch for deriving a bone's roll from the joint that owns it.
const _qOwner = new THREE.Quaternion(), _qAlign = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _dirLocal = new THREE.Vector3(), _vTmp = new THREE.Vector3(), _sTmp = new THREE.Vector3();

// Unit octahedral bone along +Y: apex at the origin, apex at (0,1,0), diamond ring at
// y = 0.15. X/Z are scaled by the bone width, Y by its length, so the ring width stays
// independent of length. DoubleSide because an unlit material with reversed winding
// silently renders nothing.
function makeBoneGeometry() {
  const v = new Float32Array([
    0, 0, 0, 1, 0.15, 0, 0, 0.15, 1,
    0, 0, 0, 0, 0.15, 1, -1, 0.15, 0,
    0, 0, 0, -1, 0.15, 0, 0, 0.15, -1,
    0, 0, 0, 0, 0.15, -1, 1, 0.15, 0,
    0, 1, 0, 0, 0.15, 1, 1, 0.15, 0,
    0, 1, 0, -1, 0.15, 0, 0, 0.15, 1,
    0, 1, 0, 0, 0.15, -1, -1, 0.15, 0,
    0, 1, 0, 1, 0.15, 0, 0, 0.15, -1,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

let _boneGeo = null;
function boneGeometry() { return (_boneGeo = _boneGeo || makeBoneGeometry()); }

// Edge overlay for the bone octahedron. A shaded solid gives you position but reads almost
// flat from many angles — the ridge lines are what make the bone's ROLL and taper legible,
// which is the whole reason to draw an octahedron rather than a cylinder.
let _boneEdgeGeo = null;
function boneEdgeGeometry() {
  return (_boneEdgeGeo = _boneEdgeGeo || new THREE.EdgesGeometry(boneGeometry(), 1));
}

let _jointGeo = null;
function jointGeometry() { return (_jointGeo = _jointGeo || new THREE.SphereGeometry(1, 10, 8)); }

// Capsule parts. A capsule is drawn as a shaft plus a cap sphere at each end rather than as
// one CapsuleGeometry, because a capsule's radius and length have to scale INDEPENDENTLY —
// scaling a single capsule mesh non-uniformly would squash its caps into ellipsoids and
// misreport the very number the user is editing. Three unit primitives, three uniform-ish
// scales, no per-frame geometry rebuild.
let _capShaftGeo = null;
function capsuleShaftGeometry() {
  return (_capShaftGeo = _capShaftGeo || new THREE.CylinderGeometry(1, 1, 1, 14, 1, true));
}
let _capEndGeo = null;
function capsuleEndGeometry() {
  return (_capEndGeo = _capEndGeo || new THREE.SphereGeometry(1, 14, 10));
}

// Default capsule radius as a fraction of the bone's own length. 0.15 was a guess with no
// evidence behind it, and every downstream weight inherited it; it is a tuning knob now, and
// the capsules are drawn, so the number can be judged by eye instead of by argument.
const DEFAULT_RADIUS_FRAC = 0.5;
function radiusFrac() {
  const v = window._boneRadiusFrac;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RADIUS_FRAC;
}

// Solid + xray ghost pair. The ghost draws only where occluded (GreaterDepth), so it
// reveals the part of the skeleton buried inside the mesh without ever becoming an
// always-on-top overlay (which reads as a stereo headache and loses all depth cue).
function makePair(geo, color) {
  const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: color, side: THREE.DoubleSide,
  }));
  const ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: color, side: THREE.DoubleSide,
    transparent: true, opacity: GHOST_OPACITY,
    depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false,
  }));
  ghost.renderOrder = 9998;
  solid.isPickable = ghost.isPickable = false;
  solid.frustumCulled = ghost.frustumCulled = false;
  return { solid: solid, ghost: ghost };
}

// One piece of a bind capsule: a translucent shell, plus the usual occluded-only ghost.
// Translucent rather than wireframe on purpose — the capsule's job is to read as a VOLUME
// enclosing part of the sculpt ("does this envelope contain the forearm?"), and a wireframe
// sphere in a headset reads as a ball of noise sitting over the model.
function makeCapsulePart(geo) {
  const p = makePair(geo, 0xffffff); // recoloured per frame from the bone's identity colour
  p.solid.material.transparent = true;
  p.solid.material.opacity = 0.16;
  p.solid.material.depthWrite = false;
  p.ghost.material.opacity = 0.09;
  p.solid.renderOrder = 9996;
  p.ghost.renderOrder = 9996;
  return p;
}

// Bone length readout. The point is proportion, not measurement: an upper and lower limb
// segment usually want to be about equal, and reading two numbers is far quicker than
// eyeballing two bones from a single viewpoint in a headset. Sprites, so they always face
// the viewer, and depthTest off so a label inside the mesh is still readable.
function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.renderOrder = 10001;
  sprite.isPickable = false;
  sprite.frustumCulled = false;
  return { sprite: sprite, canvas: canvas, tex: tex, text: '' };
}

function setLabelText(lab, text) {
  if (lab.text === text) return; // repainting a canvas + reuploading a texture is not free
  lab.text = text;
  const c = lab.canvas, ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; // outline so it reads over any sculpt colour
  ctx.strokeText(text, c.width / 2, c.height / 2);
  ctx.fillStyle = '#f5e0dc';
  ctx.fillText(text, c.width / 2, c.height / 2);
  lab.tex.needsUpdate = true;
}

const Skeleton = {};

Skeleton.isJoint = function (m) { return !!(m && m._isBone); };

// ---- bone identity colours -----------------------------------------------------
//
// Each bone gets a saturated colour, and the capsule and the vertices it claims are painted
// in it — that is what makes "does this bone own what it should?" a question you can answer
// by looking. The only pairs that MUST be far apart are the ones that touch: a shoulder and
// an elbow next to each other in pink and purple is the case where the whole diagnostic
// stops working, since the boundary between them is exactly what you are trying to see.
//
// So the colours are not a hash. They are assigned greedily down the hierarchy, each joint
// taking the palette entry furthest in hue from its parent, its grandparent, and the siblings
// already assigned. A hash spreads colours evenly over the WHOLE rig, which says nothing about
// whether any particular adjacent pair is distinguishable.
const BONE_PALETTE_SIZE = 12;
const _paletteColors = [];
function paletteColor(i) {
  let c = _paletteColors[i];
  if (!c) {
    c = _paletteColors[i] = new THREE.Color().setHSL(i / BONE_PALETTE_SIZE, 0.95, 0.55);
    c._hue = i / BONE_PALETTE_SIZE;
  }
  return c;
}

function hueGap(a, b) {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

// Rebuild the id -> palette-slot map. Roots first, so a joint's parent always already has a
// colour when its own is chosen.
function assignBoneColors(main, joints) {
  const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
  const order = joints.slice().sort((a, b) => depth(a) - depth(b));
  const slot = new Map();      // joint id -> palette index
  const used = new Array(BONE_PALETTE_SIZE).fill(0);
  const kidsDone = new Map();  // parent id -> palette indices already given to its children

  for (const j of order) {
    const parent = j._parentMesh;
    const gp = parent && parent._parentMesh;
    const avoid = [];
    if (parent && slot.has(parent.getID())) avoid.push(slot.get(parent.getID()));
    if (gp && slot.has(gp.getID())) avoid.push(slot.get(gp.getID()));
    const pid = parent ? parent.getID() : -1;
    for (const s of (kidsDone.get(pid) || [])) avoid.push(s);

    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < BONE_PALETTE_SIZE; i++) {
      let near = 1;
      for (const a of avoid) near = Math.min(near, hueGap(i / BONE_PALETTE_SIZE, a / BONE_PALETTE_SIZE));
      // Distance from the colours that touch this one comes first; even usage across the rig
      // is only a tie-break, so a busy rig still cycles rather than clumping.
      const score = near * 10 - used[i];
      if (score > bestScore) { bestScore = score; best = i; }
    }
    slot.set(j.getID(), best);
    used[best]++;
    if (!kidsDone.has(pid)) kidsDone.set(pid, []);
    kidsDone.get(pid).push(best);
  }
  main._skelColorSlots = slot;
  return slot;
}

// The colour map is rebuilt only when the set of joints changes — it is read per joint per
// frame by the visuals, and re-solving the whole hierarchy at 90Hz would be silly.
function colorSlots(main) {
  const joints = Skeleton.joints(main);
  let sig = joints.length;
  for (const j of joints) sig += j.getID() * 31;
  if (main._skelColorSig !== sig || !main._skelColorSlots) {
    main._skelColorSig = sig;
    return assignBoneColors(main, joints);
  }
  return main._skelColorSlots;
}

const _fallbackColor = new THREE.Color(0.6, 0.6, 0.6);
Skeleton.boneColor = function (main, joint) {
  if (!joint || !joint.getID) return _fallbackColor;
  const slots = colorSlots(main);
  const s = slots.get(joint.getID());
  return s === undefined ? _fallbackColor : paletteColor(s);
};

Skeleton.joints = function (main) {
  return (main.getMeshes() || []).filter(Skeleton.isJoint);
};

// Is this joint's rig visible? A joint's own locator never draws — the flat visuals in this
// file represent it — so the outliner's eye has to be honoured HERE or it does nothing on a
// bone. Visibility is inherited down the chain: hiding the root hides the whole skeleton,
// which is the only way anyone actually wants to hide a rig. Walking ancestors per joint per
// frame is O(depth) on a handful of joints, far cheaper than maintaining a cached flag that
// could drift out of sync with the outliner.
Skeleton.jointVisible = function (joint) {
  for (let m = joint; m; m = m._parentMesh) {
    if (Skeleton.isJoint(m) && m.isVisible && !m.isVisible()) return false;
  }
  return true;
};

// A scene-scale unit so joint markers and preview bones are sized relative to the model
// rather than to absolute engine units (a 0.02 marker is invisible on a big sculpt and
// swallows a small one). Model-space bounding radius of the largest sculptable mesh.
Skeleton.sceneUnit = function (main) {
  // Called every frame by the visual pass, so cache it briefly — it walks every mesh, and
  // it only feeds marker sizing, where a fraction of a second of staleness is invisible.
  const now = performance.now();
  if (main._skelUnit && now - main._skelUnitAt < 500) return main._skelUnit;

  let best = 0;
  for (const m of main.getMeshes() || []) {
    if (Skeleton.isJoint(m) || m._isNull) continue;
    const tm = m.getThreeMesh && m.getThreeMesh();
    const g = tm && tm.geometry;
    if (!g) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const ms = m.getModelSpaceMatrix ? m.getModelSpaceMatrix() : null;
    const s = ms ? Math.hypot(ms[0], ms[1], ms[2]) : 1;
    const r = (g.boundingSphere ? g.boundingSphere.radius : 1) * s;
    // A non-finite radius (a mesh whose vertices went bad) must not poison the scene unit:
    // every joint marker and bone is scaled by it, so one NaN silently makes the whole
    // skeleton invisible — a confusing symptom a long way from its cause.
    if (Number.isFinite(r) && r > best) best = r;
  }
  main._skelUnit = best > 1e-6 ? best : 1;
  main._skelUnitAt = now;
  return main._skelUnit;
};

// Push a joint's engine matrix into its Three mesh and refresh its world matrix. Needed
// any time a joint moves outside the render loop's own sync, and needed BEFORE reparenting
// or before a child reads its parent's world matrix.
Skeleton.syncThree = function (mesh) {
  const tm = mesh.getThreeMesh && mesh.getThreeMesh();
  if (!tm) return;
  tm.matrixAutoUpdate = false;
  tm.matrix.fromArray(mesh.getMatrix());
  tm.updateMatrixWorld(true);
};

Skeleton.childJoints = function (main, joint) {
  return (main.getMeshes() || []).filter((m) => Skeleton.isJoint(m) && m._parentMesh === joint);
};

// Move a joint to `pos` (MODEL space), keeping its own rotation and scale.
//
// With `compensate`, the joint's DIRECT children are pinned in world space: their local
// matrices are rewritten so their model-space transforms come out unchanged. That is what
// makes editing a limb sane — dragging the knee re-aims the thigh and shin (both bones are
// derived from joint positions, so they follow for free) while the foot and toes stay
// exactly where they were. Only direct children need pinning; their own descendants ride
// along with them and stay put automatically.
Skeleton.moveJoint = function (main, joint, pos, compensate) {
  const kids = compensate ? Skeleton.childJoints(main, joint) : [];
  const saved = kids.map((k) => k.getModelSpaceMatrix());

  const ms = joint.getModelSpaceMatrix();
  ms[12] = pos.x; ms[13] = pos.y; ms[14] = pos.z;
  joint.setModelSpaceMatrix(ms);
  Skeleton.syncThree(joint);

  // Order matters: the joint's world matrix must already be updated before a child
  // converts its desired model-space transform back through the new parent.
  for (let i = 0; i < kids.length; i++) {
    kids[i].setModelSpaceMatrix(saved[i]);
    Skeleton.syncThree(kids[i]);
  }
};

// Local matrices of a joint and its direct children — the exact set moveJoint writes, so
// this is what an undo step has to capture and restore.
Skeleton.captureLocal = function (main, joint) {
  const out = [[joint, mat4.clone(joint.getMatrix())]];
  for (const k of Skeleton.childJoints(main, joint)) out.push([k, mat4.clone(k.getMatrix())]);
  return out;
};

Skeleton.restoreLocal = function (snapshot) {
  for (const [mesh, m] of snapshot) {
    mat4.copy(mesh.getMatrix(), m);
    Skeleton.syncThree(mesh);
  }
};

Skeleton.setHighlight = function (main, joint) {
  main._skelHighlightId = joint ? joint.getID() : -1;
};

// Model-space (worldGroup-relative) position of a joint.
Skeleton.jointPos = function (joint, out) {
  const ms = joint.getModelSpaceMatrix();
  out = out || new THREE.Vector3();
  return out.set(ms[12], ms[13], ms[14]);
};

// Create a joint at `pos` (MODEL space), optionally parented to `parent`. Because
// addNewMesh pushes its own add-state, each joint is one undo step for free.
Skeleton.createJoint = function (main, pos, parent, name) {
  // No normalizeSize() here — it writes a scale into the matrix, and the matrix is set
  // outright below. The primitive's own 0.5 radius is folded into the scale instead.
  const mesh = new Multimesh(Primitives.createSphere(main._gl, 0.5, 8, 8));
  mesh.setShaderType(Enums.Shader.FLAT);
  mesh._typeName = 'Bone';
  mesh._isBone = true;
  mesh._isNull = true;      // transform-only locator: reuses the null constraint/eval paths
  mesh.isPickable = false;  // sculpt brushes skip it; VR ray-select still reaches it
  mesh._boneRadius = 0;     // filled in below once the bone length is known

  // Shrink the pick sphere to a small locator. Kept uniform so the flat bone visuals
  // (which read the joint's model-space translation only) stay truthful.
  const unit = Skeleton.sceneUnit(main);
  const s = unit * 0.036; // × the primitive's 0.5 radius → pick sphere ≈ the drawn marker
  const m = mesh.getMatrix();
  mat4.identity(m);
  mat4.scale(m, m, [s, s, s]);
  m[12] = pos.x; m[13] = pos.y; m[14] = pos.z;

  main.addNewMesh(mesh);

  // The locator itself never draws — the flat bone/joint visuals represent it. colorWrite
  // off keeps CPU picking working (it uses geometry, not the material).
  const tm = mesh.getThreeMesh();
  if (tm) {
    tm.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    // matrixAutoUpdate is cleared by Mesh.js's per-frame sync, which has NOT run yet for a
    // mesh created this frame. Leaving it at Three's default (true) makes updateMatrixWorld
    // recompose tm.matrix from the untouched position/quaternion/scale and discard the
    // matrix set above — the joint then reads as sitting at the worldGroup origin, and
    // setMeshParent's attach() (which preserves WORLD transform) bakes that origin in for
    // good. Every joint after the first ends up stacked at the origin.
    tm.matrixAutoUpdate = false;
    tm.matrix.fromArray(mesh.getMatrix());
    tm.updateMatrixWorld(true);
    // The locator must never draw — the flat bone/joint visuals represent it. visible=false
    // as well as the no-draw material, because StateAddRemove.undo() calls initRender() on
    // every surviving mesh, which rebuilds the material and would otherwise resurrect the
    // pick sphere as a visible white blob. Reasserted each frame in updateVisuals.
    tm.visible = false;
  }

  // Every joint ever created this session, live or undone. The add/remove undo system is
  // not parenting-aware, so this registry is what lets updateVisuals repair the scene graph
  // after an undo or redo (see the self-heal pass there).
  main._skelAll = main._skelAll || new Set();
  main._skelAll.add(mesh);

  if (parent && main.getMeshes().includes(parent)) {
    main.setMeshParent(mesh.getID(), parent.getID());
    // Default capsule radius from the bone's own length. A measured-at-creation default
    // is what makes the phase-2 capsule bind possible without a second pass over the rig;
    // editing a stored number later is cheap, re-measuring a finished skeleton is not.
    const len = Skeleton.jointPos(parent).distanceTo(Skeleton.jointPos(mesh));
    mesh._boneRadius = len * radiusFrac();
  } else {
    mesh._boneRadius = unit * 0.05;
  }

  if (name) mesh._permanentStaticLabel = name;
  return mesh;
};

// ---- visuals -------------------------------------------------------------------

function skelGroup(main) {
  if (main._skelGroup && main._skelGroup.parent) return main._skelGroup;
  const g = new THREE.Group();
  g.name = 'skeleton_visuals';
  g.frustumCulled = false;
  (main._worldGroup || main._scene).add(g);
  main._skelGroup = g;
  return g;
}

function ensureEntry(main, id) {
  const g = skelGroup(main);
  main._skelVis = main._skelVis || new Map();
  let e = main._skelVis.get(id);
  if (!e) {
    // The wireframe gets the same solid/ghost treatment as everything else, so the bone's
    // edges stay readable when it is buried inside the mesh.
    const wire = new THREE.LineSegments(boneEdgeGeometry(), new THREE.LineBasicMaterial({
      color: BONE_EDGE, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    const wireGhost = new THREE.LineSegments(boneEdgeGeometry(), new THREE.LineBasicMaterial({
      color: BONE_EDGE, transparent: true, opacity: 0.35, depthWrite: false,
      depthTest: true, depthFunc: THREE.GreaterDepth,
    }));
    wire.renderOrder = wireGhost.renderOrder = 9999;
    wire.isPickable = wireGhost.isPickable = false;
    wire.frustumCulled = wireGhost.frustumCulled = false;

    e = {
      bone: makePair(boneGeometry(), BONE_COLOR),
      joint: makePair(jointGeometry(), JOINT_COLOR),
      wire: { solid: wire, ghost: wireGhost },
      label: makeLabel(),
      cap: {
        shaft: makeCapsulePart(capsuleShaftGeometry()),
        a: makeCapsulePart(capsuleEndGeometry()),
        b: makeCapsulePart(capsuleEndGeometry()),
      },
    };
    g.add(e.bone.solid, e.bone.ghost, e.joint.solid, e.joint.ghost,
          e.wire.solid, e.wire.ghost, e.label.sprite);
    for (const p of [e.cap.shaft, e.cap.a, e.cap.b]) g.add(p.solid, p.ghost);
    main._skelVis.set(id, e);
  }
  return e;
}

function disposeEntry(main, id) {
  const e = main._skelVis && main._skelVis.get(id);
  if (!e) return;
  const g = skelGroup(main);
  const caps = e.cap ? [e.cap.shaft, e.cap.a, e.cap.b] : [];
  for (const p of [e.bone, e.joint, e.wire, ...caps]) {
    if (!p) continue;
    g.remove(p.solid, p.ghost);
    p.solid.material.dispose(); p.ghost.material.dispose();
  }
  if (e.label) {
    g.remove(e.label.sprite);
    e.label.sprite.material.dispose();
    e.label.tex.dispose();
  }
  main._skelVis.delete(id);
}

// Reconcile the Three scene graph with the joints that are actually live.
//
// The mesh add/remove undo system predates parenting and is not aware of it, so two things
// go wrong around a joint chain:
//   * UNDO — Scene.detachMeshThree removes from the worldGroup, which does nothing for a
//     joint whose threeMesh sits under its PARENT joint's threeMesh. The joint leaves
//     _meshes but stays in the scene, and StateAddRemove.undo's initRender() sweep rebuilds
//     its material, so the no-draw locator comes back as a visible sphere.
//   * REDO — attachMeshThree puts it back under the worldGroup, not under its parent joint,
//     while its matrix is still local-to-parent. It would reappear in the wrong place.
// Repairing here rather than in the shared undo path keeps the fix contained to rigging,
// where the parenting assumption actually lives.
Skeleton.healGraph = function (main) {
  const all = main._skelAll;
  if (!all || !all.size) return;
  const live = new Set(main.getMeshes() || []);

  for (const j of all) {
    const tm = j.getThreeMesh && j.getThreeMesh();
    if (!tm) continue;

    if (!live.has(j)) {
      if (tm.parent) tm.parent.remove(tm); // undone: take it out wherever it ended up
      continue;
    }

    tm.visible = false; // initRender() may have rebuilt the material; keep it non-drawing

    const p = j._parentMesh;
    const want = (Skeleton.isJoint(p) && live.has(p)) ? p.getThreeMesh() : main._worldGroup;
    if (want && tm.parent !== want) {
      // add(), not attach() — the joint's matrix is already local to this parent, so the
      // graph is what needs correcting, not the transform.
      want.add(tm);
      Skeleton.syncThree(j);
    }
  }
};

// Rebuild every joint marker + bone from the live model-space matrices. Called once per
// frame from the render loop, so posing, undo, gizmo drags and animation playback all
// keep the skeleton correct without any of them having to know it exists.
Skeleton.updateVisuals = function (main) {
  Skeleton.healGraph(main);
  const joints = Skeleton.joints(main);
  main._skelVis = main._skelVis || new Map();
  if (!joints.length) {
    if (main._skelVis.size) for (const id of Array.from(main._skelVis.keys())) disposeEntry(main, id);
    return;
  }

  const unit = Skeleton.sceneUnit(main);
  const jr = unit * 0.018;
  const live = new Set();
  const hi = main._skelHighlightId ?? -1;
  const showLen = !!window._boneShowLengths;
  // The bind capsules, drawn. They are the actual support of the capsule bind — a vertex
  // outside every capsule gets no weight from any of them — so seeing them is the difference
  // between tuning weights by argument and tuning them by eye.
  const showCaps = window._boneShowCapsules !== false;
  const hideCaps = (e) => {
    for (const p of [e.cap.shaft, e.cap.a, e.cap.b]) p.solid.visible = p.ghost.visible = false;
  };
  // Outliner selection lights the joint in the scene. Reading the live selection here
  // rather than hooking setMesh means it works from every selection route — outliner,
  // gizmo, undo — without any of them knowing joints exist.
  const sel = new Set((main.getSelectedMeshes?.() || []).map((m) => m.getID()));

  for (const j of joints) {
    const id = j.getID();
    live.add(id);
    const e = ensureEntry(main, id);

    // Hidden by the outliner (its own eye, or an ancestor's). Everything this joint draws
    // goes away; the entry itself stays so unhiding costs nothing.
    if (!Skeleton.jointVisible(j)) {
      e.joint.solid.visible = e.joint.ghost.visible = false;
      e.bone.solid.visible = e.bone.ghost.visible = false;
      e.wire.solid.visible = e.wire.ghost.visible = false;
      e.label.sprite.visible = false;
      hideCaps(e);
      continue;
    }

    Skeleton.jointPos(j, _pB);

    // Preselection: the joint the next trigger will act on. Colour AND size both change —
    // colour alone is easy to lose against a warm-coloured sculpt, and in a headset the
    // size change is what reads at a glance.
    const isHi = id === hi;
    const isSel = sel.has(id);
    for (const o of [e.joint.solid, e.joint.ghost]) {
      o.position.copy(_pB);
      o.scale.setScalar(isHi || isSel ? jr * 1.7 : jr);
      o.material.color.setHex(isHi ? HILITE_COLOR : (isSel ? SELECT_COLOR : JOINT_COLOR));
      o.visible = true;
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }

    const parent = j._parentMesh;
    const hasBone = Skeleton.isJoint(parent) && main.getMeshes().includes(parent);
    if (!hasBone) {
      e.bone.solid.visible = e.bone.ghost.visible = false;
      e.wire.solid.visible = e.wire.ghost.visible = false;
      e.label.sprite.visible = false;
      hideCaps(e);
      continue;
    }

    Skeleton.jointPos(parent, _pA);
    _dir.subVectors(_pB, _pA);
    const len = _dir.length();
    if (len < 1e-6) {
      e.bone.solid.visible = e.bone.ghost.visible = false;
      e.wire.solid.visible = e.wire.ghost.visible = false;
      e.label.sprite.visible = false;
      hideCaps(e);
      continue;
    }

    if (showLen) {
      // Sit the label at the bone's midpoint, nudged off the shaft so it does not sit
      // inside the geometry it is describing.
      setLabelText(e.label, len < 10 ? len.toFixed(2) : len.toFixed(1));
      e.label.sprite.position.copy(_pA).addScaledVector(_dir, 0.5).addScaledVector(_up, jr * 1.6);
      e.label.sprite.scale.set(unit * 0.16, unit * 0.08, 1);
      e.label.sprite.visible = true;
    } else {
      e.label.sprite.visible = false;
    }
    _dir.divideScalar(len);
    // ROLL COMES FROM THE JOINT, NOT FROM THE DIRECTION.
    //
    // `setFromUnitVectors(+Y, dir)` is the minimal rotation onto the bone's direction, and its
    // roll about that direction is a function of the direction alone. Rotating a joint in pose
    // mode therefore made the drawn bone spin about its own long axis even though the joint's
    // real transform — and so the deformation — was rock steady. The visual was inventing a
    // roll rather than reporting one.
    //
    // Instead: express the bone's direction in the OWNING joint's frame (the parent, at the
    // bone's head), align +Y to that, and put the joint's own rotation back on top. The local
    // direction is fixed while posing — a child rides its parent — so all the roll now comes
    // from the joint's actual orientation, which is what the bone is supposed to be showing.
    _mTmp.fromArray(parent.getModelSpaceMatrix());
    _mTmp.decompose(_vTmp, _qOwner, _sTmp);
    _dirLocal.copy(_dir).applyQuaternion(_qInv.copy(_qOwner).invert()).normalize();
    _qAlign.setFromUnitVectors(_up, _dirLocal);
    _q.copy(_qOwner).multiply(_qAlign);
    const w = Math.max(len * 0.12, jr * 0.6);
    for (const o of [e.bone.solid, e.bone.ghost, e.wire.solid, e.wire.ghost]) {
      o.position.copy(_pA);
      o.quaternion.copy(_q);
      o.scale.set(w, len, w);
      o.visible = true;
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }

    // Capsule. The radius belongs to the CHILD joint, matching the bind (a bone deforms with
    // its child), so the joint you highlight is the joint whose capsule lights up and whose
    // radius the Radius mode edits.
    const cr = j._boneRadius || 0;
    if (!showCaps || !(cr > 1e-9)) { hideCaps(e); continue; }
    // The capsule wears the colour of the joint that MOVES it — the parent, at its head —
    // which is the same colour the weight preview paints onto the vertices it claims. (The
    // radius still belongs to this joint; ownership and authorship are different things.)
    // Highlighting brightens rather than recolours, so the capsule-to-vertex colour match is
    // never broken by preselection.
    const capColor = Skeleton.boneColor(main, parent);
    const capOp = (isHi || isSel) ? 0.34 : 0.16;
    for (const o of [e.cap.shaft.solid, e.cap.shaft.ghost]) {
      o.position.copy(_pA).addScaledVector(_dir, len * 0.5); // cylinder is centre-origin
      o.quaternion.copy(_q);
      o.scale.set(cr, len, cr);
      o.visible = true;
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }
    for (const [part, at] of [[e.cap.a, _pA], [e.cap.b, _pB]]) {
      for (const o of [part.solid, part.ghost]) {
        o.position.copy(at);
        o.scale.setScalar(cr);
        o.visible = true;
        o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
      }
    }
    for (const part of [e.cap.shaft, e.cap.a, e.cap.b]) {
      part.solid.material.color.copy(capColor);
      part.ghost.material.color.copy(capColor);
      part.solid.material.opacity = capOp;
      part.ghost.material.opacity = capOp * 0.55;
    }
  }

  for (const id of Array.from(main._skelVis.keys())) if (!live.has(id)) disposeEntry(main, id);
};

// Preview bone: parent joint (or a free-floating marker) to the live controller tip, so
// you always see the bone you are about to commit before you commit it.
Skeleton.showPreview = function (main, fromPos, toPos) {
  const g = skelGroup(main);
  if (!main._skelPreview) {
    const p = makePair(boneGeometry(), 0xffffff);
    p.solid.material.transparent = true; p.solid.material.opacity = 0.45;
    p.solid.material.depthWrite = false;
    const d = makePair(jointGeometry(), JOINT_COLOR);
    d.solid.material.transparent = true; d.solid.material.opacity = 0.8;
    g.add(p.solid, p.ghost, d.solid, d.ghost);
    main._skelPreview = { bone: p, dot: d };
  }
  const pv = main._skelPreview;
  const jr = Skeleton.sceneUnit(main) * 0.018;

  for (const o of [pv.dot.solid, pv.dot.ghost]) {
    o.position.copy(toPos); o.scale.setScalar(jr); o.visible = true;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }

  if (!fromPos) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _dir.subVectors(toPos, fromPos);
  const len = _dir.length();
  if (len < 1e-6) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _q.setFromUnitVectors(_up, _dir.divideScalar(len));
  const w = Math.max(len * 0.12, jr * 0.6);
  for (const o of [pv.bone.solid, pv.bone.ghost]) {
    o.position.copy(fromPos); o.quaternion.copy(_q); o.scale.set(w, len, w); o.visible = true;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }
};

Skeleton.hidePreview = function (main) {
  const pv = main._skelPreview;
  if (!pv) return;
  for (const o of [pv.bone.solid, pv.bone.ghost, pv.dot.solid, pv.dot.ghost]) o.visible = false;
};

// Nearest existing joint to a model-space point, within `maxDist`. This is what makes
// branching work: clicking on an existing joint starts a new chain from it, so a spine
// grows clavicles and hips with no separate parenting UI.
Skeleton.pickJoint = function (main, pos, maxDist) {
  let best = null, bestD = maxDist;
  for (const j of Skeleton.joints(main)) {
    // A hidden joint must not be grabbable. Picking something you cannot see is worse than
    // not being able to pick it — you would move a rig with no idea what you had hold of.
    if (!Skeleton.jointVisible(j)) continue;
    const d = Skeleton.jointPos(j, _pA).distanceTo(pos);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
};

// ---- capsule radii -------------------------------------------------------------
//
// A joint's `_boneRadius` is the radius of the capsule around the bone that ENDS at it
// (parent -> this joint), in model space. It is what the capsule bind measures against, so
// it is the single number that decides how far a bone's influence reaches.

// Distance from a model-space point to the bone ending at `joint`, or null when the joint
// has no bone (a chain root). Used both by the radius drag and by any "is this vertex in
// the capsule" question asked outside the bind.
Skeleton.boneDistance = function (main, joint, p) {
  const parent = joint && joint._parentMesh;
  if (!Skeleton.isJoint(parent) || !main.getMeshes().includes(parent)) return null;
  Skeleton.jointPos(parent, _pA);
  Skeleton.jointPos(joint, _pB);
  _dir.subVectors(_pB, _pA);
  const len2 = _dir.lengthSq();
  // _pB is free once _dir is built, so the projection costs no allocation.
  let t = len2 > 1e-12 ? _pB.copy(p).sub(_pA).dot(_dir) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return _pA.addScaledVector(_dir, t).distanceTo(p);
};

// Bone length of the bone ending at `joint`, or 0 for a chain root.
Skeleton.boneLength = function (main, joint) {
  const parent = joint && joint._parentMesh;
  if (!Skeleton.isJoint(parent) || !main.getMeshes().includes(parent)) return 0;
  return Skeleton.jointPos(parent, _pA).distanceTo(Skeleton.jointPos(joint, _pB));
};

// Re-derive every capsule radius as `frac` x its own bone's length. This is the constant
// that was hard-coded at 0.15, turned into a knob: one drag re-proportions the whole rig,
// which is the only way to judge a default like that honestly.
Skeleton.setRadiusFraction = function (main, frac) {
  const unit = Skeleton.sceneUnit(main);
  for (const j of Skeleton.joints(main)) {
    const len = Skeleton.boneLength(main, j);
    j._boneRadius = len > 1e-9 ? len * frac : unit * 0.05;
  }
};

// Radii of every joint, for undo. Small (one float per joint), so snapshotting all of them
// is simpler and safer than tracking which ones an edit touched.
Skeleton.captureRadii = function (main) {
  return Skeleton.joints(main).map((j) => [j, j._boneRadius || 0]);
};

Skeleton.restoreRadii = function (snapshot) {
  for (const [j, r] of snapshot) j._boneRadius = r;
};

// Symmetry plane of the sculpt being rigged (not of the joints, which have none).
// Returns { origin, normal } in model space, or null when symmetry is off / no mesh.
// Cached briefly like sceneUnit — it is read every frame for the plane visual and the snap
// test. Callers must treat the returned vectors as read-only.
Skeleton.symmetryPlane = function (main) {
  const now = performance.now();
  if (main._skelPlaneAt !== undefined && now - main._skelPlaneAt < 250) return main._skelPlane;
  main._skelPlaneAt = now;
  main._skelPlane = Skeleton._computeSymmetryPlane(main);
  return main._skelPlane;
};

Skeleton._computeSymmetryPlane = function (main) {
  if (!main.getSculptManager || !main.getSculptManager().getSymmetry()) return null;
  const meshes = (main.getMeshes() || []).filter((m) => !Skeleton.isJoint(m) && !m._isNull);
  const m = meshes.includes(main.getMesh()) ? main.getMesh() : meshes[0];
  if (!m || !m.getSymmetryOrigin) return null;
  const o = m.getSymmetryOrigin(), n = m.getSymmetryNormal();
  if (!o || !n) return null;
  // Both are mesh-local; the joints live in model space, so carry them across.
  _mTmp.fromArray(m.getModelSpaceMatrix());
  const origin = new THREE.Vector3(o[0], o[1], o[2]).applyMatrix4(_mTmp);
  const normal = new THREE.Vector3(n[0], n[1], n[2])
    .transformDirection(_mTmp).normalize();
  return { origin: origin, normal: normal };
};

// The symmetry plane, drawn. A hip or a spine belongs exactly ON the centreline, and
// without seeing the plane you are guessing whether you hit it. `hot` (the tip is inside
// the snap band, so the next joint WILL land on the plane) brightens it — that turns the
// plane from decoration into a live answer to "will this joint be centred?".
Skeleton.updatePlane = function (main, plane, hot) {
  if (!plane) { Skeleton.hidePlane(main); return; }
  const g = skelGroup(main);
  if (!main._skelPlaneVis) {
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: PLANE_COLOR, side: THREE.DoubleSide,
      transparent: true, opacity: 0.06, depthWrite: false,
    }));
    // A border reads as a plane even where the fill is too faint to see against the sculpt.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: PLANE_COLOR, transparent: true, opacity: 0.5, depthWrite: false }));
    fill.isPickable = edge.isPickable = false;
    fill.frustumCulled = edge.frustumCulled = false;
    fill.renderOrder = edge.renderOrder = 9997;
    g.add(fill, edge);
    main._skelPlaneVis = { fill: fill, edge: edge };
  }
  const v = main._skelPlaneVis;
  const size = Skeleton.sceneUnit(main) * 2.6;
  _q.setFromUnitVectors(_zAxis, plane.normal);
  for (const o of [v.fill, v.edge]) {
    o.position.copy(plane.origin);
    o.quaternion.copy(_q);
    o.scale.set(size, size, 1);
    o.visible = true;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }
  v.fill.material.opacity = hot ? 0.16 : 0.06;
  v.edge.material.opacity = hot ? 0.95 : 0.5;
  v.fill.material.color.setHex(hot ? PLANE_HOT : PLANE_COLOR);
  v.edge.material.color.setHex(hot ? PLANE_HOT : PLANE_COLOR);
};

Skeleton.hidePlane = function (main) {
  const v = main._skelPlaneVis;
  if (v) v.fill.visible = v.edge.visible = false;
};

// Signed distance from a model-space point to the plane (sign = which side).
Skeleton.planeDistance = function (p, plane) {
  return _pA.copy(p).sub(plane.origin).dot(plane.normal);
};

// Project a point onto the plane. `out` must not alias `p`.
Skeleton.projectToPlane = function (p, plane, out) {
  return out.copy(p).addScaledVector(plane.normal, -Skeleton.planeDistance(p, plane));
};

// Snap the direction from `from` to `to` onto a world axis when it is already close to
// one, preserving the bone's LENGTH (only its direction is corrected). Eye joints are the
// motivating case — an eye bone wants to point exactly down Z, and eyeballing "exactly"
// by hand is the one thing hands are bad at.
//
// `excludeNormal`, when given, drops the axes parallel to it from the candidates. That is
// what stops axis snap from fighting plane snap: for a centreline joint whose parent is
// also on the centreline, snapping to the plane's own normal would drag it straight off
// the plane (and, if the parent is directly behind it, collapse the bone to nothing).
const AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
// 5 degrees: tight enough that the snap only fires when you were clearly aiming at the
// axis, rather than quietly correcting bones you meant to angle.
const AXIS_COS = Math.cos(5 * Math.PI / 180);

Skeleton.snapAxis = function (from, to, out, excludeNormal) {
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len < 1e-9) return to;
  _dir.divideScalar(len);

  let best = null, bestDot = AXIS_COS;
  for (const a of AXES) {
    if (excludeNormal && Math.abs(a.dot(excludeNormal)) > 0.9) continue;
    const d = _dir.dot(a);
    if (d > bestDot) { bestDot = d; best = a; }
  }
  if (!best) return to;
  return out.copy(from).addScaledVector(best, len);
};

Skeleton.mirrorPoint = function (p, plane, out) {
  out = out || new THREE.Vector3();
  const d = out.copy(p).sub(plane.origin).dot(plane.normal);
  return out.copy(p).addScaledVector(plane.normal, -2 * d);
};

// ---- persistence ---------------------------------------------------------------
//
// A joint is JUST A TRANSFORM (the KineFX model), and the core .sxr writer already saves
// everything that makes one: its matrix, its label, its geometry. So there is no bone
// format here. The only thing the core format does not persist is the PARENT LINK — it
// saves no hierarchy at all, which is why FrameGroup carries its own appended block.
//
// This block therefore stores HIERARCHY generally (any parented mesh, not only joints),
// plus the two scalars that are genuinely bone-specific. That also closes a pre-existing
// gap: hand-parented hierarchies — an eye parented to a head, say — were silently flattened
// on save, because only FrameGroup's own children were ever restored.
//
// Appended-block convention, matched to FrameGroup's: the block ends with
// [magic, byteLengthExcludingFooter] and repeats the magic as its first word.
// v2 adds SKIN weights to the same block. They live here rather than in a block of their
// own because they are meaningless without the hierarchy: a weight is an index into the
// joint list this block already writes. Deliberately no import of Skinning — everything is
// read and written through the mesh's own `_skin*` properties, so the two modules stay
// uncoupled and there is no import cycle.
const SKEL_MAGIC = 0x534b454c; // 'SKEL'
const SKEL_VERSION = 2;
const NONE = 0xffffffff;
const INFLUENCES = 4;

Skeleton.serialize = function (meshes) {
  if (!meshes || !meshes.length) return null;
  const idxOf = (m) => meshes.indexOf(m);

  // FrameGroup owns its own children's parenting; restoring the same link twice risks
  // matrix drift through two world-preserving reparents, so leave those to it.
  const entries = [];
  meshes.forEach((m, i) => {
    if (!m) return;
    const p = m._parentMesh || null;
    const parented = p && !p._isFrameGroup && idxOf(p) >= 0;
    if (!parented && !m._isBone) return;
    entries.push({
      i: i,
      p: parented ? idxOf(p) : NONE,
      bone: m._isBone ? 1 : 0,
      r: m._boneRadius || 0,
      mir: (m._isBone && m._boneMirror && idxOf(m._boneMirror) >= 0) ? idxOf(m._boneMirror) : NONE,
    });
  });
  // Bound meshes. The joint list is stored as indices into `meshes`, matching how the
  // hierarchy entries above refer to each other.
  const skins = [];
  meshes.forEach((m, i) => {
    if (!m || !m._skinW || !m._skinJoints || !m._skinRest) return;
    const jIdx = m._skinJoints.map((id) => {
      const j = meshes.find((x) => x && x.getID() === id);
      return j ? idxOf(j) : NONE;
    });
    const nbV = (m._skinRest.length / 3) | 0;
    if (!nbV) return;
    skins.push({ i: i, j: jIdx, nbV: nbV, mesh: m });
  });

  if (!entries.length && !skins.length) return null;

  let slots = 3 + entries.length * 5 + 1;
  for (const s of skins) {
    slots += 3 + s.j.length + s.nbV * INFLUENCES * 2 + s.nbV * 3 + s.j.length * 16;
  }

  const buf = new ArrayBuffer((slots + 2) * 4);
  const u = new Uint32Array(buf), f = new Float32Array(buf), i32 = new Int32Array(buf);
  let o = 0;
  u[o++] = SKEL_MAGIC; u[o++] = SKEL_VERSION; u[o++] = entries.length;
  for (const e of entries) {
    u[o++] = e.i; u[o++] = e.p; u[o++] = e.bone; f[o++] = e.r; u[o++] = e.mir;
  }

  u[o++] = skins.length;
  for (const s of skins) {
    const m = s.mesh;
    u[o++] = s.i; u[o++] = s.j.length; u[o++] = s.nbV;
    for (const ji of s.j) u[o++] = ji;
    // Influence indices are signed (-1 = empty slot), so they go through the Int32 view.
    for (let k = 0; k < s.nbV * INFLUENCES; k++) i32[o++] = m._skinIdx[k];
    for (let k = 0; k < s.nbV * INFLUENCES; k++) f[o++] = m._skinW[k];
    // The BIND pose, not the mesh's saved vertices — those are whatever pose it was saved
    // in, and the skin pass overwrites them from this on the first frame after load.
    for (let k = 0; k < s.nbV * 3; k++) f[o++] = m._skinRest[k];
    // Inverse binds cannot be recomputed on load: that would need the joints back at their
    // bind pose, and a rig is usually saved posed.
    for (let a = 0; a < s.j.length; a++) {
      const e = m._skinInvBind[a].elements;
      for (let k = 0; k < 16; k++) f[o++] = e[k];
    }
  }

  u[o++] = SKEL_MAGIC; u[o++] = slots * 4;
  return buf;
};

// Locate our block by walking the footer chain backwards. The skeleton block is written
// BEFORE FrameGroup's so that FrameGroup's stays last — its reader only ever inspects the
// final 8 bytes and would silently give up if anything were appended after it.
function findSkelBlock(buffer) {
  let end = buffer.byteLength;
  for (let guard = 0; guard < 8 && end >= 8; guard++) {
    const foot = new Uint32Array(buffer, end - 8, 2);
    const magic = foot[0], len = foot[1];
    const start = end - 8 - len;
    if (start < 0 || (start & 3)) return null;
    if (magic === SKEL_MAGIC) return { start: start, len: len };
    if (magic !== 0x46475250 /* FGRP */) return null; // unknown tail: stop, do not guess
    end = start;
  }
  return null;
}

Skeleton.deserialize = function (buffer, meshes, main) {
  try {
    if (!buffer || !meshes || !main) return;
    const blk = findSkelBlock(buffer);
    if (!blk) return;
    const u = new Uint32Array(buffer, blk.start, blk.len / 4);
    const f = new Float32Array(buffer, blk.start, blk.len / 4);
    const i32 = new Int32Array(buffer, blk.start, blk.len / 4);
    let o = 0;
    if (u[o++] !== SKEL_MAGIC) return;
    const ver = u[o++];
    if (ver > SKEL_VERSION) return; // written by a newer build: leave it alone
    const n = u[o++];

    const rows = [];
    for (let i = 0; i < n; i++) {
      const mi = u[o++], pi = u[o++], bone = u[o++], r = f[o++], mir = u[o++];
      const mesh = meshes[mi];
      if (!mesh) continue;
      rows.push({ mesh: mesh, parent: pi === NONE ? null : meshes[pi] || null, bone: bone, r: r, mir: mir });
    }

    // Restore the joint's own properties first — healGraph keys off _isBone, and the
    // no-draw material is not serialized (same caveat FrameGroup hits with its nulls).
    for (const row of rows) {
      if (!row.bone) continue;
      const m = row.mesh;
      m._isBone = true;
      m._isNull = true;
      m.isPickable = false;
      m._boneRadius = row.r;
      m._typeName = m._typeName || 'Bone';
      main._skelAll = main._skelAll || new Set();
      main._skelAll.add(m);
      const tm = m.getThreeMesh && m.getThreeMesh();
      if (tm) tm.visible = false;
    }
    for (const row of rows) {
      if (row.mir !== NONE && meshes[row.mir]) row.mesh._boneMirror = meshes[row.mir];
    }

    // Reparenting is world-PRESERVING (setMeshParent uses attach), but the matrix loaded
    // from the file is already LOCAL to the parent. Left alone, attach would treat that
    // local matrix as a world transform and derive a new, wrong local from it. So snapshot
    // the loaded locals, reparent, then write them back.
    const saved = rows.map((row) => mat4.clone(row.mesh.getMatrix()));

    for (const row of rows) {
      if (!row.parent) continue;
      main.setMeshParent(row.mesh.getID(), row.parent.getID());
    }

    // Restore roots first: a child's world matrix is only meaningful once its ancestors
    // are back in place.
    const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
    rows.map((row, i) => ({ row: row, m: saved[i], d: depth(row.mesh) }))
      .sort((a, b) => a.d - b.d)
      .forEach((it) => {
        mat4.copy(it.row.mesh.getMatrix(), it.m);
        Skeleton.syncThree(it.row.mesh);
      });

    // v2: skin weights. Read AFTER the hierarchy is rebuilt, so the joint list resolves
    // against meshes that are already parented.
    if (ver >= 2) {
      const nbSkins = u[o++];
      for (let s = 0; s < nbSkins; s++) {
        const mesh = meshes[u[o++]];
        const nbJ = u[o++], nbV = u[o++];
        const jointIdx = [];
        for (let a = 0; a < nbJ; a++) jointIdx.push(u[o++]);

        const idx = new Int32Array(nbV * INFLUENCES);
        for (let k = 0; k < nbV * INFLUENCES; k++) idx[k] = i32[o++];
        const wts = new Float32Array(nbV * INFLUENCES);
        for (let k = 0; k < nbV * INFLUENCES; k++) wts[k] = f[o++];
        const rest = new Float32Array(nbV * 3);
        for (let k = 0; k < nbV * 3; k++) rest[k] = f[o++];
        const invBind = [];
        for (let a = 0; a < nbJ; a++) {
          const m4 = new THREE.Matrix4();
          for (let k = 0; k < 16; k++) m4.elements[k] = f[o++];
          invBind.push(m4);
        }

        // A weight map is indexed by vertex, so it is only valid for the exact mesh it was
        // built against. Refuse a mismatch rather than deforming with garbage indices.
        if (!mesh || mesh.getNbVertices() !== nbV) {
          console.warn('[Skeleton] skin weights skipped: vertex count mismatch');
          continue;
        }
        const joints = jointIdx.map((ji) => (ji === NONE ? null : meshes[ji]));
        if (joints.some((j) => !j)) {
          console.warn('[Skeleton] skin weights skipped: missing joint');
          continue;
        }

        mesh._skinJoints = joints.map((j) => j.getID());
        mesh._skinIdx = idx;
        mesh._skinW = wts;
        mesh._skinInvBind = invBind;
        mesh._skinRest = rest;
        mesh._skinSrc = new Float32Array(rest);
        mesh._skinStampBuf = null;
        mesh._skinDirty = true; // re-skin on the first frame; the saved verts are a pose
      }
    }

    Skeleton.updateVisuals(main);
  } catch (e) {
    console.error('[Skeleton] import restore failed', e);
  }
};

export default Skeleton;
