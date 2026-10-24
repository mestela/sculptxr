// ShapeRetarget.fitParts: keep eyes / teeth / tongue rigid and seated in the skin before a retarget.
// node scratchpad/fit_eyes_test.mjs   (FE_INJECT=1 ignores the lid ring: the lids check must fail)
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../src/editing/ShapeRetarget.js', import.meta.url), 'utf8');
if (process.env.FE_INJECT === '1') {
  const anchor = 'const lidsMoved = ring.length';
  if (!src.includes(anchor)) throw new Error('anchor moved');
  src = src.replace(anchor, 'const lidsMoved = false && ring.length');
}
const { triangles, prepare, retargetDelta, fitParts } = await import('data:text/javascript,' + encodeURIComponent(src));

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };

// Skin: a flat annulus (radius 1.05..3) in z=0 with an eyeball (radius 1) in the hole, and a cap
// (a smaller separate sphere at the front) as a second eye part -- GNM's eyeball + cornea.
const P = [], F = [];
function sphere(R, cz, nu, nvr, off) {
  for (let i = 0; i <= nvr; i++) for (let j = 0; j < nu; j++) {
    const th = Math.PI * i / nvr + 0.01, ph = 2 * Math.PI * j / nu;
    P.push(R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), cz + R * Math.sin(th) * Math.sin(ph));
  }
  for (let i = 0; i < nvr; i++) for (let j = 0; j < nu; j++) {
    const a = off + i * nu + j, b = off + i * nu + (j + 1) % nu;
    F.push(a, b, b + nu, a + nu);
  }
  return off + (nvr + 1) * nu;
}
let nv = 0;
const NU = 32, NR = 12;
for (let i = 0; i <= NR; i++) for (let j = 0; j < NU; j++) {
  const rr = 1.05 + (3 - 1.05) * (i / NR) ** 1.5, ph = 2 * Math.PI * j / NU;
  P.push(rr * Math.cos(ph), rr * Math.sin(ph), 0);
}
for (let i = 0; i < NR; i++) for (let j = 0; j < NU; j++) { const a = i * NU + j, b = i * NU + (j + 1) % NU; F.push(a, b, b + NU, a + NU); }
nv = (NR + 1) * NU;
const skinN = nv;
nv = sphere(1, 0, 16, 12, nv);
nv = sphere(0.3, 0.85, 8, 6, nv);
const eyeEnd = nv;
// An unmoved piece against the eye (upper teeth beside the jaw) and one far off (a hat).
nv = sphere(0.4, -1.6, 8, 6, nv);
const fixedEnd = nv;
nv = sphere(2, 30, 8, 6, nv);
const ref = Float32Array.from(P), tris = triangles(Uint32Array.from(F), F.length / 4);
const isEye = (v) => v >= skinN && v < eyeEnd;

// eyeLookOutLeft: the eye parts turned 15 deg about y round the eye centre. jawOpen: skin only.
const look = new Float32Array(nv * 3), jaw = new Float32Array(nv * 3);
const a = 15 * Math.PI / 180;
for (let v = skinN; v < eyeEnd; v++) {
  const x = ref[v * 3], z = ref[v * 3 + 2];
  look[v * 3] = x * Math.cos(a) + z * Math.sin(a) - x; look[v * 3 + 2] = -x * Math.sin(a) + z * Math.cos(a) - z;
}
for (let v = 0; v < skinN; v++) if (ref[v * 3 + 1] < -2) jaw[v * 3 + 1] = -0.5;
const shapes = new Map([['eyeLookOutLeft', look], ['jawOpen', jaw]]);

const sim = (A, s, t) => A.map((x, i) => s * x + t[i % 3]);
const maxDiff = (A, B, pick = () => true) => { let m = 0; for (let v = 0; v < A.length / 3; v++) if (pick(v)) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(A[v * 3 + k] - B[v * 3 + k])); return m; };

// 1) Lids widened 1.6x and moved: the eye follows exactly, rigid.
{
  const t = [0.7, -0.4, 0.2];
  const target = Float32Array.from(ref);
  for (let v = 0; v < skinN; v++) for (let k = 0; k < 3; k++) target[v * 3 + k] = 1.6 * ref[v * 3 + k] + t[k];
  const { base, parts } = fitParts(ref, target, tris, nv, shapes);
  const want = sim(ref, 1.6, t);
  check('eye follows a widened, moved lid ring', base && maxDiff(base, want, isEye) < 1e-4, `(${base ? maxDiff(base, want, isEye).toExponential(2) : 'no change'}, ${JSON.stringify(parts)})`);
  check('skin left as sculpted', base && maxDiff(base, target, (v) => v < skinN) === 0);
  check('an unmoved piece against a moved part is a part', parts.some((p) => p.key.startsWith('fixed')) && parts.length === 2, `(${parts.map((p) => p.key).join(', ')})`);
  check('a far unmoved piece (a hat) is never touched', maxDiff(base, target, (v) => v >= fixedEnd) === 0);
  // ...and the gaze shape retargeted on that base is the old one at 1.6x.
  const out = retargetDelta(prepare(ref, base || target, tris, nv), look);
  const w = look.map((x) => 1.6 * x);
  check('eyeLook on the fitted eye is the same turn', maxDiff(out, w, isEye) < 0.01 * 1.6 * 0.3, `(${maxDiff(out, w, isEye).toExponential(2)})`);
}

// 2) Lids turned 30 deg about z (a tilted cartoon eye): the eye turns with them.
{
  const b = 30 * Math.PI / 180, target = Float32Array.from(ref), want = Float32Array.from(ref);
  for (let v = 0; v < nv; v++) {
    const x = ref[v * 3], y = ref[v * 3 + 1];
    want[v * 3] = x * Math.cos(b) - y * Math.sin(b); want[v * 3 + 1] = x * Math.sin(b) + y * Math.cos(b);
    if (v < skinN) { target[v * 3] = want[v * 3]; target[v * 3 + 1] = want[v * 3 + 1]; }
  }
  const { base } = fitParts(ref, target, tris, nv, shapes);
  check('eye turns with a turned lid ring', base && maxDiff(base, want, isEye) < 1e-4, `(${base ? maxDiff(base, want, isEye).toExponential(2) : 'no change'})`);
}

// 3) Lids untouched, eye moved and scaled with Transform: kept.
{
  const t = [0.1, 0.2, -0.3], target = Float32Array.from(ref);
  for (let v = skinN; v < eyeEnd; v++) for (let k = 0; k < 3; k++) target[v * 3 + k] = 1.3 * ref[v * 3 + k] + t[k];
  const { base, parts } = fitParts(ref, target, tris, nv, shapes);
  check('a Transform placement is kept', base && maxDiff(base, target) < 1e-4, `(${base ? maxDiff(base, target).toExponential(2) : 'no change'}, ${parts[0]?.by})`);
}

// 4) Lids untouched, eye squashed flat by a brush: rigid again (a similarity of the original).
{
  const target = Float32Array.from(ref);
  for (let v = skinN; v < eyeEnd; v++) target[v * 3 + 1] = 0.5 * ref[v * 3 + 1];
  const { base } = fitParts(ref, target, tris, nv, shapes);
  let ok = !!base;
  if (base) { const s = similarityResidual(ref, base); ok = s < 1e-4; console.log(`     residual ${s.toExponential(2)}`); }
  check('a squashed eye is made rigid again', ok);
}
function similarityResidual(A, B) {
  // Distances between eye vertices must all scale by one factor.
  let lo = Infinity, hi = 0;
  for (let i = skinN; i < eyeEnd; i += 7) for (let j = i + 3; j < eyeEnd; j += 11) {
    const da = Math.hypot(A[i * 3] - A[j * 3], A[i * 3 + 1] - A[j * 3 + 1], A[i * 3 + 2] - A[j * 3 + 2]);
    const db = Math.hypot(B[i * 3] - B[j * 3], B[i * 3 + 1] - B[j * 3 + 1], B[i * 3 + 2] - B[j * 3 + 2]);
    if (da > 0.1) { lo = Math.min(lo, db / da); hi = Math.max(hi, db / da); }
  }
  return hi - lo;
}

// 5) Nothing near the eye sculpted: no change. No eyeLook shapes: no change.
{
  const target = Float32Array.from(ref);
  for (let v = 0; v < skinN; v++) if (ref[v * 3 + 1] < -2.5) target[v * 3 + 2] += 0.3;
  check('a sculpt away from the eye leaves it', fitParts(ref, target, tris, nv, shapes).base === null);
  check('no shape moves a piece whole, no parts', fitParts(ref, target, tris, nv, new Map([['jawOpen', jaw]])).parts.length === 0);
}

console.log(fails ? `${fails} FAILURE(S)` : 'all checks passed');
process.exit(fails ? 1 : 0);
