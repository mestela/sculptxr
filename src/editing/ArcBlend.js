/**
 * ARC BLENDSHAPES — a shape that turns the skin moves it on an arc, not a straight line.
 *
 * A blendshape is a straight line per vertex: at half weight every point is half way along its
 * delta. A jaw swings on a hinge, so half of jawOpen pulls the chin up and in toward the hinge
 * (the chord) instead of out along the swing, and a chin pull straight down reads as a mix of
 * other shapes because jawOpen's delta points down AND back.
 *
 * THE ARC COMES FROM THE SHAPE ITSELF. Each moving vertex's neighbourhood is fitted with the
 * rotation the shape applies to it (rest -> rest + delta). That rotation's axis and angle, with
 * the vertex's own delta as the chord, give exactly one circle: for a rigid part it is the circle
 * about the real hinge. The part of the delta along the axis stays a straight line. Where nothing
 * turns, the arc is the old straight line.
 *
 * STORED AS A CUBIC IN THE WEIGHT: offset(w) = w b1 + w^2 b2 + w^3 b3, interpolating the true
 * arc at 1/3, 2/3 and 1. Three fixed arrays with scalar coefficients, so everything downstream
 * that sums [delta, coefficient] terms (the composite, the sculpt-capture subtraction, the skin's
 * mush cache, the sparse index) works unchanged. At w = 1 the three sum to the delta EXACTLY, so
 * a shape at full strength looks as sculpted and sculpting at weight 1 captures the same delta.
 *
 * Pure maths, no app imports.
 */

// Below this the neighbourhood did not turn: a straight line (radians, ~1.1 deg).
const MIN_ANGLE = 0.02;
// Past this the circle is mostly behind the chord; held here.
const MAX_ANGLE = 2.6;

// Rings of neighbours each vertex's rotation is fitted over. One ring of scanned skin is nearly
// flat; measured on the ICT jaw, 1 to 6 rings gave the same angles (median 25 deg over the jaw)
// at up to 2.5x the time, so two.
const DEPTH = 2;

// Cubic through (0,0), (1/3,f1), (2/3,f2), (1,f3): [b1 b2 b3] = INV * [f1 f2 f3].
const INV = (() => {
  const t = [1 / 3, 2 / 3, 1];
  const M = t.map((x) => [x, x * x, x * x * x]);
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), out = [[], [], []];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const m = M.filter((_, r) => r !== j).map((row) => row.filter((_, c) => c !== i));
    out[i][j] = ((i + j) % 2 ? -1 : 1) * (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / D;
  }
  return out;
})();

// The rotation part of A (Mueller et al. 2016, "A Robust Method to Extract the Rotational Part of
// Deformations"): iterate a quaternion toward the polar rotation. `q` is warm-started (xyzw).
function extractRotation(A, q, iters) {
  for (let it = 0; it < iters; it++) {
    const [x, y, z, w] = q;
    // Columns of R(q).
    const r0 = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    const r1 = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    const r2 = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    const a0 = [A[0], A[3], A[6]], a1 = [A[1], A[4], A[7]], a2 = [A[2], A[5], A[8]];
    const cr = (p, s) => [p[1] * s[2] - p[2] * s[1], p[2] * s[0] - p[0] * s[2], p[0] * s[1] - p[1] * s[0]];
    const c0 = cr(r0, a0), c1 = cr(r1, a1), c2 = cr(r2, a2);
    const dot = r0[0] * a0[0] + r0[1] * a0[1] + r0[2] * a0[2] + r1[0] * a1[0] + r1[1] * a1[1] + r1[2] * a1[2]
      + r2[0] * a2[0] + r2[1] * a2[1] + r2[2] * a2[2];
    const s = 1 / (Math.abs(dot) + 1e-9);
    const ox = (c0[0] + c1[0] + c2[0]) * s, oy = (c0[1] + c1[1] + c2[1]) * s, oz = (c0[2] + c1[2] + c2[2]) * s;
    const ang = Math.hypot(ox, oy, oz);
    if (ang < 1e-7) break;
    const h = ang / 2, k = Math.sin(h) / ang;
    const dx = ox * k, dy = oy * k, dz = oz * k, dw = Math.cos(h);
    // q = dq * q
    q[0] = dw * x + dx * w + dy * z - dz * y;
    q[1] = dw * y - dx * z + dy * w + dz * x;
    q[2] = dw * z + dx * y - dy * x + dz * w;
    q[3] = dw * w - dx * x - dy * y - dz * z;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  }
  return q;
}

// The arc offset at t for chord d, unit axis a, angle th (see the header): the circle through 0
// and d's part across the axis, turning th; the part along the axis is linear.
function arcAt(t, d, a, th, out) {
  const along = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const c = [d[0] - along * a[0], d[1] - along * a[1], d[2] - along * a[2]];
  const L = Math.hypot(c[0], c[1], c[2]);
  if (L < 1e-12) { out[0] = t * d[0]; out[1] = t * d[1]; out[2] = t * d[2]; return; }
  const h = (L / 2) / Math.tan(th / 2);
  // Centre: chord midpoint, h along a x chord-direction.
  const n = [(a[1] * c[2] - a[2] * c[1]) / L, (a[2] * c[0] - a[0] * c[2]) / L, (a[0] * c[1] - a[1] * c[0]) / L];
  const C = [c[0] / 2 + h * n[0], c[1] / 2 + h * n[1], c[2] / 2 + h * n[2]];
  const aC = [a[1] * C[2] - a[2] * C[1], a[2] * C[0] - a[0] * C[2], a[0] * C[1] - a[1] * C[0]];
  const co = Math.cos(t * th), si = Math.sin(t * th);
  for (let j = 0; j < 3; j++) out[j] = C[j] - (co * C[j] + si * aC[j]) + t * along * a[j];
}

// { b1, b2, b3 } for delta `d` over rest positions `base`, or null when nothing in it turns (the
// shape is a straight line and stays one delta). `ring(v)` lists v's neighbouring vertices.
export function arcBasis(base, d, ring, nv, depth = DEPTH) {
  const n = Math.min(nv, d.length / 3, base.length / 3);
  let max = 0;
  for (let v = 0; v < n; v++) max = Math.max(max, Math.abs(d[v * 3]), Math.abs(d[v * 3 + 1]), Math.abs(d[v * 3 + 2]));
  if (!(max > 0)) return null;
  const eps = max * 1e-4;
  const moving = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    moving[v] = Math.abs(d[v * 3]) > eps || Math.abs(d[v * 3 + 1]) > eps || Math.abs(d[v * 3 + 2]) > eps ? 1 : 0;
  }

  // v's neighbourhood out to `depth` rings (v itself not included).
  const mark = new Int32Array(n).fill(-1);
  const gather = (v) => {
    const out = [];
    let front = [v];
    mark[v] = v;
    for (let r = 0; r < depth; r++) {
      const next = [];
      for (const f of front) for (const u of ring(f)) {
        if (u >= n || mark[u] === v) continue;
        mark[u] = v; out.push(u); next.push(u);
      }
      front = next;
    }
    return out;
  };

  // The neighbourhood's rotation per moving vertex, as axis * angle.
  const om = new Float32Array(n * 3);
  const q = [0, 0, 0, 1];
  const A = new Float64Array(9);
  let turned = 0;
  for (let v = 0; v < n; v++) {
    if (!moving[v]) continue;
    const nb = gather(v);
    if (nb.length < 2) continue;
    let px = base[v * 3], py = base[v * 3 + 1], pz = base[v * 3 + 2];
    let qx = px + d[v * 3], qy = py + d[v * 3 + 1], qz = pz + d[v * 3 + 2];
    let cnt = 1;
    for (const u of nb) {
      if (u >= n) continue;
      px += base[u * 3]; py += base[u * 3 + 1]; pz += base[u * 3 + 2];
      qx += base[u * 3] + d[u * 3]; qy += base[u * 3 + 1] + d[u * 3 + 1]; qz += base[u * 3 + 2] + d[u * 3 + 2];
      cnt++;
    }
    px /= cnt; py /= cnt; pz /= cnt; qx /= cnt; qy /= cnt; qz /= cnt;
    A.fill(0);
    const add = (u) => {
      const p0 = base[u * 3] - px, p1 = base[u * 3 + 1] - py, p2 = base[u * 3 + 2] - pz;
      const q0 = base[u * 3] + d[u * 3] - qx, q1 = base[u * 3 + 1] + d[u * 3 + 1] - qy, q2 = base[u * 3 + 2] + d[u * 3 + 2] - qz;
      A[0] += q0 * p0; A[1] += q0 * p1; A[2] += q0 * p2;
      A[3] += q1 * p0; A[4] += q1 * p1; A[5] += q1 * p2;
      A[6] += q2 * p0; A[7] += q2 * p1; A[8] += q2 * p2;
    };
    add(v);
    for (const u of nb) if (u < n) add(u);
    // Warm start from the last vertex fitted: neighbours are mostly neighbours in index order too.
    extractRotation(A, q, 8);
    if (q[3] < 0) { q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; q[3] = -q[3]; }
    const s = Math.hypot(q[0], q[1], q[2]);
    if (s < 1e-9) continue;
    const ang = 2 * Math.atan2(s, q[3]);
    om[v * 3] = q[0] / s * ang; om[v * 3 + 1] = q[1] / s * ang; om[v * 3 + 2] = q[2] / s * ang;
  }

  // Two passes of neighbour averaging over the moving skin: a scanned surface fits noisy local
  // rotations, and a vertex whose arc disagrees with its neighbours' shows as a ripple mid-blend.
  let src = om, dst = new Float32Array(n * 3);
  for (let pass = 0; pass < 2; pass++) {
    for (let v = 0; v < n; v++) {
      if (!moving[v]) continue;
      let x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2], c = 1;
      for (const u of ring(v)) {
        if (u >= n || !moving[u]) continue;
        x += src[u * 3]; y += src[u * 3 + 1]; z += src[u * 3 + 2]; c++;
      }
      dst[v * 3] = x / c; dst[v * 3 + 1] = y / c; dst[v * 3 + 2] = z / c;
    }
    [src, dst] = [dst, src];
  }

  const b1 = new Float32Array(d.length), b2 = new Float32Array(d.length), b3 = new Float32Array(d.length);
  const f1 = [0, 0, 0], f2 = [0, 0, 0], dv = [0, 0, 0], a = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const i = v * 3;
    if (!moving[v]) { b1[i] = d[i]; b1[i + 1] = d[i + 1]; b1[i + 2] = d[i + 2]; continue; }
    const th = Math.hypot(src[i], src[i + 1], src[i + 2]);
    if (th < MIN_ANGLE) { b1[i] = d[i]; b1[i + 1] = d[i + 1]; b1[i + 2] = d[i + 2]; continue; }
    turned++;
    a[0] = src[i] / th; a[1] = src[i + 1] / th; a[2] = src[i + 2] / th;
    dv[0] = d[i]; dv[1] = d[i + 1]; dv[2] = d[i + 2];
    const t = Math.min(th, MAX_ANGLE);
    arcAt(1 / 3, dv, a, t, f1);
    arcAt(2 / 3, dv, a, t, f2);
    for (let j = 0; j < 3; j++) {
      b1[i + j] = INV[0][0] * f1[j] + INV[0][1] * f2[j] + INV[0][2] * dv[j];
      b2[i + j] = INV[1][0] * f1[j] + INV[1][1] * f2[j] + INV[1][2] * dv[j];
      // b3 by difference, so the three sum to the delta exactly in float32.
      b3[i + j] = dv[j] - b1[i + j] - b2[i + j];
    }
  }
  return turned ? { b1, b2, b3, turned } : null;
}
