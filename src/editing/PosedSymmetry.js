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
const _psNrm = new THREE.Matrix3();

// Does this mesh need the rest-space route at all? Only a bound mesh that is actually posed:
// at bind pose every skin matrix is the identity, so the plain plane mirror is already correct
// and cheaper, and an unbound mesh has no rest space to travel through.
// IS A STROKE ACTUALLY IN PROGRESS? One definition, used by all three symmetry traces, because
// three nearly-identical conditions disagreed and produced a log with one line in it where the
// interesting two should have been.
//
// In VR the mirror runs every frame the controller is near the mesh, and `_vrSculpting` is
// UNDEFINED on those frames rather than false -- so `!== false` let hover through. The presence
// of `_vrControllerPos` is what says we are in VR at all; on desktop every call already is a
// stroke.
PosedSymmetry.strokeActive = function (main) {
  if (!main) return false;
  // The decision is made by SculptBase, which is the only place that can see it: whether this
  // is a stroke frame is the `isSculpting` PARAMETER of _makeStrokeXRInner, not any property
  // reachable from here. Three versions of this function asked `main._vrSculpting` instead and
  // silently answered no on every frame.
  if (main._vrControllerPos) return !!window._symTraceOn;
  return true;   // desktop: every call is a stroke
};

// The burst counting now lives in SculptBase, next to the flag it depends on.
PosedSymmetry.traceStroke = function (main) {
  return !!window._symTrace && PosedSymmetry.strokeActive(main);
};

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

// THE CAGE'S OWN MIRROR PAIRING, built once in REST space.
//
// The return hop needs the deformation on the far side, and asking "which cage vertex is
// nearest?" is a SPATIAL question with an anatomical answer -- so it is wrong wherever two
// parts of the body are close together but unrelated. With the hands resting beside the hips,
// the vertex nearest a mirrored hand point is a HIP vertex, and the stroke pulls the hip.
// matt: "if i pull on part of the hand that is in free space on the side i sculpt on, but close
// to the hips on the opposite side ... it pulls out part of the hips rather than the hand."
//
// Pairing the cage to itself instead removes the question. It is measured in rest space, where
// the shape is symmetric and the plane means what it says, and it is a property of the model
// rather than of the pose -- so it holds however the character is standing, including when the
// two sides are touching.
//
// Cheap because it is the CAGE: a few thousand vertices, once per bind, into a hash grid so it
// is a handful of buckets per vertex rather than n^2. Rebuilt only when the vertex count
// changes -- a sculpt moves `_skinRest` slightly and does not repartition anybody's anatomy.
const PAIR_TOL = 0.25;   // fraction of the cage's own cell size; a pair should be nearly exact

function cagePairs(mesh, nPlane) {
  const rest = mesh._skinRest;
  const nbV = (rest.length / 3) | 0;
  if (mesh._skinPairN === nbV && mesh._skinPair) return mesh._skinPair;

  const bb = restBounds(mesh);
  const ex = bb[3] - bb[0], ey = bb[4] - bb[1], ez = bb[5] - bb[2];
  // Cell size aimed at a handful of vertices per bucket.
  const cell = Math.max(1e-6, Math.cbrt((ex * ey * ez) / Math.max(1, nbV)) * 1.5);
  const key = (x, y, z) => (Math.floor(x / cell) + ',' + Math.floor(y / cell)
    + ',' + Math.floor(z / cell));
  const grid = new Map();
  for (let i = 0; i < nbV; i++) {
    const k = key(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    let b = grid.get(k);
    if (!b) grid.set(k, b = []);
    b.push(i);
  }

  const plane = restPlaneOrigin(mesh, nPlane, [0, 0, 0]);
  const pair = new Int32Array(nbV).fill(-1);
  const tol2 = (cell * PAIR_TOL) * (cell * PAIR_TOL);
  const m = [0, 0, 0];
  for (let i = 0; i < nbV; i++) {
    m[0] = rest[i * 3]; m[1] = rest[i * 3 + 1]; m[2] = rest[i * 3 + 2];
    mirrorAcross(m, plane, nPlane);
    let best = -1, bestD = Infinity;
    // The mirrored point can fall anywhere in its own cell, so the neighbours are searched too.
    const cx = Math.floor(m[0] / cell), cy = Math.floor(m[1] / cell), cz = Math.floor(m[2] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const b = grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
          if (!b) continue;
          for (let q = 0; q < b.length; q++) {
            const j = b[q] * 3;
            const ax = rest[j] - m[0], ay = rest[j + 1] - m[1], az = rest[j + 2] - m[2];
            const d = ax * ax + ay * ay + az * az;
            if (d < bestD) { bestD = d; best = b[q]; }
          }
        }
      }
    }
    // UNPAIRED IS A REAL ANSWER. An asymmetric cage, or a vertex whose twin was sculpted away,
    // has no counterpart -- and inventing one puts the stroke somewhere arbitrary. Left at -1,
    // and the caller falls back to the spatial search it used before, which is wrong in a
    // smaller and more local way than a wrong pairing.
    if (best >= 0 && bestD <= tol2) pair[i] = best;
  }
  mesh._skinPair = pair;
  mesh._skinPairN = nbV;
  return pair;
}

// DROP THE VERTICES THAT ARE ONLY SPATIALLY NEARBY.
//
// The mirrored selection is gathered with a SPHERE around the mirrored point, and a sphere does
// not know anatomy. Where the far side rests against another part of the body -- hands on hips
// -- a large enough brush swallows both, and the stroke moves a hip along with the hand. The
// near side shows nothing of the sort, because there the hand is in free space: same radius,
// different neighbourhood. matt: "esp if i use a larger radius. i move the left hand, it also
// moves the right hip."
//
// Each candidate is carried back to rest space by ITS OWN deformation and kept only if it lands
// near the mirrored point there. A hand vertex goes where the hand rests; a hip vertex goes
// where the hip rests, which is nowhere near it, and is dropped.
//
// ITS OWN, emphatically. Carrying every candidate back through the same matrix was the first
// attempt and it cannot work: a rigid transform preserves distance, so the test reduces to the
// posed-space sphere it was meant to replace. The fixture caught that immediately -- the far
// hip and the far hand stayed exactly 0.3 apart through the transform, as they must.
//
// Whose matrix a candidate gets is settled by the nearest CAGE vertex in posed space, through a
// grid built once per call rather than a search per candidate: a few thousand inserts against
// a few hundred lookups is the right way round.
function posedCageGrid(mesh, bound) {
  const v = bound.getVertices();
  const n = bound.getNbVertices();
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const ex = Math.max(1e-6, xmax - xmin), ey = Math.max(1e-6, ymax - ymin);
  const ez = Math.max(1e-6, zmax - zmin);
  const cell = Math.max(1e-6, Math.cbrt((ex * ey * ez) / Math.max(1, n)) * 1.5);
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(v[i * 3] / cell) + ',' + Math.floor(v[i * 3 + 1] / cell)
      + ',' + Math.floor(v[i * 3 + 2] / cell);
    let b = grid.get(k);
    if (!b) grid.set(k, b = []);
    b.push(i);
  }
  return { grid: grid, cell: cell, v: v, n: n };
}

function nearestInGrid(g, x, y, z) {
  const cell = g.cell, v = g.v;
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
  let best = -1, bestD = Infinity;
  for (let r = 1; r <= 4 && best < 0; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const b = g.grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
          if (!b) continue;
          for (let q = 0; q < b.length; q++) {
            const j = b[q] * 3;
            const ax = v[j] - x, ay = v[j + 1] - y, az = v[j + 2] - z;
            const d = ax * ax + ay * ay + az * az;
            if (d < bestD) { bestD = d; best = b[q]; }
          }
        }
      }
    }
  }
  return best;
}

PosedSymmetry.pruneMirrored = function (mesh, verts, nbVerts, level, radius) {
  const centre = PosedSymmetry._lastMirRest;
  const mats = PosedSymmetry._lastMats;
  if (!centre || !mats) return nbVerts;
  const bound = Skinning.boundLevelOf(mesh);
  if (!bound) return nbVerts;

  const g = posedCageGrid(mesh, bound);
  const posed = level.getVertices();
  const lim2 = radius * radius;
  const invCache = new Map();
  let keep = 0;
  for (let i = 0; i < nbVerts; i++) {
    const v = verts[i], v3 = v * 3;
    const px = posed[v3], py = posed[v3 + 1], pz = posed[v3 + 2];
    const c = nearestInGrid(g, px, py, pz);
    // Undecidable, so kept: refusing to answer is not a reason to throw away someone's stroke.
    if (c < 0) { verts[keep++] = v; continue; }
    let inv = invCache.get(c);
    if (!inv) {
      inv = new THREE.Matrix4();
      Skinning.blendAt(mesh, mats, c, inv);
      inv.invert();
      invCache.set(c, inv);
    }
    _psVec.set(px, py, pz).applyMatrix4(inv);
    const ax = _psVec.x - centre[0], ay = _psVec.y - centre[1], az = _psVec.z - centre[2];
    if (ax * ax + ay * ay + az * az <= lim2) verts[keep++] = v;
  }
  return keep;
};

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
const _psBounds = [0, 0, 0, 0, 0, 0];
function restBounds(mesh) {
  const rest = mesh._skinRest;
  const nbV = (rest.length / 3) | 0;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < nbV; i++) {
    const i3 = i * 3;
    const x = rest[i3], y = rest[i3 + 1], z = rest[i3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  _psBounds[0] = xmin; _psBounds[1] = ymin; _psBounds[2] = zmin;
  _psBounds[3] = xmax; _psBounds[4] = ymax; _psBounds[5] = zmax;
  return _psBounds;
}

function restPlaneOrigin(mesh, nPlane, out) {
  const rest = mesh._skinRest;
  const nbV = (rest.length / 3) | 0;
  if (!nbV) return null;
  const bb = restBounds(mesh);
  const xmin = bb[0], ymin = bb[1], zmin = bb[2], xmax = bb[3], ymax = bb[4], zmax = bb[5];
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

// `nrm`, when given, is a mesh-local NORMAL at `pt`, mirrored in place alongside the point.
//
// It has to make the same journey, and for the same reason. The brush's stroke direction comes
// from this normal, and downstream getFrontVertices() culls every vertex behind its tangent
// plane -- so a normal from the wrong space does not merely aim the stroke badly, it throws
// away the entire mirrored selection and the stroke does nothing at all. That is the difference
// between "mirrors to the wrong place" and matt's "now nothing gets mirrored".
//
// Normals do not transform like points: forward they take (M^-1)^T, so BACKWARD they take
// M^T -- which is getNormalMatrix of the INVERSE, and getNormalMatrix of the forward matrix on
// the way out. For a rigid blend both reduce to the rotation; they diverge exactly when a joint
// carries scale, which is when getting it wrong would be hardest to spot.
PosedSymmetry.mirrorPoint = function (main, mesh, pt, ptPlane, nPlane, out, nrm) {
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
  // SNAPSHOT THE INPUT. Callers pass the same array as `out` (mirrorLocal mirrors in place), so
  // anything read after the write sees the result, not the input -- which made the first
  // version of the trace below print `hit` and `out` as the same point on every line and unable
  // to tell a working mirror from a no-op.
  const hx = pt[0], hy = pt[1], hz = pt[2];

  const a = nearest(posed, nbV, hx, hy, hz);
  if (a < 0) return null;
  Skinning.blendAt(mesh, mats, a, _psMat);
  _psInv.copy(_psMat).invert();
  _psVec.set(hx, hy, hz).applyMatrix4(_psInv);
  const rx = _psVec.x, ry = _psVec.y, rz = _psVec.z;

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
  // THE FAR SIDE'S VERTEX, by pairing rather than proximity -- see cagePairs. The spatial
  // search stays as the fallback for a vertex with no twin.
  // Kept for pruneMirrored, which needs the centre of the brush IN REST SPACE to judge whether
  // a candidate vertex belongs to the part being sculpted.
  PosedSymmetry._lastMirRest = [mir[0], mir[1], mir[2]];
  PosedSymmetry._lastMats = mats;

  const pairs = cagePairs(mesh, nPlane);
  let b = pairs[a];
  if (b < 0) b = nearest(rest, nbV, mir[0], mir[1], mir[2]);
  if (b < 0) return null;
  Skinning.blendAt(mesh, mats, b, _psMat);
  // Kept for pruneMirrored: the far side's deformation, inverted, is what carries a candidate
  // vertex back to rest space to be judged.
  _psVec.set(mir[0], mir[1], mir[2]).applyMatrix4(_psMat);
  out[0] = _psVec.x; out[1] = _psVec.y; out[2] = _psVec.z;

  if (nrm) {
    // posed -> rest: M_a^T, which is the normal matrix of M_a's inverse.
    Skinning.blendAt(mesh, mats, a, _psMat);
    _psInv.copy(_psMat).invert();
    _psNrm.getNormalMatrix(_psInv);
    _psVec.set(nrm[0], nrm[1], nrm[2]).applyMatrix3(_psNrm).normalize();
    // reflect the DIRECTION: no plane origin, only the plane's normal
    const d = 2 * (_psVec.x * nPlane[0] + _psVec.y * nPlane[1] + _psVec.z * nPlane[2]);
    _psVec.set(_psVec.x - d * nPlane[0], _psVec.y - d * nPlane[1], _psVec.z - d * nPlane[2]);
    // rest -> posed on the far side: the normal matrix of M_b.
    Skinning.blendAt(mesh, mats, b, _psMat);
    _psNrm.getNormalMatrix(_psMat);
    _psVec.applyMatrix3(_psNrm).normalize();
    nrm[0] = _psVec.x; nrm[1] = _psVec.y; nrm[2] = _psVec.z;
  }

  // `window._symTrace = true` (or Settings > Trace Posed Symmetry) prints the whole round trip
  // once a second FROM THE DEVICE. Every hop is a point in a named space, so a wrong space
  // shows up as a number in the wrong range rather than as a stroke that goes missing.
  // Stroke frames only, and decided once per frame by traceStroke -- see the note there.
  if (PosedSymmetry._traceOn) {
      const f = (v) => '[' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ']';
      const rb = restBounds(mesh);
      // Every hop, in order, so a bad one is the first number that stops making sense:
      //   hit    posed surface, where the brush is
      //   rest   the SAME point carried back through the skin matrix at cage vertex #a
      //   mir    that, reflected across the rest plane
      //   out    forward through the matrix at cage vertex #b -- the mirrored brush
      // Also the cage positions of #a and #b, because the two hops each stand or fall on
      // whether the vertex they picked is anywhere near the point they picked it for.
      const posedA = [posed[a * 3], posed[a * 3 + 1], posed[a * 3 + 2]];
      const restB = [rest[b * 3], rest[b * 3 + 1], rest[b * 3 + 2]];
      console.log('[sym] hit ' + f([hx, hy, hz]) + ' -> rest ' + f([rx, ry, rz])
        + ' -> mir ' + f(mir) + ' -> out ' + f(out)
        + ' | cage#' + a + ' at ' + f(posedA) + ' (posed, d='
        + Math.hypot(posedA[0] - hx, posedA[1] - hy, posedA[2] - hz).toFixed(2) + ')'
        + ' cage#' + b + ' at ' + f(restB) + ' (rest, d='
        + Math.hypot(restB[0] - mir[0], restB[1] - mir[1], restB[2] - mir[2]).toFixed(2) + ')'
        + ' | restPlane ' + f(_psPlane) + ' posedPlane ' + f(ptPlane)
        + ' | restBounds x ' + rb[0].toFixed(2) + '..' + rb[3].toFixed(2)
        + ' y ' + rb[1].toFixed(2) + '..' + rb[4].toFixed(2)
        + ' | of ' + nbV + ' normal ' + f(nPlane));
  }
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
PosedSymmetry.mirrorLocal = function (main, mesh, pt, ptPlane, nPlane, nrm) {
  if (!PosedSymmetry.applies(main, mesh)) return false;
  // Decided ONCE, here, so the point trace, the path trace and the vertex-count trace all
  // describe the same frame instead of three frames chosen by three separate throttles.
  // Throttled here rather than gated on a stroke flag published by SculptBase: Move (and every
  // other tool with its own symmetry branch) never sets that flag, so a log filtered for "sym"
  // came back empty on exactly the tool being tested. matt: "the logs are very noisy now, i
  // couldn't see anything about symmetry in them."
  const _tnow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  PosedSymmetry._traceOn = !!window._symTrace && (_tnow - (PosedSymmetry._traceAt || 0) > 500);
  if (PosedSymmetry._traceOn) PosedSymmetry._traceAt = _tnow;
  return !!PosedSymmetry.mirrorPoint(main, mesh, pt, ptPlane, nPlane, pt, nrm);
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
