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

const REPO = new URL('..', import.meta.url).pathname;
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const OPTS = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
const VR = fs.readFileSync(path.join(REPO, 'src/editing/tools/TransformVR.js'), 'utf8');
const GIZMO = fs.readFileSync(path.join(REPO, 'src/editing/GizmoVR.js'), 'utf8');
const XFPANEL = fs.readFileSync(path.join(REPO, 'src/gui/transformPanel.js'), 'utf8');

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
// The MULTIPLICATIVE form is the invariant, not the expression that produces the number. This
// used to pin `1.0 + N * speedModifier`, so removing the off-hand speed modifier -- the correct
// change, matt: "do no speed scaling with offhand trigger" -- read as a regression here while
// the step stayed just as geometric as before.
check('the step is geometric', /const step = 1\.0 \+ [\d.]/.test(BRANCH)
  && /cur \* step : cur \/ step/.test(BRANCH),
  'a linear step does not read the same at both ends of a multiplier');
check('up is bigger', /valY < -T_PRESS \? cur \* step/.test(BRANCH),
  'the radius control has up as more; this must match or the hand is lied to');

// THE RANGE IS DEFINED ONCE, AND EVERY CONTROL REFERS TO IT.
//
// It used to live as a literal in four places — the stick's clamp, the option's validator, the
// settings slider and (once it existed) the tool-panel slider — and this block checked that the
// copies agreed. They now come from GIZMO_MUL_MIN/MAX, exported from GizmoVR next to the code
// that applies the multiplier, so the agreement is structural rather than something a test has
// to keep watching. What is still worth pinning is that nobody has quietly reintroduced a
// literal: a slider with a hardcoded `min="25"` would work today and drift the day the constant
// moves. The OPTION's validator is the one remaining copy — getOptionsURL is a leaf that must
// not import the editor — so its numbers are still read out and compared.
const defMin = /export const GIZMO_MUL_MIN = ([\d.]+);/.exec(GIZMO);
const defMax = /export const GIZMO_MUL_MAX = ([\d.]+);/.exec(GIZMO);
const optClamp = /options\.gizmoSizeMul = queryNumber\(getVal\('gizmoSizeMul'\), ([\d.]+), ([\d.]+)/.exec(OPTS);
check('the range has one definition, in GizmoVR', !!defMin && !!defMax);
check('the option validator still declares its own copy', !!optClamp);
check('the stick clamps to the shared constants',
  /Math\.max\(GIZMO_MUL_MIN, Math\.min\(GIZMO_MUL_MAX, next\)\)/.test(BRANCH),
  'a literal clamp here can reach a size the sliders cannot show');
check('the settings slider is built from the shared constants',
  /id="mm-gizmo-mul" min="\$\{Math\.round\(GIZMO_MUL_MIN\*100\)\}" max="\$\{Math\.round\(GIZMO_MUL_MAX\*100\)\}"/.test(PANEL),
  'a hardcoded min/max here is the old bug, re-entered');
// THE GIZMO'S SIZE, ON THE GIZMO'S OWN PANEL. The settings copy is filed under a preferences
// list; this one is in the Transform tool's shared section, so it is on the wrist panel and in
// the menu whenever the gizmo is the thing in your hand. matt asked for exactly that.
check('the Transform section carries a size slider', /id="xf-gizmo-mul"/.test(XFPANEL));
check('the Transform slider is built from the shared constants',
  /GIZMO_MUL_MIN, GIZMO_MUL_MAX \} from '\.\.\/editing\/GizmoVR\.js'/.test(XFPANEL)
    && /min="\$\{Math\.round\(GIZMO_MUL_MIN \* 100\)\}"/.test(XFPANEL));
check('the Transform slider writes the live value and persists it',
  /window\._gizmoSizeMul = f;/.test(XFPANEL) && /saveOption\('gizmoSizeMul', f/.test(XFPANEL));
// The thumbstick writes the same number, so the panel has to be able to follow it — a slider
// that only moves when you move it will report a size the gizmo stopped being two clicks ago.
check('the Transform slider follows the thumbstick',
  /syncTransformSection/.test(XFPANEL) && /sIn\.value = String\(Math\.round\(mul \* 100\)\)/.test(XFPANEL));

if (defMin && defMax && optClamp) {
  const stick = [parseFloat(defMin[1]), parseFloat(defMax[1])];
  const opt = [parseFloat(optClamp[1]), parseFloat(optClamp[2])];
  check('the shared constants and the option agree on the range',
    stick[0] === opt[0] && stick[1] === opt[1], `constants ${stick} vs option ${opt}`);

  // The step maths, run with the constant read out of the shipped source.
  const pct = parseFloat(/const step = 1\.0 \+ ([\d.]+)/.exec(BRANCH)[1]);
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

  // THE OFF-HAND TRIGGER NO LONGER CHANGES THE SPEED, and that is the assertion now. It used
  // to hold a 0.1x slow modifier, which had to go: that trigger is SMOOTH MODE, so holding it
  // already changes WHICH tool the stick tunes, and changing the rate as well meant one gesture
  // doing two things. matt: "do no speed scaling with offhand trigger".
  check('the off-hand trigger does not scale the stick speed',
    !/speedModifier/.test(sceneCode)
      && !/isSecondaryTriggerPressed \? 15 : 30/.test(sceneCode),
    'a second meaning on the smooth-mode trigger is how the rate got lost per tool');
}

// THE SIZE IS SOLVED FROM A CONSTANT, NOT LATCHED FROM WHATEVER ZOOM IT WOKE UP AT.
//
// The VR rule is a constant PHYSICAL size, which is right — you reach for the gizmo with your
// hand, so it must not balloon and shrink with double-grip zoom the way the world does. What was
// wrong is where the constant came from. It captured `_refWorldScale` on the gizmo's first sizing
// frame and then held k = refScale/worldScale forever, and physical size works out to
// `bake * refScale` — so the gizmo's real size was decided by the zoom you happened to be at the
// first time it drew. 12.5cm if that was the default 0.008, ten times that if you had zoomed in
// first, eighty times that if its first update ran on the desktop (worldScale 0.701 there). No
// path released the latch, so for the rest of the session you could not argue with it. matt: "the
// transform gizmo gets larger and larger... something is resetting the scale of these elements
// somewhere and i can't control it."
check('the gizmo has no latched size reference', !/_refWorldScale/.test(GIZMO.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n')),
  'a latch here inherits whatever zoom the gizmo first drew at, for the whole session');
const sizeM = /const GIZMO_SIZE_M = ([\d.]+);/.exec(GIZMO);
check('the target physical size is a declared constant', !!sizeM);
check('the VR branch solves k back from it',
  /const k = \(GIZMO_SIZE_M \* gizmoSizeMul\(\)\) \/ \(\(this\._lastScale \|\| 1\) \* worldScale\);/.test(GIZMO),
  'physical = bake * k * worldScale, so k = metres / (bake * worldScale) — anything else drifts');
if (sizeM) {
  // The default must be exactly what the old rule produced at the zoom it was calibrated for
  // (the 15.625 sculpt-space bake at _vrScale 0.008), or this "fix" silently resizes the gizmo
  // for everyone who never hit the bug.
  const bake = parseFloat(/getOptionsURL\(\)\.gizmoScale \|\| ([\d.]+)/.exec(GIZMO)[1]);
  const defaultVrScale = parseFloat(/this\._vrScale = ([\d.]+);/.exec(SCENE)[1]);
  check('the default size is unchanged at the reference zoom',
    Math.abs(parseFloat(sizeM[1]) - bake * defaultVrScale) < 1e-9,
    `${sizeM[1]}m vs bake ${bake} x vrScale ${defaultVrScale} = ${bake * defaultVrScale}m`);
}

// BOTH BRANCHES TAKE THE MULTIPLIER. It was on the VR branch only, so the settings slider and
// the thumbstick did nothing at all on the desktop — a control that exists and is inert reads as
// no control, which is half of why matt asked for one that did not exist yet.
check('the desktop branch applies the size multiplier too',
  /const km = k \* gizmoSizeMul\(\);/.test(GIZMO),
  'the desktop gizmo ignoring the slider is why it looked like there was no size control');

// The grab tolerance is slop added AROUND the handle geometry. The geometry rides the gizmo's
// matrix, so it shrinks; a fixed slop does not, and a gizmo at 0.25x would keep a grab zone
// four times too wide for it — the handles stop being separable and the stick reads as having
// broken picking.
check('the gizmo grab tolerance scales with the gizmo',
  /const radius = 0\.02 \* sizeMul;/.test(VR) && /const radiusMeters = 0\.02 \* 31\.25 \* sizeMul;/.test(VR),
  'one of the two hover radii is still a fixed constant');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
