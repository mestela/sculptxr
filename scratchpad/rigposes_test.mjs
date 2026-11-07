// RigPoses: named skeleton poses. The real module, with the skeleton and solver stubbed; the file round
// trip is in skellock_test.mjs, and the panel and a real rig were checked in the app.
// node scratchpad/rigposes_test.mjs
//   RP_INJECT=absolute  stores the local matrix, not rest-relative: the Tweak check must fail
//   RP_INJECT=nopins    leaves pins where they were: the pin check must fail
//   RP_INJECT=nohold    applies during a bind pose hold: the hold check must fail
//   RP_INJECT=norest    leaves joints the pose doesn't know as they are: the new-joint check must fail
//   RP_INJECT=nolive    lists poses whose skeleton is gone: the cleared-scene check must fail
//   RP_INJECT=fixnoise  a hair's change in a detail goes in the fix: the noise check must fail
//   RP_INJECT=fixweight a stroke's details aren't divided by the weight: the weight check must fail
//   RP_INJECT=fixcompose the rig doesn't re-sum the details: the fade check must fail
//   RP_INJECT=statusbind the bind pose reads as posed: the status check must fail
//   RP_INJECT=statusfix a saved pose reads as rest: the status check must fail
//   RP_INJECT=statuswarn a posed rig off every pose isn't flagged: the status check must fail
//   RP_INJECT=postdrop  Clear leaves the offset: the clear check must fail
//   RP_INJECT=postbake  Bake leaves the offset out: the bake check must fail
//   RP_INJECT=postdrive the rig doesn't weigh an offset: the weight check must fail
//   RP_INJECT=postcomposite an offset's weight redoes the shape composite: the cost check must fail
//   RP_INJECT=postmirror Mirror leaves the offset behind: the mirror check must fail
//   RP_INJECT=fixbake   Bake leaves the details out: the bake check must fail
//   RP_INJECT=fixdrop   Clear leaves the details: the clear check must fail
//   RP_INJECT=fixundo   a removed fix's details aren't put back: the undo check must fail
//   RP_INJECT=keynopins  Key Rig leaves the pins out: the key check must fail
//   RP_INJECT=keyselect  Key Rig uses the timeline's key mode: the transform check must fail
//   RP_INJECT=alljoints weighs joints the pose doesn't change: the unrelated-joint check must fail
//   RP_INJECT=nobakerest  Bake leaves `_skinRest` out: the bake check must fail
//   RP_INJECT=nomirrorroot  a mirrored joint keeps its own parent frame: the mirror check must fail
//   RP_INJECT=ontight   a tight limit on being on a pose: the hold check must fail
//   RP_INJECT=onfuller  most joints wins over closest: the closest check must fail
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const GL = pathToFileURL(require.resolve('gl-matrix')).href;
let src = fs.readFileSync(new URL('../src/editing/RigPoses.js', import.meta.url), 'utf8');
const inject = (a, b) => { if (!src.includes(a)) throw new Error('anchor moved: ' + a); src = src.replace(a, b); };
const i = process.env.RP_INJECT;
if (i === 'absolute') {
  inject('pose.set(j, mat4.multiply(new Float32Array(16), inv, j.getMatrix()));', 'pose.set(j, new Float32Array(j.getMatrix()));');
  inject('if (rel) mat4.multiply(j.getMatrix(), j._ikRest, rel);', 'if (rel) mat4.copy(j.getMatrix(), rel);');
}
if (i === 'nopins') inject('pin.setModelSpaceMatrix(j.getModelSpaceMatrix());', '');
if (i === 'nohold') inject('if (!pose || window._bindPoseHold) return 0;', 'if (!pose) return 0;');
if (i === 'norest') inject('else mat4.copy(j.getMatrix(), j._ikRest);', '');
if (i === 'nolive') inject('for (const j of pose.keys()) if (joints.has(j)) { out.push(name); break; }', 'out.push(name);');
if (i === 'fixnoise') inject('< most * NOISE) continue;', '< 0) continue;');
if (i === 'fixweight') inject('arr[i] += dx / on.w; arr[i + 1] += dy / on.w; arr[i + 2] += dz / on.w;', 'arr[i] += dx; arr[i + 1] += dy; arr[i + 2] += dz;');
if (i === 'fixcompose') inject('else if (moved) composeDetails(m);', '');
if (i === 'statusbind') inject('if (Skinning.atBindPose(main, mesh)) return { pose', 'if (false) return { pose');
if (i === 'statusfix') inject('if (on && !layer) return', 'if (false) return');
if (i === 'statuswarn') inject("stage: 'pre', warn: true", "stage: 'pre', warn: false");
if (i === 'postdrop') inject('t.correctivePost?.delete(key);', '');
if (i === 'postbake') inject('for (const a of [r.d, r.post]) {', 'for (const a of [r.d]) {');
if (i === 'postdrive') inject('...(t.correctivePost?.keys() || []), ', '');
if (i === 'postcomposite') inject('else if (moved) composeDetails(m);', 'else if (moved) refresh(m);');
if (i === 'postmirror') inject('post: r.post && mirrorDelta(n, o, base, r.post), ', '');
if (i === 'fixbake') inject('lvl._detailsXYZ[i] += from[i];', ';');
if (i === 'fixdrop') inject('t.correctiveDetails?.delete(key);', '');
if (i === 'fixundo') inject('if (fix) (t.correctiveDetails || (t.correctiveDetails = new Map())).set(key, fix);', '');
if (i === 'keynopins') inject('Skeleton.joints(main).concat(pins), time', 'Skeleton.joints(main), time');
if (i === 'keyselect') inject("time, 'transform');", "time, window._animKeyMode);");
if (i === 'alljoints') inject('if (a >= CHANGED) rows.push({ j, q, a });', 'rows.push({ j, q, a: Math.max(a, 1e-3) });');
if (i === 'nobakerest') inject('if (i < r.m._skinRest.length) r.m._skinRest[i] += r.d[i];', '');
if (i === 'ontight') inject('if (w < ON_WEIGHT) continue;', 'if (w < 0.9) continue;');
if (i === 'onfuller') inject('(w < best.w - LEVEL || (w <= best.w + LEVEL && n <= most))', 'n <= most');
if (i === 'nomirrorroot') inject('const m = mat4.multiply(mat4.create(), P, model.get(src));', 'const m = mat4.clone(model.get(src));');
src = src.replace(/^import .*$/gm, '').replace(/^export default .*$/m, '');

globalThis.window = {};
const stubs = `import { mat4, quat } from '${GL}';
const Skeleton = globalThis.__Skeleton, IKSolver = globalThis.__IKSolver, PhysicsBones = globalThis.__Physics;
const Skinning = globalThis.__Skinning = {}, PosedSymmetry = { _restPlaneOrigin: (m, n, o) => { o[0] = 0; o[1] = 0; o[2] = 0; return o; } };
`;
const { mat4 } = await import(GL);

let joints = [], pinned = [], states = [], physics = 0;
globalThis.__Skeleton = {
  joints: () => joints,
  syncThree() {},
  updateVisuals() {},
  restoreLocal(snap) { for (const [m, v] of snap) m.getMatrix().set(v); },
};
globalThis.__IKSolver = {
  pinnedJoints: () => pinned,
  pinObject: (j) => j.pin,
  syncJointCache() {},
  syncPinCache() {},
  beginPoseHold: () => ({ was: null, now: null }),
  setPoseHold() {},
};
globalThis.__Physics = { clearRest() { physics++; }, reset() {} };
const { default: RigPoses } = await import('data:text/javascript,' + encodeURIComponent(stubs + src + '\nexport default RigPoses;'));

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : '  FAIL'} ${name} ${info}`); if (!ok) fails++; };
const close = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-5);

const at = (x, y, z) => mat4.fromTranslation(new Float32Array(16), [x, y, z]);
const joint = (x, y) => {
  const m = at(x, y, 0);
  return { _m: m, _ikRest: mat4.clone(m), getMatrix() { return this._m; },
    getModelSpaceMatrix() { return this._m; } };
};
const main = () => ({ getStateManager: () => ({ pushStateCustom: (u, r, x, label) => states.push({ u, r, label }) }) });
const rotate = (j, a) => mat4.rotateZ(j._m, j._m, a);
const reset = () => { states = []; pinned = []; window._bindPoseHold = false; };

// save and apply
{
  reset();
  const a = joint(0, 0), b = joint(0, 2), m = main();
  joints = [a, b];
  rotate(a, 0.7); rotate(b, -0.3);
  const wantA = a._m.slice(), wantB = b._m.slice();
  check('save names it', RigPoses.save(m, RigPoses.nextName(m)) && RigPoses.names(m)[0] === 'pose1');
  mat4.copy(a._m, a._ikRest); mat4.copy(b._m, b._ikRest);
  check('apply reports the joints set', RigPoses.apply(m, 'pose1') === 2);
  check('apply puts the pose back', close(a._m, wantA) && close(b._m, wantB));
  check('saving does not move anything', close(a._m, wantA));
  check('an unknown name does nothing', RigPoses.apply(m, 'nope') === 0);
  const undo = states[states.length - 1];
  check('apply is one undo step', undo && undo.label === 'Apply Rig Pose');
  undo.u();
  check('...which puts the old pose back', close(a._m, a._ikRest) && close(b._m, b._ikRest));
  undo.r();
  check('...and redo the new one', close(a._m, wantA));
  check('apply flushes physics, as Rest Pose does', physics > 0);
}

// a pose survives Tweak, which re-records the rest
{
  reset();
  const a = joint(0, 0), b = joint(0, 2), m = main();
  joints = [a, b];
  rotate(b, 0.5);
  RigPoses.save(m, 'p');
  b._ikRest = at(1, 2, 0);
  RigPoses.apply(m, 'p');
  check('a pose survives the joint being moved by Tweak', Math.abs(b._m[12] - 1) < 1e-5, 'x ' + b._m[12]);
  check('...and keeps its turn', Math.abs(b._m[0] - Math.cos(0.5)) < 1e-5);
}

// a joint drawn since goes to its rest
{
  reset();
  const a = joint(0, 0), m = main();
  joints = [a];
  rotate(a, 0.5);
  RigPoses.save(m, 'p');
  const c = joint(3, 0);
  rotate(c, 1);
  joints = [a, c];
  RigPoses.apply(m, 'p');
  check('a joint the pose does not know goes to its rest', close(c._m, c._ikRest));
  const noRest = joint(5, 0);
  noRest._ikRest = null;
  const was = noRest._m.slice();
  joints = [a, noRest];
  RigPoses.apply(m, 'p');
  check('a joint with no rest recorded is left alone', close(noRest._m, was));
}

// pins follow, or the solve undoes the pose
{
  reset();
  const a = joint(0, 0), m = main();
  a.pin = { _m: at(9, 9, 9), getMatrix() { return this._m; }, setModelSpaceMatrix(v) { this._m = new Float32Array(v); } };
  joints = [a];
  pinned = [a];
  rotate(a, 0.5);
  const want = a._m.slice();
  RigPoses.save(m, 'p');
  RigPoses.apply(m, 'p');
  check('a pin moves onto its posed joint', close(a.pin._m, want));
}

// the bind pose hold owns the rig
{
  reset();
  const a = joint(0, 0), m = main();
  joints = [a];
  rotate(a, 0.5);
  RigPoses.save(m, 'p');
  mat4.copy(a._m, a._ikRest);
  window._bindPoseHold = true;
  check('refused while the bind pose is held', RigPoses.apply(m, 'p') === 0 && close(a._m, a._ikRest));
}

// the list
{
  reset();
  const a = joint(0, 0), m = main();
  joints = [a];
  RigPoses.save(m, 'a'); RigPoses.save(m, 'b'); RigPoses.save(m, 'c');
  check('rename keeps its place', RigPoses.rename(m, 'b', 'x') && RigPoses.names(m).join() === 'a,x,c');
  check('rename refuses a taken name', !RigPoses.rename(m, 'x', 'a'));
  rotate(a, 0.2);
  check('update keeps its place', RigPoses.update(m, 'x') && RigPoses.names(m).join() === 'a,x,c');
  check('update of an unknown name does nothing', !RigPoses.update(m, 'nope'));
  RigPoses.save(m, 'pose4');
  check('next name skips a taken one', RigPoses.nextName(m) === 'pose5', RigPoses.nextName(m));
  const n = states.length;
  check('delete removes it', RigPoses.remove(m, 'a') && RigPoses.names(m).join() === 'x,c,pose4' && states.length === n + 1);
  states[states.length - 1].u();
  check('...and undo brings it back in place', RigPoses.names(m).join() === 'a,x,c,pose4');
  const held = RigPoses.names(m).length;
  joints = [];
  check('a pose whose skeleton has gone is not listed', RigPoses.names(m).length === 0);
  joints = [a];
  check('...and comes back with it', RigPoses.names(m).length === held);
}

// ---- correctives
{
  reset();
  const rotZ = (a) => mat4.fromZRotation(new Float32Array(16), a);
  const pose = (angle) => new Map([[arm, rotZ(angle)]]);
  const arm = joint(0, 0), knee = joint(0, -2);
  joints = [arm, knee];
  const P = pose(1);
  const setArm = (a) => { mat4.copy(arm._m, arm._ikRest); rotate(arm, a); };
  setArm(1);
  check('weight is 1 on the pose', Math.abs(RigPoses.weight(P) - 1) < 1e-5);
  setArm(0);
  check('...0 at rest', RigPoses.weight(P) === 0);
  setArm(0.5);
  check('...and eases between', Math.abs(RigPoses.weight(P) - 0.5) < 1e-3, 'at half ' + RigPoses.weight(P).toFixed(3));
  setArm(1.6);
  check('...and is 0 well past it', RigPoses.weight(P) < 0.5);
  setArm(1); rotate(knee, 1.2);
  const withKnee = new Map([[arm, rotZ(1)], [knee, mat4.create()]]);
  check('a joint the pose leaves alone does not fade it', Math.abs(RigPoses.weight(withKnee) - 1) < 1e-5, 'knee bent: ' + RigPoses.weight(withKnee).toFixed(3));
  check('a pose that changes nothing has no weight', RigPoses.weight(new Map([[arm, mat4.create()]])) === 0);

  const m = { ...main(), _rigPoses: new Map([['up', withKnee]]), getMeshes: () => [mesh] };
  const delta = new Float32Array(6).fill(0); delta[3] = 2;
  const applied = [];
  const track = { blendshapes: new Map(), blendshapeTracks: new Map(), baseShape: new Float32Array([1, 0, 0, 2, 0, 0]) };
  const mesh = { _skinW: [1], _skinSrc: new Float32Array(6), _skinRest: new Float32Array(6), getID: () => 7, getSymmetryNormal: () => [1, 0, 0] };
  window._animationRegistry = { tracks: new Map([[7, track]]), applyBlendshapes: (x) => applied.push(x), invalidateSparse() {} };
  check('on the pose it is the active one', RigPoses.active(m)?.name === 'up');
  const skin = globalThis.__Skinning;
  check('a stroke there is a fix for it', skin.correctiveFor(m, mesh)?.name === 'up');
  // a file from before SKEL v32: the fix is a layer under the skin
  track.blendshapes.set('pose:up', delta.slice());
  track.blendshapeTracks.set('pose:up', { times: [], values: [] });
  track.correctiveW = new Map([['pose:up', 1]]);
  setArm(0.5);
  check('off the pose, strokes go to rest', RigPoses.active(m) === null);
  applied.length = 0;
  track.correctiveW.set('pose:up', -1);
  RigPoses.drive(m);
  check('the rig sets its weight and recomposes', Math.abs(track.correctiveW.get('pose:up') - 0.5) < 1e-3 && applied.length === 1);
  RigPoses.drive(m);
  check('...once: a still rig does nothing', applied.length === 1);
  window._bindPoseHold = true;
  check('no active pose while the bind pose is held', RigPoses.active(m) === null);
  window._bindPoseHold = false;

  // two keys holding a pose bulge between them: a share of the pose off, not a fixed angle
  setArm(0.8);
  check('a fifth of a pose off is still on it', RigPoses.active(m)?.name === 'up', 'weight ' + RigPoses.weight(withKnee).toFixed(3));
  setArm(1);
  const lib = m._rigPoses;
  m._rigPoses = new Map([['near', new Map([[arm, rotZ(0.85)]])], ['up', withKnee]]);
  check('of two that fit, the closest', RigPoses.active(m)?.name === 'up', 'weight ' + RigPoses.active(m)?.w.toFixed(3));
  m._rigPoses = lib;

  // bake, undo, clear
  mesh._skinRest.fill(0);
  const baseWas = track.baseShape.slice();
  const nS = states.length;
  check('bake', RigPoses.bake(m, 'up') === 1);
  check('...moves the fix into the base and the rest shape', track.baseShape[3] === baseWas[3] + 2 && mesh._skinRest[3] === 2);
  check('...and the layer goes', !track.blendshapes.has('pose:up') && states.length === nS + 1);
  states[states.length - 1].u();
  check('...undone exactly', track.baseShape[3] === baseWas[3] && mesh._skinRest[3] === 0 && track.blendshapes.has('pose:up'));
  RigPoses.clear(m, 'up');
  check('clear drops the fix and keeps the pose', !track.blendshapes.has('pose:up') && m._rigPoses.has('up') && track.baseShape[3] === baseWas[3]);
  states[states.length - 1].u();
  check('...undone', track.blendshapes.has('pose:up'));

  // rename and delete carry the layer
  RigPoses.rename(m, 'up', 'raised');
  check('rename carries the fix', track.blendshapes.has('pose:raised') && !track.blendshapes.has('pose:up'));
  RigPoses.remove(m, 'raised');
  check('delete takes the fix with it', !track.blendshapes.has('pose:raised'));
  states[states.length - 1].u();
  check('...and undo brings it back', track.blendshapes.has('pose:raised') && m._rigPoses.has('raised'));

  // mirror: a left arm's turn becomes the right arm's opposite, and the fix crosses over
  const L = joint(1, 0), R = joint(-1, 0);
  L._boneMirror = R; R._boneMirror = L;
  joints = [L, R];
  const P2 = new Map([[L, rotZ(0.7)], [R, mat4.create()]]);
  const m2 = { ...main(), _rigPoses: new Map([['a', P2]]), getMeshes: () => [] };
  globalThis.__Skeleton.symmetryPlane = () => ({ normal: { x: 1, y: 0, z: 0 }, origin: { x: 0, y: 0, z: 0 } });
  const r = RigPoses.mirror(m2, 'a');
  const mp = m2._rigPoses.get(r.name);
  check('mirror makes a new pose', r.ok && r.name === 'a mirror');
  check('...with the twin turned the other way', Math.abs(Math.atan2(mp.get(R)[1], mp.get(R)[0]) + 0.7) < 1e-5, 'R ' + Math.atan2(mp.get(R)[1], mp.get(R)[0]).toFixed(3));
  check('...and the source at rest', Math.abs(mp.get(L)[1]) < 1e-5 && Math.abs(mp.get(L)[12]) < 1e-5);
  globalThis.__Skeleton.symmetryPlane = () => null;
  check('mirror asks for symmetry', !RigPoses.mirror(m2, 'a').ok);
  window._animationRegistry = null;
}

// ---- the status: where a stroke goes
{
  reset();
  const skin = globalThis.__Skinning;
  const arm = joint(0, 0);
  joints = [arm];
  const P = new Map([[arm, mat4.fromZRotation(new Float32Array(16), 1)]]);
  const mesh = { _skinW: [1], getID: () => 12 };
  window._animationRegistry = { tracks: new Map() };
  const m = { ...main(), _rigPoses: new Map([['up', P]]), getMeshes: () => [mesh], getMesh: () => null };
  let bind = true;
  skin.atBindPose = () => bind;
  mat4.copy(arm._m, arm._ikRest);
  let s = RigPoses.status(m);
  check('at bind: pre, no warning', RigPoses.statusText(s) === 'Bind | pre' && !s.warn, RigPoses.statusText(s));
  bind = false; rotate(arm, 1);
  s = RigPoses.status(m);
  check('on a saved pose: post, no warning', RigPoses.statusText(s) === 'up 100% | post' && !s.warn, RigPoses.statusText(s));
  mat4.copy(arm._m, arm._ikRest); rotate(arm, 0.5);
  s = RigPoses.status(m);
  check('off the pose: pre, flagged, and how near it is', RigPoses.statusText(s) === 'up 50% | pre' && s.warn, RigPoses.statusText(s));
  m._rigPoses = new Map();
  check('...and no saved pose says so', RigPoses.statusText(RigPoses.status(m)) === 'Posed | pre');
  m._rigPoses = new Map([['up', P]]);
  window._animationRegistry.tracks.set(12, { editingBlendshape: 'smile' });
  rotate(arm, 0.5);
  s = RigPoses.status(m);
  check('a shape being edited is pre, flagged while posed, even on the pose', s.stage === 'pre' && s.warn, RigPoses.statusText(s));
  bind = true;
  check('...and not at bind', RigPoses.status(m).stage === 'pre' && !RigPoses.status(m).warn);
  m.getMeshes = () => [];
  check('no skin, no status', RigPoses.status(m) === null);
  window._animationRegistry = null;
  delete skin.atBindPose;
}

// ---- a fix's offset on top of the skin pass
{
  reset();
  const skin = globalThis.__Skinning;
  const arm = joint(0, 0);
  joints = [arm];
  const P = new Map([[arm, mat4.fromZRotation(new Float32Array(16), 1)]]);
  const applied = [];
  const mesh = { _skinW: [1], _skinSrc: new Float32Array([1, 0, 0, 2, 0, 0]), _skinRest: new Float32Array([1, 0, 0, 2, 0, 0]), getID: () => 11, getSymmetryNormal: () => [1, 0, 0] };
  window._animationRegistry = { tracks: new Map(), applyBlendshapes: (x) => applied.push(x), invalidateSparse() {} };
  const m = { ...main(), _rigPoses: new Map([['up', P]]), getMeshes: () => [mesh] };
  mat4.copy(arm._m, arm._ikRest); rotate(arm, 1);
  const got = skin.ensureCorrective(m, mesh, { name: 'up', w: 1 });
  const track = window._animationRegistry.tracks.get(11);
  check('a fix is an offset named for its pose', got.arr === track.correctivePost.get('pose:up') && got.arr.length === 6);
  check('...with no base and no layer, so the skin can still be sculpted at rest', !track.baseShape && !track.blendshapes);
  check('...and it is the same one next time', skin.ensureCorrective(m, mesh, { name: 'up', w: 1 }).arr === got.arr);
  got.arr[3] = 2;
  check('the panel sees it', RigPoses.hasCorrective(m, 'up'));
  track.correctiveW.set('pose:up', -1);
  RigPoses.drive(m);
  check('the rig weighs it', Math.abs(track.correctiveW.get('pose:up') - 1) < 1e-3);
  check('...and asks for a pass', mesh._skinDirty === true);
  check('...without redoing a composite', applied.length === 0);
  track.baseShape = new Float32Array(6);
  track.correctiveW.set('pose:up', -1);
  RigPoses.drive(m);
  check('...even on a skin that has shapes', applied.length === 0);
  delete track.baseShape;
  const nS = states.length, rest = mesh._skinRest.slice();
  RigPoses.clear(m, 'up');
  check('clear drops it', !track.correctivePost.has('pose:up') && states.length === nS + 1);
  states[states.length - 1].u();
  check('...undone', track.correctivePost.get('pose:up') === got.arr);
  RigPoses.rename(m, 'up', 'raised');
  check('rename carries it', track.correctivePost.get('pose:raised') === got.arr && !track.correctivePost.has('pose:up'));
  states[states.length - 1].u();
  RigPoses.bake(m, 'up');
  check('bake moves it into the rest shape', mesh._skinRest[3] === rest[3] + 2 && mesh._skinSrc[3] === rest[3] + 2 && !track.correctivePost.has('pose:up'));
  check('...with no base made for it', !track.baseShape);
  states[states.length - 1].u();
  check('...undone exactly', mesh._skinRest[3] === rest[3] && mesh._skinSrc[3] === rest[3] && track.correctivePost.get('pose:up') === got.arr);
  globalThis.__Skeleton.symmetryPlane = () => ({ normal: { x: 1, y: 0, z: 0 }, origin: { x: 0, y: 0, z: 0 } });
  const r = RigPoses.mirror(m, 'up');
  const mp = track.correctivePost.get('pose:' + r.name);
  check('mirror reflects it', !!mp && mp.length === 6);
  globalThis.__Skeleton.symmetryPlane = () => null;
  window._animationRegistry = null;
}

// ---- a fix's details above the bound level
{
  reset();
  const skin = globalThis.__Skinning;
  const arm = joint(0, 0);
  joints = [arm];
  const P = new Map([[arm, mat4.fromZRotation(new Float32Array(16), 1)]]);
  const low = { _detailsXYZ: null }, top = { _detailsXYZ: new Float32Array([5, 5, 5, 6, 6, 6, 7, 7, 7]), _detailsFix: null };
  const mesh = { _skinW: [1], _skinSrc: new Float32Array(6), _skinRest: new Float32Array(6), _meshes: [low, top], getID: () => 9 };
  const track = { blendshapes: new Map(), blendshapeTracks: new Map(), baseShape: new Float32Array(6) };
  window._animationRegistry = { tracks: new Map([[9, track]]), applyBlendshapes() {}, invalidateSparse() {} };
  const m = { ...main(), _rigPoses: new Map([['up', P]]), getMeshes: () => [mesh] };
  mat4.copy(arm._m, arm._ikRest); rotate(arm, 1);
  track.correctiveW = new Map([['pose:up', 1]]);
  // a stroke at weight .5: the first vertex moved by 1, the third by a hair
  const edit = { lvl: top, idx: [0, 6], was: [5, 5, 5, 7, 7, 7], now: [6, 5, 5, 7.0001, 7, 7] };
  const undo = skin.addFixDetails(mesh, { name: 'up', w: 0.5 }, [edit]);
  const fix = track.correctiveDetails.get('pose:up').get(top);
  check('a stroke\'s details go in the fix, at full weight', Math.abs(fix[0] - 2) < 1e-5, 'got ' + fix[0]);
  check('...and show at the weight they were made at', Math.abs(top._detailsFix[0] - 1) < 1e-5);
  check('a hair\'s change on the level is left out', fix[6] === 0 && undo[0].idx.length === 1);
  check('the level\'s own details are left alone', top._detailsXYZ[0] === 5);
  check('the record undoes on the fix\'s array', undo[0].arr === fix && undo[0].was[0] === 0 && Math.abs(undo[0].now[0] - 2) < 1e-5);
  RigPoses.drive(m);
  check('on the pose the rig shows it all', Math.abs(top._detailsFix[0] - 2) < 1e-4, 'shown ' + top._detailsFix?.[0]);
  mat4.copy(arm._m, arm._ikRest);
  RigPoses.drive(m);
  check('at rest there is nothing to add', top._detailsFix === null);
  rotate(arm, 1);
  RigPoses.drive(m);

  const was = top._detailsXYZ.slice();
  RigPoses.bake(m, 'up');
  check('bake puts the details in the level', Math.abs(top._detailsXYZ[0] - 7) < 1e-4 && top._detailsFix === null);
  states[states.length - 1].u();
  check('...undone exactly', top._detailsXYZ[0] === was[0] && track.correctiveDetails.get('pose:up')?.get(top) === fix);
  RigPoses.drive(m);
  RigPoses.clear(m, 'up');
  check('clear drops them', !track.correctiveDetails.has('pose:up') && top._detailsFix === null);
  states[states.length - 1].u();
  RigPoses.drive(m);
  check('...and undo brings them back', track.correctiveDetails.get('pose:up')?.get(top) === fix && Math.abs(top._detailsFix[0] - 2) < 1e-4);
  RigPoses.rename(m, 'up', 'raised');
  check('rename carries them', track.correctiveDetails.get('pose:raised')?.get(top) === fix && !track.correctiveDetails.has('pose:up'));
  window._animationRegistry = null;
}
// ---- Key Rig
{
  reset();
  const j1 = joint(0, 0), j2 = joint(0, -2), pin = { pin: true }, j3 = joint(1, 0);
  joints = [j1, j2, j3];
  pinned = [j2];
  const calls = [];
  window._animationRegistry = { addKeysForMeshes: (list, t, mode) => { calls.push({ list, t, mode }); return list.length; } };
  window._animKeyMode = 'blendshape';
  const pinObj = globalThis.__IKSolver.pinObject;
  globalThis.__IKSolver.pinObject = (j) => (j === j2 ? pin : null);
  const n = RigPoses.keyRig(main(), 1.5);
  check('Key Rig keys every joint', calls[0].list.includes(j1) && calls[0].list.includes(j2) && calls[0].list.includes(j3));
  check('...and every pin', calls[0].list.includes(pin) && n === 4, 'keyed ' + n);
  check('...once, at the time asked for, as one undo step', calls.length === 1 && calls[0].t === 1.5);
  check('...as transforms, whatever the timeline\'s key mode', calls[0].mode === 'transform');
  globalThis.__IKSolver.pinObject = pinObj;
  window._animationRegistry = null;
  check('no registry, nothing keyed', RigPoses.keyRig(main(), 0) === 0);
}
const PANEL = fs.readFileSync(new URL('../src/gui/bonePanel.js', import.meta.url), 'utf8');
check('the button keys at the playhead', /#bone-pose-key'\)\?\.addEventListener[\s\S]{0,120}?window\._animCurrentTime[\s\S]{0,80}?RigPoses\.keyRig\(main, t\)/.test(PANEL));
const SKEL = fs.readFileSync(new URL('../src/editing/Skeleton.js', import.meta.url), 'utf8');
check('Mirror puts a level\'s normals back rather than recomputing them', /put\(x\.l\.getNormals\(\), x\.n\);/.test(fs.readFileSync(new URL('../src/editing/RigPoses.js', import.meta.url), 'utf8')));
check('a load takes the saved weight of the fix back out of the levels', SKEL.includes('lvl._detailsXYZ[at + c] -= w * f[o];'));
check('...which it can, as the save writes that weight', /u\[o\+\+\] = d\.i; u\[o\+\+\] = d\.level; f\[o\+\+\] = d\.w;/.test(SKEL));

const SKIN = fs.readFileSync(new URL('../src/editing/Skinning.js', import.meta.url), 'utf8');
check('a stroke on a pose goes in its fix, not through the rest commit', /if \(into\) \{\n    const rec = commitFix\(main, mesh, level, nbV, into\);[\s\S]{0,120}?\n  \}\n  if \(!atBind\) return journalled\(commitPosed\(main, mesh, level, nbV\)\);/.test(SKIN));
check('a layer stroke stays out of the rest shape', /if \(t\.layer\) for \(let c = 0; c < 3; c\+\+\) \{ rest\[i \+ c\] = e\.oldRest\[j \+ c\];/.test(SKIN));
const SM = fs.readFileSync(new URL('../src/states/StateManager.js', import.meta.url), 'utf8');
check('undoing a custom step does not commit the pose into rest', (SM.match(/if \(!exact && !\(state instanceof StCustom\)\)/g) || []).length === 2);

const SCENE = fs.readFileSync(new URL('../src/Scene.js', import.meta.url), 'utf8');
check('a cleared scene starts with no poses', /clearScene\(\) \{\s*this\._rigPoses = null;/.test(SCENE), 'or a loaded pose1 comes back as "pose1 2" beside a dead one');

if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('all checks passed');
