import * as THREE from 'three';
import NodeMaterials from '../render/nodes/NodeMaterials.js';
import { VERSION } from '../Version.js';
import RigPending from './RigPending.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mat4, vec3 } from 'gl-matrix';
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

// GRAY AT REST, so the two states that mean something can own a colour each. A rig that is
// already amber and cyan everywhere has nowhere left to say "this is what you would take" —
// matt: "make the default bone colour be a gray, so then we can use yellow for the preselect
// highlight, and cyan for a confirm selection". The dots are a shade LIGHTER than the bones so
// the two still read apart at rest.
const JOINT_COLOR = 0x9aa0ac;
const BONE_COLOR = 0x6c7280;
const BONE_EDGE = 0x1e1e2e;
const HILITE_COLOR = 0xffd733;  // preselection: yellow — "this is what the next press takes"
// CONFIRMED SELECTION. Was cyan (0x00e5ff), which sat too close to the random per-chain bone
// colours to read as "this one" -- and was not vibrant enough to win against them. matt: "the cyan
// especially isn't very vibrant. lets swap the cyan for the maya highlight colour which is roughly
// (0,255,170)." Same green Maya uses for a selected component, and it has no neighbour in the
// chain palette -- see CHAIN_HUE_EXCLUDE.
const SELECT_COLOR = 0x00ffaa;
// NO PER-HAND COLOURS. The rig used to tint whatever each controller was touching red or
// green by handedness, which put a third and fourth colour on a surface that already has to say
// "aimed at" and "selected" — and the hand doing it is the one thing you can already see,
// because it is attached to you. matt: "the red/green highlighting with the grab tool for the
// left/right controller is confusing." Held now reads as SELECTED, which is what it is.
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
const _pinHSL = { h: 0, s: 0, l: 0 };   // scratch for the pin-weight saturation ramp
const PLANE_COLOR = 0x89b4fa;
// The snap-plane cursor's radius, in METRES OF ROOM -- half of the 2cm diameter matt asked for.
// Deliberately not a fraction of sceneUnit: it is a "can you see it" marker, not a "does it match
// the bones" one, so it has to be the same size on a thimble and on a building.
const DISC_RADIUS_M = 0.01;
const PLANE_HOT = 0xa6e3a1;
const PIN_COLOR = 0xf38ba8;
const GHOST_OPACITY = 0.35;

const _mTmp = new THREE.Matrix4();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
// The mirror plane's own axes, and the cursor relative to it — see updatePlane.
const _vRight = new THREE.Vector3(), _vUp = new THREE.Vector3(), _vRel = new THREE.Vector3();
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

// ---- JOINT VOLUMES (roadmap #60) ------------------------------------------------
//
// A joint pair with a radius describes a limb well and a pelvis not at all. matt: "bones/joints
// are ultimately dimensionless entities that are ok when parented together for limbs and tails,
// but are always a tricky approximation for bones that have volume and heft, like the pelvis,
// the ribcage." The reference is 3ds Max CAT, whose bones ARE solid non-uniformly scaled boxes,
// so the skeleton reads as skeletal form rather than as a stick figure with envelopes bolted on.
//
// THE VOLUME BELONGS TO THE JOINT, NOT TO A BONE, because the case it exists for is a JUNCTION:
// "the hips is ultimately a t-junction; hips to the top of the leg joints, and hips to the base
// of the spine... i can only place a dome in one line segment of the T, not replace the entire
// T." So a volume sits at a joint, in that joint's frame, and swallows every bone leading out of
// it — those bones stop drawing and stop carrying an envelope, because the volume is the answer
// for the whole junction now. A plain limb segment is the same thing seen from its parent (a
// joint with one child), so there is no need for a second mechanism.
//
// 'none' is every joint until one is given a volume.

// Edge overlay for the bone octahedron. A shaded solid gives you position but reads almost
// flat from many angles — the ridge lines are what make the bone's ROLL and taper legible,
// which is the whole reason to draw an octahedron rather than a cylinder.
let _boneEdgeGeo = null;
function boneEdgeGeometry() {
  return (_boneEdgeGeo = _boneEdgeGeo || new THREE.EdgesGeometry(boneGeometry(), 1));
}

let _jointGeo = null;
function jointGeometry() { return (_jointGeo = _jointGeo || new THREE.SphereGeometry(1, 10, 8)); }

// ---- PHYSICS BONES ARE A DIFFERENT SHAPE ---------------------------------------
//
// A flagged joint and everything under it simulates, and there was no way to see that anywhere:
// the panel named the joint in a heading, which went stale the moment the selection moved, and
// nothing in the viewport or the outliner said anything at all. matt: "the physics header section
// displays the name of physics bones, don't do this. it doesn't stay up to date, its just
// confusing. better would be some visual indicator both in the outliner and in the 3dview."
//
// COLOUR IS NOT AVAILABLE. It is already carrying preselection (yellow), selection (cyan) and
// the per-joint tint the rig draws in, so a physics colour would either be overridden exactly
// when you were pointing at the thing or would override the states that tell you what a press
// will do. Shape is the one channel with nothing in it. matt: "we can't use colour, as the bones
// are random colours in bones mode. change the bone shape maybe, and the joint icon?"
//
// So: box instead of sphere at the joint, and a straight beam instead of the tapered octahedron
// along the bone. Both read at a glance and neither costs a draw call -- they are two more
// instanced batches, and a joint is in one or the other, never both. This is a DISPLAY variant
// only and has nothing to do with the joint VOLUMES that were built and removed: nothing here
// touches skinning, picking or the capsule envelope.
//
// Same local frame as the shapes they replace, so every line of placement code is untouched:
// the bone spans y 0..1 with x/z scaled by the bone width, the joint is a unit radius.
let _bonePhysGeo = null;
function bonePhysGeometry() {
  if (_bonePhysGeo) return _bonePhysGeo;
  // Narrower than the octahedron's widest ring (±1) so a beam does not read as fatter than the
  // bone it replaces -- it is a straight extrusion, so it carries its full width the whole way
  // where the octahedron only reaches that width for an instant.
  const g = new THREE.BoxGeometry(1.2, 1, 1.2);
  g.translate(0, 0.5, 0);
  return (_bonePhysGeo = g);
}

let _bonePhysEdgeGeo = null;
function bonePhysEdgeGeometry() {
  return (_bonePhysEdgeGeo = _bonePhysEdgeGeo
    || new THREE.EdgesGeometry(bonePhysGeometry(), 1));
}

let _jointPhysGeo = null;
function jointPhysGeometry() {
  // 1.5 across, so the box's faces sit just inside the sphere's radius and its corners just
  // outside: the same visual weight, a different silhouette.
  return (_jointPhysGeo = _jointPhysGeo || new THREE.BoxGeometry(1.5, 1.5, 1.5));
}

// Is this joint simulated? True for a flagged root AND for everything hanging below it, because
// what the marker has to answer is "does this bone swing", and the whole chain does. Walking up
// is what makes that cheap: no map to build, no list to keep in step with the flags, and it is
// a handful of property reads per joint on a rig of thirty.
function physicsGoverned(j) {
  for (let n = j; n; n = n._parentMesh) if (n._physicsRoot) return true;
  return false;
}

// ...AND THE BONE IS ONE JOINT HIGHER THAN THE JOINT IT BELONGS TO.
//
// A joint owns the bone that ENDS at it -- parent -> j -- which is the convention `_boneRadius`
// and the capsule bind already use. So asking physicsGoverned about the joint marked the bone
// ABOVE the flag: flag the elbow and the shoulder-to-elbow bone turned into a beam. matt: "it
// seems to affect one chain too high... it should just be from the elbow down."
//
// The rig agrees with him for a physical reason rather than a drawing one: the flagged joint is
// the ANCHOR, it rotates and does not translate, so it is not in the particle list at all (see
// PhysicsBones.chain). The bone hanging off it is the first thing that actually swings. Asking
// about the PARENT is the same question shifted by exactly that one link.
//
// The joint marker still goes on the flagged joint itself -- it is where the physics starts, and
// that is worth saying.
function physicsBoneGoverned(j) {
  return physicsGoverned(j && j._parentMesh);
}

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
// THE HIGHLIGHT NEEDS A MATERIAL OF ITS OWN, and the reason is the axis colouring.
//
// A triad and a gimbal carry their red/green/blue in VERTEX colours, and `material.color` then
// multiplies into them — which is exactly how the mode tint and its hue shift work. But a
// multiply cannot lift red, green and blue at the same time: cyan leaves the green and blue
// axes exactly as they were and kills the red one. The preselection colour was
// being written all along and had no way to show, which is why a pin under the cursor looked
// identical to one that was not. The same applies to the per-hand grab colour.
//
// So the highlight swaps to a copy of the same material with vertex colours OFF, where the
// colour is the whole colour. Built up front rather than toggling `vertexColors` on the live
// material: that flag forces a shader recompile, and recompiling on hover ENTER is a hitch in
// a headset — the one place where preselection matters most.
function makePinPart(geo, vertexColored = true) {
  const p = makePair(geo, 0xffffff);
  for (const o of [p.solid, p.ghost]) {
    o.material.vertexColors = vertexColored;
    o.material.needsUpdate = true;
    o.userData.vcMat = o.material;
    if (vertexColored) {
      const plain = o.material.clone();
      plain.vertexColors = false;
      plain.needsUpdate = true;
      o.userData.plainMat = plain;
    } else {
      o.userData.plainMat = o.material;   // nothing to lift: it is a flat marker already
    }
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
// FOUR TIMES THE SEGMENTS THE CAPSULES USED TO HAVE (14 radial, 10 rings). Where two capsules
// intersect, the seam is the intersection of two FACETED surfaces, so it is a zigzag whose
// amplitude is the facet's own sagitta -- r(1 - cos(pi/n)), which at 14 segments is 2.5% of the
// radius and lands at about a pixel at the zoom matt was working at. At 56 it is 0.06%. matt:
// "the triangles of cylinders vs joints vs other cylinders meet, it makes sawtooth artifacts...
// if these are being instanced/batched, could we try 4x the tessellation?"
//
// Measured on walkwave at full solidity, stipple pixels per thousand lit: 0.91 at 14 segments,
// 0.49 at 28, 0.44 at 56 -- so most of it is bought by 28 and the last of it by 56. They ARE
// instanced, so the cost is one geometry, not one per bone; what it does cost is triangles
// through the pipe, 566k for the solid and ghost passes together against about 140k at 28. That
// is nothing on a desktop GPU (0.44ms for the whole capsule pass, against 0.48ms at 28 -- fill,
// not vertices) and is worth watching on a Quest, where these two numbers are the knob.
// ...AND THE SEGMENT COUNT IS THE KNOB ON A HEADSET, so it is a setting rather than a literal.
//
// The measurement above is the whole argument: 56 buys the last of the sawtooth and costs 566k
// triangles across the solid and ghost passes, 28 buys most of it for 140k. That is free on a
// desktop GPU and is not free on a mobile one. matt: "its starting to feel gluggy on mobilevr."
//
// Persisted, so a value found in a headset survives the session it was found in.
const CAP_SEGMENTS_DEFAULT = 56;
function capsuleSegments() {
  const live = window._boneCapSegments;
  if (typeof live === 'number') return Math.max(8, Math.min(64, Math.round(live)));
  const saved = getOptionsURL().boneCapSegments;
  return typeof saved === 'number' ? Math.max(8, Math.min(64, saved)) : CAP_SEGMENTS_DEFAULT;
}

// Changing it has to throw away the geometries AND the batches built from them: an InstancedMesh
// holds its geometry, so a new segment count with the old batch still standing would keep drawing
// the old one. Dropping the batches makes the next visual pass rebuild them.
function setCapsuleSegments(main, n) {
  const v = Math.max(8, Math.min(64, Math.round(n || CAP_SEGMENTS_DEFAULT)));
  window._boneCapSegments = v;
  try { getOptionsURL.saveOption('boneCapSegments', v, 300); } catch (_) {}
  if (_capShaftGeo) { _capShaftGeo.dispose(); _capShaftGeo = null; }
  if (_capEndGeo) { _capEndGeo.dispose(); _capEndGeo = null; }
  const all = main && main._skelBatch;
  if (all) {
    for (const [key, b] of Array.from(all)) {
      if (!key.startsWith('capEnd') && !key.startsWith('capShaft')) continue;
      if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
      b.mesh.dispose();
      all.delete(key);
    }
    // The slots point at batches by key and are re-made with the entries, so the entries go too.
    for (const id of Array.from(main._skelVis ? main._skelVis.keys() : [])) disposeEntry(main, id);
  }
  Skeleton.updateVisuals(main);
  main?.render?.();
  return v;
}

function capsuleShaftGeometry() {
  const n = capsuleSegments();
  return (_capShaftGeo = _capShaftGeo || new THREE.CylinderGeometry(1, 1, 1, n, 1, true));
}
let _capEndGeo = null;
function capsuleEndGeometry() {
  const n = capsuleSegments();
  // Rings track segments so the sphere stays roughly isotropic rather than banded.
  return (_capEndGeo = _capEndGeo || new THREE.SphereGeometry(1, n, Math.max(6, Math.round(n * 0.71))));
}

// Default capsule radius as a fraction of the bone's own length. 0.15 was a guess with no
// evidence behind it, and every downstream weight inherited it; it is a tuning knob now, and
// the capsules are drawn, so the number can be judged by eye instead of by argument.
// Halved from 0.5 on the evidence the drawn capsules provide: at half a bone's length the
// envelopes read as bloated tubes rather than as limbs, and they swamped the bones they were
// meant to wrap. This is the number every downstream weight inherits.
const DEFAULT_RADIUS_FRAC = 0.25;
// The panel's slider for this was removed -- matt judged the default right and the control was
// costing more in mis-aimed presses than it was worth. `window._boneRadiusFrac` is kept as the
// override because it is how the number is tried from the console, which is how it was tuned to
// 0.25 in the first place; nothing in the UI writes it any more.
function radiusFrac() {
  const v = window._boneRadiusFrac;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RADIUS_FRAC;
}

// Solid + xray ghost pair. The ghost draws only where occluded (GreaterDepth), so it
// reveals the part of the skeleton buried inside the mesh without ever becoming an
// always-on-top overlay (which reads as a stereo headache and loses all depth cue).
// A bone's body width, from its own length. Proportional to the bone so a long limb reads as
// a limb — this is the size it has always been, and thinning it turns the rig into needles.
// A BONE'S WIDTH COMES FROM ITS OWN LENGTH AND NOTHING ELSE.
//
// There used to be a floor of `jr * 0.6` under this — no thinner than the joint dot — so that a
// short bone did not vanish inside the two markers at its ends. The dots are gone, so the floor
// has nothing left to clear, and what it had become was a bug: `jr` is the SCENE unit, one
// number for the whole rig, and on a rig with no sculpt to measure that unit is the rig's own
// half-extent. matt's was 57.9, which put the floor at 1.04 — so every bone shorter than 8.7
// units was forced to the same width regardless of its length, and a hand bone came out about
// thirty times too fat while the spine beside it looked fine. One bone gone huge, nothing else
// changed, and `rigUnit()` correctly reporting that the unit had not moved.
//
// So: no floor, and with it the last thing about a drawn bone that depends on the scene unit.
// A thin bone is not a hard target either — the pick is a screen-space test against the joint
// positions and never touches this geometry.
function boneWidth(len) { return len * 0.12; }

// Joint markers are ONE size across the whole rig. Sizing each one off the bone below it did
// keep every joint clear of its own bone, but it made a rig of mixed bone lengths a string of
// mismatched beads — which reads as noise, and as meaning something it does not. A constant
// is the honest choice: the marker says "a joint is here", and that claim is the same size
// everywhere. JOINT_R_FRAC is the single knob; bones stay proportional to their own length.
const JOINT_R_FRAC = 0.03;

// ── BATCHED RIG VISUALS ───────────────────────────────────────────────────────────────────
//
// Every bone body and joint dot used to be its own Mesh, drawn twice (solid + xray ghost). At
// twenty-five joints that is a hundred draw calls before anything else, and matt's frame timing
// put the cost exactly there: with a skeleton loaded, `draw` went 2.6ms to 11.3ms and the call
// count 23 to 185, while every other section stayed flat. It was never the solver or the trail.
//
// So the geometry is instanced instead: one InstancedMesh per KIND per pass, however many
// joints there are. Same look, same ghost, ~4 draw calls instead of ~100.
//
// THE CALL SITES DO NOT CHANGE, and that is the point. Each joint still gets an object with
// `position`, `quaternion`, `scale`, `visible` and `material.color` on it — a SLOT that records
// what was written and is flushed into the instanced buffers once, at the end of the pass. The
// four hundred lines that place these things are delicate and well understood; rewriting them
// to speak an instancing API would have been the risky half of this change.
//
// An invisible slot is scaled to zero rather than removed: instances are positional, so hiding
// one by shortening the count would renumber every joint after it.
const _mSlot = new THREE.Matrix4();
const _sZero = new THREE.Vector3(0, 0, 0);

function makeSlot() {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    // `opacity` is recorded and ignored: an instance cannot carry one (the batch material does),
    // but the placement code writes it and must not have to know that.
    material: { color: new THREE.Color(), opacity: 1 },
    visible: false,
    _hi: false,
    // The placement code calls these on a Mesh; here they are already-done and never-needed.
    updateMatrix() {},
    matrixWorldNeedsUpdate: false,
  };
}

// GATHERED FROM THE LIVE ENTRIES EVERY PASS, not held by the batch. Instances are positional,
// so a batch that kept its own slot list would renumber every joint after any joint that was
// deleted — and would keep the deleted one's slot alive forever. Walking `_skelVis` makes
// disposal automatic: an entry that is gone is simply not gathered.
// A shaft batch carries two extra per-instance attributes; everything else is a plain batch.
function isShaftKey(key) { return typeof key === 'string' && key.startsWith('capShaft'); }

// THE JOINT'S PIN, IF IT STILL EXISTS. `_isPinTarget` is a property of the mesh and a deleted
// pin still answers to it, so that test alone walked straight over a dangling reference: what
// deletion does is take the three mesh out of its parent and leave every other reference intact
// ON PURPOSE, so undo can put the same object back. Selecting several pins in the outliner and
// deleting them therefore crashed the next frame's visual pass. matt: "if i use the secondary
// trigger to shift select several pins in the outliner and then delete them, i get this error:
// Cannot read properties of null (reading 'updateWorldMatrix')". Read off the joint rather than
// through IKSolver for the same reason everything else here is: the visuals do not import the
// solver. An undo re-adds the mesh to the graph and the pin comes back on its own.
function livePin(joint) {
  const p = joint && joint._boneIKPinObj;
  if (!p || !p._isPinTarget) return null;
  const tm = p.getThreeMesh && p.getThreeMesh();
  return (tm && !tm.parent) ? null : p;
}

// InstancedMesh does not manage custom attributes, so they are attached to its geometry and
// resized alongside the matrix buffer whenever the batch grows.
// THE NODE PATH NEEDS THE INSTANCE TRANSFORM AS DATA.
//
// The GLSL these batches used to carry read `instanceMatrix` directly -- it is a built-in
// attribute in a WebGL program. TSL has no equivalent that a material can reach without binding
// to one particular InstancedMesh, and these batches are REPLACED on every capacity doubling, so
// a bound reference would go stale. The orientation, scale and colour are all sitting in the slot
// at flush time, so they ride along as ordinary instanced attributes instead.
//
// Added for both renderers rather than behind a flag: three floats a slot is nothing next to a
// second code path, and the legacy shaders simply ignore attributes they do not declare.
function ensureRigInstanceAttrs(mesh, cap) {
  const g = mesh.geometry;
  const q = g.getAttribute('aQ');
  if (q && q.count === cap) return;
  const quats = new Float32Array(cap * 4);
  for (let i = 0; i < cap; i++) quats[i * 4 + 3] = 1;      // identity, not a zero quaternion
  g.setAttribute('aQ', new THREE.InstancedBufferAttribute(quats, 4));
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3));
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3));
}

function ensureTaperAttrs(mesh, cap) {
  ensureRigInstanceAttrs(mesh, cap);
  const g = mesh.geometry;
  const a = g.getAttribute('aHA');
  if (a && a.count === cap) return;
  g.setAttribute('aHA', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute('aHB', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  // The SHARPNESS at each end, alongside the extents it belongs to. Filled with 2 rather than 0:
  // a zero exponent is not a shape, and a slot that has never been written must draw as the
  // ellipsoid everything was before this existed.
  g.setAttribute('aPA', new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(2), 1));
  g.setAttribute('aPB', new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(2), 1));
}

// The end spheres carry ONE exponent — a cap belongs to a single joint.
function ensureSharpAttr(mesh, cap) {
  ensureRigInstanceAttrs(mesh, cap);
  const g = mesh.geometry;
  const a = g.getAttribute('aP');
  if (a && a.count === cap) return;
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(2), 1));
}

// EVERY XRAY PASS RUNS BEFORE EVERY SOLID ONE. A ghost is a GreaterDepth pass -- "paint me
// wherever something is nearer" -- so what is in the depth buffer when it runs is what it shows
// through. Run after the rig's own solid passes it shows the rig through the RIG, which is the
// "arm visible through the leg" matt kept reporting; run before them, the only depth it can test
// against is the opaque content (the sculpt, and the bone and joint bodies, which are opaque),
// which is the one thing an xray exists to see through. The solid passes then paint over it.
const GHOST_ORDER = 9995;

// NOTHING IN A CAPSULE SHARES A SURFACE WITH ANYTHING ELSE IN A CAPSULE.
//
// Every joint in a chain is drawn TWICE over: the bone above it ends there and the bone below it
// begins there, so two ellipsoids of near-identical size sit at the same point, and the shaft of
// each bone meets them tangentially at exactly their radius. Coincident surfaces at 14 segments
// do not merely z-fight -- their facets interleave, so the seam breaks into a stipple of two
// colours that follows the tessellation. matt: "their radii are so closely aligned, their
// tessellation is becoming apparent where they intersect... in vr it's just the misaligned
// triangles, on desktop it's actually chattering and z-fighting really badly."
//
// The fix is containment instead of coincidence, and it is measured in percent: the shaft sits
// just inside both of its end spheres, and the sphere at a bone's HEAD sits just inside the one
// the bone above it already drew at that joint. Strict nesting has an unambiguous depth order,
// so the answer stops depending on the depth buffer's precision -- which is the half of this
// that the near plane cannot fix. Small enough to be invisible: at a 2cm joint the shaft is
// 0.6mm thinner than the sphere it enters.
const SHAFT_INSET = 0.97;   // cylinder radius, as a fraction of the end spheres it meets
const HEAD_INSET = 0.98;    // the head-end sphere, against the one the parent bone drew there

function makeBatch(main, geo, ghost, key) {
  // INSTANCED ATTRIBUTES LIVE ON THE GEOMETRY, and capsuleShaftGeometry returns a shared
  // module-level singleton -- so the four shaft batches (solid, ghost, and the preselected
  // variant of each) would have written their taper data over one another, every batch reading
  // whichever wrote last. A clone per batch is one cylinder, made once.
  //
  // ...AND THE END SPHERES NOW NEED THE SAME, because sharpness gave them an instanced attribute
  // too. Sharing one sphere meant the four capEnd batches wrote `aP` over each other AND resized
  // it to whichever grew last — so a batch holding more instances than the shared buffer read
  // past its end and stopped drawing. Worst on rigs with many small joints, because those are the
  // ones that push the counts up. matt: "the capsules often stop drawing... it seems to be finger
  // joints and the wrist that are worst affected, the major arm joints appear fine."
  const needsOwnGeo = isShaftKey(key)
    || (typeof key === 'string' && key.startsWith('capEnd'));
  if (needsOwnGeo) geo = geo.clone();
  const mat = ghost
    ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true,
        opacity: GHOST_OPACITY, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false })
    : new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const isEnd = (typeof key === 'string' && key.startsWith('capEnd'));
  // THE CAPSULES CARRY THEIR SHAPE AND SHADING IN A SHADER, and on the node renderer that cannot
  // be an onBeforeCompile -- WebGPURenderer ignores those, which is why the shafts drew as raw
  // untapered white cylinders there. NodeMaterials.rigCapsule is the same three effects (taper,
  // sharpness, shading) written as a node graph; the legacy path keeps the injections.
  let capMat = null;
  if (NodeMaterials.isActive && NodeMaterials.isActive()) {
    capMat = (isShaftKey(key) || isEnd)
      ? NodeMaterials.rigCapsule({ shaft: isShaftKey(key), ghost, key })
      // The plain batches take a PRE-BUILT node material too, rather than being converted from
      // the stock one above on the frame the rig appears -- see NodeMaterials.rigBatch for the
      // 117ms-per-material measurement that makes that distinction worth having.
      : NodeMaterials.rigBatch({ ghost, key });
  }
  if (!capMat) {
    if (isShaftKey(key)) taperMaterialInstanced(mat);
    else if (isEnd) sharpMaterialInstanced(mat);
    if (isShaftKey(key) || isEnd) shadeMaterial(mat, isShaftKey(key));
  }
  const m = new THREE.InstancedMesh(geo, capMat || mat, BATCH_CAP0);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (isShaftKey(key)) ensureTaperAttrs(m, BATCH_CAP0);
  else if (isEnd) ensureSharpAttr(m, BATCH_CAP0);
  ensureInstanceColor(m, BATCH_CAP0);
  m.count = 0;
  m.renderOrder = ghost ? GHOST_ORDER : 0;
  m.isPickable = false;
  m.frustumCulled = false;
  Skeleton.overlayGroup(main).add(m);
  return { mesh: m, cap: BATCH_CAP0, ghost: !!ghost };
}

// THE PER-INSTANCE COLOUR BUFFER, ALLOCATED UP FRONT AND NOT ON FIRST USE.
//
// three's setColorAt creates `instanceColor` lazily, the first time a batch is flushed. That was
// fine while the batches started at capacity 1 and doubled, because the rebuild that followed
// replaced the mesh -- and a replacement mesh gets a new RenderObject, which picks the attribute
// up. Raising the starting capacity so a rig never rebuilds removed those rebuilds, and with
// them the thing that was quietly repairing this: the pipeline compiled on the first frame, when
// instanceColor was still null, is now the pipeline that draws forever, and every bone comes out
// the material's flat base colour. matt: "random bone colours have dropped."
//
// The same shape as the gizmo pick overlay: a fix that was only ever working as a side effect of
// something else, and that disappeared the moment that something else was optimised away.
function ensureInstanceColor(m, cap) {
  const c = m.instanceColor;
  if (c && c.count === cap) return;
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  a.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = a;
}

// HOW BIG A BATCH STARTS, AND HOW FAST IT GROWS. InstancedMesh cannot be resized, so growing
// one means building a replacement -- and on the node renderer a replacement mesh is a new
// RenderObject, which is a new node graph AND a new compiled pipeline. Measured with
// boneTrace(): a capacity doubling rebuilds all fourteen batches at once, costing 14 pipelines
// and 14 node graphs in a single frame, and the frame it lands in ran 50-95ms on a desktop.
//
// Starting at 1 and doubling put that frame at joint 1, 2, 4, 8, 16, 32 -- which is exactly the
// shape matt reported: "still stutters when drawing out bone chains", never gone, just rarer as
// the chain grows. On the old WebGL renderer it was free, because that renderer keys its program
// cache on shader STRUCTURE and simply reallocated the buffers.
//
// So: start at a capacity a whole rig fits inside, and grow in big steps when it does not. The
// memory is nothing -- about 116 bytes an instance across the matrix, colour, quaternion and
// scale attributes, so 32 instances in fourteen batches is roughly 50KB -- and it buys silence.
const BATCH_CAP0 = 32;
const BATCH_GROW = 4;
function batchFor(main, key, geoFn, ghost) {
  const all = main._skelBatch || (main._skelBatch = new Map());
  let b = all.get(key);
  if (!b) {
    b = makeBatch(main, geoFn(), ghost, key);
    // NAMED, so a scene scan can say WHICH batch it is looking at. An instanced batch stays in
    // the scene with `visible` true whether or not any of its instances are drawn (a hidden slot
    // is scaled to zero, not removed), so anything walking the graph sees a live object with no
    // way to tell what it is. See misc/PhantomScan.js.
    b.mesh.name = 'rigbatch:' + key;
    all.set(key, b);
  }
  return b;
}

// LINES CANNOT BE INSTANCED the way meshes can — there is no InstancedLineSegments — so the
// wireframes are MERGED instead: one LineSegments whose buffer holds every joint's edges,
// transformed on the CPU each pass. That sounds expensive and is not: the edge geometry is a
// single cached EdgesGeometry of the bone, so this is a few thousand floats a frame, against
// the fifty draw calls it removes.
//
// Per-vertex colour, because the joints tint differently and a merged buffer has one material.
function makeLineBatch(main, geo, ghost) {  // named by its caller — see batchFor
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    opacity: ghost ? 0.35 : 0.9,
    ...(ghost ? { depthTest: true, depthFunc: THREE.GreaterDepth } : {}),
  });
  // SEEDED WITH ONE DEGENERATE SEGMENT rather than an empty geometry. An empty buffer draws
  // nothing, and a batch that never draws never compiles its pipeline -- which put that compile
  // inside the session, on the first bone. flushLineBatch replaces both attributes on its first
  // pass, so this costs two zeroed vertices and nothing else. See Skeleton.prewarmBatches.
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
  const m = new THREE.LineSegments(lg, mat);
  // The wireframe stays on top -- it is a line overlay and being drawn over is the whole point --
  // but its GHOST is an xray like any other and goes with them. See GHOST_ORDER.
  m.renderOrder = ghost ? GHOST_ORDER : 9999;
  m.isPickable = false;
  m.frustumCulled = false;
  Skeleton.overlayGroup(main).add(m);
  return { mesh: m, cap: 0, line: true, src: geo, ghost: !!ghost };
}

function lineBatchSlot(main, key, geoFn, ghost) {
  const all = main._skelBatch || (main._skelBatch = new Map());
  if (!all.has(key)) {
    const b = makeLineBatch(main, geoFn(), ghost);
    b.mesh.name = 'rigbatch:' + key;   // see batchFor
    all.set(key, b);
  }
  const slot = makeSlot();
  slot._key = key;
  return slot;
}

// `keyHi` gives a slot a SECOND batch to live in, chosen per frame by `slot._hi`. Instancing
// shares one material, so anything that varies per joint has to be either per-instance data or a
// separate batch -- and a capsule's preselection is a difference in OPACITY, which an instance
// cannot carry. Two batches and a flag keeps the highlight exactly as it was; the alternative,
// brightening the colour instead, would have changed how it looks to save a draw call that this
// does not cost.
function batchSlot(main, key, geoFn, ghost, keyHi) {
  batchFor(main, key, geoFn, ghost);
  if (keyHi) batchFor(main, keyHi, geoFn, ghost);
  const slot = makeSlot();
  slot._key = key;
  if (keyHi) slot._keyHi = keyHi;
  return slot;
}

// A SECOND SHAPE FOR THE SAME SLOT, chosen per frame by `slot._phys`.
//
// The same trick as `keyHi` one function up, for a different reason: keyHi exists because
// opacity cannot ride on an instance, this exists because GEOMETRY cannot. A joint is drawn from
// one batch or the other and never both, so this costs one more draw call per pass and nothing
// per joint. Independent of `_hi`, which the joint and bone slots do not use -- they say
// preselection in colour.
function physVariant(main, slot, key, geoFn, ghost) {
  batchFor(main, key, geoFn, ghost);
  slot._keyPhys = key;
  return slot;
}

function physLineVariant(main, slot, key, geoFn, ghost) {
  const all = main._skelBatch || (main._skelBatch = new Map());
  if (!all.has(key)) lineBatchSlot(main, key, geoFn, ghost);   // makes the batch; slot discarded
  slot._keyPhys = key;
  return slot;
}

// One pass over every slot, at the end of the frame's visual update.
// THE CAPSULE BATCHES CARRY WHAT AN INSTANCE CANNOT: opacity, depth-write and render order are
// material state, so they are set on the batch once a pass rather than per joint. Everything else
// about a capsule -- where it is, how big, what colour -- is still per instance.
const CAP_HI_MUL = 2.125;   // the ratio preselection has always brightened by (0.16 -> 0.34)
function tuneCapsuleBatches(main) {
  const all = main._skelBatch;
  if (!all) return;
  const base = Skeleton.capsuleOpacity();
  const shaded = Skeleton.displayFlag('capsuleShaded');
  for (const [key, b] of all) {
    if (!key.startsWith('capEnd') && !key.startsWith('capShaft')) continue;
    const m = b.mesh.material;
    const hi = key.endsWith('Hi');
    // capEndG / capEndGHi / capShaftG / capShaftGHi -- the ghost pass ends in G before any Hi
    const ghost = /G(Hi)?$/.test(key);
    m.opacity = Math.min(1, base * (hi ? CAP_HI_MUL : 1)) * (ghost ? 0.5625 : 1);
    // FULLY SOLID SKIPS THE BLEND, BUT NOT THE PASS. matt asked for the skin's rule -- "when the
    // solidity is at 100%, all the xray/transparency code paths in the material should be
    // skipped" -- and taking that literally, by clearing `transparent`, moved the solid capsules
    // into the OPAQUE pass, which three always renders BEFORE any transparent object. The ghost
    // is transparent by definition, so it went back to running after the capsules had written
    // their depth and revealed the rig through itself again: measured off-screen at full
    // solidity, capsules only, sculpt hidden, the ghost painted 57,248 pixels of see-through rig
    // over a 63,550 pixel silhouette. Pass placement is what the ordering rests on, so it stays;
    // what a fully solid capsule can skip is the blend itself, which is what actually costs.
    m.transparent = true;
    m.blending = (!ghost && m.opacity >= 0.999) ? THREE.NoBlending : THREE.NormalBlending;
    // THE GHOST IS SHADED TOO. It was left flat on the reasoning that the occluded half should
    // not compete with the half you can see -- but the ghost is the pass drawn THROUGH the mesh,
    // so with a sculpt visible it is most of the capsule surface anyone actually looks at, and
    // leaving it flat is most of why the toggle looked like it did nothing. matt: "the shaded
    // button for capsules has no effect, the capsules still appear unlit."
    if (m.userData.shadeMix) m.userData.shadeMix.value = shaded ? 1 : 0;
    // EVERY SOLID-PASS CAPSULE WRITES DEPTH, translucent or not. Instances inside one
    // InstancedMesh are drawn in buffer order and are never sorted -- three sorts objects, not
    // instances -- so with depth writes off a forearm painted after an upper arm shows through
    // it whichever is nearer, and no ordering exists that could fix it. matt: capsules "don't
    // seem to depth sort properly against each other". Writing depth resolves it per pixel: the
    // nearest capsule wins. The cost is that you no longer see one capsule THROUGH another --
    // only the nearest is blended against what was already in the buffer (the sculpt, the
    // grid), which still shows through it -- and that is the trade the rig wants.
    m.depthWrite = !ghost;
    m.depthTest = ghost ? true : m.depthTest;
    // THE GHOST DRAWS FIRST, so it can only reveal through the SCULPT. It is a GreaterDepth
    // pass -- "paint me wherever something is nearer" -- so what is already in the depth buffer
    // when it runs decides what it shows through. Sharing 9996 with the solid pass, the solid
    // capsules had already written their depth, so the ghost of an arm behind a leg was painted
    // over the leg and the rig read as having no depth culling at all. matt: "when an arm goes
    // behind a leg, i can still see the arm fully through the leg." One order earlier, the only
    // depth it can test against is the sculpt's, which is the one thing it exists to show
    // through -- and the solid pass then paints over it.
    b.mesh.renderOrder = ghost ? GHOST_ORDER : 9996;
  }
}

function flushBatches(main) {
  const all = main._skelBatch;
  if (!all || !main._skelVis) return;

  const bySlot = new Map();
  for (const e of main._skelVis.values()) {
    for (const slot of e._slots || []) {
      const key = (slot._phys && slot._keyPhys) ? slot._keyPhys
        : ((slot._hi && slot._keyHi) ? slot._keyHi : slot._key);
      let list = bySlot.get(key);
      if (!list) bySlot.set(key, (list = []));
      list.push(slot);
    }
  }

  // `?rigghosts=0` dropped the xray half of every batch, to test whether that blended overlay
  // was what made a rig cost 60ms a frame on a GalaxyXR. It was not -- the bill was a per-frame
  // console.error and a material rebuilt every frame (see the colorWrite note in NodeMaterials).
  // The switch is gone with the theory.
  for (const [key, b] of all) {
    const slots = bySlot.get(key) || [];
    const n = slots.length;

    if (b.line) { flushLineBatch(b, slots, n); continue; }
    if (n > b.cap) {
      // Rebuild at the next power of two, carrying the material and geometry across.
      let cap = b.cap || BATCH_CAP0;
      while (cap < n) cap *= BATCH_GROW;
      const old = b.mesh;
      const m = new THREE.InstancedMesh(old.geometry, old.material, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (isShaftKey(key)) ensureTaperAttrs(m, cap);
      else if (typeof key === 'string' && key.startsWith('capEnd')) ensureSharpAttr(m, cap);
      ensureInstanceColor(m, cap);
      m.renderOrder = old.renderOrder;
      m.isPickable = false;
      m.frustumCulled = false;
      if (old.parent) { old.parent.add(m); old.parent.remove(old); }
      old.dispose();
      b.mesh = m;
      b.cap = cap;
    }
    const m = b.mesh;
    const ha = isShaftKey(key) ? m.geometry.getAttribute('aHA') : null;
    const hb = ha ? m.geometry.getAttribute('aHB') : null;
    const pa = ha ? m.geometry.getAttribute('aPA') : null;
    const pb = ha ? m.geometry.getAttribute('aPB') : null;
    const pe = (typeof key === 'string' && key.startsWith('capEnd'))
      ? m.geometry.getAttribute('aP') : null;
    // The instance transform as data, for the node path -- see ensureRigInstanceAttrs.
    const isCap = ha || pe;
    const aq = isCap ? m.geometry.getAttribute('aQ') : null;
    const as = aq ? m.geometry.getAttribute('aS') : null;
    const ac = aq ? m.geometry.getAttribute('aC') : null;
    // A HIDDEN SLOT IS SKIPPED, NOT SCALED TO ZERO.
    //
    // This used to write every slot and set `count = n`, hiding one by composing it at zero
    // scale. A zero-scale instance still goes through the vertex shader, and the capsule end is
    // a 4368-triangle sphere: with capsules turned OFF, a 40-joint rig was still submitting
    // 80 x 4368 x 2 = 700k degenerate triangles every frame, which was 76% of everything the
    // rig drew. It is why the display flags made no difference to the frame time -- matt, on a
    // GalaxyXR, "tried the various draw modes, so only solid, only wire, only joints, its slow
    // for all", and measured on the desktop: all flags off changed neither the triangle count
    // nor the milliseconds.
    //
    // Compacting is safe because nothing indexes back into a batch by instance: `bySlot` is
    // rebuilt from scratch each flush, the batches are unpickable, and a highlight moves a slot
    // to a different batch key rather than addressing its slot in this one.
    let i = 0;
    for (let k = 0; k < n; k++) {
      const s = slots[k];
      if (!s.visible) continue;
      _mSlot.compose(s.position, s.quaternion, s.scale);
      m.setMatrixAt(i, _mSlot);
      if (m.setColorAt) m.setColorAt(i, s.material.color);
      if (ha && s._ha) {
        ha.setXYZ(i, s._ha[0], s._ha[1], s._ha[2]);
        hb.setXYZ(i, s._hb[0], s._hb[1], s._hb[2]);
        // 2 when the slot has not said otherwise, so an unwritten instance is the ellipsoid.
        if (pa) { pa.setX(i, s._pa || 2); pb.setX(i, s._pb || 2); }
      }
      if (pe) pe.setX(i, s._p || 2);
      if (aq) {
        aq.setXYZW(i, s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
        as.setXYZ(i, s.scale.x, s.scale.y, s.scale.z);
        const c = s.material.color;
        ac.setXYZ(i, c.r, c.g, c.b);
      }
      i++;
    }
    if (ha) { ha.needsUpdate = true; hb.needsUpdate = true; }
    if (pa) { pa.needsUpdate = true; pb.needsUpdate = true; }
    if (pe) pe.needsUpdate = true;
    if (aq) { aq.needsUpdate = true; as.needsUpdate = true; ac.needsUpdate = true; }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

// Dropped wholesale when the rig is rebuilt: the slots are indexed by creation order, so a
// partially-cleared batch would put one joint's transform on another.
const _vLine = new THREE.Vector3();

function flushLineBatch(b, slots, n) {
  const srcPos = b.src.getAttribute('position');
  const verts = srcPos.count;
  const need = n * verts * 3;
  const g = b.mesh.geometry;
  let pa = g.getAttribute('position');
  // GROWN LIKE THE INSTANCED BATCHES, AND FOR THE SAME REASON.
  //
  // This used to reallocate on every change in joint count -- `array.length !== need`, exact fit
  // -- and on the node renderer a replacement buffer is a new render object, so every size gave
  // the wire batch a fresh pipeline. matt's compile report caught it four times over in one
  // session: rigbatch:wire-ghost at BufferGeometry(0v), (2v), (24v) and (480v).
  //
  // So it only grows, in the same multiples the instanced batches use, and the draw range below
  // already decides what is actually drawn. A capacity buffer costs a few kilobytes; a pipeline
  // costs 30-40ms on a headset.
  if (!pa || pa.array.length < need) {
    let cap = Math.max(pa ? pa.array.length : 0, verts * 3 * BATCH_CAP0);
    while (cap < need) cap *= BATCH_GROW;
    pa = new THREE.BufferAttribute(new Float32Array(cap), 3);
    g.setAttribute('position', pa);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap), 3));
  }
  const P = pa.array;
  const C = g.getAttribute('color').array;
  let o = 0;
  for (let i = 0; i < n; i++) {
    const s = slots[i];
    _mSlot.compose(s.position, s.quaternion, s.visible ? s.scale : _sZero);
    const c = s.material.color;
    for (let v = 0; v < verts; v++) {
      _vLine.fromBufferAttribute(srcPos, v).applyMatrix4(_mSlot);
      P[o] = _vLine.x; P[o + 1] = _vLine.y; P[o + 2] = _vLine.z;
      C[o] = c.r; C[o + 1] = c.g; C[o + 2] = c.b;
      o += 3;
    }
  }
  pa.needsUpdate = true;
  g.getAttribute('color').needsUpdate = true;
  // A hidden joint collapses to a point rather than being removed, for the same reason an
  // instanced one is scaled to zero: the buffer is positional.
  g.setDrawRange(0, n * verts);
  b.mesh.visible = n > 0;
}

function clearBatches(main) {
  const all = main._skelBatch;
  if (!all) return;
  for (const b of all.values()) {
    if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
    b.mesh.dispose();
    // NOT the pre-built node materials: those are CACHED and shared, so disposing one here would
    // take it away from every future rig as well as this one. They belong to NodeMaterials and
    // live as long as the renderer does.
    if (!b.mesh.material.userData.nodeShared) b.mesh.material.dispose();
  }
  main._skelBatch = null;
}

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
// A TAPERED SHAFT, WITHOUT A GEOMETRY PER BONE. A truncated cone is not a scaled cylinder — no
// linear transform turns one radius into two — and rebuilding a CylinderGeometry per bone per
// frame is not an option. So the unit cylinder stays, and the two radii ride in as uniforms: the
// vertex shader widens each ring by where it sits along the shaft.
//
// The shaft's x/z scale is then left at 1 and the radius is applied here in LOCAL space, so the
// model matrix only ever rotates, translates and stretches along the bone. matt: "i should be
// able to have a large joint, and a small child joint, and see the capsule preview have a
// tapered cylinder."
// ...and THREE radii at each end, since a joint can be wide and shallow. The extents are
// world-axis aligned while the shaft's own frame runs along the bone, so the shader takes the
// bone's rotation and its inverse: the unit cross-section goes out to world, is scaled there,
// and comes back. The component along the bone is dropped, which makes this the ellipse where
// the world-scaled shape meets the plane square to the bone — exact whenever the bone runs
// along an axis, which is the spine and the arms of any rig authored in a T-pose.
//
// The inverse is passed rather than computed: transpose() is GLSL ES 3.0 and this has to
// compile on a WebGL1 context too.
function taperMaterial(mat) {
  mat.userData.taper = {
    uHA: { value: new THREE.Vector3(1, 1, 1) },
    uHB: { value: new THREE.Vector3(1, 1, 1) },
    uRot: { value: new THREE.Matrix3() },
    uRotInv: { value: new THREE.Matrix3() },
  };
  mat.onBeforeCompile = (shader) => {
    const t = mat.userData.taper;
    shader.uniforms.uHA = t.uHA;
    shader.uniforms.uHB = t.uHB;
    shader.uniforms.uRot = t.uRot;
    shader.uniforms.uRotInv = t.uRotInv;
    shader.vertexShader = 'uniform vec3 uHA;\nuniform vec3 uHB;\n'
      + 'uniform mat3 uRot;\nuniform mat3 uRotInv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n'
      // The cylinder spans y = -0.5 .. 0.5, and -0.5 is the end the bone STARTS at.
      + 'float _t = transformed.y + 0.5;\n'
      + 'vec3 _h = mix(uHA, uHB, _t);\n'
      + 'vec3 _w = uRot * vec3(transformed.x, 0.0, transformed.z);\n'
      + 'vec3 _b = uRotInv * (_w * _h);\n'
      + 'transformed.x = _b.x;\n'
      + 'transformed.z = _b.z;');
  };
  // Two materials that differ only by their uniforms must not share a compiled program.
  mat.customProgramCacheKey = () => 'skelTaper';
  return mat;
}

// HOW SOLID THE CAPSULES DRAW, 0.05..1. At the default 0.16 they are a diagnostic laid over the
// sculpt; turned up they are a cheap stand-in for the skin, which is the point -- a rig you can
// pose and play back with the mesh hidden entirely. matt: "capsule mode, would be good to have a
// toggle or a slider to control opacity... it would be great to have it be fully opaque and
// animate with the skin turned off."
// One END of a bind capsule, as batched slots rather than meshes. Four keys: solid and ghost,
// each with a preselected variant -- see batchSlot on why the highlight needs its own batch.
function makeCapsuleEndSlots(main) {
  return {
    solid: batchSlot(main, 'capEnd', capsuleEndGeometry, false, 'capEndHi'),
    ghost: batchSlot(main, 'capEndG', capsuleEndGeometry, true, 'capEndGHi'),
  };
}

// SHADING, WITHOUT LIGHTS. Unlit capsules read as flat silhouettes -- a leg and the arm crossing
// it are one shape in one colour, and you cannot see which is nearer. matt: "they should have an
// option to be shaded, viewing them unlit is very hard to read."
//
// Adding a light to this pass would mean a lit material, which these are not: they are overlays
// drawn out of order with their own depth rules. But a capsule does not need one -- its
// object-space position IS its normal (a unit sphere's exactly, a cylinder's in xz), so the
// shading term can be computed from the vertex alone and no normal attribute is needed.
//
// Blended by a uniform rather than compiled in or out: toggling a define means recompiling a
// program mid-session, and the flat look has to stay available anyway.
function shadeMaterial(mat, cylinder) {
  const u = { value: 1 };
  mat.userData.shadeMix = u;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uShadeMix = u;
    shader.vertexShader = 'varying float vShade;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      // The normal a capsule already implies: down the shaft for a cylinder, radial for a cap.
      'mat3 _sm = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz);\n'
      + 'vec3 _ssc = vec3(length(_sm[0]), length(_sm[1]), length(_sm[2]));\n'
      // AN ELLIPSOID'S NORMAL IS NOT ITS POSITION. A cap is a unit sphere scaled by the joint's
      // three half-extents, and a normal does not survive a non-uniform scale the way a point
      // does -- it transforms by the inverse, so the direction has to be divided by the scale
      // before being rotated. Skipping that lit a squashed joint as though it were round.
      + (cylinder
        ? 'vec3 _sn = normalize(vec3(transformed.x, 0.0, transformed.z));\n'
        : 'vec3 _sn = normalize(transformed / max(_ssc, vec3(1e-6)));\n')
      + 'float _sl = _ssc.x;\n'
      + 'if (_sl > 1e-8) _sn = normalize(mat3(normalize(_sm[0]), normalize(_sm[1]), normalize(_sm[2])) * _sn);\n'
      + 'vec3 _swn = normalize((modelMatrix * vec4(_sn, 0.0)).xyz);\n'
      // A single key from above and slightly front-left, and a floor rather than a black side:
      // this is here to say WHICH WAY A SURFACE FACES, not to light a scene.
      // CENTRED ON 1.0, so the lit side BRIGHTENS and the far side dims. A term that only ever
      // multiplies down darkens the whole rig and reads as "dimmer", not as "shaded" -- measured
      // at the default 16% opacity, a 0.30..1.15 range took the 10th-to-90th percentile
      // brightness from 73..194 down to 29..109: LESS contrast, which is the opposite of the
      // point. Straddling 1 keeps the weight of the colour and spends the range on the
      // difference between facing you and facing away. At 95% solidity this takes the spread
      // from 10 (flat, i.e. none) to 100.
      + 'vShade = 0.60 + 0.80 * clamp(dot(_swn, normalize(vec3(0.35, 1.0, 0.45))), 0.0, 1.0);\n'
      + '#include <project_vertex>');
    shader.fragmentShader = 'uniform float uShadeMix;\nvarying float vShade;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'
      // HUE-PRESERVING GAIN. The term straddles 1.0 so the lit side brightens, but a plain
      // multiply pushes channels past 1.0 one at a time -- an orange bone's red saturates first,
      // then its green catches up, and the colour walks toward white. That is exactly the
      // "very pastel" look matt reported. Capping the gain at the point the brightest channel
      // would clip keeps the hue exactly as authored: a mid-tone still gets most of the lift, a
      // fully saturated colour spends its range on the shadow side instead.
      + 'float _sg = mix(1.0, vShade, uShadeMix);\n'
      + 'float _smx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);\n'
      + 'if (_smx > 1e-4) _sg = min(_sg, 1.0 / _smx);\n'
      + 'diffuseColor.rgb *= _sg;');
  };
  // CALLED ON THE MATERIAL, not detached. three's own customProgramCacheKey is
  // `return this.onBeforeCompile.toString()`, so invoking the saved reference as a bare function
  // loses `this` and throws reading onBeforeCompile of undefined -- and it throws inside the
  // renderer, on the first frame that compiles a capsule program. A plain function rather than an
  // arrow for the same reason: the wrapper needs a `this` of its own to pass along.
  const prevKey = mat.customProgramCacheKey;
  const suffix = cylinder ? '|shadeCyl' : '|shadeSph';
  mat.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : '') + suffix;
  };
  return mat;
}

// THE TAPER, INSTANCED. Identical maths to taperMaterial, with the two differences that make it
// fit in an instance:
//
//   - the half-extents come from per-instance attributes instead of uniforms, because that is the
//     only thing about a capsule that genuinely varies per bone;
//   - the rotation is DERIVED from instanceMatrix rather than passed in. uRot was always just the
//     mesh's own rotation and uRotInv its transpose, so sending them would have meant eighteen
//     more floats per instance to say what the matrix already says. The scale baked into that
//     matrix is (1, length, 1), so normalising its columns leaves the rotation.
function taperMaterialInstanced(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec3 aHA;\nattribute vec3 aHB;\n'
      + 'attribute float aPA;\nattribute float aPB;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n'
      + 'mat3 _im = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz);\n'
      // A HIDDEN SLOT IS A ZERO MATRIX, by design -- instances are positional, so one is hidden
      // by collapsing it rather than by renumbering everything after it. normalize() of a zero
      // column is NaN, and a NaN vertex is undefined behaviour: it draws nothing on the GPU this
      // was written on and is not guaranteed to anywhere else. The instance is collapsed either
      // way, so the taper is simply skipped for it.
      + 'float _len0 = length(_im[0]);\n'
      + 'if (_len0 > 1e-8) {\n'
      + '  mat3 _rot = mat3(normalize(_im[0]), normalize(_im[1]), normalize(_im[2]));\n'
      + '  mat3 _rotInv = transpose(_rot);\n'
      // The cylinder spans y = -0.5 .. 0.5, and -0.5 is the end the bone STARTS at.
      + '  float _t = transformed.y + 0.5;\n'
      + '  vec3 _h = mix(aHA, aHB, _t);\n'
      + '  vec3 _w = _rot * vec3(transformed.x, 0.0, transformed.z);\n'
      // THE EXPONENT IS THE SHAPE. The surface along a direction is where the p-norm reaches 1,
      // so dividing by that norm lands on it: p = 2 leaves the ellipse exactly as it was (the
      // direction is already unit length), and higher p pushes the corners out towards a box.
      // Branched, because pow() three times is not free and almost every joint is round.
      + '  float _p = mix(aPA, aPB, _t);\n'
      + '  if (_p > 2.001) {\n'
      + '    float _n = pow(pow(abs(_w.x), _p) + pow(abs(_w.y), _p) + pow(abs(_w.z), _p), 1.0 / _p);\n'
      + '    if (_n > 1e-6) _w /= _n;\n'
      + '  }\n'
      + '  vec3 _b = _rotInv * (_w * _h);\n'
      + '  transformed.x = _b.x;\n'
      + '  transformed.z = _b.z;\n'
      + '}');
  };
  mat.customProgramCacheKey = () => 'skelTaperInstancedP';
  return mat;
}

// THE END SPHERES TAKE THE SAME EXPONENT, in object space, which is where it is simplest.
//
// A cap is a UNIT sphere scaled by the joint's half-extents through the instance matrix — so in
// object space every vertex is already the unit direction the p-norm wants, and the surface is
// that direction divided by its own norm. The instance's scale then maps it to the joint's
// extents, exactly as it did for the ellipsoid.
function sharpMaterialInstanced(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aP;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n'
      + 'if (aP > 2.001) {\n'
      + '  float _n = pow(pow(abs(transformed.x), aP) + pow(abs(transformed.y), aP)\n'
      + '                 + pow(abs(transformed.z), aP), 1.0 / aP);\n'
      + '  if (_n > 1e-6) transformed /= _n;\n'
      + '}');
  };
  mat.customProgramCacheKey = () => 'skelSharpInstanced';
  return mat;
}

// Both ends of a bind capsule's SHAFT, as batched slots. The half-extents ride along as `_ha`
// and `_hb` on the slot and are written into instanced attributes at flush time.
function makeCapsuleShaftSlots(main) {
  return {
    solid: batchSlot(main, 'capShaft', capsuleShaftGeometry, false, 'capShaftHi'),
    ghost: batchSlot(main, 'capShaftG', capsuleShaftGeometry, true, 'capShaftGHi'),
  };
}

function makeCapsulePart(geo, taper) {
  const p = makePair(geo, 0xffffff); // recoloured per frame from the bone's identity colour
  if (taper) { taperMaterial(p.solid.material); taperMaterial(p.ghost.material); }
  p.solid.material.transparent = true;
  p.solid.material.opacity = Skeleton.capsuleOpacity();
  // DEPTH-WRITE ONCE IT IS SOLID. A transparent capsule must not write depth or it punches
  // holes in what is behind it; an OPAQUE one must, or the rig sorts like glass and a near arm
  // draws behind a far one. The threshold is the point where it stops being an overlay.
  p.solid.material.depthWrite = Skeleton.capsuleOpacity() >= 0.99;
  p.ghost.material.opacity = Skeleton.capsuleOpacity() * 0.5625;
  p.solid.renderOrder = 9996;
  p.ghost.renderOrder = 9996;
  return p;
}

// Bone length readout. The point is proportion, not measurement: an upper and lower limb
// segment usually want to be about equal, and reading two numbers is far quicker than
// eyeballing two bones from a single viewpoint in a headset. Sprites, so they always face
// the viewer, and depthTest off so a label inside the mesh is still readable.
const LABEL_FONT = 'bold 34px sans-serif';
const LABEL_H = 64;      // canvas height; the width is sized to the text, see setLabelText
const LABEL_PAD = 18;    // room for the stroke outline at both ends

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = LABEL_H;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.renderOrder = 10001;
  sprite.isPickable = false;
  sprite.frustumCulled = false;
  // The sprite is scaled from THIS, so a long word is never squeezed into a short plate.
  return { sprite: sprite, canvas: canvas, tex: tex, text: '', aspect: canvas.width / LABEL_H };
}

// THE PLATE IS SIZED TO THE TEXT, not the other way round.
//
// The canvas was a fixed 128x64 and the text drawn centred, which is fine for "1.24" and
// clips a NAME at both ends — you see the middle of the word and nothing else. Stretching the
// sprite to compensate only stretches the same clipped pixels. matt: "the names are stretched
// horizontally, and are clipped to the center of their names."
//
// So: measure, widen the canvas to fit, and let the sprite take its aspect from the canvas.
// The text then has one size in pixels and one shape in the world, whatever it says.
function setLabelText(lab, text) {
  if (lab.text === text) return; // repainting a canvas + reuploading a texture is not free
  lab.text = text;
  const c = lab.canvas, ctx = c.getContext('2d');
  ctx.font = LABEL_FONT;
  const want = Math.max(64, Math.ceil(ctx.measureText(text).width) + LABEL_PAD * 2);
  if (c.width !== want) {
    c.width = want;          // resizing CLEARS the canvas and resets every ctx property
    // Three will not reallocate the GPU texture for a resized canvas without this — the same
    // gotcha the VR timeline hit when its canvas changed size.
    lab.tex.dispose();
    lab.aspect = c.width / LABEL_H;
  }
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = LABEL_FONT;
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

// ---- joint radius ------------------------------------------------------------
//
// A JOINT CAN BE SIZED, NOT JUST A BONE. `_boneRadius` has always lived on a joint, but it
// describes the BONE arriving there — a bone reads its child's — so every bone was a tube of one
// width and a head, a hand or a pelvis had no way to be wider than the limb leading into it.
// Joint volumes were the first attempt at that and were worse than the capsules they replaced;
// matt: "i need to be able to scale joints, not bones."
//
// So a joint carries its own radius, and a bone is the hull of the two spheres at its ends — a
// tapered capsule. Unset is the common case and means "whatever the bone says", which is the
// old behaviour exactly; that distinction is why this is a separate field rather than a copy of
// the bone's number, which would freeze the joint at whatever the bone happened to be.
Skeleton.jointRadius = function (j, fallback) {
  const r = j && j._jointRadius;
  return r > 0 ? r : (fallback || 0);
};

Skeleton.setJointRadius = function (j, r) {
  if (!j) return false;
  j._jointRadius = r > 0 ? r : 0;
  return true;
};

Skeleton.jointRadiusIsSet = function (j) { return !!(j && j._jointRadius > 0); };

// The radius a joint falls back to when it has none of its own: the widest bone touching it,
// which is the same rule the skin uses. Needed wherever a joint's SIZE has to be known before
// anyone has set one — the handles have to appear somewhere on an untouched joint.
Skeleton.boneRadiusOf = function (main, j) {
  let r = j._boneRadius || 0;
  for (const k of Skeleton.joints(main)) {
    if (k._parentMesh === j) r = Math.max(r, k._boneRadius || 0);
  }
  return r;
};

// ---- joint scale (width / height / depth) ------------------------------------
//
// The joint sphere becomes an ELLIPSOID: three multipliers on the radius, so a pelvis can be
// wide and shallow and a ribcage can be deep without either of them being round. matt: "lets
// enable the volume tools for these joint spheres now so i can do nonlinear setups... just keep
// the bbox controls for width, height, depth."
//
// WORLD-AXIS ALIGNED, and no rotation or offset — matt's scope, and for a rig authored in a
// T-pose the world axes ARE width, height and depth, which is why the box handles read the way
// you expect. It also sidesteps the trap the removed joint volumes fell into: a DRAWN joint
// carries only a translation, so "the joint's own frame" was world space anyway, and every
// volume came out world-aligned however its bone was pointing.
//
// Multipliers rather than three absolute half-extents, so the radius stays the one number that
// says how big a joint is: Radius mode still means something on a squashed joint, and a rig
// scaled up keeps its proportions.
const UNIT_SCALE = [1, 1, 1];
Skeleton.jointScale = function (j) {
  const s = j && j._jointScale;
  return (s && s.length === 3) ? s : UNIT_SCALE;
};

Skeleton.setJointScale = function (j, x, y, z) {
  if (!j) return false;
  const c = (v) => Math.max(0.05, Math.min(20, v || 1));   // never inside-out, never runaway
  j._jointScale = [c(x), c(y), c(z)];
  return true;
};

Skeleton.jointScaleIsSet = function (j) {
  const s = j && j._jointScale;
  return !!(s && (s[0] !== 1 || s[1] !== 1 || s[2] !== 1));
};

// ---- joint offset ------------------------------------------------------------
//
// WHERE THE JOINT'S SHAPE SITS, relative to the joint itself. There is no handle for it and
// there never will be — matt ruled that out with the rotation — but a face drag that moves ONE
// face has nowhere else to put the result: growing the top while the bottom stays means the
// centre moved by half of what the top did. matt: "i edit the top, the bottom moves."
//
// So the offset is a CONSEQUENCE of the box handles rather than a control of its own. Model
// space, world-axis aligned, same frame as the extents.
const ZERO_OFF = [0, 0, 0];
// HOW BOXY A JOINT IS — 2 is the ellipsoid everything has always been, higher is squarer.
//
// It is the EXPONENT of the norm the surface is measured with, not a second shape competing with
// the first: |x/hx|^p + |y/hy|^p + |z/hz|^p = 1 is an ellipsoid at p=2 and approaches a box as p
// grows, with every squircle in between. So it changes one line of capsuleTarget and adds nothing
// for anything else to re-derive — which is what makes it unlike the joint VOLUMES that were
// built and removed: those were a parallel primitive with four consumers drifting apart, this is
// one more number on the single SDF that both Make Skin and the bind already measure.
//
// matt: "the roundness of the capsules is fighting me for the hands, but if i could choose how
// much to blend it towards a cube shape, that would help the initial layout a lot."
const ROUND_MIN = 2, ROUND_MAX = 12;
Skeleton.jointRound = function (j) {
  const r = j && j._jointRound;
  return (typeof r === 'number' && r >= ROUND_MIN) ? Math.min(r, ROUND_MAX) : ROUND_MIN;
};

Skeleton.setJointRound = function (j, p) {
  if (!j) return;
  const v = Math.max(ROUND_MIN, Math.min(ROUND_MAX, p || ROUND_MIN));
  // Stored only when it differs from round, so a rig that never touched it serialises nothing and
  // reads identically on a build that has never heard of the field.
  if (v <= ROUND_MIN + 1e-6) delete j._jointRound; else j._jointRound = v;
};

Skeleton.jointRoundIsSet = function (j) {
  return !!(j && typeof j._jointRound === 'number' && j._jointRound > ROUND_MIN + 1e-6);
};

Skeleton.jointOffset = function (j) {
  const o = j && j._jointOffset;
  return (o && o.length === 3) ? o : ZERO_OFF;
};

Skeleton.setJointOffset = function (j, x, y, z) {
  if (!j) return false;
  j._jointOffset = [x || 0, y || 0, z || 0];
  return true;
};

Skeleton.jointOffsetIsSet = function (j) {
  const o = j && j._jointOffset;
  return !!(o && (o[0] || o[1] || o[2]));
};

// WHERE A JOINT'S SHAPE IS CENTRED, which is the joint plus its offset. One definition, used by
// the draw, the skin, the handles and the drag — the four places that have to agree, and the
// four that drifted apart when the removed joint volumes each worked it out for themselves.
const _pJC = new THREE.Vector3();
Skeleton.jointCentre = function (j, out) {
  out = out || new THREE.Vector3();
  Skeleton.jointPos(j, out);
  const o = Skeleton.jointOffset(j);
  return out.set(out.x + o[0], out.y + o[1], out.z + o[2]);
};

// IS THIS JOINT ON THE MIRROR PLANE? A centreline joint must stay symmetric left-to-right — it
// is its own twin, and an x offset would take it off the plane the rest of the rig is built
// around. matt: "only center line joints should have left-right symmetry."
Skeleton.jointIsCentreline = function (main, j) {
  if (!j || j._boneMirror) return false;
  const plane = Skeleton.rigMirrorPlane(main) || Skeleton.symmetryPlane(main);
  if (!plane) return false;
  return Math.abs(Skeleton.planeDistance(Skeleton.jointPos(j, _pJC), plane))
    <= Skeleton.sceneUnit(main) * 0.02;
};

// The three half-extents a joint actually occupies: its radius times its scale. One definition,
// used by the draw, the skin and the handles, so they cannot disagree about how big a joint is.
Skeleton.jointHalf = function (j, fallback, out) {
  out = out || [0, 0, 0];
  const r = Skeleton.jointRadius(j, fallback);
  const s = Skeleton.jointScale(j);
  out[0] = r * s[0]; out[1] = r * s[1]; out[2] = r * s[2];
  return out;
};

// ---- joint scale handles ------------------------------------------------------
//
// SIX DOTS, one on each face of the joint's bounding box. A face dot says which axis it changes
// just by where it sits, so there is nothing to read. matt asked for the box controls back for
// the joint spheres — "just keep the bbox controls for width, height, depth" — and that scope is
// why there is no centre dot and no corner dots here: no offset to slide and no rotation to
// turn, so the only thing a handle can mean is one of the three extents.
//
// A FACE DRAG SCALES THE JOINT ABOUT ITS CENTRE, so the opposite face moves out by the same
// amount. With an offset available that would be the wrong behaviour — matt objected to exactly
// it once — but without one it is the only behaviour: a joint IS centred on its joint, and a
// handle that grew one side only would have nowhere to record the shift.
//
// Drawn for the SELECTED joint only. Handles on every joint at once would be twenty times the
// clutter and would make the rig unpickable.
const HANDLE_AXES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];

function scaleHandleGroup(main) {
  if (main._jointHandles) return main._jointHandles;
  const g = new THREE.Group();
  g.frustumCulled = false;
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mk = (color) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    // Its axis colour, kept so the preselect tint can be taken off again. Read from here rather
    // than recomputed, so the handle goes back to exactly the colour it was drawn with.
    m.userData.baseColor = color;
    m.renderOrder = 10002;          // above the rig, like the labels: a handle you cannot see
    m.frustumCulled = false;        // is a handle you cannot grab
    m.isPickable = false;
    m.raycast = () => {};
    g.add(m);
    return m;
  };
  main._jointHandles = {
    group: g,
    faces: HANDLE_AXES.map(([ax]) => mk([0xff6b6b, 0x6bff8f, 0x6bb6ff][ax])),
    pos: HANDLE_AXES.map(() => new THREE.Vector3()),
    centrePos: new THREE.Vector3(),
    joint: null,
  };
  skelGroup(main).add(g);
  return main._jointHandles;
}

// Where the handles are, in model space, for the selected joint. Written every frame by the draw
// and read by the tool's pick — one source, so what you grab is what you see.
Skeleton.updateScaleHandles = function (main, j, fallbackR) {
  const h = scaleHandleGroup(main);
  h.joint = j || null;
  if (!j) { h.group.visible = false; return h; }
  h.group.visible = true;

  // World-axis aligned, so there is no frame to build: the extents ARE the offsets to the faces.
  const half = Skeleton.jointHalf(j, fallbackR || 0, _halfH);
  Skeleton.jointCentre(j, _pJH);   // the SHAPE's centre — a face drag moves it off the joint

  const r = Skeleton.sceneUnit(main) * 0.018;
  h.centrePos.copy(_pJH);
  for (let i = 0; i < HANDLE_AXES.length; i++) {
    const [ax, sign] = HANDLE_AXES[i];
    _vFace.set(0, 0, 0);
    _vFace.setComponent(ax, sign * half[ax]);
    h.pos[i].copy(h.centrePos).add(_vFace);
    h.faces[i].position.copy(h.pos[i]);
    h.faces[i].scale.setScalar(r);
    h.faces[i].updateMatrix(); h.faces[i].matrixWorldNeedsUpdate = true;
  }
  return h;
};

// Which handle is under a point, if any. Generous radius: a dot is small on purpose, and a grab
// that misses reads as the handles not working at all.
Skeleton.pickScaleHandle = function (main, p, radius) {
  const h = main._jointHandles;
  if (!h || !h.group.visible || !h.joint) return null;
  let best = null, bestD = radius * radius, bestI = -1;
  for (let i = 0; i < h.pos.length; i++) {
    const d = h.pos[i].distanceToSquared(p);
    if (d < bestD) { bestD = d; bestI = i; best = { kind: 'face', axis: HANDLE_AXES[i][0], sign: HANDLE_AXES[i][1] }; }
  }
  return best ? Object.assign(best, { index: bestI }) : null;
};

// WHICH HANDLE IS UNDER THE HAND, lit. A dot with no hover state gives you no way to know which
// one you are about to take until you have taken it — and they sit close together on a small
// joint. matt: "the bbox handles should preselect highlight."
Skeleton.highlightScaleHandle = function (main, grip) {
  const h = main._jointHandles;
  if (!h) return;
  const hot = grip ? grip.index : -99;
  const r = Skeleton.sceneUnit(main) * 0.018;
  for (let i = 0; i < h.faces.length; i++) {
    const on = hot === i;
    const f = h.faces[i];
    // THE SAME YELLOW A JOINT OR A BONE TAKES. matt: "i want them to have preselect hlighting
    // like joints/bones do." Preselection already means one thing everywhere in this rig --
    // HILITE_COLOR, "this is what the next press takes" -- and a handle that answered the same
    // question with a different signal would be a second visual language to learn. Growing it
    // was the first attempt and is not what the rest of the rig does.
    //
    // The size bump stays ON TOP of the colour: these are the smallest targets in the tool and
    // easily misclicked, so the hot one is both yellow AND bigger.
    f.material.color.setHex(on ? HILITE_COLOR : f.userData.baseColor);
    f.scale.setScalar(on ? r * 1.6 : r);
    f.material.opacity = on ? 1 : 0.9;
    f.updateMatrix(); f.matrixWorldNeedsUpdate = true;
  }
};

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
// EIGHT, not twelve: four went when the green and cyan ends of the range did, and the spacing
// between the survivors is held at the 0.053 it already had rather than repacking twelve into a
// smaller arc. A busy rig reuses a colour sooner; the parent/sibling avoidance below is what
// keeps the ones that TOUCH apart, and that is the case a reuse could actually confuse.
const BONE_PALETTE_SIZE = 8;
const _paletteColors = [];
function paletteColor(i) {
  let c = _paletteColors[i];
  if (!c) {
    // AUTHORED IN sRGB, EXPLICITLY. three's setHSL takes a colour space and defaults it to the
    // WORKING space, which is linear -- so these numbers went into the buffer unconverted while
    // every hex colour in this file (setStyle/setHex default to sRGB) was converted properly.
    // The renderer then output-converts them a second time, which lifts the DARK channel of
    // every palette colour about three-fold: HSL(0.95, 0.55) should reach the screen with a
    // 0.1225 floor and reached it with 0.384, cutting saturation from 0.875 to 0.61 before a
    // single pixel is blended. The same numbers drive the skin-weight vertex colours through
    // SculptGL's own unmanaged pipeline, where they are treated as sRGB and look right -- which
    // is exactly the comparison matt made: "if i turn on weights on the skin, they're fully
    // saturated... the capsules feel like they're at least half the saturation of the weight
    // and bones colours". Same palette, two pipelines, one of them converting twice.
    const h = chainHue(i, BONE_PALETTE_SIZE);
    // ...AND DIMMER THAN THE STATE COLOURS, which is the other half of making a selection read.
    //
    // Keeping the chains clear of yellow and green in HUE stopped them being mistaken for a
    // selection; it did not make the selection POP, because a full-value chain is exactly as
    // bright as the marker sitting on it. matt: "at a glance they still look like just regular
    // bones, not a selection." So the palette gives up 20% of its value and the two state colours
    // keep all of theirs -- 0.55 -> 0.44. Saturation is untouched: a washed-out rig would read as
    // disabled rather than as unselected.
    c = _paletteColors[i] = new THREE.Color().setHSL(h, 0.95, CHAIN_LIGHTNESS, THREE.SRGBColorSpace);
    c._hue = h;
  }
  return c;
}

// THE STATE COLOURS ARE NOT AVAILABLE TO THE CHAINS.
//
// Preselection is yellow and selection is Maya green, and a random chain landing on either hue
// means the rig is wearing the colour that is supposed to mean "this one". matt: "if we're going
// to use yellow and cyan for preselect highlight, can we keep those colours or nearby colours
// away from the random bone chains? it makes it hard to see what is selected."
//
// SKIPPING SLOTS WAS NOT ENOUGH, and the arithmetic says why. Twelve hues on an even grid sit
// 0.083 apart, so a band only ever catches the single NEAREST slot and its neighbours stay where
// they were -- 0x1ff9f9 sat 0.056 from the green and 0x1ff91f 0.111, and matt saw both: "i still
// see a cyan and a green that are too close to the maya highlight colour."
//
// So the palette is not a grid any more. Two arcs of hue are reserved outright, and the twelve
// colours are spread evenly through WHAT IS LEFT -- which keeps all twelve (skipping cost two)
// and puts the nearest one 0.093 away instead of 0.028. The cost is chain-to-chain spacing,
// 0.083 -> 0.053, and that is the right thing to spend: two chains a little closer in hue is a
// smaller problem than a chain wearing the selection colour, and the parent/sibling avoidance
// below already keeps the ones that TOUCH far apart.
const CHAIN_HUE_EXCLUDE = [0.134, 0.444];   // 0xffd733 preselect, 0x00ffaa select

// ONE ARC, AND IT STARTS PAST CYAN.
//
// A band either side of each state colour left two arcs and twelve colours, and matt cut the
// first four of them by eye: the two yellow-greens between preselect and select (0x8bf91f,
// 0x46f91f) and the two cyan-blues just past select (0x1fc8f9, 0x1f83f9). "remove the first 4
// colours from the usable palette for bones."
//
// Which collapses to something simpler than a band: the short arc BETWEEN the two state hues is
// gone entirely -- there is not enough room between yellow and green for a colour that reads as
// neither -- so what is left is one run from blue round through purple, magenta and red to
// orange. Nothing green, nothing cyan, nothing yellow.
//
// 0.620 is where the cut lands, not a band measured from 0.444: a hue has to be far enough from
// the green to read as blue, and that is further than it needs to be from the yellow.
const CHAIN_ARC = [0.620, CHAIN_HUE_EXCLUDE[0] + 1 - 0.09];   // 0.620 .. 1.044
// 20% below the 0.55 the palette was authored at -- see the note where it is used.
const CHAIN_LIGHTNESS = 0.44;
const CHAIN_ARC_TOTAL = CHAIN_ARC[1] - CHAIN_ARC[0];

// Slot index -> hue. The half-step keeps the first slot off the very edge of the arc, so the
// worst case is half a step inside it rather than exactly on the boundary.
function chainHue(i, n) {
  return (CHAIN_ARC[0] + ((i + 0.5) / n) * CHAIN_ARC_TOTAL) % 1;
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
      // REAL HUES, not slot fractions: the slots are no longer evenly spaced (see chainHue), so
      // comparing indices would measure a distance the colours do not have.
      for (const a of avoid) near = Math.min(near, hueGap(chainHue(i, BONE_PALETTE_SIZE), chainHue(a, BONE_PALETTE_SIZE)));
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

const _halfA = [0, 0, 0], _halfB = [0, 0, 0];
const _halfH = [0, 0, 0];
const _cA = new THREE.Vector3(), _cB = new THREE.Vector3(), _dirC = new THREE.Vector3();
const _qC = new THREE.Quaternion();
const _upY = new THREE.Vector3(0, 1, 0);
const _pJH = new THREE.Vector3();
const _vFace = new THREE.Vector3();
const _mRot = new THREE.Matrix4();
const _fallbackColor = new THREE.Color(0.6, 0.6, 0.6);
const _wireCol = new THREE.Color();
const _pCentre = new THREE.Vector3();
const _mFrame = new THREE.Matrix4(), _sFrame = new THREE.Vector3(), _vFrame = new THREE.Vector3();
const _mBasis = new THREE.Matrix4(), _vBasis = new THREE.Vector3(), _sBasis = new THREE.Vector3();
const _vAim = new THREE.Vector3(), _pAim = new THREE.Vector3(), _pAim2 = new THREE.Vector3();
const _yAxisV = new THREE.Vector3(0, 1, 0);
const _qBasisF = new THREE.Quaternion(), _qBasisFit = new THREE.Quaternion();
const _qFrame = new THREE.Quaternion();
const _dimsF = [0, 0, 0], _offF = [0, 0, 0];
const _frameH = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), half: [0, 0, 0] };
const _off = [0, 0, 0];
const _vOff = new THREE.Vector3();
Skeleton.boneColor = function (main, joint) {
  if (!joint || !joint.getID) return _fallbackColor;
  const slots = colorSlots(main);
  const s = slots.get(joint.getID());
  return s === undefined ? _fallbackColor : paletteColor(s);
};

// THE SAME COLOUR FOR THE UNMANAGED PIPELINE. SculptGL writes vertex colours straight to the
// framebuffer with no output conversion, so a mesh painted with a bone's identity colour needs
// the sRGB components, not the linear ones three wants. Two accessors rather than one shared
// convention because there are genuinely two pipelines; picking the wrong one is visible as a
// colour that is too light (linear numbers read as sRGB) or too dark (the reverse).
const _srgbOut = new THREE.Color();
Skeleton.boneColorSRGB = function (main, joint) {
  return _srgbOut.copy(Skeleton.boneColor(main, joint)).convertLinearToSRGB();
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
// Last measurement, kept out here so `window.rigUnit()` can report it without needing a handle
// on the scene.
let _lastUnit = 1, _lastUnitFrom = 'never', _lastUnitMeshes = 0, _unitRemeasures = 0;

Skeleton.sceneUnit = function (main) {
  // RE-MEASURED ONLY WHEN THE SCENE CHANGES STRUCTURALLY, never on a timer.
  //
  // Every marker in the rig is sized from this, so anything that moves it resizes the whole
  // skeleton at once. It used to be re-taken every 500ms from the largest mesh's BOUNDING
  // SPHERE — and a bounding sphere is not a fixed property of an object, it grows and shrinks
  // as the pose changes, because an arm going up genuinely makes the mesh bigger. On a timer
  // that arrived as a step rather than a drift: the rig jumping a size for half a second at a
  // time, with nothing the user did to explain it. Holding it during playback fixed the worst
  // of it and left the rest, since a pose can be changed by hand just as easily.
  //
  // A scene does not change SIZE because something in it moved. So the value is latched, and
  // the only thing that releases it is a change to WHAT is in the scene or how it is scaled:
  // the ids of the real meshes, their transform scales, and — when there is no sculpt to
  // measure at all — how many joints the fallback has to work with. A pose is none of those,
  // and neither is adding a pin: pins are nulls, and nulls are not the scene's size. That is
  // the whole of it. `window.rigUnit()` prints what it settled on and why.
  if (main._skelUnit && window._animPlaying) return main._skelUnit;

  let sig = 2166136261 | 0;
  let real = 0;
  for (const m of main.getMeshes() || []) {
    if (Skeleton.isJoint(m) || m._isNull) continue;
    real++;
    sig = (Math.imul(sig, 16777619) ^ m.getID()) | 0;
    // The TRANSFORM scale, not the bounding sphere: scaling an object is a deliberate act and
    // should carry the markers with it, while posing it is not and must not.
    const sm = m.getModelSpaceMatrix ? m.getModelSpaceMatrix() : null;
    const ss = sm ? Math.hypot(sm[0], sm[1], sm[2]) : 1;
    sig = (Math.imul(sig, 16777619) ^ (Math.round(ss * 4096) | 0)) | 0;
  }
  sig = (Math.imul(sig, 16777619) ^ real) | 0;
  // With no sculpt in the scene the unit comes from the rig's own extent, which legitimately
  // grows as a rig is drawn — so the joint COUNT is part of the signature. Their POSITIONS are
  // not, or posing a rig with no mesh bound to it would resize its own markers.
  if (!real) sig = (Math.imul(sig, 16777619) ^ Skeleton.joints(main).length) | 0;
  if (main._skelUnit && main._skelUnitSig === sig) return main._skelUnit;

  let best = 0;
  let from = 'mesh';
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
    from = 'rig';
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
    from = 'camera';
    const cam = main.getCamera && main.getCamera();
    const d = cam && cam._trans ? Math.abs(cam._trans[2]) : 0;
    if (d > 1e-6) best = d * 0.3;
  }
  if (best <= 1e-6) from = 'default';
  main._skelUnit = best > 1e-6 ? best : 1;
  main._skelUnitSig = sig;
  main._skelUnitFrom = from;
  main._skelUnitMeshes = real;
  _lastUnit = main._skelUnit; _lastUnitFrom = from; _lastUnitMeshes = real;
  _unitRemeasures++;
  if (window._rigUnitTrace) {
    console.log('[rigUnit] remeasured ' + main._skelUnit.toFixed(4) + ' from ' + from
      + ' (' + real + ' real meshes) — #' + _unitRemeasures);
  }
  return main._skelUnit;
};

// What the rig is sized by, and where that number came from.
//
// Read off a module-level copy rather than reaching for the scene: a diagnostic that needs a
// global nobody sets is a diagnostic that prints nothing, and this file has burnt that hour
// already. It answers immediately AND turns tracing on — and after that, SILENCE IS THE
// ANSWER. If the markers change size while nothing prints, the unit is not what moved and the
// cause is downstream of it.
window.rigUnit = function (main) {
  console.log('[rigUnit] ' + VERSION + ' — currently ' + _lastUnit.toFixed(4)
    + ', measured from ' + _lastUnitFrom + ' (' + _lastUnitMeshes + ' real meshes)'
    + ' | joint dot ' + (_lastUnit * JOINT_R_FRAC).toFixed(4)
    + ' | ' + _unitRemeasures + ' remeasures so far');
  // THE OTHER CANDIDATE. A joint marker's drawn size is `sceneUnit * JOINT_R_FRAC`, but each
  // joint ALSO carries a scale baked into its own matrix at creation — and a reparent rewrites
  // that matrix to preserve the world transform, which is exactly where a stale three-side
  // matrix bakes in a factor. So "the markers doubled" has two possible causes and this prints
  // both: if the unit is unchanged and the matrix scales have moved, it is not the unit.
  const app = main || window.app;
  const js = app ? Skeleton.joints(app) : [];
  if (js.length) {
    const scaleOf = (j) => {
      const m = j.getMatrix();
      return Math.hypot(m[0], m[1], m[2]);
    };
    const ss = js.map(scaleOf);
    const lo = Math.min(...ss), hi = Math.max(...ss);
    console.log('[rigUnit] joint matrix scale across ' + js.length + ' joints: '
      + lo.toFixed(4) + ' .. ' + hi.toFixed(4)
      + '  (variation across joints is NORMAL — each bakes the unit as it was when that joint'
      + ' was created. What matters is whether this RANGE moves across an operation.)');
    const world = js.map((j) => {
      const m = j.getModelSpaceMatrix ? j.getModelSpaceMatrix() : j.getMatrix();
      return Math.hypot(m[0], m[1], m[2]);
    });
    console.log('[rigUnit] joint WORLD scale: ' + Math.min(...world).toFixed(4) + ' .. '
      + Math.max(...world).toFixed(4)
      + '  (a parent carrying a scale shows here and not above)');
  }
  window._rigUnitTrace = true;
  console.log('[rigUnit] tracing ON. It only prints when the unit is RE-MEASURED, which is a '
    + 'structural change to the scene. Nothing printed while the rig resizes means the rig '
    + 'is not being resized by this.');
  return _lastUnit;
};

// Push a joint's engine matrix into its Three mesh and refresh its world matrix. Needed
// any time a joint moves outside the render loop's own sync, and needed BEFORE reparenting
// or before a child reads its parent's world matrix.
// A locator that occupies space and paints nothing. Kept as one function because it is applied
// in two places -- at creation and again every frame after anything that might have rebuilt the
// material -- and the two drifting apart is how a white pick sphere comes back.
//
// NOT `visible = false`: that skips the object's whole subtree in three, so anything parented to
// a joint would be invisible too.
// ONE SHARED MATERIAL, NOT ONE PER CALL. This runs from updateVisuals for every affected mesh
// every frame, and the recognise-my-own-work guard below is the only thing that stopped it
// allocating. A guard is a good idea and a poor guarantee: when it failed -- the node renderer's
// stand-in did not carry colorWrite, so the test never matched again -- this allocated a material
// per mesh per frame, and on that renderer a fresh material means a fresh render object and a
// fresh node graph. Sharing one instance makes the failure mode cheap instead of catastrophic.
let _noDrawMat = null;
function noDrawMaterial(tm) {
  if (!tm) return;
  tm.visible = true;
  const m = tm.material;
  if (m && m.colorWrite === false && m.depthWrite === false) return;   // already ours
  if (!_noDrawMat) {
    _noDrawMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  }
  tm.material = _noDrawMat;
}

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
// ── NAMING A CHAIN ────────────────────────────────────────────────────────────────────────
//
// Bone Draw already names as it goes — `${chainName}_${NN}${side}` — but `chainName` is always
// "bone", so a finished rig is `bone_01_L … bone_17`. matt: naming AFTER the fact is the useful
// half, because it keeps you in the flow while building and lets you tidy up at the end.
//
// WHAT A CHAIN IS HERE: from the joint you picked, walk DOWN through children for as long as
// there is exactly one, and stop at a fork or a leaf. Click the shoulder and you get the arm;
// a wrist that forks into fingers stops at the wrist and each finger is named separately.
// Deliberately not clever — no guessing that something "looks like a leg" from its geometry,
// because a guess that is wrong one time in five is worse than a rule you can predict.
Skeleton.chainFrom = function (main, joint) {
  const out = [];
  let j = joint;
  while (j && Skeleton.isJoint(j)) {
    out.push(j);
    const kids = Skeleton.childJoints(main, j).filter((k) => Skeleton.isJoint(k));
    if (kids.length !== 1) break;   // a fork ends the chain, and so does a leaf
    j = kids[0];
  }
  return out;
};

// The `_L` / `_R` a joint already carries. Preserved rather than re-derived: it was set at draw
// time from the mirror plane, and re-deriving it from position risks disagreeing with
// `_boneMirror`, which is the link that actually drives mirroring.
const SIDE_RE = /(_[LR])$/;
function sideOf(j) {
  const m = SIDE_RE.exec(j && j._permanentStaticLabel || '');
  return m ? m[1] : '';
}

// Rename a chain to `name`, renumbering from 01, in ONE undo step.
//
// Also renames, because leaving either behind is a name that lies:
//   - the MIRROR TWIN, with the opposite suffix. `_boneMirror` gives it for nothing, and doing
//     one side only means doing everything twice.
//   - each joint's PIN. makePin labels them `pin_<jointName>` at creation, so a renamed joint
//     otherwise leaves `pin_bone_03_L` in the outliner pointing at `arm_02_L`.
//
// No uniquing. Labels are not keys — ids are — so a duplicate is cosmetic rather than
// corrupting, and dedup logic here would buy little and surprise more.
// ── DUPLICATE A CHAIN (audit item A3) ─────────────────────────────────────────────────────
//
// The outliner's Duplicate button has always existed and has always been wrong on a joint: it
// runs main.duplicateSelection, which copies each SELECTED mesh and inherits its parent. On a
// joint that gives you one lone joint hanging off the same parent -- not a limb -- and it copies
// the joint's fields wholesale, including `_boneMirror`, so the copy claims the ORIGINAL's twin
// and every mirrored edit afterwards writes to the wrong side. matt: "do we not have a duplicate
// chain in the outliner? if not, we should."
//
// THE WHOLE SUBTREE, NOT chainFrom's SINGLE CHAIN. Those two questions have different right
// answers: naming stops at a fork because a hand and its fingers are five chains with five names,
// while duplicating an arm that stopped at the wrist would hand you an arm with no fingers, which
// is never what was meant. So this walks every descendant.
//
// WHAT IS DELIBERATELY NOT COPIED:
//   * `_boneMirror` -- the copy has no twin. Carrying the source's is the bug above.
//   * pins -- a pin is a statement about where THIS joint is held, and duplicating it would put
//     two pins on one anchor.
//   * `_physicsRoot` and its params -- a second simulated chain in the same place, both swinging,
//     is a surprise rather than a convenience. Flag the copy yourself if you want it.
// What IS copied is the shape: the local matrix, the capsule radius and the joint's own extents,
// because those ARE the limb you asked for a copy of.
Skeleton.duplicateChain = function (main, joint) {
  if (!main || !Skeleton.isJoint(joint)) return null;
  const all = [];
  (function walk(j) {
    all.push(j);
    for (const k of Skeleton.childJoints(main, j)) if (Skeleton.isJoint(k)) walk(k);
  })(joint);

  // Parents before children: createJoint parents as it goes, and a child created before its
  // parent exists has nothing to hang from. The walk above is already in that order.
  const copyOf = new Map();
  let rootCopy = null;
  for (const src of all) {
    const srcParent = src._parentMesh;
    const parent = copyOf.get(srcParent) || (src === joint ? srcParent : null);
    const name = (src._permanentStaticLabel || 'bone') + ' Copy';
    const made = Skeleton.createJoint(main, Skeleton.jointPos(src, new THREE.Vector3()), parent, name);
    if (!made) continue;
    // THE LOCAL MATRIX, not just the position. createJoint places by world position and then
    // setMeshParent's attach preserves that world transform -- which is right for where it sits
    // and says nothing about its ROTATION, and a joint's rotation is half of what a pose is.
    mat4.copy(made.getMatrix(), src.getMatrix());
    Skeleton.syncThree(made);
    if (src._boneRadius) made._boneRadius = src._boneRadius;
    if (src._jointRadius) made._jointRadius = src._jointRadius;
    if (src._jointShape) made._jointShape = Object.assign({}, src._jointShape);
    // The copy is born at rest, exactly as a drawn joint is: whatever pose the source was in is
    // its pose, and the rest it should return to is where the copy actually is.
    made._ikRest = mat4.clone(made.getMatrix());
    copyOf.set(src, made);
    if (!rootCopy) rootCopy = made;
  }
  if (rootCopy) {
    main.setMesh?.(rootCopy);
    Skeleton.refreshOutliner(main);
  }
  return rootCopy;
};

Skeleton.nameChain = function (main, joint, name) {
  const clean = String(name || '').trim().replace(/[^\w-]+/g, '_');
  if (!main || !joint || !clean) return false;
  const chain = Skeleton.chainFrom(main, joint);
  if (!chain.length) return false;

  const before = new Map();
  const after = new Map();
  const record = (m, label) => {
    if (!m) return;
    if (!before.has(m)) before.set(m, m._permanentStaticLabel);
    after.set(m, label);
  };

  chain.forEach((j, i) => {
    const idx = String(i + 1).padStart(2, '0');
    const side = sideOf(j);
    const label = clean + '_' + idx + side;
    record(j, label);
    const twin = j._boneMirror;
    if (twin && Skeleton.isJoint(twin)) {
      const flip = side === '_L' ? '_R' : (side === '_R' ? '_L' : '');
      record(twin, clean + '_' + idx + flip);
    }
    for (const m of [j, twin]) {
      const pin = m && m._boneIKPinObj;
      if (pin && pin._isPinTarget) record(pin, 'pin_' + after.get(m));
    }
  });

  const apply = (map) => {
    for (const [m, label] of map) {
      m._permanentStaticLabel = label;
      m.uiName = label;
    }
    main.render?.();
    Skeleton.refreshOutliner(main);
  };
  apply(after);
  main.getStateManager?.()?.pushStateCustom?.(
    () => apply(before), () => apply(after), false, 'Name chain');
  if (window.screenLog) {
    window.screenLog('Named ' + chain.length + ' joint' + (chain.length === 1 ? '' : 's')
      + ' -> ' + clean + '_01', 'cyan');
  }
  return true;
};

// THE PRESETS, chosen by where the chain SITS rather than shown as one long list.
//
// A radial stops being flick-able past about eight wedges — it becomes a menu you read, which
// is the thing this exists to avoid. The rig already knows which half applies: `_boneMirror` is
// set at draw time for anything off the mirror plane, so a limb and a centreline chain can be
// offered different lists and each stays short.
Skeleton.LIMB_NAMES = ['arm', 'forearm', 'hand', 'finger', 'thumb', 'leg', 'foot'];
Skeleton.AXIS_NAMES = ['spine', 'neck', 'head', 'hips', 'tail'];

Skeleton.nameSuggestions = function (joint) {
  return (joint && joint._boneMirror) ? Skeleton.LIMB_NAMES : Skeleton.AXIS_NAMES;
};

// PIN THE CHILDREN ACROSS A WHOLE EDIT, not just across one call.
//
// moveJoint compensates what IT does. That is not enough for a tweak drag, which ROTATES the
// joint first and then moves it: by the time moveJoint takes its snapshot the children have
// already swung with the rotation, so the swing is never undone — and every frame writes a
// little more of it permanently into the children's local matrices. That is the runaway matt
// spent an afternoon on, and it is why turning the twist off cured it while the compensation
// arithmetic tested clean in isolation.
//
// Bracket the whole edit instead: take the parent's model matrix before anything moves, do as
// many writes as you like, then put the children back with one correction.
Skeleton.beginCompensate = function (main, joint) {
  return {
    joint: joint,
    before: mat4.clone(joint.getModelSpaceMatrix()),
    kids: Skeleton.childJoints(main, joint),
  };
};

Skeleton.endCompensate = function (token) {
  if (!token || !token.kids.length) return;
  const after = token.joint.getModelSpaceMatrix();
  const fix = mat4.create();
  if (!mat4.invert(fix, after)) return;
  mat4.multiply(fix, fix, token.before);
  for (const k of token.kids) {
    const local = k.getMatrix();
    mat4.multiply(local, fix, local);
    Skeleton.syncThree(k);
  }
};

Skeleton.moveJoint = function (main, joint, pos, compensate) {
  const kids = compensate ? Skeleton.childJoints(main, joint) : [];

  // THE COMPENSATION IS DONE IN THE PARENT'S OWN FRAME, not through world space.
  //
  // It used to read each child's MODEL matrix, move the joint, and write that model matrix back
  // — three conversions through three.js world matrices, each depending on those matrices being
  // refreshed at exactly the right moment. When they were not, the residual was a small scale
  // error, and a small scale error applied to the child's offset EVERY FRAME is exponential:
  // matt's trace showed a child 1.9 units from its joint reaching 56 in about thirty frames,
  // roughly 1.1x per frame, while the compensation reported err=0.0000 throughout. Of course it
  // did — it re-measured with the same conversion that had just lied to it.
  //
  // The relationship is exact and needs no world matrices at all. A child's model transform is
  // `parentModel * childLocal`, so holding it still across a parent move means
  //     childLocal' = inverse(parentModel') * parentModel * childLocal
  // and the only thing that varies is one matrix, taken before and after, in the same frame.
  const before = mat4.clone(joint.getModelSpaceMatrix());

  const ms = joint.getModelSpaceMatrix();
  ms[12] = pos.x; ms[13] = pos.y; ms[14] = pos.z;
  joint.setModelSpaceMatrix(ms);
  Skeleton.syncThree(joint);

  if (kids.length) {
    const after = joint.getModelSpaceMatrix();
    const fix = mat4.create();
    if (mat4.invert(fix, after)) {
      mat4.multiply(fix, fix, before);      // parent-after^-1 * parent-before
      for (let i = 0; i < kids.length; i++) {
        const local = kids[i].getMatrix();
        mat4.multiply(local, fix, local);
        Skeleton.syncThree(kids[i]);
      }
    }
  }

  // DID THE COMPENSATION ACTUALLY HOLD. The whole promise of `compensate` is that a child comes
  // out of this function exactly where it went in — so the only measurement that matters is the
  // child's model position before against after, and it is one line to take.
  //
  // `parentOK` is there because the likeliest way for this to fail is not the arithmetic: it is
  // a child whose THREE parent is not the joint's three mesh, in which case "model space" means
  // something different on the way in and on the way out.
  // Reported from the SAME arithmetic the fix uses: the old diagnostic measured the round trip
  // it was meant to be checking, which is why it read err=0.0000 while children flew off.
  if (window._tweakTrace && kids.length) {
    for (let i = 0; i < kids.length; i++) {
      const m = mat4.create();
      mat4.multiply(m, joint.getModelSpaceMatrix(), kids[i].getMatrix());
      console.log('[compensate] ' + (kids[i]._permanentStaticLabel || kids[i].getID())
        + ' at=' + m[12].toFixed(3) + ',' + m[13].toFixed(3) + ',' + m[14].toFixed(3)
        + ' dist=' + Math.hypot(m[12] - pos.x, m[13] - pos.y, m[14] - pos.z).toFixed(3));
    }
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
Skeleton.makePin = function (main, joint, opts) {
  if (!main || !main.buildNull) return null;
  // REVEALED BY DEFAULT, because almost every caller is a person pinning a joint. The exception
  // is the loader: forcing the flag while reading a file would overwrite the user's saved
  // preference every time a rig with pins came back, which is a setting that could never be
  // made to stick. deserialize passes reveal:false.
  if (!opts || opts.reveal !== false) Skeleton.revealPins(main);
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
    // Seat it at the joint AND push that through to the three-side matrix. Unsynced, the
    // pin's two matrices disagree from the moment it is created: the SculptGL one stands at
    // the joint, the three one is still the locator buildNull left at the origin. Everything
    // that reads a pin through `getModelSpaceMatrix` on a parented mesh — the anchor the
    // solve chases included — then reads the wrong one, and every world-preserving operation
    // preserves a transform that was never true. Same mistake FrameGroup records shrinking a
    // duplicated mesh.
    if (pin.setModelSpaceMatrix) pin.setModelSpaceMatrix(_mTmp.elements);
    else mat4.copy(pin.getMatrix(), _mTmp.elements);
    Skeleton.syncThree(pin);
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
// WHILE A CONTEXT MENU IS ACTING ON A NODE, THE PRESELECTION STOPS MOVING.
//
// Picking a sector means moving the hand, and the hover follows the hand — so without this the
// highlight walks to whatever is nearest while the wheel is up, drawing attention to an object
// the menu will not touch. The latch is the subject; nothing else may claim the preselection
// until the operation is finished.
function hoverFrozen(main) { return main && main._rigMenuLatch != null; }

function applyRigHover(main, node) {
  if (hoverFrozen(main)) return;
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

// THE OTHER HALF OF THE SAME ANSWER. Every hover route already computes what is under the
// pointer and then throws the result away unless it is a rig node; this keeps the other case.
// Cheap to call every time: setMeshHoverHighlight returns on its first line when the id has not
// moved, which is the overwhelming majority of frames.
function applyMeshHover(main, mesh) {
  if (hoverFrozen(main)) return;
  const on = Skeleton.displayFlag('meshHover') && mesh && !isRigNode(mesh);
  main.setMeshHoverHighlight?.(on ? mesh.getID() : -1);
}
Skeleton.applyMeshHover = applyMeshHover;

function applyRigHovers(main, nodes, primaryNode, hands = []) {
  if (hoverFrozen(main)) return;
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
// `meshes` narrows what may be hovered — the rig assignment passes pins only, so the
// preselection cannot offer a bone the pick would refuse.
Skeleton.hoverRigFromMouse = function (main, picking, meshes) {
  if (window._grabTrace && (!main || !picking)) {
    console.log('[rigHover] mouse: main=' + !!main + ' picking=' + !!picking);
  }
  if (!main || !picking || !hoverDue(main, 'mouse')) return;
  const hit = pickPreserving(picking, () => {
    const got = picking.intersectionMouseMeshes(
      meshes || main.getMeshes(), main._mouseX, main._mouseY, false, true) ? picking.getMesh() : null;
    // THE BONE UNDER THE CURSOR, which is not the same answer as the node under it: a segment
    // resolves to its nearer END for selection, while an operation on the bone itself wants the
    // bone. Published here so both are available and neither has to be guessed from the other.
    main._rigHoverBone = picking._rigHitSegment || null;
    return got;
  });
  applyRigHover(main, isRigNode(hit) ? hit : null);
  applyMeshHover(main, hit);
};

// VR: pick from the controller ray Scene supplies. NOT derived from the controller matrix —
// that is the raw WebXR frame, and picking against it misses every mesh in the scene.
Skeleton.hoverRigFromRay = function (main, picking, origin, dir, meshes) {
  if (!main || !picking || !origin || !dir || !hoverDue(main, 'vr')) return;
  // Rig hover is an x-ray operation: skin geometry must not occlude the bone/pin that the
  // controller is visibly aiming at. Use the same target class as rig acquisition.
  const vis = (meshes || main.getMeshes()).filter((m) => m.isVisible() && isRigNode(m));
  const hit = pickPreserving(picking, () => {
    const got = picking.intersectionRayMeshes(vis, origin, dir, true) ? picking.getMesh() : null;
    main._rigHoverBone = picking._rigHitSegment || null;   // see hoverRigFromMouse
    return got;
  });
  applyRigHover(main, isRigNode(hit) ? hit : null);
};

// VR Grab supplies a complete controller snapshot even though Scene dispatches the tool
// through the dominant hand. Pick both rays so each controller gets independent preselection;
// keep the dominant ray in the legacy singular fields used by face-button actions.
// A CONTROLLER'S AIMING RAY, in engine space. Lives here because two tools need exactly the
// same one: Grab's hover branch and the Select tool both feed it to hoverRigFromRays, and two
// implementations of "where is this controller pointing" is how the mouse and VR picks drifted
// apart the last time. Prefers the ray Scene computed; falls back to the controller matrix.
Skeleton.controllerRay = function (controller) {
  if (!controller || !controller.matrix) return null;
  if (controller.rayOrigin && controller.rayDirection) {
    return { origin: vec3.clone(controller.rayOrigin), direction: vec3.clone(controller.rayDirection) };
  }
  const origin = vec3.create();
  const direction = vec3.create();
  vec3.transformMat4(origin, [0, 0, 0], controller.matrix);
  vec3.transformMat4(direction, [0, 0, -1], controller.matrix);
  vec3.sub(direction, direction, origin);
  vec3.normalize(direction, direction);
  return { origin, direction };
};

Skeleton.hoverRigFromRays = function (main, picking, rays, primaryHand) {
  if (!main || !picking || !rays?.length || !hoverDue(main, 'vr')) return;
  // ORDINARY MESHES ARE CANDIDATES HERE TOO.
  //
  // This list was filtered to rig nodes, so in VR a mesh could never BE the hit and the hover
  // had nothing to say about one -- the mesh outline only ever appeared on the frame the
  // trigger went down, because the block that set it lives in the trigger branch. From inside
  // the headset that is simply "there are no highlights". matt: "i have them all turned off
  // apart from mesh hover, but i get no highlights."
  //
  // Safe to widen, and this is the part worth being clear about: the x-ray property the filter
  // was protecting -- skin must not occlude the bone behind it -- is enforced INSIDE the pick,
  // by the rig-beats-mesh rule, not by leaving meshes out of the list. A bone under the ray
  // still wins over the body in front of it; a mesh wins only where no rig node is in reach, or
  // where it is furniture hung off one.
  const vis = main.getMeshes().filter((m) => m.isVisible() && (isRigNode(m) || m.isPickable !== false));
  let hoveredBone = null;
  const hits = rays.map(({ origin, direction }) => {
    return pickPreserving(picking, () => {
      const got = picking.intersectionRayMeshes(vis, origin, direction, true) ? picking.getMesh() : null;
      if (picking._rigHitSegment) hoveredBone = picking._rigHitSegment;
      return got;
    });
  });
  main._rigHoverBone = hoveredBone;
  const primaryIndex = Math.max(0, rays.findIndex((r) => r.handedness === primaryHand));
  const rigHits = hits.map((h) => (isRigNode(h) ? h : null));
  applyRigHovers(main, rigHits, rigHits[primaryIndex] || null, rays.map((r) => r.handedness));
  // ONE BOX, so it follows the PRIMARY hand. The rig can light a node per controller because
  // each node draws its own marker; there is a single outline object and two of them pointing
  // at different meshes has no answer.
  applyMeshHover(main, hits[primaryIndex]);
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
// `opts.silent` creates the joint without pushing undo entries of its own — for callers that
// wrap a whole topology edit in one step (see RigTopology). Two entries for one split would
// leave the middle press showing a rig nobody built.
Skeleton.createJoint = function (main, pos, parent, name, opts) {
  // boneTrace: the CPU half of a new joint, which no frame timing contains -- this runs on the
  // input event, the frame it costs comes later. See Scene._boneTraceFrame.
  const _btAt = window._boneTrace ? performance.now() : 0;
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

  if (opts && opts.silent) main.addMeshSilent(mesh);
  else main.addNewMesh(mesh);

  // The locator itself never draws — the flat bone/joint visuals represent it. colorWrite
  // off keeps CPU picking working (it uses geometry, not the material).
  //
  // THE SHARED no-draw material, via noDrawMaterial below, and NOT a fresh one here. This line
  // used to allocate its own MeshBasicMaterial per joint, and noDrawMaterial's "already ours"
  // guard -- colorWrite false and depthWrite false -- then recognised it and left it alone. So
  // every joint kept a stock material of its own, the node sweep converted each one separately
  // (convertBasic caches per SOURCE material), and drawing a chain paid a node graph and a
  // pipeline per joint. matt: "i still get stutters when drawing out bone chains."
  const tm = mesh.getThreeMesh();
  if (tm) {
    // matrixAutoUpdate is cleared by Mesh.js's per-frame sync, which has NOT run yet for a
    // mesh created this frame. Leaving it at Three's default (true) makes updateMatrixWorld
    // recompose tm.matrix from the untouched position/quaternion/scale and discard the
    // matrix set above — the joint then reads as sitting at the worldGroup origin, and
    // setMeshParent's attach() (which preserves WORLD transform) bakes that origin in for
    // good. Every joint after the first ends up stacked at the origin.
    tm.matrixAutoUpdate = false;
    tm.matrix.fromArray(mesh.getMatrix());
    tm.updateMatrixWorld(true);
    // The locator must never draw — the flat bone/joint visuals represent it. It is hidden by
    // its MATERIAL rather than by `visible`, because in three.js `visible = false` skips the
    // whole SUBTREE: anything parented to a joint could never render, however correct it was.
    // That is precisely what happened to the baked weight capsules, which are parented to
    // joints and were perfect in every measurable respect and invisible.
    //
    // The material has to be reasserted, because StateAddRemove.undo() calls initRender() on
    // every surviving mesh and rebuilds it — which would otherwise resurrect the pick sphere as
    // a white blob. updateVisuals does that each frame; see noDrawMaterial.
    noDrawMaterial(tm);
  }

  // Every joint ever created this session, live or undone. The add/remove undo system is
  // not parenting-aware, so this registry is what lets updateVisuals repair the scene graph
  // after an undo or redo (see the self-heal pass there).
  main._skelAll = main._skelAll || new Set();
  main._skelAll.add(mesh);

  if (parent && main.getMeshes().includes(parent)) {
    main.setMeshParent(mesh.getID(), parent.getID(), opts && opts.silent ? { silent: true } : undefined);
    // Default capsule radius from the bone's own length. A measured-at-creation default
    // is what makes the phase-2 capsule bind possible without a second pass over the rig;
    // editing a stored number later is cheap, re-measuring a finished skeleton is not.
    const len = Skeleton.jointPos(parent).distanceTo(Skeleton.jointPos(mesh));
    mesh._boneRadius = len * radiusFrac();
  } else {
    mesh._boneRadius = unit * 0.05;
  }

  if (name) mesh._permanentStaticLabel = name;
  if (_btAt && window.app && window.app._boneTraceJoint) {
    window.app._boneTraceJoint(performance.now() - _btAt, Skeleton.joints(main).length);
  }
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


/**
 * EVERY BATCH A RIG WILL EVER NEED, BUILT BEFORE THERE IS A RIG.
 *
 * A pipeline is keyed on the material AND the geometry it is drawn with -- attribute layout,
 * instancing, the lot. NodeMaterials.warm draws each material once on a plain PlaneGeometry
 * Mesh, which compiles a pipeline the rig then never asks for: these batches are InstancedMesh
 * carrying aQ/aS/aC and friends, so the first bone drawn in a session compiled the real ones
 * from scratch. Measured by matt on a GalaxyXR with boneTrace():
 *
 *   joint 1: frame +0  1520.0ms  built pipelines+29 vs+28 fs+7 graphs+30 | gl-render 1467.8
 *
 * A second and a half, inside the session, on the first bone. Creating the batches here and
 * handing the real meshes to the warm pass moves that cost to where the user is already
 * waiting -- and they are the SAME meshes, so what gets compiled is what gets drawn.
 *
 * Idempotent: batchFor returns an existing batch, so calling this after a rig exists is free.
 * Each batch sits at count 0 and draws nothing until a joint fills it.
 *
 * THE TABLE IS THE ONE ensureEntry USES. Listing these keys twice is how the warm pass would
 * quietly drift out of date -- a key added to a rig and not here is a pipeline compiled in the
 * session again, which is invisible until someone runs boneTrace on a headset. rigbatch_test
 * checks the two lists against each other.
 */
const PREWARM_BATCHES = [
  ['capEnd', capsuleEndGeometry, false], ['capEndHi', capsuleEndGeometry, false],
  ['capEndG', capsuleEndGeometry, true], ['capEndGHi', capsuleEndGeometry, true],
  ['capShaft', capsuleShaftGeometry, false], ['capShaftHi', capsuleShaftGeometry, false],
  ['capShaftG', capsuleShaftGeometry, true], ['capShaftGHi', capsuleShaftGeometry, true],
  ['bone', boneGeometry, false], ['bone-phys', bonePhysGeometry, false],
  ['bone-ghost', boneGeometry, true], ['bone-phys-ghost', bonePhysGeometry, true],
  ['joint', jointGeometry, false], ['joint-phys', jointPhysGeometry, false],
  ['joint-ghost', jointGeometry, true], ['joint-phys-ghost', jointPhysGeometry, true],
];
const PREWARM_LINE_BATCHES = [
  ['wire', boneEdgeGeometry, false], ['wire-phys', bonePhysEdgeGeometry, false],
  ['wire-ghost', boneEdgeGeometry, true], ['wire-phys-ghost', bonePhysEdgeGeometry, true],
];

Skeleton.prewarmBatches = function (main) {
  if (!main) return [];
  const out = [];
  for (const [key, geoFn, ghost] of PREWARM_BATCHES) {
    const b = batchFor(main, key, geoFn, ghost);
    if (b && b.mesh) out.push(b.mesh);
  }
  for (const [key, geoFn, ghost] of PREWARM_LINE_BATCHES) {
    const all = main._skelBatch || (main._skelBatch = new Map());
    if (!all.has(key)) lineBatchSlot(main, key, geoFn, ghost);
    const b = all.get(key);
    if (b && b.mesh) out.push(b.mesh);
  }
  return out;
};

function ensureEntry(main, id) {
  const g = skelGroup(main);
  main._skelVis = main._skelVis || new Map();
  let e = main._skelVis.get(id);
  if (!e) {
    // The wireframe gets the same solid/ghost treatment as everything else, so the bone's
    // edges stay readable when it is buried inside the mesh.
    // MERGED. One LineSegments for every joint's edges rather than two per joint — the same
    // reason the bodies are instanced, and the wireframe is on by default so it was carrying
    // fifty of the remaining draw calls.
    const wire = physLineVariant(main,
      lineBatchSlot(main, 'wire', boneEdgeGeometry, false),
      'wire-phys', bonePhysEdgeGeometry, false);
    const wireGhost = physLineVariant(main,
      lineBatchSlot(main, 'wire-ghost', boneEdgeGeometry, true),
      'wire-phys-ghost', bonePhysEdgeGeometry, true);

    // The dashed leader from a pinned joint to the anchor it is trying to reach. Two points,
    // rewritten each frame; the dash pattern needs computeLineDistances() after every move.
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    // LineSegments, not Line: two points are one segment either way, so this is identical
    // here -- and THREE.Line is the primitive WebGPURenderer fails on (see
    // src/render/lineStrip.js). Changed now so a rig does not reintroduce the fault the
    // moment one exists; there was no rig in the scene when it was hunted down.
    const link = new THREE.LineSegments(linkGeo, new THREE.LineDashedMaterial({
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
      // BATCHED. One instance per bone and one per joint, each drawn twice, which is where the
      // ~185 draw calls came from. Everything else here is still a Mesh of its own — pins exist
      // only on pinned joints, capsules and labels are off by default, so none of them carry
      // the same weight.
      bone: {
        solid: physVariant(main, batchSlot(main, 'bone', boneGeometry, false),
          'bone-phys', bonePhysGeometry, false),
        ghost: physVariant(main, batchSlot(main, 'bone-ghost', boneGeometry, true),
          'bone-phys-ghost', bonePhysGeometry, true),
      },
      joint: {
        solid: physVariant(main, batchSlot(main, 'joint', jointGeometry, false),
          'joint-phys', jointPhysGeometry, false),
        ghost: physVariant(main, batchSlot(main, 'joint-ghost', jointGeometry, true),
          'joint-phys-ghost', jointPhysGeometry, true),
      },
      wire: { solid: wire, ghost: wireGhost },
      label: makeLabel(),
      cap: {
        shaft: makeCapsuleShaftSlots(main),
        // THE ENDS ARE INSTANCED. They carry no taper -- world-axis aligned, with their three
        // extents straight in the scale -- so they need nothing an instance cannot hold, and
        // they were four of the six meshes every bone was drawing. Measured on a 33-joint rig:
        // capsules on added 192 visible meshes (110 -> 302), six per bone, none of them batched.
        a: makeCapsuleEndSlots(main),
        b: makeCapsuleEndSlots(main),
      },
    };
    // The batched slots, listed so flushBatches can gather them without knowing this shape.
    e._slots = [e.bone.solid, e.bone.ghost, e.joint.solid, e.joint.ghost,
                e.wire.solid, e.wire.ghost,
                e.cap.shaft.solid, e.cap.shaft.ghost,
                e.cap.a.solid, e.cap.a.ghost, e.cap.b.solid, e.cap.b.ghost];
    g.add(e.label.sprite, e.pinLink,
          e.pinT.solid, e.pinT.ghost, e.pinG.solid, e.pinG.ghost,
          e.pinS.solid, e.pinS.ghost);
    // Every capsule part is batched now; none of them are scene children.
    main._skelVis.set(id, e);
  }
  return e;
}

function disposeEntry(main, id) {
  const e = main._skelVis && main._skelVis.get(id);
  if (!e) return;
  const g = skelGroup(main);
  if (e.pinLink) {
    g.remove(e.pinLink);
    e.pinLink.geometry.dispose(); e.pinLink.material.dispose();
  }
  // bone, joint, wire AND CAPSULE are batch SLOTS, not scene objects — they own no geometry or
  // material and are released with the batch itself.
  //
  // THE CAPSULES JOINED THAT LIST when they were instanced, and this was not updated: a slot is
  // a plain object with a position, a colour and a no-op updateMatrix, so it answers to
  // `.material` and then has no `userData` at all. Deleting enough rig objects that a joint
  // entry went away therefore threw here, on the frame after the delete. matt: "i could delete
  // some and it was fine, but then deleted some more and got this error: Cannot read properties
  // of undefined (reading 'vcMat')". Only the pin markers are still real meshes.
  for (const p of [e.pinT, e.pinG, e.pinS]) {
    if (!p) continue;
    g.remove(p.solid, p.ghost);
    // Both materials, not `o.material`: a pin disposed while it was highlighted would leak the
    // axis-coloured one, and one disposed while idle would leak the highlight copy.
    for (const o of [p.solid, p.ghost]) {
      const mats = new Set([o.material, o.userData.vcMat, o.userData.plainMat].filter(Boolean));
      for (const m of mats) m.dispose();
    }
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

    // Non-drawing via the MATERIAL, never via `visible` — see makeJoint. initRender() may have
    // rebuilt the material, so it is reasserted here rather than assumed.
    noDrawMaterial(tm);

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
// ── DRIFT TRIPWIRE ────────────────────────────────────────────────────────────────────────
//
// matt: "a pinned bone gradually scaled away to nothing... the elbow, and the hand child both
// collapse." GRADUAL means compounding, so something writes a joint every frame and does not
// give back exactly what it took. Reading has not found it and the solver measures clean over
// closed loops in every pin mode, so this asks the running app instead.
//
// Only two numbers can shrink a drawn bone, and they are both LOCAL to the joint:
//   - the local TRANSLATION, whose length is the bone in the parent's frame
//   - the local SCALE, which shrinks everything below it, which is why a hand collapses with
//     the elbow that carries it
// Sampling both each frame says WHICH, and that halves the search on the first report. Local
// rather than model-space on purpose: a model-space length changes when an ancestor legitimately
// moves, and would cry wolf on every pose.
let _driftPrev = null, _driftAt = 0, _driftWorst = new Map();

function driftCheck(joints) {
  const now = performance.now();
  const cur = new Map();
  for (const j of joints) {
    const m = j.getMatrix();
    cur.set(j.getID(), {
      name: j._permanentStaticLabel || ('joint ' + j.getID()),
      t: Math.hypot(m[12], m[13], m[14]),
      s: Math.hypot(m[0], m[1], m[2]),
    });
  }
  if (_driftPrev) {
    for (const [id, c] of cur) {
      const p = _driftPrev.get(id);
      if (!p) continue;
      // A real edit moves a joint by a lot in one frame; a ratchet moves it by a sliver every
      // frame forever. The band catches the second and ignores the first, which is the whole
      // point — otherwise posing the rig buries the signal.
      const dt = p.t > 1e-12 ? (c.t - p.t) / p.t : 0;
      const ds = p.s > 1e-12 ? (c.s - p.s) / p.s : 0;
      for (const [kind, d] of [['translation', dt], ['scale', ds]]) {
        if (Math.abs(d) < 1e-7 || Math.abs(d) > 0.25) continue;
        const key = c.name + ' ' + kind;
        const w = _driftWorst.get(key) || { n: 0, sum: 0, first: d };
        w.n++; w.sum += d;
        _driftWorst.set(key, w);
      }
    }
  }
  _driftPrev = cur;
  if (now - _driftAt < 1000) return;
  _driftAt = now;
  if (!_driftWorst.size) { console.log('[rigDrift] nothing moved this second'); return; }
  const rows = Array.from(_driftWorst.entries())
    .sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum)).slice(0, 6);
  for (const [key, w] of rows) {
    console.log('[rigDrift] ' + key + ': ' + w.n + ' frames, net '
      + (w.sum * 100).toFixed(4) + '% (' + (w.sum > 0 ? 'growing' : 'SHRINKING') + ')');
  }
  _driftWorst = new Map();
}

// Watch every joint's LOCAL translation and scale and report anything that creeps. Run it,
// then pose the rig with a pin on and leave it alone for a few seconds. A line naming
// "translation" means the bone's own offset is being eaten; "scale" means the joint is
// shrinking and taking its children with it. Silence means neither, and the collapse is in
// what draws the bone rather than in the rig.
window.rigDrift = function (on) {
  window._rigDrift = on !== false;
  _driftPrev = null; _driftWorst = new Map(); _driftAt = 0;
  console.log('[rigDrift] ' + VERSION + ' — ' + (window._rigDrift ? 'ON' : 'off')
    + (window._rigDrift ? '. One line a second per drifting joint, even if nothing drifts.' : ''));
  return window._rigDrift;
};

// ── THE PENDING-ASSIGNMENT LINK ───────────────────────────────────────────────────────────
//
// A yellow dashed line from the CHILD to the parent it is about to get. It exists because the
// gesture is otherwise invisible: the button says a click is expected, but nothing in the 3D
// view says which object is the child, which one the click would take, or that anything is
// armed at all. matt asked for it by name, and it doubles as proof the target is pickable —
// no line means the thing under the pointer is not something this can parent to.
//
// Drawn between MODEL-space origins, which is where a pin and a joint both live.
const PENDING_COLOR = 0xffe066;
let _pendLine = null;
let _pendHovering = false;

function pendingLink(main) {
  const step = RigPending.step(main);
  // KEEP THE PRESELECTION ALIVE FOR BOTH STEPS. The tools that normally drive it are Grab and
  // the transforms, and while an assignment is armed those tools are switched off — so without
  // this there is no highlight at all, and the one question the user is being asked, "which
  // one?", has no answer on screen. It was gated on the PARENT step alone, which left the
  // child step with nothing to look at: matt, "it's not preselect highlighting either".
  //
  // hoverRigFromMouse throttles itself and restores the picking state it borrowed, which is
  // what makes this safe to ask for every frame — see the note on it.
  // Guarded against RE-ENTRY: applyRigHover repaints the visuals when the highlight changes,
  // and the visuals are what called this. The throttle alone would bound the recursion at two
  // levels, which is not a depth problem but is a whole extra rig rebuild on every hover
  // change. The flag makes the inner pass draw the line and ask nothing.
  if (step && !_pendHovering && !main._xrSession && main.getPicking) {
    _pendHovering = true;
    try {
      Skeleton.hoverRigFromMouse(main, main.getPicking(), RigPending.targets(main));
    } finally { _pendHovering = false; }
  }

  const subject = RigPending.subject(main);
  const target = RigPending.candidate(main);
  if (!_pendLine) {
    // A FAT line, not a native one: THREE's `Line` is a 1px hardware line that steps between
    // whole pixels and all but disappears against a busy sculpt. This is the only thing on
    // screen saying the gesture is live, so it gets a width you cannot miss. Same
    // LineSegments2 machinery the motion trails use.
    _pendLine = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({
      color: PENDING_COLOR,
      linewidth: 5,          // SCREEN pixels, since worldUnits is off
      worldUnits: false,
      dashed: true,
      transparent: false,
      depthWrite: false,
      depthTest: false,      // it is a readout, and being hidden inside the mesh is useless
      toneMapped: false,     // or a saturated yellow rolls off to pastel under any tone map
    }));
    _pendLine.renderOrder = 10001;   // over the pin leaders, which is the one thing it can hide
    _pendLine.isPickable = false;
    _pendLine.raycast = () => {};
    _pendLine.frustumCulled = false;
  }
  const g = skelGroup(main);
  if (_pendLine.parent !== g) g.add(_pendLine);

  if (!subject || !target) { _pendLine.visible = false; return; }
  const a = subject.getModelSpaceMatrix && subject.getModelSpaceMatrix();
  const b = target.getModelSpaceMatrix && target.getModelSpaceMatrix();
  if (!a || !b) { _pendLine.visible = false; return; }
  // A screen-space width has to know what the screen is, and LineMaterial clones its uniforms
  // per material — a resolution left at the default 1x1 divides the width by one instead of by
  // a thousand, which is not a subtle error.
  const cam = main.getCamera && main.getCamera();
  const rw = (cam && cam._width) || 1, rh = (cam && cam._height) || 1;
  if (_pendLine.material.resolution.x !== rw || _pendLine.material.resolution.y !== rh) {
    _pendLine.material.resolution.set(rw, rh);
  }
  _pendLine.geometry.setPositions([a[12], a[13], a[14], b[12], b[13], b[14]]);
  // Dash size from the span, so the line reads as dashed whether it crosses a finger or a
  // whole character — a fixed dash is solid at one scale and a row of dots at the other.
  const span = Math.hypot(b[12] - a[12], b[13] - a[13], b[14] - a[14]);
  _pendLine.material.dashSize = span * 0.06;
  _pendLine.material.gapSize = span * 0.04;
  _pendLine.material.needsUpdate = true;
  _pendLine.computeLineDistances();
  _pendLine.visible = true;
}

// Does hovering an outliner row light the thing in 3D? Two attempts have failed and reading has
// not found it, so this reports the whole chain: how many rows got wired, what a row resolves
// to, what id reaches the draw, and whether that id is a joint the draw can see.
//
// Prints on every move over a row, so turn it off after. Silence when you hover a row means the
// listener never fired — which is a different bug from the id not reaching the draw.
window.outlinerHover = function (on) {
  window._outlinerHoverTrace = on !== false;
  console.log('[outlinerHover] ' + VERSION + ' — trace ' + (window._outlinerHoverTrace ? 'ON' : 'off')
    + '. Open the outliner, move over a bone row. Nothing printing at all means the row '
    + 'listener never fired; a "row -> ..." with no "draw:" means the id is not reaching the '
    + 'visuals; a "draw: ... is NOT one of the N joints" means the id is the wrong kind.');
  console.log('[outlinerHover] wiring is re-attached on the next panel repaint — '
    + 'open or switch a tab if the row lines do not appear.');
  return window._outlinerHoverTrace;
};

// REBUILD THE OUTLINER, both of them, and make the panel actually believe it.
//
// The VR panel skips a rebuild when its content key is unchanged, and that key is built from
// the section, the shader, the mesh COUNT and the active tool — none of which a rename touches.
// So renaming left the old names in the DOM until something else forced a rebuild, which is why
// closing and reopening the outliner "fixed" it. The revision counter goes into that key, so
// anything that changes what the outliner SAYS can say so.
Skeleton.refreshOutliner = function (main) {
  if (!main) return;
  main._outlinerRev = (main._outlinerRev | 0) + 1;
  const gui = main.getGui && main.getGui();
  if (gui && gui._desktopSceneEl && gui._buildDesktopScene) gui._buildDesktopScene(gui._desktopSceneEl);
  main._mainMenuPanel?.markDirty?.();
};

Skeleton.updateVisuals = function (main) {
  // COUNTED, because this is a refresh function with 57 call sites and nothing says how many of
  // them fire in one frame. matt's performance recording put `held` -- a one-line property
  // lookup inside this function's per-joint loop -- at 401.9ms of SELF time, second only to
  // WebGLRenderer.render. Four call sites in a joint loop cannot reach that in 15 seconds unless
  // this whole function is running many times a frame. xrPerf prints the per-frame count.
  window._skelVisCalls = (window._skelVisCalls | 0) + 1;
  Skeleton.healGraph(main);
  // Ahead of the no-joints early return below: an assignment can be under way in a scene with
  // no rig in it at all, and the line is the only thing on screen saying so.
  pendingLink(main);
  const joints = Skeleton.joints(main);
  if (window._rigDrift) driftCheck(joints);
  main._skelVis = main._skelVis || new Map();
  if (!joints.length) {
    if (main._skelVis.size) for (const id of Array.from(main._skelVis.keys())) disposeEntry(main, id);
    // AND THEN FLUSH, or the rig is still on screen with nothing behind it.
    //
    // Bones, joints and capsules are drawn as INSTANCED batches, and what decides whether they
    // appear is the instance COUNT on the batch mesh -- not the entries that were just disposed.
    // Returning here left every batch holding the count from the last frame that had a rig, so a
    // cleared scene kept its skeleton: an empty outliner beside a viewport full of bones. matt:
    // "if i make a new scene in vr, the outliner is empty, but bones are still visible in the
    // viewport, left behind from the previous scene."
    //
    // flushBatches walks _skelVis, which is now empty, so every batch is written to zero.
    flushBatches(main);
    return;
  }

  const unit = Skeleton.sceneUnit(main);
  const jr = unit * JOINT_R_FRAC;
  const live = new Set();
  const hi = main._skelHighlightId ?? -1;
  const hiAll = new Set(main._skelHighlightIds || [hi]);
  const pinHiAll = new Set(main._pinHighlightIds || [main._pinHighlightId ?? -1]);
  // A SECOND SOURCE FOR THE SAME STATE: hovering a row in the outliner.
  //
  // It cannot go through setRigHighlight, because the ray hover is recomputed from scratch
  // every frame and would overwrite it before it was ever drawn — which is exactly what
  // happened. Its own channel, OR-ed in here, so the two sources cannot stomp each other and
  // the highlight still means one thing wherever it came from. Added to both sets: an id
  // matches a joint or a pin, never both.
  const panelHi = main._rigPanelHoverId;
  if (panelHi != null && panelHi >= 0) { hiAll.add(panelHi); pinHiAll.add(panelHi); }
  if (window._outlinerHoverTrace && panelHi != null && panelHi >= 0) {
    const hit = joints.some((j) => j.getID() === panelHi);
    console.log('[outlinerHover] draw: id ' + panelHi + (hit ? ' IS' : ' is NOT')
      + ' one of the ' + joints.length + ' joints'
      + ' | dots ' + (Skeleton.displayFlag('joints') ? 'on' : 'off')
      + ' | bones ' + (Skeleton.displayFlag('solid') ? 'on' : 'off'));
  }

  // THE NODE A CONTEXT MENU IS ACTING ON reads as SELECTED for the duration — see the latch in
  // Scene. Added to `sel`, not to the highlight: while the menu is up this is not "what you
  // would take", it is "what this is about to happen to", and those are different claims.
  const menuLatch = main._rigMenuLatch;
  const grabHands = main._rigGrabHands || {};
  // Which nodes a controller is HOLDING. Read for truth, not for colour: holding a thing is a
  // stronger statement than aiming at it, so it outranks the preselect and shows as selected.
  const held = (id) => !!grabHands[id];
  const showLen = Skeleton.displayFlag('lengths');
  const showNames = Skeleton.displayFlag('names');
  // The bind capsules, drawn. They are the actual support of the capsule bind — a vertex
  // outside every capsule gets no weight from any of them — so seeing them is the difference
  // between tuning weights by argument and tuning them by eye.
  //
  // ...UNLESS THEY HAVE BEEN BAKED, in which case the baked meshes ARE the capsules and the
  // parametric ones are a second, stale copy of the same shape drawn over the top of them.
  // Sculpt a cage and the drawn capsule stays where it was, so the two disagree about the thing
  // they both claim to show, and the one that is no longer the truth is the one drawn on top.
  // matt: "those meshes ARE the capsules, so the original parametric capsules should be hidden.
  // its only if i press the 'delete capsules' button should the parametric capsules be drawn
  // again." Deleting the cages brings them straight back, since this is read every frame.
  //
  // Asked of the mesh list rather than through WeightCage, which imports this module -- the
  // property is the same one WeightCage.isCage tests, and a scan is cheaper than a cycle.
  const showCaps = Skeleton.displayFlag('capsules')
    && !(main.getMeshes() || []).some((m) => m && m._isWeightCage);
  // The bone body and its edge overlay, each switchable. Turning both off brings the joint
  // dots back on their own, because otherwise there would be nothing on screen marking a
  // target that is still perfectly pickable — the bone IS the target now.
  const showSolid = Skeleton.displayFlag('solid');
  const showWire = Skeleton.displayFlag('wire');
  // Pins and joint dots are their own display layers, independent of the bone body.
  const showJoints = Skeleton.displayFlag('joints');
  // The master switch, read once per pass — see the joint-dot visibility line below.
  const decorHidden = Skeleton.decorationsHidden();
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
  if (menuLatch != null && menuLatch >= 0) sel.add(menuLatch);

  for (const j of joints) {
    const id = j.getID();
    live.add(id);
    const e = ensureEntry(main, id);

    // WHICH BATCH THIS JOINT'S SHAPES COME FROM, decided once here rather than inside any of the
    // placement loops below -- they are delicate enough that rigbatch_test checks they were not
    // rewritten, and nothing about placement changes: a box and a sphere occupy the same local
    // frame. See physicsGoverned.
    {
      const phBone = physicsBoneGoverned(j);
      e.bone.solid._phys = e.bone.ghost._phys = phBone;
      e.wire.solid._phys = e.wire.ghost._phys = phBone;
      e.joint.solid._phys = e.joint.ghost._phys = physicsGoverned(j);
    }

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

    // Preselection: the joint the next trigger will act on. COLOUR ONLY. It used to grow the
    // sphere as well, on the argument that size is what reads at a glance in a headset — but a
    // marker that changes size competes with what size already means here, which is the joint
    // radius, and the whole rig appeared to breathe as the cursor swept across it. The same
    // call the pin markers made, for the same reason. Outliner SELECTION still scales: that is
    // a state you set and leave, not something that flickers under a moving hand.
    const isHi = hiAll.has(id);
    const isSel = sel.has(id);
    const jointHeld = held(id);
    // THERE ARE NO JOINT SPHERES ANY MORE.
    //
    // The bone between two joints donates its surface to the joints at its ends (see the note
    // in Picking), so the whole rig is one continuous target and the dot that used to mark
    // where the invisible pick point sat has nothing left to say. Preselection and selection
    // moved onto the CAPSULE, below: every capsule touching the joint lights up, which says
    // "this joint" without adding a second kind of marker to say it with. Two markers for one
    // thing is what the dual representation was, and a dot that appears only sometimes is
    // still a dot.
    //
    // What is left is the one case with no capsule to light: an ISOLATED joint, which has no
    // bone at either end. Without this the first joint you place in Bone Draw would be
    // invisible and unpickable. The bone body being switched off is the same case by a
    // different route.
    //
    // There is no flag for any of it. Defaulting one to off is not the same as removing the
    // dots: the flag was persisted, so anyone who had ever seen the old default carried it
    // forward and got them back on every launch.
    const isolated = !hasChildBone.has(id) && !Skeleton.isJoint(j._parentMesh);
    // THE DOT IS SIZED BY ITS OWN JOINT, not by the scene.
    //
    // `jr` is one number for the whole rig — a fraction of the scene unit — which is right when
    // every joint is about the same size and wrong the moment they are not. At finger scale the
    // marker is bigger than the thing it marks: it swallows the joint, and the colour it is
    // trying to report is the colour you can no longer see. matt: "the default highlight spheres
    // is too big and totally obscures the finger joints, and i cant see the colours changing as i
    // move the joints."
    //
    // CAPPED BY THE OLD VALUE, never above it, so a rig of ordinary joints looks exactly as it
    // did and only the small ones change. Read straight off the joint rather than through
    // boneRadiusOf, which walks every mesh in the scene — once per joint, that is quadratic in
    // the middle of the per-frame visual pass.
    // THE SMALLER OF WHAT THE JOINT IS AND WHAT ITS BONE IS. `_boneRadius` is measured from the
    // bone's LENGTH when it is drawn, so taking the minimum of the two is what makes a marker on
    // a short bone small without anything having to measure a length here. matt: "it should never
    // be bigger than the joint sphere, and the system should be smart enough to reduce the size
    // of the joint indicators if the joint length gets shorter."
    const bR = j._boneRadius || 0;
    const jR = j._jointRadius > 0 ? j._jointRadius : bR;
    const ownR = (bR && jR) ? Math.min(bR, jR) : (bR || jR);
    const jd = ownR > 1e-9 ? Math.min(jr, ownR * 0.6) : jr;
    // SELECTED BEATS PRESELECTED. Held, then selected, then preselected, then the base colour.
    // Preselect used to be tested first, so pointing at something already selected repainted it
    // yellow and it flicked between the two as the hand moved. matt: "if i select a joint, it
    // sometimes shows cyan, other times yellow... selected takes precidence." Which is right:
    // preselect answers "what would the next press take", and on a thing already taken that is the
    // less useful of the two answers. Written here rather than in the loop for the reason the note
    // below gives.
    // NO SIZE CHANGE ON SELECTION. It used to swell to 1.7x, which is a lot of movement to report
    // a fact the colour already reports — and at finger scale the swollen marker covers the joint
    // and its neighbours both. matt: "the scaling up of the selected joint is SUPER annoying.
    // remove it." Kept OUT of the loop below: rigbatch_test reads that loop as one span to check
    // the placement code was not rewritten, and a comment inside it is enough to trip that.
    for (const o of [e.joint.solid, e.joint.ghost]) {
      o.position.copy(_pB);
      o.scale.setScalar(jd);
      // Held and selected are the same statement, so the same colour: cyan. Preselect is
      // yellow, and it loses to a hand actually on the thing.
      o.material.color.setHex(jointHeld || isSel ? SELECT_COLOR
        : (isHi ? HILITE_COLOR : JOINT_COLOR));
      // OFF MEANS OFF. There used to be a `noBoneBody` term here — with the bone body and the
      // wireframe both switched off, the dots came back on their own so that something still
      // marked a joint that was perfectly pickable. Reasonable in the abstract and wrong in
      // practice: it silently overrode a switch the user had just thrown, and it did it a step
      // LATER, so the dots reappeared while you were turning other things off. matt: "if i turn
      // off joint spheres first, they go away, but then if i turn off bone solid and bone
      // wireframe, the joint spheres become visible again."
      //
      // The concern it answered is met by the terms that remain: preselect, selection and a
      // held joint all still light up, so pointing at a rig you have hidden still shows you
      // what you would take. And an ISOLATED joint keeps its exemption — it has no bone at
      // either end, so with nothing drawn it would be both invisible and unfindable, which is
      // the first joint of every chain you draw.
      // AND IT GETS OUT OF THE WAY WHILE YOU ARE MOVING IT. A marker exists to say which joint
      // the next press takes; once your hand is on it that question is answered, and all it does
      // then is hide the joint at the moment you most want to watch it. The explicit flag still
      // wins — asking for joint spheres means joint spheres — but the automatic preselect,
      // selection and held states all stand down for the duration of the drag.
      // HIDE ALL DECORATIONS WINS OVER THE EXEMPTIONS. The preselect/selection/isolated terms
      // exist so a rig you have switched off is still pointable-at — a good rule for the `joints`
      // flag on its own, and the wrong one for a master switch whose entire job is to clear the
      // view of everything drawn on top of the model. With it thrown, a selected joint went on
      // drawing its dot (and its ghost) and there was no control left that would remove it.
      // ONE LINE, and `decorHidden` lifted alongside the rest: rigpick_test evaluates this
      // expression directly, so a term it cannot be handed is a term that crashes the harness.
      o.visible = !decorHidden && (showJoints || (!jointHeld && (isolated || isHi || isSel)));
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }

    // The IK pin marker: triad for a position pin, triad + gimbal rings for a 6DOF one. Read
    // straight off the joint rather than through IKSolver, so the visuals stay independent of
    // the solver (and there is no import cycle).
    // Declared out here, not inside the `if (pinMode)` below: the preselection highlight
    // further down needs it whether or not this joint is pinned.
    const pinObj = livePin(j);
    const pinMode = pinObj ? ((pinObj._pinMode | 0) & 7) : 0;
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
      //
      // ROTATION-ONLY (mode 4) IS THE EXCEPTION, and for the reason above rather than against
      // it: that pin states nothing about position, so there is no shortfall to show and the
      // marker at the joint is the honest picture. Its handle is moved to match rather than
      // merely drawn there — the null is the thing you grab, and one left behind while the
      // animation carries the joint away would be unreachable. Only the translation is
      // touched; the orientation is the half it holds and is never written here. The guard
      // matters: this runs every frame, and an unconditional write would report a moved pin
      // to the solve watcher forever. (Literal 4 rather than IKSolver.PIN_ROT on purpose —
      // the visuals do not import the solver. See the note on reading the joint's own fields.)
      if (pinObj && pinObj.getModelSpaceMatrix) {
        // NOT WHILE IT IS IN A HAND. The follow below is a courtesy — it keeps a rotation-only
        // pin's handle reachable as the animation carries its joint away — but it is a WRITE,
        // and a write to a pin somebody is holding is the app arguing with the hand. Dragging a
        // wrist pin, this put it straight back on the joint every frame. matt: "nothing should
        // be able to move or rotate the pins but me."
        if (pinMode === 4 && pinObj.setModelSpaceMatrix && !held(pinObj.getID())) {
          const pm = pinObj.getModelSpaceMatrix();
          if (Math.abs(pm[12] - _pB.x) > 1e-9 || Math.abs(pm[13] - _pB.y) > 1e-9 ||
              Math.abs(pm[14] - _pB.z) > 1e-9) {
            _mTmp.fromArray(pm);
            _mTmp.elements[12] = _pB.x;
            _mTmp.elements[13] = _pB.y;
            _mTmp.elements[14] = _pB.z;
            // WRITE AND SYNC, together, or the write is only half done and it RATCHETS.
            //
            // setModelSpaceMatrix stores a LOCAL matrix; getModelSpaceMatrix on a parented
            // mesh reads back through `tm.matrixWorld`, which only the three-side sync
            // refreshes. Unsynced, the read below — and the read on the NEXT frame — sees the
            // world matrix from before the write, so each frame takes a stale world
            // transform, keeps its rotation and scale, patches the translation and re-seats
            // it: local becomes inv(parent_now) * parent_then * local, which is identity only
            // while the parent is still. On a moving joint it compounds, every frame, for as
            // long as the pin exists.
            pinObj.setModelSpaceMatrix(_mTmp.elements);
            Skeleton.syncThree(pinObj);
          }
        }
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
    // HOW STRONGLY THIS PIN IS ASKING, read through the solver's own accessor so the drawing and
    // the solve can never disagree about it. 1 when there is no registry to ask.
    const pinW = pinObj && window._ikPinWeightOf ? window._ikPinWeightOf(j) : 1;
    const pinHeld = pinObj ? held(pinObj.getID()) : false;
    // A steering goal is NOT a triad with a different colour — it is its own marker, and the
    // triad and the rings are both switched off for it. `pinMode > 1` used to light the gimbal,
    // which quietly gave the steering goal a set of orientation rings it does not have.
    // PRESELECTION IS COLOUR ONLY. It used to grow the marker as well — 2.2 to 3.0, half again
    // as big — and a marker that changes SIZE competes with the thing size already means here:
    // a pin's scale is how you read its kind and the joint radius it belongs to. The colour
    // says "this is what you would take" on its own, and it says it without moving anything.
    //
    // The marker is the mode, read off directly: the triad is the position half and the rings
    // are the rotation half. So a 3DOF pin is lines, a 6DOF pin is lines AND rings, and the
    // rotation-only pin is rings alone. Nothing had to be invented for the fourth mode — it
    // is the half of the 6DOF marker that says what it still does.
    const pinParts = [
      [e.pinT, showPins && (pinMode === 1 || pinMode === 2), jr * 2.2],
      [e.pinG, showPins && (pinMode === 2 || pinMode === 4), jr * 2.2],
      [e.pinS, showPins && pinMode === 3, jr * 1.5],
    ];
    // The gap between where the joint is and where it is pinned. Shown only when there IS a
    // gap worth showing: a pin that is being met draws no leader, so a visible dash always
    // means the solve is falling short.
    // Mode 4 excluded: a dash means the solve is falling short of a position goal, and a
    // rotation-only pin has none to fall short of. (It sits on the joint anyway.)
    // A PIN AT WEIGHT 0 IS NOT PULLING, so there is nothing for a leader to be falling short of.
    // The dash means "the solve has not met this goal"; on a pin that is asking for nothing it
    // just reads as a broken pin. matt: "if the weight is zero, i think that line should be
    // hidden."
    const gap = showPins && pinMode && pinMode !== 4 && pinW > 0 ? _vPin.distanceTo(_pB) : 0;
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

    // THE THING YOU CAN SEE IS THE THING YOU CAN CLICK.
    //
    // A pin's pick zone is a fixed fraction of the SCREEN (see Picking), while its marker is
    // sized from the scene unit in WORLD units — so on a large rig the drawn gnomon is far
    // bigger than the zone that answers for it. You aim at an arm of the triad, land outside
    // the pin's zone entirely, and the bone underneath wins: matt, "the wrist never preselect
    // highlighted". Publishing the drawn radius lets the pick take the larger of the two, so
    // pointing at the marker means what it looks like it means.
    //
    // Recorded on the PIN OBJECT rather than reached for from Picking, which would have to
    // import Skeleton for the scene unit and does not import it for anything else.
    if (pinObj) {
      let r = 0;
      for (const [, on, size] of pinParts) if (on) r = Math.max(r, size);
      pinObj._pickRadius = r;
    }
    for (const [part, on, size] of pinParts) {
      for (const o of [part.solid, part.ghost]) {
        o.visible = on;
        if (!on) continue;
        // Flat while it is the thing you would take, axis-coloured the rest of the time —
        // see the note on makePinPart for why the highlight cannot be a tint.
        const wantMat = (pinHeld || pinHot) ? o.userData.plainMat : o.userData.vcMat;
        if (wantMat && o.material !== wantMat) o.material = wantMat;
        if (o.material && o.material.color) {
          o.material.color.setHex(pinHeld ? SELECT_COLOR : (pinHot ? HILITE_COLOR
            : (pinMode === 3 ? PIN_SOFT_COLOR
              : ((pinMode === 2 || pinMode === 4) ? PIN_FULL_COLOR : PIN_POS_COLOR))));
          // SATURATION IS THE WEIGHT. A pin fading in has always looked exactly like one at full
          // strength, so the only way to know what a pin was doing was to find its curve. Now it
          // greys out as it lets go and comes back to full colour as it takes hold. matt: "maybe
          // even dim the pin itself, and ramp it in saturation until its weight is 1, and its at
          // full saturation."
          //
          // NOT while it is preselected or held: those colours are the answer to "what would I
          // take", and a dim version of that is a worse answer than a bright one. Applied as a
          // multiply, which desaturates the flat marker and dims the axis-coloured triad alike --
          // one line for both materials.
          if (!pinHeld && !pinHot && pinW < 1) {
            o.material.color.getHSL(_pinHSL);
            o.material.color.setHSL(_pinHSL.h, _pinHSL.s * pinW, _pinHSL.l * (0.55 + 0.45 * pinW));
          }
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

    if (showLen || showNames) {
      // ONE SPRITE, BOTH FACTS. A second label per joint would double the sprite count for
      // something you read rather than aim at, and the two belong together anyway: "forearm_02
      // 1.24" is one statement about one bone. Name first, because it is what you are looking
      // for; the number is the detail.
      //
      // The label rides the bone ENDING at this joint, so a chain's ROOT — which no bone ends
      // at — carries no name. That is the same limitation the length labels have always had,
      // and the joint dot is still there to aim at.
      const _nm = showNames ? (j._permanentStaticLabel || ('#' + id)) : '';
      const _ln = showLen ? (len < 10 ? len.toFixed(2) : len.toFixed(1)) : '';
      // Sit the label at the bone's midpoint, nudged off the shaft so it does not sit
      // inside the geometry it is describing.
      setLabelText(e.label, _nm && _ln ? (_nm + '  ' + _ln) : (_nm || _ln));
      e.label.sprite.position.copy(_pA).addScaledVector(_dir, 0.5).addScaledVector(_up, jr * 1.6);
      // Height sets the type size; width follows the canvas aspect, so nothing is stretched.
      // 0.06 is 0.75 of the 0.08 these used to be — matt's call, they were too big.
      const _h = unit * 0.06;
      e.label.sprite.scale.set(_h * (e.label.aspect || 2), _h, 1);
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
    const w = boneWidth(len);
    // TINTED BY THE PIN AT THE BONE'S ROOT, not at its tip. Pinning the ankle colours the FOOT
    // — the bone that grows out of the pinned joint — because "the pin is at the root of the
    // foot" is how a rig is read and talked about, and tinting the shin instead invites you to
    // hunt for which end of it the pin is actually on.
    //
    // A pinned LEAF has no bone growing out of it and would show nothing at all, so it falls
    // back to the bone that ENDS there. That is the one case where the two readings cannot
    // agree, and showing the pin somewhere beats showing it nowhere.
    const rootPin = livePin(parent) ? ((parent._boneIKPinObj._pinMode | 0) & 7) : 0;
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
    // Rotation-only (4) tints as 6DOF does: the bone below it IS held, just in rotation
    // rather than in place, and the thing the colour reports is that it is held at all.
    // PRESELECTION AND SELECTION LIVE HERE NOW, since there is no joint dot to carry them.
    //
    // A JOINT LIGHTS ITSELF AND THE BONE BELOW IT. ONE BONE, DOWNWARD, ALWAYS.
    //
    // This used to light a bone when EITHER of its ends was the joint in question, on the
    // reasoning that the pair above and below read as "this joint" in a way one capsule could
    // not. In use it reads as neither: a mid-chain selection lit two bones, so the highlight
    // spanned two segments and you could not tell which joint it was about -- and with a
    // preselection on one end and a selection on the other you got a yellow bone and a green one
    // meeting at a joint that was neither. matt: "its still confusing... sometimes you're
    // highlighting the bone parent as well, or making the parent yellow, or other strange combos."
    //
    // So it is the CHILD bone only. `e` is the entry for joint `j` and draws `parent -> j`, so
    // this bone belongs to `parent` looking down -- which is why the test is on the PARENT's id
    // and `isSel`/`isHi` (this joint's own state) are deliberately not in it.
    //
    // At the end of a chain there is no bone below, so nothing lights but the joint marker.
    // matt: "if the very end of a bone chain is selected, just make that joint tip be cyan."
    // That falls out of the rule rather than being a case in it.
    //
    // NOTE this is the opposite hand from the "a joint owns the bone that ENDS at it" convention
    // used by the capsule radius, Split and the physics shapes. Those are about which bone an
    // EDIT acts on; this is about which bone a joint should paint to say where it is. A joint at
    // the top of a chain has no bone above it to own, and would then be unable to show itself.
    //
    // Above the pin tint, unlike the identity colour: a pin is a standing state you can go and
    // look at, while preselection is the answer to "what does this press do" and is worth
    // nothing at all if something else can cover it.
    const pid = parent.getID();
    // Held follows the same downward rule: grabbing a joint lights the bone below it, so a drag
    // reads the same way a selection does rather than lighting one more segment than it.
    const boneHeld = held(pid);
    // ONE BONE READS AS HOVERED, not every bone touching a hovered joint.
    //
    // When a segment is actually under the cursor, that segment alone is hot, so what is lit is
    // what gets split. The latch wins while a context menu is up — see the note in Scene where it
    // is set. What is lit has to be what the menu will act on, and the hand has to move to choose.
    //
    // The FALLBACK, for when no segment resolved, follows the same downward rule as the selection
    // above: the preselected joint lights the bone below it and nothing else. It used to be
    // `isHi || hiAll.has(pid)`, which lit both.
    const hoverBone = main._rigHoverBoneLatch || main._rigHoverBone;
    const boneHot = hoverBone ? (hoverBone === j) : hiAll.has(pid);
    const boneSel = sel.has(pid);
    // Same precedence as the joint marker above: selected outranks preselected, so a bone does not
    // flick to yellow when the hand passes over something already chosen.
    const boneTint = (boneHeld || boneSel) ? SELECT_COLOR : (boneHot ? HILITE_COLOR
      : ((tintMode === 2 || tintMode === 4) ? PIN_FULL_COLOR
        : (tintMode === 1 ? PIN_POS_COLOR : restTint)));
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

    // Capsule. The BONE's radius belongs to the CHILD joint, matching the bind (a bone deforms
    // with its child), so the joint you highlight is the joint whose capsule lights up.
    //
    // A JOINT MAY OVERRIDE IT AT EITHER END, which is what makes a head wider than its neck.
    // The two ends are drawn at their own radii; the shaft is one cylinder at the mean, because
    // these are InstancedMeshes and one batch is one geometry — a true frustum would need a
    // batch per taper ratio and an entry rebuild every time you dragged one. The spheres are
    // what say how big a joint is, and the SKIN is tapered exactly (see SkinMesh capsuleTarget).
    const cr = j._boneRadius || 0;
    if (!showCaps || !(cr > 1e-9)) { hideCaps(e); continue; }
    const hA = Skeleton.jointHalf(parent, cr, _halfA);
    const hB = Skeleton.jointHalf(j, cr, _halfB);
    // The capsule spans the two SHAPES, which a face drag can move off their joints. The skin is
    // built from the same two points (SkinMesh caps), so the preview and the result agree.
    Skeleton.jointCentre(parent, _cA);
    Skeleton.jointCentre(j, _cB);
    _dirC.subVectors(_cB, _cA);
    const lenC = _dirC.length();
    if (lenC > 1e-9) _dirC.divideScalar(lenC);
    _qC.setFromUnitVectors(_upY, lenC > 1e-9 ? _dirC : _upY);
    const crMid = ((hA[0] + hA[1] + hA[2]) + (hB[0] + hB[1] + hB[2])) / 6;
    // The capsule wears the colour of the joint that MOVES it — the parent, at its head —
    // which is the same colour the weight preview paints onto the vertices it claims. (The
    // radius still belongs to this joint; ownership and authorship are different things.)
    // Highlighting brightens rather than recolours, so the capsule-to-vertex colour match is
    // never broken by preselection.
    const capColor = Skeleton.boneColor(main, parent);
    // The base is a setting now, not a constant -- see Skeleton.capsuleOpacity. Highlighting
    // still brightens by about the same ratio it always did, and is capped so a fully opaque
    // capsule cannot be asked for more than solid.
    const capBase = Skeleton.capsuleOpacity();
    const capOp = (isHi || isSel) ? Math.min(1, capBase * 2.125) : capBase;
    for (const o of [e.cap.shaft.solid, e.cap.shaft.ghost]) {
      o.position.copy(_cA).addScaledVector(_dirC, lenC * 0.5); // cylinder is centre-origin
      o.quaternion.copy(_qC);
      // The radii go to the shader, not into the scale -- see taperMaterialInstanced. x/z stay
      // at 1, and the rotation the taper needs is read back off the instance matrix rather than
      // sent, since this scale keeps it recoverable.
      // COPIED, NOT REFERENCED. `hA` and `hB` are module scratch arrays reused for every bone,
      // and the flush reads them once at the end of the pass -- so storing the reference gave
      // every capsule in the rig the LAST bone's extents. matt: "the tapering isn't working
      // correctly; if i have a large joint connected to a small one, it seems to flare bigger
      // towards the small joint instead of the reverse." That is what one shared pair of extents
      // looks like: every shaft wearing somebody else's taper.
      o._ha = o._ha || [0, 0, 0];
      o._hb = o._hb || [0, 0, 0];
      o._ha[0] = hA[0] * SHAFT_INSET; o._ha[1] = hA[1] * SHAFT_INSET; o._ha[2] = hA[2] * SHAFT_INSET;
      o._hb[0] = hB[0] * SHAFT_INSET; o._hb[1] = hB[1] * SHAFT_INSET; o._hb[2] = hB[2] * SHAFT_INSET;
      // The shaft spans two joints, so it carries both exponents and the shader blends them —
      // a boxy palm running into a round finger tapers in sharpness as well as in size.
      o._pa = Skeleton.jointRound(parent); o._pb = Skeleton.jointRound(j);
      o.scale.set(1, lenC, 1);
      o.visible = true;
      o._hi = !!(isHi || isSel);
      o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
    }
    // The end caps are world-axis aligned — no rotation on them — so the three extents go
    // straight into the scale.
    for (const [part, at, ph, k, pj] of [[e.cap.a, _cA, hA, HEAD_INSET, parent],
                                        [e.cap.b, _cB, hB, 1, j]]) {
      for (const o of [part.solid, part.ghost]) {
        o.position.copy(at);
        o.scale.set(ph[0] * k, ph[1] * k, ph[2] * k);
        // A cap belongs to ONE joint, so it takes that joint's sharpness rather than a blend.
        o._p = Skeleton.jointRound(pj);
        o.visible = true;
        // Which of the two batches this end belongs to this frame. The opacity that used to
        // carry the preselection cannot ride on an instance, so it rides on the batch.
        o._hi = !!(isHi || isSel);
        o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
      }
    }
    for (const part of [e.cap.shaft, e.cap.a, e.cap.b]) {
      part.solid.material.color.copy(capColor);
      part.ghost.material.color.copy(capColor);
      // Opacity is batch state now (see tuneCapsuleBatches); recorded here and ignored, so this
      // placement code does not have to know which of the two it is.
      part.solid.material.opacity = capOp;
      part.ghost.material.opacity = capOp * 0.55;
    }
  }


  // THE JOINT HANDLES, on the selected joint and only in Tweak Joint mode. They are an editing
  // instrument rather than a display layer: drawn all the time they would bury the rig, and
  // drawn on every joint they would make it unpickable.
  {
    const scaling = main.getSculptManager?.()?.getCurrentTool?.()?.modeKey?.() === 'joint';
    const sel = scaling ? (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)) : [];
    const on = sel.length === 1 ? sel[0] : null;
    if (on) Skeleton.updateScaleHandles(main, on, Skeleton.boneRadiusOf(main, on));
    else if (main._jointHandles) {
      main._jointHandles.group.visible = false;
      main._jointHandles.joint = null;
    }
  }

  for (const id of Array.from(main._skelVis.keys())) if (!live.has(id)) disposeEntry(main, id);

  // LAST, after every slot has been written and after the dead entries are gone: the instanced
  // buffers are built from whatever is live at this moment, so flushing earlier would publish a
  // joint that is about to be removed.
  tuneCapsuleBatches(main);
  flushBatches(main);
};

// Preview bone: parent joint (or a free-floating marker) to the live controller tip, so
// you always see the bone you are about to commit before you commit it.
Skeleton.showPreview = function (main, fromPos, toPos, hot) {
  const g = skelGroup(main);
  if (!main._skelPreview) {
    const p = makePair(boneGeometry(), 0xffffff);
    p.solid.material.transparent = true; p.solid.material.opacity = 0.45;
    p.solid.material.depthWrite = false;
    const d = makePair(jointGeometry(), JOINT_COLOR);
    d.solid.material.transparent = true; d.solid.material.opacity = 0.8;
    // THE CURSOR SAYS WHICH WAY THE SNAP PLANE FACES.
    //
    // A sphere is the same from every direction, which is exactly the information the cursor
    // needed to carry: with the snap plane on, the one thing you want to know is which way it
    // lies and whether you are on it. matt: "its generally unclear how to drag to stay on the
    // symmetry plane... rather than drawing a sphere under the cursor, draw a disk, that way its
    // clear which direction the symmetry plane lies."
    //
    // A disc lying IN the plane answers both at once: face-on it is a circle, edge-on it is a
    // line, and every angle between reads as the tilt of the plane you are drawing against.
    // DoubleSide because you can be on either side of it, and it is drawn after the plane fill so
    // it stays legible over it.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({
      color: PLANE_COLOR, side: THREE.DoubleSide,
      transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, toneMapped: false,
    }));
    disc.isPickable = false;
    disc.frustumCulled = false;
    disc.renderOrder = 9998;   // over the plane fill (9997), under the panels
    g.add(p.solid, p.ghost, d.solid, d.ghost, disc);
    main._skelPreview = { bone: p, dot: d, disc: disc };
  }
  const pv = main._skelPreview;
  const jr = Skeleton.sceneUnit(main) * JOINT_R_FRAC;

  // The cursor says which of two things the next trigger will do. Continuing a chain draws it
  // full size in the joint colour, at the end of the preview bone; with no chain in progress
  // it is a smaller blue dot — a place to START one. Without that difference, ending a chain
  // looks exactly like not having ended it, and the only other signal is a log line that is
  // hidden by default.
  const rooting = !fromPos;

  // THE DISC REPLACES THE DOT WHILE THE SNAP IS ABOUT TO FIRE, rather than joining it: two
  // markers on one point is two things to read, and the dot is the one carrying less -- a sphere
  // says where, which the disc says too, and says the orientation as well.
  //
  // `hot` IS THE GATE, not the plane's existence. With the plane merely switched on the disc sat
  // under the cursor everywhere in the scene, which says "you are snapping" at every point where
  // you are not. matt: "it should only be active when the symmetry plane snapping is going to be
  // active, ie when the symmetry plane itself highlights." So the cursor and the plane highlight
  // now answer to the same fact -- inside the snap band -- and cannot disagree about it.
  const snapPlane = hot && Skeleton.displayFlag('snapPlane') ? Skeleton.symmetryPlane(main) : null;
  const disc = pv.disc;
  if (disc) {
    disc.visible = !!snapPlane;
    if (snapPlane) {
      disc.position.copy(toPos);
      // Lying IN the plane: CircleGeometry is built in XY with a +Z normal, the same frame the
      // plane fill is built in, so it takes the same rotation. See updatePlane.
      disc.quaternion.setFromUnitVectors(_zAxis, snapPlane.normal);
      // A FIXED SIZE IN THE ROOM, NOT IN THE MODEL. Everything else the rig draws is scaled by
      // sceneUnit, which is right for a marker that has to match the bones and wrong for one you
      // are meant to spot: on a small sculpt it would be a speck. matt asked for "a 2cm diameter
      // disc", so 1cm of radius, divided back out through the world group's scale -- the rig is
      // drawn inside a scaled group, so a constant there is not a constant in the room.
      const ws = g.getWorldScale(_sTmp);
      const unit = Math.abs(ws.x) > 1e-9 ? ws.x : 1;
      disc.scale.setScalar(DISC_RADIUS_M / unit);
      disc.updateMatrix(); disc.matrixWorldNeedsUpdate = true;
    }
  }

  for (const o of [pv.dot.solid, pv.dot.ghost]) {
    o.position.copy(toPos);
    o.scale.setScalar(rooting ? jr * 0.6 : jr);
    o.material.color.setHex(rooting ? PLANE_COLOR : JOINT_COLOR);
    o.visible = !snapPlane;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }

  if (!fromPos) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _dir.subVectors(toPos, fromPos);
  const len = _dir.length();
  if (len < 1e-6) { pv.bone.solid.visible = pv.bone.ghost.visible = false; return; }
  _q.setFromUnitVectors(_up, _dir.divideScalar(len));
  const w = boneWidth(len);
  for (const o of [pv.bone.solid, pv.bone.ghost]) {
    o.position.copy(fromPos); o.quaternion.copy(_q); o.scale.set(w, len, w); o.visible = true;
    o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
  }
};

Skeleton.hidePreview = function (main) {
  const pv = main._skelPreview;
  if (!pv) return;
  for (const o of [pv.bone.solid, pv.bone.ghost, pv.dot.solid, pv.dot.ghost]) o.visible = false;
  if (pv.disc) pv.disc.visible = false;
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
    // A RESET CLEARS THE JOINT SIZES TOO. Leaving them would make the button a half-reset: the
    // bones go back to a proportion of their length and the sized joints stay whatever they
    // were, so the rig comes back neither reset nor as it was.
    j._jointRadius = 0;
  }
};

// Radii of every joint, for undo. Small (one float per joint), so snapshotting all of them
// is simpler and safer than tracking which ones an edit touched.
Skeleton.captureRadii = function (main) {
  return Skeleton.joints(main).map((j) => [j, j._boneRadius || 0, j._jointRadius || 0]);
};

Skeleton.restoreRadii = function (snapshot) {
  // The joint size rides along, so one undo of Reset Radii puts back both halves of what it
  // changed. Third element absent means an older snapshot: leave the joint alone.
  for (const [j, r, jr] of snapshot) {
    j._boneRadius = r;
    if (jr !== undefined) j._jointRadius = jr > 0 ? jr : 0;
  }
};

// The same for a JOINT's own radius. Separate because 0 means something here — "unset, follow
// the bone" — and an undo has to be able to put a joint back to never having been sized.
Skeleton.restoreJointRadii = function (snapshot) {
  for (const [j, r] of snapshot) j._jointRadius = r > 0 ? r : 0;
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

// The rig's mirror plane whether or not the current selection is allowed in-stroke symmetry.
// Selecting a weight capsule turns getSymmetry() off (its mirror is another mesh, so an
// in-stroke mirror is wrong) -- and the stroke-end mirror that DOES handle it still needs the
// plane, so it asks here rather than through the gate that is switched off for its sake.
// SHOULD A RIG EDIT MIRROR? One answer, asked by everything that mirrors as a SIDE EFFECT.
//
// Two different rules were in use. Anything reaching for `symmetryPlane` respected the symmetry
// toggle for free, because that returns null when it is off. Anything that mirrored off
// `_boneMirror` merely EXISTING did not — and a joint drawn with symmetry on carries a twin for
// the rest of its life, so those operations hit both sides forever after, whatever the toggle
// said. matt: "really important to have that as an option whenever we have implied symmetrical
// behavior, eg turning on physics bones, right now i don't think i can do that asymmetrically."
//
// `getSymmetryFlag` rather than `getSymmetry`: the latter answers no while a weight cage is
// selected, which is a rule about in-stroke sculpting and has nothing to say about whether the
// user wants their rig edits mirrored.
//
// NOT for operations the user asked for BY NAME. Mirror Pose and Copy Side are requests to
// mirror; gating those on a toggle would make a button refuse to do the one thing it is called.
// This is for the side effects — flagging physics, splitting a bone — where the second half
// happens without being asked.
Skeleton.mirrorEdits = function (main) {
  return !!(main && main.getSculptManager && main.getSculptManager()
    && main.getSculptManager().getSymmetryFlag
    && main.getSculptManager().getSymmetryFlag());
};

Skeleton.rigMirrorPlane = function (main) {
  if (!main.getSculptManager || !main.getSculptManager().getSymmetryFlag?.()) return null;
  return Skeleton._computeSymmetryPlane(main, true);
};

Skeleton._computeSymmetryPlane = function (main, force) {
  if (!force && (!main.getSculptManager || !main.getSculptManager().getSymmetry())) return null;
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
Skeleton.updatePlane = function (main, plane, hot, at) {
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
  _q.setFromUnitVectors(_zAxis, plane.normal);

  // THE PLANE GROWS TO CONTAIN WHAT YOU ARE DRAWING, and stands ON the ground rather than
  // straddling it.
  //
  // It was a fixed square centred on the origin, which is the wrong shape for the job: drawing a
  // spine upward from the hips left the cursor outside it within a few joints, and half of it
  // was always buried under the floor. matt: "if i'm drawing from there up to the head, its
  // always too small... it should default to always grow and be 10% larger than where the draw
  // cursor is, and if the groundplane is visible, start with the base of it on the groundplane."
  //
  // 10% clear of the cursor, measured along the plane's OWN axes so it holds however the plane
  // is oriented; the old size stays as a floor so it never shrinks to a sliver near the origin.
  const unit = Skeleton.sceneUnit(main);
  const floor = unit * 2.6;
  _vRight.set(1, 0, 0).applyQuaternion(_q);
  _vUp.set(0, 1, 0).applyQuaternion(_q);
  let w = floor, h = floor, lift = 0;
  if (at) {
    _vRel.copy(at).sub(plane.origin);
    w = Math.max(floor, Math.abs(_vRel.dot(_vRight)) * 2.2);
    h = Math.max(floor, Math.abs(_vRel.dot(_vUp)) * 2.2);
  }

  // ON the ground, not through it: the base is pinned to the grid and the plane grows upward
  // from there. Only when the plane's own up really is up — a plane lying flat has no base to
  // stand on and is left centred.
  const grid = main._showGrid && main._groundGrid ? main._groundGrid : null;
  if (grid && Math.abs(_vUp.y) > 0.7) {
    const sign = _vUp.y > 0 ? 1 : -1;
    const base = grid.position.y;
    const top = Math.max(base + floor, at ? at.y + Math.abs(at.y - base) * 0.1 : plane.origin.y + h * 0.5);
    h = Math.max(floor, top - base);
    // How far the centre has to move along the plane's own up to put its base on the grid.
    lift = sign * ((base + h * 0.5) - plane.origin.y);
  }

  for (const o of [v.fill, v.edge]) {
    o.position.copy(plane.origin).addScaledVector(_vUp, lift);
    o.quaternion.copy(_q);
    o.scale.set(w, h, 1);
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
// THE MIRRORED TRANSFORM OF A JOINT, in model space: P M P, where P is the reflection through
// the symmetry plane. Position, rotation and scale all at once -- a reflection conjugated onto
// a transform is still a rigid transform, and it is the ONE right answer rather than a guess.
//
// Extracted from mirrorPose so the live drag can use it too. The FK/Tweak drag mirrored only
// POSITION to the twin, with a comment explaining that "a mirrored rotation is not the same
// rotation, and guessing which reflection was meant is how a symmetric rig comes back
// asymmetric" -- true, but by then mirrorPose already knew which reflection was meant, a few
// hundred lines away. matt: "tweak fk for bones mirror position but not rotation."
Skeleton.mirrorModelMatrix = function (joint, plane, out) {
  reflectionMatrix(plane, _mMirror);
  _mSrc.fromArray(joint.getModelSpaceMatrix());
  return out.multiplyMatrices(_mMirror, _mSrc).multiply(_mMirror);
};

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
  const mirrorOf = (j) => Skeleton.mirrorModelMatrix(j, plane, new THREE.Matrix4());

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
      mode: (j._boneIKPin | 0) & 7,
      // MIRRORED WITH THE MODE. A planted left foot mirrored to the right is still planted —
      // the flag is part of what "this pin" means, and dropping it would give the twin a pin
      // that sinks through the floor while its source does not.
      above: !!pin._pinAboveGround,
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
    pin._pinAboveGround = was.above;
    dst._boneIKPin = was.mode | (was.above ? 8 : 0);
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
const SKEL_VERSION = 18;  // v18 the LIGHT parameters — type, colour, intensity, range, cone, and the whole shadow group; without it a saved light reloaded as a plain sphere; v17 the three physics params added after v14 -- mass, substeps, iterations; v16 the SHADOW flags — which meshes catch the cast shadow, and which one IS the light (see render/SceneShadow.js); v3 adds the IK pin link per entry; v4 the selection lock; v5 the rest pose; v6 cages + hidden; v7 joint volumes (removed, section kept); v8 joint radii; v9 joint scale; v10 joint offset; v11 physics bones; v12 the BOUND LEVEL of each skin; v13 joint roundness (the squircle exponent); v14 the physics params v11 forgot, plus self-collision; v15 the node CONSTRAINTS — aim target, saccades (amp/speed/smooth), mirror-X
// The pin mode as packed into the SKEL `bone` word: two low bits at 1, and since PIN_ROT the
// third bit at 4 — bit 3 belongs to the selection lock and could not be borrowed. Written once
// so the two readers below cannot drift apart, which is exactly how a bitfield goes wrong.
function pinModeOf(bone) { return ((bone >> 1) & 3) | ((bone >> 2) & 4); }
// The flag half of the same field, read separately because it is not part of the mode and must
// not be folded into it — see the serialize note on bit 7.
function pinAboveGroundOf(bone) { return (bone & 128) ? 8 : 0; }

const NONE = 0xffffffff;
const INFLUENCES = 4;

// `main` is needed for the v15 constraint section: the mirror state lives on the SCENE
// (Scene._mirrors), not on the mesh, so there is nowhere else to read it from.
Skeleton.serialize = function (meshes, main) {
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
    // A HIDDEN MESH ALSO EARNS A ROW. Visibility is not in the SGL format at all, so anything
    // hidden came back visible on load — and for a baked capsule that was half the problem:
    // hidden when saved, visible on reload. matt: "i had capsules hidden, saved, reloaded, they
    // were visible, and i couldn't hide them again."
    // NEVER FOR A JOINT. A joint locator paints nothing by MATERIAL, never by `visible`, because
    // three skips a hidden object's entire subtree and a joint has capsules and cages parented
    // under it — the fault that cost six versions to find. Saving a joint as "hidden" would
    // reintroduce it through the loader, so the bit is only ever written for other meshes.
    const hidden = !m._isBone && m.isVisible ? !m.isVisible() : false;
    // A SHADOW CATCHER OR THE SHADOW LIGHT EARNS A ROW TOO. Both are ordinary meshes carrying one
    // extra boolean, and neither is necessarily parented, a bone, locked or hidden — so without
    // this the flag has nowhere to be written and a saved scene comes back with the proxy an
    // ordinary solid and no light at all. matt: "it doesn't seem to be restoring properly, and I
    // had to make another shadowcaster light."
    const shadow = !!(m._isShadowCatcher || m._isShadowLight);
    // A LIGHT EARNS A ROW TOO, for exactly the reason the shadow flags above do. A light is
    // typically unparented, unlocked, visible and not a bone, so it fell through this guard and
    // got no entry at all -- and with no entry there is nothing for the v18 light section to
    // refer to, so every light's settings were dropped on save however carefully v18 wrote
    // them. matt: "lights aren't being saved/loaded properly to sxr".
    const light = !!m._isLight;
    if (!parented && !m._isBone && !m._selectLocked && !hidden && !shadow && !light) return;
    entries.push({
      i: i,
      p: parented ? idxOf(p) : NONE,
      // Bit 0 = is a joint, bits 1-2 = IK pin mode (0 none, 1 position, 2 position+rotation).
      // The pin rides in spare bits of a field that was already a 32-bit word holding a single
      // boolean, so pins persist with NO version bump: an older build reads the whole word as
      // truthy and still sees a bone, and a v1/v2 file read here simply has the pin bits clear.
      // Bit 3 (v4) = selection lock. Same field, next spare bit — see the note above.
      // Bit 4 (v5) = the pin mode's THIRD bit. PIN_ROT is 4, which no longer fits the two bits
      // the mode started in, and bit 3 was already spoken for — so the high bit sits above the
      // lock rather than beside its own low bits. An older build reads the low two bits alone
      // and sees a rotation-only pin as unpinned, which is the right way for it to fail: it
      // cannot honour the mode, and a pin it cannot honour is better absent than mistaken for
      // a position pin that would drag the joint somewhere.
      // Bit 5 (v6) = THIS IS A BAKED WEIGHT CAPSULE. Nothing else in the file says so, and
      // without it a reloaded cage is an ordinary mesh: WeightCage.cages() finds none, so the
      // Capsules button cannot hide them, the drawn capsules come back over the top of them,
      // and a Rebind quietly falls back to the parametric shapes. The JOINT it speaks for needs
      // no field of its own — a cage is parented to exactly that joint, and `p` already carries
      // the link.
      // Bit 6 (v6) = hidden. See the note on the entry filter above.
      // Bit 7 (v7) = KEEP ABOVE GROUND. A pin FLAG, not a mode — it composes with all four
      // modes, so it could not take a value in the mode field (see IKSolver.PIN_ABOVE_GROUND).
      // Appended at the top of the word like every flag before it, so a file written by this
      // build still reads correctly in an older one: the bit is simply ignored there and the pin
      // comes back with its mode intact and the clamp off, which is the pre-feature behaviour.
      // Bit 8 (v16) = THIS MESH CATCHES THE CAST SHADOW — it wears the shadow material and is
      // otherwise invisible. Bit 9 (v16) = THIS MESH IS THE SHADOW LIGHT. Both are appended above
      // every existing flag for the same reason each of those was: an older build reads neither
      // bit, and gets the proxy back as an ordinary object and the light back as an ordinary
      // null, which is exactly the pre-feature scene rather than a broken one.
      bone: (m._isBone ? 1 : 0) | (((m._boneIKPin | 0) & 3) << 1) | (m._selectLocked ? 8 : 0)
        | (((m._boneIKPin | 0) & 4) << 2)
        | (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0)
        | (((m._boneIKPin | 0) & 8) ? 128 : 0)
        | (m._isShadowCatcher ? 256 : 0) | (m._isShadowLight ? 512 : 0),
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
    // WHICH RESOLUTION THE WEIGHTS BELONG TO (v12). A weight map is indexed by vertex, so it
    // is only meaningful for one level of the stack -- and nothing said which. The loader
    // compared the saved count against `mesh.getNbVertices()`, which on a Multimesh reports
    // the DISPLAYED level, so a character bound at the base cage and saved while subdivided
    // failed that check and came back unbound. matt: "i loaded a character i skinned and
    // weighted earlier, it isn't bound to the mesh."
    const lvl = m._meshes && m._meshes.length
      ? Math.max(0, m._meshes.indexOf(m._skinLevelMesh || m._meshes[m._skinLevel | 0]))
      : 0;
    skins.push({ i: i, j: jIdx, nbV: nbV, lvl: lvl, mesh: m });
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

  // v7: JOINT VOLUMES. They lived only in memory, so a rig saved with a pelvis dome and a
  // ribcage egg came back as bare capsules — and every downstream feature (the cage bake, Make
  // Skin, the mirroring) quietly fell back with it. Written as their own section after the
  // rests, so an older reader stops where it always did.
  //
  // The three numbers are optional: unset means "fit to the rig", which is a different state
  // from "set to whatever the fit last returned" — the first tracks the skeleton as it changes
  // and the second does not. A flag word carries that distinction rather than a sentinel value.
  // v8: A JOINT'S OWN RADIUS, where it has been set. Not folded into the per-entry radius above:
  // that one belongs to the BONE (a bone reads its child's), and a joint that has been sized by
  // hand is a different fact from the bone that happens to end there. Only joints that carry one
  // are written, so a rig that has never been sized costs a single zero.
  const rads = [];
  meshes.forEach((m, i) => {
    if (m && m._isBone && m._jointRadius > 0) rads.push({ i: i, r: m._jointRadius });
  });

  // v9: the joint's per-axis scale, where it is not round. Only the joints that carry one, so a
  // rig that has never been squashed costs a single zero.
  const scales = [];
  meshes.forEach((m, i) => {
    if (m && m._isBone && Skeleton.jointScaleIsSet(m)) scales.push({ i: i, s: m._jointScale });
  });

  // v11: physics-bone roots and their three parameters. A flagged joint is a property of the
  // RIG, not of the take — the take is what a bake turns it into — so it belongs here rather
  // than in the animation data.
  const phys = [];
  meshes.forEach((m, i) => {
    if (!m || !m._isBone || !m._physicsRoot) return;
    const p = m._physicsParams || {};
    phys.push({ i: i, s: p.stiffness, d: p.damping, g: p.gravity });
  });

  // v14: THE OTHER FIVE PHYSICS PARAMETERS, PLUS COLLIDE.
  //
  // v11 saved stiffness, damping and gravity — and PhysicsBones.DEFAULTS has eight. So `drag`,
  // `ground`, `groundY`, `inertia` and `maxBend` have been silently dropped on every save since
  // physics bones shipped, and come back as defaults: tune a tail's bend limit or tick Ground,
  // reload, and both are quietly gone. That is a pre-existing bug, not something self-collision
  // introduced; this section is where it gets fixed, because the new flag needed a home anyway.
  //
  // ITS OWN SECTION rather than five more floats on the v11 one, which is the rule the joint
  // offset and roundness sections already follow: a file written here still loads on a build
  // that stops at v13 (it reads the v11 triple and ignores the rest), and a v11 file still loads
  // here (this section is absent and the defaults stand, exactly as today).
  // v15: THE NODE CONSTRAINTS — aim target, saccades and mirror-X.
  //
  // These are rig setup, not a take: they say what a node DOES, the same way a parent link or a
  // pin does, and every one of them already lives beside those in the panel's constraint row.
  // None of them was written to the file, so every reload meant rebuilding the eye rig by hand.
  // matt: "we're not saving the mirror x or eye saccades into the sxr, i have to rebuild it each
  // time."
  //
  // THE AIM TARGET IS AN INDEX, not an id, for the same reason `mir` and `pin` are: ids are
  // regenerated on load, so an id written to a file points at nothing (or worse, at something
  // else) when it comes back. Its own section, like every addition since v9, so a file written
  // here still loads on a build that stops at v14.
  const rig = [];
  meshes.forEach((m, i) => {
    if (!m) return;
    const aim = (m._lookAtTargetId != null)
      ? meshes.findIndex((x) => x && x.getID() === m._lookAtTargetId) : -1;
    const mirrored = !!(main && main.isMirrored && main.isMirrored(m.getID()));
    if (aim < 0 && !m._saccades && !mirrored) return;   // nothing to say about this node
    rig.push({ i: i, aim: aim >= 0 ? aim : NONE,
      sac: m._saccades ? 1 : 0,
      amp: m._saccadeAmp ?? 5, spd: m._saccadeSpeed ?? 1, smo: m._saccadeSmooth ?? 0,
      mir: mirrored ? 1 : 0 });
  });

  const phys2 = [];
  meshes.forEach((m, i) => {
    if (!m || !m._isBone || !m._physicsRoot) return;
    const p = m._physicsParams || {};
    phys2.push({ i: i, dr: p.drag, gr: p.ground ? 1 : 0, gy: p.groundY,
      it: p.inertia, mb: p.maxBend, co: p.collide ? 1 : 0 });
  });

  // v17: MASS, SUBSTEPS AND ITERATIONS -- the three DEFAULTS has grown since v14, and the exact
  // repeat of the bug v14 was written to fix. Every parameter added to PhysicsBones lands in
  // `_physicsParams` and works perfectly until you save, and then comes back as a default: the
  // note above says v11 dropped five for the same reason. These three are the ones that decide
  // how a chain FEELS -- mass is the axis stiffness cannot reach, and the solver counts are what
  // took it from ringing to controllable -- so a reload undoing them undoes the tuning session.
  //
  // Whoever adds the tenth parameter: add it HERE, in a new section, and check this list against
  // PhysicsBones.DEFAULTS. Its own section for the usual reason -- a v14 reader stops before it
  // and still gets everything it knows about, and a v14 file read here just leaves the defaults
  // standing.
  const phys3 = [];
  meshes.forEach((m, i) => {
    if (!m || !m._isBone || !m._physicsRoot) return;
    const p = m._physicsParams || {};
    phys3.push({ i: i, ms: p.mass, sb: p.substeps, it: p.iterations });
  });

  // v18: THE LIGHT PARAMETERS. A light is a locator (`_isLight` + `_isNull`), so the mesh
  // itself already round-trips through the ordinary path -- but every property that makes it a
  // LIGHT lived only in memory, and a saved scene came back with a plain sphere where the light
  // had been. Exactly the shape of the bug v11/v14/v17 kept repeating for PhysicsBones: the
  // feature works perfectly until you save.
  //
  // Whoever adds the next light property: add it HERE. The shadow group in particular has grown
  // three times in one session (near, bias, softness), and each one is a tuning decision the
  // user will not enjoy making twice.
  const lights = [];
  meshes.forEach((m, i) => {
    if (!m || !m._isLight) return;
    const c = m._lightColor || [1, 1, 1];
    lights.push({
      i: i,
      t: m._lightType || 0,
      r: c[0], g: c[1], b: c[2],
      inten: m._lightIntensity === undefined ? 1 : m._lightIntensity,
      range: m._lightRange === undefined ? 50 : m._lightRange,
      cone: m._lightConeDeg === undefined ? 35 : m._lightConeDeg,
      cast: (m._castShadow !== false) ? 1 : 0,
      shNear: m._shadowNear === undefined ? 0.01 : m._shadowNear,
      shBias: m._shadowNormalBias === undefined ? 0.15 : m._shadowNormalBias,
      shInt: m._shadowIntensity === undefined ? 1 : m._shadowIntensity,
      shRad: m._shadowRadius === undefined ? 4 : m._shadowRadius,
      shRes: m._shadowMapSize === undefined ? 512 : m._shadowMapSize,
      ref: m._lightRefDist === undefined ? 0 : m._lightRefDist,
    });
  });

  // v10: the joint's offset, where a face drag has moved its shape off it. Its own section
  // rather than three more floats on the v9 one, so a file written by a build that had scale and
  // not offset still reads.
  const offs = [];
  meshes.forEach((m, i) => {
    if (m && m._isBone && Skeleton.jointOffsetIsSet(m)) offs.push({ i: i, o: m._jointOffset });
  });

  // JOINT VOLUMES ARE GONE, and the section stays. Writing an empty one keeps the block at v7
  // so a reader that expects the section still finds it, and the reader below still SKIPS a
  // populated one — which is what lets a file saved when volumes existed keep loading.
  // v13: how boxy each joint is. Its own section for the same reason offset got one — a file
  // written before this existed still reads, and one written after still loads on a build that
  // stops at v12.
  const rounds = [];
  meshes.forEach((m, i) => {
    if (m && m._isBone && Skeleton.jointRoundIsSet(m)) rounds.push({ i: i, p: m._jointRound });
  });

  const vols = [];

  // ...OR IF ANY NODE CARRIES A CONSTRAINT. This block is skipped entirely when there is no
  // hierarchy and no skin, which was right when it only held bones — but v15 put the aim/saccade/
  // mirror state in here, and a scene can easily have an eye rig and no skeleton at all. Without
  // `rig` in this test that state was built, saved to nothing, and silently absent on reload.
  if (!entries.length && !skins.length && !rig.length) return null;

  let slots = 3 + entries.length * 6 + 1;
  for (const s of skins) {
    slots += 4 + s.j.length + s.nbV * INFLUENCES * 2 + s.nbV * 3 + s.j.length * 16;
  }
  slots += 1 + rests.length * 17;
  slots += 1 + vols.length * 12;
  slots += 1 + rads.length * 2;
  slots += 1 + scales.length * 4;
  slots += 1 + offs.length * 4;
  slots += 1 + rounds.length * 2;
  slots += 1 + phys.length * 4;
  slots += 1 + phys2.length * 7;   // v14: i + drag, ground, groundY, inertia, maxBend, collide
  slots += 1 + rig.length * 7;     // v15: i + aim, saccades, amp, speed, smooth, mirror
  slots += 1 + phys3.length * 4;   // v17: i + mass, substeps, iterations
  slots += 1 + lights.length * 14; // v18: i + type, rgb, intensity, range, cone, cast, 4 shadow, res

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
    u[o++] = s.i; u[o++] = s.j.length; u[o++] = s.nbV; u[o++] = s.lvl;
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

  u[o++] = vols.length;

  u[o++] = rads.length;
  for (const r of rads) { u[o++] = r.i; f[o++] = r.r; }

  u[o++] = scales.length;
  for (const sc of scales) { u[o++] = sc.i; f[o++] = sc.s[0]; f[o++] = sc.s[1]; f[o++] = sc.s[2]; }

  u[o++] = offs.length;
  for (const of_ of offs) { u[o++] = of_.i; f[o++] = of_.o[0]; f[o++] = of_.o[1]; f[o++] = of_.o[2]; }
  u[o++] = rounds.length;
  for (const rd of rounds) { u[o++] = rd.i; f[o++] = rd.p; }

  u[o++] = phys.length;
  for (const ph of phys) { u[o++] = ph.i; f[o++] = ph.s; f[o++] = ph.d; f[o++] = ph.g; }

  u[o++] = phys2.length;
  for (const ph of phys2) {
    u[o++] = ph.i; f[o++] = ph.dr; u[o++] = ph.gr; f[o++] = ph.gy;
    f[o++] = ph.it; f[o++] = ph.mb; u[o++] = ph.co;
  }

  u[o++] = rig.length;
  for (const r of rig) {
    u[o++] = r.i; u[o++] = r.aim; u[o++] = r.sac;
    f[o++] = r.amp; f[o++] = r.spd; f[o++] = r.smo; u[o++] = r.mir;
  }

  // Substeps and iterations are COUNTS, so they go through the u32 view; mass is a multiplier.
  u[o++] = phys3.length;
  for (const ph of phys3) { u[o++] = ph.i; f[o++] = ph.ms; u[o++] = ph.sb; u[o++] = ph.it; }

  u[o++] = lights.length;
  for (const li of lights) {
    u[o++] = li.i; u[o++] = li.t;
    f[o++] = li.r; f[o++] = li.g; f[o++] = li.b;
    f[o++] = li.inten; f[o++] = li.range; f[o++] = li.cone;
    u[o++] = li.cast;
    f[o++] = li.shNear; f[o++] = li.shBias; f[o++] = li.shInt; f[o++] = li.shRad;
    u[o++] = li.shRes;
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

    // v6: baked weight capsules, and visibility.
    if (ver >= 6) {
      for (const row of rows) {
        if (row.bone & 32) {
          row.mesh._isWeightCage = true;
          row.mesh._typeName = 'Cage';
          // The joint is the parent, which is the only place the link was ever stored.
          if (row.parent && row.parent.getID) row.mesh._cageJointId = row.parent.getID();
        }
        // ...AND NEVER APPLIED TO A JOINT, whatever the file says: `visible = false` on a joint
        // hides everything parented to it. The writer already refuses to set the bit for one;
        // this is the second half of that rule, so a hand-edited or future file cannot smuggle
        // it back in.
        if ((row.bone & 64) && !(row.bone & 1)) {
          // Both flags, the pair the outliner eye and the Capsules button set — one without the
          // other leaves a mesh that is hidden to half the app.
          row.mesh.setVisible?.(false);
          const tm = row.mesh.getThreeMesh?.();
          if (tm) tm.visible = false;
        }
      }
    }

    // v16: the shadow flags. Set on the mesh only — SceneShadow's per-frame sweep is what turns
    // the flag into a material, so there is nothing to rebuild here and no order to get wrong.
    if (ver >= 16) {
      for (const row of rows) {
        if (row.bone & 256) row.mesh._isShadowCatcher = true;
        if (row.bone & 512) {
          row.mesh._isShadowLight = true;
          row.mesh._typeName = 'Shadow Light';
        }
      }
    }

    // Restore the joint's own properties first — healGraph keys off _isBone, and the
    // no-draw material is not serialized (same caveat FrameGroup hits with its nulls).
    for (const row of rows) {
      if (!(row.bone & 1)) continue;
      const m = row.mesh;
      m._isBone = true;
      m._boneIKPin = pinModeOf(row.bone) | pinAboveGroundOf(row.bone);
      m._isNull = true;
      m.isPickable = false;
      m._boneRadius = row.r;
      m._typeName = m._typeName || 'Bone';
      main._skelAll = main._skelAll || new Set();
      main._skelAll.add(m);
      // By material, not by `visible` -- see noDrawMaterial. A loaded rig would otherwise
      // reintroduce the hidden-subtree bug for every joint in the file.
      const tm = m.getThreeMesh && m.getThreeMesh();
      if (tm) noDrawMaterial(tm);
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
      const mode = pinModeOf(row.bone);
      if (!mode) continue;
      const pinMesh = row.pin !== NONE ? meshes[row.pin] : null;
      pendingPins.push({ joint: row.mesh, mode: mode, pin: pinMesh || null,
        above: !!pinAboveGroundOf(row.bone) });
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
        const savedLvl = ver >= 12 ? u[o++] : NONE;
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

        // A weight map is indexed by vertex, so it is only valid for the exact LEVEL it was
        // built against. Refuse a mismatch rather than deforming with garbage indices -- but
        // measure the right level: `mesh.getNbVertices()` is the DISPLAYED one, and a mesh
        // bound at the base cage is normally saved subdivided, so that comparison threw away
        // every bind it was meant to protect.
        if (!mesh) { console.warn('[Skeleton] skin weights skipped: no mesh'); continue; }
        const stack = mesh._meshes && mesh._meshes.length ? mesh._meshes : null;
        let level = null;
        if (!stack) {
          level = mesh.getNbVertices() === nbV ? mesh : null;
        } else if (savedLvl !== NONE && savedLvl < stack.length
                   && stack[savedLvl].getNbVertices() === nbV) {
          level = stack[savedLvl];
        } else {
          // PRE-v12, OR A STACK THAT HAS CHANGED SHAPE. The level was never written, so find
          // it by the one thing that does identify it. Only when exactly one level matches:
          // two levels of equal size would be a coin toss, and binding to the wrong one
          // deforms with indices that address real vertices, which is far worse than refusing.
          const hits = stack.filter((l) => l.getNbVertices() === nbV);
          if (hits.length === 1) level = hits[0];
        }
        if (!level) {
          console.warn('[Skeleton] skin weights skipped: no level with %d vertices', nbV);
          continue;
        }
        const joints = jointIdx.map((ji) => (ji === NONE ? null : meshes[ji]));
        if (joints.some((j) => !j)) {
          console.warn('[Skeleton] skin weights skipped: missing joint');
          continue;
        }

        // Both, because boundLevel() prefers the object and keeps the index in step with it;
        // the index alone goes stale the moment a level is inserted or removed.
        mesh._skinLevelMesh = stack ? level : null;
        mesh._skinLevel = stack ? stack.indexOf(level) : 0;
        mesh._skinJoints = joints.map((j) => j.getID());
        mesh._skinIdx = idx;
        mesh._skinW = wts;
        mesh._skinInvBind = invBind;
        mesh._skinRest = rest;
        mesh._skinSrc = new Float32Array(rest);
        mesh._skinStampBuf = null;
        mesh._skinDirty = true; // re-skin on the first frame; the saved verts are a pose
        // A BOUND MESH USED TO COME BACK LOCKED for pre-v4 files, deriving what bind used to
        // set. Bind no longer locks -- the pick priority prefers a pin, then a joint, and
        // reaches the mesh only when neither is there -- so re-deriving it would hand an old
        // file a lock that a new one does not get. From v4 the lock is stored per mesh and has
        // already been applied above, which is the only place it should come from.
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

    // v7: joint volumes. The feature is gone, but a file saved while it existed still carries
    // the section, and the reader has to step over it or every field AFTER it — there are none
    // today, and there will be — reads from the wrong offset. Skipped by size, not by parsing.
    if (ver >= 7) {
      const vn = u[o++];
      o += vn * 12;
    }

    // v8: joint radii. THIS is the field that makes the skip above load-bearing — before it
    // there was nothing after the volumes, and a reader that forgot to step over them read
    // nothing wrong.
    if (ver >= 8) {
      const rn = u[o++];
      for (let i = 0; i < rn; i++) {
        const mi = u[o++];
        const r = f[o++];
        if (meshes[mi]) meshes[mi]._jointRadius = r;
      }
    }

    // v9: the joint's per-axis scale.
    if (ver >= 9) {
      const sn = u[o++];
      for (let i = 0; i < sn; i++) {
        const mi = u[o++];
        const sx = f[o++], sy = f[o++], sz = f[o++];
        if (meshes[mi]) Skeleton.setJointScale(meshes[mi], sx, sy, sz);
      }
    }

    // v10: the joint's offset.
    if (ver >= 10) {
      const on = u[o++];
      for (let i = 0; i < on; i++) {
        const mi = u[o++];
        const ox = f[o++], oy = f[o++], oz = f[o++];
        if (meshes[mi]) Skeleton.setJointOffset(meshes[mi], ox, oy, oz);
      }
    }

    // v13: the squircle exponent per joint. Read straight after v10's offsets, which is where it
    // is written — sections are positional, so its place in the stream is what identifies it.
    if (ver >= 13) {
      const rn = u[o++];
      for (let i = 0; i < rn; i++) {
        const mi = u[o++];
        const pw = f[o++];
        if (meshes[mi]) Skeleton.setJointRound(meshes[mi], pw);
      }
    }

    // v11: physics-bone roots and their parameters.
    if (ver >= 11) {
      const pn = u[o++];
      for (let i = 0; i < pn; i++) {
        const mi = u[o++];
        const st = f[o++], dp = f[o++], gr = f[o++];
        const m = meshes[mi];
        if (!m) continue;
        m._physicsRoot = true;
        m._physicsParams = { stiffness: st, damping: dp, gravity: gr };
      }
    }

    // v14: the five parameters v11 forgot, plus self-collision. MERGED into whatever v11 just
    // built rather than replacing it — the two sections describe the same joints and a v11 file
    // read here must keep the three values it does carry.
    if (ver >= 14) {
      const pn2 = u[o++];
      for (let i = 0; i < pn2; i++) {
        const mi = u[o++];
        const dr = f[o++], gr2 = u[o++], gy = f[o++], it = f[o++], mb = f[o++], co = u[o++];
        const m = meshes[mi];
        if (!m) continue;
        const cur = m._physicsParams || {};
        cur.drag = dr; cur.ground = !!gr2; cur.groundY = gy;
        cur.inertia = it; cur.maxBend = mb; cur.collide = !!co;
        m._physicsParams = cur;
      }
    }

    // v15: the node constraints. Restored BEFORE the pins are attached only because it reads
    // nothing they write; the ordering is not load-bearing either way.
    if (ver >= 15) {
      const rn = u[o++];
      for (let i = 0; i < rn; i++) {
        const mi = u[o++], aimIdx = u[o++], sac = u[o++];
        const amp = f[o++], spd = f[o++], smo = f[o++], mir = u[o++];
        const m = meshes[mi];
        if (!m) continue;
        // THE AIM TARGET COMES BACK THROUGH THE INDEX, then becomes a live id. Writing the id
        // itself would have pointed at whatever happened to own that number this session.
        if (aimIdx !== NONE && meshes[aimIdx]) m._lookAtTargetId = meshes[aimIdx].getID();
        if (sac) { m._saccades = true; m._saccadeAmp = amp; m._saccadeSpeed = spd; m._saccadeSmooth = smo; }
        // The mirror is a LIVE CLONE the scene owns, not a flag — so it has to be rebuilt
        // through the scene rather than assigned here. Guarded: a file can carry a mirror into
        // a build or context that has no such method.
        if (mir && main && main.mirrorMesh && !main.isMirrored?.(m.getID())) {
          try { main.mirrorMesh(m.getID()); }
          catch (e) { console.warn('[Skeleton] mirror restore failed for mesh', mi, e); }
        }
      }
    }

    // v17: merged onto whatever v11/v14 built, exactly as v14 merges onto v11.
    if (ver >= 17) {
      const pn3 = u[o++];
      for (let i = 0; i < pn3; i++) {
        const mi = u[o++];
        const ms = f[o++], sb = u[o++], it3 = u[o++];
        const m = meshes[mi];
        if (!m) continue;
        const cur = m._physicsParams || {};
        cur.mass = ms; cur.substeps = sb; cur.iterations = it3;
        m._physicsParams = cur;
      }
    }

    // v18: the light parameters. The flags go on first because decorateLight builds the gizmo
    // from them, and _lightRefDist is deliberately NOT restored -- it is the brightness
    // reference latched from the scene when the light was made, and a scene that has grown or
    // shrunk since wants the current one. _syncThreeLights recomputes it when it is missing.
    if (ver >= 18) {
      const ln = u[o++];
      for (let i = 0; i < ln; i++) {
        const mi = u[o++], t = u[o++];
        const r = f[o++], g = f[o++], b = f[o++];
        const inten = f[o++], range = f[o++], cone = f[o++];
        const cast = u[o++];
        const shNear = f[o++], shBias = f[o++], shInt = f[o++], shRad = f[o++];
        const shRes = u[o++];
        const m = meshes[mi];
        if (!m) continue;
        m._isLight = true;
        m._isNull = true;
        m._typeName = m._typeName || 'Light';
        m._lightType = t;
        m._lightColor = [r, g, b];
        m._lightIntensity = inten;
        m._lightRange = range;
        m._lightConeDeg = cone;
        m._castShadow = !!cast;
        m._shadowNear = shNear;
        m._shadowNormalBias = shBias;
        m._shadowIntensity = shInt;
        m._shadowRadius = shRad;
        m._shadowMapSize = shRes || 512;
        try { main.decorateLight && main.decorateLight(m); } catch (e) {
          console.error('[Skeleton] decorateLight on load failed', e);
        }
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
        // NON-DRAWING, the same as a pin made live. `Skeleton.makePin` ends by putting a
        // colorWrite-off material on the null and hiding its cruciform, because the skeleton pass
        // draws the triad and gimbal at this transform and the null's own pick sphere would be a
        // second marker in the same place. This path never did it, so a pin that came back from a
        // .sxr drew its pick sphere as a small solid ball on the rig — visible with every rig
        // display flag off, because no flag reaches the null underneath a pin. That is matt's
        // "phantom spheres/dots that seem to be related to pins or joints", and why they only
        // appeared on a LOADED file.
        const _pinTm = p.pin.getThreeMesh && p.pin.getThreeMesh();
        if (_pinTm) {
          noDrawMaterial(_pinTm);
          const _cross = _pinTm.children && _pinTm.children.find((c) => c.name === 'null_cruciform');
          if (_cross) _cross.visible = false;
        }
        p.joint._boneIKPinObj = p.pin;
        // THE LIVE STORE IS THE PIN OBJECT, so setting only `_boneIKPin` here would load a rig
        // whose file says "keep above ground" and whose session does not — the clamp would be
        // off until the user toggled it twice. `_pinMode` is set on the object for exactly the
        // same reason a few lines down; this is its flag half.
        p.pin._pinAboveGround = p.above;
        p.joint._boneIKPin = p.mode | (p.above ? 8 : 0);
      } else {
        // Pre-v3: only the mode survived, so a pin is made where the joint is standing.
        const made = Skeleton.makePin(main, p.joint, { reveal: false });
        if (made) {
          made._pinMode = p.mode;
          made._pinAboveGround = p.above;
          p.joint._boneIKPinObj = made;
          p.joint._boneIKPin = p.mode | (p.above ? 8 : 0);
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
  // The joint's NAME, drawn where the length is drawn — off by default for the same reason:
  // it is a label per bone, and a rig full of them is unreadable while you are working.
  names: ['_boneShowNames', 'boneShowNames', false],
  capsules: ['_boneShowCapsules', 'boneShowCapsules', false],
  // WHERE MAKE SKIN WILL ATTACH each bone, drawn on the joint boxes it will build from. Off by
  // default: it is a rig-time diagnostic for the case where a joint has more bones than its box
  // has room for, not something to have on while posing. See SkinPreview.
  skinClaims: ['_boneShowSkinClaims', 'boneShowSkinClaims', false],
  // Shaded by default: flat capsules read as one silhouette and you cannot tell a near limb from
  // a far one. The flat look stays a switch away.
  capsuleShaded: ['_boneCapsuleShaded', 'boneCapsuleShaded', true],
  weights: ['_boneShowWeights', 'boneShowWeights', false],
  solid: ['_boneShowSolid', 'boneShowSolid', true],
  wire: ['_boneShowWire', 'boneShowWire', true],
  // BACK AS A TOGGLE. The dots were removed when the bone became the pick target, and came
  // back when that was switched off — but they came back with no way to turn them off again,
  // which is worse than either state. Default TRUE because that is what ships: bone selection
  // is off, so the dot is the marker for the target. Turn bone selection on and this is the
  // switch that gets the screen quiet again.
  // A NEW KEY ON PURPOSE. `boneShowJoints` shipped defaulting FALSE for v3.20.66-.83 and then
  // had its toggle removed entirely, so anyone who ran those builds has a persisted `false`
  // they never chose and cannot reason about — matt: "the joint spheres disappeared, i couldn't
  // make them reappear." Renaming the key orphans that value, so the new default applies and
  // the toggle persists under a name whose history is clean.
  joints: ['_boneShowJoints', 'boneShowJointDots', true],
  pins: ['_boneShowPins', 'boneShowPins', true],
  // The path the selected joint takes over the timeline. Off by default: it costs a full
  // evaluation per sample, and it is an animation aid rather than something you want while
  // sculpting.
  trails: ['_boneShowTrails', 'boneShowTrails', false],
  // Axis triads at a motion path's keys. Separate from trails rather than folded into them: a
  // trail is often on for minutes at a time while you watch an arc, and a triad per key is a
  // lot of ink to carry through that when you are not editing rotation.
  gnomons: ['_boneShowGnomons', 'boneShowGnomons', false],
  // Every key's triad at full size, rather than only those near the playhead. The fade is the
  // better default -- it says where you are in the take -- but it hides the shape of the
  // rotation as a whole, which is the thing you want when judging a curve rather than editing
  // one key of it.
  gnomonsAll: ['_boneShowGnomonsAll', 'boneShowGnomonsAll', false],
  // THE HOVER OUTLINE ON ORDINARY MESHES -- the same yellow box the outliner draws, driven from
  // the viewport by the selection-style tools. A joint under the ray warms up and a mesh did
  // not, so with the rig hidden (the state in which meshes ARE what you reach for) there was no
  // preselection at all and you pressed on faith. matt: "maybe grab should also have an option
  // for those preselect highlights on meshes? that would make it more clear whats going on."
  //
  // DELIBERATELY NOT IN DECOR_FLAGS. Hiding all decorations is exactly the moment this matters
  // most -- it is the state where the rig stops being pickable and meshes take over -- so the
  // master switch that clears the rig off the screen must not take the mesh's own marker with
  // it. snapPlane/snapAxis sit outside that set for the same kind of reason.
  meshHover: ['_meshHoverHighlight', 'meshHoverHighlight', true],
};
Skeleton.DISPLAY_FLAGS = DISPLAY_FLAGS;
// Published for the outliner, which marks the same joints in its rows. Assigned here with the
// rest of the surface rather than beside the function, which is above where Skeleton exists.
Skeleton.physicsGoverned = physicsGoverned;
Skeleton.flushBatches = flushBatches;
Skeleton.clearBatches = clearBatches;

// Live value first, then the saved one, then the default — the same order every other
// persisted VR setting is read in, so a toggle takes effect on the current frame.
// ONE SWITCH OVER EVERYTHING DRAWN ON TOP OF THE MODEL, and it does not touch a single one of
// their own settings.
//
// The rig has a dozen display flags and the scene has a ground plane, and clearing the view to
// look at the actual shape meant turning them off one at a time and then trying to remember what
// had been on. matt: "an extra toggle to quickly enable/disable all decorations, so all joint
// displays, the ground plane, pins. so their local state can stay as is, but have a toggle to
// quickly disable/enable them all at once."
//
// IT GATES THE READ, NOT THE STORE, which is the whole trick: every flag keeps whatever it was
// set to, `displayFlag` simply answers no while this is on, and turning it off brings the exact
// arrangement back with nothing to remember or restore.
Skeleton.decorationsHidden = function () {
  const live = window._boneHideDecor;
  if (live != null) return !!live;
  const saved = getOptionsURL().boneHideDecor;
  return saved != null ? !!saved : false;
};

// A PIN YOU JUST MADE HAS TO BE ON SCREEN. matt: "if a pin is created, we should force pin
// display if its turned off."
//
// It is not only that it is invisible. `rigNodeVisible` in Picking makes a rig node pickable
// ONLY while something marking it is drawn -- "if all nodes are hidden, then they shouldn't be
// grabbable" -- so with the pin layer off a new pin is both unseeable and ungrabbable, and
// creating one looks like it silently failed.
//
// THE MASTER SWITCH GOES WITH IT, and that is a deliberate second step rather than an
// oversight: `displayFlag` answers no for every decoration while Hide All is on, so turning the
// pins flag on underneath it would change a stored value and nothing on screen. Forcing the one
// without the other is a fix that does not fix anything.
Skeleton.revealPins = function (main) {
  let changed = false;
  if (!Skeleton.displayFlagRaw('pins')) { Skeleton.setDisplayFlag('pins', true); changed = true; }
  if (Skeleton.decorationsHidden()) { Skeleton.setDecorationsHidden(main, false); changed = true; }
  // The panel's own toggles read these flags, so they have to be rebuilt or they go on showing
  // the old state -- the button would lie about what pressing it does.
  if (changed && main && main._boneSectionRebuild) {
    try { main._boneSectionRebuild(); } catch (_) {}
  }
  return changed;
};

Skeleton.setDecorationsHidden = function (main, on) {
  window._boneHideDecor = !!on;
  try { getOptionsURL.saveOption('boneHideDecor', !!on, 300); } catch (_) {}
  Skeleton.updateVisuals(main);
  main?.render?.();
  return !!on;
};

// WHICH FLAGS ARE DECORATION. Everything that DRAWS something; nothing that CHANGES what an edit
// does. `snapPlane` and `snapAxis` live in the same list and are behaviour — hiding the plane is
// one thing, silently switching snapping off while you draw is another, and a switch that did
// both would be lying about what it is for.
//
// WEIGHTS IS NOT DECORATION, and having it in here is why its toggle looked broken. Every other
// flag in this set draws something ON TOP of the model; the weight preview repaints the MESH'S
// OWN vertex colours. Gating it here meant that with Hide All Decorations on, `displayFlag`
// answered no while the button kept rendering from `displayFlagRaw` -- so the button lit up and
// nothing happened, and turning it back off also did nothing. adurna35: "Showing and hiding
// weights seems to work really spotty... It sometimes does nothing / work / work after a delay /
// invert the button." Two of those four are this line.
//
// It leaves for the same reason `meshHover` never joined: the master switch clears the rig off
// the screen, and it must not silently reach into how the mesh itself is shaded.
const DECOR_FLAGS = new Set(['lengths', 'names', 'capsules', 'capsuleShaded', 'solid',
  'wire', 'joints', 'pins', 'trails', 'gnomons', 'gnomonsAll', 'skinClaims']);

Skeleton.displayFlag = function (name) {
  const e = DISPLAY_FLAGS[name];
  if (!e) return false;
  if (DECOR_FLAGS.has(name) && Skeleton.decorationsHidden()) return false;
  const live = window[e[0]];
  if (live != null) return !!live;
  const saved = getOptionsURL()[e[1]];
  return saved != null ? !!saved : e[2];
};

// The flag's OWN value, ignoring the master switch — for the panels, so a toggle still shows what
// it is set to while decorations are hidden. A button that reads as off because something else is
// off is a button that lies about what pressing it will do.
Skeleton.displayFlagRaw = function (name) {
  const e = DISPLAY_FLAGS[name];
  if (!e) return false;
  const live = window[e[0]];
  if (live != null) return !!live;
  const saved = getOptionsURL()[e[1]];
  return saved != null ? !!saved : e[2];
};

// Live value first, then the saved one, then the default -- the same order Skeleton.displayFlag
// reads in, so a drag takes effect on the current frame and a reload still restores it.
Skeleton.capsuleOpacity = function () {
  const live = window._boneCapsuleOpacity;
  if (typeof live === 'number') return live;
  const saved = getOptionsURL().boneCapsuleOpacity;
  return typeof saved === 'number' ? saved : 0.16;
};
// Published here rather than at the definitions above, which run before `Skeleton` exists.
Skeleton.capsuleSegments = capsuleSegments;
Skeleton.setCapsuleSegments = setCapsuleSegments;

Skeleton.setCapsuleOpacity = function (main, v) {
  const clamped = Math.max(0.05, Math.min(1, v));
  window._boneCapsuleOpacity = clamped;
  try { getOptionsURL.saveOption('boneCapsuleOpacity', clamped, 300); } catch (_) {}
  if (main) Skeleton.updateVisuals(main);
  return clamped;
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
