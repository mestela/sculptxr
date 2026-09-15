// Node harness for the timeline toolbar layout in src/gui/GuiTimeline.js.
//
// The toolbar is laid out by arithmetic and read by two separate consumers -- draw() paints from
// _toolbarBtnDefs and onMouseDown hit-tests from _toolbarBtnDefs -- so the risk is not that they
// disagree, it is that the arithmetic puts a control somewhere nobody can reach. That is exactly
// what happened: the transport was positioned as "centred, but not left of the left-hand group",
// with nothing said about the right edge, so on a narrow panel it went off the end. In VR the
// panel IS narrow, and play/pause/record were simply not there.
//
// Runs the REAL method, extracted from the source rather than restated, with stubs for the two
// things it reaches outside itself (`this` and the window globals). If the extraction fails it
// throws instead of quietly testing nothing.
//
// Run: node scratchpad/timelinebar_test.mjs
//   BAR_INJECT=noclamp   the transport is not clamped to the right edge (the original bug)
//   BAR_INJECT=nodrop    it is clamped, but colliding left buttons are not dropped (overdraw)
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(`${REPO}/src/gui/GuiTimeline.js`, 'utf8');

const inject = process.env.BAR_INJECT || '';
const cut = (anchor, replacement = '') => {
  if (!SRC.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 60)}`);
  SRC = SRC.replace(anchor, replacement);
};
if (inject === 'noclamp') {
  cut(`    const _tbMax = this._cssWidth - _tbTotal - 8;
    if (_tbX > _tbMax) {
      _tbX = Math.max(8, _tbMax);`,
      `    const _tbMax = this._cssWidth - _tbTotal - 8;
    if (false) {`);
} else if (inject === 'nodrop') {
  cut(`      for (let i = _leftBtnCount - 1; i >= 0; i--) {
        if (btns[i].x + btns[i].w <= _tbX - 8) break;
        btns.splice(i, 1);
      }`, '');
}

// --- extract the real method ---------------------------------------------------------------
const m = SRC.match(/\n  _toolbarBtnDefs\(\) \{\n([\s\S]*?)\n  \}\n/);
if (!m) throw new Error('_toolbarBtnDefs could not be extracted — this harness is testing nothing');
const body = m[1];
if (!body.includes('_tbDefs')) throw new Error('extracted body does not look like the toolbar builder');

// xfTanPrefix is the only import it reaches; everything else is `this` or window.
const build = new Function('xfTanPrefix', `return function () {\n${body}\n};`)(() => '');

function defs({ width = 900, mode = 'dope', audio = false, muted = false }) {
  globalThis.window = {
    _animShowTangents: false, _animShowTransformBox: false, _animSnapToFrame: true,
    _animMarqueeMode: false, _animAutoKey: false, _animPlaying: false,
    _animationRegistry: { tracks: new Map(), recordChannels: () => ({ translate: true, rotate: true, scale: true }) },
    _animSelectedKeys: null,
    _audioTrack: audio ? { hasClip: () => true, isMuted: () => muted } : undefined,
    _animLoopEnabled: true, _animFPS: 24, _animPlaybackSpeed: 1,
  };
  return build.call({ _mode: mode, _cssWidth: width });
}

// --- cases ---------------------------------------------------------------------------------
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};
const TRANSPORT = ['rewind', 'stepback', 'playpause', 'stepfwd', 'end', 'record', 'recopts'];
const row0 = (b) => b.filter((x) => x.y === 5);
const transport = (b) => b.filter((x) => TRANSPORT.includes(x.id));

console.log('\nthe transport is always fully on the panel');
for (const width of [420, 500, 600, 700, 900, 1200, 1600]) {
  for (const mode of ['dope', 'graph']) {
    for (const audio of [false, true]) {
      const b = defs({ width, mode, audio });
      const t = transport(b);
      const tag = `w=${width} ${mode}${audio ? ' +audio' : ''}`;
      check(`${tag}: all six transport controls exist`, t.length === 7, `${t.length} found`);
      const left = Math.min(...t.map((x) => x.x));
      const right = Math.max(...t.map((x) => x.x + x.w));
      check(`${tag}: transport within [0, ${width}]`, left >= 0 && right <= width,
        `${left}..${right}`);
    }
  }
}

console.log('\nnothing in the top row overlaps anything else');
for (const width of [420, 500, 600, 700, 900, 1200]) {
  for (const mode of ['dope', 'graph']) {
    const b = row0(defs({ width, mode, audio: true })).slice().sort((p, q) => p.x - q.x);
    let clash = null;
    for (let i = 1; i < b.length; i++) {
      if (b[i].x < b[i - 1].x + b[i - 1].w) { clash = `${b[i - 1].id} / ${b[i].id}`; break; }
    }
    check(`w=${width} ${mode}: no overlapping buttons`, clash === null, clash || '');
  }
}

console.log('\nwhat survives when there is not room');
{
  const wide = defs({ width: 1400, mode: 'graph', audio: true }).map((x) => x.id);
  check('a wide panel keeps every control', wide.includes('audio') && wide.includes('tangents')
    && wide.includes('mode') && wide.includes('playpause'), wide.join(','));

  const narrow = defs({ width: 500, mode: 'graph', audio: true }).map((x) => x.id);
  check('a narrow panel still has the transport', narrow.includes('playpause'));
  check('the mode toggle is kept longest', narrow.includes('mode'), narrow.join(','));
  check('something was actually dropped', narrow.length < wide.length,
    `${narrow.length} vs ${wide.length}`);

  // Dropping must be from the right: the rightmost left-hand control goes first.
  const mid = defs({ width: 640, mode: 'dope', audio: true }).map((x) => x.id);
  check('the newest/rightmost control goes before the oldest',
    !mid.includes('ctxmenu') || mid.includes('mode'), mid.join(','));
}

console.log('\nids stay unique after any dropping');
for (const width of [420, 500, 640, 900]) {
  const ids = defs({ width, mode: 'graph', audio: true }).map((x) => x.id);
  check(`w=${width}: no duplicate ids`, new Set(ids).size === ids.length, ids.join(','));
}

// The wording matters: run_all.mjs tests for "all checks passed" or "tests passed", so a file
// that only says "N passed" is counted as a FAILURE by the suite while reporting green alone.
console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
