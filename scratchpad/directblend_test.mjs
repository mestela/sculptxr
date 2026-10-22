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

// SPARSE: a drag that one shape answers exactly, but two others can also make between them. Plain
// least squares spreads it across all three (the facecap mouth); sparse lets the one shape take it.
{
  const dd = { one: [1, 0, 0], up: [0.7, 0.7, 0], down: [0.7, -0.7, 0] };
  const plain = solveWeights([{ deltas: dd, drag: [0.5, 0, 0] }], {});
  const sp = solveWeights([{ deltas: dd, drag: [0.5, 0, 0] }], {}, { sparse: 0.03 });
  ok(plain.up > 0.05 && plain.down > 0.05, 'without sparse, the drag is spread across every shape that can make it');
  ok(sp.one > 0.4 && sp.up < 0.03 && sp.down < 0.03, 'with sparse, the one shape takes it and the others stay off');
  const still = solveWeights([{ deltas: dd, drag: [0, 0, 0] }], { one: 0.6, up: 0.3 }, { sparse: 0.01 });
  ok(near(still.one, 0.6, 1e-6) && near(still.up, 0.3, 1e-6), 'sparse acts on the CHANGE: a grab that does not move leaves the face alone');
}

// RULES. TIE (symmetry): the follower gets the leader's weight, even though it does not touch the
// point. EXCLUDE: never answers. EXCLUSIVE: two opposing shapes whose sideways halves cancel are
// not both used to make a downward pull. UNDER: a corrective never exceeds what it corrects.
{
  const pair = { blinkL: [0, -1, 0], blinkR: [0, 0, 0] };
  const t = solveWeights([{ deltas: pair, drag: [0, -0.5, 0] }], {}, { tie: [['blinkL', 'blinkR']] });
  ok(near(t.blinkL, 0.5) && near(t.blinkR, 0.5), 'tied: blinking one eye blinks the other');
  const ex = solveWeights([{ deltas: { jawLeft: [1, 0, 0], other: [0.5, 0, 0] }, drag: [0.5, 0, 0] }], {}, { exclude: ['jawLeft'] });
  ok(!('jawLeft' in ex) && ex.other > 0.9, 'excluded: the shape never answers, the drag goes elsewhere');
  const lr = { left: [1, -0.3, 0], right: [-1, -0.3, 0], down: [0, -1, 0] };
  const both = solveWeights([{ deltas: lr, drag: [0, -0.3, 0] }], {});
  const one = solveWeights([{ deltas: lr, drag: [0, -0.3, 0] }], {}, { exclusive: [['left', 'right']] });
  ok(both.left > 0.05 && both.right > 0.05, 'without the rule, opposing shapes cancel sideways to pull down');
  ok(!(one.left > 0.02 && one.right > 0.02), 'exclusive: at most one of an opposing pair is on');
  const cl = { close: [0, 1, 0], jaw: [0, -0.2, 0.5] };
  const shut = solveWeights([{ deltas: cl, drag: [0, 0.5, 0] }], {}, { under: { close: 'jaw' } });
  ok((shut.close || 0) <= (shut.jaw || 0) + 1e-6, 'under: mouthClose never exceeds jawOpen');
  const open = solveWeights([{ deltas: { close: [0, 1, 0] }, drag: [0, 0.3, 0] }], { jaw: 0.8 }, { under: { close: 'jaw' } });
  ok(near(open.close, 0.3), '...and with the jaw open (not at the pin) it closes the lips freely up to it');
}

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all checks passed');
