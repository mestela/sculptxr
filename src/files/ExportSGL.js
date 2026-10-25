import { rotSync, maskSync } from '../editing/xfChannel.js';
import ShaderBase from '../render/shaders/ShaderBase.js';
import TextureIO from './TextureIO.js';
import MediaRef from './MediaRef.js';
import Skeleton from '../editing/Skeleton.js';
import { jiggle } from '../editing/Jiggle.js';
import { idle } from '../editing/IdleFace.js';

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
// 12 per-face group ids (_facesGroups; steers guided quad remesh)
// 13 animation playback range (master duration, start, end)
// 15 project range START (the range slider's outer left handle; the end is the master duration)
// 16 SPARSE transform keys: per-slot key mask (9 channel bits), unwrapped eulers, and ONLY the
//    tangent overrides that exist, as a list. Up to v15 every key was written with baked default
//    tangents, so every loaded key looked hand-tangented -- frozen auto tangents, and Simplify
//    refusing to touch any of them.
// 17 each transform track's EULER REFERENCE (a joint's rest rotation; its rotation channels are the
//    turn away from it -- see xfChannel). Older files have none: their joint tracks are re-spelled
//    from the quaternions on first use.
// 18 COMBINATION SHAPES (Fix Combo): per mesh, each combo layer's index and its drivers' indices,
//    by blendshape insertion order (names are capped at 32 chars, a driver list is not).
// 19 COMBO IN-BETWEENS: each combo row also carries its top sample's weight (0 = no samples yet;
//    the top sample's delta is the layer's own delta above) and its lower samples, weight + delta.
// 20 SPARSE DELTAS: every blendshape delta and combo sample is written as the vertices it moves
//    (count, index gaps, xyz) instead of every vertex; combo samples also carry their pose (one
//    weight per driver) so pruning works after a reload.
// 23 RETARGET SHAPES: the neutral the shapes were made on (once the Base has been sculpted), as its
//    offset from the base, and the layers sculpted since.
// 24 BLENDSHAPE KEY TANGENTS SAY WHICH VALUES WERE SET: the key's `tied` float carries a mask of
//    the overrides that exist (tied + 2 * mask, bits right_dt, right_dv, left_dt, left_dv, tied).
//    Every key's handles are written with the defaults filled in, so a FLATTENED key (slope 0 at
//    the default length) was byte-identical to an untouched auto one and came back auto.
// 25 JIGGLE: the Face tool's spring jiggle (on, strength, speed, damping, range) on every mesh
//    with blendshapes. It is one setting for the scene; the reader takes the last one it meets.
// 26 GLASS GROUPS: the face-group ids drawn with the transmissive coat (Mesh.setGlassGroups),
//    count + ids after each level's face groups. One setting per object; every level carries it.
// 27 IDLE FACE (on, blink rate, gaze range, pace, micro) after the jiggle, same terms: one setting
//    for the scene, written on every mesh with blendshapes, the last one read wins.
Export.VERSION = 27;

// The vertices of the first nv a delta moves. Shared by the size pass and the write pass, and
// emptied at the start of every export: deltas are sculpted in place between saves.
var _nzCache = new WeakMap();
function nonZero(d, nv) {
  var hit = _nzCache.get(d);
  if (hit && hit.nv === nv) return hit.idx;
  var idx = [], n = Math.min(nv, d.length / 3);
  for (var v = 0; v < n; v++) if (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0) idx.push(v);
  _nzCache.set(d, { nv: nv, idx: idx });
  return idx;
}
function deltaBytes(d, nv) { return 4 + nonZero(d, nv).length * 16; }
Export.writeDelta = function (u32a, f32a, off, d, nv) {
  var idx = nonZero(d, nv);
  u32a[off++] = idx.length;
  // As GAPS from the previous index: mostly 1, which gzip (the server's, for .sxr) takes to nearly
  // nothing. Plain indices made the gzipped ICT head 27% bigger than the dense file.
  for (var j = 0; j < idx.length; j++) u32a[off++] = idx[j] - (j ? idx[j - 1] : 0);
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j] * 3;
    f32a[off++] = d[i]; f32a[off++] = d[i + 1]; f32a[off++] = d[i + 2];
  }
  return off;
};
Export.readDelta = function (u32a, f32a, off, nv) {
  var d = new Float32Array(nv * 3), count = u32a[off++], at = off, vi = 0;
  off += count;
  for (var j = 0; j < count; j++) {
    vi += u32a[at + j];
    var i = vi * 3;
    d[i] = f32a[off++]; d[i + 1] = f32a[off++]; d[i + 2] = f32a[off++];
  }
  return [d, off];
};

// The combos of a track that still exist, as [comboIdx, [driverIdx...]].
// v21: the track's poses as [name, [[shapeIdx, weight]...]], shapes that still exist only.
function poseRows(track) {
  if (!track || !track.blendshapes || !track.blendshapePoses) return [];
  var names = Array.from(track.blendshapes.keys()), rows = [];
  track.blendshapePoses.forEach(function (pose, n) {
    var ws = Object.keys(pose).map(function (s) { return [names.indexOf(s), pose[s]]; })
      .filter(function (e) { return e[0] >= 0; });
    rows.push([n, ws]);
  });
  return rows;
}

// v23: [ref - base, skipped shape indices] or null.
function refRow(track, nv) {
  if (!track || !track.shapeRef || !track.baseShape || track.shapeRef.length !== nv * 3) return null;
  var diff = new Float32Array(nv * 3);
  for (var i = 0; i < diff.length; i++) diff[i] = track.shapeRef[i] - track.baseShape[i];
  var names = Array.from(track.blendshapes ? track.blendshapes.keys() : []);
  var skip = track.shapeRefSkip ? names.map(function (n, i) { return track.shapeRefSkip.has(n) ? i : -1; })
    .filter(function (i) { return i >= 0; }) : [];
  return [diff, skip];
}

// v22: the layers left out of the Face tool, as shape indices.
function noFaceRows(track) {
  if (!track || !track.blendshapes || !track.blendshapeNoFace) return [];
  var names = Array.from(track.blendshapes.keys());
  return names.map(function (n, i) { return track.blendshapeNoFace.has(n) ? i : -1; })
    .filter(function (i) { return i >= 0; });
}

function writeName(u32a, off, name) {
  for (var n = 0; n < 16; n++) {
    var c1 = (n * 2     < name.length) ? name.charCodeAt(n * 2)     : 0;
    var c2 = (n * 2 + 1 < name.length) ? name.charCodeAt(n * 2 + 1) : 0;
    u32a[off++] = (c1 << 16) | c2;
  }
  return off;
}

function comboRows(track) {
  if (!track || !track.blendshapes || !track.blendshapeCombos) return [];
  var names = Array.from(track.blendshapes.keys()), rows = [];
  track.blendshapeCombos.forEach(function (ds, n) {
    var ci = names.indexOf(n), di = ds.map(function (d) { return names.indexOf(d); });
    // Samples: none recorded means a v18 combo, one sample at 1 (its delta is the layer's).
    var S = track.comboSamples && track.comboSamples.get(n);
    var samples = S ? { top: S.length ? S[S.length - 1].s : 0, lower: S.slice(0, -1) } : { top: 1, lower: [] };
    // v20: every sample's pose (lower ones, then the top), a flag then one weight per driver.
    samples.poses = S ? S.map(function (p) { return p.pose ? ds.map(function (d) { return p.pose[d] ?? 1; }) : null; }) : [null];
    if (ci >= 0 && di.every(function (i) { return i >= 0; })) rows.push([ci, di, samples]);
  });
  return rows;
}

var TAN_KINDS = ['right_dt', 'left_dt', 'right_dv', 'left_dv', 'tied'];
var TAN_GROUPS = ['pos', 'rot', 'scale'];
// A track's tangent overrides as [slot, group, kind, channel, value] rows.
function tangentRows(track) {
  var rows = [];
  var to = track.tangentOffsets || {};
  Object.keys(to).forEach(function (k) {
    var m = /^trans_(?:(pos|rot|scale)_)?(\d+)_(right_dt|left_dt|tied|right_dv|left_dv)(?:_(\d))?$/.exec(k);
    if (!m) return;
    var g = TAN_GROUPS.indexOf(m[1] || 'pos');
    var kind = TAN_KINDS.indexOf(m[3]);
    var v = to[k];
    rows.push([+m[2], g, kind, m[4] !== undefined ? +m[4] : 0, typeof v === 'boolean' ? (v ? 1 : 0) : v]);
  });
  return rows;
}

Export.exportSGL = function (meshes, main) {
  _nzCache = new WeakMap();
  var nbMeshes = meshes.length;

  // ...+ 4 for the v13 playback range and the v15 project start, which sit together in the header.
  var nbBytes = 4 * (1 + 3 + 4 + 13 + 4 + 1);

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

      // v12: per-face group ids (nbGroups u32 + Int32 data)
      nbBytes += 4 + ((lvl.getFacesGroups && lvl.getFacesGroups()) ? lvl.getNbFaces() * 4 : 0);
      // v26: glass group ids (count u32 + ids)
      var glassG = mesh.getGlassGroups ? mesh.getGlassGroups() : null;
      nbBytes += 4 + (glassG ? glassG.size * 4 : 0);

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
      nbBytes += nbTransKeys * 12; // eulers
      nbBytes += nbTransKeys * 4;  // key mask
      nbBytes += 4 + tangentRows(track).length * 20; // tangent override rows

      nbBytes += 12 + 16 + 12; // rest pos/quat/scale
      nbBytes += 4 + 16;       // v17: has euler reference + its quaternion
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
        nbBytes += deltaBytes(delta, activeVertCount); // v20: the vertices it moves
        var bTrack = track.blendshapeTracks ? track.blendshapeTracks.get(name) : null;
        var nbBsKeys = bTrack ? bTrack.times.length : 0;
        nbBytes += 4;              // nbKeys
        nbBytes += nbBsKeys * 28;  // per key: time, value, rightDt, rightDv, leftDt, leftDv, tied (7 floats)
      });
      // v9: baseLocked + activeLayerIdx + per-layer (locked, muted)
      nbBytes += 8;
      nbBytes += track.blendshapes.size * 8;
    }

    // v10 visibility + v14 scalar channels. Both are written for EVERY mesh, count first, so
    // the reader keeps its offset aligned without needing a per-mesh flag.
    nbBytes += 4;
    if (track && track.visTimes) nbBytes += track.visTimes.length * 8;
    nbBytes += 4;
    if (track && track.scalarTracks) {
      track.scalarTracks.forEach(function (st) { nbBytes += 64 + 4 + st.times.length * 28; });
    }
    nbBytes += 4;
    comboRows(track).forEach(function (r) {
      nbBytes += 8 + r[1].length * 4 + 8;
      r[2].lower.forEach(function (p) { nbBytes += 4 + deltaBytes(p.d, activeVertCount); });
      nbBytes += r[2].poses.length * (4 + r[1].length * 4);
    });
    nbBytes += 4;
    poseRows(track).forEach(function (r) { nbBytes += 64 + 4 + r[1].length * 8; });
    nbBytes += 4 + noFaceRows(track).length * 4;
    var _rr = refRow(track, activeVertCount);
    nbBytes += 4 + (_rr ? deltaBytes(_rr[0], activeVertCount) + 4 + _rr[1].length * 4 : 0);
    nbBytes += 20;   // v25 jiggle
    nbBytes += 20;   // v27 idle
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

    // v13: playback range is authored scene state, not a UI default. Keeping it beside the
    // camera header makes it available before any animation track is read and avoids deriving
    // a user's deliberate range from whichever track happens to end last.
    f32a[off++] = window._animMasterDuration ?? 2;
    f32a[off++] = window._animLoopStart ?? 0;
    f32a[off++] = window._animLoopEnd ?? window._animMasterDuration ?? 2;
    // v15: the PROJECT range's start. Its end is the master duration above — every consumer
    // already treats that as an absolute end time — so only the start was missing, and without
    // it the range slider's outer left handle survived a reload only as long as the tab did.
    f32a[off++] = window._animProjectStart ?? 0;

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

        // v12: per-face group ids (steers guided quad remesh). 0 count when unpainted.
        var gArr = lvl.getFacesGroups ? lvl.getFacesGroups() : null;
        var nbGroups = gArr && gArr.length > 0 ? nbFaces : 0;
        u32a[off++] = nbGroups;
        if (nbGroups > 0) {
          var copyG = Math.min(gArr.length, nbFaces);
          u32a.set(gArr.subarray(0, copyG), off);
          off += copyG;
          if (copyG < nbFaces) {
            u32a.fill(0, off, off + (nbFaces - copyG));
            off += (nbFaces - copyG);
          }
        }

        // v26: glass group ids
        var glassSet = mesh.getGlassGroups ? mesh.getGlassGroups() : null;
        u32a[off++] = glassSet ? glassSet.size : 0;
        if (glassSet) for (var gid of glassSet) u32a[off++] = gid;

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
        
        // v16: eulers (winding), the key mask, and the tangent overrides that exist.
        var _eul = rotSync(track) || [];
        for (var k = 0; k < nbTransKeys * 3; ++k) f32a[off++] = _eul[k] || 0;
        var _mask = maskSync(track);
        for (var k = 0; k < nbTransKeys; ++k) u32a[off++] = _mask[k];
        var _rows = tangentRows(track);
        u32a[off++] = _rows.length;
        _rows.forEach(function (r) {
          u32a[off++] = r[0]; u32a[off++] = r[1]; u32a[off++] = r[2]; u32a[off++] = r[3];
          f32a[off++] = r[4];
        });

        // Write rest pose safely
        var rP = track.restPos || [0,0,0];
        var rQ = track.restQuat || [0,0,0,1];
        var rS = track.restScale || [1,1,1];

        f32a[off++] = rP[0]; f32a[off++] = rP[1]; f32a[off++] = rP[2];
        f32a[off++] = rQ[0]; f32a[off++] = rQ[1]; f32a[off++] = rQ[2]; f32a[off++] = rQ[3];
        f32a[off++] = rS[0]; f32a[off++] = rS[1]; f32a[off++] = rS[2];

        // v17: the euler reference the channels above are spelled against.
        var eR = track.eulerRef;
        u32a[off++] = eR ? 1 : 0;
        f32a[off++] = eR ? eR[0] : 0; f32a[off++] = eR ? eR[1] : 0; f32a[off++] = eR ? eR[2] : 0; f32a[off++] = eR ? eR[3] : 1;
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

          // Delta vertices: v20, only the ones it moves
          off = Export.writeDelta(u32a, f32a, off, delta, activeVertCount);

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
            var mask = 0;
            if (to) ['right_dt', 'right_dv', 'left_dt', 'left_dv', 'tied'].forEach(function (f, bit) {
              if (to[`${k}_${f}`] !== undefined) mask |= 1 << bit;
            });
            tied += 2 * mask;   // v24, see the version notes
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

      // v14: SCALAR CHANNELS -- pin weight and physics blend weight. These were keyable and
      // solve-critical from the day they shipped, but had no place in the file, so every fade an
      // animator keyed was dropped on save. Worse than merely lost: IKSolver.pinWeight falls back
      // to 1 for a pin with no channel (so old rigs keep working), which means a reloaded file
      // came back with every pin FULLY ON for the whole animation, fighting the baked animation
      // and the physics -- matt: "the rig collapses and does strange things even though the pin
      // weight is 0". The 0 was never in the file. Same 7-float key layout as a blendshape track,
      // because scalar and blendshape channels share evaluateScalarTrack.
      var _scal = (track && track.scalarTracks) ? track.scalarTracks : null;
      u32a[off++] = _scal ? _scal.size : 0;
      if (_scal) {
        _scal.forEach(function (st, sName) {
          for (var _sn = 0; _sn < 16; _sn++) {
            var s1 = (_sn * 2     < sName.length) ? sName.charCodeAt(_sn * 2)     : 0;
            var s2 = (_sn * 2 + 1 < sName.length) ? sName.charCodeAt(_sn * 2 + 1) : 0;
            u32a[off++] = (s1 << 16) | s2;
          }
          var nbSKeys = st.times.length;
          u32a[off++] = nbSKeys;
          for (var _sk = 0; _sk < nbSKeys; _sk++) {
            var sDt = st.times[_sk + 1] !== undefined ? st.times[_sk + 1] - st.times[_sk] : 0.2;
            var sto = st.tangentOffsets;
            f32a[off++] = st.times[_sk];
            f32a[off++] = st.values[_sk];
            f32a[off++] = sto && sto[_sk + '_right_dt'] !== undefined ? sto[_sk + '_right_dt'] : sDt * 0.33;
            f32a[off++] = sto && sto[_sk + '_right_dv'] !== undefined ? sto[_sk + '_right_dv'] : 0;
            f32a[off++] = sto && sto[_sk + '_left_dt']  !== undefined ? sto[_sk + '_left_dt']  : -sDt * 0.33;
            f32a[off++] = sto && sto[_sk + '_left_dv']  !== undefined ? sto[_sk + '_left_dv']  : 0;
            f32a[off++] = (!sto || sto[_sk + '_tied'] !== false) ? 1.0 : 0.0;
          }
        });
      }

      // v18: combination shapes. Written for every mesh, count first, like the blocks above.
      var _combos = comboRows(track);
      u32a[off++] = _combos.length;
      _combos.forEach(function (r) {
        u32a[off++] = r[0];
        u32a[off++] = r[1].length;
        r[1].forEach(function (i) { u32a[off++] = i; });
        f32a[off++] = r[2].top;
        u32a[off++] = r[2].lower.length;
        r[2].lower.forEach(function (p) {
          f32a[off++] = p.s;
          off = Export.writeDelta(u32a, f32a, off, p.d, activeVertCount);
        });
        r[2].poses.forEach(function (pose) {
          u32a[off++] = pose ? 1 : 0;
          for (var _pi = 0; _pi < r[1].length; _pi++) f32a[off++] = pose ? pose[_pi] : 0;
        });
      });

      // v21: poses (named slider settings). Every mesh, count first.
      var _poses = poseRows(track);
      u32a[off++] = _poses.length;
      _poses.forEach(function (r) {
        off = writeName(u32a, off, r[0]);
        u32a[off++] = r[1].length;
        r[1].forEach(function (e) { u32a[off++] = e[0]; f32a[off++] = e[1]; });
      });

      // v22: layers left out of the Face tool.
      var _noFace = noFaceRows(track);
      u32a[off++] = _noFace.length;
      _noFace.forEach(function (i) { u32a[off++] = i; });

      // v23: the neutral the shapes were made on. Every mesh, flag first.
      var _ref = refRow(track, activeVertCount);
      u32a[off++] = _ref ? 1 : 0;
      if (_ref) {
        off = Export.writeDelta(u32a, f32a, off, _ref[0], activeVertCount);
        u32a[off++] = _ref[1].length;
        _ref[1].forEach(function (i) { u32a[off++] = i; });
      }

      // v25: the jiggle.
      u32a[off++] = jiggle.on ? 1 : 0;
      f32a[off++] = jiggle.gain; f32a[off++] = jiggle.freq; f32a[off++] = jiggle.damp; f32a[off++] = jiggle.max;

      // v27: the idle face.
      u32a[off++] = idle.on ? 1 : 0;
      f32a[off++] = idle.rate; f32a[off++] = idle.range; f32a[off++] = idle.pace; f32a[off++] = idle.micro;
    }

    var data = new DataView(buffer, 0, off * 4);

    // Frame-by-frame (cel) animation: append an independent, footer-located block
    // after the mesh data. Old importers stop after the mesh data and ignore it.
    var parts = [data];
    // The video/audio clips, as a reference (name, offset, switches). FIRST of the footer blocks:
    // see MediaRef for why that position is safe for every other reader.
    try {
      var mdiaBuf = MediaRef.serialize(main);
      if (mdiaBuf && mdiaBuf.byteLength) parts.push(mdiaBuf);
    } catch (e) {
      console.error('[MediaRef] export append failed', e);
    }
    // Textures: the images and material scalars, appended footer block. FIRST of the three, for
    // the same reason the comment below gives -- FrameGroup's reader only inspects the final 8
    // bytes, so its block has to stay last, and SKEL's finder walks past whatever is after it.
    try {
      var texBuf = TextureIO.serialize(meshes);
      if (texBuf && texBuf.byteLength) parts.push(texBuf);
    } catch (e) {
      console.error('[TextureIO] export append failed', e);
    }
    // Scene hierarchy + bones: appended footer block. MUST come before the frame-group
    // block — FrameGroup's reader only inspects the final 8 bytes of the file, so anything
    // appended after it makes it silently skip its own data.
    try {
      var skelBuf = Skeleton.serialize(meshes, main);
      if (skelBuf && skelBuf.byteLength) parts.push(skelBuf);
    } catch (e) {
      console.error('[Skeleton] export append failed', e);
    }
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
