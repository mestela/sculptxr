// IDLE FACE: what a face does when nobody is driving it -- blinks, eye darts, lids following the
// gaze, and a slow layer of brow and mouth life (MetaHuman's idle layer). Drives the ARKit shapes
// by NAME, so any head with them idles (GNM, ICT), not only GNM.
//
// AN OFFSET ON THE SHOWN WEIGHT, not keys and not previews: AnimationRegistry.shownWeight adds
// `track._idle` on top of curve/preview and clamps 0..1, so playback, the pad and the Face tool
// all keep working underneath and a keyed blink at 1 just saturates. shownWeight is also what
// otherLayersOffset subtracts, so a stroke over an idling face captures only its own layer; the
// layer being edited never idles (the capture needs its exact weight). While a stroke is active
// the offsets are FROZEN (tickIdle skips), so the two never disagree mid-stroke.
//
// REAL TIME, like the jiggle. Not saved in the .sxr; bake to keys is a later step.
//
// BLINK NUMBERS are from the literature, not taste (matt: the first blink was "too slow and
// mechanical"). Kwon et al. 2013 (J R Soc Interface, 600 fps, 25 people): closing 76 ms, closed
// 58 ms, then the lid is back to 97% ~165 ms later and creeps the last 3% over ~270 ms more.
// Doane 1980: closing starts slow, peaks as the lid crosses the pupil, slows into the lower lid.
// Opening is the reverse -- FASTEST at the start. The first version eased in AND out of both
// phases (smoothstep), so the lid lingered near shut ~100 ms: that was the "slow".
// Intervals are log-normal and strongly skewed (Arq Bras Oftalmol 2010 interblink study; the 2011
// search-coil study). Blinks ride big gaze shifts (Evinger et al. 1994: orbicularis fires with 97%
// of saccades over 33 deg). At blink onset the eyes dip down and toward the nose and come back
// (reviewed in Front Syst Neurosci 2023, 10.3389/fnsys.2023.1242654), and the lower lid moves in
// with it (Doane 1980). The part that is NOT measured: how many
// spontaneous blinks are incomplete -- common, but no population figure was found; 20% is a guess.

// Blinks per minute, gaze range (shape weight at the edge of the gaze), pace (darts per second x),
// micro (brow/mouth life, x).
export const idle = { on: false, rate: 15, range: 0.35, pace: 1, micro: 1 };

// Same shape as JIGGLE_SLIDERS: integer slider units, `to` slider -> setting, `ui` setting -> slider.
export const IDLE_SLIDERS = [
  { key: 'rate', label: 'Blinks', min: 0, max: 40, to: (v) => v, ui: (x) => Math.round(x), fmt: (v) => `${v}/min` },
  { key: 'range', label: 'Gaze', min: 0, max: 100, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'pace', label: 'Pace', min: 25, max: 300, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
  { key: 'micro', label: 'Micro', min: 0, max: 200, to: (v) => v / 100, ui: (x) => Math.round(x * 100), fmt: (v) => `${v}%` },
];

// ── Blink (seconds) ──────────────────────────────────────────────────────────────────────────
const CLOSE = 0.076, SHUT = 0.05, OPEN = 0.165, TAIL = 0.09;   // TAIL: time constant of the last 3%
const JITTER = 0.2;        // each blink's timing scaled by 1 +- this
const PARTIAL = 0.2;       // share of blinks that stop short (guess, see header)
const SPREAD = 0.7;        // log-normal sigma of the interval
const DOUBLE = 0.08;       // chance a blink comes as a pair
const EYE_LAG = 0.012;     // the two lids are up to this far apart (s)
// What rides a blink, as weight per unit of closure: eyes down + in, lower lid up, a touch of brow.
const WITH_BLINK = { eyeLookDown: 0.12, eyeLookIn: 0.06, eyeSquint: 0.15, browDown: 0.04, cheekSquint: 0.05 };

// ── Gaze ─────────────────────────────────────────────────────────────────────────────────────
const LID_DOWN = 0.4;     // looking down lowers the upper lids by this much of eyeLookDown
const LID_UP = 0.25;      // looking up widens them by this much of eyeLookUp
const Y_SCALE = 0.7;      // vertical gaze range relative to horizontal

// ── Micro: slow drift + occasional gestures (weights at micro = 1) ──────────────────────────
// Drift: smooth noise, mostly near 0 with the odd swell. `tie` = how much the two sides share.
const DRIFT = [
  { names: ['browInnerUp'], amp: 0.06 },
  { names: ['browOuterUpLeft', 'browOuterUpRight'], amp: 0.04, tie: 0.7 },
  { names: ['browDownLeft', 'browDownRight'], amp: 0.03, tie: 0.8 },
  { names: ['mouthSmileLeft', 'mouthSmileRight'], amp: 0.04, tie: 0.6 },
  { names: ['mouthPressLeft', 'mouthPressRight'], amp: 0.05, tie: 0.8 },
  { names: ['cheekSquintLeft', 'cheekSquintRight'], amp: 0.03, tie: 0.7 },
  { names: ['mouthPucker'], amp: 0.02 },
];
const BREATH = { name: 'jawOpen', amp: 0.015, period: 4.2 };   // ~14 breaths a minute
// Gestures: median gap (s), attack/hold/release (s), weights. `side` picks one side at random.
const GESTURES = [
  { gap: 14, a: 0.18, h: 0.25, r: 0.5, w: { browInnerUp: 0.3, browOuterUpLeft: 0.22, browOuterUpRight: 0.22 } },   // brow flash
  { gap: 25, a: 0.2, h: 0.4, r: 0.5, w: { mouthPressLeft: 0.35, mouthPressRight: 0.35, mouthRollLower: 0.12 } },   // lip press
  { gap: 18, a: 0.25, h: 0.3, r: 0.6, side: true, w: { mouthSmile: 0.12, mouthDimple: 0.1 } },                    // corner twitch
];
const FLASH_ON_SHIFT = 0.25;   // chance a big gaze shift brings a brow flash (attention)

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) * (1 - x));

// Log-normal with the given MEAN (median exp(mu) = mean / exp(s^2/2)).
function lognormal(r, mean, sigma) {
  const u = Math.max(1e-9, r()), v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean * Math.exp(sigma * z - sigma * sigma / 2);
}

// Smooth noise in about -1..1: three sines at unrelated rates.
function makeNoise(r, hz) {
  return [1, 2.31, 3.97].map((k) => ({ f: hz * k * (0.8 + 0.4 * r()), p: r() * Math.PI * 2 }));
}
function noiseAt(n, t) {
  let v = 0;
  for (const { f, p } of n) v += Math.sin(2 * Math.PI * f * t + p);
  return v / 2;
}

// `rand` is injectable for the harness.
export function makeIdle(t = 0, rand = Math.random) {
  const s = {
    rand, gx: 0, gy: 0, fx: 0, fy: 0, tx: 0, ty: 0, sac0: t, sacDur: 0.05, nextSac: t + 0.5,
    blink0: -1, bk: null, lastBlink: t, nextBlink: t + 1 + rand() * 2,
    drift: DRIFT.map((d) => ({ shared: makeNoise(rand, 0.06), own: d.names.map(() => makeNoise(rand, 0.06)) })),
    breath0: rand() * BREATH.period,
    gestures: GESTURES.map((g) => ({ next: t + lognormal(rand, g.gap, SPREAD), t0: -1, k: 1, side: 'Left' })),
    lastFlash: t,
  };
  return s;
}

function blinkGap(s) {
  return idle.rate > 0 ? Math.max(0.25, lognormal(s.rand, 60 / idle.rate, SPREAD)) : Infinity;
}

function startBlink(s, t) {
  const r = s.rand, j = 1 + JITTER * (2 * r() - 1);
  s.blink0 = t;
  s.bk = {
    close: CLOSE * j, shut: SHUT * j * (0.5 + r()), open: OPEN * j,
    amp: r() < PARTIAL ? 0.55 + 0.35 * r() : 1,
    lag: (2 * r() - 1) * EYE_LAG,                // + = right lid later
    ampR: 1 + (2 * r() - 1) * 0.03,
  };
  s.lastBlink = t;
  s.nextBlink = r() < DOUBLE ? t + s.bk.close + s.bk.shut + s.bk.open + 0.05 : t + blinkGap(s);
}

// Closure 0..1 of one lid, `u` seconds into the blink.
export function blinkCurve(bk, u) {
  if (u < 0) return 0;
  if (u < bk.close) return bk.amp * smooth(u / bk.close);   // slow start, fast across the eye, stop
  u -= bk.close;
  if (u < bk.shut) return bk.amp;
  u -= bk.shut;
  if (u < bk.open) return bk.amp * (1 - 0.97 * easeOut(u / bk.open));   // fastest as it leaves
  return bk.amp * 0.03 * Math.exp(-(u - bk.open) / TAIL);               // the slow creep home
}

function envelope(g, u) {
  if (u < 0) return 0;
  if (u < g.a) return smooth(u / g.a);
  if (u < g.a + g.h) return 1;
  return 1 - smooth((u - g.a - g.h) / g.r);
}

function startGesture(s, i, t) {
  const st = s.gestures[i];
  st.t0 = t;
  st.k = 0.5 + 0.5 * s.rand();
  st.side = s.rand() < 0.5 ? 'Left' : 'Right';
  st.next = t + lognormal(s.rand, GESTURES[i].gap, SPREAD);
}

// Advance to time `t` (s) and write the weight offsets into `out` (Map name -> w).
export function stepIdle(s, t, out) {
  const r = s.rand;
  out.clear();
  const add = (name, v) => { if (v) out.set(name, (out.get(name) || 0) + v); };

  // ── Gaze ──
  if (t >= s.nextSac) {
    // A FIXATION ENDS. Half the darts are micro-saccades (a few % of the range, short hold);
    // the rest jump anywhere, mostly small (u^2), pulled back toward the centre so the gaze
    // wanders round straight ahead instead of parking at an edge.
    const micro = r() < 0.5;
    const a = r() * Math.PI * 2;
    const m = micro ? 0.04 : 0.15 + 0.85 * r() * r();
    let tx = (micro ? s.tx : s.tx * 0.5) + Math.cos(a) * m;
    let ty = (micro ? s.ty : s.ty * 0.5) + Math.sin(a) * m;
    const l = Math.hypot(tx, ty);
    if (l > 1) { tx /= l; ty /= l; }
    const jump = Math.hypot(tx - s.gx, ty - s.gy);
    s.fx = s.gx; s.fy = s.gy; s.tx = tx; s.ty = ty;
    s.sac0 = t;
    s.sacDur = 0.025 + 0.05 * jump;   // a saccade is fast and grows with its size
    s.nextSac = t + (micro ? 0.2 + 0.4 * r() : 0.4 + 2 * r()) / Math.max(0.05, idle.pace);
    // The bigger the shift, the likelier a blink comes with it (Evinger 1994) -- by pulling the
    // NEXT blink forward when it was due soon anyway, so the slider's rate stays the rate.
    if (idle.rate > 0 && s.blink0 < 0 && s.nextBlink - t < 0.5 * 60 / idle.rate && r() < Math.min(0.9, Math.max(0, (jump - 0.3) * 1.2))) startBlink(s, t);
    if (jump > 0.5 && idle.micro > 0 && t - s.lastFlash > 4 && r() < FLASH_ON_SHIFT) { startGesture(s, 0, t); s.lastFlash = t; }
  }
  const k = smooth((t - s.sac0) / s.sacDur);
  s.gx = s.fx + (s.tx - s.fx) * k;
  s.gy = s.fy + (s.ty - s.fy) * k;

  // ── Blink ──
  if (idle.rate <= 0) s.nextBlink = Infinity;
  else {
    if (s.nextBlink === Infinity) s.nextBlink = t + blinkGap(s);   // the slider came up from 0
    if (t >= s.nextBlink && s.blink0 < 0) startBlink(s, t);
  }
  let bL = 0, bR = 0;
  if (s.blink0 >= 0) {
    const u = t - s.blink0, bk = s.bk;
    bL = blinkCurve(bk, u - Math.max(0, -bk.lag));
    bR = Math.min(1, bk.ampR * blinkCurve(bk, u - Math.max(0, bk.lag)));
    if (u > bk.close + bk.shut + bk.open + 5 * TAIL + EYE_LAG) s.blink0 = -1;
  }
  const b = (bL + bR) / 2;

  // Gaze -> shapes. +x turns both eyes the same way: the left eye OUT, the right eye IN.
  const wx = s.gx * idle.range, wy = s.gy * idle.range * Y_SCALE;
  const up = Math.max(0, wy), down = Math.max(0, -wy);
  add('eyeLookOutLeft', Math.max(0, wx));
  add('eyeLookInRight', Math.max(0, wx));
  add('eyeLookInLeft', Math.max(0, -wx));
  add('eyeLookOutRight', Math.max(0, -wx));
  add('eyeLookUpLeft', up);
  add('eyeLookUpRight', up);
  add('eyeLookDownLeft', down);
  add('eyeLookDownRight', down);
  add('eyeBlinkLeft', Math.min(1, bL + LID_DOWN * down));
  add('eyeBlinkRight', Math.min(1, bR + LID_DOWN * down));
  add('eyeWideLeft', LID_UP * up * (1 - b));
  add('eyeWideRight', LID_UP * up * (1 - b));
  for (const side of ['Left', 'Right']) {
    const bs = side === 'Left' ? bL : bR;
    for (const [stem, w] of Object.entries(WITH_BLINK)) add(stem + side, w * bs);
  }

  // ── Micro ──
  const mi = idle.micro;
  if (mi > 0) {
    DRIFT.forEach((d, i) => {
      const n = s.drift[i], tie = d.tie ?? 1, sh = noiseAt(n.shared, t);
      d.names.forEach((name, j) => {
        const v = tie * sh + (1 - tie) * noiseAt(n.own[j], t);
        const pos = Math.max(0, (v + 1) / 2);
        add(name, mi * d.amp * pos * pos);   // squared: mostly quiet, the odd swell
      });
    });
    add(BREATH.name, mi * BREATH.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t + s.breath0) / BREATH.period)));
    GESTURES.forEach((g, i) => {
      const st = s.gestures[i];
      if (t >= st.next && st.t0 < 0) startGesture(s, i, t);
      if (st.t0 < 0) return;
      const e = envelope(g, t - st.t0);
      if (t - st.t0 > g.a + g.h + g.r) { st.t0 = -1; return; }
      for (const [name, w] of Object.entries(g.w)) add(g.side ? name + st.side : name, mi * st.k * w * e);
    });
  }

  for (const [name, v] of out) out.set(name, Math.min(1, v));
  return out;
}

const states = new WeakMap();   // mesh -> idle state

// Once a frame from Scene.applyRender (next to tickJiggle).
export function tickIdle(main) {
  const reg = window._animationRegistry;
  if (!reg) return;
  const sm = main._sculptManager;
  if (sm && sm._strokeActive) return;   // frozen mid-stroke: see the header
  const t = performance.now() / 1000;
  let live = false;
  for (const mesh of main.getMeshes ? main.getMeshes() : []) {
    const track = reg.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) continue;
    if (!idle.on || !(track.blendshapes.has('eyeBlinkLeft') || track.blendshapes.has('eyeLookInLeft'))) {
      if (track._idle) { track._idle = null; reg.applyBlendshapes(mesh); }   // turned off: rest pose back
      continue;
    }
    let s = states.get(mesh);
    if (!s) states.set(mesh, (s = makeIdle(t)));
    stepIdle(s, t, track._idle || (track._idle = new Map()));
    reg.applyBlendshapes(mesh);
    live = true;
  }
  // Keep the frames coming: a still scene drops to 4 fps (Scene._idleSkipFrame) and a blink is ~300 ms.
  if (live) main.render();
}
