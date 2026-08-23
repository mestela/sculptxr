// Node harness for src/editing/SecondaryAction.js and its input wiring in SculptGL.js.
//
// The channel, not the pin. What can break it is state that outlives the click that armed it:
// a modifier still armed after firing, after a miss, or after a tool change is how you get a
// pin three clicks later that nobody asked for. Those are the checks.
//
// Run: node scratchpad/secondary_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/SecondaryAction.js'), 'utf8');
const GL = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
const Enums = { Tools: { TRANSFORM: 13, GRAB: 15, TRANSFORM_VR: 16, BONE_DRAW: 34, BRUSH: 0 } };
globalThis.__pinned = [];
const IKSolver = { togglePin: (main, joint) => { globalThis.__pinned.push(joint); return true; } };
const Skeleton = { hoveredJoint: (main) => main._hovered || null };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_secondary_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default SecondaryAction;\n');
const SecondaryAction = (await import(outPath + '?v=' + Date.now())).default;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A scene stub whose picking finds nothing, so the hover path is what is under test unless a
// test says otherwise.
function app(toolIndex, hovered) {
  return {
    _hovered: hovered || null,
    _secondaryArmed: false,
    getSculptManager: () => ({ getToolIndex: () => toolIndex }),
    getMeshes: () => [],
    getPicking: () => ({ intersectionMouseMeshes: () => false, getMesh: () => null }),
  };
}

// --- 1. the channel exists only where a tool has something to put in it ------------------
{
  check('Grab has a secondary action', !!SecondaryAction.of(app(15)));
  check('Transform has one', !!SecondaryAction.of(app(13)));
  check('TransformVR has one', !!SecondaryAction.of(app(16)));
  check('Bone Draw has one', !!SecondaryAction.of(app(34)));
  check('an ordinary sculpt brush does NOT', SecondaryAction.of(app(0)) === null);
  check('and the label comes from the action, not the word "Pin" in the UI',
    SecondaryAction.label(app(15)) === 'Pin');
  check('a tool with no action reports no label', SecondaryAction.label(app(0)) === null);
}

// --- 2. arming ---------------------------------------------------------------------------
{
  const a = app(15, { id: 'j' });
  check('starts disarmed', !SecondaryAction.armed(a));
  SecondaryAction.toggle(a);
  check('a tap arms it', SecondaryAction.armed(a));
  SecondaryAction.toggle(a);
  check('and a second tap disarms it again', !SecondaryAction.armed(a));

  // A tool with no secondary action must not be armable, or the button could latch a state
  // that nothing will ever consume or clear.
  const b = app(0);
  SecondaryAction.toggle(b);
  check('a tool with no action cannot be armed', !SecondaryAction.armed(b));
}

// --- 3. firing, and the state left behind -------------------------------------------------
{
  globalThis.__pinned = [];
  const a = app(15, { id: 'knee' });
  SecondaryAction.toggle(a);
  check('it fires on the hovered joint', SecondaryAction.fire(a) === true
    && globalThis.__pinned.length === 1 && globalThis.__pinned[0].id === 'knee');
  check('ONE SHOT: firing disarms it', !SecondaryAction.armed(a),
    'a modifier still armed after firing pins the next thing you click');

  // A click that found nothing has still been spent. Leaving it armed is exactly how a
  // mystery pin appears three clicks later.
  globalThis.__pinned = [];
  const b = app(15, null);
  SecondaryAction.toggle(b);
  check('a miss still disarms', SecondaryAction.fire(b) === false && !SecondaryAction.armed(b));
  check('...and pins nothing', globalThis.__pinned.length === 0);
}

// --- 4. an armed modifier must not survive a tool change ----------------------------------
//
// Armed under Grab and then switched to a brush, the state would sit there invisible (the
// button hides itself) and fire on some later return to Grab.
{
  const a = app(15, { id: 'j' });
  SecondaryAction.toggle(a);
  let idx = 15;
  a.getSculptManager = () => ({ getToolIndex: () => idx });
  idx = 0;
  check('armed does not report true once the tool has no action', !SecondaryAction.armed(a));
  check('...and the tool change is what clears it in the app',
    /_modifierButton\?\.refresh\?\.\(\)/.test(
      fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8')),
    'SculptManager.setToolIndex does not refresh the modifier');
}

// --- 5. the input wiring in SculptGL ------------------------------------------------------
{
  check('an armed LEFT click fires and is consumed',
    /SecondaryAction\.armed\(this\)\) \{[\s\S]{0,200}?SecondaryAction\.fire\(this\)[\s\S]{0,200}?Enums\.Action\.NOTHING;[\s\S]{0,120}?return;/.test(GL),
    'the armed click must not also sculpt, orbit or select');

  // A right DRAG orbits the camera and always has. Only a press that never travelled is a
  // click, and that has to be decided on release.
  check('a right press records a click candidate', /this\._rightClickX = mouseX;/.test(GL));
  check('travel cancels it', /this\._rightMoved = true;/.test(GL) && /RIGHT_CLICK_SLOP/.test(GL));
  check('and release fires only if it never travelled',
    /const wasClick = !this\._rightMoved;[\s\S]{0,200}?if \(wasClick\) \{[\s\S]{0,120}?SecondaryAction\.fire\(this\)/.test(GL));

  // ON IPAD A SECOND FINGER IS DISPATCHED AS MOUSE_RIGHT TO MEAN PAN. A pan that starts and
  // ends on the same spot would fire the secondary action if this guard were dropped.
  check('pen and touch are excluded from the right-click shorthand',
    /button === MOUSE_RIGHT && event\.pointerType !== 'pen' && event\.pointerType !== 'touch'/.test(GL),
    'an iPad pan would fire the secondary action');

  check('Escape disarms, and only consumes the key when it was armed',
    /e\.key === 'Escape' && SecondaryAction\.disarm\(this\)/.test(GL),
    'consuming Escape unconditionally would break the Bones chain');
}

// --- 6. the on-screen button keeps out from under the timeline ----------------------------
//
// The timeline is a FIXED panel pinned to the bottom of the window, and the modifier lives in
// the same corner, so with the animation panel open the button was underneath it. Watched with
// one observer rather than pushed from every show/hide/resize path — the forgotten call site is
// how a control ends up stranded somewhere that looks deliberate.
{
  const MB = fs.readFileSync(path.join(REPO, 'src/gui/ModifierButton.js'), 'utf8');
  const TL = fs.readFileSync(path.join(REPO, 'src/gui/GuiTimeline.js'), 'utf8');

  check('the timeline panel is addressable by id, not by an inline-style selector',
    /this\._container\.id = 'timeline-panel';/.test(TL) && /TIMELINE_ID = 'timeline-panel'/.test(MB));
  check('the button is offset by the timeline height',
    /el\.style\.bottom = \(this\._timelineHeight\(\) \+ GAP\)/.test(MB));
  check('a hidden timeline contributes no offset',
    /tl\.style\.display === 'none'\) return 0;/.test(MB),
    'display:none still reports a bounding box in some layouts');
  check('...and it is WATCHED, so a drag-resize moves the button too',
    /new ResizeObserver\(\(\) => this\.refresh\(\)\)/.test(MB),
    'without an observer the offset is only correct until the panel is resized');
  // Fixed, not absolute: the timeline is position:fixed against the window, so the button has
  // to measure against the same origin or the two disagree whenever the viewport is inset.
  check('the button is positioned against the same origin as the timeline',
    /position: fixed; width: 96px/.test(MB));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
