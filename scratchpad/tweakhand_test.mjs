// Node harness for the ONE-OWNER rule on the Bones tool's VR drags.
//
// matt: "if i use tweak free to select anything, it seems to go into a feedback loop, so the
// hips will drag themselves away from the body, the head will zap off to somewhere crazy."
//
// updateXR runs once per CONTROLLER, and there is a second call site that always passes
// isPressed = false (the menu guard). The tool keeps ONE drag state, so the hand that did not
// grab was dragging the joint to ITS tip — wherever that was — and releasing the grab a frame
// later. The joint chases the other hand, which from the inside reads as a feedback loop.
//
// Structural, because the fault is in WHO calls the tool, not in what it computes: reproducing
// it needs two controllers and an XR session, and a mock of those would be a mock of the bug.
//
// Run: node scratchpad/tweakhand_test.mjs
//   TH_INJECT=anyhand    any hand may drive the drag again
//   TH_INJECT=noowner    the grab no longer records which hand took it
//   TH_INJECT=stickyhand a release leaves the owner set, so the next grab is driven by nobody
//   TH_INJECT=sharededge  the press edge goes back to one shared flag, so `down` never stops
//   TH_INJECT=regrab      a live grab is re-picked every frame, so it hops from joint to joint
//   TH_INJECT=volumedraws Volume mode loses its branch and falls through to Draw
//   TH_INJECT=novoldrag   Volume mode selects but never edits — no gizmo exists in VR to fall
//                         back on, so this is the whole feature
//   TH_INJECT=worldvol    the drag is applied in world space rather than the joint's frame
//   TH_INJECT=jumptohand  the VR grab drops its held offset, so the joint jumps to the hand
//   TH_INJECT=noarm       the grab starts armed, so a press meant as a selection drags the joint
//   TH_INJECT=undoontap   a tap that moved nothing still pushes an undo step
//   TH_INJECT=perjointundo drawing a bone pushes a state per joint again, so undoing one
//                          mirrored bone takes two or three presses
//   TH_INJECT=solveduring the pin watcher runs during a rest edit again — the actual runaway
//   TH_INJECT=nореseed    (noreseed) the caches are not re-seeded on release, so the whole edit
//                         is read as one external move and solved away in a frame
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');
let SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');

const inject = process.env.TH_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
if (inject === 'anyhand') {
  cut('      if (this._grab && (!this._grabHand || !hand || hand === this._grabHand)) {',
    '      if (this._grab) {', inject);
} else if (inject === 'noowner') {
  cut('        if (hit) { this._beginGrab(hit, qTweak, _tip); this._grabHand = hand; }',
    '        if (hit) this._beginGrab(hit, qTweak, _tip);', inject);
} else if (inject === 'sharededge') {
  cut("    const down = isPressed && !this._xrPressBy[hand0];\n    this._xrPressBy[hand0] = isPressed;",
    '    const down = isPressed && !this._wasXRPressed;\n    this._wasXRPressed = isPressed;', inject);
} else if (inject === 'regrab') {
  cut('      if (down && !this._grab) {', '      if (down) {', inject);
} else if (inject === 'volumedraws') {
  const at = SRC.indexOf("    if (this._mode === 'volume') {\n      Skeleton.hidePreview(main);");
  if (at < 0) throw new Error('inject volumedraws: anchor moved');
  const end = SRC.indexOf('      return;\n    }', at);
  SRC = SRC.slice(0, at) + SRC.slice(end + '      return;\n    }'.length);
} else if (inject === 'noarm') {
  cut('      startTip: tip ? tip.clone() : null, armed: !tip,',
    '      startTip: tip ? tip.clone() : null, armed: true,', inject);
} else if (inject === 'perjointundo') {
  cut('    const joint = Skeleton.createJoint(main, at, parent, base + side, { silent: true });',
    '    const joint = Skeleton.createJoint(main, at, parent, base + side);', inject);
} else if (inject === 'solveduring') {
  const a = '    if (this._rigRestEdit) { window._ikPinsDirty = false; }\n    else if';
  if (!SCENE.includes(a)) throw new Error('inject solveduring: anchor moved');
  SCENE = SCENE.replace(a, '    if');
} else if (inject === 'noreseed') {
  cut('    this._main._rigRestEdit = false;\n    IKSolver.syncPinCache?.(this._main);',
    '    this._main._rigRestEdit = false;', inject);
} else if (inject === 'undoontap') {
  cut('    if (moved && sm && sm.pushStateCustom) {', '    if (sm && sm.pushStateCustom) {', inject);
} else if (inject === 'jumptohand') {
  cut('        if (hit) { this._beginGrab(hit, qTweak, _tip); this._grabHand = hand; }',
    '        if (hit) { this._beginGrab(hit, qTweak); this._grabHand = hand; }', inject);
} else if (inject === 'novoldrag') {
  cut('            Skeleton.setJointVolOffset(vd.joint,', '            void 0 && (', inject);
} else if (inject === 'worldvol') {
  cut('          _vDelta.copy(_tip).sub(vd.start).applyMatrix4(vd.inv);',
    '          _vDelta.copy(_tip).sub(vd.start);', inject);
} else if (inject === 'stickyhand') {
  cut('    this._grab = null;\n    this._grabHand = null;', '    this._grab = null;', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── ONE DRAG, ONE OWNER ───────────────────────────────────────────────────────────────
check('a tweak grab records the hand that took it',
  /if \(hit\) \{ this\._beginGrab\(hit, qTweak, _tip\); this\._grabHand = hand; \}/.test(SRC));
check('...and only that hand may drive or release it',
  /if \(this\._grab && \(!this\._grabHand \|\| !hand \|\| hand === this\._grabHand\)\) \{/.test(SRC),
  'the other hand was dragging the joint to ITS tip and then releasing the grab');
check('...falling back to open season when no hand is named',
  /!this\._grabHand \|\| !hand/.test(SRC),
  'the desktop path passes no handedness, and must keep working');

// The same hazard exists in every per-controller drag this tool owns, so the same rule applies
// to all of them rather than only to the one that was reported.
for (const [what, begin, drive] of [
  ['pose', /if \(hit\) \{ this\._beginPose\(hit, q\); this\._grabHand = poseHand; \}/,
    /if \(this\._pose && \(!this\._grabHand \|\| !poseHand \|\| poseHand === this\._grabHand\)\)/],
  ['IK', /if \(hit\) \{ this\._beginIK\(hit, qIK\); this\._grabHand = ikHand; \}/,
    /if \(this\._ik && \(!this\._grabHand \|\| !ikHand \|\| ikHand === this\._grabHand\)\)/],
]) {
  check('a ' + what + ' drag has an owner too', begin.test(SRC));
  check('...and only its owner drives it', drive.test(SRC));
}

// An owner left behind after a release would make the NEXT grab answer to a hand that is no
// longer holding anything — the same bug with the sign flipped.
for (const fn of ['_releaseGrab', '_releasePose', '_releaseIK']) {
  const at = SRC.indexOf('  ' + fn + '() {');
  const body = SRC.slice(at, at + 220);
  check(fn + ' clears the owner', at > 0 && /this\._grabHand = null;/.test(body),
    'a stale owner means the next grab is driven by nobody');
}

// ── AND A WAY TO SEE IT ───────────────────────────────────────────────────────────────
check('a trace names the hand, the owner, and who moved the joint',
  /window\._tweakTrace/.test(SRC) && /owner=/.test(SRC)
  && /drift=/.test(SRC) && /handMoved=/.test(SRC) && /post=/.test(SRC),
  'drift is the distance the joint travelled between frames WITHOUT this tool writing to it — '
  + 'the one number that separates "the maths here is wrong" from "something else is writing '
  + 'to the same joint"');

// ── THE PRESS EDGE IS PER HAND ────────────────────────────────────────────────────────
//
// This is the actual runaway. updateXR runs once per controller AND there is a second call site
// that always passes isPressed = false, so a single shared flag was cleared every frame — making
// `down` true on every frame of a held trigger rather than only the first. Each of those frames
// re-ran the grab, and a grab is a PICK: it re-chose whatever was nearest the tip, so the drag
// hopped from joint to joint through the rig.
{
  check('the press edge is tracked per hand',
    /const down = isPressed && !this\._xrPressBy\[hand0\];\s*\n\s*this\._xrPressBy\[hand0\] = isPressed;/.test(SRC),
    'one shared flag is cleared by the menu-guard call and `down` never stops being true');
  check('...keyed by handedness, with a fallback for the callers that name none',
    /const hand0 = \(options && options\.handedness\) \|\| 'one';/.test(SRC));
  // Belt as well as braces: an edge is a fragile thing to hang a grab on, and every one of these
  // drags re-picks the nearest joint when it fires.
  check('a live grab is never re-picked', /if \(down && !this\._grab\) \{/.test(SRC));
  check('...nor a live pose', /if \(down && q && !this\._pose\) \{/.test(SRC));
  check('...nor a live IK drag', /if \(down && !this\._ik\) \{/.test(SRC));
  check('...nor a live radius drag', /if \(!this\._radius && hit\) this\._beginRadius\(hit\);/.test(SRC));
}

// ── A GRAB MOVES A JOINT WITH YOUR HAND, NOT TO IT ────────────────────────────────────
//
// The actual cause of the "runaway", found by measurement rather than reading: the VR path wrote
// the joint straight to the controller tip, so it jumped to the hand on the FIRST frame and
// tracked it 1:1 after that. The trace showed joint.y/z equal to tip.y/z every frame with a
// constant gap — nothing compounding, nothing looping.
//
// The desktop path has always held this offset, and says why in its own comment; the VR path
// never did. That asymmetry is the bug, so the check is that both halves hold one.
{
  check('a VR grab records the hand-to-joint offset',
    /const tipOffset = tip \? Skeleton\.jointPos\(joint, _jp2\)\.clone\(\)\.sub\(tip\) : null;/.test(SRC),
    'without it the joint teleports to the controller the instant you grab it');
  check('...and the tip is actually passed in',
    /this\._beginGrab\(hit, qTweak, _tip\)/.test(SRC),
    'the offset is only as good as the call site that supplies the tip');
  check('...and the drag applies it',
    /if \(g\.tipOffset\) pos = _vGrab\.copy\(pos\)\.add\(g\.tipOffset\);/.test(SRC));
  check('...without double-applying on the desktop path',
    /only one of the two is ever present/.test(SRC)
    && /d\.offset\.copy\(anchor\)\.sub\(_hit\)/.test(SRC),
    'the desktop drag adds its own offset before calling in');
}

// ── A TAP SELECTS; ONLY A DELIBERATE MOVE DRAGS ───────────────────────────────────────
//
// The last trace closed the question of whether anything was wrong with the drag: drift 0.0000
// every frame, no pins, the joint moving 1:1 with the hand. What was missing was any way to
// merely SELECT a joint in this mode — pressing the trigger near one started moving it, and a
// hand held still still wanders. matt: "this is immediately after drawing out some bones and i
// want to select the hips to change them to the dome type."
{
  check('a VR grab starts unarmed',
    /startTip: tip \? tip\.clone\(\) : null, armed: !tip,/.test(SRC),
    'and armed when there is no tip, so the desktop drag is unchanged');
  check('...arming only once the hand has travelled',
    /_tip\.distanceTo\(this\._grab\.startTip\) > this\._snapDist\(\) \* 0\.5/.test(SRC),
    'half the pick radius: holding still cannot trip it');
  check('...and nothing moves until it arms',
    /if \(isPressed\) \{ if \(this\._grab\.armed\) this\._dragTo\(_tip, qTweak\); \}/.test(SRC));
  check('...and the offset is re-taken when it arms, so the drag does not pop',
    /this\._grab\.tipOffset\.copy\(Skeleton\.jointPos\(this\._grab\.joint, _jp2\)\)\.sub\(_tip\);/.test(SRC),
    'the hand has already travelled a threshold by then; an offset from the press would hand '
    + 'all of it to the joint in one frame');
  check('a press that moved nothing pushes no undo step',
    /if \(moved && sm && sm\.pushStateCustom\)/.test(SRC),
    'an undo per selection fills the stack with entries that appear to do nothing');
  check('...but still selects, which is what the press was for',
    /this\._selectLater\(g\.joint\);/.test(SRC));
}

// ── THE RUNAWAY: A LOOP BETWEEN TWO CORRECT FEATURES ──────────────────────────────────
//
// Scene watches the pins every frame and re-solves when one appears to have moved, so a pin
// dragged with the gizmo rearranges the chain. Tweak edits the REST skeleton, which moves
// joints — indistinguishable, to that watcher, from a pin being dragged. So it solved, which
// moved the children, which read as another move next frame. The compensation was innocent
// throughout: the trace showed err=0.0000 while `wanted` itself drifted between frames.
//
// It only ever appeared with a pin in the rig, which is why one trace looked clean (pins=0) and
// the next did not (pins=1).
{
  check('a tweak grab declares that the rig is being edited',
    /main\._rigRestEdit = true;/.test(SRC));
  check('...an FK pose too, since it edits the rest skeleton as well',
    /_beginPose\(joint, quat\) \{\s*\n\s*this\._main\._rigRestEdit = true;/.test(SRC));
  check('...and the pin watcher stands down while it is set',
    /if \(this\._rigRestEdit\) \{ window\._ikPinsDirty = false; \}\s*\n\s*else if \(window\._ikHoldPins/.test(SCENE),
    'and clears the dirty flag rather than deferring the solve to the frame after the edit');
  check('...as does the gizmo-pose watcher, which reads joints the same way',
    /window\._ikGizmoPose === true && !window\._animPlaying && !this\._rigRestEdit/.test(SCENE));
  check('releasing re-seeds the caches before the watcher looks again',
    /this\._main\._rigRestEdit = false;\s*\n\s*IKSolver\.syncPinCache\?\.\(this\._main\);/.test(SRC),
    'without it the whole edit reads as one enormous external move and is solved away');
  check('...on both paths that raise the flag',
    (SRC.match(/IKSolver\.syncPinCache\?\.\(this\._main\);/g) || []).length >= 2);
}

// ── ONE PRESS, ONE UNDO STEP ──────────────────────────────────────────────────────────
//
// Every add pushed its own state, and a mirrored placement makes two joints — so undoing one
// bone took two or three presses and none of them was a whole bone. matt: "each bone takes at
// least 2 or 3 steps to undo the bone tip, the bone root, and the bone starting click."
{
  check('a drawn joint is created silently',
    /Skeleton\.createJoint\(main, at, parent, base \+ side, \{ silent: true \}\)/.test(SRC));
  check('...and so is its mirrored twin',
    /base \+ \(side === '_L' \? '_R' : '_L'\), \{ silent: true \}\)/.test(SRC));
  check('one state covers the pair',
    /false, made\.length > 1 \? 'Draw Bone \(mirrored\)' : 'Draw Bone'\);/.test(SRC));
  check('...and the chain cursor goes back with it',
    /setChain\(chainBefore\);/.test(SRC) && /setChain\(chainAfter\);/.test(SRC),
    'undoing has to put you back where you were in the chain, or the next joint continues from '
    + 'a parent that is no longer in the scene');
  check('...with the parents restored on redo',
    /if \(m\.parent\) main\.setMeshParent\(m\.mesh\.getID\(\), m\.parent\.getID\(\), \{ silent: true \}\);/.test(SRC));
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
