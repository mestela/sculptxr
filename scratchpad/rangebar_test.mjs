// Node harness for the timeline range bar (GuiTimeline).
//
// Two ranges live in this bar -- the PROJECT range (how long the shot is) and the PLAYBACK range
// (which part you are working on) -- and almost every way it can be wrong is a disagreement
// between what it DRAWS and what the transport then does. So the cases here are mostly about the
// invariants that keep those two honest: the playback range never leaves the project range, a
// slide keeps its length instead of squashing at the edge, no range collapses to nothing, and a
// project edge dragged past the playback range takes it along rather than leaving it stranded
// outside the bar it is drawn in.
//
// The geometry function is shared by the draw and the hit test on purpose (this file has been
// bitten twice by two copies drifting), so the round-trip toX/toT and the hit bands are tested
// here as one thing.
//
// Run: node scratchpad/rangebar_test.mjs
//   RANGE_INJECT=noprojpush   a typed global edge does not carry the playback range with it
//   RANGE_INJECT=nomidclamp   sliding clamps each end on its own, so the region squashes
//   RANGE_INJECT=nominspan    ranges may collapse to zero length
//   RANGE_INJECT=midbeforeedge the middle is hit-tested before the edges, so narrow ranges
//                             can only be slid, never resized
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(`${REPO}/src/gui/GuiTimeline.js`, 'utf8');

const inject = process.env.RANGE_INJECT || '';
const cut = (anchor, replacement = '') => {
  if (!SRC.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 60)}`);
  SRC = SRC.replace(anchor, replacement);
};
if (inject === 'noprojpush') {
  cut(`      window._animLoopStart = nl.start;
      window._animLoopEnd = Math.max(nl.start + minGap, Math.min(np.end, nl.end));`);
} else if (inject === 'nomidclamp') {
  cut(`      let a = this._rangeSnap(d.loop0 + (g.toT(rx) - d.grabT));
      a = Math.max(d.proj0, Math.min(d.proj1 - len, a));
      window._animLoopStart = a;
      window._animLoopEnd = a + len;`,
      `      const a = this._rangeSnap(d.loop0 + (g.toT(rx) - d.grabT));
      window._animLoopStart = Math.max(d.proj0, a);
      window._animLoopEnd = Math.min(d.proj1, a + len);`);
} else if (inject === 'nominspan') {
  cut('    const minSpan = 1 / fps;', '    const minSpan = 0;');
} else if (inject === 'editorwidth') {
  cut('    const w = Math.max(MIN_W, Math.round(btn.w || 0));', '    const w = Math.round(btn.w || 0);');
} else if (inject === 'noeditorclamp') {
  cut('      left: Math.max(0, Math.min(Math.round(btn.x || 0), maxLeft)),',
      '      left: Math.round(btn.x || 0),');
} else if (inject === 'noviewsync') {
  const anchor = '    this._syncViewToPlaybackRange();\n';
  const n = SRC.split(anchor).length - 1;
  if (n !== 2) throw new Error(`inject noviewsync: expected 2 call sites, found ${n}`);
  SRC = SRC.split(anchor).join('');
} else if (inject === 'clickisdrag') {
  cut('    if (Math.abs(rx - d.downX) > 3) d.moved = true;', '    d.moved = true;');
} else if (inject === 'nohandlefloor') {
  // Full-width handles on a short range: the two overlap and whichever is tested second can
  // never be grabbed, so a range can be moved but not shortened again.
  cut('    const hw = Math.min(RANGE_HANDLE_W, (lx1 - lx0) / 2);',
      '    const hw = Math.min(RANGE_HANDLE_W, Math.max(8, (lx1 - lx0) / 2));');
} else if (inject === 'midbeforeedge') {
  cut(`    if (rx >= g.hA[0] && rx <= g.hA[1]) return 'loop-start';
    if (rx >= g.hB[0] && rx <= g.hB[1]) return 'loop-end';
    if (rx > g.lx0 && rx < g.lx1) return 'loop-mid';`,
      `    if (rx > g.lx0 && rx < g.lx1) return 'loop-mid';
    if (rx >= g.hA[0] && rx <= g.hA[1]) return 'loop-start';
    if (rx >= g.hB[0] && rx <= g.hB[1]) return 'loop-end';`);
}

// --- extract the constants and the methods under test --------------------------------------
const konst = (name) => {
  const m = SRC.match(new RegExp(`^const ${name} = (\\d+);`, 'm'));
  if (!m) throw new Error(`const ${name} moved — this harness is testing nothing`);
  return Number(m[1]);
};
const K = { TOOLBAR_BOTTOM: konst('TOOLBAR_BOTTOM'), RANGE_H: konst('RANGE_H'),
            RANGE_FIELD_W: konst('RANGE_FIELD_W'), RANGE_HANDLE_W: konst('RANGE_HANDLE_W'),
            RANGE_HANDLE_OUT: konst('RANGE_HANDLE_OUT') };

const grab = (name, args = '') => {
  const re = new RegExp(`\\n  ${name}\\(${args}\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`);
  const m = SRC.match(re);
  if (!m) throw new Error(`${name}() could not be extracted — this harness is testing nothing`);
  return m[1];
};
const mk = (name, args, body) => new Function(
  'TOOLBAR_BOTTOM', 'RANGE_H', 'RANGE_FIELD_W', 'RANGE_HANDLE_W', 'RANGE_HANDLE_OUT',
  `return function (${args}) {\n${body}\n};`)(
    K.TOOLBAR_BOTTOM, K.RANGE_H, K.RANGE_FIELD_W, K.RANGE_HANDLE_W, K.RANGE_HANDLE_OUT);

const M = {
  projectRange:   mk('projectRange', '', grab('projectRange')),
  playbackRange:  mk('playbackRange', '', grab('playbackRange')),
  _rangeBarGeom:  mk('_rangeBarGeom', '', grab('_rangeBarGeom')),
  _rangeBarHit:   mk('_rangeBarHit', 'rx, ry', grab('_rangeBarHit', 'rx, ry')),
  _rangeSnap:     mk('_rangeSnap', 't', grab('_rangeSnap', 't')),
  _rangeBarDown:  mk('_rangeBarDown', 'rx, ry', grab('_rangeBarDown', 'rx, ry')),
  _setPlaybackRangeFrame: mk('_setPlaybackRangeFrame', 'kind, frame',
    grab('_setPlaybackRangeFrame', 'kind, frame')),
  _syncViewToPlaybackRange: mk('_syncViewToPlaybackRange', '', grab('_syncViewToPlaybackRange')),
  _rangeHandleRect: mk('_rangeHandleRect', 'kind', grab('_rangeHandleRect', 'kind')),
  _rangeBarUp:    mk('_rangeBarUp', '', grab('_rangeBarUp')),
  _rangeInputBox: mk('_rangeInputBox', 'btn', grab('_rangeInputBox', 'btn')),
  _rangeBarMove:  mk('_rangeBarMove', 'rx', grab('_rangeBarMove', 'rx')),
};

function tl({ width = 1000, proj = [0, 10], loop = [2, 6], fps = 24, snap = false } = {}) {
  globalThis.window = {
    _animProjectStart: proj[0], _animMasterDuration: proj[1],
    _animLoopStart: loop[0], _animLoopEnd: loop[1],
    _animFPS: fps, _animSnapToFrame: snap,
  };
  return Object.assign(Object.create(null), M, { _cssWidth: width, _rangeDrag: null, draws: 0,
    draw() { this.draws++; },
    // The field click path goes through the shared editor; here we only care that it is asked
    // for the right kind with the right rect, not what the numpad then does with it.
    edits: [],
    _editPlaybackRange(kind, rect) { this.edits.push({ kind, rect }); } });
}
const W = globalThis.window;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const loopNow = () => [window._animLoopStart, window._animLoopEnd];
const projNow = () => [window._animProjectStart, window._animMasterDuration];

console.log('\ngeometry: time and pixels round-trip');
{
  const t = tl();
  const g = t._rangeBarGeom();
  check('the lane sits under the toolbar', g.y === K.TOOLBAR_BOTTOM && g.h === K.RANGE_H);
  check('the track is inset by the two number fields',
    g.x0 === 200 + K.RANGE_FIELD_W + 4 && g.x1 === 1000 - K.RANGE_FIELD_W - 4, `${g.x0}..${g.x1}`);
  check('the fields sit at either end of the lane',
    g.fs.x === 200 && g.fe.x + g.fe.w === 1000, `${g.fs.x} / ${g.fe.x + g.fe.w}`);
  check('project start maps to the left of the track', near(g.toX(0), g.x0));
  check('project end maps to the right of the track', near(g.toX(10), g.x1));
  for (const v of [0, 2.5, 5, 9.75, 10]) {
    check(`toT(toX(${v})) round-trips`, near(g.toT(g.toX(v)), v, 1e-9));
  }
  check('the playback region is inside the track', g.lx0 > g.x0 && g.lx1 < g.x1);
}

console.log('\nhit test: which handle is under the cursor');
{
  const t = tl();
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;
  check('above the lane is not the lane', t._rangeBarHit(g.lx0, K.TOOLBAR_BOTTOM - 1) === null);
  check('below the lane is not the lane', t._rangeBarHit(g.lx0, K.TOOLBAR_BOTTOM + K.RANGE_H) === null);
  check('left of the timeline column is nothing', t._rangeBarHit(10, y) === null);
  check('the left field is the global start', t._rangeBarHit(g.fs.x + 4, y) === 'field-start');
  check('the right field is the global end', t._rangeBarHit(g.fe.x + 4, y) === 'field-end');
  check('the region edge is loop-start', t._rangeBarHit(g.lx0, y) === 'loop-start');
  check('the other edge is loop-end', t._rangeBarHit(g.lx1, y) === 'loop-end');
  check('the body is loop-mid', t._rangeBarHit((g.lx0 + g.lx1) / 2, y) === 'loop-mid');
  check('empty track between field and region is nothing',
    t._rangeBarHit((g.x0 + g.lx0) / 2, y) === null, String(t._rangeBarHit((g.x0 + g.lx0) / 2, y)));
  // The handles straddle the bar edge, so a range shoved against the end of the track is still
  // grabbable from just outside it.
  check('a handle is grabbable from just outside the bar',
    t._rangeBarHit(g.lx0 - 3, y) === 'loop-start', String(t._rangeBarHit(g.lx0 - 3, y)));

  // A NARROW REGION MUST STILL BE RESIZABLE. Edges before middle is what allows that; the
  // other order makes a short loop range something you can only slide.
  const n = tl({ loop: [5, 5.15] });
  const gn = n._rangeBarGeom();
  const inA = n._rangeBarHit(gn.lx0 + 2, y);
  const inB = n._rangeBarHit(gn.lx1 - 2, y);
  check('a narrow region still offers its edges', inA === 'loop-start' && inB === 'loop-end',
    `${inA} / ${inB} — hit 2px inside each edge, where a grab actually lands`);
}

console.log('\ndrag: the playback range never leaves the project range');
{
  const t = tl();
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;

  t._rangeBarDown(g.lx0, y);
  t._rangeBarMove(g.x0 - 500);            // yank the start far left, past the project
  check('loop start stops at the project start', near(loopNow()[0], 0), String(loopNow()));

  t._rangeDrag = null;
  const g2 = t._rangeBarGeom();
  t._rangeBarDown(g2.lx1, y);
  t._rangeBarMove(g2.x1 + 500);           // and the end far right
  check('loop end stops at the project end', near(loopNow()[1], 10), String(loopNow()));
}

console.log('\ndrag: sliding keeps its length');
{
  const t = tl({ loop: [2, 6] });
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;
  const mid = (g.lx0 + g.lx1) / 2;

  t._rangeBarDown(mid, y);
  t._rangeBarMove(mid + 60);
  const [a, b] = loopNow();
  check('a slide preserves the span', near(b - a, 4), `${a}..${b}`);

  // Shoved hard against the right edge: the region must STOP, not squash.
  t._rangeDrag = null;
  const g2 = t._rangeBarGeom();
  t._rangeBarDown((g2.lx0 + g2.lx1) / 2, y);
  t._rangeBarMove(g2.x1 + 800);
  const [c, d] = loopNow();
  check('shoved past the end it stops at full length', near(d - c, 4) && near(d, 10),
    `${c}..${d} — a squashed region is a length you cannot get back`);

  t._rangeDrag = null;
  const g3 = t._rangeBarGeom();
  t._rangeBarDown((g3.lx0 + g3.lx1) / 2, y);
  t._rangeBarMove(g3.x0 - 800);
  const [e, f] = loopNow();
  check('and at the start too', near(f - e, 4) && near(e, 0), `${e}..${f}`);
}

console.log('\ndrag: nothing collapses to nothing');
{
  const t = tl({ loop: [2, 6], fps: 24 });
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;
  t._rangeBarDown(g.lx0, y);
  t._rangeBarMove(g.lx1 + 200);           // drag the start past the end
  const [a, b] = loopNow();
  check('a range keeps at least one frame', b - a >= 1 / 24 - 1e-9, `${a}..${b} span=${b - a}`);

  const t2 = tl({ proj: [0, 10] });
  const g2 = t2._rangeBarGeom();
  t2._rangeBarDown(g2.tlX + 2, y);        // the project start grip
  t2._rangeBarMove(g2.x1 + 400);          // drag it past the project end
  const [p0, p1] = projNow();
  check('the project keeps at least one frame', p1 - p0 >= 1 / 24 - 1e-9, `${p0}..${p1}`);
}

console.log('\ndrag: a project edge carries the playback range with it');
{
  const fps = 24;
  const t = tl({ proj: [0, 10], loop: [1, 9], fps });
  t._setPlaybackRangeFrame('projstart', 4 * fps);   // push the global start inside the playback range
  const [a, b] = loopNow();
  const [p0] = projNow();
  check('the global start moved', near(p0, 4), String(p0));
  check('the playback start came with it', a >= p0 - 1e-9,
    `loop ${a}..${b} vs global start ${p0} — the bar would draw a region the transport ignores`);

  const t2 = tl({ proj: [0, 10], loop: [1, 9], fps });
  t2._setPlaybackRangeFrame('projend', 5 * fps);
  const [c, d] = loopNow();
  check('the playback end came with the global end', d <= window._animMasterDuration + 1e-9,
    `loop ${c}..${d} vs global end ${window._animMasterDuration}`);

  // Neither global edge may cross the other.
  const t3 = tl({ proj: [2, 10], fps });
  t3._setPlaybackRangeFrame('projstart', 99 * fps);
  const [q0, q1] = projNow();
  check('the global range cannot invert', q1 - q0 >= 1 / fps - 1e-9, `${q0}..${q1}`);
}

console.log('\nfields open the numeric editor rather than dragging');
{
  const t = tl();
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;

  check('clicking the left field is handled', t._rangeBarDown(g.fs.x + 4, y) === true);
  check('it asks to edit the global start', t.edits[0]?.kind === 'projstart',
    JSON.stringify(t.edits[0]?.kind));
  check('and hands it the field rect to sit on', t.edits[0]?.rect?.x === g.fs.x);
  check('a field click starts no drag', t._rangeDrag === null);

  t._rangeBarDown(g.fe.x + 4, y);
  check('the right field edits the global end', t.edits[1]?.kind === 'projend',
    JSON.stringify(t.edits[1]?.kind));

  // A handle DOES start a drag — the two paths must not be confused for each other.
  t._rangeBarDown(g.lx0, y);
  check('a handle click starts a drag', t._rangeDrag?.kind === 'loop-start',
    JSON.stringify(t._rangeDrag?.kind));
}

console.log('\na short range keeps two handles you can tell apart');
{
  const y = K.TOOLBAR_BOTTOM + 8;
  const t = tl({ loop: [5, 5.2] });
  const g = t._rangeBarGeom();
  check('the handles do not overlap', g.hA[1] <= g.hB[0] + 1e-9,
    `hA ${g.hA} hB ${g.hB} — overlapping handles make one of them unreachable`);
  const a = t._rangeBarHit(g.lx0 + 1, y);
  const b = t._rangeBarHit(g.lx1 - 1, y);
  check('both ends still answer as themselves', a === 'loop-start' && b === 'loop-end',
    `${a} / ${b}`);

  // ...and can actually be shortened, which is the thing overlapping handles take away.
  t._rangeBarDown(g.lx1 - 1, y);
  t._rangeBarMove(g.toX(5.1));
  const [, e2] = loopNow();
  check('the end handle shortens the range', e2 < 5.2 + 1e-9, String(e2));
}

console.log('\nthe ruler follows the playback range');
{
  const t = tl({ proj: [0, 10], loop: [2, 6] });
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;

  t._viewStart = 0; t._viewDuration = 10;
  t._rangeBarDown(g.lx1, y);
  t._rangeBarMove(g.toX(4));
  check('dragging an end moves the view with it',
    near(t._viewStart, 2) && near(t._viewDuration, 2),
    `view ${t._viewStart}+${t._viewDuration} — a range nothing reacts to is the bug that was reported`);

  t._rangeDrag = null;
  t._viewStart = 0; t._viewDuration = 10;
  const g2 = t._rangeBarGeom();
  t._rangeBarDown((g2.lx0 + g2.lx1) / 2, y);
  t._rangeBarMove((g2.lx0 + g2.lx1) / 2 + 40);
  check('sliding the bar moves the view too',
    near(t._viewStart, window._animLoopStart), `view ${t._viewStart} vs loop ${window._animLoopStart}`);

  // Typing a frame is the same edit and must move the view the same way.
  t._rangeDrag = null;
  t._viewStart = 0; t._viewDuration = 10;
  t._setPlaybackRangeFrame('end', 8 * 24);
  check('typing a playback end moves the view',
    near(t._viewStart + t._viewDuration, 8), `view ends ${t._viewStart + t._viewDuration}`);

  // The view never collapses, however short the range.
  t._setPlaybackRangeFrame('start', Math.round(window._animLoopEnd * 24) - 1);
  check('the view keeps a usable width', t._viewDuration >= 0.1 - 1e-9, String(t._viewDuration));
}

console.log('\na handle released without moving opens its number');
{
  const t = tl({ proj: [0, 10], loop: [2, 6] });
  const g = t._rangeBarGeom();
  const y = K.TOOLBAR_BOTTOM + 8;

  t._rangeBarDown(g.lx0, y);
  t._rangeBarMove(g.lx0);        // the zero-delta move a browser sends between press and release
  t._rangeBarMove(g.lx0 + 1);    // and a pixel of hand tremor, which must still read as a click
  t._rangeBarUp();
  check('a click on the start handle edits the playback start', t.edits[0]?.kind === 'start',
    JSON.stringify(t.edits[0]?.kind));
  check('it is handed a rect wide enough to type in', (t.edits[0]?.rect?.w ?? 0) >= 28,
    String(t.edits[0]?.rect?.w));

  t.edits.length = 0;
  t._rangeBarDown(g.lx1, y);
  t._rangeBarUp();
  check('and the end handle edits the playback end', t.edits[0]?.kind === 'end');

  // A real drag must NOT also open the editor on release.
  t.edits.length = 0;
  const g3 = t._rangeBarGeom();
  t._rangeBarDown(g3.lx0, y);
  t._rangeBarMove(g3.lx0 + 40);
  t._rangeBarUp();
  check('a drag does not open the editor', t.edits.length === 0, JSON.stringify(t.edits));

  // Nor does releasing the middle.
  t.edits.length = 0;
  const g4 = t._rangeBarGeom();
  t._rangeBarDown((g4.lx0 + g4.lx1) / 2, y);
  t._rangeBarUp();
  check('a click on the body opens nothing', t.edits.length === 0);

  check('the drag is always released', t._rangeDrag === null);
}

console.log('\nthe inline editor fits the number it is editing');
{
  const t = tl({ width: 1000 });
  const g = t._rangeBarGeom();

  // A range handle is 30px because that is a comfortable grab, not because a frame number fits
  // in it. At 10px monospace a right-aligned number in a 20px content box loses its front.
  const h = t._rangeInputBox(t._rangeHandleRect('loop-start'));
  check('a narrow handle still gets a readable editor', h.w >= 48,
    `${h.w}px — a right-aligned number in less than this loses its leading digits`);
  check('the editor keeps the handle height', h.h >= 18, String(h.h));

  // The global END field sits hard against the right margin, so widening it is exactly the
  // case that would hang the editor off the panel.
  const e = t._rangeInputBox(g.fe);
  check('the right-hand editor stays on the canvas', e.left + e.w <= 1000,
    `${e.left}+${e.w} = ${e.left + e.w} past a ${1000}px panel`);
  check('and is not shoved to zero', e.left > 0, String(e.left));

  // A control already wide enough is left where it is, at its own width.
  const wide = t._rangeInputBox({ x: 300, y: 5, w: 68, h: 20 });
  check('a wide control keeps its own geometry',
    wide.left === 300 && wide.w === 68 && wide.h === 20, JSON.stringify(wide));

  // A narrow panel must not produce a negative left.
  const narrow = tl({ width: 260 });
  const n = narrow._rangeInputBox({ x: 240, y: 5, w: 20, h: 20 });
  check('a cramped panel still lands the editor on the canvas',
    n.left >= 0 && n.w >= 48 && n.left + n.w <= 260,
    `${n.left}+${n.w} = ${n.left + n.w} on a 260px panel`);

  check('rubbish in does not produce NaN', (() => {
    const r = t._rangeInputBox({});
    return Number.isFinite(r.left) && Number.isFinite(r.top) && r.w >= 48 && r.h >= 18;
  })());
}

console.log('\nsnapping follows the timeline switch');
{
  const t = tl({ fps: 24, snap: true });
  check('snapping on lands on a frame', near(t._rangeSnap(0.2), 5 / 24), String(t._rangeSnap(0.2)));
  const u = tl({ fps: 24, snap: false });
  check('snapping off leaves the value alone', near(u._rangeSnap(0.2), 0.2));
}

console.log('\nthe drawn region is always the clamped one');
{
  // Globals poked out of range by something else (a file load, an old project) must not draw
  // a region hanging outside the bar.
  const t = tl({ proj: [2, 8], loop: [-5, 99] });
  const r = t.playbackRange();
  check('a wild playback range is clamped for drawing', r.start === 2 && r.end === 8,
    `${r.start}..${r.end}`);
  const t2 = tl({ proj: [5, 5], loop: [5, 5] });
  const p = t2.projectRange();
  check('a zero-length project still yields a usable span', p.end > p.start, `${p.start}..${p.end}`);
}

// The wording matters: run_all.mjs tests for "all checks passed" or "tests passed", so a file
// that only says "N passed" is counted as a FAILURE by the suite while reporting green alone.
console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
