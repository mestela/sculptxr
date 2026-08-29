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


// ── THE TWO SIDE PANELS OPEN EITHER SIDE OF THE MENU ────────────────────────
//
// The layer palette has always offset itself along camera-right so it sits BESIDE the main
// menu. The timeline opened at the menu's exact world position, so the two overlapped and you
// could not tell which one you were looking at — matt: "it appears over where the mainpanel,
// confusing." They now go opposite ways, so opening both puts one either side.
{
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  const cut = (from) => {
    const a = SC.indexOf(from);
    // Wide enough to reach the placement block. The timeline opener builds a resize handle
    // first, so its placement sits ~5.2k characters in — measure rather than guess, as a slice
    // that stops short makes a passing rule look like a missing one.
    return a < 0 ? '' : SC.slice(a, a + 6000);
  };
  const blend = cut('  _openVRBlendshapes() {');
  const timeline = cut('  _openVRTimeline() {');
  // PLACED BY EDGES, NOT HALF-WIDTHS. Adding half-widths assumes a centred pivot, a truthful
  // `geometry.parameters.width` and no applied scale. One of those was wrong, the panels still
  // overlapped, and the arithmetic still read as correct — so the rule is now to MEASURE.
  check('the layer palette clears the menu’s RIGHT edge',
    /\(menuExt\.max \+ 0\.02\) - bsExt\.min/.test(blend));
  check('...and the timeline clears the menu’s LEFT edge, the other way',
    /\(menuExt\.min - GAP\) - tlExt\.max/.test(timeline),
    'both to the same side is the same overlap problem one step along');
  check('...from corners transformed into world space, so pivot and scale cannot lie',
    /c\.applyMatrix4\(mesh\.matrixWorld\);/.test(SC) && /_extentAlong\(mesh, axis\)/.test(SC),
    'geometry.parameters.width is the number that was believed and was not the drawn width');
  check('...with the panel FACED before it is measured',
    /this\._vrTimelineMesh\.quaternion\.copy\(cam\.quaternion\);\s*\n\s*const menuExt/.test(timeline),
    'measuring along camera-right before the panel faces the camera measures the wrong extent');
  check('...and a half-width fallback when a box cannot be measured at all',
    (SC.match(/mm\.geometry\?\.parameters\?\.width \?\? 0\.30\) \* 0\.5/g) || []).length === 2,
    'a panel whose geometry has not been built yet must not land on the menu');
  check('...along CAMERA-right, so "left of the menu" means left from where you stand',
    (SC.match(/new THREE\.Vector3\(1, 0, 0\)\.applyQuaternion\(cam\.quaternion\)/g) || []).length >= 2,
    'the menu’s own right rotates with it; the user’s does not');
  // Landing on the menu's position is fine — it is the STARTING point, and the slide that
  // follows is what matters. The first version of this check asserted the copy was absent,
  // which the fix legitimately still does.
  check('the timeline starts at the menu and is then slid clear of it',
    /this\._vrTimelineMesh\.position\.copy\(pos\);[\s\S]{0,600}?this\._vrTimelineMesh\.position\.addScaledVector\(/.test(timeline),
    'copying the menu position and stopping there is the bug: two panels, one place');
}


// ── THE RESIZE GRIP IS A CHILD, NOT A SIBLING ───────────────────────────────
//
// It flickered. The close button beside it, which is a child of the panel, does not — matt:
// "the corner grip/resize indicator in the lower right frequently hides/unhides." The exact
// trigger was never isolated, so this is structural: as a child it inherits transform and
// visibility and cannot disagree with the panel about either.
{
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('the grip is parented to the panel, like the close button',
    /if \(h\.parent !== tl\) tl\.add\(h\);/.test(SC));
  check('...and is NOT added to the scene as a sibling',
    !/this\._scene\.add\(this\._vrResizeHandle\)/.test(SC),
    'a sibling needs its world transform rewritten every frame, one frame behind the cull');
  check('...placed in the panel’s own space',
    /h\.position\.set\(hw - 0\.014, -hh \+ 0\.014, 0\.002\);/.test(SC)
      && /h\.quaternion\.identity\(\);/.test(SC));
  check('...re-placed when the geometry changes, not every frame',
    (SC.match(/_layoutTimelineResizeHandle\(\)/g) || []).length === 3,
    'definition + open + resize; a per-frame placement is what this replaced');
  check('...and never shown or hidden per frame any more',
    !/this\._vrResizeHandle\.visible = true;/.test(SC),
    'a visibility flag written every frame is a visibility flag that can flicker');
  check('the hit test requires the PANEL to be visible too',
    /this\._vrResizeHandle\?\.visible && this\._vrTimelineMesh\?\.visible/.test(SC),
    'a child keeps its own flag true while a hidden parent stops it drawing — otherwise an '
      + 'invisible grip stays hittable');
}


// ── A RESIZE OWNS THE TRIGGER ───────────────────────────────────────────────
//
// Dragging the corner grip outward grows the panel INTO the ray doing the dragging, so the
// timeline starts receiving pointer-downs from the same held trigger and opens a marquee behind
// the resize. matt: "while resizing larger it often draws the marquee select region."
{
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('a live resize suppresses timeline pointer dispatch',
    /if \(this\._vtlZoomActive \|\| this\._vtlResizeActive\) \{\s*\n\s*this\._vtlWasPressed = _pressed;/.test(SC),
    'the trigger is already committed to the grip; nothing else may read it until release');
  check('...while KEEPING the press latch in sync',
    /this\._vtlResizeActive\) \{\s*\n\s*this\._vtlWasPressed = _pressed;/.test(SC),
    'a dropped latch makes the release read as a fresh press the moment the resize ends');
  check('...and the off-panel edge-drag latch is suppressed too',
    /!this\._vtlDragActive && !this\._vtlResizeActive\)/.test(SC),
    'the ray leaves the panel constantly while resizing — that path would feed it moves');
  check('the zoom gesture was already doing this, which is the pattern followed',
    /this\._vtlZoomActive \|\| this\._vtlResizeActive/.test(SC));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
