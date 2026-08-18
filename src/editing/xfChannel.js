import * as THREE from 'three';

// WHICH transform the graph editor is showing: translate, rotate or scale.
//
// The graph editor has three channel rows meaning X/Y/Z of whichever group is chosen, so the
// row count and every hit-test stay as they were and only the numbers behind them change.
//
// THIS LIVES IN ITS OWN MODULE BECAUSE THE EDIT PATH SPANS THREE FILES. The curve is drawn and
// hit-tested in GuiTimeline, the marquee and the transform box are in TimelineHelper, and the
// drag itself lands in AnimationRegistry.moveSelectedKeysValue. Keeping the accessors private
// to the GUI meant the drag wrote `positions` whatever group was on show — so dragging a
// rotation key vertically translated the object, which is precisely the bug that produced this
// module. Anything editing a keyed transform BY CHANNEL goes through here.
//
// Playback is deliberately NOT a caller. Interpolation reads the quaternion and slerps it; that
// has nothing to do with which group the user happens to be looking at.
//
// Rotation is stored as a QUATERNION and presented here as XYZ Euler degrees, converted on read
// and back on write. That makes rotation curves visible and editable, but it cannot express
// more than a single turn: a quaternion has no winding, so a key at 3600 degrees is a key at 0.
// Multi-turn needs rotation STORED as Euler with a turn count — a change to the track format
// and to playback, not to this file.

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function xfGroup() {
  const g = window._animXfGroup;
  return g === 'rot' || g === 'scale' ? g : 'pos';
}

export function xfRead(tr, index, channel) {
  if (!tr) return undefined;
  const g = xfGroup();
  if (g === 'scale') return tr.scales?.[index * 3 + channel];
  if (g !== 'rot') return tr.positions?.[index * 3 + channel];
  const q = tr.quaternions;
  if (!q || q.length < index * 4 + 4) return undefined;
  _q.set(q[index * 4], q[index * 4 + 1], q[index * 4 + 2], q[index * 4 + 3]);
  _e.setFromQuaternion(_q, 'XYZ');
  return [_e.x, _e.y, _e.z][channel] * 180 / Math.PI;
}

export function xfWrite(tr, index, channel, v) {
  if (!tr) return;
  const g = xfGroup();
  if (g === 'scale') { if (tr.scales) tr.scales[index * 3 + channel] = v; return; }
  if (g !== 'rot') { if (tr.positions) tr.positions[index * 3 + channel] = v; return; }
  const q = tr.quaternions;
  if (!q || q.length < index * 4 + 4) return;
  // Round-trip the whole rotation: change one Euler channel, leave the other two as they read
  // back. Writing a single channel into a quaternion is not otherwise well defined.
  _q.set(q[index * 4], q[index * 4 + 1], q[index * 4 + 2], q[index * 4 + 3]);
  _e.setFromQuaternion(_q, 'XYZ');
  const e = [_e.x, _e.y, _e.z];
  e[channel] = v * Math.PI / 180;
  _e.set(e[0], e[1], e[2], 'XYZ');
  _q.setFromEuler(_e);
  q[index * 4] = _q.x; q[index * 4 + 1] = _q.y;
  q[index * 4 + 2] = _q.z; q[index * 4 + 3] = _q.w;
}
