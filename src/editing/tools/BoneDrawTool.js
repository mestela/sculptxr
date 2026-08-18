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
    if (this._mode === 'ik') return 'ik';
    return this._compensate ? 'free' : 'fk';
  }

  setModeKey(key) {
    const named = { draw: 'draw', pose: 'pose', radius: 'radius', ik: 'ik' };
    const mode = named[key] || 'tweak';
    const compensate = key !== 'fk';
    if (this._mode === mode && (mode !== 'tweak' || this._compensate === compensate)) return;
    this._mode = mode;
    this._compensate = compensate;
    this._drag = null;
    this._hot = false;
    this._releaseGrab(); this._releasePose(); this._releaseRadius(); this._releaseIK();
    // The capsules are the whole point of radius mode, so turn them on when entering it
    // rather than making the user find a second toggle to make the mode visible.
    if (mode === 'radius') window._boneShowCapsules = true;
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

  _snapEnabled() { return window._boneSnapPlane !== false; }
  _axisEnabled() { return window._boneSnapAxis !== false; }

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
    Skeleton.updatePlane(main, plane, !!this._hot);
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

  _beginGrab(joint) {
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
    this._grab = { joint: joint, twin: twin, plane: plane, before: snapshot };
  }

  _dragTo(pos) {
    const g = this._grab;
    if (!g) return;
    // A joint WITH a twin is by definition a side joint, so snapping it to the centreline
    // would contradict its own mirror. Only centreline joints snap while dragging.
    // A joint WITH a twin is by definition a side joint, so plane-snapping it would
    // contradict its own mirror — but axis snap still applies, which is what keeps a
    // dragged eye joint pointing straight down Z.
    const gp = Skeleton.isJoint(g.joint._parentMesh) ? g.joint._parentMesh : null;
    const at = g.twin
      ? (this._axisEnabled() && gp ? Skeleton.snapAxis(Skeleton.jointPos(gp, _from), pos, _eff, null) : pos)
      : this._resolve(pos, g.plane, _eff, gp);
    Skeleton.moveJoint(this._main, g.joint, at, this._compensate);
    if (g.twin && g.plane) {
      Skeleton.mirrorPoint(at, g.plane, _mirror);
      Skeleton.moveJoint(this._main, g.twin, _mirror, this._compensate);
    }
    this._refresh();
  }

  _releaseGrab() {
    const g = this._grab;
    this._grab = null;
    if (!g) return;
    // Tweak edits the REST skeleton, and where a knee sits in the rest pose is the statement
    // of which way it bends. Drop the remembered preferences so the next solve re-reads them.
    IKSolver.clearBendRefs(this._main);
    this._selectLater(g.joint);
    const main = this._main;
    const before = g.before;
    const after = before.map(([mesh]) => [mesh, mat4.clone(mesh.getMatrix())]);
    const sm = main.getStateManager && main.getStateManager();
    if (sm && sm.pushStateCustom) {
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
    this._pose = {
      joint: joint,
      qStart: new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]).invert(),
      local: mat4.clone(joint.getMatrix()),
      before: [[joint, mat4.clone(joint.getMatrix())]],
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
    this._refresh();
  }

  _releasePose() {
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
  // the three states you landed in.
  _togglePin(joint) {
    if (!joint) return;
    const main = this._main;
    const was = IKSolver.pinMode(joint);
    const wasPin = IKSolver.pinObject(joint);
    const wasM = wasPin ? mat4.clone(wasPin.getMatrix()) : null;
    const r = IKSolver.cyclePin(joint, main);
    const now = r.mode;
    // Unpinning takes the null out of the scene; undo has to put the SAME object back, at the
    // matrix it stood at, or the pin returns somewhere else.
    if (r.removed) main.removeMeshSilent(r.removed);
    const nowPin = r.pin;
    const names = ['unpinned', 'pinned (position)', 'pinned (position + rotation)'];
    const sm = main.getStateManager && main.getStateManager();
    if (sm && sm.pushStateCustom) {
      const apply = (mode, pin, m) => {
        if (pin && mode) { main.addMeshSilent(pin); IKSolver.attachPin(joint, pin, mode, m); }
        else {
          const live = IKSolver.pinObject(joint);
          IKSolver.setPin(joint, 0, main);
          if (live) main.removeMeshSilent(live);
        }
        Skeleton.updateVisuals(main); main.render();
      };
      sm.pushStateCustom(() => apply(was, wasPin, wasM), () => apply(now, nowPin, null),
        false, 'Pin Joint');
    }
    if (window.screenLog) window.screenLog('Bones: ' + names[now], 'cyan');
    // The mini panel's pin count is only refreshed when something asks it to, and pinning
    // from the face button is exactly the route that would otherwise leave it stale. One
    // repaint per button press, not per frame.
    try { main._miniPanel?.syncFromState?.(); } catch (_) {}
    this._refresh();
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

    const down = isPressed && !this._wasXRPressed;
    this._wasXRPressed = isPressed;

    // Draw the symmetry plane, lit up while the tip is inside the snap band so you can see
    // that the next joint will be centred BEFORE you commit it.
    const plane = Skeleton.symmetryPlane(main);
    Skeleton.updatePlane(main, plane, !!plane && this._snapEnabled()
      && Math.abs(Skeleton.planeDistance(_tip, plane)) <= this._planeSnap());

    if (this._mode === 'pose') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      const q = (options && options.quat) || main._vrControllerQuat;
      if (down && q) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) this._beginPose(hit, q);
      }
      if (this._pose) {
        if (isPressed && q) this._poseTo(q);
        else this._releasePose();
      }
      this._hilite = this._pose ? this._pose.joint
                                : Skeleton.pickJoint(main, _tip, this._snapDist());
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    if (this._mode === 'ik') {
      Skeleton.hidePreview(main);
      Skeleton.hidePlane(main);
      const qIK = (options && options.quat) || main._vrControllerQuat;
      if (down) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) this._beginIK(hit, qIK);
      }
      if (this._ik) {
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
        if (hit) this._beginRadius(hit);
      }
      if (this._radius) {
        if (isPressed) this._radiusTo(_tip);
        else this._releaseRadius();
      }
      this._hilite = this._radius ? this._radius.joint : this._pickBone(_tip);
      Skeleton.setHighlight(main, this._hilite);
      return;
    }

    if (this._mode === 'tweak') {
      Skeleton.hidePreview(main);
      if (down) {
        const hit = Skeleton.pickJoint(main, _tip, this._snapDist());
        if (hit) this._beginGrab(hit);
      }
      if (this._grab) {
        if (isPressed) this._dragTo(_tip);
        else this._releaseGrab();
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

  // Dominant-hand face button from the per-controller gamepad state (4 = A/X, 5 = B/Y).
  //
  // Reads the options first, then falls back to the LIVE SESSION. A face button is global
  // device state — it is not aimed at anything and does not depend on which code path
  // happened to call the tool this frame — but the value was arriving only through the
  // options object, so any caller that passed a thinner one silently disabled the binding.
  // That has now caused the same "A works, then doesn't" report twice, and the menu-guard
  // path (which passed no controllers at all until v3.18.14) turns out to be the NORMAL case
  // rather than a rare one: the pointing-at-menu flag is sticky and reads true almost
  // permanently. Rather than audit every call site for a good options object, ask the device.
  //
  // The fallback also covers a handedness mismatch: if the options carry controllers but none
  // matches the hand being processed, the loop falls through to the session rather than
  // reporting "not pressed".
  _readButton(options, index) {
    const hand = (options && options.handedness) || this._main._dominantHand;
    const ctrls = options && options.controllers;
    if (ctrls) {
      for (let i = 0; i < ctrls.length; i++) {
        const c = ctrls[i];
        if (c.handedness === hand && c.buttons && c.buttons[index]) {
          return !!c.buttons[index].pressed;
        }
      }
    }
    const session = this._main._xrSession;
    if (session && session.inputSources) {
      for (const src of session.inputSources) {
        if (src.handedness === hand && src.gamepad && src.gamepad.buttons
            && src.gamepad.buttons[index]) {
          return !!src.gamepad.buttons[index].pressed;
        }
      }
    }
    return false;
  }

  // Called by SculptManager.setToolIndex when switching away — otherwise the preselection
  // highlight and preview bone stay lit under a tool that no longer owns them.
  clearPreview() {
    this._drag = null;
    this._releaseGrab(); this._releasePose(); this._releaseRadius(); this._releaseIK();
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
