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

// --- 1b. the falloff IS Move's, not something that resembles it ----------------------------
//
// A Move on a motion path has to feel like a Move on a mesh. Lifted from Move.move() and
// evaluated side by side, so the two cannot drift the first time either is tuned — comparing a
// reimplementation here would pass happily with the shipped curve replaced.
{
  const MOVE = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
  const m = MOVE.match(/var fallOff = dist \* dist;\s*\n\s*fallOff = ([^;]+);/);
  check('Move\'s falloff expression is liftable', !!m,
    'the anchor moved; this check cannot compare the two curves');
  if (m) {
    const moveFalloff = new Function('dist', 'let fallOff = dist * dist; return ' + m[1] + ';');
    // Straight unit-spaced line, so arc length from the grab equals index distance.
    const pts = line(11);
    const w = MPE.weights(pts, 5, 4);
    let worst = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.min(1, Math.abs(i - 5) / 4);
      worst = Math.max(worst, Math.abs(w[i] - moveFalloff(d)));
    }
    check('the strand falloff matches Move\'s curve exactly', worst < 1e-12, worst);
  }
}

// --- 1c. radius zero is the GRAB case ------------------------------------------------------
//
// Grab moves an OBJECT; the object under the pointer on a strand is one sample. Same machinery,
// radius zero — not a second code path that could drift from the soft one.
{
  const pts = line(7);
  const w = MPE.weights(pts, 3, 0);
  check('a grab takes the whole drag on its own sample', near(w[3], 1));
  check('...and moves nothing else', w.every((v, i) => i === 3 || near(v, 0)), w.join(','));

  const after = MPE.displace(pts, 3, { x: 0, y: 5, z: 0 }, 0);
  check('...which displace honours', near(after[3].y, 5)
    && after.every((p, i) => i === 3 || near(p.y, 0)));
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

// --- 7. the wiring in Move ---------------------------------------------------------------
{
  const MOVE = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
  const TRAIL = fs.readFileSync(path.join(REPO, 'src/editing/MotionTrail.js'), 'utf8');

  // SculptBase.start ABORTS when the click misses all geometry. A motion path arcs through
  // empty space, so hooking startSculpt would make the curve reachable only where it happens
  // to cross the model - which is the least interesting part of any path.
  check('the hook is start(), not startSculpt()',
    /start\(ctrl\) \{[\s\S]{0,400}?MotionPathEdit\.begin\(/.test(MOVE),
    'hooked after the pick, so a curve off the model would be unreachable');
  check('...and a stroke that is NOT on the curve falls through unchanged',
    /return super\.start\(ctrl\);/.test(MOVE));

  // start() is SHARED between mouse and headset; sculptStroke() is not. Without a guard a VR
  // stroke reaches begin() with a stale mouse position, sometimes hits, and SWALLOWS the
  // stroke — start() returns true so super.start() never runs.
  const BEGIN = SRC.slice(SRC.indexOf('MotionPathEdit.begin'), SRC.indexOf('MotionPathEdit.drag'));
  check('begin() refuses to run during a VR stroke',
    /if \(main\._vrSculpting \|\| main\._xrSession\) return false;/.test(BEGIN),
    'a headset stroke would be intermittently swallowed');

  check('the drag runs before the mesh guard in sculptStroke',
    /sculptStroke\(\) \{\s*\n\s*if \(MotionPathEdit\.active/.test(MOVE),
    'the mesh guard would return first in a rig-only scene');
  // Both of these moved into MotionPathEdit.endStroke when Smooth arrived and needed the same
  // two steps. Assert them where they now live — checking Move's file would report the
  // de-duplication as a regression.
  const END = SRC.slice(SRC.indexOf('MotionPathEdit.endStroke'));
  check('push-back happens on stroke end', /MotionPathEdit\.finish\(main\)/.test(END));
  check('...and the trail is forced to rebuild from the written keys',
    /main\._trailSig = null;/.test(END),
    'redrawing the dragged points instead would hide a push-back that disagreed with them');
  check('...and every tool goes through it', /MotionPathEdit\.endStroke\(main\)/.test(MOVE));

  // Re-sampling under a live drag fights the drag AND costs a full solve per frame.
  check('MotionTrail yields while an edit is live', /if \(main\._pathEdit\) return false;/.test(TRAIL));
  check('only the AUTHORED curve is offered to the editor',
    /targets\.findIndex\(\(t\) => t\.control\)/.test(TRAIL),
    'solver output is not editable');
  check('the editor gets the times, not just the points',
    /times: main\._trailTimes/.test(TRAIL));
}

// --- 8. the baseline survives the drag ----------------------------------------------------
//
// Every frame measures against the curve as it was when the drag STARTED. Measuring against the
// curve that is already being dragged compounds the delta and the edit runs away under the
// cursor - which looks like a sensitivity bug, not a baseline bug.
{
  const PE = SRC.slice(SRC.indexOf('MotionPathEdit.begin'), SRC.indexOf('MotionPathEdit.drag'));
  check('begin deep-copies the baseline',
    /before: strand\.points\.map\(\(p\) => \(\{ x: p\.x, y: p\.y, z: p\.z \}\)\)/.test(PE),
    'a reference would be a view of the array the drag writes to');
  const DR = SRC.slice(SRC.indexOf('MotionPathEdit.drag'), SRC.indexOf('MotionPathEdit.finish'));
  check('and drag displaces from that baseline, not from the live curve',
    /displace\(e\.before,/.test(DR) && !/displace\(e\.after/.test(DR));
}

// --- 9. smoothing a strand ----------------------------------------------------------------
{
  // A spike on an otherwise straight run: exactly the hand-recorded jitter this is for.
  const pts = line(9).map((p, i) => ({ ...p, y: i === 4 ? 4 : 0 }));
  const out = MPE.smoothed(pts, 4, 4, 1);
  check('the spike comes down', Math.abs(out[4].y) < Math.abs(pts[4].y), out[4].y);
  check('...toward the average of its neighbours', near(out[4].y, 0), out[4].y);

  // A Laplacian SHORTENS a curve, so an unpinned end creeps inward every pass and the take
  // quietly loses its first and last poses - which reads as keys drifting for no reason.
  const ends = MPE.smoothed(line(9), 4, 99, 1);
  check('the endpoints are pinned',
    near(ends[0].x, 0) && near(ends[8].x, 8), ends[0].x + '..' + ends[8].x);

  check('outside the radius nothing relaxes',
    near(MPE.smoothed(pts, 8, 1, 1)[4].y, 4),
    'the falloff must gate smoothing the same way it gates a move');
  check('strength 0 is a no-op',
    MPE.smoothed(pts, 4, 4, 0).every((p, i) => near(p.y, pts[i].y)));

  // Iterative by nature: holding the brush still keeps relaxing, so each step reads the CURRENT
  // curve. The baseline must survive it, or push-back measures the last frame instead of the
  // whole gesture.
  const main = { _pathEdit: { before: pts.map((p) => ({ ...p })), after: null, index: 4, radius: 4 } };
  MPE.smoothStep(main, 1);
  const firstY = main._pathEdit.after[4].y;
  MPE.smoothStep(main, 1);
  check('smoothing accumulates across frames',
    Math.abs(main._pathEdit.after[4].y) <= Math.abs(firstY));
  check('...and the baseline is never overwritten',
    near(main._pathEdit.before[4].y, 4), main._pathEdit.before[4].y);
}

// --- 10. the stroke end is shared, not repeated per tool -----------------------------------
{
  const MOVE = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
  const SMOOTH = fs.readFileSync(path.join(REPO, 'src/editing/tools/Smooth.js'), 'utf8');
  check('Smooth hooks start() too', /start\(ctrl\) \{[\s\S]{0,300}?MotionPathEdit\.begin\(/.test(SMOOTH));
  check('both tools end through ONE shared path',
    /MotionPathEdit\.endStroke\(/.test(MOVE) && /MotionPathEdit\.endStroke\(/.test(SMOOTH),
    'push-back plus the forced rebuild is exactly the two-step that gets half-copied');
  check('...and neither reimplements it',
    !/_trailSig = null/.test(SMOOTH) && !/_trailSig = null/.test(MOVE));
}

// --- 11. the headset path -----------------------------------------------------------------
//
// The version without projection: a controller tip is already a point in the world, so
// acquiring the curve is a distance and the drag is a real 3D delta. Both bugs on the mouse
// side came from choosing a depth, and there is no depth to choose here.
{
  const strand = {
    points: line(9),
    times: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    pin: { getID: () => 1, getParent: () => null, _pinnedJoint: {} },
    line: 0,
  };
  const main = { _trailStrand: strand, _vrControllerPos: [4, 0.02, 0], render() {} };

  check('a tip near the curve takes hold of the nearest sample',
    MPE.beginXR(main, [4, 0.02, 0], 0.5) === true && main._pathEdit.index === 4,
    main._pathEdit && main._pathEdit.index);
  check('...and the reach is a plain 3D distance',
    MPE.beginXR({ ...main, _pathEdit: null }, [4, 9, 0], 0.5) === false,
    'a tip far off the curve must not acquire it');

  // THE TIP, NOT THE PIVOT. The pivot sits inside your hand, a spike-length short of where you
  // are aiming, so a proximity grab from it reads as taking the curve from behind the cursor.
  {
    const tipOpts = { handedness: 'right',
      controllers: [{ handedness: 'left', rayOrigin: [99, 99, 99] },
                    { handedness: 'right', rayOrigin: [4, 0.02, 0] }] };
    const m2 = { _trailStrand: strand, _vrControllerPos: [4, 9, 9], render() {} };
    const t2 = {};
    check('the VR reach uses the stylus tip from the controller snapshot',
      MPE.strokeXR(m2, null, true, t2, 'move', 0, tipOpts) === true,
      'the pivot is metres away here, so this can only pass by reading rayOrigin');
    check('...and picks the snapshot for the hand driving the stroke',
      m2._pathEdit && m2._pathEdit.index === 4, m2._pathEdit && m2._pathEdit.index);
  }

  main._pathEdit.after = null;
  MPE.dragXR(main, [4, 1.02, 0]);
  check('the drag is the tip delta, with no unprojection',
    near(main._pathEdit.after[4].y, 1), main._pathEdit.after[4].y);
  // The property is that the baseline is a COPY, not a view of the live strand — assert it by
  // moving the strand underneath and checking the baseline did not follow. Reading it back
  // after a pure displace passes either way and proves nothing.
  strand.points[4] = { x: 4, y: 77, z: 0 };
  check('...and the baseline is a copy, not a view of the live strand',
    near(main._pathEdit.before[4].y, 0), main._pathEdit.before[4].y);
  strand.points[4] = { x: 4, y: 0, z: 0 };

  // Retrying begin on every held frame would snatch the curve mid-sculpt the moment a stroke
  // passed near it.
  //
  // The defect is SNATCHING MID-STROKE: press away from the curve, sculpt, and the moment the
  // controller happens to pass near the path it would be grabbed. So the press must miss and
  // the tip must then arrive ON the curve while still held.
  const tool = {};
  main._pathEdit = null;
  const held = { _trailStrand: strand, _vrControllerPos: [4, 9, 0], render() {} };
  check('the press edge away from the curve does not acquire',
    MPE.strokeXR(held, null, true, tool, 'move') === false && tool._pathXRHeld === true);
  held._vrControllerPos = [4, 0.02, 0];   // now right on it, trigger still down
  check('...and arriving on the curve mid-stroke does NOT snatch it',
    MPE.strokeXR(held, null, true, tool, 'move') === false && !held._pathEdit,
    'the curve would be grabbed out from under an ordinary sculpt');
  // Releasing and pressing again on the curve is a new edge, and must work.
  MPE.strokeXR(held, null, false, tool, 'move');
  check('...but a fresh press on it does acquire',
    MPE.strokeXR(held, null, true, tool, 'move') === true);
  held._pathEdit = null;

  const SM = fs.readFileSync(path.join(REPO, 'src/editing/tools/Smooth.js'), 'utf8');
  const MV = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
  check('both tools take the VR frame through ONE shared helper',
    /MotionPathEdit\.strokeXR\(this\._main, picking, isPressed, this, 'move'/.test(MV)
      && /MotionPathEdit\.strokeXR\(this\._main, picking, isPressed, this, 'smooth'/.test(SM),
    'the press-edge bookkeeping is what gets a subtly different second implementation');
  // The tip lives on the per-controller snapshot, so both tools have to forward `options` or
  // they silently fall back to the pivot - which is the bug this pair of checks now guards.
  check('...and both forward the controller snapshot the TIP is read from',
    /'move', 0, options\)/.test(MV) && /'smooth', this\._intensity, options\)/.test(SM),
    'without options the tip falls back to the controller pivot');
  check('...which Move can only do by accepting it',
    /updateXR\(picking, isPressed, origin, dir, options\)/.test(MV));
  check('...and a frame it does not consume falls through to the tool',
    /if \(MotionPathEdit\.strokeXR\([^)]*\)\) return;/.test(MV)
      && /return super\.updateXR\(/.test(SM));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
