import MeshReference from '../mesh/MeshReference.js';
import * as THREE from 'three';
import { mat4 } from 'gl-matrix';

class ReferenceManager {

  constructor(main) {
    this._main = main;
    this._references = [];

    // Bind Event Listener
    const input = document.getElementById('referenceopen');
    if (input) {
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.importReference(e.target.files[0]);
          input.value = ''; // Reset
        }
      });
    }
  }

  // Import Image
  importReference(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = (e) => {
      var img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        if (img.width === 0 || img.height === 0) {
          if (window.screenLog) window.screenLog('Ref Img Error: 0x0 size', 'red');
          return;
        }
        this.addReference(img);
      };
      img.onerror = () => {
        if (window.screenLog) window.screenLog('Ref Img Load Error', 'red');
      };
    };
    reader.readAsDataURL(file);
  }

  addReference(img) {
    const main = this._main;
    // A reference is a first-class mesh (MeshReference): it lives in getMeshes(), so
    // it shows in the outliner and can be selected / transformed / hidden / etc.
    const mesh = new MeshReference(main._gl);
    mesh._typeName = 'Reference';
    mesh.loadTexture(img); // builds the aspect-correct plane geometry (with UVs) + three mesh

    // Position at the model centre, sized ~1.3× the model (plane base height = 50,
    // see MeshReference.updatePlaneGeometry). Worked out in worldGroup-local space.
    const parent = main._worldGroup || main._scene;
    let factor = 1.3, center = [0, 0, 0];
    const cur = main.getMesh?.();
    const ctm = cur && cur.getThreeMesh && cur.getThreeMesh();
    if (ctm && parent) {
      const box = new THREE.Box3().setFromObject(ctm);
      if (!box.isEmpty()) {
        parent.updateWorldMatrix(true, false);
        box.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert());
        const size = new THREE.Vector3(); box.getSize(size);
        const c = new THREE.Vector3(); box.getCenter(c);
        factor = (Math.max(1, size.y) * 1.3) / 50;
        center = [c.x, c.y, c.z];
      }
    }
    const m = mat4.create();
    mat4.translate(m, m, center);
    mat4.scale(m, m, [factor, factor, factor]);
    mesh.setMatrix(m);

    main.addNewMesh(mesh); // → getMeshes(), attach to scene, select, push undo state

    // The default material isn't textured in three.js — apply the image as a map.
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (tm) {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      if (tm.material && tm.material.dispose) tm.material.dispose();
      tm.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    }

    this._references.push(mesh);
    main.render?.();
    if (window.screenLog) window.screenLog('Reference Added', 'lime');
  }

  clear() {
    for (const ref of this._references) {
      const tm = ref.getThreeMesh && ref.getThreeMesh();
      if (tm && tm.material) { tm.material.map?.dispose?.(); tm.material.dispose?.(); }
    }
    if (this._references.length) this._main.removeMeshes?.(this._references.slice());
    this._references = [];
    this._main.render?.();
  }
}

export default ReferenceManager;
