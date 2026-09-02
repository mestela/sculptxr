// The compensation in Skeleton.moveJoint, run for real.
//
// matt's trace: a child 1.9 units from its joint reached 56 in about thirty frames of Tweak
// Free — roughly 1.1x per frame — while the compensation reported err=0.0000 on every one of
// them. Both facts at once are the whole story: it was converting each child OUT to model space
// and back through three.js world matrices, and re-measuring with the same conversion that had
// just lied to it. A small scale residual, applied to the child's offset every frame, is
// exponential.
//
// So this harness does what the trace could not: it runs many moves and checks that a child is
// still where it started. A single move cannot see this bug — it only shows up over frames.
//
// Run: node scratchpad/movejoint_test.mjs
//   MJ_INJECT=worldtrip   the model-space round trip is restored, with a 1% scale error in the
//                         conversion — which is what the world matrices were contributing
//   MJ_INJECT=nofix       the parent delta is never applied, so children ride along instead
//   MJ_INJECT=lateseal    the bracket is opened AFTER the rotation — the actual bug: the twist's
//                         swing is then never undone, and accumulates a frame at a time
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const glm = await import(path.join(REPO, 'node_modules/gl-matrix/esm/index.js'));
const mat4 = glm.mat4;
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

const inject = process.env.MJ_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The function under test, lifted from source so the shipped arithmetic is what runs.
const at = SRC.indexOf('Skeleton.moveJoint = function');
const end = SRC.indexOf('\n};', at);
let body = SRC.slice(at, end + 3);
check('moveJoint is liftable', at > 0 && /const before = mat4\.clone/.test(body),
  'the function moved, or the fix is not in it');

if (inject === 'worldtrip') {
  // What the old code effectively did: convert out and back through a transform that is not
  // quite the one used on the way in. 1% is generous — the real residual was smaller.
  body = body.replace(
    'const before = mat4.clone(joint.getModelSpaceMatrix());',
    'const before = mat4.clone(joint.getModelSpaceMatrix()); mat4.scale(before, before, [1.01, 1.01, 1.01]);');
} else if (inject === 'nofix') {
  body = body.replace('mat4.multiply(local, fix, local);', '');
}

const Skeleton = { childJoints: (main, j) => main.kids.get(j) || [] };
const fn = new Function('mat4', 'Skeleton', 'window',
  body + '\nreturn Skeleton.moveJoint;')(mat4, Skeleton, { _tweakTrace: false });

// A joint and two children, as a rig has: the parent carries a model matrix, each child a LOCAL
// one relative to it. getModelSpaceMatrix on a child is parentModel * childLocal, which is what
// the real Mesh does once the world-group scale is divided out.
const mk = (local) => ({ _m: mat4.clone(local), getMatrix() { return this._m; } });
const parent = { _model: mat4.create(), getMatrix() { return this._model; },
  getModelSpaceMatrix() { return this._model; },
  setModelSpaceMatrix(m) { mat4.copy(this._model, m); } };
const kidA = mk(mat4.fromTranslation(mat4.create(), [8.3, -0.9, -1.7]));
const kidB = mk(mat4.fromTranslation(mat4.create(), [-8.3, -0.9, -1.7]));
const main = { kids: new Map([[parent, [kidA, kidB]]]) };
Skeleton.syncThree = () => {};

const worldOf = (kid) => {
  const m = mat4.create();
  mat4.multiply(m, parent.getModelSpaceMatrix(), kid.getMatrix());
  return [m[12], m[13], m[14]];
};

let pos = { x: 0, y: 18.5, z: 4.75 };
const pos0 = { x: pos.x, y: pos.y, z: pos.z };
mat4.fromTranslation(parent._model, [pos.x, pos.y, pos.z]);

const startA = worldOf(kidA), startB = worldOf(kidB);

// THIRTY FRAMES OF A DRAG, the length of matt's capture. Each frame moves the parent a little,
// exactly as a hand does.
for (let f = 0; f < 30; f++) {
  pos = { x: pos.x, y: pos.y + 0.1, z: pos.z - 0.02 };
  fn(main, parent, pos, true);
}

const endA = worldOf(kidA), endB = worldOf(kidB);
const driftA = Math.hypot(endA[0] - startA[0], endA[1] - startA[1], endA[2] - startA[2]);
const driftB = Math.hypot(endB[0] - startB[0], endB[1] - startB[1], endB[2] - startB[2]);

check('a compensated child does not move when its parent does',
  driftA < 1e-6 && driftB < 1e-6,
  'drift after 30 frames: ' + driftA.toFixed(4) + ' / ' + driftB.toFixed(4));

// The distance from the joint is the number that ran away in the trace, so it is checked on its
// own: a child can be "near enough" in world terms and still be flying outward.
const distStart = Math.hypot(startA[0] - pos0.x, startA[1] - pos0.y, startA[2] - pos0.z);
const pEnd = parent.getModelSpaceMatrix();
const distEnd = Math.hypot(endA[0] - pEnd[12], endA[1] - pEnd[13], endA[2] - pEnd[14]);
check('...and the distance to the joint changes only by the parent\'s own move',
  Math.abs(distEnd - distStart) < 3.1,
  'from ' + distStart.toFixed(2) + ' to ' + distEnd.toFixed(2)
  + ' — matt saw 1.9 become 56 over this many frames');

// Without compensation the child rides along, which is FK and must still work.
{
  const kid = mk(mat4.fromTranslation(mat4.create(), [1, 0, 0]));
  const p2 = { _model: mat4.create(), getMatrix() { return this._model; },
    getModelSpaceMatrix() { return this._model; },
    setModelSpaceMatrix(m) { mat4.copy(this._model, m); } };
  const m2 = { kids: new Map([[p2, [kid]]]) };
  fn(m2, p2, { x: 5, y: 0, z: 0 }, false);
  const w = mat4.create();
  mat4.multiply(w, p2.getModelSpaceMatrix(), kid.getMatrix());
  check('an UNcompensated child rides along with its parent',
    Math.abs(w[12] - 6) < 1e-6, 'x = ' + w[12].toFixed(3) + ', expected 6');
}

// ── A ROTATION IN THE SAME FRAME MUST BE COMPENSATED TOO ──────────────────────────────
//
// THE ACTUAL BUG. A tweak drag rotates the joint and then moves it. moveJoint compensates what
// IT does, so the snapshot was taken after the rotation had already swung the children — the
// swing was never undone, and every frame wrote a little more of it permanently into the
// children's locals. matt proved it from the console: `_boneTwist = false` cured the runaway
// while `_boneCompensate = false` merely turned Free into FK.
//
// So the bracket has to open BEFORE the rotation. This runs the shipped begin/endCompensate
// around a rotate-then-move, thirty frames deep, exactly as the tool now does.
{
  let SK = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const from = SK.indexOf('Skeleton.beginCompensate = function');
  const to = SK.indexOf('Skeleton.moveJoint = function');
  let bracket = SK.slice(from, to);
  check('the bracket is liftable', from > 0 && to > from);

  const Sk2 = { childJoints: (main, j) => main.kids.get(j) || [], syncThree: () => {} };
  const api = new Function('mat4', 'Skeleton', bracket + '\nreturn Skeleton;')(mat4, Sk2);

  const p = { _model: mat4.create(), getMatrix() { return this._model; },
    getModelSpaceMatrix() { return this._model; },
    setModelSpaceMatrix(m) { mat4.copy(this._model, m); } };
  const kid = { _m: mat4.fromTranslation(mat4.create(), [8.3, -0.9, -1.7]),
    getMatrix() { return this._m; } };
  const m3 = { kids: new Map([[p, [kid]]]) };
  mat4.fromTranslation(p._model, [0, 18.5, 4.75]);
  const world = () => { const w = mat4.create(); mat4.multiply(w, p._model, kid._m); return [w[12], w[13], w[14]]; };
  const s0 = world();

  const rot = mat4.create();
  for (let f = 0; f < 30; f++) {
    const late = inject === 'lateseal';
    // The bug is entirely in WHERE this line sits relative to the rotation below.
    const tok = late ? null : api.beginCompensate(m3, p);
    // Rotate the joint (the twist), keeping its translation — as _twistTo does.
    mat4.fromYRotation(rot, 0.02 * (f + 1));
    rot[12] = p._model[12]; rot[13] = p._model[13]; rot[14] = p._model[14];
    mat4.copy(p._model, rot);
    const tok2 = late ? api.beginCompensate(m3, p) : tok;
    // ...then move it.
    p._model[13] += 0.1;
    api.endCompensate(tok2);
  }
  const s1 = world();
  const drift = Math.hypot(s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]);
  check('a child is held still across a ROTATION as well as a move',
    drift < 1e-3,
    'drift after 30 rotate+move frames: ' + drift.toExponential(2)
    + ' — compensating only the move lets the swing accumulate');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
