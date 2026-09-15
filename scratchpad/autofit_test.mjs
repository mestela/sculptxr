// Node harness for the timeline's auto-fit-on-length-change (GuiTimeline).
//
// The rule is small and the risk is entirely in its GUARD. Fitting the view when the length
// changes is obviously right on an empty timeline and obviously wrong once anything is authored:
// moving the view out from under someone on an unrelated length edit is the kind of help nobody
// asked for. So what is tested here is mostly the "is there anything in here" question, across
// every channel a key can live in — a missed channel means a real animation counts as empty and
// the view jumps.
//
// The two methods are extracted from the real source rather than restated, so a rename in the
// registry's track fields shows up here rather than silently making _hasAnyKeys always false.
//
// Run: node scratchpad/autofit_test.mjs
//   FIT_INJECT=nokeyguard    fit whenever the length changes, authored or not
//   FIT_INJECT=firstrunfits  no baseline, so the first visible frame fits
//   FIT_INJECT=tracksnotkeys tracks.size stands in for "has keys" (an empty track counts)
//   FIT_INJECT=growonly      only a longer timeline fits; shortening leaves the view too wide
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(`${REPO}/src/gui/GuiTimeline.js`, 'utf8');

const inject = process.env.FIT_INJECT || '';
const cut = (anchor, replacement = '') => {
  if (!SRC.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 60)}`);
  SRC = SRC.replace(anchor, replacement);
};
if (inject === 'nokeyguard') {
  cut('    if (this._hasAnyKeys()) return;\n    this.fitAll();', '    this.fitAll();');
} else if (inject === 'firstrunfits') {
  cut('    if (this._lastMasterDuration === undefined) { this._lastMasterDuration = dur; return; }', '');
} else if (inject === 'tracksnotkeys') {
  cut('    for (const tr of reg.tracks.values()) {', '    return reg.tracks.size > 0;\n    for (const tr of reg.tracks.values()) {');
} else if (inject === 'growonly') {
  cut('    if (dur === this._lastMasterDuration) return;', '    if (dur <= this._lastMasterDuration) return;');
}

// --- extract the two methods under test ----------------------------------------------------
function grab(name) {
  const re = new RegExp(`\\n  ${name}\\(\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`);
  const m = SRC.match(re);
  if (!m) throw new Error(`${name}() could not be extracted — this harness is testing nothing`);
  return m[1];
}
const hasAnyKeys     = new Function(`return function () {\n${grab('_hasAnyKeys')}\n};`)();
const watchDuration  = new Function(`return function () {\n${grab('_watchMasterDuration')}\n};`)();

// --- fixtures -------------------------------------------------------------------------------
function makeTL() {
  return {
    _lastMasterDuration: undefined,
    fits: 0,
    fitAll() { this.fits++; },
    _hasAnyKeys: hasAnyKeys,
    _watchMasterDuration: watchDuration,
  };
}
const reg = (tracks) => { globalThis.window.
  _animationRegistry = { tracks: new Map(tracks.map((t, i) => [i, t])) }; };

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

globalThis.window = {};

console.log('\n_hasAnyKeys: which channels count as authored');
{
  globalThis.window._animationRegistry = null;
  check('no registry is empty', hasAnyKeys() === false);

  reg([]);
  check('no tracks is empty', hasAnyKeys() === false);

  // THE ONE THAT MATTERS: every registered object gets a track, keyed or not.
  reg([{ times: [], shapeTimes: [], visTimes: [], shapeLayers: [], blendshapeTracks: new Map() }]);
  check('a track with no keys is still empty', hasAnyKeys() === false);

  reg([{ times: [0.5] }]);
  check('a transform key counts', hasAnyKeys() === true);

  reg([{ times: [], shapeTimes: [1.0] }]);
  check('a shape key counts', hasAnyKeys() === true);

  reg([{ times: [], visTimes: [0.25] }]);
  check('a visibility key counts', hasAnyKeys() === true);

  reg([{ times: [], shapeLayers: [{ shapeTimes: [] }, { shapeTimes: [2.0] }] }]);
  check('a shape LAYER key counts', hasAnyKeys() === true);

  reg([{ times: [], blendshapeTracks: new Map([['jawOpen', { times: [0.1] }]]) }]);
  check('a blendshape weight counts', hasAnyKeys() === true);

  reg([{ times: [], blendshapeTracks: new Map([['jawOpen', { times: [] }]]) }]);
  check('an empty blendshape track is still empty', hasAnyKeys() === false);

  // A keyed track hiding behind several empty ones must still be found.
  reg([{ times: [] }, { times: [] }, { times: [], shapeTimes: [3.0] }]);
  check('a keyed track behind empty ones is found', hasAnyKeys() === true);

  reg([null, undefined, { times: [0.1] }]);
  check('null tracks do not throw', hasAnyKeys() === true);
}

console.log('\n_watchMasterDuration: when the view is refitted');
{
  reg([]);   // empty timeline throughout this block
  const tl = makeTL();

  globalThis.window._animMasterDuration = 2.0;
  tl._watchMasterDuration();
  check('the first frame only takes a baseline', tl.fits === 0, `${tl.fits} fits`);

  tl._watchMasterDuration();
  tl._watchMasterDuration();
  check('an unchanged length never refits', tl.fits === 0, `${tl.fits} fits`);

  globalThis.window._animMasterDuration = 10.0;
  tl._watchMasterDuration();
  check('a longer timeline fits', tl.fits === 1, `${tl.fits} fits`);

  tl._watchMasterDuration();
  check('and only once for that change', tl.fits === 1, `${tl.fits} fits`);

  globalThis.window._animMasterDuration = 3.0;
  tl._watchMasterDuration();
  check('a SHORTER timeline fits too', tl.fits === 2,
    `${tl.fits} fits — a shortened timeline leaves the view too wide`);

  // Now author something. From here the view is the user's.
  reg([{ times: [1.0] }]);
  globalThis.window._animMasterDuration = 30.0;
  tl._watchMasterDuration();
  check('once there are keys, a length change leaves the view alone', tl.fits === 2,
    `${tl.fits} fits`);

  // ...and the baseline still tracked, so deleting the keys later does not fire a stale fit.
  reg([]);
  tl._watchMasterDuration();
  check('no stale fit from the change that was ignored', tl.fits === 2, `${tl.fits} fits`);

  globalThis.window._animMasterDuration = 40.0;
  tl._watchMasterDuration();
  check('emptied again, a new change fits', tl.fits === 3, `${tl.fits} fits`);
}

console.log('\n_watchMasterDuration: rubbish in');
{
  reg([]);
  const tl = makeTL();
  globalThis.window._animMasterDuration = undefined;
  tl._watchMasterDuration();
  check('an unset length does nothing', tl.fits === 0 && tl._lastMasterDuration === undefined);

  globalThis.window._animMasterDuration = NaN;
  tl._watchMasterDuration();
  check('NaN does nothing', tl.fits === 0 && tl._lastMasterDuration === undefined);

  globalThis.window._animMasterDuration = 5;
  tl._watchMasterDuration();
  check('a real value after rubbish takes the baseline, not a fit', tl.fits === 0);
}

// The wording matters: run_all.mjs tests for "all checks passed" or "tests passed", so a file
// that only says "N passed" is counted as a FAILURE by the suite while reporting green alone.
console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
