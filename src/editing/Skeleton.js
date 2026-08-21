import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';
import getOptionsURL from '../misc/getOptionsURL.js';

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
const RIGHT_HAND_COLOR = 0xf38ba8;
const LEFT_HAND_COLOR = 0xa6e3a1;
// A pinned bone is tinted, which is the one display channel still free: the JOINT marker's
// colour is already spoken for by preselect and selection, so pin state goes on the bone. It
// also reads from across the scene, where a small triad does not.
const PIN_POS_COLOR = 0x89b4fa;   // 3DOF: held in place, free to rotate
const PIN_FULL_COLOR = 0xf38ba8;  // 6DOF: position and orientation both held
// A STEERING GOAL, not a hold — green, and deliberately far from both pin colours, because the
// one thing that must be legible at a glance is that this marker does not anchor anything. It
// slides the joint around the freedom the hard pins leave and gives way completely to them.
const PIN_SOFT_COLOR = 0xa6e3a1;
// The leader from a joint to the pin it has not reached. Deliberately NOT the 6DOF red above:
// "this pin holds orientation" and "this pin is not being met" are independent facts, and
// sharing a colour would conflate them.
const PIN_LINK_COLOR = 0xcba6f7;
const PLANE_COLOR = 0x89b4fa;
const PLANE_HOT = 0xa6e3a1;
const PIN_COLOR = 0xf38ba8;
const GHOST_OPACITY = 0.35;

const _mTmp = new THREE.Matrix4();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
// Scratch for deriving a bone's roll from the joint that owns it.
const _qOwner = new THREE.Quaternion(), _qAlign = new THREE.Quaternion();
const _qPin = new THREE.Quaternion();
const _sOnePin = new THREE.Vector3(1, 1, 1);
const _vPin = new THREE.Vector3();
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

// ---- IK pin markers ------------------------------------------------------------
//
// A pin has three states and the marker has to say WHICH, at a glance, in a headset, while
// the joint underneath is also carrying preselection and selection colour. So the pin is a
// SHAPE, in the conventional language for exactly these two constraints:
//   position held          -> an axis triad
//   position + orientation -> the triad inside gimbal rings
// Drawn in the JOINT's own frame, which makes the difference legible while you drag: a 3DOF
// pin's triad turns with the limb (rotation is free), a 6DOF pin's stands still.
const AXIS_COLORS = [
  new THREE.Color(0xf38ba8), // X
  new THREE.Color(0xa6e3a1), // Y
  new THREE.Color(0x89b4fa), // Z
];

// One buffer per marker rather than three meshes plus three ghosts per joint: every joint
// gets a visual entry whether or not it is ever pinned, and six extra objects each adds up
// on a full rig. Non-indexed so the concatenation needs no index rebasing.
function mergeColored(parts) {
  let total = 0;
  const geos = parts.map(([g, c]) => {
    const n = g.index ? g.toNonIndexed() : g;
    total += n.attributes.position.count;
    return [n, c];
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, c] of geos) {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < cnt; i++) {
      col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b;
    }
    o += cnt;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

let _triadGeo = null;
function triadGeometry() {
  if (_triadGeo) return _triadGeo;
  const t = 0.1; // arm thickness; arms run through the joint so the centre reads as a point
  return (_triadGeo = mergeColored([
    [new THREE.BoxGeometry(2, t, t), AXIS_COLORS[0]],
    [new THREE.BoxGeometry(t, 2, t), AXIS_COLORS[1]],
    [new THREE.BoxGeometry(t, t, 2), AXIS_COLORS[2]],
  ]));
}

// The STEERING goal's marker, and the shape is doing real work. A triad says "this point is
// held, along these axes"; rings say "and this orientation too". A steering goal holds
// nothing and has no axes — it is a place to lean towards, and the joint slides around a
// circle to get as near it as it can. So it gets a solid with no axes at all: nothing about it
// invites you to read an axis off it, which is the one wrong idea available here.
//
// A tetrahedron rather than a sphere or a cube: it is unmistakable at a glance next to a
// triad, it is the only marker in the rig with a flat face, and it has an obvious point.
let _tetraGeo = null;
function tetraGeometry() {
  if (_tetraGeo) return _tetraGeo;
  return (_tetraGeo = new THREE.TetrahedronGeometry(1.15));
}

let _gimbalGeo = null;
function gimbalGeometry() {
  if (_gimbalGeo) return _gimbalGeo;
  const r = 0.92, tube = 0.05, seg = 28;
  // A torus lies in XY and turns about Z; rotate two copies so each ring turns about its own
  // axis, and colour each ring by the axis it turns ABOUT.
  const rx = new THREE.TorusGeometry(r, tube, 5, seg); rx.rotateY(Math.PI / 2);
  const ry = new THREE.TorusGeometry(r, tube, 5, seg); ry.rotateX(Math.PI / 2);
  const rz = new THREE.TorusGeometry(r, tube, 5, seg);
  return (_gimbalGeo = mergeColored([
    [rx, AXIS_COLORS[0]], [ry, AXIS_COLORS[1]], [rz, AXIS_COLORS[2]],
  ]));
}

// makePair paints one colour; these carry their colours per vertex instead.
// `vertexColored` is not decoration: the triad and the gimbal carry a colour per axis in the
// geometry, and the material's own colour multiplies it. A geometry with NO colour attribute
// under vertexColors reads every vertex as black and multiplies the material colour away, so
// the tetrahedron has to opt out — the symptom is a marker that is present, correctly placed,
// and invisibly dark.
function makePinPart(geo, vertexColored = true) {
  const p = makePair(geo, 0xffffff);
  for (const o of [p.solid, p.ghost]) {
    o.material.vertexColors = vertexColored;
    o.material.needsUpdate = true;
  }
  p.solid.renderOrder = p.ghost.renderOrder = 9998;
  return p;
}

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
// Halved from 0.5 on the evidence the drawn capsules provide: at half a bone's length the
// envelopes read as bloated tubes rather than as limbs, and they swamped the bones they were
// meant to wrap. This is the number every downstream weight inherits.
const DEFAULT_RADIUS_FRAC = 0.25;
function radiusFrac() {
  const v = window._boneRadiusFrac;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RADIUS_FRAC;
}

// Solid + xray ghost pair. The ghost draws only where occluded (GreaterDepth), so it
// reveals the part of the skeleton buried inside the mesh without ever becoming an
// always-on-top overlay (which reads as a stereo headache and loses all depth cue).
// A bone's body width, from its own length. Proportional to the bone so a long limb reads as
// a limb — this is the size it has always been, and thinning it turns the rig into needles.
function boneWidth(len, jr) { return Math.max(len * 0.12, jr * 0.6); }

// Joint markers are ONE size across the whole rig. Sizing each one off the bone below it did
// keep every joint clear of its own bone, but it made a rig of mixed bone lengths a string of
// mismatched beads — which reads as noise, and as meaning something it does not. A constant
// is the honest choice: the marker says "a joint is here", and that claim is the same size
// everywhere. JOINT_R_FRAC is the single knob; bones stay proportional to their own length.
const JOINT_R_FRAC = 0.03;

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

// Exported so the panel shows the default the rig actually uses instead of its own copy of
// the number — the two drifting apart is how a slider ends up lying about the current value.
// Must live BELOW `const Skeleton`: assigning onto it from up beside DEFAULT_RADIUS_FRAC put
// the write in the const's temporal dead zone and the whole module failed to evaluate.
Skeleton.defaultRadiusFrac = function () { return DEFAULT_RADIUS_FRAC; };
Skeleton.radiusFraction = radiusFrac;

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
const _wireCol = new THREE.Color();
Skeleton.boneColor = function (main, joint) {
  if (!joint || !joint.getID) return _fallbackColor;
  const slots = colorSlots(main);
  const s = slots.get(joint.getID());
  return s === undefined ? _fallbackColor : paletteColor(s);
};

Skeleton.joints = function (main) {
  return (main.getMeshes() || []).filter(Skeleton.isJoint);
};

// The rig visuals a SNAPSHOT must not see. Everything else in the skeleton group is real rig
// and belongs in a thumbnail — a library of skeleton assets is unusable if every card is an
// empty grey square.
//
// It is only the preview cursor that has to go, and the reason is not that it looks untidy:
// `Box3.setFromObject` ignores visibility, so the preview bone parked wherever the controller
// was last pointing still counts toward the bounding box even when hidden, and the auto-framing
// then pulls the camera back until the sculpt is a speck. Hiding the whole group was the blunt
// way to dodge that. These four objects are the entire problem.
Skeleton.snapshotHide = function (main) {
  const pv = main && main._skelPreview;
  if (!pv) return [];
  return [pv.bone.solid, pv.bone.ghost, pv.dot.solid, pv.dot.ghost];
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
  // No sculpt in the scene — deleted, or a skeleton built before one exists. Fall back to
  // the SKELETON's own extent rather than to 1: every marker, snap radius and default bone
  // radius is scaled by this, so a rig drawn at scene scale suddenly measured against 1
  // makes its own joints too small to see and its snaps too tight to hit.
  if (best <= 1e-6) {
    const js = Skeleton.joints(main);
    if (js.length) {
      _pA.set(0, 0, 0);
      for (const j of js) _pA.add(Skeleton.jointPos(j, _pB));
      _pA.divideScalar(js.length);
      for (const j of js) best = Math.max(best, _pA.distanceTo(Skeleton.jointPos(j, _pB)));
    }
  }
  // Empty scene: no sculpt AND no joints yet, so there is no object to take a scale from.
  // Use how far the camera is pulled back — that is the size of what the user is looking at,
  // and it is the difference between a usable snap plane and a postage stamp at the origin.
  if (best <= 1e-6) {
    const cam = main.getCamera && main.getCamera();
    const d = cam && cam._trans ? Math.abs(cam._trans[2]) : 0;
    if (d > 1e-6) best = d * 0.3;
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

// The pin null itself. Lives HERE rather than in IKSolver because the loader needs to build
// one during a pre-v3 migration, and IKSolver already imports Skeleton — putting it the other
// way round would close a cycle. IKSolver.makePinObject delegates to this, so there is one
// implementation rather than two that drift.
Skeleton.makePin = function (main, joint) {
  if (!main || !main.buildNull) return null;
  const pin = main.buildNull();
  pin._typeName = 'Pin';
  pin._isPinTarget = true;
  pin._pinnedJoint = joint;
  // Named after the bone it constrains: "Pin 7" tells you nothing in an outliner, and being
  // findable is most of the point of a pin being an object. Set before attach, since the scene
  // only invents a label when there is not one already.
  const jn = joint && joint._permanentStaticLabel;
  pin._permanentStaticLabel = jn ? 'pin_' + jn : 'pin';
  main.addMeshSilent(pin);
  if (main.decorateNull) main.decorateNull(pin);
  // The skeleton pass draws the triad and gimbal at this transform, so the null's own
  // cruciform would be a second marker in the same place.
  const tm = pin.getThreeMesh && pin.getThreeMesh();
  const cross = tm && tm.children && tm.children.find((c) => c.name === 'null_cruciform');
  if (cross) cross.visible = false;
  if (joint) {
    _mTmp.fromArray(joint.getModelSpaceMatrix());
    _mTmp.decompose(_vTmp, _qPin, _sTmp);
    _mTmp.compose(_vTmp, _qPin, _sOnePin);
    if (pin.setModelSpaceMatrix) pin.setModelSpaceMatrix(_mTmp.elements);
    else mat4.copy(pin.getMatrix(), _mTmp.elements);
  }
  return pin;
};

// ---- rig preselection -------------------------------------------------------------
//
// SHARED BY EVERY TOOL THAT CAN TAKE A RIG NODE. Grab and Transform both need "the marker under
// the cursor grows and warms", and this session has twice been bitten by the same logic living
// in two places and drifting — the mouse and VR picks, and the graph editor's channel
// accessors. One implementation, two entry points for the two kinds of ray.
//
// Throttled: a full pick plus a visual rebuild at 90Hz costs more frame than preselection is
// worth, and the cost showed up not as slowness but as VR grab failing outright. A hand does
// not move fast enough to need more, and the highlight is sticky between checks.
function applyRigHover(main, node) {
  if (window._grabTrace) {
    console.log('[rigHover] node=' + (node ? (node._permanentStaticLabel || node.getID()) : 'none')
      + ' kind=' + (node ? (node._isPinTarget ? 'pin' : 'bone') : '-'));
  }
  const wasJ = main._skelHighlightId ?? -1;
  const wasP = main._pinHighlightId ?? -1;
  Skeleton.setRigHighlight(main, node);
  if ((main._skelHighlightId ?? -1) !== wasJ || (main._pinHighlightId ?? -1) !== wasP) {
    Skeleton.updateVisuals(main);
    main.render?.();   // only raises the redraw flag; without it the hover never reaches screen
  }
}

function applyRigHovers(main, nodes, primaryNode, hands = []) {
  const jointIds = nodes.filter((n) => n && !n._isPinTarget).map((n) => n.getID());
  const pinIds = nodes.filter((n) => n?._isPinTarget).map((n) => n.getID());
  const handMap = {};
  nodes.forEach((node, i) => { if (node) handMap[node.getID()] = hands[i]; });
  const before = `${main._skelHighlightIds || ''}|${main._pinHighlightIds || ''}|${JSON.stringify(main._rigHoverHands || {})}`;
  main._skelHighlightIds = jointIds;
  main._pinHighlightIds = pinIds;
  main._rigHoverHands = handMap;
  const isPin = !!primaryNode?._isPinTarget;
  main._skelHighlightId = primaryNode && !isPin ? primaryNode.getID() : -1;
  main._pinHighlightId = isPin ? primaryNode.getID() : -1;
  const after = `${jointIds}|${pinIds}|${JSON.stringify(handMap)}`;
  if (before !== after) {
    Skeleton.updateVisuals(main);
    main.render?.();
  }
}

function hoverDue(main, channel = 'mouse') {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const key = channel === 'vr' ? '_rigHoverAtVR' : '_rigHoverAtMouse';
  if (main[key] && (now - main[key]) < (window._grabHoverMs || 66)) return false;
  main[key] = now;
  return true;
}

const isRigNode = (m) => !!(m && (m._isBone || m._isPinTarget));

// A HOVER MUST LEAVE THE PICK EXACTLY AS IT FOUND IT.
//
// The picking object is shared state: a pick writes `_mesh`, `_interPoint` and `_pickedFace`,
// and the tools read those to decide what was clicked. Running a preselection pick every frame
// therefore clobbers whatever the tool had — which locked the Transform gizmo up completely,
// since the gizmo consults exactly those fields to work out which handle you took. Snapshot
// and restore, so preselection is a read and nothing else.
function pickPreserving(picking, fn) {
  const mesh = picking._mesh;
  const inter = picking._interPoint ? picking._interPoint.slice() : null;
  const face = picking._pickedFace;
  let hit = null;
  try { hit = fn(); } finally {
    picking._mesh = mesh;
    if (inter && picking._interPoint) {
      picking._interPoint[0] = inter[0];
      picking._interPoint[1] = inter[1];
      picking._interPoint[2] = inter[2];
    }
    picking._pickedFace = face;
  }
  return hit;
}

// Desktop / iPad: pick from the cursor.
Skeleton.hoverRigFromMouse = function (main, picking) {
  if (window._grabTrace && (!main || !picking)) {
    console.log('[rigHover] mouse: main=' + !!main + ' picking=' + !!picking);
  }
  if (!main || !picking || !hoverDue(main, 'mouse')) return;
  const hit = pickPreserving(picking, () =>
    picking.intersectionMouseMeshes(main.getMeshes(), main._mouseX, main._mouseY, false, true)
      ? picking.getMesh() : null);
  applyRigHover(main, isRigNode(hit) ? hit : null);
};

// VR: pick from the controller ray Scene supplies. NOT derived from the controller matrix —
// that is the raw WebXR frame, and picking against it misses every mesh in the scene.
Skeleton.hoverRigFromRay = function (main, picking, origin, dir) {
  if (!main || !picking || !origin || !dir || !hoverDue(main, 'vr')) return;
  // Rig hover is an x-ray operation: skin geometry must not occlude the bone/pin that the
  // controller is visibly aiming at. Use the same target class as rig acquisition.
  const vis = main.getMeshes().filter((m) => m.isVisible() && isRigNode(m));
  const hit = pickPreserving(picking, () =>
    picking.intersectionRayMeshes(vis, origin, dir, true) ? picking.getMesh() : null);
  applyRigHover(main, isRigNode(hit) ? hit : null);
};

// VR Grab supplies a complete controller snapshot even though Scene dispatches the tool
// through the dominant hand. Pick both rays so each controller gets independent preselection;
// keep the dominant ray in the legacy singular fields used by face-button actions.
Skeleton.hoverRigFromRays = function (main, picking, rays, primaryHand) {
  if (!main || !picking || !rays?.length || !hoverDue(main, 'vr')) return;
  const vis = main.getMeshes().filter((m) => m.isVisible() && isRigNode(m));
  const hits = rays.map(({ origin, direction }) => {
    const hit = pickPreserving(picking, () =>
      picking.intersectionRayMeshes(vis, origin, direction, true) ? picking.getMesh() : null);
    return isRigNode(hit) ? hit : null;
  });
  const primaryIndex = Math.max(0, rays.findIndex((r) => r.handedness === primaryHand));
  applyRigHovers(main, hits, hits[primaryIndex] || null, rays.map((r) => r.handedness));
};

Skeleton.setHighlight = function (main, joint) {
  main._skelHighlightIds = null;
  main._pinHighlightIds = null;
  main._skelHighlightId = joint ? joint.getID() : -1;
};

// Preselection for the rig, whatever kind of node is under the cursor. A pin is not a joint,
// so it cannot ride _skelHighlightId — but it needs the same "the next press acts on THIS"
// feedback, or reaching for a pin is guesswork.
Skeleton.setRigHighlight = function (main, node) {
  main._skelHighlightIds = null;
  main._pinHighlightIds = null;
  const isPin = !!(node && node._isPinTarget);
  main._skelHighlightId = node && !isPin ? node.getID() : -1;
  main._pinHighlightId = isPin ? node.getID() : -1;
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

// The overlay group, for anything that draws alongside the rig. Exported so the motion trail
// can live in its own module: a trail needs the animation registry AND the solver, and Skeleton
// can import neither (IKSolver imports Skeleton, and closing that cycle leaves the whole rig
// undefined at load — see the findings doc).
Skeleton.overlayGroup = skelGroup;

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

    // The dashed leader from a pinned joint to the anchor it is trying to reach. Two points,
    // rewritten each frame; the dash pattern needs computeLineDistances() after every move.
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const link = new THREE.Line(linkGeo, new THREE.LineDashedMaterial({
      color: PIN_LINK_COLOR, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    }));
    link.renderOrder = 10000;
    link.isPickable = false;
    link.frustumCulled = false;

    e = {
      pinLink: link,
      pinT: makePinPart(triadGeometry()),
      pinG: makePinPart(gimbalGeometry()),
      pinS: makePinPart(tetraGeometry(), false),
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
          e.wire.solid, e.wire.ghost, e.label.sprite, e.pinLink,
          e.pinT.solid, e.pinT.ghost, e.pinG.solid, e.pinG.ghost,
          e.pinS.solid, e.pinS.ghost);
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
  if (e.pinLink) {
    g.remove(e.pinLink);
    e.pinLink.geometry.dispose(); e.pinLink.material.dispose();
  }
  for (const p of [e.bone, e.joint, e.wire, e.pinT, e.pinG, e.pinS, ...caps]) {
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
  const jr = unit * JOINT_R_FRAC;
  const live = new Set();
  const hi = main._skelHighlightId ?? -1;
  const hiAll = new Set(main._skelHighlightIds || [hi]);
  const pinHiAll = new Set(main._pinHighlightIds || [main._pinHighlightId ?? -1]);
  const hoverHands = main._rigHoverHands || {};
  const grabHands = main._rigGrabHands || {};
  const handColor = (hand) => hand === 'right' ? RIGHT_HAND_COLOR
    : (hand === 'left' ? LEFT_HAND_COLOR : null);
  const showLen = Skeleton.displayFlag('lengths');
  // The bind capsules, drawn. They are the actual support of the capsule bind — a vertex
  // outside every capsule gets no weight from any of them — so seeing them is the difference
  // between tuning weights by argument and tuning them by eye.
  const showCaps = Skeleton.displayFlag('capsules');
  // The bone body and its edge overlay, each switchable. Turn both off and only the joint
  // markers remain — which is the pose-mode display: the spheres are what you aim at, and the
  // bones between them are just something to see the sculpt through.
  const showSolid = Skeleton.displayFlag('solid');
  const showWire = Skeleton.displayFlag('wire');
  // Joint spheres and pin controls are independent display layers. Pins remain available
  // while joint spheres are hidden, which is useful for a lighter puppeteering view.
  const showJoints = Skeleton.displayFlag('joints');
  const showPins = Skeleton.displayFlag('pins');
  // Which joints have a bone hanging off them. Built once per draw rather than asked per joint,
  // and used by the pin tint below to spot a pinned LEAF, which no bone grows out of.
  const hasChildBone = new Set();
  for (const j of joints) {
    const p = j._parentMesh;
    if (Skeleton.isJoint(p)) hasChildBone.add(p.getID());
  }
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
      e.pinT.solid.visible = e.pinT.ghost.visible = false;
      e.pinG.solid.visible = e.pinG.ghost.visible = false;
      e.pinS.solid.visible = e.pinS.ghost.visible = false;
      e.pinLink.visible = false;
      hideCaps(e);
      continue;
    }

    Skeleton.jointPos(j, _pB);

    // Preselection: the joint the next trigger will act on. Colour AND size both change —
    // colour alone is easy to lose against a warm-coloured sculpt, and in a headset the
    // size change is what reads at a glance.
    const isHi = hiAll.has(id);
    const isSel = sel.has(id);
    const jointHandColor = handColor(grabHands[id] || hoverHands[id]);
    for (const o of [e.joint.solid, e.joint.ghost]) {
      o.position.copy(_pB);
      o.scale.setScalar(isHi || isSel ? jr * 1.7 : jr);
      o.material.color.setHex(jointHandColor || (isHi ? HILITE_COLOR : (isSel ? SELECT_COLOR : JOINT_COLOR)));
      o.visible = showJoints;
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }

    // The IK pin marker: triad for a position pin, triad + gimbal rings for a 6DOF one. Read
    // straight off the joint rather than through IKSolver, so the visuals stay independent of
    // the solver (and there is no import cycle).
    // Declared out here, not inside the `if (pinMode)` below: the preselection highlight
    // further down needs it whether or not this joint is pinned.
    const pinObj = j._boneIKPinObj;
    const pinMode = (pinObj && pinObj._isPinTarget) ? ((pinObj._pinMode | 0) & 3) : 0;
    if (pinMode) {
      // THE MARKER BELONGS AT THE ANCHOR, NOT AT THE JOINT.
      //
      // A pin is a fixed point in space that the joint is trying to reach, and it is never
      // moved by the solver — an unreachable pin is one the joint falls SHORT of. Drawing the
      // marker on the joint made the pin look like it was being dragged along with the ankle,
      // which is exactly the wrong story: it hid the shortfall instead of showing it. The
      // dashed leader below draws the gap so a pin that is not being met is visible as a gap.
      //
      // Read off the joint's own fields rather than through IKSolver, so the visuals stay
      // independent of the solver and there is no import cycle. A rig loaded from a save file
      // has no anchor yet — the saved pose IS the pinned pose, so the joint is the right
      // reading until the solver takes its own.
      if (pinObj && pinObj.getModelSpaceMatrix) {
        const pm = pinObj.getModelSpaceMatrix();
        _vPin.set(pm[12], pm[13], pm[14]);
      } else {
        _vPin.copy(_pB);
      }
      // A 3DOF triad turns with the limb, a 6DOF one holds still — which is what lets the two
      // states tell themselves apart in motion. The 6DOF marker now takes the ANCHORED
      // orientation, so it really is still rather than merely nearly so.
      if (pinMode > 1 && pinObj && pinObj.getModelSpaceMatrix) {
        _mTmp.fromArray(pinObj.getModelSpaceMatrix());
        _mTmp.decompose(_vTmp, _qPin, _sTmp);
      } else {
        _mTmp.fromArray(j.getModelSpaceMatrix());
        _mTmp.decompose(_vTmp, _qPin, _sTmp);
      }
    }
    // The pin marker grows and warms the same way a joint does under the cursor: same signal,
    // same meaning, so the two read as one preselection rather than two conventions.
    const pinHot = pinObj && pinHiAll.has(pinObj.getID());
    const pinHandColor = pinObj ? handColor(grabHands[pinObj.getID()] || hoverHands[pinObj.getID()]) : null;
    // A steering goal is NOT a triad with a different colour — it is its own marker, and the
    // triad and the rings are both switched off for it. `pinMode > 1` used to light the gimbal,
    // which quietly gave the steering goal a set of orientation rings it does not have.
    const pinParts = [
      [e.pinT, showPins && (pinMode === 1 || pinMode === 2), jr * (pinHot ? 3.0 : 2.2)],
      [e.pinG, showPins && pinMode === 2, jr * (pinHot ? 3.0 : 2.2)],
      [e.pinS, showPins && pinMode === 3, jr * (pinHot ? 2.0 : 1.5)],
    ];
    // The gap between where the joint is and where it is pinned. Shown only when there IS a
    // gap worth showing: a pin that is being met draws no leader, so a visible dash always
    // means the solve is falling short.
    const gap = showPins && pinMode ? _vPin.distanceTo(_pB) : 0;
    if (gap > jr * 0.35) {
      const pa = e.pinLink.geometry.getAttribute('position');
      pa.setXYZ(0, _pB.x, _pB.y, _pB.z);
      pa.setXYZ(1, _vPin.x, _vPin.y, _vPin.z);
      pa.needsUpdate = true;
      e.pinLink.geometry.computeBoundingSphere();
      e.pinLink.material.dashSize = jr * 0.8;
      e.pinLink.material.gapSize = jr * 0.6;
      e.pinLink.computeLineDistances();
      e.pinLink.visible = true;
    } else {
      e.pinLink.visible = false;
    }

    for (const [part, on, size] of pinParts) {
      for (const o of [part.solid, part.ghost]) {
        o.visible = on;
        if (!on) continue;
        if (o.material && o.material.color) {
          o.material.color.setHex(pinHandColor || (pinHot ? HILITE_COLOR
            : (pinMode === 3 ? PIN_SOFT_COLOR
              : (pinMode === 2 ? PIN_FULL_COLOR : PIN_POS_COLOR))));
        }
        o.position.copy(_vPin);
        o.quaternion.copy(_qPin);
        o.scale.setScalar(size); // sits outside the marker, including its highlight size
        o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
      }
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
    const w = boneWidth(len, jr);
    // TINTED BY THE PIN AT THE BONE'S ROOT, not at its tip. Pinning the ankle colours the FOOT
    // — the bone that grows out of the pinned joint — because "the pin is at the root of the
    // foot" is how a rig is read and talked about, and tinting the shin instead invites you to
    // hunt for which end of it the pin is actually on.
    //
    // A pinned LEAF has no bone growing out of it and would show nothing at all, so it falls
    // back to the bone that ENDS there. That is the one case where the two readings cannot
    // agree, and showing the pin somewhere beats showing it nowhere.
    const rootPin = (parent._boneIKPinObj && parent._boneIKPinObj._isPinTarget)
      ? ((parent._boneIKPinObj._pinMode | 0) & 3) : 0;
    const leafPin = hasChildBone.has(id) ? 0 : pinMode;
    const tintMode = rootPin || leafPin;
    // IDENTITY COLOUR WHILE RIGGING, plain yellow otherwise. The capsule below already wears
    // the colour of the joint that moves it, and matching the bone to it is what lets you read
    // which bone is which at a glance — the same reason the capsules are coloured at all. It
    // is only useful while you are in the rig though: outside Bone Draw the colours are noise
    // competing with the sculpt, so the bones go back to being one quiet yellow. A pin still
    // wins over both, because pin state is the thing you most need to not miss.
    const rigging = main.getSculptManager?.()?.getToolIndex?.() === Enums.Tools.BONE_DRAW;
    const ident = rigging ? Skeleton.boneColor(main, parent) : null;
    const restTint = ident ? ident.getHex() : BONE_COLOR;
    // A steering goal does not tint the bone: the bone below a HARD pin is being held, which is
    // worth colouring, and the bone below a steering goal is not held at all.
    const boneTint = tintMode === 2 ? PIN_FULL_COLOR : (tintMode === 1 ? PIN_POS_COLOR : restTint);
    // The edge overlay takes the same identity colour DARKENED rather than the colour itself.
    // Its whole job is to make the bone's roll and taper legible, and it can only do that by
    // contrasting with the body it sits on — matched exactly, the ridge lines disappear into
    // the face they are drawn over and the bone reads as a flat lozenge again.
    const wireTint = ident ? _wireCol.copy(ident).multiplyScalar(0.35).getHex() : BONE_EDGE;
    for (const o of [e.bone.solid, e.bone.ghost, e.wire.solid, e.wire.ghost]) {
      const isBody = o === e.bone.solid || o === e.bone.ghost;
      o.position.copy(_pA);
      o.quaternion.copy(_q);
      o.scale.set(w, len, w);
      o.visible = isBody ? showSolid : showWire;
      o.material.color.setHex(isBody ? boneTint : wireTint);
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
  const jr = Skeleton.sceneUnit(main) * JOINT_R_FRAC;

  // The cursor says which of two things the next trigger will do. Continuing a chain draws it
  // full size in the joint colour, at the end of the preview bone; with no chain in progress
  // it is a smaller blue dot — a place to START one. Without that difference, ending a chain
  // looks exactly like not having ended it, and the only other signal is a log line that is
  // hidden by default.
  const rooting = !fromPos;
  for (const o of [pv.dot.solid, pv.dot.ghost]) {
    o.position.copy(toPos);
    o.scale.setScalar(rooting ? jr * 0.6 : jr);
    o.material.color.setHex(rooting ? PLANE_COLOR : JOINT_COLOR);
    o.visible = true;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }

  if (!fromPos) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _dir.subVectors(toPos, fromPos);
  const len = _dir.length();
  if (len < 1e-6) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _q.setFromUnitVectors(_up, _dir.divideScalar(len));
  const w = boneWidth(len, jr);
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
  // The plane is READ off the sculpt, but it does not belong to the sculpt — it is where the
  // centreline of the thing being rigged is. With no sculpt (deleted, or a skeleton being
  // built before one exists) the world centreline is still a perfectly good answer, and it
  // is the only way to draw a symmetric rig without a mesh in the scene. Returning null here
  // took the plane, the snap and the mirrored joints away all at once.
  if (!m || !m.getSymmetryOrigin) {
    return { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  }
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

// ---- mirror pose ---------------------------------------------------------------
//
// Pose one arm, mirror it onto the other. Cheap to build because the hard part was already
// done: `_boneMirror` links each side joint to its twin, they are set as the chain is drawn
// and they survive a save, so there is no name matching, no "_L"/"_R" string surgery, and no
// guessing which joint pairs with which.
//
// THE ROTATION IS CONJUGATED, NOT COPIED. Reflecting an orthonormal frame gives an improper
// one — a left-handed basis is not a rotation and a joint cannot hold it. The transform that
// IS a rotation is P·M·P, reflecting both the input and the output of the joint's own
// rotation: two sign flips, so the determinant comes back to +1. Copying the rotation across
// instead produces a twin that is rotated the same way rather than the opposite way, which
// looks right on a shoulder shrug and inside out on anything with a twist in it.
//
// Positions come out of the same product for free — P·M·P applied to the translation column
// is the plane reflection of the joint's position, which is what `mirrorPoint` does on its
// own — so one matrix expression covers the whole transform.
const _mMirror = new THREE.Matrix4(), _mSrc = new THREE.Matrix4();

// The reflection matrix for a plane, as a Matrix4: I - 2nnT about the plane's origin.
function reflectionMatrix(plane, out) {
  const n = plane.normal, o = plane.origin;
  const d = 2 * n.dot(o);
  out.set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, n.x * d,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, n.y * d,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, n.z * d,
    0, 0, 0, 1);
  return out;
}

// Which side of the plane a joint is on. Used to pick the SOURCE side from the selection:
// you have just been holding the arm you posed, so the joint that happens to be selected is
// the best statement of "this side is the one I mean" available without asking.
Skeleton.jointSide = function (joint, plane) {
  return Skeleton.planeDistance(Skeleton.jointPos(joint), plane);
};

// Mirror the pose across the sculpt's symmetry plane.
//
// `side` picks the source: a positive number takes the joints on the plane's +normal side,
// negative the other, and 0 (or absent) means SWAP — every twin pair exchanges poses, which is
// the "flip the pose" command rather than the "copy one side" one.
//
// `controls`, when supplied, is the set of authored joints to mirror. This keeps an IK pose
// sparse: keyed hips and active effectors are controls, while unkeyed knees and elbows are
// solver output and should be rebuilt rather than baked. With no set this remains the static
// pose command and mirrors the complete evaluated rig.
Skeleton.mirrorPose = function (main, side, controls) {
  const plane = Skeleton.symmetryPlane(main);
  if (!plane) return { ok: false, why: 'symmetry is off — turn it on to mirror a pose' };
  const joints = Skeleton.joints(main);
  const has = new Set(joints);
  const authored = controls && new Set(Array.from(controls, (j) => typeof j === 'object' ? j : null));
  const use = (j) => !authored || authored.has(j);
  reflectionMatrix(plane, _mMirror);

  // Every unordered twin pair, once.
  const pairs = [];
  const seen = new Set();
  for (const j of joints) {
    const t = j._boneMirror;
    if (!t || !has.has(t) || seen.has(j) || seen.has(t)) continue;
    seen.add(j); seen.add(t);
    pairs.push([j, t]);
  }
  if (!pairs.length) return { ok: false, why: 'no mirrored joints (draw the rig with Snap Plane on)' };

  // The mirrored transform of a joint, in MODEL space. Read before anything is written: a
  // parent that has already moved would change what its children reflect to, and a swap reads
  // both sides of every pair.
  const target = new Map();
  const mirrorOf = (j) => {
    _mSrc.fromArray(j.getModelSpaceMatrix());
    return new THREE.Matrix4().multiplyMatrices(_mMirror, _mSrc).multiply(_mMirror);
  };

  // Which joint drove which, kept because the PINS have to be mirrored from the same source —
  // and a pin's anchor is not derivable from the posed joint. A pin can be unreachable (the
  // joint falls short of it, and the gap is the whole diagnostic) and a steering goal is
  // deliberately somewhere the joint is not, so snapping the twin's pin onto the twin's joint
  // gets both of those wrong.
  const srcOf = new Map();
  let n = 0;
  for (const [a, b] of pairs) {
    const da = Skeleton.jointSide(a, plane);
    let src = null, dst = null;
    if (!side) {                       // swap
      if (!use(a) && !use(b)) continue;
      target.set(a, mirrorOf(b)); srcOf.set(a, b);
      target.set(b, mirrorOf(a)); srcOf.set(b, a);
      n += 2;
      continue;
    }
    src = (da * side > 0) ? a : b;     // the joint on the requested side drives
    dst = (src === a) ? b : a;
    if (!use(src)) continue;
    target.set(dst, mirrorOf(src));
    srcOf.set(dst, src);
    n++;
  }

  // A joint without a twin is not necessarily centred in the current pose. Hips can travel
  // metres to one side and a spine can carry a large twist. They mirror IN PLACE: the source
  // and destination object are the same, but its model transform is still conjugated by P.
  for (const j of joints) {
    if (seen.has(j) || !use(j)) continue;
    // An unpaired tip below a paired hand is not a centre control; it rides the mirrored hand
    // frame. Only the unpaired trunk (no paired ancestor) reflects in place.
    let pairedAncestor = false;
    for (let p = j._parentMesh; p; p = p._parentMesh) {
      if (p._boneMirror && has.has(p._boneMirror)) { pairedAncestor = true; break; }
    }
    if (pairedAncestor) continue;
    target.set(j, mirrorOf(j));
    srcOf.set(j, j);
    n++;
  }

  // Pin controls are independent of bone-transform controls. A static foot pin must swap even
  // when the foot itself has no track; keying the solved foot merely because its pin exists
  // would turn solver output into another authored control.
  const pinSrcOf = new Map(srcOf);
  for (const [a, b] of pairs) {
    const ap = a._boneIKPinObj, bp = b._boneIKPinObj;
    if (!ap && !bp) continue;
    if (!side) {
      pinSrcOf.set(a, b); pinSrcOf.set(b, a);
    } else {
      const src = Skeleton.jointSide(a, plane) * side > 0 ? a : b;
      pinSrcOf.set(src === a ? b : a, src);
    }
  }
  for (const j of joints) {
    if (seen.has(j) || !j._boneIKPinObj) continue;
    let pairedAncestor = false;
    for (let p = j._parentMesh; p; p = p._parentMesh) {
      if (p._boneMirror && has.has(p._boneMirror)) { pairedAncestor = true; break; }
    }
    if (!pairedAncestor) pinSrcOf.set(j, j);
  }

  if (!target.size && !pinSrcOf.size) {
    return { ok: false, why: 'no authored controls to mirror at this frame' };
  }

  // The pin setup, read BEFORE anything is written. A swap needs both sides' pins as they were,
  // and creating one twin's pin would otherwise be visible to the other twin's turn.
  const pinWas = new Map();
  for (const j of pinSrcOf.values()) {
    const pin = j._boneIKPinObj;
    pinWas.set(j, pin ? {
      mode: (j._boneIKPin | 0) & 3,
      m: new THREE.Matrix4().fromArray(pin.getModelSpaceMatrix()),
    } : null);
  }

  // Roots first: setModelSpaceMatrix converts through the parent's CURRENT world matrix, so a
  // child written before its parent would be placed relative to the old one. Same ordering the
  // loader and the bind-pose restore need, for the same reason.
  const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
  const ordered = Array.from(target.keys()).sort((x, y) => depth(x) - depth(y));
  for (const j of ordered) {
    j.setModelSpaceMatrix(target.get(j).elements);
    Skeleton.syncThree(j);
  }

  // MIRRORING A POSE MIRRORS THE PIN SETUP, not just the joints — a pin is what holds a foot
  // on the floor, and a mirrored leg with the old anchors still in place is pulled straight
  // back where it came from by the next solve, which reads as the mirror not having worked.
  //
  // Three cases, and only the first was handled before:
  //   both sides pinned  — the twin's anchor becomes the reflection of the SOURCE's anchor
  //   source only        — the twin gets a pin of the same mode, made where the reflection is
  //   twin only          — that pin goes, because the pose being copied does not have one
  //
  // The anchor is conjugated exactly like the pose (P·M·P), which matters for a 6DOF pin:
  // reflecting its orientation alone would hand the twin an improper frame to hold.
  let pinned = 0;
  const pinObjects = [];
  const added = [], removed = [];
  const pinOrdered = Array.from(pinSrcOf.keys()).sort((x, y) => depth(x) - depth(y));
  for (const dst of pinOrdered) {
    const src = pinSrcOf.get(dst);
    if (!src) continue;
    const was = pinWas.get(src);
    const dstPin = dst._boneIKPinObj;

    if (!was) {
      if (dstPin) {
        dst._boneIKPinObj = null;
        dst._boneIKPin = 0;
        removed.push(dstPin);
        pinned++;
      }
      continue;
    }

    let pin = dstPin;
    if (!pin) {
      pin = Skeleton.makePin(main, dst);
      if (!pin) continue;              // no scene to build one in
      dst._boneIKPinObj = pin;
      added.push(pin);
    }
    pin._pinMode = was.mode;
    dst._boneIKPin = was.mode;
    const m = new THREE.Matrix4().multiplyMatrices(_mMirror, was.m).multiply(_mMirror);
    pin.setModelSpaceMatrix(m.elements);
    Skeleton.syncThree(pin);
    pinObjects.push(pin);
    pinned++;
  }

  // The scene add/remove is the CALLER's, exactly as it is for Clear Pins: taking an object out
  // of the scene and putting it back is the undoable half, and the caller is the one holding
  // the undo record.
  return { ok: true, joints: n, pins: pinned, added: added, removed: removed,
    controls: ordered, pinObjects: pinObjects };
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
const SKEL_VERSION = 5;  // v3 adds the IK pin link per entry; v4 the selection lock; v5 the rest pose
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
    // A LOCKED MESH EARNS A ROW OF ITS OWN. The lock is set from the outliner on anything at
    // all, and a bound character is typically neither parented nor a bone — so without this
    // the one case that most wants saving is the one with nowhere to be written.
    if (!parented && !m._isBone && !m._selectLocked) return;
    entries.push({
      i: i,
      p: parented ? idxOf(p) : NONE,
      // Bit 0 = is a joint, bits 1-2 = IK pin mode (0 none, 1 position, 2 position+rotation).
      // The pin rides in spare bits of a field that was already a 32-bit word holding a single
      // boolean, so pins persist with NO version bump: an older build reads the whole word as
      // truthy and still sees a bone, and a v1/v2 file read here simply has the pin bits clear.
      // Bit 3 (v4) = selection lock. Same field, next spare bit — see the note above.
      bone: (m._isBone ? 1 : 0) | (((m._boneIKPin | 0) & 3) << 1) | (m._selectLocked ? 8 : 0),
      r: m._boneRadius || 0,
      mir: (m._isBone && m._boneMirror && idxOf(m._boneMirror) >= 0) ? idxOf(m._boneMirror) : NONE,
      // v3: which object this joint is pinned TO. The pin null itself is saved by the ordinary
      // mesh path — all this has to carry is the link, exactly as `mir` carries the mirror.
      // Without it a reloaded rig has pin MODES and nothing to attach them to.
      pin: (m._isBone && m._boneIKPinObj && idxOf(m._boneIKPinObj) >= 0) ? idxOf(m._boneIKPinObj) : NONE,
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

  // v5: the REST POSE — each joint's local matrix as the skeleton was drawn. It cannot be
  // recovered from the file otherwise: a rig is usually saved posed, and the solver evaluates
  // a keyed frame by putting every joint it owns back to rest first. Without this, reloading a
  // scene and scrubbing to the same frame gives a different pose from the session that saved
  // it — the rig would silently adopt whatever pose it was in at the first scrub as its rest.
  //
  // Written as its own section AFTER the skins rather than as extra words in each entry, so
  // the entry record keeps the size every older reader expects and only the new section is
  // version-gated.
  const rests = [];
  meshes.forEach((m, i) => { if (m && m._isBone && m._ikRest) rests.push({ i: i, m: m }); });

  if (!entries.length && !skins.length) return null;

  let slots = 3 + entries.length * 6 + 1;
  for (const s of skins) {
    slots += 3 + s.j.length + s.nbV * INFLUENCES * 2 + s.nbV * 3 + s.j.length * 16;
  }
  slots += 1 + rests.length * 17;

  const buf = new ArrayBuffer((slots + 2) * 4);
  const u = new Uint32Array(buf), f = new Float32Array(buf), i32 = new Int32Array(buf);
  let o = 0;
  u[o++] = SKEL_MAGIC; u[o++] = SKEL_VERSION; u[o++] = entries.length;
  for (const e of entries) {
    u[o++] = e.i; u[o++] = e.p; u[o++] = e.bone; f[o++] = e.r; u[o++] = e.mir; u[o++] = e.pin;
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

  u[o++] = rests.length;
  for (const r of rests) {
    u[o++] = r.i;
    for (let k = 0; k < 16; k++) f[o++] = r.m._ikRest[k];
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

// Pins are joined up at the very END of a load: a migrated pin has to be built where the joint
// finally stands, not where it stood before the file's matrices were applied.
const pendingPins = [];

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
      // v1/v2 entries are five words; v3 added the pin link. Read it only when the file says
      // it is there, or every field after it shifts by one.
      const pin = ver >= 3 ? u[o++] : NONE;
      const mesh = meshes[mi];
      if (!mesh) continue;
      rows.push({ mesh: mesh, parent: pi === NONE ? null : meshes[pi] || null, bone: bone, r: r, mir: mir, pin: pin });
    }

    // THE SELECTION LOCK, for every row — a locked mesh is usually not a joint, so this runs
    // over all of them rather than inside the joint loop below. Written for the first time in
    // v4; an older file simply has the bit clear, and the skin restore further down re-derives
    // it for bound meshes so a v3 file still comes back locked.
    if (ver >= 4) {
      for (const row of rows) row.mesh._selectLocked = !!(row.bone & 8);
    }

    // Restore the joint's own properties first — healGraph keys off _isBone, and the
    // no-draw material is not serialized (same caveat FrameGroup hits with its nulls).
    for (const row of rows) {
      if (!(row.bone & 1)) continue;
      const m = row.mesh;
      m._isBone = true;
      m._boneIKPin = (row.bone >> 1) & 3;
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

    // ---- IK pins ------------------------------------------------------------------
    //
    // v3 files carry the link and the pin null was saved as an ordinary mesh, so the two are
    // simply joined back up. Older files carry only the MODE, in the flag bits — for those a
    // pin is created where the joint is standing, which is the same reading the old code had:
    // the saved pose IS the pinned pose.
    //
    // Deferred to the end of the load, after the matrices are restored, or a migrated pin
    // would be built at whatever transform the joint had before the file was applied.
    pendingPins.length = 0;
    for (const row of rows) {
      if (!(row.bone & 1)) continue;
      const mode = (row.bone >> 1) & 3;
      if (!mode) continue;
      const pinMesh = row.pin !== NONE ? meshes[row.pin] : null;
      pendingPins.push({ joint: row.mesh, mode: mode, pin: pinMesh || null });
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
        // A BOUND MESH COMES BACK LOCKED, exactly as binding leaves it (Skinning.bind) —
        // otherwise a reloaded character is pickable again and the ray goes back to catching
        // the skin instead of the joints inside it.
        //
        // ONLY FOR PRE-v4 FILES. From v4 the lock is stored per mesh and has already been
        // applied above; re-deriving it here would override an explicit unlock, so a mesh you
        // deliberately unlocked would come back locked every time you opened the file.
        if (ver < 4) mesh._selectLocked = true;
      }
    }

    // v5: the rest pose, read after the skins for the reason given at the writer. A v4 file
    // simply has no section here, and those joints adopt a rest at the first evaluation — the
    // same fallback a rig drawn before this existed gets.
    if (ver >= 5) {
      const rn = u[o++];
      for (let i = 0; i < rn; i++) {
        const mi = u[o++];
        const m = meshes[mi];
        const rest = new Float32Array(16);
        for (let k = 0; k < 16; k++) rest[k] = f[o++];
        if (m) m._ikRest = rest;
      }
    }

    for (const p of pendingPins) {
      if (p.pin) {
        // v3: the null came back with the file. Re-flag it — _isPinTarget and the mode live on
        // the object and are not part of the mesh format.
        p.pin._isPinTarget = true;
        p.pin._pinMode = p.mode;
        p.pin._pinnedJoint = p.joint;
        p.pin._isNull = true;
        p.pin.isPickable = false;
        p.joint._boneIKPinObj = p.pin;
        p.joint._boneIKPin = p.mode;
      } else {
        // Pre-v3: only the mode survived, so a pin is made where the joint is standing.
        const made = Skeleton.makePin(main, p.joint);
        if (made) {
          made._pinMode = p.mode;
          p.joint._boneIKPinObj = made;
          p.joint._boneIKPin = p.mode;
        }
      }
    }
    pendingPins.length = 0;

    Skeleton.updateVisuals(main);
  } catch (e) {
    console.error('[Skeleton] import restore failed', e);
  }
};

// ---- bone display flags ---------------------------------------------------------
//
// ONE REGISTRY, because the same rule was written out at every call site as
// `window._boneShowX !== false` — a sentinel that hard-codes "default on" into the READ.
// Changing a default therefore meant finding every reader, and getting one wrong leaves a
// flag that is on in the viewport and off in the panel. Name -> [live global, saved option,
// default].
//
// Capsules and weights default OFF: both are diagnostics drawn over the sculpt, and neither
// is what you want to be looking at the moment you open the tool.
const DISPLAY_FLAGS = {
  snapPlane: ['_boneSnapPlane', 'boneSnapPlane', true],
  snapAxis: ['_boneSnapAxis', 'boneSnapAxis', true],
  lengths: ['_boneShowLengths', 'boneShowLengths', false],
  capsules: ['_boneShowCapsules', 'boneShowCapsules', false],
  weights: ['_boneShowWeights', 'boneShowWeights', false],
  solid: ['_boneShowSolid', 'boneShowSolid', true],
  wire: ['_boneShowWire', 'boneShowWire', true],
  joints: ['_boneShowJoints', 'boneShowJoints', true],
  pins: ['_boneShowPins', 'boneShowPins', true],
  // The path the selected joint takes over the timeline. Off by default: it costs a full
  // evaluation per sample, and it is an animation aid rather than something you want while
  // sculpting.
  trails: ['_boneShowTrails', 'boneShowTrails', false],
};
Skeleton.DISPLAY_FLAGS = DISPLAY_FLAGS;

// Live value first, then the saved one, then the default — the same order every other
// persisted VR setting is read in, so a toggle takes effect on the current frame.
Skeleton.displayFlag = function (name) {
  const e = DISPLAY_FLAGS[name];
  if (!e) return false;
  const live = window[e[0]];
  if (live != null) return !!live;
  const saved = getOptionsURL()[e[1]];
  return saved != null ? !!saved : e[2];
};

Skeleton.setDisplayFlag = function (name, on) {
  const e = DISPLAY_FLAGS[name];
  if (!e) return;
  window[e[0]] = !!on;
  getOptionsURL.saveOption(e[1], !!on, 0);
};

// The joint the ray is preselecting, if any — what "clicked on a bone" means for a face
// button, which is not aimed at anything itself.
//
// A HOVERED PIN COUNTS AS ITS JOINT. Pins sit exactly on the joint they hold and win the pick
// outright (higher rank, wider cone), so the moment you pin a joint the ray stops preselecting
// the BONE and starts preselecting the PIN. Reading only the bone highlight therefore made the
// binding work once and then go dead on that joint — you could pin, but never cycle or unpin,
// which reads as "it cannot pin a pin". The pin knows its joint, so ask it.
Skeleton.hoveredJoint = function (main) {
  if (!main) return null;
  const pinId = main._pinHighlightId;
  if (pinId != null && pinId >= 0) {
    const pin = (main.getMeshes() || []).find((m) => m._isPinTarget && m.getID() === pinId);
    if (pin && pin._pinnedJoint) return pin._pinnedJoint;
  }
  const id = main._skelHighlightId;
  if (id == null || id < 0) return null;
  return Skeleton.joints(main).find((j) => j.getID() === id) || null;
};

export default Skeleton;
