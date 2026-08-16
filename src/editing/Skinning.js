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
// Smoothing is OFF by default. The bind is rigid — one bone per vertex — and that is the
// point: the capsules state exactly which vertices each bone owns, and a smoothing pass
// immediately blurs that statement across capsule boundaries. Smoothing (and delta mush after
// it) belongs on top of an assignment that is already right, so it stays a knob rather than a
// default until the assignment is trusted.
const SMOOTH_ITERATIONS = 0;

// Tuning knobs, live from the console — a VR round trip is the expensive part of judging a
// weight solve, so the numbers that shape it are adjustable without an edit-reload cycle.
function tune(key, dflt) {
  const v = window[key];
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

const _mMesh = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
const _mJoint = new THREE.Matrix4(), _mSkin = new THREE.Matrix4();
const _mTmp = new THREE.Matrix4();
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

// Joint positions in MESH-LOCAL space, as they are RIGHT NOW.
function jointPositionsNow(mesh, joints) {
  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  _mInv.copy(_mMesh).invert();
  return joints.map((j) => Skeleton.jointPos(j).applyMatrix4(_mInv));
}

// Joint positions as they were AT BIND, recovered from the inverse bind matrices (which are
// already mesh-local, so inverting one and reading its translation gives the bind position).
// Re-solving weights has to measure against these: the rest vertices the solve runs on are
// the bind-pose vertices, so measuring them against a POSED skeleton would assign every
// vertex by where its bone has moved to rather than by where it started.
function jointPositionsAtBind(invBind) {
  return invBind.map((m) => {
    const e = _mTmp.copy(m).invert().elements;
    return new THREE.Vector3(e[12], e[13], e[14]);
  });
}

// Bones as (parent joint, child joint) segments in MESH-LOCAL space, given joint positions in
// that space. A chain's LAST joint contributes no bone of its own — nothing hangs below it —
// though the bone that ends at it is still measured against its position.
//
// A BONE DEFORMS WITH ITS PARENT JOINT — the joint at its head. The forearm runs elbow to
// wrist and is moved by the ELBOW; rotating the wrist must move the hand, not the forearm.
// This was the other way round at first (bone owned by its child joint), and the symptom was
// exact: rotating a wrist swung the whole forearm, because the forearm's vertices were bound
// to the wrist. The vertex colours looked correct throughout — the assignment WAS what the
// colours said — but every capsule was labelled with the joint one step too far down the
// chain. Weights bound before this need a rebind.
function boneSegments(mesh, joints, pos) {
  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  const scale = Math.hypot(_mMesh.elements[0], _mMesh.elements[1], _mMesh.elements[2]) || 1;

  const index = new Map();
  joints.forEach((j, i) => index.set(j, i));

  const segs = [];
  joints.forEach((j, i) => {
    const p = j._parentMesh;
    if (!index.has(p)) return;
    segs.push({
      // The radius still lives on the CHILD joint (that is the joint that created the bone and
      // the one whose radius you drag), but the bone moves with the PARENT.
      joint: index.get(p),
      a: pos[index.get(p)], b: pos[i],
      r: Math.max((j._boneRadius || 0) / scale, 1e-4),
    });
  });
  return segs;
}

// NEAREST CAPSULE, ONE BONE PER VERTEX. Every vertex belongs to exactly one capsule — the
// one it is nearest — with weight 1. No falloff, no blending, no smoothing.
//
// This replaced a smooth multi-influence falloff on purpose. Any falloff spreads influence
// past the capsule it came from, so the drawn capsules stopped predicting the deformation and
// the weights read as broad and mushy no matter how carefully the capsules were tuned. Rigid
// assignment makes the capsule an exact statement: this bone moves these vertices and no
// others. That is what makes editing a radius a legible act, and it is the thing to get right
// before smoothing or delta mush go on top — both of which soften a correct assignment, and
// neither of which can rescue a wrong one.
//
// "Nearest" is measured in units of each capsule's OWN radius (t = distance / radius), not in
// absolute distance. A thick torso capsule and a thin finger capsule otherwise compete on raw
// proximity, and the thin one wins territory it has no business owning purely by being close
// to the surface. In these units a vertex inside a capsule has t < 1, so `outside` — the count
// of vertices no capsule actually contains — is a real diagnostic: it means capsules are too
// small, and those vertices were assigned by nearest rather than by containment.
function nearestCapsuleWeights(verts, nbV, segs) {
  const idx = new Int32Array(nbV * MAX_INFLUENCES).fill(-1);
  const wts = new Float32Array(nbV * MAX_INFLUENCES);
  let outside = 0;

  for (let i = 0; i < nbV; i++) {
    const px = verts[i * 3], py = verts[i * 3 + 1], pz = verts[i * 3 + 2];
    let bestJoint = -1, bestT2 = Infinity;

    for (let s = 0; s < segs.length; s++) {
      const sg = segs[s];
      const d2 = distToSegment2(px, py, pz,
        sg.a.x, sg.a.y, sg.a.z, sg.b.x, sg.b.y, sg.b.z);
      const t2 = d2 / (sg.r * sg.r);
      if (t2 < bestT2) { bestT2 = t2; bestJoint = sg.joint; }
    }

    if (bestJoint < 0) continue;
    if (bestT2 > 1) outside++;
    idx[i * MAX_INFLUENCES] = bestJoint;
    wts[i * MAX_INFLUENCES] = 1;
  }
  return { idx: idx, wts: wts, outside: outside };
}

// Laplacian smoothing over the weight field: average each vertex's weights with its
// neighbours' and renormalise. This is what turns a rigid capsule assignment into
// something usable — it eats the hard boundary where two capsules meet, which is exactly
// where an unsmoothed bind creases.
//
// Weights are sparse, so smoothing runs through a dense per-vertex map and re-sparsifies.
// Allocation-free inner loop, deliberately. The obvious version — a Map plus an array
// sort per vertex per iteration — is three allocations and a sort for every vertex, which
// on a real sculpt turns a bind into a multi-second freeze. Instead the accumulator is a
// dense scratch array indexed by joint, touched joints are tracked in a small list so it
// can be cleared in O(touched), and the top-N is an insertion sort over 4 slots.
function smoothWeights(mesh, idx, wts, iterations, nbJoints) {
  const nbV = mesh.getNbVertices();
  const adj = adjacencyFromFaces(mesh);

  const acc = new Float64Array(nbJoints);
  const touched = new Int32Array(nbJoints);
  const bestI = new Int32Array(MAX_INFLUENCES);
  const bestW = new Float64Array(MAX_INFLUENCES);

  let curIdx = idx, curW = wts;
  for (let it = 0; it < iterations; it++) {
    const nIdx = new Int32Array(nbV * MAX_INFLUENCES).fill(-1);
    const nW = new Float32Array(nbV * MAX_INFLUENCES);

    for (let i = 0; i < nbV; i++) {
      let nTouched = 0;
      const add = (v, scale) => {
        const base = v * MAX_INFLUENCES;
        for (let k = 0; k < MAX_INFLUENCES; k++) {
          const j = curIdx[base + k];
          if (j < 0) continue;
          if (acc[j] === 0) touched[nTouched++] = j;
          acc[j] += curW[base + k] * scale;
        }
      };
      add(i, 1);
      const nb = adj[i];
      // Neighbours together carry the same weight as the vertex itself, so smoothing
      // blurs the boundary without dragging every vertex toward the mesh average.
      if (nb.length) { const s = 1 / nb.length; for (let n = 0; n < nb.length; n++) add(nb[n], s); }

      bestI.fill(-1); bestW.fill(0);
      for (let t = 0; t < nTouched; t++) {
        const j = touched[t], w = acc[j];
        acc[j] = 0; // clear as we go: no second pass, no full-array wipe
        let k = MAX_INFLUENCES - 1;
        if (w <= bestW[k]) continue;
        while (k > 0 && bestW[k - 1] < w) { bestW[k] = bestW[k - 1]; bestI[k] = bestI[k - 1]; k--; }
        bestW[k] = w; bestI[k] = j;
      }

      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) sum += bestW[k];
      if (sum <= 0) continue;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        if (bestI[k] < 0) continue;
        nIdx[i * MAX_INFLUENCES + k] = bestI[k];
        nW[i * MAX_INFLUENCES + k] = bestW[k] / sum;
      }
    }
    curIdx = nIdx; curW = nW;
  }
  return { idx: curIdx, wts: curW };
}

// Optional smoothing pass on top of the rigid assignment, off unless asked for. Takes the
// bound LEVEL, not the mesh: it reads a vertex count and builds adjacency from faces, and both
// must come from the level the weights address.
function solveSmoothing(level, raw, nbJoints) {
  const iterations = Math.round(tune('_skinSmooth', SMOOTH_ITERATIONS));
  if (iterations <= 0) return raw;
  return smoothWeights(level, raw.idx, raw.wts, iterations, nbJoints);
}

// Bind `mesh` to every joint currently in the scene.
//
// Binding FREEZES TOPOLOGY: the weights are indexed by vertex, so any op that changes the
// vertex count invalidates them. Callers gate on isBound() rather than silently dropping
// weights — losing a weight map without being told is the failure mode we are explicitly
// designing against.
Skinning.bind = function (main, mesh) {
  const joints = Skeleton.joints(main);
  if (!mesh || !joints.length) return { ok: false, why: 'need a mesh and a bone chain' };

  // Drawing a chain leaves the last JOINT as the active mesh (addNewMesh selects what it
  // adds), so "select a mesh then bind" silently binds a joint locator to the skeleton
  // unless this is checked. Refuse it — a joint is not skinnable geometry.
  if (mesh._isBone || mesh._isNull) {
    return { ok: false, why: 'select the character mesh first (a joint is selected)' };
  }

  const segs = boneSegments(mesh, joints, jointPositionsNow(mesh, joints));
  if (!segs.length) return { ok: false, why: 'skeleton has no bones (a chain needs 2+ joints)' };

  // Bind to the level currently selected, and remember which one that was. Binding at the
  // LOWEST level is the useful case — a few thousand vertices to solve instead of a few
  // hundred thousand, and the detail above rides along through the multires stack.
  mesh._skinLevel = mesh._sel || 0;
  mesh._skinSizeWarned = false;
  const level = boundLevel(mesh);

  const t0 = performance.now();
  const raw = nearestCapsuleWeights(level.getVertices(), level.getNbVertices(), segs);
  const w = solveSmoothing(level, raw, joints.length);

  // Inverse bind matrices, in mesh-local space.
  _mMesh.fromArray(mesh.getModelSpaceMatrix());
  _mInv.copy(_mMesh).invert();
  const invBind = joints.map((j) => {
    _mJoint.fromArray(j.getModelSpaceMatrix());
    return new THREE.Matrix4().multiplyMatrices(_mInv, _mJoint).invert();
  });

  const nbV = level.getNbVertices();
  mesh._skinJoints = joints.map((j) => j.getID());
  mesh._skinIdx = w.idx;
  mesh._skinW = w.wts;
  mesh._skinInvBind = invBind;
  mesh._skinRest = new Float32Array(level.getVertices().subarray(0, nbV * 3));
  mesh._skinSrc = new Float32Array(mesh._skinRest);
  mesh._skinStampBuf = null;
  mesh._skinDirty = true;
  Skinning.refreshWeightColors(main, mesh);
  return { ok: true, name: mesh._permanentStaticLabel || 'mesh', joints: joints.length,
           verts: nbV, ms: Math.round(performance.now() - t0), outside: raw.outside };
};

// Re-solve the weights of an already-bound mesh against the CURRENT capsules, leaving the
// bind pose and the inverse binds alone. This is what makes radius editing a live operation:
// grow a capsule and the vertices it owns change under your hand, in colour, immediately —
// which is the only way to tune an envelope without a bind-look-unbind loop for every guess.
//
// Deliberately measures the BIND-pose skeleton against the BIND-pose vertices, so it stays
// correct even if the character is posed while you edit.
Skinning.resolveWeights = function (main, mesh) {
  if (!Skinning.isBound(mesh)) return false;
  const joints = resolveJoints(main, mesh);
  if (joints.some((j) => !j)) return false; // a joint was deleted: rebinding is the fix

  const segs = boneSegments(mesh, joints, jointPositionsAtBind(mesh._skinInvBind));
  if (!segs.length) return false;

  const nbV = (mesh._skinRest.length / 3) | 0;
  const raw = nearestCapsuleWeights(mesh._skinRest, nbV, segs);
  const w = solveSmoothing(boundLevel(mesh), raw, joints.length);
  mesh._skinIdx = w.idx;
  mesh._skinW = w.wts;
  mesh._skinDirty = true;
  Skinning.refreshWeightColors(main, mesh);
  return true;
};

// The mesh a joint drives, if any. Selecting a joint is unavoidable while rigging — grabbing
// one selects it — so operations aimed at "the model" need a way to find the model from the
// bone the user happens to have hold of.
Skinning.meshForJoint = function (main, joint) {
  if (!joint || !joint.getID) return null;
  const id = joint.getID();
  const meshes = main.getMeshes() || [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (m._skinJoints && m._skinJoints.indexOf(id) >= 0) return m;
  }
  return null;
};

// Every bound mesh in the scene, for the live editing path.
Skinning.resolveWeightsAll = function (main) {
  const meshes = main.getMeshes() || [];
  let n = 0;
  for (let i = 0; i < meshes.length; i++) {
    if (Skinning.isBound(meshes[i]) && Skinning.resolveWeights(main, meshes[i])) n++;
  }
  return n;
};

// ---- weight colour preview ------------------------------------------------------
//
// Paint each vertex in the identity colour of the bone that owns it. This is the whole
// diagnostic: a bone's capsule and the vertices it claims are the same colour, so weights
// reaching past their capsule are not something to reason about, they are something you see.
// The mesh's real colours are saved and put back when the preview is turned off.

Skinning.weightColorsShown = function (mesh) { return !!(mesh && mesh._skinSavedColors); };

Skinning.showWeightColors = function (main, mesh) {
  if (!Skinning.isBound(mesh)) return false;
  // Colours are per weight, so they belong to the bound level too. At another level the map
  // does not address these vertices and painting would be meaningless.
  const level = boundLevel(mesh);
  const nbV = (mesh._skinRest.length / 3) | 0;
  if (level.getNbVertices() !== nbV) return false;
  const colors = level.getColors();
  if (!mesh._skinSavedColors) {
    mesh._skinSavedColors = new Float32Array(colors.subarray(0, nbV * 3));
  }

  const joints = resolveJoints(main, mesh);
  const cols = joints.map((j) => (j ? Skeleton.boneColor(main, j) : null));
  const idx = mesh._skinIdx, wts = mesh._skinW;

  for (let i = 0; i < nbV; i++) {
    let r = 0, g = 0, b = 0, total = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const j = idx[i * MAX_INFLUENCES + k];
      if (j < 0 || !cols[j]) continue;
      const w = wts[i * MAX_INFLUENCES + k];
      r += cols[j].r * w; g += cols[j].g * w; b += cols[j].b * w;
      total += w;
    }
    // Unowned vertices go near-black rather than to some bone's colour: "nothing moves this"
    // is a distinct answer from "this bone moves it", and it is the one worth spotting.
    if (total <= 1e-6) { r = g = b = 0.04; total = 1; }
    colors[i * 3] = r / total; colors[i * 3 + 1] = g / total; colors[i * 3 + 2] = b / total;
  }
  mesh.updateDuplicateColorsAndMaterials();
  mesh.updateColorBuffer();
  return true;
};

Skinning.restoreColors = function (mesh) {
  if (!mesh || !mesh._skinSavedColors) return;
  const level = boundLevel(mesh);
  if (level.getNbVertices() * 3 < mesh._skinSavedColors.length) return; // wrong level: leave it
  level.getColors().set(mesh._skinSavedColors);
  mesh._skinSavedColors = null;
  mesh.updateDuplicateColorsAndMaterials();
  mesh.updateColorBuffer();
};

// Repaint if the preview is on, otherwise make sure the real colours are back. Called after
// anything that changes the assignment, so the two states can never drift apart.
Skinning.refreshWeightColors = function (main, mesh) {
  if (!Skinning.isBound(mesh)) { Skinning.restoreColors(mesh); return; }
  if (window._boneShowWeights === false) Skinning.restoreColors(mesh);
  else Skinning.showWeightColors(main, mesh);
};

// Put every mesh's real colours back. Called when the Bones tool is left, so a preview can
// never end up baked into a saved sculpt just because the user walked away from the tool.
Skinning.restoreColorsAll = function (main) {
  const meshes = main.getMeshes() || [];
  for (let i = 0; i < meshes.length; i++) Skinning.restoreColors(meshes[i]);
};

Skinning.refreshWeightColorsAll = function (main) {
  const meshes = main.getMeshes() || [];
  for (let i = 0; i < meshes.length; i++) {
    if (Skinning.isBound(meshes[i]) || meshes[i]._skinSavedColors) {
      Skinning.refreshWeightColors(main, meshes[i]);
    }
  }
};

Skinning.unbind = function (mesh) {
  if (!mesh) return;
  Skinning.restoreColors(mesh);
  // Put the mesh back in its bind pose rather than leaving it stuck in whatever pose it
  // happened to be in — an unbind that silently freezes a pose is worse than no unbind.
  const level = boundLevel(mesh);
  if (mesh._skinRest && level.getNbVertices() * 3 >= mesh._skinRest.length) {
    level.getVertices().set(mesh._skinRest);
    if (synthesiseUp(mesh)) {
      mesh.updateResolution();
    } else {
      mesh.updateGeometry();
      if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
    }
  }
  mesh._skinJoints = mesh._skinIdx = mesh._skinW = null;
  mesh._skinInvBind = mesh._skinRest = mesh._skinSrc = null;
  mesh._skinLevel = 0;
};

// Called by applyBlendshapes once it has composited base + deltas: that composite IS the
// rest-space pose skinning should transform. Without this the two systems fight — the
// skin pass would keep re-transforming its own output.
Skinning.captureSource = function (mesh) {
  if (!mesh || !mesh._skinSrc) return;
  // Read the bound level, and only when it still matches: the source array is the rest space
  // the skin pass transforms, and filling it from a different level would feed the deformation
  // vertices that are not the ones it is weighted for.
  const v = boundLevel(mesh).getVertices();
  if (v.length < mesh._skinSrc.length) return;
  mesh._skinSrc.set(v.subarray(0, mesh._skinSrc.length));
  mesh._skinDirty = true; // the rest pose changed, so re-skin even if no joint moved
};

// ---- multires ------------------------------------------------------------------
//
// A Multimesh's getVertices()/getNbVertices() delegate to the CURRENTLY SELECTED level, so a
// weight map built at one level addresses nothing meaningful at another. Binding therefore
// records the level it bound at, and every later pass works on THAT level's arrays explicitly
// rather than on whatever happens to be selected.
//
// Without this, going up a level after binding and then rotating a joint made the mesh vanish:
// the skin loop ran to the high level's vertex count while reading level-0-sized weight and
// source arrays, so every index past the end returned undefined, every vertex came out NaN,
// and the mesh (plus the skeleton, whose marker scale derives from the scene bounding radius)
// disappeared. Reading off the end of a typed array wrapper is silent — nothing throws.

// The MeshResolution the weights belong to, or the mesh itself when there is no stack.
function boundLevel(mesh) {
  const stack = mesh._meshes;
  if (!stack || !stack.length) return mesh;
  const lvl = mesh._skinLevel || 0;
  return stack[Math.min(lvl, stack.length - 1)] || mesh;
}

// Push a change at the bound level up through the stack to the level being displayed. This is
// the existing multires propagation — partial subdivision of the level below, then each higher
// vertex's stored detail re-applied in its local frame — so sculpted detail rides along on top
// of the posed cage rather than being flattened by it.
function synthesiseUp(mesh) {
  const stack = mesh._meshes;
  if (!stack || !stack.length) return false;
  const from = mesh._skinLevel || 0;
  const to = mesh._sel || 0;
  if (to <= from) return false;
  for (let i = from + 1; i <= to; i++) stack[i].higherSynthesis(stack[i - 1]);
  return true;
}

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
// Compares the FULL matrix, not a sample of it. Sampling the diagonal is second-order
// insensitive to small rotations (cos θ ≈ 1 for small θ, while the off-diagonals move
// linearly), which would make a slow joint rotation — the main thing pose mode does —
// fail to trigger a re-skin. 16 floats per joint is nothing next to the skin pass itself.
function poseChanged(mesh, joints) {
  const n = joints.length * 16;
  let buf = mesh._skinStampBuf;
  if (!buf || buf.length !== n) buf = mesh._skinStampBuf = new Float32Array(n).fill(NaN);
  let changed = false;
  for (let i = 0; i < joints.length; i++) {
    const m = joints[i] ? joints[i].getMatrix() : null;
    for (let k = 0; k < 16; k++) {
      const v = m ? m[k] : 0;
      if (buf[i * 16 + k] !== v) { buf[i * 16 + k] = v; changed = true; }
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

  // Work on the level the weights were built for, whatever level is being displayed.
  const level = boundLevel(mesh);
  const src = mesh._skinSrc, out = level.getVertices();
  const idx = mesh._skinIdx, wts = mesh._skinW;
  const nbV = (mesh._skinRest.length / 3) | 0;

  // Belt and braces: if the level's vertex count ever disagrees with the weight map, do
  // NOTHING. Skinning past the end of the arrays writes NaN over the whole mesh, which is
  // unrecoverable for the user; refusing to deform is merely disappointing.
  if (level.getNbVertices() !== nbV) {
    if (!mesh._skinSizeWarned) {
      mesh._skinSizeWarned = true;
      console.warn('[Skinning] weight map is for %d verts, level has %d — skipping. Rebind.',
        nbV, level.getNbVertices());
    }
    return false;
  }

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

  // Carry the posed cage up to the displayed level, then refresh. updateResolution is the
  // stack's own refresh (geometry + colours + buffers + wireframe); without it the higher
  // level would hold new vertices that never reach the GPU.
  if (synthesiseUp(mesh)) {
    mesh.updateResolution();
  } else {
    mesh.updateGeometry();
    if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  }
  return true;
};

// Per-frame pass over every bound mesh. Cheap when nothing moved (the stamp check).
//
// `window._skinPause = true` disables the whole pass. It is a diagnostic, not a feature: the
// skin pass writes vertices and rebuilds buffers every frame a joint moves, so when something
// else in the mesh pipeline misbehaves on a bound mesh, being able to take it out of the
// picture in one line is the difference between a guess and an answer.
Skinning.update = function (main) {
  if (window._skinPause) return;
  const meshes = main.getMeshes();
  if (!meshes) return;
  for (let i = 0; i < meshes.length; i++) {
    if (Skinning.isBound(meshes[i])) Skinning.apply(main, meshes[i]);
  }
};

export default Skinning;
export { MAX_INFLUENCES };
