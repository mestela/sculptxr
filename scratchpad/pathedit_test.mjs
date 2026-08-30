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
// Defect injections (standing lesson 1) — see the ROTATION section at the bottom.
//   PE_INJECT=postmul       the twist is applied in each sample's OWN frame (q * delta), so a
//                           held section stops being rigid and every gnomon spins in place
//   PE_INJECT=lerpweight    the falloff scales the quaternion's components instead of slerping
//                           from identity, which is not a rotation and gives the wrong angle
//   PE_INJECT=diffresidual  the rotation residual is a subtraction, not after * inv(before)
//   PE_INJECT=owncentre   each curve measures the falloff from its own nearest sample
//   PE_INJECT=noextras    only the grabbed curve is ever gathered, so Connectivity off is
//                         still implicitly one object
//   PE_INJECT=nopushquat    finish() stops writing the rotation channel
let INJ_BODY = null;
{
  const i = process.env.PE_INJECT || '';
  if (i === 'postmul') INJ_BODY = ['const r = normQ(mulQ(scaleQuat(delta, w[i]), b));',
    'const r = normQ(mulQ(b, scaleQuat(delta, w[i])));'];
  else if (i === 'lerpweight') INJ_BODY = ['const r = normQ(mulQ(scaleQuat(delta, w[i]), b));',
    'const r = normQ(mulQ([delta[0] * w[i], delta[1] * w[i], delta[2] * w[i], delta[3] * w[i]], b));'];
  else if (i === 'diffresidual') INJ_BODY = ['return mulQ(a, invQ(b));',
    'return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];'];
  else if (i === 'nogate') INJ_BODY = ['const delta = ch.translate ? reach : ZERO;',
    'const delta = reach;'];
  else if (i === 'swinggate') INJ_BODY = ['ch.translate ? twist : null, e.startWorld, e.falloff);',
    'ch.rotate ? twist : null, e.startWorld, e.falloff);'];
  else if (i === 'owncentre') INJ_BODY = [
    'const c = (opts && opts.center) || points[index];',
    'const c = points[index];'];
  else if (i === 'noextras') INJ_BODY = [
    '  if (e.falloff.connected !== false) return null;',
    '  if (true) return null;'];
  else if (i === 'headstrand') INJ_BODY = [
    'for (let s = 0; s < strands.length; s++) {',
    'for (let s = 0; s < Math.min(1, strands.length); s++) {'];
  else if (i === 'nopushquat') INJ_BODY = [
    'sh.turned = MotionPathEdit.pushBackQuats(t, rec.strand.times, rec.beforeQ, rec.afterQ);',
    'sh.turned = 0;'];
}

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_pathedit_gen.mjs');
// Undo has to re-solve the rig, not just rewrite the pin's track, so the solver is stubbed and
// its calls counted rather than being left undefined.
const prelude = 'globalThis.window = globalThis.window || {};\n' +
  'globalThis.__holds = 0;\n' +
  'const IKSolver = { holdPins: () => { globalThis.__holds++; } };\n' +
  'const Enums = { Tools: { MOVE: 10, SMOOTH: 1, TRANSFORM: 13, GRAB: 15, TRANSFORM_VR: 16, BONE_DRAW: 34 } };\n' +
  // The falloff mode is a persisted option; the harness drives it through the live override so
  // each case says which mode it is testing rather than depending on a saved default.
  'const getOptionsURL = () => (globalThis.__opts || {});\n';
// THE SOURCE THE HARNESS ACTUALLY RUNS. Every structural check below reads THIS, not the file
// on disk: the injections rewrite it on its way to the module, so a check that re-reads SRC is
// looking at source that is not being run and passes cheerfully with the defect in place. That
// mistake has been made three times in this project; PE_INJECT=nopushquat caught the fourth.
let MPS = body.split('\n').filter((l) => !/^import\s/.test(l)).join('\n');
if (INJ_BODY) {
  if (!MPS.includes(INJ_BODY[0])) throw new Error('inject: the anchor moved — ' + INJ_BODY[0]);
  MPS = MPS.replace(INJ_BODY[0], INJ_BODY[1]);
}
fs.writeFileSync(outPath, prelude + MPS + '\nexport default MotionPathEdit;\n');
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

// --- 1d. connectivity: along the strand, or straight through space ------------------------
//
// A motion path is monotonic in time, so travelling ALONG it is travelling through time — near
// on the strand and near in the animation are the same thing. That is what makes connectivity
// implicitly a time-ordered falloff, and it is why it is the default.
{
  // Out along X and back, so index 2 and index 14 are almost the same POINT in space and about
  // as far apart in time as the curve allows.
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: i, y: 0, z: 0 });
  for (let i = 7; i >= 0; i--) pts.push({ x: i, y: 0.001, z: 0 });
  const other = pts.length - 3;

  const on = MPE.weights(pts, 2, 3, { connected: true });
  const off = MPE.weights(pts, 2, 3, { connected: false });

  check('connected on: the other pass is untouched', near(on[other], 0),
    'this is the walk-cycle case — fixing frame 12 must not wreck frame 90');
  check('connected OFF: the other pass comes with it', off[other] > 0.5,
    'reaching every pass through a region is the whole point of turning it off');
  check('either way the grabbed sample takes the full drag',
    near(on[2], 1) && near(off[2], 1));
  check('and neither reaches past the radius along its own measure',
    near(on[8], 0) && near(off[8], 0), on[8] + ' / ' + off[8]);

  // Default matters: the mode that can silently edit a second pass must be the one you ASK for.
  check('connectivity defaults to ON when nothing is said',
    near(MPE.weights(pts, 2, 3)[other], 0),
    'the default must be the mode that cannot silently edit a second pass');

  // ...and that has to hold for the SAVED setting too, not just the weights call. A fresh
  // profile has never written this option, so it reads back undefined.
  globalThis.__opts = {};
  delete globalThis.window._pathConnected;
  check('...including when the option has never been saved', MPE.connected() === true,
    'undefined must mean connected, or a new user gets the destructive mode by default');
  globalThis.__opts = { pathConnected: false };
  check('...but an explicit false is honoured', MPE.connected() === false);
  globalThis.window._pathConnected = true;
  check('...and the live override wins over the saved value', MPE.connected() === true);
  delete globalThis.window._pathConnected;
  globalThis.__opts = {};
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
  // The property is that a live edit does not RESAMPLE — not the exact spelling of the guard,
  // which grew a recolour call when the time gradient arrived. Assert that the _pathEdit branch
  // returns before any sampling happens.
  {
    const up = TRAIL.slice(TRAIL.indexOf('MotionTrail.update = function'));
    // Bound by the GUARD'S OWN BLOCK. Searching forward for any `return false` finds the
    // trails-are-off branch further down and passes with the guard's return deleted, which is
    // precisely the defect.
    const g = up.match(/if \(main\._pathEdit\)\s*(\{[^}]*\}|[^\n]*)/);
    check('MotionTrail yields while an edit is live',
      !!g && /\breturn\b/.test(g[1]),
      'a resample under a live drag fights it and costs a solve per frame');
  }
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
    /'move', this\._intensity, options\)/.test(MV)
      && /'smooth', this\._intensity, options\)/.test(SM),
    'without options the tip falls back to the controller pivot');
  check('...and Move passes its intensity, which damps the twist',
    /'move', this\._intensity, options\)/.test(MV),
    'the strength slider has to mean the same thing on a curve as on a mesh');
  check('...which Move can only do by accepting it',
    /updateXR\(picking, isPressed, origin, dir, options\)/.test(MV));
  check('...and a frame it does not consume falls through to the tool',
    /if \(MotionPathEdit\.strokeXR\([^)]*\)\) return;/.test(MV)
      && /return super\.updateXR\(/.test(SM));
}

// --- 12. UNDO ------------------------------------------------------------------------------
//
// One gesture, one step. And undoing it has to put back three things, not one: the keys, the
// rig they drive, and the curve drawn from them.
{
  const pin = { getID: () => 5, getParent: () => null, _pinnedJoint: {} };
  const track = { times: [0, 1, 2], positions: [0,0,0, 0,0,0, 0,0,0], eulers: [1] };
  const reg = { tracks: new Map([[5, track]]), updated: [], update(m) { this.updated.push(m); } };
  globalThis.window._animationRegistry = reg;

  const pushed = [];
  const main = {
    _pathEdit: {
      strand: { pin: pin, times: [0, 1, 2], line: 0 },
      before: line(3),
      after: line(3).map((p, i) => ({ ...p, y: i === 1 ? 6 : 0 })),
      index: 1, radius: 2,
    },
    getStateManager: () => ({
      pushStateCustom: (undo, redo, squash, name) => pushed.push({ undo, redo, squash, name }),
    }),
    render() {},
  };

  const moved = MPE.finish(main);
  check('the edit moved a key', moved === 1, moved);
  // Guarded, so a missing step FAILS here instead of throwing three lines down and taking the
  // whole harness with it — a crash reports nothing, which is worse than a red line.
  check('exactly ONE undo step for the whole gesture', pushed.length === 1, pushed.length);
  const step = pushed[0];
  check('...named so it reads in the history', !!step && step.name === 'Edit Motion Path');
  check('...and NOT squashed into the step before it', !!step && step.squash === false,
    'squashing would fold a path edit into whatever the user did previously');
  check('the key holds the edit', near(track.positions[4], 6), track.positions[4]);

  if (step) {
    step.undo();
    check('undo puts the keys back', near(track.positions[4], 0), track.positions[4]);
    step.redo();
    check('and redo re-applies them', near(track.positions[4], 6), track.positions[4]);
  } else {
    check('undo puts the keys back', false, 'no undo step to run');
    check('and redo re-applies them', false, 'no undo step to run');
  }

  // Writing the track alone moves the PIN; every joint it drives comes from the solve, so
  // without re-solving an undo leaves the limb where the edit put it.
  const FIN = SRC.slice(SRC.indexOf('MotionPathEdit.finish'));
  check('undo re-solves the rig, not just the pin', /IKSolver\.holdPins\(main\)/.test(FIN),
    'the pin would jump back and the limb would stay put');

  // The drawing has to follow too, and it does it by NOTICING rather than being told.
  const TRAIL = fs.readFileSync(path.join(REPO, 'src/editing/MotionTrail.js'), 'utf8');
  check('the trail fingerprint hashes key VALUES, not only times',
    /pacc \+= pos\[i\] \* \(i \+ 1\)/.test(TRAIL),
    'push-back changes positions and nothing else, so a times-only fingerprint cannot see it');

  // A gesture that moved nothing must not litter the history with an empty step.
  pushed.length = 0;
  main._pathEdit = {
    strand: { pin: pin, times: [0, 1, 2], line: 0 },
    before: line(3), after: line(3), index: 1, radius: 2,
  };
  MPE.finish(main);
  check('a gesture that changed nothing pushes no undo step', pushed.length === 0);
}

// --- 13. 6DOF: twisting the controller turns the section you are holding -------------------
//
// matt: "I keep instinctively twisting my controller and keep getting surprised it only reads
// translation." The requirement is explicit — it should behave as a twist does under an
// ordinary mesh Move — so the arithmetic is lifted from Move.move() rather than invented, and
// checked against it here.
{
  const pts = line(9);
  const c = { x: 4, y: 0, z: 0 };            // grab point, mid-curve
  const halfPi = Math.PI / 4;                 // 90 degrees about Z
  const qz = [0, 0, Math.sin(halfPi), Math.cos(halfPi)];

  const out = MPE.displace(pts, 4, { x: 0, y: 0, z: 0 }, 99, qz, c);
  check('a twist alone moves the curve, with no translation at all',
    Math.abs(out[8].y - pts[8].y) > 0.5, out[8].y);
  // The centre is the HAND, not the grabbed sample, and in VR the two are never quite the same
  // point. Tested with them deliberately apart: with the centre set to the grabbed sample the
  // two implementations agree exactly, so the check could not tell them apart.
  {
    const off = { x: 0, y: 0, z: 0 };          // grab centre at the origin, sample 4 at x=4
    const o2 = MPE.displace(pts, 4, { x: 0, y: 0, z: 0 }, 99, qz, off);
    check('...about the supplied centre, not the grabbed sample',
      near(o2[4].x, 0, 0.02) && near(o2[4].y, 4, 0.02),
      'a quarter turn about the ORIGIN takes sample 4 from (4,0) to (0,4); about itself it would not move');
  }
  check('...so the point at the centre itself does not move',
    near(out[4].x, 4) && near(out[4].y, 0),
    'rotating each point about itself would spin samples in place instead of swinging the curve');
  // Tolerance of 0.01, not 1e-6: the falloff is a smooth curve, so even at a huge radius a
  // point 4 units from the grab weighs a shade under 1. Demanding exactness here would be
  // asserting that the falloff does not apply, which is the opposite of the rule above.
  check('...and a point 4 along +X swings to +Y under a quarter turn about Z',
    near(out[8].x, 4, 0.01) && near(out[8].y, 4, 0.01),
    Array.of(out[8].x, out[8].y, out[8].z).join(','));
  check('...with the far side swinging the other way',
    near(out[0].y, -4, 0.01), out[0].y);

  // The falloff gates rotation exactly as it gates translation.
  const narrow = MPE.displace(pts, 4, { x: 0, y: 0, z: 0 }, 2, qz, c);
  check('the twist is under the falloff too',
    near(narrow[8].y, 0) && Math.abs(narrow[5].y) > 0,
    'a rotation that ignores falloff turns the whole curve however small the brush');

  // Translation and rotation add, which is what makes a 6DOF drag one gesture rather than two.
  const both = MPE.displace(pts, 4, { x: 0, y: 10, z: 0 }, 99, qz, c);
  check('translation and twist combine',
    both[8].y > out[8].y && near(both[8].y - out[8].y, 10, 0.01),
    both[8].y + ' vs ' + out[8].y);

  // THE SAME ARITHMETIC AS THE MESH TOOL. Lifted from Move.move() and run side by side: a
  // reimplementation here would pass happily with the shipped rule replaced.
  {
    const MOVE = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
    check('Move rotates about a centre and ADDS the result to the translation',
      /vAr\[ind\] \+= \(dirx \+ rotX\) \* fallOff;/.test(MOVE)
        && /var rCenter = rotCenter \|\| center;/.test(MOVE),
      'the anchor moved; the claim that these behave alike is no longer checked');
  }

  // No controller quaternion at all — the mouse — must be plain translation, not a crash.
  const flat = MPE.displace(pts, 4, { x: 0, y: 1, z: 0 }, 99, null, c);
  check('with no rotation supplied it is a plain translation', near(flat[4].y, 1));
}

// --- 14. the twist is measured from the GRAB, once ------------------------------------------
{
  const strand = { points: line(9), times: [0,1,2,3,4,5,6,7,8],
    pin: { getID: () => 1, getParent: () => null, _pinnedJoint: {} }, line: 0 };
  const main = { _trailStrand: strand, _vrControllerQuat: [0, 0, 0, 1], render() {} };
  // A radius that reaches the sample the checks below measure: at 0.5 the far end weighs zero
  // and every twist assertion would pass by measuring a point the brush never touched.
  MPE.beginXR(main, [4, 0, 0], 99);
  check('the grab pose is inverted and kept', !!main._pathEdit.startQuatInv);

  // Still at the grab pose: no twist, whatever else has happened.
  MPE.dragXR(main, [4, 0, 0], 1);
  check('holding the grab pose applies no twist', near(main._pathEdit.after[8].y, 0),
    main._pathEdit.after[8].y);

  // A frame-to-frame delta would compose into a ratchet that never returns to zero; measured
  // against the grab, turning back returns the curve exactly where it started.
  const q = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  main._vrControllerQuat = q;
  MPE.dragXR(main, [4, 0, 0], 1);
  const turned = main._pathEdit.after[8].y;
  MPE.dragXR(main, [4, 0, 0], 1);
  check('holding a turn steady does not keep turning',
    near(main._pathEdit.after[8].y, turned, 1e-9), main._pathEdit.after[8].y + ' vs ' + turned);
  main._vrControllerQuat = [0, 0, 0, 1];
  MPE.dragXR(main, [4, 0, 0], 1);
  check('...and turning back returns it exactly', near(main._pathEdit.after[8].y, 0, 1e-9),
    'a frame-to-frame delta ratchets and never comes home');

  // Intensity damps the twist, the same slerp-from-identity the mesh tool uses.
  main._vrControllerQuat = q;
  MPE.dragXR(main, [4, 0, 0], 1);
  const full = main._pathEdit.after[8].y;
  MPE.dragXR(main, [4, 0, 0], 0.5);
  const half = main._pathEdit.after[8].y;
  check('intensity damps the twist', Math.abs(half) > 0 && Math.abs(half) < Math.abs(full),
    half + ' vs ' + full);
  MPE.dragXR(main, [4, 0, 0], 0);
  check('...and zero intensity leaves only the translation',
    near(main._pathEdit.after[8].y, 0, 1e-9), main._pathEdit.after[8].y);
}

// --- ROTATION: the twist reaches the KEYED ORIENTATIONS -----------------------------------
//
// The gnomons drew a rotation nobody could edit. Positions had swung around the hand since
// v3.20.26 while the orientations sat still, so a twist moved the path and left every triad on
// its old heading. matt: they "are not hooked into the grab tool to allow the user to twist and
// sculpt those keys".
//
// The arithmetic is where this goes wrong quietly, so it is RUN rather than read. Two mistakes
// both look like a working twist: applying the delta in each sample's own frame (the held
// section stops being rigid), and scaling a quaternion by the falloff instead of slerping (a
// rotation by the wrong angle, which just reads as a weak brush).
const QI = { x: 0, y: 0, z: 0, w: 1 };
const axisQ = (ax, ay, az, deg) => {
  const h = (deg * Math.PI / 180) / 2, sn = Math.sin(h);
  return [ax * sn, ay * sn, az * sn, Math.cos(h)];
};
const qArr = (q) => (Array.isArray(q) ? q : [q.x, q.y, q.z, q.w]);
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
// Sign-independent: q and -q are the same rotation.
const qAngle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

{
  const pts = line(11);
  const rest = pts.map(() => ({ ...QI }));
  const out = MPE.twisted(pts, rest, 5, axisQ(0, 0, 1, 90), 3);

  check('the grabbed key takes the full twist',
    near(qAngle(qArr(out[5])), Math.PI / 2, 1e-6), qAngle(qArr(out[5])));
  check('...and a key at the radius is not turned at all',
    near(qAngle(qArr(out[2])), 0, 1e-9), qAngle(qArr(out[2])));
  check('...with the ones between turned partway, monotonically',
    qAngle(qArr(out[4])) > qAngle(qArr(out[3]))
      && qAngle(qArr(out[3])) > qAngle(qArr(out[2])));
  check('the falloff is symmetric about the grab, as it is for position',
    near(qAngle(qArr(out[4])), qAngle(qArr(out[6])), 1e-9));

  // THE WEIGHT IS A SLERP, NOT A SCALE. At w = 0.5 the result must be HALF THE ANGLE. Scaling
  // the components gives something that is not a rotation, and normalising it afterwards lands
  // on a different angle entirely — which reads as the brush merely being weak.
  const w = MPE.weights(pts, 5, 3);
  const i = w.findIndex((v) => Math.abs(v - 0.5) < 0.2);
  check('...and a half-weight key turns by half the ANGLE',
    near(qAngle(qArr(out[i])), (Math.PI / 2) * w[i], 1e-6),
    qAngle(qArr(out[i])) + ' vs ' + (Math.PI / 2) * w[i]);
  check('the baseline orientations are not mutated',
    rest[5].w === 1 && rest[5].z === 0,
    'a mutated baseline compounds the twist frame over frame');
}

// PREMULTIPLIED — the twist is about the axis the WRIST turned about, in the world the curve is
// drawn in, so a held section swings together as one rigid thing. Applied in each sample's own
// frame instead, the relative rotation between two samples changes, and what you see is every
// gnomon spinning in place rather than a section turning. Two samples at EQUAL weight either
// side of the grab, so the only difference between the candidates is the composition order.
{
  const pts = line(11);
  const rest = pts.map((_, i) => {
    const q = axisQ(1, 0, 0, i * 17);          // each sample on a different heading
    return { x: q[0], y: q[1], z: q[2], w: q[3] };
  });
  const was = qMul(qInv(qArr(rest[4])), qArr(rest[6]));
  const out = MPE.twisted(pts, rest, 5, axisQ(0, 0, 1, 80), 3);
  const now = qMul(qInv(qArr(out[4])), qArr(out[6]));
  check('a held section stays rigid — the angle between two equal-weight keys is preserved',
    near(qAngle(was), qAngle(now), 1e-9),
    qAngle(was) + ' -> ' + qAngle(now)
      + ' — turning each key in its own frame is not a grab, it is a spin');
}

// THE RESIDUAL IS A RATIO: after * inv(before), not after - before. The difference of two
// quaternions is not a rotation, and pushing it onto a key is meaningless.
{
  const pts = line(5);
  const times = [0, 1, 2, 3, 4];
  const rest = pts.map((_, i) => {
    const q = axisQ(0, 1, 0, i * 11);
    return { x: q[0], y: q[1], z: q[2], w: q[3] };
  });
  const out = MPE.twisted(pts, rest, 2, axisQ(0, 0, 1, 60), 99);  // radius past the ends
  const r = MPE.residualQuatAt(times, rest, out, 2);
  check('on a sample the residual is exactly the rotation that was applied',
    near(qAngle(qArr(r)), Math.PI / 3, 1e-6), qAngle(qArr(r)));
  check('...whatever the key was already holding',
    near(qAngle(qMul(qArr(r), qArr(rest[2]))), qAngle(qArr(out[2])), 1e-6),
    'a residual that depends on the baseline is not a residual');
  check('between samples it interpolates as a rotation',
    near(qAngle(qArr(MPE.residualQuatAt(times, rest, out, 1.5))), Math.PI / 3, 1e-6));
  check('outside the span it holds at the end sample',
    near(qAngle(qArr(MPE.residualQuatAt(times, rest, out, 99))), Math.PI / 3, 1e-6));
}

// PUSH-BACK onto the track's quaternion channel: same span rule as positions, composed on top
// of whatever the key already held, left normalised.
{
  const pts = line(5);
  const times = [0, 1, 2, 3, 4];
  const rest = pts.map(() => ({ ...QI }));
  const out = MPE.twisted(pts, rest, 2, axisQ(0, 0, 1, 90), 1.5);
  const start = axisQ(1, 0, 0, 30);
  const track = { times: [2, 9], quaternions: [...start, 0, 0, 0, 1], eulers: [1, 2, 3] };
  const turned = MPE.pushBackQuats(track, times, rest, out);

  check('a key inside the span is turned', turned === 1, turned);
  check('...composed ON TOP of the rotation it already held',
    near(qAngle(track.quaternions.slice(0, 4)), qAngle(qMul(axisQ(0, 0, 1, 90), start)), 1e-6),
    'overwriting instead of composing throws away the pose that was already keyed');
  check('...and written normalised',
    near(Math.hypot(...track.quaternions.slice(0, 4)), 1, 1e-9),
    'a key can be twisted many times; unnormalised the error compounds into a scale');
  check('a key outside the sampled span is left exactly alone',
    track.quaternions.slice(4).join() === '0,0,0,1',
    'the curve makes no claim about time the user could not see');
  check('cached eulers are dropped so the registry rebuilds them', track.eulers === null);

  // A drag with no twist in it must write nothing, or every Move costs a rotation key and an
  // undo entry for a rotation that did not change.
  const flat = { times: [2], quaternions: [0, 0, 0, 1], eulers: null };
  check('an untwisted gesture turns no key',
    MPE.pushBackQuats(flat, times, rest, rest.map((q) => ({ ...q }))) === 0);
  check('...and a curve carrying no orientations is simply not a rotation edit',
    MPE.pushBackQuats(flat, times, null, null) === 0,
    'a read-only curve has no quats; asking must be free, not a throw');
}

// THE WIRING: captured at the grab, twisted by the SAME delta as the positions, pushed back and
// undone as one gesture, and drawn live while the hand is still moving.
{
  check('the grab copies the baseline orientations',
    /beforeQ: strand\.quats \? strand\.quats\.map\(\(q\) => readQ\(q\)\) : null/.test(MPS),
    'sharing the array with the drag compounds the twist every frame');
  // Three separate greps rather than one spanning regex: the first version measured the gap
  // between them in characters, so a comment added between the two halves broke a check about
  // arithmetic. What matters is that ONE `twist` binding feeds both, not how far apart they sit.
  check('one delta drives both halves of the gesture',
    /const twist = twistSince\(e\.startQuatInv, main\._vrControllerQuat, intensity\);/.test(MPS)
      && /ch\.translate \? twist : null, e\.startWorld, e\.falloff\)/.test(MPS)
      && /MotionPathEdit\.twisted\(e\.before, e\.beforeQ, e\.index, twist, e\.radius, e\.falloff\)/.test(MPS),
    'two twists computed separately is two chances for the path and the triads to disagree');
  check('finish pushes the rotation channel back',
    /pushBackQuats\(t, rec\.strand\.times, rec\.beforeQ, rec\.afterQ\)/.test(MPS));
  check('...and a pure twist still counts as an edit',
    /if \(!moved && !turned\) return 0;/.test(MPS),
    'gating rotation behind a positional move loses every twist-only gesture');
  check('...and undo restores the quaternions with the positions, in ONE entry',
    /if \(qs && t\.quaternions\) t\.quaternions = qs\.slice\(\);/.test(MPS)
      && /pushStateCustom\(\(\) => put\(beforePos, beforeQuat\), \(\) => put\(afterPos, afterQuat\)/.test(MPS)
      && (MPS.match(/sm\.pushStateCustom\(/g) || []).length === 1,
    'two entries for one gesture, and the second undoes a state the first already changed');
  // ...and that ONE entry covers EVERY curve the gesture touched. A drag with Connectivity off
  // can move keys on several paths; undoing that a curve at a time is a different edit played
  // backwards, so every snapshot has to restore inside the same entry.
  check('...covering every curve the gesture touched, not just the grabbed one',
    /const head = snap\(e\);\s*\n\s*applyExtras\(e, \(x\) => snap\(x\)\);/.test(MPS)
      && /for \(const sh of shots\) \{/.test(MPS),
    'the extras push back but do not undo = an undo that half-restores');

  // --- THE AIM PICKS THE CURVE (#49) ---------------------------------------------------
  //
  // With several paths on screen the strand is an OUTPUT of the hit test, not an input. Picking
  // a strand first and searching only that one is exactly what made every edit land on the
  // last-selected curve however carefully you aimed at another one.
  {
    const line = (x0, base) => ({
      points: [0, 1, 2, 3].map((i) => ({ x: x0 + i, y: 0, z: 0 })),
      times: [0, 1, 2, 3], base: base, pin: { getID: () => base + 1, _pinnedJoint: {} },
    });
    const a = line(0, 0);        // samples at x = 0,1,2,3
    const b = line(100, 4);      // samples at x = 100..103
    const project = (p) => ({ x: p.x, y: p.y });

    const nearA = MPE.hitStrands([a, b], project, 2, 0, 10);
    check('the nearest curve wins, not the first one listed',
      !!nearA && nearA.strand === a && nearA.i === 2, nearA && nearA.i);
    const nearB = MPE.hitStrands([a, b], project, 101, 0, 10);
    check('...and aiming at the OTHER curve takes that one',
      !!nearB && nearB.strand === b && nearB.i === 1,
      'this is the whole bug: only the last-selected path could be edited');
    check('out of reach of both is a miss',
      MPE.hitStrands([a, b], project, 50, 0, 10) === null);

    // A parented pin cannot be edited, so it must not swallow the pick from a curve that can.
    const c = line(0, 0);
    c.pin = { getID: () => 9, _pinnedJoint: {}, _parent: {} };
    const overlap = MPE.hitStrands([c, b], project, 101, 0, 10);
    check('an uneditable curve does not swallow the pick',
      !!overlap && overlap.strand === b);
    check('...and a pick landing only on it is a miss',
      MPE.hitStrands([c], project, 2, 0, 10) === null);

    // GLOBAL numbering is what the shared dot clouds are indexed by: base + local.
    check('the hit is reported in the strand\'s own numbering, to be based later',
      nearB.i === 1 && nearB.strand.base === 4,
      'begin() adds base to get gIndex; collapsing the two lit the wrong curve\'s dot');
  }

  // --- ONE SPHERE, SEVERAL CURVES (#49) --------------------------------------------------
  //
  // Connectivity ON measures ALONG the strand, so a curve you did not grab has no meaningful
  // distance and gets nothing -- implicitly one object. OFF, the falloff is a sphere in space
  // and any keyframe inside it moves whatever curve it belongs to. matt's own reading of the
  // option, and the reason this needed no new gesture.
  {
    const row = (y) => [0, 1, 2, 3, 4].map((i) => ({ x: i, y: y, z: 0 }));
    const near = row(0);
    // THE CENTRE HAS TO BE SHARED. Measured from its own nearest sample, a curve the sphere
    // merely grazes gets weight 1 at that sample and moves as though grabbed in the middle.
    const c = { x: 2, y: 0, z: 0 };
    const own = MPE.weights(near, 2, 2, { connected: false });
    const shared = MPE.weights(row(1.5), 2, 2, { connected: false, center: c });
    check('an explicit centre is what several curves share',
      shared[2] < own[2] && shared[2] > 0,
      'weight ' + shared[2].toFixed(3) + ' at the near sample of a curve 1.5 away, vs '
        + own[2].toFixed(3) + ' measured from its own');
    check('...and a curve outside the sphere gets nothing',
      MPE.weights(row(9), 2, 2, { connected: false, center: c }).every((w) => w === 0));
    // The grabbed curve is unaffected by the change: its own anchor IS the shared centre.
    check('...while the grabbed curve reads exactly as it always did',
      MPE.weights(near, 2, 2, { connected: false, center: c })
        .every((w, i) => Math.abs(w - own[i]) < 1e-12),
      'the primary must not change behaviour just because others joined the gesture');

    // Connectivity ON is the one-object case, and must stay so.
    const along = MPE.weights(near, 2, 2, { connected: true });
    check('with Connectivity ON the falloff still runs along the strand',
      along[2] === 1 && along[0] === 0,
      'arc length, not distance -- this is what makes it implicitly a single curve');
  }

  // ...and the gathering itself, through the REAL begin/drag rather than through weights():
  // a shared centre is no use if the second curve is never put in the session to begin with.
  {
    const mk = (y, base, id) => ({
      points: [0, 1, 2, 3, 4].map((i) => ({ x: i, y: y, z: 0 })),
      times: [0, 1, 2, 3, 4], base: base, quats: null,
      pin: { getID: () => id, _pinnedJoint: {} },
    });
    const mkMain = () => {
      const a = mk(0, 0, 1), b = mk(1, 5, 2), far = mk(50, 10, 3);
      return { _trailStrand: a, _trailStrands: [a, b, far],
        _vrControllerQuat: [0, 0, 0, 1], a: a, b: b, far: far };
    };

    globalThis.window._pathConnected = false;
    const m1 = mkMain();
    check('a grab acquires the curve under the hand', MPE.beginXR(m1, [2, 0, 0], 3) === true);
    const e1 = m1._pathEdit;
    check('...and gathers the OTHER curve inside the sphere',
      !!e1.extra && e1.extra.length === 1 && e1.extra[0].strand === m1.b,
      'extras: ' + (e1.extra ? e1.extra.length : 'none')
        + ' -- without this, Connectivity off is still implicitly one object');
    check('...but not one outside it',
      !e1.extra.some((x) => x.strand === m1.far));

    // And the drag actually reaches it.
    m1._vrControllerQuat = [0, 0, 0, 1];
    MPE.dragXR(m1, [2, 0, 1], 1);
    check('a drag moves the curve it did not grab',
      !!e1.extra[0].after && Math.abs(e1.extra[0].after[2].z) > 1e-6,
      'z moved ' + (e1.extra[0].after ? e1.extra[0].after[2].z.toFixed(4) : 'not at all'));
    check('...by LESS than the curve it did grab, being further from the centre',
      Math.abs(e1.extra[0].after[2].z) < Math.abs(e1.after[2].z),
      'one sphere means one falloff, measured from the hand');

    // Connectivity ON is the single-object case and must stay untouched.
    globalThis.window._pathConnected = true;
    const m2 = mkMain();
    MPE.beginXR(m2, [2, 0, 0], 3);
    check('with Connectivity ON no other curve joins the gesture',
      !m2._pathEdit.extra,
      'along-the-strand distance is meaningless for a curve you did not grab');
    delete globalThis.window._pathConnected;
  }

  const TRAIL_R = fs.readFileSync(path.join(REPO, 'src/editing/MotionTrail.js'), 'utf8');
  check('the gnomons are drawn from the live edit while it is running',
    /return \(r && r\.after\) \|\| st\.points;/.test(TRAIL_R)
      && /return \(r && r\.afterQ\) \|\| st\.quats;/.test(TRAIL_R),
    'perFrame calls drawGnomons every frame, so the baseline would repaint over the twist');
  // The record is looked up PER STRAND -- the grabbed curve or any extra the sphere reached --
  // so a curve the gesture is not touching keeps its own geometry rather than borrowing the
  // dragged one's.
  check('...and the live edit owns exactly the curves it is editing',
    /if \(e\.strand === st\) return e;/.test(TRAIL_R)
      && /return \(e\.extra && e\.extra\.find\(\(x\) => x\.strand === st\)\) \|\| null;/.test(TRAIL_R));
  // ...and the live edit owns ONLY the curve it is editing. Without the `e.strand === st`
  // guard, every other path on screen would redraw itself from the dragged one's geometry.
  check('...and drawGnomons reads those rather than the strand directly',
    /const p = drawnPoints\(main, rs\)\[r\.local\];/.test(TRAIL_R)
      && /const rq = drawnQuats\(main, rs\);/.test(TRAIL_R));
}

// --- CHANNELS: which half of the keys an edit is allowed to write ------------------------
//
// A 6DOF grab always produces both a translation and a rotation, because a hand cannot move
// without turning a little. Once the twist reached the orientations that stopped being free.
// matt: "i can see cases where i'll want to affect just positions, or just rotations, or both."
//
// The subtle mistake here is not forgetting a gate — it is putting the TWIST'S POSITIONAL SWING
// on the wrong one. Turning your wrist swings the curve around your hand as well as turning the
// triads; that swing moves POSITIONS, so it belongs to Translate. Filed under Rotate it would
// make "just rotations" move the path, which is the one thing the button promises it will not.
{
  const drag = (ch, ang) => {
    const pts = line(5);
    const rest = pts.map(() => ({ ...QI }));
    const main = {
      _vrControllerQuat: axisQ(0, 0, 1, ang),
      _pathEdit: {
        before: pts, beforeQ: rest.map((q) => [q.x, q.y, q.z, q.w]),
        index: 2, radius: 99, startWorld: { x: 0, y: 0, z: 0 },
        startQuatInv: [0, 0, 0, 1], falloff: { connected: false },
        channels: ch, after: null, afterQ: null,
      },
    };
    MPE.dragXR(main, [0, 3, 0], 1);
    return main._pathEdit;
  };

  // Not asserted against a hand-computed position: the twist swings the curve about the GRAB
  // ORIGIN as well as translating it, so the moved point is not simply start + delta. The first
  // version of this check assumed it was and failed on correct code. What matters is that both
  // channels changed, and — below — that turning one off leaves the other one identical.
  const both = drag({ translate: true, rotate: true }, 90);
  const moved = (e) => e.after.some((p, i) => Math.abs(p.x - i) > 1e-6 || Math.abs(p.y) > 1e-6);
  check('both channels on: the path moves and the keys turn',
    moved(both) && !!both.afterQ && near(qAngle(qArr(both.afterQ[2])), Math.PI / 2, 1e-6));

  const rotOnly = drag({ translate: false, rotate: true }, 90);
  check('Translate off: the path does not move at all',
    rotOnly.after.every((p, i) => near(p.x, i) && near(p.y, 0) && near(p.z, 0)),
    JSON.stringify(rotOnly.after[2]));
  check('...not even by the twist’s swing around the hand',
    near(rotOnly.after[0].x, 0) && near(rotOnly.after[0].y, 0),
    JSON.stringify(rotOnly.after[0])
      + ' — the swing is a POSITION edit driven by a rotation, so Translate owns it');
  check('...while the keys still turn',
    !!rotOnly.afterQ && near(qAngle(qArr(rotOnly.afterQ[2])), Math.PI / 2, 1e-6));

  const movOnly = drag({ translate: true, rotate: false }, 90);
  check('Rotate off: the path moves EXACTLY as it did with both on',
    JSON.stringify(movOnly.after) === JSON.stringify(both.after),
    'switching a channel off must not change what the other one does');
  check('...and no orientation is written', movOnly.afterQ === null,
    'a null afterQ is what makes pushBackQuats a no-op, so this IS the gate');
  check('...including the twist’s swing, because that is a position',
    !near(movOnly.after[0].y, 0),
    'gating the swing on Rotate would make Move stop behaving like a 6DOF grab');
}

// SMOOTH takes the same two gates, on the same setting.
{
  const pts = line(7);
  pts[3].y = 5;                                     // a spike to relax
  const rest = pts.map((_, i) => {
    const q = axisQ(0, 1, 0, i === 3 ? 80 : 0);      // and a matching spike in rotation
    return { x: q[0], y: q[1], z: q[2], w: q[3] };
  });
  const run = (ch) => {
    const main = { _pathEdit: { before: pts, beforeQ: rest, index: 3, radius: 99,
      falloff: { connected: false }, channels: ch, after: null, afterQ: null } };
    MPE.smoothStep(main, 1);
    return main._pathEdit;
  };
  const both = run({ translate: true, rotate: true });
  check('smooth, both on: the positional spike comes down',
    Math.abs(both.after[3].y) < 5, both.after[3].y);
  check('...and so does the rotational one',
    !!both.afterQ && qAngle(qArr(both.afterQ[3])) < (80 * Math.PI / 180) - 1e-6,
    'a Rotate button on Smooth that does not smooth rotation is a lie');
  const rotOnly = run({ translate: false, rotate: true });
  // `after` IS THE CURRENT CURVE, ALWAYS. The first version of this asserted `after === null`
  // when positions were not being smoothed, which is what the code did and what crashed the
  // stroke: the redraw hands `after` straight to writeLine. "Untouched" has to mean equal to the
  // baseline, not absent.
  check('smooth, Translate off: positions come out unchanged',
    JSON.stringify(rotOnly.after) === JSON.stringify(pts),
    'a null `after` reaches writeLine and throws on .length');
  check('...and rotations still relax',
    !!rotOnly.afterQ && qAngle(qArr(rotOnly.afterQ[3])) < (80 * Math.PI / 180) - 1e-6);
  const movOnly = run({ translate: true, rotate: false });
  check('smooth, Rotate off: orientations are untouched', movOnly.afterQ === null);
}

// The rotational smooth is a slerp toward the neighbours' MIDPOINT, and the ends are pinned for
// the same reason the positional one pins them: a Laplacian pulls toward the middle, so an
// unpinned end creeps off its authored pose a little more every pass.
{
  const pts = line(5);
  const rest = pts.map((_, i) => {
    const q = axisQ(0, 1, 0, i === 2 ? 90 : 0);
    return { x: q[0], y: q[1], z: q[2], w: q[3] };
  });
  const out = MPE.smoothedQuats(pts, rest, 2, 99, 1);
  check('the rotational spike relaxes to the midpoint of its neighbours',
    near(qAngle(qArr(out[2])), 0, 1e-6), qAngle(qArr(out[2])));
  const ends = MPE.smoothedQuats(pts, pts.map(() => {
    const q = axisQ(0, 1, 0, 40); return { x: q[0], y: q[1], z: q[2], w: q[3] };
  }), 2, 99, 1);
  check('...and the endpoints keep their authored orientation',
    near(qAngle(qArr(ends[0])), 40 * Math.PI / 180, 1e-6),
    'an unpinned end quietly loses the first and last poses of the animation');
}

// The setting itself: live first, saved second, both by default.
{
  delete globalThis.window._pathTranslate;
  delete globalThis.window._pathRotate;
  globalThis.__opts = {};
  const d = MPE.channels();
  check('both channels are on when nothing has been said', d.translate && d.rotate,
    'a default of off would read as the twist simply not working');
  globalThis.__opts = { pathTranslate: false, pathRotate: false };
  check('a saved false is honoured', MPE.channels().translate === false);
  globalThis.window._pathTranslate = true;
  check('...and the live override wins, so a toggle takes the CURRENT stroke',
    MPE.channels().translate === true);
  delete globalThis.window._pathTranslate;
  delete globalThis.window._pathRotate;
  globalThis.__opts = {};
}

// BOTH PANELS. matt asked for these on the wrist panel and the main menu, and a control that
// exists in one place only is the reason Connectivity is still invisible from the main menu.
{
  const MINI = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
  const MAIN = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  check('the wrist panel offers both channels',
    /id="mp-path-translate"/.test(MINI) && /id="mp-path-rotate"/.test(MINI));
  check('...on Move AND on Smooth',
    /idx === Enums\.Tools\.MOVE \|\| idx === Enums\.Tools\.SMOOTH/.test(MINI)
      && /idx === Enums\.Tools\.SMOOTH \? pathChannelHTML\(\) : ''/.test(MINI),
    'Smooth edits the same curve, so it needs the same say over which channel it writes');
  check('...from ONE markup helper, so the two tools cannot drift apart',
    (MINI.match(/pathChannelHTML\(\)/g) || []).length >= 3);
  check('the main menu offers them too',
    /id="mm-path-translate"/.test(MAIN) && /id="mm-path-rotate"/.test(MAIN)
      && /if \(isMove \|\| isSmooth\)/.test(MAIN));
  for (const [name, src] of [['wrist', MINI], ['main menu', MAIN]]) {
    check(`the ${name} writes the live value AND saves it`,
      /window\[liveKey\] = next;/.test(src)
        && /saveOption\(savedKey, next, 0\)/.test(src),
      'live only forgets on exit; saved only ignores the stroke in progress');
  }
  // THE DESKTOP TRACKBALL. A mouse has no roll, so with Rotate on there was no gesture to read
  // and the drag did nothing at all — matt: "move tool in rotation mode does nothing".
  check('the drag becomes a rotation when Rotate is the only channel on',
    /e\.afterQ = \(ch\.rotate && !ch\.translate && e\.beforeQ\)/.test(MPS),
    'with both on, one drag would have to be a move and a turn at once');
  check('...about an axis perpendicular to the drag, in the plane of the screen',
    /const ax = \[-D\[0\] \* dx \+ R\[0\] \* dy/.test(MPS));
  check('...with both axes read from the RENDERER’s projection, not the picker’s',
    /const rx = worldAt\(main, camera, e\.screenZ, e\.startX \+ 10/.test(MPS),
    'the same space mismatch that made the preselection miss by seventy pixels');
  check('...and no rotation at all before the mouse has moved',
    /if \(!dx && !dy\) return null;/.test(MPS),
    'a zero-length drag has no axis; normalising one gives a random turn on mouse-down');

  // THE SPACE. Five rounds of diagnosis went past this because every probe projected with the
  // SAME camera the hit test used, so the two could only ever confirm each other. The curve is
  // drawn under the skeleton overlay group, which carries _worldGroup's 0.701 scale; SculptGL's
  // camera does not know about it. matt's measurement of one dot: 798,355 by the picker's
  // projection, 728,370 where three actually drew it — a ratio of 0.701 about the canvas centre.
  check('the hit test projects the way the RENDERER does',
    /function screenOf\(main, camera, p\)[\s\S]{0,300}?MotionPathEdit\.projectHook\(main, p\)/.test(MPS));
  check('...and every desktop screen-space read goes through that one function',
    (MPS.match(/screenOf\(main, camera/g) || []).length >= 3,
    'one path left on the old projection is the bug still there, just harder to find');
  check('...including the drag, or the curve moves at the wrong RATE as well as from the wrong place',
    /MotionPathEdit\.unprojectHook\(main, x, y, anchor\)/.test(MPS));
  check('...and the reach, so the drawn ring and the samples it takes are one number',
    /function reachAt\(main, camera, x, y, z, anchor, radiusPx\)/.test(MPS));
  {
    const TR2 = fs.readFileSync(path.join(REPO, 'src/editing/MotionTrail.js'), 'utf8');
    check('the hook walks the overlay group before projecting with the THREE camera',
      /applyMatrix4\(g\.matrixWorld\)\.project\(cam\)/.test(TR2),
      'the group transform is exactly what the two projections disagreed about');
    check('...and the inverse brings a screen point back into the curve’s own space',
      /\.unproject\(cam\)\s*\n?\s*\.applyMatrix4\(_invG\.copy\(g\.matrixWorld\)\.invert\(\)\)/.test(TR2));
    const SEL = fs.readFileSync(path.join(REPO, 'src/drawables/Selection.js'), 'utf8');
    check('...and the brush ring is measured in that space too',
      /MotionPathEdit\.projectHook && MotionPathEdit\.projectHook\(main, p\)/.test(SEL));
  }

  // THE REDRAW REQUEST. This is the one that cost three wrong diagnoses: every measurement of
  // the hit test came back correct while the screen stayed wrong, because a diagnostic computes
  // fresh and desktop only renders on demand. A motion path is not a mesh, so the shared
  // preUpdate — which asks for a frame when the thing under the cursor changes — asked for
  // nothing, and the lit dot sat wherever the cursor was when the last frame went out.
  check('a changed path hover asks for a frame',
    /MotionPathEdit\.hoverTick = function \(main\)[\s\S]{0,900}?main\.render\?\.\(\);/.test(MPS));
  check('...and never in a session, where the loop already draws every frame',
    /if \(main\._xrSession \|\| main\._vrSculpting\) return false;/.test(MPS),
    'a redundant draw per hover change, on the surface that can least afford one');
  check('...only on CHANGE, so a mouse move is not one frame per pixel',
    /if \(i === main\._pathHoverLast\) return false;/.test(MPS),
    'rendering every move turns a hover into a per-pixel redraw of the whole scene');
  check('...and never while a drag is live, which renders itself',
    /if \(!main \|\| !main\._trailStrand \|\| main\._pathEdit\) return false;/.test(MPS));
  for (const f of ['src/editing/tools/Move.js', 'src/editing/tools/Smooth.js']) {
    const T = fs.readFileSync(path.join(REPO, f), 'utf8');
    check(f.split('/').pop() + ' calls it from preUpdate, after the base pick',
      /preUpdate\(canBeContinuous\) \{\s*\n\s*super\.preUpdate\(canBeContinuous\);\s*\n\s*MotionPathEdit\.hoverTick\(this\._main\);/.test(T));
  }
  check('...and NOT from SculptBase, which cannot import it',
    !/MotionPathEdit/.test(fs.readFileSync(path.join(REPO, 'src/editing/tools/SculptBase.js'), 'utf8')),
    'the import cycle leaves MotionPathEdit undefined at load — module_load_test catches it');

  // AND THE DESKTOP SIDEBAR. The VR panels are not reachable with a mouse, so without this the
  // feature runs on desktop with whatever the wrist panel was last set to and no way to see it.
  const DESK = fs.readFileSync(path.join(REPO, 'src/gui/GuiSculptingTools.js'), 'utf8');
  check('the desktop sidebar offers the channels too',
    /flag\('Move', ch\.translate, '_pathTranslate', 'pathTranslate'\)/.test(DESK)
      && /flag\('Rotate', ch\.rotate, '_pathRotate', 'pathRotate'\)/.test(DESK));
  check('...and Connectivity, which had never reached a mouse at all',
    /flag\('Connectivity', MotionPathEdit\.connected\(\)/.test(DESK));
  check('...on both tools that can sculpt a path',
    (DESK.match(/addPathOptions\(this\._ctrls, fold\);/g) || []).length === 2,
    'Move and Smooth both edit the curve; one of them silently lacking the options is the bug '
      + 'this check exists to stop coming back');
  check('...writing live first and saved second, like every other panel',
    /window\[liveKey\] = !!v;[\s\S]{0,120}?saveOption\(savedKey, !!v, 0\)/.test(DESK));

  check('and both read the state back through channels(), not a local copy',
    /MotionPathEdit\.channels\(\)/.test(MINI) && /MotionPathEdit\.channels\(\)/.test(MAIN),
    'a panel holding its own copy is a panel that can disagree with the edit');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
