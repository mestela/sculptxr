import * as THREE from 'three';

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

    // We expect a File object (from input)
    var reader = new FileReader();
    reader.onload = (e) => {
      var img = new Image();
      img.src = e.target.result;
      img.src = e.target.result;
      img.onload = () => {
        if (img.width === 0 || img.height === 0) {
          // Retry once after a short delay? Or just fail safely.
          // Sometimes browsers report 0 if still "decoding" or blocked?
          // But onload should mean ready.
          if (window.screenLog) window.screenLog("Ref Img Error: 0x0 size", "red");
          return;
        }
        this.addReference(img);
      }
      img.onerror = () => {
        if (window.screenLog) window.screenLog("Ref Img Load Error", "red");
      }
    };
    reader.readAsDataURL(file);
  }

  addReference(img) {
    // A reference is just an unlit textured plane in the scene. (The old
    // MeshReference was a WebGL-only mesh with no three.js object, so it never
    // rendered after the migration.)
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    // Size: a little bigger than the current model, with the image's aspect ratio.
    // Use the model's WORLD bounding box converted into worldGroup-local space (the
    // raw geometry bbox is tiny before the mesh's own transform — that's why it
    // appeared minuscule).
    const aspect = (img.width || 1) / (img.height || 1);
    const parent = this._main._worldGroup || this._main._scene;
    let h = 70;                              // fallback (worldGroup-local units)
    let center = new THREE.Vector3(0, 0, 0); // centre of the world
    const mesh = this._main.getMesh?.();
    const tm = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (tm && parent) {
      const box = new THREE.Box3().setFromObject(tm); // world space
      if (!box.isEmpty()) {
        parent.updateWorldMatrix(true, false);
        box.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert()); // → worldGroup-local
        const size = new THREE.Vector3(); box.getSize(size);
        box.getCenter(center);
        h = Math.max(1, size.y) * 1.3;
      }
    }

    const geo = new THREE.PlaneGeometry(h * aspect, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    const card = new THREE.Mesh(geo, mat);
    card.position.copy(center);
    card._isReference = true;

    if (parent) parent.add(card);
    this._references.push(card);

    this._main.render?.();
    if (window.screenLog) window.screenLog('Reference Added', 'lime');
  }

  clear() {
    const parent = this._main._worldGroup || this._main._scene;
    for (var i = 0; i < this._references.length; ++i) {
      var card = this._references[i];
      if (parent) parent.remove(card);
      card.geometry?.dispose?.();
      if (card.material) { card.material.map?.dispose?.(); card.material.dispose?.(); }
    }
    this._references = [];
    this._main.render?.();
  }
}

export default ReferenceManager;
