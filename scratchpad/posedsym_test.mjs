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
// DELIBERATELY NOT CENTRED ON THE ORIGIN. The rest shape is symmetric about x = 5, so the
// mirror plane has to be MEASURED from the rest geometry -- a fixture centred at zero passes
// just as happily with the centre hardcoded, which an injection proved.
const CX = 5;
const REST = [];
for (const v of HALF) REST.push(CX + v[0], v[1], v[2]);
for (const v of HALF) REST.push(CX - v[0], v[1], v[2]);
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

const PLANE_PT = [CX, 0, 0], PLANE_N = [1, 0, 0];   // the rest shape mirrors about x = CX
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
    /var posed = PosedSymmetry\.mirrorLocal\(this\._main, mesh, pt, ptPlane, nPlane\);\n\s*if \(!posed\) \{\n\s*Geometry\.mirrorPoint\(pt, ptPlane, nPlane\);/.test(PICK)
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

// --- 6. THE PLANE THE CALLER HANDS IN IS A POSED-SPACE PLANE ------------------------
//
// mesh.getSymmetryOrigin() is the mesh's `_center`: the midpoint of the LOCAL BOUND, recomputed
// from the geometry as it is NOW. Posed, that is not where the rest shape's mirror plane is,
// and reflecting rest-space points across it shifts every result sideways.
//
// This is the bug that shipped in v3.30.47, and every test above would have passed with it in
// place -- they all hand in [0,0,0], which happens to BE the correct rest plane for this
// fixture. So this one hands in the plane the real caller would: the midpoint of the posed
// bounding box. matt: "i grab the outside of the left hand and pull it away from the body
// centerline ... it mirrors to the INSIDE of the right hand"; and, decisively, "if i do it at
// the restpose, it works correctly" -- the two planes coincide only at rest.
{
  const jL = joint(), jR = joint();
  const t = body(jL, jR);
  Skinning.apply(t.main, t.mesh);
  // Asymmetric, and both sides carried well off the origin, so the posed bounding box has no
  // relationship to the rest shape's plane of symmetry.
  jL.pose(new THREE.Matrix4().makeRotationZ(0.5).setPosition(3, 1.5, 0));
  jR.pose(new THREE.Matrix4().makeRotationX(-0.4).setPosition(9, -0.5, 2));
  Skinning.apply(t.main, t.mesh);

  // Exactly what Mesh.getSymmetryOrigin() would report: the centre of the CURRENT bound.
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < NB; i++) {
    for (let k = 0; k < 3; k++) {
      const v = t.verts[i * 3 + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const posedPlane = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  check('the fixture actually displaces the plane', Math.abs(posedPlane[0]) > 1,
    'posed centre x = ' + posedPlane[0].toFixed(3) + ', so a posed-space plane is the same as '
      + 'the rest one and this test proves nothing');

  let worst = 0;
  for (let i = 0; i < PAIR; i++) {
    const out = [0, 0, 0];
    const got = PosedSymmetry.mirrorPoint(t.main, t.mesh, at(t.verts, i),
      posedPlane, PLANE_N, out);
    worst = Math.max(worst, got ? dist(got, at(t.verts, i + PAIR)) : Infinity);
  }
  check('the mirror ignores it and uses the REST plane',
    worst < 1e-4, 'worst ' + worst.toFixed(5));

  // And the rest plane is derived, not assumed: this fixture rests symmetric about x = 0.
  const rp = PosedSymmetry._restPlaneOrigin(t.mesh, PLANE_N, [0, 0, 0]);
  check('...which it MEASURES from the rest shape rather than assuming the origin',
    Math.abs(rp[0] - CX) < 1e-6, 'got ' + rp[0].toFixed(5) + ', want ' + CX);
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

// --- 7. NOTHING TO MIRROR IF NOTHING WAS HIT ---------------------------------------
//
// The primary pick reports [0,0,0] when it has no intersection, and reflecting the origin
// produces a confident-looking point somewhere inside the character -- which the forced hit
// then sculpts. Half the samples in the first real trace were this. The topological snap next
// to it has always checked (`pick1 && getPickedFace() !== -1`); the spatial path never did.
{
  const PICK = fs.readFileSync(path.join(REPO, 'src/math3d/Picking.js'), 'utf8');
  check('the mirror refuses a primary pick that hit nothing',
    /if \(!from\.getMesh\(\)\) \{ this\._mesh = null; return false; \}/.test(PICK),
    'and clears its own mesh, or the forced hit from the previous sample stands');
  check('...before it reads the intersection point',
    PICK.indexOf('if (!from.getMesh()) { this._mesh = null; return false; }')
      < PICK.indexOf('vec3.copy(pt, from.getIntersectionPoint());'),
    'reading first and checking afterwards is the same bug with a longer stack trace');
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
