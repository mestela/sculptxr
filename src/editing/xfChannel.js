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


export const XF_GROUPS = ['pos', 'rot', 'scale', 'weight'];

// THE STRIP IS A FILTER, NOT A RADIO (matt 2026-09-01): "sometimes it would be good to see all
// the channels, or just translation and rotation, or just rotation and activation." So the
// visible set is a SET, and the single "active" group survives only as the one an edit lands on
// when the thing being edited does not say which group it belongs to.
export function xfVisible() {
  const v = window._animXfVisible;
  if (Array.isArray(v) && v.length) return v.filter((g) => XF_GROUPS.includes(g));
  // Nothing chosen yet: whatever the old single-group setting said, so an existing session and
  // an existing saved layout both open on the group they were last left on.
  return [xfGroup()];
}

export function xfIsVisible(g) { return xfVisible().indexOf(g) >= 0; }

// PER-CHANNEL VISIBILITY, PER GROUP. `_animChannelVisible` is one array of three flags, which
// was the whole truth while only one group could be on screen. With several visible it would
// hide X in rotation because you hid X in translation, so each group keeps its own trio --
// seeded from the old array, so a session that had hidden a channel keeps it hidden.
export function xfChanVisible(g, c) {
  const m = window._animXfChanVis;
  const row = m && m[g];
  if (row && row[c] !== undefined) return row[c] !== false;
  const legacy = window._animChannelVisible;
  return !legacy || legacy[c] !== false;
}

export function xfSetChanVisible(g, c, on) {
  const m = (window._animXfChanVis = window._animXfChanVis || {});
  if (!m[g]) m[g] = [true, true, true];
  m[g][c] = !!on;
}

// At least one has to stay on: a graph with every channel filtered out is a blank panel with no
// way back except guessing which button to press.
export function xfToggleVisible(g) {
  if (!XF_GROUPS.includes(g)) return;
  const cur = xfVisible();
  const at = cur.indexOf(g);
  let next;
  if (at < 0) next = XF_GROUPS.filter((x) => cur.indexOf(x) >= 0 || x === g);
  else if (cur.length === 1) return;         // refuse to empty it
  else next = cur.filter((x) => x !== g);
  window._animXfVisible = next;
  // The ACTIVE group -- where an untagged edit lands, and whose tangent namespace is used --
  // follows the most recent turn-on, and otherwise falls back to the first still visible.
  if (at < 0) window._animXfGroup = g;
  else if (window._animXfGroup === g) window._animXfGroup = next[0];
}

// The group an untagged edit belongs to. A key CARRIES its own group once it has been selected
// off a specific curve; this is only the fallback, and the reason it must exist is that with
// several groups drawn at once "the group" is otherwise an unanswerable question.
export function xfGroup() {
  const g = window._animXfGroup;
  return XF_GROUPS.includes(g) ? g : 'pos';
}

// TANGENT HANDLES ARE PER GROUP TOO, and were not until v3.20.197.
//
// The stored key was `trans_<index>_<side>_dv_<channel>` -- key and channel, no GROUP. So a
// handle dragged on a translation curve was read back as the tangent of the rotation and scale
// curves as well. `dv` is a VALUE-space number (-deltaY / zoomY), so used on another group it is
// not merely wrong, it is in the wrong UNITS: a third-of-a-unit translation tangent landing on a
// scale curve whose keys are all 1.0 throws the interpolation clean off the graph. matt: "the
// graph looks crazy, even though the actual keys are all the same."
export function xfTanPrefix(group) { return 'trans_' + (group || xfGroup()) + '_'; }

// Legacy files carry ungrouped `trans_` keys, authored while looking at some group -- almost
// always translate, which is the default and the only one most scenes ever had handles dragged
// in. They are read as the POS group's and nothing else's, so an old file keeps its translation
// tangents and stops leaking them into the other two.
export function xfTanGet(tr, suffix, group) {
  const to = tr && tr.tangentOffsets;
  if (!to) return undefined;
  const g = group || xfGroup();
  const v = to[xfTanPrefix(g) + suffix];
  if (v !== undefined) return v;
  return g === 'pos' ? to['trans_' + suffix] : undefined;
}

// `group` is explicit so a key can be read in ITS OWN group while several are on screen.
// Defaulted rather than required, because every existing caller means "the active one".
export function xfRead(tr, index, channel, group) {
  if (!tr) return undefined;
  const g = group || xfGroup();
  if (g === 'weight') return undefined;   // not a transform channel; see xfWeightTrack
  if (g === 'scale') return tr.scales?.[index * 3 + channel];
  if (g !== 'rot') return tr.positions?.[index * 3 + channel];
  const e = rotSync(tr);
  return e ? e[index * 3 + channel] : undefined;
}

export function xfWrite(tr, index, channel, v, group) {
  if (!tr) return;
  const g = group || xfGroup();
  if (g === 'weight') { xfWeightWrite(tr, index, v); return; }
  if (g === 'scale') { if (tr.scales) tr.scales[index * 3 + channel] = v; return; }
  if (g !== 'rot') { if (tr.positions) tr.positions[index * 3 + channel] = v; return; }
  rotSetEuler(tr, index, channel, v);
}

// ── WEIGHT, the one group that is not a transform ─────────────────────────────────────
//
// It lives in `scalarTracks` rather than in positions/quaternions/scales, has ONE channel
// instead of three, and its keys are its own -- they do not line up with the transform keys.
// Everything that draws or edits it therefore has to ask for it by name rather than by index
// into a shared array, which is why it gets its own two accessors instead of a branch inside
// the transform ones.
export const XF_WEIGHT_CHANNEL = 'pinWeight';

export function xfWeightTrack(tr) {
  return (tr && tr.scalarTracks && tr.scalarTracks.get(XF_WEIGHT_CHANNEL)) || null;
}

// WHICH TIMES ARRAY A KEY OF THIS GROUP LIVES ON. Every transform group shares `track.times`,
// so a key index means the same thing across T, R and S -- but the weight channel keeps its own
// times, and reading a weight key's time out of `track.times` gives whatever transform key
// happens to sit at that index. That is not a wrong number, it is an unrelated one.
export function xfTimes(tr, group) {
  if (!tr) return null;
  if (group === 'weight') {
    const st = xfWeightTrack(tr);
    return st ? st.times : null;
  }
  return tr.times || null;
}

export function xfWeightWrite(tr, index, v) {
  const st = xfWeightTrack(tr);
  if (!st || index < 0 || index >= st.values.length) return;
  st.values[index] = Math.min(1, Math.max(0, v));
}

// ---- rotation with winding -------------------------------------------------------
//
// A quaternion cannot hold more than one turn: key a wheel at 3600 degrees and it stores the
// same rotation as 0, so the spin is gone before any curve is drawn. Winding has to be stored
// separately, so a track may carry `eulers` — three degrees per key, unwrapped, and the
// authority for rotation whenever it is present and consistent.
//
// CONSISTENT MEANS LENGTH-MATCHED TO `times`. The registry splices keys in a dozen places and
// a missed one would leave rotation indexed against the wrong times — values silently attached
// to the wrong frames, which is far worse than losing winding. So every read goes through
// rotSync first: if the arrays disagree, `eulers` is rebuilt from the quaternions and the
// winding is lost, but the data is never wrong. A missed splice degrades; it does not corrupt.

const _rq = new THREE.Quaternion();
const _re = new THREE.Euler();
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

// Euler degrees for one key, straight off the quaternion — no winding, range (-180, 180].
export function eulerFromQuat(tr, i, out) {
  const q = tr.quaternions;
  out = out || [0, 0, 0];
  if (!q || q.length < i * 4 + 4) return out;
  _rq.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
  _re.setFromQuaternion(_rq, 'XYZ');
  out[0] = _re.x * R2D; out[1] = _re.y * R2D; out[2] = _re.z * R2D;
  return out;
}

// Nudge `v` by whole turns until it is the closest equivalent to `ref`. This is what makes a
// recorded spin accumulate instead of sawtoothing back at every half turn.
export function unwrapTo(ref, v) {
  return v + Math.round((ref - v) / 360) * 360;
}

// Rebuild `eulers` from the quaternions, unwrapped key to key so a continuous motion reads as
// continuous. Used when a track has no eulers yet, and as the repair when they fall out of step.
export function rotRebuild(tr) {
  const n = tr.times ? tr.times.length : 0;
  const out = new Array(n * 3).fill(0);
  const cur = [0, 0, 0];
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    eulerFromQuat(tr, i, cur);
    if (i === 0) { out[0] = cur[0]; out[1] = cur[1]; out[2] = cur[2]; continue; }

    // EVERY XYZ ORIENTATION HAS TWO EULER SPELLINGS: (x, y, z) and (x+180, 180−y, z+180).
    // `setFromQuaternion` always returns the one with |y| <= 90, so a limb turning steadily
    // past a quarter turn comes back as the OTHER spelling and the channel appears to reverse
    // — a steady spin of 170 degrees a key rebuilt as 0, 10, −20, 30. Unwrapping by whole
    // turns cannot repair that, because the flip is not a turn.
    //
    // So both spellings are unwrapped against the previous key and the nearer one wins, which
    // keeps a continuous motion continuous through the singularity. It is still a guess about
    // intent — an orientation genuinely does not remember how it was reached — but it is the
    // guess that matches what was recorded.
    for (let c = 0; c < 3; c++) {
      a[c] = unwrapTo(out[(i - 1) * 3 + c], cur[c]);
      b[c] = unwrapTo(out[(i - 1) * 3 + c], c === 1 ? 180 - cur[c] : cur[c] + 180);
    }
    let da = 0, db = 0;
    for (let c = 0; c < 3; c++) {
      da += Math.abs(a[c] - out[(i - 1) * 3 + c]);
      db += Math.abs(b[c] - out[(i - 1) * 3 + c]);
    }
    const pick = db < da ? b : a;
    out[i * 3] = pick[0]; out[i * 3 + 1] = pick[1]; out[i * 3 + 2] = pick[2];
  }
  tr.eulers = out;
  return out;
}

// The guarantee every reader depends on: `eulers` exists and is indexed against `times`.
export function rotSync(tr) {
  if (!tr || !tr.times) return null;
  const want = tr.times.length * 3;
  if (!tr.eulers || tr.eulers.length !== want) rotRebuild(tr);
  return tr.eulers;
}

// Write one Euler channel, in degrees, keeping the quaternion in step so everything that reads
// rotation the old way — playback fallback, export, the outliner fields — still works.
export function rotSetEuler(tr, i, channel, deg) {
  const e = rotSync(tr);
  if (!e || e.length < i * 3 + 3) return;
  e[i * 3 + channel] = deg;
  _re.set(e[i * 3] * D2R, e[i * 3 + 1] * D2R, e[i * 3 + 2] * D2R, 'XYZ');
  _rq.setFromEuler(_re);
  const q = tr.quaternions;
  if (q && q.length >= i * 4 + 4) {
    q[i * 4] = _rq.x; q[i * 4 + 1] = _rq.y; q[i * 4 + 2] = _rq.z; q[i * 4 + 3] = _rq.w;
  }
}
