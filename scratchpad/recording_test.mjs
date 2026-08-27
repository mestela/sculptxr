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

const reg = read('src/editing/AnimationRegistry.js');
const grab = read('src/editing/tools/Grab.js');
const xf = read('src/editing/tools/Transform.js');
const vr = read('src/editing/tools/TransformVR.js');
const tl = read('src/gui/GuiTimeline.js');
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
check('timeline row and key focus update real scene selection',
  /this\._main\.setMesh\?\.\(mesh\b/.test(tl)
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
    && /this\._vrPinGrabs\.set\(hand, \{ pin, last:/.test(grab)
    && /this\._vrPinGrabs\.get\(controller\.handedness\)/.test(grab));
check('two-hand rig gestures shield the wrist MiniHUD',
  /blocksMiniHudInput\(\)/.test(grab)
    && /this\._vrPinGesture \|\| this\._vrPinGrabs\.size > 0/.test(grab)
    && /const _miniHudBlocked = .*blocksMiniHudInput/.test(scene)
    && /if \(!_miniHudBlocked && this\._miniPanel/.test(scene)
    && /\.\.\.\(!_miniHudBlocked \? \[\{ name: 'MiniPanel'/.test(scene));
check('two pin targets are applied before one batched IK solve',
  /if \(moved\) this\._queueXRPinSolve\(\)/.test(grab)
    && /queueMicrotask\(\(\) => this\._flushXRPinSolve\(\)\)/.test(grab)
    && /_flushXRPinSolve\(\)[\s\S]{0,250}?IKSolver\.holdPins/.test(grab));
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
  /Export\.VERSION = 13/.test(exportSgl)
    && /f32a\[off\+\+\] = window\._animLoopStart/.test(exportSgl)
    && /f32a\[off\+\+\] = window\._animLoopEnd/.test(exportSgl)
    && /version >= 13[\s\S]{0,180}?window\._animLoopStart = f32a\[off\+\+\][\s\S]{0,100}?window\._animLoopEnd = f32a\[off\+\+\]/.test(importSgl));
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
