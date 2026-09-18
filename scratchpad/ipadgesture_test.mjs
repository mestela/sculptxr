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

// ── THE LONG PRESS MUST ASK WHAT IS UNDER ITSELF ────────────────────────────────────
//
// matt: "if i go into pins, then pos+rot, it often then swaps to the bone closest to where i
// last clicked in the menu, rather than retaining the original selection."
//
// _resolvePinJoint reads the PRESELECTION highlight and falls back to the real selection only
// when nothing is highlighted. A mouse keeps that honest by hovering; a finger never hovers, so
// the highlight sat wherever a finger last went and the menu was built for that joint instead.
// The commands themselves were always frozen at open -- the joint was simply the wrong one
// before they were built.
//
// CLEARING ON A MISS IS THE HALF THAT MATTERS: with the stale highlight gone the fallback
// reaches the actual selection, which is the case where someone picks a joint in the outliner
// and pins it from the properties panel -- exactly what matt did.
//
// Measured: selection 254, stale highlight 250, resolved 250 (wrong). After a long press on
// empty space the highlight clears and it resolves to 254. A long press ON joint 250 claims it.
{
  const SGL2 = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');

  check('the long press picks at its OWN point before opening the menu',
    /picking\.intersectionMouseMeshes\(this\.getMeshes\(\), px, py, false, true\)/.test(SGL2),
    'includeRig, or it can never find a joint or a pin');
  check('...and writes the result as the preselection, including a MISS',
    /Skeleton\.setRigHighlight\(this, node\);/.test(SGL2)
      && /let node = null;/.test(SGL2),
    'clearing a stale highlight is what lets the real selection be used');
  check('...only for rig nodes, so an ordinary mesh does not become the pin subject',
    /if \(hit && \(hit\._isBone \|\| hit\._isPinTarget\)\) node = hit;/.test(SGL2));
  check('...before the menu is opened, not after',
    SGL2.indexOf('Skeleton.setRigHighlight(this, node);')
      < SGL2.indexOf('const opened = this.openViewportMenu?.(at.x, at.y);'));
  // A pick can throw on a half-built scene, and a menu that fails to open because the hover
  // could not be resolved is worse than a menu built on a stale hover.
  check('...and a failed pick does not stop the menu opening',
    /\} catch \(_\) \{\}\n      const opened = this\.openViewportMenu/.test(SGL2));
}

// ── THE MENU BELONGS OVER THE VIEW, NOT UNDER THE PANEL ─────────────────────────────
//
// matt: "the r.click menu often draws offscreen, under the panel. it should either draw on top
// of everything, or be aware of the right side edge, and avoid it." Both were wrong at once:
//
//   Z-ORDER -- it was 45, and the sidebar is 1050 with the topbar at 1100, so a menu near the
//   right of the view was drawn UNDERNEATH them and simply vanished.
//
//   ROOM -- it flipped against `window.innerWidth`, and the window is wider than the 3D view by
//   the whole sidebar. Measured: window 1024, viewport right edge 644. So a menu opened at 624
//   had 400px of "room" that was entirely panel.
//
// Being over the panels is the weaker of the two fixes and is only the backstop: a menu drawn ON
// the sidebar still hides whatever you were reading there, so the placement keeps it off.
{
  const VM = fs.readFileSync(path.join(REPO, 'src/gui/ViewportMenu.js'), 'utf8');

  check('the menu sits above the sidebar and the topbar',
    /position: fixed; z-index: 1250; display: none;/.test(VM),
    'sidebar is 1050 and topbar 1100; 45 put it under both');
  check('...and below the modal overlays, which should still cover it',
    !/z-index: 9999/.test(VM));
  check('...with the submenu just above its parent',
    /#\$\{SUB_ID\} \{ z-index: 1251; \}/.test(VM));

  check('placement measures the VIEWPORT, not the window',
    /_bounds\(\) \{/.test(VM)
      && /document\.getElementById\('viewport'\) \|\| document\.getElementById\('canvas'\)/.test(VM),
    'the window includes the sidebar, which is exactly the space to stay out of');
  check('...and both the root and the submenu use it',
    (VM.match(/this\._bounds\(\)/g) || []).length === 2);
  // Flip first (a menu pinned to the edge covers the joint you aimed at), then clamp -- because
  // flipping past the NEAR edge is the same bug mirrored.
  check('...flipped first, then clamped so a flip cannot push it off the other side',
    /let left = \(x \+ r\.width > b\.right\) \? x - r\.width : x;/.test(VM)
      && /left = Math\.max\(b\.left, Math\.min\(left, Math\.max\(b\.left, b\.right - r\.width\)\)\);/.test(VM));
  // A menu bigger than the viewport cannot be clamped into it; the window is the lesser evil.
  check('...and a menu too big for the viewport is not clamped into nonsense',
    /Math\.max\(b\.left, b\.right - r\.width\)/.test(VM));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
