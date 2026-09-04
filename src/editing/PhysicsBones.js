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
const DEFAULTS = { stiffness: 0.25, damping: 0.7, gravity: 1, drag: 0.1, ground: false, groundY: 0,
  inertia: 0.35, maxBend: 50 };

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

// ---- blend weight (roadmap #48's scalar channel) -----------------------------
//
// HOW MUCH THE PHYSICS APPLIES, keyable over time. 1 is full jiggle, 0 is the animated pose
// exactly, and in between the joint sits proportionally between the two. That is what lets a
// tail be floppy through a shot and locked for the one beat where it must hit a mark.
//
// The channel is the generic keyable scalar built for pin weights (#48) — same storage, same
// evaluator, same dopesheet row, same undo. Building a bespoke number here would have been a
// second thing to serialise, snapshot and draw.
PhysicsBones.WEIGHT = 'physicsWeight';
const W_EPS = 0.01;

PhysicsBones.weight = function (joint) {
  const reg = window._animationRegistry;
  if (!reg || !reg.scalarAt) return 1;
  const w = reg.scalarAt(joint, PhysicsBones.WEIGHT, reg.globalPlaybackTime || 0, 1);
  if (w == null) return 1;
  // SNAP THE ENDS, for the reason pin weight documents: the scalar evaluator solves a Bezier
  // iteratively, so a key valued exactly 1 reads about 0.9990 AT ITS OWN KEY TIME. Left alone
  // that is a chain keyed as fully on which is fractionally damped for ever, and the w >= 1
  // fast path never fires.
  if (w >= 1 - W_EPS) return 1;
  if (w <= W_EPS) return 0;
  return Math.min(1, Math.max(0, w));
};

// Write a weight key at the playhead, undoable — the same shape as IKSolver.setPinWeightKey.
PhysicsBones.setWeightKey = function (main, joint, w) {
  const reg = window._animationRegistry;
  if (!joint || !reg || !reg.setScalarKey) return false;
  const t = reg.globalPlaybackTime || 0;
  const id = joint.getID();
  const snapOf = () => {
    const tr = reg.tracks && reg.tracks.get(id);
    return tr ? reg._snapshotTrack(tr) : null;
  };
  const before = snapOf();
  reg.setScalarKey(joint, PhysicsBones.WEIGHT, t, Math.min(1, Math.max(0, w)));
  const after = snapOf();
  const apply = (snap) => {
    const tr = reg.tracks && reg.tracks.get(id);
    if (tr && snap) reg._restoreTrack(tr, snap, null);
    Skeleton.updateVisuals(main);
    main.render?.();
  };
  main?.getStateManager?.()?.pushStateCustom?.(
    () => apply(before), () => apply(after), false, 'Key Physics Weight');
  Skeleton.updateVisuals(main);
  main.render?.();
  return true;
};

PhysicsBones.params = function (j) {
  const p = (j && j._physicsParams) || null;
  const pick = (k) => (p && p[k] !== undefined ? p[k] : DEFAULTS[k]);
  return {
    stiffness: pick('stiffness'), damping: pick('damping'), gravity: pick('gravity'),
    drag: pick('drag'), ground: pick('ground'), groundY: pick('groundY'),
    inertia: pick('inertia'), maxBend: pick('maxBend'),
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
    inertia:   take('inertia', 0, 1),
    maxBend:   take('maxBend', 0, 180),
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

// WHICH JOINT THE PANEL'S SLIDERS EDIT, which is deliberately NOT "whatever is selected".
//
// Tuning a jiggle means shaking the rig and watching it, and shaking it means selecting the joint
// you want to shake — so a panel that followed the selection took its own controls away the
// moment you went to test them. This remembers the last physics joint that was selected and
// keeps returning it: select the antenna once, then select the hips and shake all you like.
//
// Cleared when the joint stops being a physics bone or leaves the scene, so it cannot point at
// something that is no longer there.
PhysicsBones.panelTarget = function (main, selected) {
  const sel = (selected || []).filter((j) => PhysicsBones.isRoot(j));
  if (sel.length === 1) main._physicsPanelTarget = sel[0];
  const t = main._physicsPanelTarget;
  if (!t || !PhysicsBones.isRoot(t)) { main._physicsPanelTarget = null; return null; }
  if (main.getMeshes && !main.getMeshes().includes(t)) { main._physicsPanelTarget = null; return null; }
  return t;
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

  // HOW MUCH CHAIN HANGS BELOW EACH JOINT — its effective mass. A joint near the root has to
  // drag everything under it, so it lags further behind a shake; the tip has only itself and
  // whips. Without this every particle answers as if it were alone, and the root barely moves
  // while the middle of the chain flails — measured on a real arm, 4.3 degrees at the shoulder
  // against 34.8 at the elbow, which is backwards. matt: "mass or drag should reduce from the
  // root to the tip?" That is exactly it, and it is not a taste knob but the thing a chain of
  // rigid links physically does.
  const below = new Map();
  for (let i = out.length - 1; i >= 0; i--) {
    const link = out[i];
    let n = 1;
    for (const other of out) if (other.parent === link.joint) n += below.get(other.joint) || 1;
    below.set(link.joint, n);
  }
  for (const link of out) link.mass = below.get(link.joint) || 1;
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

// A RESET UNDOES THE PHYSICS; IT DOES NOT ADOPT IT.
//
// Every reset used to throw the state away and let the next step re-capture the rest pose from
// wherever the rig happened to be — which, mid-sag, is the sagged pose. So each reset baked in
// however far the chain had fallen, and the sag accumulated one reset at a time. Anything that
// resets does it: a scrub, a rig edit, and — matt's case — a selection, because Tweak Free
// raises the rig-edit flag. "if i select 10 things in a row, the antenna that used to point
// straight to the sides now hang straight down." Measured: 0.16 units per selection, dead
// linear.
//
// So the joints are put back to the pose they had before physics touched them, and only then is
// the state cleared. A reset is now the honest thing its name claims: the chain returns to where
// the animation or the author last put it.
PhysicsBones.reset = function (main) {
  // RESTORED FROM THE JOINT, not from `_state`, which this function is about to throw away. The
  // state map only ever holds an entry for a joint physics has already stepped, so on the first
  // seek after a load -- or any seek after a previous reset wiped it -- there was nothing to
  // restore from and the chain kept whatever pose it had been bent into. matt: "the arm position
  // is offset and crumpled; its not able to go back to its bind pose at frame 1". Measured on
  // walkwave.sxr, scrubbing to frame 109 and back: 10 of 16 physics joints failed to return to
  // their frame-1 local pose, worst 0.098 -- and 0 of 16 with physics off, which is what named
  // physics rather than the solver as the cause.
  const restore = (joint) => {
    if (!joint || !joint._physRest || !joint._physWritten) return;
    // ...unless something else has written the joint since, in which case that is the pose now
    // and putting our older one back would undo it. Same rule the step uses.
    const now = joint.getMatrix();
    for (let k = 0; k < 16; k++) {
      if (Math.abs(now[k] - joint._physWritten[k]) > 1e-9) return;
    }
    mat4Copy(now, joint._physRest);
    Skeleton.syncThree(joint);
  };
  if (main) {
    for (const root of PhysicsBones.roots(main)) {
      for (const link of PhysicsBones.chain(main, root)) restore(link.parent);
    }
  } else {
    for (const st of _state.values()) restore(st.joint);
  }
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
const _parMove = new THREE.Vector3(), _aimTo = new THREE.Vector3();
const _restDir = new THREE.Vector3(), _newDir = new THREE.Vector3();

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
    // The blend weight is read once per chain per step: it is keyed on the ROOT, because the
    // chain is what it turns on and off and keying every joint of a tail separately would be a
    // way to get them out of step with each other.
    // PHYSICS RELEASES AS THE PIN TAKES HOLD.
    //
    // A pinned chain was still being simulated at full strength, so every frame after the pin
    // came on, physics threw the wrist somewhere and the solver hauled it back. Measured on
    // weight.sxr at full pin weight: physics moving the wrist 14.4 units in a frame and the
    // solve pulling it 16.3 back, every frame, for a net of 1.9 -- a violent oscillation inside
    // each frame that reads exactly as the pop matt kept seeing. "it does a really violent pop
    // into that position and is still partially under physics even after the pin happens."
    //
    // So a joint the solver holds is one the sim gives up in proportion: fully pinned, physics
    // is off and the chain simply follows the solve; mid-fade, the two hand over smoothly and
    // sum to one. At pinHold 1 this falls into the "fully off" branch below, which parks the
    // particles on the posed chain -- so releasing the pin resumes from the pose rather than
    // from wherever gravity had dragged them meanwhile.
    let pinHold = 0;
    const ownedIds = window._ikOwnedIds, fadeW = window._ikOwnedFadeW;
    if (ownedIds) {
      for (const link of links) {
        const id = link.parent && link.parent.getID();
        if (id == null || !ownedIds.has(id)) continue;
        pinHold = Math.max(pinHold, fadeW && fadeW.has(id) ? fadeW.get(id) : 1);
      }
    }
    const blend = PhysicsBones.weight(root) * (1 - Math.min(1, pinHold));
    if (blend <= 0) {
      // Fully off: put the chain on its animated pose and keep the particles there, so turning
      // it back on starts from the pose rather than from wherever gravity had dragged it while
      // nobody was looking. A weight that fades in should fade in from where the rig IS.
      for (const link of links) {
        const st0 = _state.get(link.joint.getID());
        if (st0) { Skeleton.jointPos(link.joint, st0.p); st0.prev.copy(st0.p); st0.v.set(0, 0, 0); }
      }
      continue;
    }

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
      // A SOLVE IS NOT AN AUTHORED POSE. The IK solver writes every joint on a path from an
      // active pin to the root, so the moment matt's wrist pin came on, his arm counted as
      // "something else wrote it" and the solved wave became the chain's rest. It never went
      // back: a rewind restored the waving arm as though it were the bind pose, and each loop
      // re-adopted it. Measured on weight.sxr, playing one pass then rewinding to frame 0: the
      // pinned right arm sat 2.52 units off, while the three chains with no pin returned to 0.
      const solverPosed = window._ikOwnedIds && window._ikOwnedIds.has(link.parent.getID());
      if (same && st.rest) { mat4Copy(now, st.rest); Skeleton.syncThree(link.parent); }
      // Re-pointed on the joint as well: assigning a NEW array here would otherwise leave the
      // joint holding the old one, and the two copies of "rest" would drift apart.
      else if (!same && !solverPosed) { st.rest = Array.prototype.slice.call(now); link.parent._physRest = st.rest; }
      // else: the solver posed it this frame. Leave it where the solve put it -- physics layers
      // on top of that -- but keep the rest we already had, so a reset still has a pose to
      // return to that nothing simulated or solved ever wrote.
    }

    // A CHAIN, NOT FOUR INDEPENDENT SPRINGS. Each joint's target is read AFTER its parent has
    // been written, so it is where the animation would put this joint GIVEN THE PARENT'S
    // SIMULATED FRAME — not where the animation alone says it should be.
    //
    // That one distinction is the difference between a rig that feels coupled and one that does
    // not. Capturing every target up front, as this did, means joint four chases its un-lagged
    // animated pose no matter how far joints one to three have lagged: shake the head and all
    // four react on the SAME FRAME, each fighting its own way back. matt, comparing it to
    // Unreal: "it's as if the 4 joints aren't aware of each other... each is doing its own
    // jiggly physics which loosely transmit to each other... it doesn't feel integrated."
    //
    // Measured on a four-joint ear: every joint first moved on frame 1, a propagation spread of
    // zero. Reading the target in the loop makes a disturbance travel down the chain as a wave,
    // because a child's rest position is carried by its parent's lag.
    //
    // The joint's own LOCAL matrix is never written by this — the sim rotates the PARENT — so
    // reading its world position after the parent moved is exactly "where my parent's frame puts
    // me", with no extra bookkeeping.

    for (const link of links) {
      const j = link.joint;
      const id = j.getID();
      let st = _state.get(id);
      if (!st) {
        const at = Skeleton.jointPos(j).clone();
        st = { p: at.clone(), prev: at.clone(), v: new THREE.Vector3() };
        _state.set(id, st);
      }
      // The joint that will actually be rotated keeps the rest pose, since that is the matrix
      // being written and therefore the one that accumulates.
      const pid = link.parent.getID();
      let pst = _state.get(pid);
      if (!pst) { pst = { p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3() }; _state.set(pid, pst); }
      pst.joint = link.parent;   // so a reset can put this joint back where it found it
      // THE REST POSE LIVES ON THE JOINT, not only in `_state`, because reset() throws the state
      // map away -- and a seek runs reset on every frame you land on. Held only in the map, the
      // next step found `pst.rest` missing and captured it fresh from the pose it was looking
      // at, which was the pose physics had just bent. The bend became the rest and the arm never
      // came back. Shared by reference with the state entry, so the two cannot disagree.
      if (!pst.rest) {
        if (!link.parent._physRest) {
          link.parent._physRest = Array.prototype.slice.call(link.parent.getMatrix());
        }
        pst.rest = link.parent._physRest;
      }

      Skeleton.jointPos(j, _pAnim);   // the parent above has already been written
      Skeleton.jointPos(link.parent, _pPar);        // already written this frame, so it is live
      _pCur.copy(st.p);                             // the PARTICLE's position, not the rig's

      // INERTIA: how much of the parent's own movement the particle inherits before it starts
      // resisting. At 0 the particle is a free point on a string — the joint above can travel
      // right past it, and a fast head shake throws the chain to a huge angle before the spring
      // has any say. Measured on a four-joint ear with a two-unit shake, the root joint reached
      // 115 degrees and the chain then flailed incoherently: matt's "the entire ear moves as a
      // single unit then starts to decompose into random springly motion".
      //
      // Carrying a fraction of the parent's step is what makes a chain read as ATTACHED to the
      // thing it hangs off. It is the same idea as Dynamic Bone's Inert, and it is the setting
      // that separates "loose" from "detached".
      if (pst.lastPar) {
        _parMove.subVectors(_pPar, pst.lastPar);
        st.p.addScaledVector(_parMove, par.inertia);
        st.prev.addScaledVector(_parMove, par.inertia);
        _pCur.copy(st.p);
      }

      if (rigid) { _next.copy(_pAnim); }
      else {
        // Acceleration: the spring pulling back toward the pose the animation asked for, plus
        // gravity. Then semi-implicit Euler — velocity first, position from the NEW velocity,
        // which is what keeps a spring stable at large steps.
        // Divided by the chain hanging below this joint: a force moves a heavy thing less. Not
        // gravity, which is an acceleration and pulls every mass the same — that is the whole
        // point of it, and dividing it here would make a long tail fall slower than a short one.
        _acc.subVectors(_pAnim, _pCur).multiplyScalar(k / (link.mass || 1));
        _acc.y -= gAcc;
        // DRAG IS NOT DAMPING, which is why both are here. Damping decays the velocity at a
        // fixed rate whatever it is doing — it decides how fast a wobble dies. Drag opposes
        // motion in proportion to SPEED SQUARED, so it barely touches a slow drape and bites
        // hard on a fast whip. A tail that settles gently but does not crack like a rope needs
        // the second one, and no amount of the first gives it.
        if (par.drag > 0) {
          const sp = st.v.length();
          if (sp > 1e-9) {
            _acc.addScaledVector(st.v, -par.drag * sp / (Math.max(unit, 1e-6) * (link.mass || 1)));
          }
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

      // A BEND LIMIT, which is what stops a chain looking broken rather than loose. A free
      // particle plus a length constraint will happily fold a joint back on itself when the rig
      // moves faster than the spring can answer; a real ear cannot do that, and the eye reads
      // the fold as the simulation failing rather than as the ear being floppy. Clamping the
      // angle between where the bone points now and where its parent's frame says it should
      // point keeps every pose one a jointed chain could actually reach.
      if (par.maxBend < 180) {
        _restDir.subVectors(_pAnim, _pPar);
        _newDir.subVectors(_next, _pPar);
        if (_restDir.lengthSq() > 1e-12 && _newDir.lengthSq() > 1e-12) {
          _restDir.normalize(); _newDir.normalize();
          const cosLim = Math.cos(par.maxBend * Math.PI / 180);
          const dot = Math.max(-1, Math.min(1, _restDir.dot(_newDir)));
          if (dot < cosLim) {
            // Slerp back onto the edge of the cone, keeping the direction it was heading.
            const ang = Math.acos(dot);
            const t = 1 - (par.maxBend * Math.PI / 180) / ang;
            _newDir.lerp(_restDir, t).normalize();
            _next.copy(_pPar).addScaledVector(_newDir, rest);
            st.p.copy(_next);        // the particle is clamped too, or it fights the limit
          }
        }
      }

      // Turn the position into the parent's rotation — the only thing that can actually move a
      // joint — via the solver's own primitive, so both write a joint the same way.
      // BLEND, between the animated pose and where the physics wants the joint — applied to
      // what is WRITTEN, while the simulation underneath keeps running at full strength.
      //
      // Blending `_next` itself and then letting the particle read its state back off the rig
      // made the physics decay multiplicatively instead of running at half: a weight of 0.5
      // landed at 0.01 against a full swing of 2.67, which is off, not half. The sim has to be
      // unaware of the weight, or a chain faded back in would come back from nowhere.
      _aimTo.copy(_next);
      if (blend < 1) _aimTo.lerp(_pAnim, 1 - blend);

      // Aim from where the joint ACTUALLY is — the rig has already dragged it this frame — to
      // where the particle wants it. The rotation is the correction between those two.
      Skeleton.jointPos(j, _pRig);
      _aimA.subVectors(_pRig, _pPar);
      _aimB.subVectors(_aimTo, _pPar);
      if (_aimA.lengthSq() > 1e-12 && _aimB.lengthSq() > 1e-12) {
        _qAim.setFromUnitVectors(_aimA.normalize(), _aimB.normalize());
        IKSolver.rotateJoint(link.parent, _qAim);
        pst.written = Array.prototype.slice.call(link.parent.getMatrix());
        link.parent._physWritten = pst.written;   // survives the state wipe, so reset can guard on it
        moved++;
        // THE PARTICLE FOLLOWS THE PHYSICS, NOT THE RIG, when a weight is in play: the rig is
        // showing a blend, and a particle that tracked it would be simulating the blend rather
        // than the motion the blend is a fraction OF. `_next` is already length-constrained, so
        // it is on the same surface the read-back would have given at full weight.
        st.prev.copy(st.p);
        st.p.copy(_next);
        if (h > 1e-9) st.v.subVectors(st.p, st.prev).divideScalar(h);
        pst.lastPar = (pst.lastPar || new THREE.Vector3()).copy(_pPar);
        continue;
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
      // Where the parent was this frame, so the next one can tell how far it travelled.
      pst.lastPar = (pst.lastPar || new THREE.Vector3()).copy(_pPar);
    }
  }
  return moved;
};

// Advance to a wall-clock time, so the caller does not have to keep its own dt. Returns false
// when there is nothing to do, which is also the "not playing forward" case.
PhysicsBones.tick = function (main, nowSeconds) {
  if (!PhysicsBones.roots(main).length) return false;
  // THE INIT FRAME. A loop is a cut: the playhead jumps from one end of the range to the other,
  // and a simulation has no way to know that -- its particles carry the pose and velocity they
  // had at the END of the loop into the first frame of the next one. So the first pass looked
  // right (it began from a seek, which resets) and every pass after it started from wherever the
  // previous pass finished. matt: "usually with solvers its a given that on frame 1 the system
  // has to reinitialise itself."
  //
  // Consumed HERE rather than at the wrap because this runs after the animation has written the
  // loop-start frame, so reset seeds the particles from the pose they are actually starting on.
  // Doing it at the wrap seeds them from the pose still on screen -- the loop's LAST frame --
  // which measured worse than not resetting at all.
  if (window._physicsNeedsInit) {
    window._physicsNeedsInit = false;
    PhysicsBones.reset(main);
    _lastTime = null;              // no dt across the cut, or the first step integrates the gap
  }
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
