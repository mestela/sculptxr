// Node harness for SCULPTING SYMMETRY ON A POSED CHARACTER (src/editing/PosedSymmetry.js).
//
// Symmetry mirrors the BRUSH across the mesh's local plane. That is right at rest and quietly
// wrong once the character moves, because the mirror of a posed point is not the pose of the
// mirrored point: lift one arm and the mirrored brush lands where the other arm would be if it
// had never moved.
//
// The fix routes through rest space -- posed -> rest -> mirror -> posed -- using the same
// per-vertex composite the skin pass applies. What is measured here is the property that plain
// mirroring cannot have: with BOTH sides posed, and posed DIFFERENTLY, a point on one arm has
// to land on the other arm where it actually is. A test that moved only one side would pass
// with half the arithmetic missing.
//
// Run: node scratchpad/posedsym_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SKIN = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');
const SYM = fs.readFileSync(path.join(REPO, 'src/editing/PosedSymmetry.js'), 'utf8');

globalThis.window = globalThis.window || {};

const strip = (src) => src.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
const Skeleton = { joints: () => [], jointPos: () => new THREE.Vector3() };
const adjacencyFromFaces = () => [];
const getOptionsURL = () => ({ boneMush: 0 });
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_posedsym_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + strip(SKIN) + '\n' + strip(SYM)
  + '\nexport { Skinning, PosedSymmetry };\n');
const { Skinning, PosedSymmetry } = await import(outPath + '?v=' + Date.now());
const THREE = await import(THREE_PATH);

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

let nextId = 1;
function joint() {
  const id = nextId++;
  const m = new THREE.Matrix4().elements.slice();
  return {
    getID: () => id,
    getMatrix: () => m,
    getModelSpaceMatrix: () => m,
    pose(mat) { for (let i = 0; i < 16; i++) m[i] = mat.elements[i]; },
  };
}

// A body symmetric about x = 0: four vertices per side, each side rigidly weighted to its own
// joint. Vertex i on the left pairs with vertex i + 4 on the right.
const HALF = [
  [-2, 0, 0], [-3, 1, 0], [-3, -1, 0], [-4, 0, 0.5],
];
const REST = [];
for (const v of HALF) REST.push(v[0], v[1], v[2]);
for (const v of HALF) REST.push(-v[0], v[1], v[2]);
const NB = 8, PAIR = 4;

function body(jL, jR) {
  const verts = new Float32Array(REST);
  const level = { getNbVertices: () => NB, getVertices: () => verts };
  const idx = new Int32Array(NB * 4).fill(-1);
  const wts = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) { idx[i * 4] = i < PAIR ? 0 : 1; wts[i * 4] = 1; }
  const mesh = {
    _meshes: [level], _sel: 0,
    _skinJoints: [jL.getID(), jR.getID()],
    _skinLevelMesh: level, _skinLevel: 0,
    _skinIdx: idx, _skinW: wts,
    _skinRest: new Float32Array(REST),
    _skinSrc: new Float32Array(REST),
    _skinInvBind: [new THREE.Matrix4(), new THREE.Matrix4()],
    getID: () => 99,
    getModelSpaceMatrix: () => new THREE.Matrix4().elements,
    computeLocalRadius: () => 1,
    updateGeometry() {}, updateGeometryBuffers() {}, updateBuffers() {}, updateResolution() {},
    isDynamic: false,
  };
  return { mesh: mesh, main: { getMeshes: () => [jL, jR], render() {} }, verts: verts };
}

const PLANE_PT = [0, 0, 0], PLANE_N = [1, 0, 0];   // mirror across x = 0
const at = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// --- 1. BOTH sides posed, posed differently ----------------------------------------
{
  const jL = joint(), jR = joint();
  const t = body(jL, jR);
  Skinning.apply(t.main, t.mesh);

  jL.pose(new THREE.Matrix4().makeRotationZ(0.9).setPosition(0, 1.5, 0));
  jR.pose(new THREE.Matrix4().makeRotationX(-0.6).setPosition(0, -0.5, 7));
  Skinning.apply(t.main, t.mesh);

  check('a posed bound mesh takes the rest-space route',
    PosedSymmetry.applies(t.main, t.mesh) === true);

  let worst = 0, worstAt = -1;
  for (let i = 0; i < PAIR; i++) {
    const out = [0, 0, 0];
    const got = PosedSymmetry.mirrorPoint(t.main, t.mesh, at(t.verts, i),
      PLANE_PT, PLANE_N, out);
    const want = at(t.verts, i + PAIR);      // where the paired vertex ACTUALLY is now
    const d = got ? dist(got, want) : Infinity;
    if (d > worst) { worst = d; worstAt = i; }
  }
  check('a point on one side lands on the other side where it actually is',
    worst < 1e-4, 'worst ' + worst.toFixed(5) + ' at vertex ' + worstAt);

  // THE RIGHT SIDE IS POSED A LONG WAY FROM WHERE IT RESTS, deliberately. The mirrored point
  // arrives in REST space, so the return leg must find its vertex there -- and with the right
  // side swung out to z=7, the nearest vertex to it in POSED space is one of the LEFT ones.
  // A version that searches the posed array picks the wrong matrix and lands nowhere near.

  // The control. This is what the code did before, and it has to be visibly wrong here, or the
  // fixture is not posed enough to be measuring anything.
  let plainWorst = 0;
  for (let i = 0; i < PAIR; i++) {
    const p = at(t.verts, i);
    PosedSymmetry._mirrorAcross(p, PLANE_PT, PLANE_N);
    plainWorst = Math.max(plainWorst, dist(p, at(t.verts, i + PAIR)));
  }
  check('...where mirroring in posed space is visibly wrong',
    plainWorst > 0.5, 'plain mirror was only ' + plainWorst.toFixed(3) + ' out, so this '
      + 'fixture cannot tell the two apart');
}

// --- 2. at bind pose, stay out of the way -------------------------------------------
//
// Every skin matrix is the identity there, so the plain plane mirror is already exact -- and
// cheaper. Routing through rest space anyway would be two nearest-vertex searches per stroke
// sample for an answer that was already correct.
{
  const jL = joint(), jR = joint();
  const t = body(jL, jR);
  Skinning.apply(t.main, t.mesh);
  check('at bind pose the plain mirror is left alone',
    PosedSymmetry.applies(t.main, t.mesh) === false);
  check('...and so is an unbound mesh',
    PosedSymmetry.applies(t.main, { }) === false);
}

// --- 3. the desktop path gets an OFFSET, not a new ray ------------------------------
//
// The desktop pick reflects the whole ray and re-casts it, which is what makes it land on the
// real surface of an asymmetric mesh rather than on this side's mirror image. That is worth
// keeping, so the correction is a translation of the mirrored ray.
{
  const jL = joint(), jR = joint();
  const t = body(jL, jR);
  Skinning.apply(t.main, t.mesh);
  jL.pose(new THREE.Matrix4().makeRotationZ(0.9).setPosition(0, 1.5, 0));
  jR.pose(new THREE.Matrix4().makeRotationX(-0.6).setPosition(0, -0.5, 7));
  Skinning.apply(t.main, t.mesh);

  const hit = at(t.verts, 1);
  t.main.getPicking = () => ({
    getMesh: () => t.mesh,
    getIntersectionPoint: () => hit,
  });

  const off = PosedSymmetry.rayOffset(t.main, t.mesh, PLANE_PT, PLANE_N, [0, 0, 0]);
  check('the desktop path returns an offset', !!off);
  // plain-mirrored contact + offset == the anatomically mirrored contact
  const plain = [hit[0], hit[1], hit[2]];
  PosedSymmetry._mirrorAcross(plain, PLANE_PT, PLANE_N);
  const moved = [plain[0] + off[0], plain[1] + off[1], plain[2] + off[2]];
  check('...that carries the mirrored ray onto the paired vertex',
    dist(moved, at(t.verts, 1 + PAIR)) < 1e-4,
    'off by ' + dist(moved, at(t.verts, 1 + PAIR)).toFixed(5));

  t.main.getPicking = () => ({ getMesh: () => null, getIntersectionPoint: () => null });
  check('...and nothing at all when the primary pick is on another mesh',
    PosedSymmetry.rayOffset(t.main, t.mesh, PLANE_PT, PLANE_N, [0, 0, 0]) === null,
    'an offset measured from someone else’s contact point is worse than no offset');
}

// --- 4. both platforms through the same call ----------------------------------------
{
  const SB = fs.readFileSync(path.join(REPO, 'src/editing/tools/SculptBase.js'), 'utf8');
  const PICK = fs.readFileSync(path.join(REPO, 'src/math3d/Picking.js'), 'utf8');
  check('the VR path asks PosedSymmetry first and falls back to the plane',
    /if \(!PosedSymmetry\.mirrorLocal\(this\._main, mesh, pt, ptPlane, nPlane\)\) \{\n\s*Geometry\.mirrorPoint\(pt, ptPlane, nPlane\);/.test(PICK)
      && /pickingSym\.mirrorFrom\(picking, mesh, ptPlane, nPlane\);/.test(SB),
    'the point path lives in Picking so it and the ray path cannot drift apart');
  // SculptBase must NOT reach the skinning module: PosedSymmetry -> Skinning -> Skeleton ->
  // Primitives -> Remesh -> Smooth -> SculptBase is a cycle, and every tool that extends
  // SculptBase then gets `undefined` as its base class at load time. module_load_test catches
  // it; this says WHY, next to the code that would reintroduce it.
  check('...and SculptBase does not import its way into a load cycle',
    !/^import PosedSymmetry/m.test(SB) && !/^import Skinning/m.test(SB),
    'Picking sits outside that loop, which is why the mirror lives there');
  check('...and the desktop path shifts its mirrored ray by the same measurement',
    (PICK.match(/PosedSymmetry\.rayOffset\(this\._main, mesh, ptPlane, nPlane, _TMP_SYMOFF\)/g) || []).length === 2,
    'BOTH symmetric ray paths, or symmetry is right with a mouse and wrong with a headset -- '
      + 'matt: "i want desktop and vr to conform as much as possible"');
  check('the mirror itself is written once',
    (SB.match(/mirrorAcross|posed -> rest/g) || []).length === 0,
    'a second copy of the rest-space hop is how two platforms drift apart');
}

// --- 5. THE TOPOLOGICAL MAP MUST NOT BE TRUSTED WHEN IT WAS BUILT POSED -------------
//
// The VR path prefers an exact vertex pairing over the spatial mirror, and rightly so -- when
// the pairing is real. But it is seeded from the LIVE vertices, so a map built while posed
// pairs the wrong two vertices and the topological walk then spreads that seed consistently
// over the whole mesh. The result is not noise: it is symmetry landing somewhere else, which
// is far harder to recognise as a bug. matt: "moving where the right index finger would be
// outwards on the right side, moves the pinky finger inwards on the left side."
{
  const SB = fs.readFileSync(path.join(REPO, 'src/editing/tools/SculptBase.js'), 'utf8');
  const MS = fs.readFileSync(path.join(REPO, 'src/mesh/MeshSymmetry.js'), 'utf8');

  check('the map records whether it was built on a posed mesh',
    /this\._mapPosed = !!this\._mesh\._skinIsPosed;/.test(MS)
      && /mapIsPoseSafe\(\) \{\n\s*return !this\._mapPosed;/.test(MS));
  check('...and a posed map is thrown away once the mesh can be measured again',
    /if \(this\._map && this\._mapPosed && !this\._mesh\._skinIsPosed\) this\._map = null;/.test(MS),
    'otherwise one posed use poisons the map for the rest of the session');
  check('the skin pass is what publishes the flag',
    /mesh\._skinIsPosed = !Skinning\.atBindPose\(main, mesh\);/.test(SKIN),
    'and only when the pose changed, which is the only time the answer can change');

  check('every symmetry-map read goes through the trust gate',
    (SB.match(/this\.trustedSymMap\(mesh, symData\)/g) || []).length === 5
      && !/symData\.isTopo\(\)\) \? symData\.getMap\(\)/.test(SB),
    'there were five identical copies of this test, which is precisely how four of them would '
      + 'have kept the old behaviour');
  check('...and the gate refuses a posed-built map',
    /if \(mesh && mesh\._skinIsPosed\n\s*&& !\(typeof symData\.mapIsPoseSafe === 'function' && symData\.mapIsPoseSafe\(\)\)\) return null;/.test(SB));
  check('...while still allowing one built at bind pose, which stays valid',
    /A map built at bind pose stays valid while posed/.test(SB)
      && !/if \(mesh && mesh\._skinIsPosed\) return null;/.test(SB),
    'topology does not move, so a trustworthy map is better than the spatial mirror');
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
