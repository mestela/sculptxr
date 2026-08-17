// Node harness for the desktop/iPad screen-input path in src/editing/tools/BoneDrawTool.js.
//
// Same pattern as ik_test.mjs: the ACTUAL source text is read, its imports stripped and stubs
// prepended, so the code under test is the shipped code rather than a copy of it.
//
// What is under test here is the INPUT PLUMBING — screen picking, the camera-facing drag
// plane, the pose sweep, the tap/drag split in IK. The rigging maths those feed (_dragTo,
// _poseTo, _radiusTo, _ikTo) already has its own coverage in ik_test.mjs, so the shared
// methods are spied on and the harness asserts what gets handed to them. That keeps this
// harness honest about its own scope and stops it re-testing the solver by accident.
//
// Run: node scratchpad/bonescreen_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';

globalThis.window = globalThis.window || {};

const mat4 = {
  clone: (m) => Float32Array.from(m),
  copy: (out, m) => { for (let i = 0; i < 16; i++) out[i] = m[i]; return out; },
};

class SculptBase {
  constructor(main) { this._main = main; }
  preUpdate() {}
}

// Joints are matrices plus a parent link; model space is the composed chain, which is what
// the real Mesh.getModelSpaceMatrix returns for a parented mesh.
function modelMat(j) {
  const m = j._m.clone();
  return j._parentMesh ? m.premultiply(modelMat(j._parentMesh)) : m;
}

let _nextId = 1;
export function makeJoint(pos, parent) {
  const j = {
    _isBone: true,
    _parentMesh: parent || null,
    _id: _nextId++,
    _boneRadius: 0,
    _m: new THREE.Matrix4(),
    getID() { return this._id; },
    getMatrix() { return this._m.elements; },
    getModelSpaceMatrix() { return modelMat(this).elements; },
  };
  const world = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]);
  if (parent) world.premultiply(modelMat(parent).clone().invert());
  j._m.copy(world);
  return j;
}

const _sA = new THREE.Vector3(), _sB = new THREE.Vector3(), _sD = new THREE.Vector3();

const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  joints: (main) => main.getMeshes().filter((m) => m._isBone),
  jointVisible: (j) => j._hidden !== true,
  jointPos(j, out) {
    const m = modelMat(j);
    out = out || new THREE.Vector3();
    return out.set(m.elements[12], m.elements[13], m.elements[14]);
  },
  // The real distance-to-capsule formula, so the radius assertions mean something.
  boneDistance(main, joint, p) {
    const parent = joint && joint._parentMesh;
    if (!Skeleton.isJoint(parent)) return null;
    Skeleton.jointPos(parent, _sA);
    Skeleton.jointPos(joint, _sB);
    _sD.subVectors(_sB, _sA);
    const len2 = _sD.lengthSq();
    let t = len2 > 1e-12 ? _sB.copy(p).sub(_sA).dot(_sD) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return _sA.addScaledVector(_sD, t).distanceTo(p);
  },
  boneLength(main, joint) {
    const parent = joint && joint._parentMesh;
    if (!Skeleton.isJoint(parent)) return 0;
    return Skeleton.jointPos(parent, _sA).distanceTo(Skeleton.jointPos(joint, _sB));
  },
  sceneUnit: () => 1,
  syncThree() {},
  // Driven from the test: null unless a plane has been installed on main.
  symmetryPlane: (main) => main._plane || null,
  setHighlight(main, j) { main._highlight = j; },
  updateVisuals() {},
  captureLocal: () => [],
  restoreLocal() {},
  moveJoint() {},
  pickJoint: () => null,
  planeDistance: (p, plane) => _sA.copy(p).sub(plane.origin).dot(plane.normal),
  projectToPlane: (p, plane, out) =>
    out.copy(p).addScaledVector(plane.normal, -Skeleton.planeDistance(p, plane)),
  snapAxis: (from, to) => to, // axis snap is pre-existing behaviour, out of scope here
  // Recorded rather than drawn, so the tests can assert what the user would be shown.
  showPreview(main, from, to) { main._preview = { from: from && from.clone(), to: to.clone() }; },
  hidePreview(main) { if (main) main._preview = null; },
  updatePlane(main, plane, hot) { main._planeVis = plane ? { hot: !!hot } : null; },
  hidePlane(main) { if (main) main._planeVis = null; },
};

const Skinning = { resolveWeightsAll: () => 0, restoreColorsAll() {}, isBound: () => false };
const IKSolver = {
  captureAll: () => [],
  solve() {},
  pinMode: (j) => j._pin || 0,
  cyclePin: (j) => { j._pin = ((j._pin || 0) + 1) % 3; return j._pin; },
  setPin: (j, m) => { j._pin = m; },
  pinnedJoints: () => [],
};

export { Skeleton, modelMat, THREE };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_bonescreen_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default BoneDrawTool;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { default: BoneDrawTool, makeJoint: J, Skeleton } = mod;
const THREE = await import(THREE_PATH);

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail !== undefined ? '  got: ' + detail : ''));
}
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-4 : eps);

const W = 800, H = 600;

// A worldGroup that is scaled AND rotated, because model space is worldGroup-relative and a
// conversion that only happened to work at identity would pass a gentler harness.
function makeMain(joints, ortho) {
  const scene = new THREE.Scene();
  const wg = new THREE.Group();
  wg.scale.set(0.701, 0.701, 0.701);
  wg.rotation.set(0.3, 0.7, -0.2);
  scene.add(wg);

  const cam = ortho
    ? new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 100)
    : new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  cam.position.set(0.4, 0.2, 5);
  cam.lookAt(0, 0, 0);
  scene.add(cam);
  scene.updateMatrixWorld(true);

  // A stand-in for the sculpt being rigged. Not a joint, so it is what _modelCentre finds —
  // deliberately off-origin so "the middle of the sculpt" cannot pass by coincidence.
  const sculpt = {
    _isBone: false,
    getThreeMesh: () => ({ geometry: { boundingSphere: { center: new THREE.Vector3(0.1, 0.3, -0.2), radius: 1.4 } } }),
    getModelSpaceMatrix: () => IDENTITY,
  };
  const all = joints.concat([sculpt]);

  const spies = [];
  const main = {
    _xrSession: null,
    _canvas: { width: W, height: H },
    _mouseX: 0, _mouseY: 0,
    _worldGroup: wg,
    _spies: spies,
    _sculpt: sculpt,
    getPixelRatio: () => 1,
    getCamera: () => ({ getThreeCamera: () => cam }),
    getMeshes: () => all,
    getMesh: () => null,
    getStateManager: () => null,
    // The surface pick, driven from the test via `main._pick` (a model-space point, or null
    // for "the cursor is off the mesh"). The stand-in mesh has an identity model matrix, so
    // the mesh-local point the real Picking returns and model space are the same here.
    getPicking: () => ({
      intersectionMouseMeshes: () => !!main._pick,
      getMesh: () => (main._pick ? { getModelSpaceMatrix: () => IDENTITY } : null),
      getIntersectionPoint: () => main._pick,
    }),
    _pick: null,
    setMesh() {},
    render() {},
  };
  return main;
}

const IDENTITY = new THREE.Matrix4().elements;

// Replace the shared rigging methods with recorders. Everything they do is covered by
// ik_test.mjs; what this harness needs is the argument they were handed.
const SPIED = ['_beginGrab', '_dragTo', '_releaseGrab', '_beginPose', '_poseTo', '_releasePose',
  '_beginRadius', '_radiusTo', '_releaseRadius', '_beginIK', '_ikTo', '_releaseIK', '_togglePin',
  '_place', 'endChain'];

function makeTool(main, mode) {
  const tool = new BoneDrawTool(main);
  const log = [];
  for (const name of SPIED) {
    tool[name] = (...args) => {
      // Clone vectors: the tool hands over module scratch, which is reused on the next frame.
      log.push([name, ...args.map((a) => (a && a.isVector3 ? a.clone() : a))]);
    };
  }
  tool._mode = mode === 'fk' || mode === 'free' ? 'tweak' : mode;
  tool._compensate = mode !== 'fk';
  tool._log = log;
  tool.last = (name) => { for (let i = log.length - 1; i >= 0; i--) if (log[i][0] === name) return log[i]; return null; };
  tool.count = (name) => log.filter((e) => e[0] === name).length;
  return tool;
}

function at(main, x, y) { main._mouseX = x; main._mouseY = y; }

// Model-space point -> device px, computed independently of the tool so the round-trip
// assertions are not the tool agreeing with itself.
function project(main, p) {
  const cam = main.getCamera().getThreeCamera();
  const v = p.clone();
  main._worldGroup.localToWorld(v);
  v.project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
}

function camAxisModel(main) {
  const cam = main.getCamera().getThreeCamera();
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const a = new THREE.Vector3(0, 0, 0), b = fwd.clone();
  main._worldGroup.worldToLocal(a);
  main._worldGroup.worldToLocal(b);
  return b.sub(a).normalize();
}

// --- 1. screen picking ----------------------------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1.2, 0], a);
  const main = makeMain([a, b]);
  const tool = makeTool(main, 'free');

  const sa = project(main, new THREE.Vector3(0, 0, 0));
  at(main, sa.x, sa.y);
  check('pick: the joint under the cursor is picked', tool._pickJointScreen() === a);

  at(main, sa.x + 12, sa.y - 10); // inside the 26px grab radius
  check('pick: a near miss still grabs', tool._pickJointScreen() === a);

  at(main, sa.x + 200, sa.y);
  check('pick: empty space picks nothing', tool._pickJointScreen() === null);

  const sb = project(main, Skeleton.jointPos(b));
  at(main, sb.x, sb.y);
  check('pick: each joint is picked at its own screen position', tool._pickJointScreen() === b);

  b._hidden = true;
  check('pick: a hidden joint is not grabbable', tool._pickJointScreen() === null);
  b._hidden = false;

  // A miss must NOT claim the pointer, or the tool eats every camera orbit.
  at(main, sa.x + 200, sa.y);
  check('pick: a miss returns false so the camera still gets the drag', tool.start() === false);
  check('pick: a miss starts no drag', tool._drag === null);
}

// --- 2. tweak: screen-plane drag ------------------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1.2, 0], a);
  const main = makeMain([a, b]);
  const tool = makeTool(main, 'free');
  const anchor = Skeleton.jointPos(a).clone();
  const axis = camAxisModel(main);

  const s = project(main, anchor);
  at(main, s.x, s.y);
  check('tweak: a hit claims the pointer', tool.start() === true);
  check('tweak: the grab began on the picked joint', (tool.last('_beginGrab') || [])[1] === a);

  at(main, s.x + 150, s.y - 90);
  tool.update();
  const got = (tool.last('_dragTo') || [])[1];
  check('tweak: the drag reached _dragTo', !!got);

  const back = project(main, got);
  check('tweak: the joint tracks the cursor exactly',
    near(back.x, s.x + 150, 1e-3) && near(back.y, s.y - 90, 1e-3),
    back && `${back.x.toFixed(2)},${back.y.toFixed(2)}`);

  const depth = axis.dot(got.clone().sub(anchor));
  check('tweak: depth along the camera axis is untouched', near(depth, 0, 1e-6), depth);

  tool.end();
  check('tweak: release commits the grab', tool.count('_releaseGrab') === 1);
  check('tweak: the drag state is cleared', tool._drag === null);
}

// --- 3. tweak: no jump when the grab is off-centre -------------------------------
{
  const a = J([0, 0, 0]);
  const main = makeMain([a]);
  const tool = makeTool(main, 'free');
  const anchor = Skeleton.jointPos(a).clone();
  const s = project(main, anchor);

  at(main, s.x + 14, s.y + 9); // grabbed near the joint, not on it
  tool.start();
  tool.update();
  const got = (tool.last('_dragTo') || [])[1];
  check('tweak: grabbing off-centre does not snap the joint to the cursor',
    got && got.distanceTo(anchor) < 1e-6, got && got.distanceTo(anchor));
}

// --- 4. pose: camera-axis sweep --------------------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1.2, 0], a);
  const main = makeMain([a, b]);
  const tool = makeTool(main, 'pose');
  const s = project(main, Skeleton.jointPos(a));

  at(main, s.x, s.y);
  check('pose: a hit claims the pointer', tool.start() === true);
  const begun = tool.last('_beginPose');
  check('pose: the grab began on the picked joint', begun && begun[1] === a);
  check('pose: the grab quaternion is identity, so _poseTo gets the delta outright',
    begun && begun[2][0] === 0 && begun[2][1] === 0 && begun[2][2] === 0 && begun[2][3] === 1);

  // First move from a grab exactly ON the joint: the start angle is degenerate (atan2(0,0)),
  // so this must resolve to no rotation rather than a jump.
  at(main, s.x + 100, s.y);
  tool.update();
  let q = (tool.last('_poseTo') || [])[1];
  check('pose: a grab on the joint centre does not jump',
    q && near(new THREE.Quaternion(q[0], q[1], q[2], q[3]).angleTo(new THREE.Quaternion()), 0),
    q && new THREE.Quaternion(q[0], q[1], q[2], q[3]).angleTo(new THREE.Quaternion()));

  // A quarter turn clockwise on screen (screen Y is down).
  at(main, s.x, s.y + 100);
  tool.update();
  q = (tool.last('_poseTo') || [])[1];
  const qq = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  check('pose: a quarter sweep is a quarter turn', near(qq.angleTo(new THREE.Quaternion()), Math.PI / 2, 1e-4),
    qq.angleTo(new THREE.Quaternion()));

  const axis = camAxisModel(main);
  const got = new THREE.Vector3(qq.x, qq.y, qq.z).normalize();
  check('pose: the rotation is about the camera view axis, in model space',
    near(got.dot(axis), 1, 1e-4), got.dot(axis));

  // Crossing the -pi/pi seam must not snap the joint through a half turn.
  at(main, s.x - 100, s.y - 1);
  tool.update();
  at(main, s.x - 100, s.y + 1);
  tool.update();
  const q2 = (tool.last('_poseTo') || [])[1];
  const step = new THREE.Quaternion(q2[0], q2[1], q2[2], q2[3])
    .angleTo(new THREE.Quaternion(q[0], q[1], q[2], q[3]));
  check('pose: the angle unwraps across the seam', step < Math.PI / 2, step);

  tool.end();
  check('pose: release commits', tool.count('_releasePose') === 1);
}

// --- 5. radius: distance from the shaft ------------------------------------------
{
  const a = J([0, -1, 0]);
  const b = J([0, 1, 0], a);
  const main = makeMain([a, b]);
  const tool = makeTool(main, 'radius');

  const mid = new THREE.Vector3(0, 0, 0);
  const sm = project(main, mid);
  at(main, sm.x, sm.y);
  check('radius: the capsule under the cursor is picked', tool._pickBoneScreen() === b);
  at(main, sm.x + 400, sm.y);
  check('radius: a click far from every shaft picks nothing', tool._pickBoneScreen() === null);

  at(main, sm.x, sm.y);
  check('radius: a hit claims the pointer', tool.start() === true);
  check('radius: the drag began on the picked capsule', (tool.last('_beginRadius') || [])[1] === b);

  at(main, sm.x + 60, sm.y);
  tool.update();
  const near1 = Skeleton.boneDistance(main, b, (tool.last('_radiusTo') || [])[1]);
  at(main, sm.x + 120, sm.y);
  tool.update();
  const near2 = Skeleton.boneDistance(main, b, (tool.last('_radiusTo') || [])[1]);
  check('radius: dragging away from the shaft grows the radius', near2 > near1 && near1 > 0,
    `${near1} then ${near2}`);
  check('radius: the growth tracks the cursor distance', near(near2 / near1, 2, 0.02), near2 / near1);

  tool.end();
  check('radius: release commits', tool.count('_releaseRadius') === 1);
}

// --- 6. ik: tap cycles the pin, drag solves --------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1.2, 0], a);
  const main = makeMain([a, b]);
  const s = project(main, Skeleton.jointPos(a));

  // A tap: press and release without moving.
  let tool = makeTool(main, 'ik');
  at(main, s.x, s.y);
  check('ik: a hit claims the pointer', tool.start() === true);
  tool.update();
  tool.end();
  check('ik: a tap cycles the pin', tool.count('_togglePin') === 1);
  check('ik: a tap cycles the pin of the joint it hit', (tool.last('_togglePin') || [])[1] === a);
  check('ik: a tap never begins a solve', tool.count('_beginIK') === 0);
  check('ik: a tap pushes no IK undo', tool.count('_releaseIK') === 0);

  // A twitch below the tap threshold is still a tap — a finger on glass never holds still.
  tool = makeTool(main, 'ik');
  at(main, s.x, s.y);
  tool.start();
  at(main, s.x + 3, s.y - 2);
  tool.update();
  check('ik: a twitch under the threshold is still a tap', tool.count('_beginIK') === 0);
  tool.end();
  check('ik: the twitch cycled the pin', tool.count('_togglePin') === 1);

  // A real drag.
  tool = makeTool(main, 'ik');
  at(main, s.x, s.y);
  tool.start();
  at(main, s.x + 80, s.y + 40);
  tool.update();
  at(main, s.x + 120, s.y + 40);
  tool.update();
  check('ik: a drag begins the solve exactly once', tool.count('_beginIK') === 1);
  check('ik: the solve gets no orientation from a plain drag', (tool.last('_beginIK') || [])[2] === null);
  const target = (tool.last('_ikTo') || [])[1];
  const back = target && project(main, target);
  check('ik: the effector target tracks the cursor',
    back && near(back.x, s.x + 120, 1e-3) && near(back.y, s.y + 40, 1e-3),
    back && `${back.x.toFixed(2)},${back.y.toFixed(2)}`);
  const depth = camAxisModel(main).dot(target.clone().sub(Skeleton.jointPos(a)));
  check('ik: depth along the camera axis is untouched', near(depth, 0, 1e-6), depth);
  tool.end();
  check('ik: a drag commits an IK undo', tool.count('_releaseIK') === 1);
  check('ik: a drag does not also cycle the pin', tool.count('_togglePin') === 0);
}

// --- 7. orthographic camera ------------------------------------------------------
{
  const a = J([0, 0, 0]);
  const main = makeMain([a], true);
  const tool = makeTool(main, 'free');
  const anchor = Skeleton.jointPos(a).clone();
  const s = project(main, anchor);

  at(main, s.x, s.y);
  check('ortho: the joint is picked', tool.start() === true);
  at(main, s.x + 100, s.y + 70);
  tool.update();
  const got = (tool.last('_dragTo') || [])[1];
  const back = got && project(main, got);
  check('ortho: the joint tracks the cursor',
    back && near(back.x, s.x + 100, 1e-3) && near(back.y, s.y + 70, 1e-3),
    back && `${back.x.toFixed(2)},${back.y.toFixed(2)}`);
  const depth = camAxisModel(main).dot(got.clone().sub(anchor));
  check('ortho: depth is untouched', near(depth, 0, 1e-6), depth);
  tool.end();
}

// --- 7b. ortho by SWAPPED MATRIX, which is what the app actually does --------------
// Camera.updateOrtho keeps the PerspectiveCamera object and writes an orthographic matrix
// into it. Anything that branches on the camera's CLASS therefore takes the perspective
// path against an ortho projection — that was real, and it made the tip track at roughly
// twice the cursor's rate. A real OrthographicCamera (test 7) cannot catch it.
{
  const a = J([0, 0, 0]);
  const main = makeMain([a]);
  const cam = main.getCamera().getThreeCamera();
  check('ortho-swap: the harness camera really is a PerspectiveCamera',
    cam.isPerspectiveCamera === true);
  // Swap in an ortho projection exactly as Camera.updateOrtho does.
  const o = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 100);
  o.updateProjectionMatrix();
  cam.projectionMatrix.copy(o.projectionMatrix);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

  const tool = makeTool(main, 'free');
  const anchor = Skeleton.jointPos(a).clone();
  const axis = camAxisModel(main);
  const s = project(main, anchor);
  at(main, s.x, s.y);
  check('ortho-swap: the joint is picked', tool.start() === true);

  at(main, s.x + 140, s.y - 90);
  tool.update();
  const got = (tool.last('_dragTo') || [])[1];
  const back = got && project(main, got);
  // 1:1, not 2:1 — the whole point of the check.
  check('ortho-swap: the joint tracks the cursor exactly, not at double rate',
    back && near(back.x, s.x + 140, 1e-3) && near(back.y, s.y - 90, 1e-3),
    back && `${back.x.toFixed(2)},${back.y.toFixed(2)} want ${s.x + 140},${s.y - 90}`);
  check('ortho-swap: depth is untouched',
    got && near(axis.dot(got.clone().sub(anchor)), 0, 1e-6));
  tool.end();
}

// --- 8. draw: press-drag-release, and the tip follows the cursor everywhere -------
// Axis snap is pre-existing behaviour with its own semantics; switched off so these checks
// are about the drag and the plane snap only.
window._boneSnapAxis = false;
{
  const root = J([0, 0.5, 0]);
  const main = makeMain([root]);
  // A symmetry plane at x = 0, which is what "start a bone from x=0" means.
  main._plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  const tool = makeTool(main, 'draw');

  main._pick = null;
  check('draw: between chains a press off the mesh does not claim the pointer', tool.start() === false);

  main._pick = [0.4, 0.2, 0]; // a surface hit: it gates the press, it does NOT set the depth
  const axis = camAxisModel(main);
  const s0 = { x: 420, y: 260 };
  at(main, s0.x, s0.y);
  check('draw: a press on the mesh claims the pointer', tool.start() === true);
  const anchor = tool._drag.anchor.clone(); // mid-depth of the sculpt, not the skin
  const mid = tool._modelCentre(new THREE.Vector3());
  check('draw: the press anchors at mid-depth, not on the surface',
    near(anchor.x, mid.x) && near(anchor.y, mid.y) && near(anchor.z, mid.z), anchor.x);
  check('draw: nothing is placed on press', tool.count('_place') === 0);
  check('draw: the symmetry plane is drawn while drawing', !!main._planeVis);
  check('draw: a preview bone is shown', !!main._preview);

  // The drag rides one plane at that depth and tracks the cursor exactly.
  at(main, s0.x + 120, s0.y - 60);
  main._pick = null; // dragged clean off the silhouette
  tool.update();
  const to = main._preview.to;
  check('draw: the tip follows the cursor off the mesh', !!to);
  const back = project(main, to);
  check('draw: and tracks it exactly', near(back.x, s0.x + 120, 1e-3) && near(back.y, s0.y - 60, 1e-3),
    `${back.x.toFixed(2)},${back.y.toFixed(2)}`);
  check('draw: at the depth the press established',
    near(axis.dot(to.clone().sub(anchor)), 0, 1e-6), axis.dot(to.clone().sub(anchor)));

  tool.end();
  check('draw: release places exactly one joint', tool.count('_place') === 1);
  const placed = (tool.last('_place') || [])[1];
  check('draw: it places the dragged point, not the press point',
    project(main, placed).x > s0.x + 100);
  check('draw: the plane STAYS after release', !!main._planeVis);
  check('draw: the chain is not ended by an ordinary placement', tool.count('endChain') === 0);

  // The plane is furniture, not a hover effect: off the mesh it must not blink out.
  tool.preUpdate(false);
  check('draw: the plane survives the cursor leaving the mesh', !!main._planeVis);
}

// --- 8a. the snap band is measured in screen px ----------------------------------
{
  const main = makeMain([J([0, 0.5, 0])]);
  main._plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  const tool = makeTool(main, 'draw');

  // A candidate a hair off the centreline is within any sane px band; one well off it is not.
  const nearPlane = new THREE.Vector3(0.002, 0.2, 0);
  const farPlane = new THREE.Vector3(0.9, 0.2, 0);
  check('snap: a candidate on the centreline snaps', tool._inSnapBand(nearPlane, main._plane) === true);
  check('snap: one well off it does not', tool._inSnapBand(farPlane, main._plane) === false);

  // The old band was 5% of a scene unit and swallowed the model; the px band must not care
  // how big the model is. Same screen geometry, a model-space threshold 100x wider.
  const wide = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  check('snap: the band is screen-relative, so model scale cannot widen it',
    tool._inSnapBand(farPlane, wide) === false);

  window._boneSnapPlane = false;
  check('snap: Snap Plane off means never', tool._inSnapBand(nearPlane, main._plane) === false);
  window._boneSnapPlane = true;

  // VR keeps the model-space band it was tuned with (sceneUnit * 0.05; the stub's unit is 1).
  main._xrSession = {};
  check('snap: VR uses the model-space band, inside',
    tool._inSnapBand(new THREE.Vector3(0.03, 0.2, 0), main._plane) === true);
  check('snap: VR uses the model-space band, outside',
    tool._inSnapBand(farPlane, main._plane) === false);
  main._xrSession = null;
}

// --- 8b. the plane follows the tool, not the pointer ------------------------------
{
  const root = J([0, 0.5, 0]);
  const main = makeMain([root]);
  main._plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  const tool = makeTool(main, 'draw');

  tool.syncPlane();
  check('plane: drawn in Draw with nothing happening at all', !!main._planeVis);

  // postRender is the per-frame keeper — one call, and it must not need a pointer event.
  main._planeVis = null;
  tool.postRender();
  check('plane: postRender keeps it up', !!main._planeVis);

  tool._mode = 'tweak';
  tool.syncPlane();
  check('plane: Tweak edits the rest skeleton, so it snaps too', !!main._planeVis);

  for (const m of ['pose', 'radius', 'ik']) {
    tool._mode = m;
    tool.syncPlane();
    check(`plane: hidden in ${m} (moves the character, nothing to snap)`, main._planeVis === null);
  }

  // The Snap Plane toggle is what turns it off, and it takes the plane with it.
  tool._mode = 'draw';
  window._boneSnapPlane = false;
  tool.syncPlane();
  check('plane: Snap Plane off hides it', main._planeVis === null);
  window._boneSnapPlane = true;
  tool.syncPlane();
  check('plane: Snap Plane on brings it back', !!main._planeVis);

  // No symmetry means no centreline, in VR either.
  main._plane = null;
  tool.syncPlane();
  check('plane: no symmetry, no plane', main._planeVis === null);

  main._xrSession = {};
  main._plane = { origin: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) };
  main._planeVis = null;
  tool.syncPlane();
  check('plane: in VR updateXR owns it, so the desktop sync stands down', main._planeVis === null);
}

// --- 8c. the depth ladder --------------------------------------------------------
{
  const root = J([0, 0.5, 0]);
  const main = makeMain([root]);
  const plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  main._plane = plane;
  const tool = makeTool(main, 'draw');
  const V = () => new THREE.Vector3();

  // 1. No chain: the root takes the MIDDLE of the sculpt, never the skin under the cursor.
  main._pick = [0.4, 0.2, 0]; // a surface hit that must NOT supply the depth
  at(main, 420, 260);
  const c = tool._modelCentre(V());
  check('depth: the model centre is the sculpt\'s, not the origin',
    near(c.x, 0.1) && near(c.y, 0.3) && near(c.z, -0.2), `${c.x},${c.y},${c.z}`);
  let a = tool._drawAnchor(V());
  check('depth: a root joint takes the middle of the sculpt',
    a && near(a.x, c.x) && near(a.y, c.y) && near(a.z, c.z), a && `${a.x},${a.y},${a.z}`);
  check('depth: and NOT the picked surface', a && !near(a.x, 0.4));

  // The same answer from every viewpoint, including the Snap Plane state — the plane snap
  // is what puts a root on the centreline, not the depth it starts at.
  window._boneSnapPlane = false;
  a = tool._drawAnchor(V());
  check('depth: Snap Plane does not change where the depth comes from',
    a && near(a.x, c.x) && near(a.y, c.y) && near(a.z, c.z));
  window._boneSnapPlane = true;
  let back;

  // 3. Mid-chain the parent wins outright, mesh or no mesh.
  tool._chainParent = root;
  main._pick = [9, 9, 9];
  a = tool._drawAnchor(V());
  const rp = Skeleton.jointPos(root);
  check('depth: mid-chain the parent wins',
    a && near(a.x, rp.x) && near(a.y, rp.y) && near(a.z, rp.z));

  // Mid-chain a press off the mesh is meant, and the drag runs past the silhouette.
  const axis = camAxisModel(main);
  const s = project(main, rp);
  main._pick = null;
  at(main, s.x + 40, s.y + 20);
  check('depth: mid-chain a press off the mesh still claims the pointer', tool.start() === true);
  at(main, s.x + 200, s.y - 80);
  tool.update();
  const to = main._preview.to;
  back = project(main, to);
  check('depth: the tip tracks the cursor off the mesh',
    near(back.x, s.x + 200, 1e-3) && near(back.y, s.y - 80, 1e-3),
    `${back.x.toFixed(2)},${back.y.toFixed(2)}`);
  check('depth: at the parent\'s depth', near(axis.dot(to.clone().sub(rp)), 0, 1e-6),
    axis.dot(to.clone().sub(rp)));
  tool.end();
  check('depth: release places the joint', tool.count('_place') === 1);
}

// --- 8d. the root drag moves laterally at mid-depth ------------------------------
{
  const main = makeMain([J([0, 0.5, 0])]);
  main._plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  const tool = makeTool(main, 'draw');
  main._pick = [0.4, 0.2, 0];
  at(main, 420, 260);
  check('root drag: the press claims the pointer', tool.start() === true);
  const anchor = tool._drag.anchor.clone();
  const centre = tool._modelCentre(new THREE.Vector3());
  check('root drag: it anchors at mid-depth, not on the skin',
    near(anchor.x, centre.x) && near(anchor.y, centre.y) && near(anchor.z, centre.z));

  // Drag away: the joint moves laterally but holds the depth it started at.
  at(main, 620, 300);
  main._pick = null;
  tool.update();
  const to = tool._drag.pos;
  const axis = camAxisModel(main);
  check('root drag: depth is held', near(axis.dot(to.clone().sub(anchor)), 0, 1e-6),
    axis.dot(to.clone().sub(anchor)));
  check('root drag: and it has moved off the centreline', Math.abs(to.x) > 1e-3, to.x);
  const back = project(main, to);
  check('root drag: tracking the cursor', near(back.x, 620, 1e-3) && near(back.y, 300, 1e-3));

  // Between chains the press still has to hit the sculpt, so left-drag can orbit.
  tool.end();
  tool._chainParent = null;
  main._pick = null;
  check('root drag: a press off the sculpt between chains orbits instead', tool.start() === false);
}
window._boneSnapAxis = undefined;

// --- 8e. branching: a press on a lit joint starts a chain from it -----------------
{
  const spine = J([0, 0.5, 0]);
  const neck = J([0, 1.1, 0], spine);
  const main = makeMain([spine, neck]);
  main._plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) };
  const tool = makeTool(main, 'draw');

  const s = project(main, Skeleton.jointPos(neck));
  at(main, s.x, s.y);
  tool.preUpdate(false);
  check('branch: hovering the neck lights it', tool._hilite === neck);

  // The joint is NOT over sculpt — the cursor is past the silhouette, which is the normal
  // case at a shoulder. The press must still be allowed to reach it.
  main._pick = null;
  check('branch: a press on the lit joint claims the pointer, off-mesh', tool.start() === true);
  tool.end();
  check('branch: and reaches _place, which re-roots the chain onto it', tool.count('_place') === 1);

  // Nowhere near a joint and off the sculpt: still an orbit, not a stray joint.
  at(main, s.x + 300, s.y + 200);
  tool.preUpdate(false);
  check('branch: away from every joint nothing lights', tool._hilite === null);
  check('branch: and a press there orbits', tool.start() === false);
}

// --- 8f. the rig survives its sculpt being deleted ---------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 6, 0], a);
  // No sculpt at all: getMeshes returns joints only.
  const scene = new THREE.Scene();
  const wg = new THREE.Group(); wg.scale.set(0.701, 0.701, 0.701); scene.add(wg);
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  cam.position.set(0.4, 0.2, 20); cam.lookAt(0, 0, 0); scene.add(cam);
  scene.updateMatrixWorld(true);
  const main = {
    _xrSession: null, _canvas: { width: W, height: H }, _mouseX: 400, _mouseY: 300,
    _worldGroup: wg, _plane: null,
    getPixelRatio: () => 1,
    getCamera: () => ({ getThreeCamera: () => cam }),
    getMeshes: () => [a, b], getMesh: () => null, getStateManager: () => null,
    getPicking: () => ({ intersectionMouseMeshes: () => false, getMesh: () => null,
                         getIntersectionPoint: () => null }),
    setMesh() {}, render() {},
  };
  const tool = makeTool(main, 'draw');

  // The tool must still find a depth — the skeleton's own centre — rather than collapsing
  // to the origin or refusing to draw.
  const c = tool._modelCentre(new THREE.Vector3());
  const mid = Skeleton.jointPos(a).clone().add(Skeleton.jointPos(b)).multiplyScalar(0.5);
  check('no sculpt: the depth falls back to the skeleton centre',
    near(c.x, mid.x) && near(c.y, mid.y) && near(c.z, mid.z), `${c.x},${c.y},${c.z}`);

  // And a chain can still be continued, with no mesh under the cursor anywhere.
  tool._chainParent = b;
  at(main, 500, 250);
  check('no sculpt: a chain can still be extended', tool.start() === true);
  tool.update();
  check('no sculpt: with a live preview', !!main._preview);
  tool.end();
  check('no sculpt: and it places', tool.count('_place') === 1);
}

// --- 9. draw: releasing on the parent ends the chain ------------------------------
{
  const root = J([0, 0.5, 0]);
  const main = makeMain([root]);
  const tool = makeTool(main, 'draw');
  tool._chainParent = root; // mid-chain
  const s = project(main, Skeleton.jointPos(root));

  main._pick = [0, 0.5, 0];
  at(main, s.x + 4, s.y - 3); // released on top of the joint the bone would hang from
  tool.start();
  tool.end();
  check('draw: a release on the parent ends the chain', tool.count('endChain') === 1);
  check('draw: and places nothing', tool.count('_place') === 0);

  // Just outside the 12px radius is an ordinary short bone, not an end.
  at(main, s.x + 30, s.y);
  tool.start();
  tool.end();
  check('draw: a release clear of the parent still places', tool.count('_place') === 1);
  check('draw: and does not end the chain', tool.count('endChain') === 1);

  // With no chain in progress there is no parent to double-tap, so nothing to end.
  tool._chainParent = null;
  at(main, s.x + 4, s.y - 3);
  tool.start();
  tool.end();
  check('draw: with no chain in progress a press near a joint still places',
    tool.count('_place') === 2 && tool.count('endChain') === 1);
}

// --- 10. draw: Escape / Enter -----------------------------------------------------
{
  const root = J([0, 0.5, 0]);
  const main = makeMain([root]);
  let rebuilt = 0;
  main._boneSectionRebuild = () => { rebuilt++; };
  const tool = makeTool(main, 'draw');
  tool._chainParent = root;

  check('keys: an unrelated key is not consumed', tool.onKeyDown({ key: 'b' }) === false);
  check('keys: Escape mid-chain is consumed', tool.onKeyDown({ key: 'Escape' }) === true);
  check('keys: Escape mid-chain ends the chain', tool.count('endChain') === 1);
  check('keys: Escape mid-chain stays in Draw', tool._mode === 'draw');

  tool._chainParent = null;
  check('keys: Escape again is consumed', tool.onKeyDown({ key: 'Escape' }) === true);
  check('keys: Escape with no chain leaves drawing for Pose', tool._mode === 'pose');
  check('keys: the panel is told the mode changed', rebuilt === 1);
  check('keys: Escape outside Draw is not consumed', tool.onKeyDown({ key: 'Escape' }) === false);

  const t2 = makeTool(main, 'draw');
  t2._chainParent = root;
  check('keys: Enter does the same as Escape', t2.onKeyDown({ key: 'Enter' }) === true
    && t2.count('endChain') === 1);
  main._xrSession = {};
  check('keys: in VR the keyboard stands down (A owns this)', t2.onKeyDown({ key: 'Escape' }) === false);
}
window._boneSnapAxis = undefined;

// --- 11. mode gating and the debounce opt-out -------------------------------------
{
  const a = J([0, 0, 0]);
  const main = makeMain([a]);
  const tool = makeTool(main, 'draw');
  // Draw commits on RELEASE now, so it must opt out too: a blocked start() mid-gesture
  // clears SculptManager's _strokeActive, and the release would never reach end().
  check('draw: opts out of the single-action debounce', tool.isDragAction() === true);
  tool._mode = 'pose';
  check('pose: opts out of the single-action debounce', tool.isDragAction() === true);
  main._xrSession = {};
  check('VR: the debounce opt-out is desktop-only', tool.isDragAction() === false);
  check('VR: start() defers to updateXR', tool.start() === false);
  tool.update();
  check('VR: update() does nothing', tool.count('_poseTo') === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
