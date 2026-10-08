// A JOINT HAS NO SCALE UNLESS THE USER GIVES IT ONE.
//
// Where it came from: Skeleton.createJoint scaled the new joint's matrix by `unit * 0.036` to size
// its pick sphere -- which the rig never picks by (it is picked by proximity to the joint's
// POSITION). The first joint of a rig kept that scale, every descendant inherited it through a
// local matrix of scale 1, and so every child's local translation was in units of 1/s, parts
// parented under a joint came out at 1/s of the scene, pins seated from a joint inherited s, and
// every world-preserving reparent baked s into somebody.
//
// Checked in the browser on matt's rig.sxr and sxr2.sxr: every joint at model scale 1 after load
// (was 6.799), joint positions and orientations unchanged (3e-5, 1e-7), the skinned mesh unchanged
// (2e-6) at rest and after posing the hips and neck pins, pins untouched. A joint drawn with the
// bone tool is at scale 1, its local translation IS its bone length, and Orient still runs.
//
// Run: node scratchpad/jointscale_test.mjs
import fs from 'fs';
import path from 'path';
import { mat4, quat } from 'gl-matrix';
const REPO = new URL('..', import.meta.url).pathname;
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const mul = (a, b) => mat4.multiply(mat4.create(), a, b);
const inv = (m) => mat4.invert(mat4.create(), m);
const maxd = (a, b) => Array.from(a).reduce((mx, v, i) => Math.max(mx, Math.abs(v - b[i])), 0);
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rt = () => { const m = mat4.fromQuat(mat4.create(), quat.normalize([0, 0, 0, 1], [rnd() - .5, rnd() - .5, rnd() - .5, rnd() + .2])); m[12] = rnd() * 40; m[13] = rnd() * 40; m[14] = rnd() * 40; return m; };

// a legacy chain: scale s on the root, locals of scale 1 (descendants inherit it)
let worldWorst = 0, skinWorst = 0, localOK = true;
for (let trial = 0; trial < 60; trial++) {
  const s = 2 + rnd() * 8;
  const root = mul(rt(), mat4.fromScaling(mat4.create(), [s, s, s]));
  const L = [rt(), rt(), rt()].map((m) => { m[12] /= s; m[13] /= s; m[14] /= s; return m; });   // offsets in 1/s units, as a legacy rig has
  const models = [root]; for (const l of L) models.push(mul(models[models.length - 1], l));
  // strip: M' = M . S^-1 for every joint, locals re-derived
  const S = mat4.fromScaling(mat4.create(), [s, s, s]), Si = mat4.fromScaling(mat4.create(), [1 / s, 1 / s, 1 / s]);
  const newModels = models.map((m) => mul(m, Si));
  const newLocals = newModels.map((m, i) => (i ? mul(inv(newModels[i - 1]), m) : m));
  const rebuilt = []; let p = mat4.create(); for (const l of newLocals) { p = mul(p, l); rebuilt.push(p); }
  worldWorst = Math.max(worldWorst, ...rebuilt.map((m, i) => maxd([m[12], m[13], m[14]], [models[i][12], models[i][13], models[i][14]])));
  // every new local has scale 1, and its translation is the real offset
  localOK = localOK && newLocals.slice(1).every((m) => Math.abs(Math.hypot(m[0], m[1], m[2]) - 1) < 1e-4);
  // skin: J' . invBind' == J . invBind with invBind' = S . invBind
  const bind = models.map((m) => inv(m)), bind2 = bind.map((b) => mul(S, b));
  skinWorst = Math.max(skinWorst, ...models.map((m, i) => maxd(mul(m, bind[i]), mul(newModels[i], bind2[i]))));
}
check('stripping the scale keeps every joint where it was', worldWorst < 1e-3, 'worst ' + worldWorst);
check('...and leaves every local matrix at scale 1', localOK);
check('...and the skin is told (invBind\' = S . invBind) so nothing deforms', skinWorst < 1e-3, 'worst ' + skinWorst);

const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const SK = strip(fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8'));
const create = SK.slice(SK.indexOf('Skeleton.createJoint = function'), SK.indexOf('Skeleton.createJoint = function') + 1400);
check('a new joint is made at scale 1', /mat4\.identity\(m\);\s*m\[12\] = pos\.x; m\[13\] = pos\.y; m\[14\] = pos\.z;/.test(create) && !/mat4\.scale\(m, m,/.test(create) && !/0\.036/.test(create));
check('the migration reads the MODEL-space scale (the root carries it, the rest inherit it)', /const sc = _scaleOf\(j\.getModelSpaceMatrix\(mat4\.create\(\)\)\);/.test(SK));
check('only the scale most of the rig shares goes; a different one is left alone', /if \(!best \|\| bestN \* 2 < info\.length\) return 0;/.test(SK));
check('a keyed rig is skipped', /joint scale left as it is: the rig is keyed/.test(SK));
check('local, rest, cages and the skin are all re-derived', /_ikRest = mat4\.multiply/.test(SK) && /premultiply\(new THREE\.Matrix4\(\)\.makeScale\(s, s, s\)\)/.test(SK) && /kidModel\.get\(k\)/.test(SK));
check('it runs at the end of every load, after the pins', SK.indexOf('Skeleton.normalizePinScales(main); }') < SK.indexOf('Skeleton.normalizeJointScales(main); }'));

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
