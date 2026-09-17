// Node harness for A STROKE OWNS THE CONTROLLER.
//
// While a manipulation is live -- a sculpt stroke, a grabbed mesh, a pin or bone being
// puppeteered -- the controller is describing a path through the scene, and that path sweeps
// across panels. Every such frame used to be delivered to the panel as hover and press, so
// dragging a pin past the wrist menu fired buttons and moved sliders. matt: "if the cursor
// happens to point at a panel during a manipulation, it will start firing panel events. this
// absolutely should not happen... while a stroke is in process, a trigger is down, all menus
// should not receive events, all tracing of controller paths shouldn't fire."
//
// Run: node scratchpad/strokeinput_test.mjs   (from the repo root)
//
// Defect injections:
//   SI_INJECT=nogate       hit collection stops consulting the guard
//   SI_INJECT=sculptonly   the guard forgets rig/pin gestures and watches only _vrSculpting
//   SI_INJECT=synthrelease the synthetic centre-UV release is dispatched during a stroke again
//   SI_INJECT=noscene     an off-panel press stops claiming ownership, so only tools that
//                         implement the hook are shielded (the Tweak FK hole)
//   SI_INJECT=lateband    the hand key goes back to being declared below the gate that reads it
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const inj = process.env.SI_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const swap = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error('inject ' + what + ': anchor moved');
  return src.replace(from, to);
};

let SCENE = R('src/Scene.js');
const GRAB = R('src/editing/tools/Grab.js');

if (inj === 'nogate') {
  SCENE = swap(SCENE, 'if (!_numpadOpen && !_strokeBusy) {', 'if (!_numpadOpen) {', 'nogate');
}
if (inj === 'noscene') {
  SCENE = swap(SCENE, "if (_pressed && !this._vrPressOwner[_hand]) this._vrPressOwner[_hand] = 'scene';",
    '', 'noscene');
}
if (inj === 'lateband') {
  // The real regression: someone removes the hoisted key and reaches for `_hand`, which is
  // declared far below. Static checks all pass; every XR frame throws.
  SCENE = swap(SCENE, "this._vrPressOwner?.[_handKey] === 'scene'",
    "this._vrPressOwner?.[_hand] === 'scene'", 'lateband');
  SCENE = swap(SCENE, "          const _handKey = source.targetRayMode === 'transient-pointer'\n            ? 'G'\n            : (source.handedness === 'left' ? 'L' : 'R');\n", '', 'lateband');
  SCENE = swap(SCENE, "const _hand = _handKey;   // computed above, where the gate needed it",
    "const _hand = source.targetRayMode === 'transient-pointer' ? 'G' : (source.handedness === 'left' ? 'L' : 'R');",
    'lateband');
}
if (inj === 'sculptonly') {
  SCENE = swap(SCENE,
    "    if (tool._grabbedMesh) return true;\n    return !!tool.blocksMiniHudInput?.();",
    "    return false;", 'sculptonly');
}
if (inj === 'synthrelease') {
  SCENE = swap(SCENE, 'if (!_numpadOpen && !_strokeBusy) v.panel.onVRRelease',
    'if (!_numpadOpen) v.panel.onVRRelease', 'synthrelease');
}

// ── THE GUARD KNOWS ABOUT EVERY KIND OF MANIPULATION ────────────────────────
{
  const g = SCENE.slice(SCENE.indexOf('_strokeOwnsInput() {'),
    SCENE.indexOf('_strokeOwnsInput() {') + 700);
  check('an open sculpt stroke owns the controller',
    /this\._vrSculpting/.test(g));
  check('...so does a grabbed mesh',
    /tool\._grabbedMesh/.test(g),
    'Grab acquires outside the stroke lifecycle, so _vrSculpting alone misses it');
  // The two-handed rig case is the one matt hit: a pin drag spans the interval where one hand
  // has released and the other still owns a pin, which is when a hand is most likely to swing
  // past the wrist panel.
  check('...and so does a rig/pin gesture, through the tool-side hook',
    /tool\.blocksMiniHudInput\?\.\(\)/.test(g));
  check('...which Grab answers for pins as well as meshes',
    /blocksMiniHudInput\(\)/.test(GRAB)
      && /this\._vrPinGesture \|\| this\._vrPinGrabs\.size > 0/.test(GRAB),
    'the released-one-hand interval is exactly when the other hand sweeps the panel');
}

// ── NO RAYS ARE CAST AT ALL WHILE IT IS TRUE ────────────────────────────────
{
  check('hit collection is gated on the guard',
    /const _strokeBusy = this\._strokeOwnsInput\(\)/.test(SCENE)
      && /if \(!_numpadOpen && !_strokeBusy\) \{/.test(SCENE),
    'matt asked for the rays not to fire, not merely for the events to be dropped — the hit '
      + 'test against every visible panel is the most expensive thing in the block');

  // It must be declared BEFORE the collection it gates, and before the dispatch loop that also
  // reads it. Ordering is the whole correctness argument for a per-frame guard.
  const decl = SCENE.indexOf('const _strokeBusy = this._strokeOwnsInput()');
  const coll = SCENE.indexOf('if (!_numpadOpen && !_strokeBusy) {');
  const disp = SCENE.indexOf('if (!_numpadOpen && !_strokeBusy) v.panel.onVRRelease');
  check('...and computed before both the collection and the dispatch that read it',
    decl > 0 && decl < coll && decl < disp,
    'decl@' + decl + ' collect@' + coll + ' dispatch@' + disp);
}

// ── THE GENERAL RULE: A PRESS THAT BEGAN OFF-PANEL NEVER REACHES A PANEL ────
//
// The tool-side hook only shields tools that IMPLEMENT it. Grab did; BoneDrawTool did not, and
// it has six drag states -- so Tweak FK swept the wrist menu and pressed it. matt: "if i am the
// controller at a panel during a drag, it starts affecting the menu." Enumerating tools means
// the next tool with a drag state is the next bug. Where the press BEGAN is tool-agnostic.
{
  check('a trigger closed away from every panel claims the press for the scene',
    /if \(_pressed && !this\._vrPressOwner\[_hand\]\) this\._vrPressOwner\[_hand\] = 'scene';/.test(SCENE),
    'without it, only tools with the hook are shielded and every new drag state is a new bug');
  check('...and the gate honours that claim, not just the tool hook',
    /this\._strokeOwnsInput\(\) \|\| this\._vrPressOwner\?\.\[_handKey\] === 'scene'/.test(SCENE));

  // TDZ, not syntax: `_hand` is declared ~130 lines below the gate, so reading it there is a
  // ReferenceError on every frame that node --check and the production build both pass happily.
  const gate = SCENE.indexOf("this._vrPressOwner?.[_handKey] === 'scene'");
  const key  = SCENE.indexOf('const _handKey =');
  check('...with the hand key declared above the gate that reads it',
    key > 0 && key < gate,
    'key@' + key + ' gate@' + gate + ' — a const read before its declaration throws at runtime '
      + 'and passes every static check this repo runs');
}

// ── PANELS ARE LEFT CLEAN, NOT FROZEN ───────────────────────────────────────
//
// Gating collection rather than the whole block is deliberate: with no hits, the dispatch loop
// still walks _allVisible and sends LEAVE to every panel, so one the ray was on when the stroke
// began is un-hovered rather than stuck mid-hover.
{
  check('every visible panel still receives leave while the stroke runs',
    /for \(const v of _allVisible\) \{/.test(SCENE) && /v\.panel\.onVRLeave\(source\.handedness\)/.test(SCENE),
    'gating the whole block would freeze a panel in whatever hover state it had');
  check('...but the synthetic centre-UV release is NOT dispatched',
    /if \(!_numpadOpen && !_strokeBusy\) v\.panel\.onVRRelease\(\{ x: 0\.5, y: 0\.5 \}\);/.test(SCENE),
    'that click lands on whatever element sits at the middle of the panel');
  // The flag still has to be cleared either way, or the eventual release reads as a fresh click.
  const blk = SCENE.slice(SCENE.indexOf('// Always clear the flag so the panel'),
    SCENE.indexOf('// Always clear the flag so the panel') + 800);
  check('...while the press flag is cleared regardless',
    /this\[v\.pressKey\] = false;/.test(blk));
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
