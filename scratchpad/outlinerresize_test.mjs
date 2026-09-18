// Node harness for THE DOCKED OUTLINER'S RESIZE HANDLE.
//
// matt: "on ipad and desktop, the outliner should be resizable when docked in the side bar."
//
// IT ALREADY WAS -- ON ONE OF THEM. The list carried `resize: vertical`, scoped to the sidebar,
// and the browser did the whole job. But CSS resize is a feature iOS SAFARI DOES NOT IMPLEMENT,
// so the device with the least vertical space to spare was the one device where the list could
// not be made bigger, and the same build looked correct on desktop. That is the trap worth a
// test: a feature can be present, styled and working everywhere you happen to be looking.
//
// So the drag is ours now, on pointer events -- the same three handlers for a mouse, a pen and a
// finger. Verified with a REAL drag in the browser (synthetic PointerEvents cannot test this:
// setPointerCapture throws NotFoundError for a pointerId that was never a live pointer, so the
// handler aborts and the test proves nothing). Measured: 300 -> 463px, floor holds at 52, the
// height persists and survives the rebuild.
//
// Run: node scratchpad/outlinerresize_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const MM  = read('src/gui/htmlvr/MainMenuPanel.js');
const GUI = read('src/gui/Gui.js');

let failures = 0;
const check = (name, ok, got = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + got));
  if (!ok) failures++;
};

check('the list no longer relies on CSS resize',
  !/resize: vertical/.test(MM),
  'iOS Safari does not implement it, so the iPad could never drag the list');
check('...and there is a real handle instead',
  /<div class="mm-outliner-grip"/.test(MM));

// Full width, because the native gripper is a ~7px corner and a finger is not a mouse.
check('the handle is a full-width bar, not a corner',
  /wa-tab-panel \.mm-outliner-grip \{\s*\n\s*display: block;\s*\n\s*height: \d+px;/.test(MM));
// Without this a touch-drag scrolls the sidebar instead of resizing.
check('...and it owns the touch, so a drag does not scroll the sidebar',
  /touch-action: none;/.test(MM));
// The VR panel needs its fixed height, and the rasteriser cannot paint a handle anyway.
check('...and it appears ONLY in the docked sidebar',
  /\.mm-outliner-grip \{ display: none; \}/.test(MM)
    && /wa-tab-panel \.mm-outliner-grip \{/.test(MM),
  'the VR panel keeps the fixed height it needs');

check('the drag runs on pointer events, so one path serves mouse, pen and finger',
  /grip\.addEventListener\('pointerdown'/.test(GUI)
    && /grip\.addEventListener\('pointermove'/.test(GUI)
    && /grip\.addEventListener\('pointerup', finish\)/.test(GUI));
// Without capture the resize stops the instant the pointer outruns the 11px grip.
check('...with the pointer captured, so the drag survives leaving the grip',
  /grip\.setPointerCapture\(e\.pointerId\)/.test(GUI)
    && /if \(!grip\.hasPointerCapture\(e\.pointerId\)\) return;/.test(GUI));
check('...and a cancelled pointer still ends and saves the drag',
  /grip\.addEventListener\('pointercancel', finish\)/.test(GUI),
  'an iPad system gesture can take the pointer away mid-drag');
// A floor only. A ceiling would be a cap the user is dragging against, which is the feature
// fighting them -- the same reasoning that removed max-height.
check('a drag cannot collapse the list to nothing, and is not capped at the top',
  /Math\.max\(52, Math\.round\(startH \+ \(e\.clientY - startY\)\)\)/.test(GUI)
    && /max-height: none;/.test(MM));
check('...and the height is remembered, debounced like a slider',
  /getOptionsURL\.saveOption\?\.\('outlinerHeight', h, 300\)/.test(GUI));
// The order below is load-bearing and has its own note at the call site: restoring scrollTop
// into a short list clamps it, and growing the list afterwards does not give back the clamp.
check('...and is restored BEFORE the scroll position, or the list drifts every rebuild',
  GUI.indexOf('this._applyOutlinerHeight(panelEl);') < GUI.indexOf('lists[i].scrollTop = top;'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
