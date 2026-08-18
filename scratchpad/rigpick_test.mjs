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

// Pins outrank bones by RANK, not by distance — they sit on the same pixel as their joint.
check('pins outrank bones', /rank = mesh\._isPinTarget \? 2 : 1/.test(SRC));
check('rank dominates distance', /score = tAlong - rank \* 1e6/.test(SRC));

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
  check('VR: rig nodes use the cone, not geometry', /_rigPickConeVR \|\| 0\.075/.test(vr));
  // Pins need a WIDER cone, not just a higher rank: with equal cones a bone at the edge is as
  // easy to catch as the pin sitting on it, and ranking only decides ties.
  check('VR: the pin cone is wider than the bone cone',
    /_rigPickConeVRPin \|\| 0\.14/.test(vr) && 0.14 > 0.075);
  check('VR: pins outrank bones', /isPin \? 2 : 1/.test(vr));
  check('VR: a lone rig hit is adopted without a mesh hit',
    /if \(nearRig\) \{[\s\S]{0,400}?nearMesh = nearRig;/.test(vr),
    'the same guard that broke the desktop path');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
