// TEETH CORRECTIVES (after Retarget Shapes on a GNM head). Retarget scales each shape with the skin
// it moves, so a sculpt's shapes can each clear the teeth and still not COMBINE: on matt's spork,
// smile + mouthShrugLower put the lower gums through the chin (20 vertices, 0.41 deep) where GNM's
// own pair stays clear. Fixing the shapes one by one cannot touch that (each is fine alone), and
// scaling every shape's motion toward the teeth took up to 1.8 off the smile itself. Teeth
// Collision (Post FX) fits the crowns and leaves the gum base out, so the gumline came through.
//
// So the pairs are checked: every pair of mouth, jaw and cheek shapes at full weight (a Left/Right
// pair counts as one shape, both halves on). Where teeth or gums come through the lips, the skin
// round them or the chin, that skin is pushed back out to its rest clearance (at most CLEAR of the
// head's height) along the teeth's surface, the push spread a few rings into the skin round it,
// and stored as a COMBO on those drivers (weight = their product, so each shape alone looks as it
// did). A combo already on exactly those drivers -- one of these from an earlier run, or matt's own
// Fix Combo -- is worn while checking, and the push is added to it.
//
// Crossings are only counted where the nearest point of the teeth is on a FACE: the gums are open
// along their bottom edge, and skin below it read as "inside" by the side test (that inflated every
// number before 2026-10-30). The tongue is left out (tongueOut is meant to come through the lips),
// and so is the mouth bag, which the teeth sit in. Pure maths on arrays, no app state.
import { buildGrid, closestOnGrid, neighbours } from './TopoWrap.js';
import { regionCodes, mouthParts } from './GnmRegions.js';
import { GNM_REGION_NAMES } from './gnmRegionData.js';

const SKIN = ['upper_lip', 'lower_lip', 'upper_lip_area', 'lower_lip_area', 'chin'];
export const CLEAR = 0.004;   // clearance wanted, fraction of the head's height (0.19 on GNM)
const REACH = 0.05;           // look this far from the teeth, fraction of the head's height
const RINGS = 3;              // the push spreads this many rings of skin out, fading
const MIN_PUSH = 0.002;       // pairs needing less than this (fraction of height) are left alone

const moves = (d, v) => d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0;

// Signed gap (positive outside) from vertex v of X to the teeth, and the face's unit normal; null
// beyond `reach` or when the nearest point is an edge or corner (no meaningful side there).
function gap(g, X, v, reach) {
  const p = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], h = closestOnGrid(g, p, reach);
  if (!h) return null;
  const T = g.tris, a = T[h.t * 3] * 3, b = T[h.t * 3 + 1] * 3, c = T[h.t * 3 + 2] * 3;
  const e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n[0] /= l; n[1] /= l; n[2] /= l;
  const dx = p[0] - h.p[0], dy = p[1] - h.p[1], dz = p[2] - h.p[2], s = dx * n[0] + dy * n[1] + dz * n[2];
  if (Math.abs(s) < 0.9 * Math.hypot(dx, dy, dz)) return null;
  return { s, n };
}

// The shapes checked, as units: a Left/Right pair is one unit (both halves on) -- except the
// sideways ones (mouthLeft/Right, jawLeft/Right), which are opposites: never on together.
const SIDEWAYS = /^(mouth|jaw)(Left|Right)$/;
function units(shapes, skip) {
  const names = [...shapes.keys()].filter((n) => /^(mouth|jaw|cheek)/.test(n) && !skip(n));
  const out = [], used = new Set();
  for (const n of names) {
    if (used.has(n)) continue;
    const m = !SIDEWAYS.test(n) && /^(.+)(Left|Right)$/.exec(n), twin = m && m[1] + (m[2] === 'Left' ? 'Right' : 'Left');
    if (twin && names.includes(twin)) { out.push([n, twin]); used.add(twin); } else out.push([n]);
    used.add(n);
  }
  return out;
}

// `base` the neutral; `shapes` Map name -> delta (plain shapes); `combos` Map name -> drivers (the
// combo deltas are in `shapes` too); `skip(name)` leaves a shape out (muted, combos, tongue).
// `singles`: check each shape ALONE instead, and fix it in the shape itself -- done first, since a
// shape that crosses a little alone (mouthRollUpper, 0.09) made a pair with nearly everything.
// `only`: a Set of driver keys (sorted, '|'-joined) to re-check, null for all.
// Returns [{ drivers, delta, push, existing, single }]: a correction per pair (or shape) that needs
// one -- `existing` names the combo (or, single, the shape) it adds to (its delta already includes
// the addition), else a new combo is needed.
export const driverKey = (ds) => [...ds].sort().join('|');
export function teethCorrectives(base, shapes, combos, tris, nv, skip = () => false, { singles = false, only = null } = {}) {
  const codes = regionCodes(), nskin = codes.length;
  const want = new Set(SKIN.map((n) => GNM_REGION_NAMES.indexOf(n)));
  const K = [];
  for (let v = 0; v < nskin; v++) if (want.has(codes[v])) K.push(v);
  const plain = new Map([...shapes].filter(([n]) => !combos.has(n)));
  const tongue = plain.get('tongueOut');
  const { upper, lower } = mouthParts(base, tris, nv, plain);
  const teeth = new Uint8Array(nv);
  for (const v of [...upper, ...lower]) if (!tongue || !moves(tongue, v)) teeth[v] = 1;
  const tt = [];
  for (let q = 0; q < tris.length; q += 3) if (teeth[tris[q]] && teeth[tris[q + 1]] && teeth[tris[q + 2]]) tt.push(tris[q], tris[q + 1], tris[q + 2]);
  if (!K.length || !tt.length) return [];
  const T3 = Uint32Array.from(tt), teethV = [...new Set(tt)];
  let ylo = Infinity, yhi = -Infinity;
  for (let v = 0; v < nskin; v++) { ylo = Math.min(ylo, base[v * 3 + 1]); yhi = Math.max(yhi, base[v * 3 + 1]); }
  const h = yhi - ylo, clear = CLEAR * h, reach = REACH * h;

  // Each vertex keeps its own rest clearance, at most `clear`.
  const g0 = buildGrid(T3, base), need = new Float32Array(nv);
  for (const v of K) { const r = gap(g0, base, v, reach); need[v] = r ? Math.min(Math.max(r.s, 0), clear) : clear; }

  // The skin a push may spread over: K and RINGS rings round it (skin only).
  const nb = neighbours(tris, nv);
  const ring = new Int8Array(nv).fill(-1);
  let front = [];
  for (const v of K) { ring[v] = 0; front.push(v); }
  for (let r = 1; r <= RINGS; r++) {
    const next = [];
    for (const v of front) for (let e = nb.start[v]; e < nb.start[v + 1]; e++) {
      const u = nb.list[e];
      if (u < nskin && ring[u] < 0) { ring[u] = r; next.push(u); }
    }
    front = next;
  }
  const region = [];
  for (let v = 0; v < nskin; v++) if (ring[v] >= 0) region.push(v);

  const U = units(plain, (n) => n === 'tongueOut' || skip(n));
  const comboOf = new Map();
  for (const [name, ds] of combos) comboOf.set(driverKey(ds), name);
  const touchesK = (d) => K.some((v) => moves(d, v));
  const movesTeeth = (d) => teethV.some((v) => moves(d, v));

  const out = [];
  const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3), C2 = new Float32Array(nv * 3);
  const deficit = new Float32Array(nv), dir = new Float32Array(nv * 3);
  const cands = [];
  if (singles) for (const u of U) for (const n of u) cands.push([n]);
  else for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) cands.push([...U[i], ...U[j]]);
  for (const drivers of cands) {
    if (only && !only.has(driverKey(drivers))) continue;
    const side = drivers.map((n) => SIDEWAYS.exec(n)).filter(Boolean);
    if (side.length === 2 && side[0][1] === side[1][1]) continue;   // mouthLeft + mouthRight
    // mouthClose is worn capped at jawOpen (AnimationRegistry.underOf): without the jaw it is 0.
    if (drivers.includes('mouthClose') && !drivers.includes('jawOpen')) continue;
    const ds = drivers.map((n) => plain.get(n));
    if (!ds.some(touchesK)) continue;
    const existing = singles ? drivers[0] : comboOf.get(driverKey(drivers)) || null;
    P.set(base);
    for (const d of ds) for (let q = 0; q < P.length; q++) P[q] += d[q];
    if (existing && !singles) { const d = shapes.get(existing); for (let q = 0; q < P.length; q++) P[q] += d[q]; }
    // Teeth where the pair leaves them: the rest grid unless a driver (or the combo) moves them.
    const g = ds.some(movesTeeth) || (existing && movesTeeth(shapes.get(existing))) ? buildGrid(T3, P) : g0;
    C.fill(0); deficit.fill(0);
    let any = 0;
    for (const v of K) {
      const r = gap(g, P, v, reach);
      if (!r || r.s >= need[v]) continue;
      // Only real crossings start a push; skin merely nearer than its clearance is left.
      if (r.s >= 0) continue;
      const k = need[v] - r.s;
      deficit[v] = k; dir.set(r.n, v * 3);
      for (let c = 0; c < 3; c++) C[v * 3 + c] = r.n[c] * k;
      any = Math.max(any, k);
    }
    if (any < MIN_PUSH * h) continue;
    // Spread: rings outward, each vertex taking 0.6 of the mean push of its pushed neighbours...
    for (let r = 0; r <= RINGS; r++) {
      for (const v of region) {
        if (ring[v] !== r || deficit[v] > 0) continue;
        let n = 0, s0 = 0, s1 = 0, s2 = 0;
        for (let e = nb.start[v]; e < nb.start[v + 1]; e++) {
          const u = nb.list[e];
          if (C[u * 3] || C[u * 3 + 1] || C[u * 3 + 2]) { n++; s0 += C[u * 3]; s1 += C[u * 3 + 1]; s2 += C[u * 3 + 2]; }
        }
        if (n) { C[v * 3] = 0.6 * s0 / n; C[v * 3 + 1] = 0.6 * s1 / n; C[v * 3 + 2] = 0.6 * s2 / n; }
      }
    }
    // ...two smoothing passes, then every pushed vertex topped back up to its full push.
    for (let pass = 0; pass < 2; pass++) {
      C2.set(C);
      for (const v of region) {
        let n = 1, s0 = C[v * 3], s1 = C[v * 3 + 1], s2 = C[v * 3 + 2];
        for (let e = nb.start[v]; e < nb.start[v + 1]; e++) { const u = nb.list[e]; if (ring[u] < 0) continue; n++; s0 += C[u * 3]; s1 += C[u * 3 + 1]; s2 += C[u * 3 + 2]; }
        C2[v * 3] = s0 / n; C2[v * 3 + 1] = s1 / n; C2[v * 3 + 2] = s2 / n;
      }
      C.set(C2);
    }
    for (const v of K) {
      if (!(deficit[v] > 0)) continue;
      const along = C[v * 3] * dir[v * 3] + C[v * 3 + 1] * dir[v * 3 + 1] + C[v * 3 + 2] * dir[v * 3 + 2];
      if (along < deficit[v]) for (let c = 0; c < 3; c++) C[v * 3 + c] += (deficit[v] - along) * dir[v * 3 + c];
    }
    const delta = existing ? Float32Array.from(shapes.get(existing)) : new Float32Array(nv * 3);
    for (const v of region) for (let c = 0; c < 3; c++) delta[v * 3 + c] += C[v * 3 + c];
    out.push({ drivers, delta, push: any, existing, single: singles });
  }
  return out;
}
