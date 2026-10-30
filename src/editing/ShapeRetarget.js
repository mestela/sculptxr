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

// UN-POSE (TopoPose.js): the neutral N of a sculpt made in a pose. `ref` is the template's neutral,
// `D` its pose (one composite offset), `wrapped` the posed template fitted onto the sculpt.
// First guess: the same transfer run backwards, the template's posed -> neutral change (-D)
// carried onto `wrapped`. The transfer is not exactly invertible (a turn through an uneven stretch
// does not undo), so that alone left the worst vertex 16% of the pose off on a test head. Then
// corrected toward what the app relies on, N + (D retargeted onto N) = `wrapped`: each round adds
// the round trip's miss to N. 16% -> 0.4% in 6 rounds. KEPT ONLY WHILE THEY HELP: on GNM the first
// guess already round-trips within 0.05 (head 48 tall) and the rounds then DIVERGE, x4 a round, at
// the lip seam's sliver triangles (area 7e-4), where a tiny change of N swings the transfer --
// 66 off by round 6. So the best N so far is kept, and a round that misses by more ends it.
// Returns { base: N, miss } (miss = the worst round-trip distance left).
const UNPOSE_ROUNDS = 6;
export function unpose(ref, D, wrapped, tris, nv) {
  const posed = ref.map((r, i) => r + D[i]);
  const first = retargetDelta(prepare(posed, wrapped, tris, nv), D.map((x) => -x));
  let N = Float32Array.from(wrapped, (w, i) => w + first[i]), best = null, bestMiss = Infinity;
  for (let k = 0; k <= UNPOSE_ROUNDS; k++) {
    const a = retargetDelta(prepare(ref, N, tris, nv), D);
    const r = new Float32Array(N.length);
    let miss = 0;
    for (let v = 0; v < nv; v++) {
      for (let x = 0; x < 3; x++) r[v * 3 + x] = wrapped[v * 3 + x] - N[v * 3 + x] - a[v * 3 + x];
      miss = Math.max(miss, Math.hypot(r[v * 3], r[v * 3 + 1], r[v * 3 + 2]));
    }
    if (miss >= bestMiss) break;
    best = N; bestMiss = miss;
    N = N.map((n, i) => n + r[i]);
  }
  return { base: best, miss: bestMiss };
}

// ── FIT PARTS (eyes, teeth, tongue) ─────────────────────────────────────────────────────────
//
// An eyeball or a row of teeth has to stay rigid: a Move stroke that pushes the lids wider
// squashes the eye, and a sculpted lid ring or jaw leaves the part where it was. Run before the
// retarget, on the Base.
//
// The parts are found, not picked: the separate pieces (connected components, the biggest one
// being the skin) that some shape moves whole, grouped by WHICH shapes move them -- the left
// eyeball and its cornea cap are one eye (the left eyeLooks), the lower teeth and tongue one jaw
// (jawOpen and friends). A piece no shape moves -- the upper teeth, fixed to the skull -- is its
// own part only if it sits against a moved one, so a hat or a prop is never touched.
//
// Each part's ring is the skin within PART_REACH of its radius from its surface on the old
// neutral: the lids, the lips and mouth bag. The part is rebuilt from its ORIGINAL rigid shape by
// the similarity (turn + uniform scale + move) that best takes the old ring to the new one. If
// the ring did not move, the fit is to the part's own vertices instead: a placement made with
// Transform is kept, and only a squash is undone. A deliberately sculpted part (fangs) is made
// rigid again too -- sculpt those after the retarget.
//
// Similarity, not affine: gaze is a rotation about the centre, which an oval eyeball breaks.
// Returns { base, parts } (base a new array, or null if nothing changed).
const PART_REACH = 0.2;    // ring reach from the part's surface, in part radii
const PART_MIN_RING = 6;   // fewer ring vertices than this -> fit to the part itself
const PART_WHOLE = 0.9;    // fraction of a piece a shape must move to count as moving it whole

// Rotation (row-major 3x3) best taking the centred points `a` onto `b` -- Horn's quaternion,
// fine with a flat set like a lid ring, where a 3x3 polar breaks down.
function bestRotation(S) {
  // S[r*3+c] = sum a_r b_c
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz];
  // Jacobi eigen-solve of the symmetric 4x4.
  const V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += N[p * 4 + q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      const apq = N[p * 4 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const th = (N[q * 4 + q] - N[p * 4 + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = N[k * 4 + p], akq = N[k * 4 + q];
        N[k * 4 + p] = c * akp - s * akq; N[k * 4 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = N[p * 4 + k], aqk = N[q * 4 + k];
        N[p * 4 + k] = c * apk - s * aqk; N[q * 4 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = V[k * 4 + p], vkq = V[k * 4 + q];
        V[k * 4 + p] = c * vkp - s * vkq; V[k * 4 + q] = s * vkp + c * vkq;
      }
    }
  }
  let m = 0;
  for (let k = 1; k < 4; k++) if (N[k * 5] > N[m * 5]) m = k;
  const w = V[m], x = V[4 + m], y = V[8 + m], z = V[12 + m];
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}

// Similarity taking the `idx` vertices of `src` onto those of `dst`: p -> s R (p - ms) + md.
export function similarity(src, dst, idx) {
  const ms = [0, 0, 0], md = [0, 0, 0];
  for (const v of idx) for (let k = 0; k < 3; k++) { ms[k] += src[v * 3 + k]; md[k] += dst[v * 3 + k]; }
  for (let k = 0; k < 3; k++) { ms[k] /= idx.length; md[k] /= idx.length; }
  const S = new Array(9).fill(0);
  let ss = 0;
  for (const v of idx) {
    const a = [src[v * 3] - ms[0], src[v * 3 + 1] - ms[1], src[v * 3 + 2] - ms[2]];
    const b = [dst[v * 3] - md[0], dst[v * 3 + 1] - md[1], dst[v * 3 + 2] - md[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += a[r] * b[c];
    ss += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  }
  const R = bestRotation(S);
  // s = sum b . R a / sum |a|^2 = tr(R S) for this S layout.
  let tr = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += R[r * 3 + c] * S[c * 3 + r];
  return { R, s: ss > 0 ? tr / ss : 1, ms, md };
}

// Connected components (arrays of vertex indices), biggest first: on a head the first is the skin.
export function components(tris, nv) {
  const up = new Int32Array(nv);
  for (let v = 0; v < nv; v++) up[v] = v;
  const find = (v) => { while (up[v] !== v) { up[v] = up[up[v]]; v = up[v]; } return v; };
  for (let t = 0; t < tris.length; t += 3) {
    const a = find(tris[t]);
    for (let k = 1; k < 3; k++) { const b = find(tris[t + k]); if (b !== a) up[b] = a; }
  }
  const byRoot = new Map();
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    let c = byRoot.get(r);
    if (!c) byRoot.set(r, c = []);
    c.push(v);
  }
  return [...byRoot.values()].sort((a, b) => b.length - a.length);
}

// `self`: fit every part to its own vertices, never to the ring -- the part stays where it is, only
// rebuilt rigid (Topo Transfer's Wrap/Snap/Un-pose already placed it, and Un-pose bends an eyeball).
export function fitParts(ref, target, tris, nv, shapes, { self = false } = {}) {
  const comps = components(tris, nv).slice(1);
  if (!comps.length) return { base: null, parts: [] };

  const bounds = (idx) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of idx) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], ref[v * 3 + k]); hi[k] = Math.max(hi[k], ref[v * 3 + k]); }
    return { lo, hi, r: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
  };

  // Pieces grouped by the shapes that move them whole; unmoved pieces kept aside.
  const groups = new Map(), still = [];
  for (const verts of comps) {
    const sig = [];
    for (const [name, d] of shapes) {
      let moved = 0;
      for (const v of verts) if (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0) moved++;
      if (moved >= PART_WHOLE * verts.length) sig.push(name);
    }
    if (!sig.length) { still.push(verts); continue; }
    const key = sig.join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...verts);
  }
  if (!groups.size) return { base: null, parts: [] };
  // An unmoved piece against a moved group (its bounds within that group's radius) is a part --
  // and every unmoved piece against the SAME group is the same part, fitted once. The upper
  // teeth are a dozen pieces plus the gum: fitted one by one, each tooth took its own turn and
  // scale from the few lip vertices near it (or none, and stayed put while the gum moved), and
  // which of the two a tooth got could differ left to right, so a symmetric face got lopsided teeth.
  const movedKeys = [...groups.keys()];
  const moved = [...groups.values()].map(bounds);
  for (const verts of still) {
    const b = bounds(verts);
    const g = moved.findIndex((m) => [0, 1, 2].every((k) => b.lo[k] <= m.hi[k] + m.r && b.hi[k] >= m.lo[k] - m.r));
    if (g < 0) continue;
    const key = `fixed by ${movedKeys[g]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...verts);
  }
  const inPart = new Uint8Array(nv);
  for (const E of groups.values()) for (const v of E) inPart[v] = 1;

  const out = Float32Array.from(target);
  const parts = [];
  let changed = false;
  for (const [key, E] of groups) {
    // Ring: skin within `reach` of the part's surface, by a grid over the part's vertices.
    const { r } = bounds(E);
    const reach = PART_REACH * r, cell = new Map(), key3 = (x, y, z) => `${x},${y},${z}`;
    for (const v of E) {
      const h = key3(Math.floor(ref[v * 3] / reach), Math.floor(ref[v * 3 + 1] / reach), Math.floor(ref[v * 3 + 2] / reach));
      let c = cell.get(h);
      if (!c) cell.set(h, c = []);
      c.push(v);
    }
    const ring = [];
    for (let v = 0; v < nv; v++) {
      if (inPart[v]) continue;
      const x = ref[v * 3], y = ref[v * 3 + 1], z = ref[v * 3 + 2];
      const cx = Math.floor(x / reach), cy = Math.floor(y / reach), cz = Math.floor(z / reach);
      let hit = false;
      for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) for (let l = -1; l <= 1 && !hit; l++) {
        const c = cell.get(key3(cx + i, cy + j, cz + l));
        if (c) for (const u of c) if (Math.hypot(ref[u * 3] - x, ref[u * 3 + 1] - y, ref[u * 3 + 2] - z) < reach) { hit = true; break; }
      }
      if (hit) ring.push(v);
    }
    const movedMax = (idx) => {
      let m = 0;
      for (const v of idx) m = Math.max(m, Math.hypot(target[v * 3] - ref[v * 3], target[v * 3 + 1] - ref[v * 3 + 1], target[v * 3 + 2] - ref[v * 3 + 2]));
      return m;
    };
    const lidsMoved = !self && ring.length >= PART_MIN_RING && movedMax(ring) > 1e-4 * r;
    if (!lidsMoved && movedMax(E) <= 1e-6 * r) { parts.push({ key, verts: E.length, ring: ring.length, by: 'unchanged', scale: 1 }); continue; }
    const { R, s, ms, md } = similarity(ref, target, lidsMoved ? ring : E);
    for (const v of E) {
      const a = [ref[v * 3] - ms[0], ref[v * 3 + 1] - ms[1], ref[v * 3 + 2] - ms[2]];
      for (let k = 0; k < 3; k++) out[v * 3 + k] = s * (R[k * 3] * a[0] + R[k * 3 + 1] * a[1] + R[k * 3 + 2] * a[2]) + md[k];
    }
    changed = true;
    parts.push({ key, verts: E.length, ring: ring.length, by: lidsMoved ? 'ring' : 'self', scale: s });
  }
  return { base: changed ? out : null, parts };
}

// SMOOTH A SHAPE: GNM's shapes come with per-vertex jitter (pucker's roughest 5% of vertices sit
// 7% of its peak off their neighbours' average; funnel and rollLower 10-11%) -- matt: "if i had
// manually sculpted them i would have run a smooth over most of them". `rounds` of TAUBIN smoothing
// (lambda/mu, so the shape does not shrink) on the offset `d` (flat xyz, in place), over the
// vertices in `free` only (Uint8Array): everything else holds, so a shape never spreads past the
// skin it moved, and rigid parts (eyes, teeth) are left out by the caller. `nb`: TopoWrap.neighbours.
const SMOOTH_L = 0.5, SMOOTH_M = -0.53;
export function smoothShape(d, nb, free, rounds) {
  const idx = [];
  for (let v = 0; v < free.length; v++) if (free[v]) idx.push(v);
  const B = new Float32Array(idx.length * 3);
  for (let r = 0; r < rounds * 2; r++) {
    const k = r % 2 ? SMOOTH_M : SMOOTH_L;
    idx.forEach((v, i) => {
      const a = nb.start[v], b = nb.start[v + 1];
      for (let c = 0; c < 3; c++) {
        if (b === a) { B[i * 3 + c] = d[v * 3 + c]; continue; }
        let s = 0;
        for (let e = a; e < b; e++) s += d[nb.list[e] * 3 + c];
        B[i * 3 + c] = d[v * 3 + c] + k * (s / (b - a) - d[v * 3 + c]);
      }
    });
    idx.forEach((v, i) => { d[v * 3] = B[i * 3]; d[v * 3 + 1] = B[i * 3 + 1]; d[v * 3 + 2] = B[i * 3 + 2]; });
  }
  return d;
}

