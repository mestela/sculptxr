// Node harness for FK ROLL on an IK rig — roadmap #59, Tier 2.
//
// THE CLAIM THIS EXISTS TO CHECK: FABRIK is positional, so a joint with ONE child has its twist
// about the bone left undetermined by the maths. Rotating about the axis that POINTS AT THE
// CHILD therefore moves nothing the solver cares about — the child stays exactly where the
// solve put it — while everything below the joint turns.
//
// If that is true, FK roll is free on an IK rig. If it is false, the whole tier is worthless
// and the far larger seed-pose work in Tier 3 is the only route. So it is checked numerically,
// not asserted.
//
// Run: node scratchpad/fkroll_test.mjs
//   FK_INJECT=worldaxis   the roll is applied about a fixed axis instead of the bone's
//   FK_INJECT=premul      the roll is applied before the fit, so it rotates the fit itself
//   FK_INJECT=swingtoo    the decomposition keeps the swing as well, so pointing the bone
//                         somewhere else is stored as a roll
//   FK_INJECT=multichild  the roll is applied to joints with several children, where the
//                         geometry already determines the rotation and there is no free twist
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');

const inject = process.env.FK_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
if (inject === 'worldaxis') {
  cut('  _vRoll.set(lm[12], lm[13], lm[14]);', '  _vRoll.set(0, 1, 0);', inject);
} else if (inject === 'premul') {
  cut('  q.multiply(_qRoll);', '  q.premultiply(_qRoll);', inject);
} else if (inject === 'swingtoo') {
  // The twist decomposition keeps the whole rotation, so the swing is stored as roll as well.
  cut('  const d = q.x * ax + q.y * ay + q.z * az;', '  const d = 1;', inject);
} else if (inject === 'multichild') {
  cut('  if (!roll || kids.length !== 1) return false;', '  if (!roll) return false;', inject);
}

// Lift applyFkRoll and run it for real. It is pure given a node, its kids and a quaternion.
const at = SRC.indexOf('function applyFkRoll');
const body = SRC.slice(at, SRC.indexOf('\n}', at) + 2);
const applyFkRoll = new Function('THREE', '_vRoll', '_qRoll',
  body + '\nreturn applyFkRoll;')(THREE, new THREE.Vector3(), new THREE.Quaternion());

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A joint whose single child sits 2 units along local +X.
const childAt = (x, y, z) => ({ joint: { getMatrix: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1] } });
const node = (roll) => ({ joint: { _fkRoll: roll } });

// ── THE LOAD-BEARING PROPERTY ─────────────────────────────────────────────────────────
{
  const kid = childAt(2, 0, 0);
  const q = new THREE.Quaternion();          // fit result: identity, for a clean measurement
  const applied = applyFkRoll(node(Math.PI / 3), [kid], q);
  check('a roll is applied to a single-child joint', applied === true);

  // The child's position in the joint's frame, before and after.
  const before = new THREE.Vector3(2, 0, 0);
  const after = before.clone().applyQuaternion(q);
  check('the child does not move, so the solve is undisturbed',
    after.distanceTo(before) < 1e-12,
    'child moved ' + after.distanceTo(before).toExponential(2)
      + ' -- if this is nonzero the roll is fighting the position constraint and the whole '
      + 'tier is worthless');

  // ...while a point OFF the axis does turn: that is the roll doing its job.
  const off = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  check('...but everything off the bone axis turns with it',
    Math.abs(off.y - Math.cos(Math.PI / 3)) < 1e-9 && off.z > 0.8,
    'off-axis point -> ' + [off.x, off.y, off.z].map((v) => v.toFixed(3)).join(','));
}

// The axis is the CHILD's direction, whatever that is — not a fixed world axis.
{
  for (const [x, y, z] of [[0, 3, 0], [0, 0, -2], [1, 1, 1]]) {
    const kid = childAt(x, y, z);
    const q = new THREE.Quaternion();
    applyFkRoll(node(0.7), [kid], q);
    const before = new THREE.Vector3(x, y, z);
    const after = before.clone().applyQuaternion(q);
    check('a child at ' + [x, y, z].join(',') + ' still does not move',
      after.distanceTo(before) < 1e-12, after.distanceTo(before).toExponential(2));
  }
}

// ── WHERE IT MUST NOT APPLY ───────────────────────────────────────────────────────────
{
  const q = new THREE.Quaternion();
  check('no roll on a joint with several children',
    applyFkRoll(node(1), [childAt(2, 0, 0), childAt(0, 2, 0)], q) === false
      && q.angleTo(new THREE.Quaternion()) < 1e-12,
    'two or more children pin the rotation down completely -- there is no free twist, and '
      + 'forcing one would fight the fit and lose');
  const q2 = new THREE.Quaternion();
  check('no roll when there is no roll to apply',
    applyFkRoll(node(0), [childAt(2, 0, 0)], q2) === false);
  const q3 = new THREE.Quaternion();
  check('no roll when the child sits on top of the joint, so there is no axis',
    applyFkRoll(node(1), [childAt(0, 0, 0)], q3) === false);
}

// ── IT COMPOSES WITH THE FIT, IT DOES NOT REPLACE IT ──────────────────────────────────
{
  // A fit that swings the bone from +X to +Y, then a roll about the bone.
  const fit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const q = fit.clone();
  applyFkRoll(node(0.9), [childAt(2, 0, 0)], q);
  const kidAfter = new THREE.Vector3(2, 0, 0).applyQuaternion(q);
  const kidFit = new THREE.Vector3(2, 0, 0).applyQuaternion(fit);
  check('the fit still lands the child exactly where it did',
    kidAfter.distanceTo(kidFit) < 1e-12,
    'post-multiplying rolls about the bone; pre-multiplying would rotate the FIT and move the '
      + 'child off its solved position');
}

// ── SWING-TWIST: KEEPING ONLY THE HALF THAT SURVIVES ──────────────────────────────────
//
// A hand rotating a joint produces a swing (pointing the bone somewhere else) and a twist
// (about the bone). On a solver-owned joint the swing is not the animator's to keep -- the solve
// decides where the bone points -- but the twist is, because nothing determines it.
{
  const at2 = SRC.indexOf('IKSolver.twistAbout = function');
  const b2 = SRC.slice(at2, SRC.indexOf('\n};', at2) + 3)
    .replace('IKSolver.twistAbout = function', 'return function');
  const twistAbout = new Function(b2)();
  const AX = new THREE.Vector3(1, 0, 0);

  for (const a of [0.4, -0.9, 2.2, -2.9]) {
    const q = new THREE.Quaternion().setFromAxisAngle(AX, a);
    check('a pure twist of ' + a + ' reads back as itself',
      Math.abs(twistAbout(q, AX) - a) < 1e-9, twistAbout(q, AX).toFixed(6));
  }
  // A pure SWING has no twist to give -- this is the half that must be discarded.
  for (const [ax, ay, az] of [[0, 1, 0], [0, 0, 1], [0, 1, 1]]) {
    const v = new THREE.Vector3(ax, ay, az).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(v, 1.1);
    check('a pure swing about ' + [ax, ay, az].join(',') + ' reads as no twist',
      Math.abs(twistAbout(q, AX)) < 1e-9, twistAbout(q, AX).toExponential(2));
  }
  // Swing and twist together: only the twist comes back.
  {
    const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
    const twist = new THREE.Quaternion().setFromAxisAngle(AX, 0.5);
    const q = swing.clone().multiply(twist);
    check('a mixed rotation gives back only its twist',
      Math.abs(twistAbout(q, AX) - 0.5) < 1e-9, twistAbout(q, AX).toFixed(6));
  }
  check('a degenerate case returns zero rather than NaN',
    twistAbout(new THREE.Quaternion(0, 1, 0, 0), AX) === 0);
}

// The roll is measured from the pose at the PRESS and set absolutely -- accumulating per frame
// would integrate the same gesture once per frame of a slow drag.
{
  const TOOL = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');
  check('the drag sets the roll from its start pose, not per frame',
    /IKSolver\.clearFkRoll\(p\.joint\);\s*\n\s*IKSolver\.addFkRoll\(p\.joint, p\.rollStart \+ IKSolver\.twistAbout\(dq, p\.rollAxis\)\);/.test(TOOL),
    'a slow drag would otherwise add the same twist dozens of times');
  check('...and only on a joint the solver is going to overwrite',
    /owned = IKSolver\.solverOwnedIds\(this\._main\)\.has\(joint\.getID\(\)\);/.test(TOOL),
    'an unpinned joint keeps whatever pose it is given -- Tier 1 already works there, and '
      + 'storing a roll as well would apply it twice');
  check('...worked out once at the press, not per frame',
    /_beginPose\(joint, quat\) \{[\s\S]{0,900}?solverOwnedIds/.test(TOOL),
    'solverOwnedIds rebuilds the rig graph');
  check('...and only where there is a single child to roll about',
    /if \(kids\.length === 1\) \{/.test(TOOL));
}

// ── THE STORE ─────────────────────────────────────────────────────────────────────────
check('roll accumulates rather than replacing',
  /joint\._fkRoll = \(joint\._fkRoll \|\| 0\) \+ radians;/.test(SRC),
  'a twist gesture is a series of small additions, each building on the last');
check('...and is stored as an ANGLE, not folded into a matrix',
  /IKSolver\.fkRoll = function \(joint\) \{ return \(joint && joint\._fkRoll\) \|\| 0; \};/.test(SRC),
  'the solve rewrites the joint rotation every frame, so the roll cannot live inside it');
check('the absolute branch applies it inside the fit it just computed',
  /fitLocalRotation\(n, kids, _qLocal\);\s*\n\s*applyFkRoll\(n, kids, _qLocal\);/.test(SRC));
check('...and the delta branch applies it too',
  /if \(n\.joint\._fkRoll\) \{[\s\S]{0,400}?applyFkRoll\(n, kids, _qJoint\)/.test(SRC),
  'a root with one child takes the delta path, and is exactly the case where roll is free');

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
