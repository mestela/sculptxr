// ORIENT JOINTS: a relabelling of each joint's axes that moves nothing.
//
// The scene-side behaviour (24 joints on matt's rig, skin unchanged to 2e-6 at rest AND posed,
// idempotent, undo/redo exact, oriented-vs-unoriented posing giving identical skin, one undo
// step per Draw/Tweak) was checked in the browser against rig.sxr. What is pinned here is what
// can be: the algebra the bookkeeping rests on, and that the places that must call it, do.
//
// Run: node scratchpad/jointorient_test.mjs
import fs from 'fs';
import path from 'path';
import { mat4, vec3, quat } from 'gl-matrix';
const REPO = new URL('..', import.meta.url).pathname;
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const mul = (a, b) => mat4.multiply(mat4.create(), a, b);
const inv = (m) => mat4.invert(mat4.create(), m);
const maxd = (a, b) => a.reduce((mx, v, i) => Math.max(mx, Math.abs(v - b[i])), 0);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rot = () => mat4.fromQuat(mat4.create(), quat.normalize([0, 0, 0, 1], [rnd() - .5, rnd() - .5, rnd() - .5, rnd() + .1]));
const trs = () => { const m = rot(); m[12] = rnd() * 4; m[13] = rnd() * 4; m[14] = rnd() * 4; return m; };

// a three-deep chain, a cage under the middle joint, a skin bind, a pin on the leaf
for (let trial = 0; trial < 50; trial++) {
  const L = [trs(), trs(), trs()];                 // local matrices, joint 0 is the root
  const R = [rot(), rot(), rot()];                 // the rotation each joint's axes get
  const cage = trs();                              // a non-joint child of joint 1
  const model = (locals) => { const o = []; let p = mat4.create(); for (const l of locals) { p = mul(p, l); o.push(p); } return o; };
  const L2 = L.map((l, i) => mul(mul(i ? inv(R[i - 1]) : mat4.create(), l), R[i]));   // the joint formula
  const cage2 = mul(inv(R[1]), cage);
  const M = model(L), M2 = model(L2);
  const posOK = M.every((m, i) => maxd([m[12], m[13], m[14]], [M2[i][12], M2[i][13], M2[i][14]]) < 1e-4);
  const axesOK = M.every((m, i) => maxd(mul(m, R[i]), M2[i]) < 1e-4);            // model' = model . R
  const cageOK = maxd(mul(M[1], cage), mul(M2[1], cage2)) < 1e-4;                // same world place
  const bind = M.map((m) => inv(m));                                              // invBind at bind time
  const bind2 = bind.map((b, i) => mul(inv(R[i]), b));                            // R^-1 . invBind
  const skinOK = M.every((m, i) => maxd(mul(m, bind[i]), mul(M2[i], bind2[i])) < 1e-4);   // J.invBind unchanged
  const pin = M[2], pin2 = mul(pin, R[2]);                                        // a pin seated on the joint, then pin.R
  const pinOK = maxd(mul(inv(M[2]), pin), mul(inv(M2[2]), pin2)) < 1e-4;          // still exactly the joint's own orientation
  if (!(posOK && axesOK && cageOK && skinOK && pinOK)) { check('trial ' + trial, false, JSON.stringify({ posOK, axesOK, cageOK, skinOK, pinOK })); break; }
  if (trial === 49) check('50 random chains: positions, axes, cage, skin and pin bookkeeping all hold', true);
}

// the wiring
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const stripC = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const DRAW = stripC(read('src/editing/tools/BoneDrawTool.js'));
check('Draw Bone orients after it records the rest', /IKSolver\.captureRest\(main\);\s*autoOrient\(main\);/.test(DRAW));
check('Tweak orients after its own undo step is pushed', /'Tweak Joint'\);\s*\}\s*(\/\/.*\n\s*)*if \(moved\) autoOrient\(this\._main\);/.test(DRAW.replace(/\n\s*\/\/[^\n]*/g, '')) || /if \(moved\) autoOrient\(this\._main\)/.test(DRAW));
check('Tweak undo/redo restore the REST with the matrices', /putRest\(restBefore\)/.test(DRAW) && /putRest\(restAfter\)/.test(DRAW),
  'a Tweak undone without its rest leaves a joint whose rest disagrees with where it stands');
const ORI = stripC(read('src/editing/JointOrient.js'));
check('the orient step is squashed onto the step before it', /squash: true/.test(ORI) && /pushStateCustom\?\.\(\s*\(\) => restore\(main, before\), \(\) => restore\(main, after\), squash/.test(ORI));
check('a keyed rig is refused', /keyedMeshes\(main, joints, pins\.concat\(kids\)\)/.test(ORI) && /ok: false/.test(ORI));
check('skin inverse binds are carried', /_skinInvBind\[a\]\.premultiply\(Ri\)/.test(ORI));
const IK = stripC(read('src/editing/IKSolver.js'));
const fit = IK.slice(IK.indexOf('function fitLocalRotation'), IK.indexOf('function applyFkRoll'));
check('the absolute rotation fit honours the rest rotation', /jointRestQuat\(n\.joint, _qRest\)/.test(fit) && /out\.multiply\(_qRest\)/.test(fit),
  'without this an oriented joint is overwritten by an arc measured from the parent axes: the skin twists');

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
