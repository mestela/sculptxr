// Node harness for DELTA MUSH in src/editing/Skinning.js.
//
// Same stubbed-import trick as skin_level_test.mjs: the real source text is read, its imports
// are stripped and replaced with stubs, and the generated copy additionally exports the
// private mush functions so they can be exercised directly. `adjacencyFromFaces` is the REAL
// one (Geodesic.js has no imports of its own), because the frame the mush builds depends on
// the neighbour ORDER that function produces, and a local reimplementation of adjacency would
// be testing a copy of the rule rather than the rule.
//
// WHAT THIS IS GUARDING. Delta mush is easy to get plausibly wrong: a version that merely
// smooths the deformed mesh looks smoother in a screenshot and has silently thrown away every
// sculpted detail, and a version that stores the detail in WORLD space instead of in a
// surface frame looks perfect at the bind pose and swims the moment anything rotates. Both
// pass "the mesh looks fine". So the checks are the two exactness properties that separate a
// real mush from either failure:
//
//   1. IDENTITY AT BIND — with the skeleton at the pose the deltas were built in, the mush
//      output is the rest mesh to floating point. Detail is not smoothed away.
//   2. RIGID UNDER RIGID — move the whole skeleton rigidly and the output is the rest mesh
//      moved by the same transform. The frames rotate with the surface; nothing swims and
//      nothing shrinks.
//
// plus the thing the feature exists for:
//
//   3. IT UNCREASES A RIGID BIND — bend a two-bone tube whose vertices are each owned by
//      exactly one bone (which is what the shipped capsule bind produces) and the edge-length
//      distortion at the joint drops sharply against the same pose with mush off.
//
// Run: node scratchpad/deltamush_test.mjs
// Injections (standing lesson 1 — a passing test proves nothing until it has been seen to
// fail):
//   MUSH_INJECT=world   store/replay the detail in world space (no frame rotation) -> 2 fails
//   MUSH_INJECT=smooth  drop the detail entirely (pure smoothing)                  -> 1 fails
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const GEO_PATH = path.join(REPO, 'src/editing/Geodesic.js');
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');

const inject = process.env.MUSH_INJECT || '';
if (inject === 'world') {
  // The defect: keep the offset in world space instead of the surface frame. Exactly what a
  // "just store rest minus smoothed and add it back" implementation does.
  const a = 'if (ba >= 0 && frameAt(sm, i, ba, bb, f)) {';
  const b = 'if (ia >= 0 && frameAt(sm, i, ia, ib, f)) {';
  if (!SRC.includes(a) || !SRC.includes(b)) throw new Error('inject world: anchors moved');
  SRC = SRC.replace(a, 'if (false) {').replace(b, 'if (false) {');
} else if (inject === 'smooth') {
  // The defect: no detail at all. The output is the smoothed surface.
  const a = 'mesh._skinMushDelta = delta;';
  if (!SRC.includes(a)) throw new Error('inject smooth: anchor moved');
  SRC = SRC.replace(a, 'mesh._skinMushDelta = new Float32Array(delta.length);');
}

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .filter((l) => !/^export \{/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
import { adjacencyFromFaces } from '${GEO_PATH}';
const Skeleton = { joints: () => [], jointPos: () => new THREE.Vector3() };
const getOptionsURL = () => ({});
getOptionsURL.saveOption = () => {};
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_deltamush_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body +
  '\nexport { buildMush, applyMush, smoothPositions, flatAdjacency, frameAt };\nexport default Skinning;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { applyMush, flatAdjacency, default: Skinning } = mod;

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return true; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
  return false;
}

// ---- a two-bone tube ---------------------------------------------------------------
//
// Quad tube along +Y, RINGS rings of SEG vertices, with a sine bump displaced along the
// radius so there is real high-frequency detail for the mush to preserve or destroy. The
// bump is the whole reason this is not a smooth cylinder: on a smooth cylinder, "kept the
// detail" and "smoothed everything away" are the same picture.
const SEG = 16, RINGS = 21, RADIUS = 0.35, LEN = 2, BUMP = 0.05;
function buildTube() {
  const verts = new Float32Array(SEG * RINGS * 3);
  for (let r = 0; r < RINGS; r++) {
    const y = (r / (RINGS - 1)) * LEN;
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const rad = RADIUS + BUMP * Math.sin(a * 4) * Math.sin(y * 9);
      const i = (r * SEG + s) * 3;
      verts[i] = Math.cos(a) * rad; verts[i + 1] = y; verts[i + 2] = Math.sin(a) * rad;
    }
  }
  const nbF = SEG * (RINGS - 1);
  const faces = new Int32Array(nbF * 4);
  let f = 0;
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SEG; s++) {
      const s2 = (s + 1) % SEG;
      faces[f++] = r * SEG + s; faces[f++] = r * SEG + s2;
      faces[f++] = (r + 1) * SEG + s2; faces[f++] = (r + 1) * SEG + s;
    }
  }
  return { verts, faces, nbV: SEG * RINGS, nbF };
}

const TUBE = buildTube();

function level(verts) {
  return {
    getNbVertices: () => TUBE.nbV,
    getNbFaces: () => TUBE.nbF,
    getFaces: () => TUBE.faces,
    getVertices: () => verts,
  };
}

// A bound mesh, as applyMush reads one: it wants a rest-space source and somewhere to cache.
function mushMesh() {
  return { _skinSrc: new Float32Array(TUBE.verts), _skinMushDirty: true };
}

const ITERS = 10;
window_stub();
function window_stub() {
  global.window = { _skinMush: ITERS };
}

// Distortion of a mesh against the rest tube, edge by edge: how far every edge is from the
// length it had at rest, as a fraction. This is the crease measurement — a rigid bind pinches
// and stretches edges across the joint, and that is exactly what mush is supposed to relieve.
function edgeDistortion(posed) {
  const { off, nb } = flatAdjacency(level(TUBE.verts));
  const rest = TUBE.verts;
  let worst = 0, sum = 0, n = 0, shortest = Infinity;
  for (let i = 0; i < TUBE.nbV; i++) {
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k];
      if (j < i) continue;
      const d = (a) => Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
      const lr = d(rest), lp = d(posed);
      if (lr < 1e-9) continue;
      const e = Math.abs(lp - lr) / lr;
      if (e > worst) worst = e;
      if (lp / lr < shortest) shortest = lp / lr;   // the pinch: an edge crushed to nothing
      sum += e; n++;
    }
  }
  return { worst, mean: sum / n, shortest };
}

function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    if (d > m) m = d;
  }
  return m;
}

// Linear blend skinning with ONE bone per vertex — the shipped rigid capsule bind, in the
// two cases the tube needs. `bend` is the angle the upper bone rotates about +Z at the joint.
const JOINT_Y = LEN / 2;
function poseRigid(mat) {
  const out = new Float32Array(TUBE.verts.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < TUBE.nbV; i++) {
    v.set(TUBE.verts[i * 3], TUBE.verts[i * 3 + 1], TUBE.verts[i * 3 + 2]).applyMatrix4(mat);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}
function poseBend(angle) {
  const upper = new THREE.Matrix4()
    .makeTranslation(0, JOINT_Y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(angle))
    .multiply(new THREE.Matrix4().makeTranslation(0, -JOINT_Y, 0));
  const out = new Float32Array(TUBE.verts.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < TUBE.nbV; i++) {
    const y = TUBE.verts[i * 3 + 1];
    v.set(TUBE.verts[i * 3], y, TUBE.verts[i * 3 + 2]);
    if (y > JOINT_Y) v.applyMatrix4(upper);   // one bone per vertex, hard boundary
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}

const THREE = await import(THREE_PATH);

// --- 1. identity at the bind pose ---------------------------------------------------
{
  const mesh = mushMesh();
  const out = new Float32Array(TUBE.verts);
  const ran = applyMush(mesh, level(out), out, TUBE.nbV);
  const d = maxDiff(out, TUBE.verts);
  check('mush ran at all', ran === true);
  check('bind pose is unchanged (detail survives)', d < 1e-5, 'max vertex move ' + d.toExponential(2));
}

// --- 2. rigid under a rigid move ----------------------------------------------------
{
  const mat = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(0.7, -1.1, 0.4))
    .setPosition(0.3, -0.8, 1.2);
  const mesh = mushMesh();
  const expected = poseRigid(mat);
  const out = new Float32Array(expected);
  applyMush(mesh, level(out), out, TUBE.nbV);
  const d = maxDiff(out, expected);
  check('a rigid move stays rigid (no swim, no shrink)', d < 1e-4,
    'max vertex move ' + d.toExponential(2));
}

// --- 3. it uncreases a rigid bind ---------------------------------------------------
{
  const ANGLE = Math.PI / 2;
  const raw = poseBend(ANGLE);
  const mushed = new Float32Array(raw);
  const mesh = mushMesh();
  applyMush(mesh, level(mushed), mushed, TUBE.nbV);

  const before = edgeDistortion(raw), after = edgeDistortion(mushed);
  console.log('       raw     worst %s mean %s shortest edge %s of rest',
    before.worst.toFixed(3), before.mean.toFixed(4), before.shortest.toFixed(3));
  console.log('       mushed  worst %s mean %s shortest edge %s of rest',
    after.worst.toFixed(3), after.mean.toFixed(4), after.shortest.toFixed(3));
  // A rigid one-bone-per-vertex bind at 90 degrees stretches the outside edges of the seam
  // ring to roughly sqrt(2) and pinches the inside ones to nothing, so the numbers to beat
  // are large. Asserting RATIOS rather than absolutes: the tube's density is an arbitrary
  // choice here and a tally pinned to it would need editing forever.
  check('bend: worst edge distortion at least halves', after.worst < before.worst * 0.5,
    before.worst.toFixed(3) + ' -> ' + after.worst.toFixed(3));
  // `shortest` is printed and NOT asserted, and the reason is worth writing down: a rigid
  // one-bone-per-vertex bind never compresses anything (it reports 1.000) — it only tears the
  // seam open, which is what `worst` measures. Mush closing that tear necessarily shortens the
  // inner edges, because a tube bent 90 degrees about a point genuinely has a crushed inside.
  // An assertion here would be a demand that the mush NOT do its job.
  // The MEAN is deliberately not asserted to fall, because it does not, and the reason is the
  // mechanism rather than a defect: mush takes a crease that was catastrophic on the two rings
  // either side of the joint and spreads it over every ring it can reach, so many edges move
  // a little instead of a few moving enormously. That is the trade the feature IS. What would
  // be a real fault is the mean blowing up — deformation invented far from the joint — so the
  // bound is on that instead.
  check('bend: mush does not distort the rest of the mesh', after.mean < before.mean * 1.5,
    before.mean.toFixed(4) + ' -> ' + after.mean.toFixed(4));
}

// --- 4. the detail is still there after a bend --------------------------------------
//
// Distinguishes mush from plain smoothing, which passes every check above except this one:
// measure the bump amplitude (deviation of each ring's vertices from that ring's mean radius)
// away from the joint, where the bend itself is not what is moving the surface.
{
  const raw = poseBend(Math.PI / 2);
  const mushed = new Float32Array(raw);
  applyMush(mushMesh(), level(mushed), mushed, TUBE.nbV);

  // Ring 2 — near the base, far from the seam, and rigidly transformed by the lower bone
  // (identity), so its rest shape is exactly what it should still be.
  const ringAmp = (a, r) => {
    let mean = 0;
    const rad = [];
    for (let s = 0; s < SEG; s++) {
      const i = (r * SEG + s) * 3;
      const q = Math.hypot(a[i], a[i + 2]);
      rad.push(q); mean += q;
    }
    mean /= SEG;
    return Math.max(...rad.map((q) => Math.abs(q - mean)));
  };
  const rest = ringAmp(TUBE.verts, 2), got = ringAmp(mushed, 2);
  check('bend: the sculpted bump survives away from the joint', got > rest * 0.8,
    'amplitude ' + rest.toFixed(4) + ' -> ' + got.toFixed(4));
}

// --- 5. the knob turns it off -------------------------------------------------------
{
  global.window._skinMush = 0;
  const raw = poseBend(Math.PI / 2);
  const out = new Float32Array(raw);
  const ran = applyMush(mushMesh(), level(out), out, TUBE.nbV);
  check('iterations 0 leaves the LBS result alone', ran === false && maxDiff(out, raw) === 0);
  global.window._skinMush = ITERS;
}

// --- 6. amount blends ---------------------------------------------------------------
{
  const raw = poseBend(Math.PI / 2);
  const full = new Float32Array(raw);
  applyMush(mushMesh(), level(full), full, TUBE.nbV);

  global.window._skinMushAmount = 0.5;
  const half = new Float32Array(raw);
  applyMush(mushMesh(), level(half), half, TUBE.nbV);
  delete global.window._skinMushAmount;

  let worst = 0;
  for (let i = 0; i < half.length; i++) worst = Math.max(worst, Math.abs(half[i] - (raw[i] + full[i]) * 0.5));
  check('amount 0.5 is halfway between LBS and full mush', worst < 1e-6, 'off by ' + worst.toExponential(2));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
