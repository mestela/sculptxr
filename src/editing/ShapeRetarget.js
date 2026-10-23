/**
 * RETARGET SHAPES — rebuild every blendshape for a neutral that has been sculpted.
 *
 * A shape is stored as an offset per vertex, so sculpting the Base under it leaves each offset
 * pointing the way it did on the OLD face and at the old size: a head made 1.4x wider still wears
 * the original smile, and a turned eyelid still closes along the old direction.
 *
 * DEFORMATION TRANSFER (Sumner & Popovic 2004), same topology so every triangle corresponds to
 * itself. For each triangle the shape's local change on the old neutral is a 3x3 matrix Q
 * (rest edges + scaled normal -> shaped edges + normal). The new shape is the one whose edges are
 * Q applied to the NEW neutral's edges, in the least-squares sense over every edge: a Poisson
 * solve per shape and axis.
 *
 * Solved for the OFFSET d (new shape = target + d), and only over the vertices the shape moves:
 * a vertex the shape leaves alone stays at 0, which both pins the solve and keeps the result as
 * sparse as the source. A weak pull (LAMBDA) toward the source offset settles what edges cannot
 * see -- the translation of a part with no fixed vertex, like an eyeball turning in its socket.
 * With the target equal to the old neutral the answer is the source offset exactly.
 *
 * Pure maths, no app imports.
 */

const TRI_INDEX = 4294967295;
// Pull toward the source offset, relative to one edge's weight. Small enough not to fight the
// edges on connected skin, large enough to anchor a floating part.
const LAMBDA = 1e-3;
const MAX_ITERS = 3000;
const TOL = 1e-7;   // relative residual

// 3x3 helpers on row-major arrays.
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-20) return null;
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}

// Columns: e1, e2, and the normal scaled by 1/sqrt(|e1 x e2|) (the paper's fourth vertex), so a
// change of area shows up as a change along the normal too.
function frame(P, a, b, c) {
  const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
  const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const s = 1 / Math.sqrt(Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
  nx *= s; ny *= s; nz *= s;
  return [e1x, e2x, nx, e1y, e2y, ny, e1z, e2z, nz];
}

// The rotation part of A (Higham's iteration R <- (R + R^-T) / 2). Null if A is degenerate.
function polar(A) {
  let R = A.slice();
  for (let it = 0; it < 30; it++) {
    const I = inv3(R);
    if (!I) return null;
    const N = [0.5 * (R[0] + I[0]), 0.5 * (R[1] + I[3]), 0.5 * (R[2] + I[6]),
      0.5 * (R[3] + I[1]), 0.5 * (R[4] + I[4]), 0.5 * (R[5] + I[7]),
      0.5 * (R[6] + I[2]), 0.5 * (R[7] + I[5]), 0.5 * (R[8] + I[8])];
    let e = 0;
    for (let k = 0; k < 9; k++) e = Math.max(e, Math.abs(N[k] - R[k]));
    R = N;
    if (e < 1e-9) break;
  }
  return R;
}

// Triangles of a sculptgl face array (quads as two triangles).
export function triangles(faces, nbFaces) {
  const out = [];
  for (let f = 0; f < nbFaces; f++) {
    const a = faces[f * 4], b = faces[f * 4 + 1], c = faces[f * 4 + 2], d = faces[f * 4 + 3];
    out.push(a, b, c);
    if (d !== TRI_INDEX) out.push(a, c, d);
  }
  return Uint32Array.from(out);
}

// What every shape shares: the triangles, each one's inverse rest frame on the OLD neutral, the
// rotation that takes it to the NEW neutral, and the vertex -> triangle lists. `ref` = the
// neutral the shapes were made on, `target` = the new one.
//
// THE ROTATION: plain deformation transfer applies the shape's change in WORLD axes, so a part
// sculpted to a new angle (a tilted eyelid, a jaw line swung forward) kept moving the old way --
// measured on a test sphere turned 90 deg: 48% of the shape wrong. Each triangle's change is
// carried into its new orientation instead (G -> Rot G Rot^T), Rot being the rotation part of the
// old -> new triangle change. Size and shear are still taken from the new edges as before.
export function prepare(ref, target, tris, nv) {
  const nt = tris.length / 3;
  const invRest = new Array(nt), rot = new Array(nt);
  const count = new Uint32Array(nv + 1);
  // Per vertex, the old -> new change of the triangles around it (averaged): what the weak pull
  // carries the source offset through. A part with no fixed vertex (the lower teeth in jawOpen,
  // an eyeball) takes its TRANSLATION from that pull alone; pulling toward the raw offset left
  // jawOpen 12% short on a head scaled 1.3x.
  const vM = new Float64Array(nv * 9), vN = new Uint32Array(nv);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const R = inv3(frame(ref, a, b, c));
    invRest[t] = R;
    if (R) {
      const F = frame(target, a, b, c), M = new Array(9);
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) M[r * 3 + q] = F[r * 3] * R[q] + F[r * 3 + 1] * R[3 + q] + F[r * 3 + 2] * R[6 + q];
      rot[t] = polar(M);
      for (const v of [a, b, c]) { for (let k = 0; k < 9; k++) vM[v * 9 + k] += M[k]; vN[v]++; }
    }
    for (let k = 0; k < 3; k++) count[tris[t * 3 + k] + 1]++;
  }
  for (let v = 0; v < nv; v++) {
    if (vN[v]) for (let k = 0; k < 9; k++) vM[v * 9 + k] /= vN[v];
    else { vM[v * 9] = vM[v * 9 + 4] = vM[v * 9 + 8] = 1; }
  }
  for (let v = 0; v < nv; v++) count[v + 1] += count[v];
  const vt = new Uint32Array(count[nv]), fill = count.slice(0, nv);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[fill[tris[t * 3 + k]]++] = t;
  return { ref, target, tris, nv, invRest, rot, vM, vtStart: count, vt };
}

// One shape: `d` is the offset made on `ref`; returns the offset for `target` (a new array).
export function retargetDelta(P, d) {
  const { ref, target, tris, nv, invRest, rot, vM, vtStart, vt } = P;
  const out = new Float32Array(d.length);

  // Unknowns: the vertices this shape moves.
  const slot = new Int32Array(nv).fill(-1), U = [];
  for (let v = 0; v < nv; v++) {
    if (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0) { slot[v] = U.length; U.push(v); }
  }
  const n = U.length;
  if (!n) return out;

  // Triangles touching an unknown, each once.
  const seen = new Uint8Array(tris.length / 3), T = [];
  for (const v of U) for (let k = vtStart[v]; k < vtStart[v + 1]; k++) {
    const t = vt[k];
    if (!seen[t] && invRest[t]) { seen[t] = 1; T.push(t); }
  }

  const shaped = (i) => [ref[i * 3] + d[i * 3], ref[i * 3 + 1] + d[i * 3 + 1], ref[i * 3 + 2] + d[i * 3 + 2]];
  const diag = new Float64Array(n);
  const rhs = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const edges = new Map();   // i*n+j (i<j, slots) -> weight
  const S = new Float64Array(9), G = new Float64Array(9);
  for (const t of T) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const pa = shaped(a), pb = shaped(b), pc = shaped(c);
    const F = frame([...pa, ...pb, ...pc], 0, 1, 2);
    const R = invRest[t];
    // G = F R^-1 - I: how the triangle's change acts on an edge, minus the edge itself.
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
      G[r * 3 + q] = F[r * 3] * R[q] + F[r * 3 + 1] * R[3 + q] + F[r * 3 + 2] * R[6 + q] - (r === q ? 1 : 0);
    }
    // ...turned into the triangle's new orientation: S = Rot G Rot^T.
    const Q = rot[t];
    if (Q) {
      const M = new Float64Array(9);
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) M[r * 3 + q] = Q[r * 3] * G[q] + Q[r * 3 + 1] * G[3 + q] + Q[r * 3 + 2] * G[6 + q];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) S[r * 3 + q] = M[r * 3] * Q[q * 3] + M[r * 3 + 1] * Q[q * 3 + 1] + M[r * 3 + 2] * Q[q * 3 + 2];
    } else S.set(G);
    for (const [i, j] of [[a, b], [a, c], [b, c]]) {
      const fx = target[j * 3] - target[i * 3], fy = target[j * 3 + 1] - target[i * 3 + 1], fz = target[j * 3 + 2] - target[i * 3 + 2];
      // Edge equation d_j - d_i = G f.
      const g = [S[0] * fx + S[1] * fy + S[2] * fz, S[3] * fx + S[4] * fy + S[5] * fz, S[6] * fx + S[7] * fy + S[8] * fz];
      const si = slot[i], sj = slot[j];
      if (si >= 0) { diag[si] += 1; for (let x = 0; x < 3; x++) rhs[x][si] -= g[x]; }
      if (sj >= 0) { diag[sj] += 1; for (let x = 0; x < 3; x++) rhs[x][sj] += g[x]; }
      if (si >= 0 && sj >= 0) {
        const key = si < sj ? si * n + sj : sj * n + si;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
  }
  // The weak pull, toward the source offset carried through the local old -> new change. Also
  // the CG's starting point.
  const prior = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let s = 0; s < n; s++) {
    const v = U[s], o = v * 9, dx = d[v * 3], dy = d[v * 3 + 1], dz = d[v * 3 + 2];
    diag[s] += LAMBDA;
    for (let x = 0; x < 3; x++) {
      prior[x][s] = vM[o + x * 3] * dx + vM[o + x * 3 + 1] * dy + vM[o + x * 3 + 2] * dz;
      rhs[x][s] += LAMBDA * prior[x][s];
    }
  }
  const ne = edges.size, ei = new Uint32Array(ne), ej = new Uint32Array(ne), ew = new Float64Array(ne);
  let k = 0;
  for (const [key, w] of edges) { ei[k] = Math.floor(key / n); ej[k] = key % n; ew[k] = w; k++; }

  const mul = (x, y) => {
    for (let s = 0; s < n; s++) y[s] = diag[s] * x[s];
    for (let e = 0; e < ne; e++) { const i = ei[e], j = ej[e], w = ew[e]; y[i] -= w * x[j]; y[j] -= w * x[i]; }
  };

  // Jacobi-preconditioned CG per axis, warm-started at the prior (usually close).
  const x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  for (let ax = 0; ax < 3; ax++) {
    const b = rhs[ax];
    x.set(prior[ax]);
    mul(x, Ap);
    let bb = 0, rz = 0;
    for (let s = 0; s < n; s++) { r[s] = b[s] - Ap[s]; z[s] = r[s] / diag[s]; p[s] = z[s]; rz += r[s] * z[s]; bb += b[s] * b[s]; }
    const stop = TOL * TOL * (bb || 1);
    for (let it = 0; it < MAX_ITERS; it++) {
      let rr = 0;
      for (let s = 0; s < n; s++) rr += r[s] * r[s];
      if (rr <= stop) break;
      mul(p, Ap);
      let pAp = 0;
      for (let s = 0; s < n; s++) pAp += p[s] * Ap[s];
      if (!(pAp > 0)) break;
      const al = rz / pAp;
      let rz2 = 0;
      for (let s = 0; s < n; s++) { x[s] += al * p[s]; r[s] -= al * Ap[s]; z[s] = r[s] / diag[s]; rz2 += r[s] * z[s]; }
      const be = rz2 / rz;
      rz = rz2;
      for (let s = 0; s < n; s++) p[s] = z[s] + be * p[s];
    }
    for (let s = 0; s < n; s++) out[U[s] * 3 + ax] = x[s];
  }
  return out;
}
