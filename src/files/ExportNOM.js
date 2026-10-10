import NomFile from './NomFile.js';

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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// general 4x4 inverse (cofactor expansion); the matrices here can carry non-uniform scale
function inv(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!d) throw new Error('singular matrix');
  d = 1 / d;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d
  ];
}

// the node at `path` (indices down the tree) and its parent's world matrix
function locate(scene, path) {
  let nodes = scene.scene, parentWorld = IDENTITY, node = null;
  for (let d = 0; d < path.length; d++) {
    node = nodes[path[d]];
    if (d < path.length - 1) { parentWorld = mul(parentWorld, node.matrix || IDENTITY); nodes = node.children; }
  }
  return { node, parentWorld };
}

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
    // Vertices first. The app appends seam duplicates after the file's own vertices, so the
    // first `count_vertex` entries line up with the file one to one.
    const desc = file.scene.meshes[m._nomSource.mesh].vertices;
    // The IMPORTED level is index 0 of the stack (higher levels are rebuilt from the file's
    // offsets), and is the one a rig binds, so its array is the posed cage. Not getVertices(),
    // which answers for whichever level is on screen.
    const lvl0 = m._meshes && m._meshes.length ? m._meshes[0] : m;
    const nb = desc.count, now = lvl0.getVertices && lvl0.getVertices();
    if (now && now.length >= nb * 3 && !desc.lz4) {
      const was = file.f32(desc);
      let differs = false;
      for (let i = 0; i < nb * 3 && !differs; i++) if (now[i] !== was[i]) differs = true;
      if (differs) {
        patches.push({ offset: desc.offset, bytes: new Uint8Array(Float32Array.from(now.subarray(0, nb * 3)).buffer) });
        reshaped++;
      }
    } else if (!now || now.length < nb * 3) mismatched++;       // topology changed: cannot write back

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
