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

    // v11: restore camera framing (view transform). Flag it so loadScene skips the
    // auto-reframe and keeps the saved viewpoint.
    if (version >= 11) {
      cam._quatRot = [f32a[off++], f32a[off++], f32a[off++], f32a[off++]];
      cam._trans   = [f32a[off++], f32a[off++], f32a[off++]];
      cam._center  = [f32a[off++], f32a[off++], f32a[off++]];
      cam._offset  = [f32a[off++], f32a[off++], f32a[off++]];
      // setMode() above may have queued a resetViewFront lerp — cancel it so it doesn't
      // drift the camera off the restored framing, then apply the restored view.
      cam.clearTimers?.();
      cam.updateView?.();
      main._loadedCameraFraming = true;
    }
    if (version >= 13) {
      window._animMasterDuration = f32a[off++];
      window._animLoopStart = f32a[off++];
      window._animLoopEnd = f32a[off++];
    }
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

      // v12: per-face group ids (steers guided quad remesh). Copy out of the file buffer
      // so the mesh owns it (allocateArrays later resizes/preserves it to nbFaces).
      if (version >= 12) {
        nbElts = u32a[off++];
        if (nbElts > 0) mesh.setFacesGroups(new Int32Array(i32a.subarray(off, off + nbElts)));
        off += nbElts;
      }

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
      var globalOptTemp = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;

      // Initialise every parsed level directly from its saved data — no subdivision
      // reconstruction.  Using addLevel() was wrong because it calls fullSubdivision
      // which (a) calls computeTexCoords when the mesh has UV, inflating _colorsRGB
      // beyond the saved size, and (b) creates slightly different vertex counts when
      // the mesh has UV duplicate vertices, corrupting the colour copy.
      var parsedLevels = baseMesh._parsedLevels;
      for (var L = 0; L < parsedLevels.length; ++L) {
        parsedLevels[L].allocateArrays();
        parsedLevels[L].initTopology();
      }

      var lvl0 = parsedLevels[0];
      var mm = new Multimesh(lvl0);
      if (baseMesh._permanentStaticLabel) {
        mm._permanentStaticLabel = baseMesh._permanentStaticLabel;
      }
      mm.getCurrentMesh().constructor.OPTIMIZE = false;

      // Push levels 1–N directly, sharing each parsed level's data.
      for (var L = 1; L < parsedLevels.length; ++L) {
        var lvlN = new MeshResolution(parsedLevels[L], true); // keepMesh=true → shares data
        mm._meshes.push(lvlN);
        mm._sel = L;
        mm.setMeshData(lvlN.getMeshData());
      }

      Mesh.OPTIMIZE = globalOptTemp;

      // Create Three.js mesh objects for every level.
      for (let L = 0; L < mm._meshes.length; L++) {
        if (mm._meshes[L].initThreeMesh) mm._meshes[L].initThreeMesh();
      }
      if (mm.initThreeMesh) mm.initThreeMesh();

      mm.setSelection(activeIndex);
      const _c = mm.getColors();
      let _nwL = 0;
      if (_c) { for (let _ii = 0; _ii < _c.length; _ii += 3) if (_c[_ii] < 0.99 || _c[_ii+1] < 0.99 || _c[_ii+2] < 0.99) _nwL++; }
      console.log(`[SXR Load] after setSelection(${activeIndex}): colors.len=${_c?.length} nonWhiteVerts=${_nwL} first3=[${_c ? Array.from(_c.subarray(0,3)).map(v=>v.toFixed(3)) : 'null'}]`);
      mm.updateResolution();
      mm.initRender();
      // Restore the wireframe state from the saved file (don't force it on).
      const savedWireframe = parsedLevels[activeIndex] ?
        parsedLevels[activeIndex].getRenderData()._showWireframe : false;
      mm.setShowWireframe(!!savedWireframe);
      if (mm.updateWireframeBuffer) mm.updateWireframeBuffer();
      meshes.push(mm);
    }

    var finalMesh = isMulti ? meshes[meshes.length - 1] : baseMesh;
    if (baseMesh._permanentStaticLabel) {
      finalMesh._permanentStaticLabel = baseMesh._permanentStaticLabel;
    }

    if (version >= 5) {
      var hasAnimMask = u32a[off++];
      if (hasAnimMask > 0) {
        var trackObj = { 
          shapeTimes: [], shapes: [],
          times: [], positions: [], quaternions: [], scales: [],
          restPos: [0,0,0], restQuat: [0,0,0,1], restScale: [1,1,1],
          playbackTime: 0, lastUpdate: performance.now() 
        };
        var maxTime = 0;

        if (hasAnimMask & 1) {
          var nbKeys = u32a[off++];
          for (var k = 0; k < nbKeys; ++k) {
            var time = f32a[off++];
            
            let outputTime = time;
            if (version >= 7) {
              outputTime = f32a[off++];
              
              if (!trackObj.tangentOffsets) trackObj.tangentOffsets = {};
              
              trackObj.tangentOffsets[`${k}_right_dt`] = f32a[off++];
              trackObj.tangentOffsets[`${k}_right_dv`] = f32a[off++];
              trackObj.tangentOffsets[`${k}_left_dt`] = f32a[off++];
              trackObj.tangentOffsets[`${k}_left_dv`] = f32a[off++];
              trackObj.tangentOffsets[`${k}_tied`] = (f32a[off++] > 0.5);
            }
            
            var activeVCount = finalMesh.getNbVertices();
            
            var shapeArr = new Float32Array(activeVCount * 3);
            shapeArr.set(f32a.subarray(off, off + activeVCount * 3));
            off += activeVCount * 3;

            trackObj.shapeTimes.push(time);
            if (!trackObj.shapeOutputTimes) trackObj.shapeOutputTimes = [];
            trackObj.shapeOutputTimes.push(outputTime);
            trackObj.shapes.push(shapeArr);
            if (time > maxTime) maxTime = time;
          }
        }

        if (hasAnimMask & 2) {
          var nbTransKeys = u32a[off++];
          for (var k = 0; k < nbTransKeys; ++k) trackObj.times.push(f32a[off++]);
          for (var k = 0; k < nbTransKeys * 3; ++k) trackObj.positions.push(f32a[off++]);
          for (var k = 0; k < nbTransKeys * 4; ++k) trackObj.quaternions.push(f32a[off++]);
          for (var k = 0; k < nbTransKeys * 3; ++k) trackObj.scales.push(f32a[off++]);

          if (version >= 6) {
            trackObj.tangentOffsets = {};
            for (var k = 0; k < nbTransKeys; ++k) {
              const rDt = f32a[off++];
              trackObj.tangentOffsets[`trans_${k}_right_dt`] = rDt;
              for (let c = 0; c < 3; c++) {
                trackObj.tangentOffsets[`trans_${k}_right_dv_${c}`] = f32a[off++];
              }

              const lDt = f32a[off++];
              trackObj.tangentOffsets[`trans_${k}_left_dt`] = lDt;
              for (let c = 0; c < 3; c++) {
                trackObj.tangentOffsets[`trans_${k}_left_dv_${c}`] = f32a[off++];
              }

              const tied = f32a[off++];
              trackObj.tangentOffsets[`trans_${k}_tied`] = (tied > 0.5);
            }
          }

          var rP = [f32a[off++], f32a[off++], f32a[off++]];
          var rQ = [f32a[off++], f32a[off++], f32a[off++], f32a[off++]];
          var rS = [f32a[off++], f32a[off++], f32a[off++]];

          trackObj.restPos = rP;
          trackObj.restQuat = rQ;
          trackObj.restScale = rS;

          if (trackObj.times.length > 0) {
             var lastT = trackObj.times[trackObj.times.length - 1];
             if (lastT > maxTime) maxTime = lastT;
          }
        }

        AnimationRegistry.tracks.set(finalMesh.getID(), trackObj);

        if (maxTime > (window._animMasterDuration || 0)) {
          window._animMasterDuration = maxTime;
        }
      }
    }

    // Read blendshape tracks (version 8+)
    if (version >= 8) {
      var hasBlendshapes = u32a[off++];
      if (hasBlendshapes) {
        var nbVerts = finalMesh.getNbVertices();
        var trackObj = AnimationRegistry.tracks.get(finalMesh.getID());
        if (!trackObj) {
          trackObj = {
            shapeTimes: [], shapes: [], shapeOutputTimes: [],
            times: [], positions: [], quaternions: [], scales: [],
            restPos: [0,0,0], restQuat: [0,0,0,1], restScale: [1,1,1],
            playbackTime: 0, lastUpdate: performance.now()
          };
          AnimationRegistry.tracks.set(finalMesh.getID(), trackObj);
        }

        var hasBaseShape = u32a[off++];
        if (hasBaseShape) {
          trackObj.baseShape = new Float32Array(nbVerts * 3);
          trackObj.baseShape.set(f32a.subarray(off, off + nbVerts * 3));
          off += nbVerts * 3;
        }

        trackObj.blendshapes    = new Map();
        trackObj.blendshapeTracks = new Map();

        var nbBlendshapes = u32a[off++];
        var _bsNames = [];
        for (var b = 0; b < nbBlendshapes; b++) {
          // Read name
          var bsName = '';
          for (var n = 0; n < 16; n++) {
            var packed = u32a[off++];
            var c1 = (packed >> 16) & 0xFFFF;
            var c2 = packed & 0xFFFF;
            if (c1) bsName += String.fromCharCode(c1);
            if (c2) bsName += String.fromCharCode(c2);
          }

          // Read delta
          var delta = new Float32Array(nbVerts * 3);
          delta.set(f32a.subarray(off, off + nbVerts * 3));
          off += nbVerts * 3;
          trackObj.blendshapes.set(bsName, delta);
          _bsNames.push(bsName);

          // Read weight keyframes
          var nbBsKeys = u32a[off++];
          var bTrack = { times: [], values: [] };
          if (nbBsKeys > 0) {
            bTrack.tangentOffsets = {};
            for (var k = 0; k < nbBsKeys; k++) {
              bTrack.times.push(f32a[off++]);
              bTrack.values.push(f32a[off++]);
              bTrack.tangentOffsets[`${k}_right_dt`] = f32a[off++];
              bTrack.tangentOffsets[`${k}_right_dv`] = f32a[off++];
              bTrack.tangentOffsets[`${k}_left_dt`]  = f32a[off++];
              bTrack.tangentOffsets[`${k}_left_dv`]  = f32a[off++];
              bTrack.tangentOffsets[`${k}_tied`]     = f32a[off++] > 0.5;
            }
          }
          trackObj.blendshapeTracks.set(bsName, bTrack);
        }

        // v9: restore lock + active-layer state (written after all layers, indexed
        // by the same insertion order we just read). Older files default to base
        // locked once blendshapes exist (matches the runtime default in #39).
        trackObj.blendshapeLocked = new Set();
        trackObj.blendshapeMuted  = new Set();
        if (version >= 9) {
          trackObj.baseLocked = u32a[off++] > 0;
          var _activeIdx = u32a[off++];
          trackObj.editingBlendshape = (_activeIdx === 0xFFFFFFFF || _activeIdx >= _bsNames.length)
            ? null : _bsNames[_activeIdx];
          for (var _bi = 0; _bi < nbBlendshapes; _bi++) {
            if (u32a[off++] > 0) trackObj.blendshapeLocked.add(_bsNames[_bi]);
            if (u32a[off++] > 0) trackObj.blendshapeMuted.add(_bsNames[_bi]);
          }
        } else {
          // Pre-v9 file: no stored state. Lock Base by default (it's the runtime
          // default once a rig exists) and leave no layer active.
          trackObj.baseLocked = nbBlendshapes > 0;
          trackObj.editingBlendshape = null;
        }
      }
    }

    // v10: per-object visibility track. Written for EVERY mesh (0 keys when absent),
    // so read the count unconditionally to keep the byte offset aligned.
    if (version >= 10) {
      var nbVisKeys = u32a[off++];
      if (nbVisKeys > 0) {
        var visTrack = AnimationRegistry.tracks.get(finalMesh.getID());
        if (!visTrack) {
          visTrack = {
            times: [], positions: [], quaternions: [], scales: [],
            shapeTimes: [], shapes: [], shapeOutputTimes: [],
            playbackTime: 0, lastUpdate: performance.now(),
          };
          AnimationRegistry.tracks.set(finalMesh.getID(), visTrack);
        }
        visTrack.visTimes = [];
        visTrack.visValues = [];
        for (var _vi = 0; _vi < nbVisKeys; _vi++) {
          visTrack.visTimes.push(f32a[off++]);
          visTrack.visValues.push(u32a[off++] > 0 ? 1 : 0);
        }
      }
    }
  }

  // NOTE: FrameGroup structure is reconstructed by Scene.loadScene AFTER these meshes are
  // added to the scene — setMeshParent/getMeshes need them in main._meshes first.

  return meshes;
};

export default Import;
