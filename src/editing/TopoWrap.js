// TOPO WRAP, the coarse step: carry GNM onto another head's shape from matched landmarks.
// Pure maths, no app state (TopoTransfer.js drives it), so the harness can run it under node.
//
// TWO PARTS. A SIMILARITY (scale, turn, move: ShapeRetarget.similarity, the same Horn fit Fit
// Parts uses) takes the source landmarks onto the target's as a rigid-plus-scale best fit; then a
// THIN-PLATE SPLINE bends space so every landmark lands exactly. The 3-D thin-plate kernel is
// |r| (biharmonic in 3-D): smooth, no tuning radius, and it reduces to the affine part far from the
// landmarks -- so the back of the head moves sensibly even though nothing was picked there.
// `smooth` (> 0) lets the spline miss the landmarks a little instead of folding the surface to hit
// a mis-click exactly. It is a fraction of the mean landmark spacing added to the kernel diagonal:
// 0.01 misses by ~0.2% of the head, 0.1 by ~2%, 0.5 ignores the landmarks almost entirely.
import { similarity } from './ShapeRetarget.js';

// Solve A x = b in place (n x n, row-major, several right-hand sides as columns of b).
function solve(A, b, n, m) {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-12) throw new Error('TopoWrap: landmarks are degenerate (all in a line or plane, or two on one spot)');
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      for (let k = 0; k < m; k++) { const t = b[c * m + k]; b[c * m + k] = b[p * m + k]; b[p * m + k] = t; }
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      for (let k = 0; k < m; k++) b[r * m + k] -= f * b[c * m + k];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    for (let k = 0; k < m; k++) {
      let s = b[c * m + k];
      for (let j = c + 1; j < n; j++) s -= A[c * n + j] * b[j * m + k];
      b[c * m + k] = s / A[c * n + c];
    }
  }
  return b;
}

const dist = (a, i, b, j) => Math.hypot(a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]);

// Fit the warp. `src`, `dst`: flat xyz of matching landmarks (n >= 4, not all in one plane).
// Returns { apply(p, out), sim, residual } where `apply` maps a point of the source's space.
export function fitWarp(src, dst, { smooth = 0 } = {}) {
  const n = src.length / 3;
  if (n < 4) throw new Error('TopoWrap: need at least 4 landmarks');
  const idx = [...Array(n).keys()];
  const sim = similarity(src, dst, idx);
  const { R, s, ms, md } = sim;
  const simP = (p, o, out) => {
    const a0 = p[o] - ms[0], a1 = p[o + 1] - ms[1], a2 = p[o + 2] - ms[2];
    for (let r = 0; r < 3; r++) out[r] = s * (R[r * 3] * a0 + R[r * 3 + 1] * a1 + R[r * 3 + 2] * a2) + md[r];
  };
  // The landmarks after the similarity: the spline's centres.
  const c = new Float64Array(n * 3), t = [0, 0, 0];
  for (let i = 0; i < n; i++) { simP(src, i * 3, t); c[i * 3] = t[0]; c[i * 3 + 1] = t[1]; c[i * 3 + 2] = t[2]; }
  let mean = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mean += dist(c, i, c, j);
  mean /= n * n;
  const N = n + 4, A = new Float64Array(N * N), b = new Float64Array(N * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i * N + j] = dist(c, i, c, j);
    A[i * N + i] += smooth * mean;
    const P = [1, c[i * 3], c[i * 3 + 1], c[i * 3 + 2]];
    for (let k = 0; k < 4; k++) { A[i * N + n + k] = P[k]; A[(n + k) * N + i] = P[k]; }
    for (let k = 0; k < 3; k++) b[i * 3 + k] = dst[i * 3 + k];
  }
  const W = solve(A, b, N, 3);
  const q = [0, 0, 0];
  const apply = (p, o, out, oo = 0) => {
    simP(p, o, q);
    for (let k = 0; k < 3; k++) out[oo + k] = W[n * 3 + k] + W[(n + 1) * 3 + k] * q[0] + W[(n + 2) * 3 + k] * q[1] + W[(n + 3) * 3 + k] * q[2];
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(q[0] - c[i * 3], q[1] - c[i * 3 + 1], q[2] - c[i * 3 + 2]);
      if (r) for (let k = 0; k < 3; k++) out[oo + k] += W[i * 3 + k] * r;
    }
    return out;
  };
  let residual = 0;
  const o = [0, 0, 0];
  for (let i = 0; i < n; i++) { apply(src, i * 3, o); residual = Math.max(residual, Math.hypot(o[0] - dst[i * 3], o[1] - dst[i * 3 + 1], o[2] - dst[i * 3 + 2])); }
  return { apply, sim, residual };
}

// Warp every point of `verts` (flat xyz) into a new Float32Array.
export function warpAll(warp, verts) {
  const out = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) warp.apply(verts, i, out, i);
  return out;
}

// ── Closest point on a triangle soup (brute force: fine for landmarks, not for whole meshes) ──

// Ericson, Real-Time Collision Detection 5.1.5.
function closestOnTri(p, a, b, c, out) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const set = (x, y, z) => { out[0] = x; out[1] = y; out[2] = z; return out; };
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return set(a[0], a[1], a[2]);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return set(b[0], b[1], b[2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]); }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return set(c[0], c[1], c[2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return set(b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]));
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return set(a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w);
}

// `tris` flat vertex indices, `verts` flat xyz. Returns [x, y, z].
export function closestPoint(tris, verts, p) {
  let best = Infinity;
  const out = [0, 0, 0], q = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) { a[k] = verts[tris[t] * 3 + k]; b[k] = verts[tris[t + 1] * 3 + k]; c[k] = verts[tris[t + 2] * 3 + k]; }
    closestOnTri(p, a, b, c, q);
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < best) { best = d; out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }
  }
  return out;
}

// ── Surface snap (T3): pull a wrapped mesh onto the target's surface ─────────────────────────
//
// "Closest point on the target" for every vertex, several passes over: a BOUNDING-VOLUME TREE over
// the target's triangles, searched nearest-first. It was a uniform grid searched ring by ring, and a
// grid's cost grows with how far a point starts from the surface (rings ~ distance / cell, each
// ring O(r^2) cells): on a 196k-triangle target 1.6 us a query on the surface, 27 us at 2-7 units
// off, 170 us deep inside it, which made a generic Snap to Surface (a mesh that starts well off the
// target) take seconds. The tree visits nodes closest-box-first and drops any box no nearer than the
// best hit, so its cost hardly depends on distance. The names stay buildGrid / closestOnGrid.

const LEAF = 4;

// Rearrange idx[lo..hi] so idx[k] holds the triangle with the k-th smallest centroid on `axis`,
// smaller ones before it, larger after (quickselect: a median split per node, O(n) a level).
function selectK(idx, lo, hi, k, cen, axis) {
  while (hi > lo) {
    const piv = cen[idx[(lo + hi) >> 1] * 3 + axis];
    let i = lo, j = hi;
    while (i <= j) {
      while (cen[idx[i] * 3 + axis] < piv) i++;
      while (cen[idx[j] * 3 + axis] > piv) j--;
      if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}

export function buildGrid(tris, verts) {
  const nt = tris.length / 3;
  const box = new Float32Array(nt * 6), cen = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = verts[tris[t * 3] * 3 + k], b = verts[tris[t * 3 + 1] * 3 + k], c = verts[tris[t * 3 + 2] * 3 + k];
      const mn = Math.min(a, b, c), mx = Math.max(a, b, c);
      box[t * 6 + k] = mn; box[t * 6 + 3 + k] = mx; cen[t * 3 + k] = (mn + mx) * 0.5;
    }
  }
  const idx = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) idx[t] = t;
  // Flat nodes: bounds, and either two children (left, left + 1) or a leaf's idx range.
  const maxN = Math.max(1, 2 * Math.ceil(nt / LEAF) * 2);
  const nb = new Float32Array(maxN * 6), left = new Int32Array(maxN), first = new Int32Array(maxN), count = new Int32Array(maxN);
  let nn = 1;
  const stack = [0, 0, nt];
  while (stack.length) {
    const hi = stack.pop(), lo = stack.pop(), n = stack.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let e = lo; e < hi; e++) {
      const t = idx[e], o = t * 6, c = t * 3;
      if (box[o] < x0) x0 = box[o]; if (box[o + 1] < y0) y0 = box[o + 1]; if (box[o + 2] < z0) z0 = box[o + 2];
      if (box[o + 3] > x1) x1 = box[o + 3]; if (box[o + 4] > y1) y1 = box[o + 4]; if (box[o + 5] > z1) z1 = box[o + 5];
      if (cen[c] < cx0) cx0 = cen[c]; if (cen[c + 1] < cy0) cy0 = cen[c + 1]; if (cen[c + 2] < cz0) cz0 = cen[c + 2];
      if (cen[c] > cx1) cx1 = cen[c]; if (cen[c + 1] > cy1) cy1 = cen[c + 1]; if (cen[c + 2] > cz1) cz1 = cen[c + 2];
    }
    nb[n * 6] = x0; nb[n * 6 + 1] = y0; nb[n * 6 + 2] = z0; nb[n * 6 + 3] = x1; nb[n * 6 + 4] = y1; nb[n * 6 + 5] = z1;
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
    if (hi - lo <= LEAF || Math.max(ex, ey, ez) <= 0) { first[n] = lo; count[n] = hi - lo; continue; }
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2, mid = (lo + hi) >> 1;
    selectK(idx, lo, hi - 1, mid, cen, axis);
    left[n] = nn; count[n] = 0;
    stack.push(nn, lo, mid, nn + 1, mid, hi);
    nn += 2;
  }
  return { tris, verts, box, idx, nb, left, first, count, stack: new Int32Array(128) };
}

// Closest point on the surface within `maxDist`: { p, t } (t = triangle) or null. Exact: a node or
// a triangle is only skipped when its box is no nearer than the best hit so far. `hint`, a triangle
// likely to be near (a neighbour's answer), only seeds that bound, so the search starts tight.
export function closestOnGrid(g, p, maxDist = Infinity, hint = -1) {
  if (!g.sa) { g.sa = [0, 0, 0]; g.sb = [0, 0, 0]; g.sc = [0, 0, 0]; g.so = [0, 0, 0]; }
  const a = g.sa, b = g.sb, cc = g.sc, o = g.so, v = g.verts, T = g.tris, B = g.box, NB = g.nb, I = g.idx;
  const L = g.left, F = g.first, C = g.count, S = g.stack;
  const px = p[0], py = p[1], pz = p[2];
  let best = maxDist === Infinity ? Infinity : maxDist * maxDist * (1 + 1e-9), bt = -1, bx = 0, by = 0, bz = 0;
  const tri = (t) => {
    const i = T[t * 3] * 3, j = T[t * 3 + 1] * 3, k = T[t * 3 + 2] * 3;
    a[0] = v[i]; a[1] = v[i + 1]; a[2] = v[i + 2];
    b[0] = v[j]; b[1] = v[j + 1]; b[2] = v[j + 2];
    cc[0] = v[k]; cc[1] = v[k + 1]; cc[2] = v[k + 2];
    closestOnTri(p, a, b, cc, o);
    const d = (o[0] - px) ** 2 + (o[1] - py) ** 2 + (o[2] - pz) ** 2;
    if (d < best) { best = d; bt = t; bx = o[0]; by = o[1]; bz = o[2]; }
  };
  // Squared distance from p to box `o` in array A.
  const bd = (A, q) => {
    const dx = px < A[q] ? A[q] - px : px > A[q + 3] ? px - A[q + 3] : 0;
    const dy = py < A[q + 1] ? A[q + 1] - py : py > A[q + 4] ? py - A[q + 4] : 0;
    const dz = pz < A[q + 2] ? A[q + 2] - pz : pz > A[q + 5] ? pz - A[q + 5] : 0;
    return dx * dx + dy * dy + dz * dz;
  };
  if (hint >= 0) tri(hint);
  let sp = 0;
  S[sp++] = 0;
  while (sp) {
    const n = S[--sp];
    if (bd(NB, n * 6) >= best) continue;
    if (C[n]) {
      for (let e = F[n], e1 = F[n] + C[n]; e < e1; e++) { const t = I[e]; if (t !== hint && bd(B, t * 6) < best) tri(t); }
      continue;
    }
    const l = L[n], r = l + 1, dl = bd(NB, l * 6), dr = bd(NB, r * 6);
    // Nearer child last, so it is popped first.
    if (dl < dr) { if (dr < best) S[sp++] = r; if (dl < best) S[sp++] = l; }
    else { if (dl < best) S[sp++] = l; if (dr < best) S[sp++] = r; }
  }
  return bt >= 0 ? { p: [bx, by, bz], t: bt } : null;
}

function triNormal(g, t) {
  const v = g.verts, T = g.tris, i = T[t * 3] * 3, j = T[t * 3 + 1] * 3, k = T[t * 3 + 2] * 3;
  const u = [v[j] - v[i], v[j + 1] - v[i + 1], v[j + 2] - v[i + 2]], w = [v[k] - v[i], v[k + 1] - v[i + 1], v[k + 2] - v[i + 2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

// Area-weighted vertex normals of `verts` over `tris`.
export function vertexNormals(tris, verts) {
  const n = new Float32Array(verts.length);
  // Scalars, not small arrays: this runs over every triangle once per snap pass.
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t] * 3, j = tris[t + 1] * 3, k = tris[t + 2] * 3;
    const u0 = verts[j] - verts[i], u1 = verts[j + 1] - verts[i + 1], u2 = verts[j + 2] - verts[i + 2];
    const w0 = verts[k] - verts[i], w1 = verts[k + 1] - verts[i + 1], w2 = verts[k + 2] - verts[i + 2];
    const c0 = u1 * w2 - u2 * w1, c1 = u2 * w0 - u0 * w2, c2 = u0 * w1 - u1 * w0;
    n[i] += c0; n[i + 1] += c1; n[i + 2] += c2;
    n[j] += c0; n[j + 1] += c1; n[j + 2] += c2;
    n[k] += c0; n[k + 1] += c1; n[k + 2] += c2;
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

// Neighbour lists from triangles: flat CSR { start, list }.
export function neighbours(tris, nv) {
  const sets = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) for (let a = 0; a < 3; a++) {
    const i = tris[t + a], j = tris[t + (a + 1) % 3];
    sets[i].add(j); sets[j].add(i);
  }
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Uint32Array(start[nv]);
  for (let i = 0; i < nv; i++) list.set([...sets[i]], start[i]);
  return { start, list };
}

// SNAP. `verts` (flat xyz, in the target's space) are moved toward `grid`'s surface in passes of
// decreasing smoothness. Per pass: each vertex in `include` finds its closest target point, kept
// only when it is within `maxDist` and that surface faces the same way as the vertex (dot >
// `minDot`: a lip does not grab the lip under it, a nostril wall not the cheek); the offsets are
// then spread by normalised convolution over the mesh -- `smooth` neighbour-averaging rounds of
// offset*weight and of weight, divided -- so excluded and rejected vertices (mouth bag, sockets,
// parts) move with what surrounds them and every pass is a smooth deformation. Big `smooth` first
// is the coarse fit, 1 at the end lands the skin on the surface. Returns a new Float32Array.
//
// THEN SMOOTH THE OFFSETS (`finish` rounds, Taubin -- see smoothOffsets). Snapped exactly, the
// skin takes every facet of a DECIMATED sculpt -- the creases between its flat triangles -- and the
// wireframe zigzags across flat stretches like the back of the neck: "ripples" a touch of the
// smooth brush took out (matt). Low-pass filtering the offsets from the input shape takes the
// facet imprint out and keeps the fit. Measured on a vertex-clustered caricature (2.6k verts),
// 8 rounds: neck zigzag 0.26 -> 0.14, and the skin sits CLOSER to the full-resolution sculpt the
// facets stood in for (neck 0.197 -> 0.152, all skin 0.115 -> 0.108). Plain averaging smoothed
// harder but shrank the fit off the surface (skin 0.115 -> 0.175 at 4 rounds); sliding vertices
// along the surface (relax + reproject) only took 10-15% off: the zigzag is the facets.
export function snapSurface(verts, tris, nb, include, grid, { passes = [32, 16, 8, 4, 2, 1, 1], maxDist = Infinity, minDot = 0.3, finish = 8, progress = null } = {}) {
  const nv = verts.length / 3, x = Float32Array.from(verts);
  let D = new Float32Array(nv * 3), W = new Float32Array(nv), D2 = new Float32Array(nv * 3), W2 = new Float32Array(nv);
  // Each vertex's last hit seeds its next query, and before it has one the previous vertex's does
  // (index order is mostly neighbours). Speed only: see closestOnGrid's hint.
  const last = new Int32Array(nv).fill(-1);
  let prev = -1;
  for (const [pass, smooth] of passes.entries()) {
    progress?.(pass / passes.length);
    const N = vertexNormals(tris, x);
    D.fill(0); W.fill(0);
    for (let i = 0; i < nv; i++) {
      if (!include[i]) continue;
      const p = [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
      const hit = closestOnGrid(grid, p, maxDist, last[i] >= 0 ? last[i] : prev);
      if (!hit) continue;
      last[i] = prev = hit.t;
      const tn = triNormal(grid, hit.t);
      if (tn[0] * N[i * 3] + tn[1] * N[i * 3 + 1] + tn[2] * N[i * 3 + 2] < minDot) continue;
      for (let k = 0; k < 3; k++) D[i * 3 + k] = hit.p[k] - p[k];
      W[i] = 1;
    }
    for (let s = 0; s < smooth; s++) {
      for (let i = 0; i < nv; i++) {
        let w = W[i], d0 = D[i * 3], d1 = D[i * 3 + 1], d2 = D[i * 3 + 2];
        const a = nb.start[i], b = nb.start[i + 1];
        for (let e = a; e < b; e++) { const j = nb.list[e]; w += W[j]; d0 += D[j * 3]; d1 += D[j * 3 + 1]; d2 += D[j * 3 + 2]; }
        const c = 1 / (b - a + 1);
        W2[i] = w * c; D2[i * 3] = d0 * c; D2[i * 3 + 1] = d1 * c; D2[i * 3 + 2] = d2 * c;
      }
      [D, D2] = [D2, D]; [W, W2] = [W2, W];
    }
    for (let i = 0; i < nv; i++) if (W[i] > 1e-6) for (let k = 0; k < 3; k++) x[i * 3 + k] += D[i * 3 + k] / W[i];
  }
  if (finish > 0) smoothOffsets(x, verts, nb, finish);
  return x;
}

// x = ref + (x - ref) low-pass filtered, `rounds` times, in place. TAUBIN (lambda/mu): each round
// one smoothing step and one slightly stronger un-smoothing step, so the fine ripple goes and the
// broad shape of the fit is NOT shrunk -- plain averaging flattened real curvature too (a bump on
// the harness sheet lost a third of its height).
const TAUBIN_L = 0.5, TAUBIN_M = -0.53;
export function smoothOffsets(x, ref, nb, rounds) {
  const nv = x.length / 3;
  let A = new Float32Array(nv * 3), B = new Float32Array(nv * 3);
  for (let q = 0; q < nv * 3; q++) A[q] = x[q] - ref[q];
  for (let r = 0; r < rounds * 2; r++) {
    const k = r % 2 ? TAUBIN_M : TAUBIN_L;
    for (let i = 0; i < nv; i++) {
      const a = nb.start[i], b = nb.start[i + 1];
      for (let c = 0; c < 3; c++) {
        if (b === a) { B[i * 3 + c] = A[i * 3 + c]; continue; }
        let s = 0;
        for (let e = a; e < b; e++) s += A[nb.list[e] * 3 + c];
        B[i * 3 + c] = A[i * 3 + c] + k * (s / (b - a) - A[i * 3 + c]);
      }
    }
    [A, B] = [B, A];
  }
  for (let q = 0; q < nv * 3; q++) x[q] = ref[q] + A[q];
}

// RELAX A REGION BACK TO ITS OWN SHAPE. Each vertex in `free` is re-solved (Gauss-Seidel, `iters`
// rounds) to sit at the average of its neighbours plus the offset it had from that average in
// `ref` (the uniform Laplacian of the reference): the region keeps its local shape -- its folds,
// its creases, which way each face points -- while everything outside it stays put and pulls it
// along. Used on the lips after a snap (TopoTransfer): the snap pulls neighbouring lip rows toward
// different bits of a fused target lip and folds them; relaxed, they keep GNM's own lip shape,
// seated where the snap put the skin round them.
export function relaxRegion(verts, ref, nb, free, iters = 100) {
  const x = Float32Array.from(verts), delta = new Float32Array(free.length * 3);
  free.forEach((i, f) => {
    const a = nb.start[i], b = nb.start[i + 1];
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let e = a; e < b; e++) s += ref[nb.list[e] * 3 + c];
      delta[f * 3 + c] = ref[i * 3 + c] - s / (b - a);
    }
  });
  for (let it = 0; it < iters; it++) {
    free.forEach((i, f) => {
      const a = nb.start[i], b = nb.start[i + 1];
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let e = a; e < b; e++) s += x[nb.list[e] * 3 + c];
        x[i * 3 + c] = s / (b - a) + delta[f * 3 + c];
      }
    });
  }
  return x;
}
