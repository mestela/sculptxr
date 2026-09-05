import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let failures = 0;
const check = (name, ok, got = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + got));
  if (!ok) failures++;
};

let reg = read('src/editing/AnimationRegistry.js');
const grab = read('src/editing/tools/Grab.js');
const xf = read('src/editing/tools/Transform.js');
const vr = read('src/editing/tools/TransformVR.js');
let tl = read('src/gui/GuiTimeline.js');

// Defect injections (standing lesson 1) — source-level, since these checks read the source:
//   REC_INJECT=noparkstart  a finished non-looping take is left on its last frame again
//   REC_INJECT=livechannel  an unrecorded channel takes the LIVE value, baking in the hand you
//                           switched off
//   REC_INJECT=onepath      only one of the two capture paths goes through the gate
//   REC_INJECT=menucloses   the channel menu closes on every toggle, like a command menu
{
  const i = process.env.REC_INJECT || '';
  const cut = (src, a, b, what) => {
    if (!src.includes(a)) throw new Error('inject ' + what + ': the anchor moved');
    return src.replace(a, b);
  };
  if (i === 'noparkstart') reg = cut(reg, 'const t0 = window._animLoopStart ?? 0;', 'const t0 = -1;', i);
  else if (i === 'livechannel') reg = cut(reg, 'P: ch.translate ? P : was.p,', 'P: P,', i);
  else if (i === 'onepath') reg = cut(reg,
    'const g = this._gateChannels(this.activeMesh.getID(), elapsed,', 'const g = ({ P: (', i);
  else if (i === 'menucloses') tl = cut(tl,
    "const cmd = this._recOptCommands()[Math.floor((ry - rr.y) / rr.cellH)];",
    "const cmd = this._recOptCommands()[0]; this._recOptMenuOpen = false;", i);
}
const acp = read('src/gui/htmlvr/AnimationControlPanel.js');
const mainMenu = read('src/gui/htmlvr/MainMenuPanel.js');
const desktopPanel = read('src/gui/GuiAnimation.js');
const oldVrPanel = read('src/gui/vr/GuiVRAnimation.js');
const scene = read('src/Scene.js');
const skel = read('src/editing/Skeleton.js');
const bonePanel = read('src/gui/bonePanel.js');
const timelineHelper = read('src/gui/TimelineHelper.js');
const exportSgl = read('src/files/ExportSGL.js');
const importSgl = read('src/files/ImportSGL.js');

check('recording owns one begin-interaction transition', /beginInteraction\(mesh\)/.test(reg));
check('recording owns one end-interaction transition', /endInteraction\(mesh\)/.test(reg));
for (const [name, src] of [['Grab', grab], ['Transform', xf], ['TransformVR', vr]]) {
  check(name + ' starts recording through the shared interaction hook', /beginInteraction\?\.\(/.test(src));
  check(name + ' stops recording through the shared interaction hook', /endInteraction\?\.\(/.test(src));
}
check('the legacy VR Record button uses the shared toggle',
  /anim_record[\s\S]{0,500}?toggleRecord\?\.\(\)/.test(oldVrPanel));
check('the legacy desktop Record button uses the shared toggle',
  /record\(\)[\s\S]{0,120}?toggleRecord\?\.\(/.test(desktopPanel));
check('loop mode gates transform recording wrap',
  /_animLoopEnabled !== false[\s\S]{0,100}?_animMasterDuration/.test(reg));
check('recording follows playback speed and stops at a non-looping range end',
  /Number\.isFinite\(this\.globalPlaybackTime\)/.test(reg)
    && /const stopAtRangeEnd = window\._animLoopEnabled === false/.test(reg)
    && /if \(stopAtRangeEnd\) this\.stopRecording\(\)/.test(reg));
check('loop mode gates playback wrap',
  /lEnd > lStart && window\._animLoopEnabled !== false/.test(reg));
check('discarding a tiny take still clears the recording lifecycle',
  /seqTimes\[count - 1\] < 0\.5[\s\S]{0,1200}?this\.isRecording = false/.test(reg));
check('start-on-grab returns to a coherent waiting state after each take',
  /_animWaitingForGrab = !!\(window\._animArmed && window\._animWaitForTrigger\)/.test(reg));

const header = +(tl.match(/const HEADER_H = (\d+);/)?.[1] || 0);
check('recording controls use the expanded toolbar area, not the gutter',
  header >= 80 && /let rx = 205;[\s\S]{0,1800}?x: rx, y: 31, h: 20/.test(tl),
  'HEADER_H=' + header);
check('frame ruler starts below both toolbar rows',
  /const rulerY = TOOLBAR_BOTTOM;/.test(tl));
check('playhead cap stays inside the ruler strip',
  /const capStartY = TOOLBAR_BOTTOM;/.test(tl));
check('horizontal key edits do not clamp to the old duration',
  /const newTime = Math\.max\(0, key\.time \+ dt\);/.test(reg)
    && !/Math\.min\(masterDuration, key\.time \+ dt\)/.test(reg));
check('later key edits extend animation duration but never playback range',
  /_extendDurationForTime\(time\)[\s\S]{0,250}?_animMasterDuration = time;/.test(reg)
    && !/_extendDurationForTime\(time\)[\s\S]{0,250}?_animLoopEnd/.test(reg));
check('playback never moves a carefully positioned viewport',
  !/_followPlaybackViewport/.test(tl));
check('dopesheet scrubbing uses the visible viewport too',
  /loopStart = this\._viewStart !== undefined \? this\._viewStart : loopStart;[\s\S]{0,120}?visibleDuration = this\._viewDuration/.test(tl));
for (const id of ['loop', 'trigger', 'countin', 'reset-rig']) {
  check('timeline exposes ' + id, tl.includes(`id: '${id}'`));
}
check('timeline exposes editable playback range fields',
  tl.includes("id: 'range-start'") && tl.includes("id: 'range-end'")
    && /_editPlaybackRange\('start', hit\)/.test(tl)
    && /_editPlaybackRange\('end', hit\)/.test(tl));
check('timeline exposes a canvas-native playback speed combobox',
  /const PLAYBACK_SPEEDS = \[0\.25, 0\.5, 0\.75, 1, 1\.5, 2\];/.test(tl)
    && tl.includes("id: 'speed'")
    && /_drawSpeedMenu\(ctx\)/.test(tl)
    && /window\._animPlaybackSpeed = speed/.test(tl));
check('selected objects delete whole animation tracks',
  /deleteAnimationForIds\(ids\)/.test(reg)
    && /selectedAnimationIds\(\)/.test(tl)
    && /const active = this\._main\.getMesh\?\.\(\)/.test(tl)
    && /for \(const key of window\._animSelectedKeys \|\| \[\]\)/.test(tl));
// The PROPERTY is that timeline focus reaches the real scene selection. Do not pin the argument
// list: `setMesh(mesh, true)` (keepTool, so clicking a curve cannot switch your active tool) is
// the same claim, and the exact-spelling version of this check called that a regression.
// What keepTool itself guarantees is asserted in graph_target_test, against Scene.js.
// setMesh -> setOrUnsetMesh at v3.20.160, so a dopesheet name can ADD to the selection with the
// modifier held rather than always replacing it. keepTool stays true either way.
check('timeline row and key focus update real scene selection',
  /this\._main\.setOrUnsetMesh\?\.\(mesh, _multi, true\)/.test(tl)
    && /Last-click wins/.test(tl));
// PICKING RULES LIVE IN rigpick_test.mjs, and only there. This file used to carry its own copy
// of the VR proximity assertions, which is the same-rule-in-N-places bug in the tests
// themselves: the next person to touch Picking.js fixes one harness and is failed by the other.
// rigpick_test asserts the same properties and asserts them better — it LIFTS the score
// expression and evaluates it, rather than matching the constants as spellings.
// PER-HAND COLOURS ARE GONE, deliberately. Tinting whatever each controller touched by
// handedness put a third and fourth colour on a surface that already has to say "aimed at" and
// "selected", and the hand doing it is the one thing you can already see. matt: "the red/green
// highlighting with the grab tool for the left/right controller is confusing." What survives is
// the map itself — the visuals still need to know a pin is IN A HAND rather than aimed at, and
// that now reads as selected.
check('a held pin is still published to the visuals',
  /_rigGrabHands/.test(grab) && /_syncXRPinGrabs/.test(grab));
check('...but not as a per-hand colour',
  !/RIGHT_HAND_COLOR|LEFT_HAND_COLOR/.test(skel),
  'held reads as selected now; two more colours on the rig is what was confusing');
check('bones remain directly selectable beside pins and retain their own animation focus',
  !/setOrUnsetMesh\(mesh, multiSelect\) \{\s*mesh = IKSolver\.controlFor/.test(scene)
    && /var mesh = picking\.getMesh\(\)/.test(grab)
    && /let mesh = hit \? picking\.getMesh\(\) : null/.test(grab)
    && /const mesh = this\.getMesh\(\)/.test(vr));
check('XR hover and cursor state recover after system overlays',
  /session\.addEventListener\('visibilitychange'/.test(scene)
    && /session\.addEventListener\('inputsourceschange'/.test(scene)
    && /_recoverXRTransientInput\('frame interruption'\)/.test(scene)
    && /this\._rigHoverAtVR = 0/.test(scene));
check('non-loop recording parks without automatic playback',
  /window\._animLoopEnabled !== false/.test(reg)
    && /startPlayback\(direction = 1\)/.test(reg));
check('animation clear button is selection scoped',
  acp.includes('Delete animation from selected objects')
    && /deleteAnimationFromSelectedObjects/.test(acp));
check('timeline more menu is canvas native for desktop and VR',
  /_drawContextMenu\(ctx\)/.test(tl)
    && /_contextMenuCommands\(\)/.test(tl)
    && !/_openContextMenu\(/.test(tl));
check('graph key dragging has a 50px sticky axis lock',
  /const KEY_DRAG_FREE_THRESHOLD = 50;/.test(tl)
    && /Math\.abs\(dragDX\) >= KEY_DRAG_FREE_THRESHOLD[\s\S]{0,100}?Math\.abs\(dragDY\) >= KEY_DRAG_FREE_THRESHOLD/.test(tl)
    && /dragAxis === 'value'\) dt = 0/.test(tl)
    && /dragAxis === 'time' \? 0 : targetVal/.test(tl));
check('two-controller time zoom is enabled in the dopesheet',
  /this\._mode === 'graph' \? !this\._hitTestCurve\(cx, cy\) : this\._mode === 'dope'/.test(tl)
    && /z\.mode === 'graph'/.test(tl)
    && /empty timeline space/.test(scene));
check('Grab owns existing pins independently by controller',
  /this\._vrPinGrabs = new Map\(\)/.test(grab)
    && /this\._vrPinGrabs\.set\(hand, \{ pin, offset, startMatrix: mat4\.clone\(gm\) \}\)/.test(grab)  // was `last`, a running
    // baseline; the grab-time offset replaced it — see scratchpad/pingrab_test.mjs
    && /this\._vrPinGrabs\.get\(controller\.handedness\)/.test(grab));
check('two-hand rig gestures shield the wrist MiniHUD',
  /blocksMiniHudInput\(\)/.test(grab)
    && /this\._vrPinGesture \|\| this\._vrPinGrabs\.size > 0/.test(grab)
    && /const _miniHudBlocked = .*blocksMiniHudInput/.test(scene)
    && /if \(!_miniHudBlocked && this\._miniPanel/.test(scene)
    && /\.\.\.\(!_miniHudBlocked \? \[\{ name: 'MiniPanel'/.test(scene));
// Still ONE batched solve after every held pin has been applied -- the solve simply moved into
// the else of the rotation-only branch, which does not solve at all (see grabchannel_test).
check('two pin targets are applied before one batched IK solve',
  /\} else if \(moved\) \{\s*\n\s*this\._queueXRPinSolve\(\);/.test(grab)
    && /queueMicrotask\(\(\) => this\._flushXRPinSolve\(\)\)/.test(grab)
    && /_flushXRPinSolve\(\)[\s\S]{0,250}?IKSolver\.holdPins/.test(grab));
// Depth, not distance: the solve must sit at the function's own indentation, i.e. outside the
// per-controller loop. Measuring the gap in characters breaks the moment a comment is added.
check('...and the solve is still OUTSIDE the per-controller loop',
  /\n    if \(moved && rotateOnly\) \{/.test(grab) && /\n    \} else if \(moved\) \{/.test(grab),
  'a solve per hand would be two solves for a two-handed gesture');
check('VR pin solve avoids a duplicate skeleton visual rebuild',
  /XR's render loop rebuilds skeleton visuals every frame/.test(grab)
    && !((/_flushXRPinSolve\(\) \{([\s\S]*?)\n  \}\n\n  _queueXRPinSolve/.exec(grab)?.[1] || '')
      .includes('Skeleton.updateVisuals')));
check('Grab reads both controllers from the complete Scene snapshot',
  /const activeControllers = \[left, right\]\.filter\(Boolean\)/.test(grab)
    && !/callerHand/.test(grab));
check('Scene supplies the actual stylus ray for every controller',
  /rayOrigin: controllerRayOrigin/.test(scene)
    && /rayDirection: controllerRayDirection/.test(scene)
    && /const stylusLen = this\.getStylusLength\(\)/.test(scene)
    && /Math\.sin\(stylusTilt\) \* stylusLen/.test(scene)
    && /Math\.cos\(stylusTilt\) \* stylusLen/.test(scene));
check('secondary trigger reaches Grab instead of activating temporary Smooth',
  /activeTool\.constructor\.name !== 'Grab'/.test(scene));
check('Grab hides the brush radius cursor',
  /tool\.constructor\.name === 'Grab'/.test(scene)
    && /cursorGroup\.visible = !isTransformTool/.test(scene));
check('bone display exposes pins independently from joints',
  /pins: \['_boneShowPins', 'boneShowPins', true\]/.test(skel)
    && /const showPins = Skeleton\.displayFlag\('pins'\)/.test(skel)
    && /flagButton\(c, 'pins', 'Pins'/.test(bonePanel)
    && /flag\('pins', 'pins'\)/.test(bonePanel));
check('Grab preselects rig targets under both controller rays',
  /Skeleton\.hoverRigFromRays\(this\._main, picking, hoverRays/.test(grab)
    && /main\._skelHighlightIds = jointIds/.test(skel)
    && /main\._pinHighlightIds = pinIds/.test(skel)
    && /filter\(\(m\) => m\.isVisible\(\) && isRigNode\(m\)\)/.test(skel));
check('a free controller keeps preselecting while the other holds a pin',
  /const freeHoverRays = activeControllers/.test(grab)
    && /!this\._vrPinGrabs\.has\(controller\.handedness\)/.test(grab)
    && /Skeleton\.hoverRigFromRays\(this\._main, picking, freeHoverRays/.test(grab)
    && /_rigHoverAtVR/.test(skel) && /_rigHoverAtMouse/.test(skel));
check('VR Grab skips desktop mouse preselection',
  /if \(!this\._main\._xrSession && !this\._grabbedMesh\)/.test(grab));
check('two-hand pin undo and recording close on final release',
  /if \(this\._vrPinGrabs\.size === 0 && this\._vrPinGesture\)/.test(grab)
    && /Two-hand pin pose/.test(grab)
    && /endInteraction\?\.\(before\.recordMesh\)/.test(grab));
check('two-hand pin recording registers and captures every acquired pin',
  /addInteractionTarget\?\.\(pin\)/.test(grab)
    && /!startedRecording && \(registry\?\.isRecording \|\| registry\?\.isCountingIn\)/.test(grab)
    && /this\.recordingTargets = \[mesh\]/.test(reg)
    && /for \(const target of targets\) this\._writeTransformKey\(target, elapsed\)/.test(reg)
    && /const statesAfter = new Map\(\)/.test(reg));
check('main Animation panel exposes Loop', acp.includes('id="acp-loop-enabled"'));
check('main Animation panel exposes Reset Rig + Pins', acp.includes('id="acp-reset-rig"'));
check('clearing animation preserves the manually authored playback range',
  !/resetAll\(\)[\s\S]{0,700}?_animMasterDuration\s*=/.test(reg)
    && /_animMasterDuration = window\._animMasterDuration \?\? 2\.0/.test(desktopPanel));
check('dense animation diamonds render at half size without shrinking their hit areas',
  /ctx\.moveTo\(kx, ky - 3\.5\)/.test(timelineHelper)
    && /ctx\.fillRect\(-2\.5, -2\.5, 5, 5\)/.test(timelineHelper)
    && /isKeyHovered\(kx, ky,[\s\S]{0,80}?10\)/.test(timelineHelper)
    && /ctx\.moveTo\(x, y - 2\.5\)/.test(tl));
check('native scene files preserve the authored playback range',
  // NOT pinned to a version number: the subject is the loop-range round trip, and a literal
  // `= 13` here fails the day the format gains a field, which is exactly what it did.
  /Export\.VERSION = \d+/.test(exportSgl)
    && /f32a\[off\+\+\] = window\._animLoopStart/.test(exportSgl)
    && /f32a\[off\+\+\] = window\._animLoopEnd/.test(exportSgl)
    && /version >= 13[\s\S]{0,180}?window\._animLoopStart = f32a\[off\+\+\][\s\S]{0,100}?window\._animLoopEnd = f32a\[off\+\+\]/.test(importSgl));
// v14. Pin weight and physics blend weight were keyable and solve-critical but had no place in
// the file, so every keyed fade was dropped on save -- and because pinWeight defaults to 1 for a
// channel-less pin, the reload came back with every pin fully ON and the rig collapsed.
check('scalar channels (pin + physics weight) survive a save',
  /u32a\[off\+\+\] = _scal \? _scal\.size : 0/.test(exportSgl)
    && /_scal\.forEach[\s\S]{0,1200}?f32a\[off\+\+\] = st\.values\[_sk\]/.test(exportSgl)
    && /version >= 14[\s\S]{0,2000}?sTrack\.scalarTracks\.set\(sName, _st\)/.test(importSgl),
  'a keyed pin fade is lost on save, and reloads as a permanently-on pin');
check('...written for every mesh, count first, so the byte offset stays aligned',
  /u32a\[off\+\+\] = _scal \? _scal\.size : 0/.test(exportSgl)
    && /nbBytes \+= 64 \+ 4 \+ st\.times\.length \* 28/.test(exportSgl));

check('loading a project frames the editor to its restored playback range',
  /framePlaybackRange\(\)[\s\S]{0,260}?this\._viewStart = start[\s\S]{0,80}?this\._viewDuration = Math\.max\(0\.1, end - start\)/.test(tl)
    && /fileType === 'sgl'[\s\S]{0,100}?framePlaybackRange/.test(scene));
check('VR timeline uploads only after a throttled canvas redraw',
  /now - this\._lastVRDrawAt >= 33/.test(tl)
    && /this\._drawRevision = \(this\._drawRevision \|\| 0\) \+ 1/.test(tl)
    && /revision !== this\._vrTimelineUploadedRevision/.test(scene));
check('graph redraws publish their VR texture revision',
  /if \(this\._mode === 'graph'\) \{[\s\S]{0,500}?_drawRevision[\s\S]{0,80}?return;/.test(tl));
check('VR clear-scene confirmation rebuilds the Files menu',
  /const rebuildFiles = \(\) => \{[\s\S]{0,120}?_lastContentKey = ''[\s\S]{0,80}?_refreshContent\(\)/.test(mainMenu)
    && /main\._clearSceneConfirm = false;[\s\S]{0,60}?rebuildFn\(\);/.test(mainMenu));


// ── A FINISHED TAKE PARKS AT THE START WHEN LOOP IS OFF ──────────────────────
//
// The looping case rewinds and plays, so you see the take. The non-looping case did neither: it
// stopped the clock and left the playhead on the LAST frame, which is the one place from which
// nothing you do next makes sense — play replays nothing, and recording again starts from the
// end. matt: "when the recording is finished it should get out of record mode, and jump back to
// the first frame."
check('a non-looping take parks the playhead at the range start',
  /const t0 = window\._animLoopStart \?\? 0;\s*\n\s*this\.globalPlaybackTime = t0;\s*\n\s*window\._animCurrentTime = t0;/.test(reg),
  'left on the last frame, the transport has nowhere sensible to go next');
check('...the range START, not zero, so a range beginning partway in still works',
  /window\._animLoopStart \?\? 0/.test(reg));
check('...and it evaluates once, so the viewport is not left on the last pose',
  /if \(m\) this\.update\(m, true\);/.test(reg),
  'the clock would say frame one while the model still showed the end of the take');
check('...but a MANUAL abort is left where it was',
  /window\._animPlaying = false;[\s\S]{0,1800}?if \(!isManualAbort\) \{/.test(reg),
  'stopping a take by hand is not the take finishing; yanking the playhead would be rude');
check('...and a finished take asks for a frame',
  /window\.app\?\.render\?\.\(\);/.test(reg),
  'the take changes the keys, the trail rebuilds inside render(), and desktop renders on '
    + 'demand — so without this nothing on screen says the take finished');
check('...and record mode comes off either way',
  /this\.isRecording = false;[\s\S]{0,200}?this\.isCountingIn = false;/.test(reg));

// ── WHICH CHANNELS A TAKE WRITES ─────────────────────────────────────────────
//
// A key is one TRS sample in three parallel arrays indexed in lockstep, so "rotation only"
// cannot mean writing fewer numbers — every key still needs a position and a scale. It means
// the other channels come out UNCHANGED, and the only honest source for "unchanged" is the
// animation as it stood before the take. Taking the live value would bake your hand into a
// channel you switched off; freezing one value would flatten animation that channel already had.
check('the channel set is read live-then-saved-then-on, like every other setting',
  /translate: read\('_recTranslate', 'recTranslate'\)/.test(reg)
    && /rotate: read\('_recRotate', 'recRotate'\)/.test(reg)
    && /scale: read\('_recScale', 'recScale'\)/.test(reg));
check('...defaulting to ALL THREE ON',
  /return v == null \? true : !!v;/.test(reg),
  'a recorder that quietly drops a channel is worse than one that records too much');
check('an unrecorded channel is filled from the PRE-TAKE animation',
  /_preTakeTRS\(id, time\)/.test(reg)
    && /this\._trackStatesBeforeRecording &&\s*\n?\s*this\._trackStatesBeforeRecording\.get\(id\)/.test(reg),
  'the live value bakes in the hand you switched off; a frozen value flattens what was there');
// The substitution ITSELF, per channel. The check above proves the pre-take value is fetched;
// this proves it is USED. REC_INJECT=livechannel removes the ternary and left the first version
// of this section passing, because "the snapshot is read" and "the snapshot is written" are two
// different claims.
check('...and each channel actually takes it when switched off',
  /P: ch\.translate \? P : was\.p,/.test(reg)
    && /Q: ch\.rotate \? Q : was\.q,/.test(reg)
    && /S: ch\.scale \? S : was\.s,/.test(reg));
check('...and when there was no prior animation the live value stands',
  /if \(!was\) return \{ P, Q, S \};/.test(reg),
  'a key has to hold something, and there is nothing to preserve');
check('...with the quaternion taking the SHORT arc between pre-take keys',
  /const sgn = d < 0 \? -1 : 1;/.test(reg),
  'the long way round reads as the object spinning between two keys it should pass straight through');
check('the gate is applied at ONE point, and both capture paths go through it',
  (reg.match(/_gateChannels\(/g) || []).length === 3,
  'the same rule written into each capture path is how the two come to disagree');
check('...and the all-on case returns untouched, so the default costs nothing',
  /if \(ch\.translate && ch\.rotate && ch\.scale\) return \{ P, Q, S \};/.test(reg));

// The dropdown itself.
check('the record button has a channel dropdown beside it',
  /id: 'recopts'/.test(tl) && /case 'recopts':/.test(tl));
check('...offering all three channels',
  /row\('Translate', ch\.translate/.test(tl) && /row\('Rotate', ch\.rotate/.test(tl)
    && /row\('Scale', ch\.scale/.test(tl));
// Sliced to the hit-test block rather than searched whole-file: the "..." handler legitimately
// closes this menu on its way past, and a negative regex over the whole file caught that
// instead of the thing being asserted.
{
  const a = tl.indexOf('if (this._recOptMenuOpen) {');
  const blk = tl.slice(a, tl.indexOf('if (this._contextMenuOpen) {', a));
  const hit = blk.slice(0, blk.indexOf('this._recOptMenuOpen = false;'));
  check('...and it STAYS OPEN when one is clicked',
    /this\.draw\(\);\s*\n\s*return;/.test(hit) && !/= false/.test(hit),
    'these are switches, not commands: flipping two must not cost two trips to the menu');
}
check('...closing only on a click elsewhere, which still does its own job',
  /this\._recOptMenuOpen = false;[\s\S]{0,320}?this\.draw\(\);\s*\n\s*\}/.test(tl),
  'no early return on dismissal, so the closing click is not wasted');
check('...drawn canvas-native like the other menus, so VR gets it too',
  (tl.match(/_drawRecOptMenu\(ctx\)/g) || []).length === 3);
check('...and the arrow lights only when a channel is OFF',
  /active: !!_ch && !\(_ch\.translate && _ch\.rotate && _ch\.scale\)/.test(tl),
  'a quiet affordance normally, a warning when a take is about to ignore something');
check('the two menus are mutually exclusive',
  /case 'recopts':[\s\S]{0,180}?this\._contextMenuOpen = false;/.test(tl));

// A loop wrap is a discontinuity a simulation cannot see. It FLAGS rather than resetting inline:
// at this point the rig is still in the loop's last frame, so resetting here strands every
// particle where the previous pass ended (measured 48.7 units of error on pass two, worse than
// the 47.0 of no reset at all). PhysicsBones.tick consumes it once the frame is written.
check('a loop wrap flags the simulation for re-initialisation',
  /if \(wrapped\) window\._physicsNeedsInit = true;/.test(reg)
    && /const wrapped = this\.globalPlaybackTime > lEnd \|\| this\.globalPlaybackTime < lStart;/.test(reg),
  'physics carries the last frame of one pass into the first frame of the next');

// ── A SCRUB SEEDS THE SIM AFTER THE SOLVE, NOT BEFORE IT ──────────────────────────────
//
// seek() resets physics to put the rest pose back -- but that also seeds the particles from the
// pose AS IT IS AT THAT INSTANT, and holdPins has not run yet. The solve then moves the rig onto
// its pins, leaving every particle a solve behind, and the next physics step hauls all four
// chains back toward where the rig used to be. matt: "i can also stop playback, click the 'rewind
// to first frame' button that should reinit everything, the arms are still in the incorrect
// half-pinned pose."
//
// Measured on pinxpbd.sxr, rewinding after a pass and stepping once:
//   before   XPBD jumped 26.35 units and took ~40 frames to crawl back; the FORCE solver jumped
//            55.96 and settled at 34.13, i.e. it never came back to rest at all
//   after    XPBD 0.03, force solver settles at 1.63
check('a scrub re-seeds the simulation after the frame is solved',
  /PhysicsBones\.reset\(main\);\s*\n\s*window\._physicsNeedsInit = true;/.test(reg),
  'the particles are a solve behind and the chains snap back toward the previous pose');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
