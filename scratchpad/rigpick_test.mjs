// The rig-node pick, lifted from the real source.
//
// This exists because the pick has now broken twice in ways no test could see: once picking the
// wrong-sized invisible locator, and once reporting NOTHING when a bone was hit with no mesh
// behind it — nearMesh was never assigned on the rig path. Both were only findable by clicking.
// The cone test is pure geometry, so it can be checked directly.
import fs from 'fs';
import { vec3 } from '/Users/mattestela/sculptxr/node_modules/gl-matrix/esm/index.js';

const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/math3d/Picking.js', 'utf8');
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
    /_vrScale/.test(vr) && /physicalDistance = vec3\.len\([^)]*\) \* vrScale/.test(vr),
    'an unscaled distance changes how far you can reach when the world is scaled');
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
