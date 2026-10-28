
// NOMAD .nom EXPORT -- the return trip, and deliberately a PATCH, not a re-encode.
//
// The imported file is kept on each mesh (`_nomSource`, set by ImportNOM) and written back with
// everything it contained except the nodes that moved. Materials, lights, settings, multires
// levels, layers and every other byte of data are copied as they were, so a sculpt that goes to
// SculptXR to be posed comes back as the same sculpt, posed.
//
// OBJECT TRANSFORMS, and the TOP-LEVEL VERTEX ARRAY when a mesh's positions differ from the
// file's (a pose, or a sculpt). The vertices are stored RAW, so they are replaced in place and
// nothing else in the data block moves. What Nomad does with the lower multires levels after
// this is the open question (they hold per-vertex offsets and are not touched here).
//
// THE MATRIX ALGEBRA. In the app a mesh's matrix is  cur = G * W'  where W' is the node's world
// matrix in Nomad's own space and G is the import placement (the x50 unit scale and the
// fit-to-view normalise, which nothing else knows). At load, load = G * W with W the file's
// original world matrix, so  G = load * W^-1  and
//        W' = G^-1 * cur = W * load^-1 * cur.
// G never has to be known, and it cancels exactly when the mesh has not moved. The node's local
// matrix is then  parentWorld^-1 * W'  (SculptXR flattens the hierarchy, so parents keep their
// original placement).

import { IDENTITY, mul, inv, locate } from './NomMath.js';
import NomadCodec from '../link/NomadCodec.js';
import TEMPLATE from './nomTemplate.json';

var Export = {};

// Returns { bytes, moved, reshaped, mismatched } or null when none of the meshes came from a .nom. `moved` is the
// number of nodes whose matrix was rewritten (the rest are left exactly as they were), `reshaped`
// the meshes whose vertices were written back, `mismatched` those skipped for a changed vertex count.
Export.exportNOM = function (meshes) {
  const src = meshes.filter((m) => m && m._nomSource && m._nomLoadMatrix);
  if (!src.length) return null;
  const file = src[0]._nomSource.file;
  const scene = JSON.parse(JSON.stringify(file.scene));   // file.scene stays pristine: export is repeatable
  let moved = 0, reshaped = 0, mismatched = 0;
  const patches = [];
  for (const m of src) {
    if (m._nomSource.file !== file) continue;
    // Vertices first. The file's vertex array is the level it was SAVED at (`viewed`), and in the
    // app that level is index `viewed` of the multires stack (index 0 is Nomad's level 0, the
    // cage a rig binds). The app appends seam duplicates after the file's own vertices, so the
    // first `count_vertex` entries are the file's, in the app's numbering: `pi` takes them back
    // to Nomad's.
    const src1 = m._nomSource;
    const desc = file.scene.meshes[src1.mesh].vertices;
    const stack = m._meshes && m._meshes.length ? m._meshes : null;
    const viewed = src1.viewed | 0;
    const nb = desc.count;
    if (src1.noVerts || (stack && stack.length <= viewed) || desc.lz4) {
      mismatched++;                                  // the viewed level was not rebuilt: nothing to write back
    } else {
      // A bound rig only keeps the cage current (the skin pass poses it and synthesises up to the
      // level on screen), so bring the viewed level up from it, exactly as the skin pass does.
      if (stack && viewed > 0 && m._skinW) for (let k = 1; k <= viewed; k++) stack[k].higherSynthesis(stack[k - 1]);
      const lvl = stack ? stack[viewed] : m;
      const now = lvl.getVertices && lvl.getVertices();
      if (!now || now.length < nb * 3) {
        mismatched++;                                // topology changed: cannot write back
      } else {
        const was = file.f32(desc);
        // THE FILE'S VERTICES INCLUDE ITS VISIBLE LAYERS (see applyLayers in ImportNOM.js): the
        // layer offsets are kept apart only so Nomad can toggle them. The app's posed array is
        // that same composite (base + weighted blendshapes), so it goes back as it is.
        const cur = Float32Array.from(now.subarray(0, nb * 3));
        const out = new Float32Array(nb * 3), pi = src1.pi;
        for (let j = 0; j < nb; j++) {
          const t = (pi ? pi[j] : j) * 3;
          out[j * 3] = cur[t]; out[j * 3 + 1] = cur[t + 1]; out[j * 3 + 2] = cur[t + 2];
        }
        let differs = false;
        // 1e-6, not exact: base + w*d - w*d is not base in float32, and an untouched mesh must stay untouched
        for (let i = 0; i < nb * 3 && !differs; i++) if (Math.abs(out[i] - was[i]) > 1e-6) differs = true;
        if (differs) {
          patches.push({ offset: desc.offset, bytes: new Uint8Array(out.buffer) });
          reshaped++;
        }
      }
    }

    const { node, parentWorld } = locate(file.scene, m._nomSource.path);
    const W = mul(parentWorld, node.matrix || IDENTITY);
    const Wn = mul(mul(W, inv(Array.from(m._nomLoadMatrix))), Array.from(m.getMatrix()));
    const local = mul(inv(parentWorld), Wn);
    let d = 0;
    const old = node.matrix || IDENTITY;
    for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(local[i] - old[i]));
    if (d < 1e-6) continue;                                // not moved: do no harm
    // an entry that did not really change keeps its exact original value, not 1e-17 of noise
    for (let i = 0; i < 16; i++) if (Math.abs(local[i] - old[i]) < 1e-9) local[i] = old[i];
    locate(scene, m._nomSource.path).node.matrix = local;
    moved++;
  }
  return { bytes: file.serialize(scene, patches), moved, reshaped, mismatched };
};

// A NEW .nom, for a scene that did not come from one (there is no file to patch). Each mesh's
// CURRENT level is written as a plain Nomad 'mesh' object, its arrays laid out by the Nomad Link
// encoder (same conventions: rgbm8 colours, mask 65535 = unmasked, -1 = triangle). Everything
// Nomad needs around that -- settings, a material, the default light -- comes from a real Nomad
// file (nomTemplate.json, taken from a fresh sphere scene and a baseball2.nom static mesh).
// Arrays are stored raw, no lz4, as Nomad itself stores vertices and uvs.
// `scale` is the app-to-Nomad unit factor (the import's _nomadScale, 50), so a round trip lands
// at the size it left.
Export.writeNOM = function (meshes, opts) {
  opts = opts || {};
  const s = opts.scale || 50;
  const chunks = [];
  let dataLen = 0;
  const put = (bytes, type, count) => {
    const offset = dataLen;
    chunks.push({ offset, bytes });
    dataLen += (bytes.length + 3) & ~3;                  // keep every array 4-byte aligned
    return { count, length: bytes.length, offset, type };
  };
  const scene = JSON.parse(JSON.stringify({ groups: [TEMPLATE.group], lights: [TEMPLATE.light],
    materials: [TEMPLATE.material], meshes: [], scene: [], settings: TEMPLATE.settings }));
  if (opts.name) scene.settings.project_name = opts.name;
  let written = 0;
  for (const w of meshes) {
    if (w._meshes && w._skinW) for (let k = 1; k <= (w._sel | 0); k++) w._meshes[k].higherSynthesis(w._meshes[k - 1]);
    const m = w.getCurrentMesh ? w.getCurrentMesh() : w;
    if (!m || !m.getFaces || !m.getNbFaces()) continue;
    const { header: h, binary: b } = NomadCodec.encodeMesh(m, { faceGroupDefs: w._nomadFaceGroupDefs || m._nomadFaceGroupDefs });
    const nv = h.vertex_count, nf = h.face_count;
    const cut = (at, n) => b.subarray(at, at + n);
    const mesh = JSON.parse(JSON.stringify(TEMPLATE.mesh));
    mesh.count_vertex = nv; mesh.count_face = nf;
    mesh.material = 0;
    mesh.vertices = put(cut(h.position_offset, nv * 12), 'f32vec3', nv);
    mesh.faces = put(cut(h.face_offset, nf * 16), 'i32vec4', nf);
    if (h.texcoord_offset !== undefined) {
      mesh.count_uv = h.texcoord_count;
      mesh.uvs = put(cut(h.texcoord_offset, h.texcoord_count * 8), 'f32vec2', h.texcoord_count);
      mesh.faces_uv = put(cut(h.face_uv_offset, nf * 16), 'i32vec4', nf);
    }
    if (h.color_offset !== undefined) mesh.colors = Object.assign(put(cut(h.color_offset, nv * 4), 'u8rgbm', nv), { rgbm_scale: 1 });
    if (h.roughness_offset !== undefined) {
      mesh.roughness = put(cut(h.roughness_offset, nv), 'u8', nv);
      mesh.metalness = put(cut(h.metalness_offset, nv), 'u8', nv);
      mesh.masks = put(cut(h.mask_offset, nv * 2), 'u16', nv);
    }
    mesh.opacity = put(new Uint8Array(nv).fill(255), 'u8', nv);
    // Nomad wants a definition for every group index the faces use
    const fg = h.face_group_offset !== undefined ? new Uint16Array(b.buffer.slice(h.face_group_offset, h.face_group_offset + nf * 2)) : new Uint16Array(nf);
    mesh.faces_group = put(new Uint8Array(fg.buffer), 'u16', nf);
    let top = 0;
    for (let i = 0; i < nf; i++) if (fg[i] > top) top = fg[i];
    const defs = h.face_groups || [];
    mesh.groups = [];
    for (let i = 0; i <= top; i++) mesh.groups.push(defs[i] || { name: 'Group ' + (i + 1), color: [(i * 0.618 + 0.3) % 1, (i * 0.382 + 0.6) % 1, (i * 0.25 + 0.2) % 1] });
    mesh.index_group = top;
    scene.meshes.push(mesh);
    // world placement in Nomad units: the import's x`s`, undone
    const S = [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, 1];
    scene.scene.push(Object.assign(JSON.parse(JSON.stringify(TEMPLATE.node)), {
      children: [], mesh: scene.meshes.length - 1, name: w._permanentStaticLabel || 'SculptXR ' + scene.meshes.length,
      matrix: mul(S, Array.from(w.getMatrix())), visible: w.isVisible ? w.isVisible() !== false : true
    }));
    written++;
  }
  if (!written) return null;
  scene.scene.push(JSON.parse(JSON.stringify(TEMPLATE.lightsNode)));

  const js = new TextEncoder().encode(JSON.stringify(scene));
  const thumbW = 128, head = 72, thumb = thumbW * thumbW * 4;
  const jsonOffset = head + thumb, dataOffset = jsonOffset + js.length;
  const out = new Uint8Array(dataOffset + dataLen);
  for (let i = 0; i < 12; i++) out[i] = 'Nomad Sculpt'.charCodeAt(i);
  const v = new DataView(out.buffer);
  v.setUint32(12, 7, true);
  [out.length, jsonOffset, js.length, dataOffset, dataLen, head, thumbW]
    .forEach((n, i) => v.setBigUint64(0x10 + i * 8, BigInt(n), true));
  out.set(js, jsonOffset);
  for (const c of chunks) out.set(c.bytes, dataOffset + c.offset);
  return { bytes: out, meshes: written };
};

export default Export;
