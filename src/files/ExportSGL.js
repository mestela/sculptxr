import ShaderBase from '../render/shaders/ShaderBase.js';

var Export = {};

// versions
// 1 initial
// 2 + camera,shader, matcap, wire, alpha, flat 
// 3 faces u32 instead of i32
// 4 label string
// 5 (SGL2) Multiresolution stack & Animation track caching
Export.VERSION = 5;

Export.exportSGL = function (meshes, main) {
  var nbMeshes = meshes.length;

  var nbBytes = 4 * (1 + 3 + 4 + 1);

  for (var i = 0; i < nbMeshes; ++i) {
    var mesh = meshes[i];
    var isMulti = mesh._meshes && mesh._meshes.length > 0 ? 1 : 0;

    nbBytes += 4;

    var levels = isMulti ? mesh._meshes : [mesh];

    if (isMulti) {
      nbBytes += 8;
    }

    for (var L = 0; L < levels.length; ++L) {
      var lvl = levels[L];

      nbBytes += 4 * 5;
      nbBytes += 4 * (3 + 16 + 1);

      var nbVerts = lvl.getNbVertices();
      nbBytes += 4 + nbVerts * 12;

      nbBytes += 4 + (lvl.getColors() ? nbVerts * 12 : 0);
      nbBytes += 4 + (lvl.getMaterials() ? nbVerts * 12 : 0);

      nbBytes += 4 + lvl.getNbFaces() * 16;

      var hasUV = lvl.hasUV();
      nbBytes += 4 + (hasUV ? lvl.getNbTexCoords() * 8 : 0);
      nbBytes += 4 + (hasUV ? lvl.getNbFaces() * 16 : 0);

      nbBytes += 32;
    }

    nbBytes += 4;

    var track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
    var hasAnim = track && track.shapeTimes && track.shapeTimes.length > 0 ? 1 : 0;

    if (hasAnim) {
      var nbKeys = track.shapeTimes.length;
      var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();
      nbBytes += 4;
      nbBytes += nbKeys * 4;
      nbBytes += nbKeys * activeVertCount * 12;
    }
  }

  try {
    var buffer = new ArrayBuffer(nbBytes + 10000000); // 10MB Over-allocation Safety Margin!
    var f32a = new Float32Array(buffer);
    var u32a = new Uint32Array(buffer);
    var off = 0;

    u32a[off++] = Export.VERSION;

    u32a[off++] = main._showGrid;
    u32a[off++] = ShaderBase.showSymmetryLine;
    u32a[off++] = main._showContour;

    var cam = main.getCamera();
    u32a[off++] = cam.getProjectionType();
    u32a[off++] = cam.getMode();
    f32a[off++] = cam.getFov();
    u32a[off++] = cam.getUsePivot();

    u32a[off++] = nbMeshes;

    for (var i = 0; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      var isMulti = mesh._meshes && mesh._meshes.length > 0 ? 1 : 0;

      u32a[off++] = isMulti;

      var levels = isMulti ? mesh._meshes : [mesh];

      if (isMulti) {
        u32a[off++] = levels.length;
        u32a[off++] = mesh._sel !== undefined ? mesh._sel : 0;
      }

      var originalSel = isMulti ? mesh._sel : 0;

      for (var L = 0; L < levels.length; ++L) {
        if (isMulti) {
          mesh.setSelection(L);
          mesh.updateResolution();
        }

        var lvl = levels[L];

        u32a[off++] = lvl.getShaderType ? lvl.getShaderType() : 1;
        u32a[off++] = lvl.getMatcap ? lvl.getMatcap() : 0;
        u32a[off++] = lvl.getShowWireframe ? lvl.getShowWireframe() : 0;
        u32a[off++] = lvl.getFlatShading ? lvl.getFlatShading() : 0;
        f32a[off++] = lvl.getOpacity ? lvl.getOpacity() : 1.0;

        var center = lvl.getCenter ? lvl.getCenter() : [0,0,0];
        f32a.set(center, off);
        off += 3;
        
        var matrix = lvl.getMatrix ? lvl.getMatrix() : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        f32a.set(matrix, off);
        off += 16;
        
        f32a[off++] = lvl.getScale ? lvl.getScale() : 1.0;

        var nbVertices = lvl.getNbVertices();
        u32a[off++] = nbVertices;
        
        var vArr = (isMulti ? mesh : lvl).getVertices();
        var copyV = Math.min(vArr ? vArr.length : 0, nbVertices * 3);
        f32a.set(vArr.subarray(0, copyV), off);
        off += copyV;
        if (copyV < nbVertices * 3) {
          f32a.fill(0, off, off + (nbVertices * 3 - copyV));
          off += (nbVertices * 3 - copyV);
        }

        var cArr = lvl.getColors ? lvl.getColors() : null;
        var nbColors = cArr && cArr.length > 0 ? nbVertices : 0;
        u32a[off++] = nbColors;
        if (nbColors > 0) {
          var copyC = Math.min(cArr.length, nbVertices * 3);
          f32a.set(cArr.subarray(0, copyC), off);
          off += copyC;
          if (copyC < nbVertices * 3) {
            f32a.fill(0, off, off + (nbVertices * 3 - copyC));
            off += (nbVertices * 3 - copyC);
          }
        }

        var mArr = lvl.getMaterials ? lvl.getMaterials() : null;
        var nbMaterials = mArr && mArr.length > 0 ? nbVertices : 0;
        u32a[off++] = nbMaterials;
        if (nbMaterials > 0) {
          var copyM = Math.min(mArr.length, nbVertices * 3);
          f32a.set(mArr.subarray(0, copyM), off);
          off += copyM;
          if (copyM < nbVertices * 3) {
            f32a.fill(0, off, off + (nbVertices * 3 - copyM));
            off += (nbVertices * 3 - copyM);
          }
        }

        var nbFaces = lvl.getNbFaces();
        u32a[off++] = nbFaces;
        var fArr = lvl.getFaces();
        var copyF = Math.min(fArr ? fArr.length : 0, nbFaces * 4);
        u32a.set(fArr.subarray(0, copyF), off);
        off += copyF;
        if (copyF < nbFaces * 4) {
          u32a.fill(0, off, off + (nbFaces * 4 - copyF));
          off += (nbFaces * 4 - copyF);
        }

        var hasUV = lvl.hasUV ? lvl.hasUV() : false;
        var nbTexCoords = hasUV ? lvl.getNbTexCoords() : 0;
        u32a[off++] = nbTexCoords;
        if (hasUV && nbTexCoords > 0) {
          var tArr = lvl.getTexCoords();
          var copyT = Math.min(tArr ? tArr.length : 0, nbTexCoords * 2);
          f32a.set(tArr.subarray(0, copyT), off);
          off += copyT;
          if (copyT < nbTexCoords * 2) {
            f32a.fill(0, off, off + (nbTexCoords * 2 - copyT));
            off += (nbTexCoords * 2 - copyT);
          }
        }

        u32a[off++] = hasUV ? nbFaces : 0;
        if (hasUV && nbFaces > 0) {
          var ftArr = lvl.getFacesTexCoord();
          var copyFT = Math.min(ftArr ? ftArr.length : 0, nbFaces * 4);
          u32a.set(ftArr.subarray(0, copyFT), off);
          off += copyFT;
          if (copyFT < nbFaces * 4) {
            u32a.fill(0, off, off + (nbFaces * 4 - copyFT));
            off += (nbFaces * 4 - copyFT);
          }
        }

        let labelStr = lvl._permanentStaticLabel || ("Mesh " + (i + 1));
        for (let k = 0; k < 16; k++) {
          let char1 = (k * 2 < labelStr.length) ? labelStr.charCodeAt(k * 2) : 0;
          let char2 = (k * 2 + 1 < labelStr.length) ? labelStr.charCodeAt(k * 2 + 1) : 0;
          u32a[off++] = (char1 << 16) | char2;
        }
      }

      if (isMulti) {
        mesh.setSelection(originalSel);
        mesh.updateResolution();
      }

      var track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
      var hasAnim = track && track.shapeTimes && track.shapeTimes.length > 0 ? 1 : 0;

      u32a[off++] = hasAnim;

      if (hasAnim) {
        var nbKeys = track.shapeTimes.length;
        var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();

        u32a[off++] = nbKeys;
        for (var k = 0; k < nbKeys; ++k) {
          f32a[off++] = track.shapeTimes[k];
          var shapeArr = track.shapes[k];
          var lenToCopy = Math.min(shapeArr.length, activeVertCount * 3);
          
          f32a.set(shapeArr.subarray(0, lenToCopy), off);
          off += lenToCopy;
          
          var padding = activeVertCount * 3 - lenToCopy;
          if (padding > 0) {
            f32a.fill(0, off, off + padding);
            off += padding;
          }
        }
      }
    }

    var data = new DataView(buffer, 0, off * 4);
    return new Blob([data]);
  } catch (e) {
    if (window.screenLog) {
      window.screenLog('[SXR Crash] ' + e.name + ': ' + e.message, 'red');
    }
    console.error(e);
    return null;
  }
};

export default Export;
