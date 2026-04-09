import ShaderBase from '../render/shaders/ShaderBase.js';

var Export = {};

// versions
// 1 initial
// 2 + camera,shader, matcap, wire, alpha, flat 
// 3 faces u32 instead of i32
Export.VERSION = 4;

Export.exportSGL = function (meshes, main) {
  var nbMeshes = meshes.length;

  var bytePerMesh = 3 + 16 + 1 + 6 + 5 + 16;
  var nbBytes = 4 * (1 + 3 + 4 + 1 + nbMeshes * bytePerMesh);
  var i = 0;
  var mesh;
  for (i = 0; i < nbMeshes; ++i) {
    mesh = meshes[i];
    nbBytes += mesh.getNbVertices() * 4 * 3;
    if (mesh.getColors())
      nbBytes += mesh.getNbVertices() * 4 * 3;
    if (mesh.getMaterials())
      nbBytes += mesh.getNbVertices() * 4 * 3;
    nbBytes += mesh.getNbFaces() * 4 * 4;
    if (mesh.hasUV()) {
      nbBytes += mesh.getNbTexCoords() * 4 * 2;
      nbBytes += mesh.getNbFaces() * 4 * 4;
    }
  }

  var buffer = new ArrayBuffer(nbBytes);
  var f32a = new Float32Array(buffer);
  var u32a = new Uint32Array(buffer);
  var off = 0;
  u32a[off++] = Export.VERSION;

  // misc stuffs
  u32a[off++] = main._showGrid;
  u32a[off++] = ShaderBase.showSymmetryLine;
  u32a[off++] = main._showContour;

  // camera stuffs
  var cam = main.getCamera();
  u32a[off++] = cam.getProjectionType();
  u32a[off++] = cam.getMode();
  f32a[off++] = cam.getFov();
  u32a[off++] = cam.getUsePivot();

  // save meshes
  u32a[off++] = nbMeshes;
  for (i = 0; i < nbMeshes; ++i) {
    mesh = meshes[i];

    // shader + matcap + wire + alpha + flat 
    u32a[off++] = mesh.getShaderType();
    u32a[off++] = mesh.getMatcap();
    u32a[off++] = mesh.getShowWireframe();
    u32a[off++] = mesh.getFlatShading();
    f32a[off++] = mesh.getOpacity();

    // center + matrix + scale
    f32a.set(mesh.getCenter(), off);
    off += 3;
    f32a.set(mesh.getMatrix(), off);
    off += 16;
    f32a[off++] = mesh.getScale();

    // vertices
    var nbVertices = mesh.getNbVertices();
    u32a[off++] = nbVertices;
    f32a.set(mesh.getVertices().subarray(0, nbVertices * 3), off);
    off += nbVertices * 3;

    // colors
    var nbColors = mesh.getColors() ? nbVertices : 0;
    u32a[off++] = nbColors;
    if (nbColors > 0)
      f32a.set(mesh.getColors().subarray(0, nbVertices * 3), off);
    off += nbColors * 3;

    // materials
    var nbMaterials = mesh.getMaterials() ? nbVertices : 0;
    u32a[off++] = nbMaterials;
    if (nbMaterials > 0)
      f32a.set(mesh.getMaterials().subarray(0, nbVertices * 3), off);
    off += nbMaterials * 3;

    // faces
    var nbFaces = mesh.getNbFaces();
    u32a[off++] = nbFaces;
    u32a.set(mesh.getFaces().subarray(0, nbFaces * 4), off);
    off += nbFaces * 4;

    var hasUV = mesh.hasUV();
    // uvs
    var nbTexCoords = mesh.getNbTexCoords();
    u32a[off++] = hasUV ? nbTexCoords : 0;
    if (hasUV) {
      f32a.set(mesh.getTexCoords().subarray(0, nbTexCoords * 2), off);
      off += nbTexCoords * 2;
    }

    // face uvs
    u32a[off++] = hasUV ? nbFaces : 0;
    if (hasUV) {
      u32a.set(mesh.getFacesTexCoord().subarray(0, nbFaces * 4), off);
      off += nbFaces * 4;
    }

    // name / label (v4)
    let labelStr = mesh._permanentStaticLabel || ("Mesh " + (i + 1));
    for (let k = 0; k < 16; k++) {
      let char1 = (k * 2 < labelStr.length) ? labelStr.charCodeAt(k * 2) : 0;
      let char2 = (k * 2 + 1 < labelStr.length) ? labelStr.charCodeAt(k * 2 + 1) : 0;
      u32a[off++] = (char1 << 16) | char2;
    }
  }

  var data = new DataView(buffer, 0, off * 4);
  return new Blob([data]);
};

export default Export;
