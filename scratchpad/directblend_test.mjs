// Node harness for DIRECT MANIPULATION BLENDSHAPES (src/editing/DirectBlend.js).
//
// The solver is arithmetic, so it is RUN: a toy face of one point and a few shapes, dragged.
//
// Run: node scratchpad/directblend_test.mjs
import { sampleDeltas, solveWeights } from '../src/editing/DirectBlend.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const near = (a, b, e = 0.03) => Math.abs(a - b) < e;

// One vertex. jawOpen moves it down 1, smile moves it +x 1 and up 0.2, pucker moves it -x.
const shapes = new Map([
  ['jawOpen', new Float32Array([0, -1, 0])],
  ['smile', new Float32Array([1, 0.2, 0])],
  ['pucker', new Float32Array([-0.5, 0, 0.3])],
  ['browUp', new Float32Array([0, 0, 0])],      // does not touch this point
]);
const pos = new Float32Array([0, 0, 0]);
const d = sampleDeltas(shapes, [0], pos, [0, 0, 0]);
ok(!('browUp' in d), 'a shape that does not move the point is not sampled');

const solve = (drag, w0 = {}, o) => solveWeights([{ deltas: d, drag }], w0, o);

let w = solve([0, 0, 0]);
ok(near(w.jawOpen, 0) && near(w.smile, 0) && near(w.pucker, 0), 'no drag, no change');

w = solve([0, -0.5, 0]);
ok(near(w.jawOpen, 0.5) && w.smile < 0.05, 'drag down half -> jawOpen ~0.5');

w = solve([0, -3, 0]);
ok(near(w.jawOpen, 1, 1e-6), 'drag past the shape saturates at 1, not beyond');

w = solve([0, 0.5, 0]);
ok(w.jawOpen >= 0, 'drag the other way does not go negative');

w = solve([1, 0.2, 0]);
ok(near(w.smile, 1, 0.05) && w.jawOpen < 0.05, 'drag along a shape picks that shape');

w = solve([0, -0.5, 0], { browUp: 0.7, jawOpen: 0.2 });
ok(!('browUp' in w), 'a shape that is not at the pin is left out of the answer entirely');
ok(near(w.jawOpen, 0.7), 'drag is relative to the anchor pose (0.2 + 0.5)');

// BOUNDED, NOT CLAMPED: with jawOpen already at 1, a further pull down-and-left goes to the
// shapes that can still move rather than being thrown away.
w = solve([-0.5, -0.5, 0.3], { jawOpen: 1 });
ok(near(w.jawOpen, 1, 1e-6) && w.pucker > 0.5, 'saturated shape stays at 1, pull goes to pucker');

// Two pins: one held still, one dragged. A shape that moves both points can only partly serve
// the dragged one without breaking the still one.
const shapes2 = new Map([
  ['both', new Float32Array([0, -1, 0, 0, -1, 0])],
  ['onlyB', new Float32Array([0, 0, 0, 0, -1, 0])],
]);
const pos2 = new Float32Array([0, 0, 0, 1, 0, 0]);
const dA = sampleDeltas(shapes2, [0], pos2, [0, 0, 0]);
const dB = sampleDeltas(shapes2, [1], pos2, [1, 0, 0]);
w = solveWeights([{ deltas: dA, drag: [0, 0, 0] }, { deltas: dB, drag: [0, -1, 0] }], {});
ok(w.onlyB > 0.9 && w.both < 0.1, 'a held pin steers the drag to the shape that leaves it alone');

// Inverse distance across a face's corners: the midpoint samples half of each.
const shapes3 = new Map([['s', new Float32Array([0, 1, 0, 0, 0, 0])]]);
const d3 = sampleDeltas(shapes3, [0, 1], pos2, [0.5, 0, 0]);
ok(near(d3.s[1], 0.5, 1e-6), 'midpoint of two corners samples half the delta');

// THE FLOOR: a trace of a shape at the grab point is not a grab of it, or a brow pass records the
// mouth shapes too and flattens the mouth pass underneath.
const shapes4 = new Map([['strong', new Float32Array([0, 1, 0])], ['trace', new Float32Array([0.01, 0, 0])]]);
const d4 = sampleDeltas(shapes4, [0], pos, [0, 0, 0], 0.15);
ok('strong' in d4 && !('trace' in d4), 'a shape below the floor at the point is not grabbed');

// WEIGHTED PINS: a weight-0 pin is no pin at all.
{
  const free = solveWeights([{ deltas: d, drag: [0, -0.5, 0] }], {});
  const with0 = solveWeights([{ deltas: d, drag: [0, -0.5, 0] }, { deltas: d, drag: [0, 2, 0], weight: 0 }], {});
  ok(near(free.jawOpen, with0.jawOpen, 1e-9), 'a weight-0 pin changes nothing');
}

// ROTATION AS A RELATIVE PIN: the ring point's column is its delta MINUS the centre's, so a shape
// that only translates the patch (moves both alike) is invisible to it, and one that turns it is
// what answers. Centre held still, ring asked to turn: the turning shape takes it.
{
  const centre = { translate: [0, 1, 0], turn: [0, 0, 0] };
  const ringRel = { translate: [0, 0, 0], turn: [0, 1, 0] };
  const w2 = solveWeights([
    { deltas: centre, drag: [0, 0, 0] },
    { deltas: ringRel, drag: [0, 0.8, 0], weight: 0.5 },
  ], {});
  ok(w2.turn > 0.6 && w2.translate < 0.05, 'a twist of the patch picks the shape that turns it, not one that moves it');
}

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all checks passed');
