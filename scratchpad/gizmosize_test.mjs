// The thumbstick that resizes the VR transform gizmo.
//
// The drag itself needs a headset, but two things can be pinned down here: that the stick
// drives the MATRIX multiplier rather than rebuilding the gizmo's geometry, and that the
// three places carrying the multiplier's range still agree. That last one is this project's
// recurring bug shape — the same value implemented twice, and a change landing in one of them.
//
// Run: node scratchpad/gizmosize_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const OPTS = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
const VR = fs.readFileSync(path.join(REPO, 'src/editing/tools/TransformVR.js'), 'utf8');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The routing branch, isolated two ways so the assertions below cannot accidentally match
// anything else: COMMENTS ARE STRIPPED FIRST, because the prose here names the very things it
// says the code must not do (a test that cannot tell code from commentary reports the fix as
// the bug), and the branch ends at the radius branch that follows it rather than at a
// character count that could run past it.
const sceneCode = SCENE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const iBranch = sceneCode.indexOf("isPressedY && this._sculptManager._toolIndex === Enums.Tools.TRANSFORM_VR");
check('the stick is routed to the gizmo only while Transform is active', iBranch !== -1,
  'the tool gate is gone: this would eat the radius control for every sculpt tool');
const iEnd = iBranch === -1 ? -1 : sceneCode.indexOf('} else if (isPressedY) {', iBranch);
check('the radius control still follows it', iEnd > iBranch,
  'the gizmo branch swallowed the radius branch instead of preceding it');
const BRANCH = iBranch === -1 ? '' : sceneCode.slice(iBranch, iEnd > iBranch ? iEnd : iBranch + 1800);

// A MATRIX SCALE, NOT A REBUILD. _resize() clears the group and recreates all fifteen
// primitives, disposing none of them; at the stick's repeat rate that is ~33 rebuilds a second.
check('the stick drives the matrix multiplier', /window\._gizmoSizeMul = /.test(BRANCH));
check('the stick never rebuilds gizmo geometry', !/_resize\(/.test(BRANCH),
  'resizing geometry per tick will hitch in VR and leaks every buffer it replaces');
check('the new size is persisted', /saveOption\('gizmoSizeMul'/.test(BRANCH));

// Geometric, not linear. A multiplier spans 0.25x to 2x — eight-fold — so a fixed ABSOLUTE
// step is coarse at the small end and sluggish at the large one.
check('the step is geometric', /const step = 1\.0 \+ ([\d.]+) \* speedModifier;/.test(BRANCH)
  && /cur \* step : cur \/ step/.test(BRANCH),
  'a linear step does not read the same at both ends of a multiplier');
check('up is bigger', /valY < -T_PRESS \? cur \* step/.test(BRANCH),
  'the radius control has up as more; this must match or the hand is lied to');

// THE RANGE LIVES IN THREE FILES. The stick clamps it, the option validates it, and the
// settings slider offers it. Any two of those disagreeing means the stick can reach a size the
// slider cannot show, or the option quietly clamps what the stick just saved.
const stickClamp = /Math\.max\(([\d.]+), Math\.min\(([\d.]+), next\)\)/.exec(BRANCH);
const optClamp = /options\.gizmoSizeMul = queryNumber\(getVal\('gizmoSizeMul'\), ([\d.]+), ([\d.]+)/.exec(OPTS);
const sliderRange = /id="mm-gizmo-mul" min="(\d+)" max="(\d+)"/.exec(PANEL);
check('all three carry the range', !!stickClamp && !!optClamp && !!sliderRange);
if (stickClamp && optClamp && sliderRange) {
  const stick = [parseFloat(stickClamp[1]), parseFloat(stickClamp[2])];
  const opt = [parseFloat(optClamp[1]), parseFloat(optClamp[2])];
  const slider = [parseInt(sliderRange[1], 10) / 100, parseInt(sliderRange[2], 10) / 100];
  check('the stick and the option agree on the range',
    stick[0] === opt[0] && stick[1] === opt[1], `stick ${stick} vs option ${opt}`);
  check('the slider offers exactly what the stick can reach',
    slider[0] === stick[0] && slider[1] === stick[1], `slider ${slider} vs stick ${stick}`);

  // The step maths, run with the constant read out of the shipped source.
  const pct = parseFloat(/const step = 1\.0 \+ ([\d.]+) \* speedModifier;/.exec(BRANCH)[1]);
  const tick = (cur, up, speed = 1.0) => {
    const step = 1.0 + pct * speed;
    return Math.max(stick[0], Math.min(stick[1], up ? cur * step : cur / step));
  };

  // Reversibility: a geometric step up and back down is the identity, so a nudge you did not
  // mean costs nothing to take back. A percentage-of-max step does NOT have this property.
  const start = 1.0;
  check('a nudge up and back down returns to the same size',
    Math.abs(tick(tick(start, true), false) - start) < 1e-12);

  // It reaches both ends, and stops there.
  let v = start;
  for (let i = 0; i < 200; i++) v = tick(v, true);
  check('holding up reaches the maximum and clamps', v === stick[1], String(v));
  for (let i = 0; i < 400; i++) v = tick(v, false);
  check('holding down reaches the minimum and clamps', v === stick[0], String(v));

  // Full travel should be about a second at the 30ms repeat rate: fast enough to be one
  // gesture, slow enough to stop where you meant to.
  let n = 0; v = stick[0];
  while (v < stick[1] && n < 1000) { v = tick(v, true); n++; }
  check('full travel is between half a second and three seconds',
    n * 0.030 > 0.5 && n * 0.030 < 3.0, `${n} ticks = ${(n * 0.030).toFixed(2)}s`);

  // The slow modifier must actually be finer, or holding the trigger does nothing.
  check('the slow modifier takes smaller steps',
    (tick(1.0, true, 0.1) - 1.0) < (tick(1.0, true, 1.0) - 1.0) * 0.5);
}

// The grab tolerance is slop added AROUND the handle geometry. The geometry rides the gizmo's
// matrix, so it shrinks; a fixed slop does not, and a gizmo at 0.25x would keep a grab zone
// four times too wide for it — the handles stop being separable and the stick reads as having
// broken picking.
check('the gizmo grab tolerance scales with the gizmo',
  /const radius = 0\.02 \* sizeMul;/.test(VR) && /const radiusMeters = 0\.02 \* 31\.25 \* sizeMul;/.test(VR),
  'one of the two hover radii is still a fixed constant');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
