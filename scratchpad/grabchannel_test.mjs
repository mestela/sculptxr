// Node harness for the Grab tool's Translate / Rotate channels.
//
// matt: "at the moment i'm using the grab tool on an unpinned arm, but because grab does both
// position and rotation, it starts the ik solver solving."
//
// A 6DOF grab always produces both, because a hand cannot move without also turning. That is
// what you want on a pin, and exactly wrong on a JOINT: any translation at all makes it an IK
// effector, so there is no way to simply turn a bone. With translation off the joint stays put,
// nothing asks the solve for a new position, and the rotation is a plain FK turn.
//
// Run: node scratchpad/grabchannel_test.mjs
//   GC_INJECT=bothoff     both channels can be off at once, so the grab silently does nothing
//   GC_INJECT=stalebaseline  the delta baseline survives from the previous grab, so the first
//                         frame of a new one applies an arbitrary rotation
//   GC_INJECT=bonesolves  the BONE branch ignores the channels and solves with full 6DOF
//   GC_INJECT=boneorient  translation-only still passes the orientation, so a twist turns the
//                         limb
//   GC_INJECT=stillsolves  a rotation-only grab queues a solve again, so the chain resolves
//   GC_INJECT=noack       the solve is skipped but the pin caches are not acknowledged, so
//                         Scene's watcher schedules one a frame later
//   GC_INJECT=deadarm     the repaint moves below the arm GRAB already matches, so the buttons
//                         toggle the setting and never light
//   GC_INJECT=livematrix  the suppressed half is read back off the live matrix each frame
//                         instead of the pose the grab started in
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let CH = fs.readFileSync(path.join(REPO, 'src/editing/grabChannels.js'), 'utf8');
let GRAB = fs.readFileSync(path.join(REPO, 'src/editing/tools/Grab.js'), 'utf8');
let PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
let PANEL_INJ = false;
const OPTS = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');

const inject = process.env.GC_INJECT || '';
const cut = (src, a, b, n) => {
  if (!src.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'bothoff') {
  CH = cut(CH, '  if (!t && !r) return { translate: true, rotate: true };', '', inject);
} else if (inject === 'stalebaseline') {
  // Anchored on the comment above it, which is unique -- the assignment itself appears three
  // times (acquire, release, lost tracking) and cut() would take whichever came first.
  GRAB = cut(GRAB,
    "          // follow my rotation with that offset\" means.\n          this._lastControllerMatrix = null;",
    '          // (removed)', inject);
} else if (inject === 'bonesolves') {
  // The bone branch goes back to solving with the full 6DOF, ignoring the channels.
  GRAB = cut(GRAB, '              if (!_ch.translate) {', '              if (false) {', inject);
} else if (inject === 'boneorient') {
  GRAB = cut(GRAB, '                             _ch.rotate ? _grabQ : null);',
    '                             _grabQ);', inject);
} else if (inject === 'stillsolves') {
  GRAB = cut(GRAB, 'if (moved && rotateOnly) {', 'if (false) {', inject);
} else if (inject === 'noack') {
  GRAB = cut(GRAB, '      IKSolver.syncPinCache(this._main);\n      IKSolver.syncJointCache(this._main);',
    '', inject);
} else if (inject === 'deadarm') {
  // The repaint moves back below the arm GRAB already matches, where it can never run.
  PANEL_INJ = true;
} else if (inject === 'livematrix') {
  GRAB = cut(GRAB, '        const start = state.startMatrix;',
    '        const start = state.pin.getModelSpaceMatrix ? state.pin.getModelSpaceMatrix() : null;',
    inject);
}

if (PANEL_INJ) {
  const a = `      if (idx === Enums.Tools.GRAB) {
        const gch = GrabChannels.channels();
        extrasEl.querySelector('#mp-grab-translate')?.classList.toggle('active', gch.translate);
        extrasEl.querySelector('#mp-grab-rotate')?.classList.toggle('active', gch.rotate);
      }`;
  if (!PANEL.includes(a)) throw new Error('inject deadarm: anchor moved');
  PANEL = PANEL.replace(a, '')
    .replace("    } else if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {",
      `    } else if (idx === Enums.Tools.GRAB) {
      const gch = GrabChannels.channels();
      extrasEl.querySelector('#mp-grab-translate')?.classList.toggle('active', gch.translate);
      extrasEl.querySelector('#mp-grab-rotate')?.classList.toggle('active', gch.rotate);
    } else if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {`);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Run the channel logic for real.
const body = CH.split('\n').filter((l) => !/^import /.test(l)).join('\n')
  .replace(/^export default GrabChannels;$/m, '');
const mk = (opts) => new Function('window', 'getOptionsURL',
  body + '\nreturn GrabChannels;')({}, () => opts);

// ── DEFAULTS ──────────────────────────────────────────────────────────────────────────
{
  const G = mk({});
  const ch = G.channels();
  check('both channels are on by default, so an ordinary grab is unchanged',
    ch.translate === true && ch.rotate === true, JSON.stringify(ch));
}
check('...and both are persisted settings',
  /options\.grabTranslate = queryBool\(getVal\('grabTranslate'\), true\);/.test(OPTS)
    && /options\.grabRotate = queryBool\(getVal\('grabRotate'\), true\);/.test(OPTS));

// ── ONE OFF AT A TIME ─────────────────────────────────────────────────────────────────
{
  const G = mk({ grabTranslate: false, grabRotate: true });
  check('translation can be switched off on its own',
    G.channels().translate === false && G.channels().rotate === true);
}
{
  const G = mk({ grabTranslate: true, grabRotate: false });
  check('rotation can be switched off on its own',
    G.channels().rotate === false && G.channels().translate === true);
}

// ── BOTH OFF IS NOT A STATE ───────────────────────────────────────────────────────────
//
// A grab that does nothing looks exactly like a broken grab, and there is no feedback that
// would tell you which it was.
{
  const G = mk({ grabTranslate: false, grabRotate: false });
  const ch = G.channels();
  check('both off falls back to both on, rather than a dead tool',
    ch.translate === true && ch.rotate === true, JSON.stringify(ch));
}
{
  const win = {};
  const G = new Function('window', 'getOptionsURL',
    body + '\nreturn GrabChannels;')(win, Object.assign(() => ({}), { saveOption: () => {} }));
  G.setChannel('rotate', false);
  G.setChannel('translate', false);   // turning off the last one...
  const ch = G.channels();
  check('turning off the last channel turns the other back on',
    ch.translate === false && ch.rotate === true,
    JSON.stringify(ch) + ' -- the one you just switched off wins, the other comes back');
}

// ── THE GATE ITSELF ───────────────────────────────────────────────────────────────────
check('the VR grab substitutes the suppressed half from the START pose',
  /const start = state\.startMatrix;/.test(GRAB)
    && /startMatrix: mat4\.clone\(gm\)/.test(GRAB),
  'read back off the live matrix each frame, the half that IS applied leaks into the half '
    + 'that is not');
check('...translation off keeps the position it was taken at',
  /if \(!_ch\.translate\) \{ next\[12\] = start\[12\]; next\[13\] = start\[13\]; next\[14\] = start\[14\]; \}/.test(GRAB));
check('...rotation off keeps the 3x3, leaving the translation alone',
  /for \(const i of \[0, 1, 2, 4, 5, 6, 8, 9, 10\]\) next\[i\] = start\[i\];/.test(GRAB));
check('...and the gate is skipped entirely when both are on',
  /if \(!_ch\.translate \|\| !_ch\.rotate\) \{/.test(GRAB),
  'the ordinary 6DOF grab must not pay for a feature it is not using');

// ── ROTATION-ONLY MUST NOT SOLVE AT ALL ───────────────────────────────────────────────
//
// Suppressing the position was not enough: the solve still ran, and a ROTATED constraint is
// just as much a constraint as a moved one, so the whole chain re-solved against it. matt: "if
// i grab the elbow and rotate it, the entire skeleton tries to resolve... it is not isolating
// to a pure fk rotation."
check('a rotation-only grab does not queue a solve',
  /if \(moved && rotateOnly\) \{/.test(GRAB)
    && /\} else if \(moved\) \{\s*\n\s*this\._queueXRPinSolve\(\);/.test(GRAB),
  'the joint has not moved, so there is nothing for the solver to satisfy that it was not '
    + 'already satisfying');
// ...and skipping it is only half the job.
check('...but it DOES acknowledge the pin caches',
  /IKSolver\.syncPinCache\(this\._main\);\s*\n\s*IKSolver\.syncJointCache\(this\._main\);/.test(GRAB),
  'Scene watches the pin matrices and schedules a solve of its own when one changes without '
    + 'the solver knowing -- skip the solve without acknowledging and the watcher runs one a '
    + 'frame later, so the chain resolves anyway');
check('...and repaints, since nothing else will',
  /Skeleton\.updateVisuals\(this\._main\);\s*\n\s*this\._main\.render\(\);/.test(GRAB));
check('the flag is set per grabbed object, from the channel state',
  /if \(!_ch\.translate\) rotateOnly = true;/.test(GRAB));

// ── THE BONE PATH, WHICH IS A DIFFERENT ONE ───────────────────────────────────────────
//
// A grabbed PIN goes through _updateXRPinGrabs; a grabbed BONE goes through updateXR's
// `_grabIsJoint` branch, which hands position AND orientation to IKSolver.solve. Gating only
// the pin path left this untouched, so the buttons appeared to do nothing at all -- matt: "i
// put it into rotate mode... the bone follows the translation of my controller."
//
// Both paths, or the feature works on whichever object you did not test with.
{
  const at = GRAB.indexOf('if (this._grabIsJoint) {');
  const branch = at < 0 ? '' : GRAB.slice(at, GRAB.indexOf('\n            for (let i = 0', at));
  check('the bone branch was found', branch.length > 0);
  check('the bone branch asks which channels are on',
    /const _ch = GrabChannels\.channels\(\);/.test(branch),
    'the pin path is not the only way to grab something');
  check('...rotation-only writes the joint directly and never calls solve',
    /if \(!_ch\.translate\) \{[\s\S]{0,1200}?setModelSpaceMatrix\(_grabM\.elements\)/.test(branch)
      && !/if \(!_ch\.translate\) \{[\s\S]{0,1200}?IKSolver\.solve/.test(branch),
    'a rotated constraint makes the solver rearrange the whole chain, which is the thing being '
      + 'avoided');
  check('...keeping the position it was grabbed at',
    /_grabPrevT\.set\(jm\[12\], jm\[13\], jm\[14\]\);/.test(branch));
  check('...and acknowledging the caches so the watcher does not undo it',
    /IKSolver\.syncJointCache\(this\._main\);\s*\n\s*IKSolver\.syncPinCache\(this\._main\);/.test(branch));
  check('translation-only passes NO orientation to the solve',
    /_ch\.rotate \? _grabQ : null\);/.test(branch),
    'an orientation is a constraint when present -- leaving it in is what made a twist of the '
      + 'wrist turn the limb');
}

// ── THE DELTA BASELINE BELONGS TO ONE GRAB ────────────────────────────────────────────
//
// The tool acquires from the digital triggers rather than the stroke lifecycle, so a grab taken
// on a frame that was not a stroke has no release to run -- and the baseline survived into the
// next grab. The first frame then computed `current * inv(where the hand was when you let go
// last time)`: one arbitrary rotation, then correct tracking. matt: "the arm pops to some
// random angle, then follows my fk rotation."
{
  const at = GRAB.indexOf('this._activeController = active; // First assignment');
  const acquire = at < 0 ? '' : GRAB.slice(at, at + 1200);
  check('acquiring a mesh clears the delta baseline',
    /this\._lastControllerMatrix = null;/.test(acquire),
    'so the next frame re-seeds it from the hand\'s current pose and the first delta is '
      + 'identity');
  // ...and it must still be cleared on the other two exits, or a stale one comes back.
  check('...as do release and lost tracking',
    (GRAB.match(/this\._lastControllerMatrix = null;/g) || []).length >= 3);
  check('the first frame after seeding produces no motion',
    /if \(!this\._lastControllerMatrix \|\| this\._activeController\.handedness !== this\._lastHandedness\) \{[\s\S]{0,300}?mat4\.copy\(this\._lastControllerMatrix, currentMat\);/.test(GRAB),
    'it stores the pose and waits -- there is no delta to apply yet');
}

// ── THE PANEL ─────────────────────────────────────────────────────────────────────────
check('the wrist panel offers both buttons on Grab',
  /id="mp-grab-translate"/.test(PANEL) && /id="mp-grab-rotate"/.test(PANEL));
check('...wired through GrabChannels, not by writing the globals directly',
  /GrabChannels\.setChannel\(which, !GrabChannels\.channels\(\)\[which\]\)/.test(PANEL),
  'the both-off rule lives in one place');
check('...and they light to match the current state',
  /querySelector\('#mp-grab-translate'\)\?\.classList\.toggle\('active', gch\.translate\)/.test(PANEL));
// UNREACHABLE BRANCH. The sync is one if/else chain and GRAB matches an earlier arm, so a
// second `else if (idx === GRAB)` below it never runs -- the buttons toggled the setting and
// never repainted. The repaint has to live in the arm that actually matches.
{
  const at = PANEL.indexOf('_syncExtrasActive');
  const chain = at < 0 ? '' : PANEL.slice(at, PANEL.indexOf('\n  _buildExtrasHTML', at));
  const arms = (chain.match(/(?:\} else )?if \(idx === Enums\.Tools\.GRAB\)/g) || []).length;
  const inBone = /idx === Enums\.Tools\.BONE_DRAW \|\| idx === Enums\.Tools\.GRAB\) \{[\s\S]{0,600}?#mp-grab-translate/.test(chain);
  check('the grab buttons repaint in the arm the tool actually reaches',
    inBone,
    'GRAB matches the BONE_DRAW arm first; anything later in the chain is dead code');
  check('...and there is no second, unreachable GRAB arm below it',
    arms <= 1, arms + ' GRAB arms in the sync chain');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
