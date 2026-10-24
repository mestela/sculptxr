// SPRING JIGGLE: soft flesh (cheeks, jowls, lips) lags and overshoots when the head moves or an
// expression snaps on. A damped spring per loose vertex, chasing where the blend (and the head's
// transform) puts it, in WORLD space -- so a head turning with no expression change jiggles too.
//
// DISPLAY ONLY, like the lid push: AnimationRegistry.applyBlendshapes adds it after the blend and
// keeps it on the track (`_jiggle`), and otherLayersOffset subtracts it, so a stroke never bakes it.
//
// REAL TIME, not timeline time. It is right while playing and puppeting; scrubbing jiggles from
// whatever the scrub does (capped at `max`). A long frame gap while still wobbling (a hidden tab)
// restarts it at rest instead of flinging the face.
//
// LOOSENESS comes from GNM's regions (cheeks, parotid/jowls, lips, chin loose; brow, nose,
// forehead stiff), softened across the region borders. Only GNM heads jiggle for now: a whole head
// at one looseness reads as jelly.
import { mat4 } from 'gl-matrix';
import { isGnm, regionCodes } from './GnmRegions.js';
import { GNM_REGION_NAMES } from './gnmRegionData.js';

// Hz, damping ratio, 0..1, offset cap (mesh radii). Defaults are matt's, tuned on GNM with the
// sliders (2026-10-24). At gain 1 and a 15% cap, snapping the jaw open in one frame left the whole
// lower face hanging behind it like rubber.
export const jiggle = { on: false, freq: 10, damp: 0.24, gain: 0.4, max: 0.03 };

// The sliders (Properties Face section and the VR mini panel build theirs from this), as integer
// slider units: `to` takes a slider value to the setting, `ui` the setting to a slider value.
export const JIGGLE_SLIDERS = [
  { key: 'gain', label: 'Strength', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'freq', label: 'Speed', min: 10, max: 100, to: (v) => v / 10, ui: (x) => Math.round(x * 10), fmt: (v) => `${(v / 10).toFixed(1)} Hz` },
  { key: 'damp', label: 'Damping', min: 5, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => (v / 100).toFixed(2) },
  { key: 'max', label: 'Range', min: 1, max: 15, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
];

const LOOSE = { cheek: 1, parotid: 1, lower_lip_area: 0.8, lower_lip: 0.7, chin: 0.6, upper_lip_area: 0.6, upper_lip: 0.5, infraorbital: 0.5, zygomatic: 0.3 };
const SOFTEN = 4;        // neighbour-averaging passes over the looseness map
const STEP = 1 / 120;    // fixed sub-step (s)
const JUMP = 0.1;        // a frame gap longer than this (s) while still wobbling restarts at rest
const REST = 1e-5;       // settled: every offset and speed under this (mesh radii, per second)

// ── The spring core (no mesh): state over the loose vertices ─────────────────────────────────

// `idx` the loose vertices, `w` their looseness, `size` the mesh radius (offset cap and rest test).
export function makeSpring(idx, w, size) {
  const n = idx.length;
  return { idx, w, size, x: new Float64Array(n * 3), v: new Float64Array(n * 3), t: -1, live: false };
}

// Step to `now` (s) chasing targets `T(i)` (world, by loose index) and write each loose vertex's
// LOCAL offset (looseness-weighted, through `inv`, the inverse of the world matrix's 3x3) into
// `out` at the vertex's own slot. Returns false when at rest (nothing written).
export function stepSpring(s, T, inv, now, out) {
  const { idx, w, x, v } = s, n = idx.length;
  let dt = now - s.t;
  const tgt = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) T(i, tgt, i * 3);
  // First frame, or a long gap MID-WOBBLE (a hidden tab): start at rest. A gap AT REST is normal --
  // nothing steps a spring that is still -- so the change that ends it is stepped as one frame.
  if (s.t < 0 || !(dt > 0) || (dt > JUMP && s.live)) {
    x.set(tgt); v.fill(0); s.t = now; s.live = false;
    return false;
  }
  s.t = now;
  if (dt > JUMP) dt = 1 / 60;
  const om = 2 * Math.PI * jiggle.freq, k = om * om, c = 2 * jiggle.damp * om;
  const steps = Math.max(1, Math.ceil(dt / STEP)), h = dt / steps;
  const cap = jiggle.max * s.size;
  for (let st = 0; st < steps; st++) {
    for (let j = 0; j < n * 3; j++) {
      v[j] += (k * (tgt[j] - x[j]) - c * v[j]) * h;   // semi-implicit Euler
      x[j] += v[j] * h;
    }
  }
  let most = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    let dx = x[a] - tgt[a], dy = x[a + 1] - tgt[a + 1], dz = x[a + 2] - tgt[a + 2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l > cap) { const f = cap / l; dx *= f; dy *= f; dz *= f; x[a] = tgt[a] + dx; x[a + 1] = tgt[a + 1] + dy; x[a + 2] = tgt[a + 2] + dz; v[a] *= 0.5; v[a + 1] *= 0.5; v[a + 2] *= 0.5; }
    most = Math.max(most, l, Math.sqrt(v[a] * v[a] + v[a + 1] * v[a + 1] + v[a + 2] * v[a + 2]) * STEP);
    const g = w[i] * jiggle.gain, o = idx[i] * 3;
    out[o] = g * (inv[0] * dx + inv[3] * dy + inv[6] * dz);
    out[o + 1] = g * (inv[1] * dx + inv[4] * dy + inv[7] * dz);
    out[o + 2] = g * (inv[2] * dx + inv[5] * dy + inv[8] * dz);
  }
  s.live = most > REST * s.size;
  return s.live;
}

// ── On a mesh ────────────────────────────────────────────────────────────────────────────────

const springs = new WeakMap();   // mesh -> { key, spring, M (the matrix it last stepped with) }

function looseness(mesh) {
  const codes = regionCodes(), nv = mesh.getNbVertices();
  const w = new Float32Array(nv);
  for (let i = 0; i < Math.min(nv, codes.length); i++) w[i] = LOOSE[GNM_REGION_NAMES[codes[i]]] || 0;
  // Soften the region borders: neighbour averages over the faces.
  const f = mesh.getFaces(), nf = mesh.getNbFaces();
  for (let pass = 0; pass < SOFTEN; pass++) {
    const sum = new Float32Array(nv), cnt = new Uint16Array(nv);
    for (let i = 0; i < nf; i++) {
      const q = [f[i * 4], f[i * 4 + 1], f[i * 4 + 2], f[i * 4 + 3]].filter((v) => v >= 0 && v < nv);
      for (const a of q) for (const b of q) { sum[a] += w[b]; cnt[a]++; }
    }
    for (let i = 0; i < Math.min(nv, codes.length); i++) if (cnt[i]) w[i] = sum[i] / cnt[i];
  }
  return w;
}

// `geo`: the mesh (or multires level) whose vertices the composite `v` is -- the spring is kept
// per mesh, built from that level.
function springFor(mesh, geo, v) {
  const key = geo.getNbVertices() + '|' + geo.getNbFaces();
  let s = springs.get(mesh);
  if (!s || s.key !== key) {
    s = { key, spring: null, M: null };
    if (isGnm(geo)) {
      const w = looseness(geo), idx = [], ws = [];
      for (let i = 0; i < w.length; i++) if (w[i] > 0.02) { idx.push(i); ws.push(w[i]); }
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < w.length; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i * 3 + k]); hi[k] = Math.max(hi[k], v[i * 3 + k]); }
      const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
      s.spring = makeSpring(Int32Array.from(idx), Float32Array.from(ws), size);
    }
    springs.set(mesh, s);
  }
  return s;
}

// The jiggle for composite `v` (local), added into it and kept on the track as `_jiggle` {idx, d}
// for otherLayersOffset. Null (nothing kept) when off, not a GNM head, or at rest.
export function jigglePush(mesh, track, v, geo = mesh) {
  const prev = track._jiggle;
  track._jiggle = null;
  if (!jiggle.on || !track.baseShape) return null;
  const s = springFor(mesh, geo, v);
  if (!s.spring) return null;
  const M = mesh.getMatrix(), sp = s.spring;
  const inv = mat4.invert(mat4.create(), M) || mat4.create();
  const inv3 = [inv[0], inv[1], inv[2], inv[4], inv[5], inv[6], inv[8], inv[9], inv[10]];
  const T = (i, out, o) => {
    const p = sp.idx[i] * 3, x = v[p], y = v[p + 1], z = v[p + 2];
    out[o] = M[0] * x + M[4] * y + M[8] * z + M[12];
    out[o + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    out[o + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  };
  const n = track.baseShape.length;
  const d = prev && prev.d.length === n ? prev.d : new Float32Array(n);
  if (prev && prev.d === d) for (const i of prev.idx) { d[i * 3] = 0; d[i * 3 + 1] = 0; d[i * 3 + 2] = 0; }
  s.M = Float32Array.from(M);
  if (!stepSpring(sp, T, inv3, performance.now() / 1000, d)) return null;
  for (const i of sp.idx) { v[i * 3] += d[i * 3]; v[i * 3 + 1] += d[i * 3 + 1]; v[i * 3 + 2] += d[i * 3 + 2]; }
  track._jiggle = { idx: sp.idx, d };
  return track._jiggle;
}

// Every frame from Scene.applyRender: recomposite heads whose springs are still moving or whose
// transform moved since their last step (a head turning with no shape change).
export function tickJiggle(main) {
  const reg = window._animationRegistry;
  if (!reg) return;
  for (const mesh of main.getMeshes ? main.getMeshes() : []) {
    const s = springs.get(mesh);
    const track = reg.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) continue;
    if (!jiggle.on) {
      if (track._jiggle) reg.applyBlendshapes(mesh);   // turned off: put the rest pose back
      continue;
    }
    if (!s) { reg.applyBlendshapes(mesh); continue; }   // first sight: builds its spring (or learns it has none)
    if (!s.spring) continue;
    const M = mesh.getMatrix();
    if (s.spring.live || !s.M || M.some((x, i) => x !== s.M[i])) reg.applyBlendshapes(mesh);
    // KEEP THE FRAMES COMING while it wobbles: a still scene drops to 4 fps (Scene._idleSkipFrame),
    // and a 250 ms gap mid-wobble is a restart, so the jiggle stopped dead.
    if (s.spring.live) main.render();
  }
}
