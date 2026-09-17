// Node harness for PAINT DOES NOT GET SWALLOWED BY THE WEIGHT PREVIEW.
//
// The preview replaces the mesh's vertex colours with per-bone ones and keeps the originals in
// `_skinSavedColors`; hiding it writes that snapshot back. Colour painted while the preview was up
// was therefore overwritten the moment it was hidden -- silently, and long enough after the fact
// that it read as the paint never having landed at all.
//
// Run: node scratchpad/paintweights_test.mjs   (from the repo root)
//
// Defect injections:
//   PW2_INJECT=nohide     painting stops clearing the preview
//   PW2_INJECT=flagonly   the colours are left painted and only the flag is cleared, so the next
//                         re-skin repaints the preview straight over the stroke
//   PW2_INJECT=aftercolor the clear happens after the undo snapshot, which then captures the
//                         weight ramp as if it were the model's real colours
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const inj = process.env.PW2_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const swap = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error('inject ' + what + ': anchor moved');
  return src.replace(from, to);
};

let PAINT = R('src/editing/tools/Paint.js');
const SKIN = R('src/editing/Skinning.js');

if (inj === 'nohide') {
  PAINT = swap(PAINT, 'if (mesh && Skinning.weightColorsShown(mesh)) {', 'if (false) {', 'nohide');
}
if (inj === 'flagonly') {
  PAINT = swap(PAINT, '        Skinning.restoreColors(mesh);\n', '', 'flagonly');
}
if (inj === 'aftercolor') {
  // Snapshot FIRST, then restore -- so the undo entry records the weight ramp as the model's
  // real colours. Hoisting the existing call is the realistic shape of this regression.
  PAINT = swap(PAINT, "      this._main.getStateManager().pushStateColorAndMaterial(mesh);\n",
    "", 'aftercolor');
  PAINT = swap(PAINT, "    if (!this._pickColor || force) {\n",
    "    if (!this._pickColor || force) {\n      this._main.getStateManager().pushStateColorAndMaterial(this.getMesh());\n",
    'aftercolor');
}

// ── THE STROKE CLEARS THE PREVIEW ───────────────────────────────────────────
{
  const ps = PAINT.slice(PAINT.indexOf('pushState(force) {'),
    PAINT.indexOf('pushState(force) {') + 1400);
  check('a paint stroke asks whether the weight preview is up',
    /Skinning\.weightColorsShown\(mesh\)/.test(ps),
    'the preview is per-mesh state, so the mesh is what has to be asked');
  check('...and puts the real colours back before painting on them',
    /Skinning\.restoreColors\(mesh\)/.test(ps),
    'without this the stroke lands on the weight ramp and the snapshot overwrites it later');
  check('...and clears the flag as well as the colours',
    /Skeleton\.setDisplayFlag\('weights', false\)/.test(ps),
    'colours alone would be repainted by the next re-skin, straight over the stroke');
}

// ── ORDER IS THE WHOLE CORRECTNESS ARGUMENT ─────────────────────────────────
//
// Restore has to happen BEFORE the undo snapshot, or the snapshot records the weight ramp as the
// model's real colours and one undo leaves you with a rainbow mesh.
{
  const ps = PAINT.slice(PAINT.indexOf('pushState(force) {'));
  const restore = ps.indexOf('Skinning.restoreColors(mesh)');
  const snap = ps.indexOf('pushStateColorAndMaterial');
  check('the preview is cleared before the undo snapshot is taken',
    restore > 0 && snap > 0 && restore < snap,
    'restore@' + restore + ' snapshot@' + snap
      + ' — snapshotted first, undo restores the weight ramp as if it were the sculpt');
}

// ── AND IT IS THE STROKE, NOT THE EYEDROPPER ────────────────────────────────
{
  check('the eyedropper does not clear it',
    /if \(!this\._pickColor \|\| force\) \{/.test(PAINT),
    'picking a colour off the surface writes nothing, so it must not disturb the preview');
}

// ── THE SNAPSHOT IT DEPENDS ON ──────────────────────────────────────────────
{
  check('weightColorsShown answers from the saved snapshot',
    /weightColorsShown = function \(mesh\) \{ return !!\(mesh && mesh\._skinSavedColors\); \}/.test(SKIN),
    'that array IS the preview: set while it is up, null once the colours are back');
  check('...and restoreColors clears it, so the preview cannot be cleared twice',
    /mesh\._skinSavedColors = null;/.test(SKIN));
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
