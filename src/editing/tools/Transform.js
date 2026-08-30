import { vec3, mat4 } from 'gl-matrix';
import Gizmo from '../Gizmo.js';
import SculptBase from './SculptBase.js';

class Transform extends SculptBase {

  constructor(main) {
    super(main);

    this._gizmo = new Gizmo(main);

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

  preUpdate() {
    var picking = this._main.getPicking();
    var mesh = picking.getMesh();
    this._gizmo.onMouseOver();
    picking._mesh = mesh;
    this._main.setCanvasCursor('default');
  }

  start(ctrl) {
    var main = this._main;
    var mesh = this.getMesh();
    if (mesh && mesh._isVoxel) return false; // LOCK TRANSFORM
    var picking = main.getPicking();

    if (mesh && this._gizmo.onMouseDown()) {
      picking._mesh = mesh;
      // "Start on click" recording: armed-and-waiting → begin the take when the gizmo
      // drag starts (desktop equivalent of grabbing the object in VR).
      window._animationRegistry?.beginInteraction?.(mesh);
      return true;
    }

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
    this._gizmo.render();
  }

  addSculptToScene(scene) {
    if (this.getMesh())
      this._gizmo.addGizmoToScene(scene);
  }
}

export default Transform;
