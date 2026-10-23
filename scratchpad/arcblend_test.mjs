// Arc blendshapes: a grid swung 30 deg about a hinge must land on the hinge circle mid-blend.
import { arcBasis } from '../src/editing/ArcBlend.js';
const N = 20, nv = N * N, base = new Float32Array(nv * 3), d = new Float32Array(nv * 3);
const hinge = [0, 5, -3], th = 30 * Math.PI / 180;   // rotate about the x axis through hinge
const rot = (p, a) => { const y = p[1] - hinge[1], z = p[2] - hinge[2];
  return [p[0], hinge[1] + y * Math.cos(a) - z * Math.sin(a), hinge[2] + y * Math.sin(a) + z * Math.cos(a)]; };
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const v = i * N + j, p = [i * 0.5, -j * 0.5, 0.3 * Math.sin(i)];
  base.set(p, v * 3); const q = rot(p, th); for (let k = 0; k < 3; k++) d[v * 3 + k] = q[k] - p[k];
}
const ring = (v) => { const i = (v / N) | 0, j = v % N, o = [];
  for (const [a, b] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < N && y < N) o.push(x * N + y); } return o; };
const t0 = performance.now(); const B = arcBasis(base, d, ring, nv); const ms = performance.now() - t0;
let errArc = 0, errLin = 0, errEnd = 0;
for (let v = 0; v < nv; v++) {
  const p = [...base.subarray(v * 3, v * 3 + 3)];
  for (const w of [0.25, 0.5, 0.75]) {
    const truth = rot(p, th * w);
    for (let k = 0; k < 3; k++) {
      const i = v * 3 + k, arc = p[k] + w * B.b1[i] + w * w * B.b2[i] + w ** 3 * B.b3[i];
      errArc = Math.max(errArc, Math.abs(arc - truth[k])); errLin = Math.max(errLin, Math.abs(p[k] + w * d[i] - truth[k]));
    }
  }
  for (let k = 0; k < 3; k++) { const i = v * 3 + k; errEnd = Math.max(errEnd, Math.abs(B.b1[i] + B.b2[i] + B.b3[i] - d[i])); }
}
console.log({ ms: ms.toFixed(1), turned: B.turned, errArc: errArc.toExponential(2), errLin: errLin.toFixed(3), errEnd: errEnd.toExponential(2) });
const ok = errArc < errLin / 50 && errEnd < 1e-5;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
