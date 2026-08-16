import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import { adjacencyFromFaces } from './Geodesic.js';

// [Rigging POC#2 — phase 2a] Bind + linear blend skinning.
//
// Standard LBS, deliberately: capsule falloff for the initial assignment, a Laplacian
// smoothing pass to clean up the seams, four influences per vertex. Nothing invented.
//
// EVAL ORDER is the one structural commitment: skinning runs LAST, over whatever the
// deformation stack produced. `posed = skin(base + Σ blendshapeδ + Σ layerδ)`, with every
// delta living in REST space. Getting that backwards is expensive to unpick later, so the
// skin pass reads a rest-space source array and never accumulates into its own output.
//
// All maths is in MESH-LOCAL space: joint transforms are carried into it at bind time, so
// moving the character afterwards costs nothing and cannot skew the deformation.

const MAX_INFLUENCES = 4;
const SMOOTH_ITERATIONS = 3;

const _mMesh = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
const _mJoint = new THREE.Matrix4(), _mSkin = new THREE.Matrix4();
const _v = new THREE.Vector3();

const Skinning = {};

Skinning.isBound = function (mesh) { return !!(mesh && mesh._skinW); };

// Squared distance from p to segment ab, plus the parametric position along it.
function distToSegment2(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t - px, cy = ay + dy * t - py, cz = az + dz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

// Bones as (parent joint, child joint) segments in MESH-LOCAL space. A root joint with no
// parent contributes no bone — there is nothing to measure a capsule against — but it can
// still be an influence via its children.
function boneSegments(main, mesh, joints) {
  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  _mInv.copy(_mMesh).invert();
  const scale = Math.hypot(_mMesh.elements[0], _mMesh.elements[1], _mMesh.elements[2]) || 1;

  const pos = joints.map((j) => Skeleton.jointPos(j).applyMatrix4(_mInv));
  const index = new Map();
  joints.forEach((j, i) => index.set(j, i));

  const segs = [];
  joints.forEach((j, i) => {
    const p = j._parentMesh;
    if (!index.has(p)) return;
    segs.push({
      joint: i,                        // the bone deforms with its CHILD joint
      a: pos[index.get(p)], b: pos[i],
      r: Math.max((j._boneRadius || 0) / scale, 1e-4),
    });
  });
  return segs;
}

// Inverse-square capsule falloff, top-N influences, normalised. The classic rigid-assign
// pass: predictable and explainable, and wrong in exactly the places the smoothing pass
// afterwards is good at fixing.
function capsuleWeights(mesh, segs) {
  const nbV = mesh.getNbVertices(), verts = mesh.getVertices();
  const idx = new Int32Array(nbV * MAX_INFLUENCES).fill(-1);
  const wts = new Float32Array(nbV * MAX_INFLUENCES);

  const bestI = new Int32Array(MAX_INFLUENCES);
  const bestW = new Float64Array(MAX_INFLUENCES);

  for (let i = 0; i < nbV; i++) {
    bestI.fill(-1); bestW.fill(0);
    const px = verts[i * 3], py = verts[i * 3 + 1], pz = verts[i * 3 + 2];

    for (let s = 0; s < segs.length; s++) {
      const sg = segs[s];
      const d2 = distToSegment2(px, py, pz,
        sg.a.x, sg.a.y, sg.a.z, sg.b.x, sg.b.y, sg.b.z);
      // Radius sets the scale at which a bone stops dominating; without it a thin bone
      // near a thick one wins purely by being closer to the surface.
      const w = 1 / (d2 / (sg.r * sg.r) + 1e-4);

      // insertion sort into the top-N
      let k = MAX_INFLUENCES - 1;
      if (w <= bestW[k]) continue;
      while (k > 0 && bestW[k - 1] < w) { bestW[k] = bestW[k - 1]; bestI[k] = bestI[k - 1]; k--; }
      bestW[k] = w; bestI[k] = sg.joint;
    }

    let sum = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) sum += bestW[k];
    if (sum <= 0) continue;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      idx[i * MAX_INFLUENCES + k] = bestI[k];
      wts[i * MAX_INFLUENCES + k] = bestW[k] / sum;
    }
  }
  return { idx: idx, wts: wts };
}

// Laplacian smoothing over the weight field: average each vertex's weights with its
// neighbours' and renormalise. This is what turns a rigid capsule assignment into
// something usable — it eats the hard boundary where two capsules meet, which is exactly
// where an unsmoothed bind creases.
//
// Weights are sparse, so smoothing runs through a dense per-vertex map and re-sparsifies.
function smoothWeights(mesh, idx, wts, iterations) {
  const nbV = mesh.getNbVertices();
  const adj = adjacencyFromFaces(mesh);
  const acc = new Map();

  for (let it = 0; it < iterations; it++) {
    const next = { idx: new Int32Array(nbV * MAX_INFLUENCES).fill(-1),
                   wts: new Float32Array(nbV * MAX_INFLUENCES) };
    for (let i = 0; i < nbV; i++) {
      acc.clear();
      const add = (v, scale) => {
        for (let k = 0; k < MAX_INFLUENCES; k++) {
          const j = idx[v * MAX_INFLUENCES + k];
          if (j < 0) continue;
          acc.set(j, (acc.get(j) || 0) + wts[v * MAX_INFLUENCES + k] * scale);
        }
      };
      add(i, 1);
      const nb = adj[i];
      // Neighbours together carry the same weight as the vertex itself, so smoothing
      // blurs the boundary without dragging every vertex toward the mesh average.
      if (nb.length) { const s = 1 / nb.length; for (let n = 0; n < nb.length; n++) add(nb[n], s); }

      const pairs = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_INFLUENCES);
      let sum = 0;
      for (const [, w] of pairs) sum += w;
      if (sum <= 0) continue;
      pairs.forEach(([j, w], k) => {
        next.idx[i * MAX_INFLUENCES + k] = j;
        next.wts[i * MAX_INFLUENCES + k] = w / sum;
      });
    }
    idx = next.idx; wts = next.wts;
  }
  return { idx: idx, wts: wts };
}

// Bind `mesh` to every joint currently in the scene.
//
// Binding FREEZES TOPOLOGY: the weights are indexed by vertex, so any op that changes the
// vertex count invalidates them. Callers gate on isBound() rather than silently dropping
// weights — losing a weight map without being told is the failure mode we are explicitly
// designing against.
Skinning.bind = function (main, mesh) {
  const joints = Skeleton.joints(main);
  if (!mesh || !joints.length) return false;

  const segs = boneSegments(main, mesh, joints);
  if (!segs.length) return false;

  let w = capsuleWeights(mesh, segs);
  w = smoothWeights(mesh, w.idx, w.wts, SMOOTH_ITERATIONS);

  // Inverse bind matrices, in mesh-local space.
  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  _mInv.copy(_mMesh).invert();
  const invBind = joints.map((j) => {
    _mJoint.fromArray(j.getModelSpaceMatrix());
    return new THREE.Matrix4().multiplyMatrices(_mInv, _mJoint).invert();
  });

  const nbV = mesh.getNbVertices();
  mesh._skinJoints = joints.map((j) => j.getID());
  mesh._skinIdx = w.idx;
  mesh._skinW = w.wts;
  mesh._skinInvBind = invBind;
  mesh._skinRest = new Float32Array(mesh.getVertices().subarray(0, nbV * 3));
  mesh._skinSrc = new Float32Array(mesh._skinRest);
  mesh._skinStampBuf = null;
  mesh._skinDirty = true;
  return true;
};

Skinning.unbind = function (mesh) {
  if (!mesh) return;
  // Put the mesh back in its bind pose rather than leaving it stuck in whatever pose it
  // happened to be in — an unbind that silently freezes a pose is worse than no unbind.
  if (mesh._skinRest) {
    mesh.getVertices().set(mesh._skinRest);
    mesh.updateGeometry();
    if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  }
  mesh._skinJoints = mesh._skinIdx = mesh._skinW = null;
  mesh._skinInvBind = mesh._skinRest = mesh._skinSrc = null;
};

// Called by applyBlendshapes once it has composited base + deltas: that composite IS the
// rest-space pose skinning should transform. Without this the two systems fight — the
// skin pass would keep re-transforming its own output.
Skinning.captureSource = function (mesh) {
  if (!mesh || !mesh._skinSrc) return;
  const v = mesh.getVertices();
  mesh._skinSrc.set(v.subarray(0, mesh._skinSrc.length));
  mesh._skinDirty = true; // the rest pose changed, so re-skin even if no joint moved
};

// Resolve the bound joints once per pass. Both the change check and the skin matrices
// need them, and a find() per joint per frame is a needless O(joints × meshes) sweep.
function resolveJoints(main, mesh) {
  const byId = new Map();
  const meshes = main.getMeshes();
  for (let i = 0; i < meshes.length; i++) byId.set(meshes[i].getID(), meshes[i]);
  return mesh._skinJoints.map((id) => byId.get(id) || null);
}

// Change detector so a static rig costs nothing per frame. Numeric, and compared against
// a reused buffer — building a string here would allocate on every frame at 90Hz.
function poseChanged(mesh, joints) {
  const n = joints.length * 6;
  let buf = mesh._skinStampBuf;
  if (!buf || buf.length !== n) buf = mesh._skinStampBuf = new Float32Array(n).fill(NaN);
  let changed = false;
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    const m = j ? j.getMatrix() : null;
    const vals = m ? [m[12], m[13], m[14], m[0], m[5], m[9]] : [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 6; k++) {
      if (buf[i * 6 + k] !== vals[k]) { buf[i * 6 + k] = vals[k]; changed = true; }
    }
  }
  return changed;
}

Skinning.apply = function (main, mesh) {
  if (!Skinning.isBound(mesh)) return false;

  const joints = resolveJoints(main, mesh);
  // `_skinDirty` is set when the rest-space source changes (a blendshape recomposite), so
  // a still skeleton over a moving blendshape still re-skins.
  if (!poseChanged(mesh, joints) && !mesh._skinDirty) return false;
  mesh._skinDirty = false;

  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  _mInv.copy(_mMesh).invert();

  // Per-joint skin matrix in mesh-local space: current × inverse-bind.
  const mats = new Array(joints.length);
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    if (!j) { mats[i] = null; continue; }
    _mJoint.fromArray(j.getModelSpaceMatrix());
    _mSkin.multiplyMatrices(_mInv, _mJoint).multiply(mesh._skinInvBind[i]);
    mats[i] = _mSkin.clone();
  }

  const src = mesh._skinSrc, out = mesh.getVertices();
  const idx = mesh._skinIdx, wts = mesh._skinW;
  const nbV = mesh.getNbVertices();

  for (let i = 0; i < nbV; i++) {
    const sx = src[i * 3], sy = src[i * 3 + 1], sz = src[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, total = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const j = idx[i * MAX_INFLUENCES + k];
      if (j < 0) continue;
      const w = wts[i * MAX_INFLUENCES + k];
      const m = mats[j];
      if (!m || w <= 0) continue;
      _v.set(sx, sy, sz).applyMatrix4(m);
      ox += _v.x * w; oy += _v.y * w; oz += _v.z * w;
      total += w;
    }
    // An unweighted vertex must hold its rest position, not collapse to the origin.
    if (total <= 1e-6) { out[i * 3] = sx; out[i * 3 + 1] = sy; out[i * 3 + 2] = sz; continue; }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
  }

  mesh.updateGeometry();
  if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  return true;
};

// Per-frame pass over every bound mesh. Cheap when nothing moved (the stamp check).
Skinning.update = function (main) {
  const meshes = main.getMeshes();
  if (!meshes) return;
  for (let i = 0; i < meshes.length; i++) {
    if (Skinning.isBound(meshes[i])) Skinning.apply(main, meshes[i]);
  }
};

export default Skinning;
export { MAX_INFLUENCES };
