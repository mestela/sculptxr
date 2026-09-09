// Node harness for PIN: KEEP ABOVE GROUND — roadmap #37.
//
// matt's ask: a per-pin toggle "for easier foot contact stuff" — plant a foot and it stops
// sinking through the floor while you pose the rest.
//
// THE FEATURE HAD A PREREQUISITE NOBODY HAD NOTICED. There was no ground in this app. The only
// thing that ever asked for one was PhysicsBones.groundHeight, which read `main._groundY` — and
// nothing anywhere assigns that property, so it has been returning the 0 fallback since physics
// bones shipped, while the grid the user reads as the floor sits somewhere else entirely (see
// Scene.initGrid, which translates it down through the normalizeSize scale). Two floors, one of
// them invisible and one of them wrong. So the first thing tested here is the AUTHORITY: one
// number, off the grid's own matrix, that both features ask for.
//
// The rest is about the shape of the thing: it is a FLAG, not a sixth pin mode, because it
// composes with all four modes — and the interesting failure is that the flag has to survive a
// mode cycle, which is the one thing a bit packed into `_pinMode` cannot do.
//
// Run: node scratchpad/pinground_test.mjs
//   PG_INJECT=nogroundauth    Scene.groundHeight goes back to a hard 0, so the clamp holds a
//                             foot at an invisible plane instead of the visible grid
//   PG_INJECT=deadgrid        reads `_grid`, the LEGACY drawable whose render call is commented
//                             out, instead of `_groundGrid`, the one the user can see. This is
//                             the real bug the first version of this harness shipped with and
//                             did not catch: the clamp sat ~35 units low and never fired.
//   PG_INJECT=physicsblind    PhysicsBones stops asking Scene for the floor, restoring the
//                             original two-floors bug for the shipped physics feature
//   PG_INJECT=modewipes       setPin writes the bare `& 7` mode into `_boneIKPin`, so cycling
//                             3DOF -> 6DOF silently clears the flag
//   PG_INJECT=packedinmode    the flag is stored INSIDE _pinMode, which `& 7` then masks away
//   PG_INJECT=clampafterlerp  the clamp runs after the weight lerp, so a half-weight pin holds
//                             a different contact height from a full one
//   PG_INJECT=noresolve      the toggle flips the flag but never marks the pins dirty, so the
//                             foot keeps aiming at the old target until something else moves
//   PG_INJECT=noserialize     bit 7 is never written, so the toggle does not survive a save
//   PG_INJECT=noloadflag      the pin OBJECT's live flag is not set on load, so a saved rig
//                             loads with the file saying on and the session saying off



import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let IKS   = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');
let SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let SKEL  = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
let PHYS  = fs.readFileSync(path.join(REPO, 'src/editing/PhysicsBones.js'), 'utf8');
let GRAB  = fs.readFileSync(path.join(REPO, 'src/editing/tools/Grab.js'), 'utf8');
let TVR   = fs.readFileSync(path.join(REPO, 'src/editing/tools/TransformVR.js'), 'utf8');

const inject = process.env.PG_INJECT || '';
const cut = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error('inject ' + name + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'nogroundauth') {
  SCENE = cut(SCENE, '    const g = this._groundGrid;\n    if (g && g.position) return g.position.y;',
    '    const g = this._groundGrid;\n    if (g) return 0;', inject);
} else if (inject === 'deadgrid') {
  // THE BUG THIS HARNESS ORIGINALLY MISSED. The first version read `this._grid` — the LEGACY
  // SculptGL drawable whose render call is commented out. It is invisible, it still carries a
  // matrix, and that matrix sits about 35 units below anything anyone poses, so the clamp could
  // never fire and the feature did nothing at all. The old check asserted "it reads a grid's
  // matrix", which was true of the dead one, so it passed. Assert the VISIBLE grid instead.
  SCENE = cut(SCENE, '    const g = this._groundGrid;', '    const g = this._grid;', inject);
} else if (inject === 'physicsblind') {
  PHYS = cut(PHYS, "  if (main && typeof main.groundHeight === 'function') return main.groundHeight();",
    '  // asking Scene removed', inject);
} else if (inject === 'modewipes') {
  IKS = cut(IKS, "  joint._boneIKPin = now | (pin._pinAboveGround ? IKSolver.PIN_ABOVE_GROUND : 0);",
    '  joint._boneIKPin = now;', inject);
} else if (inject === 'packedinmode') {
  IKS = cut(IKS, '  const p = IKSolver.pinObject(joint);\n  if (p) return !!p._pinAboveGround;',
    '  const p = IKSolver.pinObject(joint);\n  if (p) return !!((p._pinMode | 0) & 7 & 8);', inject);
} else if (inject === 'clampafterlerp') {
  // Move the clamp to the very end, after the weight lerp has already run.
  IKS = cut(IKS, '    if (out.y < gy) out.y = gy;\n  }\n  const w = IKSolver.pinWeight(joint);',
    '  }\n  const w = IKSolver.pinWeight(joint);\n  if (out.y < gy0) out.y = gy0;', inject);
  IKS = cut(IKS, '    const gy = IKSolver.groundHeight(main);',
    '    const gy = IKSolver.groundHeight(main); gy0 = gy;', inject + '-a');
  IKS = cut(IKS, 'IKSolver.pinAnchor = function (joint, out, main) {',
    'IKSolver.pinAnchor = function (joint, out, main) { let gy0 = -Infinity;', inject + '-b');
  IKS = cut(IKS, '  const here = Skeleton.jointPos(joint, _vWeight);\n  return out.set(here.x + (out.x - here.x) * w,',
    '  const here = Skeleton.jointPos(joint, _vWeight);\n  out.set(here.x + (out.x - here.x) * w,', inject + '2');
} else if (inject === 'noserialize') {
  SKEL = cut(SKEL, "        | (((m._boneIKPin | 0) & 8) ? 128 : 0),", '        ,', inject);
} else if (inject === 'noresolve') {
  IKS = cut(IKS, "    window._ikPinsDirty = true;    // the target moved, so the chain has to re-solve",
    '    // not marked dirty', inject);
} else if (inject === 'noloadflag') {
  SKEL = cut(SKEL, '        p.pin._pinAboveGround = p.above;', '        // not set', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) { console.log('  ok   ' + n); return; }
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const fnBody = (src, name) => {
  const at = src.indexOf(name + ' = function');
  return at < 0 ? '' : src.slice(at, src.indexOf('\n};', at));
};
// fnBody stops BEFORE the closing brace (it is written for regex reads), so an eval of it needs
// the brace put back. Kept separate rather than changing fnBody, which every regex check above
// relies on being exactly the body text.
const fnEval = (src, name, ...binds) => {
  const b = fnBody(src, name);
  const txt = b.slice(b.indexOf('function')) + '\n}';
  return new Function(...binds.map((x) => x[0]), 'return ' + txt)(...binds.map((x) => x[1]));
};

// ── 1. THE GROUND AUTHORITY ───────────────────────────────────────────────────────────
// THE CHECK THAT MATTERS IS "WHICH GRID", NOT "IS IT A GRID". The first version of this harness
// asserted that groundHeight read a grid's matrix — which was true of `this._grid`, the LEGACY
// drawable whose render call is commented out. Invisible, still matrixed, sitting ~35 units
// below anything anyone poses. Every check passed and the feature did nothing. So the assertions
// below are about the VISIBLE object and the SPACE it is measured in.
const GH = SCENE.slice(SCENE.indexOf('  groundHeight() {'),
                       SCENE.indexOf('  initGrid() {'));
const groundHeight = new Function('return function (' + '){' + GH.slice(GH.indexOf('{') + 1,
  GH.lastIndexOf('}')) + '}')();

{
  // `_groundGrid` is a THREE.GridHelper added to `_worldGroup`; `_grid` is the dead one.
  const scene = {
    _groundGrid: { position: { y: -0.25 } },
    _grid: { getMatrix: () => { const m = new Float32Array(16); m[13] = -35.36; return m; } },
  };
  check('the floor is the VISIBLE grid\'s height',
    Math.abs(groundHeight.call(scene) - (-0.25)) < 1e-9,
    'got ' + groundHeight.call(scene));
  check('...and NOT the legacy `_grid`, whose render call is commented out',
    Math.abs(groundHeight.call(scene) - (-35.36)) > 1,
    'reading the dead drawable puts the floor ~35 units below anything anyone poses, so the '
      + 'clamp never fires and the whole feature silently does nothing — which is exactly how '
      + 'this shipped the first time');
  check('...answering 0 rather than throwing when there is no grid yet',
    groundHeight.call({ _groundGrid: null }) === 0);
  // NO 0.701 CONVERSION. `_worldGroup` IS model space — every mesh's three object is added to
  // it, so a child's local transform is its model matrix, and `_groundGrid.position.y` is
  // already in the same space as Skeleton.jointPos. Applying the group's scale here would put
  // the floor on the three-world side while the joints stayed on the model side, which is the
  // two-spaces trap the motion-path work already paid for once.
  check('...and it is NOT scaled by _worldGroup, because the joints are on that side too',
    !/0\.701/.test(GH) && !/worldGroup/.test(GH.replace(/\/\/[^\n]*/g, '')),
    'the grid and the joints both live inside _worldGroup, so they compare directly');
}

// PhysicsBones must ask the same authority, or the app still has two floors — one for feet and
// one for tails.
const PGH = fnBody(PHYS, 'PhysicsBones.groundHeight');
check('physics bones ask Scene for the floor too, not their own number',
  /typeof main\.groundHeight === 'function'/.test(PGH),
  'the ground option on a physics chain and the ground clamp on a pin have to mean the same '
    + 'plane, or a tail and a foot rest at different heights in the same scene');
check('...with `_groundY` kept as an explicit override, not as the only source',
  /main\._groundY !== undefined/.test(PGH));

// ── 2. FLAG, NOT MODE ─────────────────────────────────────────────────────────────────
// The whole design rests on this: the flag composes with all four modes, so it must not live in
// the mode field. Run setPin for real against a stub and cycle the mode.
const KEEPS  = fnBody(IKS, 'IKSolver.keepsAboveGround');
const SETKEEP = fnBody(IKS, 'IKSolver.setKeepAboveGround');
const SETPIN = fnBody(IKS, 'IKSolver.setPin');

const IK = { PIN_ABOVE_GROUND: 8, makePinObject: () => null, pinObject: (j) => j._boneIKPinObj || null };
IK.keepsAboveGround   = fnEval(IKS, 'IKSolver.keepsAboveGround', ['IKSolver', IK]);
IK.setKeepAboveGround = fnEval(IKS, 'IKSolver.setKeepAboveGround', ['IKSolver', IK]);
IK.setPin             = fnEval(IKS, 'IKSolver.setPin', ['IKSolver', IK], ['Skeleton', null]);

{
  const pin = { _pinMode: 0 };
  const joint = { _boneIKPinObj: pin, _boneIKPin: 0 };
  IK.setPin(joint, 1, null);                 // 3DOF
  IK.setKeepAboveGround(joint, true);
  check('the toggle reads back on', IK.keepsAboveGround(joint) === true);
  check('...and does not disturb the pin mode',
    (joint._boneIKPin & 7) === 1, 'mode = ' + (joint._boneIKPin & 7));

  // THE FAILURE THE DESIGN EXISTS TO PREVENT. `setPin` takes a `& 7` mode and rewrites the
  // field; a flag packed in there is erased on every cycle of the A button, so the toggle would
  // appear to un-tick itself at random — present in the file, gone in the session.
  IK.setPin(joint, 2, null);                 // cycle 3DOF -> 6DOF
  check('cycling the pin mode does NOT clear the flag',
    IK.keepsAboveGround(joint) === true,
    'the flag lives on the pin object precisely so `& 7` cannot mask it away');
  check('...and the mode still changed', (joint._boneIKPin & 7) === 2);
  check('...and the file mirror carries the flag alongside the new mode',
    (joint._boneIKPin & 8) === 8, '_boneIKPin = ' + joint._boneIKPin);

  IK.setKeepAboveGround(joint, false);
  check('turning it off clears both the object flag and the file mirror',
    IK.keepsAboveGround(joint) === false && (joint._boneIKPin & 8) === 0);
  check('...still without disturbing the mode', (joint._boneIKPin & 7) === 2);
}

// ── 3. THE CLAMP, AND WHERE IT SITS ───────────────────────────────────────────────────
const ANCHOR = fnBody(IKS, 'IKSolver.pinAnchor');
check('every read of a pin target goes through pinAnchor, so the clamp is there',
  /IKSolver\.keepsAboveGround\(joint\)/.test(ANCHOR) && /if \(out\.y < gy\) out\.y = gy;/.test(ANCHOR));

// BEFORE the weight lerp. Ordering, not taste: the clamp says where the PIN is, and the lerp
// says how much of it applies. Clamp after and a half-active pin holds a different height from a
// full one, so fading a pin in would slide the contact point — the exact pop the weight channel
// exists to avoid.
{
  const iC = ANCHOR.indexOf('if (out.y < gy) out.y = gy;');
  const iW = ANCHOR.indexOf('const w = IKSolver.pinWeight(joint);');
  check('...and it runs BEFORE the weight lerp, not after',
    iC > 0 && iW > 0 && iC < iW,
    'clamping after the lerp makes the contact height depend on the pin weight, so a pin '
      + 'fading in would drag the foot through the floor on the way');
}

// The ground is asked for per solve, from the main that is now threaded in — not from a global
// or a module-level cache that a second scene would read wrongly.
check('pinAnchor takes `main` explicitly rather than reaching for a global',
  /IKSolver\.pinAnchor = function \(joint, out, main\)/.test(IKS));
check('...and all three call sites pass it',
  (IKS.match(/IKSolver\.pinAnchor\((?:j|joint), new THREE\.Vector3\(\), main\)/g) || []).length === 3,
  'found ' + (IKS.match(/IKSolver\.pinAnchor\([^)]*\)/g) || []).length + ' calls');

// ── 4. THE MARKER IS NEVER MOVED ──────────────────────────────────────────────────────
// THE DESIGN THIS FEATURE ARRIVED AT, after two builds that failed in the headset.
//
// Both earlier versions also clamped the pin OBJECT so the marker would sit on the floor. Every
// drag tool recomputes a pin's matrix ABSOLUTELY each frame — the grab-start matrix times the
// controller delta — and never reads back where the pin is now, so anything else writing that
// matrix is a second writer. The tool puts the pin under the floor, the clamp lifts it, and they
// alternate: matt got "the pins totally freeze when the pin moves below the ground", then
// "still freezing and popping, not sliding". Clamping before the tool's own write was tried and
// was still not enough. Clamping ONLY the target is what he confirmed works.
//
// So these assert an ABSENCE, which is the only kind of check that keeps a proven-wrong
// mechanism from being helpfully reintroduced later.
check('nothing clamps the pin OBJECT — the marker goes where the user points it',
  !/enforceGround\s*=/.test(IKS) && !/clampMatrixToGround/.test(IKS),
  'moving the marker makes a second writer that argues with the drag every frame: popping, and '
    + 'a `pinsMoved` watcher that cannot tell intent from correction, which is the freeze');
check('...and no drag tool clamps a pin before writing it either',
  !/clampMatrixToGround/.test(GRAB) && !/clampMatrixToGround/.test(TVR),
  'clamping before the write was the second attempt and still popped');
check('...so the ONLY ground clamp in the solver is the one in pinAnchor',
  (IKS.match(/out\.y = gy/g) || []).length === 1,
  'more than one clamp is more than one writer');

// ── 5. PERSISTENCE ────────────────────────────────────────────────────────────────────
// Bit 7, above every flag already in the word. Appended rather than inserted so a file written
// here still reads correctly in an older build: the bit is ignored there and the pin comes back
// with its mode intact and the clamp off, which is the pre-feature behaviour.
check('the flag is written to bit 7 of the bone word',
  /\| \(\(\(m\._boneIKPin \| 0\) & 8\) \? 128 : 0\)/.test(SKEL));
check('...and read back out of it, separately from the mode',
  /function pinAboveGroundOf\(bone\) \{ return \(bone & 128\) \? 8 : 0; \}/.test(SKEL));
check('...without being folded into pinModeOf, which must keep meaning only the mode',
  /function pinModeOf\(bone\) \{ return \(\(bone >> 1\) & 3\) \| \(\(bone >> 2\) & 4\); \}/.test(SKEL));

{
  // Round-trip every mode against both flag states, so a packing mistake cannot hide in one
  // combination. This is the check that would have caught a bit 7 collision with `hidden` (64).
  const pack = new Function('m', 'hidden', 'return (m._isBone ? 1 : 0) | (((m._boneIKPin | 0) & 3) << 1)'
    + ' | (m._selectLocked ? 8 : 0) | (((m._boneIKPin | 0) & 4) << 2)'
    + ' | (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0)'
    + ((inject === 'noserialize') ? '' : ' | (((m._boneIKPin | 0) & 8) ? 128 : 0)') + ';');
  const modeOf   = new Function('bone', 'return ((bone >> 1) & 3) | ((bone >> 2) & 4);');
  const aboveOf  = new Function('bone', 'return (bone & 128) ? 8 : 0;');
  let allOk = true, why = '';
  for (const mode of [1, 2, 3, 4]) {
    for (const above of [0, 8]) {
      for (const lock of [false, true]) {
        for (const hid of [false, true]) {
          const m = { _isBone: true, _boneIKPin: mode | above, _selectLocked: lock, _isWeightCage: false };
          const w = pack(m, hid);
          if (modeOf(w) !== mode || aboveOf(w) !== above) {
            allOk = false; why = 'mode ' + mode + ' above ' + above + ' lock ' + lock
              + ' hidden ' + hid + ' -> word ' + w + ' reads mode ' + modeOf(w) + ' above ' + aboveOf(w);
          }
        }
      }
    }
  }
  check('every mode round-trips with the flag both ways, alongside lock and hidden', allOk, why);
}

// THE LIVE STORE IS THE PIN OBJECT, so a load that sets only `_boneIKPin` produces a rig whose
// file says on and whose session says off — the clamp would be dead until toggled twice.
check('loading sets the flag on the pin OBJECT, not only in the joint mirror',
  /p\.pin\._pinAboveGround = p\.above;/.test(SKEL));
check('...and the pre-v3 migration path sets it too',
  /made\._pinAboveGround = p\.above;/.test(SKEL));
check('...carried from the file through pendingPins',
  /above: !!pinAboveGroundOf\(row\.bone\)/.test(SKEL));

// A mirrored plant is still a plant: mirroring a pose mirrors the pin setup, and a right foot
// that sinks while the left one holds is the mirror visibly not having worked.
check('mirroring a pose carries the flag to the twin',
  /above: !!pin\._pinAboveGround,/.test(SKEL) && /pin\._pinAboveGround = was\.above;/.test(SKEL));

// ── 6. UNDO ───────────────────────────────────────────────────────────────────────────
const TOG = fnBody(IKS, 'IKSolver.togglePinGround');
check('the toggle is undoable', /pushStateCustom/.test(TOG));

// ── 7. THE RING ───────────────────────────────────────────────────────────────────────
// Gated on `now` like Weight is, so an UNPINNED joint's ring stays at the five wedges it has
// always had and only the already-pinned case reaches seven — inside the eight the menu's own
// note allows for.
const CMDS = SCENE.slice(SCENE.indexOf('  _resolvePinCommands() {'),
                         SCENE.indexOf('  _resolvePinWeightCommands(joint) {'));
check('the toggle is on the pin ring', /IKSolver\.togglePinGround\(this, joint\)/.test(CMDS));
check('...only when there is a pin to toggle', /if \(now\) cmds\.push\(\{\s*\n\s*label: IKSolver\.keepsAboveGround/.test(CMDS));
check('...labelled with its state, since dimming would say the wrong thing for a toggle',
  /'Ground: On' : 'Ground: Off'/.test(CMDS));
check('...and it is NOT a fifth pin mode', !/IKSolver\.PIN_ABOVE_GROUND,\s*'/.test(CMDS));

// ── 8. THE TOGGLE DOES NOT RELOCATE ANYTHING ──────────────────────────────────────────
// Undo carries the FLAG ONLY. An earlier version also captured and restored the pin's position,
// because switching the clamp on used to lift a buried pin. Nothing lifts it now, so restoring a
// position would mean undoing this toggle silently moved a pin the user had since dragged
// elsewhere — a worse bug than the one it was guarding against.
const TOG2 = fnBody(IKS, 'IKSolver.togglePinGround');
check('the toggle stores no pin position in its undo',
  !/setModelSpaceMatrix/.test(TOG2),
  'there is no position to restore any more, and restoring a stale one relocates the pin');
check('...but it does re-solve, or the foot sits where it was until something else moves',
  /_ikPinsDirty = true/.test(TOG2));

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
