import * as THREE from 'three';
import Skinning from './Skinning.js';

// SYMMETRY THAT SURVIVES A POSE.
//
// Symmetry works by mirroring the BRUSH across the mesh's local plane and running a second
// stroke. That is exactly right at rest and quietly wrong the moment the character moves: the
// mirror of a posed point is not the pose of the mirrored point. Lift an arm and the mirrored
// brush lands where the other arm would be if it had not moved -- which is usually thin air,
// and occasionally somebody's ribcage.
//
// The fix needs no vertex pairing, no symmetry map, and nothing per-level. A bound mesh already
// carries the whole deformation field, so the mirrored point can be reached by going through
// rest space and back:
//
//   posed point -> rest space (inverse of the skin matrix where it is)
//               -> mirror across the plane (rest space IS the symmetric space)
//               -> posed space (forward skin matrix where it lands)
//
// Both hops are the same per-vertex composite the skin pass applies and the rest-space
// write-back inverts, so this cannot disagree with either of them by construction.
//
// LEVEL-INDEPENDENT, which is the point. It reads only the bound level, so it is the same
// answer whether you are sculpting the base cage or two subdivisions up -- and the mirrored
// stroke that comes out of it is an ORDINARY stroke, so detail vectors, the write-back and
// undo all handle it without knowing symmetry happened.
const PosedSymmetry = {};

// Prefixed scratch, deliberately: these names are short and generic, and this module is
// concatenated with Skinning.js in the harness -- a collision there is a build error at best
// and a silently shared vector at worst.
const _psMat = new THREE.Matrix4(), _psInv = new THREE.Matrix4();
const _psVec = new THREE.Vector3();
const _psPlane = [0, 0, 0];

// Does this mesh need the rest-space route at all? Only a bound mesh that is actually posed:
// at bind pose every skin matrix is the identity, so the plain plane mirror is already correct
// and cheaper, and an unbound mesh has no rest space to travel through.
PosedSymmetry.applies = function (main, mesh) {
  if (!main || !mesh || !Skinning.isBound(mesh)) return false;
  return !Skinning.atBindPose(main, mesh);
};

// The nearest bound-level vertex to `pt`, measured in whichever array is passed. Brute force
// over the BOUND level, which is the cage -- a few thousand vertices, once or twice per stroke
// sample. A grid would be faster and is not yet worth the code: at 3106 vertices this is tens
// of microseconds, against a stroke that costs milliseconds.
function nearest(arr, nbV, px, py, pz) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < nbV; i++) {
    const i3 = i * 3;
    const dx = arr[i3] - px, dy = arr[i3 + 1] - py, dz = arr[i3 + 2] - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Mirror `pt` (mesh-local, posed) into its anatomical opposite, also mesh-local and posed.
// Writes into `out` and returns it, or returns null when the round trip cannot be made -- in
// which case the caller must fall back to the plain plane mirror rather than guess.
// THE PLANE HAS TO BE IN REST SPACE TOO.
//
// This is the trap the whole feature nearly died in. `mesh.getSymmetryOrigin()` is the mesh's
// `_center`, which is the midpoint of the LOCAL BOUND -- recomputed from the geometry as it is
// now, which is to say posed. Mirroring rest-space points across a posed-space plane shifts
// every result sideways by the offset between the two centres, and on a character that is
// easily the thickness of a hand:
//
//   matt: "i grab the outside of the left hand and pull it away from the body centerline,
//   creating a bump. it mirrors to the INSIDE of the right hand ... causing a divot."
//
// Note what that symptom is NOT. The direction was mirrored correctly -- both strokes went away
// from the centreline -- so the reflection was right and only its ORIGIN was wrong. And at bind
// pose it was invisible, because there the two centres coincide: "if i do it at the restpose, it
// works correctly". A bug that only appears posed, in the feature that only runs posed.
//
// The rest centre is measured from `_skinRest`, which is what the rest shape IS. Recomputed per
// call rather than cached: it is one pass over the bound level, the same order as the two
// nearest-vertex searches either side of it, and `_skinRest` moves under every committed
// stroke -- a cache here would be a stale plane, which is the bug again with extra steps.
//
// The NORMAL needs no such treatment: it is a fixed local axis, and posing does not turn it.
function restPlaneOrigin(mesh, nPlane, out) {
  const rest = mesh._skinRest;
  const nbV = (rest.length / 3) | 0;
  if (!nbV) return null;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < nbV; i++) {
    const i3 = i * 3;
    const x = rest[i3], y = rest[i3 + 1], z = rest[i3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const cx = (xmin + xmax) * 0.5, cy = (ymin + ymax) * 0.5, cz = (zmin + zmax) * 0.5;
  // The same shape as getSymmetryOrigin: centre, shifted along the normal by the user's offset
  // scaled by the radius -- both measured in REST space so the whole plane is one space.
  const dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
  const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  const off = (mesh.getSymmetryOffset ? mesh.getSymmetryOffset() : 0) * radius;
  out[0] = cx + nPlane[0] * off;
  out[1] = cy + nPlane[1] * off;
  out[2] = cz + nPlane[2] * off;
  return out;
}

PosedSymmetry.mirrorPoint = function (main, mesh, pt, ptPlane, nPlane, out) {
  const level = Skinning.boundLevelOf(mesh);
  if (!level) return null;
  const rest = mesh._skinRest;
  if (!rest) return null;
  const nbV = (rest.length / 3) | 0;
  const posed = level.getVertices();
  if (level.getNbVertices() !== nbV) return null;

  // Built ONCE and used for both hops: the matrices are the same field in both directions, and
  // rebuilding them between the two would be pure waste at best and a race at worst.
  const mats = Skinning.skinMatricesFor(main, mesh);
  if (!mats) return null;

  // WHERE THE BRUSH IS, IN REST SPACE. The nearest bound vertex stands in for the brush: its
  // skin matrix is the deformation in that neighbourhood, and a brush IS a neighbourhood.
  const a = nearest(posed, nbV, pt[0], pt[1], pt[2]);
  if (a < 0) return null;
  Skinning.blendAt(mesh, mats, a, _psMat);
  _psInv.copy(_psMat).invert();
  _psVec.set(pt[0], pt[1], pt[2]).applyMatrix4(_psInv);

  // REST SPACE IS THE SYMMETRIC SPACE. That is the whole idea: the plane means what it says
  // here, and nowhere else once the character has moved.
  const mir = [_psVec.x, _psVec.y, _psVec.z];
  // `ptPlane` is the caller's POSED-space plane and is deliberately not used here -- see
  // restPlaneOrigin. It stays in the signature because the caller still needs it for the plain
  // mirror it falls back to when this returns null.
  if (!restPlaneOrigin(mesh, nPlane, _psPlane)) return null;
  mirrorAcross(mir, _psPlane, nPlane);

  // AND BACK, through the deformation on the OTHER side -- a different matrix, which is exactly
  // why mirroring in posed space cannot be patched up. The nearest vertex is measured against
  // the REST positions, because that is the space the mirrored point is currently in.
  const b = nearest(rest, nbV, mir[0], mir[1], mir[2]);
  if (b < 0) return null;
  Skinning.blendAt(mesh, mats, b, _psMat);
  _psVec.set(mir[0], mir[1], mir[2]).applyMatrix4(_psMat);
  out[0] = _psVec.x; out[1] = _psVec.y; out[2] = _psVec.z;
  return out;
};

// Reflect in place across the plane. Local to this module rather than borrowed from Geometry,
// because Geometry.mirrorPoint takes the plane in the same layout the mesh reports it and this
// has to work on a bare vec3 in rest space.
function mirrorAcross(v, ptPlane, nPlane) {
  const dx = v[0] - ptPlane[0], dy = v[1] - ptPlane[1], dz = v[2] - ptPlane[2];
  const d = 2 * (dx * nPlane[0] + dy * nPlane[1] + dz * nPlane[2]);
  v[0] -= d * nPlane[0];
  v[1] -= d * nPlane[1];
  v[2] -= d * nPlane[2];
}

// IN PLACE, for a caller that already holds the mirrored point -- the VR path, which mirrors a
// controller position rather than a ray. Returns false when the rest-space route is not
// available, and the caller then does the plain plane mirror it would have done anyway.
PosedSymmetry.mirrorLocal = function (main, mesh, pt, ptPlane, nPlane) {
  if (!PosedSymmetry.applies(main, mesh)) return false;
  return !!PosedSymmetry.mirrorPoint(main, mesh, pt, ptPlane, nPlane, pt);
};

// FOR A MIRRORED RAY, which is how the desktop path works: it reflects the whole pick ray and
// re-casts it, so it lands on whatever surface is really over there rather than on the mirror
// image of this side. That is the better behaviour on an asymmetric mesh and it is worth
// keeping -- so the ray is not rebuilt, it is SHIFTED. The offset is the difference between
// where the plain mirror sends the primary contact and where the anatomy actually is, so the
// direction (and everything that depends on it) is untouched.
//
// The primary pick has already run by the time the symmetric one does, which is what makes a
// contact point available to measure from.
PosedSymmetry.rayOffset = function (main, mesh, ptPlane, nPlane, out) {
  if (!PosedSymmetry.applies(main, mesh)) return null;
  const primary = main.getPicking && main.getPicking();
  if (!primary || primary.getMesh() !== mesh) return null;
  const hit = primary.getIntersectionPoint && primary.getIntersectionPoint();
  if (!hit) return null;

  const plain = [hit[0], hit[1], hit[2]];
  mirrorAcross(plain, ptPlane, nPlane);
  const posedMir = [0, 0, 0];
  if (!PosedSymmetry.mirrorPoint(main, mesh, hit, ptPlane, nPlane, posedMir)) return null;

  out[0] = posedMir[0] - plain[0];
  out[1] = posedMir[1] - plain[1];
  out[2] = posedMir[2] - plain[2];
  return out;
};

PosedSymmetry._restPlaneOrigin = restPlaneOrigin;
PosedSymmetry._nearest = nearest;
PosedSymmetry._mirrorAcross = mirrorAcross;

export default PosedSymmetry;
