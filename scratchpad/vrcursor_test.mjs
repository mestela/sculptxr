// Node harness for WHICH HAND SHOWS THE BRUSH CURSOR in VR.
//
// matt: starting the GalaxyXR screen recorder made the radius sphere disappear, while the rest
// of the app carried on — "strange that the rest of the app is unaffected". It is not strange:
// the cursor is the ONLY thing in the app whose visibility is gated on `_activeHandedness`, and
// the recorder's overlay trips the transient-input recovery, which was clearing that latch. The
// cursor then fell back to a hard-coded 'right' and a left-handed user lost it entirely.
//
// Three separate places had to agree that "no latch yet" means "the dominant hand": the
// constructor, the recovery, and the fallback itself. Two of them said 'right'.
//
// Run: node scratchpad/vrcursor_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   VC_INJECT=hardright   the fallback hard-codes 'right' again, so a left-handed user has no
//                         cursor until they squeeze a trigger
//   VC_INJECT=wipemap     an empty-source frame wipes the handedness mapping again — the
//                         actual reported bug
//   VC_INJECT=noremap     the missing-mapping rebuild is gone, so a wipe is unrecoverable
//   VC_INJECT=culled      the cursor is frustum-culled again, so a screen recorder's secondary
//                         view culls it against the wrong projection
//   VC_INJECT=shapeonly   the cursor is kept only for SHAPE takes again, so hitting record on
//                         an ordinary transform take hides the radius sphere
//   VC_INJECT=clearlatch  the recovery forgets the sculpting hand again, which is what the
//                         recorder overlay was triggering
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');

{
  const inj = process.env.VC_INJECT || '';
  if (inj === 'hardright') {
    const a = "isActiveHand = (source.handedness === (this._dominantHand || 'right'));";
    if (!SRC.includes(a)) throw new Error('inject hardright: anchor moved');
    SRC = SRC.replace(a, "isActiveHand = (source.handedness === 'right');");
  } else if (inj === 'wipemap') {
    // A frame with no input sources wipes the handedness mapping again — which only a
    // 'connected' event can rebuild, and that event does not fire when a session un-blurs.
    const a = '    // A FRAME WITH NO INPUT SOURCES IS NOT A DISCONNECTION';
    if (!SRC.includes(a)) throw new Error('inject wipemap: anchor moved');
    SRC = SRC.replace(a, '    this._vrControllerLeft = null;\n    this._vrControllerRight = null;\n' + a);
  } else if (inj === 'noremap') {
    const a = "        const known = h === 'left' ? this._vrControllerLeft : this._vrControllerRight;";
    if (!SRC.includes(a)) throw new Error('inject noremap: anchor moved');
    SRC = SRC.replace(a, '        const known = true;');
  } else if (inj === 'culled') {
    // The cursor goes back to being frustum-culled, so a secondary view — a screen recorder
    // attached — makes three cull it against the wrong projection and it vanishes.
    const a = '            _c.traverse((o) => { o.frustumCulled = false; });';
    if (!SRC.includes(a)) throw new Error('inject culled: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'shapeonly') {
    // The recording exception goes back to SHAPE takes only, so hitting record on an ordinary
    // transform take hides the radius sphere — the reported bug.
    const a = 'cursorGroup.visible = !isTransformTool && (!window._animPlaying || _rec);';
    if (!SRC.includes(a)) throw new Error('inject shapeonly: anchor moved');
    SRC = SRC.replace(a, 'cursorGroup.visible = !isTransformTool && (!window._animPlaying'
      + " || (_rec && window._animKeyMode === 'shape'));");
  } else if (inj === 'clearlatch') {
    const a = '    this._vrLockedHand = null;';
    if (!SRC.includes(a)) throw new Error('inject clearlatch: anchor moved');
    SRC = SRC.replace(a, '    this._vrLockedHand = null;\n    this._activeHandedness = null;');
  }
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── which hand gets the cursor, evaluated ────────────────────────────────────
{
  const i = SRC.indexOf('let isActiveHand = true;');
  const block = SRC.slice(i, SRC.indexOf('if (!isActiveHand', i));
  check('the active-hand rule is liftable', i > 0 && block.length > 0);

  const active = ({ latch = null, dominant = 'right', hand = 'right' }) =>
    new Function('source', 'return (function () { ' + block + ' return isActiveHand; })'
      + '.call(this, source);')
      .call({ _activeHandedness: latch, _dominantHand: dominant }, { handedness: hand });

  // A LATCH WINS when there is one — that is the whole point of latching.
  check('a latched hand gets the cursor', active({ latch: 'left', hand: 'left' }) === true);
  check('...and the other hand does not', active({ latch: 'left', hand: 'right' }) === false);
  check('the latch beats the dominant hand',
    active({ latch: 'left', dominant: 'right', hand: 'left' }) === true,
    'you squeezed with that hand; that is a stronger statement than a setting');

  // NO LATCH -> THE DOMINANT HAND, which is the bug this fixes. The app has always known which
  // hand that is; this line was ignoring it.
  check('with no latch, the dominant hand gets it',
    active({ latch: null, dominant: 'left', hand: 'left' }) === true,
    'hard-coded "right" here is why a left-handed user had no cursor at all');
  check('...and the off hand does not',
    active({ latch: null, dominant: 'left', hand: 'right' }) === false);
  check('a right-handed user is unaffected',
    active({ latch: null, dominant: 'right', hand: 'right' }) === true
      && active({ latch: null, dominant: 'right', hand: 'left' }) === false,
    'the fix must not move the common case');
  check('and with no dominant hand recorded either, it still picks one',
    active({ latch: null, dominant: undefined, hand: 'right' }) === true,
    'never leave BOTH hands without a cursor — that is the reported symptom');
}

// ── the latch is a preference, not transient input state ─────────────────────
//
// The recovery exists for genuinely transient things: an in-flight stroke, the menu latch, the
// pointing flags. Which hand you sculpt with is not one of them, and a system overlay stealing
// focus for a moment is no reason to forget it.
{
  const i = SRC.indexOf('_recoverXRTransientInput(reason');
  const body = SRC.slice(i, SRC.indexOf('console.info', i));
  check('the recovery is liftable', i > 0 && body.length > 0);
  check('the recovery does NOT clear the sculpting hand',
    !/^\s*this\._activeHandedness = null;/m.test(body),
    'this is what the recorder overlay was tripping; the cursor is the only thing gated on it');
  // It must still clear the things that ARE transient, or the fix has thrown out the recovery.
  for (const f of ['_vrSculpting', '_vrLockedHand', '_vrMenuTriggerLatch', '_isPointingAtMenu'])
    check('...but still clears ' + f, new RegExp('this\\.' + f + ' = ').test(body),
      'the recovery has a job; keeping the latch must not cost it that job');
}

// ── and the constructor agrees ───────────────────────────────────────────────
{
  const m = /this\._activeHandedness = ([^;]+);\n\s*this\._vrScale/.exec(SRC);
  check('the initial latch is liftable', !!m);
  check('it starts empty rather than "right"', m && m[1].trim() === 'null',
    'seeding it to a hand is the same bug at startup: a left-handed user has no cursor '
    + 'until they squeeze a trigger');
}

// All three places have to agree on what "no latch" means, or the one that disagrees is the bug.
// Scoped to the CURSOR path: plenty of other code compares handedness to 'right' to answer
// "which physical controller is this", which is a different question and entirely fine.
{
  const i = SRC.indexOf('let isActiveHand = true;');
  const block = SRC.slice(i, SRC.indexOf('if (!isActiveHand', i));
  check('no hard-coded hand is left in the cursor fallback',
    !/=== 'right'/.test(block) && /this\._dominantHand/.test(block),
    'the fallback, the recovery and the constructor must all defer to _dominantHand');
}


// ── PLAYBACK HIDES THE CURSOR; RECORDING MUST NOT ────────────────────────────
//
// The actual cause of the reported bug, and nothing to do with the headset's screen recorder.
// `_animPlaying` means two things — watching an animation back, and performing one — and this
// is the ONLY thing in the app that reads it for visibility, which is why the rest of the UI
// carried on regardless. The exception was carved for SHAPE takes alone; a TRANSFORM take is a
// performance too, and it is the ordinary one for posing.
{
  // Anchored on the `_rec` line: there are earlier `cursorGroup.visible = false` guards for
  // an unmapped handedness and the off hand, and matching the first one tests nothing.
  const m = /const _rec = [^\n]+\n\s*cursorGroup\.visible = (.+?);\n/.exec(SRC);
  check('the cursor visibility rule is liftable', !!m);
  if (m) {
    const vis = (o = {}) => new Function('isTransformTool', '_rec', 'window',
      'return (' + m[1] + ');')(!!o.tool, !!o.rec,
      { _animPlaying: !!o.playing, _animKeyMode: o.mode || 'transform' });

    check('idle: the cursor is shown', vis({}) === true);
    check('playback: hidden', vis({ playing: true }) === false,
      'nobody wants a brush ring over a playback');

    // THE BUG. Recording sets _animPlaying, so a transform take looked like playback.
    check('recording a TRANSFORM take: shown', vis({ playing: true, rec: true }) === true,
      'this is the report — hitting record made the radius sphere vanish');
    check('recording a SHAPE take: still shown',
      vis({ playing: true, rec: true, mode: 'shape' }) === true,
      'the case that already worked must keep working');
    check('...and the key mode no longer decides it',
      vis({ playing: true, rec: true, mode: 'blendshape' }) === true,
      'every take is a performance; the mode is not what makes the cursor useful');

    // The transform TOOL is a separate matter — gizmo-driven, genuinely no brush radius.
    check('the transform tool never shows one', vis({ tool: true }) === false
      && vis({ tool: true, rec: true, playing: true }) === false,
      'that hide is about the tool having no radius, not about playback');
  }
}


// ── THE CURSOR IS NEVER FRUSTUM-CULLED ───────────────────────────────────────
//
// The actual cause of "recording on the GalaxyXR hides the radius sphere". Screen recording
// adds a SECONDARY (first-person observer) view, so three sees three views rather than two, and
// its WebXRManager takes the else branch:
//
//     if ( cameras.length === 2 ) setProjectionFromUnion( cameraXR, cameraL, cameraR );
//     else cameraXR.projectionMatrix.copy( cameraL.projectionMatrix );   // "assume AR"
//
// `cameraXR.projectionMatrix` is what the CULLING frustum comes from, so with a recorder
// attached it becomes the left eye's projection instead of the union of both eyes. Culling then
// discards things that are plainly on screen — but only things that had not opted out.
//
// EVERY other overlay in this app opts out. The cursor was the only one that did not, which is
// the whole of "breaks only a small section of the app, not all of it".
{
  const i = SRC.indexOf('this._vrCursorLeft = createVRCursor();');
  const block = SRC.slice(i, i + 2200);
  check('the cursor group opts out of frustum culling',
    /_c\.frustumCulled = false;/.test(block),
    'a secondary view makes three cull against the wrong projection');
  check('...and so does every child, not just the group',
    /traverse\(\(o\) => \{ o\.frustumCulled = false; \}\)/.test(block),
    'three tests each drawable; a Group has no geometry to test');
  check('...for BOTH hands',
    /\[this\._vrCursorLeft, this\._vrCursorRight\]/.test(block));

  // The claim that makes this the explanation rather than a guess: the neighbouring overlays
  // already do it, and they are the ones that kept working.
  for (const [what, re] of [
    ['the rig batches', /m\.frustumCulled = false;/],
    ['the pin leader', /link\.frustumCulled = false;/],
  ]) check('for comparison, ' + what + ' already opted out',
    re.test(fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8')),
    'if these had not, they would have vanished too — and they did not');
}


// ── AN EMPTY FRAME IS NOT A DISCONNECTION ────────────────────────────────────
//
// THE reported bug, found by measurement rather than by me reasoning at it. Starting the
// GalaxyXR screen recorder blurs the session — `sources` 2 -> 0 for about a second, then back
// to 2. The per-frame input block treated that empty frame as a disconnection and wiped the
// handedness mapping, which ONLY the 'connected' listener rebuilds. No 'connected' fires on the
// way back, because the controllers were never really disconnected. So `_vrControllerRight`
// stayed null for the rest of the session, and the cursor block's first gate —
// `if (!controllerGroup) { cursorGroup.visible = false; continue; }` — hid the radius sphere
// for good. It is the only thing in the app that asks, which is the whole of "breaks only a
// small section".
//
// matt's log, exactly: frame 1358 `vis: visible -> visible-blurred, sources: 2 -> 0`; frame
// 1536 back again; frame 1537 `curVis: true -> false`, with nothing else moving.
{
  const i = SRC.indexOf('if (sources && sources.length > 0) {');
  const tail = SRC.slice(i, i + 6000);
  const elseBranch = tail.slice(tail.indexOf('\n    } else {'), tail.indexOf('\n    }\n', tail.indexOf('\n    } else {')));
  check('an empty-source frame does not wipe the mapping',
    !/_vrControllerLeft = null/.test(elseBranch) && !/_vrControllerRight = null/.test(elseBranch),
    'only the connected listener can rebuild it, and it does not fire on un-blur');

  // The 'disconnected' listener is the real signal, and it must still do its job.
  check('a genuine disconnect still clears it',
    /'disconnected'[\s\S]{0,400}?this\._vrControllerLeft = null;/.test(SRC),
    'not wiping on an empty frame must not mean never wiping');
  check('...and only for the controller that actually went',
    /this\._vrControllerLeft === controller/.test(SRC),
    'clearing by handedness alone would drop a mapping that had already been replaced');

  // Belt and braces: rebuild a missing mapping from the live sources.
  check('a missing mapping is rebuilt from the live sources',
    /const known = h === 'left' \? this\._vrControllerLeft : this\._vrControllerRight;/.test(SRC));
  check('...only filling gaps, so it never fights the connected listener',
    /if \(known\) continue;/.test(SRC),
    'overwriting a good mapping every frame is a different bug');
  check('...and it says so, because a silent repair hides the fault',
    /re-mapped ' \+ h \+ ' controller/.test(SRC));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
