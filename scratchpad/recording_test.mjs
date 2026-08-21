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
const desktopPanel = read('src/gui/GuiAnimation.js');
const oldVrPanel = read('src/gui/vr/GuiVRAnimation.js');
const scene = read('src/Scene.js');
const skel = read('src/editing/Skeleton.js');
const bonePanel = read('src/gui/bonePanel.js');
const picking = read('src/math3d/Picking.js');

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
check('timeline row and key focus update real scene selection',
  /this\._main\.setMesh\?\.\(mesh\)/.test(tl)
    && /Last-click wins/.test(tl));
check('VR rig picking is proximity-only and pins retain priority over bones',
  /physicalDistance = vec3\.len\(_TMP_RIG_W\) \* vrScale/.test(picking)
    && /_rigPickProximityVR \|\| 0\.11/.test(picking)
    && /var rScore = physicalDistance/.test(picking)
    && /isPin \? 2 : 1/.test(picking)
    && !/_rigPickConeVRPin/.test(picking));
check('VR pin hover and grab colors identify each controller',
  /RIGHT_HAND_COLOR = 0xf38ba8/.test(skel)
    && /LEFT_HAND_COLOR = 0xa6e3a1/.test(skel)
    && /_rigGrabHands/.test(grab));
check('pinned bones redirect selection and keying to their pins',
  /IKSolver\.controlFor\(mesh, this\)/.test(scene)
    && /const control = IKSolver\.controlFor\(m, this\)/.test(scene)
    && /IKSolver\.controlFor\(picking\.getMesh\(\), main\)/.test(grab)
    && /IKSolver\.controlFor\(picking\.getMesh\(\), this\._main\)/.test(grab)
    && /IKSolver\.controlFor\(this\.getMesh\(\), main\)/.test(vr));
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
    && /getStylusTilt\(\)/.test(scene));
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
