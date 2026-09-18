// Node harness for THE iPad GESTURE -> MOUSE BRIDGE, and specifically for the one thing that
// bridge must not do: turn a camera gesture into a marking menu.
//
// matt, round-robining the devices: "if i use a 2 finger gesture to zoom the view, it pops up
// the r.click menu. can we gate that somehow?"
//
// THE GUARD WAS ALREADY THERE AND HAD NEVER ONCE FIRED. onDeviceDown arms the right-CLICK only
// for a pointer that is neither pen nor touch, and its comment names this exact scenario. But
// the touch path dispatches a SYNTHETIC event object, and that object was a bare `{}` -- so
// `pointerType` was undefined, and undefined is not 'touch'. Fingers do not lift together, so a
// two-finger zoom drops to one finger and then to none, and every transition dispatches
// MOUSE_RIGHT through that gate.
//
// So what is worth asserting is not "is there a gate" -- there was -- but that the synthetic
// event SAYS WHAT IT IS. A guard that reads a field nobody sets is decoration.
//
// Run: node scratchpad/ipadgesture_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SGL = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');

let failures = 0;
const check = (name, ok, got = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + got));
  if (!ok) failures++;
};

check('the synthetic gesture event declares itself touch',
  /this\._eventProxy = \{ pointerType: 'touch' \};/.test(SGL),
  'a bare {} leaves pointerType undefined, and the right-click gate reads exactly that field');

check('...and the right-click gate is the thing reading it',
  /button === MOUSE_RIGHT && event\.pointerType !== 'pen' && event\.pointerType !== 'touch'/.test(SGL));

// Measured in the browser against the real onDeviceDown: with pointerType undefined the press
// arms the menu, with 'touch' it does not, and a real mouse still does.
check('...so a real mouse right-click still opens the menu',
  !/event\.pointerType !== 'mouse'/.test(SGL),
  'the fix must not cost the desktop its marking menu');

// Every one of these dispatches the proxy with MOUSE_RIGHT, which is why labelling the object
// once beats adding a tap test to each of them.
check('all three MOUSE_RIGHT gesture routes go through that one object',
  (SGL.match(/evProxy\.which = MOUSE_RIGHT;/g) || []).length === 3
    && /this\.onDeviceDown\(evProxy\);/.test(SGL));

// A two-finger tap is ALREADY BOUND. Binding the menu to it -- the obvious reading of "detect a
// 2 finger tap vs a 2 finger drag" -- would silently cost the iPad its undo.
check('a two-finger tap is still undo, and three is still redo',
  /if \(peak === 2 && this\._stateManager\) \{\s*\n\s*this\.undo\(\);/.test(SGL)
    && /\} else if \(peak >= 3 && this\._stateManager\) \{\s*\n\s*this\.redo\(\);/.test(SGL),
  'the gesture that would most naturally open a context menu on iPad is taken');

// The tap test those two rely on is also what tells a zoom from a tap, and the pinch term is the
// part that matters here: a zoom keeps the finger CENTRE still while spreading the fingers, so
// duration and drift alone would read it as a tap.
check('...and a zoom is told from a tap by the pinch delta, not just drift',
  /const pinchDelta = Math\.abs\(this\._tapSeqLiftPinchDist - this\._tapSeqPeakPinchDist\);/.test(SGL)
    && /tapDrift < 40 && pinchDelta < 20/.test(SGL));

// ── SCRIBBLE NEAR THE NUMBER FIELDS ─────────────────────────────────────────────────
//
// matt: "ipad keeps scribbling lines when i drag with the pencil... it was because it was too
// close to the position input fields."
//
// touch-action DOES NOT REACH THIS, which is the trap. Scribble is a system input method, not a
// browser gesture: iPadOS offers it whenever an Apple Pencil comes near something text-editable,
// so the canvas being covered (it is, twice over) says nothing about a field sitting on top of
// it. There is no web API to refuse Scribble; a READONLY field is simply not editable, so there
// is nothing to write into and it is never offered.
{
  const HTML = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const NUMPAD = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/VRNumpad.js'), 'utf8');

  check('number fields are readonly on a touch device',
    /if \(_coarse\) i\.setAttribute\('readonly', ''\);/.test(HTML),
    'a text-editable field is the thing that invites Scribble, whatever touch-action says');
  // On these devices the field was never the editor -- tapping one opens the numpad, which
  // writes value programmatically (readonly does not block that) and dispatches change.
  // Verified in the browser: value written, change fired, the mesh moved.
  check('...gated by the SAME query the numpad uses to decide it owns editing',
    /\(hover: none\) and \(pointer: coarse\)/.test(HTML)
      && /\(hover: none\) and \(pointer: coarse\)/.test(NUMPAD),
    'two different definitions of "touch device" is a field nothing can edit');
  // Exactly one readonly stamp in the file, and it is the guarded one -- so there is no second
  // unguarded path that would reach a desktop.
  check('...and NOT on desktop, where you type into them directly',
    (HTML.match(/setAttribute\('readonly'/g) || []).length === 1
      && /let _coarse = false;/.test(HTML),
    'readonly everywhere would take away desktop typing');
  // inputmode only ever affected virtual keyboards, so it stays unconditional.
  check('...while inputmode stays unconditional',
    /i\.setAttribute\('inputmode', 'none'\);\s*\n\s*if \(_coarse\)/.test(HTML));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
