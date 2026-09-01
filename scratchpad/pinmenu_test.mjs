// Node harness for the PIN RING on A.
//
// A used to CYCLE: unpinned -> position -> position+rotation -> rotation -> steer -> unpinned.
// Five states is two too many for a cycle -- reaching one meant counting presses and reading
// the marker, and overshooting meant going all the way round. The ring shows all five at once.
//
// What is checked here is the part that cannot be seen by reading one function: that the ring
// and the old cycle share ONE undo-wrapped implementation (the pin is a real scene object, so
// an undo has to put THE SAME OBJECT back at THE SAME matrix, and a second copy of that is a
// second chance to get it subtly wrong), and that A cannot both open the wheel and step the
// mode behind it.
//
// Run: node scratchpad/pinmenu_test.mjs
//   PIN_INJECT=stillcycles  pinOnA keeps cycling while the ring is up, so one press does both
//   PIN_INJECT=nocurrent    the ring stops dimming the mode you are already in
//   PIN_INJECT=noguard      setting the mode it is already in still records an undo entry
//   PIN_INJECT=flatweight   the weight commands go on the ROOT ring, taking it to nine wedges
//   PIN_INJECT=bothwheels   the pin ring opens while the B menu is up, on the same hand
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let IKS = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');
let SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');

const inject = process.env.PIN_INJECT || '';
const cut = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error('inject ' + name + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'stillcycles') {
  IKS = cut(IKS, '  if (tool._main && tool._main._vrPinRadial) return false;', '', inject);
} else if (inject === 'nocurrent') {
  SC = cut(SC, '      enabled: mode !== now,', '      enabled: true,', inject);
} else if (inject === 'noguard') {
  IKS = cut(IKS, '  if (mode != null && mode === was) return false;   // nothing to do, and no undo entry for it',
    '', inject);
} else if (inject === 'flatweight') {
  // The weight commands are pushed onto the ROOT ring, taking it to nine wedges.
  SC = cut(SC, "    if (now) cmds.push({\n      label: 'Weight', icon: 'fa-sliders', enabled: true,\n      sub: () => this._resolvePinWeightCommands(joint), run: () => {},\n    });",
    "    if (now) cmds.push(...this._resolvePinWeightCommands(joint));", inject);
} else if (inject === 'bothwheels') {
  SC = cut(SC, '        const _aDown = !_modalUp2 && !_bBusy', '        const _aDown = !_modalUp2', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// --- ONE IMPLEMENTATION, TWO ENTRY POINTS ---------------------------------------------
check('the cycle and the ring go through the same undo-wrapped call',
  /IKSolver\.togglePin = function \(main, joint\) \{\s*\n\s*return IKSolver\.applyPinMode\(main, joint, null\);/.test(IKS)
    && /IKSolver\.setPinMode = function \(main, joint, mode\) \{\s*\n\s*return IKSolver\.applyPinMode\(main, joint, mode\);/.test(IKS),
  'the pin is a real scene object; a second copy of its undo is a second chance to get it wrong');
check('...and only the CHOICE of mode differs between them',
  /const r = mode == null\s*\n\s*\? IKSolver\.cyclePin\(joint, main\)/.test(IKS),
  'mode === null means "next round the ring", which is what A used to do');
check('...with one undo entry, restoring the pin object at its own matrix',
  /const wasM = wasPin \? mat4\.clone\(wasPin\.getMatrix\(\)\) : null;/.test(IKS)
    && (IKS.match(/sm\.pushStateCustom\(/g) || []).length >= 1);
// Choosing the mode it is already in must not record an undo step -- an undo that restores the
// state it was already in reads as a dead press.
check('choosing the current mode is a no-op, not an empty undo entry',
  /if \(mode != null && mode === was\) return false;/.test(IKS));

// --- THE RING ITSELF ------------------------------------------------------------------
const modes = [...SC.matchAll(/\[IKSolver\.(PIN_\w+),\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
check('every pin state is offered, including unpin',
  modes.length === 5 && modes.some((m) => m[0] === 'PIN_NONE'),
  modes.map((m) => m[1]).join(', '));
check('...named for what the pin HOLDS, not for its DOF count',
  !modes.some((m) => /dof/i.test(m[1])),
  '"6DOF" is the implementation\'s word for it and says nothing to someone deciding what they '
    + 'want the wrist to do');
// The dimming is the ONLY thing in the ring that says which state you are in. Without it the
// menu shows five equal options and no answer to "what is it now".
check('the mode it is already in is dimmed',
  /enabled: mode !== now,/.test(SC));
check('the ring acts on the preselected joint first, the selection second',
  /_resolvePinJoint\(\) \{[\s\S]{0,400}?const hov = Skeleton\.hoveredJoint\(this\);[\s\S]{0,200}?if \(hov\) return hov;/.test(SC),
  'in the headset you are already pointing at the joint you mean');
check('...and a pin resolves to the joint it holds',
  /if \(sel\._isPinTarget\) return sel\._pinnedJoint \|\| null;/.test(SC));

// --- A CANNOT DO BOTH -----------------------------------------------------------------
check('the old press-edge cycle stands down while the ring exists',
  /if \(tool\._main && tool\._main\._vrPinRadial\) return false;/.test(IKS),
  'otherwise one press opens the wheel AND steps the mode behind it, so the wheel is acting '
    + 'on a state that changed underneath it');
check('the two wheels never open together on the same hand',
  /const _bBusy = this\._vrRadial && \(this\._vrRadial\.isOpen \|\| this\._vrRadial\.hasPending\);/.test(SC)
    && /const _aDown = !_modalUp2 && !_bBusy/.test(SC));
check('...and the pin ring is suppressed by the same modals as the B menu',
  /const _modalUp2 = this\._vrNumpad\?\.mesh\?\.visible/.test(SC));
// The subject has to be frozen for the same reason B's is: the hand moves to choose, and the
// preselection follows the hand.
check('the subject is latched while the ring is up',
  /this\._rigMenuLatch = subj \? subj\.getID\(\) : null;/.test(SC));
check('...and the latch is not lifted while the pin ring is still open',
  /!\(this\._vrPinRadial && \(this\._vrPinRadial\.isOpen \|\| this\._vrPinRadial\.hasPending\)\)/.test(SC));
// Two instances, not one shared: they are driven by different buttons in the same frame.
check('the pin ring is its own wheel, not a mode on the B wheel',
  /this\._vrPinRadial = new VrRadialMenu\(this\._scene\);/.test(SC)
    && /this\._vrRadial = new VrRadialMenu\(this\._scene\);/.test(SC));

// ── THE WEIGHT SUBMENU ────────────────────────────────────────────────────────────────
//
// A marking menu's accuracy falls off past about eight wedges, and the root is already at five,
// so the four weight commands go one level DOWN rather than pushing the root to nine.
// Non-greedy across the `enabled:` expression, which may span lines -- anchoring `run:` to the
// NEXT line silently dropped the one entry whose guard is two lines long, and the check then
// reported a submenu missing a command that was there all along.
const wcmds = [...SC.matchAll(/\{ label: '([^']+)', icon: '[^']*', enabled: [\s\S]*?run: \(\) => \{ IKSolver\.(\w+)/g)]
  .map((m) => [m[1], m[2]]);
check('weight lives in a submenu, not four more wedges on the root',
  /label: 'Weight', icon: 'fa-sliders', enabled: true,\s*\n\s*sub: \(\) => this\._resolvePinWeightCommands\(joint\)/.test(SC),
  'the root ring is already at five; nine would be past where a marking menu stays accurate');
check('...offered only on a pin that exists',
  /if \(now\) cmds\.push\(\{\s*\n\s*label: 'Weight'/.test(SC),
  'weighting nothing is not a thing to offer');
check('the submenu covers activate, deactivate and clear',
  wcmds.length >= 4
    && wcmds.some((c) => /Activate/.test(c[0]) && c[1] === 'setPinActive')
    && wcmds.some((c) => /Deactivate/.test(c[0]) && c[1] === 'setPinActive')
    && wcmds.some((c) => /Clear/.test(c[0]) && c[1] === 'clearPinWeight'),
  wcmds.map((c) => c[0]).join(', '));
// The same dimming rule as the modes: what would do nothing is shown as doing nothing.
check('...dimming what would be a no-op',
  /enabled: w < 1,/.test(SC) && /enabled: w > 0,/.test(SC),
  'Activate on an already-active pin, Deactivate on an inactive one');
check('...and Clear only when there is actually a channel to clear',
  /enabled: !!\(pin && reg\s*\n?\s*&& reg\.scalarTrack && reg\.scalarTrack\(pin, IKSolver\.PIN_WEIGHT, false\)\)/.test(SC));
// "Here" is the word doing the work: both act AT THE PLAYHEAD.
check('the two transitions say WHERE they act',
  wcmds.filter((c) => c[1] === 'setPinActive').every((c) => /Here$/.test(c[0])),
  wcmds.filter((c) => c[1] === 'setPinActive').map((c) => c[0]).join(', '));

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
