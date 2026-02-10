import MeshReference from '../mesh/MeshReference.js?v=fix_3';
import Utils from '../misc/Utils.js?v=fix_3';

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
    var gl = this._main._gl;
    var mesh = new MeshReference(gl);
    mesh.loadTexture(img);

    // Add to Scene Meshes
    this._main.getMeshes().push(mesh);
    this._references.push(mesh);

    // Explicitly force render to ensure texture is uploaded?
    this._main.render();

    // Position in front of camera?
    // Default creation is at 0,0,0 usually? MeshStatic default.
    // Maybe move it slightly up?
    // mat4.translate(mesh.getMatrix(), mesh.getMatrix(), [0, 1.2, -0.5]); // Near head?
    // Let's rely on standard spawn logic if any, or just 0,0,0.

    this._main.render();
    if (window.screenLog) window.screenLog('Reference Added', 'lime');
  }

  clear() {
    // Remove all references from scene
    var meshes = this._main.getMeshes();
    for (var i = 0; i < this._references.length; ++i) {
      var ref = this._references[i];
      var idx = meshes.indexOf(ref);
      if (idx !== -1) meshes.splice(idx, 1);
      // Delete texture?
      // ref.deleteTexture(); // if method exists
    }
    this._references = [];
    this._main.render();
  }
}

export default ReferenceManager;
