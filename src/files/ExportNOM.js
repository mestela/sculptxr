
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
        // THE FILE'S VERTICES ARE THE BASE, WITHOUT ITS LAYERS: the layer offsets are stored apart
        // and Nomad adds them back. The posed array in the app already includes the layers (they
        // are blendshapes here), so their weighted contribution comes back out, or Nomad would add
        // it a second time. It is the object-space offset that comes out, which is exactly what
        // Nomad will add, so what Nomad shows is what the app showed.
        const cur = Float32Array.from(now.subarray(0, nb * 3));
        const shapes = src1.layerShapes;
        const reg = typeof window !== 'undefined' ? window._animationRegistry : null;
        const track = shapes && shapes.length && reg && reg.tracks ? reg.tracks.get(m.getID()) : null;
        if (track && track.blendshapes) {
          for (const name of shapes) {
            const d = track.blendshapes.get(name);
            if (!d || (track.blendshapeMuted && track.blendshapeMuted.has(name))) continue;
            const w = reg.blendshapePreviewAt(track, name, track.blendshapeTracks.get(name));
            if (w) for (let i = 0; i < cur.length; i++) cur[i] -= d[i] * w;
          }
        }
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

export default Export;
