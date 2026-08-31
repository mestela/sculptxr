// Node harness for NAMING A BONE CHAIN (roadmap #47).
//
// Bone Draw already names as it goes — `${chainName}_${NN}${side}` — but chainName is always
// "bone". matt wanted the tidy-up-afterwards half: click a joint, pick a name, the chain is
// renamed. "keep people in the flow, let them tidy up quickly after they've built something."
//
// What is checked is the WALK and what comes along with it. The rename itself is a label write;
// the things that go wrong are stopping in the wrong place, and leaving behind a name that now
// lies — a mirror twin still called `bone_03_R`, or a pin called `pin_bone_03_L` pointing at
// `arm_02_L`.
//
// Run: node scratchpad/chainname_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   CN_INJECT=walkforks    the walk continues through a fork, so naming an arm swallows every
//                          finger and numbers them as one chain
//   CN_INJECT=fixedplate   the label sprite takes a fixed width again, so a name is stretched
//   CN_INJECT=norev        a rename stops bumping the outliner revision, so the panel keeps
//                          showing the old names until it is closed and reopened
//   CN_INJECT=novrhover    the hover quad stops announcing, so the outliner highlight works on
//                          a flat screen and does nothing in a headset
//   CN_INJECT=nolatch      the preselection chases the hand while the menu is open again
//   CN_INJECT=latchsticks  the latch lifts when the first wheel closes, so the subject blinks
//                          back to yellow between the two wheels of a naming operation
//   CN_INJECT=selonly      the menu acts on the SELECTION only again, so a bone lit yellow
//                          under the ray cannot be named without clicking it first
//   CN_INJECT=nomirror     the mirror twin keeps its old name, so half the rig stays `bone_`
//   CN_INJECT=nopins       pins keep their old labels, pointing at joints that no longer exist
//                          under that name
//   CN_INJECT=rederiveside the side suffix is re-derived instead of preserved
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
const SC_RAW = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const SK_RAW = SRC;
const HP_RAW = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');
let SC_PATCH = (t) => t;
let SK_PATCH = (t) => t;
let HP_PATCH = (t) => t;

{
  const inj = process.env.CN_INJECT || '';
  if (inj === 'walkforks') {
    const a = '    if (kids.length !== 1) break;   // a fork ends the chain, and so does a leaf';
    if (!SRC.includes(a)) throw new Error('inject walkforks: anchor moved');
    SRC = SRC.replace(a, '    if (!kids.length) break;');
  } else if (inj === 'fixedplate') {
    // The label plate goes back to a fixed width, so a name is clipped at both ends and the
    // sprite stretches whatever survives.
    const a = '    e.label.sprite.scale.set(_h * (e.label.aspect || 2), _h, 1);';
    if (!SRC.includes(a)) throw new Error('inject fixedplate: anchor moved');
    SRC = SRC.replace(a, '    e.label.sprite.scale.set(unit * 0.34, _h, 1);');
  } else if (inj === 'norev') {
    // A rename stops bumping the outliner revision, so the panel's content key is unchanged and
    // the old names stay in the DOM until something unrelated forces a rebuild.
    const a = '    Skeleton.refreshOutliner(main);';
    if (!SRC.includes(a)) throw new Error('inject norev: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'novrhover') {
    // The quad stops announcing, so the outliner hover works on a flat screen and silently does
    // nothing in a headset — the reported bug, twice.
    const a = "      if (next) next.dispatchEvent(new CustomEvent('vrhover', { bubbles: true }));";
    if (!HP_RAW.includes(a)) throw new Error('inject novrhover: anchor moved');
    HP_PATCH = (t) => t.replace(a, '');
  } else if (inj === 'nolatch') {
    // The preselection is free to chase the hand while the menu is open again, so the
    // highlight walks to whatever bone is nearest behind the wheel.
    const a = '  if (hoverFrozen(main)) return;';
    if (!SK_RAW.includes(a)) throw new Error('inject nolatch: anchor moved');
    SK_PATCH = (t) => t.split(a).join('');
  } else if (inj === 'latchsticks') {
    // The latch is lifted as soon as the first wheel closes, so the subject goes yellow
    // between the two wheels of a naming operation.
    const a = 'if (!this._vrRadial.isOpen && !this._vrRadial.hasPending && this._rigMenuLatch != null) {';
    if (!SC_RAW.includes(a)) throw new Error('inject latchsticks: anchor moved');
    SC_PATCH = (t) => t.replace(a,
      'if (!this._vrRadial.isOpen && this._rigMenuLatch != null) {');
  } else if (inj === 'selonly') {
    // The menu goes back to acting on the SELECTION only, so a bone lit yellow under the ray
    // cannot be named without clicking it first.
    const a = "    const hoveredRoot = Skeleton.hoveredJoint(this);";
    if (!SC_RAW.includes(a)) throw new Error('inject selonly: anchor moved');
    SC_PATCH = (t) => t.replace('const nameRoot = hoveredRoot\n      ||', 'const nameRoot = (false)\n      ||');
  } else if (inj === 'nomirror') {
    const a = '      record(twin, clean + \'_\' + idx + flip);';
    if (!SRC.includes(a)) throw new Error('inject nomirror: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'nopins') {
    const a = "      if (pin && pin._isPinTarget) record(pin, 'pin_' + after.get(m));";
    if (!SRC.includes(a)) throw new Error('inject nopins: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'rederiveside') {
    const a = '    const side = sideOf(j);';
    if (!SRC.includes(a)) throw new Error('inject rederiveside: anchor moved');
    SRC = SRC.replace(a, "    const side = j._boneMirror ? '_L' : '';");
  }
}

// Lift the three functions plus their one regex, with a Skeleton stub for isJoint/childJoints.
const grab = (head, end) => {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error('lift: anchor moved: ' + head);
  const j = SRC.indexOf(end, i);
  return SRC.slice(i, j < 0 ? SRC.length : j);
};
const lifted = grab('Skeleton.chainFrom = function', 'Skeleton.moveJoint = function');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

globalThis.window = globalThis.window || {};
const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  childJoints: (main, j) => main.getMeshes().filter((m) => m._isBone && m._parentMesh === j),
  // Real enough to be checked: a rename has to make the outliner believe it changed, and the
  // revision counter is how it does that.
  refreshOutliner: (main) => { main._outlinerRev = (main._outlinerRev | 0) + 1; },
};
new Function('Skeleton', 'window', lifted)(Skeleton, globalThis.window);

// A rig: shoulder -> elbow -> wrist, wrist forking to two fingers. Mirrored throughout.
let nextId = 1;
const J = (label, parent, o = {}) => ({
  _isBone: true, _parentMesh: parent || null, _permanentStaticLabel: label,
  _id: nextId++, getID() { return this._id; }, ...o });
function rig() {
  const all = [];
  const add = (j) => { all.push(j); return j; };
  const mk = (base, parent, parentR) => {
    const l = add(J(base + '_L', parent));
    const r = add(J(base + '_R', parentR));
    l._boneMirror = r; r._boneMirror = l;
    return [l, r];
  };
  const [sh, shR] = mk('bone_01', null, null);
  const [el, elR] = mk('bone_02', sh, shR);
  const [wr, wrR] = mk('bone_03', el, elR);
  const [f1] = mk('bone_04', wr, wrR);
  const [f2] = mk('bone_05', wr, wrR);
  const undo = [];
  const main = {
    getMeshes: () => all,
    render() {}, getGui: () => null,
    getStateManager: () => ({ pushStateCustom: (u, r, _m, label) => undo.push({ u, r, label }) }),
  };
  return { main, all, sh, el, wr, shR, elR, wrR, f1, f2, undo, add };
}
const label = (m) => m._permanentStaticLabel;

// ── the walk ─────────────────────────────────────────────────────────────────
{
  const r = rig();
  const chain = Skeleton.chainFrom(r.main, r.sh);
  check('the walk runs from the picked joint down the chain',
    chain.length === 3 && chain[0] === r.sh && chain[2] === r.wr,
    chain.map(label).join(' '));
  check('...and STOPS at the fork', !chain.includes(r.f1) && !chain.includes(r.f2),
    'naming an arm must not swallow every finger and renumber them as one chain');

  check('starting mid-chain names from there down',
    Skeleton.chainFrom(r.main, r.el).length === 2);
  check('a leaf is a chain of one', Skeleton.chainFrom(r.main, r.f1).length === 1);
  check('a finger past the fork is its own chain',
    Skeleton.chainFrom(r.main, r.f1)[0] === r.f1,
    'which is the point of stopping: you name each one separately');
}

// ── the rename ───────────────────────────────────────────────────────────────
{
  const r = rig();
  check('it reports success', Skeleton.nameChain(r.main, r.sh, 'arm') === true);
  check('renumbered from 01 along the walk',
    label(r.sh) === 'arm_01_L' && label(r.el) === 'arm_02_L' && label(r.wr) === 'arm_03_L',
    [r.sh, r.el, r.wr].map(label).join(' '));

  // THE MIRROR. `_boneMirror` gives it for nothing, and doing one side only means doing
  // everything twice — with the other half still called bone_.
  check('the mirror twin is renamed too, with the opposite suffix',
    label(r.shR) === 'arm_01_R' && label(r.elR) === 'arm_02_R' && label(r.wrR) === 'arm_03_R',
    [r.shR, r.elR, r.wrR].map(label).join(' '));

  check('past the fork is untouched', label(r.f1) === 'bone_04_L',
    'the walk stopped there, so the names must have too');

  // The side suffix is PRESERVED, not re-derived: it was set at draw time from the mirror
  // plane, and a second derivation can disagree with `_boneMirror`, which is what actually
  // drives mirroring.
  const c = rig();
  c.sh._permanentStaticLabel = 'bone_01';       // a centreline joint, no suffix
  c.sh._boneMirror = null;
  Skeleton.nameChain(c.main, c.sh, 'spine');
  check('a centreline joint gets no suffix invented for it', label(c.sh) === 'spine_01',
    'got ' + label(c.sh));

  // NAMED FROM THE RIGHT SIDE. This is the case that separates preserving the suffix from
  // re-deriving it: every mirrored joint has a twin, so anything deriving the side from "does
  // it have a mirror" hands `_L` to the right arm and the two sides collide.
  const rr = rig();
  Skeleton.nameChain(rr.main, rr.shR, 'arm');
  check('naming from the RIGHT side keeps _R',
    label(rr.shR) === 'arm_01_R' && label(rr.elR) === 'arm_02_R',
    [rr.shR, rr.elR].map(label).join(' '));
  check('...and its twin gets _L, not a second _R',
    label(rr.sh) === 'arm_01_L' && label(rr.el) === 'arm_02_L',
    [rr.sh, rr.el].map(label).join(' '));
}

// ── the pins come along ──────────────────────────────────────────────────────
//
// makePin labels them `pin_<jointName>` at creation, so a renamed joint otherwise leaves
// `pin_bone_03_L` in the outliner pointing at `arm_03_L`.
{
  const r = rig();
  const pin = { _isPinTarget: true, _permanentStaticLabel: 'pin_bone_02_L',
    _id: 900, getID() { return this._id; } };
  const pinR = { _isPinTarget: true, _permanentStaticLabel: 'pin_bone_02_R',
    _id: 901, getID() { return this._id; } };
  r.el._boneIKPinObj = pin; r.elR._boneIKPinObj = pinR;
  Skeleton.nameChain(r.main, r.sh, 'arm');
  check('a pin follows its joint', label(pin) === 'pin_arm_02_L', label(pin));
  check('...including the mirror side', label(pinR) === 'pin_arm_02_R', label(pinR));

  // Something that is not a pin on that field must not be renamed — the flag is the contract.
  const r2 = rig();
  const notPin = { _permanentStaticLabel: 'something', _id: 902, getID() { return this._id; } };
  r2.el._boneIKPinObj = notPin;
  Skeleton.nameChain(r2.main, r2.sh, 'arm');
  check('a non-pin on that field is left alone', label(notPin) === 'something');
}

// ── one undo step, and it puts everything back ───────────────────────────────
{
  const r = rig();
  const pin = { _isPinTarget: true, _permanentStaticLabel: 'pin_bone_02_L',
    _id: 903, getID() { return this._id; } };
  r.el._boneIKPinObj = pin;
  const was = r.all.map(label).concat(label(pin));
  Skeleton.nameChain(r.main, r.sh, 'arm');
  check('exactly one undo entry for the whole rename', r.undo.length === 1,
    r.undo.length + ' entries');
  check('...and it is named for what it did', /name/i.test(r.undo[0].label));
  r.undo[0].u();
  check('undo restores every label, pins included',
    r.all.map(label).concat(label(pin)).join('|') === was.join('|'),
    r.all.map(label).join(' '));
  r.undo[0].r();
  check('redo puts the new names back', label(r.sh) === 'arm_01_L' && label(pin) === 'pin_arm_02_L');
}

// ── what it refuses ──────────────────────────────────────────────────────────
{
  const r = rig();
  check('an empty name does nothing', Skeleton.nameChain(r.main, r.sh, '   ') === false
    && label(r.sh) === 'bone_01_L');
  check('no joint, no rename', Skeleton.nameChain(r.main, null, 'arm') === false);
  const r2 = rig();
  Skeleton.nameChain(r2.main, r2.sh, 'left arm/1');
  check('a name is sanitised rather than rejected', label(r2.sh) === 'left_arm_1_01_L',
    'got ' + label(r2.sh) + ' — a label goes in an outliner and a file, so keep it plain');
}

// ── the presets are short because they are context-aware ─────────────────────
//
// A radial stops being flick-able past about eight wedges. `_boneMirror` is set at draw time
// for anything off the mirror plane, so a limb and a centreline chain get different lists and
// each stays short.
{
  const limb = { _boneMirror: {} };
  const axis = {};
  check('an off-centre chain offers limb names',
    Skeleton.nameSuggestions(limb).includes('arm')
      && !Skeleton.nameSuggestions(limb).includes('spine'));
  check('a centreline chain offers axis names',
    Skeleton.nameSuggestions(axis).includes('spine')
      && !Skeleton.nameSuggestions(axis).includes('arm'));
  for (const [what, list] of [['limb', Skeleton.LIMB_NAMES], ['axis', Skeleton.AXIS_NAMES]])
    check(`the ${what} list stays flick-able (<= 7, leaving a wedge for Keyboard)`,
      list.length <= 7, list.length + ' entries');
  check('and nothing is offered for no joint at all',
    Skeleton.nameSuggestions(null).length > 0,
    'it must still return a list rather than throw');
}


// ── WHAT THE MENU ACTS ON ────────────────────────────────────────────────────
//
// matt: "it doesn't change name if i select during a pre-select state. it should. if a bone is
// in a yellow preselect state and B is pressed, treat it as a selection." Requiring a prior
// click made the command dead in the situation it is most obviously wanted — pointing at a bone
// and reaching for the menu.
{
  const SC = SC_PATCH(SC_RAW);
  const i = SC.indexOf('const hoveredRoot = Skeleton.hoveredJoint(this);');
  // To the end of the STATEMENT, not a fixed byte count — the expression spans lines and a
  // slice that lands mid-ternary is a SyntaxError rather than a failing check.
  const end = SC.indexOf('_isBone ? selMesh : null);', i);
  const block = SC.slice(i, end + '_isBone ? selMesh : null);'.length);
  check('the chain root is liftable', i > 0 && end > i);

  const pick = new Function('Skeleton', 'selMesh', 'main',
    block.replace('Skeleton.hoveredJoint(this)', 'Skeleton.hoveredJoint(main)') + '\nreturn nameRoot;');
  const S = (hovered) => ({ hoveredJoint: () => hovered });
  const joint = { _isBone: true, n: 'joint' };
  const other = { _isBone: true, n: 'other' };
  const pin = { _isPinTarget: true, _pinnedJoint: other, n: 'pin' };

  check('a preselected bone is the target with nothing selected',
    pick(S(joint), null, {}) === joint);
  check('...and BEATS a stale selection',
    pick(S(joint), other, {}) === joint,
    'the highlight is where your hand is now; the selection may be minutes old');
  check('with no preselect, the selection is used', pick(S(null), other, {}) === other);
  check('...and a selected PIN resolves to the joint it holds',
    pick(S(null), pin, {}) === other);
  check('neither: no target, and the command disables rather than acting on nothing',
    pick(S(null), null, {}) === null);
  check('a selected ordinary mesh is not a chain root',
    pick(S(null), { n: 'mesh' }, {}) === null);

  // Opening a menu is not a pick: `getMesh()` is also the animation target, so reselecting as a
  // side effect of pressing B would retarget the timeline without anyone asking.
  check('and it does not commit the selection', !/setMesh|setOrUnsetMesh/.test(block),
    'opening a menu must not retarget the timeline');
}

// ── THE OUTLINER HOVER IS ITS OWN CHANNEL ────────────────────────────────────
//
// matt: "the preselect hover in the outliner isn't doing a matching preselect highlight in the
// viewport for bones." Two reasons, both structural. The ray hover is recomputed from scratch
// every frame, so a write through setRigHighlight was overwritten before it was ever drawn. And
// the VR panel synthesises pointermove/down/up onto the offscreen DOM — enter and leave come
// from the browser's own hit testing and never arrive, so listeners on those work on a flat
// screen and do nothing in a headset.
{
  const SK = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const MM = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  check('the panel hover has a channel the ray cannot overwrite',
    /const panelHi = main\._rigPanelHoverId;/.test(SK)
      && /hiAll\.add\(panelHi\); pinHiAll\.add\(panelHi\);/.test(SK),
    'setRigHighlight is rebuilt every frame from the controller ray');
  // TWO SOURCES, because the platforms deliver hover differently — and the VR one is not a
  // pointer event AT ALL. Hover there is a 3D quad, added earlier in this project precisely so
  // that hovering does not dispatch into the offscreen DOM and repaint the panel. So a listener
  // on any pointer event works on a flat screen and cannot fire in a headset, which is where
  // two attempts at this went. matt spotted it: "is this taking into account your recent change
  // where you're highlighting using a 'trick' to avoid repaints".
  check('the panel listens for the VR hover announcement, not just pointer events',
    /btn\.addEventListener\('vrhover'/.test(MM) && /btn\.addEventListener\('vrhoverout'/.test(MM),
    'in VR there is no pointermove on hover, by design');
  check('...and still takes a real pointermove on a flat screen',
    /btn\.addEventListener\('pointermove'/.test(MM)
      && !/addEventListener\('pointerenter'/.test(MM),
    'enter and leave never arrive in VR either');

  const HP = HP_PATCH(HP_RAW);
  check('the hover quad announces what it found',
    /_announceHover\(next, prev\)/.test(HP) && /new CustomEvent\('vrhover'/.test(HP),
    'the quad is the only thing that knows what is under the ray');
  // Scoped to the ANNOUNCE, not the whole file: the panel dispatches real mouse events for
  // CLICKS and must go on doing so. It is hover that has to stay out of the DOM.
  const ann = HP.slice(HP.indexOf('_announceHover(next, prev)'),
    HP.indexOf('_showHover(uv) {'));
  check('...as a CustomEvent, so the repaint it was avoiding stays avoided',
    /new CustomEvent/.test(ann) && !/PointerEvent|MouseEvent/.test(ann),
    'a pointer event would change :hover and repaint the panel, undoing the whole point');
  check('...on entering AND leaving', /new CustomEvent\('vrhoverout'/.test(HP));
  check('...including when the ray leaves the panel entirely',
    /clearHover\(\) \{[\s\S]{0,300}?_announceHover\(null, this\._hoverEl\)/.test(HP),
    'a highlight that outlives the thing pointing at it is worse than none');
  check('...cleared on the capture phase so moving OFF a row clears it',
    /el\.addEventListener\('pointermove', \(\) => setPanelHover\(-1\), true\)/.test(MM),
    'capture runs before the target, so the row can set it straight back');
  // AND NOTHING RESETS IT AT WIRE TIME. This wiring re-runs on every panel repaint, and a
  // repaint can land while the pointer is sitting on a row — so a reset here fought the hover
  // instead of tidying after it. The capture clear and the leave handler cover staleness.
  check('...and the wiring does not clear it as a side effect of repainting',
    !/main\._rigPanelHoverId = -1;/.test(MM),
    'a repaint mid-hover would kill the highlight it is meant to preserve');
  check('...with no repaint unless the answer moved',
    /if \(main\._rigPanelHoverId === id\) return;/.test(MM),
    'this runs on every pointermove over the panel');
}


// ── THE MENU'S SUBJECT HOLDS STILL ───────────────────────────────────────────
//
// Picking a sector means moving the hand, and the rig preselection follows the hand — so the
// highlight crawled to whatever bone was nearest while the wheel was up, behind it, on
// something the menu was never going to touch. matt: "i can see behind the menu its changing
// the preselect highlight to whatever is the next closest bone, which is confusing."
{
  const SK = SK_PATCH(SK_RAW);
  const SC = SC_PATCH(SC_RAW);

  check('the hover stops moving while a menu is acting',
    /function hoverFrozen\(main\) \{ return main && main\._rigMenuLatch != null; \}/.test(SK));
  for (const fn of ['applyRigHover', 'applyRigHovers']) {
    const k = SK.indexOf('function ' + fn + '(');
    const head = k > 0 ? SK.slice(k, SK.indexOf('\n', SK.indexOf('\n', k) + 1)) : '';
    check('...on the ' + fn + ' path', /if \(hoverFrozen\(main\)\) return;/.test(head),
      'both the one-ray and the two-hand path, or one hand still drags it around');
  }

  // SELECTED, not highlighted. While the menu is up this is not "what you would take", it is
  // "what this is about to happen to" — a different claim, and cyan is the one that means it.
  check('the subject reads as selected, not preselected',
    /if \(menuLatch != null && menuLatch >= 0\) sel\.add\(menuLatch\);/.test(SK)
      && !/hiAll\.add\(menuLatch\)/.test(SK),
    'yellow would say "you might take this", which is not what is happening');

  // The lift is the part that is easy to get wrong: naming is TWO wheels, and letting go
  // between them says the subject was released.
  // The condition gained a second latch (the hovered BONE, for Split) — same clock, same rule.
  check('the latch lifts only when nothing is open AND nothing is pending',
    /!this\._vrRadial\.isOpen && !this\._vrRadial\.hasPending/.test(SC)
      && /this\._rigMenuLatch != null \|\| this\._rigHoverBoneLatch/.test(SC),
    'lifting on the first close makes the subject blink yellow mid-operation');
  check('...and repaints when it does, so the cyan actually goes away',
    /this\._rigMenuLatch = null;\s*\n\s*this\._rigHoverBoneLatch = null;\s*\n\s*Skeleton\.updateVisuals\(this\);/.test(SC));
  check('the subject is latched at open, from the same rule the commands use',
    /Skeleton\.hoveredJoint\(this\) \|\| this\.getMesh\?\.\(\)/.test(SC),
    'latching something other than what the menu acts on is worse than not latching');
  check('...and only for rig nodes', /subj\._isBone \|\| subj\._isPinTarget/.test(SC),
    'an ordinary mesh has no rig marker to hold still');
}


// ── A RENAME HAS TO REACH THE OUTLINER ───────────────────────────────────────
//
// matt: "i have to close and open the outliner to see the names update." The VR panel skips a
// rebuild when its content key is unchanged, and that key is the section, the shader, the mesh
// COUNT and the active tool — none of which a rename touches. So the old names sat in the DOM
// until something unrelated forced a rebuild, and closing/reopening changes the section, which
// is why that appeared to fix it.
{
  const r = rig();
  const before = r.main._outlinerRev | 0;
  Skeleton.nameChain(r.main, r.sh, 'arm');
  check('a rename bumps the outliner revision', (r.main._outlinerRev | 0) > before,
    'without it the panel has no way to know its text is stale');

  const MM = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  check('...and the panel content key reads it',
    /_outlinerRev \| 0\}`;/.test(MM),
    'the key decides whether the DOM is rebuilt at all');

  // SRC, not a fresh read: a check that re-reads the file cannot see an injected defect, so it
  // passes against the very thing it exists to catch.
  const SK2 = SRC;
  check('one place refreshes both outliners',
    /Skeleton\.refreshOutliner = function \(main\) \{[\s\S]{0,400}?_buildDesktopScene[\s\S]{0,200}?markDirty/.test(SK2),
    'desktop sidebar and VR panel, or one of them goes stale');
}

// ── BONE NAMES AS A DISPLAY LAYER ────────────────────────────────────────────
//
// Same shape as the length labels, and sharing their sprite: a second label per joint would
// double the sprite count for something you read rather than aim at, and "forearm_02  1.24" is
// one statement about one bone anyway.
{
  // SRC, not a fresh read: a check that re-reads the file cannot see an injected defect, so it
  // passes against the very thing it exists to catch.
  const SK2 = SRC;
  check('there is a names display flag, off by default',
    /names: \['_boneShowNames', 'boneShowNames', false\]/.test(SK2),
    'a rig full of labels is unreadable while you work');
  check('it shares the length label rather than adding a sprite',
    /if \(showLen \|\| showNames\) \{/.test(SK2),
    'one sprite per joint is already the budget');
  check('...name first, number second', /_nm \+ '  ' \+ _ln/.test(SK2));
  check('...and either alone still shows', /\(_nm \|\| _ln\)/.test(SK2));
  // THE PLATE IS SIZED TO ITS TEXT. A fixed 128px canvas clips a name at both ends — you see
  // the middle of the word — and widening the SPRITE to compensate only stretches the same
  // clipped pixels. matt: "stretched horizontally, and clipped to the center of their names."
  check('the canvas is measured against the text',
    /Math\.ceil\(ctx\.measureText\(text\)\.width\) \+ LABEL_PAD \* 2/.test(SK2),
    'a fixed width clips anything longer than a number');
  check('...and the sprite takes its aspect from the canvas',
    /_h \* \(e\.label\.aspect \|\| 2\), _h, 1/.test(SK2),
    'a width chosen independently of the canvas IS the stretch');
  check('...with the texture reallocated when the canvas resizes',
    /lab\.tex\.dispose\(\);/.test(SK2),
    'three will not resize the GPU texture on its own — the same gotcha the VR timeline hit');
  check('...and the font re-applied afterwards, since a resize resets the context',
    /c\.width = want;[\s\S]{0,400}?ctx\.font = LABEL_FONT;/.test(SK2));

  // Lifted and RUN: the geometry of "how big and what shape" is worth checking as numbers.
  const m = /const _h = unit \* ([\d.]+);/.exec(SK2);
  check('the label height is liftable', !!m);
  check('...and is 0.75 of what it was', m && Math.abs(parseFloat(m[1]) - 0.08 * 0.75) < 1e-9,
    'got ' + (m && m[1]) + ', was 0.08');

  const BP = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');
  check('and it is reachable from the panel',
    /flagButton\(c, 'names', 'Names'/.test(BP) && /flag\('names', 'names'\);/.test(BP)
      && /setFlag\('names', Skeleton\.displayFlag\('names'\)\);/.test(BP),
    'a display layer with no toggle is the joint-dots mistake again');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
