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
const adjacencyFromFaces = () => [];
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

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
