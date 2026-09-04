// Node harness for PHYSICS BONES (roadmap #51) — the integrator and the chain rules.
//
// matt's note on the item: "the springs are the easy half; do not be fooled by them." That is
// true of the FEATURE and not of the code — the springs are still where a sign error or a
// missing constraint hides, and they are the part that can be checked without a headset. What
// cannot be checked here is whether the jiggle looks good, which is matt's job and the reason
// the live preview exists.
//
// Same stubbed-import trick as the other harnesses: the real PhysicsBones runs, with a mock rig
// underneath it made of joints that are just positions and parents.
//
// Run: node scratchpad/physicsbones_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/PhysicsBones.js'), 'utf8');

// A mock rig with REAL forward kinematics, because the module now stores and restores joint
// MATRICES — "put the rest pose back unless something else has written it" cannot be tested
// against a mock that only has world positions. So a joint here is a local offset plus a local
// rotation, exactly as the app's joints are, and world position is an FK walk.
const prelude = `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
const window = { _animationRegistry: null };
const _all = [];
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const _vT = new THREE.Vector3(), _qT = new THREE.Quaternion(), _sT = new THREE.Vector3();

// World matrix by walking up the chain, exactly as the app's getModelSpaceMatrix does.
function worldMat(j, out) {
  out.identity();
  const up = [];
  for (let n = j; n; n = n._parentMesh) up.push(n);
  for (let i = up.length - 1; i >= 0; i--) {
    _mB.fromArray(up[i]._mat);
    out.multiply(_mB);
  }
  return out;
}

const Skeleton = {
  joints: () => _all,
  jointPos: (j, out) => {
    out = out || new THREE.Vector3();
    worldMat(j, _mA);
    return out.setFromMatrixPosition(_mA);
  },
  sceneUnit: () => 2,
  syncThree: () => {},
};
const IKSolver = {
  // The real one carries a MODEL-space rotation into the joint's local frame. The fixtures here
  // have no rotated ancestors, where those two coincide — which is why the checks below are
  // about the integrator and the rest-pose bookkeeping, not about frame conversion.
  rotateJoint: (joint, q) => {
    _mA.fromArray(joint._mat);
    _mA.decompose(_vT, _qT, _sT);
    _qT.premultiply(q);
    _mA.compose(_vT, _qT, _sT);
    for (let i = 0; i < 16; i++) joint._mat[i] = _mA.elements[i];
  },
};
export { _all, Skeleton, window as win };
`;
const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_physicsbones_gen.mjs');
fs.writeFileSync(out, prelude + '\n' + body + '\nexport default PhysicsBones;\n');
const M = await import(out + '?v=' + Date.now());
const PB = M.default;
const ALL = M._all;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let nextId = 1;
const M4 = new THREE.Matrix4();
// A joint is a LOCAL matrix, as in the app. The offset is relative to the parent so the rig is a
// real chain: rotating a joint moves everything below it, which is the only way this module can
// move anything at all.
const J = (x, y, z, parent) => {
  const px = parent ? parent._abs[0] : 0, py = parent ? parent._abs[1] : 0, pz = parent ? parent._abs[2] : 0;
  M4.identity().setPosition(x - px, y - py, z - pz);
  const j = {
    _id: nextId++, _parentMesh: parent || null, _abs: [x, y, z],
    _mat: Array.from(M4.elements),
    getID() { return this._id; },
    getMatrix() { return this._mat; },
  };
  ALL.push(j);
  return j;
};
const wp = (j) => M.Skeleton.jointPos(j, new THREE.Vector3());
// Move a joint's local offset — what "the animation moved the body" looks like from here.
const setLocal = (j, x, y, z) => { j._mat[12] = x; j._mat[13] = y; j._mat[14] = z; };
const rig = () => {
  ALL.length = 0; nextId = 1;
  const body_ = J(0, 0, 0);            // the thing the tail hangs off
  const t0 = J(0, -1, 0, body_);       // tail base — the flagged joint
  const t1 = J(0, -2, 0, t0);
  const t2 = J(0, -3, 0, t1);
  return { body: body_, t0, t1, t2 };
};
const len = (a, b) => wp(a).distanceTo(wp(b));

// ── A CHAIN IS THE FLAGGED JOINT'S DESCENDANTS ────────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  const links = PB.chain({ }, r.t0);
  check('the chain is everything below the flagged joint',
    links.length === 2 && links[0].joint === r.t1,
    links.length + ' links');
  check('...ordered nearest first, so a parent is written before its child',
    links.every((l, i) => i === 0 || l.depth >= links[i - 1].depth));
  check('...and the flagged joint itself is the anchor, not a particle',
    !links.some((l) => l.joint === r.t0),
    'a joint is moved by its PARENT rotating, so flagging the tail base means the BASE rotates');
}

// ── GRAVITY MAKES A STATIONARY TAIL HANG ──────────────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.02, damping: 0.1, gravity: 10 });
  // Start it horizontal, which is the shape that has somewhere to fall to.
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);   // lay the tail out horizontally
  const main = {};
  PB.reset(main);
  const y0 = wp(r.t2).y;
  for (let i = 0; i < 120; i++) PB.step(main, 1 / 60);
  check('a horizontal tail falls under gravity', wp(r.t2).y < y0 - 0.2,
    'tip y went ' + y0.toFixed(2) + ' -> ' + wp(r.t2).y.toFixed(2));
}

// ── BONE LENGTH IS A HARD CONSTRAINT ──────────────────────────────────────────────────
//
// A stretching bone reads as broken instantly, and the skin was built assuming the rigged
// length. This is the check most likely to catch a future change to the integrator.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.01, damping: 0.0, gravity: 40 });
  const main = {};
  PB.reset(main);
  const l1 = len(r.t0, r.t1), l2 = len(r.t1, r.t2);
  for (let i = 0; i < 200; i++) {
    setLocal(r.body, Math.sin(i * 0.3) * 2, 0, 0);   // shake the thing it hangs off, hard
    PB.step(main, 1 / 60);
  }
  check('bone lengths survive a violent shake',
    Math.abs(len(r.t0, r.t1) - l1) < 1e-6 && Math.abs(len(r.t1, r.t2) - l2) < 1e-6,
    l1.toFixed(4) + '/' + l2.toFixed(4) + ' -> '
    + len(r.t0, r.t1).toFixed(4) + '/' + len(r.t1, r.t2).toFixed(4));
  check('...and the chain stays finite',
    [r.t1, r.t2].every((j) => Number.isFinite(wp(j).x + wp(j).y + wp(j).z)),
    'a Verlet chain with no damping is exactly where a blow-up would show');
}

// ── STIFFNESS 1 IS "NO PHYSICS" ───────────────────────────────────────────────────────
//
// The escape hatch has to be exact, or there is no way to tell the feature off from the feature
// misbehaving.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 1, damping: 0.5, gravity: 10 });
  const main = {};
  PB.reset(main);
  const p1 = wp(r.t1), p2 = wp(r.t2);
  for (let i = 0; i < 60; i++) PB.step(main, 1 / 60);
  check('stiffness 1 leaves the animated pose exactly alone',
    wp(r.t1).distanceTo(p1) < 1e-9 && wp(r.t2).distanceTo(p2) < 1e-9,
    'moved ' + wp(r.t2).distanceTo(p2).toExponential(2));
}

// ── IT LAGS, WHICH IS THE WHOLE POINT ─────────────────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.1, damping: 0.6, gravity: 0 });
  const main = {};
  PB.reset(main);
  // Yank the anchor sideways in one frame and look at whether the tip followed immediately.
  setLocal(r.body, 1, 0, 0);                          // the rig moves rigidly...
  PB.step(main, 1 / 60);                               // ...and the sim should resist
  check('the tip lags behind a sudden move of its anchor', wp(r.t2).x < 1,
    'tip x = ' + wp(r.t2).x.toFixed(3) + ' after the anchor jumped to 1');
}

// ── A DROPPED FRAME MUST NOT DETONATE THE CHAIN ───────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.3, gravity: 10 });
  const main = {};
  PB.reset(main);
  PB.step(main, 4.0);            // a paused tab, or a breakpoint
  check('a four-second timestep is clamped, not integrated',
    [r.t1, r.t2].every((j) => Number.isFinite(wp(j).length()) && wp(j).length() < 20),
    'tip at ' + wp(r.t2).length().toFixed(2));
}

// ── NO ROOTS, NO WORK ─────────────────────────────────────────────────────────────────
{
  rig();
  const main = {};
  PB.reset(main);
  check('a rig with nothing flagged does nothing', PB.step(main, 1 / 60) === 0);
}

// ── THE SAME SETTINGS MUST DRAPE THE SAME AT ANY FRAMERATE ────────────────────────────
//
// Stiffness and damping are per-frame factors, and a per-frame factor means something different
// at a different rate. The live preview runs at 60 and a bake runs at the timeline's fps, so
// before this was normalised the same tail sagged 6.25x further in a 24fps bake than in the
// preview it was tuned against — which makes "tune it live, then bake it" a lie, and that
// workflow is the entire feature.
{
  const settle = (fps, seconds) => {
    const r = rig();
    PB.setRoot(null, r.t0, true);
    PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1 });
    setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);   // lay the tail out horizontally      // horizontal, with somewhere to fall
    const main = {};
    PB.reset(main);
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) PB.step(main, 1 / fps);
    return wp(r.t2).y;
  };
  const at60 = settle(60, 3), at24 = settle(24, 3), at120 = settle(120, 3);
  const spread = Math.max(at60, at24, at120) - Math.min(at60, at24, at120);
  check('three seconds of sag is the same at 24, 60 and 120fps',
    spread < 0.05,
    'tip y: 24fps ' + at24.toFixed(3) + ', 60fps ' + at60.toFixed(3)
    + ', 120fps ' + at120.toFixed(3) + ' — spread ' + spread.toFixed(3));
  check('...and it actually sagged, so the check is measuring something',
    at60 < -1.3, 'tip y ' + at60.toFixed(3) + ' from a start of -1');
}

// ── GRAVITY IS A MULTIPLE OF EARTH, SCALED TO THE RIG ─────────────────────────────────
//
// matt: "is there gravity? they don't seem to drape much." There was — an absolute 6 units/s^2
// on a rig with twelve-unit bones, which settles to a sag of about a hundredth of a unit. A rig
// has no unit system, so the only gravity that means anything is one scaled by how big the rig
// is drawn.
{
  check('gravity tracks the size of the scene',
    Math.abs(PB.gravityUnits({}, 1) - 9.8) < 1e-6,
    'sceneUnit 2 (a two-unit character) should put gravity 1 at 9.8: got '
    + PB.gravityUnits({}, 1).toFixed(3));
  check('...and doubles when you ask for twice earth',
    Math.abs(PB.gravityUnits({}, 2) - 19.6) < 1e-6);
}

// ── THE REST POSE IS REMEMBERED ───────────────────────────────────────────────────────
//
// matt: "i assumed when i turned the stiffness slider up, it would start to spring back to its
// original position, but it didn't. i assume the physics bone isn't storing a rest angle/position
// before being activated, it should."
//
// He was exactly right. The spring pulled toward the pose read off the RIG, which already
// contained the previous frame's physics — so the target fell with the chain, there was no
// restoring force, and turning stiffness up only froze it where it had landed. Measured on
// skel04 before the fix: at stiffness 0.95 the tip sat 6.77 units from rest and did not move.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);       // horizontal, with somewhere to fall
  const main = {};
  PB.reset(main);
  const rest = wp(r.t2);
  for (let i = 0; i < 180; i++) PB.step(main, 1 / 60);
  const fell = wp(r.t2);
  check('a soft chain falls away from its rest pose', fell.distanceTo(rest) > 0.5,
    'moved ' + fell.distanceTo(rest).toFixed(2));

  PB.setParams(r.t0, { stiffness: 0.98 });
  for (let i = 0; i < 240; i++) PB.step(main, 1 / 60);
  const back = wp(r.t2);
  check('...and a stiff one springs back to it',
    back.distanceTo(rest) < 0.25,
    'ended ' + back.distanceTo(rest).toFixed(2) + ' from rest, having fallen '
    + fell.distanceTo(rest).toFixed(2) + ' — if this does not shrink, the rest pose is not stored');
}

// ── ...AND THE ANIMATION STILL WINS ───────────────────────────────────────────────────
//
// The other half of the same rule, and the one that is easy to break while fixing the first:
// during playback the animation writes every joint every frame, and restoring a saved rest pose
// there would quietly undo the keys. The saved pose only stands while the joint is exactly where
// the sim left it; anything else that writes — a key, a gizmo, an undo — is adopted as the new
// rest without knowing this exists.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  const main = {};
  PB.reset(main);
  for (let i = 0; i < 60; i++) PB.step(main, 1 / 60);
  // "The animation" writes the flagged joint to a new pose, as a keyed take would.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, -1, 0), q, new THREE.Vector3(1, 1, 1));
  for (let k = 0; k < 16; k++) r.t0._mat[k] = m.elements[k];
  const posed = wp(r.t2);
  PB.setParams(r.t0, { stiffness: 0.98 });
  for (let i = 0; i < 240; i++) PB.step(main, 1 / 60);
  const after = wp(r.t2);
  check('a pose written by something else becomes the new rest',
    after.distanceTo(posed) < 0.4,
    'the chain settled ' + after.distanceTo(posed).toFixed(2) + ' from the NEW pose — restoring '
    + 'a stale rest here would undo the animation every frame');
}

// ── GROUND, AND DRAG ──────────────────────────────────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.02, damping: 0.2, gravity: 2, drag: 0, ground: true, groundY: -2.5 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
  const main = {};
  PB.reset(main);
  let lowest = 0;
  for (let i = 0; i < 300; i++) { PB.step(main, 1 / 60); lowest = Math.min(lowest, wp(r.t2).y); }
  check('a chain with ground collision does not go through the floor',
    lowest > -2.5 - 1e-6, 'lowest tip y was ' + lowest.toFixed(3) + ' against a floor at -2.5');

  // Drag bites on SPEED, so it shows up in how far a whipped chain travels, not in where a
  // slow one settles. That distinction is the reason it is a separate control from damping.
  const whip = (drag) => {
    const rr = rig();
    PB.setRoot(null, rr.t0, true);
    // maxBend off, inertia off: the bend limit caps the excursion before drag can change it,
    // and with both on the two runs land on the clamp and read identical. Isolating one thing
    // at a time is the point of a fixture.
    PB.setParams(rr.t0, { stiffness: 0.02, damping: 0.05, gravity: 0, drag: drag,
      maxBend: 180, inertia: 0 });
    const mn = {};
    PB.reset(mn);
    let far = 0;
    for (let i = 0; i < 120; i++) {
      setLocal(rr.body, Math.sin(i * 0.35) * 3, 0, 0);
      PB.step(mn, 1 / 60);
      far = Math.max(far, Math.abs(wp(rr.t2).x));
    }
    return far;
  };
  const loose = whip(0), dragged = whip(0.9);
  check('drag reins in a fast whip', dragged < loose - 0.05,
    'tip reached ' + loose.toFixed(2) + ' with no drag, ' + dragged.toFixed(2) + ' with it');
}

// ── A RESET MUST NOT BAKE IN THE SAG ──────────────────────────────────────────────────
//
// matt: "each time i do this to any of the joints in the skeleton, not just physics joints, the
// physics joints sag a little. if i select 10 things in a row, the antenna that used to point
// straight to the sides now hang straight down."
//
// Selecting with Tweak Free raises the rig-edit flag, which resets the sim — and a reset used to
// throw the state away and let the next step re-capture the rest pose from wherever the rig
// happened to be, which mid-sag is the SAGGED pose. Every reset therefore enshrined however far
// the chain had fallen. Measured before the fix: 0.16 units per reset, dead linear over ten.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
  const main = {};
  PB.reset(main);
  const rest = wp(r.t2);
  const drift = [];
  for (let sel = 0; sel < 10; sel++) {
    for (let i = 0; i < 20; i++) PB.step(main, 1 / 60);
    PB.reset(main);                                   // what a selection does
    drift.push(wp(r.t2).distanceTo(rest));
  }
  check('ten resets do not move the chain at all',
    drift[9] < 1e-6,
    'drifted ' + drift.map((d) => d.toFixed(2)).join(', ')
    + ' — a linear ramp here means every reset is adopting the sag');
  check('...and a reset puts the chain back where it started',
    wp(r.t2).distanceTo(rest) < 1e-6,
    'a reset is meant to undo the physics, not to keep it');
}

// ── ...WITHOUT UNDOING SOMEBODY ELSE'S WRITE ──────────────────────────────────────────
//
// The other half, and the one that would be easy to break while fixing the first: if the
// animation or a hand pose has written the joint since the sim last did, THAT is the pose now
// and putting the older one back would quietly undo it.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  const main = {};
  PB.reset(main);
  for (let i = 0; i < 40; i++) PB.step(main, 1 / 60);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, -1, 0), q, new THREE.Vector3(1, 1, 1));
  for (let k = 0; k < 16; k++) r.t0._mat[k] = m.elements[k];
  const posed = wp(r.t2);
  PB.reset(main);
  check('a reset leaves a pose written by something else alone',
    wp(r.t2).distanceTo(posed) < 1e-6,
    'moved ' + wp(r.t2).distanceTo(posed).toFixed(3) + ' — restoring a stale pose here would '
    + 'undo the animation');
}

// ── THE BLEND WEIGHT (roadmap #48's scalar channel) ───────────────────────────────────
//
// How much the physics applies, keyable over time: 1 is full jiggle, 0 is the animated pose
// exactly, and in between the joint sits proportionally between the two. It is what lets a tail
// be floppy through a shot and locked for the beat where it has to hit a mark, and it rides the
// generic keyable scalar built for pin weights rather than a bespoke number of its own.
{
  const settle = (w) => {
    const r = rig();
    PB.setRoot(null, r.t0, true);
    PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0, inertia: 0, maxBend: 180 });
    setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
    // A fake registry answering the scalar channel, which is all PhysicsBones asks of it.
    M.win._animationRegistry = { globalPlaybackTime: 0,
      scalarAt: (mesh, name, t, dflt) => (name === PB.WEIGHT ? w : dflt) };
    const main = {};
    const rest = wp(r.t2);
    PB.reset(main);
    for (let i = 0; i < 180; i++) PB.step(main, 1 / 60);
    const moved = wp(r.t2).distanceTo(rest);
    M.win._animationRegistry = null;
    return moved;
  };

  const full = settle(1), half = settle(0.5), off = settle(0);
  check('weight 0 leaves the animated pose exactly alone', off < 1e-6,
    'moved ' + off.toFixed(6) + ' — 0 has to mean OFF, or there is no way to key a chain still');
  check('weight 1 is the full jiggle', full > 0.5, 'moved ' + full.toFixed(2));
  check('...and a half weight lands between the two',
    half > off + 0.05 && half < full - 0.05,
    'off ' + off.toFixed(2) + ', half ' + half.toFixed(2) + ', full ' + full.toFixed(2));

  // The end-snap, which pin weight documents and this inherits: the scalar evaluator solves a
  // Bezier iteratively, so a key valued exactly 1 reads about 0.9990 at its own key time.
  M.win._animationRegistry = { globalPlaybackTime: 0, scalarAt: () => 0.999 };
  check('a key of 1 that evaluates to 0.999 still means fully on',
    PB.weight({ getID: () => 1 }) === 1,
    'left alone that is a chain keyed as ON which is fractionally damped for ever');
  M.win._animationRegistry = { globalPlaybackTime: 0, scalarAt: () => 0.004 };
  check('...and 0.004 means fully off', PB.weight({ getID: () => 1 }) === 0);
  M.win._animationRegistry = null;
  check('...and with no registry at all it is fully on',
    PB.weight({ getID: () => 1 }) === 1,
    'a rig with no animation must not be silently unsimulated');
}

// ── THE REST POSE OUTLIVES A RESET ────────────────────────────────────────────────────
//
// reset() throws `_state` away, and a seek runs reset on every frame you land on. With the rest
// pose held only in that map, the next step found it missing and captured it fresh from the pose
// it was looking at -- which was the pose physics had just bent. The bend became the rest, the
// rest became the spring's target, and the chain never came back. matt: "the arm position is
// offset and crumpled; its not able to go back to its bind pose at frame 1". Measured on
// walkwave.sxr, scrubbing to frame 109 and back: 10 of 16 physics joints failed to return to
// their frame-1 local pose (0 of 16 with physics off, which is what named physics as the cause).
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
  const main = {};
  PB.reset(main);
  const rest = wp(r.t2);
  for (let i = 0; i < 120; i++) PB.step(main, 1 / 60);
  check('a chain bends away from rest before the reset', wp(r.t2).distanceTo(rest) > 0.5);

  // The seek: reset wipes the state, then the sim runs again from the pose it was left in.
  PB.reset(main);
  for (let i = 0; i < 120; i++) PB.step(main, 1 / 60);
  PB.reset(main);
  const back = wp(r.t2);
  check('...and a reset after a second run still returns it to the ORIGINAL rest',
    back.distanceTo(rest) < 0.05,
    'ended ' + back.distanceTo(rest).toFixed(3) + ' from the original rest -- the bent pose was '
    + 'adopted as the new rest when the state map was wiped');
}

// ── THE INIT FRAME ────────────────────────────────────────────────────────────────────
//
// A loop is a cut. The playhead jumps from one end of the range to the other and the sim has no
// way to know it: its particles carry the pose and velocity from the loop's LAST frame into the
// next pass's first one. matt: "it almost worked on the first playback, but every subsequent
// loop it was in the incorrect position again... usually with solvers its a given that on frame
// 1 the system has to reinitialise itself."
//
// Consumed in tick, NOT at the wrap, because tick runs after the animation has written the
// loop-start frame -- so reset seeds the particles from the pose they actually start on.
// Resetting at the wrap seeds them from the pose still on screen (the loop's last frame) and
// measured WORSE than no reset at all: 48.7 units of error on pass two against 47.0.
check('the sim re-initialises on the frame after a loop wrap',
  /if \(window\._physicsNeedsInit\) \{[\s\S]{0,200}?PhysicsBones\.reset\(main\);/.test(SRC),
  'every pass after the first starts from wherever the previous pass finished');
check('...and drops the accumulated clock, so no dt is integrated across the cut',
  /window\._physicsNeedsInit = false;[\s\S]{0,160}?_lastTime = null;/.test(SRC));

// ── A SOLVE IS NOT AN AUTHORED POSE ───────────────────────────────────────────────────
//
// The rest rule adopts the current pose whenever something OTHER than the sim wrote the joint --
// right for a key, a gizmo or an undo. But the IK solver writes every joint on a path from an
// active pin to the root, so the moment a wrist pin came on, the whole arm counted as authored
// and the SOLVED pose became the chain's rest for ever after. A rewind then restored the waving
// arm as though it were bind. Measured on weight.sxr, one pass then rewind to frame 0: the
// pinned right arm sat 2.52 units off while the three unpinned chains returned to 0.
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
  const main = {};
  PB.reset(main);
  const rest = wp(r.t2);
  for (let i = 0; i < 60; i++) PB.step(main, 1 / 60);

  // The solver poses the chain and says so, exactly as holdPins now does.
  M.win._ikOwnedIds = new Set([r.t0.getID(), r.t1.getID()]);
  setLocal(r.t1, 0, 1, 0);                       // a solve, not an authored rest
  for (let i = 0; i < 60; i++) PB.step(main, 1 / 60);
  M.win._ikOwnedIds = null;

  PB.reset(main);
  const back = wp(r.t2);
  check('a solver-posed joint is not adopted as the physics rest',
    back.distanceTo(rest) < 0.25,
    'ended ' + back.distanceTo(rest).toFixed(3) + ' from the original rest -- the solved pose '
    + 'was taken as the new rest, so a rewind restores the posed limb instead of the bind one');
}

// ── XPBD ──────────────────────────────────────────────────────────────────────────────
//
// The same chains solved as constraints, so a pin can be an attachment with a compliance instead
// of a limb being switched into the IK solve on one frame. matt: "vellum in houdini is based on
// xpbd is also friendly to constraints and soft weighting... can our physics system be pushed
// along similar lines?" Measured on weight.sxr over a twelve-frame pin fade, worst frame:
// 20.7 units with the force solver, 2.3 with this one.
// A window flag is wiped by a page load, and reloading the scene is exactly what you do to test
// a solver on a rig -- so the choice has to persist or the test silently runs the old solver.
check('...and the choice survives a reload',
  /localStorage\.getItem\('sxr_physXPBD'\) === '1'/.test(SRC)
    && /localStorage\.setItem\('sxr_physXPBD', on \? '1' : '0'\)/.test(SRC),
  'setting the flag and reloading puts you back on the force solver without saying so');
check('...reachable from the console without an import',
  /window\.physXPBD = PhysicsBones\.setSolver;/.test(SRC));

check('the constraint solver is behind a flag, with the force solver kept',
  /if \(window\._physXPBD\) PhysicsBones\.stepXPBD\(main, dt\);\s*\n\s*else PhysicsBones\.step\(main, dt\);/.test(SRC),
  'both must run side by side while they are being compared');
// Small substeps, one iteration each -- the modern formulation, and cheaper than few steps with
// many iterations for chains this short.
check('...substepped, with compliance divided by h squared',
  /const h = frameH \/ N;/.test(SRC) && /const aT = alpha \/ \(h \* h\);/.test(SRC),
  'compliance that is not scaled by the step is a stiffness that changes with frame rate');
// One-sided was the first thing written and it made the pin useless: the constraint pulled the
// wrist and the next line projected it back onto a parent that never learned anything had asked.
check('...with a TWO-SIDED length constraint, so a pull at the tip travels up the chain',
  /function solveDistance\(pPar, p, wPar, w, rest\)/.test(SRC)
    && /pPar\.addScaledVector\(_xDir, \(wPar \/ wsum\) \* C\);/.test(SRC),
  'a goal at the tip cannot reach the joints above it, and the arm barely moves');
check('...and the pin solved LAST, so a full-strength pin is not overruled by the bone length',
  SRC.indexOf('THE PIN, as an attachment constraint') > SRC.indexOf('BONE LENGTH, hard, swept down'),
  'the hand settles a constant distance short of the pin whatever the compliance');
// weight 0 is not a weak pin, it is no constraint at all -- an infinite compliance.
check('...a weight of 0 is an infinite compliance, not a weak one',
  /if \(v <= 0\) return Infinity;/.test(SRC) && /if \(!isFinite\(alpha\)\) return;/.test(SRC)
    || /if \(C < 1e-9 \|\| !isFinite\(alpha\)\) return;/.test(SRC));
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.05, damping: 0.6, gravity: 1, drag: 0 });
  setLocal(r.t1, 1, 0, 0); setLocal(r.t2, 1, 0, 0);
  const main = {};
  PB.reset(main);
  const rest = wp(r.t2);
  const before = r.t1.getMatrix().slice();
  for (let i = 0; i < 120; i++) PB.stepXPBD(main, 1 / 60);
  const fell = wp(r.t2).distanceTo(rest);
  check('a soft chain falls under the constraint solver too', fell > 0.5,
    'moved ' + fell.toFixed(2));
  // The bone cannot stretch: that is the one constraint with no compliance at all.
  const p1 = wp(r.t1), p2 = wp(r.t2);
  check('...without stretching a bone', Math.abs(p1.distanceTo(p2) - 1) < 0.02,
    'length came out ' + p1.distanceTo(p2).toFixed(3) + ', should be 1');
  void before;
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
