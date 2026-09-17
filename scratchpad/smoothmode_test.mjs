// Node harness for SMOOTH MODE IS A LATCH, NOT A PREDICATE.
//
// Holding the off-hand trigger retargets the thumbstick, the wrist panel and the brush cursor at
// the Smooth tool. The first two attempts at this were a FUNCTION each consumer called when it
// needed an answer -- and they run at four different points in one frame, over state that mutates
// during that frame:
//
//   - `_toolIndex` is swapped to Smooth by the stroke dispatch and restored at the end of it, so
//     anything asking mid-dispatch read the SELECTED tool as Smooth. The Paint exclusion missed,
//     which is why painting sometimes showed Smooth's radius.
//   - `_isPointingAtMenu` is cleared at the top of the frame and recomputed ~1400 lines later, so
//     the same question had two answers depending on who asked.
//
// matt, on the result: "its a mess." These checks are about the SHAPE that fixed it -- one
// decision point, read everywhere -- because that is what a later refactor will quietly undo.
//
// Run: node scratchpad/smoothmode_test.mjs   (from the repo root)
//
// Defect injections:
//   SM_INJECT=rederive     a consumer goes back to asking getCurrentTool() for itself
//   SM_INJECT=latelatch    the latch is computed after the dispatch instead of before it
//   SM_INJECT=radiuscopy   the override block copies the brush radius onto Smooth again
//   SM_INJECT=panelchurn   the wrist panel keys its extras block on the live manager again
//   SM_INJECT=bothtrig     smooth mode demands the dominant trigger too
//   SM_INJECT=strokeradius the stroke's radius is read from the selected tool again
//   SM_INJECT=sliderwrite  the wrist panel's sliders write to the selected tool again
//   SM_INJECT=rederivemode the dispatch works the mode out for itself instead of reading it
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const inj = process.env.SM_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let SCENE = R('src/Scene.js');
let SCENE_UNUSED_GUARD = 0;
let MINI  = R('src/gui/htmlvr/MiniPanel.js');

const swap = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error('inject ' + what + ': anchor moved');
  return src.replace(from, to);
};

if (inj === 'rederive') {
  SCENE = swap(SCENE, 'const smoothTool = this._smoothMode?.tool || null;',
    'const smoothTool = this._sculptManager.getCurrentTool();', 'rederive');
}
if (inj === 'latelatch') {
  // Move the decision after the dispatch by removing it from the per-frame input block.
  SCENE = swap(SCENE, '    this._updateSmoothModeLatch();\n', '', 'latelatch');
}
if (inj === 'radiuscopy') {
  SCENE = swap(SCENE, '        this._sculptManager._toolIndex = smoothToolIndex;',
    '        this._sculptManager._tools[smoothToolIndex]._radius = this._sculptManager.getCurrentTool()._radius;\n'
    + '        this._sculptManager._toolIndex = smoothToolIndex;', 'radiuscopy');
}
if (inj === 'panelchurn') {
  MINI = swap(MINI, 'const idx      = main.selectedToolIndex?.() ?? sm?.getToolIndex?.() ?? 0;',
    'const idx      = sm?.getToolIndex?.() ?? 0;', 'panelchurn');
}
if (inj === 'bothtrig') {
  SCENE = swap(SCENE, "    const offHand = (this._dominantHand || 'right') === 'left' ? 'right' : 'left';",
    "    let domDown = false;\n"
    + "    for (const src of this._xrSession.inputSources) {\n"
    + "      if (src.handedness === this._dominantHand && this._isTriggerDown(src)) domDown = true;\n"
    + "    }\n"
    + "    if (!domDown) return;\n"
    + "    const offHand = (this._dominantHand || 'right') === 'left' ? 'right' : 'left';", 'bothtrig');
}

// ── ONE DECISION POINT ───────────────────────────────────────────────────────
{
  const calls = (SCENE.match(/this\._updateSmoothModeLatch\(\)/g) || []).length;
  check('smooth mode is decided exactly once per frame',
    calls === 1,
    'found ' + calls + ' call sites — two decisions in one frame is the bug this replaced');

  // It has to run BEFORE the thing that mutates what it reads. The dispatch's temporary swap is
  // `_toolIndex = smoothToolIndex`, and the cursor block reads the result afterwards.
  const atLatch    = SCENE.indexOf('this._updateSmoothModeLatch()');
  const atSwap     = SCENE.indexOf('this._sculptManager._toolIndex = smoothToolIndex;');
  const atCursor   = SCENE.indexOf('const tool = this.effectiveTool?.()');
  check('...before the dispatch swaps _toolIndex out from under it',
    atLatch > 0 && atSwap > 0 && atLatch < atSwap,
    'latch@' + atLatch + ' swap@' + atSwap
      + ' — computed after the swap, the latch records Smooth as the SELECTED tool');
  check('...and before the cursor reads it',
    atLatch > 0 && atCursor > 0 && atLatch < atCursor);
}

// ── CONSUMERS READ THE LATCH, THEY DO NOT RE-DERIVE ─────────────────────────
{
  // The two thumbstick handlers are the ones that went wrong. Both must resolve through
  // `_smoothMode`, never by asking the manager which tool is current.
  const stickBlk = SCENE.slice(SCENE.indexOf('// INTENSITY CONTROL (X-Axis)') - 3000,
    SCENE.indexOf('// INTENSITY CONTROL (X-Axis)') + 1200);
  const reads = (stickBlk.match(/this\._smoothMode\?\.tool/g) || []).length;
  check('both thumbstick axes resolve their target through the latch',
    reads === 2,
    'found ' + reads + ' of 2 — radius and intensity must agree about which tool they write to');

  check('the wrist panel asks Scene, not the manager, which tool to show',
    /main\.effectiveTool\?\.\(\)/.test(MINI) && /main\.effectiveToolIndex\?\.\(\)/.test(MINI));

  // THE ONE THAT CAUSED THE PAINT SYMPTOM. The extras block is keyed on what the user PICKED;
  // keyed on the live manager, a sync landing mid-stroke sees Smooth and rebuilds against it.
  check('...and keys its tool-specific block on the selected tool, not the live one',
    /const idx\s+= main\.selectedToolIndex\?\.\(\)/.test(MINI),
    'getToolIndex() is swapped mid-stroke; selectedToolIndex is captured before that');
}

if (inj === 'strokeradius') {
  SCENE = swap(SCENE, '      const tool = this.effectiveTool();\n      if (tool && tool._radius !== undefined) {',
    '      const tool = this._sculptManager.getCurrentTool();\n      if (tool && tool._radius !== undefined) {',
    'strokeradius');
}
if (inj === 'sliderwrite') {
  SCENE_UNUSED_GUARD = 0; // eslint hint: this injection edits MiniPanel, not Scene
  MINI = swap(MINI, "const t   = main.effectiveTool?.() ?? sm?.getCurrentTool?.();",
    "const t   = sm?.getCurrentTool?.();", 'sliderwrite');
}
if (inj === 'rederivemode') {
  SCENE = swap(SCENE, '    if (_domPressed && this._smoothMode) {',
    '    if (_domPressed && !this._isPointingAtMenu && !this._wasPointingAtMenu && this._smoothMode) {',
    'rederivemode');
}

// ── THE STROKE USES THE TOOL IT IS ABOUT TO RUN ─────────────────────────────
//
// The cursor, the two sliders and the stroke are four readouts of one number, and for a while
// three of them agreed and the fourth did not: processVRSculpting computes the picking radius
// ~450 lines ABOVE the tool swap, so it read the selected tool and smoothed with the clay
// brush's footprint. matt: "the sphere radius indicator is matching my settings, the sliders
// match, but if i actually try a smooth, its clearly using the original brush radius."
{
  const radBlk = SCENE.slice(SCENE.indexOf('// 3. Picking (Engine Space Units)'),
    SCENE.indexOf('const physicalRadius = sliderVal * 0.1;'));
  check('the stroke sizes itself from the tool that will run',
    /const tool = this\.effectiveTool\(\);/.test(radBlk),
    'read from getCurrentTool(), a smooth runs with the clay brush radius — and this value is '
      + 'the PICK radius as well, so it is the whole feel of the stroke');

  // Both the cursor and the stroke have to ask the same question, or they drift apart again.
  check('...and the cursor sizes itself the same way',
    /const tool = this\.effectiveTool\?\.\(\)/.test(SCENE));
}

// ── A CONTROL WRITES WHERE IT READS ─────────────────────────────────────────
//
// The wrist panel displayed effectiveTool()'s radius and wrote getCurrentTool()'s, so dragging
// a slider in smooth mode moved the clay brush and the next sync put the old value back.
// matt: "as soon as i stop adjusting the sliders, they reset to what they were before."
{
  const sliders = MINI.slice(MINI.indexOf('// ── Radius slider'),
    MINI.indexOf('// ── Toggle helpers'));
  const writes = (sliders.match(/main\.effectiveTool\?\.\(\)/g) || []).length;
  const keys   = (sliders.match(/main\.effectiveToolIndex\?\.\(\)/g) || []).length;
  check('both wrist-panel sliders write to the tool the panel is showing',
    writes === 2, 'found ' + writes + ' of 2');
  check('...and save under that tool\'s key, not the selected one\'s',
    keys === 2, 'found ' + keys + ' of 2 — otherwise Smooth\'s radius is filed as the brush\'s');
}

// ── SMOOTH OWNS ITS OWN RADIUS ──────────────────────────────────────────────
{
  const ovr = SCENE.slice(SCENE.indexOf('if (isSmoothOverride) {'),
    SCENE.indexOf('// Check if tool allows air'));
  check('the override does not assign Smooth a radius',
    !/_tools\[smoothToolIndex\]\._radius\s*=/.test(ovr) && !/getCurrentTool\(\)\._radius\s*=/.test(ovr),
    'a value the user can dial in cannot also be one the dispatch assigns — it fired on the '
      + 'trigger pull and overwrote the number just chosen');
  check('...it only swaps the index',
    /this\._sculptManager\._toolIndex = smoothToolIndex;/.test(ovr));
}

// ── THE TWO RULES ARE DIFFERENT ON PURPOSE ──────────────────────────────────
{
  const latch = SCENE.slice(SCENE.indexOf('_updateSmoothModeLatch() {'),
    SCENE.indexOf('  effectiveToolIndex()'));
  // The MODE is the off-hand trigger alone: gating it on both meant the stick only retargeted
  // once you were already mid-stroke, which is never, because that is not when you adjust.
  check('the mode itself asks only for the off-hand trigger',
    /_vrSecondaryTriggerPressed/.test(latch) && !/_isTriggerDown/.test(latch),
    'gated on both triggers, the stick retargets only mid-stroke — which is too late to be of use');
  // The STROKE still needs both. Separate rule, separate place, and it must stay that way or a
  // lone left pinch starts smoothing on hands.
  check('...while the stroke dispatch still requires both',
    /_domPressed\s*&&/.test(SCENE) && /!NO_SMOOTH_OVERRIDE\.has\(activeTool\.constructor\.name\)/.test(SCENE),
    'a modifier qualifies an action rather than being one');
  // Comments stripped: this block EXPLAINS the _isPointingAtMenu mistake at length, and an
  // assertion that trips over the note describing the bug it guards is worse than no assertion.
  const latchCode = latch.replace(/^\s*\/\/.*$/gm, '');
  check('...and the panel guard is per-hand, not the scene-wide flag',
    /this\._panelGrabIntent\(offHand\)/.test(latchCode) && !/_isPointingAtMenu/.test(latchCode),
    'the DOMINANT hand aiming at the wrist panel has nothing to do with what the off-hand '
      + 'trigger means');
}

// ── THE STROKE READS THE MODE, IT DOES NOT WORK IT OUT AGAIN ────────────────
//
// Two sources of truth for one mode is the original bug in its most durable form: the UI said
// smooth and the stroke said clay, because the dispatch re-scanned the inputs and re-applied the
// scene-wide `_isPointingAtMenu` guard for itself.
{
  const disp = SCENE.slice(SCENE.indexOf('let _domPressed = false;'),
    SCENE.indexOf('if (isSmoothOverride) {'));
  const dispCode = disp.replace(/^\s*\/\/.*$/gm, '');
  check('the stroke adds one condition to the latch and nothing else',
    /_domPressed && this\._smoothMode/.test(dispCode),
    'the dominant trigger is the only thing the stroke knows that the mode does not');
  check('...and does not re-apply the scene-wide menu flag',
    !/_isPointingAtMenu|_wasPointingAtMenu/.test(dispCode),
    'that flag has no handedness in it; aiming the DOMINANT controller at a panel would kill '
      + 'the stroke while the panel carried on showing Smooth');
}

// ── THE LATCH CANNOT OUTLIVE THE SESSION ────────────────────────────────────
{
  const end = SCENE.slice(SCENE.indexOf('onXREnd() {'), SCENE.indexOf('onXREnd() {') + 900);
  check('the latch is cleared when the headset comes off',
    /this\._smoothMode = null;/.test(end),
    'it is only refreshed in the XR loop, so a stale one answers every desktop read');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
