import Utils from '../misc/Utils.js';
import { quat } from 'gl-matrix';

var Export = {};

function padBytes(bytes) {
  var rem = bytes.length % 4;
  if (rem === 0) return bytes;
  var pad = 4 - rem;
  var res = new Uint8Array(bytes.length + pad);
  res.set(bytes);
  return res;
}

function getMinMax(arr, itemSize) {
  var min = new Array(itemSize).fill(Infinity);
  var max = new Array(itemSize).fill(-Infinity);
  for (var j = 0; j < arr.length; j += itemSize) {
    for (var k = 0; k < itemSize; ++k) {
      var v = arr[j + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min: min, max: max };
}

Export.exportGLB = function (meshes, options = {}) {
  var bake = options.bake !== undefined ? options.bake : false;
  var fps = 60;
  var dt = 1.0 / fps;

  var binData = [];
  var byteOffset = 0;

  function getCurveSlope(times, values, keyIdx, channel, stride) {
    if (!times || times.length < 2) return 0;
    const i = keyIdx;
    const c = channel;
    if (i === 0) {
      return (values[stride + c] - values[c]) / (times[1] - times[0]);
    }
    if (i === times.length - 1) {
      const pIdx = (i - 1) * stride;
      const cIdx = i * stride;
      return (values[cIdx + c] - values[pIdx + c]) / (times[i] - times[i - 1]);
    }
    const pIdx = (i - 1) * stride;
    const nIdx = (i + 1) * stride;
    const dt = times[i + 1] - times[i - 1];
    if (dt === 0) return 0;
    return (values[nIdx + c] - values[pIdx + c]) / dt;
  }

  // Helper for shape evaluation (copying from AnimationRegistry logic)
  function evaluateShapes(track, t) {
    if (!track.shapeTimes || track.shapeTimes.length === 0) return null;
    
    let warpedTime = t;
    if (track.shapeOutputTimes && track.shapeOutputTimes.length >= 2) {
      let idx = 0;
      while (idx < track.shapeTimes.length - 2 && track.shapeTimes[idx + 1] < t) {
        idx++;
      }
      const t1 = track.shapeTimes[idx];
      const t2 = track.shapeTimes[idx + 1];
      const dt = t2 - t1;
      const v1 = track.shapeOutputTimes[idx];
      const v2 = track.shapeOutputTimes[idx + 1];
      
      let alpha = dt > 0 ? (t - t1) / dt : 0;
      
      const hasShapeTangents = track.tangentOffsets && (track.tangentOffsets[`${idx}_right_dt`] !== undefined || track.tangentOffsets[`${idx + 1}_left_dt`] !== undefined);
      
      if (dt > 0.0001 && hasShapeTangents) {
        const rightDt = track.tangentOffsets[`${idx}_right_dt`];
        const rightDv = track.tangentOffsets[`${idx}_right_dv`];
        const leftDt = track.tangentOffsets[`${idx + 1}_left_dt`];
        const leftDv = track.tangentOffsets[`${idx + 1}_left_dv`];
        
        const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
        const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
        
        const slope = dt > 0 ? (v2 - v1) / dt : 0;
        
        const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
        const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
        
        const p1x = dt0 / dt;
        const p2x = 1 + dt1 / dt;
        
        const t_bez = window._animationRegistry.getBezierT(alpha, p1x, p2x);
        
        const omt = 1 - t_bez;
        const omtSq = omt * omt;
        const omtCu = omtSq * omt;
        const tSq = t_bez * t_bez;
        const tCu = tSq * t_bez;
        
        const p1y = v1 + dv0;
        const p2y = v2 + dv1;
        
        warpedTime = omtCu * v1 + 3 * omtSq * t_bez * p1y + 3 * omt * tSq * p2y + tCu * v2;
      } else {
        warpedTime = v1 + (v2 - v1) * alpha;
      }
      
      const minTime = track.shapeTimes[0];
      const maxTime = track.shapeTimes[track.shapeTimes.length - 1];
      warpedTime = Math.max(minTime, Math.min(maxTime, warpedTime));
    }

    let sAlpha = 0;
    let sIdx = 0;

    if (track.shapeTimes.length === 1) {
      sAlpha = 0;
    } else {
      while (sIdx < track.shapeTimes.length - 1 && track.shapeTimes[sIdx + 1] < warpedTime) {
        sIdx++;
      }

      const st1 = track.shapeTimes[sIdx];
      const st2 = track.shapeTimes[sIdx + 1];

      if (st2 > st1) {
        sAlpha = (warpedTime - st1) / (st2 - st1);
      }
    }

    let blend = sAlpha;

    if (window._animShowTangents && track.shapeTimes.length > 1) {
      let m0 = 1.0;
      let m1 = 1.0;

      if (track.tangentOffsets) {
        const rightVal = track.tangentOffsets[`${sIdx}_right`];
        const leftVal = track.tangentOffsets[`${sIdx + 1}_left`];
        
        const rightHandle = rightVal !== undefined ? rightVal : 25;
        const leftHandle = leftVal !== undefined ? leftVal : -25;

        m0 = rightHandle / 25.0;
        m1 = -leftHandle / 25.0;
      }

      const t_bez = sAlpha;
      const t2 = t_bez * t_bez;
      const t3 = t2 * t_bez;

      blend = (-2 * t3 + 3 * t2) + m0 * (t3 - 2 * t2 + t_bez) + m1 * (t3 - t2);
    }

    return { sIdx, blend };
  }

  // Helper for transform evaluation
  function evaluateTransform(track, t) {
    if (!track.times || track.times.length === 0) return null;
    
    let frameIdx = 0;
    while (frameIdx < track.times.length - 1 && track.times[frameIdx + 1] < t) {
      frameIdx++;
    }
    
    const t1 = track.times[frameIdx];
    const t2 = track.times[frameIdx + 1];
    const dt = t2 - t1;
    let alpha = dt > 0 ? (t - t1) / dt : 0;
    
    let px = 0, py = 0, pz = 0;
    for (let c = 0; c < 3; c++) {
      const v1 = track.positions[frameIdx * 3 + c];
      const v2 = track.positions[(frameIdx + 1) * 3 + c];
      
      if (track.times.length > 1) {
        const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dt`] : undefined;
        const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dv_${c}`] : undefined;
        const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dt`] : undefined;
        const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dv_${c}`] : undefined;
        
        const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
        const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
        
        const slope0 = getCurveSlope(track.times, track.positions, frameIdx, c, 3);
        const slope1 = getCurveSlope(track.times, track.positions, frameIdx + 1, c, 3);
        
        const dv0 = rightDv !== undefined ? rightDv : slope0 * dt0;
        const dv1 = leftDv !== undefined ? leftDv : slope1 * dt1;

        const p1x = dt0 / dt;
        const p2x = 1 + dt1 / dt;
        const t_bez = window._animationRegistry.getBezierT(alpha, p1x, p2x);
        const omt = 1 - t_bez;
        const omtSq = omt * omt;
        const omtCu = omtSq * omt;
        const tSq = t_bez * t_bez;
        const tCu = tSq * t_bez;
        const p1y = v1 + dv0;
        const p2y = v2 + dv1;

        const val = omtCu * v1 + 3 * omtSq * t_bez * p1y + 3 * omt * tSq * p2y + tCu * v2;
        if (c === 0) px = val; else if (c === 1) py = val; else if (c === 2) pz = val;
      } else {
        const val = v1 + (v2 - v1) * alpha;
        if (c === 0) px = val; else if (c === 1) py = val; else if (c === 2) pz = val;
      }
    }
    
    const pIdx1 = frameIdx * 3;
    const pIdx2 = (frameIdx + 1) * 3;
    const sx = track.scales[pIdx1] + (track.scales[pIdx2] - track.scales[pIdx1]) * alpha;
    const sy = track.scales[pIdx1 + 1] + (track.scales[pIdx2 + 1] - track.scales[pIdx1 + 1]) * alpha;
    const sz = track.scales[pIdx1 + 2] + (track.scales[pIdx2 + 2] - track.scales[pIdx1 + 2]) * alpha;
    
    const qIdx1 = frameIdx * 4, qIdx2 = (frameIdx + 1) * 4;
    const q1 = [track.quaternions[qIdx1], track.quaternions[qIdx1 + 1], track.quaternions[qIdx1 + 2], track.quaternions[qIdx1 + 3]];
    const q2 = [track.quaternions[qIdx2], track.quaternions[qIdx2 + 1], track.quaternions[qIdx2 + 2], track.quaternions[qIdx2 + 3]];
    
    const outQuat = [0, 0, 0, 1];
    quat.slerp(outQuat, q1, q2, alpha);
    
    return { position: [px, py, pz], quaternion: outQuat, scale: [sx, sy, sz] };
  }

  var json = {
    asset: { version: "2.0", generator: "SculptXR DAW Exporter" },
    scenes: [{ nodes: [] }],
    scene: 0,
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    animations: []
  };

  function addBufferView(data, target) {
    var clone = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    var padded = padBytes(clone);
    var bv = {
      buffer: 0,
      byteOffset: byteOffset,
      byteLength: clone.length
    };
    if (target) bv.target = target;
    json.bufferViews.push(bv);
    binData.push(padded);
    byteOffset += padded.length;
    return json.bufferViews.length - 1;
  }

  // Calculate total duration for baking if needed
  var totalDuration = 0;
  if (bake) {
    totalDuration = window._animMasterDuration || 0;
    if (totalDuration === 0) {
      meshes.forEach(mesh => {
        var track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
        if (track) {
          if (track.times && track.times.length > 0) {
            totalDuration = Math.max(totalDuration, track.times[track.times.length - 1]);
          }
          if (track.shapeTimes && track.shapeTimes.length > 0) {
            totalDuration = Math.max(totalDuration, track.shapeTimes[track.shapeTimes.length - 1]);
          }
        }
      });
    }
  }

  for (var i = 0; i < meshes.length; ++i) {
    var mesh = meshes[i];
    var id = mesh.getID();
    var vAr = mesh.getVertices();
    var iAr = mesh.getTriangles();
    var nbVerts = mesh.getNbVertices();
    var nbTris = mesh.getNbTriangles();

    if (!vAr || !iAr || nbVerts === 0 || nbTris === 0) continue;

    var track = window._animationRegistry ? window._animationRegistry.tracks.get(id) : null;
    var isAnimated = track && track.shapeTimes && track.shapeTimes.length > 0;

    json.scenes[0].nodes.push(json.nodes.length);
    var nodeObj = { mesh: json.meshes.length };
    if (mesh.getMatrix) {
      nodeObj.matrix = Array.from(mesh.getMatrix());
    }
    json.nodes.push(nodeObj);

    var posMinMax = getMinMax(vAr, 3);
    var posBv = addBufferView(vAr, 34962);
    var posAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: posBv,
      componentType: 5126,
      count: nbVerts,
      type: "VEC3",
      min: posMinMax.min,
      max: posMinMax.max
    });

    var idxType = nbVerts >= 65536 ? 5125 : 5123;
    var idxArr = nbVerts >= 65536 ? iAr : new Uint16Array(iAr);
    var idxBv = addBufferView(idxArr, 34963);
    var idxAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: idxBv,
      componentType: idxType,
      count: nbTris * 3,
      type: "SCALAR"
    });

    var targets = [];
    var weights = [];

    var animObj = null;
    var samplerIdx = 0;

    var hasBlendshapes = track && track.blendshapes && track.blendshapes.size > 0;
    
    var shapeTimes = (track && track.shapeTimes) ? track.shapeTimes : [];
    var shapes = (track && track.shapes) ? track.shapes : [];

    // 1. Add ShotSculpt targets
    for (var k = 0; k < shapeTimes.length; ++k) {
      var shapeVerts = shapes[k];
      var disp = new Float32Array(vAr.length);

      for (var j = 0; j < vAr.length; ++j) {
        var delta = shapeVerts[j] - vAr[j];
        disp[j] = Math.abs(delta) > 0.001 ? delta : 0.0;
      }

      var dispMinMax = getMinMax(disp, 3);
      var dispBv = addBufferView(disp);
      var dispAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: dispBv,
        componentType: 5126,
        count: nbVerts,
        type: "VEC3",
        min: dispMinMax.min,
        max: dispMinMax.max,
        extras: { name: `ShotSculpt_${k}` }
      });

      targets.push({ POSITION: dispAccessor });
      weights.push(0.0);
    }

    // 2. Add Blendshape targets
    if (hasBlendshapes) {
      track.blendshapes.forEach((delta, name) => {
        var dispMinMax = getMinMax(delta, 3);
        var dispBv = addBufferView(delta);
        var dispAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: dispBv,
          componentType: 5126,
          count: nbVerts,
          type: "VEC3",
          min: dispMinMax.min,
          max: dispMinMax.max,
          extras: { name: name }
        });

        targets.push({ POSITION: dispAccessor });
        weights.push(0.0);
      });
    }

    var timeAccessor, weightAccessor;

    if (bake) {
      var numSamples = Math.ceil(totalDuration / dt) + 1;
      var bakedTimes = new Float32Array(numSamples);
      var totalTargets = shapeTimes.length + (hasBlendshapes ? track.blendshapes.size : 0);
      var bakedWeights = new Float32Array(numSamples * totalTargets);

      for (var s = 0; s < numSamples; ++s) {
        var t = s * dt;
        bakedTimes[s] = t;
        
        var offset = s * totalTargets;
        
        // Evaluate ShotSculpt
        if (shapeTimes.length > 0) {
          var evalRes = evaluateShapes(track, t);
          var sIdx = evalRes.sIdx;
          var blend = evalRes.blend;
          
          bakedWeights[offset + sIdx] = 1.0 - blend;
          if (sIdx < shapeTimes.length - 1) {
            bakedWeights[offset + sIdx + 1] = blend;
          }
        }
        
        // Evaluate Blendshapes
        if (hasBlendshapes) {
          var bOffset = offset + shapeTimes.length;
          let bIdx = 0;
          track.blendshapes.forEach((delta, name) => {
            const bTrack = track.blendshapeTracks.get(name);
            let weight = 0;
            if (bTrack && bTrack.times.length > 0) {
              weight = window._animationRegistry.evaluateScalarTrack(bTrack, t);
            }
            bakedWeights[bOffset + bIdx] = weight;
            bIdx++;
          });
        }
      }

      var timeMinMax = getMinMax(bakedTimes, 1);
      var timeBv = addBufferView(bakedTimes);
      timeAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: timeBv,
        componentType: 5126,
        count: numSamples,
        type: "SCALAR",
        min: timeMinMax.min,
        max: timeMinMax.max
      });

      var weightBv = addBufferView(bakedWeights);
      weightAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: weightBv,
        componentType: 5126,
        count: numSamples * totalTargets,
        type: "SCALAR"
      });

      animObj = {
        name: "Animation_" + id,
        samplers: [{
          input: timeAccessor,
          output: weightAccessor,
          interpolation: "LINEAR"
        }],
        channels: [{
          sampler: 0,
          target: {
            node: json.nodes.length - 1,
            path: "weights"
          }
        }]
      };
      samplerIdx = 1;
    } else if (shapeTimes.length > 0) {
      // Original non-baked logic for shapes (fallback)
      var timeArr = new Float32Array(shapeTimes);
      var timeMinMax = getMinMax(timeArr, 1);
      var timeBv = addBufferView(timeArr);
      timeAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: timeBv,
        componentType: 5126,
        count: shapeTimes.length,
        type: "SCALAR",
        min: timeMinMax.min,
        max: timeMinMax.max
      });

      var N = shapeTimes.length;
      var K = shapeTimes.length;
      var weightArr = new Float32Array(K * 3 * N);

      for (var k = 0; k < K; ++k) {
        var frameOffset = k * 3 * N;
        
        var inTan = new Float32Array(N);
        if (k > 0) {
          var dt_shape = shapeTimes[k] - shapeTimes[k - 1];
          var leftVal = track.tangentOffsets ? track.tangentOffsets[`${k}_left`] : undefined;
          var leftHandle = leftVal !== undefined ? leftVal : -25;
          var m1 = -leftHandle / 25.0;
          
          inTan[k - 1] = -m1 / dt_shape;
          inTan[k] = m1 / dt_shape;
        }
        weightArr.set(inTan, frameOffset);

        var val = new Float32Array(N);
        val[k] = 1.0;
        weightArr.set(val, frameOffset + N);

        var outTan = new Float32Array(N);
        if (k < K - 1) {
          var dt_shape = shapeTimes[k + 1] - shapeTimes[k];
          var rightVal = track.tangentOffsets ? track.tangentOffsets[`${k}_right`] : undefined;
          var rightHandle = rightVal !== undefined ? rightVal : 25;
          var m0 = rightHandle / 25.0;
          
          outTan[k] = -m0 / dt_shape;
          outTan[k + 1] = m0 / dt_shape;
        }
        weightArr.set(outTan, frameOffset + 2 * N);
      }

      var weightBv = addBufferView(weightArr);
      weightAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: weightBv,
        componentType: 5126,
        count: K * 3 * N,
        type: "SCALAR"
      });

      animObj = {
        name: "Animation_" + id,
        samplers: [{
          input: timeAccessor,
          output: weightAccessor,
          interpolation: "CUBICSPLINE"
        }],
        channels: [{
          sampler: 0,
          target: {
            node: json.nodes.length - 1,
            path: "weights"
          }
        }]
      };
      samplerIdx = 1;
    }

    var hasTransformAnim = track && track.times && track.times.length > 0;
    if (hasTransformAnim) {
      var transTimes = track.times;
      
      if (!animObj) {
        animObj = {
          name: "Animation_" + id,
          samplers: [],
          channels: []
        };
      }

      if (bake) {
        var numSamples = Math.ceil(totalDuration / dt) + 1;
        var bakedTimes = new Float32Array(numSamples);
        var bakedPos = new Float32Array(numSamples * 3);
        var bakedRot = new Float32Array(numSamples * 4);
        var bakedScale = new Float32Array(numSamples * 3);

        for (var s = 0; s < numSamples; ++s) {
          var t = s * dt;
          bakedTimes[s] = t;
          
          var evalRes = evaluateTransform(track, t);
          bakedPos.set(evalRes.position, s * 3);
          bakedRot.set(evalRes.quaternion, s * 4);
          bakedScale.set(evalRes.scale, s * 3);
        }

        var timeMinMax = getMinMax(bakedTimes, 1);
        var timeBv = addBufferView(bakedTimes);
        var transTimeAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: timeBv,
          componentType: 5126,
          count: numSamples,
          type: "SCALAR",
          min: timeMinMax.min,
          max: timeMinMax.max
        });

        // Position
        var posMinMax = getMinMax(bakedPos, 3);
        var posBv = addBufferView(bakedPos);
        var transPosAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: posBv,
          componentType: 5126,
          count: numSamples,
          type: "VEC3",
          min: posMinMax.min,
          max: posMinMax.max
        });

        animObj.samplers.push({
          input: transTimeAccessor,
          output: transPosAccessor,
          interpolation: "LINEAR"
        });
        animObj.channels.push({
          sampler: samplerIdx++,
          target: {
            node: json.nodes.length - 1,
            path: "translation"
          }
        });

        // Rotation
        var rotMinMax = getMinMax(bakedRot, 4);
        var rotBv = addBufferView(bakedRot);
        var transRotAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: rotBv,
          componentType: 5126,
          count: numSamples,
          type: "VEC4",
          min: rotMinMax.min,
          max: rotMinMax.max
        });

        animObj.samplers.push({
          input: transTimeAccessor,
          output: transRotAccessor,
          interpolation: "LINEAR"
        });
        animObj.channels.push({
          sampler: samplerIdx++,
          target: {
            node: json.nodes.length - 1,
            path: "rotation"
          }
        });

        // Scale
        var scaleMinMax = getMinMax(bakedScale, 3);
        var scaleBv = addBufferView(bakedScale);
        var transScaleAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: scaleBv,
          componentType: 5126,
          count: numSamples,
          type: "VEC3",
          min: scaleMinMax.min,
          max: scaleMinMax.max
        });

        animObj.samplers.push({
          input: transTimeAccessor,
          output: transScaleAccessor,
          interpolation: "LINEAR"
        });
        animObj.channels.push({
          sampler: samplerIdx++,
          target: {
            node: json.nodes.length - 1,
            path: "scale"
          }
        });

      } else {
        // Original non-baked logic for transforms
        var timeArr = new Float32Array(transTimes);
        var timeMinMax = getMinMax(timeArr, 1);
        var timeBv = addBufferView(timeArr);
        var transTimeAccessor = json.accessors.length;
        json.accessors.push({
          bufferView: timeBv,
          componentType: 5126,
          count: transTimes.length,
          type: "SCALAR",
          min: timeMinMax.min,
          max: timeMinMax.max
        });

        if (track.positions && track.positions.length > 0) {
          var posArr = new Float32Array(transTimes.length * 3 * 3);
          
          for (var k = 0; k < transTimes.length; ++k) {
            var frameOffset = k * 3 * 3;
            var v1 = [track.positions[k*3], track.positions[k*3+1], track.positions[k*3+2]];
            var inTan = [0, 0, 0];
            var outTan = [0, 0, 0];
            
            if (k > 0) {
              var dt_trans = transTimes[k] - transTimes[k - 1];
              for (var c = 0; c < 3; c++) {
                const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dt`] : undefined;
                const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dv_${c}`] : undefined;
                const dt1 = leftDt !== undefined ? leftDt : -dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.positions, k, c, 3);
                const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
                inTan[c] = -3 * dv1 / dt1;
              }
            }
            
            if (k < transTimes.length - 1) {
              var dt_trans = transTimes[k + 1] - transTimes[k];
              for (var c = 0; c < 3; c++) {
                const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dt`] : undefined;
                const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dv_${c}`] : undefined;
                const dt0 = rightDt !== undefined ? rightDt : dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.positions, k, c, 3);
                const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
                outTan[c] = 3 * dv0 / dt0;
              }
            }
            
            posArr.set(inTan, frameOffset);
            posArr.set(v1, frameOffset + 3);
            posArr.set(outTan, frameOffset + 6);
          }

          var posMinMax = getMinMax(posArr, 3);
          var posBv = addBufferView(posArr);
          var transPosAccessor = json.accessors.length;
          json.accessors.push({
            bufferView: posBv,
            componentType: 5126,
            count: transTimes.length * 3,
            type: "VEC3",
            min: posMinMax.min,
            max: posMinMax.max
          });

          animObj.samplers.push({
            input: transTimeAccessor,
            output: transPosAccessor,
            interpolation: "CUBICSPLINE"
          });
          animObj.channels.push({
            sampler: samplerIdx++,
            target: {
              node: json.nodes.length - 1,
              path: "translation"
            }
          });
        }

        if (track.quaternions && track.quaternions.length > 0) {
          var rotArr = new Float32Array(transTimes.length * 3 * 4);
          
          for (var k = 0; k < transTimes.length; ++k) {
            var frameOffset = k * 3 * 4;
            var v1 = [track.quaternions[k*4], track.quaternions[k*4+1], track.quaternions[k*4+2], track.quaternions[k*4+3]];
            var inTan = [0, 0, 0, 0];
            var outTan = [0, 0, 0, 0];
            
            if (k > 0) {
              var dt_trans = transTimes[k] - transTimes[k - 1];
              for (var c = 0; c < 4; c++) {
                const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dt`] : undefined;
                const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dv_${c}`] : undefined;
                const dt1 = leftDt !== undefined ? leftDt : -dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.quaternions, k, c, 4);
                const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
                inTan[c] = -3 * dv1 / dt1;
              }
            }
            
            if (k < transTimes.length - 1) {
              var dt_trans = transTimes[k + 1] - transTimes[k];
              for (var c = 0; c < 4; c++) {
                const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dt`] : undefined;
                const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dv_${c}`] : undefined;
                const dt0 = rightDt !== undefined ? rightDt : dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.quaternions, k, c, 4);
                const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
                outTan[c] = 3 * dv0 / dt0;
              }
            }
            
            rotArr.set(inTan, frameOffset);
            rotArr.set(v1, frameOffset + 4);
            rotArr.set(outTan, frameOffset + 8);
          }

          var rotMinMax = getMinMax(rotArr, 4);
          var rotBv = addBufferView(rotArr);
          var transRotAccessor = json.accessors.length;
          json.accessors.push({
            bufferView: rotBv,
            componentType: 5126,
            count: transTimes.length * 3,
            type: "VEC4",
            min: rotMinMax.min,
            max: rotMinMax.max
          });

          animObj.samplers.push({
            input: transTimeAccessor,
            output: transRotAccessor,
            interpolation: "CUBICSPLINE"
          });
          animObj.channels.push({
            sampler: samplerIdx++,
            target: {
              node: json.nodes.length - 1,
              path: "rotation"
            }
          });
        }

        if (track.scales && track.scales.length > 0) {
          var scaleArr = new Float32Array(transTimes.length * 3 * 3);
          
          for (var k = 0; k < transTimes.length; ++k) {
            var frameOffset = k * 3 * 3;
            var v1 = [track.scales[k*3], track.scales[k*3+1], track.scales[k*3+2]];
            var inTan = [0, 0, 0];
            var outTan = [0, 0, 0];
            
            if (k > 0) {
              var dt_trans = transTimes[k] - transTimes[k - 1];
              for (var c = 0; c < 3; c++) {
                const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dt`] : undefined;
                const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_left_dv_${c}`] : undefined;
                const dt1 = leftDt !== undefined ? leftDt : -dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.scales, k, c, 3);
                const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
                inTan[c] = -3 * dv1 / dt1;
              }
            }
            
            if (k < transTimes.length - 1) {
              var dt_trans = transTimes[k + 1] - transTimes[k];
              for (var c = 0; c < 3; c++) {
                const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dt`] : undefined;
                const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${k}_right_dv_${c}`] : undefined;
                const dt0 = rightDt !== undefined ? rightDt : dt_trans * 0.33;
                const slope = getCurveSlope(transTimes, track.scales, k, c, 3);
                const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
                outTan[c] = 3 * dv0 / dt0;
              }
            }
            
            scaleArr.set(inTan, frameOffset);
            scaleArr.set(v1, frameOffset + 3);
            scaleArr.set(outTan, frameOffset + 6);
          }

          var scaleMinMax = getMinMax(scaleArr, 3);
          var scaleBv = addBufferView(scaleArr);
          var transScaleAccessor = json.accessors.length;
          json.accessors.push({
            bufferView: scaleBv,
            componentType: 5126,
            count: transTimes.length * 3,
            type: "VEC3",
            min: scaleMinMax.min,
            max: scaleMinMax.max
          });

          animObj.samplers.push({
            input: transTimeAccessor,
            output: transScaleAccessor,
            interpolation: "CUBICSPLINE"
          });
          animObj.channels.push({
            sampler: samplerIdx++,
            target: {
              node: json.nodes.length - 1,
              path: "scale"
            }
          });
        }
      }
    }

    if (animObj) {
      json.animations.push(animObj);
    }

    var prim = {
      attributes: { POSITION: posAccessor },
      indices: idxAccessor
    };

    if (targets.length > 0) {
      prim.targets = targets;
      
      // Add targetNames to primitive extras (supported by some loaders)
      prim.extras = prim.extras || {};
      prim.extras.targetNames = [];
      
      const sTimes = (track && track.shapeTimes) ? track.shapeTimes : [];
      for (var k = 0; k < sTimes.length; ++k) {
        prim.extras.targetNames.push(`ShotSculpt_${k}`);
      }
      if (hasBlendshapes) {
        track.blendshapes.forEach((delta, name) => {
          prim.extras.targetNames.push(name);
        });
      }
    }

    var meshObj = {
      name: "Mesh_" + id,
      primitives: [prim]
    };

    if (weights.length > 0) {
      meshObj.weights = weights;
    }

    if (isAnimated) {
      meshObj.extras = meshObj.extras || {};
      meshObj.extras.targetNames = [];
      
      const nodeObj = json.nodes[json.nodes.length - 1];
      nodeObj.extras = nodeObj.extras || {};
      nodeObj.extras.targetNames = [];

      const sTimes = (track && track.shapeTimes) ? track.shapeTimes : [];
      // Add names for ShotSculpt targets
      for (var k = 0; k < sTimes.length; ++k) {
        const name = `ShotSculpt_${k}`;
        meshObj.extras.targetNames.push(name);
        nodeObj.extras.targetNames.push(name);
      }
      
      // Add names for Blendshapes
      if (hasBlendshapes) {
        track.blendshapes.forEach((delta, name) => {
          meshObj.extras.targetNames.push(name);
          nodeObj.extras.targetNames.push(name);
        });
      }
    }

    json.meshes.push(meshObj);
  }

  json.buffers.push({
    byteLength: byteOffset
  });

  var jsonStr = JSON.stringify(json);
  var jsonPad = (4 - (jsonStr.length % 4)) % 4;
  for (var p = 0; p < jsonPad; ++p) jsonStr += ' ';

  var totalBinLength = 0;
  for (var b = 0; b < binData.length; ++b) {
    totalBinLength += binData[b].length;
  }

  var glbLength = 12 + 8 + jsonStr.length + 8 + totalBinLength;

  var glb = new Uint8Array(glbLength);
  var dv = new DataView(glb.buffer);

  dv.setUint32(0, 0x46546C67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, glbLength, true);

  dv.setUint32(12, jsonStr.length, true);
  dv.setUint32(16, 0x4E4F534A, true);

  var offset = 20;
  for (var c = 0; c < jsonStr.length; ++c) {
    glb[offset++] = jsonStr.charCodeAt(c);
  }

  dv.setUint32(offset, totalBinLength, true);
  dv.setUint32(offset + 4, 0x004E4942, true);
  offset += 8;

  for (var b = 0; b < binData.length; ++b) {
    glb.set(binData[b], offset);
    offset += binData[b].length;
  }

  return new Blob([glb], { type: 'model/gltf-binary' });
};

export default Export;
