import NomadCodec from '../link/NomadCodec.js';
import NomadImport from '../link/NomadImport.js';
import NomFile from './NomFile.js';

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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// column-major a * b (glMatrix order; Nomad matrices have translation in [12..14])
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

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
  return out;
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
  const nom = src.file, md = nom.scene.meshes[src.mesh];
  const levels = md.multires_levels || [];
  const viewed = md.multires_level | 0;
  const TRI = 4294967295;
  const faceSize = (a, o) => (a[o + 3] < 0 || a[o + 3] === TRI ? 3 : 4);
  // the viewed level's faces and ids are the file's own: nothing to translate yet
  let nomParent = nom.i32(md.faces);
  let pi = null;                           // Nomad id -> SculptXR id at the previous level
  let built = 0;
  for (let k = viewed + 1; k < levels.length; k++) {
    const desc = levels[k];
    const off = nom.f32(desc.level_offsets), nomFaces = nom.i32(desc.faces);
    if (!off || !nomFaces) { console.warn('[nom] level ' + k + ' has no offsets/faces; stopping'); break; }
    const sxrParent = mm.getCurrentMesh().getFaces();
    const nOld = mm.getCurrentMesh().getNbVertices();
    const up = mm.addLevel();
    mm.higherLevel();
    const n = desc.count_vertex;
    const pk = up.getNbVertices() === n && up.getNbFaces() === desc.count_face
      ? matchLevel(sxrParent, nomParent, up.getFaces(), nomFaces, nOld, n, pi, faceSize, TRI) : null;
    if (!pk) {
      console.warn('[nom] level ' + k + ' does not match the file\'s topology; higher levels not imported');
      mm._meshes.pop(); mm.setSelection(mm._meshes.length - 1);
      break;
    }
    pi = pk;
    nomParent = nomFaces;
    // offsets by SculptXR's vertex numbering
    const o = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) { const t = pk[j] * 3; o[t] = off[j * 3]; o[t + 1] = off[j * 3 + 1]; o[t + 2] = off[j * 3 + 2]; }
    const v = up.getVertices();
    const S = Float32Array.from(v.subarray(0, n * 3));
    const SC = Float32Array.from(up.getColors().subarray(0, n * 3));
    const SM = Float32Array.from(up.getMaterials().subarray(0, n * 3));
    for (let i = 0; i < n * 3; i++) v[i] += o[i];
    up.updateGeometry();
    up.computeDetails(S, SC, SM, n);
    built++;
  }
  // back to the imported level, WITHOUT stepping down: going down copies the upper level's
  // vertices over this one, and this one is the file's own.
  mm.setSelection(0);
  mm.updateResolution();
  mm._nomLevelsBuilt = built;
  return built;
};

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

Import.importNOM = function (data, gl, onDone, onFail) {
  try {
    const nom = new NomFile(data);
    const scene = nom.scene;
    const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0,
                    perVertexMaterial: 0, vertexColours: 0, roughMetalMapped: 0, normalMapped: 0,
                    blendshapes: 0, faceGroups: 0, lights: 0, skipped: 0,
                    generator: 'Nomad Sculpt', ngon: true };
    const meshes = [];

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
            mesh._nomSource = { file: nom, path: here, mesh: node.mesh };
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
        }
        if (node.children && node.children.length) walk(node.children, world, here);
      }
    };
    walk(scene.scene || [], IDENTITY, []);
    onDone(meshes, stats);
  } catch (e) {
    if (onFail) onFail(e);
  }
};

export default Import;
