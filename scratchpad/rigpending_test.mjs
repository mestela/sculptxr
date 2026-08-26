// Node harness for src/editing/RigPending.js — the two-step rig assignment ("set parent",
// "aim at") now that its second step can be answered from the VIEWPORT as well as from an
// outliner row.
//
// The module has no imports, so the real source is read and evaluated whole. What is checked is
// the state machine and, above all, WHAT THE PICK RETURNS: this exists so a pin can be parented
// to another pin, and the neighbouring pick in SecondaryAction resolves a pin to the joint it
// holds. Copying that would parent to the joint instead, silently, and look like the feature
// half-works — which is the failure this file is mostly here to prevent.
//
// Run: node scratchpad/rigpending_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   RP_INJECT=resolvepin  pickTarget resolves a pin to its joint, the way SecondaryAction's
//                         does — so "parent this pin to that pin" quietly parents to a bone
//   RP_INJECT=childcompletes  the first click assigns instead of naming the child
//   RP_INJECT=assumechild     arming seeds the child from the selection again, so the gesture
//                             starts from whatever was left over instead of from a click
//   RP_INJECT=selfcandidate   the feedback line may point at the child itself
//   RP_INJECT=keeparmed   a click that hit nothing leaves the mode armed, so a later click
//                         reparents something the user is no longer thinking about
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/RigPending.js'), 'utf8');

{
  const inj = process.env.RP_INJECT || '';
  if (inj === 'resolvepin') {
    const a = '  return picking.getMesh() || null;';
    if (!SRC.includes(a)) throw new Error('inject resolvepin: anchor moved');
    SRC = SRC.replace(a, '  const m = picking.getMesh() || null;\n'
      + '  return m && m._isPinTarget ? (m._pinnedJoint || null) : m;');
  } else if (inj === 'childcompletes') {
    // The first click assigns instead of naming the child, so an armed-with-nothing gesture
    // parents a null subject to whatever was clicked.
    const a = '    main._rigPendingSubject = target.getID();';
    if (!SRC.includes(a)) throw new Error('inject childcompletes: anchor moved');
    SRC = SRC.replace(a, '    return RigPending.complete(main, target);\n    // eslint-disable-next-line no-unreachable\n    void 0;');
  } else if (inj === 'assumechild') {
    // Arming seeds the child from whatever the caller hands it again, so the gesture starts
    // from an assumed selection instead of from a click.
    const a = "RigPending.arm = function (main, mode) {\n  if (!main) return null;\n  main._rigPendingMode = mode;\n  main._rigPendingSubject = null;";
    if (!SRC.includes(a)) throw new Error('inject assumechild: anchor moved');
    SRC = SRC.replace(a, "RigPending.arm = function (main, mode, subject) {\n  if (!main) return null;\n  main._rigPendingMode = mode;\n  main._rigPendingSubject = subject ? subject.getID() : ((main._selectMeshes || [])[0] || {}).getID?.() ?? null;");
  } else if (inj === 'selfcandidate') {
    // The feedback line is allowed to point at the child itself, promising an assignment that
    // complete() refuses.
    const a = "    if (m && m.getID() !== main._rigPendingSubject) return m;";
    if (!SRC.includes(a)) throw new Error('inject selfcandidate: anchor moved');
    SRC = SRC.replace(a, '    if (m) return m;');
  } else if (inj === 'keeparmed') {
    const a = '  RigPending.cancel(main);\n  if (!mode || !target || target.getID() === subjId) return false;';
    if (!SRC.includes(a)) throw new Error('inject keeparmed: anchor moved');
    SRC = SRC.replace(a, '  if (!mode || !target || target.getID() === subjId) return false;\n'
      + '  RigPending.cancel(main);');
  }
}

// The module reads `window` for its on-screen status line and its trace flag, as the rest of
// the app does. Give it one; a stub here is honest, since what those calls SAY is not the
// behaviour under test.
globalThis.window = globalThis.window || {};
const RigPending = new Function(
  SRC.replace(/^export default RigPending;$/m, '') + '\nreturn RigPending;')();

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Arm and name the child — the only way a subject exists now, since arming never assumes one.
const armWith = (main, mode, subject) => { RigPending.arm(main, mode); RigPending.take(main, subject); };

// The smallest scene the module touches: meshes with ids, and the two calls it can make.
let nextId = 1;
const mesh = (o = {}) => ({ _id: nextId++, getID() { return this._id; }, ...o });
function scene(list, picked) {
  const calls = [];
  return {
    _rigPendingMode: null, _rigPendingSubject: null,
    getMeshes: () => list,
    getPicking: () => ({
      intersectionMouseMeshes(meshes, mx, my, twoSided, includeRig) {
        calls.push({ what: 'pick', includeRig });
        return !!picked;
      },
      getMesh: () => picked,
    }),
    setMeshParent(c, p) { calls.push({ what: 'parent', c, p }); },
    setLookAt(c, t) { calls.push({ what: 'lookat', c, t }); },
    render() {}, getGui: () => null,
    calls,
  };
}

// ── the state machine ────────────────────────────────────────────────────────
{
  const subj = mesh();
  const main = scene([subj]);
  check('nothing is armed to begin with', RigPending.armed(main) === null);
  RigPending.arm(main, 'parent');
  check('arming reports the mode', RigPending.armed(main) === 'parent');
  // ARMING NEVER ASSUMES A SUBJECT — press, click the child, click the parent, every time. It
  // used to seed the child from the outliner selection, which on a flat screen is a value the
  // user cannot reliably set for a pin (only the Transform tool selects rig nodes), so the
  // gesture started from whatever was left over from something else.
  check('arming assumes no subject', RigPending.subject(main) === null);
  check('...so the first click names the child', RigPending.step(main) === 'child');
  check('the panel can still read the state off main',
    main._rigPendingMode === 'parent' && main._rigPendingSubject === null,
    'the panel repaints from these every frame; the module owns transitions, not storage');

  RigPending.take(main, subj);
  check('naming the child records it', RigPending.subject(main) === subj);
  check('...on main, where the panel reads it', main._rigPendingSubject === subj.getID());

  // The button is a toggle: pressing it again backs out without committing.
  check('re-arming the same mode cancels', RigPending.toggle(main, 'parent') === null);
  check('...and clears the subject with it', RigPending.subject(main) === null);
  // A different mode replaces rather than cancels — you changed your mind about which
  // assignment, not about making one.
  RigPending.arm(main, 'parent');
  check('switching mode re-arms rather than cancelling',
    RigPending.toggle(main, 'lookat') === 'lookat');
  check('...and that one starts from the child too', RigPending.step(main) === 'child');
}

// ── completing ───────────────────────────────────────────────────────────────
{
  const subj = mesh(), target = mesh();
  const main = scene([subj, target]);
  armWith(main, 'parent', subj);
  check('completing parents the subject to the target', RigPending.complete(main, target)
    && main.calls.some((c) => c.what === 'parent' && c.c === subj.getID() && c.p === target.getID()));
  check('...and disarms', RigPending.armed(main) === null);

  const m2 = scene([subj, target]);
  armWith(m2, 'lookat', subj);
  RigPending.complete(m2, target);
  check('aim mode calls setLookAt instead',
    m2.calls.some((c) => c.what === 'lookat') && !m2.calls.some((c) => c.what === 'parent'));

  // A thing cannot be its own parent, and the click is still spent.
  const m3 = scene([subj]);
  armWith(m3, 'parent', subj);
  check('a target that IS the subject does nothing', RigPending.complete(m3, subj) === false);
  check('...but the click is still spent', RigPending.armed(m3) === null,
    'leaving it armed after a self-click is how you get a mystery reparent later');

  // A MISS. Same rule SecondaryAction settled on: a click that found nothing has been used up.
  const m4 = scene([subj, target]);
  armWith(m4, 'parent', subj);
  check('a miss changes nothing', RigPending.complete(m4, null) === false
    && m4.calls.length === 0);
  check('...and disarms too', RigPending.armed(m4) === null);
}

// ── WHAT THE PICK RETURNS ────────────────────────────────────────────────────
//
// The reason this module exists. A pin is returned AS ITSELF — parenting a pin to a pin is the
// control-rig case, and resolving it to the joint it holds (which is exactly what the pick next
// door does, correctly, for pinning) would parent to a bone instead and look like it worked.
{
  const joint = mesh({ _isBone: true });
  const pin = mesh({ _isPinTarget: true, _pinnedJoint: joint });
  const main = scene([joint, pin], pin);
  const got = RigPending.pickTarget(main);
  check('a picked pin is returned as the PIN', got === pin,
    got === joint ? 'it resolved to the joint it holds — that is the SecondaryAction rule, and '
      + 'it is wrong here' : 'got ' + JSON.stringify(got));
  check('the pick is rig-inclusive', main.calls.some((c) => c.what === 'pick' && c.includeRig === true),
    'joints and pins are locators the sculpt brush skips; without this they cannot be hit');

  const bare = scene([joint], joint);
  check('an ordinary rig node comes back untouched', RigPending.pickTarget(bare) === joint);
  const empty = scene([joint], null);
  check('a pick that hits nothing returns null', RigPending.pickTarget(empty) === null);
}

// ── consuming the click ──────────────────────────────────────────────────────
//
// The caller uses the return value to suppress the sculpt, the camera AND the selection change
// that the same click would otherwise cause. So it must say "consumed" whenever it was armed —
// including on a miss, or a stray click would arrive at the tool with the mode still lit.
{
  const subj = mesh(), target = mesh();
  const idle = scene([subj, target], target);
  check('an unarmed click is NOT consumed', RigPending.fireFromPointer(idle) === false,
    'consuming it would break every ordinary click in the app');

  const armed = scene([subj, target], target);
  armWith(armed, 'parent', subj);
  check('an armed click is consumed', RigPending.fireFromPointer(armed) === true);
  check('...and did the work', armed.calls.some((c) => c.what === 'parent'));

  const miss = scene([subj, target], null);
  armWith(miss, 'parent', subj);
  check('an armed click that hits nothing is consumed too',
    RigPending.fireFromPointer(miss) === true,
    'it has to be, or the tool gets a click the user meant for the assignment');
  check('...and disarms', RigPending.armed(miss) === null);

  // The VR half takes the ray's pick rather than picking again.
  const ray = scene([subj, target], null);
  armWith(ray, 'parent', subj);
  check('the ray path completes against what the controller already picked',
    RigPending.fireFromRay(ray, target) === true
      && ray.calls.some((c) => c.what === 'parent' && c.p === target.getID()));
  check('...without taking a second pick', !ray.calls.some((c) => c.what === 'pick'),
    'a second ray would be cast against a different frame’s pose');
  check('an unarmed ray press is not consumed',
    RigPending.fireFromRay(scene([subj], null), target) === false);
}


// ── NAMING BOTH ENDS FROM THE VIEWPORT ───────────────────────────────────────
//
// The half that made this unusable. On a flat screen, clicking a pin in the viewport only
// selects it while the Transform tool is active — every other tool ignores rig nodes on
// purpose, because they are locators the sculpt brush must skip. So "select the pin, then press
// Set parent" silently did nothing in most tools: the outliner had no selection and the button
// was inert. Rather than teach every tool to select pins, the assignment takes BOTH ends
// through its own rig-inclusive pick.
{
  const child = mesh(), parent = mesh();
  const main = scene([child, parent]);

  RigPending.arm(main, 'parent');
  check('arming with nothing selected still arms', RigPending.armed(main) === 'parent',
    'the button used to refuse, which is why it looked broken in every tool but Transform');
  check('...and the next click names the CHILD', RigPending.step(main) === 'child');

  check('naming the child assigns nothing yet', RigPending.take(main, child) === false);
  check('...stays armed', RigPending.armed(main) === 'parent');
  check('...and now wants the parent', RigPending.step(main) === 'parent');
  check('...with the child remembered', RigPending.subject(main) === child);
  check('nothing has been parented yet', !main.calls.some((c) => c.what === 'parent'),
    'a first click that assigns would parent to a subject nobody named');

  check('the second click completes', RigPending.take(main, parent) === true);
  check('...parenting child to parent',
    main.calls.some((c) => c.what === 'parent' && c.c === child.getID() && c.p === parent.getID()));
  check('...and disarms', RigPending.armed(main) === null);
  check('step is null once nothing is armed', RigPending.step(main) === null);

  // AND IT IS THE SAME THREE STEPS WITH SOMETHING ALREADY SELECTED. There is no shortcut to
  // skip past naming the child, because the shortcut was the bug: it read a selection the user
  // could not set for the object they cared about.
  const m2 = scene([child, parent]);
  m2._selectMeshes = [parent];                  // something irrelevant is selected
  RigPending.arm(m2, 'parent');
  check('a stale selection does not become the child', RigPending.step(m2) === 'child');
  check('...the click does', RigPending.take(m2, child) === false
    && RigPending.subject(m2) === child);

  // Clicking nothing while choosing the CHILD cancels: there is no line yet, so nothing on
  // screen would say the gesture is still live.
  const m3 = scene([child], null);
  RigPending.arm(m3, 'parent');
  check('a miss while choosing the child cancels', RigPending.take(m3, null) === false
    && RigPending.armed(m3) === null);

  // Both steps consume the click, or the tool underneath gets one the user did not mean for it.
  const m4 = scene([child, parent], child);
  RigPending.arm(m4, 'parent');
  check('the child-naming click is consumed', RigPending.fireFromPointer(m4) === true);
  check('...and it is still armed for the parent', RigPending.step(m4) === 'parent');
}

// ── WHAT THE FEEDBACK LINE POINTS AT ─────────────────────────────────────────
//
// A yellow dashed line child -> parent, drawn from the preselection the app already maintains.
// It is the only thing in the 3D view that says the gesture is live, so what it points at has
// to be exactly what the click would do.
{
  const child = mesh(), pin = mesh({ _isPinTarget: true }), bone = mesh({ _isBone: true });
  const main = scene([child, pin, bone]);

  RigPending.arm(main, 'parent');
  main._pinHighlightId = pin.getID();
  check('no line while the CHILD is still being chosen', RigPending.candidate(main) === null,
    'there is no child to draw from yet, so a line would be pointing from nowhere');

  RigPending.take(main, child);
  check('a hovered pin is the candidate', RigPending.candidate(main) === pin);

  // A BONE IS NEVER A CANDIDATE. matt: "ignore bones completely, it is only pins." Parenting is
  // a control-rig operation, and a rig full of bones between the pointer and the handle it is
  // on is exactly what made this a fight. Excluded rather than out-ranked: a filter cannot be
  // beaten by a distance.
  main._pinHighlightId = -1;
  main._skelHighlightId = bone.getID();
  check('a hovered BONE is not a candidate', RigPending.candidate(main) === null,
    'the line must not offer something the pick refuses');

  main._skelHighlightId = -1;
  check('nothing hovered, no line', RigPending.candidate(main) === null,
    'no line is also the honest answer for "that is not something you can parent to"');

  // THE ONE IT MUST REFUSE. complete() rejects a self-parent, so a line offering one would be
  // promising something that cannot happen.
  main._skelHighlightId = child.getID();
  check('the line never points at the child itself', RigPending.candidate(main) === null,
    'complete() refuses a self-parent, so offering it would be a lie');

  // VR hands report arrays rather than the single id.
  main._skelHighlightId = -1;
  main._pinHighlightIds = [pin.getID()];
  check('the VR two-hand highlight arrays work too', RigPending.candidate(main) === pin);
}


// ── THE TOOLS ARE OFF WHILE IT IS ARMED ──────────────────────────────────────
//
// matt: "grab should be disabled during this process, i shouldn't be able to move or tweak
// anything." Right, and not only for tidiness: the gesture names two objects by CLICKING them,
// and a tool that also acts on those clicks moves the very thing being named — which is what
// made the selection appear to come and go halfway through.
//
// Gated at SculptManager.start, beside the sculpt lock, because that is the one place every
// input route passes through; and at SculptManager.updateXR for VR, at the MANAGER rather than
// inside a tool, because it has to be true of all of them. A version wired into TransformVR
// alone works in the one tool nobody is holding at the time.
{
  const SM = fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8');
  const start = SM.slice(SM.indexOf('  start(ctrl) {'), SM.indexOf('  update() {'));
  check('a stroke cannot start while an assignment is armed',
    /if \(RigPending\.armed\(this\._main\)\) return false;/.test(start),
    'every desktop and VR route to a stroke passes through start()');
  check('...gated beside the sculpt lock, not somewhere new',
    start.indexOf('_sculptLocked') < start.indexOf('RigPending.armed'),
    'the existing "do nothing" gate is the precedent and the right neighbour');

  const xr = SM.slice(SM.indexOf('  updateXR('), SM.indexOf('  updateXR(') + 2600);
  check('VR: the armed assignment is handled at the manager, before any tool runs',
    xr.indexOf('RigPending.armed(this._main)') < xr.indexOf('tool.updateXR'),
    'a tool-level hook only works in the tool that happens to be active');
  check('VR: and the tool is skipped entirely while armed',
    /if \(RigPending\.armed\(this\._main\)\) \{[\s\S]*?\n      return;\n    \}/.test(xr),
    'otherwise Grab moves the thing you just clicked to name');
  check('VR: one press is one step of the gesture',
    /isPressed && !this\._rigPendPressed/.test(xr),
    'a held trigger at 90Hz would name the child and the parent in consecutive frames');
  check('VR: and the latch is released',
    /!isPressed[\s\S]{0,80}_rigPendPressed = false/.test(xr));
  check('VR: the ray pick is rig-inclusive',
    /intersectionRayMeshes\(targets, tip, dir, true\)/.test(xr),
    'pins and joints are exactly what needs to be reachable here');

  // And the dead tool-level hook is gone rather than left to double-fire if the order changes.
  const TV = fs.readFileSync(path.join(REPO, 'src/editing/tools/TransformVR.js'), 'utf8');
  check('the superseded per-tool hook was removed', !/RigPending/.test(TV),
    'two places handling one press is how they drift apart');
}


// The button itself: it must arm with NO subject, or the whole rule above is undone by the one
// call site that matters.
{
  const MM = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  check('the Set parent button arms without a subject',
    /RigPending\.toggle\(main, 'parent'\);/.test(MM),
    'passing selOne() here is what made it start from an assumed child');
  check('...and so does Aim at', /RigPending\.toggle\(main, 'lookat'\);/.test(MM));
}


// ── THE PRESELECTION HAS TO SURVIVE THE TOOLS BEING OFF ──────────────────────
//
// Switching the tools off switched off the thing that was driving the rig highlight: Grab and
// the transforms are what maintain it, and the armed branch skips them. So the controller
// pointed at a pin and nothing lit up — matt, "it's not preselect highlighting either" — which
// leaves the one question being asked, "which one?", with no answer on screen. Both halves of
// the gesture need it, not just the second: the child step is a pick too.
{
  const SK = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const fn = SK.slice(SK.indexOf('function pendingLink('), SK.indexOf('Skeleton.updateVisuals ='));
  check('desktop: the hover runs for BOTH steps, not just the parent one',
    /if \(step && !_pendHovering/.test(fn),
    'gated on step === "parent" it leaves the child step with nothing highlighted');
  check('desktop: and it is guarded against re-entry', /_pendHovering = true/.test(fn),
    'applyRigHover repaints the visuals, and the visuals are what called this');

  const SM = fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8');
  const xr = SM.slice(SM.indexOf('if (RigPending.armed(this._main)) {'));
  const armedBranch = xr.slice(0, xr.indexOf('\n      return;'));
  check('VR: the armed branch drives the hover itself',
    /Skeleton\.hoverRigFromRay\(this\._main, picking, tip, dir,/.test(armedBranch),
    'the tools that normally drive it are exactly the ones this branch skips');
  check('VR: and it does so before deciding about the press',
    armedBranch.indexOf('hoverRigFromRay') < armedBranch.indexOf('isPressed'),
    'a frame that presses should still update what is under the ray');
}

// ── SAYING WHERE THE GESTURE IS ──────────────────────────────────────────────
//
// The button label changes, but the button is in a panel you are not looking at while you point
// at a pin. With the tools switched off, a click that does nothing visible is indistinguishable
// from a click the app never received — which is precisely the confusion this ran into.
{
  const RP = fs.readFileSync(path.join(REPO, 'src/editing/RigPending.js'), 'utf8');
  for (const [what, re] of [
    ['arming', /say\(mode === 'parent' \? 'Set parent: click the CHILD'/],
    ['naming the child', /say\('child = '/],
    ['completing', /say\(\(mode === 'parent' \? 'parented ' : 'aimed '\)/],
    ['a click that hit nothing', /say\('cancelled — that click hit nothing'\)/],
  ]) check('every step of the gesture announces itself: ' + what, re.test(RP));
  check('...on the screen, not only in the console', /window\.screenLog/.test(RP),
    'a console line is no use to someone in a headset');
}


// PINS ONLY, and by EXCLUSION rather than by preference.
{
  const joint = mesh({ _isBone: true });
  const pin = mesh({ _isPinTarget: true, _isBone: false });
  const obj = mesh({});
  const main = scene([joint, pin, obj]);
  const t = RigPending.targets(main);
  check('a joint is not offered to the pick at all', !t.includes(joint),
    'a filter cannot be out-scored; a preference can, and was, four times');
  check('a pin is', t.includes(pin));
  check('and an ordinary object still is', t.includes(obj),
    'parenting to a mesh is a real thing to want and was never the problem');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
