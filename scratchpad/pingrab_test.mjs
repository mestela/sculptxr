// Node harness for A PIN THAT IS IN SOMEONE'S HAND.
//
// A held pin has two things arguing with it: the solver, which moves whatever the pin is
// parented under, and the visuals, which re-seat a rotation-only pin onto its joint every
// frame. Neither is wrong on its own. Both are wrong while a hand is holding the pin, and the
// old drag maths made the first one PERMANENT — it read the pin's current matrix each frame and
// folded whatever it found into the next baseline.
//
// matt: "if i move them too quickly it will recalculate an offset of the pin vs where my
// controller is" and "nothing should be able to move or rotate the pins but me."
//
// Run: node scratchpad/pingrab_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   PG_INJECT=accumulate   the drag goes back to controller*inv(last) applied to the pin's
//                          CURRENT matrix — the drift bug, exactly as it was
//   PG_INJECT=followheld   the rotation-only follow drops its held guard, so the visuals put a
//                          wrist pin back on its joint while it is being dragged
//   PG_INJECT=nosave       the VR thumbstick stops persisting the radius it just set
//   PG_INJECT=grabtiny     Grab gets its own radius default back
import fs from 'fs';
import path from 'path';
import { mat4 } from 'gl-matrix';

const REPO = '/Users/mattestela/sculptxr';
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
let GRAB = R('src/editing/tools/Grab.js');
let SKEL = R('src/editing/Skeleton.js');
let SCENE = R('src/Scene.js');
const inj = process.env.PG_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the drag maths, LIFTED AND RUN ───────────────────────────────────────────
//
// Run rather than read. "Does the pin stay in the hand when something else writes it" is a
// question about arithmetic over four frames, and no amount of looking at three mat4 calls
// answers it — the old code looks perfectly reasonable, and was wrong for a whole session.
const cut = (src, from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error('lift ' + what + ': the anchor moved (' + from.slice(0, 40) + ')');
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error('lift ' + what + ': the end moved');
  return src.slice(a, b + to.length);
};

let capture = cut(GRAB, 'const gm = pin.getModelSpaceMatrix',
  'this._vrPinGrabs.set(hand, { pin, offset, startMatrix: mat4.clone(gm) });', 'capture');
let drag = cut(GRAB, 'const next = mat4.create(); mat4.multiply(next, controller.matrix, state.offset);',
  'moved = true;', 'drag');

if (inj === 'accumulate') {
  capture = 'this._vrPinGrabs.set(hand, { pin, last: mat4.clone(controller.matrix) });';
  drag = `
      const invLast = mat4.create();
      if (!mat4.invert(invLast, state.last)) return;
      const delta = mat4.create(); mat4.multiply(delta, controller.matrix, invLast);
      const pm = state.pin.getModelSpaceMatrix();
      const next = mat4.create(); mat4.multiply(next, delta, pm);
      state.pin.setModelSpaceMatrix(next);
      mat4.copy(state.last, controller.matrix);
      moved = true;`;
}

const captureFn = new Function('mat4', 'Skeleton', 'pin', 'controller', 'hand', 'self',
  'const _m = new Map(); this._vrPinGrabs = _m;' + capture + '; return _m.get(hand);');
// GrabChannels is handed in rather than stubbed away: the drag now asks it which half of the
// gesture to apply, and these tests are all about the ordinary both-on grab. A stub that always
// answers "both" is exactly what the default is, so it tests the path that actually runs.
const dragFn = new Function('mat4', 'Skeleton', 'GrabChannels', 'state', 'controller',
  'let moved = false;' + drag + '; return moved;');
const BOTH = { channels: () => ({ translate: true, rotate: true }) };

const T = (x, y, z) => { const m = mat4.create(); m[12] = x; m[13] = y; m[14] = z; return m; };
const pos = (m) => [m[12], m[13], m[14]];
const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);
const SK = { syncThree() {} };

const makePin = (m) => {
  const cur = mat4.clone(m);
  return { _m: cur,
    getModelSpaceMatrix: () => cur,
    getMatrix: () => cur,
    setModelSpaceMatrix: (n) => mat4.copy(cur, n),
    getID: () => 7 };
};

// The gesture: take a pin 10cm in front of the hand, then move the hand. Nothing else touches
// the pin. Both the old and the new maths get this right — it is the control, not the check.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  dragFn(mat4, SK, BOTH, st, { matrix: T(0.3, 0, 0) });
  check('the pin follows the hand', near(pos(pin.getModelSpaceMatrix()), [0.3, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join());
}

// THE ONE THAT MATTERS. Something else writes the pin mid-gesture — a solve landing a frame
// late, a parent joint moving under it, the rotation-only follow. The hand has not moved. The
// pin must come straight back to where the hand is holding it.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  dragFn(mat4, SK, BOTH, st, { matrix: T(0.3, 0, 0) });
  pin.setModelSpaceMatrix(T(0.35, 0.02, -0.1)); // the interloper
  dragFn(mat4, SK, BOTH, st, { matrix: T(0.3, 0, 0) }); // same hand pose, next frame
  check('a write by anything else is undone on the next frame',
    near(pos(pin.getModelSpaceMatrix()), [0.3, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join()
      + ' — the pin is a rigid child of the hand for the length of the gesture');
}

// And it must not ACCUMULATE. Four frames of movement with a stray write before each one: the
// old maths banked every displacement, so the error grew with the drag rather than cancelling.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  for (let i = 1; i <= 4; ++i) {
    const p = pin.getModelSpaceMatrix();
    pin.setModelSpaceMatrix(T(p[12] + 0.02, p[13] + 0.02, p[14])); // solver drags it along
    dragFn(mat4, SK, BOTH, st, { matrix: T(i * 0.1, 0, 0) });
  }
  check('...and four frames of that leave no residue at all',
    near(pos(pin.getModelSpaceMatrix()), [0.4, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join()
      + ' — a fast drag is exactly where the solve is furthest behind');
}

// The pin's own matrix is never READ during the drag. This is the structural half of the rule:
// as long as the current matrix is an input, some future writer becomes part of the answer.
{
  check('the next pose comes only from the hand and the captured offset',
    /mat4\.multiply\(next, controller\.matrix, state\.offset\)/.test(drag)
      && !/state\.last/.test(drag),
    'a running baseline is what let someone else’s write become part of the offset');
  check('...and the write is synced, so the next read of the world matrix is current',
    /Skeleton\.syncThree\(state\.pin\)/.test(GRAB),
    'setModelSpaceMatrix stores a LOCAL matrix; unsynced, the three side stays stale');
}

// ── the visuals stop writing a held pin ──────────────────────────────────────
{
  let src = SKEL;
  if (inj === 'followheld') {
    const a = "if (pinMode === 4 && pinObj.setModelSpaceMatrix && !held(pinObj.getID())) {";
    if (!src.includes(a)) throw new Error('inject followheld: anchor moved');
    src = src.replace(a, 'if (pinMode === 4 && pinObj.setModelSpaceMatrix) {');
  }
  check('the rotation-only follow skips a pin that is in a hand',
    /pinMode === 4 && pinObj\.setModelSpaceMatrix && !held\(pinObj\.getID\(\)\)/.test(src),
    'this ran every frame and put a dragged wrist pin straight back on its joint');
  check('...reading the SAME held map the visuals already colour by',
    /const held = \(id\) => !!grabHands\[id\];/.test(src),
    'a second notion of "held" is a second thing to get out of step');
  check('...which Grab publishes on every change of ownership',
    /this\._main\._rigGrabHands = handMap;/.test(GRAB));
}

// ── the radius: one default, and it is remembered ────────────────────────────
{
  const tools = fs.readdirSync(path.join(REPO, 'src/editing/tools'))
    .filter((f) => f.endsWith('.js'));
  const odd = [];
  for (const f of tools) {
    if (f === 'BoneDrawTool.js' || f === 'SculptBase.js') continue; // _radius means other things
    let t = R('src/editing/tools/' + f);
    if (inj === 'grabtiny' && f === 'Grab.js') {
      t = t.replace('    this._grabbedMesh = null;',
        '    this._radius = 0.5;\n    this._grabbedMesh = null;');
    }
    const m = t.match(/this\._radius = ([\d.]+)/);
    if (m && parseFloat(m[1]) !== 50) odd.push(f + '=' + m[1]);
  }
  // SculptVoxel is the one exception and it is a deliberate one: its radius is a percentage of
  // the world, not a brush width, and 20 there was matt's own earlier call.
  check('every tool takes the same radius default',
    odd.length === 1 && odd[0] === 'SculptVoxel.js=20.0',
    odd.join(' ') + ' — Grab’s was 0.5, which is a half-millimetre sphere in VR');
  check('...and that default is 50, stated once in SculptBase',
    /this\._radius = 50\.0;/.test(R('src/editing/tools/SculptBase.js')));

  let sc = SCENE;
  if (inj === 'nosave') {
    const a = 'getOptionsURL.saveOption(\n                  `tool_${this._sculptManager.getToolIndex()}_radius`, newVal, 500);';
    if (!sc.includes(a)) throw new Error('inject nosave: anchor moved');
    sc = sc.replace(a, '');
  }
  const blk = sc.slice(sc.indexOf('tools.setRadius(newVal);') - 900,
    sc.indexOf('tools.setRadius(newVal);') + 700);
  check('the VR thumbstick saves the radius it just set',
    /saveOption\(\s*`tool_\$\{this\._sculptManager\.getToolIndex\(\)\}_radius`, newVal, 500\)/.test(blk),
    'this is how the radius is actually set in VR; unsaved, every session started over');
  // Was BrushPanel, which was deleted 2026-08-28 — the wrist panel is the surviving slider.
  check('...under the same key the panels write',
    /saveOption\(`tool_\$\{idx\}_radius`/.test(R('src/gui/htmlvr/MiniPanel.js')),
    'two keys for one setting is two answers to "how big is the brush"');
  check('...and the same key startup restores from',
    /saved\[`tool_\$\{i\}_radius`\]/.test(R('src/editing/SculptManager.js')));
}


// ── A HAND THAT IS NOT REPORTING CANNOT BE HOLDING ANYTHING ─────────────────
//
// Every release in _updateXRPinGrabs is keyed to a controller present in `activeControllers`.
// Lose a hand for one frame while it holds a pin and its entry is never deleted, so `hadGesture`
// stays true, Grab.updateXR returns early on every subsequent frame, and that controller can
// never manipulate anything again. Preselection runs on another path and keeps working — which
// is why it reads as "it highlights but I can't grab" rather than as a dead controller.
// matt: "the primary controller locked up... this has happened before."
{
  check('a hand missing from the snapshot has its pin released',
    /if \(activeControllers\.some\(\(c\) => c\.handedness === hand\)\) continue;[\s\S]{0,600}?this\._vrPinGrabs\.delete\(hand\);/.test(GRAB),
    'an entry that survives its own controller latches updateXR into an early return for ever');
  check('...and its trigger latch cleared with it',
    /this\._vrPinTriggerWas\[hand\] = false;/.test(GRAB),
    'a stuck triggerWas means the next press is never seen as an edge, so that hand can never '
      + 'start a grab even once the pin entry is gone');
  check('...before hadGesture is computed, or the release comes a frame too late',
    GRAB.indexOf("this._vrPinTriggerWas[hand] = false;   // or the next press")
      < GRAB.indexOf('const hadGesture = this._vrPinGrabs.size > 0;'));
  check('...and NOT on a frame with no controllers at all, which is the GalaxyXR blur',
    /if \(this\._grabbedMesh \|\| !controllers\.length\) return false;/.test(GRAB),
    'sources go 2->0->2 when the recorder starts; releasing there would drop a live pose');

  // The eight latches, in one place, because this has been diagnosed wrongly before and they
  // are spread across three files.
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('there is a diagnostic that names every blocking latch',
    /grabDiag\(\) \{/.test(SC) && /RigPending armed/.test(SC) && /_vrLockedHand/.test(SC)
      && /Grab\._vrPinTriggerWas/.test(SC));
  // A DIAGNOSTIC THAT THROWS IS WORSE THAN NONE — it fails at exactly the moment it is wanted,
  // and the stack trace displaces the answer. This one referenced RigPending, which Scene does
  // not import.
  check('...using only identifiers Scene actually has',
    !/RigPending\./.test(SC),
    'Scene does not import RigPending; the armed flag lives on the scene and is read directly');
  check('...reachable the way the other diagnostics are',
    /window\.grabDiag = function/.test(SC) && /window\.panelDiag = function/.test(SC),
    'a diagnostic that needs the instance handed to it does not get used');
  check('...reading the LIVE scene, not one captured at module load',
    /const app = window\.app;/.test(SC));
}


// ── A PRESS AIMED AT THE RIG DOES NOT TAKE THE MESH BEHIND IT ───────────────
//
// Grab falls back to the SELECTED mesh when its ray hits nothing — which makes it usable on an
// object you cannot easily ray, and is catastrophic while posing. Miss a pin by a centimetre
// and it took the whole character; and once `_grabbedMesh` is set, _updateXRPinGrabs returns on
// its first line, so the pin path died for BOTH hands until that mesh was released.
//
// The trace caught it exactly: `ACQUIRED #222`, then `right holding #222` for every subsequent
// frame. matt had also read the shape of it from the outside — "the right controller doesn't
// seem to care about the preselect highlight" — because the highlight and the grab were
// answering from two different pick rules.
{
  check('the air fallback is gated on nothing rig-ish being under the controller',
    /if \(!mesh && !rigUnder && this\._main\.getMesh\(\)/.test(GRAB),
    'a miss while aiming at a pin must mean "you missed", not "take the body"');
  check('...reading the same highlight the user can SEE',
    /const rigUnder = \(this\._main\._skelHighlightId \?\? -1\) >= 0\s*\n?\s*\|\| \(this\._main\._pinHighlightId \?\? -1\) >= 0;/.test(GRAB),
    'the highlight is a promise; anything else makes the two disagree about what is under you');
  check('...and the miss is traced rather than silent',
    /this\._tr\('miss on rig'/.test(GRAB));

  // THE CONSEQUENCE THAT MADE IT A LOCK-UP RATHER THAN A MISFIRE.
  check('a held mesh still disables the pin path, which is why the fallback mattered',
    /if \(this\._grabbedMesh \|\| !controllers\.length\) return false;/.test(GRAB),
    'this line is correct; the bug was letting _grabbedMesh get set by a press aimed elsewhere');

  // The frame trace must not perturb what it measures — it shares nothing with the per-frame
  // console logging that `_grabTrace` drives, because logging at 72-90Hz moved frame timing
  // enough that switching the trace off appeared to fix the bug.
  check('the frame trace is silent and on its own flag',
    /if \(!window\._grabFrameTrace\) return;/.test(GRAB)
      && !/_tr\([^)]*\)\s*\{\s*if \(!window\._grabTrace\)/.test(GRAB),
    'an instrument that changes the behaviour it measures is worse than none');
  check('...and records the held mesh on transition, so a stuck one is visible',
    /this\._tr\(now == null \? 'released' : 'ACQUIRED'/.test(GRAB));
  check('...and says WHY a pin pick declined, with the distance to the nearest pin',
    /this\._tr\('pinPick ' \+ hand/.test(GRAB),
    'if the tip looks like it is on the pin and this says centimetres, the two hands are '
      + 'using different origins');
}


// ── ONE REPORT PER TRIGGER PULL ─────────────────────────────────────────────
//
// A live trace answers "what is it doing continuously". The question here is "why did THIS pull
// do nothing", which is a single decision with about six inputs — so it is reported on the press
// EDGE, printed as it happens, on by default. matt: "we don't need endless live logs, just what
// happens when the trigger is pulled."
{
  check('the press report fires on the edge, not per frame',
    /if \(pressed && !was && !this\._vrPinGrabs\.has\(hand\)\)[\s\S]{0,1400}?this\._press\(hand, \{/.test(GRAB),
    'inside the edge branch, so it costs two lines per pull rather than two per frame');
  check('...and can be silenced without a rebuild',
    /if \(window\._grabQuiet\) return;/.test(GRAB));
  check('it reports what the HIGHLIGHT said as well as what the pick did',
    /litPin:/.test(GRAB) && /litJointOrBone:/.test(GRAB),
    'the mismatch between those two is the whole bug: a lit joint with no pin taken');
  check('...the distance to the nearest pin, IN THE SAME UNITS as the reach',
    /nearestPin:/.test(GRAB) && /dist:/.test(GRAB) && /reach:/.test(GRAB)
      && /best \* vrScale/.test(GRAB),
    'model-space distance next to a physical reach made a successful pick read as a huge miss');
  check('...and the press is reported at the SOURCE too, before any tool can decline it',
    /\[press ' \+ hand \+ '\]/.test(fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8')),
    'a pull that never reaches the tool produced no report at all — the one case an instrument '
      + 'must not have');
  check('...on the digital edge, so a sub-threshold press still reports',
    /if \(raw && !this\._trigWas\[hand\] && !window\._grabQuiet\)/.test(fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8')),
    'reporting off isTriggerPressed would hide exactly the failure being hunted');
  check('the old check still holds',
    /nearestPin:/.test(GRAB) && /reach:/.test(GRAB),
    'a miss is either aim or a disagreement about where the ray starts, and dist-vs-reach says '
      + 'which');
  check('...where the ray started, per hand',
    /rayFrom: controller\.rayOrigin \? 'tip' : 'matrix'/.test(GRAB),
    'the two hands using different origins would explain accuracy that felt random');
  check('...and what was already held, by either hand',
    /heldAlready:/.test(GRAB) && /otherHandHolds:/.test(GRAB),
    'a mesh already held disables the pin path on _updateXRPinGrabs’ first line');
  check('every outcome is named, including doing nothing',
    (GRAB.match(/OUTCOME:/g) || []).length === 3,
    'took a pin, took a mesh, or took nothing — a pull with no outcome line is a path this '
      + 'report does not cover');
}


// ── A SKIPPED HAND NAMES ITS OWN REASON ─────────────────────────────────────
//
// The acquire is gated on three conditions and the report lived INSIDE it, so a hand skipped by
// any of them said nothing at all. That produced the worst possible evidence: a clean, dominant,
// in-threshold press reported by Scene, then silence from the tool. matt: "right controller
// isn't grabbing anything at all. left controller works."
{
  check('a hand already listed as holding says so',
    /SKIPPED: 'this hand is already listed as holding a pin'/.test(GRAB),
    'a stale entry blocks every future press from that hand, silently — which is the shape of '
      + 'a dead controller from the outside');
  check('a trigger with no EDGE says so',
    /SKIPPED: 'no press EDGE — the trigger was already down last frame'/.test(GRAB),
    'a stuck triggerWas means the release frame was never seen for that hand');
  check('a hand missing from the active set says so, with whether it had a pose',
    /SKIPPED: 'not in the active set this frame'/.test(GRAB) && /hasMatrix: !!raw\.matrix/.test(GRAB),
    'a controller without a pose is excluded from the pin path entirely');
  check('...and all three are silenceable by the same flag as the rest',
    (GRAB.match(/!window\._grabQuiet/g) || []).length >= 3);
}


// ── ONE TRIGGER, ONE SOURCE OF TRUTH ────────────────────────────────────────
//
// THE BUG THAT COST A DAY. The controller list handed to the tools was built as
//   src.hand ? { buttons: [{pressed:false},{pressed:false}] } : src.gamepad
// so ANY source carrying hand-tracking data was passed a stub whose buttons are permanently
// `pressed: false` — even when that same source had a real gamepad with the trigger down. The
// Quest runtime populates `hand` intermittently alongside a controller, so this failed roughly
// three pulls in five and read as a picking or preselection problem.
//
// It survived five rounds of instrumentation because it is a SECOND SOURCE OF TRUTH: Scene reads
// `source.gamepad.buttons` for its own input handling and saw the real press, while every report
// inside Grab read the stub and produced NO output at all — not a wrong answer, no answer. The
// pair that finally named it was "canSculpt=true" from Scene with no [grab] line after it.
{
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('a real gamepad is preferred over the hand-tracking stub',
    /const _realPad = \(src\.gamepad && src\.gamepad\.buttons && src\.gamepad\.buttons\.length\)\s*\n?\s*\? src\.gamepad : null;/.test(SC),
    'a controller with its trigger down must never be described to the tools as unpressed');
  check('...and the stub only serves a source with no gamepad at all',
    /const gamepad = _realPad\s*\n?\s*\|\| \(src\.hand \? \{ buttons: \[\{ pressed: false \}, \{ pressed: false \}\] \} : null\);/.test(SC),
    'genuine hand tracking still needs something with .buttons so downstream need not check');
  check('...and the old hand-first form is gone',
    !/src\.hand \? \{ buttons: \[\{pressed:false\},\{pressed:false\}\] \} : src\.gamepad/.test(SC),
    'this exact expression is the bug');

  // The instrumentation that found it, kept: the value of each piece was in being OUTSIDE the
  // code path under suspicion. Every probe placed inside Grab could only speak when Grab
  // already worked.
  check('the press is still reported at the source, before any tool can decline it',
    /\[press ' \+ hand \+ '\]/.test(SC));
  check('...with the dispatch decision, which is the link between the two',
    /dispatch: canSculpt=/.test(SC),
    '"canSculpt=true with no [grab] line" is the pair that localised this');
  check('...and what the tools were actually handed',
    /toolsWereHanded=\[/.test(SC),
    'a hand missing from that list is invisible to every report inside the tool');
}


// ── A HELD MESH CANNOT SURVIVE A FRAME WITH NO TRIGGER DOWN ─────────────────
//
// THE ACTUAL CAUSE, after six rounds. Releasing depended entirely on Scene's stroke lifecycle:
// `_vrSculpting` goes false -> Scene calls end() -> end() clears `_grabbedMesh`. But Grab
// ACQUIRES from the digital triggers in `controllers[]`, not from the `isPressed` that lifecycle
// is built on — so a grab taken on a frame that was not a stroke had no stroke to end.
// `_grabbedMesh` stuck for ever, and since _updateXRPinGrabs returns on its FIRST line when a
// mesh is held, the pin path died for that hand: preselection still lit, nothing grabbable.
//
// The log that named it: a fresh press reporting
//   triggerWas={"left":false,"right":false}  pinGrabs=  grabbedMesh=318
// Nobody was holding anything, and yet a mesh was held.
{
  check('the tool releases a held mesh when no trigger is down',
    /if \(this\._grabbedMesh && !controllers\.some\(\(c\) => c\.buttons\?\.\[0\]\?\.pressed\)\) \{/.test(GRAB),
    'the release must not depend on who dispatched us, or a grab taken outside a stroke is '
      + 'never released');
  check('...through end(), the same path the ordinary release uses',
    /this\.end\(\);/.test(GRAB),
    'a second release path would push the undo entry twice or not at all');
  check('...before the pin path is consulted, since a held mesh short-circuits it',
    GRAB.indexOf('if (this._grabbedMesh && !controllers.some((c) => c.buttons?.[0]?.pressed))')
      < GRAB.indexOf('if (this._updateXRPinGrabs(picking, controllers))'),
    'releasing after that check leaves the pin path dead for one more frame');
  check('...and says so, since a silent release is how this hid',
    /RELEASED: 'held mesh #'/.test(GRAB));

  // The pair of probes that localised it, kept: both ends of the dispatch call.
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('Scene reports that it is about to dispatch',
    /CALLING updateXR/.test(SC));
  check('...and the tool reports being entered, with what it was given',
    /ENTERED updateXR/.test(GRAB) && /grabbedMesh=/.test(GRAB),
    'measuring either side of a call and assuming the middle is what cost the extra rounds');
}


// ── THE ORPHAN RELEASE LIVES WHERE IT IS ALWAYS REACHED ─────────────────────
//
// The first attempt put this inside Grab.updateXR, and it could never fire: updateXR is only
// dispatched while canSculpt is true, so the tool never gets a frame with the trigger UP in
// which to notice it is still holding something. The release has to sit in Scene, on the path
// taken when no stroke is open.
{
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('Scene ends a tool that is still holding something with no stroke open',
    /if \(!canSculpt && !this\._vrSculpting\) \{[\s\S]{0,400}?_t\._grabbedMesh/.test(SC),
    'the tool cannot do this itself — it is not dispatched on those frames');
  check('...through the tool’s own end(), so the undo entry is pushed once',
    /try \{ _t\.end\(\); \}/.test(SC));
  check('...and says so, because a silent orphan is how this survived six rounds',
    /orphan release: tool was holding/.test(SC));
  check('...guarded, since end() runs undo and picking code',
    /catch \(e\) \{ console\.error\('\[grab\] orphan end\(\) failed', e\); \}/.test(SC),
    'a throw here would take down the frame loop on every release');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
