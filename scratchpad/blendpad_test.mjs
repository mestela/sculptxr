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
//   BP_INJECT=noembedorigin the embedded pad ignores its origin, so in the VR panel it draws and
//                           hit-tests at the top-left instead of in its reserved strip
//   BP_INJECT=padclears     the embedded pad clears the whole canvas, wiping the layer rows the
//                           host drew above it
//   BP_INJECT=rowsteal      the row hit-test runs before the pad's, so a press on the pad is
//                           classified as the bottom-most layer
//   BP_INJECT=octreerebuild the recomposite rebuilds the octree every frame again — 25.9ms per
//                           call on a 99k-vertex mesh against a 13.9ms budget at 72Hz
//   BP_INJECT=nomigrate     a mesh replacement does not carry the track, so every topology edit
//                           (and every undo/redo swap) orphans the blendshapes
//   BP_INJECT=gcbins        the ghost-track sweep deletes orphans that still hold blendshapes,
//                           turning a recoverable id change into permanent data loss
//   BP_INJECT=capacitydrop  migration compares ARRAY LENGTH instead of vertex count, so a
//                           replacement that merely re-allocates throws every shape away
//   BP_INJECT=selectprev    _selectLayer guards the weight-1 key on the PREVIEW again, so a
//                           previewed layer never gets a real key and the sculpt gate locks the
//                           tools out — matt's "started on the third, tools were locked out"
//   BP_INJECT=gatecurve     the sculpt gate reads the CURVE again, so a pad holding the active
//                           layer at 0.4 still admits a stroke and the captured delta is wrong
//                           by 1/0.4
//   BP_INJECT=clonedropsbs  cloneTrack stops carrying the vertex deltas — a graph-editor key drag
//                           then wipes every sculpted shape on the mesh, which is how matt lost
//                           a whole face mid-session
//   BP_INJECT=deepclone     the deltas are deep-copied instead of shared, trading the data-loss
//                           bug for a ~300k-float copy per shape on every key drag
//   BP_INJECT=nowatchdog    the census guard is removed, so the next path that forgets a field
//                           loses data silently again
//   BP_INJECT=noreleaseold  a slot REASSIGNED to a different shape never releases the outgoing
//                           one, so it stays previewed forever — masking its animation and being
//                           re-recorded, flat, by every later take
//   BP_INJECT=recordmuted   a hidden layer is still recorded, so a take edits the thing you put
//                           aside
//   BP_INJECT=noresize      the VR blend panel loses its corner grip, so its height is fixed and
//                           a long layer list runs off the bottom unreachable
//   BP_INJECT=padleftovers  the pad gets only what the rows do not want, so a realistic number of
//                           layers starves the square to its floor
//   BP_INJECT=twoResizeImpls the blend panel gets its own copy of the resize maths instead of the
//                           shared helper — the divergence this codebase keeps paying for
//   BP_INJECT=padvronly     ownership and reference are conflated again, so the toolbar's slot
//                           buttons draw in VR (embedded pad) and never on desktop (sibling pad)
//   BP_INJECT=noRotate      the side labels go back to horizontal, so the side gutters have to be
//                           as wide as the longest shape name and the square collapses
//   BP_INJECT=fontfromheight the label size is taken from min(w,h) again — on an embedded pad that
//                           is the STRIP HEIGHT, so growing the strip grows the gutters instead
//   BP_INJECT=cyclestays    the toolbar's slot dispatch is disabled, so the four buttons draw but
//                           do nothing and there is no way to assign a shape at all
//   BP_INJECT=tinyhitzones  label hit zones go back to being sized to the glyphs
//   BP_INJECT=sliderblind   the stack panel's sliders read the curve instead of the previewed
//                           weight, so they disagree with the mesh in front of them
//   BP_INJECT=nounkeyed     a never-keyed shape cannot be previewed, which is every shape the
//                           first time you reach for it
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
let PAD = fs.readFileSync(path.join(REPO, 'src/gui/BlendshapePad.js'), 'utf8');
let REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
let STACK = fs.readFileSync(path.join(REPO, 'src/gui/BlendshapeStackPanel.js'), 'utf8');
let SCENE_ = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let GUI_ = fs.readFileSync(path.join(REPO, 'src/gui/Gui.js'), 'utf8');
let TLH = fs.readFileSync(path.join(REPO, 'src/gui/TimelineHelper.js'), 'utf8');
let SMG = fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8');
let MSH = fs.readFileSync(path.join(REPO, 'src/mesh/Mesh.js'), 'utf8');

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
  PAD = cut(PAD, '      if (!(n in w)) { changed = reg.setBlendshapePreview(mesh, n, null) || changed; }',
    '      if (false) { changed = false; }', inject);
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
  REG = cut(REG, '    return [...p.keys()].filter((n) => !(muted && muted.has(n)));',
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
} else if (inject === 'noembedorigin') {
  PAD = cut(PAD, "    return { x: (this._originX || 0) + (this._cssW - size) / 2,",
    '    return { x: (this._cssW - size) / 2 + 0 * (', inject);
  PAD = cut(PAD, "             y: (this._originY || 0) + g.top, s: size };",
    '             this._originX || 0), y: g.top, s: size };', inject + '2');
} else if (inject === 'padclears') {
  PAD = cut(PAD, '    if (!this._embedded) {', '    if (true) {', inject);
} else if (inject === 'rowsteal') {
  STACK = cut(STACK, '    if (this._padOwned && this._pad.hits(p.x, p.y)) { this._padActive = true; this._pad.pointerDown(p.x, p.y); return; }',
    '', inject);
} else if (inject === 'octreerebuild') {
  REG = cut(REG, '    if (mesh.updateGeometry) mesh.updateGeometry(undefined, undefined, true);',
    '    if (mesh.updateGeometry) mesh.updateGeometry();', inject);
} else if (inject === 'nomigrate') {
  SCENE_ = cut(SCENE_, '    try { window._animationRegistry?.migrateTrack?.(mesh.getID(), newMesh.getID(), newMesh); }',
    '    try { void 0; }', inject);
} else if (inject === 'gcbins') {
  REG = cut(REG, '        if (ghost && ghost.blendshapes && ghost.blendshapes.size) {', '        if (false) {', inject);
} else if (inject === 'capacitydrop') {
  REG = cut(REG, '    const newNb = newMesh && newMesh.getNbVertices ? newMesh.getNbVertices() : 0;',
    '    const newNb = newMesh && newMesh.getVertices ? newMesh.getVertices().length : 0;', inject);
} else if (inject === 'tinyhitzones') {
  PAD = cut(PAD, '        hw = g.side; hh = p.s;', '        hw = 6; hh = 14;', inject);
} else if (inject === 'selectprev') {
  STACK = cut(STACK, '      if (Math.abs(reg.blendshapeCurveWeight(track2, name) - 1) > 1e-4) {',
    '      if (Math.abs(this._weightOf(name) - 1) > 1e-4) {', inject);
} else if (inject === 'gatecurve') {
  SMG = cut(SMG, '    const w = reg.blendshapePreviewAt\n      ? reg.blendshapePreviewAt(track, name, track.blendshapeTracks?.get(name))\n      : 0;',
    '    const bT = track.blendshapeTracks?.get(name);\n    const w = bT ? reg.evaluateScalarTrack(bT, track.playbackTime || 0) : 0;', inject);
} else if (inject === 'clonedropsbs') {
  TLH = cut(TLH, '    if (track.blendshapes) cloned.blendshapes = new Map(track.blendshapes);', '', inject);
} else if (inject === 'deepclone') {
  TLH = cut(TLH, '    if (track.blendshapes) cloned.blendshapes = new Map(track.blendshapes);',
    '    if (track.blendshapes) { cloned.blendshapes = new Map(); track.blendshapes.forEach((d,n)=>cloned.blendshapes.set(n,new Float32Array(d))); }', inject);
} else if (inject === 'nowatchdog') {
  REG = cut(REG, '      try { this.checkBlendshapeCensus(); } catch (_) {}', '', inject);
} else if (inject === 'noreleaseold') {
  PAD = cut(PAD, '    for (const n of this._driven) {\n      if (!(n in w)) { changed = reg.setBlendshapePreview(mesh, n, null) || changed; }\n    }',
    '    for (const s of SLOTS) {\n      const n = this._assign[s];\n      if (n && !(n in w)) changed = reg.setBlendshapePreview(mesh, n, 0) || changed;\n    }', inject);
} else if (inject === 'recordmuted') {
  REG = cut(REG, '    return [...p.keys()].filter((n) => !(muted && muted.has(n)));',
    '    return [...p.keys()];', inject);
} else if (inject === 'noresize') {
  SCENE_ = cut(SCENE_, '      this._vrBlendResizeHandle = this._makeVRResizeGrip();', '', inject);
} else if (inject === 'padleftovers') {
  STACK = cut(STACK, '    this._padReserve = Math.max(VR_PAD_MIN, Math.min(VR_PAD_MAX_ABS, Math.max(share, left)));',
    '    this._padReserve = Math.max(VR_PAD_MIN, Math.min(VR_PAD_MAX_ABS, left));', inject);
} else if (inject === 'twoResizeImpls') {
  SCENE_ = cut(SCENE_, '            this._applyVRPanelResize(_rc.ray, this._vbsResizeState, {',
    '            this._inlineBlendResize(_rc.ray, this._vbsResizeState, {', inject);
} else if (inject === 'padvronly') {
  GUI_ = cut(GUI_, '    this._ctrlBlendshapes.attachPad(this._ctrlBlendPad);', '', inject);
} else if (inject === 'noRotate') {
  PAD = cut(PAD, "    return { side: Math.round(f * 1.5), top: Math.round(f * 1.9), bot: Math.round(f * 2.9) };",
    '    return { side: Math.round(f * 5.2), top: Math.round(f * 1.9), bot: Math.round(f * 2.9) };', inject);
} else if (inject === 'fontfromheight') {
  PAD = cut(PAD, '  _font() { return Math.max(13, Math.min(18, Math.round(this._cssW * 0.042))); }',
    '  _font() { return Math.max(13, Math.round(Math.min(this._cssW, this._cssH) * 0.075)); }', inject);
} else if (inject === 'cyclestays') {
  STACK = cut(STACK, "    if (id.startsWith('slot_') && this._pad) {", '    if (false) {', inject);
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
check('a slot emptied mid-drag is RELEASED rather than left stuck',
  /if \(!\(n in w\)\) \{ changed = reg\.setBlendshapePreview\(mesh, n, null\) \|\| changed; \}/.test(PAD),
  'it used to be previewed at 0, which still outranks the curve — releasing removes the entry');
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
  /if \(!p \|\| !p\.size\) return \[\];/.test(REG) && /\[\.\.\.p\.keys\(\)\]\.filter/.test(REG),
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

// ── THE SAME PAD IN VR ────────────────────────────────────────────────────────────────
// The VR blendshape panel is ONE canvas rasterised to ONE texture with ONE hit map, so the pad
// lives inside it rather than beside it — a second VR panel would mean a second texture, a second
// plane and a second hit path for one control. The desktop mount is the same embedded case with
// its own canvas at origin (0,0), which is what stops the weights or the feel drifting apart.
check('the pad can be embedded in another canvas at an offset',
  /embed\(ctx, x, y, w, h\) \{/.test(PAD)
    && /this\._originX = x; this\._originY = y;/.test(PAD));
check('...and its geometry is in CANVAS coordinates, origin included',
  /return \{ x: \(this\._originX \|\| 0\) \+ \(this\._cssW - size\) \/ 2,/.test(PAD),
  'ignoring the origin puts the square and every hit test at the top-left of the host canvas');
check('...and it does NOT clear a canvas it does not own',
  /if \(!this\._embedded\) \{[\s\S]{0,300}?ctx\.clearRect\(0, 0, W, H\);/.test(PAD),
  'clearing the host canvas wipes the layer rows drawn above it');
check('...with one point-based core shared by the mouse and the VR ray',
  /pointerDown\(mx, my\) \{/.test(PAD) && /pointerMove\(mx, my\) \{/.test(PAD)
    && /hits\(mx, my\) \{/.test(PAD));
check('...and the screen-to-pad Y flip lives in that core, not per host',
  /this\._y = Math\.max\(-1, Math\.min\(1, -\(\(my - p\.y\) \/ p\.s \* 2 - 1\)\)\);/.test(PAD),
  'a flip duplicated per host is a flip that will disagree between VR and desktop');

// The VR host: the pad is asked FIRST, and a drag latches so it survives the ray wandering off.
check('the VR stack panel embeds a pad in its own canvas',
  /this\._pad\.embed\(this\._ctx, 0, this\._cssH - this\._padReserve, this\._cssW, this\._padReserve\);/.test(STACK));
// THE SPLIT RESIZES. A flat reservation meant a long layer list ran underneath the pad and became
// unreachable — matt: "in vr the panel blocks the blendshape layers, it should all resize". The
// rows are served first up to what they need; the pad takes what is left between a floor (below
// which it is not a ray target any more) and a ceiling.
check('...sharing the canvas with the rows rather than taking a fixed strip',
  /const rowsWant = TOOLBAR_H \+ nRows \* ROW_H \+ BASE_H;/.test(STACK)
    && /Math\.max\(VR_PAD_MIN, Math\.min\(VR_PAD_MAX_ABS, Math\.max\(share, left\)\)\)/.test(STACK));
check('...re-shared on every draw, so adding a layer re-balances at once',
  /if \(this\._padOwned\) this\._layoutPad\(\);/.test(STACK));
check('...and the rows are CLIPPED above the pad, never drawn under it',
  /ctx\.rect\(0, 0, W, H - this\._padReserve\);\s*\n\s*ctx\.clip\(\);/.test(STACK),
  'drawing under the pad leaves a row you can still HIT but cannot SEE');
check('...and asks it BEFORE the row hit-test',
  /if \(this\._padOwned && this\._pad\.hits\(p\.x, p\.y\)\) \{ this\._padActive = true;/.test(STACK),
  'otherwise a press on the pad is classified as the bottom-most layer row');
check('...latching the drag, so it survives the ray leaving the pad',
  /if \(this\._padActive\) \{ this\._pad\.pointerMove\(p\.x, p\.y\); return; \}/.test(STACK)
    && /if \(this\._padActive\) \{ this\._padActive = false; this\._pad\.pointerUp\(\); return; \}/.test(STACK));

// ── COST ──────────────────────────────────────────────────────────────────────────────
// applyBlendshapes went from "runs when a slider is released" to "runs every frame of a take and
// every frame of playback", and a bare updateGeometry() means iFaces === undefined, which means a
// FULL computeOctree. Measured on a 99k-vertex head with four shapes live: 25.9ms per call, of
// which the vertex maths was 2.3ms and updateGeometry 25.0ms, against a 13.9ms budget at 72Hz.
// Skipping the octree took it to 10.9ms.
//
// THE CODEBASE HAD ALREADY FOUND THIS ONCE, for the skin pass — the note in Mesh.updateGeometry
// records 49,666 vertices at 29ms a frame, "a full octree rebuild, per frame, for a query nothing
// was making". Same shape, different caller.
check('the recomposite does not rebuild the octree every frame',
  /mesh\.updateGeometry\(undefined, undefined, true\)/.test(REG),
  'a blendshape moves VERTICES and never touches topology, so the octree is out of date rather '
    + 'than wrong; ensureOctree rebuilds it for the first query that actually needs it');

// ── LOSING THE BLENDSHAPES (matt's data-loss report) ──────────────────────────────────
// A track is keyed by MESH ID, and every topology edit builds a new mesh with a new id and swaps
// it in through Scene.replaceMesh — voxel remesh, and the undo/redo swaps in SculptManager.
// Nothing carried the track, so the panel read the new id, found nothing, and the layers appeared
// to vanish; the next record arm's ghost sweep then deleted the orphan for real.
check('a mesh replacement carries the animation track with it',
  /window\._animationRegistry\?\.migrateTrack\?\.\(mesh\.getID\(\), newMesh\.getID\(\), newMesh\);/.test(SCENE_),
  'done in replaceMesh because that is the one place every replacement passes through — the '
    + 'skin-bind warning sits there for the same reason');
check('...matching on VERTEX COUNT, not array length',
  /const newNb = newMesh && newMesh\.getNbVertices \? newMesh\.getNbVertices\(\) : 0;/.test(REG),
  'getVertices().length is an allocated CAPACITY — measured, a copy of a 98,306-vertex mesh had '
    + '297,603 floats against the copy\'s 300,288, so comparing capacities would throw away every '
    + 'shape on any replacement that merely re-allocated');
check('...refitting a delta when only the capacity moved, rather than discarding it',
  /const out = new Float32Array\(newLen\);\s*\n\s*out\.set\(arr\.subarray\(0, Math\.min\(arr\.length, newLen\)\)\);/.test(REG));
check('...and dropping shapes BY NAME, with a warning, when the count genuinely changed',
  /Blendshape shapes lost \(/.test(REG) && /dropped\.push\(name\)/.test(REG));
check('the ghost-track sweep refuses to bin a track holding blendshapes',
  /if \(ghost && ghost\.blendshapes && ghost\.blendshapes\.size\) \{/.test(REG),
  'transform keys for a deleted mesh are cheap and reproducible; hand-sculpted deltas are '
    + 'neither, and that sweep ran on EVERY record arm');

// ── HIT ZONES (matt: "on desktop assign hitzones too small") ──────────────────────────
check('a label hit zone is its whole gutter, not the width of the word',
  /hw = g\.side; hh = p\.s;/.test(PAD)
    && /hw = p\.s; hh = Math\.max\(f \* 1\.9, g\.top\);/.test(PAD),
  'a target sized to the glyphs is hard with a mouse and hopeless with a ray at arm\'s length');
check('...and the gutters and font scale together rather than being fixed pixels',
  /_gutter\(\) \{/.test(PAD) && /_font\(\) \{ return Math\.max\(13,/.test(PAD));

// ── ASSIGNMENT MOVED OFF THE PAD ──────────────────────────────────────────────────────
// matt: "i think clicking through to cycle the names is poor UI. fine if there's less than 6
// blendshapes, awful if there's 30." Cycling is O(n) presses to reach one shape with no way back
// a step — the only control in this panel whose cost grew with the size of the rig. His design:
// four toolbar buttons, each a square with one side bolder, and the selected layer goes there.
check('the toolbar carries four slot buttons',
  /for \(const slot of \['left', 'right', 'up', 'down'\]\)/.test(STACK)
    && /id: 'slot_' \+ slot/.test(STACK));
check('...drawn as a square with the target side picked out',
  /if \(slot === 'left'\)  \{ ctx\.moveTo\(x0, y0\); ctx\.lineTo\(x0, y1\); \}/.test(STACK));
// OWNERSHIP IS NOT REFERENCE. `_padOwned` means "this panel lays out, draws and hit-tests the
// pad" (VR, where it is embedded in this canvas); `_pad` means "there is a pad I can assign to"
// (both hosts). Gating the toolbar buttons on the first made the whole feature VR-only by
// accident — on desktop the pad is a SIBLING canvas, so the panel had no reference and the
// buttons never drew at all. matt found it on the host he was actually using.
check('the desktop panel is given a reference to its sibling pad',
  /this\._ctrlBlendshapes\.attachPad\(this\._ctrlBlendPad\);/.test(GUI_),
  'without it the four slot buttons exist only in VR');
check('...and drawing/hit-testing keys off OWNERSHIP, not the mere reference',
  /if \(this\._padOwned\) \{/.test(STACK) && /attachPad\(pad\) \{[\s\S]{0,120}?this\._padOwned = false;/.test(STACK),
  'a desktop panel must not try to draw a pad that lives on another canvas');

check('...which the toolbar actually dispatches',
  /if \(id\.startsWith\('slot_'\) && this\._pad\) \{/.test(STACK),
  'the buttons can draw perfectly and still do nothing');
check('...placing the SELECTED layer, in two presses regardless of how many shapes exist',
  /const selected = this\._track\(\)\?\.editingBlendshape \|\| null;[\s\S]{0,300}?this\._pad\.assign\(slot,/.test(STACK));
check('...and toggling off, so there is always a way back to an empty slot',
  /\(!selected \|\| cur === selected\) \? null : selected/.test(STACK));
check('the pad labels no longer cycle on click',
  !/cycles that slot/.test(PAD) && !/const cur = names\.indexOf/.test(PAD),
  'two assignment mechanisms is worse than either one');

// ── ROTATED SIDE LABELS ───────────────────────────────────────────────────────────────
// Horizontal side text needs a gutter as wide as the longest shape name — unbounded, and it
// squeezed the square to nothing. matt: "maybe the left and right labels can be rotated?"
check('the side labels are rotated, so a side gutter costs a line-height not a word',
  /ctx\.rotate\(sx > 0 \? Math\.PI \/ 2 : -Math\.PI \/ 2\);/.test(PAD)
    && /side: Math\.round\(f \* 1\.5\)/.test(PAD));
check('...and clipped to the gutter, so a long name cannot grow it back',
  /ctx\.rect\(hx, hy, hw, hh\);\s*\n\s*ctx\.clip\(\);/.test(PAD));
// The font must not come from the strip height, or the pad fights itself: more room -> bigger
// font -> bigger gutters -> no more room. Measured, raising the strip 190->260 moved the square
// 115->154 instead of 115->185, the difference going straight into margins.
check('the label size comes from the panel WIDTH, not from min(w, h)',
  /_font\(\) \{ return Math\.max\(13, Math\.min\(18, Math\.round\(this\._cssW \* 0\.042\)\)\); \}/.test(PAD),
  'on an embedded pad min(w,h) IS the strip height, which makes the gutters eat every pixel the '
    + 'strip gains');

// ── A RESIZABLE VR PANEL ──────────────────────────────────────────────────────────────
// The panel was a fixed 0.17x0.23m = 255x345 css px, which after a 38px toolbar, a 30px Base row
// and the pad's share leaves about four 46px rows — and the rest ran off the bottom with no way
// to reach them. matt: "i can only see 4, as i add more the old ones get pushed off the list and
// i can't see them anymore... the panel should be resizble like the animation panel".
check('the VR blend panel has a corner grip',
  /this\._vrBlendResizeHandle = this\._makeVRResizeGrip\(\);/.test(SCENE_)
    && /isBlendResize: true/.test(SCENE_));
check('...and the panel can actually resize its canvas',
  /resizeVRCanvas\(newCssW, newCssH\) \{/.test(STACK));
check('...persisting the size, so it survives a reload like the timeline\'s does',
  /optW: 'vrBlendW', optH: 'vrBlendH'/.test(SCENE_)
    && /_opts\.vrBlendW > 0 \? _opts\.vrBlendW/.test(SCENE_));
check('...and re-opening applies the persisted size to the reused mesh',
  /if \(Math\.abs\(gw - _worldW\) > 1e-4 \|\| Math\.abs\(gh - _worldH\) > 1e-4\)/.test(SCENE_),
  'the mesh and canvas are built once and reused, so without this a resized panel came back at '
    + 'whatever size it was first created with');
check('...and a resize drag is not also treated as a click on the rows',
  /if \(this\._vbsResizeActive\) return;/.test(SCENE_));

// ONE IMPLEMENTATION. The timeline grew this gesture first; writing it a second time is how this
// codebase has repeatedly ended up with two copies that disagree.
check('both panels resize through the SAME helper',
  /_applyVRPanelResize\(ray, st, d\) \{/.test(SCENE_)
    && (SCENE_.match(/this\._applyVRPanelResize\(/g) || []).length >= 1,
  'the maths — fixed top-left corner, axes and plane captured once on press — is identical for '
    + 'any panel, and capturing them per frame from a panel that is itself moving is a feedback '
    + 'loop that makes it chase the controller');

// THE PAD TAKES A SHARE, NOT LEFTOVERS. Measured at the default size with ten layers, a
// leftovers rule put the pad on its floor and the square at FORTY-TWO PIXELS.
check('the pad is sized from a share of the panel, not from what the rows reject',
  /Math\.max\(share, left\)/.test(STACK),
  'rows-win-first starves the square the moment a rig has a realistic number of shapes');

// ── LETTING GO OF A REASSIGNED SHAPE ──────────────────────────────────────────────────
// The release used to iterate `_assign` and clear the shapes still IN it — which covers a slot
// emptied mid-drag and misses the case that matters: on a REASSIGN the outgoing shape is no
// longer in `_assign`, so nothing ever let go of it. Its preview sat in the map for the rest of
// the session, masking its animation AND being re-recorded flat by every later take.
//
// matt's sequence: four eye shapes recorded and good; reassign the pad to four mouth shapes and
// record those; re-enable the eyes and "the keys have gone weird again."
check('the pad releases a shape when its slot is reassigned',
  /for \(const n of this\._driven\) \{[\s\S]{0,160}?setBlendshapePreview\(mesh, n, null\)/.test(PAD),
  'iterating the CURRENT assignment can never see the shape that just left it');
check('...tracking what the pad itself drove, not reconciling the whole preview map',
  /this\._driven = new Set\(Object\.keys\(w\)\);/.test(PAD),
  'so it only ever releases its own and never something another caller is holding');
check('...and releasing means REMOVING the entry, not previewing it at zero',
  /setBlendshapePreview\(mesh, n, null\)/.test(PAD),
  'a preview of 0 still outranks the curve — that is the whole masking bug again, one layer down');

// A hidden layer is one you have set aside; a take that wrote into it would edit exactly the
// thing you put away, and it contributes nothing visible anyway.
check('a muted layer is not recorded',
  /const muted = track\.blendshapeMuted;\s*\n\s*return \[\.\.\.p\.keys\(\)\]\.filter\(\(n\) => !\(muted && muted\.has\(n\)\)\);/.test(REG));

// ── THE TRACK CLONE MUST CARRY THE AUTHORED CONTENT ───────────────────────────────────
// GuiAnimation does `reg.tracks.set(meshId, cloneTrack(track))` — it REPLACES the track object,
// so anything cloneTrack omits ceases to exist on the next keyframe drag. It carried the weight
// CURVES and not the vertex DELTAS, so a graph-editor edit wiped every sculpted shape. matt:
// "went to fix another [key], noticed the face stopped moving... all the blendshapes were gone."
check('cloneTrack carries the blendshape deltas, not just the curves',
  /if \(track\.blendshapes\) cloned\.blendshapes = new Map\(track\.blendshapes\);/.test(TLH),
  'the shapeLayers note directly above records this exact treatment being needed for exactly '
    + 'this reason; blendshapes are the same shape of data and were missed');
check('...and the base cage with them',
  /if \(track\.baseShape\) cloned\.baseShape = track\.baseShape;/.test(TLH));
check('...and the per-layer mute/lock/solo state',
  /cloned\.blendshapeMuted  = new Set\(track\.blendshapeMuted\)/.test(TLH));
// BY REFERENCE. A delta is ~300k floats on a real head and a clone happens per key drag; deep
// copying would trade the data loss for a stall. Nothing on the key path mutates a delta.
check('...sharing the delta arrays rather than deep-copying them',
  !/blendshapes\.forEach\(\(d ?, ?n\) ?=> ?cloned\.blendshapes\.set\(n, ?new Float32Array/.test(TLH),
  'measured: the shallow clone costs 0.43ms; copying four 297,603-float deltas would not');

// ── THE WATCHDOG ──────────────────────────────────────────────────────────────────────
// Three routes to "my blendshapes vanished" in two days, all the same shape: a path that
// rebuilds a container and omits the authored content. Point fixes do not generalise; noticing
// does. This cannot prevent a loss, it makes one REPORTED.
check('a census watchdog reports blendshapes vanishing without a deletion',
  /checkBlendshapeCensus\(\) \{/.test(REG) && /disappeared without being deleted/.test(REG));
check('...and deliberate removals announce themselves so they do not trip it',
  /expectBlendshapeChange\(meshId\) \{/.test(REG)
    && /this\.expectBlendshapeChange\(mesh\.getID\(\)\);/.test(REG));
check('...running on a timer rather than every frame',
  /if \(!this\._bsLastCheck \|\| _bsNow - this\._bsLastCheck > 1000\)/.test(REG));
check('...and actually called — a guard nothing invokes is decoration',
  /try \{ this\.checkBlendshapeCensus\(\); \} catch \(_\) \{\}/.test(REG));

// ── TWO WEIGHTS, PICKED ON PURPOSE ────────────────────────────────────────────────────
// "What the mesh is WEARING" (previews included) and "what the curve SAYS" (keys alone) are
// different questions, and every reader has to choose deliberately. Conflating them locked matt
// out of sculpting: `_selectLayer` snaps a new layer to weight 1 so a click makes it sculptable,
// guarded on the PREVIEW-aware read — so when a preview sat at 1 it wrote no key, and the sculpt
// gate (reading the curve, unkeyed, 0) then refused. The layer looked fully on and could not be
// touched. matt: "i made 2, started on the third, when my sculpting tools were locked out."
check('there is an explicit curve-only reader, separate from the preview-aware one',
  /blendshapeCurveWeight\(track, name\) \{/.test(REG));
check('_selectLayer decides "does a weight KEY exist" from the CURVE',
  /Math\.abs\(reg\.blendshapeCurveWeight\(track2, name\) - 1\) > 1e-4/.test(STACK),
  'a preview is not a key — it is a live override that vanishes when the pad is released');

// The other direction: the capture is `delta = verts - base - others` and assumes the layer is
// at FULL strength. What decides that is what the mesh is SHOWING, so both capture gates must be
// preview-aware or a pad holding the layer at 0.4 admits a stroke whose delta is 1/0.4 wrong.
check('the sculpt start() gate reads what the mesh is SHOWING',
  /const w = reg\.blendshapePreviewAt/.test(SMG));
check('...and so does the capture backstop in Mesh.updateGeometry',
  /_reg\.blendshapePreviewAt \? _reg\.blendshapePreviewAt\(_track, _name, _bt\)/.test(MSH),
  'four places ask how much of this layer is showing; they must all get one answer');

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
