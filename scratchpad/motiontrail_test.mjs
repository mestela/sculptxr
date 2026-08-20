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
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_motiontrail_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body +
  '\nexport { samplePaths, signature, range, trailed };\nexport default MotionTrail;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { samplePaths, signature, range } = mod;
const THREE = await import(THREE_PATH);

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A joint whose position is a known function of time, so the sampled curve can be checked
// against the times the sampler CLAIMS it visited rather than against itself.
let nextId = 1;
function joint(track) {
  const j = { _isBone: true, _id: nextId++, _p: [0, 0, 0], _track: track || null,
    getID() { return this._id; } };
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
  j._pin = { getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,0,0,1] };
  const pinned = signature(main, [j], r);
  check('a pin appearing changes it', pinned !== base);
  j._pin = { getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.9,0,0,1] };
  check('and dragging that pin changes it again', signature(main, [j], r) !== pinned);
  delete j._pin;

  const r2 = { start: 0, end: 1 };
  check('changing the range changes it', signature(main, [j], r2) !== base);
}

// --- 5. no range, no trail --------------------------------------------------------------
{
  const { j, main } = setup();
  window._animLoopEnd = 0;
  window._animMasterDuration = 0;
  check('an empty timeline yields no range', range() === null);
  check('and no path', samplePaths(main, [j]) === null);
}

// --- 6. viewport representation ----------------------------------------------------------
// A trail is the thin spatial curve. THREE.Points uses camera-facing square sprites; at scene
// scale those became a wall of large red squares that hid the curve and the model underneath.
// Key timing already belongs to the dopesheet, so the viewport layer must stay line-only.
{
  const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('the viewport trail is a line', /new THREE\.Line\(/.test(code));
  check('the viewport trail has no camera-facing point sprites',
    !/new THREE\.Points\(|new THREE\.PointsMaterial\(/.test(code));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
