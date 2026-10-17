// A JOINT TRACK'S ROTATION CHANNELS ARE THE TURN AWAY FROM ITS REST (xfChannel eulerRef).
// Run: node scratchpad/eulerref_test.mjs
import path from 'path';
import * as THREE from 'three';
const REPO = new URL('..', import.meta.url).pathname;
const X = await import(path.join(REPO, 'src/editing/xfChannel.js'));

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n); failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < e);

const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, -1.1, 0.4, 'XYZ'));
const turn = (deg) => rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180));
const tr = { times: [0, 1, 2], quaternions: [...turn(0).toArray(), ...turn(30).toArray(), ...turn(-20).toArray()] };

const abs = X.rotRebuild(tr).slice();
check('without a reference, a turn about the joint\'s own Y moves several channels', Math.abs(abs[3] - abs[0]) > 1 && Math.abs(abs[5] - abs[2]) > 1);
check('setting the reference re-spells the channels', X.setEulerRef(tr, rest.toArray()) === true);
check('...as the turn away from rest: only Y moves', near(tr.eulers, [0, 0, 0, 0, 30, 0, 0, -20, 0]), JSON.stringify(tr.eulers.map((v) => +v.toFixed(2))));
check('the same reference again is a no-op', X.setEulerRef(tr, rest.toArray()) === false);
const q = X.channelsToQuat(tr, 0, 30, 0, new THREE.Quaternion());
check('channels back to a rotation go through the reference', Math.abs(Math.abs(q.dot(turn(30))) - 1) < 1e-6);
X.rotSetEuler(tr, 2, 1, 10);
check('writing a channel keeps the quaternion in step (rest * turn)', Math.abs(Math.abs(new THREE.Quaternion().fromArray(tr.quaternions, 8).dot(turn(10))) - 1) < 1e-6);
tr.tangentOffsets = { trans_rot_1_right_dv_1: 5, trans_pos_1_right_dv_0: 2 };
X.setEulerRef(tr, null);
check('changing the reference drops rotation tangents only', !('trans_rot_1_right_dv_1' in tr.tangentOffsets) && tr.tangentOffsets.trans_pos_1_right_dv_0 === 2);

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
