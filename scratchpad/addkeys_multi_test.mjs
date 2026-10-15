// Add Key must key EVERYTHING selected (not just the first), skip muted objects, and make many
// transform keys one undo step. Lifts addKeysForMeshes out of the source and runs it.
import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../src/editing/AnimationRegistry.js', import.meta.url), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + n + (!ok && d ? '  ' + d : '')); };

const a = SRC.indexOf('  addKeysForMeshes(meshes, time, mode, pushUndo = true) {');
const b = SRC.indexOf('\n  copyTransformKey(mesh, time) {', a);
check('addKeysForMeshes is liftable', a > 0 && b > a);
const body = SRC.slice(a, b).replace(/^  /gm, '');
const make = new Function('return {' + body.replace(/^addKeysForMeshes/, 'addKeysForMeshes') + '}')();

const mk = (id) => ({ getID: () => id });
const calls = [];
const reg = Object.assign({}, make, {
  tracks: new Map([[1, {}], [2, { muted: true }], [3, {}]]),
  addTransformKey: (m, t) => calls.push(['single', m.getID(), t]),
  keyTransforms: (list, t, label, undo) => { calls.push(['set', list.map((m) => m.getID()), t, label, undo]); return list.length; },
  addShapeKey: (m, t) => calls.push(['shape', m.getID(), t]),
  setBlendshapeWeight: () => {}, evaluateScalarTrack: () => 0,
});

let n = reg.addKeysForMeshes([mk(1), mk(2), mk(3), mk(4)], 0.5, 'transform');
check('keys every unmuted selected object in ONE set', calls.length === 1 && calls[0][0] === 'set'
  && calls[0][1].join() === '1,3,4' && n === 3, JSON.stringify(calls));
check('a muted object is skipped', !calls[0][1].includes(2));
check('the undo step is pushed for the set', calls[0][4] === true);
calls.length = 0;
reg.addKeysForMeshes([mk(1)], 0.5, 'transform');
check('a single object still uses addTransformKey', calls[0][0] === 'single');
calls.length = 0;
reg.addKeysForMeshes([mk(1), mk(3)], 0.5, 'shape');
check('shape mode keys each', calls.length === 2 && calls.every((c) => c[0] === 'shape'));
calls.length = 0;
reg.addKeysForMeshes([mk(2)], 0.5, 'transform');
check('only a muted object: nothing keyed', calls.length === 0);
calls.length = 0;
reg.addKeysForMeshes([mk(1), mk(3)], 0.5, 'transform', false);
check('undo can be suppressed for callers that push their own', calls[0][4] === false);

console.log(failures ? failures + ' FAILURE(S)' : 'all checks passed');
process.exit(failures ? 1 : 0);
