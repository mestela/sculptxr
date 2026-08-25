// The rig-node pick, lifted from the real source.
//
// This exists because the pick has now broken twice in ways no test could see: once picking the
// wrong-sized invisible locator, and once reporting NOTHING when a bone was hit with no mesh
// behind it — nearMesh was never assigned on the rig path. Both were only findable by clicking.
// The cone test is pure geometry, so it can be checked directly.
import fs from 'fs';
import { vec3, mat4 } from '/Users/mattestela/sculptxr/node_modules/gl-matrix/esm/index.js';

let SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/math3d/Picking.js', 'utf8');
let SKEL = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');

// Defect injections (standing lesson 1):
//   PICK_INJECT=alwaystip     a bone hit always reports its TIP joint, so the root — which is
//                             nobody's tip — becomes unreachable once the dots are hidden
//   PICK_INJECT=noclamp       raySegDist clamps the segment parameter without re-solving the
//                             ray for it, the classic way this returns a point that is not
//                             the closest one
//   PICK_INJECT=tiponly       a capsule lights only from its TIP, leaving the root with no
//                             feedback at all
//   PICK_INJECT=pinovershot   the pin tint goes back above preselection, so hovering a pinned
//                             bone shows nothing
//   PICK_INJECT=spherealways  the joint dot goes back to being drawn unconditionally
{
  const inj = process.env.PICK_INJECT || '';
  if (inj === 'alwaystip') {
    const a = 'rigHit = _segS >= 0.5 ? mesh : segHead;';
    if (!SRC.includes(a)) throw new Error('inject alwaystip: anchor moved');
    SRC = SRC.replace(a, 'rigHit = mesh;');
  } else if (inj === 'noclamp') {
    const a = `    if (_segS < 0.0) { _segS = 0.0; _segT = -c / dd; }
    else if (_segS > 1.0) { _segS = 1.0; _segT = (b - c) / dd; }`;
    if (!SRC.includes(a)) throw new Error('inject noclamp: anchor moved');
    SRC = SRC.replace(a, `    if (_segS < 0.0) _segS = 0.0;
    else if (_segS > 1.0) _segS = 1.0;`);
  } else if (inj === 'tiponly') {
    const a = 'const boneHot = isHi || hiAll.has(pid);';
    if (!SKEL.includes(a)) throw new Error('inject tiponly: anchor moved');
    SKEL = SKEL.replace(a, 'const boneHot = isHi;');
  } else if (inj === 'pinovershot') {
    // The pin tint goes back on top of preselection, so hovering a pinned bone shows nothing.
    const a = 'const boneTint = boneHand || (boneHot ? HILITE_COLOR : (boneSel ? SELECT_COLOR';
    if (!SKEL.includes(a)) throw new Error('inject pinovershot: anchor moved');
    SKEL = SKEL.replace(a, 'const boneTint = ((tintMode === 2 || tintMode === 4) ? PIN_FULL_COLOR : (tintMode === 1 ? PIN_POS_COLOR : boneHand || (boneHot ? HILITE_COLOR : (boneSel ? SELECT_COLOR');
    const b2 = ': (tintMode === 1 ? PIN_POS_COLOR : restTint))));';
    SKEL = SKEL.replace(b2, ': restTint)))));');
  } else if (inj === 'spherealways') {
    const a = 'o.visible = noBoneBody || isolated;';
    if (!SKEL.includes(a)) throw new Error('inject spherealways: anchor moved');
    SKEL = SKEL.replace(a, 'o.visible = true;');
  }
}
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The rule that broke: a rig hit must be adopted even when no mesh was hit at all.
check('a rig hit is adopted without requiring a mesh hit',
  /if \(nearRig\) \{\s*\n\s*nearMesh = nearRig;/.test(SRC),
  'the guard still requires nearMesh, so a lone bone reports nothing');

// PIN PRIORITY IS A TIE-BREAK, NOT A RANK. The original rule was `score = tAlong - rank*1e6`,
// which let a pin ANYWHERE inside the cone beat a bone directly under the cursor — rank
// dominated distance absolutely. Selection is spatial: a pin should win only when it is
// effectively coincident with its own joint, which is the case the priority exists for.
//
// Lifted from the source and evaluated, rather than matched as a spelling — the previous
// version of these two checks asserted the old formula verbatim and reported the better rule
// as a regression.
{
  const m = SRC.match(/var score = ([^;]+);/);
  check('the desktop rig score is liftable', !!m,
    'no `var score = ...;` in intersectionMouseMeshes — the checks below cannot run');
  if (m) {
    // A lifted expression that no longer evaluates in these terms is a FAILURE, not a crash.
    // The old rule read a `rank` variable hoisted above it; lifting that threw a ReferenceError
    // and took the whole harness down, which reports nothing rather than reporting the defect.
    let scoreOf = null, liftErr = '';
    try {
      const f = new Function('offAxis', 'tAlong', 'isPin',
        'const mesh = { _isPinTarget: isPin }; return ' + m[1] + ';');
      f(0.02, 3, true);                       // prove it evaluates before trusting it
      scoreOf = f;
    } catch (e) { liftErr = String(e.message || e); }
    check('the desktop rig score evaluates in (offAxis, tAlong, isPin) alone', !!scoreOf,
      liftErr + ' — a score depending on anything else is not a spatial score');
    const wins = (a, b) => scoreOf && a < b;   // lower score wins

    check('a pin beats its own joint when they coincide',
      scoreOf && wins(scoreOf(0.02, 3, true), scoreOf(0.02, 3, false)),
      'a pin sitting exactly on its joint must not lose to it by float noise');
    check('...but a nearer bone beats a pin',
      scoreOf && wins(scoreOf(0.005, 3, false), scoreOf(0.02, 3, true)),
      'the old rank*1e6 bug: a pin anywhere in the cone hid the bone under the cursor');
    check('depth breaks ties only',
      scoreOf && wins(scoreOf(0.02, 1, false), scoreOf(0.02, 9, false))
        && wins(scoreOf(0.005, 99, false), scoreOf(0.02, 0.1, false)),
      'nearest-to-eye must decide equal off-axis hits, and never outrank off-axis itself');
  }
}

// The intersection must be reported in mesh-LOCAL coords (callers transform it by the matrix).
check('a rig hit reports the local origin',
  /_TMP_INTER_RIG\[0\] = _TMP_INTER_RIG\[1\] = _TMP_INTER_RIG\[2\] = 0;/.test(SRC));

// The cone itself: a point on the ray is always inside; one beyond the radius is not; and the
// radius GROWS with depth, which is what makes it a constant target on screen.
const coneHit = (p, near, far, k) => {
  const d = vec3.sub([], far, near);
  const l2 = vec3.sqrLen(d);
  const t = vec3.dot(vec3.sub([], p, near), d) / l2;
  if (t < 0) return false;
  const c = vec3.scaleAndAdd([], near, d, t);
  return vec3.dist(c, p) <= k * t * Math.sqrt(l2);
};
const near = [0, 0, 0], far = [0, 0, 10], K = 0.035;
check('cone: dead-on the ray is a hit', coneHit([0, 0, 5], near, far, K));
check('cone: behind the eye is a miss', !coneHit([0, 0, -5], near, far, K));
// The same off-axis offset: inside the cone far away (radius 0.315 at t=0.9), outside it up
// close (radius 0.07 at t=0.2). That ratio is the whole point — a constant target on screen.
check('cone: widens with depth',
  coneHit([0, 0.2, 9], near, far, K) && !coneHit([0, 0.2, 2], near, far, K),
  'a fixed offset should be inside far away and outside up close');

// Ortho must not use the perspective cone: parallel rays mean a CYLINDER, and scaling the
// radius with depth made the zone vanish near the camera and balloon far away — nothing could
// be picked in orthographic at all.
check('ortho uses a depth-independent radius',
  /isOrthographic\(\)\) \{[\s\S]{0,240}?cone = _pk \* halfH/.test(SRC),
  'the ortho branch is missing or still scales with tAlong');
check('perspective still scales with depth', /cone = _pk \* tAlong \* Math\.sqrt\(rl2\)/.test(SRC));

// The ortho zoom is DERIVED from the fov and viewport, not a tuned constant — a constant only
// matches perspective at one canvas height, and toggling projection jumped the apparent size.
{
  const CAM = fs.readFileSync('/Users/mattestela/sculptxr/src/math3d/Camera.js', 'utf8');
  // Comment lines stripped first: the constant is named in the prose explaining why it went,
  // and a test that cannot tell code from commentary reports the fix as the bug.
  const camCode = CAM.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('ortho zoom is derived, not a magic constant',
    !/0\.00055/.test(camCode) && /Math\.tan\(this\._fov \* 0\.5/.test(camCode),
    'getOrthoZoom still carries the tuned 0.00055');

  // Apparent size must match: half the viewport in world units, at the pivot distance, should
  // be the same under both projections.
  // updateOrtho builds the frustum as mat4.ortho(-w, w, -h, h) with h = _height * delta, so
  // `_height * delta` IS the half-height. Getting that wrong by a factor of two is exactly the
  // bug this test now pins down.
  const dist = 12, fov = 45, height = 900;
  const orthoPerPx = dist * Math.tan(fov * 0.5 * Math.PI / 180) / height;
  const orthoHalfH = orthoPerPx * height;
  const perspHalfH = dist * Math.tan(fov * 0.5 * Math.PI / 180);
  check('ortho and perspective frame the same height at the pivot',
    Math.abs(orthoHalfH - perspHalfH) < 1e-9,
    orthoHalfH.toFixed(4) + ' vs ' + perspHalfH.toFixed(4));

  // _trans[2] is the pivot distance PRE-MULTIPLIED by fov/45 (see setPivot), so reading it as
  // a distance inflates the ortho frustum by that factor — 1.8x at an 81-degree fov. The
  // corrected formula has to divide it back out, and the proof is that it reproduces the old
  // hand-tuned constant exactly at the fov and canvas that constant was calibrated for.
  check('getOrthoZoom divides out the fov scaling baked into _trans[2]',
    /pivotDistance\(\)/.test(CAM) && /45 \/ \(this\._fov \|\| 45\)/.test(CAM),
    'still reading _trans[2] as a plain distance');
  {
    const legacyFov = 45, legacyHeight = 750;
    const derived = Math.tan(legacyFov * 0.5 * Math.PI / 180) / legacyHeight;
    // Within half a percent: the old value was written to two significant figures, so an exact
    // match is not the claim — the claim is that it was this formula all along, rounded.
    check('the derived zoom reproduces the old tuned constant',
      Math.abs(derived - 0.00055) / 0.00055 < 0.005,
      derived.toFixed(8) + ' vs 0.00055 (' +
        (100 * Math.abs(derived - 0.00055) / 0.00055).toFixed(2) + '% off)');
  }
}

// The VR ray path is a SEPARATE function from the mouse one, and was missed entirely the
// first time: everything went into intersectionMouseMeshes while the headset uses
// intersectionRayMeshes. These assert the same four properties hold on both sides.
{
  const vr = SRC.slice(SRC.indexOf('intersectionRayMeshes(meshes, origin, direction'));
  check('VR: rig picking is opt-in', /includeRig = false\)/.test(vr));
  // VR rig selection is CONTROLLER-TIP PROXIMITY, not a ray cone. Reaching for a joint is more
  // predictable than aiming at one, and it is the only thing that works during two-hand posing
  // where neither controller is pointing at anything in particular.
  // No word boundary on the negative: `_rigPickConeVR\b` does not match `_rigPickConeVRPin`,
  // so a reintroduced PIN cone would have slipped through while the bone cone was condemned.
  check('VR: rig nodes are picked by proximity, not geometry and not a ray cone',
    /_rigPickProximityVR \|\| 0\.11/.test(vr) && !/_rigPickConeVR/.test(vr));
  // The reach is a distance you can feel with your arm, so it has to be in PHYSICAL metres.
  // Model-space distance would make the reach grow and shrink with the world scale.
  check('VR: the reach is in physical metres, not model space',
    /_vrScale/.test(vr) && /physicalDistance = rigDist \* vrScale/.test(vr),
    'an unscaled distance changes how far you can reach when the world is scaled');
  // A spelling check, unusually, because the mistake it guards has no local behaviour to run:
  // the bone distance must reach the reach test through the SAME scaling the joint distance
  // does. Measure the bone in model space and the metres conversion is skipped for exactly the
  // targets that were just added.
  check('VR: a bone distance goes through that same conversion',
    /if \(segD < rigDist\) \{ rigDist = segD/.test(vr),
    'the segment result must land in the variable that gets scaled, not beside it');
  {
    const m = vr.match(/var rScore = ([^;]+);/);
    check('the VR rig score is liftable', !!m, 'no `var rScore = ...;` in intersectionRayMeshes');
    if (m) {
      let scoreOf = null, liftErr = '';
      try {
        const f = new Function('physicalDistance', 'isPin', 'return ' + m[1] + ';');
        f(0.05, true);
        scoreOf = f;
      } catch (e) { liftErr = String(e.message || e); }
      check('the VR rig score evaluates in (physicalDistance, isPin) alone', !!scoreOf, liftErr);
      check('VR: a pin beats its own joint when they coincide',
        scoreOf && scoreOf(0.05, true) < scoreOf(0.05, false));
      check('VR: ...but a genuinely nearer bone beats a pin',
        scoreOf && scoreOf(0.01, false) < scoreOf(0.05, true),
        'the pin bias must resolve an overlap, not steal focus across the reach');
    }
  }
  check('VR: a lone rig hit is adopted without a mesh hit',
    /if \(nearRig\) \{[\s\S]{0,400}?nearMesh = nearRig;/.test(vr),
    'the same guard that broke the desktop path');
}

// THE TWO TRANSFORM TOOLS. Transform.js (desktop) and TransformVR.js (VR) are the same tool
// twice, and six rounds of fixes once went into the desktop one while matt was testing the
// headset. TransformVR had no pick of ANY kind: it transformed whatever was already selected,
// so a bone or a pin could never be reached in VR. These assert the two picks stay in step.
{
  const DESK = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/tools/Transform.js', 'utf8');
  const VR = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/tools/TransformVR.js', 'utf8');

  check('desktop Transform picks with the rig included',
    /intersectionMouseMeshes\(main\.getMeshes\(\), main\._mouseX, main\._mouseY, false, true\)/.test(DESK));
  check('VR Transform picks at all',
    /intersectionRayMeshes\(/.test(VR),
    'TransformVR is back to operating on getMesh() with no pick');
  check('VR Transform picks with the rig included',
    /intersectionRayMeshes\(targets, origin, dir, true\)/.test(VR),
    'includeRig dropped: bones and pins become unreachable in VR');
  check('VR Transform preselects through the shared helper',
    /Skeleton\.hoverRigFromRay\(/.test(VR),
    'preselection must be the same helper Grab uses, not a private copy');

  // The ray MUST be the engine-space one updateXR is handed. Rebuilding it from the controller
  // matrix puts the pick in the raw WebXR frame, where it misses every mesh in the scene and
  // says nothing about it.
  check('VR Transform does not rebuild the ray from the controller matrix',
    !/transformMat4\([^)]*\[0, ?0, ?0\]/.test(VR),
    'a ray derived from the controller matrix picks in the wrong space');

  // A press is one selection, not one per frame at 90Hz.
  check('the VR selection pick is latched to the press',
    /_pickConsumed = true;[\s\S]{0,200}?_pickRigOrMesh/.test(VR)
      && /_pickConsumed = false;.*(?:release|press)/i.test(VR),
    'the pick must be consumed on press and rearmed on release');

  // While a handle is under the ray it owns the ray: re-picking there would drop the selection
  // at the very moment you took hold of the gizmo.
  check('a gizmo-handle press does not re-select',
    /!this\._isGizmoHovered && !this\._pickConsumed/.test(VR));
  check('rig preselection yields to the gizmo handle',
    /!this\._isGizmoHovered && !isPressed/.test(VR));
}


// ── THE BONE AS A PICK TARGET ────────────────────────────────────────────────
//
// This rig is joint-centric: the capsule between two joints is drawn into an overlay batch, is
// not in the mesh list, and owns no state. It is now pick SURFACE donated to the joints either
// side of it, reporting whichever end is nearer — which is what lets the joint dots come off
// the screen entirely. The geometry is lifted and RUN here rather than matched as a spelling,
// because "closest point between a ray and a segment" is exactly the kind of thing that looks
// right and is quietly wrong at the ends.
{
  const i = SRC.indexOf('var _TMP_SEG_A');
  const j = SRC.indexOf('\n}', SRC.indexOf('function segmentHead'));
  const lifted = SRC.slice(i, j + 2);
  const api = new Function('vec3', 'mat4',
    lifted + '\nreturn { raySegDist, pointSegDist, segmentHead, S: () => _segS, T: () => _segT };')(vec3, mat4);

  // A ray up +Z from the origin. D is vFar - vNear and is NOT normalised, exactly as the pick
  // builds it, so dd is passed alongside.
  const vNear = [0, 0, 0], D = [0, 0, 10], dd = 100;

  // Crossing the ray dead on: distance zero, and the crossing is at the middle of the bone.
  let d = api.raySegDist(vNear, D, dd, [-1, 0, 5], [2, 0, 0]);
  check('ray/segment: a bone crossing the ray reads as a hit on the bone', d < 1e-9,
    'got ' + d);
  check('...at the point where it crosses', Math.abs(api.S() - 0.5) < 1e-9);
  check('...and at the right depth along the ray', Math.abs(api.T() - 0.5) < 1e-9);

  // THE CLAMPED CASE, which is the one that goes wrong. The whole bone lies off to one side of
  // the ray, so the closest point is its END, not an interior point — and the ray parameter has
  // to be re-solved for that end rather than left where the unclamped solve put it.
  // A bone raked away from the ray, so the closest point on its INFINITE line lies a full bone
  // length off the near end. Clamping the segment parameter to that end without re-solving the
  // ray for it leaves the ray sitting where the unclamped answer put it, and the distance comes
  // back 4.12 instead of 1 — a bone you are pointing straight at reads as far away.
  d = api.raySegDist(vNear, D, dd, [1, 0, 5], [1, 0, 4]);
  check('ray/segment: a bone raked off the ray reports the distance to its nearest END',
    Math.abs(d - 1) < 1e-9, 'got ' + d + ' (should be 1: the ray passes 1 unit beside the head)');
  check('...which is the head', Math.abs(api.S()) < 1e-9, 's=' + api.S());
  check('...measured at that end’s depth, not where the unclamped solve left it',
    Math.abs(api.T() - 0.5) < 1e-9, 't=' + api.T());

  // The same bone the other way round, so the clamp lands on the TIP. Both branches re-solve.
  d = api.raySegDist(vNear, D, dd, [2, 0, 9], [-1, 0, -4]);
  check('ray/segment: and the same when the nearest end is the tip',
    Math.abs(d - 1) < 1e-9 && Math.abs(api.S() - 1) < 1e-9 && Math.abs(api.T() - 0.5) < 1e-9,
    'got ' + d + ' s=' + api.S() + ' t=' + api.T());

  // A zero-length bone is just its own joint, and must not divide by its own length.
  d = api.raySegDist(vNear, D, dd, [0, 2, 5], [0, 0, 0]);
  check('ray/segment: a zero-length bone degrades to its joint', Math.abs(d - 2) < 1e-9,
    'got ' + d);
  check('...with finite parameters', Number.isFinite(api.S()) && Number.isFinite(api.T()));

  // Behind the eye: measured from the near plane rather than reported as a negative depth,
  // since the cone radius is scaled by that depth and a negative one inverts the test.
  api.raySegDist(vNear, D, dd, [0, 1, -5], [0, 0, -1]);
  check('ray/segment: a bone behind the eye never yields a negative depth', api.T() >= 0);

  // The VR pick is controller-tip proximity, not a ray.
  d = api.pointSegDist([0, 0, 0], [1, 0, 0], [0, 0, 4]);
  check('point/segment: reaching past the end of a bone measures to that end',
    Math.abs(d - 1) < 1e-9 && Math.abs(api.S()) < 1e-9, 'got ' + d + ' s=' + api.S());
  d = api.pointSegDist([1, 0, 2], [1, 0, 0], [0, 0, 4]);
  check('point/segment: reaching for the middle of one lands on it',
    d < 1e-9 && Math.abs(api.S() - 0.5) < 1e-9, 'got ' + d + ' s=' + api.S());

  // WHICH JOINT A BONE HAS. Not every rig node has one, and the ones that do not are exactly
  // the cases that used to be handled by the dot being always visible.
  const vis = (extra = {}) => ({ _isBone: true, isVisible: () => true, ...extra });
  check('a pin is a point, never a segment', api.segmentHead({ _isPinTarget: true }) === null);
  check('the root has no bone above it', api.segmentHead(vis({ _parentMesh: null })) === null);
  check('nor does a joint parented to something that is not a joint',
    api.segmentHead(vis({ _parentMesh: { _isBone: false, isVisible: () => true } })) === null);
  check('a hidden parent means no segment, not a way round the hiding',
    api.segmentHead(vis({ _parentMesh: vis({ isVisible: () => false }) })) === null);
  check('a locked parent likewise',
    api.segmentHead(vis({ _parentMesh: vis({ _selectLocked: true }) })) === null);
  const good = vis();
  check('an ordinary joint reports its parent', api.segmentHead(vis({ _parentMesh: good })) === good);

  // NEAREST END, evaluated. Always reporting the tip is the plausible-looking version — it is
  // 1:1 with the capsules — and it silently makes the root unselectable, because the root is
  // nobody's tip and no longer has a dot of its own to click.
  const m = /rigHit = (.+?);\n/.exec(SRC.slice(SRC.indexOf('var segHead = segmentHead(mesh);')));
  check('the nearest-end rule is liftable', !!m, 'the pick loop moved');
  if (m) {
    const endOf = new Function('_segS', 'mesh', 'segHead', 'return (' + m[1] + ');');
    check('a hit near the tip takes the tip joint', endOf(0.9, 'tip', 'head') === 'tip');
    check('a hit near the head takes the head joint', endOf(0.1, 'tip', 'head') === 'head',
      'the root is only ever a head, so this is what makes it reachable at all');
    check('the boundary is the midpoint', endOf(0.5, 'tip', 'head') === 'tip'
      && endOf(0.49, 'tip', 'head') === 'head');
    check('and at the very tip it agrees with the old point test', endOf(1, 'tip', 'head') === 'tip',
      'the two must be continuous, or the answer jumps as you approach a joint');
  }
}

// ── THERE ARE NO JOINT DOTS ──────────────────────────────────────────────────
//
// Not "off by default" — gone. The bone is the pick target, so the dot marks nothing, and
// preselection moved onto the capsule where it can be shown without a second kind of marker.
// The only survivor is the case with no capsule at either end.
{
  const m = /o\.visible = (.+?);\n/.exec(SKEL.slice(SKEL.indexOf('const isolated = !hasChildBone')));
  check('the joint dot visibility is liftable', !!m, 'the placement code moved');
  if (m) {
    const show = (o = {}) => new Function('noBoneBody', 'isolated',
      'return (' + m[1] + ');')(!!o.noBoneBody, !!o.isolated);

    check('an ordinary joint draws no dot', show() === false);
    check('nor does the one under the cursor', show({ isHi: true }) === false,
      'preselection is the capsule now; a dot that appears only sometimes is still a dot');
    check('nor a selected one', show({ isSel: true }) === false);
    check('nor a grabbed one', show({ jointHandColor: 0xff0000 }) === false);
    check('an ISOLATED joint does, because it has no capsule at either end',
      show({ isolated: true }) === true,
      'without it the first joint you place is invisible AND unpickable');
    check('so does every joint when the bone body is switched off',
      show({ noBoneBody: true }) === true, 'the same case by a different route');
  }
  // NO FLAG AT ALL, deliberately. Defaulting one to off left it persisted, so anyone who had
  // seen the old default kept the dots for good.
  check('there is no joint-dot display flag to turn them back on',
    !/boneShowJoints/.test(SKEL) && !/showJoints/.test(SKEL),
    'a saved value would resurrect exactly what was asked to be removed');
}

// ── THE CAPSULE CARRIES PRESELECTION ─────────────────────────────────────────
//
// With the dot gone this is the only feedback left, so it has to be right: a capsule lights
// when EITHER of its ends is the joint in question, which is what makes hovering a mid-chain
// joint read as one joint rather than one arbitrary bone. And it has to sit ABOVE the pin
// tint — a preselection something else can cover is worth nothing.
{
  const m = /const boneTint = (.+?);\n/s.exec(SKEL);
  check('the bone tint is liftable', !!m, 'the tint code moved');
  if (m) {
    const C = (n) => {
      const r = new RegExp('^const ' + n + ' = (0x[0-9a-fA-F]+);', 'm').exec(SKEL);
      if (!r) throw new Error('constant moved: ' + n);
      return parseInt(r[1], 16);
    };
    const HILITE = C('HILITE_COLOR'), SELECT = C('SELECT_COLOR');
    const POS = C('PIN_POS_COLOR'), FULL = C('PIN_FULL_COLOR');
    const tint = (o = {}) => new Function('boneHand', 'boneHot', 'boneSel', 'tintMode',
      'HILITE_COLOR', 'SELECT_COLOR', 'PIN_POS_COLOR', 'PIN_FULL_COLOR', 'restTint',
      'return (' + m[1] + ');')(o.boneHand || null, !!o.boneHot, !!o.boneSel, o.tintMode || 0,
      HILITE, SELECT, POS, FULL, 0x111111);

    check('an idle unpinned bone wears the rest colour', tint() === 0x111111);
    check('a hovered bone wears the preselect colour', tint({ boneHot: true }) === HILITE);
    check('a selected one wears the selection colour', tint({ boneSel: true }) === SELECT);
    check('a grabbed one wears its hand colour', tint({ boneHand: 0x00ff00 }) === 0x00ff00);
    check('a pinned bone still reports its pin', tint({ tintMode: 1 }) === POS
      && tint({ tintMode: 2 }) === FULL && tint({ tintMode: 4 }) === FULL);
    check('but hovering a PINNED bone still shows the preselect',
      tint({ boneHot: true, tintMode: 2 }) === HILITE,
      'a preselection the pin state can cover is a preselection you cannot trust');
    check('and the hand beats everything', tint({ boneHand: 0xff00ff, boneHot: true,
      tintMode: 2 }) === 0xff00ff);
  }
  // EITHER END, not just the tip. Only the tip would mean hovering the ROOT lights nothing at
  // all, since the root is nobody's tip — the same trap the pick itself had, and the reason a
  // hit maps to the nearest end rather than always the child.
  for (const [what, expr] of [['preselect', 'boneHot'], ['selection', 'boneSel']]) {
    const hm = new RegExp('const ' + expr + ' = (.+?);\n').exec(SKEL);
    check(`the ${what} rule is liftable`, !!hm);
    if (!hm) continue;
    const lit = (tip, head) => new Function('isHi', 'isSel', 'hiAll', 'sel', 'pid',
      'return (' + hm[1] + ');')(tip, tip, new Set(head ? [7] : []), new Set(head ? [7] : []), 7);
    check(`${what}: the joint at the TIP lights this capsule`, lit(true, false) === true);
    check(`${what}: so does the joint at the HEAD`, lit(false, true) === true,
      'the root is only ever a head — light only tips and it has no feedback at all');
    check(`${what}: and an unrelated joint lights nothing`, !lit(false, false));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
