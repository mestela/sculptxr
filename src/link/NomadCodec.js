// Nomad Link mesh payloads <-> SculptXR mesh data.
//
// Nomad's binary blob is a set of tightly packed arrays; the header carries a
// byte offset and a format name for each one. Both applications are right-handed
// Y-up ("nomad_y_up"), so positions cross unchanged.
//
// This module deliberately imports nothing, so the decode can be exercised
// against captured payloads outside the browser (see tools/test_nomad_codec.mjs).

// Mirrors Utils.TRI_INDEX — duplicated so this file stays dependency-free.
var TRI_INDEX = 4294967295;

var NomadCodec = {};

NomadCodec.TRI_INDEX = TRI_INDEX;

// Nomad's rgbm8 vertex colours: linear rgb = rgb * (m / 65025)
NomadCodec.decodeRGBM = function (bytes, offset, count) {
  var out = new Float32Array(count * 3);
  for (var i = 0; i < count; ++i) {
    var j = offset + i * 4;
    var scale = bytes[j + 3] / 65025.0;
    var k = i * 3;
    out[k] = bytes[j] * scale;
    out[k + 1] = bytes[j + 1] * scale;
    out[k + 2] = bytes[j + 2] * scale;
  }
  return out;
};

// A normalised scalar channel (uint8_norm / uint16_norm / float32) as 0..1 floats.
NomadCodec.decodeScalar = function (view, bytes, offset, count, format) {
  var out = new Float32Array(count);
  var i = 0;
  if (format === 'uint16_norm') {
    for (; i < count; ++i) out[i] = view.getUint16(offset + i * 2, true) / 65535.0;
  } else if (format === 'float32') {
    for (; i < count; ++i) out[i] = view.getFloat32(offset + i * 4, true);
  } else { // uint8_norm
    for (; i < count; ++i) out[i] = bytes[offset + i] / 255.0;
  }
  return out;
};

/**
 * mesh_full -> a plain object MeshStatic can be filled from.
 *
 * `binary` is the packet's binary blob (ArrayBuffer or a typed-array view).
 * `flipWinding` reverses each face's corner order; Nomad follows glTF
 * (counter-clockwise front), same as SculptXR, so it defaults off.
 */
NomadCodec.decodeMesh = function (header, binary, flipWinding) {
  var buffer = binary.buffer || binary;
  var byteOffset = binary.byteOffset || 0;
  var bytes = new Uint8Array(buffer, byteOffset, binary.byteLength || buffer.byteLength);
  var view = new DataView(buffer, byteOffset);

  var nbVertices = header.vertex_count | 0;
  var nbFaces = header.face_count | 0;

  var mesh = {
    meshId: header.mesh_id || '',
    geometryId: header.geometry_id || '',
    name: header.name || 'nomad',
    worldMatrix: header.world_matrix ? header.world_matrix.slice() : null,
    smoothShading: header.smooth_shading !== false,
    nbVertices: nbVertices,
    nbFaces: nbFaces,
    vertices: null,
    faces: null,
    colors: null,
    materials: null,
    texCoords: null,
    faceUvs: null,
    faceGroups: null,
    faceGroupDefs: header.face_groups ? header.face_groups.slice() : null
  };

  // ---- positions (float32x3) ----
  var vAr = mesh.vertices = new Float32Array(nbVertices * 3);
  for (var v = 0, vlen = nbVertices * 3; v < vlen; ++v)
    vAr[v] = view.getFloat32(header.position_offset + v * 4, true);

  // ---- faces ----
  // int32x4 with -1 in the 4th slot for a triangle: the same shape as SculptXR's
  // _facesABCD, which flags triangles with TRI_INDEX instead.
  var fAr = mesh.faces = new Uint32Array(nbFaces * 4);
  var f, k;
  if (header.face_format === 'corners') {
    // Variable-size faces; SculptXR has no n-gons, so fan anything past a quad.
    throw new Error('NomadCodec: corner face format is not supported (do not advertise "ngon")');
  }
  for (f = 0; f < nbFaces; ++f) {
    k = f * 4;
    var i0 = view.getInt32(header.face_offset + k * 4, true);
    var i1 = view.getInt32(header.face_offset + (k + 1) * 4, true);
    var i2 = view.getInt32(header.face_offset + (k + 2) * 4, true);
    var i3 = view.getInt32(header.face_offset + (k + 3) * 4, true);
    var isQuad = i3 >= 0;
    if (flipWinding) {
      if (isQuad) { fAr[k] = i3; fAr[k + 1] = i2; fAr[k + 2] = i1; fAr[k + 3] = i0; }
      else { fAr[k] = i2; fAr[k + 1] = i1; fAr[k + 2] = i0; fAr[k + 3] = TRI_INDEX; }
    } else {
      fAr[k] = i0; fAr[k + 1] = i1; fAr[k + 2] = i2;
      fAr[k + 3] = isQuad ? i3 : TRI_INDEX;
    }
  }

  // ---- vertex colours (rgbm8) ----
  if (header.color_offset !== undefined && header.color_format === 'rgbm8')
    mesh.colors = NomadCodec.decodeRGBM(bytes, header.color_offset, nbVertices);

  // ---- materials: SculptXR packs [roughness, metalness, mask] per vertex ----
  var rough = header.roughness_offset !== undefined
    ? NomadCodec.decodeScalar(view, bytes, header.roughness_offset, nbVertices, header.roughness_format) : null;
  var metal = header.metalness_offset !== undefined
    ? NomadCodec.decodeScalar(view, bytes, header.metalness_offset, nbVertices, header.metalness_format) : null;
  var mask = header.mask_offset !== undefined
    ? NomadCodec.decodeScalar(view, bytes, header.mask_offset, nbVertices, header.mask_format) : null;

  if (rough || metal || mask) {
    var mAr = mesh.materials = new Float32Array(nbVertices * 3);
    var defRough = header.material && header.material.roughness !== undefined ? header.material.roughness : 0.25;
    var defMetal = header.material && header.material.metalness !== undefined ? header.material.metalness : 0.0;
    for (var m = 0; m < nbVertices; ++m) {
      var j = m * 3;
      mAr[j] = rough ? rough[m] : defRough;
      mAr[j + 1] = metal ? metal[m] : defMetal;
      // Same convention both sides: 1 = unmasked/editable. MEASURED, not assumed —
      // an unmasked Nomad sphere sends 65535 (=1.0) for every vertex, which matches
      // Mesh.initColorsAndMaterials' default of 1.0. Do not "fix" this to 1 - mask.
      mAr[j + 2] = mask ? mask[m] : 1.0;
    }
  }

  // ---- UVs: a texcoord pool plus per-face corner indices, which is exactly the
  // shape MeshStatic.initTexCoordsDataFromOBJData() already consumes ----
  if (header.texcoord_offset !== undefined && header.texcoord_count) {
    var nbUv = header.texcoord_count | 0;
    var tAr = mesh.texCoords = new Float32Array(nbUv * 2);
    for (var t = 0, tlen = nbUv * 2; t < tlen; ++t)
      tAr[t] = view.getFloat32(header.texcoord_offset + t * 4, true);

    if (header.face_uv_offset !== undefined) {
      var uvAr = mesh.faceUvs = new Uint32Array(nbFaces * 4);
      for (f = 0; f < nbFaces; ++f) {
        k = f * 4;
        var u0 = view.getInt32(header.face_uv_offset + k * 4, true);
        var u1 = view.getInt32(header.face_uv_offset + (k + 1) * 4, true);
        var u2 = view.getInt32(header.face_uv_offset + (k + 2) * 4, true);
        var u3 = view.getInt32(header.face_uv_offset + (k + 3) * 4, true);
        // Keep the corner order in step with the positions above.
        if (flipWinding) {
          if (u3 >= 0) { uvAr[k] = u3; uvAr[k + 1] = u2; uvAr[k + 2] = u1; uvAr[k + 3] = u0; }
          else { uvAr[k] = u2; uvAr[k + 1] = u1; uvAr[k + 2] = u0; uvAr[k + 3] = TRI_INDEX; }
        } else {
          uvAr[k] = u0; uvAr[k + 1] = u1; uvAr[k + 2] = u2;
          uvAr[k + 3] = u3 >= 0 ? u3 : TRI_INDEX;
        }
      }
    }
  }

  // ---- face groups (uint16 index per face, names/colours in the header) ----
  if (header.face_group_offset !== undefined) {
    var gAr = mesh.faceGroups = new Int32Array(nbFaces);
    if (header.face_group_format === 'uint8') {
      for (f = 0; f < nbFaces; ++f) gAr[f] = bytes[header.face_group_offset + f];
    } else if (header.face_group_format === 'uint32') {
      for (f = 0; f < nbFaces; ++f) gAr[f] = view.getUint32(header.face_group_offset + f * 4, true);
    } else { // uint16
      for (f = 0; f < nbFaces; ++f) gAr[f] = view.getUint16(header.face_group_offset + f * 2, true);
    }
  }

  return mesh;
};

/**
 * mesh_delta -> the touched vertex indices and their new values.
 *
 * One delta is one completed stroke on the far side, and becomes one undo step
 * here. `vertexCount` is the sender's topology guard: if it disagrees with the
 * mesh we hold, our topology has diverged and the delta must be dropped in
 * favour of asking for a full mesh.
 *
 * Every channel is optional — a pure sculpt stroke carries positions only.
 */
NomadCodec.decodeDelta = function (header, binary) {
  var buffer = binary.buffer || binary;
  var byteOffset = binary.byteOffset || 0;
  var bytes = new Uint8Array(buffer, byteOffset, binary.byteLength || buffer.byteLength);
  var view = new DataView(buffer, byteOffset);

  var count = header.count | 0;
  var delta = {
    meshId: header.mesh_id || '',
    count: count,
    vertexCount: header.vertex_count | 0,
    indices: null,
    positions: null,
    colors: null,
    mask: null
  };

  var indices = delta.indices = new Uint32Array(count);
  for (var i = 0; i < count; ++i)
    indices[i] = view.getUint32(header.index_offset + i * 4, true);

  if (header.position_offset !== undefined) {
    var pos = delta.positions = new Float32Array(count * 3);
    for (var p = 0, plen = count * 3; p < plen; ++p)
      pos[p] = view.getFloat32(header.position_offset + p * 4, true);
  }

  if (header.color_offset !== undefined && header.color_format === 'rgbm8')
    delta.colors = NomadCodec.decodeRGBM(bytes, header.color_offset, count);

  if (header.mask_offset !== undefined)
    delta.mask = NomadCodec.decodeScalar(view, bytes, header.mask_offset, count, header.mask_format);

  return delta;
};

// Nomad's rgbm8: pick the smallest multiplier that keeps the brightest channel
// in range, then store rgb scaled up by it.
NomadCodec.encodeRGBM = function (colors, count) {
  var out = new Uint8Array(count * 4);
  for (var i = 0; i < count; ++i) {
    var k = i * 3;
    var r = Math.min(Math.max(colors[k], 0), 1);
    var g = Math.min(Math.max(colors[k + 1], 0), 1);
    var b = Math.min(Math.max(colors[k + 2], 0), 1);
    var m = Math.min(Math.max(Math.ceil(Math.max(r, g, b) * 255.0), 1), 255);
    var scale = 65025.0 / m;
    var j = i * 4;
    out[j] = Math.min(r * scale + 0.5, 255);
    out[j + 1] = Math.min(g * scale + 0.5, 255);
    out[j + 2] = Math.min(b * scale + 0.5, 255);
    out[j + 3] = m;
  }
  return out;
};

/**
 * A SculptXR mesh -> a mesh_full packet {header, binary}.
 *
 * Positions stay node-local and the world matrix travels separately, which is how
 * they arrived. `opts.meshId` / `opts.geometryId` should be the ids the mesh came
 * with, so Nomad replaces that object instead of adding a second one.
 */
NomadCodec.encodeMesh = function (mesh, opts) {
  opts = opts || {};
  var nbVertices = mesh.getNbVertices();
  var nbFaces = mesh.getNbFaces();

  var vAr = mesh.getVertices();
  var fAr = mesh.getFaces();
  var cAr = mesh.getColors();
  var mAr = mesh.getMaterials();
  var gAr = mesh.getFacesGroups ? mesh.getFacesGroups() : null;
  var hasUV = mesh.hasUV && mesh.hasUV();
  var tAr = hasUV ? mesh.getTexCoords() : null;
  var fuvAr = hasUV ? mesh.getFacesTexCoord() : null;
  var nbTexCoords = hasUV ? mesh.getNbTexCoords() : 0;

  // Lay the sections out back to back, exactly as Nomad does.
  var offset = 0;
  var take = function (bytes) { var at = offset; offset += bytes; return at; };

  var positionOffset = take(nbVertices * 12);
  var faceOffset = take(nbFaces * 16);
  var texcoordOffset = hasUV ? take(nbTexCoords * 8) : -1;
  var faceUvOffset = hasUV ? take(nbFaces * 16) : -1;
  var colorOffset = cAr ? take(nbVertices * 4) : -1;
  var roughnessOffset = mAr ? take(nbVertices) : -1;
  var metalnessOffset = mAr ? take(nbVertices) : -1;
  var maskOffset = mAr ? take(nbVertices * 2) : -1;
  var faceGroupOffset = gAr ? take(nbFaces * 2) : -1;

  var binary = new Uint8Array(offset);
  var view = new DataView(binary.buffer);
  var i, k, id;

  for (i = 0; i < nbVertices * 3; ++i)
    view.setFloat32(positionOffset + i * 4, vAr[i], true);

  // TRI_INDEX -> -1, which is how Nomad flags a triangle.
  for (i = 0; i < nbFaces * 4; ++i) {
    id = fAr[i];
    view.setInt32(faceOffset + i * 4, id === TRI_INDEX ? -1 : id, true);
  }

  if (hasUV) {
    for (i = 0; i < nbTexCoords * 2; ++i)
      view.setFloat32(texcoordOffset + i * 4, tAr[i], true);
    for (i = 0; i < nbFaces * 4; ++i) {
      id = fuvAr[i];
      view.setInt32(faceUvOffset + i * 4, id === TRI_INDEX ? -1 : id, true);
    }
  }

  if (cAr) binary.set(NomadCodec.encodeRGBM(cAr, nbVertices), colorOffset);

  if (mAr) {
    for (i = 0; i < nbVertices; ++i) {
      k = i * 3;
      binary[roughnessOffset + i] = Math.min(Math.max(mAr[k], 0), 1) * 255 + 0.5;
      binary[metalnessOffset + i] = Math.min(Math.max(mAr[k + 1], 0), 1) * 255 + 0.5;
      // Mask keeps its meaning: 1 = unmasked on both sides.
      view.setUint16(maskOffset + i * 2, Math.min(Math.max(mAr[k + 2], 0), 1) * 65535 + 0.5, true);
    }
  }

  if (gAr) {
    for (i = 0; i < nbFaces; ++i)
      view.setUint16(faceGroupOffset + i * 2, gAr[i] > 0 ? gAr[i] : 0, true);
  }

  var header = {
    type: 'mesh_full',
    mesh_id: opts.meshId || '',
    geometry_id: opts.geometryId || '',
    name: opts.name || 'SculptXR',
    vertex_count: nbVertices,
    face_count: nbFaces,
    binary_size: binary.length,
    coordinate_system: 'nomad_y_up',
    world_matrix: opts.worldMatrix || IDENTITY.slice(),
    smooth_shading: opts.smoothShading !== false,
    live_sync: !!opts.live,
    replace_topology: true,
    request_id: opts.requestId || '',
    position_offset: positionOffset,
    position_format: 'float32x3',
    face_offset: faceOffset,
    face_format: 'int32x4'
  };

  if (hasUV) {
    header.texcoord_count = nbTexCoords;
    header.texcoord_offset = texcoordOffset;
    header.texcoord_format = 'float32x2';
    header.face_uv_offset = faceUvOffset;
  }
  if (cAr) {
    header.color_offset = colorOffset;
    header.color_format = 'rgbm8';
  }
  if (mAr) {
    header.roughness_offset = roughnessOffset;
    header.roughness_format = 'uint8_norm';
    header.metalness_offset = metalnessOffset;
    header.metalness_format = 'uint8_norm';
    header.mask_offset = maskOffset;
    header.mask_format = 'uint16_norm';
  }
  if (gAr) {
    header.face_group_offset = faceGroupOffset;
    header.face_group_format = 'uint16';
    header.face_groups = opts.faceGroupDefs || [{ name: 'Group 1', color: [0.8, 0.2, 0.2] }];
  }

  return { header: header, binary: binary };
};

/**
 * A sparse update for the vertices a single stroke touched.
 *
 * `indices` are vertex ids; positions are read from the mesh's current arrays.
 * `vertexCount` is the topology guard the receiver checks before applying.
 */
NomadCodec.encodeDelta = function (mesh, indices, opts) {
  opts = opts || {};
  var count = indices.length;
  var vAr = mesh.getVertices();

  var binary = new Uint8Array(count * 4 + count * 12);
  var view = new DataView(binary.buffer);
  var positionOffset = count * 4;

  for (var i = 0; i < count; ++i) {
    var id = indices[i];
    view.setUint32(i * 4, id, true);
    var k = id * 3;
    var j = positionOffset + i * 12;
    view.setFloat32(j, vAr[k], true);
    view.setFloat32(j + 4, vAr[k + 1], true);
    view.setFloat32(j + 8, vAr[k + 2], true);
  }

  return {
    header: {
      type: 'mesh_delta',
      mesh_id: opts.meshId || '',
      request_id: opts.requestId || '',
      count: count,
      vertex_count: mesh.getNbVertices(),
      binary_size: binary.length,
      live_sync: !!opts.live,
      index_offset: 0,
      index_format: 'uint32',
      position_offset: positionOffset,
      position_format: 'float32x3'
    },
    binary: binary
  };
};

var IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export default NomadCodec;
