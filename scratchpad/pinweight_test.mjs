// Node harness for PIN WEIGHT — #48 Phase A, the keyable scalar channel and the weighted pin.
//
// The design question was boolean vs sliding value. The answer is that a BOOLEAN IS A SPECIAL
// CASE of a scalar (a channel whose keys only ever hold 0 or 1, stepped), so the scalar is the
// one to build: you can express the toggle in it and you cannot express it in a flag.
//
// The other half of the answer is that a sliding value does NOT solve the activation pop --
// ramping 0->1 over a few frames still drags the joint the whole distance, just faster than a
// jump. That is Phase B (match on transition) and is not tested here.
//
// What IS tested: that an unkeyed pin still reads as fully on (every existing rig depends on
// it), that the weight moves the TARGET rather than the solver's internals, and that undo
// covers the new channel.
//
// Run: node scratchpad/pinweight_test.mjs
//   PW_INJECT=defaultzero   an unkeyed weight reads 0, silently unpinning every saved rig
//   PW_INJECT=nolerp        the weight is ignored by the position target
//   PW_INJECT=noquat        the weight is ignored by the ORIENTATION, so a 6DOF pin at w=0
//                           releases position and keeps holding rotation
//   PW_INJECT=zeroispin     a weight-0 pin still owns its chain, so deactivating snaps it to rest
//   PW_INJECT=notrack       the channel cannot be created on a never-keyed pin, so the ring is dead
//   PW_INJECT=nomatch       activating stops matching the pin to the joint, so the pop returns
//   PW_INJECT=onekey        a transition writes one key, so the channel becomes a constant
//   PW_INJECT=nosync        the matched matrix never reaches the three-side matrix
//   PW_INJECT=nosnapshot    scalar channels are left out of the undo snapshot
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let IKS = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');
let REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');

const inject = process.env.PW_INJECT || '';
const cut = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error('inject ' + name + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'defaultzero') {
  IKS = cut(IKS, "  const w = reg.scalarAt(p, IKSolver.PIN_WEIGHT, t, 1);",
    "  const w = reg.scalarAt(p, IKSolver.PIN_WEIGHT, t, 0);", inject);
} else if (inject === 'nolerp') {
  IKS = cut(IKS, "  const w = IKSolver.pinWeight(joint);\n  if (w >= 1) return out;\n  // lerp(jointPos, pinPos, w)",
    "  const w = 1;\n  if (w >= 1) return out;\n  // lerp(jointPos, pinPos, w)", inject);
} else if (inject === 'noquat') {
  IKS = cut(IKS, "  const here = modelQuat(joint, _qWeight);\n  return out.copy(here).slerp(out, w);",
    "  return out;", inject);
} else if (inject === 'zeroispin') {
  IKS = cut(IKS, '  const pins = IKSolver.activePins(main);',
    '  const pins = IKSolver.pinnedJoints(main);', inject);
} else if (inject === 'notrack') {
  REG = cut(REG, '    if (!track && create && this._ensureTransformTrack) {',
    '    if (false) {', inject);
} else if (inject === 'nomatch') {
  IKS = cut(IKS, '    IKSolver.matchPinToJoint(main, joint);', '', inject);
} else if (inject === 'onekey') {
  IKS = cut(IKS, '  reg.setScalarKey(pin, IKSolver.PIN_WEIGHT, tPrev, prev);', '', inject);
} else if (inject === 'nosync') {
  IKS = cut(IKS, '  Skeleton.syncThree(pin);\n  return true;', '  return true;', inject);
} else if (inject === 'nosnapshot') {
  REG = cut(REG, "    if (track.scalarTracks) {\n      snap.scalarTracks = new Map();",
    "    if (false) {\n      snap.scalarTracks = new Map();", inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE CHANNEL, run for real ─────────────────────────────────────────────────────────
// Lift the four scalar methods and the evaluator off the class and drive them, rather than
// reading them: the overwrite rule and the sort order are arithmetic, and arithmetic asserted
// by regex is arithmetic nobody has checked.
const slice = (name) => {
  const at = REG.indexOf('\n  ' + name + '(');
  if (at < 0) throw new Error('method not found: ' + name);
  // to the closing brace at method indentation
  const end = REG.indexOf('\n  }', at);
  return REG.slice(at, end + 4);
};
const Reg = new Function(
  'return class R { constructor(){ this.tracks = new Map(); this.globalPlaybackTime = 0; }'
  + slice('scalarTrack') + slice('scalarAt') + slice('setScalarKey')
  // ...and the two helpers the evaluator leans on. Lifted rather than stubbed: the
  // interpolation IS what is being checked, and a stub of it would pass whatever it was
  // written to pass.
  + slice('evaluateScalarTrack') + slice('getBsSlope') + slice('getBezierT')
  + '};')();

const mesh = { getID: () => 7 };
const r = new Reg();
r.tracks.set(7, { times: [], positions: [] });

check('an unkeyed channel returns the default, not zero',
  r.scalarAt(mesh, 'pinWeight', 0, 1) === 1,
  'every rig that already exists has no such channel; any other default silently deactivates '
    + 'every pin in every saved scene');

r.setScalarKey(mesh, 'pinWeight', 0, 0);
r.setScalarKey(mesh, 'pinWeight', 10, 1);
// NOT exactly, and that is worth knowing: the evaluator is a Bezier solved iteratively, so a
// key valued 1.0 comes back as about 0.9990 AT ITS OWN KEY TIME. IKSolver.pinWeight snaps the
// ends for that reason -- otherwise a pin keyed fully on is fractionally loose forever, and the
// w >= 1 fast path never fires.
check('keys read back at their own times, to the evaluator\'s precision',
  r.scalarAt(mesh, 'pinWeight', 0, 1) === 0
    && Math.abs(r.scalarAt(mesh, 'pinWeight', 10, 1) - 1) < 2e-3,
  'w(10) = ' + r.scalarAt(mesh, 'pinWeight', 10, 1));
check('...which is why the solver snaps the ends',
  /if \(w >= 1 - PIN_W_EPS\) return 1;/.test(IKS) && /if \(w <= PIN_W_EPS\) return 0;/.test(IKS));
const mid = r.scalarAt(mesh, 'pinWeight', 5, 1);
check('...and interpolate between them', mid > 0 && mid < 1, 'w(5) = ' + mid);

// Out-of-order keying has to land sorted, or the evaluator walks a sequence that goes
// backwards and interpolates between the wrong pair.
r.setScalarKey(mesh, 'pinWeight', 5, 0.25);
const st = r.scalarTrack(mesh, 'pinWeight', false);
check('a key inserted out of order lands in time order',
  st.times.join() === '0,5,10', st.times.join());
check('...with its value alongside it', st.values.join() === '0,0.25,1', st.values.join());

// Re-keying the same time EDITS rather than stacking, or scrubbing back and adjusting leaves
// two keys at one instant and the evaluator picks whichever it meets first.
r.setScalarKey(mesh, 'pinWeight', 5, 0.75);
check('re-keying a time overwrites that key rather than adding a second',
  st.times.length === 3 && st.values[1] === 0.75, st.times.join() + ' / ' + st.values.join());

// A BOOLEAN IS A SPECIAL CASE. Two keys holding 0 and 1 with no values between is the toggle;
// the channel does not need a separate mode to express it.
{
  const b = new Reg();
  b.tracks.set(7, { times: [] });
  b.setScalarKey(mesh, 'pinWeight', 0, 0);
  b.setScalarKey(mesh, 'pinWeight', 1, 1);
  check('the channel can express a plain on/off toggle',
    b.scalarAt(mesh, 'pinWeight', 0, 1) === 0
      && Math.abs(b.scalarAt(mesh, 'pinWeight', 1, 1) - 1) < 2e-3);
  // HONEST LIMIT: the evaluator interpolates with tangents, so two keys 0 -> 1 RAMP across the
  // gap rather than snapping. Per-key step/hold interpolation is backlog #7. Until then a
  // toggle is approximated by putting the two keys adjacent, and Phase B (match on transition)
  // is what makes the ramp harmless anyway.
  check('...though it ramps between them until step interpolation exists (#7)',
    b.scalarAt(mesh, 'pinWeight', 0.5, 1) > 0.1 && b.scalarAt(mesh, 'pinWeight', 0.5, 1) < 0.9,
    'w(0.5) = ' + b.scalarAt(mesh, 'pinWeight', 0.5, 1));
}

// ── THE WEIGHTED TARGET ───────────────────────────────────────────────────────────────
// Weighting the TARGET, not the solver: weighting inside FABRIK interacts with the iteration
// count, so "half pinned" would converge differently at 8 iterations than at 20 -- not
// something an animator can hold in their head.
// SCOPED TO THE FUNCTION. pinAnchorQuat carries the same two lines, so an unscoped regex for
// them passes while the POSITION path is defective -- which is exactly what the first version
// of this check did, and PW_INJECT=nolerp reported clean with the weight thrown away.
const fnBody = (name) => {
  const at = IKS.indexOf('IKSolver.' + name + ' = function');
  return at < 0 ? '' : IKS.slice(at, IKS.indexOf('\n};', at));
};
const ANCHOR = fnBody('pinAnchor');
const ANCHOR_Q = fnBody('pinAnchorQuat');
check('the weight moves the target toward the joint, not the solver internals',
  /out\.set\(here\.x \+ \(out\.x - here\.x\) \* w,/.test(ANCHOR)
    && /const w = IKSolver\.pinWeight\(joint\);/.test(ANCHOR),
  'lerp(jointPos, pinPos, w): at w=0 the target is where the joint already is, so the '
    + 'constraint asks for no change and is a no-op with no branch to disable it');
check('...and w >= 1 short-circuits, so a full pin costs nothing extra',
  /const w = IKSolver\.pinWeight\(joint\);\s*\n\s*if \(w >= 1\) return out;/.test(ANCHOR));
check('...on the ORIENTATION as well as the position',
  /return out\.copy\(here\)\.slerp\(out, w\);/.test(ANCHOR_Q)
    && /const w = IKSolver\.pinWeight\(joint\);/.test(ANCHOR_Q),
  'a 6DOF pin at w=0 that released its position but kept holding rotation is half a pin, '
    + 'which is not one of the modes');
check('the weight is clamped to 0..1',
  /Math\.min\(1, Math\.max\(0, w\)\)/.test(IKS));
check('an unkeyed pin defaults to fully on',
  /reg\.scalarAt\(p, IKSolver\.PIN_WEIGHT, t, 1\)/.test(IKS));
check('...and a pin-less joint has no weight at all',
  /if \(!p\) return 0;/.test(IKS));

// ── UNDO ──────────────────────────────────────────────────────────────────────────────
check('scalar channels are snapshotted with every other channel',
  // The GUARD as well as the line inside it: `if (false) { snap.scalarTracks = ... }` leaves
  // the assignment sitting there in plain view and snapshots nothing.
  /if \(track\.scalarTracks\) \{\s*\n\s*snap\.scalarTracks = new Map\(\);/.test(REG),
  'a channel that is not snapshotted is one undo silently leaves at its new value');
check('...and restored, including back to having none',
  /track\.scalarTracks = new Map\(\);/.test(REG)
    && /\} else if \(track\.scalarTracks\) \{[\s\S]{0,300}?track\.scalarTracks = null;/.test(REG),
  'restoring a snapshot that predates the channel must REMOVE it, not keep it');

// ── PHASE B: MATCH ON TRANSITION ──────────────────────────────────────────────────────
//
// A weight ramp does NOT solve the activation pop -- it turns the jump into a fast slide down
// the same wrong path. What solves it is putting the pin where the joint ALREADY IS at the
// activation frame, so the weight rises with the target coincident and nothing moves.
const ACTIVE = (() => {
  const at = IKS.indexOf('IKSolver.setPinActive = function');
  return at < 0 ? '' : IKS.slice(at, IKS.indexOf('\n};', at));
})();
check('activating MATCHES the pin to the joint first',
  /IKSolver\.matchPinToJoint\(main, joint\);/.test(ACTIVE),
  'without it the weight rises while the pin is still somewhere else, and the joint lurches '
    + 'across the gap -- which is the pop the whole phase exists for');
check('...and only when activating, never on the way out',
  /if \(on\) \{[\s\S]{0,400}?matchPinToJoint[\s\S]{0,300}?\n  \}/.test(ACTIVE),
  'matching on deactivate would move the pin for no reason at the moment it stops mattering');
check('...and keys the matched transform, so it survives the next evaluation',
  /reg\.keyTransforms\(\[pin\], t, 'Activate Pin', false\)/.test(ACTIVE),
  'a pin with a position track is pulled back to its keyed path on the next frame, and the '
    + 'match would last exactly one frame');
check('the match writes BOTH position and orientation',
  /const m = new THREE\.Matrix4\(\)\.compose\(p, q, new THREE\.Vector3\(1, 1, 1\)\);/.test(IKS));
// The two-matrices trap: a model-space write that does not reach the three-side matrix leaves
// the two disagreeing, and the next world-preserving read shrinks what it reads.
check('...and pushes it through to the three-side matrix',
  /pin\.setModelSpaceMatrix\(m\.toArray\(\)\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*Skeleton\.syncThree\(pin\);/.test(IKS),
  'rigbatch_test catches this one; it cost a release in v3.20.70');

// A NEAR-STEP, because per-key hold interpolation does not exist yet (#7): the old value held
// until one frame before, the new value now.
check('a transition writes TWO keys, a frame apart',
  /reg\.setScalarKey\(pin, IKSolver\.PIN_WEIGHT, tPrev, prev\);/.test(ACTIVE)
    && /reg\.setScalarKey\(pin, IKSolver\.PIN_WEIGHT, t, on \? 1 : 0\);/.test(ACTIVE),
  'one key alone sets the channel to a constant -- "on from now" needs the previous value '
    + 'held right up to the transition');
check('...holding whatever the channel actually said, not an assumed value',
  /const prev = reg\.scalarAt\(pin, IKSolver\.PIN_WEIGHT, tPrev, on \? 0 : 1\);/.test(ACTIVE),
  're-activating an already-active pin must write 1 -> 1 and change nothing, not invent a dip');
check('...and the frame gap comes from the frame rate',
  /const tPrev = Math\.max\(0, t - PIN_STEP_FRAMES \/ fps\);/.test(ACTIVE)
    && /const fps = window\._animFPS \|\| 24;/.test(ACTIVE));
check('the whole act is ONE undo entry',
  /sm\.pushStateCustom\(\(\) => apply\(before, beforeM\), \(\) => apply\(after, afterM\)/.test(ACTIVE),
  'undoing half of it leaves a pin keyed on at a position it was never matched to -- the pop, '
    + 'restored by the undo meant to remove it');
check('...restoring the pin MATRIX as well as its keys',
  /const beforeM = pin\.getModelSpaceMatrix \? pin\.getModelSpaceMatrix\(\)\.slice\(\) : null;/.test(ACTIVE));

// Clearing is not the same as keying 1.
check('clearing removes the channel rather than keying it to 1',
  /track\.scalarTracks\.delete\(IKSolver\.PIN_WEIGHT\);/.test(IKS)
    && /if \(!track\.scalarTracks\.size\) track\.scalarTracks = null;/.test(IKS),
  'an unkeyed pin is fully on with no curve at all, which is the state a rig starts in');

// ── A ZERO-WEIGHT PIN IS NOT A PIN ────────────────────────────────────────────────────
//
// matt, deactivating a wrist pin at frame 11: "the body and arm snaps away to a different
// position... i'm guessing because there was nothing telling it to maintain its pose, so it
// just let the other pins take full effect."
//
// Nearly. The arm was still SOLVER-OWNED, because the pin object still existed -- so
// seedFromRest reset the whole chain to rest before every solve. A joint off every path from a
// pin to the root is deliberately left alone; that is what a deactivated pin should get. So it
// is not a FABRIK limit and the stop-motion expectation was right.
check('a weight-0 pin is excluded from the pins that solve',
  /IKSolver\.activePins = function \(main\) \{\s*\n\s*return IKSolver\.pinnedJoints\(main\)\.filter\(\(j\) => IKSolver\.pinWeight\(j\) > 0\);/.test(IKS));
check('...and holdPins uses that list, since it is what decides ownership',
  /const pins = IKSolver\.activePins\(main\);/.test(IKS)
    && /seedFromRest\(main, written, solverOwned\(main, pins\)\);/.test(IKS),
  'a zero-weight pin left in this list keeps its chain owned, and seedFromRest then resets that '
    + 'chain to rest before every solve -- which is the snap');
check('...and the solve entry point takes it too',
  /const pinListEarly = pins \|\| IKSolver\.activePins\(main\);/.test(IKS));
// But NOT everywhere: the matrix cache has to track every pin that exists, active or not, or a
// deactivated pin that is dragged comes back stale when it is re-activated.
check('the pin matrix cache still tracks every pin, active or not',
  /IKSolver\.syncPinCache = function \(main\) \{\s*\n\s*for \(const joint of IKSolver\.pinnedJoints\(main\)\)/.test(IKS),
  'caching only active pins loses the position a deactivated pin was moved to');

// ── THE CHANNEL CAN BE CREATED ON A PIN THAT WAS NEVER KEYED ──────────────────────────
//
// matt: "if i use the marking menu to deactivate it, it has no effect... i'm guessing because
// nothing had been keyframed." Exactly right: a pin with no entry in `tracks` made scalarTrack
// bail, so setScalarKey silently did nothing.
check('a scalar channel can be created on an object with no track yet',
  /if \(!track && create && this\._ensureTransformTrack\) \{/.test(REG),
  'a pin that has never been keyed has no track at all, and Deactivate died on that line');
check('...but only on create, never as a side effect of reading',
  /scalarAt\(mesh, name, time, dflt\) \{\s*\n\s*const st = this\.scalarTrack\(mesh, name, false\);/.test(REG));

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
