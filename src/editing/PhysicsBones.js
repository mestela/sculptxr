import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import IKSolver from './IKSolver.js';
import getOptionsURL from '../misc/getOptionsURL.js';

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
  inertia: 0.35, maxBend: 50, collide: false,
  // MASS IS THE AXIS STIFFNESS CANNOT REACH. A spring's frequency is sqrt(k/m), and until now
  // only k was adjustable -- so every setting was a stiff spring and the other controls only
  // decided whether it rang in a vacuum or in honey. matt: "it always feels like a very stiff
  // spring... its very black and white, either it oscillates rapidly, or its totally
  // overconstrained." Measured on his 5-bone puppet at damping 0.15, the frequency floor was
  // 2.0 Hz at stiffness 0.02, rising to 6.7 and then falling again -- no way to get a slow,
  // heavy head at all. Four times the mass halves the frequency, which is the missing control.
  //
  // A MULTIPLIER, not an absolute: the per-link masses are structural (how much chain hangs
  // below each joint, which is what makes a root lag and a tip whip) and that relationship has
  // to survive. This scales all of them together.
  mass: 1,
  // Solver quality, per chain, and both finally safe to expose: with lambda accumulating, more
  // of either converges instead of stiffening. Before that, raising substeps made the chain
  // WORSE -- residual motion 0 / 1.45 / 10.0 / 21.3 / 34.0 for 1 / 8 / 16 / 32 / 64.
  substeps: 8,
  iterations: 1 };

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
const DAMP_SCALE = 10;      // velocity decays as exp(-DAMP_SCALE * dampRate(damping) * dt)

// DAMPING GETS THE SAME POLE-AT-ONE CURVE STIFFNESS ALREADY HAS, and it should have had it all
// along -- stiffness maps s/(1-s) so the top of its range means "infinite", while damping was a
// plain linear scale whose maximum was nowhere near critically damped.
//
// What that cost: at damping 0.99, the old curve removed 15% of the velocity per frame
// (exp(-10 * 0.99 / 60) = 0.848), which permits about ten visible oscillations before the
// amplitude is gone. Measured on matt's 5-bone puppet at stiffness 0.07: TWELVE oscillations at
// MAXIMUM damping. matt: "if i set damping up to its max (99), i would expect to see almost no
// overshoot/spring at all, yet its still at least 8 oscilations."
//
// With the pole, the slider reaches what it claims: 0.5 gives the old maximum, 0.9 removes 78% a
// frame, and 0.99 is a dead stop. The clamp stays at 0.99 so the rate is always finite.
//
// THIS CHANGES WHAT EXISTING DAMPING NUMBERS MEAN -- an old 0.99 is about 0.5 on this curve.
// `window._physDampLinear = true` restores the old straight scale for an A/B.
function dampRate(d) {
  const v = Math.max(0, Math.min(0.99, d || 0));
  if (typeof window !== 'undefined' && window._physDampLinear) return v;
  return v / (1 - v);
}

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
// THIS USED TO BE A LIE. It read `main._groundY`, which nothing anywhere ever assigned, so it
// always returned the 0 fallback — while the grid the user reads as the floor sits well below
// that. A chain with Ground ticked stopped in mid-air, at a plane with nothing drawn on it.
// Scene.groundHeight is now the single authority (the grid's own matrix); `_groundY` stays as an
// override for a caller that genuinely wants a different plane, and for the harness mocks that
// have no Scene to ask.
PhysicsBones.groundHeight = function (main) {
  if (main && main._groundY !== undefined && main._groundY !== null) return main._groundY;
  if (main && typeof main.groundHeight === 'function') return main.groundHeight();
  return 0;
};

PhysicsBones.DEFAULTS = DEFAULTS;

// THE DEFAULTS ARE EDITABLE, and that is what the panel's sliders write when no flagged joint is
// selected. matt: "i think its valid for someone to setup the values to a state they know is
// good, then enable physics."
//
// It costs nothing to support because setRoot already copies DEFAULTS into the joint it flags, so
// "set it up first" and "flag it then tune it" arrive at the same place by the same route. The
// alternative -- a separate pending-values object applied on flag -- would be a second copy of
// every parameter to keep in step, for a difference nobody could see.
//
// Session-scoped on purpose: these are "what I am working in right now" values, not a preference.
// A rig that is saved carries its own per-joint params, so nothing here changes what a file means.
PhysicsBones.setDefaults = function (patch) {
  Object.assign(DEFAULTS, patch || {});
  return DEFAULTS;
};

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
    collide: pick('collide'),
    inertia: pick('inertia'), maxBend: pick('maxBend'),
    mass: pick('mass'), substeps: pick('substeps'), iterations: pick('iterations'),
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
    // Wide, because this is the control that has to span "a feather" and "a sandbag", and the
    // useful span of a frequency knob is multiplicative. 100x mass is 10x slower.
    mass:      take('mass', 0.01, 100),
    substeps:  Math.round(take('substeps', 1, 32)),
    iterations: Math.round(take('iterations', 1, 16)),
    collide:   !!take('collide'),
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

// The physics root governing this joint — itself if it is flagged, else the nearest flagged
// ancestor, else null. The same walk Skeleton.physicsGoverned does, returning the joint rather
// than a boolean, because "which chain is this in" is the question the panel has to answer.
PhysicsBones.rootOf = function (j) {
  for (let n = j; n; n = n._parentMesh) if (n._physicsRoot) return n;
  return null;
};

// WHICH CHAIN THE PANEL'S SLIDERS EDIT: the one in the current selection, and nothing else.
//
// THIS USED TO BE STICKY, and the stickiness is gone. It existed for a real problem — tuning a
// jiggle means shaking the rig, shaking it means selecting the joint you shake WITH, and a panel
// that followed the selection took its own controls away at that moment — but remembering the
// last physics joint solved that by making the panel act on something you could no longer see.
// matt: "the stickiness is a UI hack, and means we run the risk of people modifying physics
// properties they didn't want, or being surprised when changing physics properties to setup a new
// chain still affects the old chain. i think we drop the stickyness."
//
// Hidden state that decides what a slider writes is worth more scepticism than a round trip. The
// selection is visible in the viewport and in the outliner; a remembered target is visible
// nowhere, so every wrong guess about it is silent and lands in the file.
//
// What replaces it is NOT the old round trip: with no chain selected the sliders edit DEFAULTS —
// the values the next joint you flag will be given — so the controls still do something useful
// while you are shaking the hips, and the panel says which of the two it is doing. See
// setDefaults, and the readout in bonePanel.
//
// Two chains at once is ambiguous, so it answers null and the sliders fall to the defaults rather
// than silently picking one of them.
PhysicsBones.panelTarget = function (main, selected) {
  const roots = [];
  for (const j of (selected || [])) {
    const r = PhysicsBones.rootOf(j);
    if (r && roots.indexOf(r) === -1) roots.push(r);
  }
  let t = roots.length === 1 ? roots[0] : null;
  if (t && main.getMeshes && !main.getMeshes().includes(t)) t = null;
  main._physicsPanelTarget = t;   // published for anything that wants to know, never read back
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
  // The user's multiplier on top of the structural masses, so "heavier" moves the whole chain's
  // frequency without flattening the root-drags-more relationship the loop above builds.
  const mScale = Math.max(0.01, PhysicsBones.params(root).mass || 1);
  for (const link of out) {
    // STRUCTURAL MASS IS KEPT SEPARATELY, because the two divisors mean different things.
    //
    // `mass` is the physical one: it sets the frequency (sqrt(k/m)) and it is what the pose
    // spring and the inverse masses divide by. The user's multiplier belongs in it.
    //
    // `structMass` is the root-drags-more gradient above and NOTHING ELSE. Drag divides by this
    // one, so the drag CONTROL keeps its authority as the mass knob goes up -- see the note at
    // the drag term. Both still carry the gradient; only one carries the multiplier.
    link.structMass = below.get(link.joint) || 1;
    link.mass = link.structMass * mScale;
  }
  return out;
};

// THE WHOLE COLLISION RESPONSE FOR ONE BONE, shared by both solvers.
//
// ONE IMPLEMENTATION ON PURPOSE. matt runs XPBD (the force solver cannot animate pin constraints
// on and off, which is the thing XPBD was brought in for), while the code's built-in default is
// still the force one — so BOTH are live paths depending on the saved option, and a collision
// that behaved differently between them would be a bug that only appears after someone flips a
// setting. The projection needs nothing solver-specific: a position, the parent it hangs off,
// the length to keep, and the two radii.
//
// `pt` is moved in place. `dir` is the caller's own scratch vector, since the two solvers each
// have their own and neither wants the other's clobbered mid-substep.
function collideBone(pt, parPos, len, joint, par, jointR, parR, dir) {
  const nProxy = proxyCount(len, Math.min(parR, jointR) || jointR);
  let any = false;
  // ALTERNATED with the length constraint. They are two surfaces and one pass of each lands on
  // neither: pushing out moves the joint off its sphere about the parent, and putting it back on
  // that sphere moves it back into the collider. Two rounds is what a swinging chain needs.
  for (let ci = 0; ci < 2; ci++) {
    let hit = pushOutOfBones(pt, jointR, joint, par);

    // THE PROXIES ALONG THE BONE, so it collides over its whole length and not only at its ends.
    // Without them two long thin bones cross in an X with both endpoints clear of each other. A
    // dense chain needs none — its joint spheres already overlap — which is why the count is
    // derived from length and radius rather than fixed.
    //
    // DIVIDED BY t, WHICH IS THE LEVER ARM. The bone pivots about its parent (already written
    // this frame), so the only thing that can move is the child; a push of d at a fraction t
    // along the bone is the same angular correction as a push of d/t at the far end. Applied
    // raw, everything near the parent under-rotates and the bone sinks in at its base — worst
    // nearest the root, where the chain is stiffest and the error is least forgivable.
    for (let pi = 1; pi <= nProxy; pi++) {
      const t = pi / (nProxy + 1);
      _proxy.copy(parPos).addScaledVector(_colTo.subVectors(pt, parPos), t);
      _proxyWas.copy(_proxy);
      if (!pushOutOfBones(_proxy, parR + (jointR - parR) * t, joint, par)) continue;
      pt.addScaledVector(_proxyDelta.subVectors(_proxy, _proxyWas), 1 / t);
      hit = true;
    }

    if (!hit) break;
    any = true;
    dir.subVectors(pt, parPos);
    if (dir.lengthSq() < 1e-12) break;
    dir.normalize();
    pt.copy(parPos).addScaledVector(dir, len);
  }
  return any;
}

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
// FORGET THE SPRING TARGET, so the next step re-derives it from the authored rest.
//
// `_physRest` is what the chain springs TOWARD, and it is adopted from the live pose whenever
// something other than the sim writes a joint — which is how a keyed tail follows its animation,
// and also how an IK drag makes the pulled pose the target for ever. Rest Pose put every joint
// back on `_ikRest` correctly and then the next physics step pulled the chain straight back off
// it, so the reset looked like it had restored a broken pose. matt: "there was a trace of it
// still visible in the rest pose... shouldn't activating the rest pose flush the physRest?"
//
// It should, and it needs no control of its own: Rest Pose already means everything goes back,
// and this was the one thing that did not. Clearing it rather than rewriting it from `_ikRest`
// keeps one definition of the rest in one place — the step re-captures from `_ikRest` when it
// finds nothing here.
//
// This is the symptom, not the cause. The drag should never have been able to write a target in
// the first place; see the note in panelTarget's neighbourhood and the adopt rule in step().
// DID THE SOLVER WRITE THIS JOINT ON THE FRAME WE ARE LOOKING AT?
//
// IKSolver publishes the joints it owns with a timestamp (see publishOwned). The stamp is what
// makes this self-clearing: nothing has to tear the set down, and a set left over from a solve
// two seconds ago cannot go on suppressing adoption for ever — which it did, because nothing
// ever cleared it.
//
// One frame at 60Hz is 16ms; 120 leaves room for a slow frame without letting a stale set count.
const OWNED_FRESH_MS = 120;
function solverWrote(id) {
  const ids = window._ikOwnedIds;
  if (!ids || !ids.has(id)) return false;
  const at = window._ikOwnedAt || 0;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return (now - at) < OWNED_FRESH_MS;
}

PhysicsBones.clearRest = function (main) {
  if (!main) return 0;
  let n = 0;
  for (const j of Skeleton.joints(main)) {
    if (j._physRest) { delete j._physRest; n++; }
    delete j._physWritten;
  }
  _state.clear();
  return n;
};

PhysicsBones.reset = function (main) {
  // The hold stands every rig driver down, and reset is one: it WRITES joints (that is its job,
  // putting them back on the pose physics started from), and a seek runs it -- so with the bind
  // pose held, loading or scrubbing would knock the rig straight off the pose being sculpted in.
  if (window._bindPoseHold) return;
  // RESTORED FROM THE JOINT, not from `_state`, which this function is about to throw away. The
  // state map only ever holds an entry for a joint physics has already stepped, so on the first
  // seek after a load -- or any seek after a previous reset wiped it -- there was nothing to
  // restore from and the chain kept whatever pose it had been bent into. matt: "the arm position
  // is offset and crumpled; its not able to go back to its bind pose at frame 1". Measured on
  // walkwave.sxr, scrubbing to frame 109 and back: 10 of 16 physics joints failed to return to
  // their frame-1 local pose, worst 0.098 -- and 0 of 16 with physics off, which is what named
  // physics rather than the solver as the cause.
  const restore = (joint) => {
    if (!joint) return;
    // NEVER SIMULATED YET: put it on the AUTHORED rest, not on whatever the file happened to
    // store. A physics chain has no keys and, with no active pin above it, no solver either --
    // so nothing defines its pose at all, and it simply keeps whatever it was saved in. Save a
    // scene mid-swing and that bent pose comes back as the rig's idea of frame 1 for ever.
    // matt: "compare on the first frame the values for the physics bone transforms vs their bind
    // pose values, they're clearly very different." Measured on pinxpbd.sxr, every physics joint
    // sat 0.15 to 0.79 away from its own _ikRest on frame 0, and evaluating the frame moved them
    // by nothing, because there was nothing to move them.
    if (!joint._physWritten) {
      if (joint._ikRest) { mat4Copy(joint.getMatrix(), joint._ikRest); Skeleton.syncThree(joint); }
      return;
    }
    // `_ikRest` FIRST, and `_physRest` only for a rig that has none. They are the same pose now
    // that nothing adopts into `_physRest` -- but only one of them is guaranteed to be the pose
    // the rig was DRAWN in, so that is the one to prefer when both exist.
    const rest = joint._ikRest || joint._physRest;
    if (!rest) return;
    // ...unless something else has written the joint since, in which case that is the pose now
    // and putting our older one back would undo it. Same rule the step uses.
    const now = joint.getMatrix();
    for (let k = 0; k < 16; k++) {
      if (Math.abs(now[k] - joint._physWritten[k]) > 1e-9) return;
    }
    mat4Copy(now, rest);
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

// ── SELF COLLISION (roadmap #36) ──────────────────────────────────────────────────────
//
// matt: flagged physics joints "swing through each other and through the rest of the rig", and
// he scoped the fix explicitly — BONES ONLY, not the skin, because the capsules are already the
// collision proxies the rig carries.
//
// A PARTICLE IS A SPHERE; A COLLIDER IS A TAPERED CAPSULE. That asymmetry is not a shortcut, it
// falls out of the formulation: this solver's only handle on the world is where each joint IS,
// so the thing being pushed can only ever be a point with a radius. A chain of such spheres is
// its own capsule for collision purposes, so a tail still reads as colliding along its length
// rather than at its joints. Segment-vs-segment would be more correct and has nothing to push:
// resolving it would mean distributing a correction over two particles that each have their own
// length constraint, which is a different solver.
//
// The capsule is TAPERED because the drawn bone is — a joint carries its own radius and a bone
// is the hull of the two spheres at its ends (see Skeleton.jointRadius). Colliding against a
// single average width would part company with what the user can see, and "it collides where it
// looks like it should" is the entire acceptance test for this feature.
const _colA = new THREE.Vector3(), _colB = new THREE.Vector3(), _colP = new THREE.Vector3();
const _proxy = new THREE.Vector3(), _proxyWas = new THREE.Vector3();
const _proxyDelta = new THREE.Vector3();
const _colAx = new THREE.Vector3(), _colTo = new THREE.Vector3();
let _colliders = null;

// Every bone in the rig, with the radius at each end. Rebuilt once per step() rather than per
// particle: the joint list and the radii cannot change during a step, only the POSITIONS can,
// and those are read live at test time — which is what keeps the pass Gauss-Seidel.
function buildColliders(main) {
  const out = [];
  const byJoint = new Map();     // joint -> the colliders that move when it moves
  for (const j of Skeleton.joints(main)) {
    const p = j._parentMesh;
    if (!p || !p._isBone) continue;
    const c = {
      a: p, b: j,
      ra: Skeleton.jointRadius(p, Skeleton.boneRadiusOf(main, p)),
      rb: Skeleton.jointRadius(j, Skeleton.boneRadiusOf(main, j)),
      // Cached endpoints, plus the broad-phase sphere derived from them. `stale` is what keeps
      // the cache honest — see refreshCollider.
      ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
      mx: 0, my: 0, mz: 0, reach: 0,
      stale: true,
    };
    out.push(c);
    for (const end of [p, j]) {
      let l = byJoint.get(end);
      if (!l) byJoint.set(end, (l = []));
      l.push(c);
    }
  }
  out.byJoint = byJoint;
  return out;
}

// CACHE THE ENDPOINTS; THIS IS THE WHOLE PERFORMANCE STORY.
//
// `Skeleton.jointPos` looks like a matrix read and is not. It goes through
// `Mesh.getModelSpaceMatrix`, and for a PARENTED mesh — which every joint in a skeleton is —
// that calls `updateWorldMatrix(true, false)` to walk the entire ancestor chain, then inverts a
// 4x4 and multiplies. Every call.
//
// The first cut read both endpoints of every collider inside the innermost loop: per collider,
// per proxy, per particle, per substep. On a ten-joint tail against a fifty-bone rig under
// XPBD's eight substeps that is 8 x 10 x 5 x 50 x 2 = FORTY THOUSAND ancestor-walks and matrix
// inversions per frame — which is why matt saw mobile VR fall over while the collision itself
// looked right. The arithmetic was never the cost.
//
// Cached, the same frame costs one read per bone per invalidation, so a few dozen.
//
// STALENESS IS PER JOINT, NOT PER FRAME, so the pass stays exactly Gauss-Seidel. Only SIMULATED
// joints move during a pass; everything else is static for the whole step. So a collider is
// re-read only when one of its own endpoints has actually been written this pass — which is what
// `markColliderStale` is for, called right where the solver writes a joint. Caching once per
// step instead would be faster still and WRONG in the way that matters: a joint would collide
// against where its neighbour was last substep, which is the same ordering hazard that made the
// first physics build four independent springs instead of a chain.
// WHERE A COLLIDER'S ENDPOINT ACTUALLY IS, preferring the SIM's own particle over the rig.
//
// Two reasons, and both matter. Correctness first: the XPBD solver runs eight substeps and only
// writes the rig AFTER all of them, so `Skeleton.jointPos` on a simulated joint returns LAST
// FRAME's position for the whole substep loop — a tail would collide with where it used to be.
// The particle is the live value in both solvers.
//
// And it is far cheaper: a map lookup and three reads, against an ancestor-chain walk plus a 4x4
// inversion and multiply. The rig is still the fallback, because the rest of the skeleton — the
// body a tail swings into — has no particle and is exactly where the matrices say it is.
function endPos(joint, out) {
  const st = _state.get(joint.getID());
  if (st && st.p) return out.copy(st.p);
  return Skeleton.jointPos(joint, out);
}

// `physCollidePerf()` from the console prints one line a second: how many capsule tests ran, how
// many the broad phase rejected, and how many endpoint re-reads (the expensive ancestor-walk)
// actually happened. Same shape as xrPerf/ikPerf, and reachable without an import — reaching for
// an env var in a headset is not a thing you can do. matt: "its a pain changing things like this
// with an envar in the console on the gxr."
const _cPerf = { tests: 0, rejected: 0, reads: 0, t0: 0 };
window.physCollidePerf = function (on) {
  window._physCollideTrace = on !== false;
  _cPerf.tests = _cPerf.rejected = _cPerf.reads = 0;
  _cPerf.t0 = performance.now();
  return !!window._physCollideTrace;
};
function collidePerfTick() {
  if (!window._physCollideTrace) return;
  const now = performance.now();
  if (now - _cPerf.t0 < 1000) return;
  console.log('[physCollide] %d tests/s, %d rejected by broad phase (%d%%), %d endpoint reads/s',
    _cPerf.tests, _cPerf.rejected,
    _cPerf.tests ? Math.round(_cPerf.rejected * 100 / _cPerf.tests) : 0, _cPerf.reads);
  _cPerf.tests = _cPerf.rejected = _cPerf.reads = 0;
  _cPerf.t0 = now;
}

function refreshCollider(c) {
  if (!c.stale) return;
  if (window._physCollideTrace) _cPerf.reads++;
  endPos(c.a, _colA);
  endPos(c.b, _colB);
  c.ax = _colA.x; c.ay = _colA.y; c.az = _colA.z;
  c.bx = _colB.x; c.by = _colB.y; c.bz = _colB.z;
  // The broad-phase sphere: midpoint, and the distance from it that anything of this bone can
  // reach. Recomputed with the endpoints because it is derived from them.
  c.mx = (c.ax + c.bx) * 0.5; c.my = (c.ay + c.by) * 0.5; c.mz = (c.az + c.bz) * 0.5;
  const hx = c.bx - c.mx, hy = c.by - c.my, hz = c.bz - c.mz;
  c.reach = Math.sqrt(hx * hx + hy * hy + hz * hz) + Math.max(c.ra, c.rb);
  c.stale = false;
}

// Everything this joint is an endpoint of has to be re-read before it is tested again.
function markColliderStale(joint) {
  if (!_colliders || !_colliders.byJoint) return;
  const l = _colliders.byJoint.get(joint);
  if (!l) return;
  for (let i = 0; i < l.length; i++) l[i].stale = true;
}

function markAllCollidersStale() {
  if (!_colliders) return;
  for (let i = 0; i < _colliders.length; i++) _colliders[i].stale = true;
}

// Push `pt` (radius `pr`) out of every bone that is not adjacent to the bone `par -> joint`.
// Returns true if anything moved.
//
// ADJACENCY IS EXCLUDED BY SHARED ENDPOINT, which is the standard rule and the only one that
// works here: a bone and its neighbour MEET at a joint, so they are permanently interpenetrating
// by construction and a collision pass that included them would jam the chain straight — every
// joint shoved away from a bone it is attached to. That covers the particle's own bone, its
// children, its siblings (two fingers off one palm meet at the palm) and the bone above its
// parent, and leaves everything a joint could actually swing into.
// HOW MANY PROXY POINTS A BONE NEEDS ALONG ITS LENGTH.
//
// matt: "would we be able to distribute points along the bones to act as collision proxies?" —
// and he is right that joint spheres alone are not enough. A chain of short joints IS its own
// capsule, so hair and tails collide correctly with nothing extra; but two LONG thin bones can
// cross in an X with both endpoints clear of each other, and nothing stops them.
//
// THE PROXIES NEED NO RIGIDITY CONSTRAINT, which is the part that sounds hard and is not. The
// two sides of the test are not symmetric: the COLLIDERS are already exact capsules tested
// analytically, so nothing passive needs proxies at all. Only the moving bone needs them, and
// there a proxy is a KINEMATIC FUNCTION of its two joints — a lerp — not a particle with degrees
// of freedom of its own. There is nothing to keep rigid and no active/passive bookkeeping,
// because a proxy cannot disagree with the bone it lies on.
//
// Spaced about a radius apart, which is the standard rule: gaps wider than the thinnest thing
// that could pass through them are how a proxy chain leaks. Capped, because this is the inner
// loop and a long bone with a tiny radius would otherwise ask for hundreds.
const PROXY_MAX = 4;
function proxyCount(len, r) {
  if (!(r > 1e-9) || !(len > 1e-9)) return 0;
  return Math.max(0, Math.min(PROXY_MAX, Math.floor(len / (2 * r)) - 1));
}

function pushOutOfBones(pt, pr, joint, par) {
  if (!_colliders || !_colliders.length) return false;
  let moved = false;
  for (let ci = 0; ci < _colliders.length; ci++) {
    const c = _colliders[ci];
    if (c.a === joint || c.b === joint || c.a === par || c.b === par) continue;
    refreshCollider(c);

    // BROAD PHASE, and it earns its place: most bones are nowhere near most joints, and this
    // rejects them in six subtractions and a compare instead of a clamped projection onto the
    // segment plus a taper lerp. On a whole-body rig it typically removes all but a handful.
    const dx = pt.x - c.mx, dy = pt.y - c.my, dz = pt.z - c.mz;
    const far = c.reach + pr;
    if (window._physCollideTrace) _cPerf.tests++;
    if (dx * dx + dy * dy + dz * dz > far * far) {
      if (window._physCollideTrace) _cPerf.rejected++;
      continue;
    }

    // Closest point on the segment, then the tapered width there.
    const axx = c.bx - c.ax, axy = c.by - c.ay, axz = c.bz - c.az;
    const len2 = axx * axx + axy * axy + axz * axz;
    let t = len2 > 1e-18
      ? ((pt.x - c.ax) * axx + (pt.y - c.ay) * axy + (pt.z - c.az) * axz) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = c.ax + axx * t, cy = c.ay + axy * t, cz = c.az + axz * t;
    let tox = pt.x - cx, toy = pt.y - cy, toz = pt.z - cz;
    const d = Math.sqrt(tox * tox + toy * toy + toz * toz);
    const want = pr + c.ra + (c.rb - c.ra) * t;
    if (d >= want) continue;
    // EXACTLY ON THE AXIS there is no direction to be pushed along, and inventing one puts the
    // joint somewhere arbitrary. Nudged along the bone's own perpendicular instead, which is
    // stable because the next iteration then has a real direction to work with.
    if (d < 1e-9) {
      tox = axy; toy = -axx; toz = 0;
      let l = Math.sqrt(tox * tox + toy * toy + toz * toz);
      if (l < 1e-9) { tox = 1; toy = 0; toz = 0; l = 1; }
      tox /= l; toy /= l; toz /= l;
    } else {
      tox /= d; toy /= d; toz /= d;
    }
    pt.set(cx + tox * want, cy + toy * want, cz + toz * want);
    moved = true;
  }
  return moved;
}


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
  // Rebuilt on first use; the endpoint cache is invalidated wholesale at the top of every step
  // because the ANIMATION may have moved any joint since the last one. Within a step the cache
  // is invalidated per joint at the point of each write, which is what keeps the pass
  // Gauss-Seidel — see refreshCollider.
  _colliders = null;
  markAllCollidersStale();
  collidePerfTick();
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
    const lamRate = DAMP_SCALE * dampRate(par.damping);
    const decay = Math.exp(-lamRate * h);  // exact, so it does not depend on h
    const gAcc = gravityUnits(main, par.gravity);
    const rigid = par.stiffness >= 1;
    // The blend weight is read once per chain per step: it is keyed on the ROOT, because the
    // chain is what it turns on and off and keying every joint of a tail separately would be a
    // way to get them out of step with each other.
    const blend = PhysicsBones.weight(root);
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
      const solverPosed = solverWrote(link.parent.getID());
      if (same && st.rest) { mat4Copy(now, st.rest); Skeleton.syncThree(link.parent); }
      // Re-pointed on the joint as well: assigning a NEW array here would otherwise leave the
      // joint holding the old one, and the two copies of "rest" would drift apart.
      // ADOPTED INTO THE STEP'S STATE ONLY, never onto the joint. `_physRest` persisted this, so a
      // pose adopted once outlived the reset that was supposed to undo it and was written into the
      // file. The authored rest is `_ikRest` and nothing here may write it: matt: "the only thing
      // that should change the rest pose is draw or tweak. everything else is a modification to
      // the pose, not the rest pose."
      else if (!same && !solverPosed) { st.rest = Array.prototype.slice.call(now); }
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
        // FROM THE AUTHORED REST where there is one -- both solvers, same rule. Capturing
        // "wherever it was the first time the sim ran" makes a saved mid-swing pose the
        // permanent rest, which is how a file came back with bent arms on frame 1.
        // WRITE-ONCE, AND FROM THE AUTHORED POSE. It is persisted on the joint because reset()
        // throws the state map away and a seek runs reset on every frame you land on -- held only
        // in the map, the next step found it missing and captured it fresh from the pose physics
        // had just bent. What was wrong was never the persistence, it was that the adopt branch
        // below used to REASSIGN it: a pose adopted once outlived the reset meant to undo it and
        // went into the file. Captured here and never written again, so it can only ever be the
        // rest the rig was drawn in.
        if (!link.parent._physRest) {
          link.parent._physRest = Array.prototype.slice.call(
            link.parent._ikRest || link.parent.getMatrix());
        }
        pst.rest = Array.prototype.slice.call(link.parent._physRest);
      }

      // The particle's own radius — what makes it a sphere rather than a point. Read per joint
      // rather than cached on the link, because a joint resized in the panel has to take effect
      // without resetting the sim.
      const jointR = par.collide
        ? Skeleton.jointRadius(j, Skeleton.boneRadiusOf(main, j)) : 0;

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
            // Structural mass only, and clamped so the impulse cannot exceed the velocity --
            // exactly as in stepXPBD, see the long notes there. The two solvers share these
            // parameters, so a drag slider that means one thing in one and something else in the
            // other is a setting you cannot carry between them.
            const _dc = par.drag * sp / (Math.max(unit, 1e-6) * (link.structMass || 1));
            _acc.addScaledVector(st.v, -Math.min(_dc, 1 / Math.max(h, 1e-6)));
          }
        }
        // THE EXACT SOLUTION OF v' = a - lambda*v OVER ONE STEP, not `(v + a*h) * decay`.
        //
        // The old form is only frame-rate independent while lambda*h is small, and raising the
        // damping range walked straight into where it is not: a terminal velocity of
        // a*h*d/(1-d) instead of a/lambda, which at 24fps and lambda 15 is 28% short of the
        // continuous answer. It had always been approximate; stronger damping merely made it
        // visible, as three seconds of sag differing by 0.144 across 24/60/120fps.
        //
        // v = v*d + (a/lambda)(1 - d) is exact for any h, so the curve above can be as steep as
        // it likes. Below a lambda worth dividing by, the undamped integration is the limit.
        if (lamRate > 1e-6) st.v.multiplyScalar(decay).addScaledVector(_acc, (1 - decay) / lamRate);
        else st.v.addScaledVector(_acc, h);
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

      // SELF COLLISION, after the length constraint for exactly the reason the ground is: push
      // first and re-project onto the bone's length afterwards, and the point goes straight back
      // inside whatever it was pushed out of.
      //
      // ALTERNATED rather than done once. The push and the length constraint are two surfaces
      // and a single pass of each lands on neither: pushing out moves the joint off its sphere
      // about the parent, and putting it back on that sphere moves it back into the collider.
      // Alternating converges on their intersection, which is a real position the bone can hold.
      // Two rounds is what a swinging chain needs; more buys accuracy nobody can see and this is
      // the innermost loop of the sim.
      //
      // NO CIRCLE TRICK HERE, unlike the ground. The ground is a plane, so the set of points at
      // the right distance from the parent AND on the floor has a closed form. A capsule has no
      // such form, so this is the iterative version of the same idea.
      if (par.collide) {
        // Built on FIRST USE, so a scene where nothing collides never walks the joint list at
        // all — and one that does walks it once per step rather than once per particle.
        if (!_colliders) _colliders = buildColliders(main);
        collideBone(_next, _pPar, rest, j, link.parent, jointR,
          Skeleton.jointRadius(link.parent, Skeleton.boneRadiusOf(main, link.parent)), _dir);
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
        // This rotation moved `j` and everything under it, so any collider with an endpoint
        // there must be re-read before it is tested again. Marked HERE, at the write, so the
        // cache cannot silently go stale if the write path changes.
        markColliderStale(j);
        markColliderStale(link.parent);
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
// ── XPBD ──────────────────────────────────────────────────────────────────────────────
//
// The same chains, solved as CONSTRAINTS instead of forces. matt: "vellum in houdini is based on
// xpbd is also friendly to constraints and soft weighting... can our physics system be pushed
// along similar lines? solver for gravity, drag etc, but also include forces like a pin weight
// into the solver?"
//
// Why it is worth having a second solver here at all: a pin becomes an ATTACHMENT CONSTRAINT
// whose compliance runs from infinite at weight 0 to zero at weight 1. That is continuous by
// construction, so there is no frame on which a limb joins the solve -- which is precisely the
// discontinuity the pin-weight pop turned out to be (v3.27.12: at w=0.08 the FABRIK solve alone
// moved the wrist 14.8 units and left it further from the pin than it started, and weighting the
// target, weighting the result, skipping the rest-seed, matching the pin first and keeping the
// chain permanently owned all failed to remove it).
//
// XPBD's compliance is time-step independent -- alpha~ = alpha / h^2 -- which is the other prize:
// the force solver needs SPRING_SCALE and an exp() decay to keep stiffness meaning roughly the
// same thing at different step sizes, and those are fudge factors for exactly this.
//
// Small substeps with ONE iteration each, which is the modern formulation (Macklin et al.) and
// cheaper than few steps with many iterations for chains this short. lambda therefore resets
// every substep and the projection is just dlambda = -C / (w + alpha~).
PhysicsBones.SUBSTEPS = 8;

// WHICH SOLVER, AND IT HAS TO SURVIVE A RELOAD. `window._physXPBD` alone is wiped by every page
// load, so setting it and then reloading the scene -- which is exactly what you do to test a
// solver on a rig -- silently puts you back on the old one and the difference looks like it did
// not work. matt, doing precisely that: "if i reload my scene, it is less juddery, but still pops
// strangely", which is the force solver's own signature.
// ON BY DEFAULT, and only off if you have said so. Measured on weight.sxr with a settled sim,
// the first frame of a twelve-frame pin fade moves 0.2 units under this solver against 20.6
// under the force one -- the pin is a constraint that eases on rather than a limb being switched
// into a solve. `physXPBD(false)` from the console goes back, and that choice persists too.
// BACK OFF BY DEFAULT while the constraint solver is finished. It removes the pop -- worst frame
// of a fade 6.5 against the force solver's 23.8 -- but with the pose compliance loosened enough
// for gravity and stiffness to have real authority, the hand no longer arrives: 12.49 units from
// the pin at full weight against 0.49 before. A pin that does not reach its pin is worse than a
// pop, so this is opt-in until it does both. `physXPBD(true)` selects it, and that persists.
// Through the app's own option store, not a private key: it is a setting, so it belongs in the
// settings menu -- and reaching a console to set an env var is not a thing you can do in a
// headset. matt: "its a pain changing things like this with an envar in the console on the gxr."
try {
  window._physXPBD = !!getOptionsURL().physicsXPBD;
} catch (_) { window._physXPBD = false; }

PhysicsBones.setSolver = function (on) {
  window._physXPBD = !!on;
  try { getOptionsURL.saveOption('physicsXPBD', !!on); } catch (_) {}
  if (window.screenLog) window.screenLog('Physics solver: ' + (on ? 'XPBD' : 'force'), 'cyan');
  return !!window._physXPBD;
};
// Reachable from the console without an import, like xrPerf and ikPerf.
window.physXPBD = PhysicsBones.setSolver;


// Compliance from a 0..1 slider. Both sliders read "how hard does this hold", so both map the
// same way: 1 is rigid (alpha 0) and 0 is absent (alpha infinite). Scaled by the scene unit
// squared because compliance is metres per newton and the rig's idea of a metre is arbitrary.
const _mqM = new THREE.Matrix4(), _mqP = new THREE.Vector3(), _mqS = new THREE.Vector3();
function modelQuatOf(obj, out) {
  _mqM.fromArray(obj.getModelSpaceMatrix());
  _mqM.decompose(_mqP, out, _mqS);
  return out;
}

// Does a pin hold this joint's ORIENTATION as well as its position? PIN_POS is a position goal
// only; PIN_FULL and PIN_ROT both state where the joint should FACE.
function pinHoldsOrientation(joint) {
  const m = IKSolver.pinMode ? IKSolver.pinMode(joint) : 0;
  return m === IKSolver.PIN_FULL || m === IKSolver.PIN_ROT;
}

// How hard a pin is holding this joint right now, 0 when it has none.
function pinHoldOf(joint) {
  const pin = IKSolver.pinObject && IKSolver.pinObject(joint);
  if (!pin || window._physPinConstraint === false) return 0;
  return IKSolver.pinWeight(joint) || 0;
}

function complianceFrom(v, scale, unit) {
  if (v >= 1) return 0;
  if (v <= 0) return Infinity;
  return scale * ((1 - v) / v) / (unit * unit);
}

// FITTED against the force solver, not guessed: the sliders have tuned looks behind them (the ear
// and the tail) and a constraint solver that reads the same numbers differently would silently
// retune every rig in every file. Overridable so the fit can be measured rather than argued.
// FITTED AGAINST STATIC SAG, which is the quantity the sliders are actually about: hang the rig
// still, let gravity pull, and measure how far the tip ends up from its animated pose. My first
// fit used mean deviation over a walk cycle instead -- but that is dominated by the WALK, so it
// matched the overall wobble while leaving gravity with almost no authority, and matt found it
// straight away: "changing stiffness/damp/gravity etc does nothing."
//
// Tip sag on weight.sxr (gravity 1 / gravity 4), force solver against this one at compliance 1:
//   stiffness 0.25   3.60 / 14.09   vs   4.18 / 14.35
//   stiffness 0.60   0.80 /  3.20   vs   0.95 /  3.73
// The soft end (0.05: 31.6 vs 19.7) under-sags, but that is where the force solver is nearly in
// free fall and its own numbers stop meaning much.
//
// PIN: swept against the worst frame of a twelve-frame fade -- 21.1 / 16.3 / 11.1 / 5.7 / 2.3 at
// 1e-3 / 1e-2 / 3e-2 / 1e-1 / 1. Both first guesses were three orders too stiff, which made the
// pin rigid at weight 0.08 and reproduced the very pop this is here to remove.
//
// PIN re-swept AFTER the pose fit, because the two interact: a softer pose means a floppier limb
// for the pin to drag, so the pin has to be softer too. At pose 1, the worst frame of the fade
// came out 7.8 / 7.9 / 6.1 / 6.2 at pin 1 / 3 / 10 / 30, and 30 has the quietest tail. It also
// lands closer -- 0.20 units off the pin at full weight against 0.49 at the stiffer pose.
//
// THE TRADE-OFF, stated plainly: the earlier pose value of 0.1 gave a prettier fade (worst frame
// 1.2) but it bought that by holding the limb so tightly that gravity and stiffness had almost
// no authority, which is the dead-controls complaint. A limb that can actually sag is a limb the
// pin has further to move. 6.2 against the force solver's 20.6 is the trade, and the controls
// work.
let POSE_COMPLIANCE = 1;
let PIN_COMPLIANCE  = 1;
PhysicsBones.setCompliance = function (pose, pin) {
  if (pose !== undefined) POSE_COMPLIANCE = pose;
  if (pin !== undefined) PIN_COMPLIANCE = pin;
  return { pose: POSE_COMPLIANCE, pin: PIN_COMPLIANCE };
};

const _xp = new THREE.Vector3(), _xprev = new THREE.Vector3(), _xg = new THREE.Vector3();
const _xTo = new THREE.Vector3(), _xDir = new THREE.Vector3(), _xPar = new THREE.Vector3();
const _xAnim = new THREE.Vector3(), _xRest = new THREE.Vector3(), _xPinP = new THREE.Vector3();
const _xQ = new THREE.Quaternion(), _xA = new THREE.Vector3(), _xB = new THREE.Vector3();
const _xQCur = new THREE.Quaternion(), _xQTgt = new THREE.Quaternion(), _xQI = new THREE.Quaternion();
const _xM = new THREE.Matrix4();

// One positional attachment: pull `p` toward `target`, softened by `alpha`. Returns nothing; `p`
// is moved in place. `w` is the inverse mass. With alpha 0 this is a hard snap, which is what a
// fully weighted pin should be.
// THE MISSING LAMBDA, and it is the whole difference between XPBD and PBD wearing XPBD's
// clothes. Without an accumulated multiplier every call applies a FRESH full correction, so
// solving a constraint twice corrects it twice and the iteration count becomes a hidden
// stiffness multiplier. That is PBD's known weakness and exactly what XPBD exists to remove:
// the `-aT * lam` term charges each correction against what has already been applied, so more
// iterations CONVERGE on the compliance's answer instead of stiffening past it.
//
// Measured before this: static sag was correctly substep-independent (13.9 / 14.4 / 14.5 / 14.6
// for 1 / 2 / 4 / 8 substeps -- the compliance term was always right) while STABILITY went the
// wrong way, residual motion 0 / 0 / 0 / 0.012 / 1.77 / 17.9 / 32.8 for 1 ... 64. A solver that
// gets worse with more iterations is not converging.
//
// `lam` is an array and `li` its slot, reset once per SUBSTEP by the caller -- which is the
// standard small-steps formulation (Macklin 2019), where alpha~ = alpha/h^2 carries the
// time-step independence and lambda carries the iteration independence.
function solveAttach(p, target, w, alpha, h, lam, li) {
  _xDir.subVectors(p, target);
  const C = _xDir.length();
  if (C < 1e-9 || !isFinite(alpha)) return;
  _xDir.multiplyScalar(1 / C);
  const aT = alpha / (h * h);
  const prev = lam ? lam[li] : 0;
  const dl = (-C - aT * prev) / (w + aT);
  if (lam) lam[li] = prev + dl;
  p.addScaledVector(_xDir, dl * w);
}

// The bone length, TWO-SIDED. Both ends move, split by inverse mass, and the chain's own root is
// the only kinematic point (wp = 0 there).
//
// One-sided was the first thing I wrote and it made the pin useless: the constraint pulled the
// wrist, and the very next line projected it straight back onto the sphere about a parent that
// never learned the pin had asked for anything. Measured that way, the arm barely moved through
// the fade -- 0.1 to 0.2 units a frame -- and ended 0.82 short of the pin. Sharing the correction
// is what lets a goal at the tip travel up the chain, which is the same thing FABRIK's backward
// sweep does and the reason a positional solver can do IK at all.
// The bone length, and NO LAMBDA -- which is the correction to the correction.
//
// This used to accumulate a multiplier like solveAttach does, on the reasoning that the down and
// up sweeps are two iterations of one constraint so the second "corrects an error the first one
// already removed". That reasoning does not survive contact with the code: C is RECOMPUTED from
// the current positions on every call, so once the down sweep has satisfied the length, C is
// zero and the up sweep does nothing. There was never a double-correction to prevent.
//
// What the lambda did instead was UNDO the first sweep. It subtracted `prev` from a quantity
// that is a position error, not a Lagrange multiplier: down sweep applies -C and stores it, up
// sweep then computes -0 - (-C) = +C and pulls the joint straight back out. The links stopped
// being rigid, and the chain stretched.
//
// WHAT IT DOES NOT DO IS STRETCH A BONE, and that is worth stating because it is the obvious
// thing to go looking for and it is never there. The output stage turns particles into joint
// ROTATIONS, so bone lengths are preserved by construction -- measured worst length error over a
// 90-frame whip, at every mass: exactly 0, with the bug and without it. The damage is to the
// POSE the solve converges to, not to the rigidity of the links.
//
// Measured on matt's camel_snap_anim.sxr, how far the chain extends after a hard drag of its
// pinned parent, as a percentage of dead straight (169.2 units over five bones):
//   mass      1     3.63    10     30     100
//   with     81.6   94.2   100.0  100.0   85.4      100.0 = dead straight, fully extended
//   without  79.6   83.5    86.8   87.8    88.9
// With the lambda the chain reaches FULL EXTENSION at mass 10 and 30 -- matt: "the entire bone
// chain snaps to an extreme position". Without it, extension rises gently and monotonically with
// mass, which is what a heavier chain being whipped should do. Note the 100 -> 85.4 on the top
// row: a response that is not even monotonic in mass is the signature of broken arithmetic
// rather than of physics, and it is why no combination of drag and damping could tame it.
//
// WHY IT LOOKED MASS-DEPENDENT, since the split below is a ratio and mass cancels in it: the
// pose spring's correction is -C/(1 + m*alpha~), so a heavier chain is held near its pose far
// more weakly and arrives at this function with a much larger C. The undo is proportional to C,
// so the same broken arithmetic is invisible at mass 1 and dominant by mass 10.
//
// alpha is 0 here on purpose -- a bone does not stretch -- and for a rigid constraint XPBD's
// projection reduces to exactly what is left below: dlambda = -C/wsum, applied as w*dlambda per
// end. The lambda term only ever carries the -alpha~*lambda feedback, which is zero when alpha
// is. solveAttach keeps its lambda because its alpha is NOT zero; that one is real XPBD.
//
// TWO-SIDED: both ends move, split by inverse mass, and the chain's own root is the only
// kinematic point (wp = 0 there).
//
// One-sided was the first thing I wrote and it made the pin useless: the constraint pulled the
// wrist, and the very next line projected it straight back onto the sphere about a parent that
// never learned the pin had asked for anything. Measured that way, the arm barely moved through
// the fade -- 0.1 to 0.2 units a frame -- and ended 0.82 short of the pin. Sharing the correction
// is what lets a goal at the tip travel up the chain, which is the same thing FABRIK's backward
// sweep does and the reason a positional solver can do IK at all.
function solveDistance(pPar, p, wPar, w, rest) {
  _xDir.subVectors(p, pPar);
  const d = _xDir.length();
  if (d < 1e-9) return;
  const wsum = wPar + w;
  if (wsum < 1e-12) return;
  _xDir.multiplyScalar(1 / d);
  const dl = -(d - rest);
  pPar.addScaledVector(_xDir, -(wPar / wsum) * dl);
  p.addScaledVector(_xDir, (w / wsum) * dl);
}

PhysicsBones.stepXPBD = function (main, dt) {
  const roots = PhysicsBones.roots(main);
  if (!roots.length) return 0;
  _colliders = null;              // per step, same contract as the force solver's
  markAllCollidersStale();
  const frameH = Math.max(1 / 240, Math.min(1 / 20, dt || 1 / 60));
  // Substeps are PER CHAIN now (below); the global stays as an override for bisecting one
  // setting against another without editing a rig.
  const Nover = (window._physSubsteps | 0) || 0;
  let moved = 0;
  window._physPinHeld = new Set();

  for (const root of roots) {
    const par = PhysicsBones.params(root);
    const links = PhysicsBones.chain(main, root);
    if (!links.length) continue;
    const N = Math.max(1, Nover || par.substeps || PhysicsBones.SUBSTEPS);
    const h = frameH / N;
    const ITER = Math.max(1, par.iterations || 1);
    const unit = (Skeleton.sceneUnit && Skeleton.sceneUnit(main)) || 1;
    const blend = PhysicsBones.weight(root);
    if (blend <= 0) {
      for (const link of links) {
        const st0 = _state.get(link.joint.getID());
        if (st0) { Skeleton.jointPos(link.joint, st0.p); st0.prev.copy(st0.p); st0.v.set(0, 0, 0); }
      }
      continue;
    }

    // The rest-pose rule is the force solver's, unchanged and for the same reasons: whoever wrote
    // the joint last decides what the rest pose is, and a solve is not an authored pose.
    for (const link of links) {
      const st = _state.get(link.parent.getID());
      if (!st || !st.written) continue;
      const now = link.parent.getMatrix();
      let same = true;
      for (let k = 0; k < 16; k++) {
        if (Math.abs(now[k] - st.written[k]) > 1e-9) { same = false; break; }
      }
      const solverPosed = solverWrote(link.parent.getID());
      if (same && st.rest) { mat4Copy(now, st.rest); Skeleton.syncThree(link.parent); }
      // ADOPTED INTO THE STEP'S STATE ONLY, never onto the joint. `_physRest` persisted this, so a
      // pose adopted once outlived the reset that was supposed to undo it and was written into the
      // file. The authored rest is `_ikRest` and nothing here may write it: matt: "the only thing
      // that should change the rest pose is draw or tweak. everything else is a modification to
      // the pose, not the rest pose."
      else if (!same && !solverPosed) { st.rest = Array.prototype.slice.call(now); }
    }

    // THE ANIMATED SHAPE OF THE CHAIN, read once per frame before anything is simulated: each
    // link's rest length and its direction from its parent. The pose constraint pulls toward
    // this shape carried on the SIMULATED parent, which is what makes a disturbance travel down
    // the chain as a wave rather than every joint answering on the same frame.
    const shape = [];
    for (const link of links) {
      Skeleton.jointPos(link.parent, _xPar);
      Skeleton.jointPos(link.joint, _xAnim);
      const d = _xAnim.distanceTo(_xPar);
      shape.push({ len: d, dir: _xAnim.clone().sub(_xPar).normalize(), animPar: _xPar.clone() });
    }

    const gAcc = gravityUnits(main, par.gravity);
    const decay = Math.exp(-DAMP_SCALE * dampRate(par.damping) * h);
    const aPose = complianceFrom(par.stiffness, POSE_COMPLIANCE, unit);

    // A PIN OUTRANKS THE BEND LIMIT, and this is what stopped an arm reaching its pin.
    //
    // The cone stops a chain folding back on itself under gravity: each joint may leave its
    // ANIMATED direction by at most maxBend. But a pin is not gravity -- it is an authored goal,
    // and reaching it routinely needs more than 50 degrees of deviation. So the cone clamped the
    // arm partway and the wrist sat there while the pin went on without it. Measured on
    // pinxpbd.sxr, wrist-to-pin distance from frame 115 (where the pin starts translating):
    //   as authored, maxBend 50    1.06 -> 5.66 -> 9.09 -> 10.15, then flat at ~9.9
    //   with the cone opened       under 1.4 throughout, ending 0.12
    //   with stiffness relaxed     still 9.91, so the pose spring was never the cause
    // It is the reach that is NOT the cause either: the arm is 27.89 long and the pin sits 21.5
    // to 23.1 from the shoulder the whole time. matt: "it tracks from frame 109 to 119, but then
    // gets left behind until frame 130 when the pin finishes its translation."
    //
    // Relaxed for the WHOLE chain, not just the pinned joint: the joints above it have to bend
    // for the wrist to get anywhere, so clamping them leaves the pin just as unreachable.
    let chainPinHold = 0;
    for (const link of links) chainPinHold = Math.max(chainPinHold, pinHoldOf(link.joint));
    const bendLimit = par.maxBend + (180 - par.maxBend) * Math.min(1, chainPinHold);

    // BELOW A PIN, THE CHAIN STOPS SIMULATING AND FOLLOWS THE POSE.
    //
    // The joints ABOVE a pin are solving for it -- that is the IK half, and they must keep
    // moving. The joints BELOW it are determined by nothing except gravity, so a pinned wrist
    // held its mark while the hand hanging off it drooped. matt: "the wrist is matching the pin
    // translation/rotation, and the elbow is respecting the extra aim constraint... but the hand
    // bones are still under gravity and collapse", asking for a rule that a constrained chain
    // moves "as if its in full fbik mode, especially if the pin weights are at 1".
    //
    // Scoped to below the pin rather than the whole chain, because zeroing the lot would take the
    // simulation away from the joints that are reaching FOR the pin, and the pin would stop being
    // reached. Faded by the pin's own weight, so this arrives with the handoff.
    let pinIdx = -1;
    for (let i = 0; i < links.length; i++) if (pinHoldOf(links[i].joint) > 0) pinIdx = i;
    const belowPinScale = 1 - Math.min(1, chainPinHold);

    // The particles of this chain, in order. Index i is links[i].joint; the chain's own root is
    // the kinematic anchor everything hangs from.
    const P = [], PREV = [], IM = [];
    // One multiplier per link per constraint, reset at the top of every substep.
    const lamPose = new Float64Array(links.length);
    for (let i = 0; i < links.length; i++) {
      const j = links[i].joint, id = j.getID();
      let st = _state.get(id);
      if (!st) {
        const at = Skeleton.jointPos(j).clone();
        st = { p: at.clone(), prev: at.clone(), v: new THREE.Vector3() };
        _state.set(id, st);
      }
      P.push(st); PREV.push(new THREE.Vector3()); IM.push(1 / (links[i].mass || 1));
    }
    // INERTIA, once per frame: how much of the parent's own travel the particle inherits before
    // it starts resisting. Dropped when this solver was first written -- the constraint network
    // does couple a chain, but not this, and it is the setting that separates "loose" from
    // "detached" (the ear at inertia 0 flails; see the force solver's note). Ported as it is
    // there, from the ANIMATED parent position frame to frame, so the two read the same.
    for (let i = 0; i < links.length; i++) {
      const st = P[i];
      // FOLLOW IS NOT USED BY THIS SOLVER, and that is a statement about the formulation rather
      // than a bug being dodged. Follow exists because the force solver's chain is four springs
      // that only loosely transmit, so a chain had to be TOLD to come along with the thing it
      // hangs off. XPBD couples it natively: the two-sided distance constraint is the coupling,
      // and adding a kinematic shove on top of it double-counts and destabilises.
      //
      // Measured on weight.sxr over 102 units of shoulder travel -- how far the tip strays from
      // its animated pose, mean and worst, WITH A FRESH LOAD PER RUN (rest poses adopt across
      // runs, so sequential ones contaminate each other and inflate the worst case):
      //   Follow 0     2.75 / 12.80   the chain follows the shoulder on its own
      //   Follow 0.35  5.21 / 14.74   with the carry applied
      //   Follow 0.9   5.10 / 23.63
      // With the carry ignored, all three are 2.75 / 12.80 -- the slider has no effect at all,
      // which is the point. matt: "if that is anything other than zero, the bones erratically
      // flap around."
      //
      // Kept as a read of the parameter rather than deleted, so the force solver's meaning of it
      // is untouched and the slider can come back if this ever grows a use for it.
      const carry = 0;
      if (st.lastPar && carry > 0) {
        _xDir.subVectors(shape[i].animPar, st.lastPar);
        st.p.addScaledVector(_xDir, carry);
        // BOTH ends of the step, or the shift reads as motion the chain performed and lands in
        // the velocity on the next update -- a kick, every frame, which is the "crazy".
        st.prev.addScaledVector(_xDir, carry);
      }
      (st.lastPar || (st.lastPar = new THREE.Vector3())).copy(shape[i].animPar);
    }

    const anchor = Skeleton.jointPos(links[0].parent, new THREE.Vector3());
    const parentOf = (i) => (i === 0 ? anchor : P[i - 1].p);
    const wOf = (i) => (i === 0 ? 0 : IM[i - 1]);

    for (let sub = 0; sub < N; sub++) {
      // Integrate every particle first, THEN solve. Interleaving the two -- which is what the
      // force solver does -- makes the pass a sequential filter rather than a solve, and a goal
      // at the tip can never reach the joints above it.
      for (let i = 0; i < links.length; i++) {
        const st = P[i];
        PREV[i].copy(st.p);
        _xg.set(0, -gAcc, 0);
        if (par.drag > 0) {
          const sp = st.v.length();
        // DRAG DIVIDES BY THE STRUCTURAL MASS ONLY, NOT BY THE USER'S MULTIPLIER.
        //
        // It used to divide by `link.mass`, which carries the multiplier -- so at mass 50 the
        // drag slider was 50x weaker, and on a long chain weaker again by however much hangs
        // below the link. The slider died exactly where it was needed. matt: "if the mass is
        // higher than 1, if i drag the root midly quickly, the entire bone chain snaps to an
        // extreme position... when the mass is high, no combination of drag, damp etc can stop
        // the snap." Measured on a 5-link chain, worst tip travel in one frame against an
        // anchor moving 6 units a frame: mass 1 gave 31.9, mass 50 gave 47.5 -- the whole chain
        // length in a frame -- and turning drag to its maximum made it 50.9, WORSE than leaving
        // it alone.
        //
        // a = F/m is the correct Newtonian reading and it is not the useful one here. Raising
        // mass is meant to make the chain SLOWER, and the reason it could instead make it
        // uncontrollable is that the two things that oppose the swing both vanish with mass at
        // once: the pose spring's correction is -C/(1 + m*alpha~), which is deliberate and IS
        // the frequency feature, and drag went with it. One of them has to survive, and drag is
        // the one that is a control rather than a physical constant -- the same reading that
        // gives stiffness its s/(1-s) curve and damping its pole at one.
        //
        // The root-drags-more gradient is untouched: structMass still carries it.
          // ...AND THE DRAG IMPULSE CANNOT EXCEED THE VELOCITY IT OPPOSES.
          //
          // Drag is quadratic (a = -drag*|v|*v), integrated explicitly, so the change it makes in
          // one step is drag*|v|*h/unit times the velocity. Once that factor passes 1 the term
          // REVERSES the velocity instead of removing it, and a bigger drag setting then adds
          // energy -- which is why turning drag up used to make the snap worse, and why the
          // response was not even monotonic: measured at mass 50, worst tip travel in a frame ran
          // 64.5 / 23.0 / 50.8 / 34.3 for drag 0.1 / 0.3 / 0.6 / 1.0. A damping control that gets
          // WORSE when you turn it up is unusable however well it is scaled.
          //
          // Clamped at 1/h the term is strictly dissipative: it can bring the velocity to zero in
          // one step and never past it. This is the cheap read of an implicit solve, and it is
          // the same shape of fix as the lambda accumulation -- stop a correction overshooting
          // what it was correcting.
          const coefMax = 1 / Math.max(h, 1e-6);
          if (sp > 1e-9) {
            const coef = par.drag * sp / (Math.max(unit, 1e-6) * (links[i].structMass || 1));
            _xg.addScaledVector(st.v, -Math.min(coef, coefMax));
          }
        }
        // NO DAMPING HERE. The constraint pass ends by REPLACING the velocity with the motion it
        // allowed, so a decay applied to the prediction is thrown away again a few lines later
        // and the chain never loses energy -- which is why a rig standing perfectly still failed
        // to settle at all: stiffness came out non-monotonic (9.08 / 4.16 / 13.48 for 0.05 /
        // 0.25 / 0.6) and INERTIA moved a static chain, which nothing should. Damped after the
        // update instead, where it is the velocity that survives.
        st.v.addScaledVector(_xg, h);
        st.p.addScaledVector(st.v, h);
      }

      // THE MULTIPLIERS, RESET PER SUBSTEP. That is the small-steps XPBD contract: alpha~ makes
      // the constraint time-step independent, lambda makes it iteration independent, and lambda
      // belongs to one substep's solve. `window._physXPBDLambda = false` puts the old
      // accumulate-nothing behaviour back, for an A/B against this.
      const useLam = window._physXPBDLambda !== false;
      if (useLam) lamPose.fill(0);

      // ITERATIONS WITHIN THE SUBSTEP, sharing the substep's lambdas -- which is the only reason
      // this is a QUALITY knob rather than a second stiffness knob. Each pass charges its
      // correction against what the earlier ones applied, so more passes converge on the
      // compliance's answer instead of stacking past it. Before lambda, this loop would have
      // been a way to make the chain stiffer and less stable, which is what raising substeps
      // used to do.
      for (let it = 0; it < ITER; it++) {
        // THE POSE, softly. Carried on the simulated parent, so a disturbance travels down the
        // chain as a wave instead of every joint answering on the same frame.
        for (let i = 0; i < links.length; i++) {
          _xAnim.copy(parentOf(i)).addScaledVector(shape[i].dir, shape[i].len);
          solveAttach(P[i].p, _xAnim, IM[i], aPose, h, useLam ? lamPose : null, i);
        }

        // BONE LENGTH, hard, swept down the chain and back up. The return sweep is what carries
        // a pull at the tip into the joints above it -- the same job FABRIK's backward pass
        // does. Both sweeps share one lambda per link, so the pair converges rather than
        // doubling up.
        for (let i = 0; i < links.length; i++)
          solveDistance(parentOf(i), P[i].p, wOf(i), IM[i], shape[i].len);
        for (let i = links.length - 1; i >= 0; i--)
          solveDistance(parentOf(i), P[i].p, wOf(i), IM[i], shape[i].len);
      }

      // THE PIN, as an attachment constraint, and LAST so it has the final word. Solved before
      // the length sweeps it was always overruled by them: the pin is rigid at weight 1, but the
      // bone length is rigid too and ran after it, leaving the hand a constant 0.47 short of the
      // pin whatever the compliance. Last, the pin is exact when it is fully on and the length
      // error it leaves is taken up by the next substep.
      // THE PIN, as an attachment constraint. This is the whole point: weight 0 is an infinite
      // compliance and therefore no constraint at all, weight 1 is rigid, and every value between
      // is a genuine partial hold rather than a limb being switched into a solve on one frame.
      for (let i = 0; i < links.length; i++) {
        const j = links[i].joint;
        const pin = IKSolver.pinObject && IKSolver.pinObject(j);
        if (!pin || window._physPinConstraint === false) continue;
        window._physPinHeld.add(j.getID());
        const pw = IKSolver.pinWeight(j);
        if (pw <= 0) continue;
        _xM.fromArray(pin.getModelSpaceMatrix());
        _xPinP.set(_xM.elements[12], _xM.elements[13], _xM.elements[14]);
        solveAttach(P[i].p, _xPinP, IM[i], complianceFrom(pw, PIN_COMPLIANCE, unit), h);
      }


      for (let i = 0; i < links.length; i++) {
        const st = P[i];
        _xPar.copy(parentOf(i));
        // The floor: the circle where the bone's sphere meets the ground plane, so both hold.
        if (par.ground && st.p.y < par.groundY) {
          const drop = _xPar.y - par.groundY;
          const r2 = shape[i].len * shape[i].len - drop * drop;
          if (r2 > 1e-12) {
            const ring = Math.sqrt(r2);
            _xDir.set(st.p.x - _xPar.x, 0, st.p.z - _xPar.z);
            if (_xDir.lengthSq() < 1e-12) _xDir.set(1, 0, 0);
            _xDir.normalize();
            st.p.set(_xPar.x + _xDir.x * ring, par.groundY, _xPar.z + _xDir.z * ring);
          }
          if (st.v.y < 0) st.v.y = 0;
        }
        // SELF COLLISION — the same `collideBone` the force solver runs, so the two cannot
        // drift. THIS IS THE PATH THAT ACTUALLY RUNS FOR matt: he keeps XPBD on, because the
        // force solver cannot animate pin constraints on and off. The built-in default is still
        // the force solver, so both are live depending on the saved option — which is exactly
        // why the response is one shared function rather than two that look alike.
        if (par.collide) {
          if (!_colliders) _colliders = buildColliders(main);
          const jt = links[i].joint, pj = links[i].parent;
          collideBone(st.p, _xPar, shape[i].len, jt, pj,
            Skeleton.jointRadius(jt, Skeleton.boneRadiusOf(main, jt)),
            Skeleton.jointRadius(pj, Skeleton.boneRadiusOf(main, pj)), _xDir);
        }
        // The bend cone, so a chain cannot fold back on itself.
        if (bendLimit < 180) {
          _xRest.copy(shape[i].dir);
          _xDir.subVectors(st.p, _xPar);
          if (_xDir.lengthSq() > 1e-12) {
            _xDir.normalize();
            const cosLim = Math.cos(bendLimit * Math.PI / 180);
            const dot = Math.max(-1, Math.min(1, _xRest.dot(_xDir)));
            if (dot < cosLim) {
              const ang = Math.acos(dot);
              const t = 1 - (bendLimit * Math.PI / 180) / ang;
              _xDir.lerp(_xRest, t).normalize();
              st.p.copy(_xPar).addScaledVector(_xDir, shape[i].len);
            }
          }
        }
      }

      // XPBD's velocity update: the velocity IS whatever motion the constraints allowed -- and
      // the damping goes here, on that velocity, or it is discarded (see the note above).
      for (let i = 0; i < links.length; i++) {
        P[i].v.subVectors(P[i].p, PREV[i]).multiplyScalar(1 / h).multiplyScalar(decay);
      }
    }

    // OUTPUT, once per frame rather than once per substep: turn each particle into its parent's
    // rotation. Identical to the force solver's, including the blend applied to what is WRITTEN
    // while the simulation underneath runs at full strength.
    for (const link of links) {
      const j = link.joint;
      const st = _state.get(j.getID());
      if (!st) continue;
      const pid = link.parent.getID();
      let pst = _state.get(pid);
      if (!pst) { pst = { p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3() }; _state.set(pid, pst); }
      pst.joint = link.parent;
      if (!pst.rest) {
        // FROM THE AUTHORED REST where there is one, for the same reason: capturing "wherever it
        // was the first time the sim ran" makes a saved mid-swing pose the permanent rest.
        // WRITE-ONCE, AND FROM THE AUTHORED POSE. It is persisted on the joint because reset()
        // throws the state map away and a seek runs reset on every frame you land on -- held only
        // in the map, the next step found it missing and captured it fresh from the pose physics
        // had just bent. What was wrong was never the persistence, it was that the adopt branch
        // below used to REASSIGN it: a pose adopted once outlived the reset meant to undo it and
        // went into the file. Captured here and never written again, so it can only ever be the
        // rest the rig was drawn in.
        if (!link.parent._physRest) {
          link.parent._physRest = Array.prototype.slice.call(
            link.parent._ikRest || link.parent.getMatrix());
        }
        pst.rest = Array.prototype.slice.call(link.parent._physRest);
      }
      Skeleton.jointPos(link.parent, _xPar);
      Skeleton.jointPos(j, _xAnim);
      // A link is "below the pin" when the joint it rotates about sits at or past the pinned one:
      // nothing it does can help reach the pin, so at full hold it simply follows the pose.
      const li = links.indexOf(link);
      const effBlend = (pinIdx >= 0 && li > pinIdx) ? blend * belowPinScale : blend;
      // AND THE PARTICLE IS PARKED, not merely blended past. Lerping only what is WRITTEN leaves
      // the particle simulating underneath with its own momentum, so the hand still eased down
      // through the pose on its way to nowhere -- worst droop 3.39 rather than the 9.45 it was,
      // but not the "full fbik" matt asked for. Parked, it starts each frame on the pose it is
      // going to be written to, and releasing the pin later resumes from there rather than from
      // wherever gravity had dragged it meanwhile. Same thing the chain-level "fully off" branch
      // does, applied per link.
      if (effBlend <= 0) { st.p.copy(_xAnim); st.prev.copy(_xAnim); st.v.set(0, 0, 0); }
      _xTo.copy(st.p);
      if (effBlend < 1) _xTo.lerp(_xAnim, 1 - effBlend);
      _xA.subVectors(_xAnim, _xPar);
      _xB.subVectors(_xTo, _xPar);
      // A 6DOF PIN OWNS THE JOINT'S ROTATION, because there is only one of them to own.
      //
      // `links[i].joint` IS `links[i+1].parent`, so the channel the sim uses to aim the next bone
      // at its particle is the same channel that decides which way a pinned wrist FACES. They
      // cannot both have it. A positional solver has nothing to say about facing -- that is the
      // half of a 6DOF pin XPBD does not model -- so under one, the pin takes it: matt, "its not
      // following rotation, which i know xpbd doesn't account for."
      //
      // Its POSITION still comes from the particle chain, through its own parent's aim one link
      // up, so this costs the pin nothing positionally. Slerped by the pin's weight, so a fade
      // brings the orientation in with everything else rather than snapping it on.
      const oriW = pinHoldsOrientation(link.parent) ? pinHoldOf(link.parent) : 0;
      const oriPin = oriW > 0 && IKSolver.pinObject ? IKSolver.pinObject(link.parent) : null;
      if (oriPin) {
        modelQuatOf(link.parent, _xQCur);
        modelQuatOf(oriPin, _xQTgt);
        _xQ.copy(_xQTgt).multiply(_xQCur.invert());
        if (oriW < 1) _xQI.identity().slerp(_xQ, oriW), _xQ.copy(_xQI);
        IKSolver.rotateJoint(link.parent, _xQ);
        pst.written = Array.prototype.slice.call(link.parent.getMatrix());
        link.parent._physWritten = pst.written;
        moved++;
      } else if (_xA.lengthSq() > 1e-12 && _xB.lengthSq() > 1e-12) {
        _xQ.setFromUnitVectors(_xA.normalize(), _xB.normalize());
        IKSolver.rotateJoint(link.parent, _xQ);
        pst.written = Array.prototype.slice.call(link.parent.getMatrix());
        link.parent._physWritten = pst.written;
        moved++;
      }
      pst.lastPar = pst.lastPar || new THREE.Vector3();
      Skeleton.jointPos(link.parent, pst.lastPar);
    }
  }
  return moved;
};

// THE ONE PLACE THE SOLVER IS CHOSEN. Everything that advances the sim goes through here --
// the per-frame tick AND bake. Bake reaching past it for the force solver would write keys that
// do not match the motion you just watched, which is the one thing a bake must never do.
PhysicsBones.solveStep = function (main, dt) {
  return window._physXPBD ? PhysicsBones.stepXPBD(main, dt) : PhysicsBones.step(main, dt);
};

PhysicsBones.tick = function (main, nowSeconds) {
  if (!PhysicsBones.roots(main).length) return false;
  // NOT WHILE THE BIND POSE IS HELD. Physics writes joints every frame, so with the hold on it
  // is what drags the rig off the pose being sculpted in -- measured, 16 of 33 joints inside a
  // single frame. Read off `window` rather than imported: Skinning is not in this module's
  // import graph and must not be, the same reason every other cross-module flag here is global.
  if (window._bindPoseHold) return false;
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
  PhysicsBones.solveStep(main, dt);
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
  for (let i = 0; i < preroll; i++) PhysicsBones.solveStep(main, h);

  let frames = 0;
  for (let t = start; t <= end + 1e-6; t += h) {
    evaluateAt(t);                       // the keyed pose for this frame...
    PhysicsBones.solveStep(main, h);     // ...then the sim on top of it
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
