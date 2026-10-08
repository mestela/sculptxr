import { vec3, mat4 } from 'gl-matrix';
import GizmoVR, { GIZMO_SETS, GIZMO_TYPE } from '../GizmoVR.js';
import IKSolver from '../IKSolver.js';
import Skeleton from '../Skeleton.js';
import { gizmoFrameFor } from '../JointFrame.js';
import { ownedIds, fkTarget, fkCandidates } from '../fkPick.js';
import { pinPoseOn } from '../pinPoseMode.js';
import SculptBase from './SculptBase.js';

// How long the cursor must rest on another target, inside the current gizmo's area, before the gizmo
// moves to it. Long enough that crossing a bone on the way to a handle does nothing, short enough
// that pointing at the next thing still feels immediate.
const PIN_POSE_DWELL_MS = 350;

class Transform extends SculptBase {

  constructor(main) {
    super(main);

    // ONE GIZMO (#84). GizmoVR is the gizmo TransformVR uses, and it carries the desktop half
    // too -- screen-constant sizing, the tiered mouse pick and the drag maths. Gizmo.js was a
    // fork of it and is gone; `_desktop` is what selects the mouse behaviour.
    this._gizmo = new GizmoVR(main);
    this._gizmo._desktop = true;
    // Asked every frame by the gizmo's own update(), so a selection change from anywhere (the
    // outliner, a click, undo) is reflected without waiting for the mouse to move.
    this._gizmo._handleSetFn = () => {
      // Belt and braces for the drag-hides-other-pins flag: if no drag is running it must not be set.
      if (!this._gizmo._isEditing && main._gizmoDragPin !== undefined) main._gizmoDragPin = undefined;
      // A target the cursor is resting on is waiting out its dwell (PIN_POSE_DWELL_MS), and a resting
      // cursor sends no events -- so the wait is finished here, once a frame.
      if (this._ppCand && !this._gizmo._isEditing && this._pinPoseActive()) this._pinPoseHover(!!this._gizmo._selected && this._gizmo._selected._type !== GIZMO_TYPE.ROT_W);
      return this._handleSet();
    };
    this._gizmo._frameFn = (mesh) => this._frameFor(mesh);

    window.debugGizmoDesktop = () => {
      const g = this._gizmo;
      const grp = g._group;
      console.group('[Transform Gizmo desktop]');
      console.log('group object:', grp);
      console.log('group.parent:', grp?.parent?.type ?? 'NULL — not in any scene');
      console.log('group.parent name:', grp?.parent?.name ?? 'n/a');
      console.log('group.visible:', grp?.visible);
      console.log('group children count:', grp?.children?.length);
      // SculptGL extends Scene — _worldGroup is on main directly, not on main._scene
      console.log('main._worldGroup:', main._worldGroup?.type ?? 'missing');
      console.log('main._scene (THREE.Scene):', main._scene?.type ?? 'missing');
      console.log('getMesh():', this.getMesh()?.getID?.() ?? 'null — gizmo render skipped!');
      console.log('_activatedType (bitmask):', g._activatedType);
      console.log('_currentScale:', g._currentScale);
      if (grp?.children?.length) {
        const vis = grp.children.filter(c => c.visible).length;
        console.log(`visible children: ${vis} / ${grp.children.length}`);
        if (grp.children[0]) {
          const wp = new (grp.children[0].position.constructor)();
          grp.children[0].getWorldPosition?.(wp);
          console.log('first child world position:', wp);
        }
      }
      // Force-show to test rendering
      console.log('--- calling render() now to test ---');
      if (grp) grp.visible = true;
      g.render();
      main.render();
      console.groupEnd();
      return 'see console above';
    };
  }

  isIdentity(m) {
    if (m[0] !== 1.0 || m[5] !== 1.0 || m[10] !== 1.0 || m[15] !== 1.0) return false;
    if (m[1] !== 0.0 || m[2] !== 0.0 || m[3] !== 0.0 || m[4] !== 0.0) return false;
    if (m[6] !== 0.0 || m[7] !== 0.0 || m[8] !== 0.0 || m[9] !== 0.0) return false;
    if (m[11] !== 0.0 || m[12] !== 0.0 || m[13] !== 0.0 || m[14] !== 0.0) return false;
    return true;
  }

  // WHICH HANDLES THE SELECTION OFFERS. A pin only does what its mode holds: a position pin has
  // no orientation to turn, a rotate pin no position to move, and nothing on a pin scales. Any
  // other selection keeps the full set.
  _handleSet() {
    const sel = this._main.getSelectedMeshes();
    const m = sel.length === 1 ? sel[0] : null;
    // A free joint, in Pin Pose, is FK: it turns about its own origin and nothing else.
    if (m && Skeleton.isJoint(m) && this._pinPoseActive()) return GIZMO_SETS.TURN;
    if (!m || !m._isPinTarget || !m._pinnedJoint) return GIZMO_SETS.ALL;
    switch (IKSolver.pinMode(m._pinnedJoint)) {
      case IKSolver.PIN_ROT: return GIZMO_SETS.TURN;
      case IKSolver.PIN_FULL: return GIZMO_SETS.MOVE_TURN;
      default: return GIZMO_SETS.MOVE;      // position and soft (pole) pins
    }
  }

  // THE FRAME THE HANDLES ARE DRAWN IN. A joint (or the pin standing for one) offers the axes a
  // person reaches for -- down the bone, and about its bend -- worked out from the chain; see
  // JointFrame. A pin that only moves has nothing to turn, so its arrows are the world's: a
  // stale orientation copied from the joint at the moment it was pinned would only surprise.
  // Anything else (null) keeps its own model-space orientation.
  _frameFor(mesh) {
    if (!mesh) return null;
    if (mesh._isPinTarget && mesh._pinnedJoint && this._handleSet() === GIZMO_SETS.MOVE) return mat4.create();
    return gizmoFrameFor(this._main, mesh, Skeleton);
  }

  // ---- Pin Pose (see editing/pinPoseMode.js) --------------------------------------------

  _pinPoseActive() { return pinPoseOn() && !this._main._xrSession; }

  _owned() {
    const now = performance.now();
    if (!this._ownCache || now - this._ownAt > 150) { this._ownCache = ownedIds(this._main); this._ownAt = now; }
    return this._ownCache;
  }

  // Is the cursor still on the gizmo's own ground -- inside the ring, or out along an arrow? A
  // handle is bigger than the thing it is on, and the gizmo must not let go of its target on the way
  // from the target to a handle.
  _cursorNearGizmo() {
    try {
      const s = this._gizmo._gizmoScreenRadius();
      const main = this._main;
      return Math.hypot(main._mouseX - s.cx, main._mouseY - s.cy) <= s.r * 1.8;
    } catch (e) { return false; }
  }

  // The gizmo follows the cursor: the nearest pin, or the free joint at the top of the nearest bone,
  // is lit and selected, so the next press drags its handle directly. Only what the rig can actually
  // pose is a candidate (fkPick.js); nothing else -- the skin, a joint the pins control -- is ever
  // selected by this mode. A selection the user made themselves is left alone unless the cursor
  // reaches something new; only the one this mode made is dropped when the cursor moves away.
  _pinPoseHover(overHandle) {
    const main = this._main;
    // Over a handle of a live gizmo the target never changes, and neither does the highlight.
    if (overHandle && main.getSelectedMeshes().length === 1) { this._ppCand = null; return; }
    const owned = this._owned();
    Skeleton.hoverRigFromMouse(main, main.getPicking?.(), fkCandidates(main, owned, true),
      (node, bone) => fkTarget(node, bone, owned).joint);
    const id = (main._pinHighlightId ?? -1) >= 0 ? main._pinHighlightId : (main._skelHighlightId ?? -1);
    const node = id >= 0 ? main.getMeshes().find((m) => m.getID() === id) : null;
    const sel = main.getSelectedMeshes();
    if (node) {
      if (sel.length === 1 && sel[0] === node) this._ppCand = null;
      if (!(sel.length === 1 && sel[0] === node)) {
        // A target to switch TO, while a gizmo is up and the cursor is on it or inside its area.
        if (sel.length === 1 && this._gizmo._group && this._gizmo._group.visible) {
          if (this._cursorNearGizmo()) {
            const now = performance.now();
            if (this._ppCand !== node) { this._ppCand = node; this._ppSince = now; return; }
            if (now - this._ppSince < PIN_POSE_DWELL_MS) return;   // not yet: it was only a brush past
          }
        }
        this._ppCand = null;
        this._ppAuto = node;
        main.setMesh(node, true);     // keepTool: we are already in Transform
        // The handle picked for the OLD target must not survive onto the new one.
        const sg = this._gizmo._selected;
        if (sg) { sg._isSelected = false; this._gizmo._selected = null; }
      }
    } else {
      this._ppCand = null;
      if (this._ppAuto && sel.length === 1 && sel[0] === this._ppAuto && !this._cursorNearGizmo()) {
        this._ppAuto = null;
        main.setMesh(null, true);
      }
    }
  }

  preUpdate() {
    var picking = this._main.getPicking();
    var mesh = picking.getMesh();
    // PIN POSE: the gizmo goes to whatever the cursor is nearest -- but not at the first brush past
    // another bone. Reaching for a handle means crossing ground that belongs to other targets, so
    // while the cursor is over a handle of the current gizmo it never switches, and while it is
    // anywhere else inside the gizmo's own area it switches only to a target it has stayed on for
    // a moment (PIN_POSE_DWELL_MS). Outside the gizmo it switches at once.
    const posing = !this._gizmo._isEditing && this._pinPoseActive();
    // The interior free-rotate ball is a handle for dragging, but it covers everything inside the rings,
    // so for the question "is the cursor ON the gizmo" it does not count: the cursor inside it is on
    // the gizmo's ground (dwell applies), not on a ring or an arrow (never switch).
    const overHandle = this._gizmo.onMouseOver() && !!(this._gizmo._group && this._gizmo._group.visible)
      && !!this._gizmo._selected && this._gizmo._selected._type !== GIZMO_TYPE.ROT_W;
    if (posing) this._pinPoseHover(overHandle);
    picking._mesh = mesh;
    this._main.setCanvasCursor('default');
  }

  start(ctrl) {
    var main = this._main;
    var mesh = this.getMesh();
    if (mesh && mesh._isVoxel) return false; // LOCK TRANSFORM
    var picking = main.getPicking();

    // PIN POSE: the gizmo can have moved onto a target since the last mouse event (the hover that put
    // it there ran, and the cursor then rested inside it), so the handle under the cursor has not been
    // worked out for THIS gizmo yet. Work it out now, or a press inside the circle finds no handle and
    // falls through to orbiting the view.
    if (this._pinPoseActive() && !this._gizmo._isEditing) this._gizmo.onMouseOver();
    if (mesh && this._gizmo.onMouseDown()) {
      picking._mesh = mesh;
      // Every other pin hides for the length of the drag (see Skeleton.updateVisuals).
      const dragged = main.getSelectedMeshes()[0];
      main._gizmoDragPin = dragged && dragged._isPinTarget ? dragged.getID() : -1;
      // "Start on click" recording: armed-and-waiting → begin the take when the gizmo
      // drag starts (desktop equivalent of grabbing the object in VR).
      window._animationRegistry?.beginInteraction?.(mesh);
      return true;
    }

    // PIN POSE SELECTS BY HOVER, never by press: a press either takes a handle (above) or does
    // nothing. In particular it can never grab the skin or a joint the pins control.
    if (this._pinPoseActive()) return false;

    // The gizmo is a selection tool before it is a transform tool, so it reaches rig nodes:
    // a bone or a pin is precisely what you want to put the gizmo on.
    if (!picking.intersectionMouseMeshes(main.getMeshes(), main._mouseX, main._mouseY, false, true))
      return false;

    // A PRESS ON SOMETHING ALREADY SELECTED DOES NOT COLLAPSE THE SELECTION.
    //
    // The gizmo transforms getSelectedMeshes() throughout — centre, snapshot and live write all
    // iterate it — so multi-object transform already worked. What broke it was this line: a
    // press that the gizmo did not claim fell through and re-selected, reducing the set to the
    // one mesh under the cursor. matt: "the gizmo jumps to the centroid of the selection, but as
    // soon as i try to move it, it snaps to one of the selections, and moves only that one."
    //
    // Every DCC behaves this way: clicking a member of a multi-selection keeps the selection so
    // you can drag it. Reducing to one happens on a click that was NOT a drag, which is a
    // separate gesture this tool does not implement.
    const _picked = picking.getMesh();
    const _already = _picked && main.getSelectedMeshes().length > 1
      && main.getIndexSelectMesh(_picked) >= 0;
    if (_already) return false;   // keep the set; the gizmo drag below owns the press
    if (!main.setOrUnsetMesh(_picked, ctrl || main.multiSelectHeld?.()))
      return false;

    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;
    return false;
  }

  end() {
    this._gizmo.onMouseUp();
    this._main._gizmoDragPin = undefined;

    var meshes = this._main.getSelectedMeshes();
    const main = this._main;
    window._animationRegistry?.endInteraction?.(meshes[0] || this.getMesh());
    // The gizmo wrote the real _matrix live during the drag (editMatrix stays
    // identity). Undo/redo therefore compares the drag-start snapshot (_startLocal)
    // against the current, already-moved matrix.
    const starts = this._gizmo._startLocal;
    if (!meshes.length || !starts) return;

    for (var i = 0; i < meshes.length; ++i) {
      const mesh = meshes[i];
      const before = starts[i];
      if (!before) continue;
      const after = mat4.clone(mesh.getMatrix());
      if (mat4.exactEquals(before, after)) continue; // no real change → no undo step

      const beforeC = mat4.clone(before);
      main.getStateManager().pushStateCustom(() => {
        mat4.copy(mesh.getMatrix(), beforeC);
        mesh.updateMatrices(main.getCamera());
        main.render();
      }, () => {
        mat4.copy(mesh.getMatrix(), after);
        mesh.updateMatrices(main.getCamera());
        main.render();
      });
    }

    main.render();
  }

  applyEditMatrix(iVerts) {
    var mesh = this.getMesh();
    var em = mesh.getEditMatrix();
    var mAr = mesh.getMaterials();
    var vAr = mesh.getVertices();
    var vTemp = [0.0, 0.0, 0.0];
    for (var i = 0, nb = iVerts.length; i < nb; ++i) {
      var j = iVerts[i] * 3;
      var mask = mAr[j + 2];
      var x = vTemp[0] = vAr[j];
      var y = vTemp[1] = vAr[j + 1];
      var z = vTemp[2] = vAr[j + 2];
      vec3.transformMat4(vTemp, vTemp, em);
      var iMask = 1.0 - mask;
      vAr[j] = x * iMask + vTemp[0] * mask;
      vAr[j + 1] = y * iMask + vTemp[1] * mask;
      vAr[j + 2] = z * iMask + vTemp[2] * mask;
    }
    vec3.transformMat4(mesh.getCenter(), mesh.getCenter(), em);
    mat4.identity(em);
    if (iVerts.length === mesh.getNbVertices()) mesh.updateGeometry();
    else mesh.updateGeometry(mesh.getFacesFromVertices(iVerts), iVerts);
  }

  update() {}

  // A tool change mid-drag would otherwise leave every other pin hidden for good.
  clearPreview() { this._main._gizmoDragPin = undefined; }

  updateXR(picking, isPressed, origin, dir, options) {
    // If the desktop tool is accidentally active in VR, don't crash the input loop!
    // Ideally the UI should switch them to TransformVR, but we need to survive this frame.
  }

  postRender() {
    var g = this._gizmo._group;

    // Lazy-insert the gizmo group into the Three.js scene.  The Gizmo constructor
    // runs during SculptManager.init() before Scene creates its worldGroup, so
    // the group ends up parentless.  postRender() is called every frame, so this
    // succeeds on the first frame after the scene is ready (no-op thereafter).
    if (g && !g.parent) {
      // SculptGL extends Scene, so _worldGroup lives on this._main directly.
      // this._main._scene is the THREE.Scene object which never has _worldGroup.
      var wg = this._main._worldGroup ||
               (this._main._scene && this._main._scene._worldGroup);
      if (wg) { wg.add(g); this._main.render(); }
    }

    super.postRender(this._main.getSculptManager().getSelection());
    // GizmoVR draws through the scene graph, so "rendering" it is an update of its matrices
    // and colours. Scene drives this every frame on the node renderer as well, because
    // postRender is part of the legacy raw-GL tail and does not run there.
    this._gizmo.update(this._main.getCamera());
  }

  // GizmoVR added itself to _worldGroup in its constructor -- it is scene-graph native and has
  // nothing to push onto the legacy draw list, so there is no addSculptToScene override.

}

export default Transform;
