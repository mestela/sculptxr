// LIPS STAY OUT OF THE TEETH. A smile mixed with a jaw open, a funnel on a jaw sideways, the jiggle
// swinging the lower lip back: each shape was sculpted against still teeth, so the mix (and the
// spring) pushes lip through them. This pushes it back out, after the jiggle and before the skin pass.
//
// DISPLAY ONLY, the lid push's contract: AnimationRegistry.applyBlendshapes adds it and keeps it on
// the track (`_teethPush`), otherLayersOffset subtracts it, so a stroke never bakes it.
//
// Upper teeth are the mouth pieces no jaw shape moves, lower teeth the ones jawOpen moves (tongue*
// movers left out: the tongue is behind the teeth). Each frame each jaw's motion is an AFFINE map
// fitted to its own vertices (affineFit), and the skin is tested in that jaw's rest frame. Not a
// similarity: jawOpen is a blendshape, so the lower teeth travel in straight lines rather than
// swinging -- which is exactly an affine map -- and the best rotation + uniform scale left the heel
// 0.26 off the teeth on average (0.57 at worst) and 7% too big at lunk's jawOpen 1.5.
//
// THE COLLIDER IS A HEEL per jaw, not the teeth: lips rest on the arch's outline, never in the gaps
// between teeth or on each crown. The arch is the teeth's outermost radius round a centre behind the
// jaw, per angle across the mouth, smoothed; the heel is that arch swept from the teeth's bottom to
// their top. Its distances are analytic, so neighbouring skin is always pushed alike.
//  SIDES: skin in front of the arch at rest only ever leaves by the FRONT (out along the arch's
//    normal, faded off above and below the teeth); skin above or below the teeth at rest, inside the
//    arch, only ever leaves up or down (faded off toward the arch's front). A rounded box picked the
//    nearest exit, and deep in, neighbouring lip vertices left by different faces -- one pushed down,
//    the next forward: facets. (StretchMesh's curve-capsule collider,
// matt's "two heel shapes".) History: a distance grid built from the teeth themselves carried every
// tooth's bumps into the lip, and the smoothing it then needed (push / relax x16) cost 1.2 ms and
// still left the lip crunchy.
//
// ONE PASS, then a BULGE (iCollide, Ingo Clemens): skin pushed out moves its neighbours out too,
// fading over a few rings, so a contact reads as soft flesh pressed on the teeth, not a crease. The
// push is dilated over the skin then smoothed (dilation alone stepped, ring by ring: facets), never
// below what touching skin needs. Touching skin goes out along the heel's gradient; skin that only
// bulges goes straight out from the arch (the gradient turns up/down past the heel's top/bottom,
// and lifted the skin above the gum line into a ridge).
//
// DELTA MUSH over the push (Mancewicz et al.), last: the pose before the push is the "rest", so the
// shapes keep what was sculpted and only the PUSH is mushed. Each vertex's offset from a smoothed
// copy of the pre-push pose, in that smoothed surface's local frame, is put back on a smoothed copy
// of the pushed pose. Kinks the push put in the lip (where touching skin meets bulging skin) smooth
// out; the lip's own creases come back. matt: "kinks in the lip shapes that i don't think should be
// there".
//
// LIPS MEET ON A RIBBON (before the teeth, in the same pass, sharing the bulge and the mush): the
// upper lip stays above it and the lower below, so crossing lips meet on it instead of passing.
// Not lip against lip -- a parametric ribbon between them, rebuilt each frame from the lips' own
// edges: RIBBON_K stations across the mouth, each `teeth.meet` of the way from the lower lip's edge
// to the upper's (matt: most of the time halfway, occasionally favoured up or down), with the
// mouth corners as its ends. Open lips are each on their own side already, so nothing moves.
// GNM heads only: the lips are its upper_lip / lower_lip regions, the corners its landmarks.
//
// SKIN NEVER MOVES AT REST: only skin outside the heel at rest is tested, pushed back to the
// clearance it had then (down to CLEAR), eased over a soft zone no wider than that.
// LIPS KEEP THEIR THICKNESS: with the lips and mouth bag known (GNM's upper_lip/lower_lip and
// mouth_sock regions), a lip vertex keeps `teeth.keep` of its rest distance to the bag as clearance, so the
// lip squashes against the teeth rather than thinning to nothing. LIPS ONLY: on all skin it held
// the chin and cheeks off the teeth by half their distance to the bag and crumpled the lower face.
// The bag itself is not tested (hidden; pushed on its own, the pocket in front of the lower gum
// spiked): it follows the lips round it through the bulge.
import { components, similarity } from './ShapeRetarget.js';

// The affine map taking the `idx` vertices of `src` onto those of `dst`, least squares:
// p -> A (p - mr) + mc, A row-major, with its inverse Ai. Null when the points are degenerate
// (flat), and the caller falls back to a similarity.
function affineFit(src, dst, idx) {
  const n = idx.length, mr = [0, 0, 0], mc = [0, 0, 0];
  for (const v of idx) for (let k = 0; k < 3; k++) { mr[k] += src[v * 3 + k] / n; mc[k] += dst[v * 3 + k] / n; }
  const S = new Float64Array(9), C = new Float64Array(9);   // sum r r^T, sum c r^T
  for (const v of idx) {
    const r0 = src[v * 3] - mr[0], r1 = src[v * 3 + 1] - mr[1], r2 = src[v * 3 + 2] - mr[2], r = [r0, r1, r2];
    const c = [dst[v * 3] - mc[0], dst[v * 3 + 1] - mc[1], dst[v * 3 + 2] - mc[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { S[i * 3 + j] += r[i] * r[j]; C[i * 3 + j] += c[i] * r[j]; }
  }
  const Si = inv3(S);
  if (!Si) return null;
  const A = mul3(C, Si), Ai = inv3(A);
  return Ai ? { A, Ai, mr, mc } : null;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12)) return null;
  const k = 1 / det;
  return [A * k, (c * h - b * i) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, (c * d - a * f) * k, C * k, (b * g - a * h) * k, (a * e - b * d) * k];
}
function mul3(x, y) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = x[i * 3] * y[j] + x[i * 3 + 1] * y[3 + j] + x[i * 3 + 2] * y[6 + j];
  return o;
}
// A jaw's fit this frame, as an affine map either way (a similarity's A = s R).
function jawFit(base, v, idx) {
  const f = affineFit(base, v, idx);
  if (f) return f;
  const { R, s, ms, md } = similarity(base, v, idx);
  const A = R.map((x) => x * s);
  return { A, Ai: inv3(A) || [1, 0, 0, 0, 1, 0, 0, 0, 1], mr: ms, mc: md };
}

const NA = 32;          // arch samples across the mouth
const NY = 4;
const SMOOTH_ARCH = 6;  // smoothing passes over the arch radii (across and up)           // ...and up the teeth: the heel leans and tapers with them (a vertical wall
                        // at the incisors' tips stood proud of the gums, and pushed the lip above out)
const BACK = 0.6;
const NEAR = 0.3;       // the heel takes the teeth and their gum this far from the biting edge (half-widths)
const EDGE_SPAN = 4;    // ...the biting edge taken as the highest within this many of its 4 x NA bins round the arch
const CROWN = 0.08;     // ...and only as far round the arch as there are crowns, this close to the edge
const GUM = 0.03;
const RISE = 0.06;      // ...and at the arch's back ends may widen by at most this per sample       // ...and no band of it further out than the crowns' band by more than this       // the arch's centre this far behind the back teeth, in half-widths
const BAND = 0.35;      // skin tested: rest clearance off the heel within this many jaw half-widths
const PAD = 0.15;       // the heel's push fades off over this, past its top/bottom or front edge (half-widths)
const FADE = 2;         // arch samples at each end the heel fades out over (the arch turns back there)
const CLEAR = 0.01;     // clearance pushed to, in half-widths
const FIT = 200;        // vertices the per-frame jaw fit uses
const RINGS = 10;
const RIBBON_K = 12;    // lip ribbon stations between the corners
const LIP_DEPTH = 0.35; // the ribbon reaches this far in front of / behind the lips' seam (mouth half-widths)
const LIP_FADE = 0.15;  // ...fading out over this past it
const LIP_TOL = 0.03;   // lip skin up to this far on the wrong side at rest still counts (GNM's lips overlap a hair)
const LIP_CLEAR = 0.005;       // the region the bulge may use: tested skin + this many rings (past reach + smooth)

// The tunables (sliders in the Face section, under the jiggle's; persisted by jiggleSettings.js).
// `rev` moves on every change so Jiggle.tickJiggle recomposites.
//  strength: how much of the push is applied; keep: of the lip's rest thickness kept off the teeth;
//  clear: extra clearance (half-widths); soft: the soft contact zone (half-widths); reach: rings the
//  bulge dilates over; spread: of the push kept per ring; smooth: averaging passes after.
//  mush: how much of the delta-mushed result is used; passes: its smoothing passes.
// With the mush on, the bulge's own smoothing buys nothing (crunch identical at reach 2 / smooth 0
// and reach 4 / smooth 3 on teethcollide.sxr) and the mush's area follows reach + smooth: 1.26 ms
// against 2.19.
//  lipStrength / meet / lipSoft: the lip ribbon's (meet: 0 at the lower lip's edge, 1 at the upper's).
export const teeth = { strength: 1, keep: 0.5, clear: 0, soft: 0.05, reach: 2, spread: 0.7, smooth: 0, mush: 1, passes: 6, lipStrength: 0.5, meet: 0.5, lipSoft: 0.15, rev: 0 };

// Integer slider units, as JIGGLE_SLIDERS: `to` slider -> setting, `ui` setting -> slider.
export const TEETH_SLIDERS = [
  { key: 'strength', label: 'Strength', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'keep', label: 'Lip Thickness', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'clear', label: 'Clearance', min: -10, max: 20, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v > 0 ? '+' : ''}${v}%` },
  { key: 'soft', label: 'Softness', min: 0, max: 20, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'reach', label: 'Bulge Reach', min: 0, max: 6, to: (v) => v, ui: (x) => x, fmt: (v) => `${v} rings` },
  { key: 'spread', label: 'Bulge Falloff', min: 30, max: 95, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'smooth', label: 'Bulge Smooth', min: 0, max: 4, to: (v) => v, ui: (x) => x, fmt: (v) => `${v}` },
  { key: 'mush', label: 'Mush', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'passes', label: 'Mush Passes', min: 1, max: 20, to: (v) => v, ui: (x) => x, fmt: (v) => `${v}` },
];

// The lip ribbon's sliders (the Lip Collision group); stored in `teeth` like the rest.
export const LIP_SLIDERS = [
  { key: 'lipStrength', label: 'Strength', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'meet', label: 'Meet Height', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  // Softness reads as a share of its range: 100% = 0.15 half-widths.
  { key: 'lipSoft', label: 'Softness', min: 0, max: 100, to: (v) => v * 0.0015, ui: (x) => Math.round(x / 0.0015), fmt: (v) => `${v}%` },
];

// The jaws' heels from the rest shape, or null (no jawOpen, or nothing it moves off the skin).
// `lips`: { bag, lip } 0/1 masks of the mouth bag's and the lips' vertices, or null when not known.
export function buildTeeth(base, tris, nv, shapes, lips = null) {
  const jaw = shapes.get('jawOpen');
  if (!jaw) return null;
  const comps = components(tris, nv);
  if (comps.length < 2) return null;
  const moves = (d, v) => d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0;
  const tongue = [...shapes].filter(([n]) => /^tongue/i.test(n)).map(([, d]) => d);
  const bounds = (idx) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of idx) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], base[v * 3 + k]); hi[k] = Math.max(hi[k], base[v * 3 + k]); }
    return { lo, hi, r: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
  };
  // By VERTEX, not piece: GNM's teeth, gums and tongue are one piece.
  const lower = [], still = [];
  for (const c of comps.slice(1)) {
    const lo = [], st = [];
    for (const v of c) if (!tongue.some((d) => moves(d, v))) (moves(jaw, v) ? lo : st).push(v);
    lower.push(...lo);
    still.push(st);
  }
  if (!lower.length) return null;
  // Unmoved pieces near the lower teeth are the upper teeth (an eye or a hat is not).
  const B = bounds(lower), upper = [];
  for (const st of still) {
    if (!st.length) continue;
    const b = bounds(st);
    if ([0, 1, 2].every((k) => b.lo[k] <= B.hi[k] + B.r && b.hi[k] >= B.lo[k] - B.r)) upper.push(...st);
  }
  const inMouth = new Uint8Array(nv);
  for (const c of comps.slice(1)) for (const v of c) inMouth[v] = 1;
  // Lip thickness: each lip vertex's rest distance to the nearest bag vertex, by a grid.
  let thick = null;
  if (lips) {
    const { bag, lip } = lips;
    const cell = B.r * 0.25, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
    for (let v = 0; v < nv; v++) {
      if (!bag[v]) continue;
      const h = key(Math.floor(base[v * 3] / cell), Math.floor(base[v * 3 + 1] / cell), Math.floor(base[v * 3 + 2] / cell));
      let c = grid.get(h);
      if (!c) grid.set(h, c = []);
      c.push(v);
    }
    thick = new Float32Array(nv).fill(Infinity);
    for (let v = 0; v < nv; v++) {
      if (!lip[v] || bag[v]) continue;
      const x = base[v * 3], y = base[v * 3 + 1], z = base[v * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const c = grid.get(key(cx + i, cy + j, cz + k));
        if (c) for (const u of c) thick[v] = Math.min(thick[v], Math.hypot(base[u * 3] - x, base[u * 3 + 1] - y, base[u * 3 + 2] - z));
      }
    }
    // Smoothed over the lip: the nearest bag vertex jumps from one lip vertex to the next, and the
    // clearance (so the pushed lip's surface) jumped with it -- crunchy.
    for (let pass = 0; pass < 6; pass++) {
      const sum = new Float32Array(nv), cnt = new Uint16Array(nv);
      for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = tris[t + k], b = tris[t + (k + 1) % 3];
        if (thick[a] < Infinity && thick[b] < Infinity) { sum[a] += thick[b]; cnt[a]++; sum[b] += thick[a]; cnt[b]++; }
      }
      for (let v = 0; v < nv; v++) if (cnt[v] && thick[v] < Infinity) thick[v] = 0.5 * thick[v] + 0.5 * sum[v] / cnt[v];
    }
  }
  const skip = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) skip[v] = inMouth[v] || (lips && lips.bag[v]) ? 1 : 0;
  const jaws = [[upper, -1], [lower, 1]].filter(([t]) => t.length).map(([t, bite]) => makeJaw(base, crowns(base, t, bite), bite, nv, skip, thick));
  if (!jaws.length) return null;
  const lip = lips && lips.upper && lips.corners ? buildLip(base, tris, nv, lips) : null;
  return { jaws, lip, ...region(jaws, tris, nv, inMouth, lip, base) };
}

// THE LIP RIBBON's fixed parts: the lip skin it tests (`cand`, `side` +1 upper / -1 lower) and, per
// station, the edge vertices (and weights) its upper and lower points are read from. The edges are
// the lip vertices touching the mouth bag or the other lip; a station at a fraction of the way from
// one corner to the other takes the two edge vertices either side of it in x.
function buildLip(base, tris, nv, lips) {
  const { upper, lower, bag, corners: [cL, cR] } = lips;
  const nb = Array.from({ length: nv }, () => null);
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k], b = tris[t + (k + 1) % 3];
    (nb[a] || (nb[a] = [])).push(b);
  }
  const edge = (mine, other) => {
    const e = [];
    for (let v = 0; v < nv; v++) if (mine[v] && nb[v] && nb[v].some((u) => bag[u] || other[u])) e.push(v);
    return e.sort((a, b) => base[a * 3] - base[b * 3]);
  };
  const ue = edge(upper, lower), le = edge(lower, upper);
  if (ue.length < 2 || le.length < 2) return null;
  const xa = Math.min(base[cL * 3], base[cR * 3]), xb = Math.max(base[cL * 3], base[cR * 3]);
  const first = base[cL * 3] < base[cR * 3] ? cL : cR, last = first === cL ? cR : cL;
  const pick = (list, x) => {
    let i = 0;
    while (i < list.length - 2 && base[list[i + 1] * 3] < x) i++;
    const a = list[i], b = list[i + 1], ax = base[a * 3], bx = base[b * 3];
    const t = bx > ax ? Math.min(1, Math.max(0, (x - ax) / (bx - ax))) : 0.5;
    return [a, b, t];
  };
  const U = [], L = [];
  for (let k = 1; k <= RIBBON_K; k++) {
    const x = xa + (xb - xa) * k / (RIBBON_K + 1);
    U.push(pick(ue, x)); L.push(pick(le, x));
  }
  const cand = [], side = [];
  for (let v = 0; v < nv; v++) if ((upper[v] || lower[v]) && !bag[v]) { cand.push(v); side.push(upper[v] ? 1 : -1); }
  return { first, last, U, L, cand, side: Int8Array.from(side), w: (xb - xa) / 2 || 1,
    rest: new Float64Array((RIBBON_K + 2) * 3), now: new Float64Array((RIBBON_K + 2) * 3) };
}

// How the ribbon is drawn (TeethViz): its strip reaches `depth` front and back of the stations.
export function ribbonStrip(lip) { return { depth: LIP_DEPTH * lip.w }; }

// The ribbon's stations for positions `p`, into `out` (x, y, z per station, corner to corner).
function ribbon(lip, p, meet, out) {
  const put = (k, x, y, z) => { out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z; };
  put(0, p[lip.first * 3], p[lip.first * 3 + 1], p[lip.first * 3 + 2]);
  put(RIBBON_K + 1, p[lip.last * 3], p[lip.last * 3 + 1], p[lip.last * 3 + 2]);
  for (let k = 0; k < RIBBON_K; k++) {
    const [ua, ub, ut] = lip.U[k], [la, lb, lt] = lip.L[k];
    for (let c = 0; c < 3; c++) {
      const u = p[ua * 3 + c] + (p[ub * 3 + c] - p[ua * 3 + c]) * ut, l = p[la * 3 + c] + (p[lb * 3 + c] - p[la * 3 + c]) * lt;
      out[(k + 1) * 3 + c] = l + (u - l) * meet;
    }
  }
}

// The ribbon at `x`: its height RY, depth RZ, slope RS (dy/dx) and how much counts there RW (it
// fades into the corners). False past the corners.
let RY = 0, RZ = 0, RS = 0, RW = 1;
function onRibbon(R, x) {
  const n = RIBBON_K + 2;
  if (!(x > R[0] && x < R[(n - 1) * 3])) return false;
  let i = 0;
  while (i < n - 2 && R[(i + 1) * 3] < x) i++;
  const x0 = R[i * 3], x1 = R[(i + 1) * 3], t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  RY = R[i * 3 + 1] + (R[(i + 1) * 3 + 1] - R[i * 3 + 1]) * t;
  RZ = R[i * 3 + 2] + (R[(i + 1) * 3 + 2] - R[i * 3 + 2]) * t;
  RS = x1 > x0 ? (R[(i + 1) * 3 + 1] - R[i * 3 + 1]) / (x1 - x0) : 0;
  const span = (R[(n - 1) * 3] - R[0]) / (n - 1);
  RW = smooth(0, span, Math.min(x - R[0], R[(n - 1) * 3] - x));
  return true;
}

// THE CROWNS AND THE GUM NEXT TO THEM: a jaw's mouth piece, less what lies more than NEAR from the
// teeth's biting edge. The edge is found per angle round the arch (the lowest point for the upper
// jaw, `bite` -1; the highest for the lower, +1), so the molars' lower crowns keep their own gum. The
// whole piece took the gum's wide base behind the back teeth, and the lower heel flared out past the
// molars (matt: "the back teeth do not match to the orange collider shape").
function crowns(base, teeth, bite) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity;
  for (const v of teeth) { x0 = Math.min(x0, base[v * 3]); x1 = Math.max(x1, base[v * 3]); z0 = Math.min(z0, base[v * 3 + 2]); }
  const r = (x1 - x0) / 2 || 1, cx = (x0 + x1) / 2, cz = z0 - BACK * r, near = NEAR * r;
  const bin = (v) => Math.round((Math.atan2(base[v * 3] - cx, base[v * 3 + 2] - cz) + Math.PI) / (2 * Math.PI) * 4 * NA);
  const edge = new Map();
  for (const v of teeth) {
    const b = bin(v), y = base[v * 3 + 1] * bite;
    if (!(edge.get(b) >= y)) edge.set(b, y);
  }
  // A bin's edge is the highest within EDGE_SPAN bins either side: a gap between teeth does not drop
  // it, and the gum pad behind the last molar (no tooth there, so its own top is gum) is measured
  // against the molar beside it and left out -- it kinked the lower heel's back ends outward.
  const top = (b) => {
    let e = -Infinity;
    for (let d = -EDGE_SPAN; d <= EDGE_SPAN; d++) e = Math.max(e, edge.get(b + d) ?? -Infinity);
    return e;
  };
  // ...and only round the arch as far as there are CROWNS (within CROWN of the edge): past the last
  // molar there is only the gum pad, whose own top is gum, and it all passed the test above.
  const crown = CROWN * r;
  let lo = Infinity, hi = -Infinity;
  for (const v of teeth) if (top(bin(v)) - base[v * 3 + 1] * bite <= crown) { const b = bin(v); lo = Math.min(lo, b); hi = Math.max(hi, b); }
  return teeth.filter((v) => { const b = bin(v); return b >= lo && b <= hi && top(b) - base[v * 3 + 1] * bite <= near; });
}

function makeJaw(base, teeth, bite, nv, skip, thick) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (const v of teeth) {
    const x = base[v * 3], y = base[v * 3 + 1];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, base[v * 3 + 2]);
  }
  const r = (x1 - x0) / 2 || 1;
  // The arch: round a centre behind the jaw, the teeth's outermost radius per angle (0 = straight
  // ahead, +z), gaps filled, then smoothed so no single tooth shows. Centred AT the back teeth,
  // they sat on the centre and the arch's radius fell to nothing at its ends.
  const cx = (x0 + x1) / 2, cz = z0 - BACK * r;
  let a0 = Infinity, a1 = -Infinity;
  for (const v of teeth) {
    const a = Math.atan2(base[v * 3] - cx, base[v * 3 + 2] - cz);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
  }
  // One arch per height band (row j covers band j of NY between the teeth's bottom and top); R is
  // row-major, NA per row.
  const da = (a1 - a0) / (NA - 1) || 1, dy = (y1 - y0) / NY || 1, R = new Float64Array(NA * NY);
  for (const v of teeth) {
    const x = base[v * 3] - cx, z = base[v * 3 + 2] - cz;
    const b = Math.round((Math.atan2(x, z) - a0) / da), j = Math.min(NY - 1, Math.floor((base[v * 3 + 1] - y0) / dy));
    R[j * NA + b] = Math.max(R[j * NA + b], Math.sqrt(x * x + z * z));
  }
  // EMPTY CELLS: first from the nearest filled band at the same angle (up or down the teeth), then a
  // column with nothing in it from its neighbours along the arch. Filling along the band first was
  // wrong once the deep gum went: the upper heel's top band holds only the BACK teeth's gum (their
  // biting edge sits higher), and the front of it took their small radius -- caved in by 3.3.
  for (let b = 0; b < NA; b++) for (let j = 0; j < NY; j++) {
    if (R[j * NA + b]) continue;
    for (let d = 1; d < NY; d++) {
      const lo = j - d >= 0 ? R[(j - d) * NA + b] : 0, hi = j + d < NY ? R[(j + d) * NA + b] : 0;
      if (lo || hi) { R[j * NA + b] = Math.max(lo, hi); break; }
    }
  }
  for (let j = 0; j < NY; j++) {
    const row = R.subarray(j * NA, (j + 1) * NA);
    if (!row.some((x) => x)) continue;
    for (let b = 0; b < NA; b++) if (!row[b]) {
      let p = b - 1, q = b + 1;
      while (p >= 0 && !row[p]) p--;
      while (q < NA && !row[q]) q++;
      row[b] = p < 0 ? row[q] : q >= NA ? row[p] : row[p] + (row[q] - row[p]) * (b - p) / (q - p);
    }
  }
  // NO JUMP OUT AT THE BACK: round a centre behind the jaw an arch narrows from the front teeth to the
  // molars, so over each band's outer quarter either side its radius may rise toward the end only
  // gently (RISE per sample). The gum pad behind the last molar jumped out and kinked the heel's back
  // ends; the premolars and last upper molar do bulge a little, and held to no rise at all lost 0.38
  // of them. Only the outer quarters: held from the peak, one dip in the gum band dragged the whole
  // front of the heel in after it.
  const q = Math.floor(NA / 4), rise = RISE * r;
  for (let j = 0; j < NY; j++) {
    const o = j * NA;
    for (let b = NA - q; b < NA; b++) R[o + b] = Math.min(R[o + b], R[o + b - 1] + rise);
    for (let b = q - 1; b >= 0; b--) R[o + b] = Math.min(R[o + b], R[o + b + 1] + rise);
  }
  // NO GUM PAST THE TEETH: every band no further out than the crowns' band (the one at the biting
  // edge) plus GUM. A flange of gum beside the lower molars, within NEAR of their tops, still pushed
  // the heel's back ends out past them.
  const crownRow = (bite > 0 ? NY - 1 : 0) * NA, gum = GUM * r;
  const cap = () => { for (let j = 0; j < NY; j++) if (j * NA !== crownRow) for (let b = 0; b < NA; b++) R[j * NA + b] = Math.min(R[j * NA + b], R[crownRow + b] + gum); };
  cap();
  // Smoothed along the arch and between bands, never pulled in (the lips rest on the outermost
  // teeth): a band with a gap between teeth or a short tooth in it drew a wavy edge, and a wavy
  // collider pushes a wavy lip.
  for (let pass = 0; pass < SMOOTH_ARCH; pass++) {
    const s = R.slice();
    for (let j = 0; j < NY; j++) for (let b = 0; b < NA; b++) {
      const o = j * NA + b;
      const l = s[o - (b > 0 ? 1 : 0)], rr = s[o + (b < NA - 1 ? 1 : 0)];
      const d = s[o - (j > 0 ? NA : 0)], u = s[o + (j < NY - 1 ? NA : 0)];
      R[o] = Math.max(s[o], 0.5 * s[o] + 0.15 * (l + rr) + 0.1 * (d + u));
    }
  }
  cap();
  const jaw = { cx, cz, a0, da, R, y0, y1, dy, r, fit: [], skin: [], gap: [], thick: [], side: [], now: null };
  const step = Math.max(1, Math.floor(teeth.length / FIT));
  for (let i = 0; i < teeth.length; i += step) jaw.fit.push(teeth[i]);
  // Skin outside the heel at rest, near enough to be pushed, and the side it is on: 0 in front,
  // +1 above, -1 below.
  const band = BAND * r, pad = PAD * r;
  for (let v = 0; v < nv; v++) {
    if (skip[v] || !heel(jaw, base[v * 3], base[v * 3 + 1], base[v * 3 + 2])) continue;
    let side, g;
    if (DH >= 0 && DH < band && DV < pad) { side = 0; g = DH; }
    else if (DH < 0 && DV >= 0 && DV < band) { side = SY; g = DV; }
    else continue;
    jaw.skin.push(v); jaw.gap.push(g); jaw.side.push(side);
    jaw.thick.push(thick && thick[v] < Infinity ? thick[v] : 0);
  }
  return jaw;
}

// The arch's radius at sample position `b` (0 .. NA - 1) and height `y`: Catmull-Rom across the
// samples so the radius and its slope are continuous, linear between the bands' middles (the
// end bands' own value past them). The slopes per radian and per unit height are left in ADR, ADY.
// TeethViz draws from this.
let ADR = 0, ADY = 0;
function rowRadius(R, o, da, b) {
  const i = Math.min(NA - 2, Math.max(0, Math.floor(b))), t = b - i;
  const p0 = R[o + Math.max(0, i - 1)], p1 = R[o + i], p2 = R[o + i + 1], p3 = R[o + Math.min(NA - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  ADR = 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t2) / da;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}
export function archRadius(jaw, b, y) {
  const { R, da, y0, dy } = jaw;
  const c = Math.min(NY - 1, Math.max(0, (y - y0) / dy - 0.5)), j = Math.min(NY - 2, Math.floor(c)), u = c - j;
  const ra = rowRadius(R, j * NA, da, b), sa = ADR;
  const rb = rowRadius(R, (j + 1) * NA, da, b), sb = ADR;
  ADR = sa + (sb - sa) * u;
  const inside = (y - y0) / dy - 0.5 > 0 && (y - y0) / dy - 0.5 < NY - 1;
  ADY = inside ? (rb - ra) / dy : 0;
  return ra + (rb - ra) * u;
}
export const ARCH_SAMPLES = NA;

// Where (x, y, z) (rest frame) is against jaw's heel. False off the arch's ends; else DH the signed
// distance off the arch's outline across it (positive outside), DV off the teeth's top/bottom
// (positive above or below them, negative between), SY which of the two is nearer (+1 top, -1
// bottom), AX, AY, AZ the heel's outward normal, HW how much counts (the arch's ends fade).
let DH = 0, DV = 0, SY = 1, AX = 0, AY = 0, AZ = 1, HW = 1;
function heel(jaw, x, y, z) {
  const { cx, cz, a0, da, y0, y1 } = jaw;
  const px = x - cx, pz = z - cz;
  const a = Math.atan2(px, pz), b = (a - a0) / da;
  if (!(b >= 0 && b <= NA - 1)) return false;
  const Ra = archRadius(jaw, b, y), dR = ADR / Math.max(Ra, 1e-6), dRy = ADY;
  // Across the arch: f = rho - R(a, y), divided by its gradient's length -- radial 1, along the
  // arch -R'/R, up -dR/dy -- for a distance; the gradient itself is the outward normal.
  const rho = Math.sqrt(px * px + pz * pz), l = Math.sqrt(1 + dR * dR + dRy * dRy);
  DH = (rho - Ra) / l;
  // Radial (sin a, cos a), tangent (cos a, -sin a).
  const sa = rho > 0 ? px / rho : 0, ca = rho > 0 ? pz / rho : 1;
  AX = (sa - ca * dR) / l; AZ = (ca + sa * dR) / l; AY = -dRy / l;
  SY = y > (y0 + y1) / 2 ? 1 : -1;
  DV = SY > 0 ? y - y1 : y0 - y;
  const e = Math.min(b, NA - 1 - b) / FADE;
  HW = e >= 1 ? 1 : e * e * (3 - 2 * e);
  return true;
}

// The skin the bulge may spread over (tested skin + RINGS of neighbours, never mouth pieces) with
// each vertex's neighbours inside it, CSR: `nbr[off[k] .. off[k + 1]]` are region slots.
function region(jaws, tris, nv, inMouth, lip, base) {
  const slot = new Int32Array(nv).fill(-1), verts = [];
  for (const jaw of jaws) for (const v of jaw.skin) if (slot[v] < 0) { slot[v] = verts.length; verts.push(v); }
  if (lip) for (const v of lip.cand) if (slot[v] < 0) { slot[v] = verts.length; verts.push(v); }
  const adj = Array.from({ length: nv }, () => null);
  const link = (a, b) => { (adj[a] || (adj[a] = new Set())).add(b); };
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k], b = tris[t + (k + 1) % 3];
    if (inMouth[a] || inMouth[b]) continue;
    link(a, b); link(b, a);
  }
  let front = verts.slice();
  const rings = [verts.length];   // slots before rings[r] are within r rings
  for (let ring = 0; ring < RINGS; ring++) {
    const next = [];
    for (const v of front) if (adj[v]) for (const u of adj[v]) if (slot[u] < 0) { slot[u] = verts.length; verts.push(u); next.push(u); }
    front = next;
    rings.push(verts.length);
  }
  // CUT ALONG THE LIP SEAM: skin above the lip ribbon (at rest) and skin below it are not each
  // other's neighbours, for the bulge and the mush. The lips are pushed apart, upper up and lower
  // down, and smoothing across the seam averaged the two away (mouthShrugLower: lips alone left a
  // 0.16 overlap, with the mush 0.50).
  const lab = new Int8Array(nv);
  if (lip) {
    const R = new Float64Array((RIBBON_K + 2) * 3);
    ribbon(lip, base, 0.5, R);
    const reach = (LIP_DEPTH + LIP_FADE) * lip.w;
    for (const v of verts) if (onRibbon(R, base[v * 3]) && Math.abs(base[v * 3 + 2] - RZ) < reach) lab[v] = base[v * 3 + 1] >= RY ? 1 : -1;
  }
  const off = new Int32Array(verts.length + 1), nbr = [];
  for (let k = 0; k < verts.length; k++) {
    const a = verts[k];
    if (adj[a]) for (const u of adj[a]) if (slot[u] >= 0 && lab[a] * lab[u] >= 0) nbr.push(slot[u]);
    off[k + 1] = nbr.length;
  }
  const n = verts.length;
  // The region's own triangles (slots), for the mush's normals.
  const tri = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = slot[tris[t]], b = slot[tris[t + 1]], c = slot[tris[t + 2]];
    if (a >= 0 && b >= 0 && c >= 0) tri.push(a, b, c);
  }
  // Per-frame scratch: per jaw the push along each vertex's own direction; the pose before the push
  // (O), and the mush's smoothed poses and their normals.
  const f3 = () => new Float32Array(n * 3);
  return {
    region: Int32Array.from(verts), rings, slot, off, nbr: Int32Array.from(nbr), tri: Int32Array.from(tri),
    P: new Float32Array(n), Q: new Float32Array(n), need: new Float32Array(n), up: new Int8Array(n),
    O: f3(), S0: f3(), S1: f3(), N0: f3(), N1: f3(), T: f3(),
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// How far a vertex at clearance `g0` goes out, given the clearance `rest` it had at rest: back to
// min(rest, clear), eased over a soft zone no wider than what it had (EyeCollide's push). 0: none.
function outBy(g0, rest, clear, soft, eps) {
  if (g0 >= rest) return 0;
  const t = Math.min(rest, clear), k = Math.min(soft, rest - t), g = g0 - t;
  if (g >= k - eps) return 0;
  return t + (k > 0 ? (g <= -k ? 0 : (g + k) * (g + k) / (4 * k)) : Math.max(g, 0)) - g0;
}

// Push composite `v` (local) out of the heels, writing the offsets into `push` (zeroed by the
// caller) and adding them into `v`. Returns the moved vertices (empty when nothing touched).
export function collideTeeth(state, base, v, push) {
  const { region: reg, rings, slot, off, nbr, P, Q, need, up } = state;
  const { strength, keep, reach, spread } = teeth, smoothing = teeth.smooth;
  // Only the rings the bulge can reach are worked on; the ring past them stays still, so the push
  // fades to nothing there rather than stopping at an edge.
  const nr = rings[Math.min(rings.length - 1, reach + smoothing)];
  // The pose before the push, over the whole region (the mush reads neighbours past `nr`).
  const { O } = state, nall = reg.length;
  for (let k = 0; k < nall; k++) { const i = reg[k] * 3, j = k * 3; O[j] = v[i]; O[j + 1] = v[i + 1]; O[j + 2] = v[i + 2]; }
  let moved = false;
  // THE LIPS FIRST, so the teeth have the last word on the lip skin they both move.
  const lip = state.lip;
  if (lip && teeth.lipStrength > 0) {
    ribbon(lip, base, teeth.meet, lip.rest);
    ribbon(lip, v, teeth.meet, lip.now);
    const { cand, side, w } = lip, soft = teeth.lipSoft * w, clear = LIP_CLEAR * w, eps = 1e-5 * w, tol = LIP_TOL * w;
    const depth = LIP_DEPTH * w, fade = LIP_FADE * w;
    // Signed distance of a point off ribbon R, on side `sd`, with the depth fade (RW); NaN off it.
    const off_ = (R, p, i, sd) => {
      if (!onRibbon(R, p[i])) return NaN;
      const dz = Math.abs(p[i + 2] - RZ), wd = dz <= depth ? 1 : 1 - smooth(depth, depth + fade, dz);
      RW *= wd;
      return sd * (p[i + 1] - RY) / Math.sqrt(1 + RS * RS);
    };
    need.fill(0); up.fill(0);
    let any = false;
    for (let n = 0; n < cand.length; n++) {
      const c = cand[n], k = slot[c], sd = side[n];
      const g0 = off_(lip.rest, base, c * 3, sd);
      if (!(g0 > -tol) || RW <= 0) continue;
      const g = off_(lip.now, v, c * 3, sd);
      if (g !== g || RW <= 0) continue;
      const m = outBy(g, g0, clear, soft, eps) * RW * teeth.lipStrength;
      if (m <= eps || m <= need[k]) continue;
      need[k] = m; up[k] = sd; any = true;
    }
    if (any) {
      bulge(state, nr, reach, spread, smoothing);
      for (let k = 0; k < nr; k++) {
        const m = P[k];
        if (m <= 1e-5 * w) continue;
        const i = reg[k] * 3;
        if (!onRibbon(lip.now, v[i])) continue;
        // Out along the ribbon's normal (-slope, 1), on the vertex's own side (bulging skin: the side
        // it is on now).
        const sd = up[k] || (v[i + 1] >= RY ? 1 : -1), l = Math.sqrt(1 + RS * RS);
        v[i] += -RS / l * m * sd; v[i + 1] += m * sd / l;
        moved = true;
      }
    }
  }
  for (const jaw of state.jaws) {
    const fit = jaw.now = jawFit(base, v, jaw.fit);
    const { A, Ai, mr, mc } = fit;
    if (!(strength > 0)) continue;
    const { skin, gap, thick, side, r, y0, y1 } = jaw, soft = teeth.soft * r, pad = PAD * r, eps = 1e-5 * r;
    const extra = teeth.clear * r, floor = CLEAR * r;
    // Into the jaw's rest frame: q = Ai (p - mc) + mr. Its height left in y_.
    let y_ = 0;
    const rest = (k) => {
      const i = reg[k] * 3, px = v[i] - mc[0], py = v[i + 1] - mc[1], pz = v[i + 2] - mc[2];
      y_ = Ai[3] * px + Ai[4] * py + Ai[5] * pz + mr[1];
      return heel(jaw, Ai[0] * px + Ai[1] * py + Ai[2] * pz + mr[0], y_, Ai[6] * px + Ai[7] * py + Ai[8] * pz + mr[2]);
    };
    // The push each tested vertex needs, out along the heel's gradient.
    need.fill(0); up.fill(0);
    let any = false;
    for (let n = 0; n < skin.length; n++) {
      const k = slot[skin[n]];
      if (!rest(k)) continue;
      const c = Math.max(floor, keep * thick[n] + extra);
      let m;
      if (side[n] === 0) m = outBy(DH, gap[n], c, soft, eps) * (DV <= 0 ? 1 : 1 - smooth(0, pad, DV));
      else m = outBy(side[n] > 0 ? y_ - y1 : y0 - y_, gap[n], c, soft, eps) * (DH <= -pad ? 1 : DH >= 0 ? 0 : 1 - smooth(-pad, 0, DH));
      m *= HW * strength;
      if (m <= eps || m <= need[k]) continue;
      need[k] = m; up[k] = side[n]; any = true;
    }
    if (!any) continue;
    bulge(state, nr, reach, spread, smoothing);
    // Each vertex out along its own direction off the heel (rest frame), back to local through s R.
    // Off the heel's ends (no direction) it keeps still.
    for (let k = 0; k < nr; k++) {
      const m = P[k];
      if (m <= eps) continue;
      if (!rest(k)) continue;
      // Out of the front along the arch's normal; touching from above/below, up or down.
      const u = need[k] > 0 ? up[k] : 0, dx = u ? 0 : AX * m, dy = u ? u * m : AY * m, dz = u ? 0 : AZ * m;
      const i = reg[k] * 3;
      const lx = A[0] * dx + A[1] * dy + A[2] * dz, ly = A[3] * dx + A[4] * dy + A[5] * dz, lz = A[6] * dx + A[7] * dy + A[8] * dz;
      v[i] += lx; v[i + 1] += ly; v[i + 2] += lz;
      moved = true;
    }
  }
  if (!moved) return [];
  // The mush works a couple of rings past the push (it spreads a ring a pass, but the skin there
  // barely changes); past that, as the push, the skin stays still.
  const nm = rings[Math.min(rings.length - 1, reach + smoothing + 2)];
  if (teeth.mush > 0 && teeth.passes > 0) mush(state, v, nm, teeth.passes, teeth.mush);
  const hit = [], eps = 1e-7 * state.jaws[0].r;
  for (let k = 0; k < nm; k++) {
    const i = reg[k] * 3, j = k * 3;
    const x = v[i] - O[j], y = v[i + 1] - O[j + 1], z = v[i + 2] - O[j + 2];
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= eps) continue;
    push[i] = x; push[i + 1] = y; push[i + 2] = z;
    hit.push(reg[k]);
  }
  return hit;
}

// BULGE: `need` dilated over the skin into P, `spread` of it per ring for `reach` rings, then
// `smoothing` averaging passes never below `need`. Only the first `nr` slots; those past hold 0.
function bulge(state, nr, reach, spread, smoothing) {
  const { off, nbr, P, Q, need } = state;
  P.set(need);
  for (let ring = 0; ring < reach; ring++) {
    Q.set(P);
    for (let k = 0; k < nr; k++) {
      let most = 0;
      for (let e = off[k]; e < off[k + 1]; e++) most = Math.max(most, Q[nbr[e]]);
      if (most * spread > P[k]) P[k] = most * spread;
    }
  }
  for (let pass = 0; pass < smoothing; pass++) {
    Q.set(P);
    for (let k = 0; k < nr; k++) {
      const a = off[k], b = off[k + 1];
      if (a === b) continue;
      let sum = 0;
      for (let e = a; e < b; e++) sum += Q[nbr[e]];
      P[k] = Math.max(need[k], 0.5 * Q[k] + 0.5 * sum / (b - a));
    }
  }
}

// Uniform Laplacian smoothing of `src` into `dst` (both region slots x3), `passes` times, over the
// first `nm` slots; the rest hold their own position. `T` is scratch.
function smoothPose(state, src, dst, nm, passes) {
  const { off, nbr, T } = state, n = src.length;
  dst.set(src);
  for (let p = 0; p < passes; p++) {
    T.set(dst);
    for (let k = 0; k < nm; k++) {
      const a = off[k], b = off[k + 1];
      if (a === b) continue;
      let x = 0, y = 0, z = 0;
      for (let e = a; e < b; e++) { const u = nbr[e] * 3; x += T[u]; y += T[u + 1]; z += T[u + 2]; }
      const f = 0.5 / (b - a), j = k * 3;
      dst[j] = 0.5 * T[j] + f * x; dst[j + 1] = 0.5 * T[j + 1] + f * y; dst[j + 2] = 0.5 * T[j + 2] + f * z;
    }
  }
  return n;
}

// Area-weighted vertex normals of pose `S` over the region's triangles touching the first `nm`
// slots, into `N`.
function normals(state, S, N, nm) {
  const { tri } = state;
  N.fill(0);
  for (let t = 0; t < tri.length; t += 3) {
    if (tri[t] >= nm && tri[t + 1] >= nm && tri[t + 2] >= nm) continue;
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = S[b] - S[a], uy = S[b + 1] - S[a + 1], uz = S[b + 2] - S[a + 2];
    const wx = S[c] - S[a], wy = S[c + 1] - S[a + 1], wz = S[c + 2] - S[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
}

// A frame on smoothed pose S at slot offset j: the normal, the direction to the neighbour at slot
// offset f off it, their cross; into FR at `o` (t, n, b, 9 floats).
const FR = new Float64Array(18);
function frame(S, N, j, f, o) {
  let nx = N[j], ny = N[j + 1], nz = N[j + 2];
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  let tx = S[f] - S[j], ty = S[f + 1] - S[j + 1], tz = S[f + 2] - S[j + 2];
  const d = tx * nx + ty * ny + tz * nz;
  tx -= d * nx; ty -= d * ny; tz -= d * nz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  FR[o] = tx; FR[o + 1] = ty; FR[o + 2] = tz; FR[o + 3] = nx; FR[o + 4] = ny; FR[o + 5] = nz;
  FR[o + 6] = ny * tz - nz * ty; FR[o + 7] = nz * tx - nx * tz; FR[o + 8] = nx * ty - ny * tx;
}

// DELTA MUSH of the push: O (before) and v (after, region slots read through `region`).
function mush(state, v, nm, passes, amount) {
  const { region: reg, off, nbr, O, S0, S1, N0, N1 } = state, nall = reg.length;
  // The pushed pose into S1's source (reuse N1 as it, until the normals need it).
  const P1 = N1;
  for (let k = 0; k < nall; k++) { const i = reg[k] * 3, j = k * 3; P1[j] = v[i]; P1[j + 1] = v[i + 1]; P1[j + 2] = v[i + 2]; }
  smoothPose(state, O, S0, nm, passes);
  smoothPose(state, P1, S1, nm, passes);
  normals(state, S0, N0, nm);
  normals(state, S1, N1, nm);
  for (let k = 0; k < nm; k++) {
    const a = off[k];
    if (a === off[k + 1]) continue;
    const j = k * 3, f = nbr[a] * 3;
    // A frame per smoothed pose (FR 0..8 before, 9..17 after); the pre-push detail in the first,
    // put back in the second.
    frame(S0, N0, j, f, 0); frame(S1, N1, j, f, 9);
    const dx = O[j] - S0[j], dy = O[j + 1] - S0[j + 1], dz = O[j + 2] - S0[j + 2];
    const ct = dx * FR[0] + dy * FR[1] + dz * FR[2], cn = dx * FR[3] + dy * FR[4] + dz * FR[5], cb = dx * FR[6] + dy * FR[7] + dz * FR[8];
    const i = reg[k] * 3;
    for (let c = 0; c < 3; c++) {
      const out = S1[j + c] + ct * FR[9 + c] + cn * FR[12 + c] + cb * FR[15 + c];
      v[i + c] += (out - v[i + c]) * amount;
    }
  }
}

// Cheap change test for the cache: the rest positions of every jaw's fit vertices and skin.
export function teethSum(state, base) {
  let a = 0;
  for (const jaw of state.jaws) for (const list of [jaw.fit, jaw.skin]) for (const v of list) a += base[v * 3] * 1.3 + base[v * 3 + 1] * 1.7 + base[v * 3 + 2] * 2.1;
  return a;
}
