// Node harness for REPARENTING A RIG NODE — Scene.setMeshParent.
//
// matt: "i've accidentally tried it a few times and things explode, it should be a stable
// operation." Two separate faults, and the second is the one that detonates:
//
//   1. NO UNDO. There was no state entry at all, so an accidental reparent had no way back.
//   2. THE REST POSE DID NOT MOVE WITH IT. `_ikRest` is a joint's LOCAL matrix at rest —
//      relative to its parent. `attach` rewrites the local matrix to preserve the WORLD
//      transform, leaving `_ikRest` expressed in the OLD parent's space. Every solve calls
//      seedFromRest, which copies `_ikRest` straight back into the local matrix, slamming the
//      joint to a transform that meant something under a parent it no longer has.
//
// Fault 2 arrives on the NEXT SOLVE, not on the reparent, which is exactly why it never looked
// like the reparent's fault.
//
// Run: node scratchpad/reparent_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   RP_INJECT=norest    the rest matrix is left in the old parent's space — the explosion
//   RP_INJECT=noundo    the reparent stops pushing an undo entry
//   RP_INJECT=nocache   the solver's joint/pin caches are left stale across the change
//   RP_INJECT=nobend    the cached bend reference survives a rest-shape change
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const IK = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');

{
  const i = process.env.RP_INJECT || '';
  const cut = (a, b) => {
    if (!SRC.includes(a)) throw new Error('inject ' + i + ': the anchor moved');
    SRC = SRC.replace(a, b);
  };
  if (i === 'norest') cut('const R = new THREE.Matrix4().fromArray(restBefore).premultiply(newW);',
    'const R = new THREE.Matrix4().fromArray(restBefore);');
  else if (i === 'noundo') cut("      false, 'Set Parent');", '      false, null);');
  else if (i === 'nocache') cut('      IKSolver.syncJointCache?.(this);', '');
  else if (i === 'nobend') cut('      child._boneBendRef = null;', '');
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The method, sliced out so every check is about THIS operation and not a lookalike elsewhere.
const a = SRC.indexOf('  setMeshParent(childId, parentId, opts) {');
const FN = SRC.slice(a, SRC.indexOf('\n  getParentMesh(', a));
check('setMeshParent is liftable', FN.length > 0 && FN.length < 8000, FN.length);

// ── the rest pose travels with the joint ─────────────────────────────────────
check('the rest matrix is rebased into the new parent’s space',
  /newW\.copy\(newP\.matrixWorld\)\.invert\(\)\.multiply\(oldW\);/.test(FN)
    && /fromArray\(restBefore\)\.premultiply\(newW\)/.test(FN),
  'left in the old parent’s space, the next solve slams the joint through seedFromRest');
check('...and the delta is the SAME one attach applied to the live matrix',
  /inv\(newParentWorld\) \*/.test(FN) || /D = inv\(newParentWorld\)/.test(FN),
  'a different delta for rest and current is a rig that drifts apart every solve');
check('...taken from the OLD parent before the reparent happens',
  FN.indexOf('const restBefore = child._ikRest;') < FN.indexOf('apply(parent, null, restAfter);'),
  'reading the old parent after attach reads the new one');
check('a joint with no rest recorded stays that way',
  /child\._ikRest = restMatrix \? mat4\.clone\(restMatrix\) : null;/.test(FN),
  'inventing a rest here would make the first solve after a reparent define it from a pose');

// This is the mechanism the bug rides on — assert it still exists, so the check above keeps
// meaning what it says.
check('seedFromRest really does copy _ikRest into the live matrix',
  /mat4\.copy\(j\.getMatrix\(\), j\._ikRest\);/.test(IK),
  'if this ever stops being true, the rebase above is guarding nothing');

// ── one undo ─────────────────────────────────────────────────────────────────
check('a reparent pushes an undo entry', /pushStateCustom\?\.\(/.test(FN)
  && /'Set Parent'/.test(FN),
  'no way back is most of why an accidental reparent read as an explosion');
check('...unless the caller is wrapping a bigger edit in one step',
  /if \(!opts \|\| !opts\.silent\) \{/.test(FN),
  'a split that undid in three presses leaves the user in a rig nobody built');
check('...restoring the exact local matrix, not just the parent',
  /mat4\.copy\(child\.getMatrix\(\), localMatrix\);/.test(FN),
  'attach preserves the WORLD transform, and the world may have moved since');
check('...and the rest matrix with it',
  /rest: child\._ikRest \? mat4\.clone\(child\._ikRest\) : null/.test(FN)
    && (FN.match(/rest: child\._ikRest/g) || []).length === 2,
  'an undo that restores the pose but not the rest leaves the same bug behind');
check('...through ONE function, so undo and redo cannot diverge',
  /const apply = \(toParent, localMatrix, restMatrix\) =>/.test(FN),
  'two code paths for one operation is two chances to get the inverse wrong');

// ── the caches ───────────────────────────────────────────────────────────────
check('the solver’s joint and pin caches are re-synced',
  /IKSolver\.syncJointCache\?\.\(this\);/.test(FN) && /IKSolver\.syncPinCache\?\.\(this\);/.test(FN),
  'a stale cache is the difference between a reparent and a rig that tears itself apart');
check('the cached bend reference is dropped',
  /child\._boneBendRef = null;/.test(FN),
  'the bend is a fact about the rest shape, which just changed');
check('the visuals and the outliner are told',
  /Skeleton\.updateVisuals\?\.\(this\);/.test(FN) && /Skeleton\.refreshOutliner\?\.\(this\);/.test(FN));

// ── the refusals ─────────────────────────────────────────────────────────────
check('a cycle is still refused', /would create a cycle/.test(FN));
// "ALREADY THERE" MEANS BOTH SIDES AGREE. Checking only `_parentMesh` skipped the re-attach
// when restoring a mesh that had been removed silently — `removeMeshSilent` leaves
// `_parentMesh` pointing at the old parent, so the logical side matched while the three side
// sat under the world group. The saved LOCAL matrix was then applied to a mesh with the wrong
// parent, and the joint landed at its local coordinates read as world ones.
check('reparenting to the parent it already has is not an edit',
  /if \(child\._parentMesh === \(parent \|\| null\) && _curTM && _curTM\.parent === _wantTM\) return;/.test(FN),
  'otherwise a no-op click costs an undo entry and a full resync');
check('...but only when the THREE parent agrees too',
  /const _wantTM = parent \? parent\.getThreeMesh\(\) : this\._worldGroup;/.test(FN),
  'a silently removed mesh keeps its _parentMesh, so the logical check alone skips the '
    + 're-attach and the joint lands in the wrong place');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
