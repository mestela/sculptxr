import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';
import Geometry from '../math3d/Geometry.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Utils from '../misc/Utils.js';

// WEIGHT CAGES — a capsule you can sculpt.
//
// The bind is NEAREST CAPSULE, ONE BONE PER VERTEX (see Skinning). A capsule is entirely
// derived: two joint positions and one radius on the child joint. So "tune the weights" has
// meant "drag one number per bone", and any shape a limb actually needs -- a deltoid, a jaw, a
// thigh fatter at the hip than the knee -- is unreachable.
//
// matt's framing, and it is the cheap one: BAKE THE CAPSULE TO A MESH, parent it to the bone,
// and let the bind measure against that instead. A mesh is sculptable with the brush stack that
// already exists, parents with setMeshParent, and carries its own bounds -- so almost nothing
// new is built. The roadmap's objection was that a distance-to-volume query needs an
// accelerator; that is true per FRAME and irrelevant here, because binding happens once.
//
// WHAT HAD TO CHANGE. The capsule bind ranks by `distance / radius`, deliberately, so a thin
// finger capsule cannot steal territory from a fat torso capsule merely by being nearer the
// surface. An arbitrary cage has no radius to divide by. The replacement is SIGNED distance:
// inside is negative, and the most negative wins. That gives "inside beats outside, deepest
// inside wins ties, and only vertices outside every cage fall back to nearest surface" from a
// single ranking number -- and it makes a cage an exact statement about what it owns, which is
// the same property that made rigid one-bone-per-vertex worth having.
const WeightCage = {};

// OPAQUE. Translucency was meant to solve "a capsule lives inside the skin so you cannot see
// it", and it made things worse rather than better -- a translucent shape inside another shape
// is harder to read than either alone. matt: "the translucent stuff is making it hard to
// understand." Hide the skin instead; that is one click in the outliner and unambiguous.
//
// Still a knob, because the judgement is made while looking at one.
WeightCage.OPACITY = 1;

WeightCage.isCage = function (m) { return !!(m && m._isWeightCage); };

// ---- cage opacity -----------------------------------------------------------------
//
// THE OTHER HALF OF THE X-RAY. Skinning.skinOpacity makes the SKIN see-through so you can find
// the capsule inside it; this makes the CAPSULES see-through so you can watch the weights
// change on the skin underneath while you sculpt one. matt: "i'd need to set their opacity all
// at once, so i can verify that sculpting it is affecting the weights of the target geometry."
//
// All of them together, because a cage is never the thing you are looking at -- the character
// is -- and setting twenty opacities one outliner row at a time is not a thing anyone will do.
//
// A PRIVATE MATERIAL PER CAGE, for the reason spelled out at Skinning.applySkinOpacity: every
// matcap mesh shares one cached ShaderMaterial and the per-frame loop writes each mesh's alpha
// into it in turn, so the alpha the GPU uses is whichever mesh was visited last. Without the
// clone, dimming the cages dims the character with them -- which is the exact bug matt hit from
// the other side ("xray is affecting both the skin mesh and the capsule meshes, thats stupid").
WeightCage.opacity = function () {
  const live = window._cageOpacity;
  if (Number.isFinite(live) && live > 0) return live;
  const saved = getOptionsURL().cageOpacity;
  return Number.isFinite(saved) && saved > 0 ? saved : 1;
};

WeightCage.setOpacity = function (main, v) {
  window._cageOpacity = Math.min(1, Math.max(0.05, v));
  getOptionsURL.saveOption('cageOpacity', window._cageOpacity, 300);
  return WeightCage.applyOpacity(main);
};

// Also called after a bake, so cages made while the slider is down come up see-through rather
// than making the setting look like it stopped working.
WeightCage.applyOpacity = function (main) {
  const a = WeightCage.opacity();
  const clear = a >= 0.99;
  let n = 0;
  for (const cage of WeightCage.cages(main)) {
    cage.setOpacity(a);
    const tm = cage.getThreeMesh && cage.getThreeMesh();
    const mat = tm && tm.material;
    if (mat) {
      if (!mat.userData || !mat.userData._cagePrivate) {
        const own = mat.clone();
        own.userData = Object.assign({}, mat.userData, { _cagePrivate: true });
        tm.material = own;
      }
      tm.material.transparent = true;
      // A see-through cage that still WRITES depth hides the very skin it is supposed to let
      // you see -- the same trap the x-ray skin has, from the other side.
      tm.material.depthWrite = clear;
      tm.material.needsUpdate = true;
      // After the skin (0, or 2 while its own x-ray is on), so a dimmed cage blends OVER the
      // character rather than the character painting over it.
      tm.renderOrder = clear ? 0 : 3;
    }
    n++;
  }
  return n;
};

WeightCage.cages = function (main) {
  return (main.getMeshes() || []).filter(WeightCage.isCage);
};

// A capsule as a triangle mesh: a tube of `radial` sides between the two ends, capped with
// hemispheres. Deliberately low-poly -- it is a volume to be measured against and sculpted, not
// rendered detail, and every triangle is one more the bind walks per vertex.
// `shape`, when given, is {hA:[x,y,z], hB:[x,y,z]} -- the half-extents of each END, in the space
// A and B are given in. With it the capsule TAPERS and its ends are ellipsoids; without it, r is
// one radius for the whole thing and it is the plain capsule this always made.
//
// Generate with r = 1 when passing a shape: the reshape below treats each vertex's offset from
// the axis as a unit direction and scales it by the extents, so a unit capsule is the input it
// expects.
function capsuleGeometry(ax, ay, az, bx, by, bz, r, radial, rings, lengthSegs, shape) {
  const A = new THREE.Vector3(ax, ay, az);
  const B = new THREE.Vector3(bx, by, bz);
  const axis = new THREE.Vector3().subVectors(B, A);
  const len = axis.length();
  if (len < 1e-9) return null;
  axis.multiplyScalar(1 / len);
  // Any perpendicular will do; pick the one furthest from the axis so it cannot be degenerate.
  const up = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(up, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);

  lengthSegs = Math.max(2, lengthSegs || 2);
  const verts = [];
  const push = (p) => { verts.push(p.x, p.y, p.z); return verts.length / 3 - 1; };
  const _p = new THREE.Vector3();

  // ROWS FROM POLE TO POLE, built as an explicit list rather than an index puzzle.
  //
  // The tube gets `lengthSegs` bands, so there are edge loops ALONG the bone and not just at
  // its two ends -- without them the middle of a capsule has no vertices to move and cannot be
  // shaped at all, which is the one thing this mesh exists for. matt: "the capsules don't have
  // an edge loop around their center, they should."
  //
  // The previous version also emitted the ring at A twice, once as the last cap row and again
  // as the first tube row: a degenerate band of zero-area quads down the middle of every
  // capsule.
  const rows = [];
  const addRow = (centre, rad) => {
    const ids = [];
    if (rad < 1e-6) {
      ids.push(push(centre));               // a pole is one vertex, shared by the whole ring
      rows.push({ ids: ids, pole: true });
      return;
    }
    for (let k = 0; k < radial; k++) {
      const t = (k / radial) * Math.PI * 2;
      _p.copy(centre).addScaledVector(u, Math.cos(t) * rad).addScaledVector(v, Math.sin(t) * rad);
      ids.push(push(_p));
    }
    rows.push({ ids: ids, pole: false });
  };

  // Cap A: pole round to the ring sitting on A.
  for (let i = 0; i <= rings; i++) {
    const ang = (Math.PI / 2) * (1 - i / rings);
    addRow(A.clone().addScaledVector(axis, -Math.sin(ang) * r), Math.cos(ang) * r);
  }
  // The tube, divided along its length. i starts at 1 because the ring at A is already there.
  for (let i = 1; i < lengthSegs; i++) {
    addRow(A.clone().addScaledVector(axis, (len * i) / lengthSegs), r);
  }
  // Cap B: the ring on B, round to the pole.
  for (let i = 0; i <= rings; i++) {
    const ang = (Math.PI / 2) * (i / rings);
    addRow(B.clone().addScaledVector(axis, Math.sin(ang) * r), Math.cos(ang) * r);
  }

  const faces = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const lo = rows[i], hi = rows[i + 1];
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const a = lo.pole ? lo.ids[0] : lo.ids[k];
      const b = lo.pole ? lo.ids[0] : lo.ids[k2];
      const c = hi.pole ? hi.ids[0] : hi.ids[k2];
      const d = hi.pole ? hi.ids[0] : hi.ids[k];
      if (lo.pole) faces.push(a, c, d, Utils.TRI_INDEX);       // fan at the first pole
      else if (hi.pole) faces.push(a, b, c, Utils.TRI_INDEX);  // fan at the last
      else faces.push(a, b, c, d);
    }
  }
  // ── TAPER AND PER-AXIS EXTENTS ────────────────────────────────────────────────────
  //
  // Applied as a reshape rather than woven into the rows above, so the topology stays one
  // description and cannot drift between the plain and the shaped case.
  //
  // Each vertex is pushed out from the point on the AXIS nearest to it. Clamping t to [0,1]
  // is what makes the two caps ellipsoids of their own joint's extents: every cap vertex
  // measures from the end centre, while the tube lerps between the two.
  //
  // THE EXTENTS ARE WORLD-AXIS ALIGNED, which is why this has to run in the space they were
  // measured in -- see the note at the call site about building in model space and mapping the
  // result into the parent's frame afterwards, rather than the other way round.
  if (shape && shape.hA && shape.hB) {
    const hA = shape.hA, hB = shape.hB;
    const _c = new THREE.Vector3(), _o = new THREE.Vector3();
    for (let i = 0; i < verts.length; i += 3) {
      _o.set(verts[i] - A.x, verts[i + 1] - A.y, verts[i + 2] - A.z);
      const t = Math.max(0, Math.min(1, _o.dot(axis) / len));
      _c.copy(A).addScaledVector(axis, t * len);
      _o.set(verts[i] - _c.x, verts[i + 1] - _c.y, verts[i + 2] - _c.z);
      verts[i]     = _c.x + _o.x * (hA[0] + (hB[0] - hA[0]) * t);
      verts[i + 1] = _c.y + _o.y * (hA[1] + (hB[1] - hA[1]) * t);
      verts[i + 2] = _c.z + _o.z * (hA[2] + (hB[2] - hA[2]) * t);
    }
  }
  return { verts: new Float32Array(verts), faces: new Uint32Array(faces) };
}

WeightCage.capsuleGeometry = capsuleGeometry;

// ── THE CAGE SHELL ────────────────────────────────────────────────────────────────────
//
// A SUBDIVIDED CUBE. Better than the lat-long shell it replaces: all quads and no poles (a
// lat-long sphere fans triangles at each end, which is the worst place to sculpt), even spacing
// so a subdivision or a smooth behaves the same everywhere, and one topology for every cage.
function cubeShell(n) {
  const verts = [];
  const index = new Map();
  const at = (i, j, k) => {
    const key = i + ',' + j + ',' + k;
    if (index.has(key)) return index.get(key);
    verts.push((i / n) * 2 - 1, (j / n) * 2 - 1, (k / n) * 2 - 1);
    const id = verts.length / 3 - 1;
    index.set(key, id);
    return id;
  };
  const faces = [];
  const quad = (a, b, c, d) => faces.push(a, d, c, b);   // wound outward — see the note below
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      quad(at(i, j, 0), at(i + 1, j, 0), at(i + 1, j + 1, 0), at(i, j + 1, 0));
      quad(at(i, j, n), at(i, j + 1, n), at(i + 1, j + 1, n), at(i + 1, j, n));
      quad(at(i, 0, j), at(i, 0, j + 1), at(i + 1, 0, j + 1), at(i + 1, 0, j));
      quad(at(i, n, j), at(i + 1, n, j), at(i + 1, n, j + 1), at(i, n, j + 1));
      quad(at(0, i, j), at(0, i + 1, j), at(0, i + 1, j + 1), at(0, i, j + 1));
      quad(at(n, i, j), at(n, i, j + 1), at(n, i + 1, j + 1), at(n, i + 1, j));
    }
  }
  return { verts: verts, faces: faces };
}

WeightCage.cubeShell = cubeShell;

// A cage prepared for measuring: its triangles in the SKIN MESH's local space, plus a bounding
// box. Transformed once per cage rather than per vertex -- a cage is a few hundred triangles
// and the sculpt is a hundred thousand vertices, so the direction of that conversion is the
// difference between a bind that takes a second and one that takes a minute.
WeightCage.prepare = function (cage, skinInvModel, jointIndex) {
  // THE LEVEL YOU ARE LOOKING AT, not level 0. A cage is there to be sculpted, and sculpting it
  // at a subdivided level would otherwise leave the bind measuring the smooth base underneath
  // and reporting no change at all. The trade is honest and visible: a heavily subdivided cage
  // costs bind time, and the bind reports its milliseconds.
  const level = cage.getCurrentMesh ? cage.getCurrentMesh() : (cage._meshes ? cage._meshes[0] : cage);
  const verts = level.getVertices ? level.getVertices() : null;
  const faces = level.getFaces ? level.getFaces() : null;
  if (!verts || !faces) return null;
  const m = new THREE.Matrix4().multiplyMatrices(
    skinInvModel, new THREE.Matrix4().fromArray(cage.getModelSpaceMatrix()));
  const n = verts.length / 3;
  const out = new Float32Array(n * 3);
  const _v = new THREE.Vector3();
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    _v.set(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]).applyMatrix4(m);
    out[i * 3] = _v.x; out[i * 3 + 1] = _v.y; out[i * 3 + 2] = _v.z;
    if (_v.x < bb[0]) bb[0] = _v.x; if (_v.y < bb[1]) bb[1] = _v.y; if (_v.z < bb[2]) bb[2] = _v.z;
    if (_v.x > bb[3]) bb[3] = _v.x; if (_v.y > bb[4]) bb[4] = _v.y; if (_v.z > bb[5]) bb[5] = _v.z;
  }
  // HANDEDNESS, because a MIRRORED SKIN TURNS EVERY CAGE INSIDE OUT.
  //
  // signedDistance decides inside from the winning triangle's NORMAL, and a normal is the cross
  // product of two edges -- so it depends on winding. The matrix above carries the cage into the
  // skin mesh's local space, and when that skin is a mirrored instance the matrix has a NEGATIVE
  // determinant: every triangle comes through wound the other way and every normal points in
  // instead of out. The sign then inverts wholesale.
  //
  // matt: "i notice that one eye refuses to upate its weights. any reason there? scale by -1 or
  // something confusing it?" Exactly that. His camel's eyeinner and eyeouter carry scale.x of
  // -12.657 and -12.747 where their twins are positive -- one eye of each pair is the mirror.
  // Measured on a capsule prepared into a mirrored space: a point at its CENTRE read +5.706
  // (outside) and a point well clear of it read -34.294 (inside).
  //
  // Recorded once per cage here rather than tested per vertex: this runs once per cage per bind
  // and the sign is a property of the transform, not of the point.
  const flip = m.determinant() < 0 ? -1 : 1;
  return { joint: jointIndex, verts: out, faces: faces, bb: bb, mesh: cage, flip: flip };
};

const _cp = [0, 0, 0];
const _v1 = [0, 0, 0], _v2 = [0, 0, 0], _v3 = [0, 0, 0], _pt = [0, 0, 0];

// SIGNED distance from a point to a cage, negative inside.
//
// The sign is taken from the winning triangle's normal rather than by casting a ray and
// counting crossings: a cage is a capsule, or a sculpted version of one, so it is near enough
// convex for the normal test to agree with the parity test everywhere it matters -- and the
// parity test costs a ray march per vertex per cage, which is the whole budget.
//
// Returns Infinity when the point is outside the cage's bounding box by more than `slack`, so
// the caller can skip it without walking a single triangle. That box test is the broadphase:
// each vertex then measures against the one to three cages actually near it.
WeightCage.signedDistance = function (c, px, py, pz, slack) {
  const bb = c.bb;
  if (px < bb[0] - slack || py < bb[1] - slack || pz < bb[2] - slack
   || px > bb[3] + slack || py > bb[4] + slack || pz > bb[5] + slack) return Infinity;

  const f = c.faces, v = c.verts;
  let best = Infinity, bestSign = 1;
  _pt[0] = px; _pt[1] = py; _pt[2] = pz;
  // ivec4 per face: a quad is measured as its two triangles, a triangle has TRI_INDEX in the
  // fourth slot and is measured once.
  for (let t = 0; t + 3 < f.length; t += 4) {
    const quad = f[t + 3] !== Utils.TRI_INDEX;
    for (let half = 0; half < (quad ? 2 : 1); half++) {
    const i1 = f[t] * 3;
    const i2 = (half === 0 ? f[t + 1] : f[t + 2]) * 3;
    const i3 = (half === 0 ? f[t + 2] : f[t + 3]) * 3;
    _v1[0] = v[i1]; _v1[1] = v[i1 + 1]; _v1[2] = v[i1 + 2];
    _v2[0] = v[i2]; _v2[1] = v[i2 + 1]; _v2[2] = v[i2 + 2];
    _v3[0] = v[i3]; _v3[1] = v[i3 + 1]; _v3[2] = v[i3 + 2];
    const d2 = Geometry.distance2PointTriangle(_pt, _v1, _v2, _v3, _cp);
    if (d2 >= best) continue;
    best = d2;
    // Which side: the face normal against the vector from the surface to the point.
    const ex = _v2[0] - _v1[0], ey = _v2[1] - _v1[1], ez = _v2[2] - _v1[2];
    const fx = _v3[0] - _v1[0], fy = _v3[1] - _v1[1], fz = _v3[2] - _v1[2];
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const dot = nx * (px - _cp[0]) + ny * (py - _cp[1]) + nz * (pz - _cp[2]);
    bestSign = dot < 0 ? -1 : 1;
    }
  }
  if (!isFinite(best)) return Infinity;
  // The handedness correction goes HERE and not on the Infinity above: that is a broadphase
  // miss, and -Infinity would read as the deepest inside of anything rather than as a skip.
  return bestSign * (c.flip || 1) * Math.sqrt(best);
};

// ONE BONE PER VERTEX, ranked by signed distance: inside beats outside, deepest inside wins,
// and a vertex outside every cage falls to the nearest surface. `outside` counts the vertices
// no cage actually contains -- the same diagnostic the capsule bind reports, and it means the
// same thing: the cages are too small.
WeightCage.weights = function (verts, nbV, cages, maxInfluences, slack) {
  const idx = new Int32Array(nbV * maxInfluences).fill(-1);
  const wts = new Float32Array(nbV * maxInfluences);
  // HOW FAR EACH VERTEX WAS FROM THE CAGE THAT WON IT. Kept because it is exactly what makes a
  // partial re-solve tight: a cage can only take a vertex by beating that distance, so a vertex
  // further from the edited cage than this cannot have changed. See WeightCage.candidates.
  const dist = new Float32Array(nbV).fill(Infinity);
  let outside = 0;
  for (let i = 0; i < nbV; i++) {
    const px = verts[i * 3], py = verts[i * 3 + 1], pz = verts[i * 3 + 2];
    let bestJoint = -1, bestD = Infinity;
    for (let c = 0; c < cages.length; c++) {
      const d = WeightCage.signedDistance(cages[c], px, py, pz, slack);
      if (d < bestD) { bestD = d; bestJoint = cages[c].joint; }
    }
    if (bestJoint < 0) continue;
    if (bestD > 0) outside++;
    idx[i * maxInfluences] = bestJoint;
    wts[i * maxInfluences] = 1;
    dist[i] = bestD;
  }
  return { idx: idx, wts: wts, dist: dist, outside: outside };
};

// THE SAME QUESTION, ASKED ABOUT A FEW VERTICES INSTEAD OF ALL OF THEM.
//
// Sculpting one capsule cannot change what most of the mesh is weighted to, so re-measuring
// every vertex against every cage after every stroke is nearly all wasted work -- and it is the
// work that decides whether the weight colours can update on stroke end at all, or only on a
// Rebind. matt: "we could accellerate this further by only testing against the last touched
// capsule."
//
// `candidates` (from WeightCage.candidates) is the set that can actually have changed;
// everything else is copied from `base`.
// WHICH VERTICES ONE SCULPTED CAPSULE CAN HAVE CHANGED.
//
// Two sets, and both are needed. Everything the touched bone OWNED, because the capsule may
// have shrunk out from under it; and everything inside the capsule's new bounding box, because
// it may have grown over vertices another bone owned. A vertex outside every cage falls to its
// nearest surface, so the box is padded by the capsule's own diagonal to catch the ones just
// beyond it -- padded by the scene-wide slack instead, the set would be the whole mesh and the
// shortcut would be a no-op with extra steps.
//
// Lives here, next to the measurement it is a shortcut for, so it can be tested against a full
// solve: a candidate rule that misses a vertex is a wrong weight that only appears in one
// sculpt out of ten, which is exactly the kind of thing that never gets noticed by looking.
WeightCage.candidates = function (verts, nbV, cage, base, maxInfluences) {
  const bb = cage.bb;
  const idx = base.idx, dist = base.dist;
  const out = [];
  for (let i = 0; i < nbV; i++) {
    // Everything the touched bone already owned: its capsule may have shrunk out from under it.
    if (idx[i * maxInfluences] === cage.joint) { out.push(i); continue; }
    // A vertex with no owner, or no recorded distance, has nothing to beat -- always measure.
    const d = dist ? dist[i] : Infinity;
    if (!isFinite(d)) { out.push(i); continue; }
    // Otherwise the edited cage has to BEAT the distance this vertex already had, and distance
    // to the cage's box is a lower bound on distance to the cage. A vertex further outside the
    // box than its current winner's distance cannot change hands, whatever was sculpted.
    //
    // A vertex INSIDE its cage (negative distance) can only be taken by a cage it is also
    // inside, so the box alone decides -- max(0, d) says both of those in one line.
    const pad = d > 0 ? d : 0;
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    if (x >= bb[0] - pad && x <= bb[3] + pad &&
        y >= bb[1] - pad && y <= bb[4] + pad &&
        z >= bb[2] - pad && z <= bb[5] + pad) out.push(i);
  }
  return out;
};

WeightCage.weightsPartial = function (verts, cages, maxInfluences, slack, candidates, base) {
  const idx = new Int32Array(base.idx);
  const wts = new Float32Array(base.wts);
  const dist = base.dist ? new Float32Array(base.dist) : new Float32Array(idx.length / maxInfluences).fill(Infinity);
  let outside = 0;
  for (let n = 0; n < candidates.length; n++) {
    const i = candidates[n];
    const px = verts[i * 3], py = verts[i * 3 + 1], pz = verts[i * 3 + 2];
    let bestJoint = -1, bestD = Infinity;
    for (let c = 0; c < cages.length; c++) {
      const d = WeightCage.signedDistance(cages[c], px, py, pz, slack);
      if (d < bestD) { bestD = d; bestJoint = cages[c].joint; }
    }
    // A candidate that reaches no cage at all keeps whatever it had: dropping it would UNWEIGHT
    // a vertex on the strength of a broadphase miss.
    if (bestJoint < 0) continue;
    if (bestD > 0) outside++;
    for (let k = 0; k < maxInfluences; k++) { idx[i * maxInfluences + k] = -1; wts[i * maxInfluences + k] = 0; }
    idx[i * maxInfluences] = bestJoint;
    wts[i * maxInfluences] = 1;
    dist[i] = bestD;
  }
  return { idx: idx, wts: wts, dist: dist, outside: outside };
};

// ── BAKING ────────────────────────────────────────────────────────────────────────────
//
// One cage per BONE, built from the capsule that bone already has, and parented to the joint
// the bone hangs from -- the same joint `boneSegments` credits with the bone, so a cage moves
// with its bone for free and needs no separate rig.
//
// Starting from the capsules rather than from nothing is the point: the existing weighting is
// already right nearly everywhere, so a bake reproduces what you have and sculpting is only
// needed where it was wrong. matt: "most things should be fine as is; this sculpting would only
// be required for problematic shapes."
// One cage mesh, built and put in the scene. Shared by the volume pass and the capsule pass so
// the two cannot drift in colour, flags, buffer upload or parenting — every one of which has
// already cost a round of "the cage is there and invisible".
function makeCage(main, geo, owner, namedAfter, prefix) {
  const base = new MeshStatic(main._gl);
  base.setVertices(geo.verts);
  base.setFaces(geo.faces);
  base.init();
  if (main._gl) base.initRender();
  const cage = new Multimesh(base);
  cage.setMatcap(getOptionsURL().matcap);

  // THE COLOUR OF THE BONE IT SPEAKS FOR, as vertex colours — which is where a SculptGL mesh
  // keeps colour, and it means sculpting the cage keeps it, since new vertices inherit from
  // their neighbours.
  // sRGB components -- this paints SculptGL vertex colours. See Skeleton.boneColorSRGB.
  const col = Skeleton.boneColorSRGB(main, owner);
  const cAr = base.getColors();
  if (cAr) {
    for (let ci = 0; ci < cAr.length; ci += 3) {
      cAr[ci] = col.r; cAr[ci + 1] = col.g; cAr[ci + 2] = col.b;
    }
  }
  cage.setOpacity(WeightCage.OPACITY);
  cage.setShowWireframe(true);
  // UPLOAD THE BUFFERS. init() writes positions and builds the three mesh; the INDEX buffer is
  // written by updateBuffers(), and without it the geometry has vertices and no triangles — it
  // draws nothing at all. Primitives get this free from normalizeSize(), which these must not
  // call: it rescales to a unit box, which is exactly the fit being preserved here.
  cage.updateGeometry();
  if (cage.updateDuplicateColorsAndMaterials) cage.updateDuplicateColorsAndMaterials();
  cage.updateBuffers();
  cage._typeName = 'Cage';
  cage.isQuad = true;
  cage._isWeightCage = true;
  // WHICH BONE THIS SPEAKS FOR. By joint ID rather than index: the joint list is rebuilt on
  // every call and an index would point at a different bone the moment one is added or split.
  cage._cageJointId = owner.getID();
  cage._permanentStaticLabel = prefix + (namedAfter._permanentStaticLabel || namedAfter.getID());
  // SILENT: a bake makes twenty of these and it is ONE action. addNewMesh would push a state
  // per cage, so undoing a bake meant undoing each capsule in turn — matt: "if i bake capsules,
  // i noticed i can't undo in one step, but i have to undo every capsule being baked." The
  // single state for the whole bake is pushed by bake() below.
  main.addMeshSilent(cage);
  if (main.setMeshParent) main.setMeshParent(cage.getID(), owner.getID(), { silent: true });
  mat4.identity(cage.getMatrix());
  Skeleton.syncThree(cage);
  return cage;
}

WeightCage.bake = function (main) {
  const joints = Skeleton.joints(main);
  if (!joints.length) return { ok: false, why: 'no skeleton to bake from' };

  const existing = WeightCage.cages(main);
  if (existing.length) return { ok: false, why: 'cages already exist — delete them first' };

  // LENGTH_SEGS 2 puts an edge loop at the middle of every bone, which is the least that
  // makes a capsule shapeable; more is more to sculpt and more for the bind to walk.
  const RADIAL = 10, RINGS = 3, LENGTH_SEGS = 2;
  const made = [];
  const _mP = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3();
  const _hA = [0, 0, 0], _hB = [0, 0, 0];

  for (const j of joints) {
    const p = j._parentMesh;
    if (!Skeleton.isJoint(p)) continue;            // a root has no bone above it
    // THE SAME GATE THE DRAW USES, so a cage exists exactly where a capsule is drawn.
    const cr = j._boneRadius || 0;
    if (!(cr > 1e-9)) continue;

    // ── BUILT FROM THE SHAPE YOU TWEAKED, NOT FROM THE RAW BONE ──────────────────────
    //
    // matt: "the 'make capsule meshes' doesn't take into account the most recent tweak bones
    // edits." It took a single radius straight off `_boneRadius` and ran it from the parent's
    // ORIGIN to the child's, so everything Tweak Joint exists to author was discarded: the
    // per-joint radius override, the width/height/depth scale that makes a joint an ellipsoid,
    // and the offset a face drag uses to move a joint's shape off the joint itself. A rig that
    // had been shaped for an hour baked as a row of plain uniform tubes.
    //
    // These are the same two calls the capsule draw makes -- jointHalf is described in Skeleton
    // as "one definition, used by the draw, the skin and the handles, so they cannot disagree
    // about how big a joint is", and this was the one place that disagreed. jointCentre is the
    // offset-aware position, which is why the drawn capsule already spans the shapes rather
    // than the joints.
    const hA = Skeleton.jointHalf(p, cr, _hA);
    const hB = Skeleton.jointHalf(j, cr, _hB);
    Skeleton.jointCentre(p, _a);
    Skeleton.jointCentre(j, _b);

    // IN MODEL SPACE FIRST, THEN INTO THE PARENT'S FRAME -- and that order is forced, not a
    // preference. The extents above are WORLD-AXIS ALIGNED, so they can only be applied in the
    // space they were measured in; a rotated parent's local axes are not those axes, and there
    // is no way to carry a non-uniform scale through a rotation. So the capsule is shaped
    // where the numbers mean something and the finished vertices are mapped afterwards.
    const geo = capsuleGeometry(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, 1,
                                RADIAL, RINGS, LENGTH_SEGS, { hA: hA, hB: hB });
    if (!geo) continue;
    // Parented to the parent joint, so the cage's own transform starts as identity and stays
    // legible when it is moved by hand later.
    _mP.fromArray(p.getModelSpaceMatrix());
    _mInv.copy(_mP).invert();
    for (let vi = 0; vi < geo.verts.length; vi += 3) {
      _v.set(geo.verts[vi], geo.verts[vi + 1], geo.verts[vi + 2]).applyMatrix4(_mInv);
      geo.verts[vi] = _v.x; geo.verts[vi + 1] = _v.y; geo.verts[vi + 2] = _v.z;
    }

    const cage = makeCage(main, geo, p, j, 'cage_');
    if (cage) made.push(cage);
  }

  if (!made.length) return { ok: false, why: 'no bones with a radius to bake' };

  // ONE STATE FOR THE WHOLE BAKE. Parents are restored on redo because removeMeshSilent leaves
  // `_parentMesh` set but does not re-attach the three-side mesh — a cage put back without it
  // sits under the world group and reads its local matrix as a world one.
  const owners = made.map((c) => ({ cage: c, owner: c._parentMesh }));
  main.getStateManager?.()?.pushStateCustom?.(
    () => {
      for (const o of owners) main.removeMeshSilent(o.cage);
      Skeleton.updateVisuals(main); main.render?.();
    },
    () => {
      for (const o of owners) {
        main.addMeshSilent(o.cage);
        if (o.owner && main.setMeshParent) main.setMeshParent(o.cage.getID(), o.owner.getID(), { silent: true });
      }
      Skeleton.updateVisuals(main); main.render?.();
    },
    false, 'Bake Weight Cages');

  // PAIR THEM NOW, while every capsule is still the shape the generator made. This is the one
  // moment the two sides are exact mirror images, so it is the only moment a correspondence can
  // be established with confidence -- afterwards you are matching a sculpt against a capsule.
  const pairs = WeightCage.pairMirrors(main);
  main._cagePairTried = true;
  WeightCage.applyOpacity(main);
  return { ok: true, cages: made.length, paired: pairs.paired, unpaired: pairs.unpaired };
};

// THE CAPSULES BUTTON HIDES THE BAKED ONES TOO.
//
// Once they are baked there are two capsule representations in the scene -- the drawn overlay
// and these meshes -- and only the overlay answered to the Capsules toggle. So the one button
// that means "get the capsules out of my way" left the solid ones sitting over the character,
// and the only way to clear them was to hunt down twenty rows in the outliner. matt: "ideally
// just the 'capsules' button in the bones tool would also hide all the capsule meshes."
//
// Sets the SculptGL visibility and the three-side flag together, the same pair the outliner's
// eye sets -- a cage hidden here reads as hidden there, and vice versa.
WeightCage.setVisible = function (main, on) {
  const cages = WeightCage.cages(main);
  for (const c of cages) {
    c.setVisible?.(!!on);
    const t = c.getThreeMesh?.();
    if (t) t.visible = !!on;
  }
  return cages.length;
};

// ── MIRRORING ─────────────────────────────────────────────────────────────────────────
//
// Sculpt one arm's capsule, get the other arm's for free. Applied when the stroke ENDS rather
// than while it runs, because the mirror of an arm capsule is a DIFFERENT MESH and no in-stroke
// mirror can reach across meshes -- SculptManager.getSymmetry() switches the in-stroke one off
// for cages precisely so this can do the job properly instead.
//
// The pairing is not guessed: `_boneMirror` already links each side joint to its twin, it is
// maintained as the chain is drawn and it survives a save. A bone ON the centreline has no
// twin, and mirrors onto ITSELF -- which is the case the ordinary local symmetry would have got
// right, and it costs nothing to handle here with the same machinery.

// THE PAIRING IS BUILT AT BAKE TIME, IN LOCAL SPACE. Both facts are load-bearing and the first
// version had neither, which is what made mirroring "borderline unusable, with shapes on one
// side going crazy on the other".
//
//   WHEN. The map was built the first time a mirror ran -- by which point one side had already
//   been sculpted, so it was matching a shaped capsule against a round one and the nearest
//   neighbour was meaningless. Built at bake, both capsules are pristine and every match is an
//   exact hit; nothing later can degrade it, because the map is indices, not positions.
//
//   WHERE. Mirroring in MODEL space bakes the pose into the result: with the arms in different
//   positions -- which is most poses -- the mirrored shape lands nowhere near the twin's own
//   frame and the capsule tears itself apart. What is captured instead is a single 4x4 taking
//   the source cage's LOCAL space to its twin's local space, measured once at bake. It has no
//   pose in it at all, so the same matrix is right whatever the character is doing later.
//
// `M` = inverse(twin's model matrix) * reflection * (this cage's model matrix), at bake.
function mirrorTransform(srcCage, dstCage, plane) {
  // Reflection about the plane as a 4x4: p' = p - 2((p-o).n)n, i.e. (I - 2nn^T) with a
  // translation of 2(o.n)n. Written out rather than composed from translate/scale/translate,
  // which is three matrices and one more place to get the sign wrong.
  const n = plane.normal, o = plane.origin;
  const k = 2 * (n.x * o.x + n.y * o.y + n.z * o.z);
  const P = new THREE.Matrix4().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, k * n.x,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, k * n.y,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, k * n.z,
    0, 0, 0, 1);
  const A = new THREE.Matrix4().fromArray(srcCage.getModelSpaceMatrix());
  const Binv = new THREE.Matrix4().fromArray(dstCage.getModelSpaceMatrix()).invert();
  return new THREE.Matrix4().multiplyMatrices(Binv, new THREE.Matrix4().multiplyMatrices(P, A));
}

// Vertex i of `src` corresponds to which vertex of `dst`, once carried across by `M`.
//
// Matched rather than assumed equal: mirroring reverses a capsule's radial winding, so index i
// on the left is emphatically not index i on the right, and copying straight across turns the
// twin inside out. `worst` is the largest match distance -- at bake, against a symmetric rig,
// it is essentially zero, and anything else means the two bones are not mirror images and the
// pair should be left alone rather than scrambled.
// A MIRROR MAP HAS TO BE A BIJECTION, and plain nearest-neighbour is not one.
//
// Two source vertices can pick the same target, which leaves a third with nobody -- and then
// mirroring writes one vertex's position into a place another vertex also claims while a third
// is never written at all. matt: "when i let go there's a short pause, and the mesh does its own
// strange distortion. almost like its trying to mirror and flip the stroke, but its not doing it
// very well." That is exactly what a non-bijective map looks like applied to a shape.
//
// IT SLIPS PAST A DISTANCE BAR, which is why one was not enough. Measured on his camel's
// cage_bone_05: two vertices of seventy-two collided, and the miss was 0.522 against a bar of
// 0.936 -- comfortably "close enough" by distance while being structurally broken. The cause is
// that his bone sits 2.41 off the mirror plane, so the capsule is not symmetric about it and the
// ring's angular phase does not line up; the poles are the two that cannot find a partner.
//
// CLOSEST FIRST, AND A LOSER DOES NOT MIRROR. Sources are served in order of how sure they are,
// so the vertex genuinely nearest a target takes it. If a later source wanted that same target,
// it is left UNMAPPED rather than sent to a substitute: two sources wanting one target means
// neither has a clean partner, and picking some other free vertex for it is a guess that puts a
// vertex somewhere nobody asked for. The apply loop already skips `map[i] < 0`, so an unmapped
// vertex simply stays where it is.
//
// On matt's camel that is the two poles of each capsule and nothing else -- seventy of seventy
// two mirror exactly and the two that cannot sit still, which is invisible next to the
// distortion it replaces.
//
// `worst` counts only the vertices that DID pair, or the quality bar would be measuring the
// distance to a partner that was deliberately not used.
function mirrorMap(srcVerts, dstVerts, M) {
  const n = srcVerts.length / 3, m = dstVerts.length / 3;
  const map = new Int32Array(n).fill(-1);
  const _p = new THREE.Vector3();
  // Every source's ranked distance to its nearest target, so the confident ones go first.
  const best = new Int32Array(n).fill(-1);
  const bestD = new Float64Array(n).fill(Infinity);
  const mirrored = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    _p.set(srcVerts[i * 3], srcVerts[i * 3 + 1], srcVerts[i * 3 + 2]).applyMatrix4(M);
    mirrored[i * 3] = _p.x; mirrored[i * 3 + 1] = _p.y; mirrored[i * 3 + 2] = _p.z;
    for (let j = 0; j < m; j++) {
      const dx = dstVerts[j * 3] - _p.x, dy = dstVerts[j * 3 + 1] - _p.y, dz = dstVerts[j * 3 + 2] - _p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD[i]) { bestD[i] = d; best[i] = j; }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => bestD[a] - bestD[b]);
  const taken = new Uint8Array(m);
  let worst = 0;
  for (const i of order) {
    const pick = best[i];
    if (pick < 0 || taken[pick]) continue;     // no partner, or someone nearer already has it
    taken[pick] = 1;
    map[i] = pick;
    if (bestD[i] > worst) worst = bestD[i];
  }
  return { map: map, worst: Math.sqrt(worst) };
}

// Local vertices of a cage's CURRENT level, as a plain array.
function localVerts(cage) {
  const level = cage.getCurrentMesh ? cage.getCurrentMesh() : cage;
  const v = level.getVertices ? level.getVertices() : null;
  if (!v) return null;
  const nb = level.getNbVertices();
  return { level: level, verts: v, nb: nb };
}

// Pair every cage with its twin, once, while they are still the shapes the generator made.
// Stored on the SOURCE cage, both directions, so either side can be the one you sculpt.
WeightCage.pairMirrors = function (main) {
  const plane = Skeleton.rigMirrorPlane(main);
  const cages = WeightCage.cages(main);
  for (const c of cages) { c._cageMirror = null; }
  // WHETHER THIS WAS A REAL ATTEMPT. With symmetry off there is no plane, so nothing below
  // runs and every cage comes back unpaired -- which is not the same statement as "these shapes
  // do not match", and the difference decides whether it is worth trying again. See the retry
  // in mirrorEdit.
  main._cagePairHadPlane = !!plane;
  if (!plane) return { paired: 0, unpaired: cages.length };

  const joints = Skeleton.joints(main);
  const byJoint = new Map();
  for (const c of cages) byJoint.set(c._cageJointId, c);
  let paired = 0, unpaired = 0;

  for (const c of cages) {
    const joint = joints.find((j) => j.getID() === c._cageJointId);
    if (!joint) { unpaired++; continue; }
    const twinJoint = joint._boneMirror || joint;          // centreline: mirrors onto itself
    const twin = twinJoint === joint ? c : byJoint.get(twinJoint.getID());
    const a = localVerts(c), b = twin ? localVerts(twin) : null;
    if (!twin || !a || !b || a.nb !== b.nb) { unpaired++; continue; }

    const M = mirrorTransform(c, twin, plane);
    const mm = mirrorMap(a.verts, b.verts, M);
    // HOW WELL THEY ACTUALLY MATCH. A hand-drawn rig can have limbs that are nearly but not
    // exactly mirrored, and a nearest-neighbour map across a bad pair collapses several source
    // vertices onto one target -- which is precisely what "going crazy" looks like. A tenth of
    // the capsule's own radius is a generous bar for two shapes that should be identical.
    const r = joint._boneRadius || 0;
    if (r > 0 && mm.worst > r * 0.1) { unpaired++; continue; }
    c._cageMirror = { toId: twin.getID(), M: M, map: mm.map, nb: a.nb, self: twin === c };
    paired++;
  }
  return { paired: paired, unpaired: unpaired };
};

WeightCage.mirrorEdit = function (main, cage) {
  if (!WeightCage.isCage(cage)) return null;
  // The toggle still governs: symmetry off means no mirroring, whatever is paired.
  if (!Skeleton.rigMirrorPlane(main)) return null;

  let pair = cage._cageMirror;
  // A scene loaded from a file has cages but no pairs -- the map is geometry, not a saved field.
  // Pairing once here recovers them: a rig saved with both sides mirrored still matches, and one
  // saved asymmetric fails the quality bar and is refused, which is the right answer either way.
  //
  // ...AND AGAIN IF THE LAST ATTEMPT HAD NO PLANE TO WORK WITH, which is the case the latch
  // alone could not tell apart. bake() pairs as its last step, so baking while symmetry is OFF
  // records "tried" against an attempt that never ran a line of matching -- and turning symmetry
  // on afterwards could then never pair anything, for the rest of the session. That is matt's
  // order of work exactly: "set radius on bones, tweak, bake capsules, move tool to sculpt
  // them... even though sym mode is enabled, i can't sculpt the cages in symmetry."
  //
  // Reproduced and measured: bake with symmetry off gives paired 0 and latches; turning symmetry
  // on and sculpting then answers "this capsule has no mirror twin" forever, and clearing the
  // latch by hand makes the very same edit mirror.
  //
  // The original caution still holds where it applies -- a REAL attempt that failed the quality
  // bar is not retried, because a map built after sculpting would match a shape you have already
  // changed against one you have not. This only re-runs an attempt that never happened.
  if (!pair && (!main._cagePairTried || !main._cagePairHadPlane)) {
    main._cagePairTried = true;
    WeightCage.pairMirrors(main);
    pair = cage._cageMirror;
  }
  // Not paired at bake -- no twin, an asymmetric rig, or a cage from a file saved before the
  // pairing existed. Refusing is the honest answer; a nearest-neighbour map built now would be
  // matching a shape you have already sculpted against one you have not.
  if (!pair) return { ok: false, why: 'this capsule has no mirror twin' };

  // A SELF PAIR IS THE IN-STROKE MIRROR'S JOB, not this one. Copying every vertex onto its
  // partner is a copy when the destination is another cage and a SWAP when it is this one --
  // see the note in SculptManager.getSymmetry. Declining here is what leaves exactly one of the
  // two doing the work.
  if (pair.self) return { ok: true, self: true, why: 'mirrored in-stroke; nothing to do here' };

  const dstCage = WeightCage.cages(main).find((c) => c.getID() === pair.toId);
  if (!dstCage) return { ok: false, why: 'the twin capsule is gone' };

  const src = localVerts(cage);
  const dst = pair.self ? src : localVerts(dstCage);
  if (!src || !dst) return null;
  // Subdivide one side and the correspondence is gone. Refusing is the honest answer: silently
  // mirroring a fraction of the vertices would leave a torn twin that looks like a sculpt bug.
  if (src.nb !== pair.nb || dst.nb !== pair.nb) {
    return { ok: false, why: 'a capsule was subdivided — re-bake to pair them again' };
  }

  // Written into a copy first: mirroring a cage onto ITSELF reads and writes the same array,
  // and a vertex already moved this pass is no longer the source its partner needs.
  const outV = new Float32Array(dst.verts.subarray(0, dst.nb * 3));
  const _p = new THREE.Vector3();
  for (let i = 0; i < src.nb; i++) {
    const j = pair.map[i];
    if (j < 0) continue;
    _p.set(src.verts[i * 3], src.verts[i * 3 + 1], src.verts[i * 3 + 2]).applyMatrix4(pair.M);
    outV[j * 3] = _p.x; outV[j * 3 + 1] = _p.y; outV[j * 3 + 2] = _p.z;
  }
  dst.verts.set(outV, 0);
  dstCage.updateGeometry();
  dstCage.updateBuffers();
  // The twin comes back because the caller has to re-measure the skin against IT as well —
  // it is a second capsule that moved, and not the same vertices changed hands.
  return { ok: true, twinCage: dstCage, twin: pair.self ? 'self' : 'twin' };
};

// ...and one state for undoing them all, for the same reason.
WeightCage.deleteAll = function (main) {
  const cages = WeightCage.cages(main);
  if (!cages.length) return 0;
  const owners = cages.map((c) => ({ cage: c, owner: c._parentMesh }));
  for (const o of owners) main.removeMeshSilent(o.cage);
  main.getStateManager?.()?.pushStateCustom?.(
    () => {
      for (const o of owners) {
        main.addMeshSilent(o.cage);
        if (o.owner && main.setMeshParent) main.setMeshParent(o.cage.getID(), o.owner.getID(), { silent: true });
      }
      Skeleton.updateVisuals(main); main.render?.();
    },
    () => {
      for (const o of owners) main.removeMeshSilent(o.cage);
      Skeleton.updateVisuals(main); main.render?.();
    },
    false, 'Delete Weight Cages');
  return cages.length;
};

// IS IT THERE AT ALL. "I don't see any baked capsules" has several possible causes -- nothing
// was created, they were created inside the skin, they were created somewhere else entirely, or
// they were created with no geometry -- and from the viewport those look identical. This says
// which.
window.cageDiag = function () {
  const main = window.app;
  const cages = WeightCage.cages(main);
  console.log('[cage] ' + cages.length + ' baked capsule(s) in the scene'
    + (cages.length ? '' : '  <-- nothing was created; check the console for a bake message'));
  const _v = new THREE.Vector3();
  for (const c of cages) {
    const lvl = c.getCurrentMesh ? c.getCurrentMesh() : c;
    const p = c._parentMesh;
    const M = new THREE.Matrix4().fromArray(c.getModelSpaceMatrix());
    _v.setFromMatrixPosition(M);
    const _s = new THREE.Vector3().setFromMatrixScale(M);
    // THE SIZE IT ACTUALLY ENDS UP, which is the measurement the first version of this was
    // missing. A capsule present, parented, positioned and visible but scaled to nothing looks
    // in every other respect exactly like one that is working.
    const vt = lvl.getVertices ? lvl.getVertices() : null;
    let ext = 0;
    if (vt) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < vt.length; i += 3) for (let k = 0; k < 3; k++) {
        if (vt[i + k] < lo[k]) lo[k] = vt[i + k];
        if (vt[i + k] > hi[k]) hi[k] = vt[i + k];
      }
      ext = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    }
    console.log('[cage]   #' + c.getID() + ' ' + (c._permanentStaticLabel || '')
      + '  verts=' + (lvl.getNbVertices ? lvl.getNbVertices() : '?')
      + ' faces=' + (lvl.getNbFaces ? lvl.getNbFaces() : '?')
      + '  parent=' + (p ? ('#' + p.getID() + ' ' + (p._permanentStaticLabel || '')) : 'NONE  <-- not parented to a bone')
      + '  at ' + [_v.x, _v.y, _v.z].map((n) => n.toFixed(3)).join(',')
      + '  localExtent=' + ext.toFixed(4)
      + '  parentScale=' + [_s.x, _s.y, _s.z].map((n) => n.toFixed(4)).join(',')
      + '  worldExtent=' + (ext * _s.x).toFixed(4)
      + '  visible=' + (c.isVisible ? c.isVisible() : '?')
      + '  alpha=' + (c._renderData ? c._renderData._alpha : '?'));
    // THE THREE SIDE, which is what actually draws. Everything above can be perfect while the
    // render object is missing, hidden, or detached from the scene graph -- and all three look
    // identical from the model-space numbers.
    const tm = c.getThreeMesh ? c.getThreeMesh() : null;
    if (!tm) {
      console.log('[cage]     three: NONE  <-- no render object, so nothing can draw it');
    } else {
      let root = tm, depth = 0;
      const chain = [];
      while (root.parent && depth < 24) { chain.push(root.parent.name || root.parent.type); root = root.parent; depth++; }
      console.log('[cage]     three: visible=' + tm.visible
        + ' geomVerts=' + (tm.geometry && tm.geometry.attributes && tm.geometry.attributes.position
            ? tm.geometry.attributes.position.count : 'none')
        // The index is what turns vertices into triangles. Vertices without it draw nothing.
        + ' index=' + (tm.geometry && tm.geometry.index ? tm.geometry.index.count
            : 'NONE  <-- no triangles, so nothing is drawn')
        + ' frustumCulled=' + tm.frustumCulled
        + ' parentChain=' + (chain.length ? chain.join(' -> ') : 'DETACHED  <-- not under the scene')
        + ' reachesScene=' + (root && root.type === 'Scene'));
    }
  }
  // A/B AGAINST A MESH THAT DOES DRAW. Every field measured so far has come back correct on a
  // capsule that is invisible, which means the difference is in a field not yet printed. So
  // print the same fields for the skin, and the answer is whichever line differs.
  const skin = (main.getMeshes() || []).find((m) => !WeightCage.isCage(m) && !m._isBone
    && !m._isNull && !m._isPinTarget && m.getNbVertices && m.getNbVertices() > 100);
  const describe = (m, tag) => {
    if (!m) { console.log('[cage] ' + tag + ': none found'); return; }
    const tm = m.getThreeMesh ? m.getThreeMesh() : null;
    const mat = tm && tm.material;
    console.log('[cage] ' + tag + ' #' + m.getID()
      + '  shaderType=' + (m.getShaderType ? m.getShaderType() : '?')
      + '  flat=' + (m._renderData ? m._renderData._flatShading : '?')
      + '  drawArrays=' + (m.isUsingDrawArrays ? m.isUsingDrawArrays() : '?')
      + '  threeType=' + (tm ? tm.type : 'no three mesh'));
    console.log('[cage]   material: ' + (!mat ? 'NONE  <-- nothing can draw without one'
      : (Array.isArray(mat) ? ('array of ' + mat.length) : mat.type)
        + ' visible=' + mat.visible + ' colorWrite=' + mat.colorWrite
        + ' transparent=' + mat.transparent + ' opacity=' + mat.opacity
        + ' side=' + mat.side + ' program=' + (mat.program ? 'built' : 'not built yet')));
  };
  describe(cages[0], 'CAPSULE (invisible)');
  describe(skin, 'SKIN (draws)');

  if (!cages.length) return { cages: 0 };
  console.log('[cage] they are ordinary meshes: look for them in the outliner, parented under '
    + 'the joint each bone hangs from. Hide the skin to see them in the viewport.');
  return { cages: cages.length };
};

export default WeightCage;
