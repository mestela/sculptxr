// VERTEX AMBIENT OCCLUSION, baked once by ray casting, one value per vertex (1 = open sky).
//
// What it is for is SPECULAR occlusion: the environment map reflects the whole sky off every
// surface, so a tongue or the inside of the lips -- which in reality see only the mouth around
// them -- caught a full bright fresnel rim. three's physical lighting model already applies
// Frostbite's specular occlusion (Lagarde 2014) to the env reflection when a material has an
// aoNode, and the same value darkens the env diffuse. This supplies the value (Mesh.setOcclusion).
//
// PER VERTEX, so it rides blendshapes and the rig at no cost, which a screen-space AO pass in VR
// would not. Baked in whatever pose the mesh is in: bake at rest. Self-occlusion only -- other
// objects do not shadow it.
//
// Rays: a fixed Fibonacci set of directions, those in the vertex's hemisphere, cosine weighted,
// against a flat BVH of the mesh's triangles, any-hit within `maxDist` (a fraction of the mesh's
// size, so distant geometry -- the other side of a head -- does not count as cover).

const DIRS = 128;
const LEAF = 4;

function fibonacciDirs(n) {
  const out = new Float32Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), t = ga * i;
    out[i * 3] = Math.cos(t) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(t) * r;
  }
  return out;
}

// Flat BVH over triangles: nodes are [minx,miny,minz,maxx,maxy,maxz] + (left child | first tri,
// count). count 0 = inner node whose children are `left` and `left + 1`.
function buildBVH(v, tris, nbTri) {
  const cen = new Float32Array(nbTri * 3);
  for (let t = 0; t < nbTri; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) cen[t * 3 + k] = (v[a + k] + v[b + k] + v[c + k]) / 3;
  }
  const order = new Uint32Array(nbTri);
  for (let t = 0; t < nbTri; t++) order[t] = t;
  const box = [], kid = [], cnt = [];
  const bounds = (s, e, i) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = s; j < e; j++) {
      const t = order[j];
      for (let k = 0; k < 3; k++) {
        const p = tris[t * 3 + k] * 3;
        if (v[p] < x0) x0 = v[p]; if (v[p] > x1) x1 = v[p];
        if (v[p + 1] < y0) y0 = v[p + 1]; if (v[p + 1] > y1) y1 = v[p + 1];
        if (v[p + 2] < z0) z0 = v[p + 2]; if (v[p + 2] > z1) z1 = v[p + 2];
      }
    }
    box[i * 6] = x0; box[i * 6 + 1] = y0; box[i * 6 + 2] = z0; box[i * 6 + 3] = x1; box[i * 6 + 4] = y1; box[i * 6 + 5] = z1;
  };
  const stack = [[0, 0, nbTri]];
  let nodes = 1;
  while (stack.length) {
    const [i, s, e] = stack.pop();
    bounds(s, e, i);
    if (e - s <= LEAF) { kid[i] = s; cnt[i] = e - s; continue; }
    // split at the median of the widest axis
    const ext = [box[i * 6 + 3] - box[i * 6], box[i * 6 + 4] - box[i * 6 + 1], box[i * 6 + 5] - box[i * 6 + 2]];
    const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : (ext[1] > ext[2] ? 1 : 2);
    const sub = Array.from(order.subarray(s, e)).sort((p, q) => cen[p * 3 + ax] - cen[q * 3 + ax]);
    order.set(sub, s);
    const m = (s + e) >> 1;
    const l = nodes; nodes += 2;
    kid[i] = l; cnt[i] = 0;
    stack.push([l, s, m], [l + 1, m, e]);
  }
  return { box: Float32Array.from(box), kid: Uint32Array.from(kid), cnt: Uint32Array.from(cnt), order };
}

// any hit along o + t*d for t in (tMin, tMax)
function occluded(bvh, v, tris, ox, oy, oz, dx, dy, dz, tMin, tMax, stack) {
  const { box, kid, cnt, order } = bvh;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const i = stack[--sp], b = i * 6;
    let t0 = ((ix >= 0 ? box[b] : box[b + 3]) - ox) * ix, t1 = ((ix >= 0 ? box[b + 3] : box[b]) - ox) * ix;
    const ty0 = ((iy >= 0 ? box[b + 1] : box[b + 4]) - oy) * iy, ty1 = ((iy >= 0 ? box[b + 4] : box[b + 1]) - oy) * iy;
    if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? box[b + 2] : box[b + 5]) - oz) * iz, tz1 = ((iz >= 0 ? box[b + 5] : box[b + 2]) - oz) * iz;
    if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
    if (t0 > t1 || t1 < tMin || t0 > tMax) continue;
    if (!cnt[i]) { stack[sp++] = kid[i]; stack[sp++] = kid[i] + 1; continue; }
    for (let j = kid[i], e = kid[i] + cnt[i]; j < e; j++) {
      const t = order[j], a = tris[t * 3] * 3, bb = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
      // Moller-Trumbore, both sides
      const e1x = v[bb] - v[a], e1y = v[bb + 1] - v[a + 1], e1z = v[bb + 2] - v[a + 2];
      const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - v[a], sy = oy - v[a + 1], sz = oz - v[a + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = (dx * qx + dy * qy + dz * qz) * inv;
      if (w < 0 || u + w > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > tMin && tt < tMax) return true;
    }
  }
  return false;
}

// Float32Array(nbVertices), 1 = unoccluded. `maxDist` defaults to a quarter of the bounding
// diagonal.
export function bakeVertexAO(mesh, opts) {
  opts = opts || {};
  const v = mesh.getVertices(), n = mesh.getNormals();
  const nbV = mesh.getNbVertices(), nbTri = mesh.getNbTriangles();
  const tris = mesh.getTriangles();
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nbV; i++) {
    const p = i * 3;
    if (v[p] < x0) x0 = v[p]; if (v[p] > x1) x1 = v[p];
    if (v[p + 1] < y0) y0 = v[p + 1]; if (v[p + 1] > y1) y1 = v[p + 1];
    if (v[p + 2] < z0) z0 = v[p + 2]; if (v[p + 2] > z1) z1 = v[p + 2];
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const maxDist = opts.maxDist || diag * 0.25;
  const eps = diag * 1e-4;
  const bvh = buildBVH(v, tris, nbTri);
  const dirs = fibonacciDirs(DIRS);
  const stack = new Uint32Array(256);
  const ao = new Float32Array(nbV);
  for (let i = 0; i < nbV; i++) {
    const p = i * 3;
    const nx = n[p], ny = n[p + 1], nz = n[p + 2];
    const ox = v[p] + nx * eps, oy = v[p + 1] + ny * eps, oz = v[p + 2] + nz * eps;
    let open = 0, all = 0;
    for (let k = 0; k < DIRS; k++) {
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const c = dx * nx + dy * ny + dz * nz;
      if (c <= 0) continue;
      all += c;
      if (!occluded(bvh, v, tris, ox, oy, oz, dx, dy, dz, eps, maxDist, stack)) open += c;
    }
    ao[i] = all > 0 ? open / all : 1;
  }
  return ao;
}

export default { bakeVertexAO };
