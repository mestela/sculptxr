import * as THREE from 'three';
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

const SAMPLES = 48;      // along the whole range; the curve is smooth, not the motion
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
function trailTarget(main) {
  const sel = main.getMesh && main.getMesh();
  if (sel && (Skeleton.isJoint(sel) || (sel._isPinTarget && sel._pinnedJoint))) {
    main._trailTarget = sel;
    return sel;
  }
  const held = main._trailTarget;
  if (held && (main.getMeshes() || []).indexOf(held) >= 0) return held;
  main._trailTarget = null;
  return null;
}

function trailed(main) {
  const sel = trailTarget(main);
  if (window._trailTrace) {
    console.log('[trail] target=' + (sel && sel._permanentStaticLabel) +
      ' isBone=' + !!(sel && sel._isBone) + ' isPin=' + !!(sel && sel._isPinTarget) +
      ' pinnedJoint=' + !!(sel && sel._pinnedJoint) +
      ' selection=' + (main.getMesh && main.getMesh() && main.getMesh()._permanentStaticLabel));
  }
  if (sel && Skeleton.isJoint(sel)) return [{ obj: sel, control: false }];
  if (sel && sel._isPinTarget && sel._pinnedJoint) {
    const reg = window._animationRegistry;
    const keyed = !!(reg && reg.tracks && reg.tracks.get(sel.getID()));
    const out = [{ obj: sel._pinnedJoint, control: false }];
    if (keyed) out.unshift({ obj: sel, control: true });
    return out;
  }
  return [];
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
    const m = p.getMatrix();
    sig += 'p' + j.getID() + ':' + m[12].toFixed(4) + ',' + m[13].toFixed(4) + ',' + m[14].toFixed(4) + ';';
    sig += trackSig(reg, p, 'pk');
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
  for (const o of [...(v.lines || []), v.dots, v.keyDots, v.gnomons]) {
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
// Both curves are transparent now, not just the solved one: at 2px and near-opaque the
// authored path competed with the triads sitting on it, and the triads are the thing you are
// reading when they are switched on.
const CONTROL_OPACITY = 0.65;
const OUTPUT_OPACITY = 0.35;

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
const PAST_NEAR   = [0.95, 0.00, 0.45];
const FUTURE_NEAR = [0.00, 0.95, 0.55];
const FAR_GREY    = [0.48, 0.48, 0.48];
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
const AXIS_COL = [[1.00, 0.52, 0.64], [0.62, 0.78, 0.15], [0.50, 0.70, 1.00]];
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
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    depthTest: false,
    alphaToCoverage: false,      // the shader antialiases its own edges; coverage on top of
                                 // that thins a thin line to almost nothing
  }));
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
function pushFat(obj, state, pos, col, segs) {
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
function gnomonLength(main) {
  return (Skeleton.sceneUnit(main) || 1) * 0.0375;
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

MotionTrail.drawGnomons = function (main) {
  const v = main._trailVis;
  const strand = main._trailStrand;
  if (!v || !v.gnomons) return;
  if (!strand || !strand.quats || !Skeleton.displayFlag('gnomons')) {
    v.gnomons.visible = false;
    return;
  }
  const idx = v.keyIndices || [];
  const n = idx.length;
  if (!n) { v.gnomons.visible = false; return; }

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

  const keyTimes = idx.map((i) => strand.times[i]);
  const centre = playheadKeyIndex(keyTimes, now(main));

  let o = 0;
  let verts = 0;
  for (let k = 0; k < idx.length; k++) {
    const scale = 1 - Math.abs(k - centre) / GNOMON_KEY_REACH;
    if (scale <= 0) continue;          // past the reach: not drawn at all, not drawn faintly
    const len = L * scale;
    const i = idx[k];
    const p = strand.points[i];
    const q = strand.quats[i];
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
  const g = v.gnomons.geometry;
  // setPositions rebuilds the instanced attributes, so it is called only when the buffer itself
  // was replaced; otherwise the existing attributes are written in place and flagged.
  if (v.gnomonFresh) {
    g.setPositions(pos);
    g.setColors(col);
    v.gnomonFresh = false;
  } else {
    g.attributes.instanceStart.needsUpdate = true;
    g.attributes.instanceEnd.needsUpdate = true;
    if (g.attributes.instanceColorStart) {
      g.attributes.instanceColorStart.needsUpdate = true;
      g.attributes.instanceColorEnd.needsUpdate = true;
    }
  }
  // The instanced equivalent of a draw range: one instance per SEGMENT, so the keys out of
  // reach are simply not issued.
  g.instanceCount = verts / 2;
  syncResolution(main, v.gnomons.material);
  v.gnomons.visible = true;
};

function makeDots(main, sizePx) {
  const g = Skeleton.overlayGroup(main);
  const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,   // SCREEN pixels — this is the whole difference from the old wall
    map: dotTexture(),
    alphaTest: 0.02,          // discard the fully transparent rim rather than blending it
    vertexColors: true,       // key dots carry the time ramp; sample dots carry identity
    transparent: true,
    depthWrite: false,
    depthTest: false,
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
};

// Dropping the held target is a separate thing from clearing the drawing: turning trails off
// and on again should come back to what you were looking at.
MotionTrail.forget = function (main) {
  main._trailTarget = null;
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
    if (plainCol) { for (let i = 0; i < plainCol.length; i++) plainCol[i] = v.identity[i % 3]; }
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
    v.dots.material.size = DOT_PX * (slot && !slot.key ? HOVER_GROW : 1);
    v.keyDots.material.size = KEY_DOT_PX * (slot && slot.key ? HOVER_GROW : 1);
  }

  // Fat lines want the colour in the same PAIRS layout as the positions: segment i takes the
  // colour of point i at its start and point i+1 at its end, so the gradient runs continuously
  // along the curve rather than stepping at every segment boundary.
  v.lines.forEach((line, i) => {
    const st = v.lineState && v.lineState[i];
    // A drag rewrites positions before the colours catch up; a buffer sized for a different
    // sample count would be written past its end.
    if (!st || !st.col || st.col.length !== (times.length - 1) * 6) return;
    writePairs(col, st.col, times.length);
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
// The gnomons were on the rebuild path and looked simply broken: pressing Key Axes set the flag
// and nothing appeared, because the curve had not changed and so was never redrawn. That is the
// second thing to land on this path for exactly the same reason, which is why there is now one
// entry point rather than a call bolted onto each early return.
MotionTrail.perFrame = function (main) {
  MotionTrail.recolor(main);
  MotionTrail.drawGnomons(main);
};

MotionTrail.update = function (main) {
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
      gnomons: makeGnomons(main),
    };
  }

  // The strand the editor may take hold of: the AUTHORED curve only. Solver output is not
  // editable, so it is never offered — see MotionPathEdit for why.
  const ci = targets.findIndex((t) => t.control);
  main._trailStrand = ci >= 0
    ? { points: paths[ci], quats: paths.quats && paths.quats[ci],
        times: main._trailTimes, pin: targets[ci].obj, line: ci }
    : null;

  const v = main._trailVis;
  v.lineState = v.lineState || paths.map(() => ({ fresh: true }));
  paths.forEach((pts, i) => {
    const line = v.lines[i];
    const tg = targets[i];
    // Both curves take the colour of the JOINT they describe, so a control and its output read
    // as one thing seen two ways rather than as two unrelated curves.
    MotionTrail.writeLine(main, i, pts);
    line.material.opacity = tg.control ? CONTROL_OPACITY : OUTPUT_OPACITY;
    line.visible = pts.length > 1;
    void tg;
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

  const pts = strand.points;
  const isKey = keyMask(main, strand.pin, strand.times);
  const plain = [], keys = [], keyTimes = [], slots = [], keyIndices = [];
  for (let i = 0; i < pts.length; i++) {
    if (isKey[i]) { slots.push({ key: true, i: keys.length }); keys.push(pts[i]); keyTimes.push(strand.times[i]); keyIndices.push(i); }
    else { slots.push({ key: false, i: plain.length }); plain.push(pts[i]); }
  }

  v.dots.geometry.setFromPoints(plain);
  v.keyDots.geometry.setFromPoints(keys);
  v.dots.visible = plain.length > 0;
  v.keyDots.visible = keys.length > 0;

  // SAMPLE dots keep IDENTITY — which control is this. KEY dots carry TIME, because a key is
  // where an edit can actually land, so "which of these is at the playhead, and which side of
  // it is the rest" is the question you are asking of them.
  // Published for recolor, which runs every frame and owns the colours: the identity tint, the
  // key times, and a map from SAMPLE index to which cloud a sample landed in and where. Without
  // that map a preselected sample cannot be found again once the two clouds are split.
  const col = Skeleton.boneColor(main, strand.pin._pinnedJoint);
  const span = (strand.times[strand.times.length - 1] - strand.times[0]) || 1;
  v.identity = [col.r, col.g, col.b];
  v.keyTimes = keyTimes;
  v.slots = slots;
  v.keyIndices = keyIndices;
  v.plainCol = new Float32Array(plain.length * 3);
  v.keyCol = new Float32Array(keyTimes.length * 3);
  // Half a sample spacing counts as "on the playhead": the key and the playhead rarely land on
  // the same float, and a white mark that only appears on exact equality never appears.
  v.nowEps = span / Math.max(1, strand.times.length - 1) * 0.5;
  v.dots.material.opacity = 0.55;
  v.keyDots.material.opacity = 0.95;
  void weights;
};

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
MotionPathEdit.redrawHook = function (main) {
  const e = main._pathEdit;
  if (e && e.after) MotionTrail.redraw(main, e.strand.line, e.after);
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
  pushFat(line, st, st.pos, st.col, segs);
};

export default MotionTrail;
