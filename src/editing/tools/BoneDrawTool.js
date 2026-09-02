import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import Skeleton from '../Skeleton.js';
import Skinning from '../Skinning.js';
import IKSolver from '../IKSolver.js';

// Minimum gap between live weight re-solves while dragging a radius. Slow enough that a dense
// mesh keeps its framerate, fast enough that the recolour still reads as continuous.
const LIVE_WEIGHT_MS = 80;

// [Rigging POC#2 — phase 1] Bone drawing.
//
// Click-per-joint, not a continuous stroke. A stroke sounds faster but gives you hand
// jitter, an arbitrary joint count and no say in where the joints land — you would clean
// it up immediately, which costs more than placing four joints deliberately. Each click
// is decisive, and each click is one undo step.
//
// In VR the joint goes at the CONTROLLER TIP, not at a ray hit: joints belong inside the
// volume, and reaching into the arm is the whole reason this is worth doing in VR rather
// than on a screen. The tool arms the stylus xray ghost (Scene._updateStylusXray) so the
// tip stays visible once it is inside the mesh; the skeleton's own xray pass (Skeleton.js)
// does the same for the joints already placed. Joint placement is deliberately MANUAL —
// medial-axis auto-centring solves a 2D depth-perception problem we do not have here.
//
// Four modes, chosen in the mini panel on the non-dominant controller (three modes across
// two face buttons made every button change meaning by mode, which was unreadable):
//
// DRAW
//   trigger        place a joint, auto-parented to the previous one
//   trigger with a
//   joint hilit    start a new chain FROM that joint, so the new bone shares its root with
//                  the bones already there (this is how you branch: spine -> clavicles ->
//                  arms, with no separate parenting UI). Only offered between chains — mid
//                  chain, silently rewriting the hierarchy you are drawing is worse than a
//                  stray joint you can undo.
//   A button       end the chain (next trigger starts a new root)
//
// TWEAK FK / TWEAK FREE   edit the REST skeleton
//   trigger hold   grab the highlighted joint and drag it to the controller tip; FK lets
//                  the children follow, FREE pins them in world space
//
// RADIUS                  edit the BIND CAPSULES
//   trigger hold   grab the capsule nearest the tip; its radius follows the controller's
//                  distance from the bone, so you inflate the envelope until it contains the
//                  limb. The capsule is the exact support of the capsule bind, so this is
//                  weight editing with the geometry visible rather than a number to guess at.
//
// POSE                    move the CHARACTER
//   trigger hold   rotate the highlighted joint in place; children ride the rotation
//                  through the scene graph. Translation is ignored on purpose — posing
//                  must not quietly rewrite the rig's proportions.
//
// IK                      move the CHARACTER, full-body
//   A button       cycle the highlighted joint's pin: none -> position -> position+rotation
//                  (Mirai stop-motion pinning: a pin says "this stays where it is", and
//                  everything else rearranges around it). A position pin lets the limb above
//                  it swivel — right for a hand on a surface; a 6DOF pin also holds the
//                  joint's orientation, which is what keeps a foot flat on the ground.
//   trigger hold   drag the highlighted joint; the solver reaches for your hand with the
//                  whole skeleton, holding every pin. The grab is 6DOF — TURNING your hand
//                  turns the joint, and the rest of the rig is solved around that too, so
//                  pinning the feet and twisting the hips moves the whole body. With nothing
//                  pinned the chain root is the anchor, so a first drag reaches with the arm
//                  instead of flinging the character after your hand.
//
// With symmetry on, a mirrored joint is placed at the same time and named _L / _R. The
// naming looks like bureaucracy at POC stage, but mirrored weight paste, mirrored posing
// and any future retargeting all key off it, and it is free only at creation time. Tweak
// drags the mirrored twin along too, so a symmetric rig stays symmetric.
//
// Preselection highlights the nearest JOINT rather than the nearest bone shaft. Joints are
// the thing both actions actually operate on, and picking the shaft cannot address a
// chain's LAST joint at all (its only bone hangs above it), which would make continuing a
// finished chain impossible.

const _tip = new THREE.Vector3();
const _mirror = new THREE.Vector3();
const _pos = new THREE.Vector3();
// Separate scratch for the plane maths: `pos` handed to _place() may itself be one of the
// module scratch vectors, so the snapped result must never write through it.
const _eff = new THREE.Vector3();
const _from = new THREE.Vector3();
// Pose-mode scratch
const _qNow = new THREE.Quaternion(), _qDelta = new THREE.Quaternion();
const _qParent = new THREE.Quaternion(), _qJoint = new THREE.Quaternion();
const _mParent = new THREE.Matrix4(), _mLocal = new THREE.Matrix4();
const _vTmp = new THREE.Vector3(), _sTmp = new THREE.Vector3();

// Screen-input scratch. Kept separate from the pose scratch above: the screen path CALLS
// _poseTo, which clobbers every one of those on its way through.
const _rayO = new THREE.Vector3(), _rayD = new THREE.Vector3();
const _axis = new THREE.Vector3(), _hit = new THREE.Vector3();
const _jp = new THREE.Vector3(), _jp2 = new THREE.Vector3();
// Volume drag scratch: the joint's rotation inverted, and the controller delta in its frame.
const _mVolInv = new THREE.Matrix4();
const _vDelta = new THREE.Vector3();
const _vGrab = new THREE.Vector3();   // the tip plus the grab's held offset
const _qVolT = new THREE.Quaternion(), _qVolT2 = new THREE.Quaternion();
const _qNowV = new THREE.Quaternion(), _qDeltaV = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _wA = new THREE.Vector3(), _wB = new THREE.Vector3();
const _proj = new THREE.Vector3(), _qDrag = new THREE.Quaternion();
const _surf = new THREE.Vector3(), _mSurf = new THREE.Matrix4();
const _snapTo = new THREE.Vector3();
const _s0 = new THREE.Vector2(), _s1 = new THREE.Vector2();

// Distance in px from (px,py) to the segment a-b. The bone pick is a segment pick, not a
// joint pick — a capsule is grabbed anywhere along its shaft, which is where you look when
// you are judging whether it contains the limb.
function _distToSegment(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 1e-9 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(a.x + vx * t - px, a.y + vy * t - py);
}

class BoneDrawTool extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;

    this._chainParent = null;       // joint the next click parents to (null = new root)
    this._chainParentMirror = null; // its mirrored twin, when symmetry is on
    this._chainName = 'bone';
    this._chainIndex = 0;

    this._mode = 'draw';       // draw | tweak | pose | radius | ik
    this._compensate = true;   // tweak: pin the dragged joint's children in world space
    this._hilite = null;       // preselected joint
    this._grab = null;         // { joint, twin, snapshot } while dragging in tweak mode
    this._pose = null;         // { joint, qStart, local } while rotating in pose mode
    this._radius = null;       // { joint, twin, before } while dragging a capsule radius
    this._ik = null;           // { joint, before } while dragging an IK effector
    this._drag = null;         // { kind, joint, ... } while a mouse/touch drag owns the pointer

    this._wasXRPressed = false;
    this._wasAPressed = false;

    // Console escape hatch — VR round-trips are the expensive part of iterating on this.
    window._boneSetMode = (k) => { this.setModeKey(k); }; // draw | fk | free | pose
  }

  // Four modes, selected from the mini panel on the non-dominant controller:
  //   draw  place joints
  //   fk    tweak, children FOLLOW the dragged joint (plain forward kinematics)
  //   free  tweak, children STAY PUT (the dragged joint moves on its own — drag the knee,
  //         thigh and shin re-aim, foot and toes do not move)
  //   pose  ROTATE a joint in place; children ride the rotation through the scene graph,
  //         which is what makes FK free here. Tweak edits the rest skeleton, pose moves
  //         the character — two different jobs, so they are two different modes.
  modeKey() {
    if (this._mode === 'draw') return 'draw';
    if (this._mode === 'pose') return 'pose';
    if (this._mode === 'radius') return 'radius';
    // VOLUME: the gizmo sizes and places the selected joint's volume instead of posing the rig.
    // A mode rather than a modifier, because the gizmo means something else in every other one
    // and "why did my hips move" is not a question worth creating.
    if (this._mode === 'volume') return 'volume';
    if (this._mode === 'ik') return 'ik';
    return this._compensate ? 'free' : 'fk';
  }

  // Which path a joint drag takes is the thing that is hardest to see from inside the
  // headset — FK, free, pose and IK all look like "the bone moved" until you compare what the
  // REST of the chain did. One line per drag start, on the same flag the solver uses.
  _traceMode(what) {
    if (!window._ikTrace) return;
    console.log('[bones] ' + what + ' mode=' + this.modeKey()
      + ' (fk/free edit the rest skeleton and never call the solver)');
  }

  setModeKey(key) {
    const named = { draw: 'draw', pose: 'pose', radius: 'radius', ik: 'ik', volume: 'volume' };
    const mode = named[key] || 'tweak';
    const compensate = key !== 'fk';
    if (this._mode === mode && (mode !== 'tweak' || this._compensate === compensate)) return;
    this._mode = mode;
    this._compensate = compensate;
    this._drag = null;
    this._hot = false;
    this._releaseGrab(); this._releasePose(); this._releaseRadius(); this._releaseIK();
    this._releaseVolume();
    // The capsules are the whole point of radius mode, so turn them on when entering it
    // rather than making the user find a second toggle to make the mode visible.
    if (mode === 'radius') Skeleton.setDisplayFlag('capsules', true);
    // Same reasoning for volumes: the bone bodies ARE the volumes, so make sure they are drawn
    // rather than leaving the mode looking like it does nothing.
    if (mode === 'volume') Skeleton.setDisplayFlag('solid', true);
    // Leaving draw mode ends the chain — coming back to draw should start clean rather
    // than silently resuming a chain from before the detour.
    if (mode !== 'draw') this.endChain();
    Skeleton.hidePreview(this._main);
    Skeleton.setHighlight(this._main, null);
    this._hilite = null;
    this._refresh();
  }

  // A chain parent that has been undone out of the scene must not be parented to.
  _validParent() {
    const p = this._chainParent;
    if (p && this._main.getMeshes().includes(p)) return p;
    this._chainParent = this._chainParentMirror = null;
    return null;
  }

  // In VR the render loop already calls Skeleton.updateVisuals and draws every frame, and
  // calling render() from inside updateXR would be a re-entrant render — the exact failure
  // that broke playback during the vertex-recording work. Desktop renders on demand, so it
  // needs the explicit refresh.
  _refresh() {
    if (this._main._xrSession) return;
    // Before the render, not after: postRender also syncs the plane, but that runs once the
    // frame is already drawn, so a mode switch with nothing else moving would leave the
    // plane a frame behind — which on a still screen means invisible.
    this.syncPlane();
    Skeleton.updateVisuals(this._main);
    this._main.render();
  }

  // Scene -> outliner, deferred to AFTER the drag and OUT of the XR frame. Two reasons,
  // both of which bit when this ran at grab time instead:
  //   1. Scene.setMesh runs tool-context switching, which calls setToolIndex — and
  //      setToolIndex fires clearPreview() on the outgoing tool WITHOUT checking whether
  //      the tool actually changed. Since the "new" tool is Bones again, that cancelled the
  //      grab on the very frame it started, in every mode.
  //   2. setMesh ends in a render(), and rendering from inside updateXR is the re-entrant
  //      render that has broken the VR loop before.
  // A timeout leaves the XR frame entirely, and by then the grab is already committed.
  _selectLater(joint) {
    const main = this._main;
    // ...but AutoKey cannot wait for a timeout. It runs inside end(), in this frame, and reads
    // the CURRENT selection — which is still whatever was selected before the drag, typically
    // the skin. That is why posing a joint with AutoKey on keyed the mesh instead of the bone.
    // Record what was moved synchronously; the deferred selection below is for the outliner.
    main._lastRigEdit = joint || null;
    setTimeout(() => {
      if (joint && main.getMeshes().includes(joint)) main.setMesh?.(joint);
    }, 0);
  }

  endChain() {
    this._chainParent = this._chainParentMirror = null;
    this._chainIndex = 0;
    Skeleton.hidePreview(this._main);
  }

  // Snap radius for "did you click an existing joint" — scaled to the model so it is
  // forgiving on a big sculpt without swallowing neighbouring joints on a small one.
  _snapDist() { return Skeleton.sceneUnit(this._main) * 0.05; }

  // Band around the symmetry plane inside which a joint is pulled exactly onto it. ONE
  // threshold drives two consequences, which is what keeps the behaviour predictable:
  // inside the band a joint is centreline (snapped, and NOT mirrored, because a joint on
  // the plane is its own twin); outside it, the joint is a side joint and gets a mirror.
  _planeSnap() { return Skeleton.sceneUnit(this._main) * 0.05; }

  _snapEnabled() { return Skeleton.displayFlag('snapPlane'); }
  _axisEnabled() { return Skeleton.displayFlag('snapAxis'); }

  _onPlane(p, plane) {
    return !!plane && Math.abs(Skeleton.planeDistance(p, plane)) <= 1e-4;
  }

  // Resolve where a joint would actually land. Plane snap first, then axis snap, and the
  // order matters: snapping to the centreline changes whether the joint is on-plane, which
  // is what decides whether the plane's own normal is a legal axis to snap to.
  // `out` must not alias `pos`. `parent` may be null (a root joint has no direction).
  _resolve(pos, plane, out, parent) {
    let at = pos;
    if (this._inSnapBand(at, plane)) {
      at = Skeleton.projectToPlane(at, plane, out);
    }
    if (parent && this._axisEnabled()) {
      const from = Skeleton.jointPos(parent, _from);
      // Only guard the normal when BOTH ends sit on the plane; otherwise the bone is a
      // side bone and every axis is fair game (an eye pointing down Z, say).
      const guard = (this._onPlane(at, plane) && this._onPlane(from, plane))
        ? plane.normal : null;
      at = Skeleton.snapAxis(from, at, out, guard);
    }
    return at;
  }

  // Place one joint (plus its mirror) and advance the chain.
  _place(pos) {
    const main = this._main;
    const parent = this._validParent();

    // Clicking an existing joint re-roots the chain there instead of stacking a new joint
    // on top of it. Only when starting a chain — mid-chain it would silently rewrite the
    // hierarchy you are in the middle of drawing.
    if (!parent) {
      // Use the preselected joint when there is one, so what lit up is exactly what gets
      // used — recomputing here could disagree with the highlight the user was aiming at.
      const hit = this._hilite && main.getMeshes().includes(this._hilite)
        ? this._hilite
        : Skeleton.pickJoint(main, pos, this._snapDist());
      if (hit) {
        this._chainParent = hit;
        this._chainParentMirror = hit._boneMirror || null;
        this._chainIndex = 1;
        return;
      }
    }

    const plane = Skeleton.symmetryPlane(main);
    // Snap first, then classify — so a hip or spine joint lands EXACTLY on the centreline
    // and is then correctly read as on-plane (distance 0) rather than as a side joint that
    // happens to be close.
    const at = this._resolve(pos, plane, _eff, parent);
    // Signed distance: magnitude says whether this is a centreline joint (spine, head —
    // must NOT be duplicated), sign says which side.
    const sd = plane ? Skeleton.planeDistance(at, plane) : 0;
    // Classify on whether _resolve ACTUALLY snapped it (distance is then exactly 0), not on
    // a second reading of the band. The two used to be the same threshold; now that the
    // screen decides the band in px they would disagree, and a joint that was NOT snapped
    // would still be read as centreline — losing its mirror and its offset in one go.
    const offPlane = plane ? !this._onPlane(at, plane) : false;
    const side = offPlane ? (sd > 0 ? '_L' : '_R') : '';
    const base = this._chainName + '_' + String(this._chainIndex).padStart(2, '0');

    const joint = Skeleton.createJoint(main, at, parent, base + side);

    if (plane && offPlane) {
      Skeleton.mirrorPoint(at, plane, _mirror);
      const mParent = this._chainParentMirror && main.getMeshes().includes(this._chainParentMirror)
        ? this._chainParentMirror
        : parent; // first mirrored joint of a chain hangs off the shared (on-plane) parent
      const twin = Skeleton.createJoint(main, _mirror, mParent,
        base + (side === '_L' ? '_R' : '_L'));
      joint._boneMirror = twin;
      twin._boneMirror = joint;
      this._chainParentMirror = twin;
    } else {
      this._chainParentMirror = joint;
    }

    this._chainParent = joint;
    this._chainIndex++;
    // A JOINT IS BORN AT REST, and this is the only moment that is unambiguously true. The
    // solver evaluates keyed frames by putting every joint it owns back to rest first, so a
    // joint with no rest recorded has to adopt one later — from whatever pose the rig happened
    // to be in at the first scrub, which is the history the rest pose exists to remove. Filling
    // it here costs one matrix and makes drawing the rig the moment that defines it.
    IKSolver.captureRest(main);
    this._refresh();

    // Deep trace (window._boneTrace = true). Logs the requested position next to where the
    // joint actually ENDED UP after parenting — the two diverging is the signature of a
    // world/local transform problem, which is the failure mode this tool is most exposed to.
    if (window._boneTrace) {
      const at = Skeleton.jointPos(joint);
      console.log('[bone] place req(%s) got(%s) parent=%s idx=%d',
        pos.toArray().map((n) => n.toFixed(3)).join(','),
        at.toArray().map((n) => n.toFixed(3)).join(','),
        parent ? parent.getID() : 'none', this._chainIndex - 1);
    }
  }

  // ---- desktop / iPad ------------------------------------------------------------
  //
  // DRAW places the joint at the picked surface point. It cannot do better — there is no
  // depth channel on a flat screen, which is exactly the limitation this feature is built to
  // escape — so treat it as a way to rough a chain in and nudge it afterwards, not as the
  // real workflow.
  //
  // The other modes DO have a 2D answer, because none of them is placing a new joint in the
  // volume: they are moving, rotating or sizing something that already has a position. The
  // depth channel VR provides is only needed to INVENT a depth. So:
  //
  //   TWEAK / IK   drag in the camera-facing plane through the joint's current position.
  //                Depth is left exactly as it was, and orbiting gives you the other axis.
  //                This is what every DCC does, and it is honest — the screen never
  //                pretends to have supplied a depth it does not have.
  //   POSE         no translation is involved at all, so there is nothing to fake: lock the
  //                axis to the camera view axis and read the cursor's angular sweep around
  //                the joint's screen position. Straight off GeodesicPoseTool, which solved
  //                this exact problem for its bend.
  //   RADIUS       a radius is a distance from the bone, and a screen measures distance from
  //                a line perfectly well. Drag away from the shaft and the capsule inflates.
  //
  // Picking is done in SCREEN space, not by pushing the cursor into the volume: on a flat
  // screen the joint you mean is the one you can see under the pointer, and a model-space
  // proximity test against a ray would prefer whichever joint happened to be nearest the
  // camera along it.

  // Grab radius for the screen picks, in device px (`_mouseX/_mouseY` are already scaled by
  // the pixel ratio, and so is `_canvas.width`). Sized for a fingertip rather than a mouse —
  // iPad is the surface this is being built for, and a generous radius costs a mouse nothing.
  _pickPx() { return 26 * (this._main.getPixelRatio ? this._main.getPixelRatio() : 1); }

  // Model space is worldGroup-relative (see Skeleton.jointPos), and the worldGroup carries a
  // scale — so every conversion below goes through the group rather than assuming the two
  // spaces agree. Directions are transformed as a difference of two points, which stays
  // correct under that scale without needing to reason about it.
  _screenRay(outO, outD) {
    const main = this._main;
    const cam = main.getCamera && main.getCamera();
    const tcam = cam && cam.getThreeCamera && cam.getThreeCamera();
    const canvas = main._canvas;
    if (!tcam || !canvas || !canvas.width || !canvas.height) return false;
    const nx = (main._mouseX / canvas.width) * 2 - 1;
    const ny = -(main._mouseY / canvas.height) * 2 + 1;
    // Unproject both ends of the NDC ray by hand rather than via Raycaster.setFromCamera.
    // That helper branches on the camera's TYPE, and in orthographic mode this app keeps a
    // PerspectiveCamera object and swaps an ortho matrix into it — so the raycaster took its
    // perspective path against an ortho projection and built a ray that moved at roughly
    // twice the cursor's rate. Unprojecting near and far is correct for either projection
    // because it only ever consults the matrices, never the class.
    _wA.set(nx, ny, -1).applyMatrix4(tcam.projectionMatrixInverse).applyMatrix4(tcam.matrixWorld);
    _wB.set(nx, ny, 1).applyMatrix4(tcam.projectionMatrixInverse).applyMatrix4(tcam.matrixWorld);
    const wg = main._worldGroup;
    outO.copy(_wA);
    outD.copy(_wB);
    if (wg) { wg.worldToLocal(outO); wg.worldToLocal(outD); }
    outD.sub(outO).normalize();
    return true;
  }

  // Camera view axis in model space — the drag plane's normal, and pose's rotation axis.
  _camAxis(out) {
    const main = this._main;
    const cam = main.getCamera && main.getCamera();
    const tcam = cam && cam.getThreeCamera && cam.getThreeCamera();
    if (!tcam) return out.set(0, 0, -1);
    tcam.getWorldDirection(_wB);
    const wg = main._worldGroup;
    if (!wg) return out.copy(_wB).normalize();
    _wA.set(0, 0, 0);
    wg.worldToLocal(_wA); wg.worldToLocal(_wB);
    return out.copy(_wB).sub(_wA).normalize();
  }

  // Where the cursor ray meets the camera-facing plane through `anchor` (model space).
  _planePoint(anchor, out) {
    if (!this._screenRay(_rayO, _rayD)) return false;
    this._camAxis(_axis);
    const denom = _axis.dot(_rayD);
    if (Math.abs(denom) < 1e-9) return false; // ray parallel to the plane: no useful answer
    const t = _axis.dot(_wA.copy(anchor).sub(_rayO)) / denom;
    out.copy(_rayO).addScaledVector(_rayD, t);
    return true;
  }

  // Model-space point -> canvas device px. Returns false for anything behind the camera,
  // which would otherwise project to a mirrored position and read as a near hit.
  _toScreen(pos, out) {
    const main = this._main;
    const cam = main.getCamera && main.getCamera();
    const tcam = cam && cam.getThreeCamera && cam.getThreeCamera();
    const canvas = main._canvas;
    if (!tcam || !canvas) return false;
    _proj.copy(pos);
    if (main._worldGroup) main._worldGroup.localToWorld(_proj);
    _proj.project(tcam);
    if (_proj.z > 1) return false;
    out.set((_proj.x * 0.5 + 0.5) * canvas.width, (-_proj.y * 0.5 + 0.5) * canvas.height);
    return true;
  }

  _pickJointScreen() {
    const main = this._main;
    const mx = main._mouseX, my = main._mouseY;
    let best = null, bestD = this._pickPx();
    for (const j of Skeleton.joints(main)) {
      if (!Skeleton.jointVisible(j)) continue; // as in VR: never grab what you cannot see
      Skeleton.jointPos(j, _jp);
      if (!this._toScreen(_jp, _s0)) continue;
      const d = Math.hypot(_s0.x - mx, _s0.y - my);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  // The screen twin of _pickBone. Capped rather than "nearest anywhere": an uncapped pick
  // means a click on empty space grabs some distant capsule and starts resizing it.
  _pickBoneScreen() {
    const main = this._main;
    const mx = main._mouseX, my = main._mouseY;
    let best = null, bestD = this._pickPx() * 4;
    for (const j of Skeleton.joints(main)) {
      if (!Skeleton.jointVisible(j)) continue;
      const parent = j._parentMesh;
      if (!Skeleton.isJoint(parent) || !main.getMeshes().includes(parent)) continue;
      Skeleton.jointPos(j, _jp);
      Skeleton.jointPos(parent, _jp2);
      if (!this._toScreen(_jp, _s0) || !this._toScreen(_jp2, _s1)) continue;
      const d = _distToSegment(mx, my, _s1, _s0);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  // Movement below this (device px) is a TAP, not a drag. Only IK reads it, to tell "cycle
  // this joint's pin" from "reach with this joint" — the A button that does the former in VR
  // has no equivalent here, and a tap on the thing being pinned is the same gesture in
  // spirit: point at a joint and commit.
  _tapPx() { return 6 * (this._main.getPixelRatio ? this._main.getPixelRatio() : 1); }

  // Model-space point under the cursor, from the surface pick. `fresh` re-runs the raycast;
  // pass false to reuse the pick SculptBase.preUpdate has already done this move, which is
  // the difference between one raycast per pointer move on a dense sculpt and two.
  _surfacePoint(out, fresh) {
    const picking = this._main.getPicking();
    if (fresh && !picking.intersectionMouseMeshes()) return null;
    const m = picking.getMesh();
    const inter = picking.getIntersectionPoint();
    if (!m || !inter) return null;
    return out.set(inter[0], inter[1], inter[2])
      .applyMatrix4(_mSurf.fromArray(m.getModelSpaceMatrix()));
  }

  // Placing a joint ON TOP OF the one it would hang from is the gesture that ends the chain
  // when there is no keyboard — a zero-length bone is never a thing you meant, so the only
  // reading left is "done". 12 CSS px rather than the 5 a mouse would want: this exists for
  // the iPad, and a fingertip does not land inside 5.
  _endTapPx() { return 12 * (this._main.getPixelRatio ? this._main.getPixelRatio() : 1); }

  // Is there anything in the scene to press ON? A rig outlives the mesh it was built against.
  _hasSculpt() {
    return (this._main.getMeshes() || []).some(
      (m) => !Skeleton.isJoint(m) && !m._isNull && m.isVisible?.() !== false);
  }

  // Is the cursor on the joint that lit up? _place already re-roots the chain onto _hilite,
  // so this is only asking whether the press should be allowed to reach it.
  _onHilitedJoint() {
    const h = this._hilite;
    return !!(h && this._main.getMeshes().includes(h) && this._pickJointScreen() === h);
  }

  _isEndTap(parent) {
    if (!parent) return false;
    Skeleton.jointPos(parent, _jp);
    if (!this._toScreen(_jp, _s0)) return false;
    const main = this._main;
    return Math.hypot(_s0.x - main._mouseX, _s0.y - main._mouseY) <= this._endTapPx();
  }

  start() {
    if (this._main._xrSession) return false; // VR drives everything from updateXR
    if (this._mode === 'draw') return this._startDraw();
    return this._startScreenDrag();
  }

  // Draw is press-drag-release, not click-to-commit. The joint is not placed until release,
  // so the drag is a chance to see where it will land — with the symmetry plane drawn and
  // lighting up as you cross its snap band — instead of committing blind and undoing.
  _startDraw() {
    this._traceMode('draw');
    // Mid-chain a press anywhere is meant — the depth comes from the parent, so the mesh has
    // nothing to say about it and a chain can run out past the silhouette. Between chains
    // the press must land on the sculpt: it is where the first joint's depth comes from, and
    // it is what leaves left-drag free to orbit when you are not drawing anything.
    const parent = this._validParent();
    // Between chains the press must land on the sculpt OR on a preselected joint. Not
    // because the depth comes from there any more — it does not — but so that left-drag is
    // still free to orbit when you are not drawing.
    //
    // The joint case is what BRANCHING is: press the neck to grow the arms from it. Gating
    // on the surface pick alone lost it entirely, because the joint you are aiming at is
    // usually the one place the cursor is NOT over unbroken sculpt — it sits in the hollow
    // at a shoulder, or past the silhouette on a rig whose mesh has been deleted.
    // ...and the surface gate only applies when there IS a sculpt to press on. With the mesh
    // deleted there is nothing to hit, so requiring a hit meant no chain could ever be
    // started — VR has no such problem, because it places at the controller tip and never
    // asks the mesh anything. Nothing to orbit around either, so nothing is lost.
    if (!parent && !this._onHilitedJoint()
        && this._hasSculpt() && !this._surfacePoint(_surf, true)) return false;
    const anchor = this._drawAnchor(_jp2);
    if (!anchor || !this._planePoint(anchor, _hit)) return false;
    this._drag = { kind: 'draw', pos: _hit.clone(), anchor: anchor.clone() };
    this._drawFeedback(this._drag.pos);
    return true;
  }

  // The snap plane is a persistent piece of the tool's furniture, not a hover effect. It
  // answers "where is x = 0", and that question does not come and go with the pointer — a
  // plane that blinks in and out is worse than no plane, because you cannot line anything up
  // against it. Drawn for the modes where a snap actually applies (Draw and Tweak, as in
  // VR); the modes that move a character rather than edit the rest skeleton hide it.
  //
  // `_hot` (the candidate joint is inside the snap band, so it WILL land on the centreline)
  // only brightens it. That is a reading of the plane, not a decision about showing it.
  syncPlane() {
    const main = this._main;
    if (main._xrSession) return; // updateXR owns the plane there
    const wants = this._mode === 'draw' || this._mode === 'tweak';
    const plane = wants && this._snapEnabled() ? Skeleton.symmetryPlane(main) : null;
    if (!plane) { Skeleton.hidePlane(main); return; }
    // The cursor goes with it: the plane sizes itself to stay clear of where you are drawing.
    Skeleton.updatePlane(main, plane, !!this._hot, this._drag ? this._drag.pos : null);
  }

  // Model-space centre of the sculpt — the depth a joint gets when there is no plane and no
  // parent to take one from. Its own bounding sphere, carried into model space the same way
  // sceneUnit does it.
  _modelCentre(out) {
    const main = this._main;
    let best = null, bestR = 0;
    for (const m of main.getMeshes() || []) {
      if (Skeleton.isJoint(m) || m._isNull) continue;
      const tm = m.getThreeMesh && m.getThreeMesh();
      const g = tm && tm.geometry;
      if (!g) continue;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs || !Number.isFinite(bs.radius)) continue;
      if (bs.radius > bestR) { bestR = bs.radius; best = { bs: bs, m: m }; }
    }
    if (best) {
      out.copy(best.bs.center);
      if (best.m.getModelSpaceMatrix) out.applyMatrix4(_mSurf.fromArray(best.m.getModelSpaceMatrix()));
      return out;
    }
    // No sculpt: use the skeleton's own centre, so a rig can still be extended after the
    // mesh it was built against is gone. Origin only when there is nothing at all.
    const js = Skeleton.joints(main);
    out.set(0, 0, 0);
    if (!js.length) return out;
    for (const j of js) out.add(Skeleton.jointPos(j, _jp));
    return out.divideScalar(js.length);
  }

  // Depth for the camera-facing plane the tip rides in:
  //   mid-chain   the joint you are continuing from
  //   new chain   the middle of the sculpt
  //
  // Notably NOT the surface pick. Taking the root's depth off the skin put the first joint
  // on the surface, and every joint after it inherited that depth — so a whole chain sat on
  // the shell of the model, the one place a bone never belongs, and the exact 2D problem
  // that made this feature VR-first.
  //
  // The middle of the sculpt rather than where the cursor ray crosses the symmetry plane:
  // the ray only crosses the plane at the eye when the CAMERA sits on it, which is precisely
  // what a front view of a symmetric character is. That construction quietly never fired
  // from the most ordinary viewpoint there is. Mid-depth works from every angle, and the
  // centreline is still one thing away — the plane snap pulls the joint exactly onto it as
  // soon as the cursor is near it on screen.
  _drawAnchor(out) {
    const parent = this._validParent();
    if (parent) return Skeleton.jointPos(parent, out);
    return this._modelCentre(out);
  }

  // Where the tip is right now: the cursor ray, met by the camera-facing plane at that depth.
  _drawPoint(out) {
    const anchor = this._drawAnchor(_jp2);
    if (!anchor) return null;
    return this._planePoint(anchor, out) ? out : null;
  }

  // The plane snap band, in SCREEN px. It used to be 5% of a scene unit — a hand-width,
  // which is the right unit for a controller in VR and the wrong one entirely for a screen:
  // it scales with whatever else is in the scene, and on a normal rig it had grown wide
  // enough to swallow the model, so every joint landed on the centreline whether you meant
  // it or not. Px is what you are actually aiming with.
  _planeSnapPx() { return 14 * (this._main.getPixelRatio ? this._main.getPixelRatio() : 1); }

  // Is `pos` close enough to the plane to snap? VR keeps the model-space band it was tuned
  // with; the screen asks the question in the units the screen has.
  _inSnapBand(pos, plane) {
    if (!plane || !this._snapEnabled()) return false;
    if (this._main._xrSession) {
      return Math.abs(Skeleton.planeDistance(pos, plane)) <= this._planeSnap();
    }
    Skeleton.projectToPlane(pos, plane, _snapTo);
    if (!this._toScreen(pos, _s0) || !this._toScreen(_snapTo, _s1)) return false;
    return Math.hypot(_s0.x - _s1.x, _s0.y - _s1.y) <= this._planeSnapPx();
  }

  // Preview bone + plane state for a candidate position. Shows the RESOLVED point — where
  // the joint will actually land once snapping is applied — so what you see is what commits.
  _drawFeedback(pos) {
    const main = this._main;
    const plane = Skeleton.symmetryPlane(main);
    const parent = this._validParent();
    this._hot = !!plane && this._snapEnabled()
      && Math.abs(Skeleton.planeDistance(pos, plane)) <= this._planeSnap();
    Skeleton.showPreview(main, parent ? Skeleton.jointPos(parent, _pos) : null,
      this._resolve(pos, plane, _eff, parent));
    this._refresh();
  }

  // Returning TRUE is what claims the drag: SculptGL puts the pointer into SCULPT_EDIT and
  // stops the camera taking it. Returning false on a miss is equally deliberate — a click
  // that hit no joint must still orbit, or the tool would eat every camera move.
  _startScreenDrag() {
    this._traceMode('screen drag');
    const main = this._main;
    const startX = main._mouseX, startY = main._mouseY;

    if (this._mode === 'radius') {
      const bone = this._pickBoneScreen();
      if (!bone) return false;
      // Anchor the plane on the bone's MIDPOINT, not on the joint: the radius is a distance
      // from the shaft, so the plane you drag in should contain the shaft you are measuring.
      Skeleton.jointPos(bone, _jp);
      Skeleton.jointPos(bone._parentMesh, _jp2);
      const anchor = _jp.clone().add(_jp2).multiplyScalar(0.5);
      this._beginRadius(bone);
      this._drag = { kind: 'radius', joint: bone, anchor: anchor, startX: startX, startY: startY };
      this._hilite = bone;
      Skeleton.setHighlight(main, bone);
      return true;
    }

    const joint = this._pickJointScreen();
    if (!joint) return false;

    // VOLUME mode selects and stops — the gizmo is the editor here, not the drag.
    if (this._mode === 'volume') {
      this._hilite = joint;
      Skeleton.setHighlight(main, joint);
      this._selectLater(joint);
      return true;
    }

    Skeleton.jointPos(joint, _jp);
    const anchor = _jp.clone();
    this._hilite = joint;
    Skeleton.setHighlight(main, joint);

    if (this._mode === 'pose') {
      // Identity at the grab makes _poseTo's stored inverse identity too, so the quaternion
      // handed to it each frame IS the accumulated model-space delta — no controller to
      // measure against, and none needed.
      this._beginPose(joint, [0, 0, 0, 1]);
      const screen = new THREE.Vector2();
      this._toScreen(anchor, screen);
      this._drag = {
        kind: 'pose', joint: joint, screen: screen,
        // Axis is locked at the grab, as in GeodesicPoseTool: an axis that followed the
        // camera would rewrite the meaning of the sweep already accumulated.
        axis: this._camAxis(new THREE.Vector3()),
        last: Math.atan2(startY - screen.y, startX - screen.x),
        total: 0, startX: startX, startY: startY,
      };
      return true;
    }

    // TWEAK and IK both drag a position in the camera-facing plane. Hold the offset between
    // the cursor and the joint so the joint does not jump to the pointer on the first frame.
    const d = { kind: this._mode === 'ik' ? 'ik' : 'tweak', joint: joint, anchor: anchor,
                offset: new THREE.Vector3(), startX: startX, startY: startY, moved: false };
    if (this._planePoint(anchor, _hit)) d.offset.copy(anchor).sub(_hit);
    this._drag = d;

    // IK does NOT begin the solve here. A tap is a pin cycle, and _beginIK snapshots every
    // joint and _releaseIK pushes an undo — so starting one for a gesture that turns out to
    // be a tap would put an empty "IK Pose" step in the history for every pin press.
    if (d.kind === 'tweak') this._beginGrab(joint);
    return true;
  }

  update() {
    if (this._main._xrSession) return;
    const d = this._drag;
    if (!d) return;
    const main = this._main;

    if (d.kind === 'draw') {
      // The anchor is fixed for the whole drag, so the tip rides one plane and follows the
      // cursor everywhere — off the silhouette included.
      if (this._planePoint(d.anchor, _hit)) d.pos.copy(_hit);
      this._drawFeedback(d.pos);
      return;
    }

    if (d.kind === 'pose') {
      const cur = Math.atan2(main._mouseY - d.screen.y, main._mouseX - d.screen.x);
      let da = cur - d.last;
      // Unwrap, or dragging across the -pi/pi seam snaps the joint through a half turn.
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      d.total += da;
      d.last = cur;
      _qDrag.setFromAxisAngle(d.axis, d.total);
      this._poseTo([_qDrag.x, _qDrag.y, _qDrag.z, _qDrag.w]);
      return;
    }

    if (d.kind === 'radius') {
      if (this._planePoint(d.anchor, _hit)) this._radiusTo(_hit);
      return;
    }

    if (!this._planePoint(d.anchor, _hit)) return;
    _hit.add(d.offset);

    if (d.kind === 'tweak') { this._dragTo(_hit); return; }

    // IK: the first movement past the tap threshold promotes the gesture to a solve.
    if (!d.moved) {
      if (Math.hypot(main._mouseX - d.startX, main._mouseY - d.startY) < this._tapPx()) return;
      d.moved = true;
      this._beginIK(d.joint, null); // no rotation channel from a plain drag — position only
    }
    this._ikTo(_hit, null);
  }

  end() {
    if (this._main._xrSession) return;
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    if (d.kind === 'draw') {
      this._hot = false; // the plane stays; only its "you are about to snap" reading clears
      // Released on the joint it would hang from: that is the end-of-chain gesture, not a
      // zero-length bone. Checked before _place so nothing is created and nothing to undo.
      if (this._isEndTap(this._validParent())) {
        this.endChain();
        if (window.screenLog) window.screenLog('Bones: chain ended', 'cyan');
        this._refresh();
        return;
      }
      this._place(d.pos);
      Skeleton.hidePreview(this._main);
      this._refresh();
      return;
    }
    if (d.kind === 'tweak') this._releaseGrab();
    else if (d.kind === 'pose') this._releasePose();
    else if (d.kind === 'radius') this._releaseRadius();
    else if (d.moved) this._releaseIK();
    else this._togglePin(d.joint); // tap in IK mode = cycle the pin (the VR A button)
  }

  // Hover preselection, the desktop twin of the highlight updateXR maintains from the tip.
  // Gated on an actual change: this runs on every pointer move, and _refresh renders.
  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous);
    if (this._main._xrSession) return;

    if (this._mode === 'draw') {
      if (this._drag) return; // the drag owns the feedback; update() is already driving it
      const main = this._main;
      // Between chains, preselect the nearest joint so a press there ROOTS the new chain at
      // it rather than dropping a loose joint on top — the same branching gesture as in VR,
      // and _place reads _hilite so what lit up is exactly what gets used.
      const parent = this._validParent();
      const hilite = parent ? null : this._pickJointScreen();
      if (hilite !== this._hilite) {
        this._hilite = hilite;
        Skeleton.setHighlight(main, hilite);
        this._refresh();
      }
      // Hover preview of the next bone, so a chain is drawn by moving and pressing rather
      // than by pressing and hoping. Mid-chain it previews anywhere; between chains it is
      // shown only where a press would actually place one, so the preview never promises a
      // joint that a press would turn into a camera orbit. super.preUpdate already ran the
      // pick this move, so the gate costs no second raycast.
      // `hilite` was just picked above, so reuse it rather than picking every joint twice per
      // pointer move. It stands in for _onHilitedJoint: a lit joint is a place a press works.
      const canPlace = parent || hilite || !this._hasSculpt() || this._surfacePoint(_surf, false);
      const at = canPlace ? this._drawPoint(_hit) : null;
      if (at) { this._previewOn = true; this._drawFeedback(at); }
      else if (this._previewOn) {
        // Only once on leaving the silhouette: this runs on every pointer move, and off-mesh
        // is where the cursor spends most of its time. The plane is not touched — it is not
        // a hover effect, and postRender keeps it up.
        this._previewOn = false;
        this._hot = false;
        Skeleton.hidePreview(main); this._refresh();
      }
      return;
    }

    const hit = this._drag ? this._drag.joint
      : (this._mode === 'radius' ? this._pickBoneScreen() : this._pickJointScreen());
    if (hit === this._hilite) return;
    this._hilite = hit;
    Skeleton.setHighlight(this._main, hit);
    this._refresh();
  }

  // The single-action debounce in SculptManager exists for tools whose whole operation runs
  // inside start(); it is keyed on `_continuous === false`, which this tool is. Nothing here
  // happens in start() any more — every desktop mode is press-drag-release, Draw included —
  // so the debounce could only block a second deliberate gesture begun within 300ms of the
  // last. Worse, blocking start() mid-drag clears SculptManager's _strokeActive, and the
  // release that should have placed the joint would never reach end().
  isDragAction() { return !this._main._xrSession; }

  // Escape / Enter, routed from SculptGL.onKeyDown. Two presses, matching what A does on the
  // controller: the first ends the chain, the second leaves drawing altogether. Returns true
  // when the key was consumed, so an unhandled key still reaches the app's own shortcuts.
  onKeyDown(e) {
    if (this._main._xrSession || this._mode !== 'draw') return false;
    if (e.key !== 'Escape' && e.key !== 'Enter') return false;
    if (this._validParent()) {
      this.endChain();
      if (window.screenLog) window.screenLog('Bones: chain ended - again to stop drawing', 'cyan');
    } else {
      // Pose, not some inert state: there isn't one, and it is what you want next after
      // drawing a skeleton. Same landing as the controller's second A press.
      this.setModeKey('pose');
      if (window.screenLog) window.screenLog('Bones: drawing off - Pose mode', 'cyan');
      try { this._main._miniPanel?.syncFromState?.(); } catch (_) {}
      try { this._main._boneSectionRebuild?.(); } catch (_) {}
    }
    Skeleton.hidePreview(this._main);
    Skeleton.hidePlane(this._main);
    this._refresh();
    return true;
  }

  // ---- tweak --------------------------------------------------------------------

  // `quat` is the controller orientation at the grab, when there is one. Tweak is a 6DOF grab
  // in the headset: you take hold of a joint and your hand both moves AND turns, and until now
  // only the movement was read. matt: "tweak fk should support rotation, so if i twist my
  // controller around, the entire child hierarchy should rotate."
  //
  // The hierarchy following is free — children are parented, so in FK they ride the rotation
  // through the scene graph. In Tweak FREE they do not, because that mode explicitly restores
  // each child's model-space transform afterwards, which is exactly what "free" means.
  _beginGrab(joint, quat, tip) {
    const main = this._main;
    // Resolve the symmetry plane ONCE per grab, not per frame: it walks every mesh, and a
    // plane that shifted mid-drag would make the mirrored joint wander independently.
    const plane = Skeleton.symmetryPlane(main);
    const twin = (plane && joint._boneMirror && main.getMeshes().includes(joint._boneMirror))
      ? joint._boneMirror : null;
    // Snapshot the exact set moveJoint writes — the joint and its direct children — for
    // both lanes, so one undo restores the whole edit including the compensation.
    const snapshot = Skeleton.captureLocal(main, joint)
      .concat(twin ? Skeleton.captureLocal(main, twin) : []);
    // HOLD THE OFFSET BETWEEN THE HAND AND THE JOINT.
    //
    // Without it the joint is written straight to the controller tip, so it JUMPS to your hand
    // the instant you grab it and then follows 1:1 — which is what matt was seeing and reading
    // as a runaway: "the hips will drag themselves away from the body, the head will zap off to
    // somewhere crazy." The trace showed it plainly: joint.y and joint.z equal to tip.y and
    // tip.z on every frame, with the gap constant. Nothing was compounding; the very first
    // frame had already moved it.
    //
    // The desktop path has held this offset all along ("so the joint does not jump to the
    // pointer on the first frame") — the VR path simply never did. A grab should move the joint
    // WITH your hand, not TO it.
    // A REST EDIT IS IN PROGRESS — HOLD THE SOLVER OFF.
    //
    // Scene watches the pins every frame and re-solves when one appears to have moved, so that
    // dragging a pin with the gizmo rearranges the chain. Tweak edits the REST skeleton, which
    // moves joints — so the watcher read every frame of a tweak as "a pin moved", solved, and
    // moved the children; the compensation then preserved their new positions, and the watcher
    // saw movement again. A loop between two features that are each correct on their own, which
    // is why it only appeared with a pin in the rig: matt's clean trace had pins=0, the runaway
    // one had pins=1.
    main._rigRestEdit = true;
    const tipOffset = tip ? Skeleton.jointPos(joint, _jp2).clone().sub(tip) : null;
    this._grab = { joint: joint, twin: twin, plane: plane, before: snapshot, tipOffset: tipOffset,
      // A TAP IS A SELECT; ONLY A DELIBERATE MOVE IS A DRAG.
      //
      // Nothing was wrong with the drag itself — the trace showed the joint tracking the hand
      // 1:1, no drift, no pins, no loop. The fault was that there is no way to merely SELECT a
      // joint in this mode: pressing the trigger anywhere near one starts moving it, and a hand
      // held still for a second still wanders a few centimetres, which the joint faithfully
      // follows. matt was trying to "select the hips to change them to the dome type" and
      // watched them walk away from the body.
      //
      // So the grab starts UNARMED and only begins writing once the hand has travelled past a
      // threshold — the same tap-versus-drag rule the desktop IK path already uses. Release
      // without arming and the press was a selection, which _releaseGrab already performs.
      startTip: tip ? tip.clone() : null, armed: !tip,
      // Inverted at the grab so every frame is measured against that ONE pose. A frame-to-frame
      // delta composes into a ratchet that never returns to zero.
      qStart: quat ? new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]).invert() : null,
      localAtGrab: mat4.clone(joint.getMatrix()),
      twinLocalAtGrab: twin ? mat4.clone(twin.getMatrix()) : null };
  }

  _dragTo(pos, quat) {
    const g = this._grab;
    if (!g) return;
    // The VR grab carries the hand-to-joint offset; the desktop drag has already applied its
    // own before calling in, so only one of the two is ever present.
    if (g.tipOffset) pos = _vGrab.copy(pos).add(g.tipOffset);
    // A joint WITH a twin is by definition a side joint, so snapping it to the centreline
    // would contradict its own mirror. Only centreline joints snap while dragging.
    // A joint WITH a twin is by definition a side joint, so plane-snapping it would
    // contradict its own mirror — but axis snap still applies, which is what keeps a
    // dragged eye joint pointing straight down Z.
    const gp = Skeleton.isJoint(g.joint._parentMesh) ? g.joint._parentMesh : null;
    const at = g.twin
      ? (this._axisEnabled() && gp ? Skeleton.snapAxis(Skeleton.jointPos(gp, _from), pos, _eff, null) : pos)
      : this._resolve(pos, g.plane, _eff, gp);
    // ROTATION FIRST, then position. moveJoint writes the model-space TRANSLATION and, in
    // compensate mode, restores each child's model-space transform afterwards — so it has to be
    // the last thing that touches the chain, or the compensation is computed against a parent
    // frame that is about to turn.
    // TWO SWITCHES, so the runaway can be cornered from the console instead of by argument.
    // `_boneCompensate = false` drops the child pinning; `_boneTwist = false` drops the
    // controller's ROTATION. Whichever one stops it names the culprit, and either is a usable
    // workaround in the meantime.
    // THE COMPENSATION BRACKETS BOTH WRITES. The twist rotates the joint and the move
    // translates it; children have to be held still across the pair, not across the second one
    // alone — see Skeleton.beginCompensate. Leaving it to moveJoint compensated the translation
    // and let the rotation's swing accumulate, one frame's worth at a time.
    const compensating = window._boneCompensate === false ? false : this._compensate;
    const comp = compensating ? Skeleton.beginCompensate(this._main, g.joint) : null;
    if (quat && g.qStart && window._boneTwist !== false) this._twistTo(g.joint, g.localAtGrab, quat);
    Skeleton.moveJoint(this._main, g.joint, at, false);
    if (comp) Skeleton.endCompensate(comp);
    if (g.twin && g.plane) {
      // The twin is deliberately NOT twisted: a mirrored rotation is not the same rotation, and
      // guessing which reflection was meant is how a symmetric rig comes back asymmetric. The
      // mirror follows position only, which is what it has always done.
      Skeleton.mirrorPoint(at, g.plane, _mirror);
      Skeleton.moveJoint(this._main, g.twin, _mirror, this._compensate);
    }
    this._refresh();
  }

  // The controller's rotation since the grab, applied about the joint's own origin. Same maths
  // as _poseTo — carried into the parent's frame first, or a rotation applied to a joint deep in
  // a posed chain is measured against the wrong frame and skews as the chain moves.
  _twistTo(joint, localAtGrab, quat) {
    const g = this._grab;
    _qNow.set(quat[0], quat[1], quat[2], quat[3]);
    _qDelta.copy(_qNow).multiply(g.qStart);
    const parent = joint._parentMesh;
    if (parent && parent.getModelSpaceMatrix) {
      _mParent.fromArray(parent.getModelSpaceMatrix());
      _mParent.decompose(_vTmp, _qParent, _sTmp);
      _qDelta.premultiply(_qParent.clone().invert()).multiply(_qParent);
    }
    _mLocal.fromArray(localAtGrab);
    _mLocal.decompose(_vTmp, _qJoint, _sTmp);
    _qJoint.premultiply(_qDelta);
    _mLocal.compose(_vTmp, _qJoint, _sTmp);
    mat4.copy(joint.getMatrix(), _mLocal.elements);
    Skeleton.syncThree(joint);
  }

  // One undo step per volume edit, holding both numbers: a resize and a move are the same
  // gesture with a different button, and either way what you want back is "how it was".
  _releaseVolume() {
    const vd = this._volDrag;
    this._volDrag = null;
    if (!vd) return;
    const j = vd.joint;
    const rotArr = (q) => [q.x, q.y, q.z, q.w];
    const before = { dims: vd.dims.slice(), off: vd.off.slice(),
      rot: rotArr(vd.rot || Skeleton.jointVolRot(j)) };
    const after = {
      dims: Skeleton.jointVolDims(this._main, j).slice(),
      off: Skeleton.jointVolOffset(this._main, j).slice(),
      rot: rotArr(Skeleton.jointVolRot(j)),
    };
    const same = before.dims.every((v, i) => v === after.dims[i])
      && before.off.every((v, i) => v === after.off[i])
      && before.rot.every((v, i) => v === after.rot[i]);
    if (same) return;   // a tap that selected and moved nothing is not an undo step
    const main = this._main;
    const apply = (st) => {
      Skeleton.setJointVolDims(j, st.dims[0], st.dims[1], st.dims[2]);
      Skeleton.setJointVolOffset(j, st.off[0], st.off[1], st.off[2]);
      Skeleton.setJointVolRot(j, { x: st.rot[0], y: st.rot[1], z: st.rot[2], w: st.rot[3] });
      Skeleton.updateVisuals(main);
      main.render?.();
    };
    main.getStateManager?.()?.pushStateCustom?.(
      () => apply(before), () => apply(after), false, 'Bone Volume');
  }

  _releaseGrab() {
    const g = this._grab;
    this._grab = null;
    this._grabHand = null;
    // The rig has a new rest; re-seed the watcher's caches BEFORE letting it look again, or the
    // whole edit reads as one enormous external move and is solved away in a single frame.
    this._main._rigRestEdit = false;
    IKSolver.syncPinCache?.(this._main);
    IKSolver.syncJointCache?.(this._main);
    if (!g) return;
    // Tweak edits the REST skeleton, and where a knee sits in the rest pose is the statement
    // of which way it bends. Drop the remembered preferences so the next solve re-reads them.
    IKSolver.clearBendRefs(this._main);
    // Tweak edits the REST skeleton, so the joints it moved have a new rest — and only those.
    // A blanket re-capture here would enshrine the current POSE as rest for the whole rig.
    // `before` is the exact set moveJoint writes: the joint, its twin, and their direct
    // children.
    IKSolver.captureRest(this._main, g.before.map(([mesh]) => mesh).filter((m) => m._isBone));
    this._selectLater(g.joint);
    const main = this._main;
    const before = g.before;
    const after = before.map(([mesh]) => [mesh, mat4.clone(mesh.getMatrix())]);
    // A grab that never armed moved nothing, so there is nothing to undo — and an undo step
    // per selection is worse than no undo at all: it fills the stack with entries that appear
    // to do nothing when you use them.
    const moved = before.some(([mesh], i) => {
      const a = after[i][1], b = mesh && before[i][1];
      for (let k = 0; k < 16; k++) if (a[k] !== b[k]) return true;
      return false;
    });
    const sm = main.getStateManager && main.getStateManager();
    if (moved && sm && sm.pushStateCustom) {
      sm.pushStateCustom(
        () => { Skeleton.restoreLocal(before); Skeleton.updateVisuals(main); main.render(); },
        () => { Skeleton.restoreLocal(after); Skeleton.updateVisuals(main); main.render(); },
        false, 'Tweak Joint');
    }
  }

  // ---- pose (FK rotate) ----------------------------------------------------------
  //
  // Grab a joint and the controller's ROTATION drives it, pivoting on the joint's own
  // origin. Children follow through the scene graph for free — that IS forward kinematics,
  // and it is the reason joints were built as ordinary parented nodes in the first place.
  //
  // Translation is deliberately ignored. Dragging a joint's position is what Tweak mode is
  // for (editing the rest skeleton); a pose that also moved joints would quietly change the
  // rig's proportions every time you turned a wrist.
  _beginPose(joint, quat) {
    this._main._rigRestEdit = true;   // same reason as _beginGrab: this edits the rest skeleton
    // IS THE SOLVER GOING TO OVERWRITE THIS JOINT? Worked out once, at the press: solverOwnedIds
    // rebuilds the rig graph, which is not something to do per frame of a drag.
    //
    // If it is owned, the swing belongs to the solve and only the TWIST about the bone survives
    // -- so the gesture is split and the twist is stored as the joint's free roll. If it is not
    // owned, the joint keeps whatever it is given and nothing special is needed (roadmap #59,
    // Tier 1: FK on an unpinned chain already works).
    let owned = false;
    let axis = null;
    try {
      owned = IKSolver.solverOwnedIds(this._main).has(joint.getID());
    } catch (_) { owned = false; }
    if (owned) {
      // The bone axis, in the joint's own frame: where its single child sits. With no child, or
      // several, there is no free roll to give -- see applyFkRoll.
      const kids = Skeleton.joints(this._main).filter((j) => j._parentMesh === joint);
      if (kids.length === 1) {
        const lm = kids[0].getMatrix();
        const v = new THREE.Vector3(lm[12], lm[13], lm[14]);
        if (v.lengthSq() > 1e-12) axis = v.normalize();
      }
    }
    this._pose = {
      joint: joint,
      qStart: new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]).invert(),
      local: mat4.clone(joint.getMatrix()),
      before: [[joint, mat4.clone(joint.getMatrix())]],
      rollAxis: axis,
      rollStart: IKSolver.fkRoll(joint),
      q0: (() => {
        const m = new THREE.Matrix4().fromArray(joint.getMatrix());
        const q = new THREE.Quaternion();
        m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
        return q;
      })(),
    };
  }

  _poseTo(quat) {
    const p = this._pose;
    if (!p) return;

    // Controller delta, in model space.
    _qNow.set(quat[0], quat[1], quat[2], quat[3]);
    _qDelta.copy(_qNow).multiply(p.qStart);

    // Carry it into the joint's PARENT space, or a rotation applied to a joint deep in a
    // posed chain would be measured against the wrong frame and skew as the chain moves.
    const parent = p.joint._parentMesh;
    if (parent && parent.getModelSpaceMatrix) {
      _mParent.fromArray(parent.getModelSpaceMatrix());
      _mParent.decompose(_vTmp, _qParent, _sTmp);
      _qDelta.premultiply(_qParent.clone().invert()).multiply(_qParent);
    }

    // Rotate about the joint's own origin: keep position and scale, pre-multiply rotation.
    _mLocal.fromArray(p.local);
    _mLocal.decompose(_vTmp, _qJoint, _sTmp);
    _qJoint.premultiply(_qDelta);
    _mLocal.compose(_vTmp, _qJoint, _sTmp);
    mat4.copy(p.joint.getMatrix(), _mLocal.elements);
    Skeleton.syncThree(p.joint);

    // THE HALF THAT SURVIVES. On a solver-owned joint the swing is about to be rewritten by the
    // next solve, so the twist about the bone is recorded as the joint's free roll -- measured
    // from the pose at the press, ABSOLUTE, not accumulated per frame, or a slow drag would
    // integrate the same gesture dozens of times.
    if (p.rollAxis) {
      const dq = _qJoint.clone().multiply(p.q0.clone().invert());
      IKSolver.clearFkRoll(p.joint);
      IKSolver.addFkRoll(p.joint, p.rollStart + IKSolver.twistAbout(dq, p.rollAxis));
    }
    this._refresh();
  }

  _releasePose() {
    this._grabHand = null;
    this._main._rigRestEdit = false;
    IKSolver.syncPinCache?.(this._main);
    IKSolver.syncJointCache?.(this._main);
    const p = this._pose;
    this._pose = null;
    if (!p) return;
    this._selectLater(p.joint);
    const main = this._main;
    const before = p.before;
    const after = before.map(([mesh]) => [mesh, mat4.clone(mesh.getMatrix())]);
    const sm = main.getStateManager && main.getStateManager();
    if (sm && sm.pushStateCustom) {
      sm.pushStateCustom(
        () => { Skeleton.restoreLocal(before); Skeleton.updateVisuals(main); main.render(); },
        () => { Skeleton.restoreLocal(after); Skeleton.updateVisuals(main); main.render(); },
        false, 'Pose Joint');
    }
  }

  // ---- radius (capsule editing) --------------------------------------------------
  //
  // The capsule around a bone is what the bind measures against, and until it was drawn its
  // radius was a number nobody could judge. Here it is grabbed directly: hold the trigger and
  // the radius follows the controller's distance from the bone, so you inflate the envelope
  // until it contains the limb and stop. That is the same "reach into the volume" argument
  // that made VR bone placement worth building.

  // Pick by RELATIVE distance (distance / radius), not absolute: the capsules differ hugely
  // in size across a rig, and the one you mean is the one you are inside or nearest the shell
  // of — not whichever bone's centreline happens to be closest to your hand.
  _pickBone(pos) {
    const main = this._main;
    let best = null, bestT = 4;
    for (const j of Skeleton.joints(main)) {
      if (!Skeleton.jointVisible(j)) continue; // hidden capsules are not grabbable
      const d = Skeleton.boneDistance(main, j, pos);
      if (d === null) continue;
      // A zero/absent radius must stay grabbable, or a bone can never be given one.
      const ref = Math.max(j._boneRadius || 0, Skeleton.boneLength(main, j) * 0.05, 1e-9);
      const t = d / ref;
      if (t < bestT) { bestT = t; best = j; }
    }
    return best;
  }

  _beginRadius(joint) {
    const main = this._main;
    const twin = (joint._boneMirror && main.getMeshes().includes(joint._boneMirror))
      ? joint._boneMirror : null;
    const before = [[joint, joint._boneRadius || 0]];
    if (twin) before.push([twin, twin._boneRadius || 0]);
    this._radius = { joint: joint, twin: twin, before: before };
  }

  _radiusTo(pos) {
    const r = this._radius;
    if (!r) return;
    const d = Skeleton.boneDistance(this._main, r.joint, pos);
    if (d === null) return;
    // A capsule with no thickness has no support at all, so never let a drag collapse one to
    // zero — that would silently unweight everything the bone owned.
    const min = Math.max(Skeleton.boneLength(this._main, r.joint) * 0.02, 1e-6);
    const val = Math.max(d, min);
    r.joint._boneRadius = val;
    if (r.twin) r.twin._boneRadius = val; // a mirrored rig stays mirrored
    this._liveWeights();
    this._refresh();
  }

  // Re-solve the bound weights mid-drag, so the vertices a capsule owns recolour under your
  // hand. Throttled: the solve is O(vertices x bones) and a dense sculpt cannot afford it at
  // 90Hz, but it is far too useful to defer to the release — half the value is watching the
  // territory change as the capsule grows.
  _liveWeights(force) {
    if (window._boneLiveWeights === false) return;
    const now = performance.now();
    if (!force && now - (this._lastLiveWeights || 0) < LIVE_WEIGHT_MS) return;
    this._lastLiveWeights = now;
    const t0 = now;
    const n = Skinning.resolveWeightsAll(this._main);
    if (window._boneTrace && n) {
      console.log('[bone] live weights %dms', Math.round(performance.now() - t0));
    }
  }

  _releaseRadius() {
    const r = this._radius;
    this._radius = null;
    // `before` is missing when the radius drag never actually captured one — which happens when
    // the tool is switched away mid-drag, since setToolIndex calls clearPreview and that lands
    // here. Without this the map below throws and takes the tool switch with it.
    if (!r || !r.before) return;
    this._liveWeights(true); // land on the final radius, not on the last throttled tick
    this._selectLater(r.joint);
    const main = this._main;
    const before = r.before;
    const after = before.map(([j]) => [j, j._boneRadius || 0]);
    const sm = main.getStateManager && main.getStateManager();
    if (sm && sm.pushStateCustom) {
      const apply = (radii) => {
        Skeleton.restoreRadii(radii);
        Skinning.resolveWeightsAll(main); // radii ARE the weights now; undoing one undoes both
        Skeleton.updateVisuals(main);
        main.render();
      };
      sm.pushStateCustom(() => apply(before), () => apply(after), false, 'Bone Radius');
    }
  }

  // ---- ik (full-body, pinned) ----------------------------------------------------
  //
  // The dragged joint is an effector and every pinned joint is an effector that wants to stay
  // put, so one solve handles both. The undo snapshot is EVERY joint: a full-body solve can
  // legitimately reach anywhere in the tree, and a snapshot of only the joints it happened to
  // touch this time would be a snapshot of the solver's behaviour rather than of the rig.

  // The grab is 6DOF: the controller's position drives where the joint goes, its ROTATION
  // drives how the joint is turned, and both are constraints on the same solve. Grabbing the
  // hips and twisting them has to swing the legs and spine, which then have to be re-solved
  // against the pins — a rotation applied after the fact would leave the pinned feet behind.
  _beginIK(joint, quat) {
    _mParent.fromArray(joint.getModelSpaceMatrix());
    _mParent.decompose(_vTmp, _qJoint, _sTmp);
    this._ik = {
      joint: joint,
      before: IKSolver.captureAll(this._main),
      // Inverted at capture: every frame's delta is measured against this one pose, so the
      // orientation is absolute and cannot drift over a long drag.
      qCtrl0: quat ? new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]).invert() : null,
      qJoint0: _qJoint.clone(),
    };
  }

  _ikTo(pos, quat) {
    const ik = this._ik;
    if (!ik) return;
    let orient = null;
    if (quat && ik.qCtrl0 && window._ikGrabRotate !== false) {
      orient = _qNow.set(quat[0], quat[1], quat[2], quat[3])
        .multiply(ik.qCtrl0)   // controller delta since the grab, in model space
        .multiply(ik.qJoint0); // ...applied on top of the joint's orientation at the grab
    } else if (!quat && window._ikLockGrabRotation !== false) {
      // NO CONTROLLER — a mouse or a finger, which carries position and nothing else. That
      // is three fewer constraints per drag than the same grab in VR, and it is why a
      // full-body solve reads as far looser on a screen: the solver is being asked a vaguer
      // question, not behaving differently. Hold the orientation the joint had at the grab
      // and the question is as specific as the 6DOF one.
      //
      // The joint keeps the orientation it started with rather than being free to spin — a
      // dragged hand stays level while the arm re-solves under it. Set
      // window._ikLockGrabRotation = false for the old free-effector behaviour.
      orient = ik.qJoint0;
    }
    IKSolver.solve(this._main, ik.joint, pos, null, orient);
    this._refresh();
  }

  _releaseIK() {
    this._grabHand = null;
    const ik = this._ik;
    this._ik = null;
    if (!ik) return;
    this._selectLater(ik.joint);
    const main = this._main;
    const before = ik.before;
    const after = before.map(([mesh]) => [mesh, mat4.clone(mesh.getMatrix())]);
    const sm = main.getStateManager && main.getStateManager();
    if (sm && sm.pushStateCustom) {
      sm.pushStateCustom(
        () => { Skeleton.restoreLocal(before); Skeleton.updateVisuals(main); main.render(); },
        () => { Skeleton.restoreLocal(after); Skeleton.updateVisuals(main); main.render(); },
        false, 'IK Pose');
    }
  }

  // A cycles: unpinned -> position -> position + rotation -> unpinned. One button, because
  // pinning is "point at a joint and press", and the marker out in the scene says which of
  // the three states you landed in. The work itself lives on Skeleton: Transform and Grab
  // bind the same press, and three copies of an undo this fiddly would not stay in step.
  _togglePin(joint) {
    if (IKSolver.togglePin(this._main, joint)) this._refresh();
  }

  // ---- VR -----------------------------------------------------------------------
  updateXR(picking, isPressed, origin, dir, options) {
    const main = this._main;
    const tip = (options && options.tipOrigin) || origin;
    if (!tip) {
      // An early return here skips the A handling entirely, so a caller passing no tip would
      // look exactly like a dead button.
      if (window._boneATrace) {
        this._noTip = (this._noTip || 0) + 1;
        if (this._noTip % 30 === 1) console.log(`[boneA] NO TIP - updateXR bailed (n=${this._noTip})`);
      }
      return;
    }
    _tip.set(tip[0], tip[1], tip[2]);

    // A ends the chain, in draw mode only. Mode selection moved to the mini panel — three
    // modes across two face buttons meant each button changed meaning by mode, which is
    // exactly why the previous binding was unreadable.
    const aPressed = this._readButton(options, 4);
    this._traceA(options, aPressed);
    if (aPressed && !this._wasAPressed) {
      if (window._boneATrace) console.log('[boneA] EDGE -> acting, mode=' + this._mode);
      // Same button, two modes, no overlap in meaning: A ends a chain while drawing, and
      // pins the highlighted joint while solving. Both are "commit the thing you are
      // pointing at", which is the only reading of a face button that stays memorable.
      if (this._mode === 'draw') {
        // A ENDS THE CHAIN; A AGAIN LEAVES DRAWING. Ending a chain used to be all it did, and
        // there was no way to stop drawing from the controller at all — the next trigger
        // dropped another root joint, wherever your hand happened to be. That is fine while
        // building a skeleton and wrong the moment you have finished one.
        if (this._validParent()) {
          this.endChain();
          if (window.screenLog) window.screenLog('Bones: chain ended - A again to stop drawing', 'cyan');
        } else {
          // Pose, not some inert state: there isn't one, and it is what you want next after
          // drawing a skeleton. Nothing there happens without deliberately grabbing a joint.
          this.setModeKey('pose');
          if (window.screenLog) window.screenLog('Bones: drawing off - Pose mode', 'cyan');
          try { main._miniPanel?.syncFromState?.(); } catch (_) {}
        }
      } else if (this._mode === 'ik') {
        this._togglePin(this._hilite);
      }
    }
    this._wasAPressed = aPressed;

    // THE PRESS EDGE IS PER HAND, AND THAT IS THE RUNAWAY.
    //
    // updateXR is called once per controller, and there is a second call site that always passes
    // isPressed = false (the menu guard). With one shared flag the sequence each frame was:
    // guard call sets it false, real call sees pressed && !false — so `down` was TRUE ON EVERY
    // FRAME of a held trigger, not just the first.
    //
    // That re-ran the grab every frame, and a grab is a PICK: `pickJoint` re-chose whatever was
    // nearest the tip right then. The joint being dragged is by definition nearest the tip, so
    // it holds — until it is not, and the grab hops to the next joint, which is then dragged to
    // your hand as well. matt: "the hips will drag themselves away from the body, the head will
    // zap off to somewhere crazy." Not a feedback loop in the maths; a rising edge that never
    // stopped rising.
    const hand0 = (options && options.handedness) || 'one';
    this._xrPressBy = this._xrPressBy || {};
    const down = isPressed && !this._xrPressBy[hand0];
    this._xrPressBy[hand0] = isPressed;

    // Draw the symmetry plane, lit up while the tip is inside the snap band so you can see
    // that the next joint will be centred BEFORE you commit it.
    const plane = Skeleton.symmetryPlane(main);
    Skeleton.updatePlane(main, plane, !!plane && this._snapEnabled()
      && Math.abs(Skeleton.planeDistance(_tip, plane)) <= this._planeSnap(), _tip);

    // CLEARED EACH FRAME, then set by the modes that actually resolve a bone. This tool does
    // its own picking, so nothing else here would ever clear it — and a stale value names a
    // bone the tip is nowhere near, which is worse than naming none.
    // WHICH BONE THE HAND IS ON, IN EVERY MODE OF THIS TOOL — not only in Draw and Radius.
    //
    // Split acts on `_rigHoverBone` and falls back to the selected JOINT when there is none. At a
    // T-junction that fallback cannot mean anything: the chest has a neck and two shoulders
    // hanging off it, and "the joint" does not say which of the three you meant. matt: "i can see
    // the neck, but i can't select it to split it... i would have expected bone highlighting to
    // work here, but it seems to only highlight the joint."
    //
    // The pick is the same one Draw already does, so this costs a pick per frame and makes the
    // highlight — and therefore Split — follow the hand in Pose, Tweak, IK and Volume too.
    main._rigHoverBone = this._pickBone(_tip);

    if (this._mode === 'pose') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      const q = (options && options.quat) || main._vrControllerQuat;
      const poseHand = (options && options.handedness) || null;
      if (down && q && !this._pose) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) { this._beginPose(hit, q); this._grabHand = poseHand; }
      }
      // Same ownership rule as the tweak grab above — one drag, one hand.
      if (this._pose && (!this._grabHand || !poseHand || poseHand === this._grabHand)) {
        if (isPressed && q) this._poseTo(q);
        else this._releasePose();
      }
      this._hilite = this._pose ? this._pose.joint
                                : Skeleton.pickJoint(main, _tip, this._snapDist());
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    // VOLUME: SELECT ONLY. The gizmo does the sizing and placing (see Skeleton.volumeEditTarget),
    // so all this mode owes the controller is a way to say WHICH joint — and, crucially, a
    // branch of its own. Without one it fell through to the code below and started drawing new
    // joints, which is exactly what matt saw: "i tried the 'volume' button, it doesn't seem to
    // do anything, it behaves like draw mode."
    if (this._mode === 'volume') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      const volHand = (options && options.handedness) || null;

      // THE DRAG IS THE GIZMO. There is no gizmo to grab in here: the desktop Gizmo is not
      // drawn by this tool, and the VR one belongs to TransformVR, which is a different TOOL
      // and cannot be active at the same time. So Volume mode edits the way everything else in
      // this app does in a headset — grab the thing and move your hand. matt: "i don't see any
      // gizmos, nothing happens when i hold the trigger and drag."
      //
      // Trigger drags the volume; the secondary button turns the same drag into a resize. Both
      // are 1:1 in the joint's own frame, so what your hand does is what the shape does.
      // A HANDLE FIRST, THEN A JOINT. The dots sit on the volume you have selected, so they are
      // what the hand is reaching for when it is near them; falling through to the joint pick
      // would re-select instead of resizing and the handles would feel dead.
      if (down && !this._volDrag) {
        const hj = main._volHandles && main._volHandles.joint;
        const grip = hj ? Skeleton.pickVolumeHandle(main, _tip, this._snapDist() * 1.2) : null;
        if (grip) {
          _mVolInv.fromArray(hj.getModelSpaceMatrix());
          _mVolInv.setPosition(0, 0, 0);
          // The volume's own rotation is part of its frame, so a handle drag is measured in it —
          // otherwise dragging the X dot on a tilted ribcage would scale it along the bone.
          _qVolT.copy(Skeleton.jointVolRot(hj, _qVolT2));
          _mVolInv.multiply(new THREE.Matrix4().makeRotationFromQuaternion(_qVolT));
          _mVolInv.invert();
          this._volDrag = {
            joint: hj, hand: volHand, grip: grip,
            start: _tip.clone(), inv: _mVolInv.clone(),
            dims: Skeleton.jointVolDims(main, hj).slice(),
            off: Skeleton.jointVolOffset(main, hj).slice(),
            rot: Skeleton.jointVolRot(hj).clone(),
            // Fixed at the grab: whether this volume has to stay symmetric about the mirror
            // plane. Read once, because a drag that crossed the plane would otherwise change
            // the rules under your hand halfway through.
            centreline: Skeleton.volumeIsCentreline(main, hj),
            qStart: (options && options.quat)
              ? new THREE.Quaternion(options.quat[0], options.quat[1], options.quat[2], options.quat[3]).invert()
              : null,
            side: [1, 1, 1],
          };
          this._selectLater(hj);
          return;
        }
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist() * 3);
        if (hit && Skeleton.hasVolume(hit)) {
          this._selectLater(hit);
          _mVolInv.fromArray(hit.getModelSpaceMatrix());
          _mVolInv.setPosition(0, 0, 0);
          _mVolInv.invert();
          this._volDrag = {
            joint: hit, hand: volHand,
            start: _tip.clone(),
            dims: Skeleton.jointVolDims(main, hit).slice(),
            off: Skeleton.jointVolOffset(main, hit).slice(),
            // Which side of the volume the grab started on, so pulling outward always GROWS.
            side: null,
          };
          const local = _tip.clone().sub(Skeleton.jointPos(hit, _jp)).applyMatrix4(_mVolInv);
          this._volDrag.side = [Math.sign(local.x) || 1, Math.sign(local.y) || 1, Math.sign(local.z) || 1];
          this._volDrag.inv = _mVolInv.clone();
        } else if (hit) {
          this._selectLater(hit);   // no volume to edit: selecting is all this can mean
        }
      }

      const vd = this._volDrag;
      if (vd && (!vd.hand || !volHand || volHand === vd.hand)) {
        if (isPressed) {
          _vDelta.copy(_tip).sub(vd.start).applyMatrix4(vd.inv);
          if (vd.grip && vd.grip.kind === 'face') {
            const ax = vd.grip.axis, sgn = vd.grip.sign;
            const d = _vDelta.getComponent(ax);
            const dims = vd.dims.slice(), off = vd.off.slice();
            if (vd.centreline && ax === 0) {
              // BOTH SIDES AT ONCE. A ribcage straddles the mirror plane, so pulling its left
              // face has to take the right one with it — the extent changes and the centre does
              // not move at all. matt: "if i grab the ribcage and scale the left bbox handle,
              // the right should mirror it."
              dims[ax] = Math.max(1e-4, vd.dims[ax] + sgn * d);
            } else {
              // Grow from the face you took hold of, leaving the opposite one where it is: the
              // extent takes half the pull and the centre takes the other half.
              dims[ax] = Math.max(1e-4, vd.dims[ax] + sgn * d * 0.5);
              off[ax] = vd.off[ax] + d * 0.5;
            }
            Skeleton.setJointVolDims(vd.joint, dims[0], dims[1], dims[2]);
            Skeleton.setJointVolOffset(vd.joint, off[0], off[1], off[2]);
          } else if (vd.grip && vd.grip.kind === 'centre') {
            // SIX DEGREES OF FREEDOM, no modifier. The centre dot is a handle you hold: the
            // volume follows the controller's position AND its rotation, because that is what
            // holding something means. Asking for a button to turn it made rotation a mode.
            if (vd.qStart && options && options.quat) {
              _qNowV.set(options.quat[0], options.quat[1], options.quat[2], options.quat[3]);
              _qDeltaV.copy(_qNowV).multiply(vd.qStart);
              if (vd.centreline) {
                // Only the tip about the mirror normal keeps a centreline volume symmetric;
                // the rest of the controller's rotation is dropped rather than approximated.
                Skeleton.twistAboutAxis(_qDeltaV, _axisX, _qDeltaV);
              }
              Skeleton.setJointVolRot(vd.joint, _qDeltaV.multiply(vd.rot));
            }
            // ...and slides. A centreline volume slides in YZ only: any x would take it off the
            // plane it is defined by.
            Skeleton.setJointVolOffset(vd.joint,
              vd.centreline ? vd.off[0] : vd.off[0] + _vDelta.x,
              vd.off[1] + _vDelta.y, vd.off[2] + _vDelta.z);
          } else if (options && options.isNegative) {
            // RESIZE. The extent grows on the side you pulled from, so dragging away from the
            // volume always makes it bigger whichever face you took hold of.
            Skeleton.setJointVolDims(vd.joint,
              vd.dims[0] + _vDelta.x * vd.side[0],
              vd.dims[1] + _vDelta.y * vd.side[1],
              vd.dims[2] + _vDelta.z * vd.side[2]);
          } else {
            Skeleton.setJointVolOffset(vd.joint,
              vd.off[0] + _vDelta.x, vd.off[1] + _vDelta.y, vd.off[2] + _vDelta.z);
          }
        } else {
          this._releaseVolume();
        }
      }

      // The handle under the hand is lit, so you can see which one you are about to take.
      Skeleton.highlightVolumeHandle(main,
        vd ? vd.grip : Skeleton.pickVolumeHandle(main, _tip, this._snapDist() * 1.2));
      this._hilite = vd ? vd.joint : Skeleton.pickJoint(main, _tip, this._snapDist());
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    if (this._mode === 'ik') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      const qIK = (options && options.quat) || main._vrControllerQuat;
      const ikHand = (options && options.handedness) || null;
      if (down && !this._ik) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) { this._beginIK(hit, qIK); this._grabHand = ikHand; }
      }
      if (this._ik && (!this._grabHand || !ikHand || ikHand === this._grabHand)) {
        if (isPressed) this._ikTo(_tip, qIK);
        else this._releaseIK();
      }
      this._hilite = this._ik ? this._ik.joint
                              : Skeleton.pickJoint(main, _tip, this._snapDist());
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    if (this._mode === 'radius') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      if (down) {
        const hit = this._pickBone(_tip);
        if (!this._radius && hit) this._beginRadius(hit);
      }
      if (this._radius) {
        if (isPressed) this._radiusTo(_tip);
        else this._releaseRadius();
      }
      this._hilite = this._radius ? this._radius.joint : this._pickBone(_tip);
      Skeleton.setHighlight(main, this._hilite);
      // Radius mode already resolves a BONE rather than a joint, so say so — then the lit bone
      // is the split target here too, the same as everywhere else.
      main._rigHoverBone = this._hilite;
      return;
    }

    if (this._mode === 'tweak') {
      Skeleton.hidePreview(main);
      const qTweak = (options && options.quat) || main._vrControllerQuat;
      const hand = (options && options.handedness) || null;
      // `&& !this._grab`: a grab already in hand is never re-picked, whatever the edge says.
      if (down && !this._grab) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) { this._beginGrab(hit, qTweak, _tip); this._grabHand = hand; }
      }
      // ONLY THE HAND THAT GRABBED MAY DRIVE OR RELEASE THE GRAB.
      //
      // updateXR runs once per CONTROLLER, and there is a second call site that always passes
      // isPressed = false (the menu guard). So the other hand's call was dragging the joint to
      // ITS tip — wherever that happened to be — and then releasing the grab a frame later. From
      // the inside that reads exactly as matt described it: "the hips will drag themselves away
      // from the body, the head will zap off to somewhere crazy."
      //
      // One grab, one owner. A call from any other hand leaves it alone.
      if (this._grab && (!this._grabHand || !hand || hand === this._grabHand)) {
        // Half the pick radius: far enough that holding still cannot trip it, near enough that
        // a move meant as a move arms on the first deliberate centimetre.
        if (isPressed && !this._grab.armed && this._grab.startTip
            && _tip.distanceTo(this._grab.startTip) > this._snapDist() * 0.5) {
          this._grab.armed = true;
          // RE-TAKE THE OFFSET AT THE MOMENT OF ARMING. The hand has by definition travelled a
          // threshold's worth by now, and an offset measured back at the press would hand all of
          // it to the joint in one frame — a visible pop exactly when the drag begins. Measured
          // here, the joint starts from where it still is and follows from there.
          if (this._grab.tipOffset) {
            this._grab.tipOffset.copy(Skeleton.jointPos(this._grab.joint, _jp2)).sub(_tip);
          }
        }
        if (isPressed) { if (this._grab.armed) this._dragTo(_tip, qTweak); }
        else this._releaseGrab();
        // Read AFTER the write, so the next frame can tell this tool's own result apart from
        // whatever happened to the joint in between.
        if (window._tweakTrace && this._grab) {
          Skeleton.jointPos(this._grab.joint, _jp2);
          this._tracePost = _jp2.clone();
          console.log('[tweak]   -> post=' + _jp2.x.toFixed(3) + ',' + _jp2.y.toFixed(3)
            + ',' + _jp2.z.toFixed(3)
            + '  movedThisFrame=' + (this._traceTip ? _jp2.distanceTo(_jp).toFixed(4) : '?'));
        }
      }
      // WHO MOVED THE JOINT. The first trace proved the joint was tracking the hand; it could
      // not say whether THIS tool was the only thing writing to it. So the joint is read BEFORE
      // the drag as well as after, and `drift` is the distance it travelled between the end of
      // last frame and the start of this one — i.e. movement this tool did not cause.
      //
      // drift ~0 and post == target  -> the tool owns the joint and the maths here is the story
      // drift large                  -> something else (a solver, a pin, another tool) is also
      //                                 writing to it, and this tool is fighting it every frame
      // hand still, post moving      -> the target itself is being recomputed, not the input
      if (window._tweakTrace && this._grab) {
        Skeleton.jointPos(this._grab.joint, _jp);
        const drift = this._tracePost ? _jp.distanceTo(this._tracePost) : 0;
        const handMove = this._traceTip ? _tip.distanceTo(this._traceTip) : 0;
        this._traceTip = _tip.clone();
        console.log('[tweak] hand=' + hand + ' owner=' + this._grabHand
          + ' pressed=' + (isPressed ? 1 : 0)
          + ' pre=' + _jp.x.toFixed(3) + ',' + _jp.y.toFixed(3) + ',' + _jp.z.toFixed(3)
          + ' drift=' + drift.toFixed(4)
          + ' handMoved=' + handMove.toFixed(4)
          + ' pins=' + (IKSolver.pinnedJoints(main).length)
          + ' twin=' + (this._grab.twin ? 1 : 0)
          + ' compensate=' + (this._compensate ? 1 : 0));
      }
      // Preselect whatever the tip is nearest to, unless a drag already owns a joint.
      this._hilite = this._grab ? this._grab.joint
                                : Skeleton.pickJoint(main, _tip, this._snapDist());
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    // DRAW. Between chains the nearest joint is preselected, so a trigger there roots the
    // new chain at it instead of dropping a loose joint on top of it.
    const parent = this._validParent();
    this._hilite = parent ? null : Skeleton.pickJoint(main, _tip, this._snapDist());
    Skeleton.setHighlight(main, this._hilite);

    // AND THE NEAREST BONE, because Draw is exactly where you reach for Split.
    //
    // Draw does its own POINT pick against joints rather than going through Picking, so the
    // segment-aware path that publishes `_rigHoverBone` never runs here — bones lit in Grab and
    // stayed dark in Draw. matt: "not in the bone tool when in draw mode, which again is when
    // you'd be most likely to need it for the bone split."
    //
    // Only BETWEEN chains. Mid-chain the tip is the end of the bone you are drawing, so every
    // frame would light the segment you are in the middle of placing.
    main._rigHoverBone = parent ? null : this._pickBone(_tip);

    if (down) {
      this._place(_tip);
      return;
    }

    // Live preview of the bone about to be committed. It previews the RESOLVED position —
    // where the joint will actually land once snapping is applied — not the raw tip, so
    // what you see is what you commit.
    Skeleton.showPreview(main, parent ? Skeleton.jointPos(parent, _pos) : null,
      this._resolve(_tip, plane, _eff, parent));
  }

  // ---- A-button trace -------------------------------------------------------------
  //
  // Turn on with `window._boneATrace = true`. A face button that works "sometimes" is almost
  // never a bug in the binding, so this deliberately reports the whole chain rather than the
  // verdict: whether updateXR runs at all, which hand it was called for, what the options
  // object actually contains, and — separately — what the RAW WebXR gamepads say. If the raw
  // state shows the press and the options state does not, the press is being filtered on the
  // way in; if neither shows it, it never reached the page; if both do and nothing happens,
  // the edge detector is being reset by something.
  _traceA(options, aPressed) {
    if (!window._boneATrace) return;
    this._aFrame = (this._aFrame || 0) + 1;

    const ctrls = (options && options.controllers) || [];
    const optStr = ctrls.length
      ? ctrls.map((c) => `${c.handedness || '?'}:${c.buttons ? c.buttons.length : 'nobtns'}` +
          `:A=${c.buttons && c.buttons[4] ? (c.buttons[4].pressed ? 1 : 0) : '-'}`).join(' ')
      : 'EMPTY';

    // Raw, straight off the session — bypasses whatever the caller chose to pass along.
    let rawStr = 'nosession';
    let rawAny = false;
    const session = this._main._xrSession;
    if (session && session.inputSources) {
      const parts = [];
      for (const src of session.inputSources) {
        const b = src.gamepad && src.gamepad.buttons && src.gamepad.buttons[4];
        const on = !!(b && b.pressed);
        if (on) rawAny = true;
        parts.push(`${src.handedness || '?'}:A=${b ? (on ? 1 : 0) : '-'}`);
      }
      rawStr = parts.join(' ') || 'nosources';
    }

    // State that differed between the working run and the failing one: recording, playback,
    // and which hand the app thinks is dominant. A binding that only dies during a take is a
    // different bug from one that dies near a menu.
    const reg = window._animationRegistry;
    const rec = reg
      ? `rec=${reg.isRecording ? 1 : 0}${reg.isCountingIn ? '+in' : ''}` +
        `${window._animWaitingForGrab ? '+wait' : ''}${window._animPlaying ? '+play' : ''}`
      : 'rec=none';
    const dom = `dom=${this._main._dominantHand}`;

    const chain = this._validParent() ? 'chain' : 'nochain';
    const sig = `${options && options.handedness}|${optStr}|${rawStr}|${aPressed ? 1 : 0}|` +
                `${this._wasAPressed ? 1 : 0}|${this._mode}|${chain}|${rec}|${dom}`;
    // Log on any change, plus a heartbeat so a silent console distinguishes "nothing is
    // changing" from "updateXR is not being called at all".
    const beat = (this._aFrame % 90) === 0;
    if (sig === this._aSig && !beat) return;
    this._aSig = sig;
    console.log(`[boneA] f=${this._aFrame} hand=${options && options.handedness}` +
      ` opts=[${optStr}] raw=[${rawStr}] rawAny=${rawAny ? 1 : 0}` +
      ` aPressed=${aPressed ? 1 : 0} wasA=${this._wasAPressed ? 1 : 0}` +
      ` mode=${this._mode} ${chain} ${rec} ${dom}${beat ? ' (beat)' : ''}`);
  }

  // Called by SculptManager.setToolIndex when switching away — otherwise the preselection
  // highlight and preview bone stay lit under a tool that no longer owns them.
  clearPreview() {
    this._drag = null;
    this._releaseGrab(); this._releasePose(); this._releaseRadius(); this._releaseIK();
    this._releaseVolume();
    // Leaving the tool puts the real vertex colours back. A weight preview is a diagnostic,
    // and one that outlived the tool could be saved into the sculpt without anyone noticing.
    Skinning.restoreColorsAll(this._main);
    Skeleton.hidePreview(this._main);
    Skeleton.hidePlane(this._main);
    Skeleton.setHighlight(this._main, null);
    this._hilite = null;
  }

  // No brush cursor to draw — but this is the once-per-frame hook the active tool gets, and
  // it is what keeps the snap plane up without anything having to poke it. Sets visibility
  // only: calling render() from inside a render is the re-entrant failure this repo has hit
  // before, and syncPlane deliberately does not.
  postRender() { this.syncPlane(); }
  // ...and because there is none, SculptGL must not hide the real pointer during a drag.
  drawsOwnCursor() { return false; }
}

export default BoneDrawTool;
