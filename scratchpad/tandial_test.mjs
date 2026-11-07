// The Timing, Ease and Overshoot sliders. The segment maths runs for real, through a cubic evaluated
// the way the app evaluates a segment; the wiring on the canvas class is checked in source (the
// behaviour was driven on a real file in the app).
//
// Run: node scratchpad/tandial_test.mjs   (TD_INJECT=norm|flat|nonext|lone|tie|undo|shared|force)
import fs from 'fs';

const REPO = new URL('..', import.meta.url).pathname;
const inject = process.env.TD_INJECT || '';
let TH_SRC = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');
let TL_SRC = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
const bite = (src, a, b) => { if (!src.includes(a)) throw new Error('inject target gone: ' + a); return src.replace(a, b); };
if (inject === 'norm') TH_SRC = bite(TH_SRC, 'OVERSHOOT_DV * dV / nextLen', 'OVERSHOOT_DV / nextLen');
if (inject === 'flat') TH_SRC = bite(TH_SRC, 'sa = mix(sa0, 0, flat);', '');
if (inject === 'nonext') TH_SRC = bite(TH_SRC, 'nextLen > 0 ? OVERSHOOT_DV * dV / nextLen : -OVERSHOOT_DV * dV / (xb0 * T)', 'OVERSHOOT_DV * dV / (nextLen || 1)');
if (inject === 'lone') TH_SRC = bite(TH_SRC, 'else if (!sel.has(at - 1)) {', 'else if (false) {');
if (inject === 'tie') TL_SRC = bite(TL_SRC, 'if (corners) t.to[t.flag] = false;', 'if (false) t.to[t.flag] = false;');
if (inject === 'undo') TL_SRC = bite(TL_SRC, 'if (d.moved) {\n      const after', 'if (false) {\n      const after');
if (inject === 'shared') TL_SRC = bite(TL_SRC, 'const { jobs, bsJobs } = this._selectedTangentJobs();\n    const entries', 'const jobs = new Map(), bsJobs = new Map();\n    const entries');
if (inject === 'force') TL_SRC = bite(TL_SRC, "(e.tiedB || r.kind === 'over')", 'e.tiedB');

fs.mkdirSync(REPO + 'scratchpad/_gen', { recursive: true });
const OUT = REPO + 'scratchpad/_gen/_tandial_helper.mjs';
fs.writeFileSync(OUT, TH_SRC.replace(/^import [\s\S]*?from '\.\.\/editing\/xfChannel\.js';\n/,
  'const xfKeyed=0,xfRead=0,xfWrite=0,xfTanPrefix=0,xfVisible=0,xfChanVisible=0,xfWeightTrack=0;\n'));
const TH = (await import(OUT + '?' + Date.now())).default;
fs.unlinkSync(OUT);

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// A move's progress (0..1) at fraction u of its time, as the app evaluates the cubic.
function progress(out, dV, T, v0, u) {
  const x1 = out.xa, x2 = 1 - out.xb;
  let lo = 0, hi = 1, t = 0.5;
  for (let i = 0; i < 40; i++) {
    const o = 1 - t, x = 3 * o * o * t * x1 + 3 * o * t * t * x2 + t * t * t;
    if (x < u) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  const o = 1 - t, p0 = v0, p3 = v0 + dV;
  const p1 = p0 + out.sa * out.xa * T, p2 = p3 - out.sb * out.xb * T;
  const v = o * o * o * p0 + 3 * o * o * t * p1 + 3 * o * t * t * p2 + t * t * t * p3;
  return (v - v0) / dV;
}

// Which moves a selection means.
const segs = (n, a) => JSON.stringify(TH.easeSegments(n, a));
check('a lone key means the move leaving it', segs(5, [0]) === '[[0,1]]', segs(5, [0]));
check('a lone last key means the move arriving at it', segs(5, [4]) === '[[3,4]]');
check('two neighbours are the move between them', segs(5, [1, 2]) === '[[1,2]]');
check('three neighbours are two moves', segs(5, [1, 2, 3]) === '[[1,2],[2,3]]');
check('apart, each leaves on its own', segs(5, [0, 2]) === '[[0,1],[2,3]]');
check('a curve with one key has no move', segs(1, [0]) === '[]');

const flatKey = { T: 1, dV: 10, xa0: 0.33, xb0: 0.33, sa0: 10, sb0: 10, nextLen: 0.33 };   // starts linear
const E = (kind, f, s = flatKey) => TH.easeSegment(kind, f, s);

for (const k of ['timing', 'ease', 'over']) {
  const c = E(k, 0);
  check(`${k}: centre changes nothing`, c.xa === 0.33 && c.xb === 0.33 && c.sa === 10 && c.sb === 10);
}

// Timing.
{
  const late = E('timing', 0.6);
  check('Late flattens and lengthens the first handle', late.sa === 0 && late.xa > 0.33);
  check('...shortens the second', late.xb < 0.33);
  check('...and leaves its slope alone, so an overshoot survives', late.sb === 10);
  check('Late holds: less done early than a straight move', progress(late, 10, 1, 0, 0.25) < 0.25, String(progress(late, 10, 1, 0, 0.25)));
  check('Early does the reverse', progress(E('timing', -0.6), 10, 1, 0, 0.75) > 0.75);
  check('handles stay inside the move', E('timing', 1).xa <= 1 && E('timing', -1).xb <= 1 && E('timing', 1).xb > 0);
  check('a small pull is a small change', Math.abs(E('timing', 0.1).xa - 0.33) < 0.1);
  check('a flat move stays flat', E('timing', 1, { ...flatKey, dV: 0, sa0: 0, sb0: 0 }).sb === 0);
}

// Same timing whatever the channel's size: the point of the tool.
{
  const shape = (dV) => {
    const s = { T: 1, dV, xa0: 0.33, xb0: 0.33, sa0: dV, sb0: dV, nextLen: 0.33 };
    return [0.1, 0.5, 0.9].map((u) => progress(E('ease', 0.5, s), dV, 1, 0, u));
  };
  const a = shape(0.01), b = shape(140), c = shape(-37);
  check('channels of any size and direction share one timing',
    a.every((v, i) => near(v, b[i], 1e-6) && near(v, c[i], 1e-6)), JSON.stringify([a, b, c]));
}

// Ease.
{
  const soft = E('ease', 1);
  check('Soft is flat and long at both ends', soft.sa === 0 && soft.sb === 0 && soft.xa > 0.5 && soft.xb > 0.5);
  const lo = progress(soft, 10, 1, 0, 0.1), mid = progress(soft, 10, 1, 0, 0.5);
  check('...slow at the ends, half way at half time', lo < 0.05 && near(mid, 0.5, 1e-6), `${lo} ${mid}`);
  const lin = E('ease', -1, { ...flatKey, sa0: 0, sb0: 0 });
  check('Linear is a straight line', near(progress(lin, 10, 1, 0, 0.25), 0.25, 1e-3), String(progress(lin, 10, 1, 0, 0.25)));
  check('...and asks for corners', lin.corners === true);
  check('Soft does not', !soft.corners);
}

// Overshoot.
{
  const s = { ...flatKey, sa0: 0, sb0: 0 };
  const over = E('over', 1, s);
  check('it carries the motion through the second key', over.sb > 0 && over.sb * s.nextLen / s.dV > 0.5);
  check('...and scales with the travel', near(E('over', 1, { ...s, dV: -20 }).sb, -2 * over.sb));
  check('...leaving the first key alone', over.sa === 0 && over.xa === s.xa0);
  const last = E('over', 1, { ...s, nextLen: 0 });
  check('a last key arrives from beyond instead', last.sb < 0, String(last.sb));
  const antic = E('over', -1, s);
  check('Antic pulls back before leaving', antic.sa < 0 && antic.sb === 0);
  check('...and dips below the start', progress(antic, 10, 1, 0, 0.1) < 0, String(progress(antic, 10, 1, 0, 0.1)));
  check('a channel with no travel does not move', E('over', 1, { ...s, dV: 0 }).sb === 0);
}

// Wiring.
const code = TL_SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const fn = (name) => { const i = code.indexOf('\n  ' + name + '('); return i < 0 ? '' : code.slice(i, code.indexOf('\n  }\n', i)); };
check('the sliders and Flat/Auto use one job list',
  /_selectedTangentJobs\(\)/.test(fn('_tanDialStart')) && /_selectedTangentJobs\(\)/.test(fn('setSelectedTangents')));
check('length and slope are both written', /c\.dtKey\(a, 'right'\)/.test(fn('_tanDialMove')) && /c\.dvKey\(a, 'right'\)/.test(fn('_tanDialMove')));
check('the drag is measured from the press', /\(rx - d\.x0\)/.test(fn('_tanDialMove')), 'pressing would jump the curve');
check('Overshoot always writes the far side of the second key', /\(e\.tiedB \|\| r\.kind === 'over'\)/.test(fn('_tanDialMove')),
  'that handle is what carries the curve past the key');
check('a straight segment lets the ties go', /if \(corners\) t\.to\[t\.flag\] = false/.test(fn('_tanDialMove')));
check('...and pulling back restores them', /else put\(t\.to, t\.flag, t\.was\)/.test(fn('_tanDialMove')));
check('one undo step, and none for a bare press', /if \(d\.moved\) \{\s*const after/.test(fn('_tanDialEnd')));
check('undo refreshes the scene', /_restoreTracksInPlace\(state\); this\._tanDialApply\(d\)/.test(fn('_tanDialEnd')));
check('sparse tracks re-derive', /xfRefreshDerived\(tr\)/.test(fn('_tanDialApply')));
check('move and release reach it', /if \(this\._tanDial\) \{\s*this\._tanDialMove/.test(code) && /if \(this\._tanDial\) \{ this\._tanDialEnd\(\)/.test(code));
check('a cancelled action drops it', /this\._tanDial = null;/.test(fn('_cancelActiveAction')));
check('available in the dopesheet too', !/_mode !== 'graph'/.test(fn('_tanDialRects')), 'a summary selection is made there');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
