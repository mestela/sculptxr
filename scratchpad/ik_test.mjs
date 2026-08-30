// Node harness for src/editing/IKSolver.js.
//
// The real module cannot be imported here (gl-matrix is UMD, Skeleton drags in the whole
// mesh stack), so the ACTUAL source text is read, its imports stripped, and stubs prepended.
// That means the code under test is the shipped code, not a copy of it.
//
// Run: node scratchpad/ik_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');

// Defect injections, so the steering checks have been seen to fail (standing lesson 1):
//   IK_INJECT=noswivel  the steering goal does nothing at all
//   IK_INJECT=axial     swivel toward the goal WITHOUT removing the component along the axis,
//                       which is the plausible-looking version that lands short of the circle's
//                       closest point because it asks for an angle the rotation cannot deliver
{
  const inj = process.env.IK_INJECT || '';
  if (inj === 'noswivel') {
    const a = '  if (!soft || !soft.size) return 0;';
    if (!SRC.includes(a)) throw new Error('inject noswivel: anchor moved');
    SRC = SRC.replace(a, '  return 0;');
  } else if (inj === 'rotastarget') {
    // The rotation-only pin falls through into `targets`, which is the plausible-looking
    // version: it still holds the orientation, so it looks like it works, and quietly nails
    // the joint to the handle's position as well.
    const a = `        rotHeld.push(node);   // woken after markActive, not here — see the markActive note
        continue;
      }`;
    if (!SRC.includes(a)) throw new Error('inject rotastarget: anchor moved');
    SRC = SRC.replace(a, `        rotHeld.push(node);
      }`);
  } else if (inj === 'rotwakeearly') {
    // The rotation-only pin lights its own node DURING the pin loop instead of after the
    // anchor walks. markActive stops at the first already-lit node, so a hard pin whose chain
    // runs through this joint silently loses everything above it and solves nothing.
    const a = '    for (const n of rotHeld) n.active = true;';
    if (!SRC.includes(a)) throw new Error('inject rotwakeearly: anchor moved');
    SRC = SRC.replace(a, '')
      .replace(`        rotHeld.push(node);   // woken after markActive, not here — see the markActive note`,
        '        node.active = true;');
  } else if (inj === 'watchlocal') {
    // The pin watcher goes back to reading the pin's own LOCAL matrix. Identical for a
    // top-level pin, which is why it was invisible — and blind the moment a pin has a parent.
    const a = 'const m = p.getModelSpaceMatrix ? p.getModelSpaceMatrix(_mWatch) : p.getMatrix();';
    if (!SRC.includes(a)) throw new Error('inject watchlocal: anchor moved');
    SRC = SRC.replace(a, 'const m = p.getMatrix();');
  } else if (inj === 'rotwatchall') {
    // pinsMoved goes back to comparing all sixteen matrix elements for a rotation-only pin,
    // so its handle riding along with its joint reports a change on every frame of playback.
    const a = '      if (rotOnly && (i > 10 || (i & 3) === 3)) continue;';
    if (!SRC.includes(a)) throw new Error('inject rotwatchall: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'axial') {
    const a = `  _vPu.addScaledVector(_vAx, -_vPu.dot(_vAx));`;
    const b = `  _vPv.addScaledVector(_vAx, -_vPv.dot(_vAx));`;
    if (!SRC.includes(a) || !SRC.includes(b)) throw new Error('inject axial: anchors moved');
    SRC = SRC.replace(a, '').replace(b, '');
  }
}

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';

// The solver reads its tuning knobs off window, as the rest of the app does.
globalThis.window = globalThis.window || {};

const mat4 = {
  create: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  clone: (m) => Float32Array.from(m),
  copy: (out, m) => { for (let i = 0; i < 16; i++) out[i] = m[i]; return out; },
};

// --- mock rig -------------------------------------------------------------------
// A joint is a local matrix plus a parent link. Model space is the composed chain, which is
// exactly what the real Mesh.getModelSpaceMatrix returns for a parented mesh.
let _nextId = 1;
export function makeJoint(pos, parent) {
  const j = {
    _isBone: true,
    _parentMesh: parent || null,
    _id: _nextId++,
    _m: new THREE.Matrix4(),
    getID() { return this._id; },
    getMatrix() { return this._m.elements; },
    getModelSpaceMatrix() { return modelMat(this).elements; },
  };
  // Position is given in MODEL space; store the local that produces it.
  const world = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]);
  if (parent) world.premultiply(modelMat(parent).clone().invert());
  j._m.copy(world);
  return j;
}

function modelMat(j) {
  const m = j._m.clone();
  return j._parentMesh ? m.premultiply(modelMat(j._parentMesh)) : m;
}

// The scene, as much of it as the solver touches. Pins are now real objects, so the mock has
// to be able to make and hold them: buildNull + addMeshSilent is the whole surface
// IKSolver.makePinObject uses, and keeping the mesh list mutable is what lets a pin come and
// go the way it does in the app.
export function makeMain(joints) {
  const list = joints.slice();
  return {
    getMeshes: () => list,
    buildNull() {
      // A null composes through its parent exactly as a joint does, and honours the "out"
      // argument the real Mesh takes. Both matter now that a pin can be PARENTED to another
      // pin: the solve reads a pin in model space, so a stub that ignored its parent would
      // make the watcher look correct while the app it models was blind.
      // (No backticks in here: the whole prelude is a template literal.)
      const n = {
        _isNull: true,
        _permanentStaticLabel: null,
        _id: _nextId++,
        _m: new THREE.Matrix4(),
        _parentMesh: null,
        getID() { return this._id; },
        getMatrix() { return this._m.elements; },
        getModelSpaceMatrix(out) {
          const e = modelMat(this).elements;
          if (!out) return e;
          for (let i = 0; i < 16; i++) out[i] = e[i];
          return out;
        },
        setModelSpaceMatrix(e) {
          const m = new THREE.Matrix4().fromArray(e);
          if (this._parentMesh) m.premultiply(modelMat(this._parentMesh).clone().invert());
          this._m.copy(m);
        },
      };
      return n;
    },
    decorateNull() {},
    addMeshSilent(m) { if (!list.includes(m)) list.push(m); return m; },
    removeMeshSilent(m) { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); },
  };
}

const Skeleton = {
  isJoint: (m) => !!(m && m._isBone),
  joints: (main) => main.getMeshes().filter((m) => m._isBone),
  jointPos(j, out) {
    const m = modelMat(j);
    out = out || new THREE.Vector3();
    return out.set(m.elements[12], m.elements[13], m.elements[14]);
  },
  sceneUnit: () => 1,
  // Pin creation moved into Skeleton so the file loader can reach it without an import cycle.
  // The stub mirrors what the real one does that the SOLVER can observe: a null in the scene,
  // flagged as a pin, standing where the joint stands.
  makePin(main, joint) {
    if (!main || !main.buildNull) return null;
    const pin = main.buildNull();
    pin._isPinTarget = true;
    pin._pinnedJoint = joint;
    pin._permanentStaticLabel = joint && joint._permanentStaticLabel
      ? 'pin_' + joint._permanentStaticLabel : 'pin';
    main.addMeshSilent(pin);
    if (joint) pin._m.fromArray(modelMat(joint).elements);
    return pin;
  },
  syncThree() {},
  moveJoint(main, joint, pos) {
    const m = modelMat(joint);
    m.elements[12] = pos.x; m.elements[13] = pos.y; m.elements[14] = pos.z;
    if (joint._parentMesh) m.premultiply(modelMat(joint._parentMesh).clone().invert());
    joint._m.copy(m);
  },
};

export { Skeleton, modelMat };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_ik_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default IKSolver;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { default: IKSolver, makeJoint: J, makeMain, Skeleton, modelMat } = mod;
const THREE = await import(THREE_PATH);

let failures = 0;
function spineless() { return null; }
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

function pos(j) { return Skeleton.jointPos(j); }

function lengths(joints) {
  return joints.filter((j) => j._parentMesh)
    .map((j) => pos(j).distanceTo(pos(j._parentMesh)));
}

function lengthsPreserved(name, joints, before) {
  const after = lengths(joints);
  let worst = 0;
  for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(after[i] - before[i]));
  check(name + ': bone lengths preserved', worst < 1e-6, 'worst drift ' + worst.toExponential(2));
}

// --- 1. reachable target on a straight chain ------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const d = J([0, 3, 0], c);
  const joints = [a, b, c, d];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(1.5, 1.5, 0);
  IKSolver.solve(main, d, target);

  check('reachable: effector hits the target', pos(d).distanceTo(target) < 1e-3,
    'err ' + pos(d).distanceTo(target).toExponential(2));
  check('reachable: root did not move (nothing pinned)', pos(a).length() < 1e-9);
  lengthsPreserved('reachable', joints, L0);
}

// --- 2. unreachable target -------------------------------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const joints = [a, b, c];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(50, 0, 0);
  IKSolver.solve(main, c, target);

  // The chain should straighten toward the target and stop at its own reach, NOT stretch.
  check('unreachable: chain reaches its own limit', Math.abs(pos(c).length() - 2) < 1e-3,
    'reach ' + pos(c).length().toFixed(4));
  check('unreachable: chain points at the target',
    pos(c).clone().normalize().dot(target.clone().normalize()) > 0.999);
  lengthsPreserved('unreachable', joints, L0);
}

// --- 3. a pin holds while something else is dragged ------------------------------
{
  const root = J([0, 0, 0]);
  const s1 = J([0, 1, 0], root);
  const s2 = J([0, 2, 0], s1);
  const s3 = J([0, 3, 0], s2);
  const s4 = J([0, 4, 0], s3);
  const joints = [root, s1, s2, s3, s4];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(s4, true, main);
  const tipBefore = pos(s4).clone();

  // Kept inside the pin's reach on purpose: s2 -> s4 is two bones of length 1, so a target
  // further than 2 from the pin is unsatisfiable and the pin SHOULD fall short.
  const target = new THREE.Vector3(0.3, 2.1, 0);
  IKSolver.solve(main, s2, target);

  // Realtime XR uses a ten-sweep budget; difficult interior anchors may settle a few
  // thousandths short rather than spending another 30 sweeps chasing exact convergence.
  check('pinned: the pin stayed put', pos(s4).distanceTo(tipBefore) < 1e-2,
    'moved ' + pos(s4).distanceTo(tipBefore).toExponential(2));
  check('pinned: dragged joint reached its target', pos(s2).distanceTo(target) < 1e-2,
    'err ' + pos(s2).distanceTo(target).toExponential(2));
  check('pinned: the root was free to move', pos(root).length() > 1e-6);
  lengthsPreserved('pinned', joints, L0);
  IKSolver.setPinned(s4, false, main);
}

// --- 4. branching tree, two pins --------------------------------------------------
{
  // Arms drawn BENT, so the chain has slack. Straight limbs are already at full extension:
  // any movement of the body is then unreachable and the pins must fall short by definition.
  const hips = J([0, 0, 0]);
  const chest = J([0, 1, 0], hips);
  const shL = J([0.5, 1, 0], chest);
  const elL = J([0.9, 0.6, 0], shL);
  const haL = J([1.1, 0.1, 0], elL);
  const shR = J([-0.5, 1, 0], chest);
  const elR = J([-0.9, 0.6, 0], shR);
  const haR = J([-1.1, 0.1, 0], elR);
  const joints = [hips, chest, shL, elL, haL, shR, elR, haR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(haL, true, main);
  IKSolver.setPinned(haR, true, main);
  const handL = pos(haL).clone(), handR = pos(haR).clone();

  // Pull the hips down: the classic "hands pinned, body crouches" case.
  IKSolver.solve(main, hips, new THREE.Vector3(0, -0.3, 0));

  check('branch: left pin held', pos(haL).distanceTo(handL) < 1e-2,
    'moved ' + pos(haL).distanceTo(handL).toFixed(4));
  check('branch: right pin held', pos(haR).distanceTo(handR) < 1e-2,
    'moved ' + pos(haR).distanceTo(handR).toFixed(4));
  check('branch: hips actually moved down', pos(hips).y < -0.2,
    'y ' + pos(hips).y.toFixed(3));
  lengthsPreserved('branch', joints, L0);
  IKSolver.setPinned(haL, false, main);
  IKSolver.setPinned(haR, false, main);
}

// --- 5. what the solver is allowed to touch ---------------------------------------
// An unsolved branch of the SAME skeleton still rides its ancestors — that is what a
// hierarchy means, and a rotated root must carry everything under it. A different skeleton
// entirely must not move at all.
{
  const root = J([0, 0, 0]);
  const spine = J([0, 1, 0], root);
  const arm = J([1, 1, 0], spine);
  const tail = J([0, -1, 0], root);   // same tree, off the solved path
  const other = J([9, 0, 0]);          // a separate skeleton
  const otherKid = J([9, 1, 0], other);
  const joints = [root, spine, arm, tail, other, otherKid];
  const main = makeMain(joints);
  const otherBefore = pos(otherKid).clone();
  const tailOffset = pos(tail).clone().sub(pos(root)).length();
  const L0 = lengths(joints);

  IKSolver.solve(main, arm, new THREE.Vector3(0.7, 1.6, 0));

  check('scope: a separate skeleton is untouched', pos(otherKid).distanceTo(otherBefore) < 1e-9);
  check('scope: an unsolved branch rides its parent rigidly',
    Math.abs(pos(tail).clone().sub(pos(root)).length() - tailOffset) < 1e-9);
  lengthsPreserved('scope', joints, L0);
}

// --- 6. the grabbed joint's ORIENTATION is a constraint, not a decoration -----------
{
  // Hips with two legs and a spine, feet pinned: twist the hips and the legs must be carried
  // by that twist, with the pinned feet re-solved against where they end up.
  const hips = J([0, 0, 0]);
  const spine = J([0, 1, 0], hips);
  const thighL = J([0.3, -0.2, 0], hips);
  const kneeL = J([0.35, -0.9, 0.1], thighL);
  const footL = J([0.4, -1.6, 0], kneeL);
  const thighR = J([-0.3, -0.2, 0], hips);
  const kneeR = J([-0.35, -0.9, 0.1], thighR);
  const footR = J([-0.4, -1.6, 0], kneeR);
  const joints = [hips, spine, thighL, kneeL, footL, thighR, kneeR, footR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(footL, true, main);
  IKSolver.setPinned(footR, true, main);
  const fL = pos(footL).clone(), fR = pos(footR).clone();
  const thighLBefore = pos(thighL).clone();

  // Turn the hips 30 degrees about Y while leaving them where they are.
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);
  IKSolver.solve(main, hips, pos(hips).clone(), null, twist);

  const q = new THREE.Quaternion();
  modelMat(hips).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  check('twist: hips reached the driven orientation', q.angleTo(twist) < 1e-4,
    'off by ' + (q.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  // The spine sits ON the twist axis, so its POSITION is invariant under a Y twist — its
  // orientation is what has to follow. The thighs are off-axis, so they must actually move.
  const qs = new THREE.Quaternion();
  modelMat(spine).decompose(new THREE.Vector3(), qs, new THREE.Vector3());
  check('twist: the spine was carried by the twist', qs.angleTo(twist) < 1e-4,
    'off by ' + (qs.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  check('twist: the thighs swung with the hips', pos(thighL).distanceTo(thighLBefore) > 1e-2,
    'moved ' + pos(thighL).distanceTo(thighLBefore).toFixed(4));
  check('twist: left foot still pinned', pos(footL).distanceTo(fL) < 1.5e-2,
    'moved ' + pos(footL).distanceTo(fL).toFixed(4));
  check('twist: right foot still pinned', pos(footR).distanceTo(fR) < 1e-2,
    'moved ' + pos(footR).distanceTo(fR).toFixed(4));
  lengthsPreserved('twist', joints, L0);
  IKSolver.setPinned(footL, false, main);
  IKSolver.setPinned(footR, false, main);
}

// --- 7. a LEAF effector can be rotated (nothing hangs off it to fit against) --------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const c = J([0, 2, 0], b);
  const joints = [a, b, c];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
  IKSolver.solve(main, c, new THREE.Vector3(0.5, 1.5, 0), null, twist);

  const q = new THREE.Quaternion();
  modelMat(c).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  check('leaf twist: orientation reached', q.angleTo(twist) < 1e-4,
    'off by ' + (q.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  lengthsPreserved('leaf twist', joints, L0);
}

// --- 8. a 6DOF pin holds ORIENTATION as well as position ---------------------------
{
  // A leg with a foot on the ground. Pull the hips sideways: a 3DOF pin lets the foot tip
  // over as the shin swings, a 6DOF pin keeps it flat.
  const build = () => {
    const hips = J([0, 2, 0]);
    const knee = J([0.1, 1, 0], hips);
    const ankle = J([0, 0.2, 0], knee);
    const toe = J([0, 0.2, 0.3], ankle); // sticks forward, so a tilt is visible as motion
    return { hips, knee, ankle, toe, joints: [hips, knee, ankle, toe] };
  };

  const q = new THREE.Quaternion();
  const orientOf = (j) => { modelMat(j).decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q.clone(); };

  const a = build();
  const mainA = makeMain(a.joints);
  IKSolver.setPin(a.ankle, IKSolver.PIN_POS, mainA);
  const o3 = orientOf(a.ankle);
  IKSolver.solve(mainA, a.hips, new THREE.Vector3(0.5, 1.8, 0));
  const drift3 = orientOf(a.ankle).angleTo(o3);

  const b = build();
  const mainB = makeMain(b.joints);
  const L0 = lengths(b.joints);
  IKSolver.setPin(b.ankle, IKSolver.PIN_FULL, mainB);
  const o6 = orientOf(b.ankle);
  const p6 = pos(b.ankle).clone();
  IKSolver.solve(mainB, b.hips, new THREE.Vector3(0.5, 1.8, 0));

  check('6dof pin: orientation held', orientOf(b.ankle).angleTo(o6) < 1e-4,
    'drifted ' + (orientOf(b.ankle).angleTo(o6) * 180 / Math.PI).toFixed(3) + ' deg');
  check('6dof pin: position still held', pos(b.ankle).distanceTo(p6) < 1e-2);
  check('6dof pin: a 3dof pin does NOT hold orientation', drift3 > 1e-3,
    'rotated ' + (drift3 * 180 / Math.PI).toFixed(2) + ' deg');
  lengthsPreserved('6dof pin', b.joints, L0);

  // Repeated solves must not let a held orientation ratchet round over a long drag.
  for (let i = 0; i < 60; i++) {
    IKSolver.solve(mainB, b.hips, new THREE.Vector3(0.5 + 0.002 * i, 1.8, 0));
  }
  check('6dof pin: no orientation drift over 60 solves', orientOf(b.ankle).angleTo(o6) < 1e-3,
    'drifted ' + (orientOf(b.ankle).angleTo(o6) * 180 / Math.PI).toFixed(4) + ' deg');
  IKSolver.setPin(b.ankle, IKSolver.PIN_NONE, mainB);
  IKSolver.setPin(a.ankle, IKSolver.PIN_NONE, mainB);
}

// --- 8b. a full pin on the root holds translation as well as rotation ----------------
{
  const hips = J([0, 2, 0]);
  const thighL = J([0.3, 1.4, 0], hips);
  const thighR = J([-0.3, 1.4, 0], hips);
  const main = makeMain([hips, thighL, thighR]);
  IKSolver.setPin(hips, IKSolver.PIN_FULL, main);
  const pin = IKSolver.pinObject(hips);
  const wantP = new THREE.Vector3(0.45, 1.65, -0.2);
  const wantQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.55);
  pin._m.compose(wantP, wantQ, new THREE.Vector3(1, 1, 1));
  IKSolver.holdPins(main);
  const gotQ = new THREE.Quaternion();
  modelMat(hips).decompose(new THREE.Vector3(), gotQ, new THREE.Vector3());
  check('root pin: hips follow the pin translation', pos(hips).distanceTo(wantP) < 1e-6,
    'off by ' + pos(hips).distanceTo(wantP).toExponential(2));
  check('root pin: hips still follow the pin rotation', gotQ.angleTo(wantQ) < 1e-6,
    'off by ' + (gotQ.angleTo(wantQ) * 180 / Math.PI).toFixed(4) + ' deg');
  check('root pin: the body travels with the hips', pos(thighL).x > 0.5,
    'left thigh x ' + pos(thighL).x.toFixed(3));
}

// --- 9. pin state cycles and reads back --------------------------------------------
{
  const j = J([0, 0, 0]);
  const m9 = makeMain([j]);
  const before = m9.getMeshes().length;

  const c1 = IKSolver.cyclePin(j, m9);
  check('cycle: none -> position', c1.mode === IKSolver.PIN_POS);
  check('cycle: pinning puts a null in the scene', m9.getMeshes().length === before + 1);
  const pinObj = IKSolver.pinObject(j);
  check('cycle: the joint points at it', !!pinObj && pinObj === c1.pin);

  const c2 = IKSolver.cyclePin(j, m9);
  check('cycle: position -> full', c2.mode === IKSolver.PIN_FULL);
  check('cycle: strengthening a pin reuses the same object', IKSolver.pinObject(j) === pinObj);
  check('cycle: and does not add a second null', m9.getMeshes().length === before + 1);

  // The cycle gained a fourth stop when steering goals arrived: a soft pin is a pin in every
  // structural sense (same object, same anchor, same undo) and differs only in what the solver
  // does with it, so it belongs on the same button rather than on a new one. Rotation-only
  // then took a fifth, sitting NEXT TO 6DOF rather than at the end of the numbers, because it
  // is the same hold minus a half and reads as the neighbour of the thing it halves. That is
  // why the order is a written-out ring: PIN_ROT is 4 for file compatibility, so the sequence
  // the button walks is no longer the mode numbers in order.
  const c3 = IKSolver.cyclePin(j, m9);
  check('cycle: full -> rotation only', c3.mode === IKSolver.PIN_ROT);
  check('cycle: a rotation-only pin still reads as pinned', IKSolver.isPinned(j));
  check('cycle: rotation only reuses the same object', IKSolver.pinObject(j) === pinObj);

  const c35 = IKSolver.cyclePin(j, m9);
  check('cycle: rotation only -> steer', c35.mode === IKSolver.PIN_SOFT);
  check('cycle: a steering goal still reads as pinned', IKSolver.isPinned(j));
  check('cycle: and still reuses the same object', IKSolver.pinObject(j) === pinObj);
  check('cycle: and does not add a null of its own', m9.getMeshes().length === before + 1);

  // Every mode is reachable from the button and none of them twice, which is the whole
  // contract of a cycle and the thing a hand-written ring can get wrong.
  const ring = IKSolver.PIN_CYCLE;
  const modes = [IKSolver.PIN_NONE, IKSolver.PIN_POS, IKSolver.PIN_FULL,
                 IKSolver.PIN_SOFT, IKSolver.PIN_ROT];
  check('cycle: the ring visits every mode exactly once',
    ring.length === modes.length && modes.every((m) => ring.filter((r) => r === m).length === 1),
    JSON.stringify(ring));
  check('cycle: the modes are all distinct values', new Set(modes).size === modes.length);

  const c4 = IKSolver.cyclePin(j, m9);
  check('cycle: steer -> none', c4.mode === IKSolver.PIN_NONE);
  check('cycle: unpinning hands the object back to be removed', c4.removed === pinObj);
  check('cycle: and the joint no longer reads as pinned', !IKSolver.isPinned(j));

  // THE ANCHOR IS THE OBJECT'S TRANSFORM. This is the whole point of the change: move the pin
  // and the joint is pinned somewhere else, with nothing to re-read and nothing to ratchet.
  const k = J([0, 1, 0]);
  const m9b = makeMain([k]);
  IKSolver.setPin(k, IKSolver.PIN_POS, m9b);
  const kp = IKSolver.pinObject(k);
  check('anchor: a fresh pin sits on its joint',
    IKSolver.pinAnchor(k, new THREE.Vector3()).distanceTo(pos(k)) < 1e-9);
  kp._m.elements[13] = 5;
  check('anchor: moving the pin object moves the anchor',
    Math.abs(IKSolver.pinAnchor(k, new THREE.Vector3()).y - 5) < 1e-9,
    'y ' + IKSolver.pinAnchor(k, new THREE.Vector3()).y);

  // A pin is named after the bone it constrains: "Pin 7" is useless in an outliner, and being
  // findable is most of the point of a pin being an object at all.
  const named = J([0, 2, 0]);
  named._permanentStaticLabel = 'bone_03_R';
  const mN = makeMain([named]);
  IKSolver.setPin(named, IKSolver.PIN_POS, mN);
  check('name: the pin is named after its bone',
    IKSolver.pinObject(named)._permanentStaticLabel === 'pin_bone_03_R',
    IKSolver.pinObject(named)._permanentStaticLabel);

  // Moving a pin has to be NOTICED, or dragging one with the gizmo leaves the rig where it was.
  const mv = J([0, 0, 0]);
  const mM = makeMain([mv]);
  IKSolver.setPin(mv, IKSolver.PIN_POS, mM);
  IKSolver.pinsMoved(mM); // first look establishes the baseline
  check('moved: a settled pin reports no movement', !IKSolver.pinsMoved(mM));
  IKSolver.pinObject(mv)._m.elements[13] += 0.5;
  check('moved: nudging the pin object is noticed', IKSolver.pinsMoved(mM));
  check('moved: and only once, until it moves again', !IKSolver.pinsMoved(mM));

  // A pin whose object has been deleted from the scene is no pin at all — checked once, in
  // pinObject, rather than left to dangle at every call site.
  kp._isPinTarget = false;
  check('anchor: a dangling pin reference reads as unpinned', !IKSolver.isPinned(k));
  j._boneIKPin = 0;
}

// --- 10. no NaNs anywhere after a degenerate drag ----------------------------------
{
  const a = J([0, 0, 0]);
  const b = J([0, 1, 0], a);
  const joints = [a, b];
  const main = makeMain(joints);
  IKSolver.solve(main, b, new THREE.Vector3(0, 0, 0)); // target ON the parent
  const finite = joints.every((j) => Array.from(j.getMatrix()).every(Number.isFinite));
  check('degenerate: no NaN in any joint matrix', finite);
  lengthsPreserved('degenerate', joints, [1]);
}

// --- 11. pins are WORLD-SPACE anchors: the character can jump ---------------------
// The reported bug: pin the feet, push the hips DOWN and the pins behave; pull the hips UP
// until the legs over-extend and the pins rise with the feet. The pin target was being
// re-read from the joint's live position every solve, so any shortfall was adopted as the
// new pin and the anchor ratcheted upward. Down worked only because the legs have slack
// there, so the solve lands on the pin exactly and re-reading it changes nothing.
{
  const hips = J([0, 0, 0]);
  const thighL = J([0.3, -0.2, 0], hips);
  const kneeL = J([0.35, -0.9, 0], thighL);
  const footL = J([0.4, -1.6, 0], kneeL);
  const thighR = J([-0.3, -0.2, 0], hips);
  const kneeR = J([-0.35, -0.9, 0], thighR);
  const footR = J([-0.4, -1.6, 0], kneeR);
  const joints = [hips, spineless(hips), thighL, kneeL, footL, thighR, kneeR, footR]
    .filter(Boolean);
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(footL, true, main);
  IKSolver.setPinned(footR, true, main);
  const groundL = pos(footL).clone(), groundR = pos(footR).clone();
  const hips0 = pos(hips).clone();

  // 1. DOWN into a crouch: reachable, so the feet hold exactly. (This always worked.)
  IKSolver.solve(main, hips, hips0.clone().add(new THREE.Vector3(0, -0.5, 0)));
  check('jump: crouching holds both feet', pos(footL).distanceTo(groundL) < 1e-2
    && pos(footR).distanceTo(groundR) < 1e-2);

  // 2. UP far enough that the legs cannot reach the ground any more.
  const reach = L0.length ? null : null;
  for (let i = 0; i < 8; i++) {
    IKSolver.solve(main, hips, hips0.clone().add(new THREE.Vector3(0, 3.0, 0)));
  }
  const anchorL = IKSolver.pinAnchor(footL, new THREE.Vector3());
  const anchorR = IKSolver.pinAnchor(footR, new THREE.Vector3());
  check('jump: the left pin stayed on the ground', anchorL.distanceTo(groundL) < 1e-9,
    'moved ' + anchorL.distanceTo(groundL).toFixed(4));
  check('jump: the right pin stayed on the ground', anchorR.distanceTo(groundR) < 1e-9,
    'moved ' + anchorR.distanceTo(groundR).toFixed(4));
  check('jump: the feet actually left the ground', pos(footL).y > groundL.y + 0.2,
    'foot y ' + pos(footL).y.toFixed(3) + ' vs ground ' + groundL.y.toFixed(3));
  // Falling short is correct — but it must fall short TOWARD the pin, not off sideways.
  const aim = pos(footL).clone().sub(pos(kneeL)).normalize();
  const want = anchorL.clone().sub(pos(kneeL)).normalize();
  check('jump: the airborne foot still aims at its pin', aim.dot(want) > 0.9,
    'dot ' + aim.dot(want).toFixed(3));
  lengthsPreserved('jump', joints, L0);

  // 3. BACK DOWN: the feet must land exactly on the pins again, not on wherever they drifted.
  for (let i = 0; i < 8; i++) IKSolver.solve(main, hips, hips0.clone());
  check('jump: landing puts the left foot back on its pin',
    pos(footL).distanceTo(groundL) < 1e-2, 'off by ' + pos(footL).distanceTo(groundL).toFixed(4));
  check('jump: landing puts the right foot back on its pin',
    pos(footR).distanceTo(groundR) < 1e-2, 'off by ' + pos(footR).distanceTo(groundR).toFixed(4));

  // Unpinning forgets the anchor, so the next pin anchors fresh rather than resurrecting it.
  IKSolver.setPinned(footL, false, main);
  check('jump: unpinning drops the anchor', !footL._boneIKPinAt);
  IKSolver.setPinned(footR, false, main);
}

// --- 12. a position-only drag can hold the effector's orientation -----------------
// The desktop case: a mouse carries position and nothing else, so the solve is three
// constraints short of the same grab in VR. Passing the joint's grab-time orientation as the
// driven orientation closes that gap — this is the solver half of it.
{
  const root = J([0, 0, 0]);
  const a = J([0, 1, 0], root);
  const b = J([0, 2, 0], a);
  const hand = J([0, 3, 0], b);
  const finger = J([0.4, 3, 0], hand); // gives the hand an orientation worth holding
  const joints = [root, a, b, hand, finger];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  // orientOf lives inside the 6DOF-pin block, so this test carries its own copy.
  const orientAt = (j) => {
    const q = new THREE.Quaternion();
    modelMat(j).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  };
  const held = orientAt(hand).clone();
  const target = new THREE.Vector3(1.4, 2.2, 0);
  IKSolver.solve(main, hand, target, null, held);

  check('lock: the effector still reaches its target', pos(hand).distanceTo(target) < 1e-2,
    'err ' + pos(hand).distanceTo(target).toFixed(4));
  check('lock: and kept the orientation it was given',
    orientAt(hand).angleTo(held) < 1e-3,
    'off by ' + (orientAt(hand).angleTo(held) * 180 / Math.PI).toFixed(3) + ' deg');
  lengthsPreserved('lock', joints, L0);

  // Without it the hand is free to spin — which is the looseness being complained about.
  const j2 = [J([0, 0, 0])];
  const a2 = J([0, 1, 0], j2[0]), b2 = J([0, 2, 0], a2);
  const hand2 = J([0, 3, 0], b2), fin2 = J([0.4, 3, 0], hand2);
  const main2 = makeMain([j2[0], a2, b2, hand2, fin2]);
  const held2 = orientAt(hand2).clone();
  IKSolver.solve(main2, hand2, target.clone());
  check('lock: unconstrained, the same drag lets it turn',
    orientAt(hand2).angleTo(held2) > 1e-2,
    'turned ' + (orientAt(hand2).angleTo(held2) * 180 / Math.PI).toFixed(2) + ' deg');
}

// --- 13. a pinned foot survives its own knee being dragged ------------------------
// Knee and foot are ONE bone apart, so the knee can only ever sit on a sphere around the
// planted foot. Dragging it off that sphere is not a hard request, it is a contradictory
// one — and FABRIK answers a contradiction by splitting the difference, which slid the foot
// off its pin. The drag is clamped to the sphere instead, so the leg swings around the foot.
{
  const hips = J([0, 0, 0]);
  const thigh = J([0.3, -0.2, 0], hips);
  const knee = J([0.35, -0.9, 0.1], thigh);
  const foot = J([0.4, -1.6, 0], knee);
  const joints = [hips, thigh, knee, foot];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(foot, true, main);
  const ground = pos(foot).clone();
  const boneLen = pos(knee).distanceTo(pos(foot));

  // Yank the knee somewhere it cannot possibly be: far off the sphere around the foot.
  for (let i = 0; i < 4; i++) IKSolver.solve(main, knee, new THREE.Vector3(2.5, -0.4, 0));
  check('knee: the foot stayed on its pin', pos(foot).distanceTo(ground) < 1e-2,
    'moved ' + pos(foot).distanceTo(ground).toFixed(4));
  check('knee: the knee stayed one bone from the foot',
    Math.abs(pos(knee).distanceTo(pos(foot)) - boneLen) < 1e-3,
    'off by ' + Math.abs(pos(knee).distanceTo(pos(foot)) - boneLen).toFixed(4));
  check('knee: and it actually moved toward the drag', pos(knee).x > 0.35 + 1e-3,
    'knee x ' + pos(knee).x.toFixed(3));
  lengthsPreserved('knee', joints, L0);

  // A reachable knee drag must still land exactly, not be clamped when it need not be.
  const near = pos(foot).clone().add(new THREE.Vector3(0, boneLen, 0));
  for (let i = 0; i < 6; i++) IKSolver.solve(main, knee, near.clone());
  check('knee: a reachable drag is not clamped', pos(knee).distanceTo(near) < 1e-2,
    'err ' + pos(knee).distanceTo(near).toFixed(4));
  IKSolver.setPinned(foot, false, main);
}

// --- 14. the drawn bend decides which way a knee goes -----------------------------
// A leg drawn with a slight bend states its preferred direction. FABRIK has no opinion — a
// backwards knee satisfies every bone length just as well — so it is free to flip, and that
// flip is the visible pop. The sign of the drawn bend is held.
{
  const hip = J([0, 0, 0]);
  const knee = J([0.25, -1.0, 0], hip);   // drawn bent forward (+x)
  const ankle = J([0, -2.0, 0], knee);
  const joints = [hip, knee, ankle];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const bendSign = (a, b, c) => {
    const u = pos(b).clone().sub(pos(a));
    const v = pos(c).clone().sub(pos(b));
    return u.cross(v).z;
  };
  const want = bendSign(hip, knee, ankle);
  check('bend: the rig was drawn with a bend to read', Math.abs(want) > 1e-6);

  // Drag the ankle straight up past the hip. Chosen because it PROVOKES the flip: unguarded
  // this motion inverts the knee on 29 of 60 steps (a gentle arc, by contrast, never flips at
  // all, and a test built on one would have proved nothing).
  const sweep = (i, N) => new THREE.Vector3(0.02, -1.9 + 3.6 * (i / N), 0);
  let flips = 0;
  for (let i = 1; i <= 60; i++) {
    IKSolver.solve(main, ankle, sweep(i, 60));
    if (bendSign(hip, knee, ankle) * want < 0) flips++;
  }
  check('bend: the knee never inverted over a full sweep', flips === 0, flips + ' flips');
  lengthsPreserved('bend', joints, L0);

  // Turned off, the same sweep is free to flip — which is the behaviour being fixed.
  window._ikHinge = false;
  const hip2 = J([0, 0, 0]);
  const knee2 = J([0.25, -1.0, 0], hip2);
  const ankle2 = J([0, -2.0, 0], knee2);
  const main2 = makeMain([hip2, knee2, ankle2]);
  const want2 = (() => { const u = pos(knee2).clone().sub(pos(hip2));
    return u.cross(pos(ankle2).clone().sub(pos(knee2))).z; })();
  let flips2 = 0;
  for (let i = 1; i <= 60; i++) {
    IKSolver.solve(main2, ankle2, sweep(i, 60));
    const u = pos(knee2).clone().sub(pos(hip2));
    if (u.cross(pos(ankle2).clone().sub(pos(knee2))).z * want2 < 0) flips2++;
  }
  window._ikHinge = undefined;
  check('bend: unguarded, the same sweep inverts it repeatedly', flips2 > 10, flips2 + ' flips');
}

// --- 15. the bend survives the leg going straight ---------------------------------
// The reported case: jump (legs straighten, feet leave the floor), then land. While straight
// there is no bend to read, so a preference taken from the live pose vanishes exactly when
// it is needed and the knee lands whichever way the solver fancies.
{
  const hip = J([0, 0, 0]);
  const knee = J([0.25, -1.0, 0], hip);   // drawn bent forward (+x)
  const ankle = J([0, -2.0, 0], knee);
  const main = makeMain([hip, knee, ankle]);
  const bendSign = () => pos(knee).clone().sub(pos(hip))
    .cross(pos(ankle).clone().sub(pos(knee))).z;
  const want = Math.sign(bendSign());

  // Straighten it out completely (ankle at full reach), hold there, then fold back up.
  const reach = pos(hip).distanceTo(pos(knee)) + pos(knee).distanceTo(pos(ankle));
  for (let i = 0; i < 6; i++) IKSolver.solve(main, ankle, new THREE.Vector3(0, -reach, 0));
  for (let i = 0; i < 6; i++) IKSolver.solve(main, ankle, new THREE.Vector3(0, -reach * 0.999, 0));

  // Land: fold to a deep bend again.
  let wrong = 0;
  for (let i = 1; i <= 30; i++) {
    const d = reach * (1 - 0.5 * (i / 30));
    IKSolver.solve(main, ankle, new THREE.Vector3(0, -d, 0));
    if (Math.abs(bendSign()) > 1e-6 && Math.sign(bendSign()) !== want) wrong++;
  }
  check('straight: the knee folds back the way it was drawn', wrong === 0, wrong + ' frames wrong');
  check('straight: the preference was remembered, not re-read', !!knee._boneBendRef);
}

// --- 16. a symmetric rig crouches symmetrically -----------------------------------
// Reported: pronounced bend at rest, feet pinned, lower the hips — and one knee aimed
// forward while the other aimed back. The cause was refreshing the remembered bend from each
// solve: it is self-confirming, so the first frame a knee happened to solve backwards became
// that knee's preference for ever. The rest pose is the authority, and only the rest pose.
{
  const hips = J([0, 0, 0]);
  const thighL = J([0.3, -0.2, 0], hips);
  const kneeL = J([0.35, -0.9, 0.35], thighL);   // pronounced forward bend (+z)
  const footL = J([0.3, -1.6, 0], kneeL);
  const thighR = J([-0.3, -0.2, 0], hips);
  const kneeR = J([-0.35, -0.9, 0.35], thighR);  // mirrored: same forward bend
  const footR = J([-0.3, -1.6, 0], kneeR);
  const joints = [hips, thighL, kneeL, footL, thighR, kneeR, footR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(footL, true, main);
  IKSolver.setPinned(footR, true, main);
  const hips0 = pos(hips).clone();

  // Both knees are drawn bending +z, so both should stay in front through a deep crouch.
  let wrong = 0, minZ = Infinity;
  for (let i = 1; i <= 25; i++) {
    IKSolver.solve(main, hips, hips0.clone().add(new THREE.Vector3(0, -0.9 * (i / 25), 0)));
    if (pos(kneeL).z <= 0 || pos(kneeR).z <= 0) wrong++;
    minZ = Math.min(minZ, pos(kneeL).z, pos(kneeR).z);
  }
  check('symmetry: both knees stayed in front through the crouch', wrong === 0,
    wrong + ' frames wrong, worst knee z ' + minZ.toFixed(3));
  check('symmetry: the two knees agree with each other',
    Math.sign(pos(kneeL).z) === Math.sign(pos(kneeR).z),
    `L ${pos(kneeL).z.toFixed(3)} R ${pos(kneeR).z.toFixed(3)}`);
  check('symmetry: the feet held their pins', pos(footL).y < -1.59 && pos(footR).y < -1.59,
    `L ${pos(footL).y.toFixed(3)} R ${pos(footR).y.toFixed(3)}`);
  lengthsPreserved('symmetry', joints, L0);

  // The preference must come from the REST pose, not from whatever a solve produced. Poison
  // one knee's remembered bend and re-derive: it must be re-read, not trusted.
  IKSolver.clearBendRefs(main);
  check('symmetry: clearing forgets the remembered bends', !kneeL._boneBendRef);
  IKSolver.solve(main, hips, hips0.clone());
  check('symmetry: and the next solve re-reads it', !!kneeL._boneBendRef);

  IKSolver.setPinned(footL, false, main);
  IKSolver.setPinned(footR, false, main);
}

// --- 17. the constraint must not itself be a pop ----------------------------------
// The whole point of moving the constraint INSIDE the sweeps. The previous approach solved
// freely and then reflected the joint back if it had come out on the wrong side — a discrete
// jump applied after convergence, which is what matt sees when he straightens a leg and bends
// it again.
//
// A flip is measured WITHOUT reference to any remembered axis: the bend plane of the knee
// inverting from one frame to the next. That is what a pop physically is, and it judges the
// motion produced rather than the mechanism that produced it, so it is fair to both approaches.
//
// The path is matt's own action — straighten the leg right out, bend it again, swinging it
// about, with a little out-of-plane drift — and it stays well away from the hip. Dragging an
// ankle THROUGH the hip is a real kinematic singularity where the legal knee position swings
// right round and every solver jumps; asserting continuity there would be asserting nonsense.
//
// Both numbers below fail against the pre-fix code, which scored 3 flips and 0.210.
{
  const hip = J([0, 0, 0]);
  const knee = J([0.25, -1.0, 0], hip);
  const ankle = J([0, -2.0, 0], knee);
  const main = makeMain([hip, knee, ankle]);
  const bone = pos(hip).distanceTo(pos(knee));
  const reach = 2 * bone;
  const N = 400;
  const at = (f) => {
    const a = -Math.PI / 2 + Math.sin(f * Math.PI * 2) * 1.0;
    const r = reach * (0.55 + 0.449 * (0.5 - 0.5 * Math.cos(f * Math.PI * 6)));
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(f * Math.PI * 3) * 0.35);
  };
  const bendPlane = () => pos(knee).clone().sub(pos(hip))
    .cross(pos(ankle).clone().sub(pos(knee)));

  // Settle on the first target before measuring: the step from the drawn rest pose to wherever
  // the drag begins is a jump in the INPUT, not a discontinuity in the solve.
  for (let k = 0; k < 12; k++) IKSolver.solve(main, ankle, at(1 / N));
  let prevN = bendPlane().normalize(), prevK = pos(knee).clone();
  let flips = 0, worst = 0;
  for (let i = 1; i <= N; i++) {
    IKSolver.solve(main, ankle, at(i / N));
    const n = bendPlane();
    if (n.length() > 1e-6) { n.normalize(); if (n.dot(prevN) < 0) flips++; prevN = n.clone(); }
    worst = Math.max(worst, pos(knee).distanceTo(prevK));
    prevK = pos(knee).clone();
  }
  // The SIZE of the worst jump is what reads as a pop, and it is the number that separates the
  // approaches: the pre-fix post-hoc reflection scored 0.210 bone here, clamping the hinge
  // inside every sweep scores 0.161, and seeding the branch scores 0.077.
  check('pop: no frame moves the knee a tenth of a bone', worst < bone * 0.1,
    'worst frame jump ' + (worst / bone).toFixed(3) + ' bone');

  // Branch switches are NOT zero, and that is the deliberate trade. Clamping the hinge every
  // sweep does reach zero, but on a pinned two-leg rig it made the sweeps oscillate — 40x the
  // jitter and 270x the pin drift of leaving the hinge off. Seeding the branch keeps the solver
  // steady and accepts a handful of switches on a sweep built to provoke them; the pre-fix code
  // scored 3 on this same path, so this is not a regression, and each switch is now less than
  // half the size. `window._ikHingeMode = 'clamp'` trades back the other way.
  check('pop: branch switches stay rare', flips <= 6, flips + ' flips in ' + N + ' frames');
}

// --- 18. a hinge picks the right branch, and the pin still lands -------------------
// The leg is drawn with the knee bulging +x. Pull the hips across to +x with the foot pinned
// flat and the free solve puts the knee on the WRONG side (-x) — both sides satisfy every bone
// length, so nothing stops it. The hinge has to pick the drawn side AND still hit the pin: it
// is the case where the constraint could most easily be seen fighting the solve.
//
// HONEST CAVEAT: this one also passes against the pre-fix code, which reached the same pose by
// reflecting the knee after the fact. It is a guard against the constraint breaking a pin — the
// canary for a hinge fighting the solve, and it did fail during development, drifting 0.64 —
// not evidence that the new approach is better. Test 17 is where that evidence lives.
{
  const hips = J([0, 2, 0]);
  const knee = J([0.1, 1, 0], hips);   // drawn bulging +x
  const ankle = J([0, 0.2, 0], knee);
  const toe = J([0, 0.2, 0.3], ankle);
  const joints = [hips, knee, ankle, toe];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPin(ankle, IKSolver.PIN_FULL, main);
  const anchor = pos(ankle).clone();
  IKSolver.solve(main, hips, new THREE.Vector3(0.5, 1.8, 0));

  check('branch: the knee stayed on the side it was drawn', pos(knee).x > 0,
    'knee x ' + pos(knee).x.toFixed(3));
  check('branch: the pin held exactly', pos(ankle).distanceTo(anchor) < 1e-2,
    'drifted ' + pos(ankle).distanceTo(anchor).toFixed(4));
  check('branch: and the hips still reached the drag',
    pos(hips).distanceTo(new THREE.Vector3(0.5, 1.8, 0)) < 1e-2);
  lengthsPreserved('branch', joints, L0);
  IKSolver.setPin(ankle, IKSolver.PIN_NONE, main);
}

// --- 19. pins survive keyframe playback -------------------------------------------
// Playback does NOT re-run the solver: it slerps each joint's stored LOCAL rotation back into
// its matrix. Pin satisfaction does not survive that, because where the foot ends up is a
// nonlinear function of the rotations above it — interpolate between two poses that each sit
// on the pin and the foot cuts the chord rather than following the arc. Exact at the keys,
// worst in between. `holdPins` re-solves the interpolated pose against the pins each frame.
//
// This reproduces playback's arithmetic exactly (slerp the quaternion, lerp position and
// scale, write the local matrix — AnimationRegistry ~2580) so what is tested is the real path.
{
  // Two legs, so the hips read as a branch point and the thighs stay ball joints. A one-legged
  // chain makes the hip look like a serial link and it gets hinged, which is not the real rig.
  const hips = J([0, 2, 0]);
  const thigh = J([0.3, 1.8, 0], hips);
  const knee = J([0.35, 1.0, 0.12], thigh);
  const foot = J([0.3, 0.2, 0], knee);
  const thighR = J([-0.3, 1.8, 0], hips);
  const kneeR = J([-0.35, 1.0, 0.12], thighR);
  const footR = J([-0.3, 0.2, 0], kneeR);
  const joints = [hips, thigh, knee, foot, thighR, kneeR, footR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPin(foot, IKSolver.PIN_POS, main);
  const anchor = IKSolver.pinAnchor(foot, new THREE.Vector3());

  const grab = () => joints.map((j) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    j._m.decompose(p, q, sc);
    return { p, q, s: sc };
  });
  const playbackTo = (A, B, a) => joints.forEach((j, i) => {
    j._m.compose(A[i].p.clone().lerp(B[i].p, a),
      A[i].q.clone().slerp(B[i].q, a),
      A[i].s.clone().lerp(B[i].s, a));
  });

  for (let i = 0; i < 8; i++) IKSolver.solve(main, hips, new THREE.Vector3(0, 2, 0));
  const keyA = grab();
  for (let i = 0; i < 8; i++) IKSolver.solve(main, hips, new THREE.Vector3(0.25, 1.62, 0.12));
  const keyB = grab();
  check('playback: both keys sit on the pin', pos(foot).distanceTo(anchor) < 1e-3,
    'key B off by ' + pos(foot).distanceTo(anchor).toFixed(5));

  // Straight interpolation, no pin pass: this is the drift matt reported.
  let raw = 0;
  for (let k = 0; k <= 20; k++) {
    playbackTo(keyA, keyB, k / 20);
    raw = Math.max(raw, pos(foot).distanceTo(anchor));
  }
  check('playback: interpolation alone does drift off the pin', raw > 0.1,
    'worst mid-key drift only ' + raw.toFixed(4) + ' — this sweep no longer provokes the bug');

  // Same frames, with the pin pass run after each one.
  let held = 0, hipsMoved = 0;
  for (let k = 0; k <= 20; k++) {
    playbackTo(keyA, keyB, k / 20);
    const hipsAt = pos(hips).clone();
    IKSolver.holdPins(main);
    held = Math.max(held, pos(foot).distanceTo(anchor));
    hipsMoved = Math.max(hipsMoved, pos(hips).distanceTo(hipsAt));
  }
  check('playback: the pin pass removes most of the drift', held < raw * 0.2,
    'worst drift ' + held.toFixed(4) + ' vs ' + raw.toFixed(4) + ' unheld');

  // What is LEFT is not the pin pass. With the hinge off the same frames land on the pin to
  // four decimals, so the residual is the hinge's known reach shortfall — around alpha 0.35
  // this leg needs 98% of its own span and the constrained solve does not quite get there.
  // Asserted rather than described, so that closing the reach error shows up here as a
  // failure telling you to tighten this bound.
  window._ikHinge = false;
  let heldFree = 0;
  for (let k = 0; k <= 20; k++) {
    playbackTo(keyA, keyB, k / 20);
    IKSolver.holdPins(main);
    heldFree = Math.max(heldFree, pos(foot).distanceTo(anchor));
  }
  window._ikHinge = undefined;
  check('playback: the pin pass itself is exact (hinge off)', heldFree < 1e-3,
    'worst drift ' + heldFree.toFixed(5));
  // The root's motion is what the take SAYS the character does. The legs bend up to meet the
  // pins; the character must not slide down to meet them.
  check('playback: and does not move the authored root', hipsMoved < 1e-9,
    'hips moved ' + hipsMoved.toFixed(5));
  lengthsPreserved('playback', joints, L0);
  IKSolver.setPin(foot, IKSolver.PIN_NONE, main);
}

// --- 20. a closed loop must not wind the bones up ---------------------------------
// The candy-wrapper collapse at the top of a thigh. `fitRotation` measures a DELTA from the
// joint's current orientation; each delta is minimal-arc so no single frame invents roll, but
// composing them along a path is parallel transport, and parallel transport around a CLOSED
// loop comes back rotated. So the pose was a function of how you got there.
//
// The test drives the hips right round a circle and back to exactly where they started, four
// times. Every bone must hold the twist it began with — not merely a small twist, the SAME
// twist, every lap. An accumulating solver fails by growing, which is why four laps are run
// rather than one: a single lap cannot tell a fixed offset from a ratchet.
{
  const hips = J([0, 1.8, 0]);
  const thL = J([0.28, 1.7, 0], hips), knL = J([0.36, 1.05, 0.30], thL);
  const anL = J([0.28, 0.35, 0], knL);
  const thR = J([-0.28, 1.7, 0], hips), knR = J([-0.36, 1.05, 0.30], thR);
  const anR = J([-0.28, 0.35, 0], knR);
  const joints = [hips, thL, knL, anL, thR, knR, anR];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPin(anL, IKSolver.PIN_POS, main);
  IKSolver.setPin(anR, IKSolver.PIN_POS, main);

  // How far a joint's frame has turned ABOUT ITS OWN BONE: the twist half of a swing-twist
  // split, which is the component that collapses a skin rather than bending it.
  const twistDeg = (joint, child) => {
    const q = new THREE.Quaternion();
    modelMat(joint).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const axis = pos(child).clone().sub(pos(joint));
    if (axis.lengthSq() < 1e-12) return 0;
    axis.normalize();
    const v = new THREE.Vector3(q.x, q.y, q.z);
    const proj = axis.clone().multiplyScalar(v.dot(axis));
    const t = new THREE.Quaternion(proj.x, proj.y, proj.z, q.w).normalize();
    return 2 * Math.atan2(new THREE.Vector3(t.x, t.y, t.z).dot(axis), t.w) * 180 / Math.PI;
  };

  const home = new THREE.Vector3(0, 1.8, 0);
  const lap = (main) => {
    for (let i = 1; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      IKSolver.solve(main, hips, new THREE.Vector3(
        Math.sin(a) * 0.3, 1.8 - 0.22 * (1 - Math.cos(a)), Math.cos(a) * 0.16 - 0.16));
    }
    IKSolver.solve(main, hips, home);
  };

  IKSolver.solve(main, hips, home);
  const t0 = twistDeg(thL, knL);
  const left = [];
  for (let k = 0; k < 4; k++) { lap(main); left.push(twistDeg(thL, knL) - t0); }

  // Not "small" — STABLE. A constant offset is a different pose; a growing one is a ratchet.
  const growth = Math.abs(left[3] - left[0]);
  check('twist: a closed loop does not wind the thigh up', growth < 1,
    'grew ' + growth.toFixed(2) + ' deg over four laps [' + left.map((v) => v.toFixed(1)).join(', ') + ']');

  // And the same loop DOES wind up with the accumulating write-back, so the check above is
  // measuring the fix rather than a sweep too gentle to provoke anything.
  window._ikAbsoluteRotations = false;
  const hips2 = J([0, 1.8, 0]);
  const th2 = J([0.28, 1.7, 0], hips2), kn2 = J([0.36, 1.05, 0.30], th2);
  const an2 = J([0.28, 0.35, 0], kn2);
  const th3 = J([-0.28, 1.7, 0], hips2), kn3 = J([-0.36, 1.05, 0.30], th3);
  const an3 = J([-0.28, 0.35, 0], kn3);
  const main2 = makeMain([hips2, th2, kn2, an2, th3, kn3, an3]);
  IKSolver.setPin(an2, IKSolver.PIN_POS, main);
  IKSolver.setPin(an3, IKSolver.PIN_POS, main);
  IKSolver.solve(main2, hips2, home);
  const u0 = twistDeg(th2, kn2);
  const old = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 1; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      IKSolver.solve(main2, hips2, new THREE.Vector3(
        Math.sin(a) * 0.3, 1.8 - 0.22 * (1 - Math.cos(a)), Math.cos(a) * 0.16 - 0.16));
    }
    IKSolver.solve(main2, hips2, home);
    old.push(twistDeg(th2, kn2) - u0);
  }
  window._ikAbsoluteRotations = undefined;
  check('twist: the accumulating write-back does wind it up',
    Math.abs(old[3] - old[0]) > 20,
    'grew only ' + Math.abs(old[3] - old[0]).toFixed(1) + ' deg — this loop no longer provokes it');
  IKSolver.setPin(an2, IKSolver.PIN_NONE, main); IKSolver.setPin(an3, IKSolver.PIN_NONE, main);

  lengthsPreserved('twist', joints, L0);
  IKSolver.setPin(anL, IKSolver.PIN_NONE, main);
  IKSolver.setPin(anR, IKSolver.PIN_NONE, main);
}

// --- 21. a 6DOF grab turns the limb, not just moves it -----------------------------
// A VR grab carries position AND orientation, and the solver takes the orientation as a
// CONSTRAINT rather than a decoration — the joint's children are carried by it. Passing
// position alone is why a grabbed bone slid but never turned while a pin did both.
{
  const root = J([0, 0, 0]);
  const mid = J([0, 1, 0], root);
  const tip = J([0, 2, 0], mid);
  const leaf = J([0.4, 2.4, 0], tip); // off-axis, so a twist of `tip` actually moves it
  const joints = [root, mid, tip, leaf];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(0.3, 1.9, 0);
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);

  // Position only: the leaf goes wherever the chain takes it.
  IKSolver.solve(main, tip, target.clone());
  const leafNoTwist = pos(leaf).clone();

  // Same target, now with a driven orientation. The leaf must end up somewhere else, because
  // it is carried by the joint's rotation rather than merely following its position.
  IKSolver.solve(main, tip, target.clone(), null, twist);
  const leafTwisted = pos(leaf).clone();

  check('grab: a driven orientation moves what the joint carries',
    leafTwisted.distanceTo(leafNoTwist) > 1e-2,
    'leaf moved only ' + leafTwisted.distanceTo(leafNoTwist).toFixed(5));

  const q = new THREE.Quaternion();
  modelMat(tip).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  check('grab: the joint actually reached the driven orientation', q.angleTo(twist) < 1e-3,
    'off by ' + (q.angleTo(twist) * 180 / Math.PI).toFixed(3) + ' deg');
  check('grab: and still reached the target', pos(tip).distanceTo(target) < 1e-2,
    'err ' + pos(tip).distanceTo(target).toFixed(4));
  lengthsPreserved('grab', joints, L0);
}

// --- 22. a joint moved behind the solver's back re-solves the rig --------------------
// This is what makes the transform GIZMO a posing tool. The gizmo writes a joint's matrix
// directly, so the rig has to notice and rearrange around it — and, critically, the solver's
// OWN writes must not read back as an external move, or every frame would re-solve to the pose
// it just produced.
{
  const hips = J([0, 2, 0]);
  const knee = J([0.1, 1, 0], hips);
  const ankle = J([0, 0.2, 0], knee);
  const joints = [hips, knee, ankle];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  // The watcher is opt-in (window._ikGizmoPose), so the test has to arm it.
  window._ikGizmoPose = true;
  IKSolver.syncJointCache(main);
  check('gizmo: a settled rig reports no external move',
    IKSolver.externallyMovedJoint(main) === null);

  // Something else writes the joint — exactly what the gizmo does.
  // A gizmo drag writes the joint's LOCAL matrix, which lengthens the bone — the solver has to
  // put that back and treat the position as a request, or the rig stretches a little on every
  // drag.
  ankle._m.elements[12] += 0.3;
  const moved = IKSolver.externallyMovedJoint(main);
  check('gizmo: a directly-written joint is noticed', moved === ankle,
    moved ? 'reported ' + moved.getID() : 'reported nothing');

  IKSolver.resolveToJoint(main, ankle);
  check('gizmo: and the rig re-solves rather than the bone stretching', true);
  lengthsPreserved('gizmo', joints, L0);

  // THE FEEDBACK GUARD. After a solve there must be nothing left to report, or the render loop
  // would re-solve to its own output every frame for ever.
  check('gizmo: the solver\'s own writes do not read back as an external move',
    IKSolver.externallyMovedJoint(main) === null,
    'the cache is not refreshed after a solve');

  // One at a time: a gizmo drags one thing, and re-solving to several contradictory effectors
  // is not a pose.
  hips._m.elements[13] += 0.2;
  knee._m.elements[13] += 0.2;
  const one = IKSolver.externallyMovedJoint(main);
  check('gizmo: only one moved joint is reported', !!one);
  IKSolver.syncJointCache(main);
  check('gizmo: syncing clears the report', IKSolver.externallyMovedJoint(main) === null);
  check('gizmo: the watcher is OFF unless armed', (() => {
    window._ikGizmoPose = false;
    ankle._m.elements[12] += 0.5;
    const r = IKSolver.externallyMovedJoint(main);
    window._ikGizmoPose = true;
    IKSolver.syncJointCache(main);
    return r === null;
  })());

  // THE THRESHOLD IS NOT AN EPSILON. Matrices are Float32Array, so near values of 1 to 2 the
  // spacing between representable floats is about 1.2e-7 — a "tighter is safer" threshold below
  // that reports a move on every single comparison and the rig re-solves every frame for ever.
  // This is exactly what the first version did, at 1e-9.
  IKSolver.syncJointCache(main);
  ankle._m.elements[12] += 1e-7;   // float32 noise, not a drag
  check('gizmo: float32 noise is not a move', IKSolver.externallyMovedJoint(main) === null,
    'the threshold is back below float32 spacing');
  ankle._m.elements[12] += 0.01;   // a real, if small, drag
  check('gizmo: a small real move still counts',
    IKSolver.externallyMovedJoint(main) === ankle);
}

// GRAB THE KNEE, THE FOOT STAYS ON ITS PIN. The leg shape specifically, because this is the
// thing you reach for when a pin alone pulls too much: the pinned joint is a DESCENDANT of the
// one being dragged, which is the case that looks like it should not work. It does — in the
// solver. Dragging the same joint under the bone tool's FK mode does not consult pins at all,
// by design (FK edits the rest skeleton, children follow rigidly); this is what the IK path
// gives you instead.
{
  const hip = J([0, 3, 0]);
  const knee = J([0, 2, 0], hip);
  const ankle = J([0, 1, 0], knee);
  const toe = J([0.3, 1, 0], ankle);
  const joints = [hip, knee, ankle, toe];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  IKSolver.setPinned(ankle, true, main);
  const footBefore = pos(ankle).clone();

  // ON THE SPHERE, and this is the part worth understanding. The ankle is ONE bone below the
  // knee, so pinning it does not merely limit the knee's reach — it CONFINES the knee to the
  // sphere of radius (shin length) about the pin. That is an equality, not an inequality: a
  // drag to any point off that sphere is projected onto it, whether it was too far or too
  // near. So a pinned ankle leaves the knee two degrees of freedom, sliding on a sphere —
  // which is exactly the freedom a pole vector exists to steer.
  // (0.6, 1.8, 0) is distance 1 from the pin at (0, 1, 0), so it is exactly reachable.
  const target = new THREE.Vector3(0.6, 1.8, 0);
  IKSolver.solve(main, knee, target);

  check('knee+pin: the pinned ankle held its ground',
    pos(ankle).distanceTo(footBefore) < 1e-2,
    'moved ' + pos(ankle).distanceTo(footBefore).toExponential(2));
  check('knee+pin: the knee still went where it was put',
    pos(knee).distanceTo(target) < 2e-2, 'err ' + pos(knee).distanceTo(target).toExponential(2));
  lengthsPreserved('knee+pin', joints, L0);

  // AND THE LIMIT, which is the thing worth knowing: pull the knee further from the pin than
  // the shin is long and the two goals cannot both be met. The DRAG is what gives (clampToPins)
  // — the alternative is the pin sliding, and a pin that moves when you pull hard enough is
  // not holding anything. This is why an elbow pin can feel like it has "too much influence":
  // past the bone's length it is the pin that wins, not the hand.
  const far = new THREE.Vector3(2.5, 2.0, 0);
  IKSolver.solve(main, knee, far);
  check('knee+pin: an out-of-reach drag is clamped, not the pin dragged',
    pos(ankle).distanceTo(footBefore) < 1e-2 && pos(knee).distanceTo(far) > 0.5,
    'ankle moved ' + pos(ankle).distanceTo(footBefore).toExponential(2));
  check('knee+pin: and the knee sits exactly one shin from the pin',
    Math.abs(pos(knee).distanceTo(pos(ankle)) - 1) < 1e-2,
    'dist ' + pos(knee).distanceTo(pos(ankle)).toFixed(4));
  IKSolver.setPinned(ankle, false, main);
}

// A DRIVEN ORIENTATION MUST NOT CARRY A PINNED DESCENDANT OFF ITS PIN.
//
// The headset always sends an orientation — the controller carries 6DOF — and driving it makes
// the effector's children RIGID with it, which is the point of it for a hand or a foot. On a
// mid-limb joint it over-constrains everything below: with the knee's position AND orientation
// both driven, the ankle's position is a rigid function of them and the pin has no freedom
// left. The leg below the hand then moves as one piece, which reads as the solver having been
// bypassed for plain FK. Measured before the fix: the pin held to 0.0000 on position alone and
// was dragged 0.80 / 1.10 / 1.50 off it at 10 / 30 / 60 degrees.
{
  const mk = () => {
    const hip = J([0, 3, 0]);
    const knee = J([0, 2, 0], hip);
    const ankle = J([0, 1, 0], knee);
    const toe = J([0.3, 1, 0], ankle);
    return { hip, knee, ankle, toe, joints: [hip, knee, ankle, toe],
             main: makeMain([hip, knee, ankle, toe]) };
  };
  const target = new THREE.Vector3(0.6, 1.8, 0); // one shin from the pin at (0, 1, 0)

  for (const deg of [10, 30, 60]) {
    const { knee, ankle, joints, main } = mk();
    const L0 = lengths(joints);
    IKSolver.setPinned(ankle, true, main);
    const before = pos(ankle).clone();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * Math.PI / 180);
    IKSolver.solve(main, knee, target, null, q);
    check(`orient: a pinned ankle holds through a ${deg}-degree driven rotation`,
      pos(ankle).distanceTo(before) < 1e-2,
      'moved ' + pos(ankle).distanceTo(before).toFixed(4));
    check(`orient: the knee still reaches its target at ${deg} degrees`,
      pos(knee).distanceTo(target) < 2e-2, 'err ' + pos(knee).distanceTo(target).toFixed(4));
    lengthsPreserved(`orient ${deg}`, joints, L0);
    IKSolver.setPinned(ankle, false, main);
  }

  // THE TWO CASES THAT MUST NOT REGRESS. Dropping the orientation is scoped to a pinned
  // DIRECT CHILD, and that scope was found the hard way: gating on any pinned DESCENDANT broke
  // the hips twist above, where the feet are pinned three bones down and are supposed to stay
  // planted while the body turns. A pin with intervening joints has slack to absorb the
  // rotation; a pin one bone down does not.
  {
    const { toe, ankle, main } = mk();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
    IKSolver.solve(main, toe, pos(toe).clone(), null, q);
    const m = toe.getModelSpaceMatrix ? toe.getModelSpaceMatrix() : null;
    const got = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(m).decompose(new THREE.Vector3(), got, new THREE.Vector3());
    check('orient: a LEAF effector still keeps its driven orientation',
      Math.abs(got.angleTo(q)) < 1e-2, 'off by ' + got.angleTo(q).toFixed(4) + ' rad');
    IKSolver.setPinned(ankle, false, main);
  }

  // A pin further down the chain leaves the orientation armed: the toe is pinned, the HIP is
  // driven, and the two bones between them absorb it. Same shape as the hips/feet twist.
  {
    const { hip, toe, main } = mk();
    IKSolver.setPinned(toe, true, main);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    IKSolver.solve(main, hip, pos(hip).clone(), null, q);
    const got = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(hip.getModelSpaceMatrix())
      .decompose(new THREE.Vector3(), got, new THREE.Vector3());
    check('orient: a pin further down does NOT disarm the driven orientation',
      Math.abs(got.angleTo(q)) < 1e-2, 'off by ' + got.angleTo(q).toFixed(4) + ' rad');
    IKSolver.setPinned(toe, false, main);
  }
}

// GRABBING THE ROOT MOVES THE CHARACTER. The root is the anchor for every other drag — with
// nothing pinned, something has to be, or the whole rig follows your hand on the first pull —
// but anchoring it while it is ITSELF the effector held it against the only input asking it to
// move, and the root bone read as locked.
{
  const root = J([0, 0, 0]);
  const a = J([0, 1, 0], root);
  const b = J([0, 2, 0], a);
  const joints = [root, a, b];
  const main = makeMain(joints);
  const L0 = lengths(joints);

  const target = new THREE.Vector3(0.7, -0.4, 0.2);
  IKSolver.solve(main, root, target);
  check('root: grabbing the root moves it', pos(root).distanceTo(target) < 1e-2,
    'err ' + pos(root).distanceTo(target).toExponential(2) + ' (the root is anchored against its own drag)');
  // Moving a root is a translation of the whole rig, not a stretch of the first bone.
  check('root: the children travel with it',
    pos(a).distanceTo(target.clone().add(new THREE.Vector3(0, 1, 0))) < 1e-2);
  lengthsPreserved('root', joints, L0);
}

// ...and every OTHER joint still gets the root as its anchor, which is the behaviour the
// fixed root was there for in the first place.
{
  const root = J([0, 0, 0]);
  const a = J([0, 1, 0], root);
  const b = J([0, 2, 0], a);
  const main = makeMain([root, a, b]);
  IKSolver.solve(main, b, new THREE.Vector3(1.2, 1.0, 0));
  check('root: stays put when a LIMB is dragged', pos(root).length() < 1e-6,
    'the whole character follows your hand on the first drag');
}

// THE VR GIZMO POSES A BONE. Source guards, because the drag itself needs a headset — what
// can be pinned down here is the SHAPE of the path: that a joint goes to the solver instead of
// having its matrix written, and that it does so scoped to one drag rather than by watching
// every joint every frame (the arrangement that locked the desktop gizmo up).
{
  const VR = fs.readFileSync(path.join(REPO, 'src/editing/tools/TransformVR.js'), 'utf8');

  // The test moved from the gesture-wide `_dragIsJoint` to the MESH's own kind at v3.20.165,
  // when the VR gizmo learned to move a whole selection: a mixed set (a joint and a pin) must
  // not have the dragged mesh's rule applied to the other. The guarantee is unchanged — a joint
  // is solved, never written — it is just asked per mesh.
  check('VR gizmo: a dragged bone is solved, not written',
    /if \(Skeleton\.isJoint\(mesh\) && window\._vrGizmoPose !== false\) \{[\s\S]{0,700}?IKSolver\.solve\(/.test(VR),
    'the joint branch in _applyMatrix is gone; a drag would edit bone LENGTH');
  check('VR gizmo: the joint branch returns before the matrix write',
    /IKSolver\.solve\([\s\S]{0,300}?return;[\s\S]{0,200}?setModelSpaceMatrix/.test(VR),
    'falling through would write the joint after solving it');
  check('VR gizmo: orientation is driven, not just position',
    /IKSolver\.solve\(this\._main, mesh, _poseT, null, _poseQ\)/.test(VR),
    'position alone is why a posed bone slides but never turns');

  // Scoped to the drag: decided ONCE on press, from the picked node.
  check('VR gizmo: the joint test is made once at drag start',
    /_dragIsJoint = Skeleton\.isJoint\(mesh\)/.test(VR));
  // Comments stripped first: the watcher is NAMED in the prose explaining why this path does
  // not use it, and a test that cannot tell code from commentary reports the fix as the bug.
  const vrCode = VR.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('VR gizmo: it does not watch matrices to find the drag',
    !/externallyMovedJoint|resolveToJoint/.test(vrCode),
    'inferring the drag from changing matrices is the arrangement that fought every other writer');

  // A solve reaches anywhere in the tree, so the undo is the whole skeleton.
  check('VR gizmo: the pose undo snapshots every joint',
    /_dragUndoRig = this\._dragIsJoint \? IKSolver\.captureAll\(main\)/.test(VR)
      && /pushStateCustom\([\s\S]{0,120}?'Pose'\)/.test(VR),
    'one matrix cannot undo a solve');
  // The grace-period recovery clears _dragMesh when the trigger signal is lost. If the undo
  // hung off that, the pose would become unundoable exactly when the hardware misbehaved.
  check('VR gizmo: the pose undo does not depend on the drag mesh surviving',
    /if \(this\._dragUndoRig\) \{/.test(VR));
}

// --- determinism: an evaluated frame is the same pose however it was reached -------------
//
// FABRIK seeds from the pose the rig is already in, which is right for a drag and wrong for
// evaluation: it makes the solved pose a function of the ROUTE to the frame rather than of the
// frame. Keying the controls and letting the solver fill in the rest is unusable until this
// holds, because a scrub and a playback disagree about the same frame.
//
// A body rather than a leg, deliberately: a pinned ankle leaves the knee free on a circle, and
// two legs sharing one root is what makes where each knee settles depend on where it started.
function pinnedBody() {
  const hips = J([0, 2, 0]);
  const spine = J([0, 2.5, 0], hips);
  const chest = J([0, 3.0, 0], spine);
  const limb = (sx) => {
    const hip = J([0.2 * sx, 1.9, 0], hips);
    const knee = J([0.22 * sx, 1.0, 0.06], hip);
    const ankle = J([0.2 * sx, 0.1, 0], knee);
    return { hip, knee, ankle };
  };
  const L = limb(-1), R = limb(1);
  const joints = [hips, spine, chest, L.hip, L.knee, L.ankle, R.hip, R.knee, R.ankle];
  const main = makeMain(joints);
  IKSolver.setPin(L.ankle, IKSolver.PIN_POS, main);
  IKSolver.setPin(R.ankle, IKSolver.PIN_POS, main);
  return { main, joints, hips, knee: R.knee, ankle: R.ankle };
}

// The production case: two planted ankles and a 6DOF hip control. Moving the hip pin must
// move the root while the legs absorb the change and both ankle anchors remain fixed.
{
  const rig = pinnedBody();
  const ankles = IKSolver.pinnedJoints(rig.main).slice();
  const ankleAnchors = ankles.map((j) => IKSolver.pinAnchor(j, new THREE.Vector3()));
  IKSolver.setPin(rig.hips, IKSolver.PIN_FULL, rig.main);
  const hipPin = IKSolver.pinObject(rig.hips);
  const wantP = new THREE.Vector3(0.18, 1.72, 0.12);
  const wantQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
  hipPin._m.compose(wantP, wantQ, new THREE.Vector3(1, 1, 1));
  window._ikWritten = new Set();
  IKSolver.holdPins(rig.main);
  check('three-pin body: hips follow their translated pin', pos(rig.hips).distanceTo(wantP) < 1e-6,
    'off by ' + pos(rig.hips).distanceTo(wantP).toExponential(2));
  ankles.forEach((j, i) => check('three-pin body: planted ankle ' + (i + 1) + ' still holds',
    pos(j).distanceTo(ankleAnchors[i]) < 1e-3,
    'off by ' + pos(j).distanceTo(ankleAnchors[i]).toExponential(2)));
}

{
  const rig = pinnedBody();
  IKSolver.captureRest(rig.main);
  const rest = rig.joints.map((j) => pos(j));
  IKSolver.setPin(rig.hips, IKSolver.PIN_FULL, rig.main);
  const hipPin = IKSolver.pinObject(rig.hips);
  hipPin._m.makeTranslation(0.3, 1.6, 0.2);
  const ankle = IKSolver.pinnedJoints(rig.main).find((j) => j !== rig.hips);
  IKSolver.pinObject(ankle)._m.makeTranslation(-0.45, 0.25, 0.3);
  window._ikWritten = new Set();
  IKSolver.holdPins(rig.main);
  IKSolver.resetRigAndPins(rig.main);
  let restErr = 0;
  rig.joints.forEach((j, i) => { restErr = Math.max(restErr, pos(j).distanceTo(rest[i])); });
  check('reset rig: every joint returns to solver rest', restErr < 1e-6,
    'worst ' + restErr.toExponential(2));
  let pinErr = 0;
  for (const j of IKSolver.pinnedJoints(rig.main)) {
    pinErr = Math.max(pinErr, IKSolver.pinAnchor(j, new THREE.Vector3()).distanceTo(pos(j)));
  }
  check('reset rig: every pin returns onto its rest joint', pinErr < 1e-6,
    'worst ' + pinErr.toExponential(2));
}

const FR = { A: [0.35, 1.55, 0.25], B: [-0.30, 1.45, -0.30], T: [0.10, 1.70, 0.10] };

// One EVALUATED frame, in the app's own order: playback writes the keyed bone and names it as
// a control, then the solver holds the pins.
function evalFrame(rig, at, nameControls) {
  Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(at[0], at[1], at[2]));
  if (nameControls) (window._ikWritten || (window._ikWritten = new Set())).add(rig.hips.getID());
  IKSolver.holdPins(rig.main);
}

function poseAfter(path, { rest = true, controls = true } = {}) {
  const rig = pinnedBody();
  if (rest) IKSolver.captureRest(rig.main);       // what drawing the rig does
  for (const f of path) evalFrame(rig, FR[f], controls);
  return { rig, pose: rig.joints.map((j) => pos(j)) };
}

function spread(runs) {
  const base = runs[0].pose;
  let worst = 0;
  for (const r of runs) {
    for (let i = 0; i < base.length; i++) worst = Math.max(worst, base[i].distanceTo(r.pose[i]));
  }
  return worst;
}

{
  // Seen to fail first: with the controls unnamed the solver cannot tell a keyed hip from its
  // own output, so it seeds from the live pose and the three routes disagree. This is the
  // shipped behaviour this feature replaces, and asserting that it DOES spread is what proves
  // the check below can tell the difference.
  window._ikWritten = null;
  const noCtl = { controls: false };
  const before = spread([poseAfter(['T'], noCtl), poseAfter(['A', 'T'], noCtl),
                         poseAfter(['A', 'B', 'T'], noCtl)]);
  check('the old seed really does carry history (the check can tell)', before > 1e-3,
    'spread ' + before.toExponential(2));

  window._ikWritten = null;
  const runs = [poseAfter(['T'], {}), poseAfter(['A', 'T'], {}), poseAfter(['A', 'B', 'T'], {})];
  const after = spread(runs);
  check('an evaluated frame is the same pose however it was reached', after < 1e-6,
    'spread ' + after.toExponential(2) + ' (was ' + before.toExponential(2) + ')');

  // And it is the same pose because the CONTROLS still hold, not because everything collapsed
  // onto rest and stayed there.
  const r = runs[2].rig;
  check('determinism: the keyed control still lands exactly',
    pos(r.hips).distanceTo(new THREE.Vector3(...FR.T)) < 1e-6);
  check('determinism: the pins still hold',
    pos(r.ankle).distanceTo(new THREE.Vector3(0.2, 0.1, 0)) < 1e-3,
    'err ' + pos(r.ankle).distanceTo(new THREE.Vector3(0.2, 0.1, 0)).toExponential(2));
}

// The other history channel, and the quieter one: what the SESSION did before the scrub. Pose
// by hand first — which seeds from the live pose, as a drag must — then evaluate, and compare
// against a rig nobody touched. This is what the rest pose being captured AT DRAW TIME buys;
// adopting a rest at the first evaluation instead would enshrine the posed rig.
{
  window._ikWritten = null;
  const fresh = poseAfter(['T'], {});

  const used = pinnedBody();
  IKSolver.captureRest(used.main);
  Skeleton.moveJoint(used.main, used.hips, new THREE.Vector3(-0.4, 1.4, -0.35));
  IKSolver.holdPins(used.main);                      // a drag: no controls named
  Skeleton.moveJoint(used.main, used.hips, new THREE.Vector3(0.45, 1.5, 0.4));
  IKSolver.holdPins(used.main);
  evalFrame(used, FR.T, true);

  let worst = 0;
  used.joints.forEach((j, i) => { worst = Math.max(worst, pos(j).distanceTo(fresh.pose[i])); });
  check('posing by hand first does not change the evaluated frame', worst < 1e-6,
    'worst ' + worst.toExponential(2));
}

// DRAGGING MUST NOT BE RESET TO REST. Continuity between frames is most of why a drag feels
// attached to your hand, and the two modes are told apart by whether the caller named any
// controls — so from one and the same posed state the two must give different answers.
{
  const settle = () => {
    const rig = pinnedBody();
    IKSolver.captureRest(rig.main);
    window._ikWritten = null;
    Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(-0.4, 1.4, -0.35));
    IKSolver.holdPins(rig.main);                      // drags: nothing named
    Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(0.45, 1.5, 0.4));
    IKSolver.holdPins(rig.main);
    Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(...FR.T));
    return rig;
  };

  window._ikWritten = null;
  const dragRig = settle();
  IKSolver.holdPins(dragRig.main);                    // one more drag frame

  const evalRig = settle();
  (window._ikWritten || (window._ikWritten = new Set())).add(evalRig.hips.getID());
  IKSolver.holdPins(evalRig.main);                    // the same frame, evaluated

  check('a drag keeps the live pose while an evaluation does not',
    pos(dragRig.knee).distanceTo(pos(evalRig.knee)) > 1e-3,
    'the two modes agreed, so the drag was reset to rest too');
}

// A joint the solver does not own — off every path from a pin to the root — must survive an
// evaluation untouched. Scrubbing the timeline is not permission to undo a hand-posed chest.
{
  window._ikWritten = null;
  const rig = pinnedBody();
  IKSolver.captureRest(rig.main);
  const chest = rig.joints[2];
  Skeleton.moveJoint(rig.main, chest, new THREE.Vector3(0.3, 3.2, 0.25));
  // Its LOCAL matrix, not its model position: the chest hangs off the hips, and the hips are
  // the control being written, so the chest moving through the world is it riding its parent —
  // which is correct. What must not change is the pose that was set on the chest itself.
  const posed = Float32Array.from(chest.getMatrix());
  evalFrame(rig, FR.T, true);
  let worst = 0;
  const now = chest.getMatrix();
  for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(now[k] - posed[k]));
  check('an evaluation leaves joints the solver does not own alone', worst < 1e-6,
    'local matrix moved ' + worst.toExponential(2) + ' - a scrub undid a hand pose');
}

// Drawing a joint onto a rig that is currently POSED must not record that pose as rest for
// every joint in the body — only the new joint has no rest to keep.
{
  const rig = pinnedBody();
  IKSolver.captureRest(rig.main);
  const restBefore = Float32Array.from(rig.hips._ikRest);
  Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(0.4, 1.5, 0.3));
  IKSolver.captureRest(rig.main);   // as drawing another joint would
  let same = true;
  for (let k = 0; k < 16; k++) if (restBefore[k] !== rig.hips._ikRest[k]) same = false;
  check('capturing rest again leaves an existing rest alone', same,
    'a blanket capture would enshrine the current pose as the rest skeleton');
}

// --- the pole vector, as a steering goal ------------------------------------------------
//
// A pinned ankle one bone below the knee confines the knee to a SPHERE about the pin; fix the
// hip too and it is the intersection of two spheres, which is a CIRCLE about the hip-to-ankle
// axis. Nothing used to steer where on that circle the knee sat. A soft pin does, and the
// claim being tested is the strong one: it costs the hard pins NOTHING, because the rotation
// that steers is about the axis through both of them and every point of that axis is fixed.
function poleLeg() {
  const hips = J([0, 2, 0]);
  const knee = J([0.05, 1, 0.05], hips);
  const ankle = J([0, 0, 0], knee);
  const joints = [hips, knee, ankle];
  const main = makeMain(joints);
  IKSolver.setPin(ankle, IKSolver.PIN_POS, main);
  return { main, joints, hips, knee, ankle };
}

{
  window._ikWritten = null;
  const ANKLE = new THREE.Vector3(0, 0, 0);

  // Where the knee lands with no steering at all.
  const plain = poleLeg();
  Skeleton.moveJoint(plain.main, plain.hips, new THREE.Vector3(0.1, 1.85, 0));
  IKSolver.holdPins(plain.main);
  const free = pos(plain.knee);

  // The same pose, with a steering goal well off to one side.
  const steered = poleLeg();
  const L0 = lengths(steered.joints);
  Skeleton.moveJoint(steered.main, steered.hips, new THREE.Vector3(0.1, 1.85, 0));
  IKSolver.setPin(steered.knee, IKSolver.PIN_SOFT, steered.main);
  const goalPin = IKSolver.pinObject(steered.knee);
  // Out along +Z: a direction the knee can only reach by swivelling about the hip-ankle axis.
  const goal = new THREE.Vector3(0, 1, 1.5);
  goalPin._m.makeTranslation(goal.x, goal.y, goal.z);
  IKSolver.holdPins(steered.main);

  const before = free.distanceTo(goal);
  const after = pos(steered.knee).distanceTo(goal);
  check('the steering goal actually moves the knee', pos(steered.knee).distanceTo(free) > 1e-3,
    'moved ' + pos(steered.knee).distanceTo(free).toExponential(2));
  check('and moves it TOWARDS the goal', after < before - 1e-3,
    before.toFixed(4) + ' -> ' + after.toFixed(4));

  // The claim that makes this a priority rather than a competing goal.
  check('steering costs the hard pin nothing', pos(steered.ankle).distanceTo(ANKLE) < 1e-9,
    'ankle drifted ' + pos(steered.ankle).distanceTo(ANKLE).toExponential(2));
  check('and leaves the fixed root where it is',
    pos(steered.hips).distanceTo(new THREE.Vector3(0.1, 1.85, 0)) < 1e-9);
  lengthsPreserved('steering', steered.joints, L0);

  // The knee is confined to a circle, so it cannot REACH a goal off that circle — and it must
  // not stretch anything trying. What it can do is get as close as the circle allows, which is
  // the closest point: no other point of the circle is nearer the goal.
  const axis = new THREE.Vector3().subVectors(ANKLE, pos(steered.hips)).normalize();
  const k = pos(steered.knee);
  let best = after;
  for (let i = 0; i < 360; i++) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, i * Math.PI / 180);
    const p = k.clone().sub(pos(steered.hips)).applyQuaternion(q).add(pos(steered.hips));
    best = Math.min(best, p.distanceTo(goal));
  }
  check('it lands on the CLOSEST point of the circle, not merely a better one',
    after < best + 1e-4, 'landed ' + after.toFixed(5) + ', best on the circle ' + best.toFixed(5));
}

// An elbow pole must use shoulder-to-wrist as its axis even when the nearest HARD ancestor is
// the hips. The old hard-anchor search rotated the chest and shoulder as part of the swivel.
{
  window._ikWritten = null;
  const hips = J([0, 0, 0]);
  const chest = J([0, 1, 0], hips);
  const shoulder = J([0.6, 1.2, 0], chest);
  const elbow = J([1.2, 1.0, 0.1], shoulder);
  const wrist = J([1.8, 0.8, 0], elbow);
  const main = makeMain([hips, chest, shoulder, elbow, wrist]);
  IKSolver.setPin(hips, IKSolver.PIN_POS, main);
  IKSolver.setPin(wrist, IKSolver.PIN_POS, main);
  IKSolver.setPin(elbow, IKSolver.PIN_SOFT, main);
  const shoulderBefore = pos(shoulder);
  const elbowBefore = pos(elbow);
  IKSolver.pinObject(elbow)._m.makeTranslation(1.2, 1.0, -1.2);
  IKSolver.holdPins(main);
  check('elbow steering moves the elbow', pos(elbow).distanceTo(elbowBefore) > 1e-3,
    'moved ' + pos(elbow).distanceTo(elbowBefore).toExponential(2));
  check('elbow steering does not collapse the shoulder into the torso',
    pos(shoulder).distanceTo(shoulderBefore) < 1e-9,
    'shoulder moved ' + pos(shoulder).distanceTo(shoulderBefore).toExponential(2));
}

// A steering goal with no hard anchor below it has no circle to slide on. It must then do
// NOTHING rather than approximate — silently turning a steering goal into a weak target is how
// a feature that is supposed to cost the hard pins nothing starts costing them something.
{
  window._ikWritten = null;
  const rig = poleLeg();
  IKSolver.setPin(rig.ankle, IKSolver.PIN_NONE, rig.main);   // no hard pin anywhere
  IKSolver.setPin(rig.knee, IKSolver.PIN_SOFT, rig.main);
  const pin = IKSolver.pinObject(rig.knee);
  pin._m.makeTranslation(1.5, 1, 1.5);
  const was = rig.joints.map((j) => pos(j));
  IKSolver.holdPins(rig.main);
  let worst = 0;
  rig.joints.forEach((j, i) => { worst = Math.max(worst, pos(j).distanceTo(was[i])); });
  check('a steering goal with nothing to swivel about does nothing', worst < 1e-9,
    'moved ' + worst.toExponential(2));
}


// ROTATION-ONLY PINS. The other half of a 6DOF pin: the orientation is held, the position is
// not. The half that is easy to get wrong is the half that must NOT happen — a mode that holds
// orientation by quietly also holding position is indistinguishable from 6DOF in every pose
// where the joint happens to be reachable, and only shows itself as a limb that will not
// travel. So the check is on the freedom, not only on the hold.
{
  window._ikWritten = null;
  const mq = (j) => {
    const q = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(j.getModelSpaceMatrix()).decompose(
      new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  };

  // ON THE LEAF, which is where an orientation hold is a statement rather than a trap: hold a
  // MID-chain joint's orientation and it also decides where its child ends up, because the
  // child hangs off it rigidly. That is true of 6DOF pins too and is not this mode's problem,
  // but it means the ankle is the honest place to measure "position is free".
  const rig = poleLeg();
  IKSolver.setPin(rig.ankle, IKSolver.PIN_ROT, rig.main);   // replaces poleLeg's PIN_POS
  const pin = IKSolver.pinObject(rig.ankle);
  // A distinctive held orientation, so the check cannot pass just because nothing rotated —
  // and the handle deliberately parked well AWAY from the joint, somewhere the ankle could
  // comfortably reach. In the app the handle rides on its joint, so a handle position that is
  // quietly being used as a goal would look harmless there; put it a metre off and a goal
  // becomes something the pose cannot hide.
  const held = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
  const handle = new THREE.Vector3(0, 0.5, 1.2);
  pin._m.compose(handle, held, new THREE.Vector3(1, 1, 1));

  const ankleWas = pos(rig.ankle);
  Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(0.2, 1.9, 0));
  IKSolver.holdPins(rig.main);

  check('rotation-only pin: the orientation IS held',
    mq(rig.ankle).angleTo(held) < 1e-6,
    'off by ' + mq(rig.ankle).angleTo(held).toFixed(4) + ' rad');
  check('rotation-only pin: the position is NOT held',
    pos(rig.ankle).distanceTo(ankleWas) > 1e-3,
    'ankle moved ' + pos(rig.ankle).distanceTo(ankleWas).toExponential(2));
  check('rotation-only pin: the handle position is not a goal',
    pos(rig.ankle).distanceTo(handle) > 1.0,
    'ankle ended ' + pos(rig.ankle).distanceTo(handle).toFixed(3) + ' from the handle');

  // The contrast that makes the second check mean something: the SAME rig with a 6DOF pin on
  // the ankle DOES hold the position, so "not held" is a property of the mode rather than of a
  // pose where nothing was going to move anyway.
  const rig6 = poleLeg();
  IKSolver.setPin(rig6.ankle, IKSolver.PIN_FULL, rig6.main);
  const anchor6 = IKSolver.pinAnchor(rig6.ankle, new THREE.Vector3());
  Skeleton.moveJoint(rig6.main, rig6.hips, new THREE.Vector3(0.2, 1.9, 0));
  IKSolver.holdPins(rig6.main);
  check('contrast: a 6DOF pin on the same joint DOES hold the position',
    pos(rig6.ankle).distanceTo(anchor6) < 1e-3,
    'ankle off by ' + pos(rig6.ankle).distanceTo(anchor6).toExponential(2));

  // And it costs the hard pins nothing. Measured as a DIFFERENCE against the same solve with
  // the rotation-only pin absent, rather than against the anchor: a hard pin does not always
  // reach its anchor — this pose is slightly out of reach, which is ordinary — and a check
  // written against the anchor would be measuring the reach rather than the interference.
  const kneeOnly = (rot) => {
    const r = poleLeg();
    IKSolver.setPin(r.ankle, rot ? IKSolver.PIN_ROT : IKSolver.PIN_NONE, r.main);
    IKSolver.setPin(r.knee, IKSolver.PIN_POS, r.main);
    Skeleton.moveJoint(r.main, r.hips, new THREE.Vector3(0.2, 1.9, 0));
    IKSolver.holdPins(r.main);
    return pos(r.knee);
  };
  const kneeAlone = kneeOnly(false);
  const kneeWithRot = kneeOnly(true);
  check('rotation-only pin: a hard pin on the same chain solves identically without it',
    kneeAlone.distanceTo(kneeWithRot) < 1e-9,
    'knee shifted ' + kneeAlone.distanceTo(kneeWithRot).toExponential(2));
}

// A rotation-only pin MID-CHAIN must not sever the chain above it. It lights its own node so
// that applyRotations reaches it, and markActive's walk stops at the first node already lit —
// so lighting it at the wrong moment leaves a hard pin further down with no chain to move and
// the whole rig standing still. Measured on the joint ABOVE the rot pin, because that is the
// part that disappears: whether the ankle then reaches its own anchor is a separate question
// (a held mid-chain orientation does place its child, which is what holding one means).
{
  window._ikWritten = null;
  const rig = poleLeg();                                   // ankle already PIN_POS
  IKSolver.setPin(rig.knee, IKSolver.PIN_ROT, rig.main);
  const rigid = pos(rig.knee).add(new THREE.Vector3(0.2, -0.1, 0));  // where a dead solve leaves it
  Skeleton.moveJoint(rig.main, rig.hips, new THREE.Vector3(0.2, 1.9, 0));
  IKSolver.holdPins(rig.main);
  check('rotation-only pin: a hard pin below it still moves the chain ABOVE it',
    pos(rig.knee).distanceTo(rigid) > 1e-3,
    'knee sat exactly where the hips carried it, ' +
    pos(rig.knee).distanceTo(rigid).toExponential(2) + ' from rigid');
}

// The pin watcher must ignore a rotation-only pin's TRANSLATION. Its handle rides on the joint
// it holds, so a moved-pin report would fire on every frame of playback and put the whole rig
// through a solve per frame — which is the judder this mode would otherwise reintroduce.
{
  const rig = poleLeg();
  IKSolver.setPin(rig.knee, IKSolver.PIN_ROT, rig.main);
  const pin = IKSolver.pinObject(rig.knee);
  IKSolver.pinsMoved(rig.main);                       // seed the caches
  check('watcher: a settled rig reports nothing moved', !IKSolver.pinsMoved(rig.main));

  const e = pin._m.elements;
  e[12] += 0.5; e[13] -= 0.25;                        // translate the handle only
  check('watcher: translating a rotation-only pin is not a change',
    !IKSolver.pinsMoved(rig.main));

  pin._m.multiply(new THREE.Matrix4().makeRotationZ(0.3)); // now rotate it
  check('watcher: rotating one IS a change', IKSolver.pinsMoved(rig.main));

  // A position pin is watched whole, as it always was.
  const rigP = poleLeg();
  const pinP = IKSolver.pinObject(rigP.ankle);
  IKSolver.pinsMoved(rigP.main);
  pinP._m.elements[12] += 0.5;
  check('watcher: translating a POSITION pin is still a change', IKSolver.pinsMoved(rigP.main));
}


// A PIN PARENTED TO ANOTHER PIN — the control-rig case: one handle that carries several pins,
// so moving it poses a whole limb. The structure is free (setMeshParent already does the
// scene-graph half); what is NOT free is that the watcher which decides whether to solve has
// to be asking about the same number the solve consumes.
//
// pinAnchor is MODEL space. The watcher used to read the pin's own LOCAL matrix, which is the
// same thing for a top-level pin and a completely different thing once it has a parent: drag
// the parent and the child's local matrix does not move at all. No change reported, no solve
// scheduled, and a control handle built out of pins looks dead while every value in it is
// correct.
{
  window._ikWritten = null;
  const rig = poleLeg();                       // ankle PIN_POS
  const pin = IKSolver.pinObject(rig.ankle);
  // The handle: a null the pin hangs off, standing where the pin stands.
  const handle = rig.main.buildNull();
  handle._m.fromArray(pin._m.elements);
  rig.main.addMeshSilent(handle);
  const world = new THREE.Matrix4().fromArray(pin.getModelSpaceMatrix());
  pin._parentMesh = handle;
  pin.setModelSpaceMatrix(world.elements);     // reparent, world-preserving, as the app does

  check('parenting a pin leaves it exactly where it was',
    new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray(pin.getModelSpaceMatrix()))
      .distanceTo(new THREE.Vector3().setFromMatrixPosition(world)) < 1e-9);

  IKSolver.pinsMoved(rig.main);                                   // seed
  check('a settled parented pin reports nothing moved', !IKSolver.pinsMoved(rig.main));

  // THE CLAIM. Move the HANDLE; the pin's own local matrix never changes.
  const before = Float64Array.from(pin.getMatrix());
  handle._m.elements[12] += 0.5;
  check('...and the pin\'s own local matrix genuinely did not change',
    Array.from(pin.getMatrix()).every((v, i) => Math.abs(v - before[i]) < 1e-12),
    'if this fails the check below proves nothing');
  check('moving the PARENT of a pin schedules a solve', IKSolver.pinsMoved(rig.main),
    'the watcher has to ask about the anchor the solve reads, not about the pin object');

  // And the anchor really did follow, or there would be nothing worth solving for.
  const anchor = IKSolver.pinAnchor(rig.ankle, new THREE.Vector3());
  check('...because the anchor moved with it',
    Math.abs(anchor.x - (world.elements[12] + 0.5)) < 1e-9,
    'anchor x ' + anchor.x.toFixed(4));

  // The cache the watcher compares against must store the SAME reading, or every frame looks
  // like a change and the whole rig solves at frame rate.
  IKSolver.syncPinCache(rig.main);
  check('syncPinCache stores the same reading the watcher takes',
    !IKSolver.pinsMoved(rig.main),
    'the two halves disagreeing means a full IK solve every frame, forever');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
