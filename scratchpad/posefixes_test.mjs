// The Pose Fixes section of the blendshape panel. Muting, the mesh, save/reload, Clear and undo were driven on a
// real file in the app (postpose.sxr); this pins the wiring, which spans four files and reads right if one is cut.
//
// Run: node scratchpad/posefixes_test.mjs   (PF_INJECT=weight|stroke|status|drop|put|save|load|clone|sel|hit|sig)
import fs from 'fs';

const REPO = new URL('..', import.meta.url).pathname;
const inject = process.env.PF_INJECT || '';
const read = (f) => fs.readFileSync(REPO + f, 'utf8');
let RP = read('/src/editing/RigPoses.js'), SK = read('/src/editing/Skeleton.js'), TH = read('/src/gui/TimelineHelper.js'), BP = read('/src/gui/BlendshapeStackPanel.js');
const bite = (src, a, b) => { if (!src.includes(a)) throw new Error('inject target gone: ' + a); return src.replace(a, b); };
if (inject === 'weight') RP = bite(RP, 'pose && !t.correctiveMuted?.has(key) ? RigPoses.weight(pose) : 0', 'pose ? RigPoses.weight(pose) : 0');
if (inject === 'stroke') RP = bite(RP, 'return on && !fixMuted(mesh, on) ? on : null;', 'return on;');
if (inject === 'status') RP = bite(RP, 'if (on && !layer && !fixMuted(mesh, on)) return', 'if (on && !layer) return');
if (inject === 'drop') RP = bite(RP, 't.correctiveMuted?.delete(key);\n', '');
if (inject === 'put') RP = bite(RP, 'if (muted) (t.correctiveMuted', 'if (false) (t.correctiveMuted');
if (inject === 'save') SK = bite(SK, 'u[o++] = fixMuted.length;', 'u[o++] = 0;');
if (inject === 'load') SK = bite(SK, 'if (t) (t.correctiveMuted || (t.correctiveMuted = new Set())).add(key);', '');
if (inject === 'clone') TH = bite(TH, 'if (track.correctivePost) cloned.correctivePost', 'if (false) cloned.correctivePost');
if (inject === 'sel') BP = bite(BP, '_fixes() { return RigPoses.fixes(this._main); }', '_fixes() { return this._track() ? RigPoses.fixes(this._main) : []; }');
if (inject === 'hit') BP = bite(BP, 'if (fixHit.kind !== \'row\') this._onFixPress(fixHit);', '');
if (inject === 'sig') BP = bite(BP, "let s = fx + (window", "let s = (window");

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const rp = strip(RP), sk = strip(SK), th = strip(TH), bp = strip(BP);

check('a muted fix weighs 0, in the one place weights are set', /pose && !t\.correctiveMuted\?\.has\(key\) \? RigPoses\.weight\(pose\) : 0/.test(rp));
check('a stroke skips a muted fix', /return on && !fixMuted\(mesh, on\) \? on : null;/.test(rp), 'it would land where it cannot be seen');
check('...and the status says pre', /if \(on && !layer && !fixMuted\(mesh, on\)\) return/.test(rp));
check('deleting a fix forgets its mute', /t\.correctiveMuted\?\.delete\(key\);/.test(rp), 'a new fix on that pose would start off');
check('undoing a delete brings it back', /if \(muted\) \(t\.correctiveMuted/.test(rp));
check('muting applies at once', /RigPoses\.drive\(main\);\s*main\.render\?\.\(\);/.test(rp));
check('saved', /u\[o\+\+\] = fixMuted\.length;/.test(sk) && +(/const SKEL_VERSION = (\d+);/.exec(sk) || [])[1] >= 33);
check('...its slots are counted', /for \(const d of fixMuted\) slots \+= 2 \+ d\.key\.length;/.test(sk));
check('...and loaded', /if \(ver >= 33\)/.test(sk) && /if \(t\) \(t\.correctiveMuted \|\| \(t\.correctiveMuted = new Set\(\)\)\)\.add\(key\);/.test(sk));
for (const f of ['correctivePost', 'correctiveDetails', 'correctiveW', 'correctiveMuted']) {
  check(`a cloned track keeps ${f}`, new RegExp(`if \\(track\\.${f}\\) cloned\\.${f}`).test(th), 'undoing a key drag replaces the track with a clone');
}
check('the list does not depend on the selection', /_fixes\(\) \{ return RigPoses\.fixes\(this\._main\); \}/.test(bp), 'a joint is usually what is selected while posing');
check('it counts in the panel height', /\+ this\._fixesH\(\);/.test(bp));
check('it draws with no mesh selected', /No mesh selected[\s\S]{0,200}_drawFixes/.test(bp));
check('a press reaches it', /if \(fixHit\.kind !== 'row'\) this\._onFixPress\(fixHit\)/.test(bp));
check('weights moving redraw it', /let s = fx \+ \(window/.test(bp) && /'none' \+ fx/.test(bp));
check('Pose Fixes is not a layer row', /!n\.startsWith\('pose:'\)/.test(bp));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
