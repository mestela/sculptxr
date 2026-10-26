// TopoWrap.js: a pure similarity is reproduced exactly everywhere (the spline adds nothing), a bent
// target is hit exactly at every landmark and smoothly between, `smooth` trades exactness away,
// degenerate landmarks are refused, and closestPoint lands on a triangle's face, edge and corner.
// node scratchpad/topowrap_test.mjs   (TW_INJECT=noaffine drops the spline's affine part: the
//   similarity check must fail; TW_INJECT=nodelta drops the relax's shape term: the lip check must fail)
import fs from 'node:fs';

const src = new URL('../src/editing/TopoWrap.js', import.meta.url);
let code = fs.readFileSync(src, 'utf8');
if (process.env.TW_INJECT === 'nodelta') {
  const anchor = 'x[i * 3 + c] = s / (b - a) + delta[f * 3 + c];';
  if (!code.includes(anchor)) throw new Error('anchor moved');
  code = code.replace(anchor, 'x[i * 3 + c] = s / (b - a);');
}
if (process.env.TW_INJECT === 'noaffine') {
  const anchor = 'for (let k = 0; k < 3; k++) out[oo + k] = W[n * 3 + k] + W[(n + 1) * 3 + k] * q[0] + W[(n + 2) * 3 + k] * q[1] + W[(n + 3) * 3 + k] * q[2];';
  if (!code.includes(anchor)) throw new Error('anchor moved');
  code = code.replace(anchor, 'for (let k = 0; k < 3; k++) out[oo + k] = 0;');
}
const copy = new URL('../src/editing/_topowrap_test_copy.js', import.meta.url);
fs.writeFileSync(copy, code);
let T;
try { T = await import(copy.href); } finally { fs.rmSync(copy); }
const { fitWarp, warpAll, closestPoint, buildGrid, closestOnGrid, snapSurface, neighbours, relaxRegion, vertexNormals } = T;

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
function lcg(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r = lcg(7);

// 20 landmarks over a head-sized blob, and 500 other points.
const pts = (n) => Float64Array.from({ length: n * 3 }, () => (r() - 0.5) * 40);
const L = pts(20), V = pts(500);

// A known similarity: scale 1.7, 30 deg about Y, then a move.
const ang = Math.PI / 6, cs = Math.cos(ang), sn = Math.sin(ang);
const simF = (x, y, z) => [1.7 * (cs * x + sn * z) + 5, 1.7 * y - 3, 1.7 * (-sn * x + cs * z) + 11];
const map = (A, f) => { const o = new Float64Array(A.length); for (let i = 0; i < A.length; i += 3) o.set(f(A[i], A[i + 1], A[i + 2]), i); return o; };
const maxErr = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 3) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])); return m; };

let w = fitWarp(L, map(L, simF));
check('similarity: landmarks hit', w.residual < 1e-6, `(${w.residual.toExponential(1)})`);
check('similarity: every other point exact too', maxErr(warpAll(w, V), map(V, simF)) < 1e-4, `(${maxErr(warpAll(w, V), map(V, simF)).toExponential(1)})`);

// A bend on top: the spline must hit the landmarks and stay smooth (no point thrown far).
const bend = (x, y, z) => { const [a, b, c] = simF(x, y, z); return [a + 0.02 * y * y, b, c + 3 * Math.sin(x / 15)]; };
w = fitWarp(L, map(L, bend));
check('bend: landmarks hit exactly', w.residual < 1e-6, `(${w.residual.toExponential(1)})`);
const err = maxErr(warpAll(w, V), map(V, bend));
check('bend: points between land near the true bend', err < 6, `(max ${err.toFixed(2)} on a ~70-unit blob)`);

const ws = fitWarp(L, map(L, bend), { smooth: 0.01 });
check('smooth 0.01: misses the landmarks a little, not a lot', ws.residual > 1e-3 && ws.residual < 1, `(${ws.residual.toFixed(3)})`);

let threw = false;
try { fitWarp(Float64Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0), Float64Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0)); } catch (e) { threw = /degenerate/.test(e.message); }
check('landmarks in a line are refused', threw);

// One triangle in the z = 0 plane.
const verts = [0, 0, 0, 10, 0, 0, 0, 10, 0], tris = [0, 1, 2];
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9;
check('closest: above the face drops straight down', near(closestPoint(tris, verts, [2, 3, 5]), [2, 3, 0]));
check('closest: past the long edge lands on it', near(closestPoint(tris, verts, [8, 8, 1]), [5, 5, 0]));
check('closest: beyond a corner is the corner', near(closestPoint(tris, verts, [-3, -4, 2]), [0, 0, 0]));

// ── Surface snap ──
// A sheet (grid of n x n) and a bumpy target surface z = f(x, y) under it, both as triangles.
function sheet(n, f) {
  const v = [], t = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = i / (n - 1) * 20 - 10, y = j / (n - 1) * 20 - 10; v.push(x, y, f(x, y)); }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; t.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
  return { v: Float32Array.from(v), t: Uint32Array.from(t) };
}
const bump = (x, y) => 2 * Math.sin(x / 3) * Math.cos(y / 4);
const tgt = sheet(60, bump), grid = buildGrid(tgt.t, tgt.v);
let worst = 0;
for (let k = 0; k < 200; k++) {
  const p = [(r() - 0.5) * 24, (r() - 0.5) * 24, (r() - 0.5) * 10];
  const a = closestOnGrid(grid, p).p, b = closestPoint(tgt.t, tgt.v, p);
  worst = Math.max(worst, Math.abs(Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]) - Math.hypot(b[0] - p[0], b[1] - p[1], b[2] - p[2])));
}
check('grid closest point = brute force', worst < 1e-5, `(${worst.toExponential(1)})`);

const flat = sheet(25, () => 3);   // flat, 3 above the surface's mean
const off = (v) => { let m = 0; for (let i = 0; i < v.length; i += 3) m += Math.abs(v[i + 2] - bump(v[i], v[i + 1])); return m / (v.length / 3); };
const inc = new Uint8Array(flat.v.length / 3).fill(1);
const mid = 12 * 25 + 12; inc[mid] = 0;   // one excluded vertex in the middle
const out = snapSurface(flat.v, flat.t, neighbours(flat.t, flat.v.length / 3), inc, grid);
check('snap: sheet lands on the surface', off(out) < 0.05 * off(flat.v), `(mean ${off(flat.v).toFixed(2)} -> ${off(out).toFixed(3)})`);
check('snap: an excluded vertex is carried with its neighbours', Math.abs(out[mid * 3 + 2] - bump(out[mid * 3], out[mid * 3 + 1])) < 0.3, `(${Math.abs(out[mid * 3 + 2] - bump(out[mid * 3], out[mid * 3 + 1])).toFixed(3)} off)`);
const flip = Float32Array.from(flat.t); for (let i = 0; i < flip.length; i += 3) [flip[i + 1], flip[i + 2]] = [flip[i + 2], flip[i + 1]];
const back = snapSurface(flat.v, Uint32Array.from(flip), neighbours(flat.t, flat.v.length / 3), inc, grid);
check('snap: a surface facing the other way is not grabbed', off(back) > 0.9 * off(flat.v), `(${off(back).toFixed(2)})`);

// ── Ripples: a fine sheet snapped onto a DECIMATED target (a fine bumpy surface vertex-clustered
// into irregular facets, as a decimated sculpt is) takes the facet creases; the Taubin finish must
// take most of them out AND sit no further from the smooth surface the facets stood for.
{
  const f = (x, y) => 2 * Math.sin(x / 3) * Math.cos(y / 4);
  const dense = sheet(81, f), cell = 1.4, cid = new Map(), cnt = [], acc = [], map = [];
  for (let i = 0; i < dense.v.length / 3; i++) {
    const k = Math.floor(dense.v[i * 3] / cell) + ',' + Math.floor(dense.v[i * 3 + 1] / cell);
    let c = cid.get(k);
    if (c === undefined) { c = cnt.length; cid.set(k, c); cnt.push(0); acc.push([0, 0, 0]); }
    map.push(c); cnt[c]++; for (let q = 0; q < 3; q++) acc[c][q] += dense.v[i * 3 + q];
  }
  const cv = Float32Array.from(acc.flatMap((a, c) => a.map((x) => x / cnt[c]))), ct = [];
  for (let t = 0; t < dense.t.length; t += 3) { const a = map[dense.t[t]], b = map[dense.t[t + 1]], c = map[dense.t[t + 2]]; if (a !== b && b !== c && a !== c) ct.push(a, b, c); }
  const cg = buildGrid(Uint32Array.from(ct), cv);
  const fine = sheet(41, () => 2.5), fnb = neighbours(fine.t, fine.v.length / 3), inc2 = new Uint8Array(fine.v.length / 3).fill(1);
  const inner = (i) => { const x = fine.v[i * 3], y = fine.v[i * 3 + 1]; return Math.abs(x) < 8 && Math.abs(y) < 8; };
  // Ripple = how the snapped sheet's local shape (Laplacian) differs from snapping onto the smooth
  // original: the real curvature is in both and cancels; the facet imprint is not.
  const ideal = snapSurface(fine.v, fine.t, fnb, inc2, buildGrid(dense.t, dense.v), { finish: 0 });
  const lapAt = (v, i) => { const a = fnb.start[i], b = fnb.start[i + 1], m = [0, 0, 0]; for (let e = a; e < b; e++) for (let c = 0; c < 3; c++) m[c] += v[fnb.list[e] * 3 + c]; return [0, 1, 2].map((c) => v[i * 3 + c] - m[c] / (b - a)); };
  const zig = (v) => { let z = 0, n = 0; for (let i = 0; i < v.length / 3; i++) { if (!inner(i)) continue; const p = lapAt(v, i), q = lapAt(ideal, i); z += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); n++; } return z / n; };
  const toSmooth = (v) => { let d = 0, n = 0; for (let i = 0; i < v.length / 3; i++) if (inner(i)) { d += Math.abs(v[i * 3 + 2] - f(v[i * 3], v[i * 3 + 1])); n++; } return d / n; };
  const raw = snapSurface(fine.v, fine.t, fnb, inc2, cg, { finish: 0 }), even = snapSurface(fine.v, fine.t, fnb, inc2, cg);
  check('finish: facet ripples smoothed out', zig(even) < 0.8 * zig(raw), `(zigzag ${zig(raw).toFixed(3)} -> ${zig(even).toFixed(3)})`);
  check('finish: and no further from the smooth surface the facets stood for', toSmooth(even) <= toSmooth(raw) * 1.02, `(${toSmooth(raw).toFixed(3)} -> ${toSmooth(even).toFixed(3)})`);
}

// ── Region relax (the lips after a snap) ──
// A sheet with a bump in the middle as the reference; the bump region scrambled; the rim fixed.
// Relaxed, the region must come back to the reference's shape.
const bumpRef = sheet(21, (x, y) => 3 * Math.exp(-(x * x + y * y) / 12));
const nb21 = neighbours(bumpRef.t, bumpRef.v.length / 3);
const freeIdx = [];
for (let j = 4; j <= 16; j++) for (let i = 4; i <= 16; i++) freeIdx.push(j * 21 + i);
const messy = Float32Array.from(bumpRef.v);
for (const i of freeIdx) { messy[i * 3] += (r() - 0.5) * 2; messy[i * 3 + 1] += (r() - 0.5) * 2; messy[i * 3 + 2] = -messy[i * 3 + 2]; }
const fixedUp = relaxRegion(messy, bumpRef.v, nb21, freeIdx, 400);
let relaxErr = 0;
for (const i of freeIdx) relaxErr = Math.max(relaxErr, Math.hypot(fixedUp[i * 3] - bumpRef.v[i * 3], fixedUp[i * 3 + 1] - bumpRef.v[i * 3 + 1], fixedUp[i * 3 + 2] - bumpRef.v[i * 3 + 2]));
check('relax: a scrambled region regains its own shape', relaxErr < 0.05, `(${relaxErr.toFixed(3)})`);

if (!fails) console.log('all checks passed');
process.exit(fails ? 1 : 0);
