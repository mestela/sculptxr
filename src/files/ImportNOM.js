import NomadCodec from '../link/NomadCodec.js';
import NomadImport from '../link/NomadImport.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import MeshResolution from '../mesh/multiresolution/MeshResolution.js';
import NomFile from './NomFile.js';
import { buildStencil, applyStencil } from './NomMultires.js';
import { IDENTITY, mul, inv, worldOf } from './NomMath.js';

// NOMAD .nom IMPORT.
//
// The container is NomFile.js. Per-vertex conventions are the Nomad Link's, because it is the
// same program writing the same numbers: rgbm8 colour, mask 1 = unmasked, UV pool plus
// per-corner indices, int32x4 faces with -1 for a triangle. So this decodes each array and hands
// the result to NomadImport.buildMesh, the function the live link already uses.
//
// DO NO HARM. The point of this importer is posing a sculpt and sending it BACK, so every mesh
// keeps `_nomSource = { file, node, mesh }`: the parsed file, the node's path in the scene tree
// and the mesh index. An exporter then patches the transforms (and later the vertices) and
// copies every other byte of the file through untouched. Nothing is rebuilt from our model.
//
// Only the TOP multires level is imported (the arrays on the mesh itself). The lower levels are
// base + deltas and stay in the file.

var Import = {};


function decodeMesh(nom, m, name) {
  const nbVertices = m.count_vertex, nbFaces = m.count_face;
  const out = {
    meshId: '', geometryId: '', name, worldMatrix: null,
    smoothShading: true, nbVertices, nbFaces,
    vertices: nom.f32(m.vertices), faces: null, colors: null, materials: null,
    texCoords: null, faceUvs: null, faceGroups: null,
    faceGroupDefs: m.groups ? m.groups.slice() : null
  };
  if (!out.vertices || out.vertices.length !== nbVertices * 3) throw new Error('bad vertex array');

  const faceIdx = (desc) => {
    const src = nom.i32(desc), dst = new Uint32Array(nbFaces * 4);
    for (let i = 0; i < nbFaces; i++) {
      const k = i * 4;
      dst[k] = src[k]; dst[k + 1] = src[k + 1]; dst[k + 2] = src[k + 2];
      dst[k + 3] = src[k + 3] >= 0 ? src[k + 3] : NomadCodec.TRI_INDEX;
    }
    return dst;
  };
  out.faces = faceIdx(m.faces);

  const rgbm = nom.bytesOf(m.colors);
  if (rgbm) out.colors = NomadCodec.decodeRGBM(rgbm, 0, nbVertices);

  const rough = nom.bytesOf(m.roughness, 'u8'), metal = nom.bytesOf(m.metalness, 'u8'), mask = nom.u16(m.masks);
  if (rough || metal || mask) {
    const ms = out.materials = new Float32Array(nbVertices * 3);
    for (let i = 0; i < nbVertices; i++) {
      ms[i * 3] = rough ? rough[i] / 255 : 0.25;
      ms[i * 3 + 1] = metal ? metal[i] / 255 : 0;
      ms[i * 3 + 2] = mask ? mask[i] / 65535 : 1;
    }
  }

  if (m.uvs && m.faces_uv) {
    out.texCoords = nom.f32(m.uvs);
    out.faceUvs = faceIdx(m.faces_uv);
  }

  if (m.faces_group) {
    const g = nom.u16(m.faces_group);
    out.faceGroups = new Int32Array(g);
  }
  out.layerInfo = applyLayers(nom, m, out);

  // A VIEWED LEVEL ABOVE 0. Nomad saves the arrays of the level you were looking at, and the lower
  // levels exist only implicitly: each is the first N vertices of the level above it (measured:
  // this reproduces the stored offsets to 6e-8). SculptXR's multires goes UP from a base cage
  // (the thing a rig binds), so the base here is level 0 -- the first N0 vertices of the top
  // arrays, with level 0's own faces -- and buildLevels subdivides back up to the viewed level.
  // The full-resolution colours/materials are kept aside for that: a level's colour is not a
  // subdivision of the level below, it is what the file says, and the difference becomes detail.
  const viewed = m.multires_level | 0, L0 = viewed > 0 && m.multires_levels && m.multires_levels[0];
  if (L0 && L0.faces) {
    const n0 = L0.count_vertex, f0 = L0.count_face;
    const fIdx = (desc) => {
      const src = nom.i32(desc), dst = new Uint32Array(f0 * 4);
      for (let i = 0; i < f0; i++) {
        const k = i * 4;
        dst[k] = src[k]; dst[k + 1] = src[k + 1]; dst[k + 2] = src[k + 2];
        dst[k + 3] = src[k + 3] >= 0 ? src[k + 3] : NomadCodec.TRI_INDEX;
      }
      return dst;
    };
    const base = Object.assign({}, out, {
      nbVertices: n0, nbFaces: f0,
      vertices: out.vertices.slice(0, n0 * 3), faces: fIdx(L0.faces),
      colors: out.colors && out.colors.slice(0, n0 * 3), materials: out.materials && out.materials.slice(0, n0 * 3),
      texCoords: null, faceUvs: null, faceGroups: null
    });
    if (L0.uvs && L0.faces_uv) { base.texCoords = nom.f32(L0.uvs); base.faceUvs = fIdx(L0.faces_uv); }
    if (L0.faces_group) base.faceGroups = new Int32Array(nom.u16(L0.faces_group));
    base.top = { vertices: out.vertices, colors: out.colors, materials: out.materials, n: nbVertices };
    return base;
  }
  return out;
}

// NOMAD LAYERS. The mesh's own colour / roughness / metalness arrays are the BASE; paint made on
// a layer is stored apart (measured: the base colour array of a painted head is one uniform skin
// tone, the paint sits in `layers[i].colors`). Each channel of a layer has a data array, a
// per-vertex strength array (`opacity_<channel>`), a factor, a visibility flag and a blend mode.
// The three surface channels are composited into the vertex arrays here, bottom layer first, so
// the model looks as it does in Nomad. Positions (`offsets`) are not flattened -- they come back
// as a blendshape, the app's own layer mechanism, so they stay switchable.
//
// Blending: 'normal' is a lerp by strength; 'add' and 'multiply' are done too. Anything else
// falls back to normal and is reported.
function applyLayers(nom, m, out) {
  const info = { colour: 0, roughness: 0, metalness: 0, shapes: [], unknownBlend: null };
  const n = m.count_vertex;
  const mix = (base, lay, a, mode) =>
    mode === 'add' ? base + lay * a : mode === 'multiply' ? base * (1 - a) + base * lay * a : base * (1 - a) + lay * a;
  const unit = (mode) => {
    if (mode && mode !== 'normal' && mode !== 'add' && mode !== 'multiply') info.unknownBlend = mode;
  };
  const names = new Set();
  for (const L of m.layers || []) {
    if (L.visible === false) continue;
    const f = L.factor === undefined ? 1 : L.factor;

    // colour
    if (L.colors && L.visible_color !== false && L.colors.count === n && !L.colors.only_zeros) {
      const lay = NomadCodec.decodeRGBM(nom.bytesOf(L.colors), 0, n);
      const A = nom.bytesOf(L.opacity_color, 'u8');
      const k = f * (L.factor_color === undefined ? 1 : L.factor_color);
      unit(L.blend_color);
      if (A && out.colors) {
        for (let i = 0; i < n; i++) {
          const a = Math.min(1, A[i] / 255 * k);
          if (!a) continue;
          for (let c = 0; c < 3; c++) out.colors[i * 3 + c] = mix(out.colors[i * 3 + c], lay[i * 3 + c], a, L.blend_color);
        }
        info.colour++;
      }
    }

    // roughness (slot 0 of the material vector) and metalness (slot 1)
    for (const [name, slot, field] of [['roughness', 0, 'roughness'], ['metalness', 1, 'metalness']]) {
      const D = L[field];
      if (!D || L['visible_' + name] === false || D.only_zeros || D.count !== n || !out.materials) continue;
      const lay = nom.bytesOf(D, 'u8'), A = nom.bytesOf(L['opacity_' + name], 'u8');
      const k = f * (L['factor_' + name] === undefined ? 1 : L['factor_' + name]);
      unit(L['blend_' + name]);
      if (!A) continue;
      for (let i = 0; i < n; i++) {
        const a = Math.min(1, A[i] / 255 * k);
        if (a) out.materials[i * 3 + slot] = mix(out.materials[i * 3 + slot], lay[i] / 255, a, L['blend_' + name]);
      }
      info[name]++;
    }

    // positions -> a blendshape that carries the layer's own name and weight
    if (L.offsets && !L.offsets.only_zeros && L.offsets.count === n) {
      let name = L.name || 'Layer', u = 2;
      while (names.has(name)) name = (L.name || 'Layer') + ' ' + u++;
      names.add(name);
      info.shapes.push({ name, delta: nom.f32(L.offsets).slice(),
                         weight: L.visible_offset === false ? 0 : f * (L.factor_offset === undefined ? 1 : L.factor_offset) });
    }
  }
  return info;
}

// THE HIGHER MULTIRES LEVELS. Nomad saves the arrays of the level you were LOOKING at; every
// level above it is stored as `level_offsets` only. Measured (2026-10-10, against a file that has
// the ground truth): an offset is a plain OBJECT-SPACE vector,
//         level_k = subdivide(level_k-1) + offsets_k
// (matched to 6e-8), and SculptXR's own catmull subdivision reproduces Nomad's face arrays for
// each level index for index, so the same subdivision can be run here and the offsets added.
//
// SculptXR keeps detail as vectors in the local n/t/bi frame instead (so it rotates with a pose),
// so each level's offsets are applied to the subdivided positions and then handed to
// computeDetails, which re-expresses them in that frame. The displayed shape is identical.
//
// Called by Scene once the meshes are wrapped, because adding a level is a Multimesh operation.
// The imported level stays at index 0 -- it is the one a rig binds, and the higher levels ride
// along. Levels BELOW the viewed one are not rebuilt (the file has no data for them).
Import.buildLevels = function (mm) {
  const src = mm && mm._nomSource;
  if (!src || !mm.addLevel) return 0;
  // A mesh with UVs keeps SculptXR's own subdivision (it carries the seam duplicates, and it
  // matches Nomad's numbering after a translation, see matchLevel). Everything else -- and this
  // is where cages with triangles live -- is built from Nomad's own face lists, below.
  const base = mm._meshes && mm._meshes[0];
  return base && base.hasUV && base.hasUV() ? buildLevelsSxr(mm, src) : buildLevelsStencil(mm, src);
};

// LEVELS FROM NOMAD'S FACE LISTS (no UVs). A level's faces come straight from the file and its
// positions from a Catmull-Clark stencil (NomMultires.js); the lower level's synthesis is pointed
// at that stencil, so SculptXR steps between these levels exactly as Nomad numbers them and a
// cage with triangles is no different from one without. Up to the viewed level the positions are
// slices of the file's top array (see decodeMesh); above it they are subdivision + the file's
// object-space offsets. Vertex numbering is Nomad's throughout, so nothing needs translating.
function buildLevelsStencil(mm, src) {
  const nom = src.file, md = nom.scene.meshes[src.mesh];
  const levels = md.multires_levels || [];
  const viewed = md.multires_level | 0;
  const TRI = 4294967295;
  const facesOf = (k) => nom.i32(k === viewed ? md.faces : (levels[k] && levels[k].faces));
  const toU32 = (a) => { const o = new Uint32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] >= 0 ? a[i] : TRI; return o; };
  const gl = mm.getCurrentMesh().getGL();
  let parent = facesOf(0), built = 0;
  const stencils = [];
  for (let k = 1; k < levels.length; k++) {
    const desc = levels[k], nNew = desc.count_vertex, nOld = levels[k - 1].count_vertex;
    const kids = facesOf(k);
    const sliced = !!(src.top && k <= viewed);
    const off = sliced ? null : nom.f32(desc.level_offsets);
    if (!kids || !parent || (!sliced && !off)) { console.warn('[nom] ' + (src.name || '') + ' level ' + k + ' has no ' + (kids ? 'offsets' : 'faces') + '; stopping'); break; }
    const st = buildStencil(parent, kids, nOld, nNew);
    if (!st) { console.warn('[nom] ' + (src.name || '') + ' level ' + k + ': the face list is not a subdivision of the level below; higher levels not imported'); break; }

    const lower = mm._meshes[mm._meshes.length - 1];
    const ms = new MeshStatic(gl);
    ms.setVertices(new Float32Array(nNew * 3));
    ms.setFaces(toU32(kids));
    ms.setColors(new Float32Array(nNew * 3));
    ms.setMaterials(new Float32Array(nNew * 3));
    const fgDesc = k === viewed ? md.faces_group : desc.faces_group;
    if (fgDesc) ms.setFacesGroups(new Int32Array(nom.u16(fgDesc)));
    const up = new MeshResolution(ms, true);
    up.setRenderData(mm.getRenderData());
    up.setTransformData(mm.getTransformData());
    up.allocateArrays();
    up.initTopology();

    // the lower level now subdivides by this stencil (only toward THIS level: a level SculptXR adds
    // later has a different vertex count and falls back to its own rule)
    lower.computePartialSubdivision = function (sv, sc, sm, nbUp) {
      if (nbUp !== st.n) return MeshResolution.prototype.computePartialSubdivision.call(this, sv, sc, sm, nbUp);
      applyStencil(st, this.getVertices(), sv, nbUp);
      applyStencil(st, this.getColors(), sc, nbUp);
      applyStencil(st, this.getMaterials(), sm, nbUp);
    };
    mm._meshes.push(up);
    mm._sel = mm._meshes.length - 1;
    mm.setMeshData(up.getMeshData());

    const S = new Float32Array(nNew * 3), SC = new Float32Array(nNew * 3), SM = new Float32Array(nNew * 3);
    applyStencil(st, lower.getVertices(), S, nNew);
    applyStencil(st, lower.getColors(), SC, nNew);
    applyStencil(st, lower.getMaterials(), SM, nNew);
    const v = up.getVertices(), C = up.getColors(), M = up.getMaterials();
    if (sliced) v.set(src.top.vertices.subarray(0, nNew * 3));
    else for (let i = 0; i < nNew * 3; i++) v[i] = S[i] + off[i];
    // colours/materials: the file's own up to the viewed level, subdivided above it; the difference
    // from the subdivision becomes the level's colour/material detail
    C.set(src.top && sliced && src.top.colors ? src.top.colors.subarray(0, nNew * 3) : SC);
    M.set(src.top && sliced && src.top.materials ? src.top.materials.subarray(0, nNew * 3) : SM);
    stencils.push(st);
    parent = kids;
    built++;
  }
  if (viewed > 0 && built < viewed) src.noVerts = true;
  mm.setSelection(Math.min(viewed, mm._meshes.length - 1));
  mm.updateResolution();
  mm.initRender();

  // The details are computed by settleLevels, called once the scene has finished adding the meshes.
  mm._nomStencils = stencils;
  mm._nomLevelsBuilt = built;
  return built;
}

// THE DETAILS ARE COMPUTED LAST, from the settled levels. A detail vector is only valid against the
// normal it was measured with, and something between building the stack and the end of the load
// rewrote the top level's normals (measured: the old-vertex quarter of them): details taken earlier
// were measured against the wrong frames, and stepping down and up again moved ~5% of the
// vertices by up to 5mm. Run after addImportedMeshes this is exactly the analysis SculptXR itself
// would do, so everything it does later (step, pose) is consistent with it.
Import.settleLevels = function (mm) {
  const sts = mm && mm._nomStencils;
  if (!sts || !sts.length) return;
  for (let k = 1; k <= sts.length; k++) {
    const up = mm._meshes[k], lower = mm._meshes[k - 1], st = sts[k - 1], n = up.getNbVertices();
    const S = new Float32Array(n * 3), SC = new Float32Array(n * 3), SM = new Float32Array(n * 3);
    applyStencil(st, lower.getVertices(), S, n);
    applyStencil(st, lower.getColors(), SC, n);
    applyStencil(st, lower.getMaterials(), SM, n);
    up.updateGeometry();
    up.computeDetails(S, SC, SM, n);
  }
  mm._nomStencils = null;
};

function buildLevelsSxr(mm, src) {
  const nom = src.file, md = nom.scene.meshes[src.mesh];
  const levels = md.multires_levels || [];
  const viewed = md.multires_level | 0;
  const TRI = 4294967295;
  const faceSize = (a, o) => (a[o + 3] < 0 || a[o + 3] === TRI ? 3 : 4);
  // The base is Nomad's level 0 (the file's top arrays when it was saved at level 0, else the
  // first N0 vertices of them: see decodeMesh). The VIEWED level's faces live on the mesh itself,
  // every other level's in `multires_levels[k]`.
  const facesOf = (k) => nom.i32(k === viewed ? md.faces : (levels[k] && levels[k].faces));
  let nomParent = facesOf(0);
  let pi = null;                           // Nomad id -> SculptXR id at the previous level
  let built = 0;
  for (let k = 1; k < levels.length; k++) {
    const desc = levels[k];
    // Up to the viewed level the positions are slices of the top array (see decodeMesh), so a
    // level there needs no offsets -- and some files carry none for the viewed level. Above it
    // the offsets are all there is.
    const sliced = !!(src.top && k <= viewed);
    const off = sliced ? null : nom.f32(desc.level_offsets), nomFaces = facesOf(k);
    if ((!sliced && !off) || !nomFaces) { console.warn('[nom] ' + (src.name || '') + ' level ' + k + ' has no ' + (nomFaces ? 'offsets' : 'faces') + '; stopping'); break; }
    const sxrParent = mm.getCurrentMesh().getFaces();
    const nOld = mm.getCurrentMesh().getNbVertices();
    const up = mm.addLevel();
    mm.higherLevel();
    const n = desc.count_vertex;
    const pk = up.getNbVertices() === n && up.getNbFaces() === desc.count_face
      ? matchLevel(sxrParent, nomParent, up.getFaces(), nomFaces, nOld, n, pi, faceSize, TRI) : null;
    if (!pk) {
      console.warn('[nom] ' + (src.name || '') + ' level ' + k + ' does not match the file\'s topology; higher levels not imported');
      mm._meshes.pop(); mm.setSelection(mm._meshes.length - 1);
      break;
    }
    pi = pk;
    nomParent = nomFaces;
    // offsets by SculptXR's vertex numbering
    const o = sliced ? null : new Float32Array(n * 3);
    if (o) for (let j = 0; j < n; j++) { const t = pk[j] * 3; o[t] = off[j * 3]; o[t + 1] = off[j * 3 + 1]; o[t + 2] = off[j * 3 + 2]; }
    const v = up.getVertices();
    const S = Float32Array.from(v.subarray(0, n * 3));
    const SC = Float32Array.from(up.getColors().subarray(0, n * 3));
    const SM = Float32Array.from(up.getMaterials().subarray(0, n * 3));
    if (o) for (let i = 0; i < n * 3; i++) v[i] += o[i];
    else for (let j = 0; j < n; j++) { const t = pk[j] * 3; v[t] = src.top.vertices[j * 3]; v[t + 1] = src.top.vertices[j * 3 + 1]; v[t + 2] = src.top.vertices[j * 3 + 2]; }
    // Up to the viewed level the file's own colours/materials ARE those of the first N vertices
    // of the top arrays (the lower levels are slices of it); they replace the subdivided ones,
    // and computeDetails turns the difference into per-level colour detail.
    if (src.top && k <= viewed) {
      const C = up.getColors(), M = up.getMaterials();
      for (let j = 0; j < n; j++) {
        const t = pk[j] * 3;
        if (src.top.colors) { C[t] = src.top.colors[j * 3]; C[t + 1] = src.top.colors[j * 3 + 1]; C[t + 2] = src.top.colors[j * 3 + 2]; }
        if (src.top.materials) { M[t] = src.top.materials[j * 3]; M[t + 1] = src.top.materials[j * 3 + 1]; M[t + 2] = src.top.materials[j * 3 + 2]; }
      }
    }
    up.updateGeometry();
    up.computeDetails(S, SC, SM, n);
    if (k === viewed) {
      src.pi = pk;                                         // Nomad id -> SculptXR id at the viewed level
      // layer shapes were read in Nomad's numbering; the blendshape system works in the app's
      for (const sh of src.layerDefs || []) {
        const d2 = new Float32Array(sh.delta.length);
        for (let j = 0; j < n; j++) { const t = pk[j] * 3; d2[t] = sh.delta[j * 3]; d2[t + 1] = sh.delta[j * 3 + 1]; d2[t + 2] = sh.delta[j * 3 + 2]; }
        sh.delta = d2;
      }
    }
    built++;
  }
  // A viewed level that could not be rebuilt cannot be written back: the vertex array it would be
  // taken from does not exist. The exporter skips the vertices (and counts it), never guesses.
  if (viewed > 0 && built < viewed) src.noVerts = true;
  // Open at the level the file was saved at, as Nomad does, WITHOUT stepping there: stepping
  // copies vertices between levels, and every level was just set from the file.
  mm.setSelection(Math.min(viewed, mm._meshes.length - 1));
  mm.updateResolution();
  mm._nomLevelsBuilt = built;
  return built;
}

// Nomad and SculptXR subdivide the same surface to the same vertex SET, but number the new
// vertices differently: a parent's four children are listed in a rotated order, and the numbering
// follows the listing. Returns pk (Nomad id -> SculptXR id at this level), or null when the two
// topologies are not the same surface after translation.
//
// Parents are matched by their (already translated) vertex sets, each parent's children are the
// next size(parent) faces in either listing, and a child is matched by the one OLD vertex it
// carries. The rest of the child's corners then pair up in order (both wind the same way).
function matchLevel(sxrParent, nomParent, sxrKids, nomKids, nOld, nNew, piPrev, faceSize, TRI) {
  const tr = (id) => (piPrev && id < nOld ? piPrev[id] : id);
  const key = (q, len) => {
    let m = 0;
    for (let i = 1; i < len; i++) if (q[i] < q[m]) m = i;
    let k = '';
    for (let i = 0; i < len; i++) k += q[(m + i) % len] + ',';
    return k;
  };
  const nParents = (sxrParent.length / 4) | 0;
  // Nomad parents by translated key; children start at the running total of parent sizes
  const nomIdx = new Map(); let c = 0;
  for (let p = 0; p < nParents; p++) {
    const len = faceSize(nomParent, p * 4);
    const q = []; for (let i = 0; i < len; i++) q.push(tr(nomParent[p * 4 + i]));
    nomIdx.set(key(q, len), { p, start: c }); c += len;
  }
  const pk = new Int32Array(nNew).fill(-1);
  // old vertices: Nomad id j (< nOld) is SculptXR id tr(j)
  for (let j = 0; j < nOld; j++) pk[j] = tr(j);
  let sc = 0;
  for (let p = 0; p < nParents; p++) {
    const len = faceSize(sxrParent, p * 4);
    const q = []; for (let i = 0; i < len; i++) q.push(sxrParent[p * 4 + i]);
    const hit = nomIdx.get(key(q, len));
    if (!hit) return null;
    // old vertex (a SculptXR id) -> the SculptXR child quad carrying it
    const byOld = new Map();
    for (let i = 0; i < len; i++) {
      const o = (sc + i) * 4, quad = [sxrKids[o], sxrKids[o + 1], sxrKids[o + 2], sxrKids[o + 3]];
      const at = quad.findIndex((x) => x < nOld);
      if (at < 0) return null;
      byOld.set(quad[at], { quad, at });
    }
    for (let i = 0; i < len; i++) {
      const o = (hit.start + i) * 4, quad = [nomKids[o], nomKids[o + 1], nomKids[o + 2], nomKids[o + 3]];
      const at = quad.findIndex((x) => x < nOld);
      if (at < 0) return null;
      const mate = byOld.get(tr(quad[at]));
      if (!mate) return null;
      for (let t = 1; t < 4; t++) {
        const nid = quad[(at + t) % 4], sid = mate.quad[(mate.at + t) % 4];
        if (pk[nid] >= 0 && pk[nid] !== sid) return null;      // a vertex reached twice must agree
        pk[nid] = sid;
      }
    }
    sc += len;
  }
  for (let j = 0; j < nNew; j++) if (pk[j] < 0) return null;
  return pk;
}

// LIGHTS. Created through the app's own addLight() once the meshes are in, and placed with the
// same matrix the meshes got: every mesh is  app = G * W  (W the node's world matrix in the file,
// G the import's unit scale and fit-to-view), so G falls out of any one of them as
// load * W^-1, and a light at world matrix Wl goes to G * Wl. Nomad's own power/intensity are not
// calibrated against this app's slider, so intensity stays at the default; type, colour, cone
// and shadow come across.
Import.addLights = function (main, stats, meshes) {
  const defs = stats && stats.lightDefs;
  if (!defs || !defs.length || !main.addLight) return 0;
  const ref = meshes.find((m) => m._nomSource && m._nomLoadMatrix);
  if (!ref) return 0;
  const nom = ref._nomSource.file;
  const G = mul(Array.from(ref._nomLoadMatrix), inv(worldOf(nom.scene, ref._nomSource.path)));
  const TYPE = { point: 0, spot: 1, directional: 2, sun: 2 };
  let n = 0;
  for (const d of defs) {
    const def = d.def || {};
    const light = main.addLight();
    light._lightType = TYPE[def.type] === undefined ? 1 : TYPE[def.type];
    if (def.color) light._lightColor = [def.color[0], def.color[1], def.color[2]];
    // Nomad's spot_angle is the FULL cone angle (matt compared the two apps: the first import
    // came in at twice the size); `_lightConeDeg` is the half-angle.
    if (def.spot_angle) light._lightConeDeg = def.spot_angle * 90 / Math.PI;
    light._castShadow = def.shadow_cast !== false;
    light._permanentStaticLabel = d.node.name || 'Light';
    light.setMatrix(new Float32Array(mul(G, worldOf(nom.scene, d.path))));
    if (main.decorateLight) main.decorateLight(light);
    if (def.visible === false && light.setVisible) light.setVisible(false);
    light._nomLight = { file: nom, path: d.path, light: d.node.light };
    n++;
  }
  return n;
};

Import.importNOM = function (data, gl, onDone, onFail) {
  try {
    const nom = new NomFile(data);
    const scene = nom.scene;
    const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0,
                    perVertexMaterial: 0, vertexColours: 0, roughMetalMapped: 0, normalMapped: 0,
                    blendshapes: 0, faceGroups: 0, lights: 0, skipped: 0, layers: 0,
                    generator: 'Nomad Sculpt', ngon: true };
    const meshes = [];
    const lights = [];

    const walk = (nodes, parentWorld, path) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const here = path.concat(i);
        const world = mul(parentWorld, node.matrix || IDENTITY);
        if (node.mesh !== undefined) {
          const m = scene.meshes[node.mesh];
          try {
            const dec = decodeMesh(nom, m, node.name || 'Mesh');
            const mesh = NomadImport.buildMesh(dec, gl);
            mesh.setMatrix(new Float32Array(world));
            mesh._nomSource = { name: node.name, file: nom, path: here, mesh: node.mesh, layerShapes: dec.layerInfo.shapes.map((x) => x.name),
                                layerDefs: dec.layerInfo.shapes, top: dec.top || null, viewed: m.multires_level | 0, pi: null };
            // position layers become blendshapes once the mesh is wrapped (Scene reads this)
            if (dec.layerInfo.shapes.length) mesh._importedMorphs = dec.layerInfo.shapes;
            stats.layers += dec.layerInfo.colour + dec.layerInfo.roughness + dec.layerInfo.metalness;
            stats.blendshapes += dec.layerInfo.shapes.length;
            if (dec.layerInfo.unknownBlend) console.warn('[nom] layer blend mode "' + dec.layerInfo.unknownBlend + '" imported as normal');
            if (node.visible === false) mesh._nomHidden = true;
            meshes.push(mesh);
            stats.meshes++;
            stats.verts += dec.nbVertices;
            for (let f = 0; f < dec.nbFaces; f++) if (dec.faces[f * 4 + 3] !== NomadCodec.TRI_INDEX) stats.quads++;
            if (dec.texCoords) stats.uvs++;
            if (dec.colors) stats.vertexColours++;
            if (dec.materials) stats.perVertexMaterial++;
            if (dec.faceGroups && dec.faceGroupDefs && dec.faceGroupDefs.length) stats.faceGroups++;
          } catch (e) {
            console.warn('[nom] skipped mesh "' + node.name + '": ' + e.message);
            stats.skipped++;
          }
        } else if (node.light !== undefined) {
          stats.lights++;
          lights.push({ path: here, node, def: scene.lights[node.light] });
        }
        if (node.children && node.children.length) walk(node.children, world, here);
      }
    };
    walk(scene.scene || [], IDENTITY, []);
    stats.lightDefs = lights;
    stats.nomFile = nom;
    onDone(meshes, stats);
  } catch (e) {
    if (onFail) onFail(e);
  }
};

export default Import;
