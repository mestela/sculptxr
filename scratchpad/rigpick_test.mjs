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
//   PICK_INJECT=nopinatend    a bone hit resolves to the JOINT even when a pin sits on that
//                             end, so aiming at a visible handle takes the bone under it
//   PICK_INJECT=vrrawmetres   the VR score compares raw metres again, so a bone SEGMENT beats
//                             the pin sitting on its own end from almost anywhere
//   PICK_INJECT=markerzone    the pick zone ignores the drawn marker size, so a gnomon larger
//                             than its own zone cannot be hit
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
  } else if (inj === 'nopinatend') {
    // The bone hit keeps resolving to the JOINT even when a pin is sitting on that end, so
    // aiming at a visible handle selects the bone underneath it.
    const a = '  return (dx * dx + dy * dy + dz * dz) <= r * r ? pin : null;';
    if (!SRC.includes(a)) throw new Error('inject nopinatend: anchor moved');
    SRC = SRC.replace(a, '  return null;');
  } else if (inj === 'vrrawmetres') {
    // The VR score goes back to raw metres. A pin is a point and a bone is a segment, so the
    // segment wins along the whole limb and pins become all but unreachable.
    const a = 'var rScore = (BONE_SELECT() ? physicalDistance / reach : physicalDistance)';
    if (!SRC.includes(a)) throw new Error('inject vrrawmetres: anchor moved');
    SRC = SRC.replace(a, 'var rScore = (BONE_SELECT() ? physicalDistance : physicalDistance)');
  } else if (inj === 'markerzone') {
    // The pick zone goes back to being a fixed fraction of the screen, ignoring how big the
    // marker actually is — so on a large rig you aim at the gnomon and hit the bone behind it.
    const a = '        if (BONE_SELECT() && mesh._pickRadius > cone) cone = mesh._pickRadius;';
    if (!SRC.includes(a)) throw new Error('inject markerzone: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'tiponly') {
    const a = 'const boneHot = isHi || hiAll.has(pid);';
    if (!SKEL.includes(a)) throw new Error('inject tiponly: anchor moved');
    SKEL = SKEL.replace(a, 'const boneHot = isHi;');
  } else if (inj === 'pinovershot') {
    // The pin tint goes back on top of preselection, so hovering a pinned bone shows nothing.
    const a = 'const boneTint = boneHeld ? SELECT_COLOR : (boneHot ? HILITE_COLOR';
    if (!SKEL.includes(a)) throw new Error('inject pinovershot: anchor moved');
    SKEL = SKEL.replace(a, 'const boneTint = tintMode ? ((tintMode === 2 || tintMode === 4)'
      + ' ? PIN_FULL_COLOR : PIN_POS_COLOR) : (boneHeld ? SELECT_COLOR : (boneHot ? HILITE_COLOR');
    SKEL = SKEL.replace(': (tintMode === 1 ? PIN_POS_COLOR : restTint))));',
      ': (tintMode === 1 ? PIN_POS_COLOR : restTint)))));');
  } else if (inj === 'spherealways') {
    const a = 'o.visible = showJoints || noBoneBody || isolated || isHi || isSel || jointHeld;';
    if (!SKEL.includes(a)) throw new Error('inject spherealways: anchor moved');
    SKEL = SKEL.replace(a, 'o.visible = true;');   // always drawn, flag ignored
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
// WHICH ONE YOU MEANT, in two distances and one comparison.
//
// matt, after four versions of me tuning a single blended score: "this feels like its spiralling
// out of control... to me its simple: get list of bones/pins within (x) radius; if there are
// pins and bones within similar radius, pins get priority." He is right, and the rule below is
// that sentence. Keep the nearest of each KIND, then choose. Two distances and one comparison
// cannot drift the way four interacting constants did — and there is exactly one number to
// argue about, `_rigPinPriority`, rather than four that move each other.
{
  const i = SRC.indexOf('function rigWinner(');
  const lifted = SRC.slice(i, SRC.indexOf('\n}', i) + 2);
  check('the winner rule is liftable', i > 0, 'rigWinner moved');
  const win = new Function('window', lifted + '\nreturn rigWinner;')({});
  const PIN = { pin: true }, BONE = { bone: true };
  const K = parseFloat(/_rigPinPriority \|\| ([\d.]+)/.exec(SRC)?.[1] ?? '2.0');

  check('a pin alone wins', win(PIN, 5, null, Infinity) === PIN);
  check('a bone alone wins', win(null, Infinity, BONE, 5) === BONE);
  check('nothing in range, nothing picked', win(null, Infinity, null, Infinity) === null);

  // THE RULE ITSELF. A pin at the same distance as a bone wins; a pin somewhat further still
  // wins; a bone wins only by being CLEARLY nearer.
  check('a pin at the same distance beats the bone', win(PIN, 5, BONE, 5) === PIN);
  check('a pin further away still wins, up to the priority factor',
    win(PIN, 5 * K * 0.99, BONE, 5) === PIN,
    'reaching into a rig full of pins and getting the bone under one is never what was meant');
  check('...and exactly at the factor', win(PIN, 5 * K, BONE, 5) === PIN);
  check('a clearly nearer bone wins', win(PIN, 5 * K * 1.01, BONE, 5) === BONE,
    'a pin must not shadow a bone the pointer is plainly on');
  check('the priority factor is greater than 1', K > 1,
    'at 1 this is nearest-wins and the pin priority does nothing');

  // DETERMINISM, which is the property being bought here. The same pair gives the same answer
  // every time, and no third candidate elsewhere in the scene can change it.
  const once = win(PIN, 4, BONE, 3);
  check('the same pair always gives the same answer',
    [...Array(50)].every(() => win(PIN, 4, BONE, 3) === once));
  check('and it reads no depth, no zone size, no epsilon',
    !/tAlong|cone|reach|1e-/.test(lifted),
    'every one of those was a tuning constant pretending to be a rule');
}

// THE RADIUS IS THE TOOL'S OWN RADIUS, so "within x radius" means the sphere on screen.
{
  check('the pick radius comes from the tool',
    /_tool\.getScreenRadius \? _tool\.getScreenRadius\(\) : 0/.test(SRC),
    'a hidden constant cannot be adjusted while you work; the drawn sphere can');
  check('...converted at the NODE depth, not the brush depth',
    /this\.unproject\(_pp\[0\] \+ _scr, _pp\[1\], _pp\[2\]\)/.test(SRC),
    'the same conversion the brush uses, anchored on the thing being picked');
  check('...with the old screen-fraction cone as a fallback',
    /if \(!\(cone > 0\)\) \{/.test(SRC),
    'a tool with no radius must not leave the pick with no zone at all');
  check('...and ONE radius for pins and bones alike',
    !/_isPinTarget[\s\S]{0,80}getScreenRadius/.test(SRC),
    'which kind you meant is rigWinner\'s job; folding it into the radius is what spiralled');
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
    /if \(segD < rigDist\) \{\s*\n\s*rigDist = segD;/.test(vr),
    'the segment result must land in the variable that gets scaled, not beside it');
  check('VR: the same two-distance rule decides it',
    /nearPinD/.test(vr) && /nearBoneD/.test(vr) && /rigWinner\(nearPin, nearPinD, nearBone, nearBoneD\)/.test(vr),
    'one rule for both platforms, or they drift apart again');
  check('VR: with no blended score left to tune',
    !/rScore/.test(vr), 'the thing that took four rounds to not get right');

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
  const m = /rigHit = (_segS.+?);\n/.exec(SRC.slice(SRC.indexOf('var rigHit = mesh;')));
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

// ── WHEN THE JOINT DOTS DRAW ─────────────────────────────────────────────────
//
// They went when the bone became the pick target and came back when that was switched off —
// but with no way to turn them off, which is worse than either state. So: a flag, plus the two
// cases that ignore it, because switching a marker off must not also switch off the only way
// to find the thing it marks.
{
  const m = /o\.visible = (.+?);\n/.exec(SKEL.slice(SKEL.indexOf('const isolated = !hasChildBone')));
  check('the joint dot visibility is liftable', !!m, 'the placement code moved');
  if (m) {
    const show = (o = {}) => new Function('showJoints', 'noBoneBody', 'isolated',
      'isHi', 'isSel', 'jointHeld', 'return (' + m[1] + ');')(
      !!o.showJoints, !!o.noBoneBody, !!o.isolated, !!o.isHi, !!o.isSel, !!o.jointHeld);

    check('the flag on draws them', show({ showJoints: true }) === true);
    check('the flag off hides them', show({ showJoints: false }) === false,
      'the dots came back with no way to turn them off, which is what this restores');
    // The dot is where preselect and selection are SHOWN on a joint, so those states have to
    // bring it back even with the layer off — otherwise turning the dots off silently turns
    // off the answer to "which one would I get".
    check('...except the one under the cursor', show({ isHi: true }) === true);
    check('...a selected one', show({ isSel: true }) === true);
    check('...and one in a hand', show({ jointHeld: true }) === true);
    check('an ISOLATED joint draws anyway', show({ isolated: true }) === true,
      'it has no capsule at either end: without the dot it is invisible AND unpickable');
    check('so does every joint when the bone body is switched off',
      show({ noBoneBody: true }) === true, 'the same case by a different route');
    check('...and those two ignore the flag on purpose',
      show({ showJoints: false, isolated: true }) === true
        && show({ showJoints: false, noBoneBody: true }) === true,
      'switching a marker off must not switch off the only way to find the thing');
  }
  check('the flag exists and defaults to ON',
    /joints: \['_boneShowJoints', 'boneShowJointDots', true\]/.test(SKEL),
    'bone selection ships off, so the dot is the marker for the target');
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
    const tint = (o = {}) => new Function('boneHeld', 'boneHot', 'boneSel', 'tintMode',
      'HILITE_COLOR', 'SELECT_COLOR', 'PIN_POS_COLOR', 'PIN_FULL_COLOR', 'restTint',
      'return (' + m[1] + ');')(!!o.boneHeld, !!o.boneHot, !!o.boneSel, o.tintMode || 0,
      HILITE, SELECT, POS, FULL, 0x111111);

    check('an idle unpinned bone wears the rest colour', tint() === 0x111111);
    check('a hovered bone wears the preselect colour', tint({ boneHot: true }) === HILITE);
    check('a selected one wears the selection colour', tint({ boneSel: true }) === SELECT);
    // HELD READS AS SELECTED — one cyan, not a red hand and a green hand. The per-hand tints
    // put two more colours on a surface that already has to say "aimed at" and "selected", and
    // which hand it is is the thing you can already see.
    check('a held bone reads as selected', tint({ boneHeld: true }) === SELECT);
    check('...and holding outranks aiming at it',
      tint({ boneHeld: true, boneHot: true }) === SELECT,
      'a hand on the thing is a stronger statement than a ray near it');
    check('a pinned bone still reports its pin', tint({ tintMode: 1 }) === POS
      && tint({ tintMode: 2 }) === FULL && tint({ tintMode: 4 }) === FULL);
    check('but hovering a PINNED bone still shows the preselect',
      tint({ boneHot: true, tintMode: 2 }) === HILITE,
      'a preselection the pin state can cover is a preselection you cannot trust');
    check('and holding beats the pin tint too',
      tint({ boneHeld: true, tintMode: 2 }) === SELECT);
    check('no per-hand colours survive anywhere',
      !/HAND_COLOR/.test(SRC) && !/HAND_COLOR/.test(
        fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8')),
      'red and green by handedness is what was confusing');
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


// ── THE ZONE IS AT LEAST THE MARKER ──────────────────────────────────────────
//
// A pin's pick zone is a fraction of the SCREEN; its gnomon is sized in WORLD units from the
// scene unit. On matt's rig — unit 57.9, so a marker ~3.8 units across — the drawn thing is far
// bigger than the zone that answers for it, and aiming at an arm of the triad landed outside
// the pin entirely: "the wrist never preselect highlighted", with the bone underneath winning.
// So the zone takes whichever is larger. The thing you can see is the thing you can click.
{
  const m = /if \(BONE_SELECT\(\) && mesh\._pickRadius > cone\) cone = mesh\._pickRadius;/.test(SRC);
  check('the desktop cone is widened to the drawn marker', m,
    'a marker bigger than its own pick zone is a target you cannot hit');
  check('...and the VR reach likewise',
    /Math\.max\(base, \(mesh\._pickRadius \|\| 0\) \* vrScale\)/.test(SRC),
    'a gnomon 30cm across has arms further out than an 11cm reach');

  // Evaluated: the widening has to be a MAXIMUM, never a replacement, or a pin viewed from far
  // away would lose the screen-space zone that makes it hittable at a distance.
  const widen = new Function('cone', 'r',
    'const BONE_SELECT = () => true; const mesh = { _pickRadius: r }; '
    + (SRC.match(/if \(BONE_SELECT\(\) && mesh\._pickRadius > cone\) cone = mesh\._pickRadius;/) || [''])[0]
    + ' return cone;');
  check('a marker larger than the cone widens it', widen(0.2, 3.8) === 3.8);
  check('a marker smaller than the cone leaves it alone', widen(2.0, 0.5) === 2.0,
    'a distant pin still needs its screen-space zone, which is the larger one there');
  check('no marker recorded changes nothing', widen(0.2, undefined) === 0.2,
    'anything that is not a pin has no _pickRadius, and must keep the plain cone');
}

// And the radius has to actually be PUBLISHED, or the widening above reads undefined forever
// and the whole thing is a no-op that looks implemented.
{
  const SK = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');
  check('the drawing code publishes the marker radius',
    /pinObj\._pickRadius = r;/.test(SK));
  check('...taking the LARGEST visible part',
    /for \(const \[, on, size\] of pinParts\) if \(on\) r = Math\.max\(r, size\);/.test(SK),
    'a mode showing the rings and the triad is as big as the bigger of them');
}


// ── THE CONTROL ON AN END BEATS THE JOINT IT DRIVES ──────────────────────────
//
// The defect three rounds of score tuning could not reach. A bone hit resolves to the joint at
// its nearer END, and a control pin sits exactly ON that joint — so the segment and the pin
// occupy the SAME PLACE, and which won was decided by whichever tuning constant happened to be
// larger. Scoring cannot separate two things that are not apart. So this one is not scored:
// inside the marker the pin is drawing, the pin IS the answer.
{
  const i = SRC.indexOf('function pinAtEnd(');
  const lifted = SRC.slice(i, SRC.indexOf('\nfunction segmentHead'));
  const api = new Function('_TMP_SEG_MS', lifted + '\nreturn pinAtEnd;')(new Array(16).fill(0));

  const at = (x, r, extra = {}) => {
    const m = new Array(16).fill(0);
    m[12] = x; m[13] = 0; m[14] = 0;
    return { _isPinTarget: true, _pickRadius: r, isVisible: () => true,
      getModelSpaceMatrix(out) { for (let k = 0; k < 16; k++) out[k] = m[k]; return out; },
      ...extra };
  };
  const joint = (pin) => ({ _isBone: true, _boneIKPinObj: pin });

  const pin = at(0, 2.0);
  check('aiming inside the pin marker takes the PIN', api(joint(pin), 1.5, 0, 0) === pin,
    'this is the whole report: the wrist pin never highlighted');
  check('...right up to its edge', api(joint(pin), 1.99, 0, 0) === pin);
  check('aiming outside it leaves the bone alone', api(joint(pin), 2.5, 0, 0) === null,
    'the middle of a bone, well away from any handle, must still be the bone');
  check('a joint with no pin is untouched', api(joint(null), 0, 0, 0) === null);
  check('a pin with no marker drawn claims nothing',
    api(joint(at(0, 0)), 0, 0, 0) === null,
    'nothing is on screen there, so nobody can be aiming at it');
  check('a hidden pin claims nothing',
    api(joint(at(0, 2, { isVisible: () => false })), 0, 0, 0) === null);
  check('a locked pin claims nothing',
    api(joint(at(0, 2, { _selectLocked: true })), 0, 0, 0) === null);
  check('and it is measured in 3D, not along one axis',
    api(joint(pin), 0, 1.5, 0) === pin && api(joint(pin), 1.5, 1.5, 0) === null);
}

// The escape hatch. Four rounds went into the interaction between bone segments and pins; if
// the balance is still wrong in the headset, this puts the pick back to joints-as-points
// without a rebuild, which is what it was before any of it.
// THE WHOLE OF BONE SELECTION IS OPT-IN, AND OFF. Five versions of it shipped without ever
// being run against the real app, each one re-balancing the previous against the pins that sit
// on the joints at a bone's ends. What runs by default is the rule from v3.20.65, which is
// known to work because it did.
check('bone selection is one switch, and it defaults to OFF',
  /const BONE_SELECT = \(\) => window\._rigBoneSelect === true;/.test(SRC),
  'a default of true is not an escape hatch, it is the same gamble with a flag on it');
check('...gating the segments on both paths',
  (SRC.match(/BONE_SELECT\(\) \? segmentHead\(mesh\) : null/g) || []).length === 2,
  'desktop and VR, or the switch only half works');
check('...the zone widening', /BONE_SELECT\(\) && mesh\._pickRadius > cone/.test(SRC));
check('...and the zone widening is the only thing left gated',
  /BONE_SELECT\(\) && mesh\._pickRadius > cone/.test(SRC)
    && !/BONE_SELECT\(\) \? offAxis/.test(SRC),
  'the blended scores are gone entirely now, so there is nothing left to gate there');
{
  const SK = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');
  // The dots are a flag again rather than a consequence of this switch — see the section
  // above. What still must hold is that they DEFAULT to drawn, because bone selection ships
  // off and the dot is then the only marker for the thing being aimed at.
  check('and the joint dots default to drawn, since the bone is not the target',
    /joints: \['_boneShowJoints', 'boneShowJointDots', true\]/.test(SK),
    'removing the marker AND the target it stood for leaves nothing to aim at');
}


// ── THE RADIUS IS THE ONE ON SCREEN, ON BOTH PLATFORMS ───────────────────────
//
// matt: "turn [the grab radius sphere] back on, and use its radius as the proximity max dist."
// The sphere lost its job when the rig pick was a RAY, where a radius meant nothing; the pick
// is proximity again, so the sphere is the literal shape of the question and must be the number
// the pick uses. A radius you can see and set beats a constant nobody can — which is the whole
// lesson of the rounds before this one.
{
  check('VR: the reach is the published cursor radius',
    /this\._main\?\._vrBrushPhysicalRadius \|\| \(window\._rigPickProximityVR \|\| 0\.11\)/.test(SRC),
    'a constant of its own is a number nobody can adjust while working');

  const SC = fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8');
  check('...and Scene publishes exactly what it draws the sphere at',
    /this\._vrBrushPhysicalRadius = physicalRadius;/.test(SC),
    'two numbers for one radius is how the sphere ends up lying about the pick');
  check('Grab shows its cursor again', !/tool\.constructor\.name === 'Grab'\);\n\n?\s*if \(volumeSphere\)/.test(SC)
    && /const isGrabTool = tool && tool\.constructor && tool\.constructor\.name === 'Grab';/.test(SC),
    'it was grouped with the transform tools when the pick was a ray');
  check('...but not the surface ring', /!isVoxelTool && !isGrabTool && hitDist/.test(SC),
    'Grab is not a brush and does not act on a surface');
  check('the transform tools still have no cursor',
    /isTransformTool = tool && tool\.constructor\s*\n?\s*&& \(tool\.constructor\.name === 'TransformVR' \|\| tool\.constructor\.name === 'Transform'\);/.test(SC),
    'those are gizmo-driven and genuinely have no radius');
}

// ── AND IT IS MEASURED FROM THE SPIKE TIP ────────────────────────────────────
//
// matt: "it seems to again be measuring from the controller pivot rather than from the end of
// the controllers spike." `origin` IS the pivot; the tip is a stylus-length in front of it and
// is what you aim with, so reaching for a pin was off by the length of the controller. Scene
// computes the tip exactly and passes it as `tipOrigin`.
{
  const SM = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/SculptManager.js', 'utf8');
  const armed = SM.slice(SM.indexOf('if (RigPending.armed(this._main)) {'));
  const branch = armed.slice(0, armed.indexOf('\n      return;'));
  check('the armed branch takes the tip, not the pivot',
    /const tip = \(options && options\.tipOrigin\) \|\| origin;/.test(branch));
  check('...for the hover', /hoverRigFromRay\(this\._main, picking, tip, dir,/.test(branch));
  check('...and for the press pick', /intersectionRayMeshes\(targets, tip, dir, true\)/.test(branch));
  check('...with the pivot only as a fallback', /\|\| origin;/.test(branch),
    'a frame with no tip supplied must still pick something');
  check('no raw origin left in the branch', !/picking, origin, dir/.test(branch)
    && !/targets, origin, dir/.test(branch),
    'one of the two using the pivot is the same bug half the time');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
