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

WeightCage.cages = function (main) {
  return (main.getMeshes() || []).filter(WeightCage.isCage);
};

// A capsule as a triangle mesh: a tube of `radial` sides between the two ends, capped with
// hemispheres. Deliberately low-poly -- it is a volume to be measured against and sculpted, not
// rendered detail, and every triangle is one more the bind walks per vertex.
function capsuleGeometry(ax, ay, az, bx, by, bz, r, radial, rings, lengthSegs) {
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
  return { verts: new Float32Array(verts), faces: new Uint32Array(faces) };
}

WeightCage.capsuleGeometry = capsuleGeometry;

// ── THE VOLUME SHAPES, AS QUAD MESHES ─────────────────────────────────────────────────
//
// A joint volume decides the envelope now, so baking has to produce THAT shape rather than the
// capsule the bone no longer draws. Same output format as capsuleGeometry — ivec4 faces, quads
// in the body, triangle fans at poles — because the bind, the sculpt tools and the renderer all
// read it.
//
// One generator per shape, and quads throughout, because these meshes have a second consumer:
// matt's note on Make Skin — "assuming we stick with known shapes... we should be able to have
// known good box modelling equivalents for each". A shape that bakes as a clean quad cage is
// the same shape Make Skin can stitch.
//
// Built as a UNIT shape about the origin and scaled by the volume's half-extents at the end, so
// the ring maths never has to know which shape it is drawing.
// A SUBDIVIDED CUBE, PROJECTED ONTO THE SHAPE — matt's approach, and better than the lat-long
// shells it replaces: "there should be a boxmodelling/extrude cube equivalent for our basic
// shapes, even if its a cube that is rotated and scaled to match the target volume, subdivided,
// and then shrinkwrapped onto the target shape."
//
// Three things fall out of it, and the third is the one that matters most:
//   - all quads, no poles: a lat-long sphere has a fan of triangles at each end, which is the
//     worst place to sculpt and the worst place to bridge from;
//   - even spacing, so a subdivision or a smooth behaves the same everywhere on the shape;
//   - EVERY VOLUME HAS THE SAME TOPOLOGY. A box, an egg and a dome are then the same mesh with
//     different vertex positions, which is what makes stitching one to the next in Make Skin a
//     question of which face to bridge rather than of what the shapes are.
//
// The projection is exact rather than a search, because the shapes are analytic: a cube point
// normalised is a point on the ellipsoid.
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

WeightCage.volumeGeometry = function (shape, dims, offset, rot, radial, rings) {
  const g = cubeShell(4);
  if (!g) return null;

  // SHRINKWRAP, ANALYTICALLY. The cube is the topology; this is the shape.
  //   box  — already the shape.
  //   egg  — normalise: a direction from the centre lands on the unit sphere.
  //   dome — the same sphere, with everything above the equator laid onto the cap. The rim
  //          stays put, so the surface is closed and the cap is a real disc rather than a
  //          pinched pole.
  // The projection itself lives in Skeleton.shapePoint, so the cage and Make Skin wrap the cube
  // onto the SAME surface — two views of one volume, from one definition.
  if (shape !== 'box') {
    const _n = new THREE.Vector3();
    for (let i = 0; i < g.verts.length; i += 3) {
      Skeleton.shapePoint(shape, g.verts[i], g.verts[i + 1], g.verts[i + 2], _n);
      g.verts[i] = _n.x; g.verts[i + 1] = _n.y; g.verts[i + 2] = _n.z;
    }
  }


  const out = new Float32Array(g.verts.length);
  const _p = new THREE.Vector3();
  const q = rot || new THREE.Quaternion();
  for (let i = 0; i < g.verts.length; i += 3) {
    _p.set(g.verts[i] * dims[0], g.verts[i + 1] * dims[1], g.verts[i + 2] * dims[2]);
    _p.applyQuaternion(q);
    out[i] = _p.x + offset[0]; out[i + 1] = _p.y + offset[1]; out[i + 2] = _p.z + offset[2];
  }
  return { verts: out, faces: new Uint32Array(g.faces) };
};

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
  return { joint: jointIndex, verts: out, faces: faces, bb: bb, mesh: cage };
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
  return bestSign * Math.sqrt(best);
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
  const col = Skeleton.boneColor(main, owner);
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
  const _mJ = new THREE.Matrix4(), _mP = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  // VOLUMES FIRST. A joint with a volume owns its whole junction — it swallows the bones out of
  // it, and those bones have no envelope of their own any more — so it bakes ONE cage for the
  // volume and the capsule loop below must skip everything it covers. Baking both would put two
  // overlapping cages on the same vertices and let them argue over the weights.
  const hasChild = new Set();
  for (const j of joints) { const p = j._parentMesh; if (Skeleton.isJoint(p)) hasChild.add(p.getID()); }

  for (const j of joints) {
    if (!Skeleton.hasVolume(j)) continue;
    const shape = Skeleton.jointVolume(j);
    const geo = WeightCage.volumeGeometry(shape,
      Skeleton.jointVolDims(main, j), Skeleton.jointVolOffset(main, j), Skeleton.jointVolRot(j));
    if (!geo) continue;
    const cage = makeCage(main, geo, j, j, 'vol_' + shape + '_');
    if (cage) made.push(cage);
  }

  for (const j of joints) {
    const p = j._parentMesh;
    if (!Skeleton.isJoint(p)) continue;            // a root has no bone above it
    // Swallowed by a volume — at either end. Its envelope is that volume's cage.
    if (Skeleton.boneSwallowed(p, j, !hasChild.has(j.getID()), main)) continue;
    const r = j._boneRadius || 0;
    if (r <= 0) continue;

    // Built in the PARENT's frame, since that is what the cage is parented to -- so the cage's
    // own transform starts as identity and stays legible when it is moved by hand later.
    _mP.fromArray(p.getModelSpaceMatrix());
    _mInv.copy(_mP).invert();
    _a.set(0, 0, 0);                                // the parent joint IS the origin here
    _mJ.fromArray(j.getModelSpaceMatrix());
    _b.setFromMatrixPosition(_mJ).applyMatrix4(_mInv);
    // The radius is a model-space length, so it needs the parent's scale taken out of it too.
    const sc = _mP.elements[0] * _mP.elements[0] + _mP.elements[1] * _mP.elements[1]
             + _mP.elements[2] * _mP.elements[2];
    const rLocal = r / (Math.sqrt(sc) || 1);

    const geo = capsuleGeometry(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, rLocal,
                                RADIAL, RINGS, LENGTH_SEGS);
    if (!geo) continue;

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
    false, 'Bake Capsules');

  // PAIR THEM NOW, while every capsule is still the shape the generator made. This is the one
  // moment the two sides are exact mirror images, so it is the only moment a correspondence can
  // be established with confidence -- afterwards you are matching a sculpt against a capsule.
  const pairs = WeightCage.pairMirrors(main);
  main._cagePairTried = true;
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
function mirrorMap(srcVerts, dstVerts, M) {
  const n = srcVerts.length / 3, m = dstVerts.length / 3;
  const map = new Int32Array(n).fill(-1);
  const _p = new THREE.Vector3();
  let worst = 0;
  for (let i = 0; i < n; i++) {
    _p.set(srcVerts[i * 3], srcVerts[i * 3 + 1], srcVerts[i * 3 + 2]).applyMatrix4(M);
    let best = -1, bestD = Infinity;
    for (let j = 0; j < m; j++) {
      const dx = dstVerts[j * 3] - _p.x, dy = dstVerts[j * 3 + 1] - _p.y, dz = dstVerts[j * 3 + 2] - _p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = j; }
    }
    map[i] = best;
    if (bestD > worst) worst = bestD;
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
  if (!pair && !main._cagePairTried) {
    main._cagePairTried = true;
    WeightCage.pairMirrors(main);
    pair = cage._cageMirror;
  }
  // Not paired at bake -- no twin, an asymmetric rig, or a cage from a file saved before the
  // pairing existed. Refusing is the honest answer; a nearest-neighbour map built now would be
  // matching a shape you have already sculpted against one you have not.
  if (!pair) return { ok: false, why: 'this capsule has no mirror twin' };

  const dstCage = pair.self ? cage
    : WeightCage.cages(main).find((c) => c.getID() === pair.toId);
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
    false, 'Delete Capsules');
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
