import MeshStatic from 'mesh/meshStatic/MeshStatic';
import RenderData from 'mesh/RenderData';
import Shader from 'render/ShaderLib';
import Enums from 'misc/Enums';

class MeshReference extends MeshStatic {

  constructor(gl) {
    super(gl);
    this.setID(MeshStatic.ID++);
    this._isReference = true;
    this._isSculptable = false;
    this._isExportable = false;
    this.isPickable = true; // Ensure pickable
    this._texture = null;
    this._texWidth = 1;
    this._texHeight = 1;

    // Default to Unlit Texture Shader
    // this.setShaderType(Enums.Shader.TEXTURE); // Defer to loadTexture to avoid crash
  }

  get isReference() {
    return this._isReference;
  }

  loadTexture(img) {
    var gl = this.getGL();
    if (this._texture) gl.deleteTexture(this._texture);

    this._texWidth = img.width;
    this._texHeight = img.height;

    if (this._texWidth === 0 || this._texHeight === 0) {
      // Fallback to avoid crash
      this._texWidth = 256;
      this._texHeight = 256;
    }

    this._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (window.screenLog) window.screenLog(`Ref Img Loaded: ${this._texWidth}x${this._texHeight}`, "lime");
    console.log(`Ref Img Loaded: ${this._texWidth}x${this._texHeight}`);

    // Update simple quad geometry to match aspect ratio
    this.updatePlaneGeometry();

    // Set Shader Type AFTER geometry is initialized to avoid crash
    this.setShaderType(Enums.Shader.TEXTURE);
  }

  updatePlaneGeometry() {
    // 1 unit height, width based on aspect ratio
    var ratio = this._texWidth / this._texHeight;
    var scale = 50.0; // Larger default scale
    var x = ratio * 0.5 * scale;
    var y = 0.5 * scale; // Total height 1 * scale

    var vAr = new Float32Array([
      -x, -y, 0.0,
      x, -y, 0.0,
      x, y, 0.0,
      -x, y, 0.0
    ]);

    var fAr = new Int32Array([
      0, 1, 2, 3
    ]);

    var tAr = new Float32Array([
      0.0, 1.0,
      1.0, 1.0,
      1.0, 0.0,
      0.0, 0.0
    ]);

    // Ensure Colors and Materials are initialized (RenderData expects them)
    // 4 Unit Colors (White)
    var cAr = new Float32Array([
      1.0, 1.0, 1.0,
      1.0, 1.0, 1.0,
      1.0, 1.0, 1.0,
      1.0, 1.0, 1.0
    ]);

    // 4 Unit Materials (Roughness 1, Metalness 0, Mask 0)
    var mAr = new Float32Array([
      1.0, 0.0, 0.0,
      1.0, 0.0, 0.0,
      1.0, 0.0, 0.0,
      1.0, 0.0, 0.0
    ]);

    this.setVertices(vAr);
    this.setFaces(fAr);
    this.setTexCoords(tAr);
    this.setFacesTexCoord(fAr); // Required because hasUV() is true
    this.setColors(cAr);
    this.setMaterials(mAr);

    // Force Shader Type to be TEXTURE always?
    // The render loop might override it if checking Global options.
    // We can override getShaderType() to always return TEXTURE?
    // Let's do that for MeshReference.

    // Standard Init
    this.init();

    // Update Buffers
    this.updateGeometryBuffers();

    this.setShaderType(Enums.Shader.TEXTURE);

    // if (this.getRenderData()) {
    //   this.getRenderData().updateGeometry(); // Does not exist
    // } else {
    //   this.initRender();
    // }
  }

  render(main) {
    if (!this.isVisible()) return;
    if (!this._texture) return;

    // Use TEXTURE shader
    // We need to bind texture before draw? 
    // ShaderTexture checks for mesh.getTexture() usually?
    // Let's ensure shader uses THIS texture

    var gl = this.getGL();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);

    super.render(main);
  }

  getTexture() {
    return this._texture;
  }

  getShaderType() {
    return Enums.Shader.TEXTURE;
  }

  getTexture0() {
    return this._texture;
  }

  isUsingTexCoords() {
    return true;
  }

  updateDuplicateGeometry(iVerts) {
    // Reference meshes don't have duplicate geometry (hard edges) like normal meshes might?
    // Or rather, we just want to skip this expensive update.
    return;
  }

  updateDuplicateColorsAndMaterials(iVerts) {
    // Override to prevent crash on missing duplicateStartCount
    return;
  }

  optimize() {
    // No optimization for reference images
  }
}

export default MeshReference;
