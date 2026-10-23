// ShapeRetarget: deformation transfer of blendshape offsets onto a sculpted neutral.
// node scratchpad/retarget_test.mjs   (RT_INJECT=1 drops the edge term: the scale check must fail)
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../src/editing/ShapeRetarget.js', import.meta.url), 'utf8');
if (process.env.RT_INJECT === '1') {
  const anchor = 'const g = [S[0] * fx';
  if (!src.includes(anchor)) throw new Error('anchor moved');
  src = src.replace(anchor, 'const g0 = [S[0] * fx').replace('// Edge equation d_j - d_i = G f.', 'const g = [0, 0, 0];');
}
const { triangles, prepare, retargetDelta } = await import('data:text/javascript,' + encodeURIComponent(src));

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };

// A UV sphere (quads, triangle caps) plus a separate small sphere: a part with no fixed vertex.
function sphere(R, cx, nu, nvr, P, F, off) {
  for (let i = 0; i <= nvr; i++) for (let j = 0; j < nu; j++) {
    const th = Math.PI * i / nvr, ph = 2 * Math.PI * j / nu;
    P.push(cx + R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph));
  }
  for (let i = 0; i < nvr; i++) for (let j = 0; j < nu; j++) {
    const a = off + i * nu + j, b = off + i * nu + (j + 1) % nu, c = b + nu, d = a + nu;
    F.push(a, b, c, d);
  }
  return off + (nvr + 1) * nu;
}
const P = [], F = [];
let nv = sphere(10, 0, 32, 24, P, F, 0);
const eye0 = nv;
nv = sphere(1.5, 20, 12, 10, P, F, nv);
const ref = Float32Array.from(P), faces = Uint32Array.from(F), tris = triangles(faces, F.length / 4);

// The shape: a smooth bump on the big sphere, and the small sphere turned 20 deg about z AND
// lifted 2 (a part with no fixed vertex, like the lower teeth in jawOpen: its travel must scale too).
const d = new Float32Array(nv * 3);
for (let v = 0; v < eye0; v++) {
  const x = ref[v * 3], y = ref[v * 3 + 1], z = ref[v * 3 + 2];
  const w = Math.max(0, 1 - Math.hypot(x - 10, y, z) / 6) ** 2;
  d[v * 3] = 2 * w; d[v * 3 + 1] = 1.5 * w;
}
const a = 20 * Math.PI / 180;
for (let v = eye0; v < nv; v++) {
  const x = ref[v * 3] - 20, y = ref[v * 3 + 1];
  d[v * 3] = x * Math.cos(a) - y * Math.sin(a) - x; d[v * 3 + 1] = x * Math.sin(a) + y * Math.cos(a) - y + 2;
}
const maxDiff = (A, B) => { let m = 0; for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs(A[i] - B[i])); return m; };
const peak = maxDiff(d, new Float32Array(d.length));

// 1) Unchanged neutral -> the source offset.
let t0 = performance.now();
const same = retargetDelta(prepare(ref, ref, tris, nv), d);
check('unchanged neutral returns the source offset', maxDiff(same, d) < 1e-3 * peak, `(${maxDiff(same, d).toExponential(2)}, ${(performance.now() - t0).toFixed(0)} ms)`);

// 2) Neutral scaled 2x -> offsets scale 2x (the floating part too: it turns, it does not slide).
const big = ref.map((x) => 2 * x);
const out2 = retargetDelta(prepare(ref, big, tris, nv), d);
const d2 = d.map((x) => 2 * x);
check('2x neutral gives a 2x shape', maxDiff(out2, d2) < 0.02 * 2 * peak, `(${(maxDiff(out2, d2) / (2 * peak) * 100).toFixed(2)}% of peak)`);

// 3) Neutral turned 90 deg about y -> offsets turned with it.
const rot = (A) => { const o = new Float32Array(A.length); for (let i = 0; i < A.length; i += 3) { o[i] = A[i + 2]; o[i + 1] = A[i + 1]; o[i + 2] = -A[i]; } return o; };
const out3 = retargetDelta(prepare(ref, rot(ref), tris, nv), d);
check('turned neutral gives a turned shape', maxDiff(out3, rot(d)) < 0.02 * peak, `(${(maxDiff(out3, rot(d)) / peak * 100).toFixed(2)}% of peak)`);

// 4) Untouched vertices stay exactly 0.
let leaked = 0;
for (let v = 0; v < nv; v++) if (d[v * 3] === 0 && d[v * 3 + 1] === 0 && d[v * 3 + 2] === 0 && (out2[v * 3] || out2[v * 3 + 1] || out2[v * 3 + 2])) leaked++;
check('a vertex the shape leaves alone stays at 0', leaked === 0, `(${leaked})`);

console.log(fails ? `${fails} FAILURE(S)` : 'all checks passed');
process.exit(fails ? 1 : 0);
