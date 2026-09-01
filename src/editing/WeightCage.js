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
function capsuleGeometry(ax, ay, az, bx, by, bz, r, radial, rings) {
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

  const verts = [];
  const push = (p) => { verts.push(p.x, p.y, p.z); return verts.length / 3 - 1; };
  const _p = new THREE.Vector3();

  // Rings from one pole to the other: the hemispheres bend round, the tube runs straight.
  const rows = [];
  const total = rings * 2 + 2;
  for (let i = 0; i <= total; i++) {
    let centre, rad;
    if (i <= rings) {                        // cap A
      const a = (Math.PI / 2) * (1 - i / rings);
      centre = A.clone().addScaledVector(axis, -Math.sin(a) * r);
      rad = Math.cos(a) * r;
    } else if (i >= rings + 2) {             // cap B
      const k = i - (rings + 2);
      const a = (Math.PI / 2) * (k / rings);
      centre = B.clone().addScaledVector(axis, Math.sin(a) * r);
      rad = Math.cos(a) * r;
    } else {                                  // the two tube rings, at A and at B
      centre = i === rings + 1 ? A.clone() : B.clone();
      rad = r;
      if (i === rings + 1) centre = A.clone();
    }
    const row = [];
    if (rad < 1e-6) {
      row.push(push(centre));                 // a pole is one vertex, shared by the whole ring
      rows.push({ ids: row, pole: true });
      continue;
    }
    for (let k = 0; k < radial; k++) {
      const t = (k / radial) * Math.PI * 2;
      _p.copy(centre).addScaledVector(u, Math.cos(t) * rad).addScaledVector(v, Math.sin(t) * rad);
      row.push(push(_p));
    }
    rows.push({ ids: row, pole: false });
  }

  // FACES ARE ivec4, NOT TRIANGLE TRIPLES. SculptGL stores four indices per face and flags a
  // triangle by putting Utils.TRI_INDEX in the fourth slot (Mesh.js:20). Emitting raw triples
  // produced a mesh with no valid faces at all: the bake ran, took its time, and put nothing in
  // the scene -- matt, "i don't see any baked capsules."
  //
  // Quads everywhere except the two poles, where the ring collapses to a point and the quad
  // degenerates to a triangle. Quads also make the cage subdividable and pleasant to sculpt,
  // which is the whole point of it being a mesh.
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
  }
  return { idx: idx, wts: wts, outside: outside };
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
WeightCage.bake = function (main) {
  const joints = Skeleton.joints(main);
  if (!joints.length) return { ok: false, why: 'no skeleton to bake from' };

  const existing = WeightCage.cages(main);
  if (existing.length) return { ok: false, why: 'cages already exist — delete them first' };

  const RADIAL = 10, RINGS = 3;
  const made = [];
  const _mJ = new THREE.Matrix4(), _mP = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  for (const j of joints) {
    const p = j._parentMesh;
    if (!Skeleton.isJoint(p)) continue;            // a root has no bone above it
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

    const geo = capsuleGeometry(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, rLocal, RADIAL, RINGS);
    if (!geo) continue;

    const base = new MeshStatic(main._gl);
    base.setVertices(geo.verts);
    base.setFaces(geo.faces);
    base.init();
    if (main._gl) base.initRender();
    const cage = new Multimesh(base);
    cage.setMatcap(getOptionsURL().matcap);
    // THE COLOUR OF THE BONE IT SPEAKS FOR. Twenty-one grey capsules over a skeleton say
    // nothing about which belongs to what; the rig already gives every bone an identity colour
    // and the drawn capsules already use it, so a baked one that did not was simply losing
    // information the rig was handing it for free.
    //
    // Written as VERTEX colours, which is where a SculptGL mesh keeps colour -- and it means
    // sculpting the cage keeps the colour, since new vertices inherit from their neighbours.
    const col = Skeleton.boneColor(main, p);
    const cAr = base.getColors();
    if (cAr) {
      for (let ci = 0; ci < cAr.length; ci += 3) {
        cAr[ci] = col.r; cAr[ci + 1] = col.g; cAr[ci + 2] = col.b;
      }
    }
    // SEMI-TRANSPARENT, OR YOU CANNOT SEE IT AT ALL.
    //
    // A capsule lives INSIDE the character -- that is what it is for -- so a freshly baked cage
    // is completely enclosed by the skin and an opaque one is invisible. The bake ran, took its
    // time, and appeared to do nothing: matt, "i press it, there's a delay, but i see no change
    // in the 3d view." This is why the capsule OVERLAY has always been drawn with a ghost pass;
    // a cage is a real mesh and cannot use that, so it gets alpha instead.
    cage.setOpacity(WeightCage.OPACITY);
    cage.setShowWireframe(true);      // the shape is easier to read, and to sculpt, with edges
    // UPLOAD THE BUFFERS. `init()` builds the three mesh and writes the POSITIONS, but the
    // INDEX buffer is written by updateBuffers() -- and without it the geometry has vertices
    // and no triangles, so it draws nothing at all. Every other mesh in the app gets this for
    // free from `normalizeSize()`, which every primitive calls and a capsule must not: it
    // rescales to a unit box, which is exactly the fit being preserved here.
    //
    // That is why a baked capsule was present, parented, correctly sized, visible, unculled and
    // reaching the Scene -- and invisible. matt ran cageDiag three times and every field was
    // right, because the missing thing was not a field.
    cage.updateGeometry();
    // The colours live in a duplicated buffer for rendering, so writing the array is not
    // enough on its own -- it has to be pushed through before the buffers go up.
    if (cage.updateDuplicateColorsAndMaterials) cage.updateDuplicateColorsAndMaterials();
    cage.updateBuffers();
    cage._typeName = 'Cage';
    // Quads, so it subdivides and sculpts like any other primitive rather than degrading into
    // triangles the first time it is smoothed.
    cage.isQuad = true;
    cage._isWeightCage = true;
    // WHICH BONE THIS SPEAKS FOR. Stored by joint ID rather than by index: the joint list is
    // rebuilt on every call and an index would point at a different bone the moment one is
    // added, split or dissolved.
    cage._cageJointId = p.getID();
    cage._permanentStaticLabel = 'cage_' + (p._permanentStaticLabel || p.getID());
    main.addNewMesh(cage);
    // Parented AFTER it is in the scene, so the reparent has something to move.
    if (main.setMeshParent) main.setMeshParent(cage.getID(), p.getID());
    mat4.identity(cage.getMatrix());
    Skeleton.syncThree(cage);
    made.push(cage);
  }

  return made.length
    ? { ok: true, cages: made.length }
    : { ok: false, why: 'no bones with a radius to bake' };
};

WeightCage.deleteAll = function (main) {
  const cages = WeightCage.cages(main);
  for (const c of cages) main.removeMesh ? main.removeMesh(c) : main.removeMeshSilent(c);
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
