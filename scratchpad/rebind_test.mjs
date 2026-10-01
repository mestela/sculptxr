// Harness for Skinning.syncJoints — the bind that follows rig edits (add / dissolve / delete a
// joint after binding). Lifts the real function text out of src/editing/Skinning.js with the
// stubbed-import trick, so what runs here is the shipped code.
//
// What it guards: a joint added AFTER the bind gets the bind frame it would have had if it had
// been there all along — including when it is added to a POSED rig, which is the case that
// collapses if the current pose is taken as the bind — survivors keep their frames untouched,
// removed joints drop out, and reordering the scene without changing the rig is a no-op.
//
// Run: node scratchpad/rebind_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = new URL('..', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');
const grab = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('anchor moved: ' + from);
  return SRC.slice(i, j);
};
let body = grab('// ORDER-FREE: the mesh list can be reordered', 'Skinning.update = function');
// RB_INJECT=posebind binds every new joint where the pose has put it — the collapse. The suite
// must fail on it, or it is not testing the thing it is for.
const inject = process.env.RB_INJECT;
if (inject === 'posebind') {
  const a = '    if (!a) return nowLocal(j).invert();';
  if (!body.includes(a)) throw new Error('anchor moved: posebind');
  body = body.replace(a, '    return nowLocal(j).invert();');
}

const prelude = `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
const _mMesh = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
const Skinning = { isBound: (m) => !!(m && m._skinW), resolveWeights: (main, m) => { m._resolved = (m._resolved || 0) + 1; return true; } };
const Skeleton = { joints: (main) => main._joints };
`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_rebind_gen.mjs');
fs.writeFileSync(out, prelude + body + '\nexport { Skinning, jointSig, THREE };\n');
const { Skinning, jointSig, THREE } = await import(out + '?v=' + Date.now());

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A joint is its LOCAL matrix under a parent; model space is the product up the chain.
let nextId = 1;
const joint = (parent, local) => ({ _id: nextId++, _parentMesh: parent, local: local,
  getID() { return this._id; },
  model() { return this._parentMesh ? this._parentMesh.model().clone().multiply(this.local) : this.local.clone(); },
  getModelSpaceMatrix() { return this.model().elements; } });
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const R = (a) => new THREE.Matrix4().makeRotationX(a);
const close = (a, b) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-9);

// The mesh sits off the origin and turned, so mesh-local and model space differ.
const meshM = new THREE.Matrix4().makeRotationY(0.3).setPosition(2, 0, 1);
const bindNow = (main, mesh) => {
  const inv = meshM.clone().invert();
  mesh._skinJoints = main._joints.map((j) => j.getID());
  mesh._skinInvBind = main._joints.map((j) => inv.clone().multiply(j.model()).invert());
  mesh._skinW = new Float32Array(4);
};

console.log('rebind after rig edits');
{
  const root = joint(null, T(0, 0, 0));
  const neck = joint(root, T(0, 2, 0));
  const head = joint(neck, T(0, 1, 0));
  const main = { _joints: [root, neck, head] };
  const mesh = { getModelSpaceMatrix: () => meshM.elements };
  bindNow(main, mesh);
  const bindHead = mesh._skinInvBind[2].clone();

  // AT THE BIND POSE: a new joint must get exactly what a fresh bind would give it.
  const jaw = joint(head, T(0, -0.5, 0.4));
  main._joints = [root, neck, head, jaw];
  check('a new joint is picked up', Skinning.syncJoints(main, mesh) && mesh._skinJoints.length === 4);
  const fresh = meshM.clone().invert().multiply(jaw.model()).invert();
  check('...with the bind frame a fresh bind would have given it', close(mesh._skinInvBind[3], fresh));
  check('...while the joints already bound keep theirs', close(mesh._skinInvBind[2], bindHead));
  check('...and the weights are re-solved', mesh._resolved === 1);

  // ON A POSED RIG: tilt the neck, THEN add a chin under the jaw. Its bind frame must be where it
  // would have been at bind, not where the pose has put it — that difference is the collapse.
  neck.local = T(0, 2, 0).multiply(R(0.6));
  const chin = joint(jaw, T(0, -0.5, 0.8));
  main._joints = [root, neck, head, jaw, chin];
  Skinning.syncJoints(main, mesh);
  neck.local = T(0, 2, 0);                            // back to the bind pose to measure
  const chinAtBind = meshM.clone().invert().multiply(chin.model()).invert();
  check('a joint added to a POSED rig binds where it would have been at bind', close(mesh._skinInvBind[4], chinAtBind));
  neck.local = T(0, 2, 0).multiply(R(0.6));
  const posedWrong = meshM.clone().invert().multiply(chin.model()).invert();
  check('...not where the pose put it (the collapse)', !close(mesh._skinInvBind[4], posedWrong));
  neck.local = T(0, 2, 0);

  // REMOVAL: the jaw goes, the chin stays (as a dissolve would leave it, reparented).
  chin._parentMesh = head;
  chin.local = jaw.local.clone().multiply(chin.local);
  const chinBind = mesh._skinInvBind[4].clone();
  main._joints = [root, neck, head, chin];
  Skinning.syncJoints(main, mesh);
  check('a removed joint drops out of the bind', mesh._skinJoints.length === 4 && !mesh._skinJoints.includes(jaw.getID()));
  check('...and a reparented survivor keeps its frame', close(mesh._skinInvBind[3], chinBind));

  // REORDERING the scene without changing the rig is not an edit.
  const before = mesh._resolved;
  main._joints = [chin, head, root, neck];
  check('reordering the scene does not re-solve', !Skinning.syncJoints(main, mesh) && mesh._resolved === before);
  check('...and the change check agrees in any order',
    jointSig([root, neck, head, chin]) === jointSig([chin, head, root, neck]));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
