// Node harness for src/editing/MotionTrail.js.
//
// The trail makes a PROMISE: the joint will pass through these points on playback. What can
// break that promise is not the drawing — it is the sampler, so that is what is tested here:
// that it walks the range it says it walks, that it puts the playhead and the pose back
// afterwards (a sampler that leaves the rig on the last frame is a scrub that jumps every time
// you touch a key), and that its fingerprint notices the things the curve depends on. The
// three.js drawing is not under test; it needs a real scene and proves nothing about the path.
//
// Run: node scratchpad/motiontrail_test.mjs
//   TRAIL_INJECT=noplayguard  sample without suppressing playback
//   TRAIL_INJECT=nopins       leave pins out of the fingerprint
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/MotionTrail.js'), 'utf8');

const inject = process.env.TRAIL_INJECT || '';
if (inject === 'noplayguard') {
  const a = '  window._animPlaying = false;';
  if (!SRC.includes(a)) throw new Error('inject noplayguard: anchor moved');
  SRC = SRC.replace(a, '  // suppressed');
} else if (inject === 'nopins') {
  const a = "  for (const j of IKSolver.pinnedJoints(main)) {";
  if (!SRC.includes(a)) throw new Error('inject nopins: anchor moved');
  SRC = SRC.replace(a, '  for (const j of []) {');
}

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  joints: (main) => main.getMeshes().filter((m) => m._isBone),
  jointPos: (j) => new THREE.Vector3(j._p[0], j._p[1], j._p[2]),
  displayFlag: (n) => !!globalThis.window['_flag_' + n],
  boneColor: () => ({ r: 1, g: 0, b: 0 }),
  sceneUnit: () => 1,
  overlayGroup: () => ({ add() {} }),
};
const IKSolver = {
  pinnedJoints: (main) => main.getMeshes().filter((m) => m._pin),
  pinObject: (j) => j._pin || null,
  holdPins: (main) => { globalThis.__solves.push(globalThis.window._animCurrentTime); },
};
globalThis.window = globalThis.window || {};
globalThis.__solves = [];
// MotionTrail publishes the editor's redraw hook, so the editor need not import the drawing
// back and close a cycle. Stubbed here because the drawing is not what this harness tests.
// Preselection lives in the editor; the trail asks it which sample a click would take. Stubbed
// to "nothing hovered" by default, and overridden where a test is about the highlight itself.
const MotionPathEdit = { hoverIndex: () => (globalThis.__hover == null ? -1 : globalThis.__hover) };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_motiontrail_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body +
  '\nexport { samplePaths, signature, range, trailed, animated, sampleTimes, timeColor };\nexport default MotionTrail;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { samplePaths, signature, range } = mod;
const THREE = await import(THREE_PATH);
// The REAL fat-line geometry, not a fake of it: the gnomons rely on setPositions storing the
// array it is handed and on instanceCount limiting what is drawn, and a stub of that API would
// pass whatever it was written to pass.
const { LineSegmentsGeometry } =
  await import(path.join(REPO, 'node_modules/three/examples/jsm/lines/LineSegmentsGeometry.js'));
// Enough of LineMaterial to be written to. The shader is not under test here.
const fatMat = () => ({ resolution: { x: 0, y: 0, set(a, b) { this.x = a; this.y = b; } } });
const fatSeg = () => ({ geometry: new LineSegmentsGeometry(), material: fatMat(), visible: false });

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

// A joint whose position is a known function of time, so the sampled curve can be checked
// against the times the sampler CLAIMS it visited rather than against itself.
let nextId = 1;
function joint(track) {
  const j = { _isBone: true, _id: nextId++, _p: [0, 0, 0], _track: track || null,
    getID() { return this._id; },
    // A real mesh has this, and the sampler now reads ORIENTATION out of it for the gnomons.
    // Stubbed as a genuine model matrix rather than omitted: a stub that is missing what the
    // shipped object has is a harness that cannot see a whole class of bug.
    getModelSpaceMatrix() {
      return [1,0,0,0, 0,1,0,0, 0,0,1,0, this._p[0], this._p[1], this._p[2], 1];
    } };
  return j;
}

function scene(joints) {
  return { getMeshes: () => joints, getMesh: () => joints[0] };
}

// A registry that writes the joint's position from the playhead, which is all the sampler
// needs from one: `update` is what playback calls per mesh, and its side effect on the rig is
// the thing being sampled.
function registry(joints) {
  const tracks = new Map();
  for (const j of joints) if (j._track) tracks.set(j.getID(), j._track);
  return {
    tracks: tracks,
    globalPlaybackTime: 0,
    update(mesh) {
      const t = this.globalPlaybackTime;
      mesh._p = [t, t * t, 0];   // a curve, so a linear read-back would be visibly wrong
    },
  };
}

function setup(times) {
  const j = joint({ times: times || [0, 1, 2] });
  const main = scene([j]);
  const reg = registry([j]);
  window._animationRegistry = reg;
  window._animLoopStart = 0;
  window._animLoopEnd = 2;
  window._animMasterDuration = 2;
  window._animPlaying = false;
  window._flag_trails = true;
  globalThis.__solves = [];
  return { j, main, reg };
}

// --- 1. the samples span the range, both ends included -------------------------------
{
  const { j, main, reg } = setup();
  window._trailSamples = 5;
  const paths = samplePaths(main, [j]);
  check('it sampled', !!paths && paths[0].length === 5, paths && paths[0].length);
  if (paths) {
    // x is the playhead at each sample, by construction of the mock registry.
    const xs = paths[0].map((p) => p.x);
    check('the first sample is the start of the range', Math.abs(xs[0] - 0) < 1e-9, xs[0]);
    check('the last sample is the end of the range', Math.abs(xs[4] - 2) < 1e-9, xs[4]);
    check('and they are evenly spaced across it',
      Math.abs(xs[1] - 0.5) < 1e-9 && Math.abs(xs[2] - 1) < 1e-9, xs.join(','));
    // The mock moves the joint along a parabola; a sampler that read the endpoints and
    // interpolated would land on the chord instead.
    check('the curve is sampled, not interpolated between the ends',
      Math.abs(paths[0][2].y - 1) < 1e-9, paths[0][2].y);
  }
  delete window._trailSamples;
}

// --- 2. the playhead and the pose are put back ----------------------------------------
//
// A sampler that leaves the rig on the last frame turns "touch a key" into "the model jumps",
// which is worse than having no trail at all.
{
  const { j, main, reg } = setup();
  reg.globalPlaybackTime = 0.75;
  window._animCurrentTime = 0.75;
  samplePaths(main, [j]);
  check('the playhead is back where it started', Math.abs(reg.globalPlaybackTime - 0.75) < 1e-9,
    reg.globalPlaybackTime);
  check('and the rig is evaluated there, not left on the last sample',
    Math.abs(j._p[0] - 0.75) < 1e-9, j._p[0]);
  check('the last solve was the restoring one',
    Math.abs(globalThis.__solves[globalThis.__solves.length - 1] - 0.75) < 1e-9);
}

// --- 3. playback is suppressed while sampling ------------------------------------------
//
// update() advances the playhead by wall-clock dt when playback is on, so a sampler that
// leaves it running fights the clock for the playhead and every sample after the first is
// taken at a time nobody asked for.
{
  const { j, main, reg } = setup();
  window._animPlaying = true;
  let sawPlaying = false;
  const realUpdate = reg.update;
  reg.update = function (mesh) { if (window._animPlaying) sawPlaying = true; realUpdate.call(this, mesh); };
  samplePaths(main, [j]);
  check('playback is off for the duration of the sampling', !sawPlaying);
  check('and is switched back on afterwards', window._animPlaying === true);
  window._animPlaying = false;
}

// --- 4. the fingerprint notices what the curve depends on -------------------------------
{
  const { j, main } = setup([0, 1, 2]);
  const r = range();
  const base = signature(main, [j], r);
  check('the fingerprint is stable when nothing changed', signature(main, [j], r) === base);

  j._track.times = [0, 1.5, 2];
  check('a moved key changes it', signature(main, [j], r) !== base);

  j._track.times = [0, 1, 2];
  check('and restoring the key restores it', signature(main, [j], r) === base);

  // A pin drag does not touch a track, and it moves the solved pose as much as a key does.
  // A pin is a MESH, so it has an id and can carry a track — stub it as one.
  j._pin = { _isPinTarget: true, getID: () => 901, getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,0,0,1] };
  const pinned = signature(main, [j], r);
  check('a pin appearing changes it', pinned !== base);
  j._pin = { _isPinTarget: true, getID: () => 901, getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.9,0,0,1] };
  check('and dragging that pin changes it again', signature(main, [j], r) !== pinned);
  delete j._pin;

  // A KEYED pin is not the same as a dragged one: its track can change without its matrix
  // moving at all (retime a key, delete one, add one at another time). Both have to register.
  j._pin = { _isPinTarget: true, getID: () => 901,
    getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,0,0,1] };
  const dragOnly = signature(main, [j], r);
  window._animationRegistry.tracks.set(901, { times: [0, 1, 2] });
  const keyed = signature(main, [j], r);
  check('a pin gaining a track changes the fingerprint', keyed !== dragOnly, keyed);
  window._animationRegistry.tracks.set(901, { times: [0, 1.5, 2] });
  check('...and retiming that pin key changes it again, though the pin has not moved',
    signature(main, [j], r) !== keyed);
  window._animationRegistry.tracks.delete(901);
  delete j._pin;

  // THE PLAYBACK CASE, which cost half of every second. A keyed pin's live matrix is DERIVED
  // from its track: during playback it is rewritten every frame while the curve it describes
  // does not change at all. Hashing it made the fingerprint differ every frame, which forced a
  // full resample — and a resample is one solve per sample.
  {
    let mx = 0.5;
    const keyedPin = { _isPinTarget: true, getID: () => 902,
      getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, mx, 0, 0, 1] };
    j._pin = keyedPin;
    window._animationRegistry.tracks.set(902, { times: [0, 1, 2] });
    const before = signature(main, [j], r);
    mx = 0.9;                                    // playback writes the pin from its track
    check('a KEYED pin moving does not force a resample',
      signature(main, [j], r) === before,
      'this is where ~1000 solves/s came from during playback');

    // ...but the track itself changing still must, or an edit would leave a stale curve.
    window._animationRegistry.tracks.set(902, { times: [0, 1.5, 2] });
    check('...while retiming its keys still does', signature(main, [j], r) !== before);

    // An UNKEYED pin has no track, so its transform is the only thing that says where it is.
    window._animationRegistry.tracks.delete(902);
    const dragBase = signature(main, [j], r);
    mx = 1.4;
    check('an UNKEYED pin still registers when it is dragged',
      signature(main, [j], r) !== dragBase,
      'that is what hashing the matrix was for in the first place');
    delete j._pin;
  }

  const r2 = { start: 0, end: 1 };
  check('changing the range changes it', signature(main, [j], r2) !== base);
}

// --- 4b. AN ANIMATED PIN IS EVALUATED, NOT FROZEN ------------------------------------
//
// MotionTrail predates pin animation. It was written when a pin was a static anchor you drag,
// so the sampler writes the keyed BONES and then calls holdPins — and holdPins reads whatever
// transform each pin currently has. A pin with a track of its own is therefore held at its
// present position for every sample, and the trail is a curve the playback does not follow.
// That is the exact failure the file's own header says the feature was blocked on.
//
// Real playback does not have this bug: Scene.js iterates EVERY mesh, and a pin is an ordinary
// mesh ("everything a pin needs in order to be transformable and keyable comes free from being
// an ordinary object" — IKSolver.makePinObject). So the two evaluators disagree, which is the
// second-evaluator problem the header warns about.
{
  const { j, main, reg } = setup();
  const pin = { _isPinTarget: true, _id: 900, _p: [0, 0, 0],
    _track: { times: [0, 1, 2] }, getID() { return this._id; },
    getModelSpaceMatrix() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, this._p[0], this._p[1], this._p[2], 1]; } };
  j._pin = pin;
  main.getMeshes = () => [j, pin];
  reg.tracks.set(pin.getID(), pin._track);

  const seen = [];
  const realUpdate = reg.update;
  reg.update = function (mesh) { seen.push([mesh.getID(), this.globalPlaybackTime]); realUpdate.call(this, mesh); };

  window._trailSamples = 5;
  samplePaths(main, [j]);
  delete window._trailSamples;

  const pinWrites = seen.filter(([id]) => id === 900);
  check('an animated pin is evaluated at every sample',
    pinWrites.length >= 5,
    `the pin's track was applied ${pinWrites.length} times across 5 samples — holdPins then ` +
    'reads a stale transform, so the trail is not the path playback takes');
  check('...at the sample times, not all at one time',
    new Set(pinWrites.map(([, t]) => t)).size >= 5,
    pinWrites.map(([, t]) => t).join(','));

  delete j._pin;
}

// --- 5. no range, no trail --------------------------------------------------------------
{
  const { j, main } = setup();
  window._animLoopEnd = 0;
  window._animMasterDuration = 0;
  check('an empty timeline yields no range', range() === null);
  check('and no path', samplePaths(main, [j]) === null);
}

// --- 5b. a pin gets its AUTHORED curve as well as the solved one ------------------------
//
// The whole point of trailing a pin. The control curve is what you keyed and what will become
// editable; the output curve is what the solver managed. When IK reaches, they coincide; where
// they separate, the gap is the diagnosis. An unkeyed pin has no authored path at all, only a
// stationary point, so it gets one curve rather than a degenerate second one.
{
  const { j, main, reg } = setup();
  const pin = { _isPinTarget: true, _id: 902, _p: [0, 0, 0], _pinnedJoint: j,
    getID() { return this._id; },
    getModelSpaceMatrix() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, this._p[0], this._p[1], this._p[2], 1]; } };
  j._pin = pin;
  main.getMeshes = () => [j, pin];

  main.getMesh = () => j;
  const forBone = mod.trailed(main);
  check('a selected bone trails itself, once',
    forBone.length === 1 && forBone[0].obj === j && forBone[0].control === false,
    JSON.stringify(forBone.map((t) => [t.obj.getID(), t.control])));

  main.getMesh = () => pin;
  const unkeyed = mod.trailed(main);
  check('an UNKEYED pin trails only the solved joint path',
    unkeyed.length === 1 && unkeyed[0].obj === j && unkeyed[0].control === false,
    JSON.stringify(unkeyed.map((t) => [t.obj.getID(), t.control])));

  reg.tracks.set(pin.getID(), { times: [0, 1, 2] });
  const keyed = mod.trailed(main);
  check('a KEYED pin trails its authored curve too',
    keyed.length === 2, JSON.stringify(keyed.map((t) => [t.obj.getID(), t.control])));
  check('...the authored curve is the PIN, flagged as the control',
    keyed[0] && keyed[0].obj === pin && keyed[0].control === true);
  check('...and the solved curve is the JOINT, not flagged',
    keyed[1] && keyed[1].obj === j && keyed[1].control === false);

  // Two curves means two sampled paths, or the drawing has nothing to draw the second from.
  window._trailSamples = 4;
  const paths = samplePaths(main, keyed);
  delete window._trailSamples;
  // Both curves come from ONE pass over the times, so they are the same length by
  // construction — assert that, not a count, which now depends on where the keys fall.
  check('...and both are sampled, in step with each other',
    !!paths && paths.length === 2 && paths[0].length === paths[1].length && paths[0].length >= 4,
    paths ? paths.map((p) => p.length).join(',') : 'null');

  reg.tracks.delete(pin.getID());
  delete j._pin;
}

// --- 5c. samples land ON the keys, not just on a uniform grid ----------------------------
//
// A uniform grid hits a key only by luck, so the drawn curve cuts a chord across the pose the
// key actually holds: two close keys with a snap between them read as a smooth arc. It also
// decides whether push-back can READ the displacement at a key or has to interpolate it.
{
  const { j, main, reg } = setup();
  const r = range();                       // 0 .. 2
  reg.tracks.set(j.getID(), { times: [0, 0.3, 1.7, 2] });
  const tg = [{ obj: j, control: false }];

  const times = mod.sampleTimes(reg, tg, r, 5);   // grid: 0, 0.5, 1, 1.5, 2
  for (const kt of [0, 0.3, 1.7, 2]) {
    check('a key at ' + kt + ' gets its own sample',
      times.some((t) => Math.abs(t - kt) < 1e-9), times.join(','));
  }
  check('the uniform fill survives alongside them',
    times.includes(0.5) && times.includes(1) && times.includes(1.5), times.join(','));
  check('the times come out sorted', times.every((t, i) => i === 0 || t >= times[i - 1]));
  check('and a key that coincides with the grid is not sampled twice',
    times.filter((t) => Math.abs(t) < 1e-9).length === 1, times.join(','));

  // Keys outside the drawn range are not part of this curve.
  reg.tracks.set(j.getID(), { times: [-5, 1, 99] });
  const clipped = mod.sampleTimes(reg, tg, r, 5);
  check('keys outside the range are ignored',
    clipped.every((t) => t >= r.start - 1e-9 && t <= r.end + 1e-9), clipped.join(','));

  // A track keyed on every frame of a long range would otherwise be one full solve per key.
  // 1999 intervals, deliberately: the thinning stride divides 2000 evenly, so a round count
  // would keep the last index by luck and the range-spanning guard would never be exercised.
  const dense = [];
  for (let i = 0; i <= 1999; i++) dense.push(r.start + (r.end - r.start) * (i / 1999));
  reg.tracks.set(j.getID(), { times: dense });
  const capped = mod.sampleTimes(reg, tg, r, 5);
  check('a densely keyed track is capped', capped.length <= 256, capped.length);
  check('...and stays sorted through the thinning',
    capped.every((t, i) => i === 0 || t >= capped[i - 1]));
  // Thinning must not shorten the curve: it still has to reach both ends of the range it says
  // it draws, or it visibly stops short.
  check('...and still spans the whole range',
    Math.abs(capped[0] - r.start) < 1e-9 && Math.abs(capped[capped.length - 1] - r.end) < 1e-9,
    capped[0] + '..' + capped[capped.length - 1]);

  reg.tracks.delete(j.getID());
}

// --- 5d. the trail target STICKS to the last rig node -------------------------------------
//
// Read straight off the live selection, the trail was far too easy to lose: with a pin selected
// and Move active, a stroke that missed the curve by a few pixels fell through to an ordinary
// sculpt, that sculpt selected the MESH, and the trail being edited vanished.
{
  const { j, main, reg } = setup();
  const pin = { _isPinTarget: true, _id: 903, _p: [0, 0, 0], _pinnedJoint: j,
    getID() { return this._id; },
    getModelSpaceMatrix() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, this._p[0], this._p[1], this._p[2], 1]; } };
  const mesh = { _id: 904, getID() { return this._id; } };
  j._pin = pin;
  main.getMeshes = () => [j, pin, mesh];
  delete main._trailTarget;

  main.getMesh = () => pin;
  check('selecting a pin takes the trail', mod.trailed(main).length >= 1);

  main.getMesh = () => mesh;
  const held = mod.trailed(main);
  check('...and selecting an ordinary MESH does not drop it',
    held.length >= 1 && held[held.length - 1].obj === j,
    'this is the sculpt-missed-the-curve case that lost the trail mid-edit');

  main.getMesh = () => null;
  check('...nor does selecting nothing', mod.trailed(main).length >= 1);

  // Another rig node is a deliberate change of subject, and must take it.
  const j2 = joint({ times: [0, 1, 2] });
  main.getMeshes = () => [j, pin, mesh, j2];
  main.getMesh = () => j2;
  const moved = mod.trailed(main);
  check('but selecting another rig node DOES take it', moved[0].obj === j2);

  // A target that has left the scene is the one case where holding on would be a lie.
  main.getMesh = () => null;
  main.getMeshes = () => [mesh];
  check('a deleted target is dropped', mod.trailed(main).length === 0);

  delete j._pin;
  delete main._trailTarget;
}

// --- 5e. time as colour, recoloured per frame without resampling -------------------------
//
// Red behind the playhead, green ahead, each fading with distance — so whether a loop closes is
// a question you answer by looking at where the two shades meet, rather than by holding both
// ends of the curve in your head.
{
  // The curve is a FAT line now, so its colour lives in the same pairs layout as its positions:
  // six floats per segment, start colour then end colour.
  const times = [0, 0.5, 1, 1.5, 2];
  const segs = times.length - 1;
  const st = { fresh: false, pos: new Float32Array(segs * 6), col: new Float32Array(segs * 6) };
  const lineObj = fatSeg();
  lineObj.geometry.setPositions(st.pos);
  lineObj.geometry.setColors(st.col);
  const main = { _trailTimes: times, _trailVis: { lines: [lineObj], lineState: [st] } };
  window._animationRegistry = { globalPlaybackTime: 1 };   // playhead in the middle

  mod.default.recolor(main);
  check('a colour is written for every sample',
    st.col.length === segs * 6 && st.col.some((x) => x !== 0), st.col.length);

  // Sample i is the START colour of segment i, so it lands at i*6 in the pairs buffer. The
  // last sample only ever appears as the END of the final segment.
  const at = (i) => (i < segs
    ? [st.col[i * 6], st.col[i * 6 + 1], st.col[i * 6 + 2]]
    : [st.col[(segs - 1) * 6 + 3], st.col[(segs - 1) * 6 + 4], st.col[(segs - 1) * 6 + 5]]);
  check('samples BEHIND the playhead are red-dominant',
    at(0)[0] > at(0)[1] && at(1)[0] > at(1)[1], at(0).join(','));
  check('samples AHEAD of it are green-dominant',
    at(3)[1] > at(3)[0] && at(4)[1] > at(4)[0], at(4).join(','));
  check('...and each fades with distance from the playhead',
    at(1)[0] > at(0)[0] && at(3)[1] > at(4)[1],
    'the near shade must be the brighter one, or "how far away" reads backwards');

  // THE POINT OF SPLITTING RECOLOUR OUT. The playhead moves every frame and the geometry does
  // not; putting the playhead in the fingerprint would mean a full evaluation per sample, every
  // frame, to redraw a curve that has not moved.
  const wasRed = at(1)[0] > at(1)[1];
  globalThis.__solves = [];
  window._animationRegistry.globalPlaybackTime = 0;   // playhead to the start: all future now
  mod.default.recolor(main);
  check('moving the playhead recolours without a single solve',
    globalThis.__solves.length === 0, globalThis.__solves.length);
  check('...and the colours actually follow it',
    wasRed && at(1)[1] > at(1)[0],
    'sample 1 was behind the playhead and is now ahead of it, so it must swap red for green');
  check('...still fading away from the new playhead position',
    at(1)[1] > at(4)[1], at(1)[1] + ' vs ' + at(4)[1]);

  // A drag rewrites positions before the colours catch up; a buffer sized for a different
  // sample count would be written past its end.
  const shortSt = { fresh: false, pos: new Float32Array(6), col: new Float32Array(6) };
  mod.default.recolor({ _trailTimes: times,
    _trailVis: { lines: [fatSeg()], lineState: [shortSt] } });
  check('a buffer whose length disagrees is skipped, not half-written',
    shortSt.col.every((x) => x === 0));

  // Identity moved to the dots when the line took the gradient.
  check('the line is drawn with per-vertex colour', /vertexColors: true/.test(SRC));
  // NO BLENDING ANYWHERE. It cost a blended pass per overlay every frame, and it was also why
  // the colours went pastel in the headset: a part-alpha line IS mixed with what is behind it.
  check('no overlay is drawn with alpha blending',
    !/transparent: true/.test(SRC) && /transparent: false/.test(SRC),
    'blending was the judder suspect and the pastel cause both');
  check('...the dots keep their round shape by CUTOUT instead',
    /alphaTest: 0\.5/.test(SRC) && /map: dotTexture\(\)/.test(SRC),
    'alphaTest discards the rim outright, with no blended pass');
  check('...and the overlays are out of the tone mapper',
    (SRC.match(/toneMapped: false/g) || []).length >= 2,
    'tone mapping rolls a saturated axis off toward pastel the moment it is not Linear');
  check('the two curves are told apart by VALUE, not opacity',
    /CONTROL_VALUE = 0\.70/.test(SRC) && /OUTPUT_VALUE = 0\.40/.test(SRC)
      && !/material\.opacity =/.test(SRC));
  // A path runs through the model it belongs to; with depth testing on it z-fights wherever it
  // grazes a surface, which looks like the curve itself is unstable.
  check('the line reads as an overlay throughout, like the dots',
    /depthWrite: false,\n    depthTest: false,/.test(SRC),
    'depth testing makes the curve shimmer where it grazes the mesh');
  // The curve is a fat line too now: hardware 1px lines cannot be antialiased.
  check('the trail curve is a fat line, like the triads',
    /const TRAIL_PX = /.test(SRC) && !/new THREE\.Line\(/.test(SRC),
    'THREE.Line steps between whole pixels as the camera moves');
  check('...built by the SAME helper as the triads',
    (SRC.match(/makeFat\(main,/g) || []).length >= 2,
    'two fat-line constructions drift into two different materials');
  // Widths are screen pixels and matt set both by eye, so they are worth pinning: a fat line
  // whose width drifts is not something a structural check would otherwise notice.
  {
    // Fractional, because a fat line can be thinner than a pixel and still be antialiased.
    const t = SRC.match(/const TRAIL_PX = ([\d.]+);/);
    const g = SRC.match(/const GNOMON_PX = ([\d.]+);/);
    check('the widths are the ones that were dialled in',
      !!t && !!g && Number(t[1]) === 1.5 && Number(g[1]) === 3,
      (t && t[1]) + ' / ' + (g && g[1]));
    check('...and the triads read heavier than the curve they sit on',
      !!t && !!g && Number(g[1]) > Number(t[1]));
  }

  // THE AXES ARE BALANCED BY LUMINANCE, not by eye. An antialiased line's apparent weight is
  // its luminance contrast, so under Rec.709 an equal-width green reads far heavier than an
  // equal-width blue — which is exactly how the first triad was reported.
  {
    const m = SRC.match(/const AXIS_COL = \[\[([^\]]+)\], \[([^\]]+)\], \[([^\]]+)\]\]/);
    check('the axis colours are readable from source', !!m);
    if (m) {
      const luma = (str) => {
        const c = str.split(',').map(Number);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const L = [luma(m[1]), luma(m[2]), luma(m[3])];
      // The spread is NOT pinned tight any more. Holding the axes at full value and cutting the
      // hue shift to a fifth both widen it, and both were asked for with eyes on the result — a
      // check demanding 0.12 here would be overruling the person looking at it.
      //
      // What survives is the part that was diagnosed rather than chosen: blue reads thinner
      // than the others at equal width, so it must be LIFTED rather than left pure. A pure blue
      // is luma 0.07; this asserts several times that.
      check('blue is lifted, not left as a pure blue',
        L[2] > 0.4 && Number(m[3].split(',')[0]) > 0.3,
        'the eye resolves blue detail poorly, so it reads thinner than its luma alone predicts');
      check('...and no axis is left darker than a pure blue would be',
        Math.min(...L) > 0.2, L.map((x) => x.toFixed(2)).join(' / '));
    }
  }

  // Red-and-green for TIME and red-and-green for X-and-Y were two unrelated meanings in the
  // same two colours, sitting on top of each other.
  {
    const past = SRC.match(/const PAST_NEAR   = \[([^\]]+)\]/);
    const fut = SRC.match(/const FUTURE_NEAR = \[([^\]]+)\]/);
    // Present but SLIGHT, which is the whole requirement: enough that the two palettes stop
    // reading as the same red and green, not so much that they stop reading as red and green.
    const b1 = past && Number(past[1].split(',')[2]);
    const b2 = fut && Number(fut[1].split(',')[2]);
    check('the trail palette is hue-shifted away from pure red and green',
      b1 > 0.02 && b2 > 0.02, b1 + ' / ' + b2);
    check('...but only slightly', b1 < 0.25 && b2 < 0.25,
      'a heavy shift stops them reading as red and green at all');
    const axisX = SRC.match(/const AXIS_COL = \[\[([^\]]+)\]/);
    check('...and the axes are shifted the OTHER way',
      !!axisX && Number(axisX[1].split(',')[1]) > 0.27,
      'X toward pink while the trail goes toward purple, so the pairs stop competing');
  }
  // SAMPLE dots keep identity — with several paths on screen, which one is the question they
  // answer. KEY dots moved onto the time ramp, because a key is where an edit can land, so
  // which side of the playhead it sits on is what you need from it.
  // Behavioural now that recolor owns the dot colours: drive it and read the buffers back.
  {
    const mk = (n) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return { geometry: g, material: { size: 0, opacity: 1 } };
    };
    // Four samples: 0 and 2 are keys, 1 and 3 are plain fill.
    const v = {
      lines: [], dots: mk(2), keyDots: mk(2),
      identity: [0.2, 0.4, 0.9],
      keyTimes: [0, 1],
      nowEps: 0.25,
      slots: [{ key: true, i: 0 }, { key: false, i: 0 }, { key: true, i: 1 }, { key: false, i: 1 }],
      plainCol: new Float32Array(6), keyCol: new Float32Array(6),
    };
    const m = { _trailTimes: [0, 0.5, 1, 1.5], _trailVis: v };
    window._animationRegistry = { globalPlaybackTime: 0 };

    globalThis.__hover = -1;
    mod.default.recolor(m);
    const pc = v.dots.geometry.getAttribute('color').array;
    const kc = v.keyDots.geometry.getAttribute('color').array;
    check('...and the sample dots still carry the identity colour',
      near(pc[0], 0.2 * 0.4, 1e-6) && near(pc[2], 0.9 * 0.4, 1e-6),
      'with several paths on screen, which one is the question the dots answer');
    check('...while the KEY dots are on the time ramp',
      near(kc[0], 1) && near(kc[1], 1) && near(kc[2], 1)      // key 0 sits on the playhead
        && kc[4] > kc[3],                                      // key 1 is ahead of it: green
      Array.from(kc).join(','));

    // PRESELECTION: which sample a click would take. Samples are discrete, so without this the
    // curve appears to move from somewhere other than the cursor.
    globalThis.__hover = 3;            // a PLAIN sample, slot 1 of the plain cloud
    mod.default.recolor(m);
    const pc2 = v.dots.geometry.getAttribute('color').array;
    check('the preselected sample is highlighted', pc2[3] > 0.9 && pc2[5] < 0.4,
      Array.from(pc2).join(','));
    check('...and its neighbours are not',
      near(pc2[0], 0.2 * 0.4, 1e-6) && near(pc2[2], 0.9 * 0.4, 1e-6),
      Array.from(pc2).join(','));
    check('...and it grows, since a colour shift alone is easy to miss at four pixels',
      v.dots.material.size > 4, v.dots.material.size);
    check('...while the other cloud stays its normal size',
      v.keyDots.material.size === 6, v.keyDots.material.size);

    globalThis.__hover = 0;            // now a KEY sample
    mod.default.recolor(m);
    const kc2 = v.keyDots.geometry.getAttribute('color').array;
    check('a preselected KEY highlights too, and is not confusable with the playhead white',
      kc2[0] > 0.9 && kc2[2] < 0.4, Array.from(kc2).join(','));
    check('...and the highlight is dropped when nothing is hovered', (() => {
      globalThis.__hover = -1;
      mod.default.recolor(m);
      const k = v.keyDots.geometry.getAttribute('color').array;
      return near(k[0], 1) && near(k[2], 1) && v.dots.material.size === 4;
    })(), 'a stuck highlight promises a click that would land somewhere else');

    globalThis.__hover = -1;
    window._animationRegistry = { globalPlaybackTime: 1 };
  }
  check('...through the SAME ramp the line uses',
    (SRC.match(/timeColor\(/g) || []).length >= 3 && /function timeColor/.test(SRC),
    'two ramps drift into two slightly different reds');
  // A hard-edged quad a few pixels across crawls as it moves: every frame it lands on a
  // different set of whole pixels and nothing blends the step.
  check('the sprites are round and soft-edged, not raw squares',
    /map: dotTexture\(\)/.test(SRC) && /createRadialGradient/.test(SRC),
    'a hard-edged few-pixel quad shimmers as it moves');
  check('...and only ONE texture is built for all of them',
    /let _dotTex = null/.test(SRC) && /if \(_dotTex\) return _dotTex/.test(SRC),
    'a texture per point cloud is a texture per rebuild');
  // A key rarely lands on the same float as the playhead.
  // Behavioural, not a spelling: the ramp is lifted and run. A source check here passed with
  // the call site changed to hand it a tolerance of zero, which is exactly the defect.
  {
    const out = new Float32Array(3);
    mod.timeColor(1.0, 1.0, 2, out, 0, 0.25);
    check('a key AT the playhead reads white', out[0] === 1 && out[1] === 1 && out[2] === 1,
      Array.from(out).join(','));
    // Outside the tolerance, deliberately: 1.1 is INSIDE 0.25 of the playhead and is supposed
    // to read white, so testing it here would be asserting the opposite of the rule.
    mod.timeColor(1.4, 1.0, 2, out, 0, 0.25);
    check('...and one outside the tolerance does not, but is still nearly saturated',
      !(out[0] === 1 && out[1] === 1) && out[1] > 0.8, Array.from(out).join(','));
    mod.timeColor(1.0, 1.0, 2, out, 0, 0);
    check('...and a zero tolerance means no white mark ever appears',
      !(out[0] === 1 && out[1] === 1 && out[2] === 1),
      'this is what the key dots must NOT be called with');
  }
  check('the key dots are given a real tolerance, not zero',
    /timeColor\(v\.keyTimes\[i\], head, span, keyCol, i \* 3, v\.nowEps\)/.test(SRC)
      && /v\.nowEps = span \/ Math\.max\(1, strand\.times\.length - 1\) \* 0\.5/.test(SRC),
    'a key rarely lands on the same float as the playhead');
  {
    const g = SRC.match(/const FAR_GREY\s*=\s*\[([\d.]+)/);
    check('the far end of the ramp is a midtone GREY, not black',
      !!g && Number(g[1]) > 0.3 && Number(g[1]) < 0.7, g && g[1]);
  }
}

// --- 5f. RGB gnomons at the keys ----------------------------------------------------------
//
// A quaternion is not a place, so rotation has no path to draw — the only way to see it is to
// plant an axis triad where a key is and let its orientation show.
{
  const seg = fatSeg();
  const strand = {
    points: [ {x:0,y:0,z:0}, {x:1,y:0,z:0}, {x:2,y:0,z:0} ],
    // A quarter turn about Z on the middle key, identity either side.
    quats: [ new THREE.Quaternion(),
             new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), Math.PI / 2),
             new THREE.Quaternion() ],
    times: [0, 1, 2],
    pin: { getID: () => 1, _pinnedJoint: {} },
  };
  const m = { _trailStrand: strand, _trailVis: { gnomons: seg, keyIndices: [0, 1] },
    getCamera: () => ({ _width: 1600, _height: 900 }) };

  window._flag_gnomons = false;
  mod.default.drawGnomons(m);
  check('no triads unless Key Axes is on', seg.visible === false,
    'a triad per key is a lot of ink to carry while you are just watching an arc');

  // TOGGLING THE FLAG HAS TO SHOW SOMETHING. It does not change the fingerprint, so it causes
  // no rebuild — anything that only ran on the rebuild path looked simply broken: the button
  // set the flag and nothing appeared.
  window._flag_gnomons = true;
  globalThis.__solves = [];
  mod.default.perFrame(m);
  check('turning Key Axes on draws them without a rebuild',
    seg.visible === true && globalThis.__solves.length === 0,
    'the flag is not in the fingerprint, so nothing would ever redraw them');
  window._flag_gnomons = false;
  mod.default.perFrame(m);
  check('...and turning it off takes them away again', seg.visible === false);

  window._flag_gnomons = true;
  mod.default.drawGnomons(m);
  const pos = seg.geometry.attributes.instanceStart.data;      // interleaved: start xyz, end xyz
  const col = seg.geometry.attributes.instanceColorStart.data;
  check('one triad per KEY, three segments each',
    seg.visible && seg.geometry.instanceCount === 2 * 3, seg.geometry.instanceCount);
  check('...and only at the keys, not at every sample',
    seg.geometry.instanceCount / 3 === 2 && strand.points.length === 3);

  // Segment 0 of key 0 is the X axis, unrotated: it must run along +X from the key.
  const at = (i) => [pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]];
  check('the gnomons are drawn with FAT lines, not 1px hardware lines',
    !!seg.geometry.attributes.instanceStart,
    'a hardware line cannot be antialiased and steps between whole pixels');
  check('...whose screen-space width is told the viewport size',
    seg.material.resolution.x === 1600 && seg.material.resolution.y === 900,
    'a fat line with a stale resolution renders at the wrong thickness');
  // EVERY fat line, not just the triads. LineMaterial clones its uniforms per material, so a
  // resolution set on one does nothing for the others, and the default is 1x1 - which divides
  // the screen-space width by 1 instead of by a thousand.
  check('...and so is every OTHER fat line, through the same helper',
    /function pushFat\(main, obj, state/.test(SRC)
      && /syncResolution\(main, obj\.material\);/.test(SRC),
    'the trail inherited this gap when it was converted to fat lines');
  check('...with no second copy of the push left to drift',
    (SRC.match(/setPositions\(/g) || []).length === 1,
    'the gnomons had their own copy of the rebuild rule');
  check('each axis starts AT the key', near(at(0)[0], 0) && near(at(0)[1], 0));
  check('an unrotated key points its X axis along +X',
    at(1)[0] > 0 && near(at(1)[1], 0, 1e-6), at(1).join(','));

  // Key 1 is turned a quarter turn about Z, so ITS x axis points along +Y. This is the whole
  // point: the triad has to show the ORIENTATION, not just mark the spot.
  check('a rotated key turns its triad with it',
    near(at(7)[0] - at(6)[0], 0, 1e-6) && at(7)[1] - at(6)[1] > 0,
    'a triad that ignores the quaternion is just three lines at a point');

  // DISTANCE IS SHOWN BY SCALE. A faded triad still occupies its space and still reads as
  // three coloured lines; a shrinking one gets out of the way and vanishes for real.
  {
    const pts = [], qs = [], times = [], keys = [];
    for (let i = 0; i < 30; i++) {
      pts.push({ x: i, y: 0, z: 0 });
      qs.push(new THREE.Quaternion());
      times.push(i);
      keys.push(i);                       // every sample is a key, so key index == time
    }
    const s2 = fatSeg();
    const m2 = { _trailStrand: { points: pts, quats: qs, times: times,
                                 pin: { getID: () => 1, _pinnedJoint: {} } },
                 _trailVis: { gnomons: s2, keyIndices: keys },
                 getCamera: () => ({ _width: 1600, _height: 900 }) };
    window._flag_gnomons = true;
    window._animationRegistry = { globalPlaybackTime: 15 };
    mod.default.drawGnomons(m2);

    const P = s2.geometry.attributes.instanceStart.data.array;
    const axisLen = (k) => {              // length of the X axis of the k'th DRAWN triad
      const o = k * 18;
      return Math.abs(P[o + 3] - P[o]);
    };
    const drawn = s2.geometry.instanceCount / 3;
    check('only keys within reach are drawn at all',
      drawn === 19, drawn);               // 15 +/- 10 exclusive of the zero-scale ends
    check('...and the rest are not drawn faintly, they are not drawn',
      s2.geometry.instanceCount < 30 * 3);

    check('the triad at the playhead is the largest', axisLen(9) > axisLen(0));
    check('...and it shrinks linearly with distance in KEYS',
      near(axisLen(9) - axisLen(8), axisLen(8) - axisLen(7), 1e-6),
      [axisLen(7), axisLen(8), axisLen(9)].join(','));
    check('...reaching zero at the edge of the reach', axisLen(0) < axisLen(9) * 0.15,
      axisLen(0) + ' vs ' + axisLen(9));

    // Counted in KEYS, not seconds: ten keys either side is ten poses either side, whether
    // they are a second apart or a minute.
    // The playhead moves with them, or this tests "the playhead drifted to the start" instead.
    const stretched = times.map((t) => t * 100);
    m2._trailStrand.times = stretched;
    window._animationRegistry = { globalPlaybackTime: 1500 };
    mod.default.drawGnomons(m2);
    // Visibility as well as the count: with the reach measured in seconds nothing qualifies at
    // this spacing, the draw is abandoned early, and the STALE draw range from the previous
    // call still reads as correct.
    check('the reach does not change when the keys are spread out in time',
      s2.visible === true && s2.geometry.instanceCount / 3 === drawn,
      s2.visible + ' / ' + s2.geometry.instanceCount / 3);
    m2._trailStrand.times = times;

    // The colours stay at full strength - the one thing about a gnomon you must not squint at.
    const C = s2.geometry.attributes.instanceColorStart.data.array;
    check('axis colours do not fade with distance', near(C[0], C[18 * 9]),
      'scale carries the distance, colour carries which axis');

    window._flag_gnomons = false;
    window._animationRegistry = { globalPlaybackTime: 1 };
  }

  // It runs every frame now, so it must not allocate a fresh pair of buffers each time.
  //
  // The flag has to be ON here. The scale block above leaves it off, and with it off
  // drawGnomons returns before touching the geometry at all - so this check passed on state
  // nothing had written, whatever the code did.
  window._flag_gnomons = true;
  mod.default.drawGnomons(m);
  // The ATTRIBUTE, not the array behind it: setPositions called with the same Float32Array
  // still wraps it in a fresh InstancedInterleavedBuffer and fresh attributes every time, so
  // comparing the array passes whether or not the rebuild was skipped.
  const firstAttr = seg.geometry.attributes.instanceStart;
  mod.default.drawGnomons(m);
  check('repeat draws reuse the buffers rather than reallocating',
    seg.geometry.attributes.instanceStart === firstAttr,
    'rebuilding the instanced attributes every frame is waste for geometry that rarely changes');
  window._flag_gnomons = false;

  check('the axes are RGB, in that order',
    col.array[0] > col.array[1] && col.array[7] > col.array[6]
      && col.array[14] > col.array[12],
    'x red, y green, z blue — the convention every 3D app shares');

  // Nothing to read the orientation from is not a crash and not a triad.
  mod.default.drawGnomons({ _trailStrand: { points: strand.points, times: strand.times,
    pin: strand.pin }, _trailVis: { gnomons: seg, keyIndices: [0] } });
  check('a curve with no sampled orientations draws none', seg.visible === false);
  window._flag_gnomons = false;
}

// --- 6. viewport representation ----------------------------------------------------------
// A trail is the thin spatial curve. THREE.Points uses camera-facing square sprites; at scene
// scale those became a wall of large red squares that hid the curve and the model underneath.
// Key timing already belongs to the dopesheet, so the viewport layer must stay line-only.
{
  const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // The trail is a LINE, not a cloud of sprites — the original rule, restated for the fat-line
  // implementation that replaced THREE.Line. LineSegments2 is still a line; what the rule
  // forbids is drawing the path as points.
  check('the viewport trail is a line', /new LineSegments2\(/.test(code));

  // THIS CHECK USED TO BAN THREE.Points OUTRIGHT, and it was right to at the time: the default
  // PointsMaterial draws WORLD-SIZED camera-facing squares, and at scene scale those became a
  // wall of red that hid the curve and the model under it.
  //
  // But the defect was the SIZING, not the primitive. Dots are now needed — a drag takes hold
  // of the nearest sample, and with the samples invisible the curve appears to move from
  // somewhere other than the cursor, which reads as the tool being misaligned. A point pinned
  // to a few SCREEN pixels cannot swamp anything.
  //
  // So the rule is stated as what actually went wrong: any Points material must switch
  // sizeAttenuation OFF and ask for a small pixel size.
  const materials = [...code.matchAll(/new THREE\.PointsMaterial\(\{([\s\S]*?)\}\)/g)];
  check('every point cloud is sized in SCREEN pixels, not world units',
    materials.length > 0 && materials.every((m) => /sizeAttenuation:\s*false/.test(m[1])),
    'world-sized sprites are the wall of squares this check was written for');
  // The size is passed in, so check the values the callers actually ask for. A screen-sized
  // point still hides the curve if it is 40px across.
  const sizes = [...code.matchAll(/^const (?:KEY_)?DOT_PX = (\d+);/gm)].map((m) => Number(m[1]));
  check('...and asks for a dot, not a slab',
    sizes.length > 0 && sizes.every((n) => n > 0 && n <= 16), sizes.join(','));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
