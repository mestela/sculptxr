// Node harness for SPLIT and DISSOLVE — src/editing/RigTopology.js.
//
// Both are TOPOLOGY edits, and the work is not the geometry: it is saying what happens to the
// things that referred to the joint. So these checks are mostly about parentage, the rest pose,
// pins and undo, and they RUN the real source rather than reading it.
//
// Run: node scratchpad/rigtopo_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   RT_INJECT=cascade      dissolve removes the joint BEFORE reparenting its children, so the
//                          limb below it is orphaned — the Delete behaviour this must not have
//   RT_INJECT=noundo       neither verb pushes an undo entry
//   RT_INJECT=presencelast restore sets parents before re-adding meshes, so undoing a dissolve
//                          reparents onto a joint that is not in the scene yet
//   RT_INJECT=childfirst   restore walks children before parents, so a child's world transform
//                          is computed from a parent that is not back yet
//   RT_INJECT=splitroot    split stops refusing a root, and invents a parent for it
//   RT_INJECT=norest       a split joint is created with no rest pose
//   RT_INJECT=nomirrorsplit a split stops taking the twin bone with it
//   RT_INJECT=unpairedmids  both sides split, but the two new joints are never paired
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/RigTopology.js'), 'utf8');

{
  const i = process.env.RT_INJECT || '';
  const cut = (a, b) => {
    if (!SRC.includes(a)) throw new Error('inject ' + i + ': anchor moved — ' + a.slice(0, 40));
    SRC = SRC.replace(a, b);
  };
  if (i === 'cascade') cut(
    '  for (const k of kids) {\n    main.setMeshParent(k.getID(), parent ? parent.getID() : null, { silent: true });\n  }',
    '');
  else if (i === 'noundo') cut(
    '  main.getStateManager?.()?.pushStateCustom?.(\n    () => restore(main, before), () => restore(main, after), false, label);',
    '  void main; void before; void after; void label;');
  else if (i === 'childfirst') cut(
    '  const ordered = snap.filter((e) => e.present).sort((a, b) => depthOf(a) - depthOf(b));',
    '  const ordered = snap.filter((e) => e.present).sort((a, b) => depthOf(b) - depthOf(a));');
  else if (i === 'presencelast') cut(
    '  for (const e of snap) {\n    const has = main.getIndexMesh(e.mesh) >= 0;',
    '  for (const e of []) {\n    const has = main.getIndexMesh(e.mesh) >= 0;');
  else if (i === 'splitroot') cut(
    "  return !!(joint && Skeleton.isJoint(joint) && joint._parentMesh\n    && Skeleton.isJoint(joint._parentMesh) && main.getIndexMesh(joint) >= 0);",
    '  return !!(joint && Skeleton.isJoint(joint) && main.getIndexMesh(joint) >= 0);');
  else if (i === 'norest') cut('    m._ikRest = mat4.clone(m.getMatrix());', '');
  else if (i === 'nomirrorsplit') cut('  const targets = twinOk ? [joint, twin] : [joint];', '  const targets = [joint];');
  else if (i === 'unpairedmids') cut(
    '    mids[0]._boneMirror = mids[1];\n    mids[1]._boneMirror = mids[0];', '');
}

// ── stubs: a tiny scene that behaves the way the real one does where it matters ──
const gen = path.join(path.dirname(fileURLToPath(import.meta.url)), '_rigtopo_gen.mjs');
const prelude = `
const mat4 = {
  clone: (m) => m.slice(),
  copy: (a, b) => { for (let i = 0; i < 16; i++) a[i] = b[i]; return a; },
};
globalThis.__created = [];
const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  jointPos: (j) => ({ x: j.m[12], y: j.m[13], z: j.m[14] }),
  childJoints: (main, j) => main.getMeshes().filter((m) => m._isBone && m._parentMesh === j),
  syncThree: () => {},
  updateVisuals: () => {},
  refreshOutliner: () => {},
  // The real one goes through addNewMesh/addMeshSilent and setMeshParent; the stub does the
  // same two things so 'silent' and parentage are genuinely exercised.
  createJoint: (main, pos, parent, name, opts) => {
    const j = main._mk(name || 'new');
    j.m[12] = pos.x; j.m[13] = pos.y; j.m[14] = pos.z;
    if (opts && opts.silent) main.addMeshSilent(j); else main.addNewMesh(j);
    if (parent) main.setMeshParent(j.getID(), parent.getID(), opts && opts.silent ? { silent: true } : undefined);
    globalThis.__created.push(j);
    return j;
  },
};
const IKSolver = {
  pinObject: (j) => (j && j._boneIKPinObj && j._boneIKPinObj._isPinTarget) ? j._boneIKPinObj : null,
  syncJointCache: () => { globalThis.__syncJ = (globalThis.__syncJ || 0) + 1; },
  syncPinCache: () => {},
};
`;
// The source already exports; strip imports only, or the generated file exports twice.
fs.writeFileSync(gen, prelude
  + SRC.split('\n').filter((l) => !/^import\s/.test(l)).join('\n'));
const RT = (await import(gen + '?v=' + Date.now())).default;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
// A defect should FAIL A NAMED CHECK, not take the process down: a stack trace says something
// broke, a failing check says WHICH RULE broke. Every call that a defect could make throw goes
// through this.
const attempt = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

let nextId = 1;
function makeScene() {
  const meshes = [];
  const undos = [];
  const main = {
    _mk(label) {
      const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1;
      const o = { _isBone: true, _parentMesh: null, m, _permanentStaticLabel: label,
        _id: nextId++, getID() { return this._id; }, getMatrix() { return this.m; } };
      return o;
    },
    getMeshes: () => meshes,
    getIndexMesh: (m) => meshes.indexOf(m),
    addMeshSilent: (m) => { if (!meshes.includes(m)) meshes.push(m); return m; },
    addNewMesh: (m) => { meshes.push(m); main._undoPushes = (main._undoPushes || 0) + 1; return m; },
    removeMeshSilent: (m) => { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); },
    // World transforms are not what these checks are about, so the stub reparent only tracks
    // the hierarchy — which IS what they are about.
    setMeshParent: (cid, pid, opts) => {
      const c = meshes.find((m) => m.getID() === cid);
      const p = pid == null ? null : meshes.find((m) => m.getID() === pid);
      if (c) c._parentMesh = p || null;
      if (!opts || !opts.silent) main._undoPushes = (main._undoPushes || 0) + 1;
    },
    getStateManager: () => ({
      pushStateCustom: (undo, redo, squash, label) => undos.push({ undo, redo, label }),
    }),
    render: () => {},
  };
  main._undos = undos;
  return { main, meshes, undos };
}

const chain = (main, meshes, n) => {
  const js = [];
  for (let i = 0; i < n; i++) {
    const j = main._mk('j' + i);
    j.m[12] = i;                       // strung out along X so a midpoint is checkable
    j._parentMesh = js[i - 1] || null;
    j._ikRest = j.m.slice();
    meshes.push(j);
    js.push(j);
  }
  return js;
};

// ── SPLIT MIRRORS ────────────────────────────────────────────────────────────
//
// A rig is built symmetrically and only stays that way if every topology edit is symmetric.
// matt: "if i split a bone, it doesn't appear to mirror when it should. eg i split the joint
// from the chest to the shoulder, it only appeared on one side."
{
  const { main, meshes } = makeScene();
  // A chest with a left and right collarbone hanging off it — the shape matt was splitting.
  const chest = main._mk('chest'); chest.m[13] = 5; meshes.push(chest);
  const clavL = main._mk('clav_L'); clavL.m[12] = 2; clavL.m[13] = 5; clavL._parentMesh = chest; meshes.push(clavL);
  const clavR = main._mk('clav_R'); clavR.m[12] = -2; clavR.m[13] = 5; clavR._parentMesh = chest; meshes.push(clavR);
  clavL._boneMirror = clavR; clavR._boneMirror = clavL;

  const n0 = meshes.length;
  const mid = RT.split(main, clavL);

  check('splitting one side splits the other too', meshes.length === n0 + 2,
    'added ' + (meshes.length - n0) + ' joint(s) — a one-sided split leaves a rig that no '
    + 'longer mirrors, and every feature reading _boneMirror quietly stops working for that limb');
  check('...each between its own joint and parent',
    !!mid && clavL._parentMesh === mid && mid._parentMesh === chest
    && clavR._parentMesh && clavR._parentMesh._parentMesh === chest);
  check('...and the two new joints are paired',
    !!mid && !!mid._boneMirror && mid._boneMirror === clavR._parentMesh
    && mid._boneMirror._boneMirror === mid,
    'unpaired, the next mirror-aware operation treats them as centreline bones sitting '
    + 'improbably far off the plane');
  check('...mirrored positions, not copied ones',
    !!mid && Math.abs(mid.m[12] - 1) < 1e-9 && Math.abs(clavR._parentMesh.m[12] + 1) < 1e-9,
    'each side is measured along its OWN bone: ' + (mid ? mid.m[12] : '?')
    + ' and ' + (clavR._parentMesh ? clavR._parentMesh.m[12] : '?'));
}

// A bone whose twin is not the same bone on the other side must NOT drag it along.
{
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 3);
  const stray = main._mk('stray'); stray.m[12] = 9; stray._parentMesh = null; meshes.push(stray);
  js[1]._boneMirror = stray;                 // a twin with a different parent: not our bone
  const n0 = meshes.length;
  RT.split(main, js[1]);
  check('a twin that is not the mirror of this bone is left alone',
    meshes.length === n0 + 1,
    'guessing there would be worse than not mirroring at all');
}

// ── SPLIT ────────────────────────────────────────────────────────────────────
{
  const { main, meshes, undos } = makeScene();
  const js = chain(main, meshes, 3);          // j0 -> j1 -> j2
  globalThis.__created = [];
  const mid = RT.split(main, js[1]);

  check('split inserts a joint', !!mid && meshes.includes(mid));
  check('...between the joint and its parent',
    mid._parentMesh === js[0] && js[1]._parentMesh === mid,
    'the chain must read parent -> new -> joint');
  check('...at the midpoint of the bone by default',
    Math.abs(mid.m[12] - 0.5) < 1e-9, mid.m[12]);
  check('...and everything below comes along untouched',
    js[2]._parentMesh === js[1], 'a split must not restructure the rest of the limb');
  check('...with a rest pose of its own',
    !!mid._ikRest, 'without one the first solve adopts whatever pose the rig is in');
  check('...and a name carrying the side suffix',
    /_split/.test(mid._permanentStaticLabel),
    '_L/_R is load-bearing for mirror pairing');

  check('ONE undo entry for the whole split', undos.length === 1, undos.length);
  check('...which exists at all', undos.length > 0,
    'without an entry there is no way back from a topology edit');
  check('...and no stray entries from the pieces', !main._undoPushes,
    'createJoint and the reparent must both run silent, or a split undoes in three presses');
  check('...labelled', undos[0]?.label === 'Split Bone');

  attempt(() => undos[0].undo());
  check('undo removes the new joint', !meshes.includes(mid));
  check('...and rejoins the chain', js[1]._parentMesh === js[0]);
  attempt(() => undos[0].redo());
  check('redo puts it back', meshes.includes(mid) && js[1]._parentMesh === mid);
}

// A ROOT HAS NO BONE ABOVE IT. Refused rather than fudged: inventing a parent for a root is a
// different operation with a different name.
{
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 2);
  check('a root cannot be split', attempt(() => RT.canSplit(main, js[0]), 'threw') === false,
    'inventing a parent for a root is a different operation with a different name');
  check('...and asking does nothing',
    attempt(() => RT.split(main, js[0]), 'threw') === null && meshes.length === 2);
}

// A side suffix survives the rename.
{
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 2);
  js[1]._permanentStaticLabel = 'arm_02_L';
  const mid = RT.split(main, js[1]);
  check('the split joint keeps the side suffix LAST',
    /_L$/.test(mid._permanentStaticLabel), mid._permanentStaticLabel);
}

// ── DISSOLVE ─────────────────────────────────────────────────────────────────
{
  const { main, meshes, undos } = makeScene();
  const js = chain(main, meshes, 3);          // j0 -> j1 -> j2
  const ok = RT.dissolve(main, js[1]);

  check('dissolve removes the joint', ok === true && !meshes.includes(js[1]));
  check('...and rejoins its neighbours', js[2]._parentMesh === js[0],
    'THE difference from Delete: Delete cascades and takes the limb with it');
  check('...leaving the limb in the scene', meshes.includes(js[2]));
  check('ONE undo entry', undos.length === 1 && undos[0].label === 'Dissolve Bone');

  attempt(() => undos[0].undo());
  check('undo brings the joint back', meshes.includes(js[1]));
  check('...and re-inserts it in the chain',
    js[2]._parentMesh === js[1] && js[1]._parentMesh === js[0],
    'restoring presence AFTER parentage would leave the child on the grandparent');
}

// A pinned joint takes its pin with it, and undo brings both back.
{
  const { main, meshes, undos } = makeScene();
  const js = chain(main, meshes, 3);
  const pin = main._mk('pin_j1'); pin._isPinTarget = true; pin._isBone = false;
  meshes.push(pin);
  js[1]._boneIKPinObj = pin; js[1]._bonePinMode = 3;

  RT.dissolve(main, js[1]);
  check('a dissolved joint takes its pin with it', !meshes.includes(pin),
    'a pin is placed on a SPECIFIC joint; silently re-homing it changes the animation');
  check('...and clears the reference', js[1]._boneIKPinObj === null);
  attempt(() => undos[0].undo());
  check('undo brings the pin back too', meshes.includes(pin));
}

// The only joint in the scene is not a dissolve.
{
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 1);
  check('the last joint cannot be dissolved', RT.canDissolve(main, js[0]) === true
    && RT.dissolve(main, js[0]) === false,
    'that is Delete, and Delete already means it');
  check('...and it is still there', meshes.includes(js[0]));
}

// A fork dissolves to the grandparent, all branches kept.
{
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 2);
  const a = main._mk('a'), b = main._mk('b');
  a._parentMesh = js[1]; b._parentMesh = js[1];
  meshes.push(a, b);
  RT.dissolve(main, js[1]);
  check('every child of a dissolved fork moves up',
    a._parentMesh === js[0] && b._parentMesh === js[0],
    'reparenting one and dropping the rest is the cascade bug wearing a hat');
}

// The solver caches are invalidated by both.
{
  globalThis.__syncJ = 0;
  const { main, meshes } = makeScene();
  const js = chain(main, meshes, 3);
  RT.split(main, js[1]);
  RT.dissolve(main, js[2]);
  check('both verbs re-sync the solver caches', globalThis.__syncJ >= 2,
    'a stale cache is the difference between a topology edit and a rig that tears itself apart');
}


// PARENTS BEFORE CHILDREN, on the way back.
//
// getModelSpaceMatrix reads a parented mesh's world matrix through THREE, so restoring a child
// first computes its world from a parent that has not been put back — the joint lands somewhere
// else. In a rig with no bound mesh the scene unit is measured from the JOINT EXTENT, so every
// marker resizes with it: matt, undoing a dissolve, "all the joint spheres doubled in size."
{
  const { main, meshes, undos } = makeScene();
  const js = chain(main, meshes, 4);              // j0 -> j1 -> j2 -> j3
  RT.dissolve(main, js[1]);
  const order = [];
  const realSet = main.setMeshParent;
  main.setMeshParent = (cid, pid, opts) => { order.push(cid); return realSet(cid, pid, opts); };
  attempt(() => undos[0].undo());
  main.setMeshParent = realSet;

  const depth = (m) => { let d = 0; for (let p = m._parentMesh; p; p = p._parentMesh) d++; return d; };
  let ok = true;
  const seen = new Map();
  for (const id of order) {
    const m = meshes.find((x) => x.getID() === id);
    if (m) seen.set(id, depth(m));
  }
  const ds = order.map((id) => seen.get(id)).filter((d) => d !== undefined);
  for (let i = 1; i < ds.length; i++) if (ds[i] < ds[i - 1]) ok = false;
  check('a restore walks parents before children', ok, ds.join(','),
    'a child restored first reads its world from a parent that is not back yet');
  check('...and forces one world-matrix pass afterwards',
    /updateMatrixWorld\?\.\(true\)/.test(SRC),
    'anything reading a world matrix next — the scene unit included — must see all of it');
}


// ── TWEAK FK CARRIES ROTATION ───────────────────────────────────────────────
//
// Tweak is a 6DOF grab: your hand moves AND turns, and only the movement was read. matt:
// "tweak fk should support rotation, so if i twist my controller around, the entire child
// hierarchy should rotate." The hierarchy following is free — children are parented, so in FK
// they ride it through the scene graph.
{
  const BD = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');
  check('the grab captures the controller orientation',
    /_beginGrab\(joint, quat, tip\)/.test(BD) && /qStart: quat \?/.test(BD));
  check('...inverted once, not accumulated frame to frame',
    /\.invert\(\) : null,/.test(BD),
    'a frame-to-frame delta composes into a ratchet that never returns to zero');
  check('...and the VR dispatch actually passes it',
    /this\._beginGrab\(hit, qTweak, _tip\)/.test(BD) && /this\._dragTo\(_tip, qTweak\)/.test(BD),
    'capturing a quat nothing supplies is a feature that silently does nothing');
  check('the twist is applied BEFORE the move',
    BD.indexOf('this._twistTo(g.joint, g.localAtGrab, quat)')
      < BD.indexOf('Skeleton.moveJoint(this._main, g.joint, at,'),
    'moveJoint restores each child in compensate mode, so it has to be last');
  check('...measured from the pose at the GRAB, not the live matrix',
    /_twistTo\(joint, localAtGrab, quat\)/.test(BD),
    'reading the live matrix each frame re-applies the rotation on top of itself');
  check('...carried into the parent frame, like pose mode',
    (BD.match(/_qDelta\.premultiply\(_qParent\.clone\(\)\.invert\(\)\)\.multiply\(_qParent\)/g) || []).length === 2,
    'a rotation on a joint deep in a posed chain is otherwise measured in the wrong frame');
  check('the MIRROR twin follows position only',
    /The twin is deliberately NOT twisted/.test(BD),
    'a mirrored rotation is not the same rotation; guessing the reflection is how a symmetric '
      + 'rig comes back asymmetric');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
