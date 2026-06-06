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
      return true;
    }

    if (!picking.intersectionMouseMeshes(main.getMeshes(), main._mouseX, main._mouseY))
      return false;

    if (!main.setOrUnsetMesh(picking.getMesh(), ctrl))
      return false;

    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;
    return false;
  }

  end() {
    this._gizmo.onMouseUp();

    if (!this.getMesh() || this.isIdentity(this.getMesh().getEditMatrix()))
      return;

    var meshes = this._main.getSelectedMeshes();
    const main = this._main;

    for (var i = 0; i < meshes.length; ++i) {
      const mesh = meshes[i];
      const em = mesh.getEditMatrix();
      
      const oldMat = mat4.clone(mesh.getMatrix());
      
      const newMat = mat4.create();
      mat4.mul(newMat, oldMat, em);
      
      main.getStateManager().pushStateCustom(() => {
        // UNDO
        mat4.copy(mesh.getMatrix(), oldMat);
        mesh.updateMatrices(main.getCamera());
        main.render();
      }, () => {
        // REDO
        mat4.copy(mesh.getMatrix(), newMat);
        mesh.updateMatrices(main.getCamera());
        main.render();
      });

      // Apply to current state
      mat4.copy(mesh.getMatrix(), newMat);
      mat4.identity(em);
      mesh.updateMatrices(main.getCamera());
    }
    
    if (window._animationRegistry && window._animationRegistry.isRecording) {
      window._animationRegistry.stopRecording();
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
