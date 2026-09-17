import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Utils from '../misc/Utils.js';

// glTF / GLB IMPORT.
//
// The app has exported glTF since long before it could read it, so `getFileType` answered 'glb'
// for a file nothing could open and the load ended in silence. This is the other half.
//
// THE THREE PROBLEMS THIS FILE EXISTS TO SOLVE, none of them "parse the file" — GLTFLoader does
// that, and it is already a dependency (the controller models come through it):
//
//   1. QUADS. glTF has no quads; a quad mesh arrives triangulated, and SculptXR is a quad-first
//      application. FB_ngon_encoding carries them anyway — see decodePolygons.
//   2. SEAMS. glTF stores UVs per VERTEX, so it must split a vertex wherever its UVs differ,
//      and the split is in the POSITION array too. Imported verbatim, a seam is a crack: the
//      two sides are different vertices and a brush moves one and not the other. SculptXR's
//      model is the one OBJ uses — a position array, and per-face-corner UV indices into a
//      separate pool — which represents a seam without tearing the surface. See weld().
//   3. TRANSFORMS. A character is several objects at several places in a node tree, and
//      their relative placement is the character.
//
// NOT TEXTURES, yet. The renderer has no albedo sampler and no punctual lights (ShaderPBR is
// IBL-only, and uTexture0 is the environment), so there is nowhere to put an image. Material
// FACTORS do have somewhere to go and are carried; the maps wait for the material work.

var Import = {};

// Named once: three renamed this between versions, and an undefined colour space silently
// leaves the texture linear, which reads as a washed-out model rather than an error.
const THREE_SRGB = THREE.SRGBColorSpace !== undefined ? THREE.SRGBColorSpace : undefined;

// ---- 1. quads -------------------------------------------------------------------------
//
// FB_ngon_encoding: the triangles of one polygon are consecutive AND SHARE THEIR FIRST INDEX,
// because that is what fan triangulation produces. So a run of triangles all starting with the
// same vertex is one polygon, and the polygon is that first vertex plus the third index of
// every triangle in the run. It is lossless, which is the whole point: this RESTORES the
// authored quads rather than guessing at them the way a merge-by-shape pass would.
//
// It never made the core spec, but it is what Nomad writes, and Nomad is where these files come
// from. matt: "the nomad creator follows a suggestion in the glb github that he actively chased,
// it never made the final official spec but he uses it everywhere."
//
// THE DECLARATION IS NOT THE TEST, because Nomad does not declare it. Measured on an actual
// Nomad 11 export: extensionsUsed lists only the KHR material extensions, while the index data
// is fan-encoded throughout -- the camel's body is 9,932 triangles in 4,966 runs of exactly two,
// its teeth 1,994 in 997, and three other objects are genuinely triangles in runs of one. Gating
// on the declaration imported all of it as triangles.
//
// THE STRUCTURE IS THE TEST. Sharing a first index is not enough and never was: (a,b,c) and
// (a,e,f) share `a` and are two unrelated triangles. A FAN also chains -- each triangle's second
// index is the previous triangle's third -- so the run walks a single polygon's rim, and that is
// checkable rather than assumed. Two triangles that share a vertex AND the edge between them
// ARE a quad; merging them loses no information and cannot invent a face that was not there.
// A coincidental shared first index in an ordinary triangle list will almost never also chain,
// which is what makes this safe to run on files that declare nothing.
//
// `window._glbNoQuads = true` imports everything as triangles, for when a file fools it anyway.
function decodePolygons(idx, useNgon) {
  const polys = [];
  const nbTris = (idx.length / 3) | 0;
  const allowFans = !(typeof window !== 'undefined' && window._glbNoQuads);
  void useNgon;   // kept for the stats line; it reports what the file SAID, not what it did
  for (let t = 0; t < nbTris;) {
    const first = idx[t * 3];
    const poly = [first, idx[t * 3 + 1], idx[t * 3 + 2]];
    let n = t + 1;
    if (allowFans) {
      // `prev` is the rim corner the next triangle must start its edge from. Stop at the first
      // triangle that either starts somewhere else or does not continue the rim.
      let prev = idx[t * 3 + 2];
      while (n < nbTris && idx[n * 3] === first && idx[n * 3 + 1] === prev) {
        prev = idx[n * 3 + 2];
        poly.push(prev);
        n++;
      }
    }
    polys.push(poly);
    t = n;
  }
  return polys;
}

// A polygon, as the faces this app can hold: triangles and quads, nothing wider.
//
// The fan for a >4 polygon is the one OBJ import already uses -- walk in from both ends, which
// gives quads and at most one triangle, rather than a fan from one corner which gives a pile of
// slivers. An n-gon mesh is not what these files carry (Nomad is quads), so this is the safety
// net rather than the path.
function emitFace(poly, fAr, uvAr, map, uvMap) {
  const n = poly.length;
  if (n < 3) return;
  const push = (a, b, c, d) => {
    fAr.push(map ? map[a] : a, map ? map[b] : b, map ? map[c] : c,
      d === undefined ? Utils.TRI_INDEX : (map ? map[d] : d));
    // The uv corner still speaks in ORIGINAL vertices — that is the split glTF made, and the
    // whole reason this representation exists — but through the pool, so equal uvs share a slot.
    if (uvAr) uvAr.push(uvMap[a], uvMap[b], uvMap[c],
      d === undefined ? Utils.TRI_INDEX : uvMap[d]);
  };
  if (n === 3) { push(poly[0], poly[1], poly[2]); return; }
  if (n === 4) { push(poly[0], poly[1], poly[2], poly[3]); return; }
  const nbPrim = Math.ceil(n / 2) - 1;
  for (let j = 0; j < nbPrim; j++) {
    const i1 = j, i2 = j + 1, i3 = n - 1 - j, i4 = n - j;
    if (i3 === i2) push(poly[i1], poly[i2], poly[i4 % n]);
    else push(poly[i1], poly[i2], poly[i3], poly[i4 % n]);
  }
}

// ---- 2. seams -------------------------------------------------------------------------
//
// EXACT positions, not a tolerance. The duplicates being removed here were made by splitting ONE
// vertex, so its copies are bit-identical — an epsilon buys nothing and starts merging detail
// that the author put there on purpose. (GeometryWorker's weldVertices uses a 0.02 bucket; that
// is for repairing boolean output, which is a different job with a different tolerance.)
//
// Returns the map from old vertex index to new, plus one representative old index per new
// vertex, which is how per-vertex data that did NOT split (colour, normal) is carried across.
function weld(pos, nbOld, used) {
  const map = new Uint32Array(nbOld);
  const rep = [];
  const seen = new Map();
  const out = [];
  let nbUsed = 0;
  for (let i = 0; i < nbOld; i++) {
    // ONLY WHAT THE FACES REFERENCE. Primitives of one mesh share a vertex buffer, so a
    // primitive's own slice leaves the rest unreferenced; carrying them in would import
    // stray points that nothing draws and every later pass still pays for.
    if (used && !used[i]) continue;
    nbUsed++;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const key = x + '_' + y + '_' + z;
    let ni = seen.get(key);
    if (ni === undefined) {
      ni = out.length / 3;
      seen.set(key, ni);
      out.push(x, y, z);
      rep.push(i);
    }
    map[i] = ni;
  }
  return { vertices: new Float32Array(out), map: map, rep: rep, merged: nbUsed - rep.length };
}

// A NORMALIZED INTEGER ATTRIBUTE IS NOT ITS RAW VALUE, and reading it as one is silent: glTF
// stores COLOR_0 as normalized ushort by default, so a white vertex is 65535, and writing that
// straight into a float colour clamps to 1. The whole model imports WHITE and nothing warns.
// matt: "it loads correctly into other online glb viewers, but in here it loads unlit white."
//
// Divisors are the glTF spec's: unsigned by max, signed by max positive with a floor at -1.
function denormalizer(attr) {
  if (!attr.normalized) return (v) => v;
  const a = attr.array;
  if (a instanceof Uint8Array) return (v) => v / 255;
  if (a instanceof Uint16Array) return (v) => v / 65535;
  if (a instanceof Uint32Array) return (v) => v / 4294967295;
  if (a instanceof Int8Array) return (v) => Math.max(v / 127, -1);
  if (a instanceof Int16Array) return (v) => Math.max(v / 32767, -1);
  return (v) => v;
}

// The distinct uv VALUES, plus the original-vertex -> pool-slot map. See the note at the call
// site for why value and not index.
function buildUVPool(uvAttr, nbOld) {
  const src = uvAttr.array, stride = uvAttr.itemSize;
  const index = new Uint32Array(nbOld);
  const seen = new Map();
  const out = [];
  for (let i = 0; i < nbOld; i++) {
    const u = src[i * stride], v = src[i * stride + 1];
    const key = u + '_' + v;
    let s = seen.get(key);
    if (s === undefined) { s = out.length / 2; seen.set(key, s); out.push(u, v); }
    index[i] = s;
  }
  return { uv: new Float32Array(out), index: index };
}

// ---- 3. one glTF MESH (all its primitives) -> one MeshStatic --------------------------
//
// A PRIMITIVE IS NOT AN OBJECT. glTF allows one material per primitive, so an object painted
// with three materials is stored as three primitives OF THE SAME MESH, sharing one vertex
// buffer and splitting the index list between them. three.js gives each primitive its own
// THREE.Mesh, and importing those one-for-one turned the camel's 6 objects into 13 -- `body`
// arriving three times, each carrying all 8,836 vertices and a third of the faces.
//
// So they are merged back: one object, one vertex pool, every face, and the per-primitive
// material written onto the vertices that primitive actually uses. Which is also what makes
// the material meaningful here at all, since this renderer keeps material PER VERTEX.
function buildMesh(prims, gl, name, stats) {
  const first = prims[0];
  const geo0 = first.geometry;
  const posAttr = geo0 && geo0.attributes && geo0.attributes.position;
  if (!posAttr || !posAttr.count) return null;

  const nbOld = posAttr.count;
  const pos = posAttr.array;
  const uvAttr = geo0.attributes.uv;
  const colAttr = geo0.attributes.color;

  // Every primitive's polygons, kept with the primitive they came from so the material can
  // follow them onto the right vertices.
  const perPrim = [];
  const used = new Uint8Array(nbOld);
  for (let p = 0; p < prims.length; p++) {
    const geo = prims[p].geometry;
    let idx;
    if (geo.index) idx = geo.index.array;
    else { const n = geo.attributes.position.count; idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
    const polys = decodePolygons(idx, !!(stats && stats.ngon));
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      for (let k = 0; k < poly.length; k++) used[poly[k]] = 1;
    }
    perPrim.push(polys);
  }

  const w = weld(pos, nbOld, used);
  const uvPool = uvAttr ? buildUVPool(uvAttr, nbOld) : null;

  const fAr = [];
  const uvfAr = uvPool ? [] : null;
  for (let p = 0; p < perPrim.length; p++) {
    const polys = perPrim[p];
    for (let i = 0; i < polys.length; i++) emitFace(polys[i], fAr, uvfAr, w.map, uvPool && uvPool.index);
  }

  const mesh = new MeshStatic(gl);
  mesh.setVertices(w.vertices);
  mesh.setFaces(new Uint32Array(fAr));

  const nbNew = w.rep.length;
  const matOf = (o) => (Array.isArray(o.material) ? o.material[0] : o.material);

  // Vertex colours: glTF's COLOR_0 if present, otherwise each primitive's base colour painted
  // onto the vertices that primitive uses. The second is not a fallback so much as the point --
  // an imported object with a red material should look red, and per-vertex colour is where this
  // renderer keeps that.
  if (colAttr && colAttr.count === nbOld) {
    const cs = new Float32Array(nbNew * 3);
    const src = colAttr.array, stride = colAttr.itemSize, dn = denormalizer(colAttr);
    for (let i = 0; i < nbNew; i++) {
      const o = w.rep[i] * stride;
      cs[i * 3] = dn(src[o]); cs[i * 3 + 1] = dn(src[o + 1]); cs[i * 3 + 2] = dn(src[o + 2]);
    }
    mesh.setColors(cs);
  } else if (prims.some((o) => matOf(o) && matOf(o).color)) {
    const cs = new Float32Array(nbNew * 3).fill(1);
    paintPerPrimitive(prims, perPrim, w, cs, (m) => m && m.color ? [m.color.r, m.color.g, m.color.b] : null);
    mesh.setColors(cs);
  }

  // COLOR_1 IS THIS APP'S MATERIAL VECTOR, not a second colour set. Nomad writes a normalized
  // ubyte VEC4 per vertex whose xyz are (roughness, metalness, mask) -- the same three values,
  // in the same order, that Mesh.setMaterials takes, because Nomad and SculptXR come from the
  // same SculptGL lineage. Checked against the material factors in the same file: gums 40/255 =
  // 0.157 against roughness 0.157, teeth 21/255 = 0.082 against 0.082.
  //
  // Taken in preference to the material factor because it is PER VERTEX -- a sculpt painted with
  // varying roughness keeps that variation, where flooding a factor would flatten it.
  const mat1 = geo0.attributes.color_1 || geo0.attributes.COLOR_1;
  if (mat1 && mat1.count === nbOld) {
    const ms = new Float32Array(nbNew * 3);
    const src = mat1.array, stride = mat1.itemSize, dn = denormalizer(mat1);
    for (let i = 0; i < nbNew; i++) {
      const o = w.rep[i] * stride;
      ms[i * 3] = dn(src[o]); ms[i * 3 + 1] = dn(src[o + 1]); ms[i * 3 + 2] = dn(src[o + 2]);
    }
    mesh.setMaterials(ms);
    if (stats) stats.perVertexMaterial++;
  } else if (prims.some((o) => { const m = matOf(o); return m && (m.roughness !== undefined || m.metalness !== undefined); })) {
    const ms = new Float32Array(nbNew * 3);
    for (let i = 0; i < nbNew; i++) { ms[i * 3] = 0.25; ms[i * 3 + 1] = 0; ms[i * 3 + 2] = 1; }
    paintPerPrimitive(prims, perPrim, w, ms, (m) => m
      ? [m.roughness === undefined ? 0.25 : m.roughness, m.metalness === undefined ? 0 : m.metalness, 1]
      : null);
    mesh.setMaterials(ms);
  }

  if (uvPool && uvfAr && uvfAr.length === fAr.length) {
    mesh.initTexCoordsDataFromOBJData(uvPool.uv, new Uint32Array(uvfAr));
  }

  // THE NODE'S PLACE IN THE WORLD, flattened. The node tree is how a glTF says where things are;
  // baking each object's world matrix keeps the character assembled without importing a
  // hierarchy the outliner would then have to own. Scene.normalizeAndCenterMeshes fits the whole
  // group with ONE shared transform afterwards, so relative placement survives being fitted.
  // (The primitives of one mesh share their node, so any of them answers for all.)
  first.updateMatrixWorld(true);
  mesh.setMatrix(new Float32Array(first.matrixWorld.elements));

  mesh._permanentStaticLabel = name || first.name || 'Mesh';

  // THE BASE-COLOUR MAP. GLTFLoader has already decoded the image and built the THREE.Texture
  // with the right wrapping and filtering, so this is a handover rather than a decode.
  //
  // ONE MAP PER OBJECT, and that is a real limit worth naming: glTF hangs a material off each
  // PRIMITIVE, and the primitives of one mesh have just been merged into one object, so a body
  // painted with three different images keeps only the first. Nomad writes one image per object
  // (the camel's body has a single colour map across all three of its primitives), which is why
  // this is a limit and not a bug today. Normal and metal/rough maps are not taken at all yet --
  // there is no sampler for them.
  // KHR_materials_transmission, which GLTFLoader has already decoded onto the material. Read
  // before the map so a transmissive surface is one whatever else it carries.
  const trans = prims.map(matOf).find((m) => m && m.transmission > 0);
  if (trans && mesh.setTransmission) mesh.setTransmission(trans.transmission);

  // The packed metal/rough texture. GLTFLoader hangs the SAME image on both metalnessMap and
  // roughnessMap because glTF packs them together, so either one finds it.
  //
  // NO colorSpace here, unlike the albedo map: this is linear data and calling it sRGB would
  // bend every roughness value on the way in.
  const withRM = prims.map(matOf).find((m) => m && (m.roughnessMap || m.metalnessMap));
  if (withRM && mesh.setRoughMetalMap) {
    const rm = withRM.roughnessMap || withRM.metalnessMap;
    rm.flipY = false;
    rm.needsUpdate = true;
    mesh.setRoughMetalMap(rm,
      withRM.roughness === undefined ? 1 : withRM.roughness,
      withRM.metalness === undefined ? 1 : withRM.metalness);
    if (stats) stats.roughMetalMapped++;
  }

  const withMap = prims.map(matOf).find((m) => m && m.map);
  if (withMap) {
    const tex = withMap.map;
    // glTF base colour is sRGB. Marked explicitly because the shader converts with the same
    // function it uses for vertex colour, and a mislabelled texture would sit a gamma apart
    // from the colours it multiplies.
    if (THREE_SRGB) tex.colorSpace = THREE_SRGB;
    tex.flipY = false;              // glTF UVs have their origin at the top left
    tex.needsUpdate = true;
    mesh.setAlbedoMap ? mesh.setAlbedoMap(tex) : (mesh._albedoMap = tex);
  }

  if (stats) {
    stats.meshes++;
    stats.verts += nbNew;
    stats.merged += w.merged;
    for (let p = 0; p < perPrim.length; p++)
      for (let i = 0; i < perPrim[p].length; i++) if (perPrim[p][i].length === 4) stats.quads++;
    if (uvAttr) stats.uvs++;
    if (colAttr && colAttr.count === nbOld) stats.vertexColours++;
    if (trans) stats.transmissive++;
    if (prims.map(matOf).some((m) => m && m.map)) stats.textured++;
  }
  return mesh;
}

// Write a per-vertex value for the vertices each primitive actually uses. A vertex shared by
// two primitives takes the LAST one written, which is arbitrary and unavoidable: the file says
// two materials meet there and this renderer has one value per vertex to say it with.
function paintPerPrimitive(prims, perPrim, w, out, valueOf) {
  for (let p = 0; p < prims.length; p++) {
    const m = Array.isArray(prims[p].material) ? prims[p].material[0] : prims[p].material;
    const v = valueOf(m);
    if (!v) continue;
    const polys = perPrim[p];
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      for (let k = 0; k < poly.length; k++) {
        const ni = w.map[poly[k]];
        out[ni * 3] = v[0]; out[ni * 3 + 1] = v[1]; out[ni * 3 + 2] = v[2];
      }
    }
  }
}

// ---- entry point ----------------------------------------------------------------------
//
// ASYNC, unlike every other importer here, because GLTFLoader is: a GLB can carry Draco or
// KHR_mesh_quantization, and unpacking those is the loader's job and worth having. The caller
// gets a callback rather than a return value; Scene.loadScene has an async route already (a
// model loaded from a URL goes through one).
Import.importGLTF = function (data, gl, onDone, onFail) {
  const loader = new GLTFLoader();
  const done = (gltf) => {
    // The raw JSON, which the loader keeps: the ngon extension is a PRIMITIVE-level flag that
    // three neither understands nor exposes on the geometry, so it is read from the source.
    const json = (gltf.parser && gltf.parser.json) || {};
    const used = json.extensionsUsed || [];
    const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0,
                    transmissive: 0, textured: 0, perVertexMaterial: 0, vertexColours: 0,
                    roughMetalMapped: 0,
                    // Who wrote the file, so the caller can apply that source's unit
                    // conversion -- Nomad's units are not scene units. See Scene.loadScene.
                    generator: (json.asset && json.asset.generator) || '',
                    ngon: used.indexOf('FB_ngon_encoding') >= 0 };

    const objs = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && o.geometry) objs.push(o); });

    // GROUP THE PRIMITIVES BACK INTO MESHES, and the test for "these belong together" has to be
    // the loader's own bookkeeping rather than the shape of the tree. three wraps a
    // multi-primitive mesh in a Group, but it uses Groups for node hierarchy too, so "same
    // parent" alone would merge things that merely sit near each other -- and this file has both
    // (a `body` group holding three primitives, and an `eyes` group holding two separate eyes).
    //
    // parser.associations is the mapping three keeps from its objects back to the glTF. A
    // primitive-wrapper Group is associated with a MESH and not with a primitive; a node group
    // has no mesh at all, and a single-primitive mesh object used as a parent carries
    // `primitives`. Only the first is a set of primitives to merge.
    //
    // THE TWO EYES MUST SURVIVE THIS. They are two NODES referencing one glTF mesh -- instances,
    // same geometry, different transforms -- so they group by their own object identity and stay
    // two objects. Keying on the mesh index instead would have merged them into one eye.
    const assoc = (gltf.parser && gltf.parser.associations) || new Map();
    const groups = new Map();
    const order = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      const pa = assoc.get(o.parent);
      const parentIsPrimitiveGroup = !!pa && pa.meshes !== undefined && pa.primitives === undefined;
      const key = parentIsPrimitiveGroup ? o.parent : o;
      if (!groups.has(key)) { groups.set(key, []); order.push(key); }
      groups.get(key).push(o);
    }

    const meshes = [];
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      const prims = groups.get(key);
      // The GROUP's name is the object's name; the primitives are named body_1, body_2, ...
      const name = (key.name || prims[0].name || '') || 'Mesh';
      const m = buildMesh(prims, gl, name, stats);
      if (m) meshes.push(m);
    }
    onDone(meshes, stats);
  };
  try {
    // '' is the resource path: a .glb is self-contained, so nothing is ever fetched relative to
    // it. A .gltf with external .bin/image files has no path to resolve against once it has been
    // read off disk, and the loader will say so.
    loader.parse(data, '', done, (e) => onFail && onFail(e));
  } catch (e) {
    if (onFail) onFail(e);
  }
};

export default Import;
