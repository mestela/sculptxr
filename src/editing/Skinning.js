import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import WeightCage from './WeightCage.js';
import { adjacencyFromFaces } from './Geodesic.js';
import getOptionsURL from '../misc/getOptionsURL.js';

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

// ---- delta mush ------------------------------------------------------------------
//
// The pass that makes a RIGID capsule bind usable: Blue Sky's answer to "one bone per
// vertex creases at every boundary". It does not touch the weights at all — it is a
// post-process on the deformed positions, so the capsules go on stating exactly which bone
// owns which vertex (which is what makes editing a radius legible) while the SHAPE across a
// boundary comes out smooth.
//
// How it works, in one line: smooth the deformed mesh hard enough to lose every crease AND
// every sculpted detail, then put the detail back as a per-vertex offset expressed in a
// LOCAL FRAME built from the smoothed surface. Because the frame rotates with the smoothed
// surface, the detail rides the deformation instead of being flattened by it.
//
// Two properties fall out of that and both are load-bearing:
//   - At the bind pose the result is EXACTLY the rest mesh. smooth(rest) + frame . delta is
//     how the delta was defined, so mush is invisible until something moves.
//   - Under a rigid move of the whole skeleton the result is the rigidly moved rest mesh.
//     The frames rotate with it, so nothing shrinks and nothing swims.
// Both are asserted in scratchpad/deltamush_test.mjs. They are the checks that separate a
// working mush from a plausible-looking blur.
//
// The iteration count is the only real knob: it is the RADIUS of the smoothing, in edges. It
// has to reach across the crease it is meant to remove, so a dense mesh needs more of them
// than a coarse one. Zero disables the whole pass.
const MUSH_ITERATIONS = 10;
const MUSH_STEP = 0.6;   // per-iteration move toward the neighbour average
const MUSH_AMOUNT = 1;   // blend between the raw LBS result (0) and the mushed one (1)

// Live value, then the saved one, then the default — the display-flag order, so a slider
// drag takes effect on the current frame.
Skinning.mushIterations = function () {
  const live = window._skinMush;
  if (Number.isFinite(live) && live >= 0) return Math.round(live);
  const saved = getOptionsURL().boneMush;
  return Number.isFinite(saved) && saved >= 0 ? Math.round(saved) : MUSH_ITERATIONS;
};

Skinning.setMushIterations = function (n) {
  window._skinMush = Math.max(0, Math.round(n));
  getOptionsURL.saveOption('boneMush', window._skinMush, 0);
};

Skinning.defaultMushIterations = function () { return MUSH_ITERATIONS; };

// Vertex adjacency, flattened. The array-of-arrays that adjacencyFromFaces returns is fine
// to build from and wrong to iterate at 90Hz — this runs several times a frame over every
// vertex, and chasing a pointer per vertex per iteration is most of the cost. Duplicates are
// dropped: adjacencyFromFaces links an interior edge once per face that shares it, which
// would weight those neighbours double in the average for no reason anyone chose.
function flatAdjacency(level) {
  const adj = adjacencyFromFaces(level);
  const nbV = adj.length;
  const off = new Int32Array(nbV + 1);
  let total = 0;
  const seen = new Int32Array(nbV).fill(-1);
  for (let i = 0; i < nbV; i++) {
    const a = adj[i];
    for (let k = 0; k < a.length; k++) { if (seen[a[k]] !== i) { seen[a[k]] = i; total++; } }
    off[i + 1] = total;
  }
  const nb = new Int32Array(total);
  seen.fill(-1);
  let w = 0;
  for (let i = 0; i < nbV; i++) {
    const a = adj[i];
    for (let k = 0; k < a.length; k++) { if (seen[a[k]] !== i) { seen[a[k]] = i; nb[w++] = a[k]; } }
  }
  return { off: off, nb: nb };
}

// Uniform Laplacian, `iters` passes, ping-ponging between two buffers. Returns whichever
// buffer holds the result. A vertex with no neighbours (an isolated vert) holds still.
function smoothPositions(src, a, b, off, nb, iters, step) {
  let cur = src, out = a;
  const nbV = (src.length / 3) | 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < nbV; i++) {
      const s = off[i], e = off[i + 1], n = e - s;
      const i3 = i * 3, px = cur[i3], py = cur[i3 + 1], pz = cur[i3 + 2];
      if (n === 0) { out[i3] = px; out[i3 + 1] = py; out[i3 + 2] = pz; continue; }
      let ax = 0, ay = 0, az = 0;
      for (let k = s; k < e; k++) { const j = nb[k] * 3; ax += cur[j]; ay += cur[j + 1]; az += cur[j + 2]; }
      const inv = 1 / n;
      out[i3] = px + (ax * inv - px) * step;
      out[i3 + 1] = py + (ay * inv - py) * step;
      out[i3 + 2] = pz + (az * inv - pz) * step;
    }
    cur = out; out = (out === a) ? b : a;
  }
  return cur;
}

// The orthonormal frame at vertex `i` of a smoothed position array, from two of its
// neighbours. Written into `f` as [tx,ty,tz, nx,ny,nz, bx,by,bz]; returns false when the
// pair is degenerate (collinear), which the caller answers by storing the delta in world
// space instead.
//
// The PAIR IS CHOSEN ONCE, AT BIND, and stored — not re-picked per frame. Picking the
// "best" pair from the posed mesh would let the choice flip between frames as the surface
// moves, and a frame that changes identity mid-animation makes the detail jump.
function frameAt(p, i, ia, ib, f) {
  const i3 = i * 3, a3 = ia * 3, b3 = ib * 3;
  const px = p[i3], py = p[i3 + 1], pz = p[i3 + 2];
  let tx = p[a3] - px, ty = p[a3 + 1] - py, tz = p[a3 + 2] - pz;
  const ex = p[b3] - px, ey = p[b3 + 1] - py, ez = p[b3 + 2] - pz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-12) return false;
  tx /= tl; ty /= tl; tz /= tl;
  // Normal from the two edges. Perpendicular to t by construction, so t/n/b is orthonormal
  // without a Gram-Schmidt step.
  let nx = ty * ez - tz * ey, ny = tz * ex - tx * ez, nz = tx * ey - ty * ex;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-9) return false;
  nx /= nl; ny /= nl; nz /= nl;
  f[0] = tx; f[1] = ty; f[2] = tz;
  f[3] = nx; f[4] = ny; f[5] = nz;
  f[6] = ny * tz - nz * ty; f[7] = nz * tx - nx * tz; f[8] = nx * ty - ny * tx;
  return true;
}

// Scratch, sized to the bound level and reused. Two position buffers for the ping-pong plus
// the frame.
function mushScratch(mesh, n) {
  let sc = mesh._skinMushScratch;
  if (!sc || sc.a.length !== n) {
    sc = mesh._skinMushScratch = { a: new Float32Array(n), b: new Float32Array(n), f: new Float64Array(9) };
  }
  return sc;
}

// Build the rest-space deltas: what each vertex is, relative to the smoothed surface under
// it. Runs against `_skinSrc` — the composited rest pose, base plus blendshape deltas — not
// `_skinRest`, so a blendshape's detail is preserved rather than being read as deformation
// and smoothed away.
function buildMush(mesh, level, iters, step) {
  const src = mesh._skinSrc;
  const nbV = (src.length / 3) | 0;
  if (!mesh._skinAdj || mesh._skinAdj.off.length !== nbV + 1) mesh._skinAdj = flatAdjacency(level);
  const off = mesh._skinAdj.off, nb = mesh._skinAdj.nb;

  const sc = mushScratch(mesh, src.length);
  const sm = smoothPositions(src, sc.a, sc.b, off, nb, iters, step);

  const pair = new Int32Array(nbV * 2);
  const delta = new Float32Array(nbV * 3);
  const f = sc.f;

  for (let i = 0; i < nbV; i++) {
    const s = off[i], e = off[i + 1];
    // Pick the neighbour pair whose edges are furthest from collinear, measured on the
    // SMOOTHED surface the frame is actually built from. A near-collinear pair gives a
    // normal that is mostly rounding error, and the detail it carries wobbles with it.
    let ba = -1, bb = -1, best = 0;
    const i3 = i * 3, px = sm[i3], py = sm[i3 + 1], pz = sm[i3 + 2];
    for (let k = s; k < e; k++) {
      const j = nb[k] * 3;
      const ux = sm[j] - px, uy = sm[j + 1] - py, uz = sm[j + 2] - pz;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (ul < 1e-12) continue;
      for (let k2 = k + 1; k2 < e; k2++) {
        const j2 = nb[k2] * 3;
        const vx = sm[j2] - px, vy = sm[j2 + 1] - py, vz = sm[j2 + 2] - pz;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (vl < 1e-12) continue;
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        // Normalised: the sine of the angle between them, so a long thin edge pair cannot
        // beat a short well-spread one just by being long.
        const q = Math.sqrt(cx * cx + cy * cy + cz * cz) / (ul * vl);
        if (q > best) { best = q; ba = nb[k]; bb = nb[k2]; }
      }
    }

    const dx = src[i3] - sm[i3], dy = src[i3 + 1] - sm[i3 + 1], dz = src[i3 + 2] - sm[i3 + 2];
    if (ba >= 0 && frameAt(sm, i, ba, bb, f)) {
      pair[i * 2] = ba; pair[i * 2 + 1] = bb;
      delta[i3] = dx * f[0] + dy * f[1] + dz * f[2];
      delta[i3 + 1] = dx * f[3] + dy * f[4] + dz * f[5];
      delta[i3 + 2] = dx * f[6] + dy * f[7] + dz * f[8];
    } else {
      // No usable frame (an isolated or degenerate vertex): carry the offset in world space.
      // It will not rotate with the surface, which is wrong in principle and unnoticeable in
      // practice for a vertex that has no surface around it to rotate with.
      pair[i * 2] = -1; pair[i * 2 + 1] = -1;
      delta[i3] = dx; delta[i3 + 1] = dy; delta[i3 + 2] = dz;
    }
  }

  mesh._skinMushPair = pair;
  mesh._skinMushDelta = delta;
  mesh._skinMushIters = iters;
  mesh._skinMushStep = step;
  mesh._skinMushDirty = false;
}

// Smooth the DEFORMED positions in `out` and put the stored detail back on top, in place.
// Called with the LBS result; leaves `out` holding the mushed result.
function applyMush(mesh, level, out, nbV) {
  const iters = Skinning.mushIterations();
  if (iters <= 0) return false;
  const step = tune('_skinMushStep', MUSH_STEP);
  let amount = tune('_skinMushAmount', MUSH_AMOUNT);
  if (amount > 1) amount = 1;
  if (amount <= 0) return false;

  if (!mesh._skinMushDelta || mesh._skinMushDelta.length !== nbV * 3 ||
      mesh._skinMushIters !== iters || mesh._skinMushStep !== step || mesh._skinMushDirty) {
    buildMush(mesh, level, iters, step);
  }

  // The pass is O(vertices x iterations) and runs on every frame a joint moves, so it is the
  // one part of skinning with a real per-frame budget. Measured (desktop M-series, 10
  // iterations): about 0.12 ms per 1000 vertices, linear in both. A 5k bind level is well
  // inside a 90Hz frame; a 50k one is not, on any headset. `window._skinTrace = true` prints
  // the cost once a second FROM THE DEVICE, which is the only number worth trusting.
  const t0 = window._skinTrace ? performance.now() : 0;

  const off = mesh._skinAdj.off, nb = mesh._skinAdj.nb;
  const sc = mushScratch(mesh, nbV * 3);
  const sm = smoothPositions(out, sc.a, sc.b, off, nb, iters, step);
  const pair = mesh._skinMushPair, delta = mesh._skinMushDelta, f = sc.f;

  for (let i = 0; i < nbV; i++) {
    const i3 = i * 3;
    const ia = pair[i * 2], ib = pair[i * 2 + 1];
    let x, y, z;
    if (ia >= 0 && frameAt(sm, i, ia, ib, f)) {
      const dx = delta[i3], dy = delta[i3 + 1], dz = delta[i3 + 2];
      x = sm[i3] + f[0] * dx + f[3] * dy + f[6] * dz;
      y = sm[i3 + 1] + f[1] * dx + f[4] * dy + f[7] * dz;
      z = sm[i3 + 2] + f[2] * dx + f[5] * dy + f[8] * dz;
    } else {
      x = sm[i3] + delta[i3]; y = sm[i3 + 1] + delta[i3 + 1]; z = sm[i3 + 2] + delta[i3 + 2];
    }
    if (amount >= 1) { out[i3] = x; out[i3 + 1] = y; out[i3 + 2] = z; continue; }
    out[i3] += (x - out[i3]) * amount;
    out[i3 + 1] += (y - out[i3 + 1]) * amount;
    out[i3 + 2] += (z - out[i3 + 2]) * amount;
  }

  if (window._skinTrace) {
    const now = performance.now();
    if (now - (mesh._skinTraceAt || 0) > 1000) {
      mesh._skinTraceAt = now;
      console.log('[skin] mush %d verts x %d iters: %sms', nbV, iters, (now - t0).toFixed(2));
    }
  }
  return true;
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

  // Skinning always belongs to the control cage. If the sculpt is currently displayed above
  // level 0, analyse each step downward first so the cage and every stored detail layer reflect
  // the visible sculpt. Do this directly on the resolution objects rather than changing
  // selection: Bind must not unexpectedly drop the user's viewport to the lowest level.
  if (mesh._meshes?.length) {
    for (let i = mesh._sel || 0; i > 0; i--) mesh._meshes[i - 1].lowerAnalysis(mesh._meshes[i]);
  }
  mesh._skinLevel = 0;
  mesh._skinSizeWarned = false;
  mesh._skinLevelWarned = false;
  // The level itself, so later passes survive the list being reordered under them.
  mesh._skinLevelMesh = mesh._meshes ? mesh._meshes[0] : null;
  const level = boundLevel(mesh);
  if (!level) return { ok: false, why: 'no geometry at the selected level' };

  const t0 = performance.now();

  // CAGES IF THERE ARE ANY, CAPSULES OTHERWISE.
  //
  // A cage is a baked capsule you have sculpted, so it answers the same question with a shape
  // the capsule could not express. Falling back keeps every existing rig binding exactly as it
  // did -- a scene with no cages cannot tell this code is here.
  const cageMeshes = WeightCage.cages(main).filter((c) => !c._isVoxelChunk);
  let raw;
  let usedCages = 0;
  if (cageMeshes.length) {
    const jointIndex = new Map();
    joints.forEach((j, i) => jointIndex.set(j.getID(), i));
    const invModel = new THREE.Matrix4().fromArray(mesh.getModelSpaceMatrix()).invert();
    const prepared = [];
    for (const c of cageMeshes) {
      const ji = jointIndex.get(c._cageJointId);
      // A cage whose joint is gone -- dissolved, or from another skeleton -- has nothing to
      // speak for, and weighting vertices to a bone that no longer exists is worse than
      // ignoring it.
      if (ji === undefined) continue;
      const p = WeightCage.prepare(c, invModel, ji);
      if (p) prepared.push(p);
    }
    if (prepared.length) {
      // Slack for the broadphase: a vertex further than this outside a cage's box is not
      // measured against it at all. Generous, because a vertex outside EVERY cage still has to
      // find its nearest bone.
      let diag = 0;
      for (const p of prepared) {
        diag = Math.max(diag, Math.hypot(p.bb[3] - p.bb[0], p.bb[4] - p.bb[1], p.bb[5] - p.bb[2]));
      }
      raw = WeightCage.weights(level.getVertices(), level.getNbVertices(), prepared,
                               MAX_INFLUENCES, diag);
      usedCages = prepared.length;
    }
  }
  if (!raw) raw = nearestCapsuleWeights(level.getVertices(), level.getNbVertices(), segs);
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
  // Topology and rest space both just changed, so nothing cached for the mush survives.
  mesh._skinAdj = mesh._skinMushPair = mesh._skinMushDelta = mesh._skinMushScratch = null;
  mesh._skinMushDirty = true;
  Skinning.refreshWeightColors(main, mesh);
  // A BOUND MESH IS DRIVEN BY THE RIG, so it stops being a viewport selection target: from
  // here on you reach for a bone or a pin, and the ray hitting the character instead is a
  // constant nuisance — the skin is exactly the thing standing between you and every joint
  // inside it. Reuses the outliner's existing lock (Scene.toggleSelectLock), which the picking
  // scans already honour, so the mesh stays selectable FROM the outliner. Unbind clears it,
  // and there is a button for that in the bones panel.
  //
  // Set here rather than derived from isBound() at pick time: the picking scans have no
  // business importing the skinning module, and a bound-mesh check through the Multimesh proxy
  // has failed to fire before.
  mesh._selectLocked = true;

  return { ok: true, name: mesh._permanentStaticLabel || 'mesh', joints: joints.length,
           verts: nbV, ms: Math.round(performance.now() - t0), outside: raw.outside,
           // Which source actually decided the weights, so "I sculpted a cage and nothing
           // changed" is answerable without guessing.
           cages: usedCages };
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
  const lvl = boundLevel(mesh);
  if (!lvl) return false;
  const w = solveSmoothing(lvl, raw, joints.length);
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
  if (!level || level.getNbVertices() !== (mesh._skinRest.length / 3 | 0)) return false;
  const nbV = (mesh._skinRest.length / 3) | 0;
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
  if (!level || level.getNbVertices() * 3 < mesh._skinSavedColors.length) return; // wrong level: leave it
  level.getColors().set(mesh._skinSavedColors);
  mesh._skinSavedColors = null;
  mesh.updateDuplicateColorsAndMaterials();
  mesh.updateColorBuffer();
};

// Repaint if the preview is on, otherwise make sure the real colours are back. Called after
// anything that changes the assignment, so the two states can never drift apart.
Skinning.refreshWeightColors = function (main, mesh) {
  if (!Skinning.isBound(mesh)) { Skinning.restoreColors(mesh); return; }
  if (!Skeleton.displayFlag('weights')) Skinning.restoreColors(mesh);
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

// Force the next skin pass to run even though no joint moved. The pass is change-gated on
// the pose, so a change to the DEFORMER — the mush iteration count, from the slider — would
// otherwise sit there doing nothing until something happened to move a bone.
Skinning.markDirtyAll = function (main) {
  const meshes = main.getMeshes() || [];
  for (let i = 0; i < meshes.length; i++) {
    if (Skinning.isBound(meshes[i])) meshes[i]._skinDirty = true;
  }
};

// Is ANYTHING in the scene bound? Distinct from `isBound(getMesh())` on purpose: while
// rigging, the selection is a joint most of the time (grabbing one selects it), so a
// scene-wide action must not be gated on what happens to be selected.
// Would dropping these levels take the one the weights were built on with it? Asked BEFORE a
// destructive multires command, so the answer can be a refusal with a reason rather than a
// rig that silently stops deforming afterwards.
Skinning.levelsHoldBind = function (mesh, levels) {
  if (!Skinning.isBound(mesh) || !mesh._skinLevelMesh) return false;
  return levels.indexOf(mesh._skinLevelMesh) >= 0;
};

Skinning.anyBound = function (main) {
  return (main.getMeshes() || []).some(Skinning.isBound);
};

// Put every bound rig back at the pose it was bound in.
//
// The bind pose is not stored as a pose anywhere — but it does not need to be, because the
// inverse bind matrices ARE it: `invBind = inverse(inv(M_mesh) . J_model)` at bind, so the
// joint's bind transform comes straight back out as `M_mesh . inverse(invBind)`. Reading the
// mesh's CURRENT matrix there is deliberate: it puts the skeleton back at bind RELATIVE TO
// THE MESH, so a character that has since been moved or scaled keeps its rig on it.
//
// This is the reset that makes posing safe to experiment with, and it is exact — it restores
// the pose the weights were actually solved against, not an approximation of it.
Skinning.restoreBindPose = function (main) {
  const meshes = main.getMeshes() || [];
  const targets = new Map();
  for (const mesh of meshes) {
    if (!Skinning.isBound(mesh)) continue;
    const joints = resolveJoints(main, mesh);
    _mMesh.fromArray(mesh.getModelSpaceMatrix());
    joints.forEach((j, i) => {
      // First bind wins if two meshes share a joint — they were bound at different moments
      // and would disagree, and silently averaging two bind poses would be worse than either.
      if (!j || targets.has(j) || !mesh._skinInvBind[i]) return;
      targets.set(j, new THREE.Matrix4().copy(mesh._skinInvBind[i]).invert().premultiply(_mMesh));
    });
  }
  if (!targets.size) return 0;

  // Roots first: a child's model-space transform is only meaningful once its ancestors are
  // back in place, since setModelSpaceMatrix converts through the parent's CURRENT world
  // matrix. Same ordering the skeleton loader needs, for the same reason.
  const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
  const ordered = Array.from(targets.keys()).sort((a, b) => depth(a) - depth(b));
  for (const j of ordered) {
    j.setModelSpaceMatrix(targets.get(j).elements);
    Skeleton.syncThree(j);
  }
  return ordered.length;
};

Skinning.unbind = function (mesh) {
  if (!mesh) return;
  Skinning.restoreColors(mesh);
  // Put the mesh back in its bind pose rather than leaving it stuck in whatever pose it
  // happened to be in — an unbind that silently freezes a pose is worse than no unbind.
  const level = boundLevel(mesh);
  if (level && mesh._skinRest && level.getNbVertices() * 3 >= mesh._skinRest.length) {
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
  mesh._skinAdj = mesh._skinMushPair = mesh._skinMushDelta = mesh._skinMushScratch = null;
  mesh._skinLevel = 0;
  mesh._skinLevelMesh = null;
  mesh._skinLevelWarned = false;
  // Bind locked it out of the viewport; unbind hands it back. Unconditional, matching bind —
  // the lock is owned by the bind state here, and leaving a mesh unselectable after unbinding
  // is the one failure mode with no obvious way out from inside the headset.
  mesh._selectLocked = false;
};

// Called by applyBlendshapes once it has composited base + deltas: that composite IS the
// rest-space pose skinning should transform. Without this the two systems fight — the
// skin pass would keep re-transforming its own output.
Skinning.captureSource = function (mesh) {
  if (!mesh || !mesh._skinSrc) return;
  // Read the bound level, and only when it still matches: the source array is the rest space
  // the skin pass transforms, and filling it from a different level would feed the deformation
  // vertices that are not the ones it is weighted for.
  const lvl = boundLevel(mesh);
  if (!lvl) return;
  const v = lvl.getVertices();
  if (v.length < mesh._skinSrc.length) return;
  mesh._skinSrc.set(v.subarray(0, mesh._skinSrc.length));
  mesh._skinDirty = true; // the rest pose changed, so re-skin even if no joint moved
  // The mush deltas are DEFINED against that rest pose, so they are stale too. Rebuilt
  // lazily on the next skin pass rather than here: a blendshape being scrubbed fires this
  // every frame, and only the frames that actually deform need the rebuild.
  mesh._skinMushDirty = true;
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
//
// THE BOUND LEVEL IS A REFERENCE, NOT AN INDEX. An index into `_meshes` is only stable until
// something reorders the list, and several ordinary commands do: Reverse inserts a new level
// BELOW, shifting every existing level up one, and Delete Lower splices levels off the bottom.
// Undo and redo shuffle them back again, in two places that write `_meshes` directly rather
// than going through Multimesh. A stored index would have to be patched at every one of those
// sites, and the failure when one was missed is a weight map silently addressing the WRONG
// resolution. Holding the mesh itself and re-deriving the index makes all of them correct for
// free, and turns "the bound level was deleted" into something detectable (indexOf === -1)
// rather than something that quietly resolves to a different level.
function boundLevel(mesh) {
  const stack = mesh._meshes;
  if (!stack || !stack.length) return mesh;
  const ref = mesh._skinLevelMesh;
  if (ref) {
    const i = stack.indexOf(ref);
    if (i < 0) return null; // the level the weights belong to is gone
    mesh._skinLevel = i;    // keep the index in step for anything still reading it
    return ref;
  }
  const lvl = mesh._skinLevel || 0;
  return stack[Math.min(lvl, stack.length - 1)] || mesh;
}

// Warn once per mesh when the bound level has been deleted out from under the weights, and
// refuse to deform. Refusing is disappointing; deforming against the wrong resolution writes
// garbage over a sculpt, which is not recoverable.
function boundLevelGone(mesh) {
  if (!mesh._skinLevelWarned) {
    mesh._skinLevelWarned = true;
    console.warn('[Skinning] the level this mesh was bound at no longer exists; rebind to pose it');
    if (window.screenLog) window.screenLog('Bones: bound level deleted - rebind to pose', '#f38ba8');
  }
  return null;
}

// Push a change at the bound level up through the stack to the level being displayed. This is
// the existing multires propagation — partial subdivision of the level below, then each higher
// vertex's stored detail re-applied in its local frame — so sculpted detail rides along on top
// of the posed cage rather than being flattened by it.
function synthesiseUp(mesh) {
  const stack = mesh._meshes;
  if (!stack || !stack.length) return false;
  const level = boundLevel(mesh);
  if (!level) return false;
  const from = stack.indexOf(level);
  const to = mesh._sel || 0;
  if (from < 0) return false;
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
  if (!level) return boundLevelGone(mesh) || false;
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

  // Delta mush LAST, over the finished LBS result. It is a post-process on positions, so it
  // has to see the deformation the weights produced — running it before, or folding it into
  // the weights, would be a different (and much worse) algorithm.
  applyMush(mesh, level, out, nbV);

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
