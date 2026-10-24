// EYELIDS RIDE ON THE EYES. A blink mixed with a look up, a squint on a turned eye: the shapes were
// each sculpted on a still eye, so their mix pushes the lid into the eyeball and the eye shows
// through. This pushes the lid back out, after the blend and before the skin pass.
//
// DISPLAY ONLY. The push is kept on the track (AnimationRegistry.applyBlendshapes) and the sculpt
// capture subtracts it again (otherLayersOffset), so a stroke never bakes it into a shape.
//
// The eye's surface is a cube map of its radius round its centre, built once from the rest
// shape, so the cornea bulge counts and an oval eye is fine. Each frame the eye's motion (a look)
// is a similarity fitted to its own vertices, and the lids are tested in the eye's rest frame.
//
// Three things, all in the eye's rest frame:
//  PUSH OUT: a lid in the eye goes back to the clearance it had at rest (down to CLEAR), eased on
//    over a soft zone never wider than that clearance.
//  SUCK ON: a lid that hugged the eye at rest and was lifted off it goes back onto it, so lids
//    track the eye (the cornea bulge as the eye turns) instead of floating. Only lids that hugged
//    (rest gap under CONFORM_IN, fading to none at CONFORM_OUT), and a lift past LET_GO is taken
//    as meant and left alone.
//  LIDS MEET: an upper lid never goes below the lower lid's edge, so an overdriven blink closes
//    on the lower lid instead of passing it. Upper/lower are split, per azimuth band across the
//    eye, at the widest elevation gap among the lids at rest -- the opening. ONLY a lid passing
//    BEHIND or through the lower lid is turned back: one hanging IN FRONT of it (lifted off its
//    own rest seat, brow down over a squint) is a fold and is left there, just kept clear of it. Turning a fold up above the lower
//    lid's edge lifted the whole upper lid and opened the eye (square_anim_eyes, frames 26-35).
//
// A LID NEVER MOVES AT REST: every rule above is measured from the rest pose.
import { components, similarity } from './ShapeRetarget.js';
import { GNM_VERTS, GNM_LIDS } from './gnmLids.js';

// The known lids for this mesh, or null: GNM's (gnmLids.js) when it has GNM's vertex count AND every
// step along both lid loops is an edge of it -- a count alone could be any mesh.
export function knownLids(tris, nv) {
  if (nv !== GNM_VERTS) return null;
  const edges = new Set();
  for (let t = 0; t < tris.length; t += 3) for (let a = 0; a < 3; a++) {
    const i = tris[t + a], j = tris[t + (a + 1) % 3];
    edges.add(i < j ? i * nv + j : j * nv + i);
  }
  const chain = (loop) => loop.every((v, k) => k === 0 || edges.has(Math.min(v, loop[k - 1]) * nv + Math.max(v, loop[k - 1])));
  return GNM_LIDS.every((l) => chain(l.upper) && chain(l.lower)) ? GNM_LIDS : null;
}

const N = 16;           // cube-map cells per face edge
const BAND = 0.5;       // lid candidates: rest clearance within this many eye radii
const CLEAR = 0.02;     // clearance a lid is pushed to, in eye radii (a lid edge chords the eye)
const SOFT = 0.1;       // soft contact zone, in eye radii
const WHOLE = 0.9;      // fraction of a piece an eyeLook shape must move to make it an eye
const CONFORM_IN = 0.05, CONFORM_OUT = 0.25;   // rest gap (eye radii): fully sucked on below, not at all above
const LET_GO_IN = 0.2, LET_GO_OUT = 0.4;       // lifted this far past its rest gap (eye radii): left alone
const AZ = 1.4;         // lids meet across the front of the eye only, +-80 deg of azimuth
const NB = 24;          // azimuth bands for the lid edges
const THICK = 0.05;     // lid thickness, in eye radii: an upper lid this far in front of the lower one is over it
const CARRY_DEFAULT = 0.8;   // known lids: an edge's move is carried this far up its lid (eye radii, at rest)

// Each rule on its own, for diagnosis from the console (import EyeCollide.js, flip, recomposite).
// `share`: how much of a crossing the upper lid takes (the lower takes the rest); `carry`: how far
// up the lid an edge's move reaches, in eye radii (read when the eyes are built).
export const rules = { push: true, suck: true, meet: true, share: 0.5, carry: CARRY_DEFAULT };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Azimuth across the eye and elevation of a direction in the eye frame (F forward, U up, S side).
let AA = 0, EE = 0;
function angles(eye, x, y, z) {
  const { F, U, S } = eye;
  const f = x * F[0] + y * F[1] + z * F[2], u = x * U[0] + y * U[1] + z * U[2], w = x * S[0] + y * S[1] + z * S[2];
  AA = Math.atan2(w, f); EE = Math.atan2(u, Math.sqrt(f * f + w * w));
}

// The lower lid's edge (highest elevation) at an azimuth, linear between bands; -Infinity where
// no lower lid vertex is. The same over `edge` and `egap` (the edge's clearance off the eye).
let EG = 0;
function edgeAt(edge, a, egap) {
  const b = (a + AZ) / (2 * AZ) * NB - 0.5;
  const i = Math.min(NB - 1, Math.max(0, Math.floor(b))), j = Math.min(NB - 1, i + 1), t = Math.min(1, Math.max(0, b - i));
  const p = edge[i], q = edge[j];
  // Past the last band with an edge in it there is no edge (beside the eye's corners): the nearest
  // band decides. Carrying the end band on put skin beside the corner "below the edge".
  if (p === -Infinity || q === -Infinity) {
    const near = t < 0.5 ? p : q;
    if (egap) EG = near === -Infinity ? 0 : egap[t < 0.5 ? i : j];
    return near === -Infinity ? -Infinity : near;
  }
  if (egap) EG = egap[i] + (egap[j] - egap[i]) * t;
  return p + (q - p) * t;
}
function lowerEdge(eye, P, out, egap) {
  out.fill(-Infinity);
  const { side, edgeLo } = eye, at = new Int32Array(NB).fill(-1);
  for (let n = 0; n < side.length; n++) {
    if (side[n] !== -1 || (edgeLo && !edgeLo[n])) continue;
    angles(eye, P[n * 3], P[n * 3 + 1], P[n * 3 + 2]);
    if (Math.abs(AA) >= AZ) continue;
    const b = Math.min(NB - 1, Math.floor((AA + AZ) / (2 * AZ) * NB));
    if (EE > out[b]) { out[b] = EE; at[b] = n; }
  }
  if (egap) for (let b = 0; b < NB; b++) {
    const n = at[b];
    if (n < 0) { egap[b] = 0; continue; }
    const x = P[n * 3], y = P[n * 3 + 1], z = P[n * 3 + 2];
    egap[b] = Math.sqrt(x * x + y * y + z * z) - radius(eye.grid, x, y, z);
  }
  // A band the edge's vertices skipped reads the row below as the edge, a notch the upper lid then
  // dips into: a band below both neighbours is raised to the lower of them.
  for (let b = 1; b < NB - 1; b++) {
    const k = out[b - 1] < out[b + 1] ? b - 1 : b + 1;
    if (out[b] < out[k]) { out[b] = out[k]; if (egap) egap[b] = egap[k]; }
  }
  return out;
}

// Cube-map cell of a direction: face (axis*2 + negative) and its two in-face coordinates in [-1, 1],
// into CF / CU / CW (no array: this runs per lid vertex per frame).
let CF = 0, CU = 0, CW = 0;
function cube(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) { CF = x < 0 ? 1 : 0; CU = y / ax; CW = z / ax; }
  else if (ay >= az) { CF = y < 0 ? 3 : 2; CU = x / ay; CW = z / ay; }
  else { CF = z < 0 ? 5 : 4; CU = x / az; CW = y / az; }
}

// The map stores the radius at cell CORNERS, (N+1)^2 per face, each ray-cast along its own
// direction. A corner on a seam is the same direction from both faces, so it has the same value
// and the lookup is continuous across faces. (Cell centres clamped at the face edge disagreed by
// up to ~0.2% of the radius across a seam: a lid crossing one popped.)
const M = N + 1;
function cornerDir(f, i, j) {
  const u = i / N * 2 - 1, w = j / N * 2 - 1, s = f & 1 ? -1 : 1, a = f >> 1;
  const d = a === 0 ? [s, u, w] : a === 1 ? [u, s, w] : [u, w, s], l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

// Eye radius along a direction, bilinear over the corners. A corner whose ray missed (0: a hole
// in the eye mesh) is left out and the rest renormalised -- blending it in read the eye as SMALLER
// there, and suck-on then pulled the lid into it. 0 when every corner missed (no collision).
function radius(grid, x, y, z) {
  cube(x, y, z);
  const fx = Math.min(N, Math.max(0, (CU + 1) / 2 * N)), fy = Math.min(N, Math.max(0, (CW + 1) / 2 * N));
  const i = Math.min(N - 1, fx | 0), j = Math.min(N - 1, fy | 0), a = fx - i, b = fy - j, o = CF * M * M + i * M + j;
  const c00 = grid[o], c01 = grid[o + 1], c10 = grid[o + M], c11 = grid[o + M + 1];
  if (c00 > 0 && c01 > 0 && c10 > 0 && c11 > 0) return (c00 * (1 - b) + c01 * b) * (1 - a) + (c10 * (1 - b) + c11 * b) * a;
  let sum = 0, w = 0;
  if (c00 > 0) { const k = (1 - a) * (1 - b); sum += c00 * k; w += k; }
  if (c01 > 0) { const k = (1 - a) * b; sum += c01 * k; w += k; }
  if (c10 > 0) { const k = a * (1 - b); sum += c10 * k; w += k; }
  if (c11 > 0) { const k = a * b; sum += c11 * k; w += k; }
  return w > 1e-6 ? sum / w : 0;
}

// Furthest hit of the ray c + t d over the listed triangles (Moller-Trumbore); 0 for a miss.
function farHit(P, tris, list, c, d) {
  let best = 0;
  for (const t of list) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, e = tris[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[e] - P[a], e2y = P[e + 1] - P[a + 1], e2z = P[e + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-20) continue;
    const sx = c[0] - P[a], sy = c[1] - P[a + 1], sz = c[2] - P[a + 2];
    const u = (sx * px + sy * py + sz * pz) / det;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
    if (v < -1e-6 || u + v > 1 + 1e-6) continue;
    const h = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (h > best) best = h;
  }
  return best;
}

// Ray-cast every corner. Triangles are binned by the cells their corners fall in (one cell of
// slack), so each ray tests a handful; one that spans faces is tested by every ray on them.
function castGrid(P, tris, c) {
  const bins = Array.from({ length: 6 * N * N }, () => []), span = Array.from({ length: 6 }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    let f0 = -1, lo = [N, N], hi = [-1, -1], same = true;
    const faces = new Set();
    for (let k = 0; k < 3; k++) {
      const v = tris[t + k] * 3;
      cube(P[v] - c[0], P[v + 1] - c[1], P[v + 2] - c[2]);
      faces.add(CF);
      if (f0 < 0) f0 = CF; else if (CF !== f0) same = false;
      const i = Math.floor((CU + 1) / 2 * N), j = Math.floor((CW + 1) / 2 * N);
      lo = [Math.min(lo[0], i), Math.min(lo[1], j)]; hi = [Math.max(hi[0], i), Math.max(hi[1], j)];
    }
    if (!same) { for (const f of faces) span[f].push(t); continue; }
    for (let i = Math.max(0, lo[0] - 1); i <= Math.min(N - 1, hi[0] + 1); i++)
      for (let j = Math.max(0, lo[1] - 1); j <= Math.min(N - 1, hi[1] + 1); j++) bins[f0 * N * N + i * N + j].push(t);
  }
  const grid = new Float32Array(6 * M * M), all = [];
  for (let t = 0; t < tris.length; t += 3) all.push(t);
  for (let f = 0; f < 6; f++) for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    // A seam corner is a corner of the neighbouring face too, whose triangles are binned there:
    // it tests them all (a few hundred rays).
    let list = all;
    if (i > 0 && j > 0 && i < N && j < N) {
      list = new Set(span[f]);
      for (const ii of [i - 1, i]) for (const jj of [j - 1, j]) for (const t of bins[f * N * N + ii * N + jj]) list.add(t);
    }
    grid[f * M * M + i * M + j] = farHit(P, tris, list, c, cornerDir(f, i, j));
  }
  return grid;
}

// Sum of the base positions an eye state was built from: changes when the eyes or lids are sculpted.
export function eyeSum(state, base) {
  let s = 0;
  for (const eye of state.eyes) {
    for (const v of eye.idx) s += base[v * 3] + base[v * 3 + 1] * 1.3 + base[v * 3 + 2] * 1.7;
    for (const v of eye.lids) s += base[v * 3] + base[v * 3 + 1] * 1.3 + base[v * 3 + 2] * 1.7;
  }
  return s;
}

// Upper (1) / lower (-1) / neither (0) per lid, and each upper lid's rest headroom over the lower
// edge (negative where they already touch at rest, at the corners, so rest never moves).
// Frame: up is the mesh's +Y, forward the mean direction to the hugging lids.
function sides(eye, base, tris) {
  const { c, r, lids, gap, rig } = eye, n = lids.length;
  const P = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) P[k * 3 + a] = base[lids[k] * 3 + a] - c[a];
  const U = [0, 1, 0], F = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    if (gap[k] > CONFORM_OUT * r) continue;
    const l = Math.hypot(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]) || 1;
    F[0] += P[k * 3] / l; F[2] += P[k * 3 + 2] / l;
  }
  let l = Math.hypot(F[0], F[2]);
  if (l < 1e-9) { F[2] = 1; l = 1; }
  F[0] /= l; F[2] /= l;
  eye.U = U; eye.F = F; eye.S = [U[1] * F[2] - U[2] * F[1], U[2] * F[0] - U[0] * F[2], U[0] * F[1] - U[1] * F[0]];

  // The opening per band: the widest elevation gap among the hugging lids.
  const bands = Array.from({ length: NB }, () => []);
  const az = new Float32Array(n), el = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    angles(eye, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    az[k] = AA; el[k] = EE;
    if (Math.abs(AA) < AZ && gap[k] <= CONFORM_OUT * r) bands[Math.min(NB - 1, Math.floor((AA + AZ) / (2 * AZ) * NB))].push(EE);
  }
  const split = bands.map((es) => {
    if (es.length < 4) return null;
    es.sort((a, b) => a - b);
    let best = 0, at = null;
    for (let k = 1; k < es.length; k++) if (es[k] - es[k - 1] > best) { best = es[k] - es[k - 1]; at = (es[k] + es[k - 1]) / 2; }
    return best > 0.15 ? at : null;
  });
  const ok = split.filter((x) => x !== null).sort((a, b) => a - b);
  const mid = ok.length ? ok[ok.length >> 1] : 0;
  eye.side = new Int8Array(n);
  if (rig) {
    // KNOWN EDGES: each lid vertex goes with the loop it is fewer edges from (a walk over the lid
    // vertices only), and the lower edge is read off the lower loop alone -- a cheek bulging up
    // in a squint is not the lid's edge. Corners belong to both loops and count as lower.
    const local = new Map();
    for (let k = 0; k < n; k++) local.set(lids[k], k);
    const adj = Array.from({ length: n }, () => []);
    for (let t = 0; t < tris.length; t += 3) for (let a = 0; a < 3; a++) {
      const i = local.get(tris[t + a]), j = local.get(tris[t + (a + 1) % 3]);
      if (i !== undefined && j !== undefined) { adj[i].push(j); adj[j].push(i); }
    }
    let front = [];
    eye.edgeLo = new Uint8Array(n);
    eye.inner = new Uint8Array(n);
    const onLoop = new Set([...rig.upper, ...rig.lower]);
    for (const v of rig.socket) { const k = local.get(v); if (k !== undefined && !onLoop.has(v)) eye.inner[k] = 1; }
    eye.src = new Int32Array(n).fill(-1);
    for (const v of rig.upper) { const k = local.get(v); if (k !== undefined && !eye.side[k]) { eye.side[k] = 1; eye.src[k] = k; front.push(k); } }
    eye.edgeUp = new Uint8Array(n);
    for (const v of rig.upper) { const k = local.get(v); if (k !== undefined) eye.edgeUp[k] = 1; }
    for (const v of rig.lower) {
      const k = local.get(v);
      if (k === undefined) continue;
      eye.edgeLo[k] = 1; eye.edgeUp[k] = 0;   // a corner is on both loops: it goes with the lower
      eye.src[k] = k;
      if (eye.side[k] !== -1) { eye.side[k] = -1; front.push(k); }
    }
    while (front.length) {
      const next = [];
      for (const k of front) for (const j of adj[k]) if (!eye.side[j]) { eye.side[j] = eye.side[k]; eye.src[j] = eye.src[k]; next.push(j); }
      front = next;
    }
    // How much of its upper edge's rise each upper lid vertex takes: all of it at the edge, none
    // rules.carry eye radii up the lid (rest distance to the edge vertex its walk came from).
    eye.carry = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const e = eye.src[k];
      if (e < 0) continue;
      const dist = Math.hypot(P[k * 3] - P[e * 3], P[k * 3 + 1] - P[e * 3 + 1], P[k * 3 + 2] - P[e * 3 + 2]);
      eye.carry[k] = 1 - smooth(0, rules.carry * r, dist);
    }
    eye.need = new Float32Array(n);
    zipper(eye, rig, local, P);
  } else {
    for (let k = 0; k < n; k++) {
      if (Math.abs(az[k]) >= AZ) continue;
      const b = Math.min(NB - 1, Math.floor((az[k] + AZ) / (2 * AZ) * NB));
      eye.side[k] = el[k] > (split[b] ?? mid) ? 1 : -1;
    }
  }
  eye.edge = new Float32Array(NB);
  eye.egap = new Float32Array(NB);
  lowerEdge(eye, P, eye.edge);
  eye.room = new Float32Array(n);
  for (let k = 0; k < n; k++) if (eye.side[k] === 1) eye.room[k] = Math.min(0, el[k] - edgeAt(eye.edge, az[k]));
  eye.q = new Float32Array(n * 3);
  eye.moved = new Uint8Array(n);
}

// Eyes = the pieces eyeLook* shapes move whole, grouped by which ones (eyeball + cornea = one eye).
// A head whose looks move only the lids (ICT: the eyes never turn) gets its eyes from where that
// lid motion is: the round unmoved pieces whose bounds hold its centre.
// Lids = every other vertex within BAND of an eye at rest and not inside it. Null with no eyes.
// `rig` (optional): known lids, [{ upper, lower, socket }] of vertex indices -- the lid edge as
// two corner-to-corner loops and the socket the lid wraps into (gnmLids.js for GNM heads). Each
// goes to the nearest eye, and its vertices are lids even where they sit inside the eye at rest
// (an edge tucked against it): their rest gap is kept as it is.
export function buildEyes(base, tris, nv, shapes, rig = null) {
  const looks = [...shapes].filter(([n]) => /^eyeLook/i.test(n));
  if (!looks.length) return null;
  const bounds = (idx) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of idx) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], base[v * 3 + k]); hi[k] = Math.max(hi[k], base[v * 3 + k]); }
    return { lo, hi };
  };
  const inside = ({ lo, hi }, p) => [0, 1, 2].every((k) => p[k] >= lo[k] && p[k] <= hi[k]);
  const groups = new Map(), still = [];
  for (const verts of components(tris, nv).slice(1)) {
    const sig = [];
    for (const [name, d] of looks) {
      let moved = 0;
      for (const v of verts) if (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0) moved++;
      if (moved >= WHOLE * verts.length) sig.push(name);
    }
    if (!sig.length) { still.push(verts); continue; }
    const key = sig.join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...verts);
  }
  const found = [...groups.values()].map(bounds);
  const round = still.map((verts) => {
    const b = bounds(verts), e = [0, 1, 2].map((k) => b.hi[k] - b.lo[k]);
    return Math.min(...e) > 0.75 * Math.max(...e) ? b : null;
  });
  for (const [, d] of looks) {
    const c = [0, 0, 0];
    let n = 0;
    for (let v = 0; v < nv; v++) if (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0) { n++; for (let k = 0; k < 3; k++) c[k] += base[v * 3 + k]; }
    if (!n) continue;
    for (let k = 0; k < 3; k++) c[k] /= n;
    if (found.some((b) => inside(b, c))) continue;
    const pick = still.filter((_, i) => round[i] && inside(round[i], c));
    if (!pick.length) continue;
    const E = pick.flat();
    groups.set(`still ${groups.size}`, E);
    found.push(bounds(E));
  }
  if (!groups.size) return null;

  const owner = new Int32Array(nv).fill(-1);
  const eyes = [...groups.values()].map((E, e) => {
    for (const v of E) owner[v] = e;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of E) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], base[v * 3 + k]); hi[k] = Math.max(hi[k], base[v * 3 + k]); }
    const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const r = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    // The look's fit runs every frame: a rigid eye needs a couple of hundred of its vertices, not all.
    const step = Math.max(1, Math.floor(E.length / 200));
    return { idx: Int32Array.from(E), fit: Int32Array.from(E.filter((_, i) => i % step === 0)), c, r };
  });
  // The eye's own triangles, ray-cast from its centre.
  const own = eyes.map(() => []);
  for (let t = 0; t < tris.length; t += 3) {
    const e = owner[tris[t]];
    if (e >= 0 && owner[tris[t + 1]] === e && owner[tris[t + 2]] === e) own[e].push(tris[t], tris[t + 1], tris[t + 2]);
  }
  eyes.forEach((eye, e) => { eye.grid = castGrid(base, own[e], eye.c); });

  // Lids, each to its nearest eye.
  const lids = eyes.map(() => ({ idx: [], gap: [] }));
  for (let v = 0; v < nv; v++) {
    if (owner[v] >= 0) continue;
    let best = -1, bestGap = Infinity;
    eyes.forEach((eye, e) => {
      const x = base[v * 3] - eye.c[0], y = base[v * 3 + 1] - eye.c[1], z = base[v * 3 + 2] - eye.c[2];
      const dist = Math.hypot(x, y, z);
      if (dist > (1 + BAND) * eye.r * 1.5 || dist === 0) return;
      const rho = radius(eye.grid, x, y, z);
      if (rho <= 0) return;
      const gap = dist - rho;
      if (gap >= 0 && gap <= BAND * eye.r && gap < bestGap) { best = e; bestGap = gap; }
    });
    if (best >= 0) { lids[best].idx.push(v); lids[best].gap.push(bestGap); }
  }
  for (const r of rig || []) {
    const loop = [...r.upper, ...r.lower];
    const m = [0, 1, 2].map((k) => loop.reduce((a, v) => a + base[v * 3 + k], 0) / loop.length);
    let e = -1, best = Infinity;
    eyes.forEach((eye, i) => { const d = Math.hypot(m[0] - eye.c[0], m[1] - eye.c[1], m[2] - eye.c[2]); if (d < best) { best = d; e = i; } });
    if (e < 0 || best > 3 * eyes[e].r) continue;
    const eye = eyes[e], have = new Set(lids[e].idx);
    for (const v of [...loop, ...r.socket]) {
      if (have.has(v) || owner[v] >= 0) continue;
      const x = base[v * 3] - eye.c[0], y = base[v * 3 + 1] - eye.c[1], z = base[v * 3 + 2] - eye.c[2];
      const rho = radius(eye.grid, x, y, z);
      if (rho <= 0) continue;
      have.add(v); lids[e].idx.push(v); lids[e].gap.push(Math.hypot(x, y, z) - rho);
    }
    eye.rig = r;
  }
  eyes.forEach((eye, e) => {
    eye.lids = Int32Array.from(lids[e].idx); eye.gap = Float32Array.from(lids[e].gap);
    eye.hug = eye.gap.map((g) => 1 - smooth(CONFORM_IN * eye.r, CONFORM_OUT * eye.r, g));
    sides(eye, base, tris);
  });
  return { eyes: eyes.filter((eye) => eye.lids.length) };
}

// THE ZIPPER: the two edge loops both run corner to corner, so each edge vertex is paired with the
// point the same fraction of the way (by rest arc length) along the other loop. Pairing through
// azimuth bands instead gave neighbouring edge vertices different partners and a jagged seam.
// Stores per loop vertex: its lid-local index, its partner (two other-loop entries and a weight),
// and how far it sat above (upper) or below (lower) its partner at rest -- the opening, negative
// where the lids already overlap (corners).
function zipper(eye, rig, local, P) {
  const take = (loop) => loop.map((v) => local.get(v)).filter((k) => k !== undefined);
  const up = take(rig.upper);
  let lo = take(rig.lower);
  if (up.length < 2 || lo.length < 2) return;
  const near = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  if (near(up[0], lo[0]) > near(up[0], lo[lo.length - 1])) lo = lo.slice().reverse();
  const params = (loop) => {
    const t = [0];
    for (let i = 1; i < loop.length; i++) t.push(t[i - 1] + near(loop[i - 1], loop[i]));
    return t.map((x) => x / (t[t.length - 1] || 1));
  };
  const tu = params(up), tl = params(lo);
  const at = (t, ts) => {   // [i, j, w]: t between ts[i] and ts[j]
    let i = 0;
    while (i < ts.length - 2 && ts[i + 1] < t) i++;
    const w = ts[i + 1] > ts[i] ? Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i]))) : 0;
    return [i, i + 1, w];
  };
  const el = (k) => { angles(eye, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); return EE; };
  const pairs = [];
  for (let i = 0; i < up.length; i++) {
    const [a, b, w] = at(tu[i], tl);
    pairs.push({ k: up[i], s: 1, a: lo[a], b: lo[b], w, rest: el(up[i]) - (el(lo[a]) * (1 - w) + el(lo[b]) * w) });
  }
  for (let i = 0; i < lo.length; i++) {
    const [a, b, w] = at(tl[i], tu);
    pairs.push({ k: lo[i], s: -1, a: up[a], b: up[b], w, rest: (el(up[a]) * (1 - w) + el(up[b]) * w) - el(lo[i]) });
  }
  eye.zip = pairs;
}

// LIDS MEET, KNOWN EDGES: where a zipper pair has crossed (the upper below the lower by more than
// at rest), each gives way half the crossing -- they meet halfway -- and each edge vertex's turn is
// carried into its own lid (`carry`), like a soft-selection move, so a lid shifts as a sheet.
// Closing it all by lifting the upper lid turned it 35 deg over the top of the eye on
// square_anim_eyes frame 30 (the squint had raised the lower edge to +9 deg, the upper sat at -27):
// the rows by the edge turned further than the crease above them and ran through it. Turns in
// elevation about the eye's centre, at each vertex's own distance. Marks moved vertices need = -1.
function meetKnown(eye, q, n) {
  const { side, src, carry, inner, need, zip, F, U, S } = eye;
  need.fill(0);
  if (!zip) return;
  const el = (k) => { angles(eye, q[k * 3], q[k * 3 + 1], q[k * 3 + 2]); return EE; };
  for (const p of zip) {
    const other = el(p.a) * (1 - p.w) + el(p.b) * p.w;
    const open = p.s === 1 ? el(p.k) - other : other - el(p.k);   // > 0: open, as at rest
    const cross = Math.min(p.rest, 0) - open;
    if (cross > 1e-4) need[p.k] = p.s * cross * (p.s === 1 ? rules.share : 1 - rules.share);
  }
  const rise = eye.rise || (eye.rise = new Float32Array(n));
  for (let k = 0; k < n; k++) rise[k] = src[k] >= 0 ? need[src[k]] * carry[k] : 0;
  need.fill(0);
  for (let k = 0; k < n; k++) {
    if (!side[k] || (inner && inner[k]) || !(Math.abs(rise[k]) > 1e-4)) continue;
    const x = q[k * 3], y = q[k * 3 + 1], z = q[k * 3 + 2];
    angles(eye, x, y, z);
    const e = EE + rise[k];
    const d = Math.sqrt(x * x + y * y + z * z), ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(AA), sa = Math.sin(AA);
    for (let a = 0; a < 3; a++) q[k * 3 + a] = d * (ce * (ca * F[a] + sa * S[a]) + se * U[a]);
    need[k] = -1;
  }
}

// Lids in `v` (the composite) pushed out of, sucked onto, and kept on their side of the eyes.
// Writes the moves into `push` (dense, the size of the base) at the lid vertices only and returns
// how many moved; the caller zeroes it.
export function collide(state, base, v, push) {
  let moved = 0;
  for (const eye of state.eyes) {
    const { R, s, ms, md } = similarity(base, v, eye.fit);
    if (!(s > 0)) continue;
    const { c, r, grid, lids, gap, hug, side, q, room, edge, egap, inner } = eye;
    const clear = CLEAR * r, soft = SOFT * r, eps = 1e-5 * r, th = THICK * r;
    eye.moved.fill(0);
    // Into the eye's rest frame, relative to its centre: q = R^T (p - md) / s + ms - c.
    for (let n = 0; n < lids.length; n++) {
      const i = lids[n] * 3;
      const px = (v[i] - md[0]) / s, py = (v[i + 1] - md[1]) / s, pz = (v[i + 2] - md[2]) / s;
      q[n * 3] = R[0] * px + R[3] * py + R[6] * pz + ms[0] - c[0];
      q[n * 3 + 1] = R[1] * px + R[4] * py + R[7] * pz + ms[1] - c[1];
      q[n * 3 + 2] = R[2] * px + R[5] * py + R[8] * pz + ms[2] - c[2];
    }
    lowerEdge(eye, q, edge);
    for (let n = 0; n < lids.length; n++) {
      const x = q[n * 3], y = q[n * 3 + 1], z = q[n * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);   // not Math.hypot: several times slower, per lid per frame
      if (dist === 0) continue;
      const rho = radius(grid, x, y, z);
      if (rho <= 0) continue;
      const g0 = dist - rho;
      let to = dist;
      if (g0 < gap[n]) {
        if (!rules.push) continue;
        // Push out. Target clearance and soft width, both no more than it had at rest.
        const t = Math.min(gap[n], clear), k = Math.min(soft, gap[n] - t);
        const g = g0 - t;
        if (g < k - eps) to = rho + t + (k > 0 ? (g <= -k ? 0 : (g + k) * (g + k) / (4 * k)) : Math.max(g, 0));
      } else if (hug[n] > 0 && rules.suck) {
        // An upper lid over the lower one is the meet rule's: sucked on, it went through the lower lid.
        if (side[n] === 1) {
          angles(eye, x, y, z);
          if (Math.abs(AA) < AZ && EE < edgeAt(edge, AA) + room[n] - 1e-4) continue;
        }
        // Suck on: back toward its rest gap, unless lifted far enough to be meant.
        const lift = g0 - gap[n];
        to = dist - lift * hug[n] * (1 - smooth(LET_GO_IN * r, LET_GO_OUT * r, lift));
      }
      if (Math.abs(to - dist) <= eps) continue;
      const f = to / dist;
      q[n * 3] = x * f; q[n * 3 + 1] = y * f; q[n * 3 + 2] = z * f;
      eye.moved[n] = 1;
    }
    // Lids meet: an upper lid below the lower lid's edge (less whatever it was below at rest) and
    // not in front of it is turned back up to the edge; one in front is kept THICK clear of it.
    // Between, a blend, so a lid half over the other does not tear.
    lowerEdge(eye, q, edge, egap);
    const { F, U, S } = eye;
    if (eye.src && rules.meet) {
      meetKnown(eye, q, lids.length);
      for (let n = 0; n < lids.length; n++) if (eye.need[n] < 0) eye.moved[n] = 1;
    } else for (let n = 0; n < lids.length; n++) {
      // Only lid that hugs the eye meets the other lid: skin further out (crease, brow) and the
      // socket's inner wall never cross the lower lid's edge, and turning them up threw them
      // across the face (GNM, frame 0 of square_anim_eyes: 1.47).
      if (side[n] !== 1 || !rules.meet || !(hug[n] > 0) || (inner && inner[n])) continue;
      const x = q[n * 3], y = q[n * 3 + 1], z = q[n * 3 + 2];
      angles(eye, x, y, z);
      if (Math.abs(AA) >= AZ) continue;
      const lo = edgeAt(edge, AA, egap) + room[n];
      if (!(EE < lo - 1e-4)) continue;   // fit noise at rest is not contact
      const d = Math.sqrt(x * x + y * y + z * z), rho = radius(grid, x, y, z);
      if (rho <= 0) continue;
      // In front = lifted off its OWN rest seat: a blink slides along the eye (lift ~0) and is turned
      // back; a fold hangs out over the lower lid. (Measured against the lower edge's depth instead,
      // every lid on GNM read as in front: its lower edge tucks INTO the eye at rest.)
      const over = EG + th, w = (1 - smooth(th, 3 * th, d - rho - gap[n])) * hug[n];
      const e = EE + (lo - EE) * w;
      const dd = d - rho < over ? d + (1 - w) * (rho + over - d) : d;
      const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(AA), sa = Math.sin(AA);
      for (let k = 0; k < 3; k++) q[n * 3 + k] = dd * (ce * (ca * F[k] + sa * S[k]) + se * U[k]);
      eye.moved[n] = 1;
    }
    for (let n = 0; n < lids.length; n++) {
      if (!eye.moved[n]) continue;
      const i = lids[n] * 3;
      // Back out of the rest frame: p' = s R (q + c - ms) + md.
      const qx = q[n * 3] + c[0] - ms[0], qy = q[n * 3 + 1] + c[1] - ms[1], qz = q[n * 3 + 2] + c[2] - ms[2];
      push[i] = s * (R[0] * qx + R[1] * qy + R[2] * qz) + md[0] - v[i];
      push[i + 1] = s * (R[3] * qx + R[4] * qy + R[5] * qz) + md[1] - v[i + 1];
      push[i + 2] = s * (R[6] * qx + R[7] * qy + R[8] * qz) + md[2] - v[i + 2];
      moved++;
    }
  }
  return moved;
}
