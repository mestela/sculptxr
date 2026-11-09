// FITTING THE HAND TEMPLATE TO A RIG.
//
// Add Hand places HandTemplate's joints on a wrist; Make Skin then needs the template's MESH on
// whatever those joints have become -- moved, lengthened, spread, fattened. The fit is the same
// idea as skinning, run on the rest pose: every template vertex rides the bones near it, each
// bone taking it from where the template had that bone to where the rig has it. Along the bone
// a vertex keeps its fraction; across it, its offset turns with the bone and scales by the
// bone's radius over the template's, so a fatter volume makes a fatter finger.
//
// A FRESH ADD HAND FITS TO THE TEMPLATE EXACTLY: the rig's joints are the template's under one
// similarity (handPoints), and the hand frame below is measured the same way on both, so every
// bone maps onto itself and the mesh comes out as modelled.
import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import HandTemplate from './HandTemplate.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// How sharply a vertex prefers its nearest bone (distance in that bone's radii, to this power).
const FALLOFF = 4;
const KEEP = 3;

const HandFit = {};

// The hand's frame from the direction it points: f toward the thumb (the character's front, square
// to the hand; up when the hand points straight forward), p out of the palm. A hanging left hand
// faces -X, the right +X, and a T-posed hand faces down on either side.
HandFit.handFrame = function (a, side) {
  const f = new THREE.Vector3(0, 0, 1).addScaledVector(a, -a.z);
  if (f.lengthSq() < 0.04) f.set(0, 1, 0).addScaledVector(a, -a.y);
  f.normalize();
  const p = new THREE.Vector3().crossVectors(a, f).multiplyScalar(side === '_R' ? -1 : 1);
  return { f, p };
};

// A template point into the rig: x along the hand, z toward the thumb, -y out of the palm.
HandFit.toRig = function (t, W, a, f, p, k, out) {
  return out.copy(W).addScaledVector(a, t[0] * k).addScaledVector(f, t[2] * k).addScaledVector(p, -t[1] * k);
};

const tplIndex = new Map(HandTemplate.joints.map((j, i) => [j.n, i]));
const tplPos = (n) => new THREE.Vector3().fromArray(HandTemplate.joints[tplIndex.get(n)].pos);

// A template hand on this wrist: its children carry thumb_01 and the four metacarpals. Returns the
// side suffix and the rig joints by template name, or null.
HandFit.handAt = function (main, wrist) {
  const kids = Skeleton.childJoints(main, wrist).filter((k) => Skeleton.isJoint(k));
  const m = kids.map((k) => /^thumb_01(.*)$/.exec(k._permanentStaticLabel || '')).find(Boolean);
  if (!m) return null;
  const side = m[1];
  const named = new Map();
  for (const j of Skeleton.joints(main)) named.set(j._permanentStaticLabel || '', j);
  const by = new Map();
  for (const t of HandTemplate.joints) {
    if (t.n === 'wrist') continue;
    const j = named.get(t.n + side);
    if (!j) return null;
    by.set(t.n, j);
  }
  // ...hung as the template hangs them, so a stray joint of the same name is not taken.
  for (const t of HandTemplate.joints) {
    if (t.n === 'wrist') continue;
    const want = t.p >= 0 && HandTemplate.joints[t.p].n !== 'wrist' ? by.get(HandTemplate.joints[t.p].n) : wrist;
    if (by.get(t.n)._parentMesh !== want) return null;
  }
  by.set('wrist', wrist);
  return { side, by, wrist };
};

// Every joint under a template hand's wrist (not the wrist), for Make Skin to leave out.
HandFit.handJoints = function (main, hand) {
  const out = new Set();
  for (const j of hand.by.values()) if (j !== hand.wrist) out.add(j);
  return out;
};

// Orthonormal basis from wrist W, middle knuckle M, index knuckle I, pinky knuckle K.
function basis(W, M, I, K) {
  const a = new THREE.Vector3().subVectors(M, W).normalize();
  const b = new THREE.Vector3().subVectors(I, K);
  b.addScaledVector(a, -b.dot(a)).normalize();
  const c = new THREE.Vector3().crossVectors(a, b);
  return new THREE.Matrix4().makeBasis(a, b, c);
}
// Which way round a hand is: the thumb's knuckle is on the palm side of the (along x across) plane.
function chirality(W, M, I, K, T) {
  return Math.sign(new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(M, W), new THREE.Vector3().subVectors(I, K))
    .dot(new THREE.Vector3().subVectors(T, W))) || 1;
}

// The template mesh fitted to a hand found by handAt, in model space:
// { verts: Float32Array, faces: Uint32Array (quads), loop: [16 indices] }.
HandFit.fit = function (main, hand) {
  const rp = (n) => Skeleton.jointPos(hand.by.get(n));
  const T = HandTemplate;
  const nv = T.verts.length / 3;

  // A LEFT template on a right hand is mirrored first (z, the thumb's axis), faces turned round.
  const keys = ['wrist', 'middle_01', 'index_01', 'pinky_01', 'thumb_02'];
  const [tW, tM, tI, tK, tT] = keys.map(tplPos);
  const [rW, rM, rI, rK, rT] = keys.map(rp);
  const mirror = chirality(tW, tM, tI, tK, tT) !== chirality(rW, rM, rI, rK, rT);
  const refl = (v) => (mirror ? v.set(v.x, v.y, -v.z) : v);
  [tW, tM, tI, tK, tT].forEach(refl);

  // ONE SIMILARITY for the whole hand, wrist on wrist and knuckle line on knuckle line...
  const k = rW.distanceTo(rM) / Math.max(tW.distanceTo(tM), 1e-9);
  const R = basis(rW, rM, rI, rK).multiply(basis(tW, tM, tI, tK).transpose());
  const G = (v, out) => out.copy(refl(v)).sub(tW).applyMatrix4(R).multiplyScalar(k).add(rW);

  // ...then each bone, from where G put it to where the rig has it.
  const bones = [];
  for (const t of T.joints) {
    if (t.p < 0) continue;
    const pn = T.joints[t.p].n;
    const A = G(new THREE.Vector3().fromArray(T.joints[t.p].pos), new THREE.Vector3());
    const B = G(new THREE.Vector3().fromArray(t.pos), new THREE.Vector3());
    const A2 = rp(pn), B2 = rp(t.n);
    const L = A.distanceTo(B), L2 = A2.distanceTo(B2);
    if (!(L > 1e-9) || !(L2 > 1e-9)) continue;
    const d = B.clone().sub(A).divideScalar(L), d2 = B2.clone().sub(A2).divideScalar(L2);
    const r = Math.max(t.r * k, 1e-9);
    const rr = hand.by.get(t.n)._boneRadius > 0 ? hand.by.get(t.n)._boneRadius : r;
    bones.push({ A, d, L, A2, d2, L2, r, s: rr / r, q: new THREE.Quaternion().setFromUnitVectors(d, d2) });
  }

  const verts = new Float32Array(nv * 3);
  const v = new THREE.Vector3(), o = new THREE.Vector3(), acc = new THREE.Vector3(), one = new THREE.Vector3();
  const near = [];
  for (let i = 0; i < nv; i++) {
    G(v.fromArray(T.verts, 3 * i), v);
    near.length = 0;
    for (const b of bones) {
      const t = Math.max(0, Math.min(1, o.subVectors(v, b.A).dot(b.d) / b.L));
      const dist = o.copy(b.A).addScaledVector(b.d, t * b.L).distanceTo(v) / b.r;
      near.push({ b, t, w: 1 / Math.pow(dist + 0.25, FALLOFF) });
    }
    near.sort((x, y) => y.w - x.w);
    let wsum = 0;
    acc.set(0, 0, 0);
    for (let n = 0; n < Math.min(KEEP, near.length); n++) {
      const { b, t, w } = near[n];
      o.copy(v).sub(b.A).addScaledVector(b.d, -t * b.L);      // offset from the bone point
      const along = o.dot(b.d);                               // only past an end
      o.addScaledVector(b.d, -along).multiplyScalar(b.s).addScaledVector(b.d, along).applyQuaternion(b.q);
      one.copy(b.A2).addScaledVector(b.d2, t * b.L2).add(o);
      acc.addScaledVector(one, w);
      wsum += w;
    }
    acc.divideScalar(wsum);
    verts[3 * i] = acc.x; verts[3 * i + 1] = acc.y; verts[3 * i + 2] = acc.z;
  }

  const nf = T.faces.length / 4;
  const faces = new Uint32Array(nf * 4);
  for (let f = 0; f < nf; f++) {
    for (let c = 0; c < 4; c++) faces[4 * f + c] = T.faces[4 * f + (mirror ? 3 - c : c)];
  }
  return { verts, faces, loop: T.wristLoop.slice(), mirror };
};

HandFit.FINGERS = FINGERS;
export default HandFit;
