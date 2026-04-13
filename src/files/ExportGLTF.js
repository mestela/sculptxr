import Utils from '../misc/Utils.js';

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

Export.exportGLB = function (meshes) {
  var binData = [];
  var byteOffset = 0;

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

    if (isAnimated) {
      var shapeTimes = track.shapeTimes;
      var shapes = track.shapes;

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
          max: dispMinMax.max
        });

        targets.push({ POSITION: dispAccessor });
        weights.push(0.0);
      }

      var timeArr = new Float32Array(shapeTimes);
      var timeMinMax = getMinMax(timeArr, 1);
      var timeBv = addBufferView(timeArr);
      var timeAccessor = json.accessors.length;
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
      var weightArr = new Float32Array(K * N);

      for (var k = 0; k < K; ++k) {
        weightArr[k * N + k] = 1.0;
      }

      var weightBv = addBufferView(weightArr);
      var weightAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: weightBv,
        componentType: 5126,
        count: K * N,
        type: "SCALAR"
      });

      json.animations.push({
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
      });
    }

    var prim = {
      attributes: { POSITION: posAccessor },
      indices: idxAccessor
    };

    if (targets.length > 0) {
      prim.targets = targets;
    }

    var meshObj = {
      name: "Mesh_" + id,
      primitives: [prim]
    };

    if (weights.length > 0) {
      meshObj.weights = weights;
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
