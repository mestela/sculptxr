/**
 * DIRECT MANIPULATION BLENDSHAPES — grab a point on the face, drag it, and the weights follow.
 *
 * J.P. Lewis and Ken Anjyo, "Direct Manipulation Blendshapes", IEEE CG&A 2010. The insight is
 * that the shapes ALREADY KNOW which way they move each point: a blendshape's delta at a vertex
 * is a direction on the face. So a drag is a target for a handful of points, and the weights are
 * the least-squares answer to "which mix of shapes puts those points there":
 *
 *     minimise  |B w - m|^2  +  alpha |w - w0|^2  +  mu |w|^2,     0 <= w <= 1
 *
 * B is 3 rows per pinned point, one column per shape (that shape's delta at the point). m is
 * where the points should be, as displacement from the base. w0 is the pose at the moment the
 * hands last changed, and alpha pulls toward it: without it any shape that does not touch the
 * pinned points is free to go anywhere, and the solve is underdetermined the moment you have
 * fewer pins than shapes — which is always.
 *
 * PATH INDEPENDENT BY CONSTRUCTION. w0 and each pin's anchor are re-taken only when a hand grabs
 * or lets go, never per frame, so dragging back to where you started puts the face back where it
 * was. A per-frame w0 drifts: every frame's small regularisation error compounds.
 *
 * Pure maths, no app imports, so the harness runs it in node.
 */

// The delta of every shape at a point on a face, as one vec3 per shape. A point, not a vertex:
// the corners are blended by inverse distance so the grab does not snap from vertex to vertex as
// it crosses a face. `corners` are vertex indices, `pos` their current positions (flat xyz),
// `p` the point. Returns { name: [dx, dy, dz] } for every shape that moves the point by at least
// `minFrac` of the strongest one there.
//
// THE FLOOR IS WHAT MAKES LAYERING WORK. A sculpted shape is rarely exactly zero anywhere — a
// mouth shape carries a trace of noise up at the brow — and every shape in the answer is a shape
// the take records. So a brow pass took the mouth shapes too, held them at whatever they were on
// the grab, and wrote that flat line over the mouth pass underneath.
export function sampleDeltas(shapes, corners, pos, p, minFrac = 0) {
  const idx = [], wts = [];
  for (let k = 0; k < corners.length; k++) {
    const i = corners[k] * 3;
    const dx = pos[i] - p[0], dy = pos[i + 1] - p[1], dz = pos[i + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    // On a corner exactly: that vertex alone, or the inverse distance divides by zero.
    if (d2 < 1e-20) return averageDeltas(shapes, [corners[k]], [1], minFrac);
    idx.push(corners[k]); wts.push(1 / Math.sqrt(d2));
  }
  return averageDeltas(shapes, idx, wts, minFrac);
}

// The weighted average delta of every shape over vertices `idx` (weights `wts`): a PATCH of skin
// rather than a point, so the tool radius sets how much of the face a grab takes hold of. Same
// return and same floor as sampleDeltas.
export function averageDeltas(shapes, idx, wts, minFrac = 0) {
  let sum = 0;
  for (const w of wts) sum += w;
  const out = {};
  for (const [name, delta] of shapes) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3, w = wts[k];
      if (i + 2 >= delta.length) continue;
      x += delta[i] * w; y += delta[i + 1] * w; z += delta[i + 2] * w;
    }
    x /= sum; y /= sum; z /= sum;
    if (x !== 0 || y !== 0 || z !== 0) out[name] = [x, y, z];
  }
  let max = 0;
  for (const d of Object.values(out)) max = Math.max(max, Math.hypot(d[0], d[1], d[2]));
  for (const [name, d] of Object.entries(out)) {
    if (Math.hypot(d[0], d[1], d[2]) < minFrac * max) delete out[name];
  }
  return out;
}

// Gaussian elimination with partial pivoting, in place. n is a few dozen at most (ARKit is 52),
// so a dense solve per frame is nothing.
function solveDense(A, b, n) {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-30) continue;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = Math.abs(A[r * n + r]) < 1e-30 ? 0 : s / A[r * n + r];
  }
  return x;
}

/**
 * Solve one frame.
 *   pins:  [{ deltas: {name: vec3} (from sampleDeltas), drag: vec3, weight?, free? }]  — drag is
 *          how far the point has been pulled since the anchor, in the mesh's local space; weight
 *          (default 1) scales how hard that pin pulls against the others; free (a unit vector) is
 *          a direction the pin does not hold: a mouse drag says nothing about depth (see FacePuppet)
 *   w0:    {name: weight} — the pose at the anchor
 *   opts:  { alpha, mu, sparse, cost, tie, exclude, exclusive, under, range } — range {name: {min, max}}
 *          widens a shape past 0..1 (its slider's range: a cartoon jawOpen at 2); alpha/mu/sparse RELATIVE to the strongest shape at the pins, so the feel
 *          does not change with the mesh's units or how big the face's shapes are. sparse > 0
 *          makes few shapes answer a drag instead of many (see SPARSE below)
 * Returns {name: weight} for the shapes that touch a pin. Shapes that touch none are NOT
 * returned: they cannot be solved for (their column is zero), and including them only lets the
 * regulariser nudge them, which reads as the far side of the face drifting while you pull here.
 */
export function solveWeights(pins, w0, opts = {}) {
  // TIE [[a, b]]: b follows a (symmetry: eyeBlinkRight follows eyeBlinkLeft). One unknown whose
  // column is the SUM of the two — at the lip centre both halves move the point, and solving them
  // apart lets the solver use one and not the other. EXCLUDE: never part of the answer.
  const tie = opts.tie || [];
  if (tie.length || opts.exclude) {
    const drop = new Set(opts.exclude || []);
    pins = pins.map((pin) => {
      const d = {};
      for (const [nm, c] of Object.entries(pin.deltas)) if (!drop.has(nm)) d[nm] = c;
      for (const [a, b] of tie) {
        if (!d[b]) continue;
        const s = d[a] || [0, 0, 0];
        d[a] = [s[0] + d[b][0], s[1] + d[b][1], s[2] + d[b][2]];
        delete d[b];
      }
      return { ...pin, deltas: d };
    });
    w0 = { ...w0 };
    for (const [a, b] of tie) w0[a] = ((w0[a] || 0) + (w0[b] || 0)) / 2;
  }
  const names = [];
  const seen = new Set();
  for (const pin of pins) for (const n of Object.keys(pin.deltas)) if (!seen.has(n)) { seen.add(n); names.push(n); }
  const n = names.length;
  if (!n) return {};

  // B^T B and B^T m, accumulated pin by pin without ever building B. m = B w0 + drag: the
  // target is where the point was at the anchor plus how far it has been pulled.
  const AtA = new Float64Array(n * n);
  const Atm = new Float64Array(n);
  for (const pin of pins) {
    const pw = pin.weight ?? 1;
    if (pw <= 0) continue;
    // FREE AXIS: columns and target both with their part along it taken out, so the fit ignores it.
    const f = pin.free;
    const flat = (c) => { if (!f) return c; const k = c[0] * f[0] + c[1] * f[1] + c[2] * f[2]; return [c[0] - k * f[0], c[1] - k * f[1], c[2] - k * f[2]]; };
    const cols = names.map((nm) => (pin.deltas[nm] ? flat(pin.deltas[nm]) : null));
    const m = flat([pin.drag[0], pin.drag[1], pin.drag[2]]);
    for (let i = 0; i < n; i++) {
      const c = cols[i];
      if (!c) continue;
      const w = w0[names[i]] || 0;
      m[0] += c[0] * w; m[1] += c[1] * w; m[2] += c[2] * w;
    }
    for (let i = 0; i < n; i++) {
      const ci = cols[i];
      if (!ci) continue;
      Atm[i] += pw * (ci[0] * m[0] + ci[1] * m[1] + ci[2] * m[2]);
      for (let j = i; j < n; j++) {
        const cj = cols[j];
        if (!cj) continue;
        const d = pw * (ci[0] * cj[0] + ci[1] * cj[1] + ci[2] * cj[2]);
        AtA[i * n + j] += d;
        if (j !== i) AtA[j * n + i] += d;
      }
    }
  }

  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, AtA[i * n + i]);
  if (scale <= 0) return {};
  const alpha = (opts.alpha ?? 0.02) * scale;
  const mu = (opts.mu ?? 0) * scale;
  const ws = names.map((nm) => w0[nm] || 0);


  // Per-shape bounds: the slider's range (opts.range, else [0,1]), narrowed by the rules below.
  const lo = new Float64Array(n), hi = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const r = opts.range && opts.range[names[i]];
    if (r) { lo[i] = Math.min(0, r.min); hi[i] = Math.max(1, r.max); }
  }
  const lo0 = Float64Array.from(lo), hi0 = Float64Array.from(hi);

  // BOUNDED by an active set: solve, pin the worst offender to its bound, solve the rest again.
  // Clamping an unconstrained answer after the fact is wrong in a way you can see — once jawOpen
  // hits 1 the remaining pull should go to the shapes that can still move, and a clamp just
  // throws that pull away.
  const solveBounded = () => {
    const fixed = new Map();   // index -> bound value
    let w = null;
    for (let iter = 0; iter <= n; iter++) {
      const free = [];
      for (let i = 0; i < n; i++) if (!fixed.has(i)) free.push(i);
      const f = free.length;
      const A = new Float64Array(f * f);
      const b = new Float64Array(f);
      for (let a = 0; a < f; a++) {
        const i = free[a];
        b[a] = Atm[i] + alpha * ws[i];
        for (const [k, v] of fixed) b[a] -= AtA[i * n + k] * v;
        for (let c = 0; c < f; c++) A[a * f + c] = AtA[i * n + free[c]];
        A[a * f + a] += alpha + mu;
      }
      const x = solveDense(A, b, f);
      w = new Float64Array(n);
      for (const [k, v] of fixed) w[k] = v;
      let worst = -1, worstBy = 0;
      for (let a = 0; a < f; a++) {
        const i = free[a];
        w[i] = x[a];
        const by = x[a] < lo[i] ? lo[i] - x[a] : x[a] > hi[i] ? x[a] - hi[i] : 0;
        if (by > worstBy) { worstBy = by; worst = a; }
      }
      if (worst < 0) break;
      const i = free[worst];
      fixed.set(i, x[worst] < lo[i] ? lo[i] : hi[i]);
    }
    return w;
  };

  // SPARSE: plain least squares spreads a drag across every shape that moves the point — on
  // ARKit's mouth, 12-15 of them — and the sum overloads into a face nobody made. So each shape
  // pays `sparse` per unit it CHANGES from w0 (an L1 penalty), which makes one shape doing the
  // work cheaper than several sharing it. On the change, not on w, so a grab that does not move
  // leaves the face alone. Solved exactly by coordinate descent from the bounded L2 answer: per
  // shape, the 1-D minimiser is a soft threshold toward w0, then the box. n is tens.
  // Deterministic in (drag, w0): path independence holds.
  const sparse = (opts.sparse ?? 0) * scale;
  // COST per shape multiplies its sparse penalty: a shape that moves the whole lower face but
  // this lid only a little (jawOpen, grabbed at the lower lid) must not be the cheap answer.
  const cost = names.map((nm) => (opts.cost && opts.cost[nm]) || 1);
  const solveAll = () => {
    const w = solveBounded();
    if (sparse <= 0) return w;
    for (let sweep = 0; sweep < 200; sweep++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const q = AtA[i * n + i] + alpha + mu;
        let g = Atm[i] + alpha * ws[i];
        for (let j = 0; j < n; j++) if (j !== i) g -= AtA[i * n + j] * w[j];
        const z = g / q - ws[i];
        const shrunk = Math.sign(z) * Math.max(Math.abs(z) - sparse * cost[i] / q, 0);
        const wi = Math.min(hi[i], Math.max(lo[i], ws[i] + shrunk));
        moved = Math.max(moved, Math.abs(wi - w[i]));
        w[i] = wi;
      }
      if (moved < 1e-7) break;
    }
    return w;
  };

  // RULES between shapes, enforced by narrowing bounds and solving again (a handful of passes):
  //   exclusive [[a, b]] — opposing poses (mouthLeft/mouthRight) that no face makes at once. A
  //     straight pull down on facecap's chin answered mouthLeft 0.52 + mouthRight 0.52: their
  //     sideways halves cancel and their small downward halves add. The weaker one is held off.
  //   under {a: b} — a corrective that only means anything on top of another: ARKit's
  //     mouthClose closes the lips AGAINST jawOpen, so it may not exceed it.
  const idx = new Map(names.map((nm, i) => [nm, i]));
  let w = solveAll();
  for (let pass = 0; pass < 8; pass++) {
    let again = false;
    for (const [a, b] of opts.exclusive || []) {
      const ia = idx.get(a), ib = idx.get(b);
      if (ia === undefined || ib === undefined || w[ia] <= 0.02 || w[ib] <= 0.02) continue;
      const k = w[ia] < w[ib] ? ia : ib;
      lo[k] = hi[k] = 0;
      again = true;
    }
    for (const [a, b] of Object.entries(opts.under || {})) {
      const ia = idx.get(a);
      if (ia === undefined) continue;
      const cap = idx.has(b) ? w[idx.get(b)] : (w0[b] || 0);
      if (w[ia] <= cap + 1e-6) continue;
      hi[ia] = Math.max(lo[ia], cap);
      again = true;
    }
    if (!again) break;
    w = solveAll();
  }

  const out = {};
  for (let i = 0; i < n; i++) out[names[i]] = Math.min(hi0[i], Math.max(lo0[i], w[i]));
  for (const [a, b] of tie) if (a in out) out[b] = out[a];
  return out;
}
