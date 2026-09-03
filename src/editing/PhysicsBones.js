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

// Defaults chosen to be visible but not silly on a first press: a tail that clearly lags, drapes
// under its own weight, and settles within a second or so.
//
// GRAVITY IS A MULTIPLE OF EARTH, not a number of units per second squared. The rig has no unit
// system — a character is forty units tall because that is how it got drawn — so an absolute
// gravity means something different on every rig, and the first version's 6 produced an
// equilibrium sag of ELEVEN THOUSANDTHS of a unit on a rig with twelve-unit bones. matt: "is
// there gravity? they don't seem to drape much." There was; it was about a thousand times too
// small to see. It is scaled by Skeleton.sceneUnit now, so 1 drapes the same way whatever size
// the rig was drawn at.
const DEFAULTS = { stiffness: 0.25, damping: 0.7, gravity: 1, drag: 0.1, ground: false, groundY: 0 };

// A SPRING RATE AND A DECAY RATE, not per-frame factors — which is what makes "tune it live,
// then bake it" true rather than a slogan.
//
// The first version lerped toward the animated pose by `stiffness` every FRAME and damped the
// velocity by a per-frame factor. Both mean something different at a different rate, and the
// live preview runs at 60 while a bake runs at the timeline's fps: measured, the same tail sagged
// 6.25x further in a 24fps bake than in the preview it was tuned against. Raising the parameters
// to the power of the step got that down to a 0.5-unit spread and no further, because the
// equilibrium of a per-frame lerp is itself proportional to the timestep — sag ~ g*h/(60*s). The
// only fix is to stop expressing the spring per frame.
//
// So: a is an acceleration, v is a velocity in units per second, and the integration is
// semi-implicit Euler. Equilibrium sag is then g/k — no h in it at all.
//
// STIFFNESS 0..1 MAPS TO s/(1-s) so that 1 still means "no physics": the spring rate goes to
// infinity and the joint sits exactly on its animated pose. That escape hatch has to be exact or
// there is no way to tell the feature off from the feature misbehaving.
const SPRING_SCALE = 30;    // k = SPRING_SCALE * sceneUnit * s/(1-s)
const DAMP_SCALE = 10;      // velocity decays as exp(-DAMP_SCALE * damping * dt)

// Earth gravity expressed in scene units, given how big the scene is. A character is roughly two
// metres, sceneUnit is roughly a character, so a unit is roughly sceneUnit/2 metres — and 9.8
// m/s^2 lands here. Approximate on purpose: the point is that the number tracks the rig's scale
// rather than being right in any absolute sense.
function gravityUnits(main, mult) {
  const unit = (Skeleton.sceneUnit && Skeleton.sceneUnit(main)) || 1;
  return (mult === undefined ? 1 : mult) * 9.8 * (unit / 2);
}
PhysicsBones.gravityUnits = gravityUnits;

// Where the floor is. The ground grid is the one the user can actually see, so a chain that
// stops on it stops where they expect; y = 0 is the fallback, which is where the grid sits.
PhysicsBones.groundHeight = function (main) {
  const g = main && (main._groundY !== undefined ? main._groundY : null);
  return g === null ? 0 : g;
};

PhysicsBones.DEFAULTS = DEFAULTS;

PhysicsBones.isRoot = function (j) { return !!(j && j._physicsRoot); };

PhysicsBones.params = function (j) {
  const p = (j && j._physicsParams) || null;
  const pick = (k) => (p && p[k] !== undefined ? p[k] : DEFAULTS[k]);
  return {
    stiffness: pick('stiffness'), damping: pick('damping'), gravity: pick('gravity'),
    drag: pick('drag'), ground: pick('ground'), groundY: pick('groundY'),
  };
};

PhysicsBones.setParams = function (j, patch) {
  if (!j) return false;
  const cur = PhysicsBones.params(j);
  const take = (k, lo, hi) => {
    const v = patch[k] !== undefined ? patch[k] : cur[k];
    return (lo === undefined) ? v : Math.max(lo, Math.min(hi, v));
  };
  j._physicsParams = {
    stiffness: take('stiffness', 0, 1),
    damping:   take('damping', 0, 0.99),
    gravity:   take('gravity'),
    drag:      take('drag', 0, 1),
    ground:    !!take('ground'),
    groundY:   take('groundY'),
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
      _state.set(link.joint.getID(), { p: at.clone(), prev: at.clone(), v: new THREE.Vector3() });
    }
  }
};

PhysicsBones.isSettled = function () { return _state.size > 0; };

const _pAnim = new THREE.Vector3(), _pPar = new THREE.Vector3(), _pCur = new THREE.Vector3();
const _vel = new THREE.Vector3(), _next = new THREE.Vector3(), _dir = new THREE.Vector3();
const _aimA = new THREE.Vector3(), _aimB = new THREE.Vector3(), _qAim = new THREE.Quaternion();
const _pRig = new THREE.Vector3(), _acc = new THREE.Vector3();

// gl-matrix's mat4 is a plain array here; a joint's matrix is written in place so the object
// identity the rest of the app holds stays valid.
function mat4Copy(dst, src) { for (let i = 0; i < 16; i++) dst[i] = src[i]; }

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
    const unit = (Skeleton.sceneUnit && Skeleton.sceneUnit(main)) || 1;
    const stiff = Math.min(0.9999, Math.max(0, par.stiffness));
    const k = SPRING_SCALE * unit * (stiff / (1 - stiff));  // spring rate, per second squared
    const decay = Math.exp(-DAMP_SCALE * par.damping * h);  // exact, so it does not depend on h
    const gAcc = gravityUnits(main, par.gravity);
    const rigid = par.stiffness >= 1;

    // THE REST POSE IS PUT BACK BEFORE ANYTHING IS MEASURED.
    //
    // The spring pulls toward the pose the animation asked for — and the first version read that
    // pose straight off the rig, which by then already contained the PREVIOUS frame's physics.
    // So the target drifted along with the sim: no restoring force, a chain that fell and stayed
    // fallen, and a stiffness slider that only froze it where it had landed. matt: "i assume the
    // physics bone isn't storing a rest angle/position before being activated, it should."
    // Measured: at stiffness 0.95 the tip sat 6.77 units from rest and did not move.
    //
    // WHO WROTE IT LAST decides what the rest pose is, and that cannot be assumed. During
    // playback the animation writes every joint every frame, and restoring a saved pose there
    // would undo the keys. Idle — matt's case, a rig being dragged around by hand — nothing
    // writes it but us. So the rule is: if the joint is exactly where WE left it, nobody else
    // has touched it and the saved rest still stands; if it has moved, that is the new authored
    // pose and it is adopted. Animation, a gizmo pose and an undo all take the second branch
    // without any of them knowing this exists.
    for (const link of links) {
      const st = _state.get(link.parent.getID());
      if (!st || !st.written) continue;
      const now = link.parent.getMatrix();
      let same = true;
      for (let k = 0; k < 16; k++) {
        if (Math.abs(now[k] - st.written[k]) > 1e-9) { same = false; break; }
      }
      if (same && st.rest) { mat4Copy(now, st.rest); Skeleton.syncThree(link.parent); }
      else if (!same) { st.rest = Array.prototype.slice.call(now); }
    }

    // THE ANIMATED POSE IS CAPTURED FIRST, all of it, before anything is written. Each write
    // rotates a joint and therefore moves every joint below it, so a target read after the first
    // write would be a target measured against a pose that is already half simulated.
    const target = new Map();
    for (const link of links) target.set(link.joint.getID(), Skeleton.jointPos(link.joint).clone());

    for (const link of links) {
      const j = link.joint;
      const id = j.getID();
      let st = _state.get(id);
      if (!st) { st = { p: target.get(id).clone(), prev: target.get(id).clone(), v: new THREE.Vector3() }; _state.set(id, st); }
      // The joint that will actually be rotated keeps the rest pose, since that is the matrix
      // being written and therefore the one that accumulates.
      const pid = link.parent.getID();
      let pst = _state.get(pid);
      if (!pst) { pst = { p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3() }; _state.set(pid, pst); }
      if (!pst.rest) pst.rest = Array.prototype.slice.call(link.parent.getMatrix());

      _pAnim.copy(target.get(id));
      Skeleton.jointPos(link.parent, _pPar);        // already written this frame, so it is live
      _pCur.copy(st.p);                             // the PARTICLE's position, not the rig's

      if (rigid) { _next.copy(_pAnim); }
      else {
        // Acceleration: the spring pulling back toward the pose the animation asked for, plus
        // gravity. Then semi-implicit Euler — velocity first, position from the NEW velocity,
        // which is what keeps a spring stable at large steps.
        _acc.subVectors(_pAnim, _pCur).multiplyScalar(k);
        _acc.y -= gAcc;
        // DRAG IS NOT DAMPING, which is why both are here. Damping decays the velocity at a
        // fixed rate whatever it is doing — it decides how fast a wobble dies. Drag opposes
        // motion in proportion to SPEED SQUARED, so it barely touches a slow drape and bites
        // hard on a fast whip. A tail that settles gently but does not crack like a rope needs
        // the second one, and no amount of the first gives it.
        if (par.drag > 0) {
          const sp = st.v.length();
          if (sp > 1e-9) _acc.addScaledVector(st.v, -par.drag * sp / Math.max(unit, 1e-6));
        }
        st.v.addScaledVector(_acc, h).multiplyScalar(decay);
        _next.copy(_pCur).addScaledVector(st.v, h);

      }

      // LENGTH IS A HARD CONSTRAINT, not a spring. A bone that stretches reads as broken
      // immediately, and the skin is built assuming the length it was rigged with.
      const rest = _pPar.distanceTo(_pAnim);
      _dir.subVectors(_next, _pPar);
      if (_dir.lengthSq() < 1e-12) continue;         // sitting on its own parent: nothing to aim
      _dir.normalize();
      _next.copy(_pPar).addScaledVector(_dir, rest);

      // GROUND, AFTER the length constraint and not before it. Clamping y first and then
      // projecting back onto the bone's length just pushes the point through the floor again —
      // measured, 0.013 under a floor it was clamped to.
      //
      // Both constraints can hold exactly. The positions at the right distance from the parent
      // AND on the floor are a CIRCLE: where the sphere of radius `rest` about the parent meets
      // the plane y = groundY. So the point is put on that circle, keeping its horizontal
      // direction. When the parent is high enough that the bone cannot reach the floor, the
      // sphere misses the plane and there is nothing to do.
      if (par.ground && _next.y < par.groundY) {
        const drop = _pPar.y - par.groundY;
        const r2 = rest * rest - drop * drop;
        if (r2 > 1e-12) {
          const ring = Math.sqrt(r2);
          _dir.set(_next.x - _pPar.x, 0, _next.z - _pPar.z);
          if (_dir.lengthSq() < 1e-12) _dir.set(1, 0, 0);
          _dir.normalize();
          _next.set(_pPar.x + _dir.x * ring, par.groundY, _pPar.z + _dir.z * ring);
        }
        if (st.v.y < 0) st.v.y = 0;
      }

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
        pst.written = Array.prototype.slice.call(link.parent.getMatrix());
        moved++;
      }
      // Carry the particle forward. Read back from the rig rather than trusting `_next`: the aim
      // is a rotation about the parent, so where the joint lands is the truth, and a particle
      // that drifted from it would fight the constraint every frame after.
      //
      // The velocity is RE-DERIVED from where it actually ended up, so the length constraint and
      // the aim cannot inject energy the integrator never accounted for — the classic way a
      // constrained spring chain slowly winds itself up.
      st.prev.copy(st.p);
      Skeleton.jointPos(j, st.p);
      if (h > 1e-9) st.v.subVectors(st.p, st.prev).divideScalar(h);
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
