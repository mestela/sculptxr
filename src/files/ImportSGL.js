import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import ExportSGL from './ExportSGL.js';
import ShaderBase from '../render/shaders/ShaderBase.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import { installStencils } from './NomMultires.js';
import MeshResolution from '../mesh/multiresolution/MeshResolution.js';
import AnimationRegistry from '../editing/AnimationRegistry.js';
import Mesh from '../mesh/Mesh.js';
import { jiggle } from '../editing/Jiggle.js';
import { idle } from '../editing/IdleFace.js';

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
// BAKED DEFAULTS ARE NOT OVERRIDES.
//
// Blendshape, shape and scalar keys were exported with EVERY key's handles written out, filling
// in the defaults for the ones nobody touched (dt = a third of the next gap, dv = 0; 25 for
// shape keys, which was never even in seconds). Read back, each of those became a hand-set
// override: the auto tangent -- which follows the neighbouring keys -- was replaced by a FLAT
// handle, so every curve came back with slightly wrong tangents, and a shape key got a handle
// 25 seconds long. A key whose five numbers are exactly the exporter's defaults carries no
// information, so it is not stored as an override and the auto tangent comes back.
function isBakedDefaultKey(rDt, rDv, lDt, lDv, tied, defDt) {
  var near = function (a, b) { return Math.abs(a - b) < 1e-4; };
  return tied && rDv === 0 && lDv === 0 && near(rDt, defDt) && near(lDt, -defDt);
}
// Store a key's tangent record unless it is the baked default. `next` = the following key's time.
function setKeyTangents(to, k, t, next, rDt, rDv, lDt, lDv, tied, fixedDefault) {
  var defDt = fixedDefault !== undefined ? fixedDefault : (next !== undefined ? next - t : 0.2) * 0.33;
  if (isBakedDefaultKey(rDt, rDv, lDt, lDv, tied, defDt)) return;
  to[k + '_right_dt'] = rDt;
  to[k + '_right_dv'] = rDv;
  to[k + '_left_dt'] = lDt;
  to[k + '_left_dv'] = lDv;
  to[k + '_tied'] = tied;
}

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
      // RESET BEFORE READING, so a v13/v14 file does not inherit the project start of whatever
      // was loaded before it. Zero is what the project start has always implicitly been, so an
      // older file lands exactly where it used to.
      window._animProjectStart = 0;
      if (version >= 15) window._animProjectStart = f32a[off++];
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

      // v26: glass group ids, applied to the finished object below (its render data is shared)
      if (version >= 26) {
        nbElts = u32a[off++];
        if (nbElts > 0) baseMesh._parsedGlass = new Set(i32a.subarray(off, off + nbElts));
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

      // Push levels 1–N directly, sharing each parsed level's mesh data. All resolutions of a
      // Multimesh must also share ONE RenderData/Three.js object. Keeping each parsed level's
      // private RenderData attached higher-level wireframes to objects that never enter the scene;
      // level 0 appeared only because its render object is the one owned by the Multimesh.
      for (var L = 1; L < parsedLevels.length; ++L) {
        var lvlN = new MeshResolution(parsedLevels[L], true); // keepMesh=true → shares data
        lvlN.setRenderData(mm.getRenderData());
        lvlN.setTransformData(mm.getTransformData());
        mm._meshes.push(lvlN);
        mm._sel = L;
        mm.setMeshData(lvlN.getMeshData());
      }

      Mesh.OPTIMIZE = globalOptTemp;

      // a Nomad-style stack (triangles in the cage) subdivides by its own stencil, which a save does not carry
      installStencils(mm, MeshResolution);

      // There is deliberately one render object for the complete resolution stack.
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
    if (baseMesh._parsedGlass && finalMesh.setGlassGroups) finalMesh.setGlassGroups(baseMesh._parsedGlass);
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
              
              // 25 / -25 is the exporter's stand-in for "no handle"; see isBakedDefaultKey.
              var _sr = f32a[off++], _srv = f32a[off++], _sl = f32a[off++], _slv = f32a[off++];
              setKeyTangents(trackObj.tangentOffsets, k, time, undefined, _sr, _srv, _sl, _slv, f32a[off++] > 0.5, 25);
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

          if (version >= 16) {
            trackObj.eulers = [];
            for (var k = 0; k < nbTransKeys * 3; ++k) trackObj.eulers.push(f32a[off++]);
            trackObj.keyMask = [];
            for (var k = 0; k < nbTransKeys; ++k) trackObj.keyMask.push(u32a[off++]);
            var nbTan = u32a[off++];
            var KINDS = ['right_dt', 'left_dt', 'right_dv', 'left_dv', 'tied'];
            var GROUPS = ['pos', 'rot', 'scale'];
            trackObj.tangentOffsets = {};
            for (var r = 0; r < nbTan; ++r) {
              var slot = u32a[off++], g = GROUPS[u32a[off++]], kind = KINDS[u32a[off++]], ch = u32a[off++];
              var val = f32a[off++];
              var key = 'trans_' + g + '_' + slot + '_' + kind + (kind === 'right_dv' || kind === 'left_dv' ? '_' + ch : '');
              trackObj.tangentOffsets[key] = kind === 'tied' ? val > 0.5 : val;
            }
          } else if (version >= 6) {
            // v6-v15 wrote the DEFAULT tangents out for every key, so they are not overrides and
            // are skipped: kept, they froze every loaded key's auto tangents and made Simplify
            // treat every key as hand-set. Genuinely hand-set handles in those files are lost.
            off += nbTransKeys * 9;
          }

          var rP = [f32a[off++], f32a[off++], f32a[off++]];
          var rQ = [f32a[off++], f32a[off++], f32a[off++], f32a[off++]];
          var rS = [f32a[off++], f32a[off++], f32a[off++]];

          trackObj.restPos = rP;
          trackObj.restQuat = rQ;
          trackObj.restScale = rS;

          if (version >= 17) {
            var hasRef = u32a[off++];
            var eR = [f32a[off++], f32a[off++], f32a[off++], f32a[off++]];
            if (hasRef) trackObj.eulerRef = eR;
          }

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

          // Read delta (v20: sparse, the vertices it moves)
          var delta;
          if (version >= 20) {
            var _rd = ExportSGL.readDelta(u32a, f32a, off, nbVerts);
            delta = _rd[0]; off = _rd[1];
          } else {
            delta = new Float32Array(nbVerts * 3);
            delta.set(f32a.subarray(off, off + nbVerts * 3));
            off += nbVerts * 3;
          }
          trackObj.blendshapes.set(bsName, delta);
          _bsNames.push(bsName);

          // Read weight keyframes
          var nbBsKeys = u32a[off++];
          var bTrack = { times: [], values: [] };
          if (nbBsKeys > 0) {
            bTrack.tangentOffsets = {};
            var _raw = [];
            for (var k = 0; k < nbBsKeys; k++) {
              bTrack.times.push(f32a[off++]);
              bTrack.values.push(f32a[off++]);
              var _t5 = [f32a[off++], f32a[off++], f32a[off++], f32a[off++]], _tf = f32a[off++];
              _raw.push([_t5[0], _t5[1], _t5[2], _t5[3], (_tf % 2) > 0.5, _tf]);
            }
            for (var k = 0; k < nbBsKeys; k++) {
              var _r = _raw[k];
              if (version >= 24) {
                // v24: the tied float carries which values were set (ExportSGL notes); exactly those.
                var _tf = _r[5], _mask = Math.floor(_tf / 2);
                var _vals = [_r[0], _r[1], _r[2], _r[3], (_tf - 2 * _mask) > 0.5];
                ['right_dt', 'right_dv', 'left_dt', 'left_dv', 'tied'].forEach(function (f, bit) {
                  if (_mask & (1 << bit)) bTrack.tangentOffsets[k + '_' + f] = _vals[bit];
                });
                continue;
              }
              setKeyTangents(bTrack.tangentOffsets, k, bTrack.times[k], bTrack.times[k + 1], _r[0], _r[1], _r[2], _r[3], _r[4]);
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

    // v14: scalar channels (pin weight, physics blend weight). Read unconditionally at v14+,
    // count first, to keep the offset aligned exactly as the vis block above does.
    if (version >= 14) {
      var nbScalarCh = u32a[off++];
      for (var _sc = 0; _sc < nbScalarCh; _sc++) {
        var sName = '';
        for (var _sn = 0; _sn < 16; _sn++) {
          var _pk = u32a[off++];
          var _c1 = (_pk >>> 16) & 0xFFFF, _c2 = _pk & 0xFFFF;
          if (_c1) sName += String.fromCharCode(_c1);
          if (_c2) sName += String.fromCharCode(_c2);
        }
        var nbSKeys = u32a[off++];
        var sTrack = AnimationRegistry.tracks.get(finalMesh.getID());
        if (!sTrack) {
          sTrack = {
            times: [], positions: [], quaternions: [], scales: [],
            shapeTimes: [], shapes: [], shapeOutputTimes: [],
            playbackTime: 0, lastUpdate: performance.now(),
          };
          AnimationRegistry.tracks.set(finalMesh.getID(), sTrack);
        }
        if (!sTrack.scalarTracks) sTrack.scalarTracks = new Map();
        var _st = { times: [], values: [], tangentOffsets: {} };
        var _sraw = [];
        for (var _sk = 0; _sk < nbSKeys; _sk++) {
          _st.times.push(f32a[off++]);
          _st.values.push(f32a[off++]);
          _sraw.push([f32a[off++], f32a[off++], f32a[off++], f32a[off++], f32a[off++] > 0.5]);
        }
        for (var _sk = 0; _sk < nbSKeys; _sk++) {
          var _q = _sraw[_sk];
          setKeyTangents(_st.tangentOffsets, _sk, _st.times[_sk], _st.times[_sk + 1], _q[0], _q[1], _q[2], _q[3], _q[4]);
        }
        if (nbSKeys > 0) sTrack.scalarTracks.set(sName, _st);
      }
    }

    // v18: combination shapes, by blendshape index.
    if (version >= 18) {
      var nbCombos = u32a[off++];
      var cTrack = AnimationRegistry.tracks.get(finalMesh.getID());
      var cNames = cTrack && cTrack.blendshapes ? Array.from(cTrack.blendshapes.keys()) : [];
      for (var _ci = 0; _ci < nbCombos; _ci++) {
        var cName = cNames[u32a[off++]];
        var nbDrv = u32a[off++], drv = [];
        for (var _di = 0; _di < nbDrv; _di++) drv.push(cNames[u32a[off++]]);
        // v19: in-between samples (v18 combos have none and read as one sample at 1).
        var samples = null;
        if (version >= 19) {
          var sTop = f32a[off++], nbLower = u32a[off++];
          samples = [];
          var nv3 = finalMesh.getNbVertices() * 3;
          for (var _li = 0; _li < nbLower; _li++) {
            var sS = f32a[off++], sD;
            if (version >= 20) {
              var _rs = ExportSGL.readDelta(u32a, f32a, off, nv3 / 3);
              sD = _rs[0]; off = _rs[1];
            } else {
              sD = new Float32Array(nv3);
              sD.set(f32a.subarray(off, off + nv3));
              off += nv3;
            }
            samples.push({ s: sS, d: sD });
          }
          if (sTop > 0 && cName) samples.push({ s: sTop, d: cTrack.blendshapes.get(cName) });
          // v20: the pose each sample was sculpted at.
          if (version >= 20) {
            for (var _pi = 0, _np = nbLower + (sTop > 0 ? 1 : 0); _pi < _np; _pi++) {
              var hasPose = u32a[off++], pose = {};
              for (var _pd = 0; _pd < nbDrv; _pd++) pose[drv[_pd]] = f32a[off++];
              if (hasPose && samples[_pi]) samples[_pi].pose = pose;
            }
          }
        }
        if (cName && drv.every(Boolean)) {
          if (!cTrack.blendshapeCombos) cTrack.blendshapeCombos = new Map();
          cTrack.blendshapeCombos.set(cName, drv);
          if (samples) {
            if (!cTrack.comboSamples) cTrack.comboSamples = new Map();
            cTrack.comboSamples.set(cName, samples);
          }
        }
      }

      // v21: poses, as name + [shapeIdx, weight] pairs.
      if (version >= 21) {
        var nbPoses = u32a[off++];
        for (var _po = 0; _po < nbPoses; _po++) {
          var pName = '';
          for (var _pn = 0; _pn < 16; _pn++) {
            var _pv = u32a[off++], _p1 = _pv >>> 16, _p2 = _pv & 0xFFFF;
            if (_p1) pName += String.fromCharCode(_p1);
            if (_p2) pName += String.fromCharCode(_p2);
          }
          var nbW = u32a[off++], pw = {};
          for (var _pw = 0; _pw < nbW; _pw++) {
            var sIdx = u32a[off++], sW = f32a[off++];
            if (cNames[sIdx]) pw[cNames[sIdx]] = sW;
          }
          if (cTrack && pName) {
            if (!cTrack.blendshapePoses) cTrack.blendshapePoses = new Map();
            cTrack.blendshapePoses.set(pName, pw);
          }
        }
      }

      // v22: layers left out of the Face tool.
      if (version >= 22) {
        var nbNoFace = u32a[off++];
        for (var _nf = 0; _nf < nbNoFace; _nf++) {
          var nfName = cNames[u32a[off++]];
          if (cTrack && nfName) (cTrack.blendshapeNoFace || (cTrack.blendshapeNoFace = new Set())).add(nfName);
        }
      }

      // v23: the neutral the shapes were made on (Retarget Shapes), as its offset from the base.
      if (version >= 23 && u32a[off++]) {
        var _rd = ExportSGL.readDelta(u32a, f32a, off, finalMesh.getNbVertices());
        off = _rd[1];
        var nbSkip = u32a[off++], rSkip = new Set();
        for (var _rs2 = 0; _rs2 < nbSkip; _rs2++) { var rsName = cNames[u32a[off++]]; if (rsName) rSkip.add(rsName); }
        if (cTrack && cTrack.baseShape && cTrack.baseShape.length === _rd[0].length) {
          var rRef = _rd[0];
          for (var _ri = 0; _ri < rRef.length; _ri++) rRef[_ri] += cTrack.baseShape[_ri];
          cTrack.shapeRef = rRef;
          cTrack.shapeRefSkip = rSkip.size ? rSkip : null;
        }
      }

      // v25: the jiggle. The scene's, not the device's: the live values, and the saved slider
      // preferences are left alone.
      if (version >= 25) {
        jiggle.on = u32a[off++] === 1;
        jiggle.gain = f32a[off++]; jiggle.freq = f32a[off++]; jiggle.damp = f32a[off++]; jiggle.max = f32a[off++];
      }
      // v27: the idle face, on the same terms as the jiggle.
      if (version >= 27) {
        idle.on = u32a[off++] === 1;
        idle.rate = f32a[off++]; idle.range = f32a[off++]; idle.pace = f32a[off++]; idle.micro = f32a[off++];
      }
    }
  }

  // NOTE: FrameGroup structure is reconstructed by Scene.loadScene AFTER these meshes are
  // added to the scene — setMeshParent/getMeshes need them in main._meshes first.

  // The saved centre is the symmetry plane's origin, and it is whatever the box centre was at
  // some earlier save -- so a plane that was off the seam stayed off it through every reload.
  // Re-seat it on the seam (Mesh._seamOffset); the other two axes stay as saved.
  for (var s = 0; s < meshes.length; ++s) {
    var sm = meshes[s];
    if (!sm._seamOffset || !sm._meshData || !sm._meshData._octree) continue;
    var sc = sm.getCenter(), sn = sm.getSymmetryNormal(), so = sm._seamOffset(sc);
    for (var k = 0; k < 3; ++k) sc[k] += sn[k] * so;
  }

  return meshes;
};

export default Import;
