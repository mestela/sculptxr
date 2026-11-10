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
const META = new Set(['index', 'middle', 'ring', 'pinky'].flatMap((f) => [f + '_00', f + '_01']));

// THE PALM SLAB. Four metacarpal volumes side by side were four narrow things to edit for one
// palm; Add Hand hangs a `palm` bone off the wrist instead (wrist to the middle of the knuckle
// line) whose one flat volume IS the palm, and the metacarpals get Shapes Skin off. Its section
// starts as the template palm's own, measured here in template space (half width a0 across the
// knuckles, half thickness b0), so an unedited slab changes nothing.
HandFit.PALM = (() => {
  const T = HandTemplate, kn = ['index_01', 'middle_01', 'ring_01', 'pinky_01'].map(tplPos);
  const pos = kn.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(kn.length);
  const W = tplPos('wrist'), d = pos.clone().sub(W), L = d.length();
  d.divideScalar(L);
  const across = kn[0].clone().sub(kn[3]);
  across.addScaledVector(d, -across.dot(d)).normalize();
  const n = new THREE.Vector3().crossVectors(d, across);
  let a0 = 0, b0 = 0;
  const band = [];
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  const segs = T.joints.filter((t) => t.p >= 0).map((t) => ({ meta: META.has(t.n), r: t.r,
    A: new THREE.Vector3().fromArray(T.joints[t.p].pos), B: new THREE.Vector3().fromArray(t.pos) }));
  const nearestIsMeta = (p) => {
    let best = Infinity, meta = false;
    for (const s of segs) {
      const ab = q.subVectors(s.B, s.A), l2 = ab.lengthSq();
      const t = l2 > 0 ? Math.max(0, Math.min(1, p.clone().sub(s.A).dot(ab) / l2)) : 0;
      const dist = s.A.clone().addScaledVector(ab, t).distanceTo(p) / s.r;
      if (dist < best) { best = dist; meta = s.meta; }
    }
    return meta;
  };
  for (let i = 0; i < T.verts.length / 3; i++) {
    v.fromArray(T.verts, 3 * i);
    if (!nearestIsMeta(v)) continue;    // the palm, not the thumb beside it
    v.sub(W);
    const t = v.dot(d) / L;
    if (t < 0.4 || t > 0.85) continue;  // clear of the wrist and the knuckles
    band.push(i);
    a0 = Math.max(a0, Math.abs(v.dot(across)));
    b0 = Math.max(b0, Math.abs(v.dot(n)));
  }
  return { pos: pos.toArray(), a0, b0, band };
})();

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
  // The palm slab, when the hand has one (hands added before it did not).
  const palm = named.get('palm' + side);
  if (palm && palm._parentMesh === wrist) by.set('palm', palm);
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
  // Its SCALE from the thumb's and fingers' bones, not wrist-to-knuckle: a short palm shrank the
  // whole template four-fold for every bone to stretch back. The metacarpals (the palm) are left out,
  // so the palm's length is the palm's alone.
  let tLen = 0, rLen = 0;
  for (const t of T.joints) {
    if (t.p < 0 || META.has(t.n) || META.has(T.joints[t.p].n)) continue;
    tLen += new THREE.Vector3().fromArray(t.pos).distanceTo(new THREE.Vector3().fromArray(T.joints[t.p].pos));
    rLen += rp(t.n).distanceTo(rp(T.joints[t.p].n));
  }
  const k = tLen > 1e-9 ? rLen / tLen : rW.distanceTo(rM) / Math.max(tW.distanceTo(tM), 1e-9);
  const R = basis(rW, rM, rI, rK).multiply(basis(tW, tM, tI, tK).transpose());
  const G = (v, out) => out.copy(refl(v)).sub(tW).applyMatrix4(R).multiplyScalar(k).add(rW);

  // THE METACARPAL ROOTS (`<finger>_00`) ARE TAKEN FROM THE KNUCKLES, not read: they hide inside the
  // palm with Shapes Skin off, nobody moves them, and a knuckle pulled in past one reversed that
  // metacarpal and turned the palm inside out. Each sits its template fraction of the way from wrist
  // to knuckle, plus its template offset off that line -- exactly where Add Hand put it, until the
  // knuckle moves.
  const at = (n) => {
    const m = /^(index|middle|ring|pinky)_00$/.exec(n);
    if (!m) return rp(n);
    const t0 = tplPos(n), t1 = tplPos(m[1] + '_01'), tw = tplPos('wrist');
    const a = t1.clone().sub(tw), f = t0.clone().sub(tw).dot(a) / Math.max(a.lengthSq(), 1e-18);
    const perp = refl(t0.clone().sub(tw).addScaledVector(a, -f)).applyMatrix4(R).multiplyScalar(k);
    return rW.clone().lerp(rp(m[1] + '_01'), f).add(perp);
  };

  // ...then each bone, from where G put it to where the rig has it.
  const bones = [];
  for (const t of T.joints) {
    if (t.p < 0) continue;
    const pn = T.joints[t.p].n;
    const A = G(new THREE.Vector3().fromArray(T.joints[t.p].pos), new THREE.Vector3());
    const B = G(new THREE.Vector3().fromArray(t.pos), new THREE.Vector3());
    const A2 = at(pn), B2 = at(t.n);
    const L = A.distanceTo(B), L2 = A2.distanceTo(B2);
    if (!(L > 1e-9) || !(L2 > 1e-9)) continue;
    const d = B.clone().sub(A).divideScalar(L), d2 = B2.clone().sub(A2).divideScalar(L2);
    const r = Math.max(t.r * k, 1e-9);
    const end = hand.by.get(t.n);
    const rr = end._boneRadius > 0 ? end._boneRadius : r;
    // THE BONE'S VOLUME SHAPES ITS PART OF THE HAND: width and height stretch the section along the
    // volume's own axes (twist turns those axes), and an offset slides it, as they do the volume.
    const fr = Skeleton.volumeFrame(main, end);
    const vol = (fr.W !== 1 || fr.H !== 1 || fr.o1 || fr.o3)
      ? { e1: fr.e1.clone(), e3: fr.e3.clone(), W: fr.W, H: fr.H, off: fr.e1.clone().multiplyScalar(fr.o1 * rr).addScaledVector(fr.e3, fr.o3 * rr) }
      : null;
    bones.push({ A, d, L, A2, d2, L2, r, s: rr / r, vol, meta: META.has(t.n), q: new THREE.Quaternion().setFromUnitVectors(d, d2) });
  }

  // THE SLAB, as edited, against the template palm it started as: a vertex's offset from the palm
  // axis, in template half-extents across and through the palm, is laid out again on the slab's
  // section (width and height along the volume's own axes, so twist turns it; offset slides it).
  // Each axis is taken the way round that faces the other, which keeps a mirrored hand mirrored.
  const pj = hand.by.get('palm');
  let slab = null;
  if (pj) {
    const P = rp('wrist'), d = rp('palm').sub(P);
    if (d.lengthSq() > 1e-18) {
      d.normalize();
      const fr = Skeleton.volumeFrame(main, pj);
      const across = rp('index_01').sub(rp('pinky_01'));
      across.addScaledVector(d, -across.dot(d)).normalize();
      const n = new THREE.Vector3().crossVectors(d, across);
      if (across.dot(fr.e1) < 0) across.negate();
      if (n.dot(fr.e3) < 0) n.negate();
      const r = fr.r > 0 ? fr.r : HandFit.PALM.b0 * k;
      slab = { P, d, across, n, a0: HandFit.PALM.a0 * k, b0: HandFit.PALM.b0 * k,
        A1: fr.e1.clone().multiplyScalar(r * fr.W), A3: fr.e3.clone().multiplyScalar(r * fr.H),
        off: fr.e1.clone().multiplyScalar(fr.o1 * r).addScaledVector(fr.e3, fr.o3 * r) };
    }
  }

  const verts = new Float32Array(nv * 3), wmetaOf = new Float32Array(nv);
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
    let wsum = 0, wmeta = 0;
    acc.set(0, 0, 0);
    for (let n = 0; n < Math.min(KEEP, near.length); n++) {
      const { b, t, w } = near[n];
      if (b.meta) wmeta += w;
      o.copy(v).sub(b.A).addScaledVector(b.d, -t * b.L);      // offset from the bone point
      const along = o.dot(b.d);                               // only past an end
      o.addScaledVector(b.d, -along).multiplyScalar(b.s).addScaledVector(b.d, along).applyQuaternion(b.q);
      if (b.vol) {
        const x = o.dot(b.vol.e1), z = o.dot(b.vol.e3);
        o.addScaledVector(b.vol.e1, x * (b.vol.W - 1)).addScaledVector(b.vol.e3, z * (b.vol.H - 1)).add(b.vol.off);
      }
      one.copy(b.A2).addScaledVector(b.d2, t * b.L2).add(o);
      acc.addScaledVector(one, w);
      wsum += w;
    }
    acc.divideScalar(wsum);
    wmetaOf[i] = wmeta / wsum;
    verts[3 * i] = acc.x; verts[3 * i + 1] = acc.y; verts[3 * i + 2] = acc.z;
  }

  if (slab) {
    // THE PALM THE BONES MADE, measured on the vertices HandFit.PALM was measured on: that, not the
    // template scaled by k, is what the slab replaces. k comes from wrist-to-knuckle, so a short
    // palm shrank the reference while the slab kept its size, and the palm blew up by the inverse.
    let a0 = 0, b0 = 0;
    for (const i of HandFit.PALM.band) {
      o.fromArray(verts, 3 * i).sub(slab.P);
      a0 = Math.max(a0, Math.abs(o.dot(slab.across)));
      b0 = Math.max(b0, Math.abs(o.dot(slab.n)));
    }
    a0 = a0 || slab.a0; b0 = b0 || slab.b0;
    for (let i = 0; i < nv; i++) {
      if (!(wmetaOf[i] > 0)) continue;
      // The palm's share of this vertex (its weight on the metacarpals) follows the slab.
      acc.fromArray(verts, 3 * i);
      o.subVectors(acc, slab.P);
      const u = o.dot(slab.across) / a0, w3 = o.dot(slab.n) / b0, al = o.dot(slab.d);
      one.copy(slab.P).addScaledVector(slab.d, al).addScaledVector(slab.A1, u).addScaledVector(slab.A3, w3).add(slab.off);
      acc.lerp(one, wmetaOf[i]);
      verts[3 * i] = acc.x; verts[3 * i + 1] = acc.y; verts[3 * i + 2] = acc.z;
    }
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
