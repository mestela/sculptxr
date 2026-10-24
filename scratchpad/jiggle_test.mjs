// Jiggle.js spring core: still at rest, lags + overshoots + settles after a step, gain, cap, jump
// reset, and the offset comes back in LOCAL space through the inverse matrix.
// node scratchpad/jiggle_test.mjs   (JG_INJECT=nodamp removes the damping: the settle check must fail;
//   JG_INJECT=gapreset resets on every long gap: the still-spell check must fail)
import fs from 'node:fs';

const src = new URL('../src/editing/Jiggle.js', import.meta.url);
let code = fs.readFileSync(src, 'utf8');
if (process.env.JG_INJECT === 'gapreset') {
  const anchor = '(dt > JUMP && s.live)';
  if (!code.includes(anchor)) throw new Error('anchor moved');
  code = code.replace(anchor, '(dt > JUMP)');
}
if (process.env.JG_INJECT === 'nodamp') {
  const anchor = 'c = 2 * jiggle.damp * om;';
  if (!code.includes(anchor)) throw new Error('anchor moved');
  code = code.replace(anchor, 'c = 0;');
}
// A sibling copy so its relative and bare imports resolve as the original's do.
const copy = new URL('../src/editing/_jiggle_test_copy.js', import.meta.url);
fs.writeFileSync(copy, code);
let J;
try { J = await import(copy.href); } finally { fs.rmSync(copy); }
const { makeSpring, stepSpring, jiggle } = J;

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// One loose vertex (index 0, looseness 1), mesh radius 1, target at `p`.
function run(path, { inv = I3, gain = 1, until = 3, dt = 1 / 72 } = {}) {
  jiggle.gain = gain;
  const s = makeSpring(Int32Array.of(0), Float32Array.of(1), 1);
  const out = new Float32Array(3), trace = [];
  for (let t = 0; t <= until + 1e-9; t += dt) {
    const p = path(t);
    out.fill(0);
    const live = stepSpring(s, (i, o, k) => { o[k] = p[0]; o[k + 1] = p[1]; o[k + 2] = p[2]; }, inv, t, out);
    trace.push({ t, live, o: Array.from(out) });
  }
  jiggle.gain = 1;
  return trace;
}

const still = run(() => [0.3, 0.2, 0.1]);
check('a still target never jiggles', still.every((f) => !f.live && f.o.every((x) => x === 0)));

// Step 0.05 along x at t = 0.5.
const step = run((t) => [t < 0.5 ? 0 : 0.05, 0, 0]);
const after = step.filter((f) => f.t >= 0.5);
const first = after.find((f) => f.live);
check('a step makes it lag behind', first && first.o[0] < -0.01, first && `offset ${first.o[0].toFixed(4)}`);
check('...and overshoot', after.some((f) => f.o[0] > 0.001), `max ${Math.max(...after.map((f) => f.o[0])).toFixed(4)}`);
const settledAt = after.find((f, i) => after.slice(i).every((g) => !g.live));
check('...and settle within 2.5 s', settledAt && settledAt.t < 3, settledAt ? `at ${(settledAt.t - 0.5).toFixed(2)} s` : 'never');

check('gain 0 writes nothing', run((t) => [t < 0.5 ? 0 : 0.05, 0, 0], { gain: 0 }).every((f) => f.o.every((x) => x === 0)));

const huge = run((t) => [t < 0.5 ? 0 : 50, 0, 0]);
check('the offset is capped', huge.every((f) => Math.hypot(...f.o) <= jiggle.max + 1e-6), `max ${Math.max(...huge.map((f) => Math.hypot(...f.o))).toFixed(3)}`);

// A long gap AT REST is normal (nothing steps a still spring): the change that ends it jiggles.
const s = makeSpring(Int32Array.of(0), Float32Array.of(1), 1), out = new Float32Array(3);
const at = (p) => (i, o, k) => { o[k] = p[0]; o[k + 1] = p[1]; o[k + 2] = p[2]; };
stepSpring(s, at([0, 0, 0]), I3, 0, out); stepSpring(s, at([0, 0, 0]), I3, 1 / 72, out);
out.fill(0);
const woke = stepSpring(s, at([0.05, 0, 0]), I3, 1.2, out);
check('a change after a still spell jiggles', woke && out[0] < -0.01, `offset ${out[0].toFixed(4)}`);
// A long gap MID-WOBBLE (a hidden tab) restarts at rest instead of flinging.
out.fill(0);
const hidden = stepSpring(s, at([0.05, 0, 0]), I3, 2.5, out);
check('a long gap while wobbling restarts at rest', !hidden && out.every((x) => x === 0));

// World is local turned 90 deg about z (local x -> world y), so inv takes world y back to local x.
const invZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];   // column-major 3x3 inverse of that turn
const turned = run((t) => [0, t < 0.5 ? 0 : 0.05, 0], { inv: invZ });
const f1 = turned.find((f) => f.t >= 0.5 && f.live);
check('the offset comes back in local space', f1 && Math.abs(f1.o[0]) > 0.01 && Math.abs(f1.o[1]) < 1e-6, f1 && `local ${f1.o.map((x) => x.toFixed(4))}`);

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
