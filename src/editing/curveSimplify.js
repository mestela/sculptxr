// SIMPLIFY CURVES — greedy key decimation against the ORIGINAL curve.
//
// The two controls map onto the two stopping rules of the same algorithm (Blender's Decimate
// has the same pair): TOLERANCE removes keys while the curve stays within an allowed error,
// RATIO removes keys until only that fraction is left. Either way the key that costs least to
// remove goes first, and every cost is measured against the curve as it was BEFORE simplifying,
// never against the previous step -- measuring step against step lets error accumulate, and a
// "1%" simplify ends up a long way from where it started.
//
// Keys are only ever REMOVED. A surviving key keeps its exact time, value and tangents, so
// simplifying never moves anything you placed by hand; it only takes away what it can prove
// is redundant.
//
// ALL CHANNELS SHARE ONE SET OF TIMES, as every transform group does (`track.times`), so a key
// can only go when EVERY channel can spare it. The cost of a key is the worst channel's error.
//
// The curve model is the graph editor's: a cubic bezier per segment with auto tangents taken
// from the neighbours (catmull-rom slope, one-sided at the ends) unless the key carries a
// hand-set tangent. A channel flagged `linear` is ALSO held to the straight-line model, because
// playback interpolates rotation and scale linearly while the graph draws them as beziers; a
// key is removable only if neither the drawn curve nor the played motion moves by more than
// the tolerance.

const SAMPLES_PER_SEG = 4;   // the key itself + three in-betweens, so a removed hump is noticed

// Solve the bezier's x (time) for the parameter that lands at `alpha`. Newton from t = alpha
// converges in a handful of steps for any handle layout the editor allows (x is monotonic); the
// bisection is the fallback for a flat spot, and matches what the graph editor itself does.
function bezierT(alpha, p1x, p2x) {
  let t = alpha;
  for (let i = 0; i < 6; i++) {
    const o = 1 - t;
    const x = 3 * o * o * t * p1x + 3 * o * t * t * p2x + t * t * t - alpha;
    if (Math.abs(x) < 1e-7) return t;
    const d = 3 * o * o * p1x + 6 * o * t * (p2x - p1x) + 3 * t * t * (1 - p2x);
    if (!(d > 1e-6)) break;
    t -= x / d;
    if (t < 0 || t > 1) break;
  }
  let lo = 0, hi = 1;
  t = 0.5;
  for (let i = 0; i < 30; i++) {
    const o = 1 - t;
    const x = 3 * o * o * t * p1x + 3 * o * t * t * p2x + t * t * t;
    if (Math.abs(x - alpha) < 1e-7) return t;
    if (x < alpha) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

// times: key times (ascending).
// chans: [{ v, norm, linear, tan }] -- `v` one value per key; `norm` the unit the error is
//        divided by; `tan(i, side)` optional, returns { dt, dv } overrides for key i's
//        'left'/'right' handle (either may be undefined).
// opts:  { mode: 'tolerance' | 'ratio', tolerance, ratio, removable: bool[] }
// Returns a Uint8Array keep-mask.
export function decimateKeys(times, chans, opts) {
  const n = times.length;
  const keep = new Uint8Array(n).fill(1);
  if (n < 3) return keep;

  const T = times;
  const prev = new Int32Array(n), next = new Int32Array(n);
  for (let i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1 < n ? i + 1 : -1; }

  const slope = (v, i, p, nx) => {
    if (p < 0) return (v[nx] - v[i]) / (T[nx] - T[i]);
    if (nx < 0) return (v[i] - v[p]) / (T[i] - T[p]);
    return (v[nx] - v[p]) / (T[nx] - T[p]);
  };

  // Channels without hand-set handles share the same time curve, so the nine channels of a
  // transform key ask this the same question in a row. Remembering the last answer is most of
  // the run time on a long take, which matters because the slider re-runs the whole thing live.
  let lastA = NaN, lastP1 = NaN, lastP2 = NaN, lastT = 0;
  const solveT = (alpha, p1x, p2x) => {
    if (alpha !== lastA || p1x !== lastP1 || p2x !== lastP2) {
      lastA = alpha; lastP1 = p1x; lastP2 = p2x; lastT = bezierT(alpha, p1x, p2x);
    }
    return lastT;
  };

  // Value of channel `c` at `time` on the segment a->b, with a's other neighbour `ap` and b's
  // other neighbour `bn` (-1 at the ends). These are passed in, not read from prev/next, so a
  // removal can be priced before it is made.
  const evalBez = (c, a, ap, b, bn, time) => {
    const ch = chans[c], v = ch.v;
    const dt = T[b] - T[a];
    if (!(dt > 0)) return v[a];
    const ra = ch.tan?.(a, 'right'), lb = ch.tan?.(b, 'left');
    const dt0 = ra?.dt !== undefined ? ra.dt : dt * 0.33;
    const dt1 = lb?.dt !== undefined ? lb.dt : -dt * 0.33;
    const dv0 = ra?.dv !== undefined ? ra.dv : slope(v, a, ap, b) * dt0;
    const dv1 = lb?.dv !== undefined ? lb.dv : slope(v, b, a, bn) * dt1;
    const t = solveT((time - T[a]) / dt, dt0 / dt, 1 + dt1 / dt);
    const o = 1 - t;
    return o * o * o * v[a] + 3 * o * o * t * (v[a] + dv0) + 3 * o * t * t * (v[b] + dv1) + t * t * t * v[b];
  };
  const evalLin = (c, a, b, time) => {
    const v = chans[c].v, dt = T[b] - T[a];
    return dt > 0 ? v[a] + (v[b] - v[a]) * (time - T[a]) / dt : v[a];
  };

  // The original curve, sampled once. Sample s of segment i sits at alpha s/SAMPLES_PER_SEG.
  const S = SAMPLES_PER_SEG;
  const ns = (n - 1) * S;
  const sTime = new Float64Array(ns);
  const sBez = chans.map(() => new Float64Array(ns));
  const sLin = chans.map((ch) => (ch.linear ? new Float64Array(ns) : null));
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < S; s++) {
      const k = i * S + s;
      const time = T[i] + (T[i + 1] - T[i]) * (s / S);
      sTime[k] = time;
      for (let c = 0; c < chans.length; c++) {
        sBez[c][k] = evalBez(c, i, prev[i], i + 1, next[i + 1], time);
        if (sLin[c]) sLin[c][k] = evalLin(c, i, i + 1, time);
      }
    }
  }

  // Worst normalised error over the samples of segment a->b.
  const segErr = (a, ap, b, bn) => {
    let worst = 0;
    for (let k = a * S; k < b * S; k++) {
      const time = sTime[k];
      for (let c = 0; c < chans.length; c++) {
        const inv = 1 / chans[c].norm;
        const eb = Math.abs(evalBez(c, a, ap, b, bn, time) - sBez[c][k]) * inv;
        if (eb > worst) worst = eb;
        if (sLin[c]) {
          const el = Math.abs(evalLin(c, a, b, time) - sLin[c][k]) * inv;
          if (el > worst) worst = el;
        }
      }
    }
    return worst;
  };

  // Removing k changes the auto tangents at its neighbours p and n, so the three segments
  // pp->p, p->n and n->nn all move.
  const cost = (k) => {
    const p = prev[k], nx = next[k];
    const pp = prev[p], nn = next[nx];
    let e = segErr(p, pp, nx, nn);
    if (pp >= 0) e = Math.max(e, segErr(pp, prev[pp], p, nx));
    if (nn >= 0) e = Math.max(e, segErr(nx, p, nn, next[nn]));
    return e;
  };

  const removable = new Uint8Array(n);
  let candidates = 0;
  for (let i = 1; i < n - 1; i++) {
    if (!opts.removable || opts.removable[i]) { removable[i] = 1; candidates++; }
  }
  const costs = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (removable[i]) costs[i] = cost(i);

  const byRatio = opts.mode === 'ratio';
  const target = byRatio ? Math.round(candidates * Math.min(1, Math.max(0, opts.ratio))) : 0;
  const tol = opts.tolerance || 0;
  let left = candidates;

  while (left > 0) {
    if (byRatio && left <= target) break;
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (removable[i] && costs[i] < bestCost) { bestCost = costs[i]; best = i; }
    }
    if (best < 0) break;
    if (!byRatio && bestCost > tol) break;

    const p = prev[best], nx = next[best];
    next[p] = nx; prev[nx] = p;
    keep[best] = 0; removable[best] = 0; costs[best] = Infinity; left--;

    // A key's cost reads up to three neighbours either side (its window's own tangents look
    // one further out), so those are the keys whose price just changed.
    let a = p;
    for (let j = 0; j < 3 && a >= 0; j++, a = prev[a]) if (removable[a]) costs[a] = cost(a);
    a = nx;
    for (let j = 0; j < 3 && a >= 0; j++, a = next[a]) if (removable[a]) costs[a] = cost(a);
  }
  return keep;
}
