import { vec3, mat4 } from 'gl-matrix';
import Geometry from './Geometry.js';
import PosedSymmetry from '../editing/PosedSymmetry.js';
import Tablet from '../misc/Tablet.js';
import Utils from '../misc/Utils.js';
import TR from '../gui/GuiTR.js';

var _TMP_NEAR = [0.0, 0.0, 0.0];
var _TMP_SYMOFF = [0.0, 0.0, 0.0];
var _TMP_NEAR_1 = [0.0, 0.0, 0.0];
var _TMP_FAR = [0.0, 0.0, 0.0];
var _TMP_FAR_1 = [0.0, 0.0, 0.0];
var _TMP_INV = mat4.create();
var _TMP_MS = mat4.create(); // model-space (worldGroup-relative) mesh matrix
var _TMP_INTER = [0.0, 0.0, 0.0];
var _TMP_INTER_1 = [0.0, 0.0, 0.0];
var _TMP_INTER_RIG = [0.0, 0.0, 0.0];
var _TMP_RIG_P = [0.0, 0.0, 0.0], _TMP_RIG_D = [0.0, 0.0, 0.0];
var _TMP_RIG_W = [0.0, 0.0, 0.0], _TMP_RIG_C = [0.0, 0.0, 0.0];
var _TMP_SEG_A = [0.0, 0.0, 0.0], _TMP_SEG_E = [0.0, 0.0, 0.0];
var _TMP_SEG_R = [0.0, 0.0, 0.0], _TMP_SEG_Q = [0.0, 0.0, 0.0];
var _TMP_SEG_P = [0.0, 0.0, 0.0];
var _TMP_SEG_MS = mat4.create();
// Filled by the two segment helpers below, read immediately after. Two numbers rather than an
// allocated result object: these run once per joint per pick, and a pick runs on every hover.
var _segT = 0.0;   // parameter ALONG THE RAY at closest approach (the desktop helper only)
var _segS = 0.0;   // parameter along the segment, 0 at the head and 1 at the tip

// BONE SELECTION IS OPT-IN, AND OFF.
//
// Making the capsule pick surface was a good idea that I could not test. It went in over five
// versions, and every one of them had to re-balance it against the pins that sit on the joints
// at its ends — because a bone segment and the pin on its end occupy the SAME PLACE, so every
// rule that separated them was a tuning constant rather than a fact. matt, on v3.20.77: "still
// fucked. getting annoyed now." Four rounds of my adjusting margins is four rounds too many to
// spend on a tool someone is trying to work with.
//
// So the whole of it — the segments, the zone-relative scores, the marker-sized zones, the
// control-beats-joint rule — is behind one switch, and the switch is OFF. What runs by default
// is exactly what ran in v3.20.65: rig nodes picked as POINTS in a cone, compared in raw
// units. Known to work, because it did.
//
//   window._rigBoneSelect = true    turn it back on, no rebuild
//
// Skeleton reads the same flag and brings the joint dots back when it is off, because the dots
// were only removed on the grounds that the bone had replaced them as the target.
//
// BACK ON BY DEFAULT, 2026-08-28. It was switched off after four rounds of margin-tuning, and
// what actually fixed that was `rigWinner` below — two distances and one ratio, rather than a
// margin per case. With that in place the segments are a preference the pin can beat, not a
// competitor, which is the shape the note above says the problem needed.
//
// Turning it back on is also what makes SPLIT legible: matt, "the intuition is to select a
// bone which somehow got disabled a few versions ago." Splitting a thing you cannot point at
// is a menu item that acts on something invisible.
//
//   window._rigBoneSelect = false   force it off everywhere, no rebuild
//   window._rigBoneSelect = true    force it on everywhere
//
// FOLLOWS THE TOOL BY DEFAULT: on in the BONE tool, off everywhere else.
//
// Bone selection is needed by Split, which has to know which bone you are pointing at — and it
// is actively harmful in Grab. Grab's generic pick runs with includeRig, so a pickable bone
// capsule is something it will happily TAKE; capsules are large and easy to hit, so with bone
// select on globally the right hand kept grabbing a bone instead of the pin it was aimed at.
// That held mesh then short-circuits the pin path on its first line, and the hand goes dead.
//
// matt found this the hard way twice — the first time it was the reason bone select was
// reverted wholesale, the second time `window._rigBoneSelect = false` fixed a lock-up on the
// spot. His conclusion, and it is the right one: "keep dissolve and split in the marking menu
// only for the bones tool, not for grab."
//
// So the switch is per-tool rather than global, and the manual override still wins either way.
const BONE_SELECT = (main) => {
  if (window._rigBoneSelect === false) return false;
  if (window._rigBoneSelect === true) return true;
  const idx = main && main.getSculptManager && main.getSculptManager()
    ? main.getSculptManager().getToolIndex() : -1;
  return idx === BONE_DRAW_TOOL;
};
// Enums is not imported here and importing it for one number would drag the tool tables into
// the pick loop's module. The index is stable and asserted in rigpick_test.
const BONE_DRAW_TOOL = 34;

// WHICH ONE YOU MEANT, in two lines and one number.
//
// Everything within reach is a candidate. Keep the nearest PIN and the nearest BONE separately,
// and at the end: if a pin is anywhere near as close as the bone, the pin wins. A pin is a
// control someone deliberately placed on that joint; reaching into a rig full of them and
// getting the bone underneath is never what was wanted. A bone only wins by being CLEARLY
// nearer — more than `_rigPinPriority` times closer.
//
// This replaces four versions of arithmetic that mixed the two into one number with tie-break
// epsilons and zone normalisations. Every one of those was a tuning constant pretending to be a
// rule, and each round moved the margin somewhere else. Two distances and one comparison cannot
// drift: for any pair of candidates the answer is the same every time, and it is one number to
// argue about rather than four interacting ones.
function rigWinner(pin, pinD, bone, boneD) {
  if (!pin) return bone;
  if (!bone) return pin;
  const k = window._rigPinPriority || 2.0;
  return pinD <= boneD * k ? pin : bone;
}

// THE BONE IS A PICK TARGET FOR THE JOINTS EITHER SIDE OF IT.
//
// This rig is joint-centric: a joint is a real object with a transform and a parent, and the
// capsule drawn between two of them has no identity at all — it is not in the mesh list, owns
// no state, and cannot be selected. Drawing something that substantial and refusing to let it
// be clicked is what made the rig read as two kinds of thing when it only has one. So the
// segment donates its surface to the joints at its ends, and a hit reports whichever end is
// nearer. Near a joint that is the same answer the old point test gave, so the two are
// continuous; between them it fills the gap that used to be dead.
//
// The alternative mappings both lose a joint you need. Always reporting the TIP leaves the
// root unreachable; always the HEAD leaves every leaf unreachable, and leaves are the hands
// and feet you reach for most.

// Closest approach between the ray vNear + t*D (t >= 0) and the segment A -> A+E.
// Returns the distance; leaves the parameters in _segT and _segS.
function raySegDist(vNear, D, dd, A, E) {
  var ee = vec3.dot(E, E);
  vec3.sub(_TMP_SEG_R, vNear, A);
  var c = vec3.dot(D, _TMP_SEG_R);
  if (ee < 1e-20) {                     // a zero-length bone is just its own joint
    _segS = 0.0;
    _segT = -c / dd;
  } else {
    var f = vec3.dot(E, _TMP_SEG_R);
    var b = vec3.dot(D, E);
    var denom = dd * ee - b * b;
    _segT = denom > 1e-20 ? (b * f - c * ee) / denom : 0.0;
    _segS = (b * _segT + f) / ee;
    // Clamp to the segment, then re-solve the ray for that end — clamping one parameter
    // without re-solving the other is the classic way this returns a point that is not the
    // closest one.
    if (_segS < 0.0) { _segS = 0.0; _segT = -c / dd; }
    else if (_segS > 1.0) { _segS = 1.0; _segT = (b - c) / dd; }
  }
  if (_segT < 0.0) _segT = 0.0;         // behind the eye: measure from the near plane
  vec3.scaleAndAdd(_TMP_SEG_Q, vNear, D, _segT);
  vec3.scaleAndAdd(_TMP_SEG_P, A, E, _segS);
  return vec3.dist(_TMP_SEG_Q, _TMP_SEG_P);
}

// Closest approach between a POINT and the segment A -> A+E. The VR rig pick is controller-tip
// proximity rather than a ray, so it wants this one.
function pointSegDist(P, A, E) {
  var ee = vec3.dot(E, E);
  vec3.sub(_TMP_SEG_R, P, A);
  _segS = ee < 1e-20 ? 0.0 : vec3.dot(_TMP_SEG_R, E) / ee;
  if (_segS < 0.0) _segS = 0.0; else if (_segS > 1.0) _segS = 1.0;
  vec3.scaleAndAdd(_TMP_SEG_Q, A, E, _segS);
  return vec3.dist(P, _TMP_SEG_Q);
}

// The joint at the other end of this joint's bone, when there is one and it can be selected.
// A hidden or locked parent means no segment: the capsule is not a way round either state.
// THE PIN ON THAT END, when the point you are aiming at is inside the pin's own marker.
//
// This is the defect three rounds of score tuning could not reach. A bone hit resolves to the
// joint at its nearer END — and a control pin sits exactly ON that joint. So the segment and
// the pin occupy the SAME PLACE, and which of them won was decided by whichever tuning constant
// happened to be larger that week. Scoring cannot separate two things that are not apart.
//
// So it is not scored at all. If the nearer end carries a pin and you are within the marker
// that pin is drawing, the pin IS the answer: it is the control, the joint is the thing the
// control drives, and nobody reaching for a visible handle means the bone underneath it. The
// marker bound keeps it honest — aim at the middle of the bone, well away from any handle, and
// you still get the bone.
function pinAtEnd(joint, px, py, pz) {
  const pin = joint && joint._boneIKPinObj;
  if (!pin || !pin._isPinTarget || !pin.getModelSpaceMatrix) return null;
  if (!pin.isVisible || !pin.isVisible() || pin._selectLocked) return null;
  const r = pin._pickRadius || 0;
  if (r <= 0) return null;                       // no marker drawn: nothing to be aiming at
  const m = pin.getModelSpaceMatrix(_TMP_SEG_MS);
  const dx = m[12] - px, dy = m[13] - py, dz = m[14] - pz;
  return (dx * dx + dy * dy + dz * dz) <= r * r ? pin : null;
}

function segmentHead(mesh) {
  if (!mesh._isBone) return null;      // pins are points, and always have been
  var p = mesh._parentMesh;
  if (!p || !p._isBone) return null;   // the root, or a joint parented to something else
  if (!p.isVisible || !p.isVisible() || p._selectLocked) return null;
  return p;
}
var _TMP_DIR_PICK = [0.0, 0.0, 0.0];
var _TMP_V1 = [0.0, 0.0, 0.0];
var _TMP_V2 = [0.0, 0.0, 0.0];
var _TMP_V3 = [0.0, 0.0, 0.0];

class Picking {

  static addAlpha(u8, width, height, name) {
    var newAlpha = {};
    newAlpha._name = name;
    newAlpha._texture = u8;
    newAlpha._ratioX = Math.max(1.0, width / height);
    newAlpha._ratioY = Math.max(1.0, height / width);
    newAlpha._ratioMax = Math.max(newAlpha._ratioX, newAlpha._ratioY);
    newAlpha._width = width;
    newAlpha._height = height;
    var i = 1;
    while (Picking.ALPHAS[newAlpha._name])
      newAlpha._name = name + (i++);
    Picking.ALPHAS[newAlpha._name] = newAlpha;
    Picking.ALPHAS_NAMES[newAlpha._name] = newAlpha._name;
    return newAlpha;
  }

  constructor(main, xSym) {
    this._mesh = null; // mesh
    this._main = main; // the camera
    this._pickedFace = -1; // face picked
    this._pickedVertices = []; // vertices selected
    this._interPoint = [0.0, 0.0, 0.0]; // intersection point (mesh local space)
    this._rLocal2 = 0.0; // radius of the selection area (local/object space)
    this._rLocal2 = 0.0; // radius of the selection area (local/object space)
    this._rWorld2 = 0.0; // radius of the selection area (world space)
    this._symPosedMirror = false;          // did the last mirror go through rest space?
    this._symMirrorNormal = [0.0, 0.0, 0.0]; // and the normal it produced there
    this._eyeDir = [0.0, 0.0, 0.0]; // eye direction

    this._xSym = !!xSym;

    this._pickedNormal = [0.0, 0.0, 0.0];
    // alpha stuffs
    this._alphaOrigin = [0.0, 0.0, 0.0];
    this._alphaSide = 0.0;
    this._alphaLookAt = mat4.create();
    this._alpha = null;
  }

  setIdAlpha(id) {
    this._alpha = Picking.ALPHAS[id];
  }

  getAlpha(x, y, z) {
    var alpha = this._alpha;
    // VR Fix: Allow alpha calculation to proceed so we get Symmetry Masking (xn > 1.0 checks)
    if (!alpha || !alpha._texture) return 1.0;

    var m = this._alphaLookAt;
    var rs = this._alphaSide;

    var xn = alpha._ratioY * (m[0] * x + m[4] * y + m[8] * z + m[12]) / (this._xSym ? -rs : rs);
    if (Math.abs(xn) > 1.0) return 0.0;

    var yn = alpha._ratioX * (m[1] * x + m[5] * y + m[9] * z + m[13]) / rs;
    if (Math.abs(yn) > 1.0) return 0.0;

    var aw = alpha._width;
    xn = (0.5 - xn * 0.5) * aw;
    yn = (0.5 - yn * 0.5) * alpha._height;
    return alpha._texture[(xn | 0) + aw * (yn | 0)] / 255.0;
  }

  updateAlpha(keepOrigin) {
    var dir = _TMP_V1;
    var nor = _TMP_V2;

    var radius = Math.sqrt(this._rLocal2);
    this._alphaSide = radius * Math.SQRT1_2;

    vec3.sub(dir, this._interPoint, this._alphaOrigin);
    if (vec3.len(dir) === 0) return;
    vec3.normalize(dir, dir);

    var normal = this._pickedNormal;
    vec3.scaleAndAdd(dir, dir, normal, -vec3.dot(dir, normal));
    vec3.normalize(dir, dir);

    if (!keepOrigin)
      vec3.copy(this._alphaOrigin, this._interPoint);

    vec3.scaleAndAdd(nor, this._alphaOrigin, normal, radius);
    mat4.lookAt(this._alphaLookAt, this._alphaOrigin, nor, dir);
  }

  initAlpha() {
    this.computePickedNormal();
    this.updateAlpha();
  }

  getMesh() {
    return this._mesh;
  }

  setLocalRadius2(radius) {
    this._rLocal2 = radius;
  }

  getLocalRadius2() {
    return this._rLocal2;
  }

  getLocalRadius() {
    return Math.sqrt(this._rLocal2);
  }

  getWorldRadius2() {
    return this._rWorld2;
  }

  getWorldRadius() {
    return Math.sqrt(this._rWorld2);
  }

  setIntersectionPoint(inter) {
    this._interPoint = inter;
  }

  getEyeDirection() {
    return this._eyeDir;
  }

  getIntersectionPoint() {
    return this._interPoint;
  }

  getPickedVertices() {
    return this._pickedVertices;
  }

  getPickedFace() {
    return this._pickedFace;
  }

  getPickedNormal() {
    return this._pickedNormal;
  }

  /** Intersection between a ray the mouse position for every meshes */
  // RIG NODES ARE PICKABLE ONLY WHEN ASKED FOR. Joints and pin nulls carry
  // `isPickable = false` so sculpt brushes cannot grab them — the brush and the selection share
  // this one function, so making them pickable outright would put a joint under every stroke.
  // `includeRig` is the opt-in the selection paths use.
  intersectionMouseMeshes(meshes = this._main.getMeshes(), mouseX = this._main._mouseX, mouseY = this._main._mouseY, twoSided = false, includeRig = false) {
    this._rigHitSegment = null;   // per pick — see the note in intersectionRayMeshes
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        meshes = [activeMesh];
      }
    }
    this._isVRHit = false;

    var vNear = this.unproject(mouseX, mouseY, 0.0);
    var vFar = this.unproject(mouseX, mouseY, 0.1);
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;
    var nearPinD = Infinity, nearPin = null;
    var nearBoneD = Infinity, nearBone = null;
    var nearRigFace = -1;

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      var isRig = !!(mesh._isBone || mesh._isPinTarget);
      if (!mesh.isVisible() || mesh._selectLocked) continue;
      if (mesh.isPickable === false && !(includeRig && isRig)) continue;

      // RIG NODES ARE PICKED AS POINTS IN A CONE, not as geometry.
      //
      // A joint's pick sphere is a 0.03-scale locator while the marker you SEE is sized from
      // the scene unit — different things entirely — so ray-vs-geometry meant aiming at an
      // invisible object a fraction the size of the dot, and missing it by a pixel or landing
      // somewhere else entirely depending on zoom. Instead: distance from the node's centre to
      // the ray, against a radius that grows with depth, which is a fixed target in SCREEN
      // space at any distance. `window._rigPickCone` widens or narrows it.
      if (isRig) {
        // WORLD space, to match the ray. vNear/vFar are unprojected into world coords and the
        // mesh path transforms them INTO each mesh; getModelSpaceMatrix is worldGroup-relative,
        // so comparing a model-space point against a world-space ray silently misses entirely
        // the moment the world group carries any transform of its own.
        const rtm = mesh.getThreeMesh();
        if (!rtm) continue;
        rtm.updateMatrixWorld(true);
        const rwm = rtm.matrixWorld.elements;
        _TMP_RIG_P[0] = rwm[12]; _TMP_RIG_P[1] = rwm[13]; _TMP_RIG_P[2] = rwm[14];
        vec3.sub(_TMP_RIG_D, vFar, vNear);
        var rl2 = vec3.sqrLen(_TMP_RIG_D);
        if (rl2 < 1e-20) continue;
        vec3.sub(_TMP_RIG_W, _TMP_RIG_P, vNear);
        var tAlong = vec3.dot(_TMP_RIG_W, _TMP_RIG_D) / rl2;
        if (tAlong < 0) continue;                       // behind the eye
        vec3.scaleAndAdd(_TMP_RIG_C, vNear, _TMP_RIG_D, tAlong);
        var offAxis = vec3.dist(_TMP_RIG_C, _TMP_RIG_P);
        // The bone this joint hangs off is part of its target — see the note by raySegDist.
        // Kept as an IMPROVEMENT on the point test rather than a replacement for it, so a
        // joint with no bone (the first one you place, before it has been extended) is picked
        // exactly as it always was.
        var rigHit = mesh;
        // BONE SELECTION IS OFF BY DEFAULT — see the note by BONE_SELECT.
        var segHead = BONE_SELECT(this._main) ? segmentHead(mesh) : null;
        // A CANDIDATE, committed only where the winner is decided — see the VR path for why
        // writing it here directly let iteration order pick the bone.
        var segIsBone = null;
        if (segHead) {
          var shm = segHead.getThreeMesh();
          if (shm) {
            shm.updateMatrixWorld(true);
            var shw = shm.matrixWorld.elements;
            _TMP_SEG_A[0] = shw[12]; _TMP_SEG_A[1] = shw[13]; _TMP_SEG_A[2] = shw[14];
            vec3.sub(_TMP_SEG_E, _TMP_RIG_P, _TMP_SEG_A);
            var segOff = raySegDist(vNear, _TMP_RIG_D, rl2, _TMP_SEG_A, _TMP_SEG_E);
            if (segOff < offAxis) {
              offAxis = segOff;
              tAlong = _segT;
              // WHICH BONE, as distinct from which joint. A segment is drawn from a joint to
              // its parent, so the segment IS `mesh` — the child end — whichever end the
              // selection resolves to. Recorded separately because the two answers differ and
              // both are wanted: selection wants the nearer END, while an operation on the BONE
              // (split) wants the bone you are pointing at. Without this, pointing at the top
              // of a bone selected the parent and split the bone ABOVE the one under the
              // cursor.
              segIsBone = mesh;
              // NEAREST END. At s = 1 this is the joint itself and the answer matches the
              // point test exactly, which is what makes the two continuous.
              rigHit = _segS >= 0.5 ? mesh : segHead;
              // ...and the CONTROL on that end wins over the joint it drives — see pinAtEnd.
              rigHit = pinAtEnd(rigHit, _TMP_SEG_P[0], _TMP_SEG_P[1], _TMP_SEG_P[2]) || rigHit;
            }
          }
        }
        // ORTHO RAYS ARE PARALLEL, so the hit zone is a cylinder, not a cone: scaling the
        // radius with depth there makes it vanish near the camera and balloon far away, which
        // is why nothing could be picked in orthographic at all. In both cases the radius is
        // chosen to be the same fraction of the SCREEN.
        // THE RADIUS IS THE TOOL'S OWN RADIUS — the sphere you can see and set.
        //
        // matt: "use [the grab sphere radius] as the preselect radius". It is the right answer
        // and it settles an argument the previous rules could not: a hidden constant that had
        // to be guessed at, tuned blind and re-tuned every time something else moved is
        // replaced by a number that is drawn on screen and adjustable while you work. "Within
        // x radius" stops being a figure of speech.
        //
        // Converted at the NODE's depth rather than the brush's: project the node, step the
        // tool's screen radius sideways, unproject, and measure. Same conversion the brush uses
        // for its own world radius, anchored on the thing being picked.
        //
        // ONE radius for pins and bones alike. Which of them you meant is decided by rigWinner
        // afterwards, and mixing that decision into the radius is what produced four versions
        // of interacting constants.
        var _cam = this._main && this._main.getCamera && this._main.getCamera();
        var cone = 0;
        var _tool = this._main.getSculptManager && this._main.getSculptManager()
          && this._main.getSculptManager().getCurrentTool();
        var _scr = _tool && _tool.getScreenRadius ? _tool.getScreenRadius() : 0;
        if (_scr > 0) {
          var _pp = this.project(_TMP_RIG_P);
          cone = Math.sqrt(vec3.sqrDist(_TMP_RIG_P, this.unproject(_pp[0] + _scr, _pp[1], _pp[2])));
        }
        if (!(cone > 0)) {
          // No tool radius to read (a tool without one, or before one is set). Fall back to the
          // screen-fraction cone this used before, so the pick never silently has no zone.
          var _pk = mesh._isPinTarget
            ? (window._rigPickConePin || 0.028)
            : (window._rigPickCone || 0.018);
          if (_cam && _cam.isOrthographic && _cam.isOrthographic()) {
            var halfH = (_cam._height || 1) * _cam.getOrthoZoom(); // matches updateOrtho's half-extent
            cone = _pk * halfH / Math.tan((_cam.getFov ? _cam.getFov() : 45) * 0.5 * Math.PI / 180);
          } else {
            cone = _pk * tAlong * Math.sqrt(rl2);
          }
        }
        // NEVER SMALLER THAN THE MARKER ITSELF. The cone above is a fraction of the screen; a
        // pin's gnomon is sized in WORLD units from the scene unit, and on a large rig it is
        // much the bigger of the two. Pointing at an arm of the triad then landed outside the
        // pin's own zone and the bone beneath it won every time. `_pickRadius` is published by
        // the code that draws the marker, so the zone is whatever is actually on screen.
        if (BONE_SELECT(this._main) && mesh._pickRadius > cone) cone = mesh._pickRadius;
        if (window._pickTrace) {
          console.log('[pick]', mesh._permanentStaticLabel || mesh.getID(),
            mesh._isPinTarget ? 'PIN' : 'BONE',
            'hit=', rigHit === mesh ? 'self' : (rigHit._permanentStaticLabel || rigHit.getID()),
            'p=', _TMP_RIG_P.map((v) => v.toFixed(2)).join(','),
            't=', tAlong.toFixed(3), 'off=', offAxis.toFixed(3), 'cone=', cone.toFixed(3),
            offAxis <= cone ? 'HIT' : '');
        }
        if (offAxis > cone) continue;
        // Selection is spatial, not categorical. A pin wins only an effectively coincident
        // tie with its own joint; it must never hide a different bone elsewhere in the cone.
        //
        // MEASURED AGAINST ITS OWN ZONE, not in raw units. A pin's cone is wider than a bone's
        // (0.028 vs 0.018) because a pin is the smaller thing to aim at and needs the help —
        // but the score compared raw distances, so the wider zone bought a pin nothing at all
        // and the comparison silently favoured whichever target simply had more surface near
        // the ray. That was harmless while bones were picked as POINTS at their joints. It
        // stopped being harmless the moment a bone became a whole SEGMENT of pick surface:
        // a bone then beat the pin sitting on its own end from almost anywhere, and pins
        // became effectively unselectable. Dividing by the cone asks the question that was
        // always meant: how far INTO its own target zone is each one.
        // Off-axis distance alone, kept per KIND. Depth is not mixed in: two candidates the
        // pointer is equally close to are equally good, and the rule below decides which kind
        // you meant. The intersection is reported in MESH-LOCAL coords — callers transform it
        // by the mesh matrix — and a locator's origin is its centre.
        _TMP_INTER_RIG[0] = _TMP_INTER_RIG[1] = _TMP_INTER_RIG[2] = 0;
        nearRigFace = -1;
        if (rigHit._isPinTarget) {
          if (offAxis < nearPinD) { nearPinD = offAxis; nearPin = rigHit; }
        } else if (offAxis < nearBoneD) {
          nearBoneD = offAxis; nearBone = rigHit;
          this._rigHitSegment = segIsBone;   // null when this hit was a point, not a segment
        }
        continue;
      }

      mesh.getThreeMesh().updateMatrixWorld(true);
      mat4.invert(_TMP_INV, mesh.getThreeMesh().matrixWorld.elements);
      vec3.transformMat4(_TMP_NEAR_1, vNear, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, vFar, _TMP_INV);
      if (!this.intersectionRayMesh(mesh, _TMP_NEAR_1, _TMP_FAR, twoSided))
        continue;

      var interTest = this.getIntersectionPoint();
      var testDistance = vec3.dist(_TMP_NEAR_1, interTest) * mesh.getScale();
      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    // A RIG NODE BEATS A MESH WHENEVER ONE WAS ASKED FOR. The skeleton lives INSIDE the sculpt,
    // so bones sit behind the surface from almost every angle and a nearest-hit rule leaves the
    // mesh permanently in the way of its own rig — you end up hiding the mesh to reach a hip.
    // Only the tools that want rig nodes pass includeRig, so asking for them is a clear enough
    // statement of intent to let them win. Gated to a bound mesh first, which was too narrow:
    // a rig is usually drawn long before anything is bound to it.
    // Note the missing `&& nearMesh`: rig nodes are tested on their own path and never touch
    // nearMesh, so requiring one meant a hit on a bone with no mesh behind it reported NOTHING
    // — which read as the rig having become unselectable altogether.
    var nearRig = rigWinner(nearPin, nearPinD, nearBone, nearBoneD);
    if (nearRig) {
      nearMesh = nearRig;
      nearFace = nearRigFace;
      vec3.copy(_TMP_INTER_1, _TMP_INTER_RIG);
    }

    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        this._mesh = activeMesh;
        return false;
      }
    }

    this._mesh = nearMesh;
    if (nearMesh) {
      vec3.copy(this._interPoint, _TMP_INTER_1);
      this._pickedFace = nearFace;
      if (nearFace !== -1)
        this.updateLocalAndWorldRadius2();
    } else {
      this._pickedFace = -1;
    }
    return !!nearMesh;
  }

  // The VR twin of intersectionMouseMeshes. `includeRig` opts into joints and pins the same
  // way, and for the same reason: the controller ray shares this function with sculpting, so
  // making rig nodes pickable outright would put a joint under every stroke.
  intersectionRayMeshes(meshes, origin, direction, includeRig = false) {
    // Cleared per pick: a stale segment would name a bone from wherever the ray was last time.
    this._rigHitSegment = null;
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;
    var nearPinD = Infinity, nearPin = null;
    var nearBoneD = Infinity, nearBone = null;

    // vNear = origin
    // vFar = origin + direction * length
    vec3.copy(_TMP_NEAR_1, origin);
    vec3.scaleAndAdd(_TMP_FAR_1, origin, direction, 5000.0);

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible() || mesh._selectLocked) continue;

      mesh.getModelSpaceMatrix(_TMP_MS); // parent-aware (== getMatrix() for flat meshes)

      // VR rig nodes are selected entirely by controller proximity. Reaching for a joint or
      // pin is more predictable than aiming a ray at it, especially during two-hand posing.
      if (includeRig && (mesh._isBone || mesh._isPinTarget)) {
        _TMP_RIG_P[0] = _TMP_MS[12]; _TMP_RIG_P[1] = _TMP_MS[13]; _TMP_RIG_P[2] = _TMP_MS[14];
        vec3.sub(_TMP_RIG_W, _TMP_RIG_P, origin);
        // Coordinates are in model space; convert to physical metres so world scale does not
        // change the reach distance.
        const vrScale = this._main?._vrScale || 1.0;
        var rigDist = vec3.len(_TMP_RIG_W);
        var vrHit = mesh;
        // Reaching for the middle of a limb takes the joint at the nearer end of it. Same rule
        // as the desktop pick, measured from the controller tip instead of along a ray, since
        // that is what the VR rig pick has always been.
        var vrHead = BONE_SELECT(this._main) ? segmentHead(mesh) : null;
        // WHICH BONE, as distinct from which joint. A segment is drawn from a joint to its
        // parent, so the segment IS `mesh` — the child end — whichever end the SELECTION
        // resolves to. Selection wants the nearer end; an operation on the bone (split) wants
        // the bone under the cursor, and they differ.
        //
        // Held per mesh and committed only where the winner is decided. Written straight to
        // `this` it was overwritten by every bone whose segment beat its own joint, so the last
        // one in ITERATION ORDER won rather than the nearest — which is why aiming at a bone
        // still could not split it.
        var segIsBone = null;
        if (vrHead) {
          vrHead.getModelSpaceMatrix(_TMP_SEG_MS);
          _TMP_SEG_A[0] = _TMP_SEG_MS[12];
          _TMP_SEG_A[1] = _TMP_SEG_MS[13];
          _TMP_SEG_A[2] = _TMP_SEG_MS[14];
          vec3.sub(_TMP_SEG_E, _TMP_RIG_P, _TMP_SEG_A);
          var segD = pointSegDist(origin, _TMP_SEG_A, _TMP_SEG_E);
          if (segD < rigDist) {
            rigDist = segD;
            segIsBone = mesh;   // a CANDIDATE — see the commit below
            vrHit = _segS >= 0.5 ? mesh : vrHead;
            vrHit = pinAtEnd(vrHit, _TMP_SEG_Q[0], _TMP_SEG_Q[1], _TMP_SEG_Q[2]) || vrHit;
          }
        }
        const physicalDistance = rigDist * vrScale;
        var isPin = !!mesh._isPinTarget;
        // A PIN REACHES FURTHER THAN A BONE, in the same proportion the desktop cone gives it
        // (0.028 against 0.018), and never less far than the marker you are reaching FOR — a
        // gnomon drawn 30cm across has arms further out than an 11cm reach, so touching one
        // would miss the pin and take the bone behind it.
        // THE REACH IS THE CURSOR SPHERE. Same number the sphere is drawn at, published by
        // Scene each frame — "use its radius as the proximity max dist". A radius you can see
        // and set beats a constant nobody can, which is the whole lesson of the last few
        // rounds. Falls back to the fixed reach when there is no sphere to read.
        const base = this._main?._vrBrushPhysicalRadius || (window._rigPickProximityVR || 0.11);
        const reach = BONE_SELECT(this._main)
          ? Math.max(base, (mesh._pickRadius || 0) * vrScale) : base;
        if (physicalDistance > reach) continue;
        // MEASURED AGAINST ITS OWN REACH, exactly as the desktop score is measured against its
        // own cone — and for a reason that only appeared when bones became pick surface.
        //
        // A pin is a POINT. A bone is now a whole SEGMENT. Compared in raw metres the segment
        // wins from almost anywhere near the limb, and the 2 mm pin bias below is far too small
        // to matter: the pin only won in a sliver where it was genuinely nearer than the entire
        // bone. matt, on the primary controller: "I have to be apparently 1mm to the right of a
        // pin to select it." The secondary hand looked fine because it was not driving this
        // pick at all.
        // Same rule as the desktop pick, measured from the controller tip: nearest of each
        // kind, and rigWinner decides between them.
        if (vrHit._isPinTarget) {
          if (physicalDistance < nearPinD) { nearPinD = physicalDistance; nearPin = vrHit; }
        } else if (physicalDistance < nearBoneD) {
          nearBoneD = physicalDistance; nearBone = vrHit;
          this._rigHitSegment = segIsBone;   // null when this hit was a point, not a segment
        }
        continue;
      }
      if (mesh.isPickable === false) continue;

      mat4.invert(_TMP_INV, _TMP_MS);
      vec3.transformMat4(_TMP_NEAR, _TMP_NEAR_1, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, _TMP_FAR_1, _TMP_INV);

      if (!this.intersectionRayMesh(mesh, _TMP_NEAR, _TMP_FAR)) continue;

      var interTest = this.getIntersectionPoint();
      // Distance check (world space)
      // intersectionRayMesh sets _interPoint in LOCAL space

      // Transform local intersection to world to measure distance from origin
      vec3.transformMat4(_TMP_V1, interTest, _TMP_MS);
      var testDistance = vec3.dist(origin, _TMP_V1);

      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    // A rig node wins whenever one was asked for — the skeleton lives inside the sculpt, so
    // nearest-hit leaves the mesh permanently in the way of its own rig. Note it does not
    // require nearMesh: rig nodes are tested on their own path and never set it, and requiring
    // one is what made a lone bone report nothing on the desktop side.
    var nearRig = rigWinner(nearPin, nearPinD, nearBone, nearBoneD);
    if (nearRig) {
      nearMesh = nearRig;
      nearFace = -1;
      // Local coords: callers transform this by the mesh matrix, and a locator's origin is its
      // centre.
      _TMP_INTER_1[0] = _TMP_INTER_1[1] = _TMP_INTER_1[2] = 0;
    }

    this._mesh = nearMesh;
    vec3.copy(this._interPoint, _TMP_INTER_1);
    this._pickedFace = nearFace;

    // For radius, we might need to handle it differently in VR
    // updateLocalAndWorldRadius2 uses screen projection.
    // We'll trust it works if we fake mouse, OR we overload it.
    if (nearFace !== -1)
      this.updateLocalAndWorldRadius2();

    return !!nearMesh;
  }

  /** Intersection between a sphere and meshes (Contact Picking for VR) */
  intersectionSphereMeshes(meshes, worldCenter, worldRadius) {
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        meshes = [activeMesh];
      }
    }
    this._isVRHit = true;
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;
    var nearPoint = [0.0, 0.0, 0.0];

    var localCenter = [0.0, 0.0, 0.0];
    var closestPoint = [0.0, 0.0, 0.0];

    // Temp vars for triangle vertices
    var v1 = [0.0, 0.0, 0.0];
    var v2 = [0.0, 0.0, 0.0];
    var v3 = [0.0, 0.0, 0.0];
    var vAr, fAr;

    var worldRadiusSq = worldRadius * worldRadius;

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible() || mesh.isPickable === false || mesh._selectLocked) continue;

      mesh.getModelSpaceMatrix(_TMP_MS); // parent-aware (== getMatrix() for flat meshes)
      mat4.invert(_TMP_INV, _TMP_MS);
      vec3.transformMat4(localCenter, worldCenter, _TMP_INV);

      var scale = mesh.getModelSpaceScale();
      var localRadiusSq = worldRadiusSq / (scale * scale);

      // Silenced continuous console noise

      var iFaces = [];

      var bound = mesh.getLocalBound();
      var dx = bound[3] - bound[0];
      var dy = bound[4] - bound[1];
      var dz = bound[5] - bound[2];
      var meshLocalSize = Math.hypot(dx, dy, dz);

      // Floor for the contact-search radius so a sub-face brush still catches a face. The old
      // floor was 5% of the WHOLE mesh's bounding box — scale-blind, so when zoomed in with a
      // small brush the search accepted the nearest face within 5% of the entire head. On flat
      // areas that region is ~coplanar (fine), but near concave detail (eye sockets / surface
      // tucked under proud eyeballs) it snapped to a face BENEATH the aimed surface → the cursor
      // drew under the mesh and jumped around. Tie the floor to local resolution (a few average
      // face-spacings) instead, capped at the old 5% so it can only ever tighten, never widen.
      var nbFaces = mesh.getNbFaces ? mesh.getNbFaces() : 0;
      var avgFaceSpacing = nbFaces > 0 ? meshLocalSize / Math.sqrt(nbFaces) : meshLocalSize * 0.05;
      var minFaceSpan = (window._contactMinFaces ?? 2.5); // floor = this many avg face-spacings
      // CRITICAL: also cap the floor in PHYSICAL terms. The floor is in local/engine units, so
      // as the world is grip-scaled up its real-world reach grows with it — the pick then snaps
      // to surface metres away from the controller tip (cursor under the mesh, sculpt offset from
      // the stylus, smooth reaching ~2x radius). Cap at a few cm of physical reach. Tunable: _contactMaxReach.
      var vrScaleNow = (this._main && this._main._vrScale) ? this._main._vrScale : 1.0;
      var physReachLocal = (window._contactMaxReach ?? 0.04) / (vrScaleNow * scale); // ~4cm physical → local units
      var safeMinRadius = Math.min(meshLocalSize * 0.05, avgFaceSpacing * minFaceSpan, physReachLocal);
      var safeMinRadiusSq = safeMinRadius * safeMinRadius;

      var maxLocalRadiusSq = Math.max(localRadiusSq, safeMinRadiusSq);
      var maxLocalRadius = Math.sqrt(maxLocalRadiusSq);

      // Step size is physically 5cm OR 5% of the mesh's bounding size, whichever is smaller.
      var vrScale = this._main && this._main._vrScale ? this._main._vrScale : 1.0;
      var physicalStepLocal = (0.05 / vrScale) / scale;
      var meshStepLocal = Math.max(0.0001, meshLocalSize * 0.05);
      var stepLocal = Math.min(physicalStepLocal, meshStepLocal);

      // Protect against insanely huge volumetric brushes triggering too many steps (cap at 60 lookups)
      if (maxLocalRadius / stepLocal > 60) {
        stepLocal = maxLocalRadius / 60;
      }

      var currentSearchR = stepLocal;

      while (currentSearchR <= maxLocalRadius) {
        iFaces = mesh.intersectSphere(localCenter, currentSearchR * currentSearchR);
        if (iFaces.length > 0) break;
        currentSearchR += stepLocal;
      }

      if (iFaces.length === 0) {
        iFaces = mesh.intersectSphere(localCenter, maxLocalRadiusSq);
      }

      const isSculpting = this._main && this._main._vrSculpting;

      if (iFaces.length === 0) continue;

      vAr = mesh.getVertices();
      fAr = mesh.getFaces();

      var faceBoxes = mesh.getFaceBoxes();
      var lRadius = maxLocalRadius;

      var rejectedByAABB = 0;
      var rejectedByDist = 0;

      // Find closest face
      for (var j = 0; j < iFaces.length; ++j) {
        var faceId = iFaces[j];
        var boxId = faceId * 6;

        // Fast AABB Check
        if (localCenter[0] < faceBoxes[boxId] - lRadius ||
            localCenter[0] > faceBoxes[boxId + 3] + lRadius ||
            localCenter[1] < faceBoxes[boxId + 1] - lRadius ||
            localCenter[1] > faceBoxes[boxId + 4] + lRadius ||
            localCenter[2] < faceBoxes[boxId + 2] - lRadius ||
            localCenter[2] > faceBoxes[boxId + 5] + lRadius) {
            rejectedByAABB++;
            continue;
        }

        var indFace = faceId * 4;

        // Get vertices
        var iv1 = fAr[indFace] * 3;
        var iv2 = fAr[indFace + 1] * 3;
        var iv3 = fAr[indFace + 2] * 3;

        v1[0] = vAr[iv1]; v1[1] = vAr[iv1 + 1]; v1[2] = vAr[iv1 + 2];
        v2[0] = vAr[iv2]; v2[1] = vAr[iv2 + 1]; v2[2] = vAr[iv2 + 2];
        v3[0] = vAr[iv3]; v3[1] = vAr[iv3 + 1]; v3[2] = vAr[iv3 + 2];

        // Check distance
        var distSq = Geometry.distance2PointTriangle(localCenter, v1, v2, v3, closestPoint);

        // Quad check?
        var iv4 = fAr[indFace + 3];
        if (iv4 !== Utils.TRI_INDEX) {
          var iv4i = iv4 * 3;
          var v4 = [vAr[iv4i], vAr[iv4i + 1], vAr[iv4i + 2]];
          var closestQuad = [0, 0, 0, 0];
          var distSq2 = Geometry.distance2PointTriangle(localCenter, v1, v3, v4, closestQuad);
          if (distSq2 < distSq) {
            distSq = distSq2;
            vec3.copy(closestPoint, closestQuad);
          }
        }

        if (distSq < maxLocalRadiusSq) { // Found a potential hit within radius
          // Convert dist to world for comparison
          var worldDist = Math.sqrt(distSq) * scale;
          if (worldDist < nearDistance) {
            nearDistance = worldDist;
            nearMesh = mesh;
            nearFace = iFaces[j];
            vec3.copy(nearPoint, closestPoint);
          }
        } else {
          rejectedByDist++;
        }
      }

      // Culling complete
    }



    if (nearMesh) {
      this._mesh = nearMesh;
      vec3.copy(this._interPoint, nearPoint);
      this._pickedFace = nearFace;
      // FIX for VR: Use the passed physical radius, DO NOT re-project to screen (which updateLocalAndWorldRadius2 does)
      this._rWorld2 = worldRadius * worldRadius;
      // Selection/deform radius = the ACTUAL brush radius, not the floored SEARCH radius
      // (maxLocalRadiusSq). The floor only widens the surface FIND so a sub-face brush still
      // catches a face; letting it become the deform radius made tools over-reach (smooth ~2x).
      this._rLocal2 = localRadiusSq;
      return true;
    }

    // Reset Picking if no hit, UNLESS Lock Selection is enabled
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        this._mesh = activeMesh;
        // Preserve the active locked mesh so tools like Move.js don't abort due to a !picking.getMesh() check!
        return false;
      }
    }

    this._mesh = null;
    this._pickedFace = -1;
    this._rLocal2 = 0.0;
    vec3.set(this._interPoint, 0.0, 0.0, 0.0);
    return false;
  }

  // Put THIS picking on the mirror image of `from`'s contact, and force the hit. The one place
  // a mirrored brush position is computed for the point-based (VR) path, so that it and the
  // ray-based (desktop) path above cannot drift apart.
  //
  // On a POSED bound character the reflection goes through rest space, because the symmetry
  // plane only means what it says at bind pose -- mirroring a posed point puts the brush where
  // the other side would be if it had never moved. Everywhere else it is the plain reflection
  // it always was.
  mirrorFrom(from, mesh, ptPlane, nPlane) {
    // NOTHING TO MIRROR IF NOTHING WAS HIT. The primary pick reports [0,0,0] when it has no
    // intersection, and reflecting the origin produces a confident-looking point somewhere
    // inside the character -- which the forced hit below then sculpts. The topological snap
    // beside this has always checked (`pick1 && getPickedFace() !== -1`); this path never did.
    if (!from.getMesh()) { this._mesh = null; return false; }
    var pt = vec3.create();
    vec3.copy(pt, from.getIntersectionPoint());
    PosedSymmetry.setBrushRadius2(from.getLocalRadius2());
    // The NORMAL travels with the point. Downstream the stroke direction comes from it and
    // getFrontVertices() culls everything behind its tangent plane, so a normal left in the
    // wrong space discards the whole mirrored selection rather than merely aiming it badly.
    var nrm = vec3.create();
    vec3.copy(nrm, from.getPickedNormal());
    var posed = PosedSymmetry.mirrorLocal(this._main, mesh, pt, ptPlane, nPlane, nrm);
    if (!posed) {
      Geometry.mirrorPoint(pt, ptPlane, nPlane);
    }
    // Kept for the caller, which otherwise overwrites the symmetric normal with the plain
    // posed-space mirror of the main one -- correct at bind pose, and the reason a posed
    // mirrored stroke vanished.
    this._symPosedMirror = posed;
    if (posed) vec3.copy(this._symMirrorNormal, nrm);
    // Says which of the two mirrors produced this point, so "nothing gets mirrored" can be
    // told from "it mirrored somewhere empty". Throttled; only while the trace is on.
    if (PosedSymmetry._traceOn) {
        console.log('[sym] ' + (posed ? 'REST-SPACE mirror' : 'PLAIN plane mirror')
          + ' -> [' + pt[0].toFixed(2) + ',' + pt[1].toFixed(2) + ',' + pt[2].toFixed(2) + ']'
          + ' r2=' + from.getLocalRadius2().toFixed(3));
    }
    this.setIntersectionPoint(pt);
    this._mesh = mesh; // force hit
    this.setLocalRadius2(from.getLocalRadius2());
    return true;
  }

  intersectionMouseMesh(mesh = this._main.getMesh(), mouseX = this._main._mouseX, mouseY = this._main._mouseY) {
    var vNear = this.unproject(mouseX, mouseY, 0.0);
    var vFar = this.unproject(mouseX, mouseY, 0.1);
    
    if (window._debugRay) {
      var eyeDir = [0, 0, 0];
      vec3.sub(eyeDir, vFar, vNear);
      vec3.normalize(eyeDir, eyeDir);
      console.log("Ray Dir:", eyeDir, "Mouse:", mouseX, mouseY, "Cam Size:", this._main.getCamera()._width, this._main.getCamera()._height);
    }

    var matInverse = mat4.create();
    mesh.getThreeMesh().updateMatrixWorld(true);
    mat4.invert(matInverse, mesh.getThreeMesh().matrixWorld.elements);
    vec3.transformMat4(vNear, vNear, matInverse);
    vec3.transformMat4(vFar, vFar, matInverse);
    return this.intersectionRayMesh(mesh, vNear, vFar);
  }

  /** Intersection between a ray and a mesh */
  intersectionRayMesh(mesh, vNearOrig, vFarOrig, twoSided = false) {
    // resest picking
    this._mesh = null;
    this._pickedFace = -1;
    // resest picking
    vec3.copy(_TMP_NEAR, vNearOrig);
    vec3.copy(_TMP_FAR, vFarOrig);
    // apply symmetry
    if (this._xSym) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(_TMP_NEAR, ptPlane, nPlane);
      Geometry.mirrorPoint(_TMP_FAR, ptPlane, nPlane);
      // ON A POSED CHARACTER THE PLANE IS IN THE WRONG SPACE. Mirroring a posed point gives
      // where the other side WOULD be if it had never moved; it has moved. Shift the mirrored
      // ray onto the actual anatomy -- direction untouched, so this still lands on whatever
      // surface is really over there, which is what makes it right on an asymmetric mesh.
      // Null whenever the mesh is unbound or at bind pose, where the plain mirror is correct.
      var _po = PosedSymmetry.rayOffset(this._main, mesh, ptPlane, nPlane, _TMP_SYMOFF);
      if (_po) {
        vec3.add(_TMP_NEAR, _TMP_NEAR, _po);
        vec3.add(_TMP_FAR, _TMP_FAR, _po);
      }
    }
    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();
    // compute eye direction
    var eyeDir = this.getEyeDirection();
    vec3.sub(eyeDir, _TMP_FAR, _TMP_NEAR);
    vec3.normalize(eyeDir, eyeDir);
    var iFacesCandidates = mesh.intersectRay(_TMP_NEAR, eyeDir);
    var distance = Infinity;
    var nbFacesCandidates = iFacesCandidates.length;
    for (var i = 0; i < nbFacesCandidates; ++i) {
      var indFace = iFacesCandidates[i] * 4;
      var ind1 = fAr[indFace] * 3;
      var ind2 = fAr[indFace + 1] * 3;
      var ind3 = fAr[indFace + 2] * 3;
      _TMP_V1[0] = vAr[ind1];
      _TMP_V1[1] = vAr[ind1 + 1];
      _TMP_V1[2] = vAr[ind1 + 2];
      _TMP_V2[0] = vAr[ind2];
      _TMP_V2[1] = vAr[ind2 + 1];
      _TMP_V2[2] = vAr[ind2 + 2];
      _TMP_V3[0] = vAr[ind3];
      _TMP_V3[1] = vAr[ind3 + 1];
      _TMP_V3[2] = vAr[ind3 + 2];
      var hitDist = Geometry.intersectionRayTriangle(_TMP_NEAR, eyeDir, _TMP_V1, _TMP_V2, _TMP_V3, _TMP_INTER, twoSided);
      if (hitDist < 0.0) {
        ind2 = fAr[indFace + 3];
        if (ind2 !== Utils.TRI_INDEX) {
          ind2 *= 3;
          _TMP_V2[0] = vAr[ind2];
          _TMP_V2[1] = vAr[ind2 + 1];
          _TMP_V2[2] = vAr[ind2 + 2];
          hitDist = Geometry.intersectionRayTriangle(_TMP_NEAR, eyeDir, _TMP_V1, _TMP_V3, _TMP_V2, _TMP_INTER, twoSided);
        }
      }
      if (hitDist >= 0.0 && hitDist < distance) {
        distance = hitDist;
        vec3.copy(this._interPoint, _TMP_INTER);
        this._pickedFace = iFacesCandidates[i];
      }
    }
    if (this._pickedFace !== -1) {
      this._mesh = mesh;
      this.updateLocalAndWorldRadius2();
      return true;
    }
    this._rLocal2 = 0.0;
    return false;
  }

  /** Find all the vertices inside the sphere */
  pickVerticesInSphere(rLocal2) {
    var mesh = this._mesh;
    var vAr = mesh.getVertices();
    var vertSculptFlags = mesh.getVerticesSculptFlags();
    var inter = this.getIntersectionPoint();

    // Compute a safe minimum search radius to bridge stale Octree gaps.
    // If rLocal is tiny (due to matrix scaling), use a fraction of mesh size instead.
    var bound = mesh.getLocalBound();
    var dx = Math.max(0.001, bound[3] - bound[0]);
    var dy = Math.max(0.001, bound[4] - bound[1]);
    var dz = Math.max(0.001, bound[5] - bound[2]);
    var meshSize = Math.max(dx, dy, dz);
    
    // 2.5% of the mesh size is a safe, responsive bubble that doesn't over-fetch too many candidates
    var safeMinRadius = meshSize * 0.025; 
    var safeMinRadiusSq = safeMinRadius * safeMinRadius;
    var searchRadiusSq = Math.max(rLocal2, safeMinRadiusSq);

    var iFacesInCells = mesh.intersectSphere(inter, searchRadiusSq, true);
    var iVerts = mesh.getVerticesFromFaces(iFacesInCells);
    var nbVerts = iVerts.length;

    // The widened searchRadiusSq is only to over-FETCH candidate faces (bridge stale-octree
    // gaps when the brush is tiny). Accept verts against the ACTUAL brush radius — using the
    // floored radius here made the selection grab a fixed 2.5%-of-mesh bubble regardless of
    // brush size, so tools over-reached (smooth past its ring; clay flattening a region far
    // larger than its buildup ceiling → "no effect" when scaled up). Empty result is fine:
    // dynamicTopology falls back to the picked face and subdivides for fine detail.
    var acceptRadiusSq = rLocal2 > 0 ? rLocal2 : searchRadiusSq;

    var sculptFlag = ++Utils.SCULPT_FLAG;
    var pickedVertices = new Uint32Array(Utils.getMemory(4 * nbVerts), 0, nbVerts);
    var acc = 0;
    var itx = inter[0];
    var ity = inter[1];
    var itz = inter[2];

    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i];
      var j = ind * 3;
      var ddx = itx - vAr[j];
      var ddy = ity - vAr[j + 1];
      var ddz = itz - vAr[j + 2];
      if ((ddx * ddx + ddy * ddy + ddz * ddz) < acceptRadiusSq) {
        vertSculptFlags[ind] = sculptFlag;
        pickedVertices[acc++] = ind;
      }
    }

    this._pickedVertices = new Uint32Array(pickedVertices.subarray(0, acc));
    return this._pickedVertices;
  }


  _isInsideSphere(id, inter, rLocal2) {
    if (id === Utils.TRI_INDEX) return false;
    var iv = id * 3;
    return vec3.sqrDist(inter, this._mesh.getVertices().subarray(iv, iv + 3)) <= rLocal2;
  }

  pickVerticesInSphereTopological(rLocal2) {
    var mesh = this._mesh;
    if (!mesh) return new Uint32Array(0);
    var nbVertices = mesh.getNbVertices();
    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();

    var vrvStartCount = mesh.getVerticesRingVertStartCount();
    var vertRingVert = mesh.getVerticesRingVert();
    var ringVerts = vertRingVert instanceof Array ? vertRingVert : null;

    var vertSculptFlags = mesh.getVerticesSculptFlags();
    var vertTagFlags = mesh.getVerticesTagFlags();

    var sculptFlag = ++Utils.SCULPT_FLAG;
    var tagFlag = ++Utils.TAG_FLAG;

    var inter = this.getIntersectionPoint();
    var itx = inter[0];
    var ity = inter[1];
    var itz = inter[2];

    var pickedVertices = new Uint32Array(Utils.getMemory(4 * nbVertices), 0, nbVertices);
    var idf = this.getPickedFace() * 4;
    var acc = 1;

    if (this._isInsideSphere(fAr[idf], inter, rLocal2)) pickedVertices[0] = fAr[idf];
    else if (this._isInsideSphere(fAr[idf + 1], inter, rLocal2)) pickedVertices[0] = fAr[idf + 1];
    else if (this._isInsideSphere(fAr[idf + 2], inter, rLocal2)) pickedVertices[0] = fAr[idf + 2];
    else if (this._isInsideSphere(fAr[idf + 3], inter, rLocal2)) pickedVertices[0] = fAr[idf + 3];
    else acc = 0;

    if (acc === 1) {
      vertSculptFlags[pickedVertices[0]] = sculptFlag;
      vertTagFlags[pickedVertices[0]] = tagFlag;
    }

    for (var i = 0; i < acc; ++i) {
      var id = pickedVertices[i];
      var start, end;
      if (ringVerts) {
        vertRingVert = ringVerts[id];
        start = 0;
        end = vertRingVert.length;
      } else {
        start = vrvStartCount[id * 2];
        end = start + vrvStartCount[id * 2 + 1];
      }

      for (var j = start; j < end; ++j) {
        var idv = vertRingVert[j];
        if (vertTagFlags[idv] === tagFlag)
          continue;
        vertTagFlags[idv] = tagFlag;

        var id3 = idv * 3;
        var dx = itx - vAr[id3];
        var dy = ity - vAr[id3 + 1];
        var dz = itz - vAr[id3 + 2];
        if ((dx * dx + dy * dy + dz * dz) > rLocal2)
          continue;

        vertSculptFlags[idv] = sculptFlag;
        pickedVertices[acc++] = idv;
      }
    }

    this._pickedVertices = new Uint32Array(pickedVertices.subarray(0, acc));
    return this._pickedVertices;
  }

  computeWorldRadius2(ignorePressure) {
    this._mesh.getThreeMesh().updateMatrixWorld(true);
    vec3.transformMat4(_TMP_INTER, this.getIntersectionPoint(), this._mesh.getThreeMesh().matrixWorld.elements);
 
    var offsetX = this._main.getSculptManager().getCurrentTool().getScreenRadius();
    if (!ignorePressure) offsetX *= Tablet.getPressureRadius();
 
    var screenInter = this.project(_TMP_INTER);
    return vec3.sqrDist(_TMP_INTER, this.unproject(screenInter[0] + offsetX, screenInter[1], screenInter[2]));
  }

  updateLocalAndWorldRadius2() {
    if (!this._mesh) return;
    this._rWorld2 = this.computeWorldRadius2();

    const m = this._mesh.getThreeMesh().matrixWorld.elements;
    const scale2 = m[0] * m[0] + m[4] * m[4] + m[8] * m[8];
    this._rLocal2 = this._rWorld2 / scale2;
  }

  unproject(x, y, z) {
    const cam = this._main.getCamera();
    // Desktop picking align fix for STATIONARY / TRACKED VR
    const isSpectator = this._main.getXRMode && this._main.getXRMode() &&
      (this._main._spectatorMode === 0 || this._main._spectatorMode === 1);

    if (isSpectator) cam._unprojectDiverted = true;
    const res = cam.unproject(x, y, z);
    if (isSpectator) cam._unprojectDiverted = false;

    return res;
  }

  project(vec) {
    const cam = this._main.getCamera();
    const isSpectator = this._main.getXRMode && this._main.getXRMode() &&
      (this._main._spectatorMode === 0 || this._main._spectatorMode === 1);

    if (isSpectator) cam._unprojectDiverted = true;
    const res = cam.project(vec);
    if (isSpectator) cam._unprojectDiverted = false;

    return res;
  }

  computePickedNormal() {
    if (!this._mesh || this._pickedFace < 0) return;
    // OPTIMIZATION: Fallback if normals are missing (e.g. Voxel Flat Shader)
    const normals = this._mesh.getNormals();
    if (normals && normals.length > 0) {
      this.polyLerp(normals, this._pickedNormal);
    } else {
      // Compute Face Normal
      const fAr = this._mesh.getFaces();
      const vAr = this._mesh.getVertices();
      const id = this._pickedFace * 4;
      const iv1 = fAr[id] * 3;
      const iv2 = fAr[id + 1] * 3;
      const iv3 = fAr[id + 2] * 3;

      const v1 = vAr.subarray(iv1, iv1 + 3);
      const v2 = vAr.subarray(iv2, iv2 + 3);
      const v3 = vAr.subarray(iv3, iv3 + 3);

      Geometry.triangleNormal(this._pickedNormal, v1, v2, v3);
    }
    return vec3.normalize(this._pickedNormal, this._pickedNormal);
  }

  polyLerp(vField, out) {
    var vAr = this._mesh.getVertices();
    var fAr = this._mesh.getFaces();
    var id = this._pickedFace * 4;
    var iv1 = fAr[id] * 3;
    var iv2 = fAr[id + 1] * 3;
    var iv3 = fAr[id + 2] * 3;

    var iv4 = fAr[id + 3];
    var isQuad = iv4 !== Utils.TRI_INDEX;
    if (isQuad) iv4 *= 3;

    var d1 = vec3.dist(this._interPoint, vAr.subarray(iv1, iv1 + 3));
    if (d1 < 1e-6) return vec3.copy(out, vField.subarray(iv1, iv1 + 3));
    var len1 = 1.0 / d1;

    var d2 = vec3.dist(this._interPoint, vAr.subarray(iv2, iv2 + 3));
    if (d2 < 1e-6) return vec3.copy(out, vField.subarray(iv2, iv2 + 3));
    var len2 = 1.0 / d2;

    var d3 = vec3.dist(this._interPoint, vAr.subarray(iv3, iv3 + 3));
    if (d3 < 1e-6) return vec3.copy(out, vField.subarray(iv3, iv3 + 3));
    var len3 = 1.0 / d3;

    var len4 = 0.0;
    if (isQuad) {
      var d4 = vec3.dist(this._interPoint, vAr.subarray(iv4, iv4 + 3));
      if (d4 < 1e-6) return vec3.copy(out, vField.subarray(iv4, iv4 + 3));
      len4 = 1.0 / d4;
    }

    var invSum = 1.0 / (len1 + len2 + len3 + len4);
    vec3.set(out, 0.0, 0.0, 0.0);
    vec3.scaleAndAdd(out, out, vField.subarray(iv1, iv1 + 3), len1 * invSum);
    vec3.scaleAndAdd(out, out, vField.subarray(iv2, iv2 + 3), len2 * invSum);
    vec3.scaleAndAdd(out, out, vField.subarray(iv3, iv3 + 3), len3 * invSum);
    if (isQuad) vec3.scaleAndAdd(out, out, vField.subarray(iv4, iv4 + 3), len4 * invSum);
    vec3.normalize(out, out);
    return out;
  }

  /** Intersection between a thick ray (segment) and a mesh */
  intersectionRayMeshThick(mesh, vNearOrig, vFarOrig, radiusSq) {
    var dir = _TMP_DIR_PICK;
    vec3.sub(dir, vFarOrig, vNearOrig);
    vec3.normalize(dir, dir);
    // reset picking
    this._mesh = null;
    this._pickedFace = -1;

    vec3.copy(_TMP_NEAR, vNearOrig);
    vec3.copy(_TMP_FAR, vFarOrig);

    // Apply Symmetry (Optional? For Gizmos usually irrelevant but good for consistency)
    if (this._xSym) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(_TMP_NEAR, ptPlane, nPlane);
      Geometry.mirrorPoint(_TMP_FAR, ptPlane, nPlane);
      // ON A POSED CHARACTER THE PLANE IS IN THE WRONG SPACE. Mirroring a posed point gives
      // where the other side WOULD be if it had never moved; it has moved. Shift the mirrored
      // ray onto the actual anatomy -- direction untouched, so this still lands on whatever
      // surface is really over there, which is what makes it right on an asymmetric mesh.
      // Null whenever the mesh is unbound or at bind pose, where the plain mirror is correct.
      var _po = PosedSymmetry.rayOffset(this._main, mesh, ptPlane, nPlane, _TMP_SYMOFF);
      if (_po) {
        vec3.add(_TMP_NEAR, _TMP_NEAR, _po);
        vec3.add(_TMP_FAR, _TMP_FAR, _po);
      }
    }

    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();

    var minRadiusSq = Infinity;
    var distance = Infinity; // distanceToCamera - keep for tie-breaking or mesh-sorting
    var nbFaces = fAr.length / 4; // Quads/Tris

    // We iterate ALL faces (Structure dependent)
    // Optimization: Check bounding box first? 
    // Gizmos are small, full iteration is fine.

    // Temp vars for Segment-Segment
    var closestRay = [0.0, 0.0, 0.0];
    var closestEdge = [0.0, 0.0, 0.0];

    for (var i = 0; i < nbFaces; ++i) {
      var indFace = i * 4;
      var iv1 = fAr[indFace] * 3;
      var iv2 = fAr[indFace + 1] * 3;
      var iv3 = fAr[indFace + 2] * 3;
      var iv4 = fAr[indFace + 3];

      _TMP_V1[0] = vAr[iv1]; _TMP_V1[1] = vAr[iv1 + 1]; _TMP_V1[2] = vAr[iv1 + 2];
      _TMP_V2[0] = vAr[iv2]; _TMP_V2[1] = vAr[iv2 + 1]; _TMP_V2[2] = vAr[iv2 + 2];
      _TMP_V3[0] = vAr[iv3]; _TMP_V3[1] = vAr[iv3 + 1]; _TMP_V3[2] = vAr[iv3 + 2];

      // Check Edge 1 (V1-V2)
      var d1 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V1, _TMP_V2, closestRay, closestEdge);
      if (window.debugPicking) {
        // Visual debug for close calls (within 5x radius)
        if (d1 < radiusSq * 25.0) {
          // We can't easily draw lines, but we can log or draw a sphere at the candidate
          // Need to transform closestEdge to World for debug view
          var worldPt = vec3.create();
          vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
          // Draw RED if miss, GREEN if hit (logic below)
          var isHit = d1 < radiusSq;
          // We need a way to accumulate debug points? 
          // For now, let's just use the main debug sphere for the BEST hit.
        }
      }

      if (d1 < radiusSq) {
        vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
        if (vec3.dot(_TMP_V1, dir) > 0.0001) {
          if (d1 < minRadiusSq) {
            minRadiusSq = d1;
            distance = vec3.sqrDist(_TMP_NEAR, closestRay);
            vec3.copy(this._interPoint, closestEdge); // Snap to Edge
            this._pickedFace = i;

            if (window.debugPicking) {
              var worldPt = vec3.create();
              vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
              if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true); // Green
            }
          }
        }
      }

      // Check Edge 2 (V2-V3)
      var d2 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V2, _TMP_V3, closestRay, closestEdge);
      if (d2 < radiusSq) {
        vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
        if (vec3.dot(_TMP_V1, dir) > 0.0001) {
          if (d2 < minRadiusSq) {
            minRadiusSq = d2;
            distance = vec3.sqrDist(_TMP_NEAR, closestRay);
            vec3.copy(this._interPoint, closestEdge);
            this._pickedFace = i;
            if (window.debugPicking) {
              var worldPt = vec3.create();
              vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
              if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
            }
          }
        }
      }

      // Check Edge 3 (V3-V1) or (V3-V4)
      if (iv4 === Utils.TRI_INDEX) {
        // Triangle
        var d3 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V3, _TMP_V1, closestRay, closestEdge);
        if (d3 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d3 < minRadiusSq) {
              minRadiusSq = d3;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }
      } else {
        // Quad (Check V3-V4 and V4-V1)
        var iv4i = iv4 * 3;
        var v4 = [vAr[iv4i], vAr[iv4i + 1], vAr[iv4i + 2]];

        // Edge 3 (V3-V4)
        var d3 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V3, v4, closestRay, closestEdge);
        if (d3 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d3 < minRadiusSq) {
              minRadiusSq = d3;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }

        // Edge 4 (V4-V1)
        var d4 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, v4, _TMP_V1, closestRay, closestEdge);
        if (d4 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d4 < minRadiusSq) {
              minRadiusSq = d4;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }
      }
    }

    if (this._pickedFace !== -1) {
      this._mesh = mesh;
      return true; // Match found
    }
    return false;
  }

  /** Intersection for VR (Bypasses Screen Projection) */
  intersectionRayMeshesVR(meshes, origin, direction, physicalRadius) {
    this._isVRHit = true;
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;

    // vNear = origin
    // vFar = origin + direction * length
    vec3.copy(_TMP_NEAR_1, origin);
    vec3.scaleAndAdd(_TMP_FAR_1, origin, direction, 100.0); // 100m range (better precision)

    // Scale physical radius to World Units (approximate, since picking is in local space usually)
    // Actually intersectionRayMesh takes Ray in Local Space.
    // So we need to scale the radius to Local Space.

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible()) continue;

      mat4.invert(_TMP_INV, mesh.getMatrix());
      vec3.transformMat4(_TMP_NEAR, _TMP_NEAR_1, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, _TMP_FAR_1, _TMP_INV);

      // Local Radius Squared
      // World Radius = physicalRadius (e.g. 0.05)
      // Local Radius = World Radius / Scale
      var scale = mesh.getScale();
      var localRadius = physicalRadius / scale;
      var localRadiusSq = localRadius * localRadius;

      // First check EXACT Ray Cast (Priority)
      var hitExact = this.intersectionRayMesh(mesh, _TMP_NEAR, _TMP_FAR);
      var hitThick = false;

      // If no exact hit, check Thick
      if (!hitExact) {
        hitThick = this.intersectionRayMeshThick(mesh, _TMP_NEAR, _TMP_FAR, localRadiusSq);
      }

      if (!hitExact && !hitThick) continue;

      var interTest = this.getIntersectionPoint();
      // Distance check (world space)
      vec3.transformMat4(_TMP_V1, interTest, mesh.getMatrix());
      var testDistance = vec3.dist(origin, _TMP_V1);

      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    this._mesh = nearMesh;
    vec3.copy(this._interPoint, _TMP_INTER_1);
    this._pickedFace = nearFace;

    // VR RADIUS FIX: Store in Engine Units (apply inverse vrScale)
    if (nearFace !== -1) {
      const vrScale = this._main._vrScale || 50.0;
      const pickingRadius = physicalRadius / vrScale;
      this._rWorld2 = pickingRadius * pickingRadius;
      // Parent-aware: convert world radius to LOCAL using the composed MODEL scale
      // (parentChain * _matrix), not the raw local getScale2(). For a parented child
      // these differ by the parent's scale — using local blows the radius up ~scale²
      // and the brush engulfs the whole mesh.
      const _msc = nearMesh.getModelSpaceScale ? nearMesh.getModelSpaceScale() : nearMesh.getScale();
      this._rLocal2 = this._rWorld2 / (_msc * _msc);
    } else {
      this._rLocal2 = 0.0;
    }

    return !!nearMesh;
  }
}

// TODO update i18n strings in a dynamic way
Picking.INIT_ALPHAS_NAMES = [TR('alphaSquare'), TR('alphaSkin')];
Picking.INIT_ALPHAS_PATHS = ['square.jpg', 'skin.jpg'];

var readAlphas = function () {
  // check nodejs
  if (!window.module || !window.module.exports) return;
  var fs = eval('require')('fs');
  var path = eval('require')('path');

  var directoryPath = path.join(window.__filename, '../resources/alpha');
  fs.readdir(directoryPath, function (err, files) {
    if (err) return;
    for (var i = 0; i < files.length; ++i) {
      var fname = files[i];
      if (fname == 'square.jpg' || fname == 'skin.jpg') continue;
      Picking.INIT_ALPHAS_NAMES.push(fname);
      Picking.INIT_ALPHAS_PATHS.push(fname);
    }
  });
};

readAlphas();

var none = TR('alphaNone');
Picking.ALPHAS_NAMES = {};
Picking.ALPHAS_NAMES[none] = none;

Picking.ALPHAS = {};
Picking.ALPHAS[none] = null;

export default Picking;
