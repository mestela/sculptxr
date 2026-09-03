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

// A mock rig. A joint is a position and a parent; "rotating" a joint means moving everything
// below it rigidly, which is what a rotation does and is all this module can observe.
const prelude = `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
const window = {};
const _all = [];
const Skeleton = {
  joints: () => _all,
  jointPos: (j, out) => (out || new THREE.Vector3()).copy(j.wp),
  sceneUnit: () => 2,          // 1 unit = 1 metre, so gravity 1 reads as 9.8
};
const IKSolver = {
  // The real one turns a model-space rotation into a joint's local matrix. Here it applies the
  // rotation to the subtree about the joint's own origin, which is the same thing observed
  // from outside — and it is the observable behaviour every check below is written against.
  rotateJoint: (joint, q) => {
    const walk = (n) => {
      for (const c of _all) {
        if (c._parentMesh !== n) continue;
        c.wp.sub(joint.wp).applyQuaternion(q).add(joint.wp);
        walk(c);
      }
    };
    walk(joint);
  },
};
export { _all, Skeleton };
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
const J = (x, y, z, parent) => {
  const j = { _id: nextId++, wp: new THREE.Vector3(x, y, z), _parentMesh: parent || null,
    getID() { return this._id; } };
  ALL.push(j);
  return j;
};
const rig = () => {
  ALL.length = 0; nextId = 1;
  const body_ = J(0, 0, 0);            // the thing the tail hangs off
  const t0 = J(0, -1, 0, body_);       // tail base — the flagged joint
  const t1 = J(0, -2, 0, t0);
  const t2 = J(0, -3, 0, t1);
  return { body: body_, t0, t1, t2 };
};
const len = (a, b) => a.wp.distanceTo(b.wp);

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
  r.t1.wp.set(1, -1, 0); r.t2.wp.set(2, -1, 0);
  const main = {};
  PB.reset(main);
  const y0 = r.t2.wp.y;
  for (let i = 0; i < 120; i++) PB.step(main, 1 / 60);
  check('a horizontal tail falls under gravity', r.t2.wp.y < y0 - 0.2,
    'tip y went ' + y0.toFixed(2) + ' -> ' + r.t2.wp.y.toFixed(2));
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
    r.body.wp.x = Math.sin(i * 0.3) * 2;          // shake the thing it hangs off, hard
    PB.step(main, 1 / 60);
  }
  check('bone lengths survive a violent shake',
    Math.abs(len(r.t0, r.t1) - l1) < 1e-6 && Math.abs(len(r.t1, r.t2) - l2) < 1e-6,
    l1.toFixed(4) + '/' + l2.toFixed(4) + ' -> '
    + len(r.t0, r.t1).toFixed(4) + '/' + len(r.t1, r.t2).toFixed(4));
  check('...and the chain stays finite',
    [r.t1, r.t2].every((j) => Number.isFinite(j.wp.x + j.wp.y + j.wp.z)),
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
  const p1 = r.t1.wp.clone(), p2 = r.t2.wp.clone();
  for (let i = 0; i < 60; i++) PB.step(main, 1 / 60);
  check('stiffness 1 leaves the animated pose exactly alone',
    r.t1.wp.distanceTo(p1) < 1e-9 && r.t2.wp.distanceTo(p2) < 1e-9,
    'moved ' + r.t2.wp.distanceTo(p2).toExponential(2));
}

// ── IT LAGS, WHICH IS THE WHOLE POINT ─────────────────────────────────────────────────
{
  const r = rig();
  PB.setRoot(null, r.t0, true);
  PB.setParams(r.t0, { stiffness: 0.1, damping: 0.6, gravity: 0 });
  const main = {};
  PB.reset(main);
  // Yank the anchor sideways in one frame and look at whether the tip followed immediately.
  r.t0.wp.x += 1; r.t1.wp.x += 1; r.t2.wp.x += 1;      // the rig moves rigidly...
  PB.step(main, 1 / 60);                               // ...and the sim should resist
  check('the tip lags behind a sudden move of its anchor', r.t2.wp.x < 1,
    'tip x = ' + r.t2.wp.x.toFixed(3) + ' after the anchor jumped to 1');
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
    [r.t1, r.t2].every((j) => Number.isFinite(j.wp.length()) && j.wp.length() < 20),
    'tip at ' + r.t2.wp.length().toFixed(2));
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
    r.t1.wp.set(1, -1, 0); r.t2.wp.set(2, -1, 0);      // horizontal, with somewhere to fall
    const main = {};
    PB.reset(main);
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) PB.step(main, 1 / fps);
    return r.t2.wp.y;
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
