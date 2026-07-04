import ShaderBase from '../render/shaders/ShaderBase.js';

var Export = {};

// versions
// 1 initial
// 2 + camera,shader, matcap, wire, alpha, flat
// 3 faces u32 instead of i32
// 4 label string
// 5 (SGL2) Multiresolution stack & Animation track caching
// 8 blendshape tracks (baseShape, deltas, weight keyframes, tangents)
// 9 blendshape lock/active-layer state (baseLocked, active editing layer, per-layer lock/mute)
// 10 per-object visibility track (step-held vis keyframes)
// 11 camera framing (view transform) in the header
Export.VERSION = 11;

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
    var hasShape = track && track.shapeTimes && track.shapeTimes.length > 0 ? 1 : 0;
    var hasTransform = track && track.times && track.times.length > 0 ? 2 : 0;
    var hasAnim = hasShape | hasTransform;

    if (hasShape) {
      var nbKeys = track.shapeTimes.length;
      var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();
      nbBytes += 4; // nbKeys
      nbBytes += nbKeys * 4; // shapeTimes
      nbBytes += nbKeys * 4; // shapeOutputTimes
      nbBytes += nbKeys * 20; // tangents (5 floats)
      nbBytes += nbKeys * activeVertCount * 12; // shapes
    }
    
    if (hasTransform) {
      var nbTransKeys = track.times.length;
      nbBytes += 4; // nbTransKeys
      nbBytes += nbTransKeys * 4;  // times
      nbBytes += nbTransKeys * 12; // pos
      nbBytes += nbTransKeys * 16; // quat
      nbBytes += nbTransKeys * 12; // scale
      nbBytes += nbTransKeys * 36; // tangents (9 floats per key)

      nbBytes += 12 + 16 + 12; // rest pos/quat/scale
    }

    // Blendshape tracks
    nbBytes += 4; // hasBlendshapes flag
    var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();
    if (track && track.blendshapes && track.blendshapes.size > 0) {
      nbBytes += 4; // hasBaseShape flag
      if (track.baseShape) nbBytes += activeVertCount * 12; // baseShape verts
      nbBytes += 4; // nbBlendshapes
      track.blendshapes.forEach((delta, name) => {
        nbBytes += 64;                 // name (16 uint32s, 2 chars each)
        nbBytes += activeVertCount * 12; // delta verts
        var bTrack = track.blendshapeTracks ? track.blendshapeTracks.get(name) : null;
        var nbBsKeys = bTrack ? bTrack.times.length : 0;
        nbBytes += 4;              // nbKeys
        nbBytes += nbBsKeys * 28;  // per key: time, value, rightDt, rightDv, leftDt, leftDv, tied (7 floats)
      });
      // v9: baseLocked + activeLayerIdx + per-layer (locked, muted)
      nbBytes += 8;
      nbBytes += track.blendshapes.size * 8;
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

    // v11: camera framing (view transform) so a save restores the viewpoint. The view is
    // derived from these 4 state vectors (Camera.computeView): quatRot, trans, center, offset.
    f32a.set(cam._quatRot, off); off += 4;
    f32a.set(cam._trans,   off); off += 3;
    f32a.set(cam._center,  off); off += 3;
    f32a.set(cam._offset,  off); off += 3;

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
        // Bypassed setSelection entirely so active vertex deltas do not abort!

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
        
        var vArr = lvl.getVertices();
        var copyV = Math.min(vArr ? vArr.length : 0, nbVertices * 3);
        f32a.set(vArr.subarray(0, copyV), off);
        off += copyV;
        if (copyV < nbVertices * 3) {
          f32a.fill(0, off, off + (nbVertices * 3 - copyV));
          off += (nbVertices * 3 - copyV);
        }

        var cArr = lvl.getColors ? lvl.getColors() : null;
        var nbColors = cArr && cArr.length > 0 ? nbVertices : 0;
        if (L === levels.length - 1) {
          let _nw = 0;
          if (cArr) { for (let _ii = 0; _ii < Math.min(cArr.length, nbVertices*3); _ii += 3) if (cArr[_ii] < 0.99 || cArr[_ii+1] < 0.99 || cArr[_ii+2] < 0.99) _nw++; }
          console.log(`[SXR Export] L${L}: verts=${nbVertices} cArr.len=${cArr?.length} nonWhiteVerts=${_nw} first3=[${cArr ? Array.from(cArr.subarray(0,3)).map(v=>v.toFixed(3)) : 'null'}]`);
        }
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

        // The label lives on the Multimesh (`mesh`), not its levels (`lvl` is a bare
        // MeshResolution) — so read it from `mesh` first or multi-meshes save "Mesh N".
        let labelStr = mesh._permanentStaticLabel || lvl._permanentStaticLabel || ("Mesh " + (i + 1));
        for (let k = 0; k < 16; k++) {
          let char1 = (k * 2 < labelStr.length) ? labelStr.charCodeAt(k * 2) : 0;
          let char2 = (k * 2 + 1 < labelStr.length) ? labelStr.charCodeAt(k * 2 + 1) : 0;
          u32a[off++] = (char1 << 16) | char2;
        }
      }

      // Export completely silent! Live buffers preserve exactly.

      var track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
      var hasShape = track && track.shapeTimes && track.shapeTimes.length > 0 ? 1 : 0;
      var hasTransform = track && track.times && track.times.length > 0 ? 2 : 0;
      var hasAnim = hasShape | hasTransform;

      u32a[off++] = hasAnim;

      if (hasShape) {
        var nbKeys = track.shapeTimes.length;
        var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();

        u32a[off++] = nbKeys;
        for (var k = 0; k < nbKeys; ++k) {
          f32a[off++] = track.shapeTimes[k];
          f32a[off++] = track.shapeOutputTimes ? track.shapeOutputTimes[k] : track.shapeTimes[k];
          
          const rightDt = track.tangentOffsets ? track.tangentOffsets[`${k}_right_dt`] : undefined;
          const rightDv = track.tangentOffsets ? track.tangentOffsets[`${k}_right_dv`] : undefined;
          const leftDt = track.tangentOffsets ? track.tangentOffsets[`${k}_left_dt`] : undefined;
          const leftDv = track.tangentOffsets ? track.tangentOffsets[`${k}_left_dv`] : undefined;
          const tied = track.tangentOffsets ? track.tangentOffsets[`${k}_tied`] !== false : true;

          f32a[off++] = rightDt !== undefined ? rightDt : 25;
          f32a[off++] = rightDv !== undefined ? rightDv : 0;
          f32a[off++] = leftDt !== undefined ? leftDt : -25;
          f32a[off++] = leftDv !== undefined ? leftDv : 0;
          f32a[off++] = tied ? 1.0 : 0.0;

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
      
      if (hasTransform) {
        var nbTransKeys = track.times.length;
        u32a[off++] = nbTransKeys;
        
        for (var k = 0; k < nbTransKeys; ++k) {
          f32a[off++] = track.times[k];
        }
        for (var k = 0; k < nbTransKeys * 3; ++k) {
          f32a[off++] = track.positions[k];
        }
        for (var k = 0; k < nbTransKeys * 4; ++k) {
          f32a[off++] = track.quaternions[k];
        }
        for (var k = 0; k < nbTransKeys * 3; ++k) {
          f32a[off++] = track.scales[k];
        }
        
        // Write Tangents (9 floats per key)
        for (var k = 0; k < nbTransKeys; ++k) {
          const dt = (k < nbTransKeys - 1) ? track.times[k+1] - track.times[k] : 0.2;
          
          const rDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dt`] : undefined;
          const lDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dt`] : undefined;
          const tied = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_tied`] !== false : true;

          f32a[off++] = rDt !== undefined ? rDt : dt * 0.33;
          for (let c = 0; c < 3; c++) {
            const rDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dv_${c}`] : undefined;
            const slope = window._animationRegistry ? window._animationRegistry.getCurveSlope(track, k, c) : 0;
            f32a[off++] = rDv !== undefined ? rDv : slope * (rDt !== undefined ? rDt : dt * 0.33);
          }

          f32a[off++] = lDt !== undefined ? lDt : -dt * 0.33;
          for (let c = 0; c < 3; c++) {
            const lDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dv_${c}`] : undefined;
            const slope = window._animationRegistry ? window._animationRegistry.getCurveSlope(track, k, c) : 0;
            f32a[off++] = lDv !== undefined ? lDv : slope * (lDt !== undefined ? lDt : -dt * 0.33);
          }

          f32a[off++] = tied ? 1.0 : 0.0;
        }
        
        // Write rest pose safely
        var rP = track.restPos || [0,0,0];
        var rQ = track.restQuat || [0,0,0,1];
        var rS = track.restScale || [1,1,1];

        f32a[off++] = rP[0]; f32a[off++] = rP[1]; f32a[off++] = rP[2];
        f32a[off++] = rQ[0]; f32a[off++] = rQ[1]; f32a[off++] = rQ[2]; f32a[off++] = rQ[3];
        f32a[off++] = rS[0]; f32a[off++] = rS[1]; f32a[off++] = rS[2];
      }

      // Write blendshape tracks
      var activeVertCount = (isMulti ? mesh.getCurrentMesh() : mesh).getNbVertices();
      var hasBlendshapes = track && track.blendshapes && track.blendshapes.size > 0 ? 1 : 0;
      u32a[off++] = hasBlendshapes;

      if (hasBlendshapes) {
        var hasBaseShape = track.baseShape ? 1 : 0;
        u32a[off++] = hasBaseShape;
        if (hasBaseShape) {
          var bsCopy = Math.min(track.baseShape.length, activeVertCount * 3);
          f32a.set(track.baseShape.subarray(0, bsCopy), off);
          off += bsCopy;
          if (bsCopy < activeVertCount * 3) {
            f32a.fill(0, off, off + (activeVertCount * 3 - bsCopy));
            off += (activeVertCount * 3 - bsCopy);
          }
        }

        u32a[off++] = track.blendshapes.size;

        track.blendshapes.forEach((delta, name) => {
          // Name: 16 uint32s, 2 chars each (up to 32 chars)
          for (var n = 0; n < 16; n++) {
            var c1 = (n * 2     < name.length) ? name.charCodeAt(n * 2)     : 0;
            var c2 = (n * 2 + 1 < name.length) ? name.charCodeAt(n * 2 + 1) : 0;
            u32a[off++] = (c1 << 16) | c2;
          }

          // Delta vertices
          var dCopy = Math.min(delta.length, activeVertCount * 3);
          f32a.set(delta.subarray(0, dCopy), off);
          off += dCopy;
          if (dCopy < activeVertCount * 3) {
            f32a.fill(0, off, off + (activeVertCount * 3 - dCopy));
            off += (activeVertCount * 3 - dCopy);
          }

          // Weight keyframes
          var bTrack = track.blendshapeTracks ? track.blendshapeTracks.get(name) : null;
          var nbBsKeys = bTrack ? bTrack.times.length : 0;
          u32a[off++] = nbBsKeys;
          for (var k = 0; k < nbBsKeys; k++) {
            var bsDt = bTrack.times[k + 1] !== undefined ? bTrack.times[k + 1] - bTrack.times[k] : 0.2;
            var to = bTrack.tangentOffsets;
            var rDt = to && to[`${k}_right_dt`] !== undefined ? to[`${k}_right_dt`] : bsDt * 0.33;
            var rDv = to && to[`${k}_right_dv`] !== undefined ? to[`${k}_right_dv`] : 0;
            var lDt = to && to[`${k}_left_dt`]  !== undefined ? to[`${k}_left_dt`]  : -bsDt * 0.33;
            var lDv = to && to[`${k}_left_dv`]  !== undefined ? to[`${k}_left_dv`]  : 0;
            var tied = (!to || to[`${k}_tied`] !== false) ? 1.0 : 0.0;
            f32a[off++] = bTrack.times[k];
            f32a[off++] = bTrack.values[k];
            f32a[off++] = rDt;
            f32a[off++] = rDv;
            f32a[off++] = lDt;
            f32a[off++] = lDv;
            f32a[off++] = tied;
          }
        });

        // v9: lock + active-layer state, so a reloaded rig restores Base-locked
        // and the previously-active editing layer instead of coming back neutral.
        // Written AFTER all layers (insertion order = import read order, so the
        // activeLayerIdx + per-layer flags line up by index on load).
        var _bsNames = Array.from(track.blendshapes.keys());
        u32a[off++] = track.baseLocked ? 1 : 0;
        var _activeIdx = (track.editingBlendshape == null)
          ? -1 : _bsNames.indexOf(track.editingBlendshape);
        u32a[off++] = _activeIdx < 0 ? 0xFFFFFFFF : _activeIdx;  // 0xFFFFFFFF = Base/none
        for (var _bi = 0; _bi < _bsNames.length; _bi++) {
          u32a[off++] = (track.blendshapeLocked && track.blendshapeLocked.has(_bsNames[_bi])) ? 1 : 0;
          u32a[off++] = (track.blendshapeMuted  && track.blendshapeMuted.has(_bsNames[_bi]))  ? 1 : 0;
        }
      }

      // v10: per-object visibility track (step-held). Independent block, always
      // written (0 keys when the object isn't vis-animated).
      var nbVisKeys = (track && track.visTimes) ? track.visTimes.length : 0;
      u32a[off++] = nbVisKeys;
      for (var _vi = 0; _vi < nbVisKeys; _vi++) {
        f32a[off++] = track.visTimes[_vi];
        u32a[off++] = track.visValues[_vi] ? 1 : 0;
      }
    }

    var data = new DataView(buffer, 0, off * 4);

    // Frame-by-frame (cel) animation: append an independent, footer-located block
    // after the mesh data. Old importers stop after the mesh data and ignore it.
    var parts = [data];
    // Frame-group structure (SR + voxel frames): appended footer block.
    try {
      if (main && main._frameGroup) {
        var fgrpBuf = main._frameGroup.serialize(meshes);
        if (fgrpBuf && fgrpBuf.byteLength) parts.push(fgrpBuf);
      }
    } catch (e) {
      console.error('[FrameGroup] export append failed', e);
    }
    return new Blob(parts, { type: 'application/octet-stream' });
  } catch (e) {
    if (window.screenLog) {
      window.screenLog('[SXR Crash] ' + e.name + ': ' + e.message, 'red');
    }
    console.error(e);
    return null;
  }
};

export default Export;
