import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';

// FINGER CAPTURE: tracked hands (WebXR hand input) retargeted onto a rig's fingers.
//
// THE RIG IS FOUND BY NAME: `<finger>_01..04<side>` for thumb, index, middle, ring and pinky,
// which is what RigTopology.addHand builds (a hand drawn by hand and named the same works too).
// The user's LEFT hand drives `_L`, the right `_R`.
//
// SWING ONLY, RELATIVE TO THE HAND. For each rig finger joint, the bone to its child is turned to
// point the way the matching tracked bone points, both measured in their own hand's frame (wrist,
// middle knuckle, index and pinky knuckles). So:
//   - the rig keeps its own proportions; only directions come from the performer;
//   - the wrist itself is not touched (that is the Perf Hand null and the arm's pins), so the
//     fingers are right whatever the wrist is doing;
//   - no twist is taken, so there is no joint-axis convention to agree on and no per-rig
//     calibration. Fingers barely twist; the thumb's roll is the one thing given up.
// Every rotation is written as an extra turn on the joint's REST local matrix, so a capture is
// the same whatever pose the fingers were in before it.

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// WebXR joint at each rig joint, knuckle by knuckle (rig _01 .. _04).
const XR = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};
const XR_NAMES = ['wrist'].concat(...FINGERS.map((f) => XR[f]));

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _qj = new THREE.Quaternion();
const _qi = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mr = new THREE.Matrix4(), _M = new THREE.Matrix3();
const _B1 = new THREE.Matrix4(), _B2 = new THREE.Matrix4();

// Orthonormal hand frame from wrist W, middle knuckle M, index knuckle I, pinky knuckle K.
function handBasis(W, M, I, K, out) {
  _a.subVectors(M, W).normalize();
  _b.subVectors(I, K);
  _b.addScaledVector(_a, -_b.dot(_a)).normalize();
  _c.crossVectors(_a, _b);
  return out.makeBasis(_a, _b, _c);
}

const restLocal = (j) => j._ikRest || j.getMatrix();
// Model-space rest matrix, through the rest of every ancestor.
function restWorld(j, out) {
  out.fromArray(restLocal(j));
  for (let p = j._parentMesh; p; p = p._parentMesh) out.premultiply(_m.fromArray(restLocal(p)));
  return out;
}

const HandCapture = {
  FINGERS, XR, XR_NAMES,

  // The rig hand for a side ('_L' / '_R'): { wrist, chains: { thumb: [j1..j4], ... } }, or null.
  // All twenty joints, or it is not a hand we can drive.
  rigHand(main, side) {
    const by = new Map();
    for (const m of main.getMeshes()) if (Skeleton.isJoint(m)) by.set(m._permanentStaticLabel, m);
    const chains = {};
    for (const f of FINGERS) {
      const c = [1, 2, 3, 4].map((k) => by.get(f + '_0' + k + side));
      if (c.some((j) => !j)) return null;
      chains[f] = c;
    }
    // The four fingers share one parent: the wrist, or (Add Hand) a palm joint -- through their own
    // metacarpal (`<finger>_00`, the template hand) when they have one. The thumb hangs off that or
    // the joint above it, and that is the wrist the hand frame is measured from.
    const up = (j) => {
      const p = j._parentMesh;
      return p && p._permanentStaticLabel === j._permanentStaticLabel.replace(/_01(.*)$/, '_00$1') ? p._parentMesh : p;
    };
    const palm = up(chains.index[0]);
    if (!palm || ['middle', 'ring', 'pinky'].some((f) => up(chains[f][0]) !== palm)) return null;
    const wrist = chains.thumb[0]._parentMesh;
    if (wrist !== palm && wrist !== palm._parentMesh) return null;
    return { wrist, chains, side };
  },

  rigHands(main) {
    return { left: this.rigHand(main, '_L'), right: this.rigHand(main, '_R') };
  },

  // Every rig finger joint (not the tips' children; the tips are never turned, but recording them
  // is harmless and keeps the set simple), for adding to a take.
  joints(hand) {
    return hand ? FINGERS.flatMap((f) => hand.chains[f].slice(0, 3)) : [];
  },

  // Tracked joint positions for one XRHand this frame, keyed by WebXR name; null unless all 25.
  readXR(frame, ref, xrHand) {
    if (!frame?.getJointPose || !xrHand) return null;
    const out = {};
    for (const n of XR_NAMES) {
      const j = xrHand.get(n), jp = j && frame.getJointPose(j, ref);
      if (!jp) return null;
      const p = jp.transform.position;
      out[n] = new THREE.Vector3(p.x, p.y, p.z);
    }
    return out;
  },

  // Turn the rig hand's fingers to match tracked positions `xr` (from readXR).
  drive(hand, xr) {
    if (!hand || !xr) return false;
    const c = hand.chains;
    // Rig hand frame at rest, model space.
    const Wr = restWorld(hand.wrist, new THREE.Matrix4());
    const pos = (j) => new THREE.Vector3().setFromMatrixPosition(restWorld(j, _B2));
    handBasis(new THREE.Vector3().setFromMatrixPosition(Wr), pos(c.middle[0]), pos(c.index[0]),
      pos(c.pinky[0]), _B1);
    handBasis(xr.wrist, xr[XR.middle[0]], xr[XR.index[0]], xr[XR.pinky[0]], _B2);
    // Tracked direction -> rig model direction: rig basis * inverse(tracked basis).
    _mr.copy(_B1).multiply(_B2.transpose());
    _M.setFromMatrix4(_mr);

    for (const f of FINGERS) {
      const chain = c[f], names = XR[f];
      // world (model) of the joint's parent, as rewritten so far; the palm is never turned
      const parentW = restWorld(chain[0]._parentMesh, new THREE.Matrix4());
      for (let k = 0; k < 3; k++) {
        const j = chain[k], child = chain[k + 1];
        const L = new THREE.Matrix4().fromArray(restLocal(j));
        const Wj = parentW.clone().multiply(L);
        // Where the rig bone points now (through the rewritten parents), and where it should.
        _a.setFromMatrixPosition(_m.fromArray(restLocal(child))).transformDirection(Wj);
        _t.subVectors(xr[names[k + 1]], xr[names[k]]).applyMatrix3(_M).normalize();
        if (!(_a.lengthSq() > 0) || !(_t.lengthSq() > 0)) { parentW.copy(Wj); continue; }
        _q.setFromUnitVectors(_a, _t);
        // As an extra turn in the joint's own frame: inv(Qj) * q * Qj, applied after rest.
        Wj.decompose(_p, _qj, _s);
        _qi.copy(_qj).invert().multiply(_q).multiply(_qj);
        L.multiply(_m.makeRotationFromQuaternion(_qi));
        mat4.copy(j.getMatrix(), L.elements);
        Skeleton.syncThree(j);
        parentW.multiply(L);
      }
    }
    return true;
  },
};

window._handCapture = HandCapture;
export default HandCapture;
