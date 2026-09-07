import fs from 'fs';
import { mat4 } from 'gl-matrix';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};
const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/tools/BoneDrawTool.js', 'utf8');

// ── UNDO/REDO OF A DRAWN JOINT MUST BE THE IDENTITY ───────────────────────────────────────
//
// matt: "draw out a joint chain, while drawing it undo and redo. the joint will redo, but scaled
// up. keep doing an undo and redo, the joint gets larger and larger."
//
// The mechanism, in three steps that are each individually reasonable:
//   1. removeMeshSilent detaches the three mesh but does NOT clear `_parentMesh`;
//   2. addMeshSilent re-adds it under _worldGroup, so its LOCAL-to-parent matrix is now sitting
//      in the graph as though it were a world one;
//   3. setMeshParent calls Object3D.attach, which PRESERVES WORLD -- so the new local it derives
//      is parentWorld⁻¹ · (old local), and the parent's inverse is folded in once more.
//
// Each cycle multiplies by that inverse again. A joint's scale is well under 1 in world units,
// so the compounding grows without bound. This models the arithmetic directly: no THREE, no
// scene, just the matrix identity that has to hold.
{
  const parentScale = 0.05;          // a joint radius in world units — the real case is small
  const parentWorld = mat4.create();
  mat4.scale(parentWorld, parentWorld, [parentScale, parentScale, parentScale]);
  const parentInv = mat4.invert(mat4.create(), parentWorld);

  const creationLocal = mat4.create();      // the matrix createJoint produced, the truth
  mat4.translate(creationLocal, creationLocal, [1, 2, 3]);

  // The broken redo: derive a new local from a world-preserving attach, every cycle.
  const worldPreserving = (local) => mat4.multiply(mat4.create(), parentInv, local);
  let broken = mat4.clone(creationLocal);
  const scaleOf = (m) => Math.hypot(m[0], m[1], m[2]);
  const before = scaleOf(broken);
  for (let i = 0; i < 5; i++) broken = worldPreserving(broken);
  const after = scaleOf(broken);

  check('the world-preserving redo really does compound', after > before * 100,
    'scale went ' + before.toFixed(3) + ' -> ' + after.toFixed(3)
      + '; if this does not grow the model no longer matches the bug');

  // The fix: restore the snapshot. Five cycles, still identical.
  let fixed = mat4.clone(creationLocal);
  for (let i = 0; i < 5; i++) fixed = mat4.clone(creationLocal);
  check('...and restoring the creation matrix is stable across cycles',
    scaleOf(fixed) === scaleOf(creationLocal)
      && fixed.every((v, i) => Math.abs(v - creationLocal[i]) < 1e-12),
    'a redo that is not the identity is a redo that drifts');
}

// ── AND THE CODE ACTUALLY DOES THAT ───────────────────────────────────────────────────────
{
  check('the creation matrix is snapshotted for every made joint',
    /for \(const m of made\) \{\s*\n\s*m\.matrix = mat4\.clone\(m\.mesh\.getMatrix\(\)\);/.test(SRC),
    'nothing to restore, so redo falls back to re-deriving it');

  check('...including the rest matrix, which is also local',
    /m\.rest = m\.mesh\._ikRest \? mat4\.clone\(m\.mesh\._ikRest\) : null;/.test(SRC),
    '_ikRest is a LOCAL matrix — the recorded reparent trap in this codebase');

  const redo = (SRC.match(/\(\) => \{\s*\n\s*for \(const m of made\) \{\s*\n\s*main\.addMeshSilent[\s\S]*?\n      \},/) || [''])[0];
  check('redo restores the matrix after reparenting, not before',
    redo.indexOf('setMeshParent') < redo.indexOf('mat4.copy(m.mesh.getMatrix(), m.matrix)'),
    'the reparent would overwrite the restored matrix again');
  check('...and syncs the three side, or the restore is invisible',
    /mat4\.copy\(m\.mesh\.getMatrix\(\), m\.matrix\);[\s\S]{0,200}?Skeleton\.syncThree\(m\.mesh\);/.test(SRC),
    'the TWO-MATRICES trap: writing _matrix without syncThree leaves the drawn one stale');
}

// ── THE PATTERN ALREADY EXISTED; THE DRAW PATH JUST NEVER GOT IT ──────────────────────────
//
// RigTopology.restore does this correctly and its comments record the same symptom from the
// dissolve path -- matt, then: "all the joint spheres doubled in size." Reparent, THEN write the
// local matrix, THEN sync the three side, THEN one top-down updateMatrixWorld so anything reading
// a world matrix sees the whole hierarchy. The scene unit is the joint extent when nothing is
// bound, so a half-updated graph resizes every marker in the rig.
{
  const RT = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/RigTopology.js', 'utf8');
  check('RigTopology still restores the matrix after the reparent',
    RT.indexOf('setMeshParent(e.mesh.getID()') < RT.indexOf('mat4.copy(e.mesh.getMatrix(), e.matrix)'),
    'the reference implementation for this has changed and the two paths now disagree');
  check('the draw path refreshes world matrices once the locals are back',
    /\(main\._worldGroup \|\| main\._scene\)\?\.updateMatrixWorld\?\.\(true\);/.test(SRC),
    'the scene unit reads world matrices, and a half-updated graph resizes every joint marker');
}

// ── A TWEAK'S FIRST FRAMES, REPORTED ──────────────────────────────────────────────────────
//
// matt: "tweak fk tool / move the top of leg / it scales 100x too big as soon as i touch it."
// Two different faults look the same on screen: the joint's own matrix gaining scale, or the
// joint being flung far enough that the SCENE UNIT -- measured from the joint extent when
// nothing is bound -- grows and takes every marker with it. The second is recorded twice in this
// codebase already (the dissolve undo, and the reparent early-return). Reading the code did not
// separate them, so the trace reports both at once.
{
  const BD = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/tools/BoneDrawTool.js', 'utf8');
  const MM2 = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MainMenuPanel.js', 'utf8');
  const tr = (BD.match(/if \(window\._tweakTrace[\s\S]*?\n    \}/) || [''])[0];

  check('the tweak trace reports the joint AND its parent', /parent=/.test(tr),
    'the repro is specifically the first joint whose parent is another joint');
  check('...both scales, so a matrix fault and a scene-unit fault are distinguishable',
    /localScale=/.test(tr) && /modelScale=/.test(tr) && /parentModelScale=/.test(tr),
    'one number cannot tell "the joint grew" from "the ruler shrank"');
  check('...and the scene unit, which is the other candidate',
    /sceneUnit=/.test(tr),
    'with no bound mesh this is measured from the joint extent and moves everything at once');
  check('...capped at three frames per touch',
    /<= 3\)/.test(tr) && /this\._tweakTraceN = 0;/.test(BD),
    'a per-frame trace during a drag is the noise matt just asked to be rid of');
  check('...and reachable from the settings menu',
    /id: 'mm-tweak-trace'[\s\S]{0,160}?_tweakTrace/.test(MM2));
  check('...off until asked for', !/window\._tweakTrace = true/.test(BD));
}

// ── SCALE COMPOUNDS DOWN THE CHAIN ────────────────────────────────────────────────────────
//
// From matt's trace, checked arithmetically:
//
//   bone_01_L  parentModel 0.1902 x local 1.7346 = 0.3300  (reported 0.3300)
//   bone_02_L  parentModel 0.3300 x local 1.0891 = 0.3594  (reported 0.3594)
//   bone_03_L  parentModel 0.3594 x local 1.9993 = 0.7185  (reported 0.7185)
//
// Exact to four decimals on all three. A joint's world size is the PRODUCT of every ancestor's
// scale, so bone_03 is 3.78x bone_00 -- and any per-joint scale error multiplies into every
// descendant and into the mirrored chain, which is what "symmetry gets out of wack, bones get
// bigger and smaller" looks like from the inside.
//
// It also kills the other hypothesis outright: sceneUnit read 29.232 on every single line, so
// the ruler is not moving. This is the joints.
{
  // The identity itself, so a future change that decouples joint size from the hierarchy has to
  // come past this rule and say so.
  const chain = [
    { local: 1.7346, parentModel: 0.1902, model: 0.3300 },
    { local: 1.0891, parentModel: 0.3300, model: 0.3594 },
    { local: 1.9993, parentModel: 0.3594, model: 0.7185 },
  ];
  const holds = chain.every((c) => Math.abs(c.parentModel * c.local - c.model) < 5e-4);
  check('a joint\'s model scale is its parent\'s times its own', holds,
    'the recorded measurement no longer reproduces, so the model of the bug is wrong');

  const BD2 = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/tools/BoneDrawTool.js', 'utf8');
  check('a grab is measured before and after, not only during',
    /g\._tweakBefore/.test(BD2) && /line\('GRAB  ', B\.joint, snap\(g\.joint\)\);/.test(BD2),
    'within one drag every number is constant, so per-frame lines cannot see accumulation');
  check('...including the twin, since symmetry drifting is the same accumulation',
    /line\('  twin', B\.twin, snap\(g\.twin\)\);/.test(BD2));
  check('...and the children, which is where a parent scale change lands',
    /B\.kids\.forEach/.test(BD2));
  check('the per-frame line reports the real mode',
    /'  mode=' \+ this\._mode/.test(BD2),
    'this.mode is not a property on the tool and printed undefined in matt\'s trace');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
