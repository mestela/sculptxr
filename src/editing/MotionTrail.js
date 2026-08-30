import * as THREE from 'three';
import { VERSION } from '../Version.js';
// Fat lines, for the gnomons only. THREE.Line draws hardware 1px lines, which cannot be
// antialiased and step between whole pixels as the camera moves; LineSegments2 triangulates a
// screen-space width instead. Used here and not (yet) for the trail itself, so the approach can
// be judged on the small thing before the curve is committed to it.
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';
import MotionPathEdit from './MotionPathEdit.js';

// Motion trails: the world-space path a joint takes over the timeline, drawn in the viewport.
//
// THIS FEATURE WAS BLOCKED, and it is worth saying why rather than just building it. A trail is
// a promise that the joint will pass through those points on playback. Until v3.19.94 the solve
// seeded from whatever pose the rig was already in, so an IK-driven joint's position depended on
// the ROUTE taken to a frame rather than on the frame — and a trail built by stepping the
// playhead would have been a curve the playback did not follow. Drawing it then would have been
// worse than not drawing it: a confident wrong answer. Now that evaluation is deterministic, a
// sampled path IS the path, and this is a few dozen lines.
//
// The sampling runs the app's OWN evaluation — write the keyed joints, then hold the pins —
// rather than reimplementing interpolation. Anything else would be a second evaluator to keep
// in step with the first, and the two disagreeing is exactly the bug this feature exists to
// visualise.

// ALONG THE WHOLE RANGE. 48 was chosen to draw a smooth curve, and for drawing it is plenty —
// the curve is smooth even when the motion is not. But the EDITOR snaps a grab to the nearest
// sample, so the spacing is also the worst-case distance between where you click and where the
// edit takes hold. At 48 across a long path that is around half an inch on a 15" monitor, which
// is what matt reported as the selection feeling "heavily misaligned": it was not misaligned,
// it was quantised. Each sample costs one full rig evaluation on rebuild (not per frame — the
// trail rebuilds on its fingerprint), so this is a real cost, and `window._trailSamples`
// overrides it either way.
const SAMPLES = 128;
const TRAIL_ORDER = 9998;

function tune(key, dflt) {
  const v = window[key];
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const MotionTrail = {};

// The range to draw: the loop if one is set, otherwise the whole timeline.
function range() {
  const start = window._animLoopStart ?? 0;
  const end = window._animLoopEnd ?? window._animMasterDuration ?? 0;
  return end > start ? { start: start, end: end } : null;
}

// What to trail. The SELECTION, and only the selection: a trail per joint on a thirty-joint rig
// is a ball of wool, and the cost is a full evaluation per sample either way.
//
// A pin gets TWO curves, and the difference between them is the point.
//
//   control — the path you AUTHORED, sampled from the pin's own track. This is the curve that
//             is yours to edit; a pin is a free 6DOF control, so any shape is reachable.
//   output  — the path the JOINT actually takes, sampled from the solve. This is solver output,
//             constrained by bone lengths, and it is not directly editable.
//
// While IK reaches its target the two coincide and you see one curve. Where they separate, the
// gap IS the diagnosis: the control is asking for something the limb cannot do. That divergence
// is invisible today, because only the joint has ever been drawn.
//
// A pin with no track of its own has no authored path — just a stationary point — so only the
// output curve is drawn for it. Drawing a degenerate curve would be noise.
// THE TARGET STICKS. It used to be read straight off the live selection, which made the trail
// far too easy to lose: with a pin selected and Move active, a stroke that missed the curve by a
// few pixels fell through to an ordinary sculpt, that sculpt selected the MESH, and the trail
// you were in the middle of editing simply vanished. The edit was lost and so was the thing
// showing you what you were editing.
//
// So a rig node captures the trail when it is selected, and KEEPS it until another rig node
// takes it — selecting a mesh, or nothing, leaves the trail where it was. The target is dropped
// only when it leaves the scene, which is the one case where keeping it would be a lie.
//
// SELECT SEVERAL AND YOU SEE SEVERAL. The stickiness above is per-SET, not per-node: the whole
// selected set is captured together and held together. Holding them individually would let a
// set decay one node at a time as unrelated picks came and went, which is worse than either
// keeping all of it or dropping all of it.
//
// The CURRENT node is forced to the front, because the head of this list is the strand that
// gets the editable dots and gnomons. Whatever you touched last is what you are editing.
function trailTargets(main) {
  const inScene = (m) => (main.getMeshes() || []).indexOf(m) >= 0;
  const isRig = (m) => !!(m && (Skeleton.isJoint(m) || (m._isPinTarget && m._pinnedJoint)));
  const cur = main.getMesh && main.getMesh();
  const sel = (main.getSelectedMeshes && main.getSelectedMeshes()) || [];
  const picked = sel.filter(isRig);
  if (isRig(cur)) {
    const at = picked.indexOf(cur);
    if (at >= 0) picked.splice(at, 1);
    picked.unshift(cur);
  }
  if (picked.length) {
    main._trailTargets = picked;
    main._trailTarget = picked[0];   // what trailTrace() reports, and the editable strand
    return picked;
  }
  const held = (main._trailTargets || []).filter(inScene);
  main._trailTargets = held;
  main._trailTarget = held[0] || null;
  return held;
}

function trailed(main) {
  const targets = trailTargets(main);
  const sel = targets[0] || null;
  if (window._trailTrace) {
    console.log('[trail] target=' + (sel && sel._permanentStaticLabel) +
      ' isBone=' + !!(sel && sel._isBone) + ' isPin=' + !!(sel && sel._isPinTarget) +
      ' pinnedJoint=' + !!(sel && sel._pinnedJoint) +
      ' pinOnJoint=' + !!(sel && sel._boneIKPinObj) +
      ' selection=' + (main.getMesh && main.getMesh() && main.getMesh()._permanentStaticLabel));
  }
  const reg = window._animationRegistry;
  const keyed = (m) => !!(m && reg && reg.tracks && reg.tracks.get(m.getID()));
  // A JOINT AND THE PIN ON IT ARE ONE CONTROL POINT, so either one selected shows the same
  // pair of curves. The pin case was handled and the joint case was not, which made the trail
  // depend on WHICH of the two the pick happened to return — and the pick returns the joint
  // when you grab a pinned wrist in the viewport, while the dopesheet row is the pin. Same
  // wrist, same keys, and a trail from one route only. matt's report, exactly.
  //
  // The keys are on the PIN: the joint is driven by the solver and usually has no track of its
  // own, so reading only what was selected finds nothing to draw and draws nothing.
  // Each selected node contributes its own control/output pair, in selection order. Deduped
  // by object AND role: selecting a joint and the pin sitting on it names the same control
  // twice, and drawing that curve twice is invisible until it is edited twice as well.
  const out = [];
  const seen = new Set();
  const add = (obj, control) => {
    const k = obj.getID() + (control ? 'c' : 'o');
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ obj: obj, control: control });
  };
  for (const t of targets) {
    if (Skeleton.isJoint(t)) {
      const pin = t._boneIKPinObj;
      if (pin && pin._isPinTarget && keyed(pin)) add(pin, true);
      add(t, false);
    } else if (t._isPinTarget && t._pinnedJoint) {
      if (keyed(t)) add(t, true);
      add(t._pinnedJoint, false);
    }
  }
  return out;
}

// A cheap fingerprint of everything the curve depends on. Recomputed per frame and compared,
// rather than invalidated by callers: an invalidation hook has to be added to every path that
// can change a key, and the one that gets forgotten leaves a stale curve on screen that looks
// exactly like a correct one. Reading a few dozen key times per frame is nothing.
function trackSig(reg, obj, tag) {
  const t = reg.tracks.get(obj.getID());
  if (!t || !t.times || !t.times.length) return '';
  let acc = 0;
  for (let i = 0; i < t.times.length; i++) acc += t.times[i] * (i + 1);
  // VALUES, not just times. A key that MOVES without being retimed leaves the count and every
  // time identical, so a fingerprint built from times alone cannot see it — and the curve is a
  // drawing of exactly those values. This was invisible while keys only ever arrived by
  // recording; editing a motion path changes positions and nothing else, and an UNDO of that
  // edit changes them straight back, which is the case that made it obvious.
  let pacc = 0;
  const pos = t.positions || [];
  for (let i = 0; i < pos.length; i++) pacc += pos[i] * (i + 1);
  return tag + obj.getID() + ':' + t.times.length + ':' + acc.toFixed(4) + ':' + pacc.toFixed(4) + ';';
}

function signature(main, joints, r) {
  const reg = window._animationRegistry;
  let sig = joints.map((t) => (t.obj || t).getID() + (t.control ? 'c' : '')).join(',') + '|' + r.start + ',' + r.end + '|';
  if (!reg || !reg.tracks) return sig;
  for (const j of Skeleton.joints(main)) sig += trackSig(reg, j, '');
  // Pins move the answer as much as keys do — by being DRAGGED, which touches no track, and by
  // being KEYED, which is now the main way a rig is animated. Both have to be fingerprinted or
  // the curve goes stale in exactly the workflow it exists to serve.
  for (const j of IKSolver.pinnedJoints(main)) {
    const p = IKSolver.pinObject(j);
    if (!p) continue;
    // A KEYED pin's live matrix is DERIVED from its track, so during playback it changes every
    // frame while the curve it describes does not change at all. Hashing it made the
    // fingerprint differ on every frame of playback, which forced a full resample — and a
    // resample is a solve per sample, which is where ~1000 solves/s and half a second of every
    // second went. The track is the honest fingerprint for a keyed pin.
    //
    // An UNKEYED pin has no track, and its transform is the only thing that says where it is —
    // dragged with the gizmo, moved by undo, poked from the console. That one still gets
    // hashed, which is what the matrix was here for in the first place.
    const pk = trackSig(reg, p, 'pk');
    if (pk) {
      sig += pk;
    } else {
      const m = p.getMatrix();
      sig += 'p' + j.getID() + ':' + m[12].toFixed(4) + ',' + m[13].toFixed(4) + ',' + m[14].toFixed(4) + ';';
    }
  }
  return sig;
}

// Everything the sampler must write before holding the pins: keyed BONES and keyed PINS.
//
// A pin is an ordinary keyable mesh — "everything a pin needs in order to be transformable and
// keyable comes free from being an ordinary object" (IKSolver.makePinObject) — so it carries a
// track of its own, and keyed pins are now the main way a rig is animated. holdPins reads each
// pin's TRANSFORM, so a pin left unevaluated anchors every sample to wherever it happens to be
// sitting: the trail becomes a curve playback does not follow, which is the exact failure this
// file's header says the feature was blocked on until evaluation became deterministic.
//
// Real playback iterates every mesh in the scene (Scene.js), so it never had this bug. This is
// the same set narrowed to the rig, because a curve that only needs transforms should not drag
// every vertex snapshot in the scene through the sampler.
function animated(main, reg) {
  if (!reg || !reg.tracks) return [];
  const out = [];
  for (const j of Skeleton.joints(main)) {
    if (reg.tracks.get(j.getID())) out.push(j);
    const p = IKSolver.pinObject(j);
    if (p && reg.tracks.get(p.getID())) out.push(p);
  }
  return out;
}

// Put the rig at time `t` exactly as a scrub does: every keyed joint written, then the pins
// held. The registry names each bone it writes, so holdPins seeds from rest and the answer does
// not depend on the order the samples were taken in — which is the whole reason this works.
function evaluateAt(main, reg, joints, t) {
  reg.globalPlaybackTime = t;
  window._animCurrentTime = t;
  // Joints only. Running the whole scene would drag every shape track and vertex snapshot
  // through the sampler for a curve that only needs transforms.
  for (const j of joints) reg.update(j, true);
  IKSolver.holdPins(main);
}

// Sample the path of each trailed joint over the range.
// WHEN TO SAMPLE. Uniform fill, plus a sample on every KEY TIME of the trailed tracks.
//
// A uniform grid lands on a key only by luck, so the drawn curve is a chord across the pose the
// key actually holds: two close keys with a fast move between them read as a smooth arc rather
// than the snap they are. Putting a sample exactly on each key makes the curve pass through the
// poses that were authored — which is what the curve is a promise about.
//
// It also makes EDITING tractable later. Push-back has to answer "how far did the curve move at
// this key's time"; with a sample on the key that is a read, and without it an interpolation.
//
// Capped, because a track keyed on every frame of a long range would otherwise be a full solve
// per key. Keys win the cap: they are the times that carry the animation, and dropping uniform
// fill only costs smoothness between them.
const MAX_SAMPLES = 256;

function sampleTimes(reg, targets, r, n) {
  const times = [];
  for (let i = 0; i < n; i++) times.push(r.start + (r.end - r.start) * (i / (n - 1)));

  if (reg && reg.tracks) {
    for (const tg of targets) {
      const t = reg.tracks.get((tg.obj || tg).getID());
      if (!t || !t.times) continue;
      for (const kt of t.times) if (kt >= r.start && kt <= r.end) times.push(kt);
    }
  }

  times.sort((a, b) => a - b);
  // Dedupe against the frame grid rather than exactly: a key at 1/24 and a uniform sample a
  // ten-thousandth away are the same sample, and solving both is pure cost.
  const span = (r.end - r.start) || 1;
  const eps = span * 1e-6;
  const out = [];
  for (const t of times) if (!out.length || t - out[out.length - 1] > eps) out.push(t);

  if (out.length <= MAX_SAMPLES) return out;

  // Over the cap. Drop the uniform fill first, since it only buys smoothness between keys.
  const keys = new Set();
  if (reg && reg.tracks) {
    for (const tg of targets) {
      const t = reg.tracks.get((tg.obj || tg).getID());
      if (t && t.times) for (const kt of t.times) keys.add(kt);
    }
  }
  let kept = out.filter((t) => keys.has(t));

  // A track keyed on every frame blows the cap on keys ALONE, so key-exactness cannot be
  // absolute — thin them too. Nothing is lost that matters: a per-frame track has no sparse
  // structure to be exact about, and the curve is already dense wherever it is thinned.
  if (kept.length > MAX_SAMPLES) {
    const stride = Math.ceil(kept.length / MAX_SAMPLES);
    kept = kept.filter((_, i) => i % stride === 0);
  } else {
    const fill = out.filter((t) => !keys.has(t));
    const room = MAX_SAMPLES - kept.length;
    const stride = Math.ceil(fill.length / Math.max(1, room));
    for (let i = 0; i < fill.length; i += stride) kept.push(fill[i]);
  }

  // The curve must still SPAN the range whatever the thinning dropped, or it visibly stops
  // short of the ends it claims to cover.
  if (kept[0] !== out[0]) kept.push(out[0]);
  if (kept[kept.length - 1] !== out[out.length - 1]) kept.push(out[out.length - 1]);
  kept.sort((a, b) => a - b);
  return kept;
}

function samplePaths(main, targets) {
  const reg = window._animationRegistry;
  const r = range();
  if (!reg || !r) return null;
  const joints = animated(main, reg);
  if (!joints.length) return null;

  const n = Math.max(2, Math.round(tune('_trailSamples', SAMPLES)));
  const paths = targets.map(() => []);
  // Orientation is only collected for the AUTHORED curve: it is the only one that can be
  // edited, and a triad on every sample of a read-only curve is noise.
  const quats = targets.map((tg) => (tg.control ? [] : null));
  const wasT = reg.globalPlaybackTime || 0;
  const wasPlaying = window._animPlaying;
  // Suppress playback for the duration: update() advances globalPlaybackTime by wall-clock dt
  // when it is on, so the sampler would fight the clock for the playhead and every sample after
  // the first would be taken at the wrong time.
  window._animPlaying = false;

  const times = sampleTimes(reg, targets, r, n);
  // Kept for the editor: a sample is only meaningful with the time it was taken at, and
  // push-back has to ask "how far did the curve move at this key's time".
  main._trailTimes = times;

  try {
    for (const t of times) {
      evaluateAt(main, reg, joints, t);
      // A pin reads the same way a joint does — both are meshes, and the path is the
      // translation of the model-space matrix either way.
      targets.forEach((tg, k) => {
        const o = tg.obj || tg;
        paths[k].push(Skeleton.jointPos(o));
        // The ORIENTATION at the same instant, for the gnomons. Free here: the rig is already
        // posed at this time, and reading the rotation out of a track afterwards would be a
        // second evaluator to keep in step with this one.
        if (quats[k]) quats[k].push(sampleQuat(o));
      });
    }
  } finally {
    // Put the rig back on the frame the user is actually on, through the same path, so the
    // viewport is never left showing the last sample.
    evaluateAt(main, reg, joints, wasT);
    window._animPlaying = wasPlaying;
  }
  paths.quats = quats;
  return paths;
}

const _mQ = new THREE.Matrix4();
const _vQ = new THREE.Vector3();
const _sQ = new THREE.Vector3();

function sampleQuat(obj) {
  const q = new THREE.Quaternion();
  _mQ.fromArray(obj.getModelSpaceMatrix());
  _mQ.decompose(_vQ, q, _sQ);
  return q;
}

function disposeTrail(main) {
  const v = main._trailVis;
  if (!v) return;
  for (const o of [...(v.lines || []), v.dots, v.keyDots, v.hoverDot, v.gnomons]) {
    if (!o) continue;
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
  main._trailVis = null;
}

// One line per path. The AUTHORED curve is drawn solid; the SOLVED one is drawn faint, because
// it is a readout rather than something you can take hold of, and because the two coincide
// whenever the limb is reaching — a second curve at full strength would just thicken the first.
// NO ALPHA ANYWHERE. The authored and solved curves are told apart by VALUE, not opacity.
//
// Blending was also why the colours went pastel in the headset, and it was not the tone mapper:
// a 0.35-alpha red drawn over a light background IS a pale pink, because that is what blending
// does. Removing it puts the hue back at full strength for free.
const CONTROL_VALUE = 0.70;
const OUTPUT_VALUE = 0.40;

// TIME, READ AS COLOUR. Red behind the playhead, green ahead of it, each fading with distance.
// The point is loops: whether the end of a cycle comes back to where the start left is a
// question about two ENDS of the curve, and with one colour along the whole thing you have to
// hold both in your head. In red and green the answer is where the two shades meet.
//
// This takes the line's colour, so IDENTITY moves to the dots — which is the right way round,
// since the dots are what you aim at, and with several paths on screen the thing you need from
// a line at a glance is when, not which.
// FULLY SATURATED AT THE PLAYHEAD, FADING TO A MIDTONE GREY. The first attempt lerped toward
// black at both ends, which desaturates as it darkens: a dim red reads as orange and a dim green
// as lime, so the two shades stopped being distinguishable exactly where you need to tell them
// apart. Grey holds the value steady and lets only the SATURATION carry distance.
// HUE-SEPARATED FROM THE AXIS TRIADS. Red-and-green for time and red-and-green for X-and-Y
// were two unrelated meanings in the same two colours, sitting on top of each other. The trail
// is pushed one way round the wheel and the axes the other, so the pairs stop competing:
// the trail's past goes toward PURPLE and its future toward CYAN.
// A FIFTH of the shift that was there: enough to stop the two palettes reading as the same
// red and green, not enough to stop them reading as red and green at all.
const PAST_NEAR   = [0.99, 0.00, 0.09];
const FUTURE_NEAR = [0.00, 0.99, 0.11];
const FAR_GREY    = [0.46, 0.46, 0.46];
// A key sitting on the playhead is the one an edit lands on, so it is not on the scale at all.
const NOW_WHITE   = [1.00, 1.00, 1.00];
// The sample a click would take. Bright and distinctly warm, so it does not read as "this key
// is at the playhead" — the two marks mean different things and must not be confusable.
const HOVER_COL   = [1.00, 0.85, 0.15];
const HOVER_GROW  = 1.9;

function mix(a, b, k, out, i) {
  out[i]     = b[0] + (a[0] - b[0]) * k;
  out[i + 1] = b[1] + (a[1] - b[1]) * k;
  out[i + 2] = b[2] + (a[2] - b[2]) * k;
}

// The one ramp, so the line and the key dots cannot drift into two slightly different reds.
// `nowEps` is how close to the playhead counts as ON it; 0 for the line, which has a sample
// every few frames and would otherwise show a white speck wandering along it.
function timeColor(t, head, span, out, i, nowEps) {
  const d = (t - head) / span;
  if (nowEps > 0 && Math.abs(t - head) <= nowEps) {
    out[i] = NOW_WHITE[0]; out[i + 1] = NOW_WHITE[1]; out[i + 2] = NOW_WHITE[2];
    return;
  }
  const k = Math.max(0, 1 - Math.min(1, Math.abs(d)));
  mix(d < 0 ? PAST_NEAR : FUTURE_NEAR, FAR_GREY, k, out, i);
}

// Where the playhead is, in the same clock the samples were taken on.
function now(main) {
  const reg = window._animationRegistry;
  const t = reg && reg.globalPlaybackTime;
  return Number.isFinite(t) ? t : (window._animCurrentTime || 0);
}

// DOTS ON THE AUTHORED CURVE, because you cannot grab what you cannot see. A drag takes hold of
// the nearest SAMPLE, and with the samples invisible the curve appeared to move from a point
// other than the one under the cursor — which reads as the tool being misaligned rather than as
// the samples being sparse.
//
// This uses THREE.Points, which an earlier iteration was right to remove: at scene scale the
// DEFAULT PointsMaterial draws world-sized camera-facing squares, and they became a wall of red
// that hid both the curve and the model. The fix for that was sizeAttenuation, not banning the
// primitive — a point pinned to a few SCREEN pixels is a dot, and cannot swamp anything.
// Halved from the first attempt, which drew squares big enough to sit ON the curve rather than
// mark it. The ratio between them is kept: a key still reads as the larger mark.
const DOT_PX = 4;          // a sample: grabbable, small
const KEY_DOT_PX = 6;      // a sample that is also a KEY: where an edit can actually land
const DOT_ORDER = 9999;

// A sample sitting on a key time is worth showing differently: push-back moves KEYS, so those
// are the instants an edit can be recorded at. A wiggle sculpted between two of them has
// nothing to carry it.
function keyMask(main, pin, times) {
  const reg = window._animationRegistry;
  const track = reg && reg.tracks && reg.tracks.get(pin.getID());
  const out = new Array(times.length).fill(false);
  if (!track || !track.times) return out;
  const span = (times[times.length - 1] - times[0]) || 1;
  const eps = span * 1e-6;
  for (const kt of track.times) {
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(times[i] - kt) <= eps) { out[i] = true; break; }
    }
  }
  return out;
}

// A ROUND, SOFT-EDGED SPRITE instead of the raw square. A PointsMaterial with no map draws a
// hard-edged quad, and a hard-edged quad a few pixels across crawls and shimmers as it moves —
// every frame it lands on a different set of whole pixels and there is nothing to blend the
// step. A radial alpha ramp gives the edge something to resolve against, which is what stops
// the crawl; it also stops the marks reading as squares.
//
// Built once and shared: a texture per point cloud would be a texture per rebuild.
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  // Solid to about two thirds, then a soft shoulder — a pure gradient to the rim looks like a
  // smudge rather than a dot at these sizes.
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,1)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  _dotTex = new THREE.CanvasTexture(c);
  _dotTex.minFilter = THREE.LinearFilter;
  _dotTex.magFilter = THREE.LinearFilter;
  return _dotTex;
}

// RGB GNOMONS AT THE KEYS. Rotation has no path to draw — a quaternion is not a place — so the
// only way to see it is to plant an axis triad where a key is and let its orientation show.
//
// AT THE KEYS ONLY, not every sample. There are dozens of samples and a handful of keys, and a
// triad on each sample would be a thicket you cannot read; the keys are also the only instants a
// rotation edit could be recorded at, so they are the honest place to show it.
//
// One LineSegments for the lot: three segments per key, coloured per vertex, so the whole set
// is a single draw call however many keys there are.
const GNOMON_ORDER = 9997;
// ...and the axes go the other way: X toward PINK, Y toward YELLOW. Z is lifted rather than
// hue-shifted, for a different reason.
//
// THE BLUE AXIS REALLY WAS THINNER, and it is not the geometry — all three are the same width.
// An antialiased line's apparent weight is its LUMINANCE contrast against the background, and
// under Rec.709 green carries 0.72 of the luma, red 0.21 and blue 0.07. The old triad measured
// 0.79 / 0.41 / 0.50, which is very close to the order it was reported in. Blue also reads
// thinner than its luma alone predicts, because the eye resolves blue detail poorly.
//
// So the three are balanced by luminance rather than by eye: roughly 0.63 / 0.70 / 0.68. Blue
// gets most of the lift, which is why Z is a light blue rather than a pure one.
// X and Y carry a FIFTH of the hue shift they had. Z is not hue-shifted at all — its lift is a
// SATURATION change, and that is the fix for the blue axis reading thinner than the other two,
// which is a separate problem from the two palettes competing.
//
// The luminance spread is wider again as a result (Z is dark at full saturation and the eye
// resolves blue detail poorly), and that is the cost of holding the axes at full value. If blue
// still reads thin, the lever is its saturation, not its hue.
const AXIS_COL = [[1.00, 0.30, 0.33], [0.32, 0.96, 0.27], [0.50, 0.70, 1.00]];
const _axV = new THREE.Vector3();

const GNOMON_PX = 3;
// Thinner than the triads on purpose. A fat line can be a fraction of a pixel wide and still be
// antialiased, which a hardware line cannot — so the curve can go BELOW 1px rather than being
// stuck at the width that caused the original aliasing.
const TRAIL_PX = 1.5;

// ONE fat-line object for everything here — the trail and the triads alike. LineSegments2
// rather than Line2 even for the curve, because Line2's own setPositions ALLOCATES a fresh
// array on every call to expand a polyline into pairs, and the curve is rewritten every frame
// of a drag. Expanding it here into a buffer that gets reused costs nothing per frame, and it
// leaves one geometry type and one update path instead of two of each.
function makeFat(main, px, opacity, order) {
  const g = Skeleton.overlayGroup(main);
  const seg = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({
    linewidth: px,               // SCREEN pixels, because worldUnits is off
    worldUnits: false,
    vertexColors: true,
    // LATE PASS, BUT NOT BLENDED. `depthTest: false` and renderOrder 9998 were not enough on
    // their own, and the reason is a rule renderOrder cannot beat: three.js draws EVERY
    // transparent object after EVERY opaque one, and renderOrder only sorts WITHIN a pass. Every
    // mesh in this app is `transparent: true` (measured: opacity 1, but transparent all the
    // same), so an opaque overlay is painted over by the whole scene however high its order.
    // This is also exactly how the BONES have always drawn through meshes -- their visuals are
    // transparent with a high order -- so this makes the trail match the thing it is drawn
    // alongside rather than inventing a second mechanism.
    //
    // `transparent` here buys the PASS, and NoBlending declines the blend. The previous note
    // rejected transparency because a blended pass per overlay showed as judder in the headset,
    // and because a part-alpha line is literally mixed with whatever is behind it and loses its
    // saturation. Both of those are the BLEND, not the pass — so neither is paid here. Edges
    // stay hard exactly as before (LineMaterial antialiases through alpha, and this renderer
    // runs antialias:false because MSAA breaks WebXR session start), which is unchanged, not a
    // new loss, and still the reason to keep the widths modest.
    transparent: true,
    blending: THREE.NoBlending,
    depthWrite: false,
    depthTest: false,
    // The overlay is a readout, not part of the scene's lighting. Tone mapping would roll a
    // fully saturated axis off toward pastel the moment anyone switched away from Linear.
    toneMapped: false,
  }));
  void opacity;
  seg.frustumCulled = false;
  seg.isPickable = false;
  seg.renderOrder = order;
  g.add(seg);
  return seg;
}

function makeGnomons(main) {
  return makeFat(main, GNOMON_PX, 0.95, GNOMON_ORDER);
}

// A polyline written into the pairs layout LineSegmentsGeometry wants: segment i runs from
// point i to point i+1, six floats a segment.
function writePairs(src, out, n) {
  for (let i = 0; i < n - 1; i++) {
    const o = i * 6;
    out[o] = src[i * 3]; out[o + 1] = src[i * 3 + 1]; out[o + 2] = src[i * 3 + 2];
    out[o + 3] = src[(i + 1) * 3]; out[o + 4] = src[(i + 1) * 3 + 1]; out[o + 5] = src[(i + 1) * 3 + 2];
  }
}

// Hand a fat line its geometry, rebuilding the instanced attributes only when the buffer was
// actually replaced. setPositions/setColors rebuild them every time they run.
// The pairs write again, with every channel scaled — used for colour, where each curve carries
// its own brightness, rather than duplicating the loop with a multiply bolted on.
function writePairsScaled(src, out, n, k) {
  for (let i = 0; i < n - 1; i++) {
    const o = i * 6;
    out[o] = src[i * 3] * k; out[o + 1] = src[i * 3 + 1] * k; out[o + 2] = src[i * 3 + 2] * k;
    out[o + 3] = src[(i + 1) * 3] * k;
    out[o + 4] = src[(i + 1) * 3 + 1] * k;
    out[o + 5] = src[(i + 1) * 3 + 2] * k;
  }
}

function pushFat(main, obj, state, pos, col, segs) {
  // EVERY fat line needs the viewport, not just the triads. LineMaterial clones its uniforms
  // per material, so a resolution set on one does nothing for the others — and a line whose
  // resolution is still the default 1x1 has its screen-space width divided by 1 instead of by
  // a thousand, which is not a subtle error. This was set for the gnomons alone when they were
  // the only fat line, and the trail inherited the gap when it was converted.
  syncResolution(main, obj.material);
  const g = obj.geometry;
  if (state.fresh) {
    g.setPositions(pos);
    g.setColors(col);
    state.fresh = false;
  } else {
    g.attributes.instanceStart.needsUpdate = true;
    g.attributes.instanceEnd.needsUpdate = true;
    if (g.attributes.instanceColorStart) {
      g.attributes.instanceColorStart.needsUpdate = true;
      g.attributes.instanceColorEnd.needsUpdate = true;
    }
  }
  g.instanceCount = segs;
}

// A screen-space width needs to know what the screen is. Read every draw rather than pushed
// from a resize hook: a hook has to be added to every path that can change the viewport, and
// the one that gets forgotten leaves the lines the wrong thickness with nothing to point at.
function syncResolution(main, mat) {
  const cam = main.getCamera && main.getCamera();
  const w = (cam && cam._width) || 1;
  const h = (cam && cam._height) || 1;
  if (mat.resolution.x !== w || mat.resolution.y !== h) mat.resolution.set(w, h);
}

// Sized off the scene, not a constant: the same triad has to be legible on a head and on a
// whole figure, and Skeleton.sceneUnit is what every other rig marker is scaled by.
// A FRACTION OF THE SCENE UNIT. 0.0375 was tuned on the day the gnomons were built and read as
// too small in use — matt, with the diagnostic in front of him: "still smaller than i'd expect".
// Tunable live, because this is taste and taste is faster to settle by turning a knob than by
// asking.
const GNOMON_LEN = 0.06;
function gnomonLength(main) {
  return (Skeleton.sceneUnit(main) || 1) * tune('_gnomonSize', GNOMON_LEN);
}

// DISTANCE IS SHOWN BY SCALE, NOT BY FADING. A faded triad still occupies its space and still
// reads as three coloured lines, so a long take turns into a wall of them; a shrinking one
// simply gets out of the way, and vanishes for real at the edge of the range instead of
// lingering as a smudge. It also keeps the axis colours at full strength, which is the one
// thing about a gnomon you must not have to squint at.
//
// Counted in KEYS, not seconds: ten keys either side is ten poses either side, whether they
// are a second apart or a minute. Frames would mean a densely keyed passage shows three triads
// and a sparse one shows none.
const GNOMON_KEY_REACH = 10;
// ...BUT NOT TO NOTHING. The falloff exists so a long take does not become a wall of triads,
// and it works — but at ten keys out it reached 0.125, and a triad an eighth of full size does
// not read as "far away", it reads as broken. matt measured exactly that: "scale=0.125..0.975".
// A floor keeps the distant ones legible while still ranking them behind the playhead.
const GNOMON_MIN_SCALE = 0.45;

// Where the playhead sits in the key ordering, as a FRACTIONAL index — it rarely lands on a
// key, and an integer answer would make the whole set jump a step as it crossed each one.
function playheadKeyIndex(keyTimes, head) {
  const n = keyTimes.length;
  if (!n) return 0;
  if (head <= keyTimes[0]) return 0;
  if (head >= keyTimes[n - 1]) return n - 1;
  let i = 1;
  while (i < n && keyTimes[i] < head) i++;
  const t0 = keyTimes[i - 1], t1 = keyTimes[i];
  return (i - 1) + (t1 > t0 ? (head - t0) / (t1 - t0) : 0);
}

// The authored curves on screen. `_trailStrands` is the real list; the single-strand fallback
// keeps every caller working in the moment before update() has built one.
function strandsOf(main) {
  const list = main._trailStrands;
  if (list && list.length) return list;
  const one = main._trailStrand;
  if (!one) return [];
  if (one.base == null) one.base = 0;
  return [one];
}

// A LIVE EDIT OWNS THE CURVE IT IS EDITING, and only that one. perFrame runs every frame of a
// drag, so reading the baseline here would repaint the old shape one frame after the drag drew
// the new one -- the gnomons would sit inert while the path moved, which is indistinguishable
// from the rotation not being editable at all. The strands NOT under the drag keep their own.
function editRecord(main, st) {
  const e = main._pathEdit;
  if (!e) return null;
  if (e.strand === st) return e;
  return (e.extra && e.extra.find((x) => x.strand === st)) || null;
}
function drawnPoints(main, st) {
  const r = editRecord(main, st);
  return (r && r.after) || st.points;
}
function drawnQuats(main, st) {
  const r = editRecord(main, st);
  return (r && r.afterQ) || st.quats;
}

MotionTrail.drawGnomons = function (main) {
  const v = main._trailVis;
  const strand = main._trailStrand;
  if (!v || !v.gnomons) return;
  // Any curve carrying orientations is reason to draw; requiring it of the HEAD one would let
  // a head without them hide every other path's triads.
  const anyQuats = strandsOf(main).some((st) => st && st.quats);
  if (!strand || !anyQuats || !Skeleton.displayFlag('gnomons')) {
    v.gnomons.visible = false;
    return;
  }
  // A LIVE EDIT OWNS THE ORIENTATIONS, exactly as it owns the curve. perFrame runs every frame
  // of a drag and calls this, so reading the baseline here would repaint the old rotation one
  // frame after the twist drew the new one — the gnomons would sit inert while the path moved,
  // which is indistinguishable from the rotation not being editable at all.
  const strands = strandsOf(main);

  // A ref whose strand has gone is a stale map from the frame before the selection changed;
  // drawDots will rebuild it. Drawing from it would read a curve that is no longer on screen.
  const idx = (v.keyIndices || [])
    .map((r) => (typeof r === 'number' ? { s: 0, local: r } : r))
    .filter((r) => r && strands[r.s]);
  const n = idx.length;
  if (!n) { v.gnomons.visible = false; return; }

  // ALL KEYS, or only those near the playhead. Full size for every one in this mode rather
  // than a fade stretched over the whole take: spread across a long take the far end fades to
  // nothing, which is the same as not drawing it and defeats the point of asking for all.
  const showAll = !!Skeleton.displayFlag('gnomonsAll');

  const L = gnomonLength(main);
  // Sized for EVERY key even though only some are drawn: which ones qualify changes as the
  // playhead moves, and a buffer that resized with them would reallocate constantly. The
  // draw range does the hiding instead.
  const need = n * 6 * 3;
  if (!v.gnomonPos || v.gnomonPos.length !== need) {
    v.gnomonPos = new Float32Array(need);
    v.gnomonCol = new Float32Array(need);
    v.gnomonFresh = true;
  }
  const pos = v.gnomonPos;
  const col = v.gnomonCol;

  // THE REACH IS PER CURVE. It is measured in KEY POSITIONS, so measuring it down the
  // concatenated list asks "how many keys away is this, counting through the other curves" --
  // and every key of the second curve is then tens of positions from the playhead and silently
  // out of reach. Only one path's triads ever drew, whichever happened to be listed first.
  //
  // Each curve gets its own ordinal and its own playhead key, which is also the only reading
  // that means anything: the concatenated times are not monotonic, so a single centre computed
  // over them is a search through a sequence that runs forwards, jumps back, and runs forwards
  // again.
  const ordinal = new Array(idx.length);
  const centreOf = new Map();
  const perStrand = new Map();
  for (let k = 0; k < idx.length; k++) {
    const r = idx[k];
    let list = perStrand.get(r.s);
    if (!list) { list = []; perStrand.set(r.s, list); }
    ordinal[k] = list.length;
    list.push(strands[r.s].times[r.local]);
  }
  const head = now(main);
  for (const [si, times] of perStrand) centreOf.set(si, playheadKeyIndex(times, head));

  let o = 0;
  let verts = 0;
  let smallest = 1, biggest = 0;
  // Per curve, so "only one path has triads" is a number rather than a thing to squint at.
  const drawnBy = new Map();
  const keysBy = new Map();
  for (const r of idx) keysBy.set(r.s, (keysBy.get(r.s) || 0) + 1);
  for (let k = 0; k < idx.length; k++) {
    const raw = showAll
      ? 1
      : 1 - Math.abs(ordinal[k] - centreOf.get(idx[k].s)) / GNOMON_KEY_REACH;
    if (raw <= 0) continue;            // past the reach: not drawn at all, not drawn faintly
    // Remapped onto [floor, 1] rather than clamped, so the ranking survives the floor: a clamp
    // would flatten everything past the halfway point into one size.
    const floor = Math.min(0.95, tune('_gnomonMinScale', GNOMON_MIN_SCALE));
    const scale = floor + raw * (1 - floor);
    if (scale < smallest) smallest = scale;
    if (scale > biggest) biggest = scale;
    const len = L * scale;
    const r = idx[k];
    drawnBy.set(r.s, (drawnBy.get(r.s) || 0) + 1);
    const rs = strands[r.s];
    const p = drawnPoints(main, rs)[r.local];
    const rq = drawnQuats(main, rs);
    const q = rq && rq[r.local];
    if (!p) continue;
    for (let a = 0; a < 3; a++) {
      _axV.set(a === 0 ? len : 0, a === 1 ? len : 0, a === 2 ? len : 0);
      if (q) _axV.applyQuaternion(q);
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      pos[o + 3] = p.x + _axV.x; pos[o + 4] = p.y + _axV.y; pos[o + 5] = p.z + _axV.z;
      const c = AXIS_COL[a];
      col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
      col[o + 3] = c[0]; col[o + 4] = c[1]; col[o + 5] = c[2];
      o += 6;
      verts += 2;
    }
  }
  if (!verts) { v.gnomons.visible = false; return; }
  // The instanced equivalent of a draw range: one instance per SEGMENT, so the keys out of
  // reach are simply not issued. Through the same helper the curves use, so the resolution and
  // the rebuild rule cannot differ between them again.
  v.gnomonState = v.gnomonState || {};
  v.gnomonState.fresh = v.gnomonFresh;
  pushFat(main, v.gnomons, v.gnomonState, pos, col, verts / 2);
  v.gnomonFresh = v.gnomonState.fresh;
  v.gnomons.visible = true;

  // A TRIAD'S DRAWN LENGTH IS `unit * 0.0375 * scale`, AND NOTHING ELSE. Two inputs, so when
  // the answer is wrong it is one of exactly two numbers — the scene unit, or the distance in
  // KEYS from the playhead. Kept every draw because it is five numbers, and because "the
  // gnomons are the wrong size" is otherwise a report that can only be answered by guessing.
  // Read it with window.gnomonDiag().
  // The head curve's playhead key, which is what the single-curve reading always was.
  const centre = centreOf.has(idx[0].s) ? centreOf.get(idx[0].s) : 0;
  v.gnomonDbg = { L: L, unit: Skeleton.sceneUnit(main) || 0, centre: centre,
    keys: idx.length, drawn: verts / 2 / 3, minScale: smallest, maxScale: biggest,
    perStrand: Array.from(keysBy.keys()).sort((a, b) => a - b).map((si) => ({
      strand: si,
      pin: (strands[si] && strands[si].pin && strands[si].pin._permanentStaticLabel)
        || ('#' + (strands[si] && strands[si].pin && strands[si].pin.getID())),
      keys: keysBy.get(si) || 0, drawn: drawnBy.get(si) || 0,
      centre: centreOf.get(si), hasQuats: !!(strands[si] && strands[si].quats),
    })) };

  if (window._trailTrace) {
    const r = v.gnomons.material.resolution;
    console.log('[trail] gnomons segs=' + (verts / 2) + ' len=' + L.toFixed(4) +
      ' res=' + r.x + 'x' + r.y + ' vis=' + v.gnomons.visible);
  }
};

// WHY ARE THE AXIS TRIADS THAT SIZE. One command, one answer, because the length has exactly
// two inputs and they are told apart by one number each:
//
//   unit    — Skeleton.sceneUnit, latched off the meshes in the scene. If THIS is 10x small,
//             the whole rig is undersized too and the gnomons are a symptom, not the bug.
//   scale   — 1 - (keys from the playhead) / 10. A triad nine keys from the playhead is drawn
//             at a TENTH of full size, on purpose. If minScale is small and unit is right, the
//             triads are not the wrong size; the playhead is somewhere else.
// WHY IS THE TRAIL BEHIND THE MESH. Everything in the source says it cannot be: depthTest is
// off and the render order is 9998 against a mesh's 0. So the answer is a runtime fact, and
// there is exactly one that the source cannot show -- three.js renders ALL transparent objects
// after ALL opaque ones, and renderOrder only sorts WITHIN a pass. An opaque overlay therefore
// loses to a transparent mesh no matter how high its order.
window.trailDepthDiag = function () {
  const main = window.app;
  const v = main && main._trailVis;
  if (!v || !v.lines || !v.lines.length) {
    console.log('[trail] nothing drawn -- turn Trails on with a keyed control selected');
    return null;
  }
  const m = v.lines[0].material;
  console.log('[trail] line   depthTest=' + m.depthTest + ' depthWrite=' + m.depthWrite
    + ' transparent=' + m.transparent + ' renderOrder=' + v.lines[0].renderOrder
    + '  (pass: ' + (m.transparent ? 'TRANSPARENT' : 'opaque') + ')');
  const dm = v.dots && v.dots.material;
  if (dm) {
    console.log('[trail] dots   depthTest=' + dm.depthTest + ' transparent=' + dm.transparent
      + ' renderOrder=' + v.dots.renderOrder);
  }
  // And the meshes it is losing to.
  let worst = null;
  for (const mesh of (main.getMeshes ? main.getMeshes() : [])) {
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    const mm = tm && tm.material;
    if (!mm) continue;
    const row = { name: mesh._permanentStaticLabel || ('#' + mesh.getID()),
      transparent: !!mm.transparent, opacity: mm.opacity, order: tm.renderOrder };
    console.log('[trail] mesh   ' + row.name + '  transparent=' + row.transparent
      + ' opacity=' + row.opacity + ' renderOrder=' + row.order
      + (row.transparent ? '  <-- TRANSPARENT: drawn after every opaque object, so it paints '
        + 'over the trail whatever the trail order is' : ''));
    if (row.transparent) worst = row;
  }
  if (!worst) {
    console.log('[trail] no transparent mesh found -- so the overlap is NOT the pass order, '
      + 'and depthTest=false above should already be winning. Tell me what this printed.');
  }
  return { line: { depthTest: m.depthTest, transparent: m.transparent }, culprit: worst };
};

// WHY ARE THE JOINT DOTS STILL ON. The flag is one of six reasons a dot draws, and the other
// five are deliberate -- a dot that is the ONLY marker of a pickable thing must not be
// switchable off. So "the button does nothing" is usually one of those five, and this says
// which, per joint, instead of leaving it to be guessed.
window.jointDotDiag = function () {
  const main = window.app;
  const flags = {
    joints: Skeleton.displayFlag('joints'),
    solid: Skeleton.displayFlag('solid'),
    wire: Skeleton.displayFlag('wire'),
  };
  const noBoneBody = !flags.solid && !flags.wire;
  console.log('[joints] Joints=' + flags.joints + '  Solid=' + flags.solid
    + '  Wire=' + flags.wire
    + (noBoneBody ? '\n[joints] Solid AND Wire are both OFF, so the dots are the only thing '
        + 'marking a joint and are forced on REGARDLESS of the Joints flag. Turn Solid or Wire '
        + 'on and the flag takes effect.' : ''));
  const joints = Skeleton.joints(main) || [];
  const sel = new Set((main.getSelectedMeshes?.() || []).map((x) => x.getID()));
  const hasChildBone = new Set();
  for (const j of joints) {
    const p = j._parentMesh;
    if (Skeleton.isJoint(p)) hasChildBone.add(p.getID());
  }
  let forced = 0;
  for (const j of joints) {
    const id = j.getID();
    const isolated = !hasChildBone.has(id) && !Skeleton.isJoint(j._parentMesh);
    const isSel = sel.has(id);
    const why = [];
    if (flags.joints) why.push('flag on');
    if (noBoneBody) why.push('no bone body');
    if (isolated) why.push('ISOLATED (no bone at either end)');
    if (isSel) why.push('selected');
    if (why.length && !flags.joints) forced++;
    if (why.length && !flags.joints) {
      console.log('[joints]   ' + (j._permanentStaticLabel || ('#' + id))
        + ' visible despite the flag: ' + why.join(', '));
    }
  }
  console.log('[joints] ' + joints.length + ' joints, ' + forced
    + ' drawn for a reason other than the flag');
  return { flags: flags, joints: joints.length, forced: forced };
};

window.gnomonDiag = function () {
  const main = _lastMain;
  const d = main && main._trailVis && main._trailVis.gnomonDbg;
  if (!d) {
    console.log('[gnomon] nothing drawn yet — turn Trails and Rotation on, with a keyed pin '
      + 'selected, then run this again');
    return null;
  }
  console.log('[gnomon] unit=' + d.unit.toFixed(4) + ' fullLength=' + d.L.toFixed(4)
    + '  keys=' + d.keys + ' drawn=' + d.drawn + ' playheadAtKey=' + d.centre.toFixed(2)
    + '  scale=' + d.minScale.toFixed(3) + '..' + d.maxScale.toFixed(3)
    + '  -> drawn length ' + (d.L * d.minScale).toFixed(4) + '..'
    + (d.L * d.maxScale).toFixed(4));
  // ONE LINE PER CURVE. "only one path has triads" is otherwise a report that can only be
  // answered by guessing which of several reasons it was: no orientations on that curve, no
  // keys on it, or every key out of the playhead's reach.
  for (const r of (d.perStrand || [])) {
    console.log('[gnomon]   curve ' + r.strand + ' ' + r.pin
      + '  keys=' + r.keys + ' drawn=' + r.drawn
      + ' playheadAtKey=' + (r.centre == null ? '?' : r.centre.toFixed(2))
      + (r.hasQuats ? '' : '  <-- no orientations, so no triads')
      + (r.keys && !r.drawn ? '  <-- every key out of reach of the playhead' : ''));
  }
  console.log('[gnomon] maxScale well under 1 means the PLAYHEAD is far from the keys, not that '
    + 'the triads are small. unit far from the size of your sculpt means the scene unit is the '
    + 'problem — check window.rigUnit().');
  return d;
};

function makeDots(main, sizePx) {
  const g = Skeleton.overlayGroup(main);
  const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,   // SCREEN pixels — this is the whole difference from the old wall
    map: dotTexture(),
    // A CUTOUT, not a blend. alphaTest discards the rim outright, so the dot keeps its round
    // shape without any blended pass — which is the whole point, since blending was what had
    // to go. The edge is harder than it was; a few pixels across, that is a fair trade.
    alphaTest: 0.5,
    vertexColors: true,       // key dots carry the time ramp; sample dots carry identity
    // The same late-pass-without-the-blend as the lines above; see makeFat for why. alphaTest
    // is a discard in the shader, so the round dot survives NoBlending untouched.
    transparent: true,
    blending: THREE.NoBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  }));
  pts.frustumCulled = false;
  pts.isPickable = false;
  pts.renderOrder = DOT_ORDER;
  g.add(pts);
  return pts;
}

function makeLine(main) {
  return makeFat(main, TRAIL_PX, 1.0, TRAIL_ORDER);
}

MotionTrail.clear = function (main) {
  disposeTrail(main);
  main._trailSig = null;
  main._trailStrand = null;
  main._trailStrands = null;
};

// Dropping the held target is a separate thing from clearing the drawing: turning trails off
// and on again should come back to what you were looking at.
MotionTrail.forget = function (main) {
  main._trailTarget = null;
  // The SET is what stickiness holds now, so clearing only the head left the rest held and
  // the next frame simply promoted one of them -- a forget that forgot nothing.
  main._trailTargets = null;
  MotionTrail.clear(main);
};

// Redraw one curve from points the editor is holding, without re-sampling. The drag is a pure
// geometry change until it is pushed back, so a solve per frame would be wasted work.
MotionTrail.redraw = function (main, lineIndex, points) {
  const v = main._trailVis;
  const line = v && v.lines && v.lines[lineIndex];
  if (!line) return;
  MotionTrail.writeLine(main, lineIndex, points);
  // The dots ride with the drag. Leaving them on the old samples is worse than not drawing them
  // at all: they would read as the curve's real positions while the line says otherwise.
  const strand = main._trailStrand;
  if (strand) {
    const was = strand.points;
    strand.points = points;
    MotionTrail.drawDots(main);
    strand.points = was;
  }
};

// Per-frame. Cheap when nothing changed: one fingerprint, one string compare.
// RECOLOUR PER FRAME, RESAMPLE ONLY ON CHANGE. The playhead moves every frame and the geometry
// does not, so the gradient cannot ride on the fingerprint — putting the playhead in it would
// mean a full evaluation per sample, every frame, to draw a curve that has not moved. Writing a
// colour array is nothing by comparison.
MotionTrail.recolor = function (main) {
  const v = main._trailVis;
  const times = main._trailTimes;
  if (!v || !v.lines || !times || times.length < 2) return;

  const t0 = times[0];
  const t1 = times[times.length - 1];
  const span = (t1 - t0) || 1;
  const head = now(main);

  const col = new Float32Array(times.length * 3);
  for (let i = 0; i < times.length; i++) timeColor(times[i], head, span, col, i * 3, 0);

  // The dots are recoloured here as well, not in drawDots: preselection changes every frame,
  // and drawDots only runs when the geometry is rebuilt.
  const hover = MotionPathEdit.hoverIndex(main);
  if (v.slots) {
    const plainCol = v.plainCol, keyCol = v.keyCol;
    // Sample dots ride at the solved curve's brightness: they mark the path, they are not it.
    if (plainCol) {
      const id = v.plainIdent;
      for (let i = 0; i < plainCol.length; i++) {
        plainCol[i] = (id && i < id.length ? id[i] : v.identity[i % 3]) * OUTPUT_VALUE;
      }
    }
    if (keyCol) {
      for (let i = 0; i < v.keyTimes.length; i++) {
        timeColor(v.keyTimes[i], head, span, keyCol, i * 3, v.nowEps);
      }
    }
    const slot = hover >= 0 ? v.slots[hover] : null;
    if (slot) {
      const arr = slot.key ? keyCol : plainCol;
      if (arr) {
        arr[slot.i * 3] = HOVER_COL[0];
        arr[slot.i * 3 + 1] = HOVER_COL[1];
        arr[slot.i * 3 + 2] = HOVER_COL[2];
      }
    }
    if (plainCol) setColors(v.dots, plainCol);
    if (keyCol) setColors(v.keyDots, keyCol);
    // The hovered mark grows as well as changes colour: at four pixels a colour shift alone is
    // easy to miss against a busy scene.
    // THE HOVER MARK IS ITS OWN ONE-POINT CLOUD, and this is the bug that read as a misaligned
    // preselection for four rounds of diagnosis.
    //
    // It used to grow the hovered dot by writing `material.size` — but a PointsMaterial carries
    // ONE size for the whole cloud, which the note on makeDots says in as many words. So
    // hovering a single sample grew every one of the hundred-odd sample dots at once: the entire
    // curve visibly changed, and the one genuinely tinted dot was lost inside it. matt saw
    // exactly that and described it precisely — "i can see all the plotted points of the curve
    // get preselection highlighting" — and I read it as a remark about which points COULD be
    // highlighted rather than as the report it was.
    //
    // Every measurement of the tint was correct the whole time, because the tint was correct.
    // A separate one-vertex cloud is the cheapest true per-point mark: one draw call, no custom
    // shader, and the size is per-cloud precisely because the cloud is one point.
    const hp = hover >= 0 && v.slots[hover] ? pointOf(main, hover) : null;
    if (v.hoverDot) {
      if (hp) {
        v.hoverDot.geometry.setFromPoints([hp]);
        setColors(v.hoverDot, new Float32Array(HOVER_COL));
        v.hoverDot.material.size = (v.slots[hover].key ? KEY_DOT_PX : DOT_PX) * HOVER_GROW;
      }
      v.hoverDot.visible = !!hp;
    }
  }

  // Fat lines want the colour in the same PAIRS layout as the positions: segment i takes the
  // colour of point i at its start and point i+1 at its end, so the gradient runs continuously
  // along the curve rather than stepping at every segment boundary.
  v.lines.forEach((line, i) => {
    const st = v.lineState && v.lineState[i];
    // A drag rewrites positions before the colours catch up; a buffer sized for a different
    // sample count would be written past its end.
    if (!st || !st.col || st.col.length !== (times.length - 1) * 6) return;
    // Value, not alpha, is what separates the authored curve from the solved one now.
    const k = (v.lineValue && v.lineValue[i] != null) ? v.lineValue[i] : CONTROL_VALUE;
    writePairsScaled(col, st.col, times.length, k);
    const g = line.geometry;
    if (g.attributes.instanceColorStart) {
      g.attributes.instanceColorStart.needsUpdate = true;
      g.attributes.instanceColorEnd.needsUpdate = true;
    }
  });
};

// EVERYTHING THAT CHANGES WITHOUT THE GEOMETRY CHANGING. The playhead moves, a display flag is
// toggled, the pointer hovers a different sample — none of those alter the fingerprint, so none
// of them cause a rebuild, and anything that depends on them has to run here instead.
//
// The gnomons were on the rebuild path and looked simply broken: pressing the button set the flag
// and nothing appeared, because the curve had not changed and so was never redrawn. That is the
// second thing to land on this path for exactly the same reason, which is why there is now one
// entry point rather than a call bolted onto each early return.
// Why is there no trail? Answers on the spot rather than only arming a flag: the last three
// diagnostics in this project printed nothing when first run, because the thing they watched
// only speaks when it changes. This says what it can see RIGHT NOW — the display flag, the
// scene selection, the sticky target and whether anything is actually keyed — and then traces.
//
// Written for matt's report that a pin selected in the DOPESHEET trails and the same pin
// selected in the VIEWPORT does not. Both routes end at the same place, so the answer is in
// one of these four lines and not in a theory of mine.
window.trailTrace = function (on) {
  window._trailTrace = on !== false;
  const main = _lastMain;
  if (!main) {
    console.log('[trail] ' + VERSION + ' — trace '
      + (window._trailTrace ? 'ON' : 'off') + '. No frame has drawn yet, so nothing to report.');
    return window._trailTrace;
  }
  const reg = window._animationRegistry;
  const sel = main.getMesh && main.getMesh();
  const held = main._trailTarget;
  const kind = (m) => !m ? 'none'
    : ((m._permanentStaticLabel || ('#' + m.getID())) + (m._isPinTarget ? ' [pin]'
      : (m._isBone ? ' [joint]' : ' [mesh]')));
  const keyed = (m) => !!(m && reg && reg.tracks && reg.tracks.get(m.getID()));
  console.log('[trail] ' + VERSION
    + '\n  trails display flag : ' + (Skeleton.displayFlag('trails') ? 'ON' : 'OFF  <-- nothing will draw')
    + '\n  scene selection     : ' + kind(sel) + (keyed(sel) ? ' (keyed)' : ' (no track)')
    + '\n  sticky trail target : ' + kind(held) + (keyed(held) ? ' (keyed)' : ' (no track)')
    + '\n  pin <-> joint link  : ' + (sel && sel._isPinTarget
      ? (sel._pinnedJoint ? 'pin -> ' + kind(sel._pinnedJoint) : 'MISSING  <-- a pin with no _pinnedJoint is skipped')
      : (sel && sel._isBone
        ? (sel._boneIKPinObj ? 'joint -> ' + kind(sel._boneIKPinObj)
          + (keyed(sel._boneIKPinObj) ? ' (keyed - this is where the curve comes from)' : ' (no track either)')
          : 'this joint carries no pin')
        : 'n/a'))
    + '\n  tracks in the scene : ' + (reg && reg.tracks ? reg.tracks.size : 'no registry'));
  console.log('[trail] trace ' + (window._trailTrace ? 'ON' : 'off')
    + ' — per-frame lines follow while the target or the keys change.');
  return window._trailTrace;
};

MotionTrail.perFrame = function (main) {
  MotionTrail.recolor(main);
  MotionTrail.drawGnomons(main);
};

let _lastMain = null;

MotionTrail.update = function (main) {
  _lastMain = main;   // so trailTrace() can answer without being handed the scene
  // A live path edit owns the drawn curve: the editor writes the geometry directly as the drag
  // moves, and re-sampling underneath it would fight the drag and cost a solve per frame.
  if (main._pathEdit) { MotionTrail.perFrame(main); return false; }
  if (!Skeleton.displayFlag('trails')) { MotionTrail.clear(main); return false; }
  const targets = trailed(main);
  const r = range();
  if (!targets.length || !r) { MotionTrail.clear(main); return false; }

  if (window._trailTrace) {
    const reg = window._animationRegistry;
    console.log('[trail] targets=' + targets.length +
      ' control=' + targets.some((t) => t.control) +
      ' range=' + (r ? r.start + '..' + r.end : 'none') +
      ' tracks=' + (reg && reg.tracks ? reg.tracks.size : 'none'));
  }
  const sig = signature(main, targets, r);
  if (sig === main._trailSig && main._trailVis) { MotionTrail.perFrame(main); return false; }
  main._trailSig = sig;

  const paths = samplePaths(main, targets);
  if (!paths || !paths[0] || paths[0].length < 2) { MotionTrail.clear(main); return false; }

  // The count changes when the selection moves between a bone and a keyed pin, so rebuild
  // rather than trying to reconcile: two lines is not a pool worth managing.
  if (!main._trailVis || main._trailVis.lines.length !== paths.length) {
    disposeTrail(main);
    main._trailVis = {
      lines: paths.map(() => makeLine(main)),
      dots: makeDots(main, DOT_PX),
      keyDots: makeDots(main, KEY_DOT_PX),
      // Drawn after the two clouds so it sits on top of the dot it marks.
      hoverDot: makeDots(main, DOT_PX * HOVER_GROW),
      gnomons: makeGnomons(main),
    };
  }

  // The strand the editor may take hold of: the AUTHORED curve only. Solver output is not
  // editable, so it is never offered — see MotionPathEdit for why.
  const strandAt = (i) => ({
    points: paths[i], quats: paths.quats && paths.quats[i],
    times: main._trailTimes, pin: targets[i].obj, line: i,
  });
  // EVERY authored curve on screen, so an edit can reach the ones that are not the head of the
  // selection. `_trailStrand` stays the head's: it owns the dots and the gnomons, and every
  // existing caller means "the one I am editing" by it.
  main._trailStrands = targets.map((t, i) => (t.control ? strandAt(i) : null)).filter(Boolean);
  // EACH STRAND CARRIES ITS OWN BASE. The dots of every authored curve share two point clouds,
  // so a sample is addressed by a GLOBAL index that runs across the strands in order. Both the
  // drawing and the hit test have to agree on where each strand starts in that numbering, and
  // the reliable way to make two sides agree on a rule is to not write the rule twice.
  let base = 0;
  for (const st of main._trailStrands) { st.base = base; base += st.points.length; }
  main._trailSampleCount = base;
  const ci = targets.findIndex((t) => t.control);
  main._trailStrand = ci >= 0 ? strandAt(ci) : null;

  const v = main._trailVis;
  v.lineState = v.lineState || paths.map(() => ({ fresh: true }));
  paths.forEach((pts, i) => {
    const line = v.lines[i];
    const tg = targets[i];
    // Both curves take the colour of the JOINT they describe, so a control and its output read
    // as one thing seen two ways rather than as two unrelated curves.
    MotionTrail.writeLine(main, i, pts);
    v.lineValue = v.lineValue || [];
    v.lineValue[i] = tg.control ? CONTROL_VALUE : OUTPUT_VALUE;
    line.visible = pts.length > 1;
  });

  MotionTrail.drawDots(main);
  MotionTrail.perFrame(main);
  return true;
};

// The samples of the AUTHORED curve, drawn as dots so they can be aimed at. Split into two
// clouds rather than one with per-point sizes: PointsMaterial carries a single size, and two
// draw calls is cheaper than the custom shader the alternative needs.
MotionTrail.drawDots = function (main, weights) {
  const v = main._trailVis;
  const strand = main._trailStrand;
  if (!v || !v.dots) return;
  if (!strand) { v.dots.visible = v.keyDots.visible = false; return; }

  // EVERY authored curve contributes its samples to the same two clouds, addressed by the
  // global index each strand's `base` defines. One pair of clouds rather than a pair per curve:
  // PointsMaterial carries a single size, so the split is already by size class, not by curve.
  const strands = strandsOf(main);
  const plain = [], keys = [], keyTimes = [], slots = [], keyIndices = [], ident = [];
  for (let si = 0; si < strands.length; si++) {
    const st = strands[si];
    if (!st.points || !st.times) continue;
    const isKey = keyMask(main, st.pin, st.times);
    // Identity is per CURVE -- it is the colour of the joint the curve describes -- so it is
    // stored per point. Held as one colour for the whole cloud, a second curve simply took the
    // first one's colour and the two became indistinguishable.
    const col = Skeleton.boneColor(main, st.pin._pinnedJoint);
    const dpts = drawnPoints(main, st);
    for (let i = 0; i < dpts.length; i++) {
      if (isKey[i]) {
        slots.push({ key: true, i: keys.length, s: si, local: i });
        keys.push(dpts[i]); keyTimes.push(st.times[i]);
        keyIndices.push({ s: si, local: i, g: st.base + i });
      } else {
        slots.push({ key: false, i: plain.length, s: si, local: i });
        plain.push(dpts[i]);
        ident.push(col.r, col.g, col.b);
      }
    }
  }

  v.dots.geometry.setFromPoints(plain);
  v.keyDots.geometry.setFromPoints(keys);
  v.dots.visible = plain.length > 0;
  v.keyDots.visible = keys.length > 0;

  // SAMPLE dots keep IDENTITY -- which control is this. KEY dots carry TIME, because a key is
  // where an edit can actually land, so "which of these is at the playhead, and which side of
  // it is the rest" is the question you are asking of them.
  // Published for recolor, which runs every frame and owns the colours: the identity tint, the
  // key times, and a map from SAMPLE index to which cloud a sample landed in and where. Without
  // that map a preselected sample cannot be found again once the two clouds are split.
  const span = (strand.times[strand.times.length - 1] - strand.times[0]) || 1;
  v.identity = ident.length ? [ident[0], ident[1], ident[2]] : [1, 1, 1];
  v.plainIdent = new Float32Array(ident);
  v.keyTimes = keyTimes;
  v.slots = slots;
  v.keyIndices = keyIndices;
  v.plainCol = new Float32Array(plain.length * 3);
  v.keyCol = new Float32Array(keyTimes.length * 3);
  // Half a sample spacing counts as "on the playhead": the key and the playhead rarely land on
  // the same float, and a white mark that only appears on exact equality never appears.
  v.nowEps = span / Math.max(1, strand.times.length - 1) * 0.5;

  void weights;
};

// The drawn position of a sample: the edit's curve while a drag is live, the strand otherwise.
// Same rule the gnomons follow, so the mark cannot sit on the old curve mid-drag.
function pointOf(main, g) {
  const v = main._trailVis;
  const sl = v && v.slots && v.slots[g];
  const strands = strandsOf(main);
  // Before the clouds are built there is no map, so fall back to the head strand's own
  // numbering -- which is what the global index means when there is only one curve.
  // A slot with no strand on it MEANS the head strand, and the global index means its own
  // sample number -- which is what both meant when there was only ever one curve.
  const st = strands[sl && sl.s != null ? sl.s : 0];
  if (!st) return null;
  const pts = drawnPoints(main, st);
  const p = pts && pts[sl && sl.local != null ? sl.local : g];
  return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
}

function setColors(obj, arr) {
  const g = obj.geometry;
  const existing = g.getAttribute('color');
  if (existing && existing.count === arr.length / 3) {
    existing.copyArray(arr);
    existing.needsUpdate = true;
  } else {
    g.setAttribute('color', new THREE.BufferAttribute(arr.slice(), 3));
  }
}

// The editor redraws through this rather than importing MotionTrail, which would close an
// import cycle between the two.
// WHICH DOT IS ACTUALLY LIT, read out of the colour buffer that was last uploaded rather than
// recomputed. This is the measurement that separates "the highlight is on the wrong dot" from
// "the highlight is on the right dot and something else is what looks wrong" — and it is the
// one I kept not taking, computing the answer three times instead and getting the same correct
// number while the screen said otherwise.
MotionPathEdit.drawnHoverHook = function (main) {
  const v = main && main._trailVis;
  if (!v || !v.slots) return null;
  const hit = (cloud, isKey) => {
    const g = cloud && cloud.geometry;
    const c = g && g.getAttribute('color');
    const pos = g && g.getAttribute('position');
    if (!c || !pos) return null;
    for (let i = 0; i < c.count; i++) {
      if (Math.abs(c.getX(i) - HOVER_COL[0]) < 0.01 && Math.abs(c.getY(i) - HOVER_COL[1]) < 0.01
        && Math.abs(c.getZ(i) - HOVER_COL[2]) < 0.01) {
        // Back to a SAMPLE index, so it can be compared with what the hit test decided.
        const sample = v.slots.findIndex((sl) => sl && sl.key === isKey && sl.i === i);
        // WHERE THREE ACTUALLY DRAWS IT. Every probe so far projected with SculptGL's camera —
        // the same projection the hit test uses — so of course the two agreed. The dot is
        // rendered by three, through the three camera, under _worldGroup and whatever transform
        // that carries. If those two projections disagree, the hit test is self-consistent and
        // the screen is somewhere else, which is exactly the symptom.
        const out = { cloud: isKey ? 'key' : 'plain', within: i, sample: sample,
          x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
        const tc = main._camera && main._camera.getThreeCamera && main._camera.getThreeCamera();
        const cv = main._canvas;
        if (tc && cv) {
          cloud.updateMatrixWorld(true);
          const w = new THREE.Vector3(out.x, out.y, out.z).applyMatrix4(cloud.matrixWorld);
          out.world = [w.x, w.y, w.z];
          const ndc = w.clone().project(tc);
          out.threeX = (ndc.x * 0.5 + 0.5) * cv.width;
          out.threeY = (-ndc.y * 0.5 + 0.5) * cv.height;
        }
        return out;
      }
    }
    return null;
  };
  return hit(v.dots, false) || hit(v.keyDots, true);
};

// THE PROJECTION THE RENDERER USES, handed to the editor so its hit test and your eyes agree.
//
// The trail is drawn under the skeleton overlay group, which lives under `_worldGroup` and its
// 0.701 scale. SculptGL's own camera.project takes the raw sample and knows nothing about that
// group, so the editor was measuring in a space the screen does not use: self-consistent, and
// about seventy pixels from the dot you were pointing at. matt measured it — the two
// projections of ONE dot came out at 798,355 and 728,370, a ratio of exactly 0.701 about the
// canvas centre.
//
// Lives here rather than in MotionPathEdit for the same reason redrawHook does: that module
// cannot import three or the drawing without closing an import cycle.
const _pv = new THREE.Vector3();
MotionPathEdit.projectHook = function (main, p) {
  const g = main && main._skelGroup;
  const cam = main && main._camera && main._camera.getThreeCamera && main._camera.getThreeCamera();
  const cv = main && main._canvas;
  if (!g || !cam || !cv) return null;
  g.updateMatrixWorld(true);
  _pv.set(p.x, p.y, p.z).applyMatrix4(g.matrixWorld).project(cam);
  return { x: (_pv.x * 0.5 + 0.5) * cv.width, y: (-_pv.y * 0.5 + 0.5) * cv.height };
};

// The inverse, for the drag: a screen point at the depth of the sample being held, brought back
// into the space the curve's samples live in.
MotionPathEdit.unprojectHook = function (main, x, y, depthOf) {
  const g = main && main._skelGroup;
  const cam = main && main._camera && main._camera.getThreeCamera && main._camera.getThreeCamera();
  const cv = main && main._canvas;
  if (!g || !cam || !cv || !depthOf) return null;
  g.updateMatrixWorld(true);
  // The held sample's NDC depth, so the drag stays on its plane rather than sliding toward or
  // away from the eye — the same rule the old camera-space version followed.
  _pv.set(depthOf.x, depthOf.y, depthOf.z).applyMatrix4(g.matrixWorld).project(cam);
  const z = _pv.z;
  _pv.set((x / cv.width) * 2 - 1, -((y / cv.height) * 2 - 1), z).unproject(cam)
    .applyMatrix4(_invG.copy(g.matrixWorld).invert());
  return { x: _pv.x, y: _pv.y, z: _pv.z };
};
const _invG = new THREE.Matrix4();

MotionPathEdit.redrawHook = function (main) { MotionTrail.redrawEdit(main); };

// EVERY curve the gesture is moving, not only the one under the hand. Shared rather than
// repeated at each of the three callers: redrawing just the primary leaves the others frozen
// until the trigger comes up, which reads as them not being edited at all.
MotionTrail.redrawEdit = function (main) {
  const e = main && main._pathEdit;
  if (!e) return;
  if (e.after) MotionTrail.redraw(main, e.strand.line, e.after);
  if (!e.extra) return;
  for (const x of e.extra) if (x.after) MotionTrail.redraw(main, x.strand.line, x.after);
};

// Write one curve's points into its fat-line geometry. The colour buffer is left alone here:
// recolor owns it and runs every frame, so writing a colour here as well would be one rule in
// two places, disagreeing for a frame each time the playhead moved.
MotionTrail.writeLine = function (main, i, pts) {
  const v = main._trailVis;
  const line = v && v.lines && v.lines[i];
  if (!line || pts.length < 2) return;
  const segs = pts.length - 1;
  const need = segs * 6;
  v.lineState = v.lineState || [];
  const st = v.lineState[i] || (v.lineState[i] = { fresh: true });
  if (!st.pos || st.pos.length !== need) {
    st.pos = new Float32Array(need);
    st.col = new Float32Array(need);
    st.fresh = true;
  }
  const flat = st.flat && st.flat.length === pts.length * 3
    ? st.flat : (st.flat = new Float32Array(pts.length * 3));
  for (let k = 0; k < pts.length; k++) {
    flat[k * 3] = pts[k].x; flat[k * 3 + 1] = pts[k].y; flat[k * 3 + 2] = pts[k].z;
  }
  writePairs(flat, st.pos, pts.length);
  pushFat(main, line, st, st.pos, st.col, segs);
};

export default MotionTrail;
