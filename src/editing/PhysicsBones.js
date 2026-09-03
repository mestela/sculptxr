import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';

// PHYSICS BONES (roadmap #51) — jiggle and follow-through for hair, tails and ears.
//
// matt's own note on this item is the design brief, and the important half of it is not the
// maths: "the springs are the easy half; do not be fooled by them. The hard part is that this is
// an animation tool with a SCRUBBABLE timeline, and a simulation is not reproducible under
// scrubbing: scrub backwards and the sim state is undefined. Every package answers that with
// simulate-then-bake or a cache, so the real item is a sim cache + bake-to-keys workflow, with
// the integrator as the small part."
//
// So the contract is:
//   - the sim runs ONLY while the timeline plays FORWARD, where "the previous frame" means
//     something;
//   - scrubbing shows the un-simulated pose, honestly, rather than a state that depends on how
//     you got there;
//   - BAKE steps the range in order and writes ordinary rotation keys, after which the motion is
//     just animation — scrubbable, editable, saveable, and reproducible because it is no longer a
//     simulation at all.
//
// WHAT MOVES. matt: flagging a joint simulates "that joint and everything below it". A joint's
// position is decided by its PARENT's rotation, so flagging the base of a tail means the base
// joint is the one that rotates and everything below it swings — the flagged joint is the anchor
// and its descendants are the particles.
//
// The integrator is Verlet with a length constraint, which is what every dynamic-bone
// implementation converges on: it is stable at large timesteps, it needs no explicit velocity,
// and the constraint keeps bone lengths exact instead of approximately right.

const PhysicsBones = {};

// Defaults chosen to be visible but not silly on a first press: a tail that clearly lags and
// settles within a second or so.
const DEFAULTS = { stiffness: 0.15, damping: 0.75, gravity: 6 };

PhysicsBones.DEFAULTS = DEFAULTS;

PhysicsBones.isRoot = function (j) { return !!(j && j._physicsRoot); };

PhysicsBones.params = function (j) {
  const p = (j && j._physicsParams) || null;
  return {
    stiffness: p && p.stiffness !== undefined ? p.stiffness : DEFAULTS.stiffness,
    damping:   p && p.damping   !== undefined ? p.damping   : DEFAULTS.damping,
    gravity:   p && p.gravity   !== undefined ? p.gravity   : DEFAULTS.gravity,
  };
};

PhysicsBones.setParams = function (j, patch) {
  if (!j) return false;
  const cur = PhysicsBones.params(j);
  j._physicsParams = {
    stiffness: Math.max(0, Math.min(1, patch.stiffness !== undefined ? patch.stiffness : cur.stiffness)),
    damping:   Math.max(0, Math.min(0.99, patch.damping !== undefined ? patch.damping : cur.damping)),
    gravity:   patch.gravity !== undefined ? patch.gravity : cur.gravity,
  };
  return true;
};

PhysicsBones.setRoot = function (main, j, on) {
  if (!j) return false;
  if (on) {
    j._physicsRoot = true;
    if (!j._physicsParams) j._physicsParams = Object.assign({}, DEFAULTS);
  } else {
    delete j._physicsRoot;
  }
  PhysicsBones.reset(main);
  return true;
};

PhysicsBones.roots = function (main) {
  return Skeleton.joints(main).filter((j) => j._physicsRoot);
};

// Every joint a root governs, nearest first. The root itself is the ANCHOR — it rotates, it does
// not translate — so it is not in the particle list; its children are.
PhysicsBones.chain = function (main, root) {
  const joints = Skeleton.joints(main);
  const kids = new Map();
  for (const j of joints) {
    const p = j._parentMesh;
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(j);
  }
  const out = [];
  const walk = (j, depth) => {
    for (const c of (kids.get(j) || [])) { out.push({ joint: c, parent: j, depth: depth }); walk(c, depth + 1); }
  };
  walk(root, 0);
  out.sort((a, b) => a.depth - b.depth);
  return out;
};

// ── SIM STATE ─────────────────────────────────────────────────────────────────────────
//
// Keyed by joint id and thrown away by reset(). Each particle keeps its OWN world position and
// the one before it — with Verlet that pair IS the velocity, so there is no separate thing to
// keep in step.
//
// THE PARTICLE'S POSITION IS ITS OWN, NOT THE RIG'S, and that is the whole mechanism. When the
// body moves, the hierarchy drags the tail's joints along rigidly; if the integrator read its
// current position back off the rig each frame it would see that displacement as VELOCITY and
// carry it further — the tail would overshoot ahead of the body instead of trailing behind it.
// Measured, on a one-unit yank: the tip led the anchor by 2.03 instead of lagging at 0.6.
// Keeping `p` across frames is what makes inertia mean anything.
let _state = new Map();
let _lastTime = null;

PhysicsBones.reset = function (main) {
  _state = new Map();
  _lastTime = null;
  if (!main) return;
  // Seed from wherever the rig is right now, so the first step has a sensible "previous frame"
  // and the chain does not detonate out of a cold start.
  for (const root of PhysicsBones.roots(main)) {
    for (const link of PhysicsBones.chain(main, root)) {
      const at = Skeleton.jointPos(link.joint).clone();
      _state.set(link.joint.getID(), { p: at.clone(), prev: at.clone() });
    }
  }
};

PhysicsBones.isSettled = function () { return _state.size > 0; };

const _pAnim = new THREE.Vector3(), _pPar = new THREE.Vector3(), _pCur = new THREE.Vector3();
const _vel = new THREE.Vector3(), _next = new THREE.Vector3(), _dir = new THREE.Vector3();
const _aimA = new THREE.Vector3(), _aimB = new THREE.Vector3(), _qAim = new THREE.Quaternion();
const _pRig = new THREE.Vector3();

// ONE STEP. `dt` is a real timestep in seconds and is clamped: a dropped frame or a paused tab
// otherwise hands the integrator a dt large enough to throw the chain into orbit, and the user
// reads that as the feature being broken rather than as their machine hiccupping.
PhysicsBones.step = function (main, dt) {
  const roots = PhysicsBones.roots(main);
  if (!roots.length) return 0;
  const h = Math.max(1 / 240, Math.min(1 / 20, dt || 1 / 60));
  let moved = 0;

  for (const root of roots) {
    const par = PhysicsBones.params(root);
    const links = PhysicsBones.chain(main, root);
    if (!links.length) continue;

    // THE ANIMATED POSE IS CAPTURED FIRST, all of it, before anything is written. Each write
    // rotates a joint and therefore moves every joint below it, so a target read after the first
    // write would be a target measured against a pose that is already half simulated.
    const target = new Map();
    for (const link of links) target.set(link.joint.getID(), Skeleton.jointPos(link.joint).clone());

    for (const link of links) {
      const j = link.joint;
      const id = j.getID();
      let st = _state.get(id);
      if (!st) { st = { p: target.get(id).clone(), prev: target.get(id).clone() }; _state.set(id, st); }

      _pAnim.copy(target.get(id));
      Skeleton.jointPos(link.parent, _pPar);        // already written this frame, so it is live
      _pCur.copy(st.p);                             // the PARTICLE's position, not the rig's

      // Verlet: the step the particle took last frame, damped, carried forward.
      _vel.subVectors(_pCur, st.prev).multiplyScalar(1 - par.damping);
      _next.copy(_pCur).add(_vel);
      _next.y -= par.gravity * h * h;               // gravity, in the same units the rig is in

      // Spring back toward where the animation wanted this joint. Stiffness 1 is "no physics at
      // all", 0 is "no memory of the pose", and the useful range is near the bottom.
      _next.lerp(_pAnim, par.stiffness);

      // LENGTH IS A HARD CONSTRAINT, not a spring. A bone that stretches reads as broken
      // immediately, and the skin is built assuming the length it was rigged with.
      const rest = _pPar.distanceTo(_pAnim);
      _dir.subVectors(_next, _pPar);
      if (_dir.lengthSq() < 1e-12) continue;         // sitting on its own parent: nothing to aim
      _dir.normalize();
      _next.copy(_pPar).addScaledVector(_dir, rest);

      // Turn the position into the parent's rotation — the only thing that can actually move a
      // joint — via the solver's own primitive, so both write a joint the same way.
      // Aim from where the joint ACTUALLY is — the rig has already dragged it this frame — to
      // where the particle wants it. The rotation is the correction between those two.
      Skeleton.jointPos(j, _pRig);
      _aimA.subVectors(_pRig, _pPar);
      _aimB.subVectors(_next, _pPar);
      if (_aimA.lengthSq() > 1e-12 && _aimB.lengthSq() > 1e-12) {
        _qAim.setFromUnitVectors(_aimA.normalize(), _aimB.normalize());
        IKSolver.rotateJoint(link.parent, _qAim);
        moved++;
      }
      // Carry the particle forward. Read back from the rig rather than trusting `_next`: the aim
      // is a rotation about the parent, so where the joint lands is the truth, and a particle
      // that drifted from it would fight the constraint every frame after.
      st.prev.copy(st.p);
      Skeleton.jointPos(j, st.p);
    }
  }
  return moved;
};

// Advance to a wall-clock time, so the caller does not have to keep its own dt. Returns false
// when there is nothing to do, which is also the "not playing forward" case.
PhysicsBones.tick = function (main, nowSeconds) {
  if (!PhysicsBones.roots(main).length) return false;
  const t = nowSeconds === undefined ? performance.now() / 1000 : nowSeconds;
  const dt = _lastTime === null ? 1 / 60 : t - _lastTime;
  _lastTime = t;
  if (dt <= 0) return false;
  PhysicsBones.step(main, dt);
  return true;
};

// ── BAKE ──────────────────────────────────────────────────────────────────────────────
//
// THE POINT OF THE WHOLE FEATURE, per matt's own note. A simulation cannot be scrubbed; keys can.
// So this steps the range in order, runs the sim frame by frame, and writes ordinary transform
// keys onto the joints the sim rotates. Afterwards there is no simulation left to be
// non-reproducible — it is animation like any other, and it saves, scrubs and edits.
//
// WHICH JOINTS GET KEYS: the ones that ROTATE, which is each particle's PARENT — the flagged
// root and every non-leaf below it. A leaf's own rotation is not determined by anything here.
//
// PRE-ROLL, because a sim that starts cold snaps on the first frame: the chain begins at the
// animated pose with no velocity, and whatever the rig is doing at the range start hits it all at
// once. Stepping the start pose a few times first lets it settle into that pose, which is what
// every package does and what makes a loop start where it ends.
PhysicsBones.bake = function (main, opts) {
  const o = opts || {};
  const reg = window._animationRegistry;
  if (!reg) return { baked: 0, reason: 'no animation registry' };
  const roots = PhysicsBones.roots(main);
  if (!roots.length) return { baked: 0, reason: 'no physics bones flagged' };

  const fps = o.fps || window._animFps || 24;
  const start = o.start !== undefined ? o.start : (window._animLoopStart ?? 0);
  const end = o.end !== undefined ? o.end
    : (window._animLoopEnd ?? window._animMasterDuration ?? 0);
  if (!(end > start)) return { baked: 0, reason: 'the loop range is empty' };

  // Every joint this bake will write, deduped: a joint can be the parent of two particles.
  const writes = [];
  const seen = new Set();
  for (const root of roots) {
    for (const link of PhysicsBones.chain(main, root)) {
      if (seen.has(link.parent.getID())) continue;
      seen.add(link.parent.getID());
      writes.push(link.parent);
    }
  }
  if (!writes.length) return { baked: 0, reason: 'a flagged joint with nothing below it' };

  const before = writes.map((m) => [m, reg._snapshotTrack(reg._ensureTransformTrack(m.getID()))]);
  const wasPlaying = window._animPlaying;
  const wasTime = reg.globalPlaybackTime;
  window._animPlaying = false;

  const evaluateAt = (t) => {
    reg.globalPlaybackTime = t;
    window._animCurrentTime = t;
    for (const m of main.getMeshes()) reg.update(m, true);
  };

  const h = 1 / fps;
  PhysicsBones.reset(main);
  evaluateAt(start);
  const preroll = o.preroll === undefined ? 30 : o.preroll;
  for (let i = 0; i < preroll; i++) PhysicsBones.step(main, h);

  let frames = 0;
  for (let t = start; t <= end + 1e-6; t += h) {
    evaluateAt(t);                       // the keyed pose for this frame...
    PhysicsBones.step(main, h);          // ...then the sim on top of it
    for (const m of writes) reg._writeTransformKey(m, t);
    frames++;
  }
  reg._stampKeyTime?.(end);

  const after = writes.map((m) => [m, reg._snapshotTrack(reg.tracks.get(m.getID()))]);
  const apply = (snaps) => {
    for (const [mesh, snap] of snaps) {
      const tr = reg.tracks.get(mesh.getID());
      if (tr) reg._restoreTrack(tr, snap, null);
    }
    PhysicsBones.reset(main);
    window.app?.render?.();
  };
  window.app?.getStateManager?.()?.pushStateCustom?.(
    () => apply(before), () => apply(after), false, 'Bake Physics Bones');

  reg.globalPlaybackTime = wasTime;
  window._animPlaying = wasPlaying;
  evaluateAt(wasTime || start);
  PhysicsBones.reset(main);
  return { baked: writes.length, frames: frames, from: start, to: end, fps: fps };
};

export default PhysicsBones;
