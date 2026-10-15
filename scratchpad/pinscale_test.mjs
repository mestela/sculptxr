// PINS CARRY NO SCALE, AND GRAB MOVES A PARENTED MESH BY THE CURSOR'S DELTA.
//
// matt's sxr2.sxr: a neck pin parented to the hips pin, both seated by an older build at their
// joint's scale (6.799). Two separate faults met there:
//
//  1. Grab's desktop path took the anchor and the write-back from the mesh's LOCAL matrix, so a
//     parented pin jumped (a 20 px drag sent it 310 units) -- the "it collapses to the hips".
//     Fixed by working in model space throughout. Checked in the browser: cursor (-15,30) ->
//     pin on screen (-16,30); (25,0) -> (25,-1); the neck joint then reaches the pin exactly.
//  2. A pin at 6.8 multiplies everything under it. Normalising must be WORLD-PRESERVING --
//     baking the parent's scale by hand leaves the child's local offset pointing somewhere new.
//     Checked in the browser on the real file: every pin at scale 1, positions and joints
//     unchanged, the neck pin's local offset re-derived.
//
// Run: node scratchpad/pinscale_test.mjs
import fs from 'fs';
import path from 'path';
import { mat4, quat } from 'gl-matrix';
const REPO = new URL('..', import.meta.url).pathname;
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const mul = (a, b) => mat4.multiply(mat4.create(), a, b);
const inv = (m) => mat4.invert(mat4.create(), m);
const maxd = (a, b) => Array.from(a).reduce((mx, v, i) => Math.max(mx, Math.abs(v - b[i])), 0);
let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const trs = (s) => mat4.fromRotationTranslationScale(mat4.create(), quat.normalize([0, 0, 0, 1], [rnd() - .5, rnd() - .5, rnd() - .5, rnd() + .2]),
  [rnd() * 50, rnd() * 50, rnd() * 50], [s, s, s]);

// the algebra: renormalise a parent to unit scale, re-derive the child's local so its world is unchanged
let worst = 0, naive = 0;
for (let i = 0; i < 100; i++) {
  const s = 1 + rnd() * 8, parent = trs(s), childLocal = trs(1);
  const childWorld = mul(parent, childLocal);
  const t = mat4.getTranslation([0, 0, 0], parent), q = mat4.getRotation([0, 0, 0, 1], parent);
  const unit = mat4.fromRotationTranslationScale(mat4.create(), q, t, [1, 1, 1]);
  worst = Math.max(worst, maxd(mul(unit, mul(inv(unit), childWorld)), childWorld));      // child re-derived
  naive = Math.max(naive, maxd(mul(unit, childLocal), childWorld));                      // child left alone (what baking by hand does)
}
check('re-deriving the child keeps its world transform exactly', worst < 1e-3, 'worst ' + worst);
check('...and leaving the child alone (baking the parent by hand) does NOT -- that is the collapse', naive > 1, 'naive drift ' + naive);

const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const SK = strip(read('src/editing/Skeleton.js'));
check('a legacy pin (scale == its joint\'s) is normalised, a chosen scale is left alone',
  /if \(ps\.every\(\(v\) => near\(v, 1\)\)\) continue;/.test(SK) && /if \(!\(near\(ps\[0\], js\[0\]\) && near\(ps\[1\], js\[1\]\) && near\(ps\[2\], js\[2\]\)\)\) continue;/.test(SK));
check('children are restored to their own model transforms', /kids\.forEach\(\(k, i\) => \{ k\.setModelSpaceMatrix\(kidModels\[i\]\)/.test(SK));
check('roots first, and the three-side matrices are brought into line before any read', /pins\.sort\(\(a, b\) => depth\(a\) - depth\(b\)\);/.test(SK) && /Skeleton\.syncThree\(m\);\s*\n?\s*\(main\._worldGroup/.test(SK.replace(/\n\s*/g, '\n')) || /for \(const m of all\) if \(m && \(m\._isPinTarget \|\| m\._isBone\)\) Skeleton\.syncThree\(m\);/.test(SK));
check('it runs at the end of every rig load', /try \{ Skeleton\.normalizePinScales\(main\); \}/.test(SK));
check('a new pin is made at unit scale', /_mTmp\.compose\(_vTmp, _qPin, _sOnePin\);/.test(SK));

const GR = strip(read('src/editing/tools/Grab.js'));
check('Grab takes its anchor from the MODEL-space matrix', /this\._grabInitModelM = mesh\.getModelSpaceMatrix/.test(GR) && /vec3\.transformMat4\(vec3\.create\(\), hitLocal, this\._grabInitModelM\)/.test(GR));
check('...writes the moved mesh in model space, through its parent', /const next = mat4\.clone\(this\._grabInitModelM\);[\s\S]{0,300}setModelSpaceMatrix\(next\)/.test(GR));
check('...and no longer writes the cursor delta into the local translation', !/m\[12\] = this\._grabInitT\[0\] \+ delta\[0\];\s*\n\s*m\[13\] = this\._grabInitT\[1\] \+ delta\[1\];\s*\n\s*m\[14\] = this\._grabInitT\[2\] \+ delta\[2\];\s*\n\s*\n?\s*this\._grabbedMesh\.updateMatrices/.test(GR));

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
