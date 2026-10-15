// Node harness for the graph editor's SIMPLIFY CURVES (curveSimplify.js + the registry's
// simplifyTransformTrack).
//
// The promise it makes is an ERROR BOUND: after simplifying at tolerance t, no channel is further
// than t (of its group's range) from where it was -- on the drawn bezier AND, for rotation and
// scale, on the straight-line playback. So that is checked against an evaluator written here,
// independently, not against the module's own.
//
// Run: node scratchpad/curve_simplify_test.mjs   (from the repo root)
//
// Defect injections:
//   CS_INJECT=nolinear   the linear (playback) model is ignored, so rotation keys are removed on
//                        the strength of a bezier the playback never draws
//   CS_INJECT=stale      neighbours' costs are not recomputed after a removal, so later removals
//                        are priced on a curve that no longer exists and the bound breaks
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
let CS = fs.readFileSync(path.join(REPO, 'src/editing/curveSimplify.js'), 'utf8');

const inject = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error(`inject ${name}: anchor moved`);
  return src.replace(a, b);
};
{
  const i = process.env.CS_INJECT || '';
  if (i === 'nolinear') CS = inject(CS, '        if (sLin[c]) {\n          const el', '        if (false) {\n          const el', i);
  else if (i === 'stale') CS = inject(CS, 'for (let j = 0; j < 3 && a >= 0; j++, a = prev[a])', 'for (let j = 0; j < 0 && a >= 0; j++, a = prev[a])', i);
}

const { decimateKeys } = await import('data:text/javascript;base64,' + Buffer.from(CS).toString('base64'));

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── an independent evaluator: the graph editor's curve, kept keys only ──────────
function bezT(alpha, p1x, p2x) {
  let lo = 0, hi = 1, t = 0.5;
  for (let k = 0; k < 40; k++) {
    const o = 1 - t, x = 3 * o * o * t * p1x + 3 * o * t * t * p2x + t * t * t;
    if (x < alpha) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}
function evalCurve(T, V, time, linear) {
  let i = 0;
  while (i < T.length - 2 && T[i + 1] < time) i++;
  const dt = T[i + 1] - T[i], al = (time - T[i]) / dt;
  if (linear) return V[i] + (V[i + 1] - V[i]) * al;
  const sl = (k) => k === 0 ? (V[1] - V[0]) / (T[1] - T[0])
    : k === T.length - 1 ? (V[k] - V[k - 1]) / (T[k] - T[k - 1])
    : (V[k + 1] - V[k - 1]) / (T[k + 1] - T[k - 1]);
  const d0 = dt * 0.33, d1 = -dt * 0.33;
  const t = bezT(al, d0 / dt, 1 + d1 / dt), o = 1 - t;
  return o * o * o * V[i] + 3 * o * o * t * (V[i] + sl(i) * d0) + 3 * o * t * t * (V[i + 1] + sl(i + 1) * d1) + t * t * t * V[i + 1];
}
function maxErr(T, V, keep, linear, norm) {
  const kT = [], kV = [];
  for (let i = 0; i < T.length; i++) if (keep[i]) { kT.push(T[i]); kV.push(V[i]); }
  let worst = 0;
  for (let i = 0; i < T.length - 1; i++) for (let s = 0; s < 8; s++) {
    const time = T[i] + (T[i + 1] - T[i]) * s / 8;
    worst = Math.max(worst, Math.abs(evalCurve(kT, kV, time, linear) - evalCurve(T, V, time, linear)) / norm);
  }
  return worst;
}
const count = (k) => k.reduce((a, b) => a + b, 0);

// A recorded-looking take: 120 keys at 60fps, two frequencies plus a little jitter.
const N = 120;
const T = Array.from({ length: N }, (_, i) => i / 60);
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const V = T.map((t) => Math.sin(t * 5) + 0.3 * Math.sin(t * 17) + 0.002 * rnd());
const range = Math.max(...V) - Math.min(...V);

// ── the bound, bezier ──────────────────────────────────────────────────────────
for (const tol of [0.005, 0.02, 0.08]) {
  const keep = decimateKeys(T, [{ v: V, norm: range }], { mode: 'tolerance', tolerance: tol });
  const e = maxErr(T, V, keep, false, range);
  check(`bezier within tolerance ${tol} (${N} -> ${count(keep)} keys, worst ${e.toFixed(4)})`, e <= tol * 1.05);
  check(`tolerance ${tol} actually removed keys`, count(keep) < N * 0.6);
}

// ── the bound, linear (rotation/scale playback) ────────────────────────────────
{
  const tol = 0.02;
  const keep = decimateKeys(T, [{ v: V, norm: range, linear: true }], { mode: 'tolerance', tolerance: tol });
  const e = maxErr(T, V, keep, true, range);
  check(`linear playback within tolerance (worst ${e.toFixed(4)})`, e <= tol * 1.05);
}

// ── ends, masks, ratio ─────────────────────────────────────────────────────────
{
  const keep = decimateKeys(T, [{ v: V, norm: range }], { mode: 'tolerance', tolerance: 10 });
  check('first and last keys always survive', keep[0] === 1 && keep[N - 1] === 1);
  const mask = T.map((_, i) => i < 40 || i > 80);
  const k2 = decimateKeys(T, [{ v: V, norm: range }], { mode: 'tolerance', tolerance: 10, removable: mask });
  check('keys outside the removable set are untouched', k2.slice(40, 81).every((x) => x === 1));
  const k3 = decimateKeys(T, [{ v: V, norm: range }], { mode: 'ratio', ratio: 0.25 });
  check(`ratio 0.25 keeps a quarter of the interior keys (${count(k3) - 2} of ${N - 2})`, count(k3) - 2 === Math.round((N - 2) * 0.25));
  const line = T.map((t) => 3 * t - 1);
  // 1e-4, not smaller: the bezier time solve stops at 1e-5, and the slider's floor is 1e-3.
  const k4 = decimateKeys(T, [{ v: line, norm: 3 }], { mode: 'tolerance', tolerance: 1e-4 });
  check('a straight line simplifies to its two ends', count(k4) === 2);
}

// The registry side (per-channel simplify on sparse keys) is in sparsekeys_test.mjs.

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
