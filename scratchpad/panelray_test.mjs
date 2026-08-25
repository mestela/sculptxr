// The panel has to be where the ray thinks it is.
//
// Wrist panels are parented to the controller grip, so their world matrix comes from the
// controller — and world matrices are recomputed inside renderer.render(), which runs at the END
// of the frame. So at hit-test time every panel's matrixWorld is from the PREVIOUS frame's
// render while the ray is from this frame's fresh pose.
//
// The error is one frame of the carrying hand's motion. Because the panel sits about 30cm from
// that hand, a millimetre of drift swings the hit point a long way: measured single-frame uv
// jumps of 0.44 to 1.09 in a 0-1 space, from a hand held as still as a hand gets.
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const hit = SCENE.indexOf("this._mark('xr-panelhit');");
const phase1 = SCENE.indexOf('// Phase 1: collect hits', hit);
const pre = hit === -1 ? '' : SCENE.slice(hit, phase1);

check('the hit-test phase is locatable', hit !== -1 && phase1 > hit);
check('world matrices are refreshed BEFORE the hit test',
  /updateMatrixWorld\(true\)/.test(pre),
  'a stale matrix makes the ray and the panel disagree about where the panel is');
check('...via the GRIPS, so it cascades to every panel hanging off them',
  /this\._vrControllerLeftGrip, this\._vrControllerRightGrip/.test(pre),
  'updating a child alone still reads a stale parent matrixWorld');

// The forced flag is the whole point: without it three skips subtrees it believes are clean,
// and the controller's own matrixWorldNeedsUpdate has already been consumed by the last render.
check('the update is FORCED',
  /updateMatrixWorld\(true\)/.test(pre) && !/updateMatrixWorld\(\)/.test(pre),
  'an unforced update is a no-op exactly when it is needed');

// It has to sit after the mark, or the cost lands in whatever section came before and the
// next person to read the timings is misled about where the frame went.
check('it is inside the section it costs',
  SCENE.indexOf("this._mark('xr-panelhit');") < SCENE.indexOf('updateMatrixWorld(true)', hit));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
