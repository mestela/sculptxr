// Node harness for src/editing/MotionPathEdit.js.
//
// The arithmetic is the whole feature here, so it is lifted from the real source and run, not
// pattern-matched. What can go wrong: an edit that reaches a DIFFERENT PASS of a self-crossing
// path, a residual measured against a curve that has already been mutated, and a push-back that
// moves keys the user could not see.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/MotionPathEdit.js'), 'utf8');
const body = SRC.split('\n').filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l)).join('\n');
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_pathedit_gen.mjs');
fs.writeFileSync(outPath, 'globalThis.window = globalThis.window || {};\n' + body +
  '\nexport default MotionPathEdit;\n');
const MPE = (await import(outPath + '?v=' + Date.now())).default;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);

// A straight run along X, one unit apart, so arc length and index coincide and the numbers can
// be reasoned about by hand.
const line = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0 }));

// --- 1. falloff is centred, symmetric and bounded ----------------------------------------
{
  const pts = line(11);
  const w = MPE.weights(pts, 5, 3);
  check('the grabbed sample takes the full drag', near(w[5], 1));
  check('it is symmetric about the grab', near(w[4], w[6]) && near(w[3], w[7]));
  check('it reaches zero at the radius', near(w[2], 0) && near(w[8], 0));
  check('and stays zero beyond it', w.slice(0, 3).every((v) => near(v, 0))
    && w.slice(8).every((v) => near(v, 0)));
  check('it is monotonic on the way out', w[5] > w[6] && w[6] > w[7] && w[7] >= w[8]);
  check('nothing is ever pulled backwards', w.every((v) => v >= 0 && v <= 1));
}

// --- 2. A SELF-CROSSING PATH IS THE POINT --------------------------------------------------
//
// A walk cycle, or a hand returning to the same spot: the curve passes NEAR ITSELF at two very
// different times. Falloff along the strand leaves the other pass alone; falloff through space
// would grab both and wreck one while fixing the other.
{
  // Out along X and back again, so index 2 and index 10 are the SAME POINT in space.
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push({ x: i, y: 0, z: 0 });
  for (let i = 5; i >= 0; i--) pts.push({ x: i, y: 0.001, z: 0 });
  const iOut = 2, iBack = pts.length - 3;
  check('the two passes really are coincident in space',
    near(pts[iOut].x, pts[iBack].x, 1e-6) && near(pts[iOut].y, pts[iBack].y, 0.01),
    `${pts[iOut].x} vs ${pts[iBack].x}`);

  const w = MPE.weights(pts, iOut, 3);
  check('grabbing one pass moves it', w[iOut] > 0.9);
  check('...and leaves the other pass alone', near(w[iBack], 0),
    'a spatial falloff would edit both passes of a cycle at once');
}

// --- 3. displace is pure, and the baseline survives ----------------------------------------
{
  const pts = line(9);
  const before = pts.map((p) => ({ ...p }));
  const after = MPE.displace(pts, 4, { x: 0, y: 2, z: 0 }, 2);
  check('the drag lands on the grabbed sample', near(after[4].y, 2));
  check('the ends of the curve are untouched', near(after[0].y, 0) && near(after[8].y, 0));
  check('the input is NOT mutated',
    pts.every((p, i) => near(p.x, before[i].x) && near(p.y, before[i].y)),
    'a mutated baseline makes the residual measure the drag twice');
  check('time is never touched — displace only returns positions',
    !/times\[/.test(SRC.slice(SRC.indexOf('MotionPathEdit.displace'), SRC.indexOf('MotionPathEdit.residualAt'))));
}

// --- 4. residual at a key time ------------------------------------------------------------
{
  const times = [0, 1, 2, 3];
  const before = line(4);
  const after = before.map((p, i) => ({ x: p.x, y: i === 2 ? 5 : 0, z: 0 }));
  check('exactly on a sample it is a read, not an interpolation',
    near(MPE.residualAt(times, before, after, 2).y, 5));
  check('between samples it interpolates',
    near(MPE.residualAt(times, before, after, 1.5).y, 2.5));
  check('before the first sample it holds', near(MPE.residualAt(times, before, after, -9).y, 0));
  check('after the last it holds too', near(MPE.residualAt(times, before, after, 99).y, 0));
}

// --- 5. push-back moves keys by a DELTA ---------------------------------------------------
{
  const times = [0, 1, 2, 3];
  const before = line(4);
  const after = before.map((p, i) => ({ x: p.x, y: i === 2 ? 5 : 0, z: 0 }));
  const track = { times: [0, 2, 3], positions: [10, 10, 10, 20, 20, 20, 30, 30, 30], eulers: [1] };
  const moved = MPE.pushBack(track, times, before, after);

  check('only the keys the curve actually moved are touched', moved === 1, moved);
  check('the moved key takes the residual ON TOP of its own value',
    near(track.positions[3], 20) && near(track.positions[4], 25) && near(track.positions[5], 20),
    track.positions.slice(3, 6).join(','));
  check('an unmoved key is left exactly alone',
    near(track.positions[0], 10) && near(track.positions[1], 10));
  check('cached eulers are dropped so the registry rebuilds them', track.eulers === null);

  // Keys outside the sampled span are animation the user could not see while sculpting.
  //
  // The edit has to reach the ENDS of the curve for this to mean anything: residualAt clamps
  // outside the span, so with an edit that dies away before the ends the clamped residual is
  // zero and the keys survive whether the span is checked or not. Move the whole curve.
  const shifted = before.map((p) => ({ x: p.x, y: p.y + 7, z: p.z }));
  check('...and this case really does have a non-zero residual at the ends',
    MPE.residualAt(times, before, shifted, -5).y === 7);
  const outside = { times: [-5, 99], positions: [1, 1, 1, 2, 2, 2] };
  MPE.pushBack(outside, times, before, shifted);
  check('keys outside the sampled span are not moved',
    outside.positions.join(',') === '1,1,1,2,2,2', outside.positions.join(','));
}

// --- 6. a parented pin is refused, not guessed ---------------------------------------------
//
// Keys store the LOCAL matrix translation; the curve is drawn in model space. With a parent
// between them the residual is in the wrong space, and an animated parent makes the conversion
// time-varying rather than one matrix.
{
  check('an unparented pin is editable', MPE.editable({ getParent: () => null }) === true);
  check('a parented pin is refused', MPE.editable({ getParent: () => ({}) }) === false);
  check('and so is nothing at all', MPE.editable(null) === false);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
