// Node harness for NAV THROW — releasing a world grab (#19).
//
// Inertia after a release is a feature ("really fun to throw the scene around in vr"), and the
// same code was also moving the scene when you meant to put it down: "it always shifts away a
// little from my intended position when letting go" (adurna35).
//
// The cause was one number answering two questions. The STRONGEST sample in the six-frame buffer
// supplied both the magnitude AND the launch decision, so a single noisy frame while letting go
// from rest cleared the threshold. The magnitude must keep using the strongest sample — Galaxy XR
// damps controller motion on the release frame, and reading the last frame zeroes a real throw —
// so the DECISION is what changed: was the motion sustained across the window.
//
// The rule is arithmetic, so it is LIFTED AND RUN rather than read.
//
// Run: node scratchpad/navthrow_test.mjs
//
// Defect injections:
//   NT_INJECT=maxgate    the decision goes back to the strongest sample, so a noisy release flies
//   NT_INJECT=allgate    every sample must clear the threshold, which refuses an accelerating
//                        throw -- the gesture the feature exists for
//   NT_INJECT=lastframe  the magnitude comes from the final sample, undoing the Galaxy XR fix
//   NT_INJECT=noscale    the user setting stops being applied, so Off still throws
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const inj = process.env.NT_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let SCENE = R('src/Scene.js');
const swap = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error('inject ' + what + ': anchor moved');
  return src.replace(from, to);
};

if (inj === 'maxgate') {
  SCENE = swap(SCENE, 'return n >= Math.ceil(hist.length / 2);', 'return n >= 1;', 'maxgate');
}
if (inj === 'allgate') {
  SCENE = swap(SCENE, 'return n >= Math.ceil(hist.length / 2);', 'return n >= hist.length;', 'allgate');
}
if (inj === 'lastframe') {
  SCENE = swap(SCENE, 'for (const v of g.velHist) { const l = vec3.length(v); if (l > best) { best = l; vec3.set(g.vel, v[0], v[1], v[2]); } }',
    'const _lv = g.velHist[g.velHist.length - 1]; vec3.set(g.vel, _lv[0], _lv[1], _lv[2]);', 'lastframe');
}
if (inj === 'noscale') {
  SCENE = swap(SCENE, 'const throwScale = this._navThrowScale();', 'const throwScale = 1;', 'noscale');
}

// ── LIFT THE DECISION AND RUN IT ────────────────────────────────────────────
const src = SCENE.slice(SCENE.indexOf('const _sustained = (hist, measure, thresh) => {'),
  SCENE.indexOf('const _flyT = _sustained('));
if (!src) throw new Error('lift: the anchor moved');
const sustained = new Function(src + '\nreturn _sustained;')();

const T = 0.002;
const speed = (v) => Math.hypot(v[0], v[1], v[2]);
const asVec = (arr) => arr.map((m) => [m, 0, 0]);

// Per-frame speeds, measured cases. `want` is whether the scene should glide.
const CASES = [
  ['let go from rest, one noisy frame', [0.0003, 0.0004, 0.0002, 0.0030, 0.0004, 0.0003], false],
  ['let go from rest, pure noise',      [0.0004, 0.0003, 0.0005, 0.0004, 0.0002, 0.0006], false],
  ['slow deliberate nudge',             [0.0018, 0.0021, 0.0025, 0.0027, 0.0030, 0.0028], true],
  ['deliberate throw, accelerating',    [0.0010, 0.0020, 0.0040, 0.0070, 0.0100, 0.0120], true],
  ['throw, damped final frame (GXR)',   [0.0080, 0.0090, 0.0100, 0.0110, 0.0120, 0.0010], true],
];
for (const [name, samples, want] of CASES) {
  const got = sustained(asVec(samples), speed, T);
  check((want ? 'flies: ' : 'stays: ') + name, got === want,
    'got ' + (got ? 'fly' : 'stay') + ', wanted ' + (want ? 'fly' : 'stay'));
}

// HALF, not all and not one. The two failure modes sit either side of it: at one, a noisy frame
// launches; at all, an accelerating throw is refused because its first samples are slow.
check('...the gate is half the window',
  /return n >= Math\.ceil\(hist\.length \/ 2\);/.test(SCENE),
  'one sample is the old bug; every sample refuses the gesture this exists for');

// ── MAGNITUDE STILL COMES FROM THE STRONGEST SAMPLE ─────────────────────────
{
  const blk = SCENE.slice(SCENE.indexOf('if (g.wasActive) {'), SCENE.indexOf('const _sustained'));
  check('the launch speed is still the strongest recent sample',
    /if \(l > best\) \{ best = l; vec3\.set\(g\.vel, v\[0\], v\[1\], v\[2\]\); \}/.test(blk),
    'Galaxy XR damps the release frame; reading the last sample zeroes a real throw');
}

// ── THE SETTING ─────────────────────────────────────────────────────────────
{
  check('the throw strength is applied to the launch',
    /const throwScale = this\._navThrowScale\(\);/.test(SCENE)
      && /if \(throwScale <= 0\) \{\s*\n\s*g\.gliding = false;/.test(SCENE),
    'Off has to mean the scene stops where you left it, not merely slower');
  check('...live value first, then the saved one',
    /const live = window\._navThrow;/.test(SCENE)
      && /const saved = getOptionsURL\(\)\.navThrow;/.test(SCENE),
    'the slider writes both so a drag takes effect on the next release, not the next reload');
  check('...clamped to 0..1 at the source',
    (SCENE.match(/Math\.max\(0, Math\.min\(1, \+(live|saved)\)\)/g) || []).length === 2);
  check('...and registered as a number, not a flag',
    /options\.navThrow = queryNumber\(getVal\('navThrow'\), 0, 1, 1\)/
      .test(R('src/misc/getOptionsURL.js')),
    '"less, but not none" is the request, so it cannot be a toggle');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
