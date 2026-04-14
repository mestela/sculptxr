import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import ExportSGL from './ExportSGL.js';
import ShaderBase from '../render/shaders/ShaderBase.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import MeshResolution from '../mesh/multiresolution/MeshResolution.js';
import AnimationRegistry from '../editing/AnimationRegistry.js';
import Mesh from '../mesh/Mesh.js';

var Import = {};

var handleNegativeIndexFace = function (i32) {
  var u32 = new Uint32Array(i32);
  var nbFaces = u32.length / 4;
  for (var i = 0; i < nbFaces; ++i) {
    var idd = i * 4 + 3;
    if (i32[idd] < 0)
      u32[idd] = Utils.TRI_INDEX;
  }

  return u32;
};

// see ExportSGL for file description
//
/** Import SGL file */
Import.importSGL = function (buffer, gl, main) {
  var f32a = new Float32Array(buffer);
  var u32a = new Uint32Array(buffer);
  var i32a = new Int32Array(buffer);

  var off = 0;
  var version = u32a[off++];
  if (version > ExportSGL.VERSION)
    return [];

  // camera stuffs
  if (version >= 2) {
    main._showGrid = u32a[off++];
    ShaderBase.showSymmetryLine = u32a[off++];
    main._showContour = u32a[off++];

    var cam = main.getCamera();
    cam.setProjectionType(u32a[off++]);
    cam.setMode(u32a[off++]);
    cam.setFov(f32a[off++]);
    cam.setUsePivot(u32a[off++]);
  }

  var nbMeshes = u32a[off++];
  var meshes = [];
  for (var i = 0; i < nbMeshes; ++i) {
    var isMulti = 0;
    var numLevels = 1;
    var activeIndex = 0;

    if (version >= 5) {
      isMulti = u32a[off++];
      if (isMulti) {
        numLevels = u32a[off++];
        activeIndex = u32a[off++];
      }
    }

    var baseMesh = null;

    for (var L = 0; L < numLevels; ++L) {
      var mesh = new MeshStatic(gl);
      if (!baseMesh) baseMesh = mesh;

      if (version >= 2) {
        var render = mesh.getRenderData();
        render._shaderType = u32a[off++];
        render._matcap = u32a[off++];
        render._showWireframe = u32a[off++];
        render._flatShading = u32a[off++];
        render._alpha = f32a[off++];
        console.log(`[SXR Binary Parse] Level ${L} parsed flags - Shader: ${render._shaderType}, ShowWireframe: ${render._showWireframe}`);
      }

      mesh.getCenter().set(f32a.subarray(off, off + 3));
      off += 3;
      mesh.getMatrix().set(f32a.subarray(off, off + 16));
      off += 16;
      off++;

      var nbElts = u32a[off++];
      mesh.setVertices(f32a.subarray(off, off + nbElts * 3));
      off += nbElts * 3;

      nbElts = u32a[off++];
      if (nbElts > 0) mesh.setColors(f32a.subarray(off, off + nbElts * 3));
      off += nbElts * 3;

      nbElts = u32a[off++];
      if (nbElts > 0) mesh.setMaterials(f32a.subarray(off, off + nbElts * 3));
      off += nbElts * 3;

      nbElts = u32a[off++];
      if (version <= 2) {
        mesh.setFaces(handleNegativeIndexFace(i32a.subarray(off, off + nbElts * 4)));
      } else {
        mesh.setFaces(u32a.subarray(off, off + nbElts * 4));
      }
      off += nbElts * 4;

      nbElts = u32a[off++];
      var uv = null;
      if (nbElts) uv = f32a.subarray(off, off + nbElts * 2);
      off += nbElts * 2;

      nbElts = u32a[off++];
      var fuv = null;
      if (nbElts) {
        if (version <= 2) fuv = handleNegativeIndexFace(i32a.subarray(off, off + nbElts * 4));
        else fuv = u32a.subarray(off, off + nbElts * 4);
      }
      off += nbElts * 4;

      if (uv && fuv) mesh.initTexCoordsDataFromOBJData(uv, fuv);

      if (version >= 4) {
        let decodedStr = "";
        for (let k = 0; k < 16; k++) {
          let u = u32a[off++];
          let c1 = (u >> 16) & 0xFFFF;
          let c2 = u & 0xFFFF;
          if (c1 !== 0) decodedStr += String.fromCharCode(c1);
          if (c2 !== 0) decodedStr += String.fromCharCode(c2);
        }
        if (decodedStr.length > 0) mesh._permanentStaticLabel = decodedStr;
      }

      if (!isMulti) {
        meshes.push(mesh);
      } else {
        if (!baseMesh._parsedLevels) baseMesh._parsedLevels = [];
        baseMesh._parsedLevels.push(mesh);
      }
    }

    if (isMulti && baseMesh && baseMesh._parsedLevels) {
      var lvl0 = baseMesh._parsedLevels[0];
      var globalOptTemp = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false; // Enforce absolute base-class lock!
      lvl0.allocateArrays();
      lvl0.initTopology();

      var mm = new Multimesh(lvl0);
      if (baseMesh._permanentStaticLabel) {
        mm._permanentStaticLabel = baseMesh._permanentStaticLabel;
      }
      var optTemp = mm.getCurrentMesh().constructor.OPTIMIZE;
      mm.getCurrentMesh().constructor.OPTIMIZE = false;

      for (var L = 1; L < baseMesh._parsedLevels.length; ++L) {
        var parsedLvl = baseMesh._parsedLevels[L];
        var nextLevel = mm.addLevel(); // Restores topological linkage absolutely!

        // Hard drop the spatial vectors from the parsed save directly over the valid links
        var targetVerts = nextLevel.getVertices();
        var sourceVerts = parsedLvl.getVertices();
        if (targetVerts && sourceVerts) {
            targetVerts.set(sourceVerts.subarray(0, targetVerts.length));
        }
        nextLevel.updateGeometry();
      }

      Mesh.OPTIMIZE = globalOptTemp;

      console.log(`[SXR] Multiresolution hierarchy loaded and synchronized natively.`);
      
      // CRITICAL FIX: initRender() does not create the Three.js WebGL representations! We must call initThreeMesh() on all levels!
      for (let L = 0; L < mm._meshes.length; L++) {
          if (mm._meshes[L].initThreeMesh) {
              mm._meshes[L].initThreeMesh();
          }
      }
      if (mm.initThreeMesh) {
          mm.initThreeMesh();
      }

      mm.setSelection(activeIndex);
      console.log(`[SXR Import Debug] Multimesh initialized. ActiveIndex: ${activeIndex}`);
      
      for (let L = 0; L < mm._meshes.length; L++) {
          var lvl = mm._meshes[L];
          var vArr = lvl.getVertices();
          var fArr = lvl.getFaces();
          
          let vStr = "";
          for (let i = 0; i < Math.min(vArr.length, 36); i += 3) {
              vStr += `[${vArr[i].toFixed(2)}, ${vArr[i+1].toFixed(2)}, ${vArr[i+2].toFixed(2)}] `;
          }
          let fStr = "";
          for (let i = 0; i < Math.min(fArr.length, 48); i += 4) {
              fStr += `(${fArr[i]}, ${fArr[i+1]}, ${fArr[i+2]}, ${fArr[i+3] === -1 ? 'TRI' : fArr[i+3]}) `;
          }
          console.log(`[SXR TOPOLOGY DUMP] Level ${L} Vertices: ${vStr}`);
          console.log(`[SXR TOPOLOGY DUMP] Level ${L} Faces: ${fStr}`);
      }

      mm.updateResolution();
      mm.initRender();
      mm.setShowWireframe(true);
      if (mm.updateWireframeBuffer) {
          mm.updateWireframeBuffer();
      }
      meshes.push(mm);
      
      console.log(`[SXR] Multiresolution Hierarchy Complete! Active Index: ${activeIndex}`);
      
      var debugMesh = mm.getCurrentMesh();
      var debugVerts = debugMesh.getVertices();
      var debugTris = debugMesh.getTriangles();
      
      console.log("[SXR DIAGNOSTIC] Level " + activeIndex + " First 12 Vertices (X,Y,Z):");
      var vStr = "";
      for (let d=0; d<36; d+=3) {
          vStr += `[${debugVerts[d].toFixed(2)}, ${debugVerts[d+1].toFixed(2)}, ${debugVerts[d+2].toFixed(2)}] `;
      }
      console.log(vStr);
      
      console.log("[SXR DIAGNOSTIC] Level " + activeIndex + " First 24 Indices:");
      var iStr = "";
      if (debugTris) {
          for (let d=0; d<24; d+=3) {
              iStr += `(${debugTris[d]}, ${debugTris[d+1]}, ${debugTris[d+2]}) `;
          }
          console.log(iStr);
      } else {
          console.log("NO INDICES FOUND!");
      }

      var debugWire = debugMesh.getWireframe();
      console.log(`[SXR DIAGNOSTIC] Level ${activeIndex} Wireframe Length: ${debugWire ? debugWire.length : 0}`);
      if (debugWire && debugWire.length >= 16) {
          var wStr = "";
          for (let w=0; w<16; w+=2) {
              wStr += `[${debugWire[w]} -> ${debugWire[w+1]}] `;
          }
          console.log(`[SXR DIAGNOSTIC] Level ${activeIndex} First 8 Wireframe Edges: ${wStr}`);
      }
    }

    var finalMesh = isMulti ? meshes[meshes.length - 1] : baseMesh;
    if (baseMesh._permanentStaticLabel) {
      finalMesh._permanentStaticLabel = baseMesh._permanentStaticLabel;
    }

    if (version >= 5) {
      var hasAnim = u32a[off++];
      if (hasAnim) {
        var nbKeys = u32a[off++];
        console.log(`[SXR] Parsing Animation Track... Total Keyframes: ${nbKeys}`);
        var trackObj = { shapeTimes: [], shapes: [] };
        var maxTime = 0;

        for (var k = 0; k < nbKeys; ++k) {
          var time = f32a[off++];
          var activeVCount = finalMesh.getNbVertices();
          
          var shapeArr = new Float32Array(activeVCount * 3);
          shapeArr.set(f32a.subarray(off, off + activeVCount * 3));
          off += activeVCount * 3;

          trackObj.shapeTimes.push(time);
          trackObj.shapes.push(shapeArr);
          if (time > maxTime) maxTime = time;
          console.log(`[SXR] -> Read Keyframe ${k} at time ${time.toFixed(2)}s`);
        }

        trackObj.times = [];
        trackObj.positions = [];
        trackObj.quaternions = [];
        trackObj.scales = [];
        trackObj.playbackTime = 0;
        trackObj.lastUpdate = performance.now();

        AnimationRegistry.tracks.set(finalMesh.getID(), trackObj);
        
        if (maxTime > (window._animMasterDuration || 0)) {
          window._animMasterDuration = maxTime;
        }
        window._animPlaying = true;

        console.log(`[SXR] Successfully mounted Animation Track to Mesh ID: ${finalMesh.getID()}`);
      }
    }
  }

  return meshes;
};

export default Import;
