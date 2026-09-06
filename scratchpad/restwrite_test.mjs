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

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');

globalThis.window = globalThis.window || {};

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
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
  /return commitPosed\(main, mesh, level, nbV\);/.test(SRC)
    && !/restRefused\(mesh, 'sculpting while posed'\)/.test(SRC));

check('src: a singular basis drops the vertex rather than writing a garbage inverse',
  /if \(!\(Math\.abs\(det\) > 1e-12\)\) \{ singular\+\+; continue; \}/.test(SRC));

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
    down.lowerAnalysis = function (above) {
      analysisLog.push('down' + i);
      const v = down.getVertices(), u = above.getVertices();
      v.set(u.subarray(0, n0 * 3));
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

check('src: the fold runs before the commit, not after',
  /analyseDown\(mesh, level\);\n\n  if \(!Skinning\.atBindPose/.test(SRC),
  'the commit reads the weighted array, so it has to be folded by then');

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
