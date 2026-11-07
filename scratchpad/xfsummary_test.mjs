// The Transforms fold in the dopesheet: which rows join it, what a summary key holds, and that a
// selection there reaches the graph editor. Pure parts run for real; the wiring is checked in source
// because it lives on a canvas class that needs a browser.
//
// Run: node scratchpad/xfsummary_test.mjs   (XF_INJECT=shape|mute|tol|floor|graphset|expand|drop)
import fs from 'fs';

const REPO = new URL('..', import.meta.url).pathname;
const inject = process.env.XF_INJECT || '';
let TH_SRC = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');
let TL_SRC = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
const bite = (src, a, b) => { if (!src.includes(a)) throw new Error('inject target gone: ' + a); return src.replace(a, b); };
if (inject === 'shape') TH_SRC = bite(TH_SRC, '!track.shapeTimes?.length\n      && ', '');
if (inject === 'mute') TH_SRC = bite(TH_SRC, 'if (tr.muted) continue;\n      for (let i = 0; i < tr.times.length', 'for (let i = 0; i < tr.times.length');
if (inject === 'tol') TH_SRC = bite(TH_SRC, 'const XF_SAME = 1e-3', 'const XF_SAME = 1e-9');
if (inject === 'floor') TH_SRC = bite(TH_SRC, 'LANE_H_MIN = 16', 'LANE_H_MIN = 0');
if (inject === 'graphset') TL_SRC = bite(TL_SRC, 'if (this._graphKeyIds) {\n      for (const m of', 'if (false) {\n      for (const m of');
if (inject === 'expand') TL_SRC = bite(TL_SRC, 'this._graphFromDope();\n', '');
if (inject === 'drop') TL_SRC = bite(TL_SRC, ' || this._graphKeyIds?.has(k.meshId))) {', ')) {');

fs.mkdirSync(REPO + 'scratchpad/_gen', { recursive: true });
const OUT = REPO + 'scratchpad/_gen/_xfsummary_helper.mjs';
const stubbed = TH_SRC.replace(/^import [\s\S]*?from '\.\.\/editing\/xfChannel\.js';\n/, 'const xfKeyed=0,xfRead=0,xfWrite=0,xfTanPrefix=0,xfVisible=0,xfChanVisible=0,xfWeightTrack=0;\n');
fs.writeFileSync(OUT, stubbed);
const TH = (await import(OUT + '?' + Date.now())).default;
fs.unlinkSync(OUT);

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Who joins the fold.
check('a transform-only row joins', TH.isXfRow({ times: [0, 1] }));
check('a row with no keys does not', !TH.isXfRow({ times: [] }));
check('a row with shape keys stays out', !TH.isXfRow({ times: [0], shapeTimes: [0] }), 'folding it would hide them');
check('...with blendshape rows', !TH.isXfRow({ times: [0], blendshapeTracks: new Map([['a', {}]]) }));
check('...with shape layers', !TH.isXfRow({ times: [0], shapeLayers: [{}] }));
check('an empty blendshape map does not count', TH.isXfRow({ times: [0], blendshapeTracks: new Map() }));

// What a summary key holds.
const rows = [[1, { times: [0, 1, 2] }], [2, { times: [1 + 1e-5, 3] }], [3, { times: [1, 2], muted: true }]];
const sum = TH.xfSummary(rows);
check('one key per time, in order', sum.map((g) => g.time).join() === '0,1,2,3', sum.map((g) => g.time).join());
check('float noise is the same key', sum[1].keys.length === 2, 'a retimed pose splits into two markers otherwise');
check('...holding the real keys', JSON.stringify(sum[1].keys) ===
  JSON.stringify([{ meshId: 1, type: 'transform', index: 1 }, { meshId: 2, type: 'transform', index: 0 }]));
check('muted rows are left out', !sum.flatMap((g) => g.keys).some((k) => k.meshId === 3), 'their keys cannot be picked');
check('no rows, no keys', TH.xfSummary(null).length === 0);
check('near but different times stay apart', TH.xfSummary([[1, { times: [0, 0.01] }]]).length === 2);

// A big rig stays readable.
check('lanes keep a floor and scroll', TH.laneHeight(100, 27) === 16, 'shared out they are ' + 100 / 27 + 'px');
check('a few lanes still share the height', TH.laneHeight(100, 4) === 25);
check('...up to the cap', TH.laneHeight(1000, 4) === 34);

// Wiring.
const code = TL_SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const fn = (name) => { const i = code.indexOf('\n  ' + name + '('); return i < 0 ? '' : code.slice(i, code.indexOf('\n  }\n', i)); };
check('the summary is a lane, so layout and hit tests place it', /\[XF_SUMMARY_ID, \{ _xfSummary: true \}\]/.test(fn('_dopesheetTracks')));
check('folding removes the rows from the lanes', /this\._xfFolded \? \[\] : xfRows/.test(fn('_dopesheetTracks')));
check('one transform row gets no fold', /xfRows\.length >= 2/.test(fn('_dopesheetTracks')));
check('the graph draws what the dopesheet selected', /if \(this\._graphKeyIds\) \{\s*for \(const m of/.test(fn('_graphMeshes')));
check('a selection elsewhere ends it', /!this\._graphKeyIds\?\.has\(_selId\)\) this\._graphKeyIds = null/.test(fn('_graphMesh')));
check('key presses capture it', /KEY TAKEN[^\n]*\n\s*this\._captureGraphKeys\(\)/.test(code));
check('a marquee captures it', /this\._captureGraphKeys\(\);/.test(fn('finalizeMarquee')));
check('entering the graph turns slots into channel keys', /case 'mode'[\s\S]{0,200}this\._graphFromDope\(\);/.test(code));
check('a summary key survives the stale-selection check', /this\._graphKeyIds\?\.has\(k\.meshId\)\)\) \{/.test(fn('_dropStaleKeySelection')),
  'Delete would drop the keys and wipe the selected object instead');
check('snapping reads the grabbed row, not any row with that index', /k\.meshId === this\._activeMeshId &&\s*k\.type === this\._activeKeyframeType/.test(code));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
