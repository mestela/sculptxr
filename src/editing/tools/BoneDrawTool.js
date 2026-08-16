import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import Skeleton from '../Skeleton.js';

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
// Two modes, B button toggles:
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
// TWEAK
//   trigger hold   grab the highlighted joint and drag it to the controller tip
//   A button       toggle joint compensation (on by default)
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

class BoneDrawTool extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;

    this._chainParent = null;       // joint the next click parents to (null = new root)
    this._chainParentMirror = null; // its mirrored twin, when symmetry is on
    this._chainName = 'bone';
    this._chainIndex = 0;

    this._mode = 'draw';       // 'draw' | 'tweak'
    this._compensate = true;   // tweak: pin the dragged joint's children in world space
    this._hilite = null;       // preselected joint
    this._grab = null;         // { joint, twin, snapshot } while dragging in tweak mode

    this._wasXRPressed = false;
    this._wasAPressed = false;

    // Console escape hatch — VR round-trips are the expensive part of iterating on this.
    window._boneSetMode = (k) => { this.setModeKey(k); }; // 'draw' | 'fk' | 'free'
  }

  // Three modes, selected from the mini panel on the non-dominant controller:
  //   draw  place joints
  //   fk    tweak, children FOLLOW the dragged joint (plain forward kinematics)
  //   free  tweak, children STAY PUT (the dragged joint moves on its own — drag the knee,
  //         thigh and shin re-aim, foot and toes do not move)
  modeKey() {
    if (this._mode === 'draw') return 'draw';
    return this._compensate ? 'free' : 'fk';
  }

  setModeKey(key) {
    const mode = key === 'draw' ? 'draw' : 'tweak';
    const compensate = key !== 'fk';
    if (this._mode === mode && this._compensate === compensate) return;
    this._mode = mode;
    this._compensate = compensate;
    this._releaseGrab();
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
    Skeleton.updateVisuals(this._main);
    this._main.render();
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
    if (plane && this._snapEnabled()
        && Math.abs(Skeleton.planeDistance(at, plane)) <= this._planeSnap()) {
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
    const offPlane = plane ? Math.abs(sd) > this._planeSnap() : false;
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

  // ---- desktop ------------------------------------------------------------------
  // Desktop places the joint at the picked surface point. It cannot do better — there is
  // no depth channel on a flat screen, which is exactly the limitation this feature is
  // built to escape — so treat it as a way to rough a chain in and nudge it with the
  // gizmo, not as the real workflow.
  start() {
    if (this._main._xrSession) return false; // VR drives everything from updateXR
    const picking = this._main.getPicking();
    if (!picking.intersectionMouseMeshes()) return false;
    const m = picking.getMesh();
    const inter = picking.getIntersectionPoint();
    if (!m || !inter) return false;
    _pos.set(inter[0], inter[1], inter[2]).applyMatrix4(
      new THREE.Matrix4().fromArray(m.getModelSpaceMatrix()));
    this._place(_pos);
    return false; // not a deforming stroke
  }

  update() {}
  end() {}

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

  // ---- VR -----------------------------------------------------------------------
  updateXR(picking, isPressed, origin, dir, options) {
    const main = this._main;
    const tip = (options && options.tipOrigin) || origin;
    if (!tip) return;
    _tip.set(tip[0], tip[1], tip[2]);

    // A ends the chain, in draw mode only. Mode selection moved to the mini panel — three
    // modes across two face buttons meant each button changed meaning by mode, which is
    // exactly why the previous binding was unreadable.
    const aPressed = this._readButton(options, 4);
    if (aPressed && !this._wasAPressed && this._mode === 'draw') {
      this.endChain();
      if (window.screenLog) window.screenLog('Bones: chain ended', 'cyan');
    }
    this._wasAPressed = aPressed;

    const down = isPressed && !this._wasXRPressed;
    this._wasXRPressed = isPressed;

    // Draw the symmetry plane, lit up while the tip is inside the snap band so you can see
    // that the next joint will be centred BEFORE you commit it.
    const plane = Skeleton.symmetryPlane(main);
    Skeleton.updatePlane(main, plane, !!plane && this._snapEnabled()
      && Math.abs(Skeleton.planeDistance(_tip, plane)) <= this._planeSnap());

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

  // Dominant-hand face button from the per-controller gamepad state (4 = A/X, 5 = B/Y).
  _readButton(options, index) {
    const ctrls = options && options.controllers;
    if (!ctrls) return false;
    const hand = options.handedness;
    for (let i = 0; i < ctrls.length; i++) {
      const c = ctrls[i];
      if (c.handedness === hand && c.buttons && c.buttons[index]) {
        return !!c.buttons[index].pressed;
      }
    }
    return false;
  }

  // Called by SculptManager.setToolIndex when switching away — otherwise the preselection
  // highlight and preview bone stay lit under a tool that no longer owns them.
  clearPreview() {
    this._releaseGrab();
    Skeleton.hidePreview(this._main);
    Skeleton.hidePlane(this._main);
    Skeleton.setHighlight(this._main, null);
    this._hilite = null;
  }

  postRender() {} // no brush cursor
}

export default BoneDrawTool;
