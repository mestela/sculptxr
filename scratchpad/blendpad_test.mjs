// Node harness for the BLENDSHAPE KAOSPAD — roadmap #11.
//
// matt: "a xy controller in space, (or xyz cube in vr), blendshapes get mapped to the corners,
// making it easy to control 4 blendshapes at once with a single gesture/controller." He picked
// BIPOLAR AXES over bilinear corners for the desktop test.
//
// THE ONE PROPERTY THAT DEFINES THE MODEL IS THAT THE CENTRE IS NEUTRAL. Bilinear corner weights
// sum to 1 everywhere, so the middle of the pad is all four shapes at 25% and there is no rest
// pose to return to — fine for four mutually exclusive alternatives, wrong for a face where
// brow-up plus smile is a real pose and neutral has to be reachable. Nearly every check below is
// some restatement of that.
//
// The weights are arithmetic, so they are RUN. The drawing is not tested; the assignment and
// preview plumbing are checked as text.
//
// Run: node scratchpad/blendpad_test.mjs
//   BP_INJECT=bilinear      the bipolar model is swapped for the corner one, so the centre stops
//                           being neutral and every rest pose gains a quarter of four shapes
//   BP_INJECT=nosum         a shape on two slots is assigned rather than accumulated, so
//                           whichever slot runs last silently wins
//   BP_INJECT=noclamp       accumulated weight is not clamped, so a shape on two slots can reach
//                           2 and the mesh doubles the delta
//   BP_INJECT=keysonmove    the pad writes keys instead of driving the preview layer, burying the
//                           track under every experimental waggle
//   BP_INJECT=nostale       a slot emptied mid-drag is left at its last previewed value with
//                           nothing driving it
//   BP_INJECT=previewsplit  otherLayersOffset stops seeing previews, so a sculpt made while the
//                           pad is up bakes the previewed weight into the captured delta
//   BP_INJECT=fallthrough   the capture dispatch loses its BS/SR arms, so BS and SR takes fall
//                           through to the TRANSFORM writer — the original bug: playhead runs,
//                           no weight keys, and stray transform keys instead
//   BP_INJECT=recordall     every shape is recorded rather than the performed set, so shapes you
//                           never touched are flattened by the act of recording something else
//   BP_INJECT=previewsticks the preview is not cleared when a take ends, so it masks the keys
//                           just recorded and playback shows a frozen face
//   BP_INJECT=noquant       capture times are not snapped to the frame grid, so keys land
//                           between frames and the dopesheet disagrees with the take
//   BP_INJECT=notangentshift a key insert/remove does not renumber the tangent overrides, which
//                           silently re-points them at the wrong keys
//   BP_INJECT=holdonplay    a preview left set is NOT released when playback starts, so the pad
//                           silently masks the recorded animation for its four shapes
//   BP_INJECT=releaseonrec  the release fires during RECORDING too, erasing the performance as
//                           it is being captured
//   BP_INJECT=sliderblind   the stack panel's sliders read the curve instead of the previewed
//                           weight, so they disagree with the mesh in front of them
//   BP_INJECT=nounkeyed     a never-keyed shape cannot be previewed, which is every shape the
//                           first time you reach for it
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let PAD = fs.readFileSync(path.join(REPO, 'src/gui/BlendshapePad.js'), 'utf8');
let REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
let STACK = fs.readFileSync(path.join(REPO, 'src/gui/BlendshapeStackPanel.js'), 'utf8');

const inject = process.env.BP_INJECT || '';
const cut = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error('inject ' + name + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'bilinear') {
  PAD = cut(PAD, '  if (bilinear) {', '  if (true) {', inject);
} else if (inject === 'nosum') {
  PAD = cut(PAD, '    out[name] = Math.min(1, (out[name] || 0) + SLOT_AXIS[s](x, y));',
    '    out[name] = SLOT_AXIS[s](x, y);', inject);
} else if (inject === 'noclamp') {
  PAD = cut(PAD, '    out[name] = Math.min(1, (out[name] || 0) + SLOT_AXIS[s](x, y));',
    '    out[name] = (out[name] || 0) + SLOT_AXIS[s](x, y);', inject);
} else if (inject === 'keysonmove') {
  PAD = cut(PAD, '      changed = reg.setBlendshapePreview(mesh, name, w[name]) || changed;',
    '      changed = reg.setBlendshapeWeight(mesh, name, w[name]) || changed;', inject);
} else if (inject === 'nostale') {
  PAD = cut(PAD, '      if (n && !(n in w)) changed = reg.setBlendshapePreview(mesh, n, 0) || changed;',
    '      if (false) changed = false;', inject);
} else if (inject === 'previewsplit') {
  REG = cut(REG, '      const previewingO = track.blendshapePreview && track.blendshapePreview.has(name);',
    '      const previewingO = false;', inject);
  REG = cut(REG, '      const weight = this.blendshapePreviewAt(track, name, bTrack);\n      if (weight === 0) return;',
    '      const weight = this.evaluateScalarTrack(bTrack, track.playbackTime);\n      if (weight === 0) return;', inject + '2');
} else if (inject === 'sliderblind') {
  STACK = cut(STACK, '    if (reg && reg.blendshapePreviewAt) return reg.blendshapePreviewAt(track, name, bTrack);',
    '    if (false) return 0;', inject);
} else if (inject === 'fallthrough') {
  REG = cut(REG, "    if (_mode === 'shaperep') return;", '', inject);
  REG = cut(REG, "    if (_mode === 'blendshape') {\n      this._captureBlendshapeKeys(elapsed);",
    '    if (false) {\n      this._captureBlendshapeKeys(elapsed);', inject + '2');
} else if (inject === 'recordall') {
  REG = cut(REG, '    return p && p.size ? [...p.keys()] : [];',
    '    return [...(track.blendshapes ? track.blendshapes.keys() : [])];', inject);
} else if (inject === 'previewsticks') {
  REG = cut(REG, '        recTrack.blendshapePreview.clear();', '        void 0;', inject);
} else if (inject === 'noquant') {
  REG = cut(REG, '    const fps = window._animFPS || 24;\n    t = Math.round(t * fps) / fps;',
    '    const fps = window._animFPS || 24; void fps;', inject);
} else if (inject === 'notangentshift') {
  REG = cut(REG, '        shiftTangentOffsets(bt, lo, +1);', '        void lo;', inject);
} else if (inject === 'holdonplay') {
  REG = cut(REG, "    if (window._animPlaying && !this.isRecording\n        && track.blendshapePreview && track.blendshapePreview.size) {",
    '    if (false) {', inject);
} else if (inject === 'releaseonrec') {
  REG = cut(REG, "    if (window._animPlaying && !this.isRecording\n        && track.blendshapePreview && track.blendshapePreview.size) {",
    '    if (window._animPlaying\n        && track.blendshapePreview && track.blendshapePreview.size) {', inject);
} else if (inject === 'nounkeyed') {
  REG = cut(REG, '      const previewing = track.blendshapePreview && track.blendshapePreview.has(name);',
    '      const previewing = false;', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) { console.log('  ok   ' + n); return; }
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Lift the exported weight function. It is pure by design precisely so this can happen.
const src = PAD.slice(PAD.indexOf('const SLOTS ='), PAD.indexOf('class BlendshapePad'));
const weightsFor = new Function(src.replace('export function', 'function')
  + '\nreturn weightsFor;')();

const A = { right: 'R', left: 'L', up: 'U', down: 'D' };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const at = (x, y) => weightsFor(x, y, A, false);
const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);

// ── THE CENTRE IS NEUTRAL ─────────────────────────────────────────────────────────────
// The property the whole model exists for. A face rig has to be able to get back to no
// expression, and the bilinear alternative cannot express that at all.
{
  const c = at(0, 0);
  check('the centre of the pad is NEUTRAL — every weight zero',
    sum(c) === 0,
    'got ' + JSON.stringify(c) + '. Bilinear corner weights sum to 1 everywhere, so the middle '
      + 'would be all four shapes at 25% and there would be no rest pose to return to');
}

// ── EACH AXIS IS BIPOLAR AND INDEPENDENT ──────────────────────────────────────────────
{
  const r = at(1, 0);
  check('full right is the right shape alone, at 1',
    near(r.R, 1) && !r.L && !r.U && !r.D, JSON.stringify(r));
  const l = at(-1, 0);
  check('...and full left is its opposite, with the right shape off',
    near(l.L, 1) && !l.R, JSON.stringify(l));
  const u = at(0, 1);
  check('...and the Y axis is the same story, independently',
    near(u.U, 1) && !u.D && !u.R && !u.L, JSON.stringify(u));

  // The diagonal is what makes the pad worth having: two shapes ADDITIVELY, not a blend of two.
  const d = at(1, 1);
  check('a corner gives BOTH its shapes at full — additive, not a 50/50 blend',
    near(d.R, 1) && near(d.U, 1),
    'got ' + JSON.stringify(d) + '. Bilinear would give 1.0 to a single corner shape and 0 to '
      + 'the rest, which cannot express "brow up AND smile"');
  check('...and the two axes do not interfere', near(at(0.5, 0).R, 0.5)
    && near(at(0.5, 0.25).R, 0.5) && near(at(0.5, 0.25).U, 0.25),
    JSON.stringify(at(0.5, 0.25)));
}

// ── PARTIAL VALUES TRACK THE HANDLE LINEARLY ──────────────────────────────────────────
check('a half-deflected axis gives half weight', near(at(0.5, 0).R, 0.5) && near(at(-0.25, 0).L, 0.25));
check('...and the opposing shape stays at zero rather than going negative',
  at(0.5, 0).L === undefined || at(0.5, 0).L === 0, JSON.stringify(at(0.5, 0)));

// ── ONE SHAPE ON TWO SLOTS ────────────────────────────────────────────────────────────
// A legitimate setup — the same shape on up and down makes a fold-in-half control — and the
// place a naive implementation silently loses a value.
{
  const both = { right: 'S', left: 'S', up: null, down: null };
  const w = weightsFor(1, 0, both, false);
  check('a shape assigned to two slots ACCUMULATES rather than being overwritten',
    near(w.S, 1), JSON.stringify(w) + ' — a plain assignment lets whichever slot ran last win');
  // Both slots at once cannot exceed 1, or the mesh applies more than the whole delta.
  const w2 = weightsFor(0, 0, { right: 'S', left: 'S', up: 'S', down: 'S' }, false);
  check('...and stays at neutral when nothing is deflected', sum(w2) === 0);
  const w3 = weightsFor(0.8, 0.8, { right: 'S', left: null, up: 'S', down: null }, false);
  check('...and is CLAMPED to 1 when two slots drive it together',
    near(w3.S, 1), 'got ' + w3.S + ' — past 1 the mesh applies more than the whole delta');
}

// ── EMPTY SLOTS ───────────────────────────────────────────────────────────────────────
{
  const w = weightsFor(1, 1, { right: 'R', left: null, up: null, down: null }, false);
  check('an unassigned slot contributes nothing rather than throwing',
    near(w.R, 1) && Object.keys(w).length === 1, JSON.stringify(w));
}

// ── THE BILINEAR COMPARISON, kept honest ──────────────────────────────────────────────
// The flag exists because "axes feel better than corners" is a prediction about feel, and matt is
// the one who can check it. Assert the alternative really is the alternative.
{
  const c = weightsFor(0, 0, A, true);
  check('the bilinear flag really does switch models — its centre is NOT neutral',
    near(sum(c), 1) && sum(c) > 0,
    'if this sums to 0 the flag is doing nothing and the A/B is fake');
  check('...and its weights sum to 1 everywhere, which is what makes it a blend space',
    near(sum(weightsFor(0.3, -0.7, A, true)), 1));
}

// ── THE PREVIEW LAYER, as text ────────────────────────────────────────────────────────
// NOTHING HERE MAY WRITE A KEY. setBlendshapeWeight keys at the quantised playhead, so a pad
// driving it would lay down a key per pointermove — burying the track and leaving no way to try a
// pose and change your mind.
check('dragging drives the PREVIEW layer, never setBlendshapeWeight',
  /reg\.setBlendshapePreview\(mesh, name, w\[name\]\)/.test(PAD)
    && !/_push\(\)[\s\S]{0,900}?setBlendshapeWeight/.test(PAD),
  'a pad that keys as it moves buries the track under every experimental waggle');
check('...and committing is a separate, explicit act that writes ordinary keys',
  /commitBlendshapePreview\(mesh\)/.test(PAD) && /for \(const \[name, value\] of pairs\) this\.setBlendshapeWeight/.test(REG));
check('...recompositing ONCE for all four, not once per shape',
  /if \(changed\) reg\.applyBlendshapes\(mesh\);/.test(PAD),
  'each apply is a full vertex pass plus a geometry update; four per pointermove is the '
    + 'difference between tracking your hand and lagging behind it');
check('a slot emptied mid-drag is driven back to zero rather than left stuck',
  /if \(n && !\(n in w\)\) changed = reg\.setBlendshapePreview\(mesh, n, 0\)/.test(PAD));
check('Reset clears the override as well as centring the handle',
  /reg\.clearBlendshapePreview\(mesh\)/.test(PAD),
  'centring alone leaves a zero override sitting on an animated curve, which reads as the '
    + 'animation having broken');

// THE TWO SITES MUST AGREE. applyBlendshapes ADDS the other layers into what you see;
// otherLayersOffset SUBTRACTS them back out so a sculpt captures only the layer being edited.
// If one honours previews and the other does not, the difference is silently baked into the delta.
check('applyBlendshapes and otherLayersOffset read the SAME weight, previews included',
  (REG.match(/this\.blendshapePreviewAt\(track, name, bTrack\)/g) || []).length === 2,
  'found ' + (REG.match(/this\.blendshapePreviewAt\(track, name, bTrack\)/g) || []).length
    + ' — a sculpt made while the pad is up would otherwise absorb the previewed weight');
check('...and a never-keyed shape can still be previewed',
  /if \(\(!bTrack \|\| bTrack\.times\.length === 0\) && !previewing\) return;/.test(REG)
    && /const previewing = track\.blendshapePreview && track\.blendshapePreview\.has\(name\);/.test(REG),
  'the unkeyed early-out is right for playback and wrong for a preview — it is every shape the '
    + 'first time you reach for it');

// THE THIRD READER. applyBlendshapes and otherLayersOffset are the other two; the stack panel's
// sliders are the third, and reading the curve directly made them the odd one out the moment a
// weight could be driven without being keyed. Caught in the browser, not here: the pad held D at
// 0.6 and the slider still read 1.00, the last committed key. A slider that disagrees with the
// mesh is worse than no slider, because it is the thing you check to find out what is going on.
check('the stack panel sliders show the PREVIEWED weight, not the underlying curve',
  /return reg\.blendshapePreviewAt\(track, name, bTrack\);/.test(STACK),
  'the pad drives the mesh through the preview layer; a slider reading the curve shows the last '
    + 'committed key instead and the two disagree on screen');

// ── RECORDING ─────────────────────────────────────────────────────────────────────────
// matt: "the record mode should respect the XF/SH/BS/SR modes, and only record keys for the
// states that are active." It did not. captureTick had ONE early-out, for 'shape', and every
// other mode FELL THROUGH to the transform writer — so a BS take recorded the mesh's matrix and
// not one weight, and an SR take wrote transform keys over a frame-replacement performance.
// Neither is a mode anyone selected; both were the absence of a branch reading as a decision.
check('the capture dispatch names every mode rather than falling through',
  /if \(_mode === 'shape' \|\| _mode === 0\) return;/.test(REG)
    && /if \(_mode === 'shaperep'\) return;/.test(REG)
    && /if \(_mode === 'blendshape'\) \{\s*\n\s*this\._captureBlendshapeKeys\(elapsed\);/.test(REG),
  'a fall-through default is what caused this, so every mode has to name itself');
check('...and blendshape capture writes WEIGHT keys, not the mesh matrix',
  /_captureBlendshapeKeys\(t\) \{/.test(REG) && /bt\.values\.splice\(lo, 0, v\);/.test(REG));
check('...inserted in time order, so a take that wraps the loop cannot run backwards',
  /while \(lo < hi\) \{ const mid = \(lo \+ hi\) >>> 1; if \(bt\.times\[mid\] < t\) lo = mid \+ 1; else hi = mid; \}/.test(REG));

// ONLY THE SHAPES BEING PERFORMED. Recording every shape on the mesh is the obvious reading and
// the wrong one: it writes a key per frame for shapes you never touched, so anything already
// animated is flattened by the act of recording something else.
check('a take records only the shapes actually being driven',
  /return p && p\.size \? \[\.\.\.p\.keys\(\)\] : \[\];/.test(REG),
  'the preview map is exactly the set under your hand — the pad puts its four there and no more');
check('...and overdubbing REPLACES that window rather than piling a second take on it',
  /if \(window\._animKeyMode === 'blendshape' && targetTrack\.blendshapeTracks\)/.test(REG));

// A PREVIEW OUTRANKS THE CURVE BY DESIGN, so leaving one set after a take masks the very keys
// just recorded — full dopesheet, frozen face.
check('the preview stands down when a blendshape take ends',
  /recTrack\.blendshapePreview\.clear\(\);/.test(REG)
    && /window\._blendshapePad\?\.reset\?\.\(\);/.test(REG),
  'otherwise the pose the pad was left in hides the whole performance');

// KEYS LAND ON THE FRAME GRID, like every other key writer here. Not tidiness: the capture rate
// and the frame rate are unrelated numbers, so raw transport times land wherever the tick fired,
// the dopesheet draws keys somewhere other than where a frame-by-frame scrub samples them, and
// two samples a millisecond apart become two keys instead of one.
check('capture times are snapped to the frame grid',
  /const fps = window\._animFPS \|\| 24;\s*\n\s*t = Math\.round\(t \* fps\) \/ fps;/.test(REG),
  'setBlendshapeWeight has always quantised; a second writer that does not disagrees with it');

// TANGENT OVERRIDES ARE KEYED BY KEY INDEX (`3_right_dt`), so any insert or delete renumbers the
// keys under them. Left alone it is silent curve corruption that only appears on a track someone
// hand-tuned in the graph editor — and it would be blamed on the evaluator.
{
  const shift = new Function(REG.slice(REG.indexOf('function shiftTangentOffsets'),
    REG.indexOf('\n}\n', REG.indexOf('function shiftTangentOffsets')) + 2)
    + '\nreturn shiftTangentOffsets;')();
  const bt = { tangentOffsets: { '0_right_dt': 'a', '3_right_dt': 'b', '4_left_dv': 'c' } };
  shift(bt, 2, +1);
  check('inserting a key renumbers the tangent overrides above it',
    bt.tangentOffsets['0_right_dt'] === 'a' && bt.tangentOffsets['4_right_dt'] === 'b'
      && bt.tangentOffsets['5_left_dv'] === 'c',
    JSON.stringify(bt.tangentOffsets));
  const bt2 = { tangentOffsets: { '0_right_dt': 'a', '3_right_dt': 'b', '4_left_dv': 'c' } };
  shift(bt2, 3, -1);
  check('...and removing one drops its own overrides and renumbers the rest',
    bt2.tangentOffsets['3_right_dt'] === undefined && bt2.tangentOffsets['3_left_dv'] === 'c'
      && bt2.tangentOffsets['0_right_dt'] === 'a',
    JSON.stringify(bt2.tangentOffsets));
  const bt3 = {};
  shift(bt3, 0, +1);
  check('...and a track with no overrides is left alone rather than throwing',
    bt3.tangentOffsets === undefined);
}
check('the capture path renumbers on insert, and the overdub delete does too',
  /shiftTangentOffsets\(bt, lo, \+1\);/.test(REG) && /shiftTangentOffsets\(bt, i, -1\);/.test(REG));

// ── PRESSING PLAY ENDS POSING ─────────────────────────────────────────────────────────
// The bug that got furthest: matt recorded a take, pressed play, and nothing moved. A preview
// OUTRANKS the keyed curve — that is what lets the pad show a pose without writing one — and
// `_push` writes an entry for every assigned shape INCLUDING ZEROS, so merely touching the pad
// pins four shapes until something clears them. `_blendshapePad.reset()` in the console brought
// playback straight back, which is what identified it.
check('starting playback releases a held preview',
  /if \(window\._animPlaying && !this\.isRecording\s*\n\s*&& track\.blendshapePreview && track\.blendshapePreview\.size\) \{[\s\S]{0,200}?blendshapePreview\.clear\(\);/.test(REG),
  'otherwise the pad masks the animation for its shapes and nothing on screen says why');
check('...but NOT while recording, where the pad IS the input being captured',
  /window\._animPlaying && !this\.isRecording/.test(REG),
  'a take sets _animPlaying too; clearing then would erase the performance as it was played');
check('...and the pad handle is returned to neutral with it, so it stops lying about state',
  /window\._blendshapePad\?\.reset\?\.\(\);[\s\S]{0,80}?\}/.test(REG));

// THE STATE HAS TO BE VISIBLE. It being invisible is what made this cost a round trip: the
// symptom read as "playback is broken", not "the pad is still holding this".
check('the pad shows when it is holding an override',
  /_holding\(\) \{/.test(PAD) && /const holding = this\._holding\(\) > 0;/.test(PAD)
    && /ctx\.strokeStyle = holding \? /.test(PAD));
check('...and the button names what it will do while held',
  /holding \? 'Release' : 'Reset'/.test(PAD));

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
