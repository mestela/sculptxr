// Two bindings the Transform and Grab tools grew: the centre handle's optional 6DOF carry,
// and A pinning the joint under the ray. Both are shared with other code — the panels share a
// builder, the three tools share one pin cycle — so most of what can go wrong here is a second
// copy appearing, which is what these guards watch for.
//
// Run: node scratchpad/transformopts_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';
import { vec3, mat4, quat } from '/Users/mattestela/sculptxr/node_modules/gl-matrix/esm/index.js';

const REPO = '/Users/mattestela/sculptxr';
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const VR = read('src/editing/tools/TransformVR.js');
const GRAB = read('src/editing/tools/Grab.js');
const BONE = read('src/editing/tools/BoneDrawTool.js');
const BASE = read('src/editing/tools/SculptBase.js');
const IK = read('src/editing/IKSolver.js');
const MP = read('src/gui/htmlvr/MiniPanel.js');
const MM = read('src/gui/htmlvr/MainMenuPanel.js');
const XF = read('src/gui/transformPanel.js');
const OPTS = read('src/misc/getOptionsURL.js');
const SCENE = strip(read('src/Scene.js'));

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── The panels share one section ────────────────────────────────────────────────
check('the mini panel uses the shared transform section',
  /buildTransformSectionHTML\(this\._main, 'mp'\)/.test(MP) && /wireTransformSection\(/.test(MP));
check('the main menu uses the shared transform section',
  /buildTransformSectionHTML\(main, 'mm'\)/.test(MM) && /wireTransformSection\(/.test(MM));
check('neither panel hand-rolls the toggle',
  !/id="xf-freerot"/.test(MP) && !/id="xf-freerot"/.test(MM),
  'the markup exists in a panel as well as the shared builder: two copies to keep in step');
check('the option is declared and validated',
  /options\.xfFreeRotate = queryBool\(/.test(OPTS),
  'an undeclared option is not restored on reload, so the toggle forgets itself');
check('the toggle is persisted', /saveOption\('xfFreeRotate'/.test(XF));
// Live value first, saved value second — the same order the gizmo size multiplier is read in,
// so a change takes effect on the current frame rather than after a reload.
check('live value wins over the saved one',
  /window\._xfFreeRotate != null\s*\n?\s*\? !!window\._xfFreeRotate : !!getOptionsURL\(\)\.xfFreeRotate/.test(XF));
check('the tool reads the same pair', /window\._xfFreeRotate != null/.test(VR));

// ── The 6DOF carry ──────────────────────────────────────────────────────────────
// Composition order is the whole thing: T(now) · R · T(-start) holds the object in the hand,
// while any other order swings it around the world origin or the object's own centre.
const vrCode = strip(VR);
check('the centre handle composes T(now) . R . T(-start)',
  /mat4\.multiply\(m, m, pre\);\s*\n\s*mat4\.multiply\(m, post, m\);/.test(vrCode)
    && /mat4\.multiply\(newMat, m, this\._startMeshMatrix\)/.test(vrCode),
  'the rotation is being composed in some other order: the object will not stay in the hand');
check('the rotation is the controller DELTA, not its absolute pose',
  /quat\.conjugate\(qDelta, this\._startControllerQuat\);\s*\n\s*quat\.multiply\(qDelta, controllerQuat, qDelta\)/.test(vrCode),
  'using the raw controller orientation snaps the object to the hand on the first frame');
check('translation-only remains the default',
  /queryBool\(getVal\('xfFreeRotate'\), false\)/.test(OPTS));

// The property that ordering buys, run as maths: a point at the controller's START position
// must land exactly on the controller's CURRENT position, whatever the rotation.
{
  const start = vec3.fromValues(0.3, -1.2, 2.0);
  const now = vec3.fromValues(-0.4, 0.9, 1.1);
  const qd = quat.create();
  quat.setAxisAngle(qd, vec3.normalize(vec3.create(), [0.3, 1.0, -0.5]), 1.1);
  const m = mat4.create();
  mat4.fromQuat(m, qd);
  const pre = mat4.create(); mat4.fromTranslation(pre, [-start[0], -start[1], -start[2]]);
  const post = mat4.create(); mat4.fromTranslation(post, now);
  mat4.multiply(m, m, pre);
  mat4.multiply(m, post, m);
  const out = vec3.transformMat4(vec3.create(), start, m);
  check('the held point tracks the controller exactly', vec3.dist(out, now) < 1e-6,
    `${Array.from(out)} vs ${Array.from(now)}`);
  // And with no rotation it degrades to the plain hand delta the old path applied.
  const m2 = mat4.create();
  mat4.fromQuat(m2, quat.create());
  mat4.multiply(m2, m2, pre);
  mat4.multiply(m2, post, m2);
  const p = vec3.fromValues(5, 6, 7);
  const moved = vec3.transformMat4(vec3.create(), p, m2);
  const delta = vec3.sub(vec3.create(), now, start);
  check('with no rotation it is exactly the old free move',
    vec3.dist(moved, vec3.add(vec3.create(), p, delta)) < 1e-6);
}

// ── A pins the joint under the ray ──────────────────────────────────────────────
check('there is ONE pin cycle', /IKSolver\.togglePin = function/.test(IK));
check('the bone tool delegates to it', /IKSolver\.togglePin\(this\._main, joint\)/.test(BONE));
check('no tool keeps its own copy of the pin undo',
  !/cyclePin\(/.test(strip(BONE)) && !/cyclePin\(/.test(strip(VR)) && !/cyclePin\(/.test(strip(GRAB)),
  'a second copy of this undo will not stay in step with the shared one');
check('there is ONE A binding', /IKSolver\.pinOnA = function/.test(IK));
check('Transform binds it', /IKSolver\.pinOnA\(this, options, this\._initInput\)/.test(VR));
check('Grab binds it', /IKSolver\.pinOnA\(this, options, !!this\._grabbedMesh\)/.test(GRAB));
// EDGE, not level: a held button must pin once, not once per frame at 90Hz.
check('the binding fires on the press edge only',
  /tool\._wasAPressed = a;\s*\n\s*if \(!a \|\| was \|\| busy\) return false;/.test(IK));

// Grab returns early when it has no controllers; the A read has to come FIRST or that return
// swallows it. This is the exact swallow that produced "A works, then doesn't" twice before.
{
  const g = strip(GRAB);
  const iA = g.indexOf('IKSolver.pinOnA(');
  const iRet = g.indexOf('if (controllers.length === 0)');
  check('Grab reads A before its no-controller return', iA !== -1 && iRet > iA,
    'the early return swallows the face button');
}

// A hovered PIN has to resolve to its joint. Pins sit on the joint and win the pick, so
// reading only the bone highlight let you pin a joint once and then never cycle or unpin it.
{
  const SK = read('src/editing/Skeleton.js');
  const i = SK.indexOf('Skeleton.hoveredJoint = function');
  const FN = i === -1 ? '' : SK.slice(i, SK.indexOf('\n};', i));
  check('the hovered-joint lookup consults the pin highlight',
    /_pinHighlightId/.test(FN),
    'once a joint is pinned the ray preselects the PIN, and the binding goes dead on it');
  check('it resolves a pin through its own back-reference',
    /_pinnedJoint/.test(FN) && /_isPinTarget/.test(FN));
  check('the pin still carries that back-reference',
    /pin\._pinnedJoint = joint;/.test(SK),
    'the lookup above depends on it');
  // Order matters: a pin and its joint are both under the ray, and the pin is what the pick
  // reports, so the pin branch has to be asked first or it is never reached.
  check('the pin is checked before the bone highlight',
    FN.indexOf('_pinHighlightId') < FN.indexOf('_skelHighlightId'));
}

// ── The button reader lives in one place ────────────────────────────────────────
check('_readButton is defined on SculptBase', /_readButton\(options, index\) \{/.test(BASE));
check('no tool redefines it',
  !/_readButton\(options, index\) \{/.test(BONE) && !/_readButton\(options, index\) \{/.test(VR)
    && !/_readButton\(options, index\) \{/.test(GRAB));
// SculptBase MUST NOT import the rig: Skeleton pulls in the mesh stack and the cycle leaves
// SculptBase undefined at the moment the tools extend it. That is why pinOnA takes the tool
// as an argument instead of living on the base class.
check('SculptBase does not import the rig modules',
  !/^import .*(Skeleton|IKSolver)/m.test(BASE),
  'this closes an import cycle: module_load_test reports "Class extends value undefined"');

// ── A no longer doubles as the subtract toggle for these tools ──────────────────
check('the tools that bind A do not also flip subtract',
  /bindsA = idxA === Enums\.Tools\.TRANSFORM_VR \|\| idxA === Enums\.Tools\.GRAB/.test(SCENE)
    && /\} else if \(!bindsA\) \{\s*\n\s*this\._vrSubtractActive/.test(SCENE),
  'placing a pin would silently flip Negative for the next brush you pick up');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
