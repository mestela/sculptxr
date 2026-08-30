// Node harness for MULTI-SELECTION — the secondary trigger as Ctrl.
//
// matt: "holding down the secondary controller trigger, click select then supports multi select,
// like holding control and selecting files on windows", in the outliner, Transform, Grab and the
// animation panel names.
//
// Almost none of this was new code. `setOrUnsetMesh` already had exact Ctrl-click semantics,
// the transform tools and the gizmo already act on getSelectedMeshes(), and the secondary
// trigger was already read every frame. What was missing was the wire between them. So these
// checks are mostly about COVERAGE — every place a selection is made honours the same rule —
// and about the one place it must NOT.
//
// Run: node scratchpad/multiselect_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   MS_INJECT=sculpt      the modifier is consulted by the brush base class too, where the same
//                         trigger already means smooth/negative
//   MS_INJECT=grabsingle  Grab's VR select goes back to replacing the selection
//   MS_INJECT=outliner    the outliner row goes back to single-select
//   MS_INJECT=dope        the dopesheet name goes back to single-select
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
let SCENE = R('src/Scene.js');
let GRAB = R('src/editing/tools/Grab.js');
let TVR = R('src/editing/tools/TransformVR.js');
let TR = R('src/editing/tools/Transform.js');
let SB = R('src/editing/tools/SculptBase.js');
let PANEL = R('src/gui/htmlvr/MainMenuPanel.js');
let TL = R('src/gui/GuiTimeline.js');
let GVR = R('src/editing/GizmoVR.js');

{
  const i = process.env.MS_INJECT || '';
  const cut = (src, a, b, what) => {
    if (!src.includes(a)) throw new Error('inject ' + what + ': anchor moved');
    return src.replace(a, b);
  };
  if (i === 'sculpt') SB = cut(SB, 'var mesh = null;',
    'if (main.multiSelectHeld?.()) ctrl = true;\n    var mesh = null;', i);
  else if (i === 'grabsingle') GRAB = cut(GRAB,
    'this._main.setOrUnsetMesh(mesh, this._main.multiSelectHeld?.(), true);',
    'this._main.setMesh(mesh);', i);
  else if (i === 'outliner') PANEL = cut(PANEL,
    'main.setOrUnsetMesh?.(mesh, _multi);', 'main.setOrUnsetMesh?.(mesh, false);', i);
  else if (i === 'dope') TL = cut(TL,
    'this._main.setOrUnsetMesh?.(mesh, _multi, true);',
    'this._main.setMesh?.(mesh, true);', i);
}

// COMMENTS ARE NOT CODE. The first version of the two checks below matched the identifier
// anywhere — including the comment in SculptBase that explains why the hook is deliberately
// absent. A check that fails on its own documentation teaches people to delete the
// documentation, so these read stripped source.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the primitive, evaluated ─────────────────────────────────────────────────
//
// Lifted and RUN rather than read: "adds, removes, never empties" is three rules on one array
// and reading them is exactly the kind of thing that looks right.
{
  const a = SCENE.indexOf('  setOrUnsetMesh(mesh, multiSelect, keepTool) {');
  const body = SCENE.slice(SCENE.indexOf('{', a) + 1, SCENE.indexOf('\n    this._mesh = mesh;', a));
  check('setOrUnsetMesh is liftable', body.length > 0);

  const run = (start, mesh, multi) => {
    const self = { _selectMeshes: start.slice(),
      getIndexSelectMesh: (m) => self._selectMeshes.indexOf(m) };
    new Function('mesh', 'multiSelect', body).call(self, mesh, multi);
    return self._selectMeshes;
  };
  const A = 'A', B = 'B';
  check('plain click replaces the selection', run([A], B, false).join() === 'B');
  check('modified click ADDS to it', run([A], B, true).join() === 'A,B');
  check('...and REMOVES one already in the set', run([A, B], A, true).join() === 'B',
    'that is what makes it a toggle rather than an accumulator');
  check('...but never empties it', run([A], A, true).join() === 'A',
    'an empty selection with a modifier held is a click that appears to do nothing');
  check('a null mesh still clears', run([A, B], null, false).length === 0);
}

// ── one rule, one place ──────────────────────────────────────────────────────
check('the modifier has a single definition',
  /multiSelectHeld\(\) \{\s*\n\s*return !!this\._vrSecondaryTriggerPressed;\s*\n\s*\}/.test(SCENE),
  'four copies of "is the secondary trigger down" is four chances to disagree');
check('...reading the flag Scene already computes every frame',
  /this\._vrSecondaryTriggerPressed = !!\(nonDomSource/.test(SCENE),
  'the gesture already existed and was already read — only the wire was missing');

// ── coverage: every selection path honours it ────────────────────────────────
for (const [what, src, pat] of [
  ['TransformVR', TVR, /setOrUnsetMesh\(mesh, ctrl \|\| main\.multiSelectHeld\?\.\(\)\)/],
  ['Transform (desktop)', TR, /setOrUnsetMesh\(_picked, ctrl \|\| main\.multiSelectHeld\?\.\(\)\)/],
  ['the outliner row', PANEL, /main\.setOrUnsetMesh\?\.\(mesh, _multi\)/],
  ['the dopesheet name', TL, /this\._main\.setOrUnsetMesh\?\.\(mesh, _multi, true\)/],
]) {
  check(what + ' honours the modifier', pat.test(src),
    'a selection path that ignores it makes the gesture unreliable, which is worse than absent');
}

// Desktop keyboard equivalents, where there is an event to read one from.
check('the outliner also takes Ctrl / Cmd / Shift',
  /e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/.test(PANEL));
check('...and so does the dopesheet, captured on pointer down',
  /this\._lastModifierDown = !!\(e && \(e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\)\);/.test(TL),
  'the row handlers are reached through several paths and none of them carry the event');

// ── AND THE PLACES IT MUST NOT REACH ────────────────────────────────────────
//
// GRAB IS EXCLUDED, and this was learned in the headset. Grab is a TWO-HANDED tool: the
// secondary trigger already means "the other hand takes a pin", which is the whole of two-handed
// posing. Wiring Ctrl onto it made holding the left trigger start an IK solve that dragged the
// skeleton off its pins — matt: "the skeleton started doing an ik solve and drifting away from
// the pins." Desktop Ctrl-click still works there, because a keyboard modifier does not collide
// with a second hand.
check('Grab does NOT consult the VR modifier',
  !/multiSelectHeld/.test(code(GRAB)),
  'the secondary trigger is the other hand’s grab in this tool');
check('...but desktop Ctrl-click still multi-selects there',
  /setOrUnsetMesh\(mesh, ctrl\)/.test(GRAB),
  'a keyboard modifier does not collide with the second hand');

// ── and the one place it must NOT reach ──────────────────────────────────────
//
// The same trigger is the smooth/negative override mid-stroke. The two meanings cannot share a
// button, so the brush base class must never consult it.
check('the brush base class does NOT consult the modifier',
  !/multiSelectHeld/.test(code(SB)),
  'the secondary trigger is smooth/negative during a stroke — unifying these breaks sculpting');
check('...and the dead sticky-mode flag is gone entirely',
  !/_vrMultiSelect/.test(code(SCENE)) && !/_vrMultiSelect/.test(code(SB))
    && !/_vrMultiSelect/.test(code(R('src/SculptGL.js'))),
  'a dead flag beside a live modifier is how someone later wires the wrong one');
check('...and a VR stroke starts explicitly single-select',
  /this\._sculptManager\.start\(false\);/.test(SCENE));

// ── the payoff already existed ───────────────────────────────────────────────
check('the transform tools already act on the whole selection',
  /var meshes = this\._main\.getSelectedMeshes\(\);/.test(TR)
    && /const sel = main\.getSelectedMeshes\(\);/.test(TVR),
  'building a set is only worth it because the tools already consume one');
check('...and so does the gizmo',
  (R('src/editing/Gizmo.js').match(/this\._main\.getSelectedMeshes\(\)/g) || []).length >= 5);


// ── A PRESS ON A MEMBER OF THE SET DOES NOT COLLAPSE IT ─────────────────────
//
// The gizmo already transformed getSelectedMeshes() everywhere — centre, snapshot and live
// write all iterate it — so multi-object transform worked all along. What broke it was the
// selection being reduced by the very press that started the drag. matt: "the gizmo jumps to the
// centroid of the selection, but as soon as i try to move it, it snaps to one of the selections,
// and moves only that one."
{
  check('Transform keeps a multi-selection when you press a member of it',
    /const _already = _picked && main\.getSelectedMeshes\(\)\.length > 1\s*\n?\s*&& main\.getIndexSelectMesh\(_picked\) >= 0;/.test(TR)
      && /if \(_already\) return false;/.test(TR),
    'reducing to one on press is what made only one object move');
  check('...and TransformVR does the same in start()',
    /if \(main\.getSelectedMeshes\(\)\.length > 1 && main\.getIndexSelectMesh\(mesh\) >= 0\) return true;/.test(TVR));
  // THE PATH THAT ACTUALLY RUNS IN THE HEADSET. matt was testing TransformVR, and the guard in
  // start() is on a different path — the press-to-reselect below is the one that collapsed the
  // set. Membership is the test rather than the modifier: you build the selection with the
  // modifier HELD and then RELEASE it to drag, so asking about the modifier here would always
  // say no.
  check('...and TransformVR’s press-to-reselect defers to membership',
    /const inSet = main\.getSelectedMeshes\(\)\.length > 1\s*\n\s*&& main\.getIndexSelectMesh\(picked\) >= 0;/.test(TVR)
      && /if \(!inSet\) \{/.test(TVR),
    'this is the press that begins the drag; reselecting here is what made the gizmo snap');
  check('...and GizmoVR transforms the whole set, which is why it is worth preserving',
    /let meshes = this\._main\.getSelectedMeshes\(\);/.test(fs.readFileSync(path.join(REPO, 'src/editing/GizmoVR.js'), 'utf8')),
    'the VR gizmo is a separate class from the desktop one and had to be checked separately');
  check('...only when there IS more than one, so ordinary click-to-select is untouched',
    /getSelectedMeshes\(\)\.length > 1/.test(TR));

  // The dopesheet has to be able to SEE a multi-selection, or the rows and Delete stay single.
  check('the timeline reports every selected object, not just the primary',
    /const _sel = this\._main\.getSelectedMeshes\?\.\(\) \|\| \[\];\s*\n\s*if \(_sel\.length > 1\) return _sel\.map\(\(m\) => m\.getID\(\)\);/.test(TL),
    'selectedAnimationIds answered with the primary only, so three selected objects highlighted '
      + 'one row and Delete acted on one track');
  check('...falling back to the last-click rule for a single selection',
    /if \(activeId != null && \(!keyIds\.size \|\| !keyIds\.has\(activeId\)\)\) return \[activeId\];/.test(TL),
    'that rule stops a stale key selection making Delete affect two things');
}


// ── THE VR TRANSFORM MOVES THE WHOLE SELECTION ──────────────────────────────
//
// TransformVR drags ONE mesh by design — `_dragMesh`, "MESH LOCKING" — and every mode computes
// its result against that single start matrix. The desktop Gizmo iterates the selection; this is
// a different class and never did. So the gizmo sat on the centroid and exactly one object
// moved. matt: "go to manipulate, only one pin moves."
//
// A DELTA, not a shared pose, and matt's own observation is why: the pins had "very different
// local transforms in both position and rotation", so there is no common matrix to write — only
// a common CHANGE.
{
  check('every selected object’s start pose is captured at gesture start',
    /this\._dragStart = new Map\(\);/.test(TVR)
      && /for \(const m of \(main\.getSelectedMeshes\(\) \|\| \[\]\)\)/.test(TVR),
    'the delta needs something to apply to');
  check('...in MODEL space, matching the matrix the delta is computed from',
    /if \(m\.getModelSpaceMatrix\) m\.getModelSpaceMatrix\(sm\);/.test(TVR));
  // A multi-selection's gizmo is a world-aligned frame at the median. Every mode must read
  // THAT frame -- if any one of them still reaches for the dragged mesh's own pos/rot, the
  // pivot looks right while the axes silently belong to whichever object was under the ray.
  check('no mode builds its gesture frame from the dragged mesh directly',
    !/vec3\.transformQuat\((?:vX|vY|vZ|axis), \w+, (?:rot|this\._startMeshRot)\)/.test(TVR)
      && !/vec3\.sub\(v(?:Start|Curr), [^,]+, this\._startMeshPos\)/.test(TVR)
      // ...including via an alias: `const qRot = this._startMeshRot` reinstates the whole
      // defect while every transformQuat line below still reads innocently as `qRot`.
      && /const qRot = gestureRot;/.test(TVR),
    'the pivot and the axes have to come from the same frame');
  check('...and that frame is world-aligned only when several are selected',
    /const multiGesture = !!\(this\._dragStart && this\._dragStart\.size > 1\);/.test(TVR)
      && /const gesturePos = multiGesture \? this\._dragPivot : this\._startMeshPos;/.test(TVR)
      && /const gestureRot = multiGesture \? quat\.create\(\) : this\._startMeshRot;/.test(TVR),
    'a single selection must keep its old local-frame behaviour exactly');
  // World-axis motion composes on the LEFT. Post-multiplying re-reads it as a local offset.
  check('multi-selection translate and scale compose on the left',
    /mat4\.multiply\(newMat, translationMatrix, this\._startMeshMatrix\);/.test(TVR)
      && /mat4\.multiply\(newMat, scaleDelta, this\._startMeshMatrix\);/.test(TVR),
    'world-space deltas premultiply; local ones postmultiply');

  check('the drag result is turned into a delta and applied to the rest',
    /mat4\.multiply\(delta, mat, inv\);/.test(TVR)
      && /mat4\.multiply\(om, delta, sm\);/.test(TVR),
    'reusing the per-mode maths rather than reimplementing it for N');
  check('...through ONE choke point, so all four modes are covered',
    (TVR.match(/this\._applyMatrix\(mesh, /g) || []).length >= 4
      && /_applyMatrixOne\(mesh, mat\) \{/.test(TVR),
    'translate, rotate, free and arcball all funnel through _applyMatrix');
  check('...and only when there is more than one selected',
    /this\._dragStart && this\._dragStart\.size > 1\s*\n?\s*\? this\._dragStart\.get\(mesh\) : null;/.test(TVR)
      && /if \(!start \|\| !mat4\.invert\(inv, start\)\) \{ this\._applyMatrixOne\(mesh, mat\); return; \}/.test(TVR),
    'a single-object drag must take exactly the path it always did');

  // A MIXED SELECTION IS THE TRAP. `_dragIsJoint` was decided once, for the mesh under the ray.
  // A joint is POSED through the solver; a pin is written. Applying one kind's rule to the other
  // would either stretch bones or refuse to move pins.
  check('the joint-vs-write rule is decided PER MESH',
    /if \(Skeleton\.isJoint\(mesh\) && window\._vrGizmoPose !== false\) \{/.test(TVR),
    'a gesture-wide flag applies the dragged mesh’s rule to everything else in the set');
  check('the start map is cleared when the gesture ends',
    (TVR.match(/this\._dragStart = null;/g) || []).length === 2,
    'a stale map would propagate a delta onto objects from a previous selection');
}


// ── ROTATE AND SCALE HAPPEN ABOUT THE MEDIAN ────────────────────────────────
//
// `mat * inv(start)` is position-INDEPENDENT for a translation, which is why translate worked on
// the whole set as soon as the delta existed. A rotation composed about the dragged mesh's own
// origin comes out as T(p) * R * T(-p) — a rotation about THAT mesh — so the rest orbited it, in
// its frame rather than the world's. matt: "rotate and scale... seem to operate around one of
// the selections and in its local space, not the midpoint in worldspace."
{
  check('the multi-object gesture frame is the world-aligned pivot',
    /const multiGesture = !!\(this\._dragStart && this\._dragStart\.size > 1\);/.test(TVR)
      && /const gesturePos = multiGesture \? this\._dragPivot : this\._startMeshPos;/.test(TVR)
      && /const gestureRot = multiGesture \? quat\.create\(\) : this\._startMeshRot;/.test(TVR),
    'the dragged mesh is only a target; its local position/rotation must not steer the gizmo');
  check('the visible VR gizmo uses that same world-aligned frame',
    /if \(meshes\.length === 1\) \{[\s\S]{0,700}?mat4\.getRotation\(qRot, unscaledMat\);/.test(GVR),
    'for a set there is no shared local frame; inheriting meshes[0] makes the rings lie');
  check('rotate and scale measure the controller from that pivot',
    (TVR.match(/vec3\.sub\(vStart, this\._startControllerPos, gesturePos\);/g) || []).length === 2
      && (TVR.match(/vec3\.sub\(vCurr, controllerPos, gesturePos\);/g) || []).length === 2,
    'otherwise the objects orbit the midpoint but the hand gesture still aims at one object');
  check('non-uniform multi-scale is composed in world space',
    /if \(multiGesture\) \{\s*\n\s*const scaleDelta = mat4\.fromScaling\(mat4\.create\(\), factors\);\s*\n\s*const newMat = mat4\.create\(\);\s*\n\s*mat4\.multiply\(newMat, scaleDelta, this\._startMeshMatrix\);/.test(TVR),
    'rebuilding the dragged mesh local TRS rotates the scale axes into that mesh frame');
  check('the linear part is re-hung on the pivot for rotate and scale',
    /const L = mat4\.clone\(delta\);\s*\n\s*L\[12\] = 0; L\[13\] = 0; L\[14\] = 0;/.test(TVR)
      && /mat4\.multiply\(delta, toC, L\);\s*\n\s*mat4\.multiply\(delta, delta, fromC\);/.test(TVR),
    'T(C) * L * T(-C) is the rotation about the median; the raw delta is about the dragged mesh');
  check('...and translate keeps the raw delta',
    /if \(this\._mode !== 0\) \{/.test(TVR),
    'a translation is position-independent, and free-move’s carried rotation should turn about '
      + 'the hand rather than the median');
  check('the pivot is the median of the START poses',
    /this\._dragPivot\[0\] \+= sm\[12\]; this\._dragPivot\[1\] \+= sm\[13\]; this\._dragPivot\[2\] \+= sm\[14\];/.test(TVR)
      && /vec3\.scale\(this\._dragPivot, this\._dragPivot, 1 \/ this\._dragStart\.size\);/.test(TVR),
    'read live it would drift as the objects move under it mid-gesture');
  check('...cleared with the rest of the gesture state',
    (TVR.match(/this\._dragPivot = null;/g) || []).length === 2);
  check('the dragged mesh orbits too, rather than being written separately',
    /for \(const \[m, sm\] of this\._dragStart\) \{[\s\S]{0,200}?this\._applyMatrixOne\(m, om\);/.test(TVR)
      && !/this\._applyMatrixOne\(mesh, mat\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*_applyMatrixOne/.test(TVR),
    'on a multi-selection every member moves by the same rule, the dragged one included');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
