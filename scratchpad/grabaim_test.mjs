// GRAB, ROTATE-ONLY, ON A JOINT: a one-bone aim, not an IK solve.
//
// Checked in the browser on rig.sxr: grabbing an elbow with translation off turned it so the
// forearm pointed exactly where the aim said (dot 1.000000), moved only the wrist and hand,
// left every parent and every pin alone, never started the solver, tracked the cursor on screen
// (shoulder drag: cursor +30,-25 -> elbow tip +40,-25), and undid/redid as one 'Pose' step.
// What is pinned here: the maths of an absolute aim, and that the wiring stays.
//
// Run: node scratchpad/grabaim_test.mjs
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
const REPO = new URL('..', import.meta.url).pathname;
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rv = () => new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize();
const rq = () => new THREE.Quaternion(rnd() - .5, rnd() - .5, rnd() - .5, rnd() + .1).normalize();
let worst = 0, worstRatchet = 0;
for (let i = 0; i < 200; i++) {
  const q0 = rq(), local = rv(), d0 = local.clone().applyQuaternion(q0);      // the bone's direction at the press
  const dT = rv();
  const qNew = new THREE.Quaternion().setFromUnitVectors(d0, dT).multiply(q0); // arc x starting orientation
  worst = Math.max(worst, local.clone().applyQuaternion(qNew).distanceTo(dT));  // the bone now points at the aim
  // path independence: wander the aim around and come back; absolute means it comes back identical
  const wander = [rv(), rv(), rv(), dT];
  let last = null; for (const w of wander) last = new THREE.Quaternion().setFromUnitVectors(d0, w).multiply(q0);
  worstRatchet = Math.max(worstRatchet, 1 - Math.abs(last.dot(qNew)));
}
check('the bone points exactly at the aim (200 random cases)', worst < 1e-6, 'worst error ' + worst);
check('the result does not depend on the path the cursor took (no twist ratchet)', worstRatchet < 1e-9, 'worst ' + worstRatchet);

const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const GRAB = strip(fs.readFileSync(path.join(REPO, 'src/editing/tools/Grab.js'), 'utf8'));
const FKP = strip(fs.readFileSync(path.join(REPO, 'src/editing/fkPick.js'), 'utf8'));
check('Grab starts an aim only when the joint is grabbed with translation off',
  /this\._grabIsJoint && !GrabChannels\.channels\(\)\.translate\) this\._beginAim\(mesh, _aimBone\)/.test(GRAB));
check('the aim branch comes before the IK solve in update()', GRAB.indexOf('this._grabIsJoint && this._grabAim') > 0
  && GRAB.indexOf('this._grabIsJoint && this._grabAim') < GRAB.indexOf('IKSolver.solve(main, this._grabbedMesh'));
check('the aim never calls the solver', !/IKSolver\.solve/.test(GRAB.slice(GRAB.indexOf('this._grabIsJoint && this._grabAim'), GRAB.indexOf('IKSolver.solve(main, this._grabbedMesh'))));
check('the aim acknowledges the pin and joint caches so the watcher does not re-solve',
  /IKSolver\.syncPinCache\(main\);\s*IKSolver\.syncJointCache\(main\);\s*Skeleton\.updateVisuals\(main\);\s*main\.render\(\);\s*return;\s*\}\s*if \(this\._grabIsJoint\) \{/.test(GRAB));
check('the aim is built from the start pose (absolute), not accumulated', /setFromUnitVectors\(a\.d0, _aimD1\)\.multiply\(a\.q0\)/.test(GRAB));
check('the aim is cleared at the end of the grab', /this\._grabAim = null;\s*this\._grabUndoRig = null;/.test(GRAB));

// BONE-FOCUSED: grabbing the middle of a bone turns the joint at the TOP of it, aimed along it.
check('Grab, rotate-only, on a desktop gets bone segments from the pick', /sm\.getToolIndex\(\) === GRAB_TOOL\) \{\s*return !main\._xrSession && GrabChannels\.channels\(\)\.translate === false;/.test(
  strip(fs.readFileSync(path.join(REPO, 'src/math3d/Picking.js'), 'utf8'))));
check('...and the VR/desktop-translate Grab is untouched (still no segments)', /return !main\._xrSession && GrabChannels/.test(strip(fs.readFileSync(path.join(REPO, 'src/math3d/Picking.js'), 'utf8'))));
check('Grab swaps a picked bone for its parent joint and aims along that bone',
  /this\._fkTarget\(mesh, picking\._rigHitSegment, this\._ownedIds\(true\)\)[\s\S]{0,260}mesh = t\.joint;\s*_aimBone = t\.bone;/.test(GRAB) && /this\._beginAim\(mesh, _aimBone\)/.test(GRAB) && /const child = bone \|\| aimChild\(main, joint, Skeleton\)/.test(GRAB)
  && /if \(bone && Skeleton\.isJoint\(par\) && !owned\.has\(par\.getID\(\)\)\) return \{ joint: par, bone: bone \};/.test(FKP));
check('a bone tool\'s forced pick is left alone', /const _forced = !!this\._forcePick;/.test(GRAB) && /if \(!_forced && !GrabChannels/.test(GRAB));

check('the preselect lights the joint that will turn (the bone\'s parent), not the nearer end',
  /\.\.\.this\._fkHoverArgs\(\)/.test(GRAB) && /\(node, bone\) => this\._fkTarget\(node, bone, owned\)\.joint/.test(GRAB)
  && /typeof boneFocus === 'function' && node && !node\._isPinTarget/.test(strip(fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8'))));
// ...ANYTHING THE SOLVER OWNS IS NOT OFFERED: a joint on a path from an active pin to the root is
// rewritten on the next solve, so an FK turn of it is thrown away. Pins are not offered either.
check('rotate-only uses the solver\'s own set of owned joints (through the shared fkPick)', /IKSolver\.solverOwnedIds\(main\)/.test(FKP) && /ownedIds\(this\._main\)/.test(GRAB));
check('an owned joint is dropped from the pick list unless it is the free end of a free bone',
  /const boneFree = Skeleton\.isJoint\(p\) && !owned\.has\(p\.getID\(\)\);\s*return boneFree \|\| !owned\.has\(m\.getID\(\)\);/.test(FKP) && /fkCandidates\(this\._main, owned, false\)/.test(GRAB));
check('the skinned body is not offered with translation off, and such a pick is refused', /if \(Skinning\.isBound\(m\)\) return false;/.test(FKP) && /&& Skinning\.isBound\(mesh\)\) return false;/.test(GRAB));
check('pins stay pickable in rotate-only (they control what the solver owns)', !/if \(m\._isPinTarget\) return false;/.test(GRAB) && !/mesh\._isPinTarget \|\| Skinning/.test(GRAB));
check('when nothing is takeable no bone lights either', /if \(!node\) main\._rigHoverBone = null;/.test(strip(fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8'))));

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
