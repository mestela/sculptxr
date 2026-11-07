// The transform box and what it touches: handles keep a move's shape when keys retime, a handle past its
// segment cannot double the curve back, idle scale is not keyed, every T/R/S group may be hidden, and
// the box writes each key to its own object.
//
// Run: node scratchpad/transformbox_test.mjs   (TB_INJECT=target|pad|fit|retime|dv|scale|hide|first|prune|dead)
import fs from 'fs';

const REPO = new URL('..', import.meta.url).pathname;
const inject = process.env.TB_INJECT || '';
let XF = fs.readFileSync(REPO + '/src/editing/xfChannel.js', 'utf8');
let TH = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');
let TL = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
let REG = fs.readFileSync(REPO + '/src/editing/AnimationRegistry.js', 'utf8');
const bite = (src, a, b) => { if (!src.includes(a)) throw new Error('inject target gone: ' + a); return src.replace(a, b); };
if (inject === 'target') TL = bite(TL, '(sk) => reg.tracks.get(sk.meshId), this._animTransformBoxInitialKeys', '() => reg.tracks.get(this._graphMesh().getID()), this._animTransformBoxInitialKeys');
if (inject === 'pad') TL = bite(TL, '({ minT, maxT } = this._padBoxTime(minT, maxT));', '');
if (inject === 'fit') XF = bite(XF, 'return len > dt ? dt / len : 1;', 'return 1;');
if (inject === 'retime') XF = bite(XF, 'if (ratio > 0) to[k] = base.to[k] * ratio;\n  }\n}\n\n// The same', '}\n}\n\n// The same');
if (inject === 'dv') XF = bite(XF, '(left|right)_dt$/;\nexport function xfRetimeHandles', '(left|right)_d[tv](?:_\\d)?$/;\nexport function xfRetimeHandles');
if (inject === 'scale') REG = bite(REG, 'bits = this._dropIdleScale(track, time, [sx, sy, sz], bits);', '');
if (inject === 'hide') XF = bite(XF, 'if (Array.isArray(v)) return v.filter', 'if (Array.isArray(v) && v.length) return v.filter');
if (inject === 'first') REG = bite(REG, 'm[0] |= sb;', '');
if (inject === 'prune') XF = bite(XF, "if (Math.abs(tr.scales[i * 3 + c] - tr.scales[c]) > 1e-4) return false;", '');
if (inject === 'dead') TL = bite(TL, 'if (Math.hypot(rx - this._pressX, ry - this._pressY) < 3) return false;', '');

globalThis.window = globalThis.window || {};
fs.mkdirSync(REPO + 'scratchpad/_gen', { recursive: true });
const OUT = REPO + 'scratchpad/_gen/_xfbox_helper.mjs';
fs.writeFileSync(OUT, XF);
const X = await import(OUT + '?' + Date.now());
fs.unlinkSync(OUT);

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const track = (times, posX, extra = {}) => ({
  times, positions: posX.flatMap((v) => [v, 0, 0]), scales: times.flatMap(() => [1, 1, 1]),
  quaternions: times.flatMap(() => [0, 0, 0, 1]), keyMask: times.map(() => X.XF_ALL),
  eulers: times.flatMap(() => [0, 0, 0]), ...extra,
});

// Keeping the shape of a move through a retime.
{
  const to = { trans_pos_0_right_dt: 0.9, trans_pos_0_right_dv_0: 0, trans_pos_1_left_dt: -0.1, trans_pos_1_left_dv_0: -1 };
  const tr = track([0, 1, 2], [0, 10, 0], { tangentOffsets: { ...to } });
  const shape = (end) => [0.1, 0.25, 0.5, 0.75, 0.9].map((u) => X.xfEval(tr, 'pos', 0, u * end) / 10);
  const before = shape(1);
  const base = X.xfRetimeSnapshot(tr.tangentOffsets, tr.times);
  tr.times[1] = 0.4;
  X.xfRetimeHandles(tr, base);
  check('a length scales with its segment', near(tr.tangentOffsets.trans_pos_0_right_dt, 0.36));
  check('...its height stays', tr.tangentOffsets.trans_pos_1_left_dv_0 === -1);
  check('the move keeps its shape', shape(0.4).every((v, i) => near(v, before[i], 1e-4)),
    JSON.stringify([before, shape(0.4)]));
  tr.times[1] = 1;
  X.xfRetimeHandles(tr, base);
  check('moving back restores it exactly', near(tr.tangentOffsets.trans_pos_0_right_dt, 0.9));
  tr.times[1] = 2.5;
  X.xfRetimeHandles(tr, base);
  check('a key dragged past its neighbour leaves that side alone', Number.isFinite(tr.tangentOffsets.trans_pos_1_left_dt));
}
{
  const bt = { times: [0, 1, 2], values: [0, 1, 0], tangentOffsets: { '0_right_dt': 0.8, '0_right_dv': 0, '1_left_dv': -0.5 } };
  const base = X.xfRetimeSnapshot(bt.tangentOffsets, bt.times);
  bt.times[1] = 0.5;
  X.xfRetimeScalar(bt, base);
  check('blendshape lengths scale too', near(bt.tangentOffsets['0_right_dt'], 0.4));
  check('...heights stay', bt.tangentOffsets['1_left_dv'] === -0.5);
}

// A handle too long for its segment.
check('a handle that fits is left alone', X.xfHandleFit(0.3, 1) === 1 && X.xfHandleFit(-0.3, 1) === 1);
check('one that does not is cut to the segment', near(X.xfHandleFit(4, 1), 0.25) && near(X.xfHandleFit(-4, 1), 0.25));
{
  const tr = track([0, 1], [0, 10], { tangentOffsets: { trans_pos_0_right_dt: 5, trans_pos_0_right_dv_0: 0 } });
  let prev = 0, worst = 0;
  for (let n = 1; n <= 100; n++) { const v = X.xfEval(tr, 'pos', 0, n / 100); worst = Math.max(worst, Math.abs(v - prev)); prev = v; }
  check('an oversized handle cannot snap the curve', worst < 1.5, 'largest step ' + worst);
}

// Idle scale in old files.
{
  const tr = track([0, 1], [0, 10], { tangentOffsets: { trans_scale_0_right_dt: 0.3 } });
  check('flat scale keys go', X.xfPruneIdleScale(tr) === true);
  const sb = X.xfGroupBits('scale');
  check('...from every slot', tr.keyMask.every((b) => !(b & sb)));
  check('...leaving the other channels', tr.keyMask.every((b) => b & X.xfGroupBits('pos')));
  check('...and their handles', !Object.keys(tr.tangentOffsets).length);
  check('it evaluates the same', X.xfEval(tr, 'scale', 0, 0.5) === 1);
  const scaled = track([0, 1], [0, 10]); scaled.scales[3] = 2;
  check('real scale animation stays', X.xfPruneIdleScale(scaled) === false && scaled.keyMask[1] === X.XF_ALL);
  const nonOne = track([0, 1], [0, 10]); nonOne.scales = [3, 3, 3, 3, 3, 3];
  X.xfPruneIdleScale(nonOne);
  check('a flat scale other than 1 still holds', X.xfEval(nonOne, 'scale', 0, 0.5) === 3);
  const onlyScale = track([0, 1, 2], [0, 0, 0]);
  onlyScale.keyMask[1] = X.xfGroupBits('scale');
  X.xfPruneIdleScale(onlyScale);
  check('a slot keyed for nothing else is removed', onlyScale.times.length === 2);
  const tilted = track([0, 1], [0, 1], { tangentOffsets: { trans_scale_0_right_dv_0: 0.5 } });
  check('flat keys with a shaped handle stay', X.xfPruneIdleScale(tilted) === false);
}

// Hiding everything.
{
  window._animXfVisible = ['pos'];
  X.xfToggleVisible('pos');
  check('the last group can be hidden', X.xfVisible().length === 0);
  check('...and an edit still has a group', X.xfGroup() === 'pos');
  X.xfToggleVisible('rot');
  check('...and turned back on', X.xfVisible().join() === 'rot');
  window._animXfVisible = undefined;
  check('nothing chosen yet is still T R S', X.xfVisible().join() === 'pos,rot,scale');
}

// Wiring.
const code = TL.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const fn = (name, src = code) => { const i = src.indexOf('\n  ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
check('top and bottom write each key to its own track', /\(sk\) => reg\.tracks\.get\(sk\.meshId\), this\._animTransformBoxInitialKeys/.test(code),
  'one track for all keys replaces an object\'s curves with the others\' values');
check('the graph box is padded where it is hit', /\(\{ minT, maxT \} = this\._padBoxTime\(minT, maxT\)\);/.test(code));
check('...where it is drawn', /const _pad = this\._padBoxTime\(minT, maxT\);/.test(code));
check('...and in the dopesheet', /_dpad = this\._padBoxTime/.test(code) && /_dp = this\._padBoxTime/.test(code));
check('a click on a handle edits nothing', /< 3\) return false/.test(fn('_boxPastDeadzone')));
check('...and leaves no undo step', /if \(!this\._boxMoved\) this\._undoTracksBeforeMove = null/.test(code));
check('the centre drag holds one axis', /_boxAxis === 'value' \? 0/.test(code) && /_boxAxis === 'time' \? 0/.test(code));
check('...and is clamped by the keys, not the padded box', /Math\.max\(-\(_keyMinT/.test(code));
check('a value scale scales the handles', /TimelineHelper\.scaleKeyHandles\(track, sk, factor\)/.test(TH) && /scaleKeyHandles\(track, initKey, scaleFactorY\)/.test(code));
check('box drags keep handle shares', /this\._retimeCapture\(\);\s*const dx = rx/.test(code));
check('key drags too', /if \(dt !== 0\) this\._retimeCapture\(\)/.test(code));
check('the release ends it', /this\._retimeBase = null;\s*if \(this\._tanDial\)/.test(code));
check('new keys skip idle scale', /bits = this\._dropIdleScale\(track, time, \[sx, sy, sz\], bits\)/.test(REG));
check('the first real scale key keeps the held value before it', /m\[0\] \|= sb;/.test(REG), 'a channel holds flat before its first key');
check('an unchanged key still does not key scale', /const idle = !m\.length/.test(REG));
check('old files are cleaned on load', /xfPruneIdleScale\(trackObj\)/.test(fs.readFileSync(REPO + '/src/files/ImportSGL.js', 'utf8')));
check('hiding everything says so', /_allHidden \? 'all key types hidden'/.test(code));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
