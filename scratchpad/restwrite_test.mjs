// Node harness for the REST-SPACE WRITE-BACK in src/editing/Skinning.js — both grades.
//
// The rule the whole thing exists to enforce: WHAT YOU SCULPT IS WHAT STAYS ON SCREEN. The skin
// pass treats the bound level's vertex array as an output buffer and rebuilds it from `_skinSrc`
// every time a joint moves, so a stroke that never reaches `_skinSrc` is deleted by the next
// frame that happens to deform. At bind pose the commit is a copy; POSED it has to invert the
// per-vertex composite, and that is the arithmetic measured here.
//
// It is measured as a ROUND TRIP, not as a formula: sculpt, commit, re-run the real skin pass,
// and check the vertex is where it was left. A write-back that agrees with a re-derivation of
// its own maths would pass while being wrong in exactly the way that matters.
//
// Run: node scratchpad/restwrite_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = new URL('..', import.meta.url).pathname;
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');

globalThis.window = globalThis.window || {};

// RW_INJECT=fixdraw   the pass doesn't draw a fix: the exact check must fail
// RW_INJECT=fixturn   a stroke isn't turned back by the vertex's rotation: the bent check must fail
// RW_INJECT=fixweight a stroke isn't divided by the weight: the weight check must fail
// RW_INJECT=fixrest   a stroke on a pose goes through the rest commit: the rest check must fail
// RW_INJECT=fixfollow the offset isn't turned as it's drawn: the off-pose check must fail
// RW_INJECT=jumpsilent a stroke that lands elsewhere says nothing: the jump check must fail
// RW_INJECT=jumpalways any posed stroke warns: the quiet check must fail
// RW_INJECT=fixflip   a joint on the far side isn't flipped into the blend: the far-side check must fail
let SRC_B = SRC;
{
  const inj = (a, b) => { if (!SRC_B.includes(a)) throw new Error('anchor moved: ' + a); SRC_B = SRC_B.replace(a, b); };
  const i = process.env.RW_INJECT;
  if (i === 'jumpsilent') inj('  jumpCheck(mesh, out, nbV);\n', '');
  if (i === 'jumpalways') inj('if (most <= stroke * JUMP_SHARE || most <= floor) return;', '');
  if (i === 'fixdraw') inj('  applyFixes(mesh, mats, out, nbV);\n', '');
  if (i === 'fixturn') inj('turn(_qv, -1, dx, dy, dz);', 'turn(_qv, 1, dx, dy, dz);');
  if (i === 'fixweight') inj('const k = 1 / on.w, ids', 'const k = 1, ids');
  if (i === 'fixrest') inj('const rec = commitFix(main, mesh, level, nbV, into);', 'const rec = null; commitPosed(main, mesh, level, nbV);');
  if (i === 'fixfollow') inj('turn(_qv, 1, x, y, z);', '_qv[4] = x; _qv[5] = y; _qv[6] = z;');
  if (i === 'fixflip') inj('< 0) w = -w;', '< 0) w = w;');
}
const body = SRC_B.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
const WeightCage = {};
const Skeleton = { joints: () => [], jointPos: () => new THREE.Vector3() };
const adjacencyFromFaces = (level) => {
  const n = level.getNbVertices();
  const a = [];
  for (let i = 0; i < n; i++) a.push([(i + n - 1) % n, (i + 1) % n]);
  return a;
};
const getOptionsURL = () => ({ boneMush: 0 });
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_restwrite_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default Skinning;\n');
const { default: Skinning } = await import(outPath + '?v=' + Date.now());

const THREE = await import(THREE_PATH);

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-4 : eps); }

// ---- the smallest thing the skin pass will accept ---------------------------------
//
// One joint, one level, N vertices all fully weighted to it. The joint's matrix is handed in
// as a plain array so a test can pose it by writing one line.
let nextId = 1;
function joint(mat) {
  const id = nextId++;
  const m = mat ? mat.slice() : new THREE.Matrix4().elements.slice();
  return {
    getID: () => id,
    getMatrix: () => m,
    getModelSpaceMatrix: () => m,
    setModelMatrix(e) { for (let i = 0; i < 16; i++) m[i] = e[i]; },
  };
}

function boundMesh(rest, j) {
  const nbV = rest.length / 3;
  const verts = new Float32Array(rest);
  const level = {
    getNbVertices: () => nbV,
    getVertices: () => verts,
  };
  const idx = new Int32Array(nbV * 4).fill(-1);
  const wts = new Float32Array(nbV * 4);
  for (let i = 0; i < nbV; i++) { idx[i * 4] = 0; wts[i * 4] = 1; }
  const mesh = {
    _meshes: [level], _sel: 0,
    _skinJoints: [j.getID()],
    _skinLevelMesh: level, _skinLevel: 0,
    _skinIdx: idx, _skinW: wts,
    _skinRest: new Float32Array(rest),
    _skinSrc: new Float32Array(rest),
    _skinInvBind: [new THREE.Matrix4()],   // bound with the joint at the identity
    getID: () => 99,
    getModelSpaceMatrix: () => new THREE.Matrix4().elements,
    computeLocalRadius: () => 1,
    updateGeometry() {}, updateGeometryBuffers() {}, updateBuffers() {}, updateResolution() {},
    isDynamic: false,
  };
  const main = { getMeshes: () => [j], render() {} };
  return { mesh: mesh, main: main, level: level, verts: verts, nbV: nbV };
}

// A stroke: move one vertex by (dx,dy,dz) in the array the user sees.
function sculpt(t, i, dx, dy, dz) {
  t.verts[i * 3] += dx; t.verts[i * 3 + 1] += dy; t.verts[i * 3 + 2] += dz;
}

const REST = [1, 0, 0,  0, 1, 0,  0, 0, 1,  2, 1, 0];

// --- A POSE'S FIX, ON TOP OF THE PASS ----------------------------------------------
//
// Two joints bent hard, every vertex shared between them, mush on: the case where a stroke stored
// under the skin came back up to nine times its size (pose_crumple.sxr). Round trips through the real pass.
{
  const rotZ = (a, px = 0, py = 0) => new THREE.Matrix4().makeTranslation(px, py, 0).multiply(new THREE.Matrix4().makeRotationZ(a)).multiply(new THREE.Matrix4().makeTranslation(-px, -py, 0)).elements.slice();
  const A = joint(), B = joint(rotZ(2.6));
  const nbV = 12, rest = [];
  for (let i = 0; i < nbV; i++) { const a = i / nbV * Math.PI * 2; rest.push(Math.cos(a) * 2, Math.sin(a) * 2, i % 2 ? 0.3 : -0.3); }
  const t = boundMesh(rest, A);
  const { mesh, main, verts: v } = t;
  mesh._skinJoints = [A.getID(), B.getID()];
  mesh._skinInvBind = [new THREE.Matrix4(), new THREE.Matrix4()];
  for (let i = 0; i < nbV; i++) { mesh._skinIdx[i * 4 + 1] = 1; mesh._skinW[i * 4] = 0.5; mesh._skinW[i * 4 + 1] = 0.5; }
  mesh._skinAdj = (() => { const off = new Int32Array(nbV + 1), nb = []; for (let i = 0; i < nbV; i++) { off[i] = nb.length; nb.push((i + nbV - 1) % nbV, (i + 1) % nbV); } off[nbV] = nb.length; return { off, nb: Int32Array.from(nb) }; })();
  main.getMeshes = () => [A, B];
  const key = 'pose:p', track = { correctivePost: new Map(), correctiveW: new Map([[key, 1]]) };
  window._animationRegistry = { tracks: new Map([[99, track]]), invalidateSparse() {} };
  let on = { name: 'p', w: 1 };
  Skinning.correctiveFor = () => on;
  Skinning.composeFixDetails = () => {};
  Skinning.ensureCorrective = () => {
    if (!track.correctivePost.has(key)) track.correctivePost.set(key, new Float32Array(nbV * 3));
    return { track, arr: track.correctivePost.get(key) };
  };
  const wasMush = window._skinMush;
  window._skinMush = 10;
  const pass = () => { mesh._skinDirty = true; Skinning.apply(main, mesh); };
  const off = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
  pass();
  const clean = v.slice();
  const restWas = mesh._skinRest.slice(), srcWas = mesh._skinSrc.slice();
  sculpt(t, 3, 0.4, -0.2, 0.3); sculpt(t, 4, 0.1, 0.5, 0);
  const drawn = v.slice();
  Skinning._lastRestEntry = null;
  check('fix: a stroke on a pose commits', Skinning.commitToRest(main, mesh) === true);
  const entry = Skinning._lastRestEntry;
  check('fix: it stays out of the rest shape', off(mesh._skinRest, restWas) === 0 && off(mesh._skinSrc, srcWas) === 0);
  pass();
  check('fix: the pass draws exactly what was sculpted, mush on, bend 2.6', off(v, drawn) < 1e-5, 'off by ' + off(v, drawn).toFixed(5));
  sculpt(t, 3, -0.2, 0.1, 0.1);
  const drawn2 = v.slice();
  Skinning._lastRestEntry = null;
  Skinning.commitToRest(main, mesh);
  const entry2 = Skinning._lastRestEntry;
  pass();
  check('fix: a second stroke lands on the first', off(v, drawn2) < 1e-5, 'off by ' + off(v, drawn2).toFixed(5));
  Skinning.applyRestEntry(entry2, 'undo'); pass();
  check('fix: undo is exact', off(v, drawn) < 1e-5);
  Skinning.applyRestEntry(entry, 'undo'); pass();
  check('fix: ...back to the clean skin', off(v, clean) < 1e-5);
  Skinning.applyRestEntry(entry, 'redo'); pass();
  check('fix: redo is exact', off(v, drawn) < 1e-5);
  // what Revert takes away is what the pass drew, so taking all of it lands on the clean skin and empties the fix
  {
    const arr = track.correctivePost.get(key), w = track.correctiveW?.get(key) ?? 1;
    const adds = Skinning.fixOffset(main, mesh, arr, w);
    let wrong = 0;
    for (let k = 0; k < adds.length; k++) wrong = Math.max(wrong, Math.abs(v[k] - clean[k] - adds[k]));
    check('revert: the offset measured is the one on screen', wrong < 1e-5, 'off by ' + wrong.toFixed(5));
    const had = arr.slice();
    for (let k = 0; k < adds.length; k++) v[k] -= adds[k];
    Skinning._lastRestEntry = null;
    Skinning.commitToRest(main, mesh);
    const back = Skinning._lastRestEntry;
    let left = 0;
    for (let k = 0; k < arr.length; k++) left = Math.max(left, Math.abs(arr[k]));
    check('revert: taking all of it empties the fix', left < 1e-5, 'left ' + left.toFixed(5));
    pass();
    check('revert: ...and lands on the clean skin', off(v, clean) < 1e-5, 'off by ' + off(v, clean).toFixed(5));
    Skinning.applyRestEntry(back, 'undo'); pass();
    check('revert: undo is exact', off(arr, had) < 1e-6 && off(v, drawn) < 1e-5);
  }

  // a rig a hair off the pose: the weight comes back out
  track.correctiveW.set(key, 0.8); on = { name: 'p', w: 0.8 };
  pass();
  sculpt(t, 6, 0.3, 0, 0);
  const drawnW = v.slice();
  Skinning.commitToRest(main, mesh); pass();
  check('fix: under full weight a stroke still lands', off(v, drawnW) < 1e-5, 'off by ' + off(v, drawnW).toFixed(5));
  track.correctiveW.set(key, 0); pass();
  check('fix: at no weight it is gone', off(v, clean) < 1e-5);

  // off the pose it turns with the limb, same length
  const fixArr = track.correctivePost.get(key);
  fixArr.fill(0); fixArr[0] = 1;
  track.correctiveW.set(key, 1);
  const both = (a) => { A.setModelMatrix(rotZ(a)); B.setModelMatrix(rotZ(a)); };
  both(1); window._skinMush = 0; pass();
  const c = Math.cos(1), s = Math.sin(1), r0 = 2;
  check('fix: off the pose the offset turns with its joints', Math.abs(v[0] - (r0 + 1) * c) < 1e-4 && Math.abs(v[1] - (r0 + 1) * s) < 1e-4, v[0].toFixed(3) + ',' + v[1].toFixed(3));

  // two joints whose quaternions sit on far sides of the sphere: without a flip they blend the long way
  const axisB = new THREE.Vector3(-0.6, 0.8, 0);
  A.setModelMatrix(new THREE.Matrix4().makeRotationX(3).elements.slice());
  B.setModelMatrix(new THREE.Matrix4().makeRotationAxis(axisB, 3).elements.slice());
  pass();
  const withFix = v.slice();
  track.correctiveW.set(key, 0); pass();
  const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 3), qb = new THREE.Quaternion().setFromAxisAngle(axisB, 3);
  if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
  const want = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(qa.x + qb.x, qa.y + qb.y, qa.z + qb.z, qa.w + qb.w).normalize());
  const got = new THREE.Vector3(withFix[0] - v[0], withFix[1] - v[1], withFix[2] - v[2]);
  check('fix: joints on far sides blend the short way', got.distanceTo(want) < 1e-4, 'off by ' + got.distanceTo(want).toFixed(4));

  delete Skinning.correctiveFor; delete Skinning.ensureCorrective; delete Skinning.composeFixDetails;
  window._animationRegistry = null;
  window._skinMush = wasMush;
}

// --- A POSED STROKE THAT DOESN'T LAND SAYS SO --------------------------------------
{
  const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a).elements.slice();
  const A = joint(), B = joint(rotZ(2.6));
  const nbV = 12, rest = [];
  for (let i = 0; i < nbV; i++) { const a = i / nbV * Math.PI * 2; rest.push(Math.cos(a) * 2, Math.sin(a) * 2, i % 2 ? 0.3 : -0.3); }
  const t = boundMesh(rest, A);
  const { mesh, main, verts: v } = t;
  mesh._skinJoints = [A.getID(), B.getID()];
  mesh._skinInvBind = [new THREE.Matrix4(), new THREE.Matrix4()];
  for (let i = 0; i < nbV; i++) { mesh._skinIdx[i * 4 + 1] = 1; mesh._skinW[i * 4] = 0.5; mesh._skinW[i * 4 + 1] = 0.5; }
  mesh._skinAdj = (() => { const off = new Int32Array(nbV + 1), nb = []; for (let i = 0; i < nbV; i++) { off[i] = nb.length; nb.push((i + nbV - 1) % nbV, (i + 1) % nbV); } off[nbV] = nb.length; return { off, nb: Int32Array.from(nb) }; })();
  main.getMeshes = () => [A, B];
  const alerts = [], wasAlert = window._vrAlert, wasWarn = console.warn, wasMush = window._skinMush;
  window._vrAlert = (x) => alerts.push(x);
  console.warn = () => {};
  const pass = () => { mesh._skinDirty = true; Skinning.apply(main, mesh); };
  window._skinMush = 0; pass();
  sculpt(t, 3, 0.4, -0.2, 0.3);
  Skinning.commitToRest(main, mesh); pass();
  check('jump: a stroke that lands stays quiet', alerts.length === 0, alerts[0]);
  window._skinMush = 10; mesh._skinMushDirty = true; pass();
  sculpt(t, 3, 0.4, -0.2, 0.3);
  Skinning.commitToRest(main, mesh); pass();
  check('jump: one that lands elsewhere warns, and nothing is refused', alerts.length === 1 && /landed/.test(alerts[0]));
  check('jump: ...once, not on every pass', (pass(), alerts.length === 1));
  sculpt(t, 4, 0.4, -0.2, 0.3);
  Skinning.commitToRest(main, mesh); pass();
  check('jump: repeats are held back a while', alerts.length === 1);
  window._vrAlert = wasAlert; console.warn = wasWarn; window._skinMush = wasMush;
}

// --- 1. ROUND TRIP under a rotation ------------------------------------------------
//
// The joint is turned 90° about Z and moved, so every skin matrix is far from the identity and
// a delta committed without the inverse would land in the wrong direction entirely.
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);                       // bind pose: output == rest

  const pose = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(3, -1, 2);
  j.setModelMatrix(pose.elements);
  Skinning.apply(t.main, t.mesh);                       // now posed

  const before = Array.from(t.verts);
  sculpt(t, 0, 0.10, -0.25, 0.40);
  const target = [t.verts[0], t.verts[1], t.verts[2]];

  check('posed stroke commits', Skinning.commitToRest(t.main, t.mesh) === true);

  // Re-run the real pass, exactly as the next frame would.
  t.mesh._skinDirty = true;
  Skinning.apply(t.main, t.mesh);

  check('posed: sculpted vertex survives the skin pass',
    near(t.verts[0], target[0]) && near(t.verts[1], target[1]) && near(t.verts[2], target[2]),
    'want ' + target.map((n) => n.toFixed(4)).join(',')
      + ' got ' + [t.verts[0], t.verts[1], t.verts[2]].map((n) => n.toFixed(4)).join(','));

  let moved = 0;
  for (let i = 1; i < t.nbV; i++) {
    for (let k = 0; k < 3; k++) if (!near(t.verts[i * 3 + k], before[i * 3 + k], 1e-6)) moved++;
  }
  check('posed: untouched vertices do not move', moved === 0, moved + ' components moved');
}

// --- 2. ROUND TRIP back at the bind pose -------------------------------------------
//
// Commit while posed, then return the joint to bind: the sculpt has to be in the REST shape,
// not merely cancelled out by the pose it was made in.
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);
  const restBefore = Array.from(t.verts);

  j.setModelMatrix(new THREE.Matrix4().makeRotationY(0.7).setPosition(0, 2, 0).elements);
  Skinning.apply(t.main, t.mesh);
  sculpt(t, 2, 0.3, 0.3, -0.2);
  Skinning.commitToRest(t.main, t.mesh);

  j.setModelMatrix(new THREE.Matrix4().elements);       // straight back to bind
  Skinning.apply(t.main, t.mesh);

  const d = [t.verts[6] - restBefore[6], t.verts[7] - restBefore[7], t.verts[8] - restBefore[8]];
  const len = Math.hypot(d[0], d[1], d[2]);
  check('posed stroke is present in the rest shape', near(len, Math.hypot(0.3, 0.3, 0.2), 1e-3),
    'moved ' + len.toFixed(4));
}

// --- 3. THE SCALE CASE -------------------------------------------------------------
//
// A joint scaled x2 doubles every posed distance, so a 0.4 stroke on screen is a 0.2 change in
// rest space. Committing the screen delta unchanged is the plausible-looking bug, and it grows
// the model a little more on every stroke.
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);
  j.setModelMatrix(new THREE.Matrix4().makeScale(2, 2, 2).elements);
  Skinning.apply(t.main, t.mesh);

  const srcBefore = t.mesh._skinSrc[0];
  sculpt(t, 0, 0.4, 0, 0);
  Skinning.commitToRest(t.main, t.mesh);
  check('scaled joint: rest delta is the posed delta over the scale',
    near(t.mesh._skinSrc[0] - srcBefore, 0.2),
    'got ' + (t.mesh._skinSrc[0] - srcBefore).toFixed(4));
  check('scaled joint: _skinRest tracks _skinSrc',
    near(t.mesh._skinRest[0], t.mesh._skinSrc[0]));
}

// --- 4. TWO STROKES BEFORE THE NEXT FRAME ------------------------------------------
//
// commitToRest fires on stroke end, and nothing guarantees a skin pass between two of them.
// If the posed reference is not advanced by the commit, the second stroke is measured against
// the pre-first-stroke surface and the first stroke is committed a second time.
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);
  j.setModelMatrix(new THREE.Matrix4().makeRotationZ(0.5).elements);
  Skinning.apply(t.main, t.mesh);

  const srcBefore = t.mesh._skinSrc[0];
  sculpt(t, 0, 0.2, 0, 0);
  Skinning.commitToRest(t.main, t.mesh);
  const afterFirst = t.mesh._skinSrc[0] - srcBefore;
  sculpt(t, 0, 0.2, 0, 0);
  Skinning.commitToRest(t.main, t.mesh);
  const afterSecond = t.mesh._skinSrc[0] - srcBefore;
  check('two strokes, no frame between: the second is not the first counted twice',
    near(afterSecond, afterFirst * 2, 1e-4),
    'first ' + afterFirst.toFixed(4) + ', total ' + afterSecond.toFixed(4));
}

// --- 5. NO REFERENCE, NO COMMIT ----------------------------------------------------
//
// Without a snapshot of what skinning last drew there is no way to tell a stroke from the pose
// itself, and adopting the posed shape as rest would bake the pose into the bind irreversibly.
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);
  j.setModelMatrix(new THREE.Matrix4().makeRotationZ(0.5).elements);
  Skinning.apply(t.main, t.mesh);
  t.mesh._skinPosed = null;
  const src0 = Array.from(t.mesh._skinSrc);
  sculpt(t, 0, 0.5, 0, 0);
  check('posed with no reference: refuses', Skinning.commitToRest(t.main, t.mesh) === false);
  check('posed with no reference: rest space untouched',
    src0.every((v, i) => v === t.mesh._skinSrc[i]));
}

// --- 6. THE BIND-POSE PATH STILL COPIES --------------------------------------------
{
  const j = joint();
  const t = boundMesh(REST, j);
  Skinning.apply(t.main, t.mesh);
  sculpt(t, 1, 0, 0.5, 0);
  check('at bind pose: commits', Skinning.commitToRest(t.main, t.mesh) === true);
  check('at bind pose: rest is the level, verbatim',
    t.mesh._skinSrc[4] === t.verts[4] && t.mesh._skinRest[4] === t.verts[4]);
}

// --- 7. SOURCE RULES ---------------------------------------------------------------
//
// Anchored on the source because they are structure, not arithmetic: each of these was a
// separate way for the write-back to be silently wrong.
check('src: the skin pass snapshots its output for the write-back',
  /applyMush\(mesh, level, out, nbV\);/.test(SRC)
    && /mesh\._skinPosed\.set\(out\.subarray\(0, nbV \* 3\)\)/.test(SRC),
  'apply() must record what it drew, or a posed stroke has nothing to be measured against');

check('src: one builder for the skin matrices',
  /function skinMatrices\(mesh, joints\)/.test(SRC)
    && (SRC.match(/skinMatrices\(mesh, joints\)/g) || []).length >= 3,
  'apply() and commitPosed() must invert the same matrices, not two copies of the loop');

check('src: unbind drops the posed reference',
  /Skinning\.unbind = function[\s\S]*?mesh\._skinPosed = null;[\s\S]*?^};/m.test(SRC),
  'a stale reference from a previous bind would misread the first stroke after rebinding');

check('src: a posed commit no longer refuses',
  /return journalled\(commitPosed\(main, mesh, level, nbV\)\);/.test(SRC)
    && !/restRefused\(mesh, 'sculpting while posed'\)/.test(SRC));

check('src: a singular basis drops the vertex rather than writing a garbage inverse',
  /if \(!\(Math\.abs\(det\) > 1e-12\)\) \{ singular\+\+; if \(jr\) jr\.drop\(\); continue; \}/.test(SRC));

// A press with no stroke must leave the rest shape alone. Weight colours used to go up the stack by a
// synthesis, which isn't exact against the last one, so the next stroke end took the difference for
// sculpting and folded the whole limb in: 1884 rest vertices moved on skinny_rebuild, by up to 0.22.
{
  const show = SRC.slice(SRC.indexOf('Skinning.showWeightColors = function'), SRC.indexOf('Skinning._solo = null;'));
  const restore = SRC.slice(SRC.indexOf('Skinning.restoreColors = function'), SRC.indexOf('Skinning.refreshWeightColors = function'));
  check('src: carrying weight colours up leaves the positions alone',
    /coloursUp\(mesh\);/.test(show) && !/synthesiseUp\(/.test(show) && /coloursUp\(mesh\);/.test(restore) && !/synthesiseUp\(/.test(restore));
  const up = SRC.slice(SRC.indexOf('function coloursUp'), SRC.indexOf('// Resolve the bound joints once per pass.'));
  check('src: ...by putting them back after every level', /v\.slice\(0,[\s\S]*higherSynthesis[\s\S]*v\.set\(keep\);/.test(up));
}
check('src: a posed bound mesh is never read back as rest, and strokes reach its shape through the commit',
  /if \(this\._skinW && this\._skinIsPosed\) _track = null;/.test(fs.readFileSync(path.join(REPO, 'src/mesh/Mesh.js'), 'utf8'))
    && /if \(!moved\) return false;\n  strokeIntoShape\(main, mesh\);/.test(SRC)
    && /mesh\._skinIsPosed = true;/.test(fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8')));
check('src: a recomposite does not analyse a bound mesh',
  /if \(li >= 0 && li < sel && !mesh\._skinW\) \{/.test(fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8')));
check('src: a posed stroke goes back by the mush frames when there are any',
  /const back = mushReturn\(mesh, mats, src, idx, wts, nbV\);/.test(SRC) && /if \(iters <= 0 \|\| !pair \|\| !mesh\._skinAdj\) return null;/.test(SRC));

// ---- ABOVE THE BOUND LEVEL (grade 3) ----------------------------------------------
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. The real MeshResolution needs the whole mesh and
// render stack to instantiate, so the stack below is a stand-in that honours the same contract:
// the shared vertices come FIRST and are copied down verbatim, and what the subdivision cannot
// reproduce is kept as a residual. That is `copyDataFromHigherRes` + `computeDetails` in
// structure, and it makes the ORCHESTRATION measurable -- does the commit fold the stroke down
// before reading the weighted array, in the right order, once.
//
// It does NOT stand in for one thing: the real details live in each vertex's normal/tangent
// FRAME, not in object space, so they rotate with the surface. That is the property that makes
// detail follow a pose, and no mock of mine can vouch for it -- it is measured in the browser,
// against the live dev server, with the real subdivision.
//
// Two levels, where level 1 is level 0 plus one midpoint per consecutive pair.
function subdivide(coarse, out) {
  const n = coarse.length / 3;
  out.set(coarse);
  for (let i = 0; i < n; i++) {
    const a = i * 3, b = ((i + 1) % n) * 3, o = (n + i) * 3;
    out[o] = (coarse[a] + coarse[b]) * 0.5;
    out[o + 1] = (coarse[a + 1] + coarse[b + 1]) * 0.5;
    out[o + 2] = (coarse[a + 2] + coarse[b + 2]) * 0.5;
  }
}

let analysisLog = [];

// A stack of `n` levels, each one a subdivision of the level below plus its own details. THREE
// levels is the case that matters -- matt's workflow is "subdivide twice" -- and it is the only
// size that can see the fold ORDER: with two levels, folding down and folding up are the same
// single step, so a reversed loop passes.
function stackN(rest, n) {
  const levels = [];
  let coarse = new Float32Array(rest);
  for (let i = 0; i < n; i++) {
    const nb = (coarse.length / 3) | 0;
    const verts = coarse;
    const lvl = { name: 'L' + i, getNbVertices: () => nb, getVertices: () => verts };
    levels.push(lvl);
    if (i + 1 < n) { coarse = new Float32Array(nb * 2 * 3); subdivide(verts, coarse); }
  }
  for (let i = 1; i < n; i++) {
    const up = levels[i], down = levels[i - 1];
    const n1 = up.getNbVertices(), n0 = down.getNbVertices();
    const scratch = new Float32Array(n1 * 3);
    const details = new Float32Array(n1 * 3);
    // MeshResolution.higherSynthesis: rebuild from below, then add the details back.
    up.higherSynthesis = function (below) {
      analysisLog.push('up' + i);
      subdivide(below.getVertices(), scratch);
      const v = up.getVertices();
      for (let k = 0; k < n1 * 3; k++) v[k] = scratch[k] + details[k];
    };
    // MeshResolution.lowerAnalysis, called ON the level below with the level above: the shared
    // vertices come down verbatim and the residual becomes detail.
    down.lowerAnalysis = function (above, mask) {
      analysisLog.push('down' + i);
      const v = down.getVertices(), u = above.getVertices();
      // MeshResolution.copyDataFromHigherRes honours the same mask: only the vertices the
      // stroke moved come down, and everything else keeps the cage it already had.
      if (mask) {
        for (let k = 0; k < n0; k++) {
          if (!mask[k]) continue;
          v[k * 3] = u[k * 3]; v[k * 3 + 1] = u[k * 3 + 1]; v[k * 3 + 2] = u[k * 3 + 2];
        }
      } else {
        v.set(u.subarray(0, n0 * 3));
      }
      subdivide(v, scratch);
      for (let k = 0; k < n1 * 3; k++) details[k] = u[k] - scratch[k];
    };
  }
  return levels;
}

function boundBelow(rest, j, nLevels) {
  const levels = stackN(rest, nLevels || 3);
  const top = levels[levels.length - 1];
  const nbV = rest.length / 3;
  const idx = new Int32Array(nbV * 4).fill(-1);
  const wts = new Float32Array(nbV * 4);
  for (let i = 0; i < nbV; i++) { idx[i * 4] = 0; wts[i * 4] = 1; }
  const mesh = {
    _meshes: levels, _sel: levels.length - 1,   // BOUND AT 0, DISPLAYING THE TOP
    _skinJoints: [j.getID()],
    _skinLevelMesh: levels[0], _skinLevel: 0,
    _skinIdx: idx, _skinW: wts,
    _skinRest: new Float32Array(rest),
    _skinSrc: new Float32Array(rest),
    _skinInvBind: [new THREE.Matrix4()],
    getID: () => 99,
    getModelSpaceMatrix: () => new THREE.Matrix4().elements,
    computeLocalRadius: () => 1,
    updateGeometry() {}, updateGeometryBuffers() {}, updateBuffers() {}, updateResolution() {},
    isDynamic: false,
  };
  return { mesh: mesh, main: { getMeshes: () => [j], render() {} },
           levels: levels, hi: top.getVertices() };
}

// --- 8. bind the base cage, subdivide, POSE, sculpt: the stroke is kept -------------
//
// Both halves of a stroke are checked, because they take different routes home: a SHARED vertex
// is copied down and becomes part of the rest shape, a MIDPOINT vertex has nowhere to go but the
// details. A version that folds the stroke down but loses the details passes the first and fails
// the second, and vice versa.
{
  analysisLog = [];
  const j = joint();
  const t = boundBelow(REST, j);
  Skinning.apply(t.main, t.mesh);
  j.setModelMatrix(new THREE.Matrix4().makeRotationZ(0.8).setPosition(1, 2, -1).elements);
  Skinning.apply(t.main, t.mesh);

  const shared = 1, midpoint = 13;            // 4 coarse verts -> L1 has 8 -> L2 has 16
  t.hi[shared * 3] += 0.30; t.hi[shared * 3 + 1] -= 0.15;
  t.hi[midpoint * 3 + 2] += 0.45;
  const want = Array.from(t.hi);

  check('above the bound level: commits', Skinning.commitToRest(t.main, t.mesh) === true);
  check('...by folding the stroke down one level at a time, top first',
    analysisLog.filter((x) => x[0] === 'd').join(',') === 'down2,down1',
    'each analysis reads the level above it, so 2 has to reach 1 before 1 can reach 0; got '
      + analysisLog.join(','));

  t.mesh._skinDirty = true;
  Skinning.apply(t.main, t.mesh);             // the next frame, as it really runs

  let worst = 0, worstAt = -1;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(t.hi[i] - want[i]);
    if (d > worst) { worst = d; worstAt = i; }
  }
  check('...and the sculpted level survives the skin pass', worst < 1e-4,
    'worst drift ' + worst.toFixed(5) + ' at component ' + worstAt);
}

// --- 9. ...and it is in the REST shape, not cancelled out by the pose ---------------
{
  const j = joint();
  const t = boundBelow(REST, j);
  Skinning.apply(t.main, t.mesh);
  const restHi = Array.from(t.hi);

  j.setModelMatrix(new THREE.Matrix4().makeRotationY(1.1).setPosition(0, -2, 3).elements);
  Skinning.apply(t.main, t.mesh);
  t.hi[1 * 3] += 0.30;                        // shared vertex -> must reach _skinSrc
  t.hi[13 * 3 + 2] += 0.45;                   // midpoint      -> must reach the details
  Skinning.commitToRest(t.main, t.mesh);

  j.setModelMatrix(new THREE.Matrix4().elements);
  Skinning.apply(t.main, t.mesh);

  const dShared = Math.hypot(t.hi[3] - restHi[3], t.hi[4] - restHi[4], t.hi[5] - restHi[5]);
  const dMid = Math.hypot(t.hi[39] - restHi[39], t.hi[40] - restHi[40], t.hi[41] - restHi[41]);
  check('back at bind pose: the shared-vertex half is in the rest shape',
    Math.abs(dShared - 0.30) < 1e-3, 'moved ' + dShared.toFixed(4));
  check('back at bind pose: the detail half came with it',
    dMid > 1e-3, 'moved ' + dMid.toFixed(4));
}

// --- 10. BELOW the bound level is still refused, pointing the right way -------------
{
  const j = joint();
  const t = boundBelow(REST, j);
  t.mesh._skinLevelMesh = t.levels[1]; t.mesh._skinLevel = 1;   // bound high, displaying low
  t.mesh._sel = 0;
  t.mesh._skinRest = new Float32Array(t.levels[1].getNbVertices() * 3);
  t.mesh._skinSrc = new Float32Array(t.levels[1].getNbVertices() * 3);
  check('below the bound level: refuses', Skinning.commitToRest(t.main, t.mesh) === false);
}

// --- 11. HOW FAR THE MUSH MOVES A COMMITTED STROKE ---------------------------------
//
// Delta mush is a post-process that reads the neighbourhood, so it is not per-vertex
// invertible. commitPosed relies on it CANCELLING in the difference between two surfaces, which
// is exact only while the mush deltas hold still -- and the commit marks them stale, because
// they are defined against the rest pose that just changed. So the surface that comes back is
// not quite the one the stroke was drawn on, and the question is by how much.
//
// Not a pass/fail on a guessed tolerance: this prints the number and fails only if a stroke
// comes back visibly wrong (a tenth of what was drawn). If it ever creeps, the number moves
// first and says so.
//
// AND THE NUMBER IS A FLOOR, NOT A MEASUREMENT. The topology here is a ring of four, where the
// smoothing has almost nothing to do; a real mesh has a real neighbourhood. What this rules out
// is the structural failure -- the drift compounding, or the stroke coming back somewhere else
// entirely. How big it actually is on a sculpted character is a question for the device.
{
  const j = joint();
  const t = boundMesh(REST, j);
  window._skinMush = 6;                    // mush ON, and a real ring adjacency above
  try {
    Skinning.apply(t.main, t.mesh);
    j.setModelMatrix(new THREE.Matrix4().makeRotationZ(0.6).setPosition(1, 0, 0).elements);
    Skinning.apply(t.main, t.mesh);

    const drawn = 0.25;
    sculpt(t, 0, drawn, 0, 0);
    const want = [t.verts[0], t.verts[1], t.verts[2]];
    Skinning.commitToRest(t.main, t.mesh);
    t.mesh._skinDirty = true;
    Skinning.apply(t.main, t.mesh);

    const drift = Math.hypot(t.verts[0] - want[0], t.verts[1] - want[1], t.verts[2] - want[2]);
    console.log('       mush drift: ' + drift.toFixed(5) + ' on a ' + drawn + ' stroke ('
      + (100 * drift / drawn).toFixed(1) + '%)');
    check('with mush on, a committed stroke comes back where it was drawn',
      drift < drawn * 0.1, 'drift ' + drift.toFixed(5) + ' of a ' + drawn + ' stroke');
  } finally {
    delete window._skinMush;
  }
}

// --- 12. WHAT COULD NOT BE REPRODUCED HERE ------------------------------------------
//
// matt: "i add ears, a jaw structure to the head. if i use the move brush on the hips, the
// feet, the legs, after 10 move operates, the head has smoothed back to its original state."
//
// A fixture for that was written and DELETED, because it did not discriminate: ten strokes on
// one vertex, a detail on a shared vertex far away, mush on -- and the drift was 0.00002 both
// with the fold masked and with it unmasked. It was measuring mush noise on a four-vertex ring,
// not the reported loss. Two things it is worth recording, so the next attempt starts further
// along:
//
//   - the detail has to sit on a SHARED vertex. The fold only copies the vertices a level
//     shares with the one above, so a detail on a midpoint is never touched by it and the
//     fixture cannot see the bug at all. The first version made that mistake.
//   - delta mush is SHAPE-PRESERVING by construction (its deltas are rebuilt against the rest
//     pose each time), so "the mush smooths the cage" does not on its own explain a loss. That
//     was the theory this test was written to confirm, and it did not.
//
// So the masked fold below is committed on its own merits -- a stroke has no business
// rewriting the whole cage -- and NOT as a confirmed fix for the smoothing. The mechanism is
// still unknown, and `window._skinNoFold` turns the fold off entirely to find out whether it is
// implicated at all.

check('src: the fold runs before the commit, not after',
  /analyseDown\(mesh, level\);[\s\S]{0,1200}?if \(!atBind\) return journalled/.test(SRC),
  'the commit reads the weighted array, so it has to be folded by then');

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
