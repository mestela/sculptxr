// ShapeRetarget.unpose: a sculpt made in a pose, taken back to its own neutral.
// node scratchpad/unpose_test.mjs   (UP_INJECT=1 drops the correction rounds: the 1% checks must fail)
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../src/editing/ShapeRetarget.js', import.meta.url), 'utf8');
if (process.env.UP_INJECT === '1') {
  const anchor = 'N = N.map((n, i) => n + r[i]);';
  if (!src.includes(anchor)) throw new Error('anchor moved');
  src = src.replace(anchor, 'break;');
}
const { triangles, prepare, retargetDelta, unpose } = await import('data:text/javascript,' + encodeURIComponent(src));

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };

// A UV sphere for the template head.
const P = [], F = [], nu = 48, nr = 32, R = 10;
for (let i = 0; i <= nr; i++) for (let j = 0; j < nu; j++) {
  const th = Math.PI * i / nr, ph = 2 * Math.PI * j / nu;
  P.push(R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph));
}
for (let i = 0; i < nr; i++) for (let j = 0; j < nu; j++) {
  const a = i * nu + j, b = i * nu + (j + 1) % nu;
  F.push(a, b, b + nu, a + nu);
}
const nv = P.length / 3, B = Float32Array.from(P), tris = triangles(Uint32Array.from(F), F.length / 4);

// The template's pose: a "jaw" on the +x side swung down and forward (a rotation of the cap
// about z, falling off with distance), the kind of shape that turns the surface.
const D = new Float32Array(nv * 3);
for (let v = 0; v < nv; v++) {
  const x = B[v * 3], y = B[v * 3 + 1], z = B[v * 3 + 2];
  const w = Math.max(0, Math.min(1, (x - 2) / 6)) * Math.max(0, 1 - Math.abs(z) / 9);
  const a = -0.5 * w, c = Math.cos(a), s = Math.sin(a);
  D[v * 3] = x * c - y * s - x; D[v * 3 + 1] = x * s + y * c - y;
}

// The character: the template made wider and taller unevenly, the jaw side pushed out, and
// TURNED 50 deg about y (a head sculpted facing elsewhere). Its true pose is the template's pose
// carried onto it (forward transfer) -- what the sculptor made, and what Wrap + Snap fit GNM to.
const turn = 50 * Math.PI / 180, ct = Math.cos(turn), st = Math.sin(turn);
const C = new Float32Array(nv * 3);
for (let v = 0; v < nv; v++) {
  let x = B[v * 3] * 1.35, y = B[v * 3 + 1] * (1.1 + 0.02 * B[v * 3]), z = B[v * 3 + 2] * 0.9;
  x += 0.04 * Math.max(0, x) ** 2;
  C[v * 3] = x * ct + z * st; C[v * 3 + 1] = y; C[v * 3 + 2] = -x * st + z * ct;
}
const W = C.map((c, i) => c + 0);
const fwd = retargetDelta(prepare(B, C, tris, nv), D);
for (let i = 0; i < W.length; i++) W[i] += fwd[i];

const posed = B.map((b, i) => b + D[i]);
const err = (A) => { let m = 0, s = 0; for (let v = 0; v < nv; v++) { const e = Math.hypot(A[v * 3] - C[v * 3], A[v * 3 + 1] - C[v * 3 + 1], A[v * 3 + 2] - C[v * 3 + 2]); m = Math.max(m, e); s += e; } return { max: m, mean: s / nv }; };
let peak = 0;
for (let v = 0; v < nv; v++) peak = Math.max(peak, Math.hypot(fwd[v * 3], fwd[v * 3 + 1], fwd[v * 3 + 2]));

// 1) Template onto itself: un-posing its own pose gives its neutral exactly.
const back = unpose(B, D, posed, tris, nv).base;
let e0 = 0;
for (let i = 0; i < back.length; i++) e0 = Math.max(e0, Math.abs(back[i] - B[i]));
check('the template un-poses to its own neutral', e0 < 1e-3 * peak, `(${e0.toExponential(2)})`);

// 2) The character: un-posed close to the neutral it was made from, and far closer than
// subtracting GNM's pose as it is (which is in the template's size and facing).
const t0 = performance.now();
const { base: N, miss } = unpose(B, D, W, tris, nv);
const ms = performance.now() - t0;
const naive = W.map((w, i) => w - D[i]);
const eN = err(N), eR = err(naive);
check('posed character un-poses to its neutral', eN.max < 0.01 * peak, `(max ${(eN.max / peak * 100).toFixed(2)}% of the pose, mean ${(eN.mean / peak * 100).toFixed(3)}%, ${ms.toFixed(0)} ms)`);
check('...far better than subtracting the raw pose', eN.max < 0.05 * eR.max, `(raw: max ${(eR.max / peak * 100).toFixed(1)}%)`);

// 3) The round trip the app relies on: neutral + the pose retargeted onto it (Retarget Shapes)
// gives back the sculpt.
const again = retargetDelta(prepare(B, N, tris, nv), D);
let eT = 0;
for (let v = 0; v < nv; v++) eT = Math.max(eT, Math.hypot(N[v * 3] + again[v * 3] - W[v * 3], N[v * 3 + 1] + again[v * 3 + 1] - W[v * 3 + 1], N[v * 3 + 2] + again[v * 3 + 2] - W[v * 3 + 2]));
check('neutral + retargeted pose gives the sculpt back', eT < 0.01 * peak && Math.abs(eT - miss) < 1e-4 * peak, `(max ${(eT / peak * 100).toFixed(2)}% of the pose, reported ${(miss / peak * 100).toFixed(2)}%)`);

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
