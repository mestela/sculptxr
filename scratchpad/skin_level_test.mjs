// Node harness for the BOUND-LEVEL resolution in src/editing/Skinning.js.
//
// Same stubbed-import trick as ik_test.mjs: the real source text is read, its imports are
// stripped and replaced with stubs. The generated copy additionally exports the two private
// functions under test, so they can be exercised directly rather than through the whole
// skinning pipeline.
//
// What this is guarding: the level a mesh was bound at used to be stored as an INDEX into
// `_meshes`, and several ordinary commands reorder that list (Reverse inserts below, Delete
// Lower splices off the bottom, undo/redo shuffle them back). A stale index does not throw —
// it silently resolves to a DIFFERENT resolution, and the weights then address the wrong
// vertices.
//
// Run: node scratchpad/skin_level_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE_PATH = path.join(REPO, 'node_modules/three/build/three.module.js');
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
import * as THREE from '${THREE_PATH}';
const Skeleton = { joints: () => [], jointPos: () => new THREE.Vector3() };
const adjacencyFromFaces = () => [];
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_skin_gen.mjs');
fs.writeFileSync(outPath,
  prelude + '\n' + body + '\nexport { boundLevel, synthesiseUp };\nexport default Skinning;\n');

const mod = await import(outPath + '?v=' + Date.now());
const { boundLevel, synthesiseUp, default: Skinning } = mod;

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

// A resolution level, thin enough to be identified by name in a failure message.
let synthLog = [];
function level(name, nbV) {
  return {
    name: name,
    getNbVertices: () => nbV,
    getVertices: () => new Float32Array(nbV * 3),
    higherSynthesis(lower) { synthLog.push(lower.name + '->' + this.name); },
  };
}

// A bound mesh with a resolution stack, as Multimesh presents one.
function boundMesh(levels, boundAt) {
  return {
    _meshes: levels,
    _sel: levels.length - 1,
    _skinW: new Float32Array(4),          // enough for isBound
    _skinLevel: boundAt,
    _skinLevelMesh: levels[boundAt],
  };
}

// --- 1. subdivide: a level is appended ABOVE the bound one --------------------------
{
  const L0 = level('L0', 100);
  const m = boundMesh([L0], 0);
  m._meshes.push(level('L1', 400));       // what Multimesh.pushMesh does
  m._sel = 1;

  check('subdivide: still bound to L0', boundLevel(m) === L0,
    'got ' + (boundLevel(m) && boundLevel(m).name));
  check('subdivide: index stays 0', m._skinLevel === 0);
}

// --- 2. reverse: a level is inserted BELOW, shifting everything up ------------------
{
  const L0 = level('L0', 100), L1 = level('L1', 400);
  const m = boundMesh([L0, L1], 0);
  m._meshes.unshift(level('Lnew', 30));   // what Multimesh.unshiftMesh does
  m._sel = 1;

  // The whole point: an index of 0 now names the NEW coarse level, which has different
  // vertices entirely. Nothing would have thrown — the weights would just have been applied
  // to the wrong resolution.
  check('reverse: still bound to L0, not the new level below', boundLevel(m) === L0,
    'got ' + (boundLevel(m) && boundLevel(m).name));
  check('reverse: index re-derived to 1', m._skinLevel === 1);
}

// --- 3. delete lower: the bound level is removed ------------------------------------
{
  const L0 = level('L0', 100), L1 = level('L1', 400);
  const m = boundMesh([L0, L1], 0);
  m._meshes.splice(0, 1);                 // what Multimesh.deleteLower does
  m._sel = 0;

  check('delete lower: reports the bound level as gone', boundLevel(m) === null,
    'got ' + (boundLevel(m) && boundLevel(m).name));
  check('delete lower: refused up front by levelsHoldBind',
    Skinning.levelsHoldBind(boundMesh([L0, L1], 0), [L0]) === true);
  check('delete higher: a delete that spares the bound level is allowed',
    Skinning.levelsHoldBind(boundMesh([L0, L1], 0), [L1]) === false);
}

// --- 4. undo of a subdivide pops the level back off --------------------------------
{
  const L0 = level('L0', 100), L1 = level('L1', 400);
  const m = boundMesh([L0, L1], 0);
  m._meshes.pop();
  m._sel = 0;
  check('undo subdivide: still bound to L0', boundLevel(m) === L0);
}

// --- 5. a file bound before the level was stored as a reference ---------------------
{
  const L0 = level('L0', 100), L1 = level('L1', 400);
  const m = boundMesh([L0, L1], 1);
  m._skinLevelMesh = null;                // older data: index only
  check('legacy: falls back to the stored index', boundLevel(m) === L1);
}

// --- 6. synthesis walks up from the RE-DERIVED index -------------------------------
{
  const L0 = level('L0', 100), L1 = level('L1', 400), L2 = level('L2', 1600);
  const m = boundMesh([L0, L1, L2], 0);
  m._meshes.unshift(level('Lnew', 30));   // reverse, so the bound level is now index 1
  m._sel = 3;

  synthLog = [];
  synthesiseUp(m);
  check('synthesis: starts at the bound level, not at index 0',
    synthLog.join(',') === 'L0->L1,L1->L2',
    'got ' + synthLog.join(','));

  // Nothing to do when the displayed level IS the bound one.
  synthLog = [];
  m._sel = 1;
  check('synthesis: no-op when displaying the bound level',
    synthesiseUp(m) === false && synthLog.length === 0);
}

// A BOUND MESH IS LOCKED OUT OF VIEWPORT SELECTION. Once the character is driven by the rig
// you are reaching for bones and pins, and the skin is exactly what stands between the ray and
// every joint inside it. Reuses the outliner's lock, which the picking scans already honour —
// so it stays selectable FROM the outliner, and Unbind hands it back.
{
  const SKIN = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skinning.js', 'utf8');
  const PICK = fs.readFileSync('/Users/mattestela/sculptxr/src/math3d/Picking.js', 'utf8');

  const bindFn = SKIN.slice(SKIN.indexOf('Skinning.bind = function'),
                            SKIN.indexOf('Skinning.unbind = function'));
  const unbindFn = SKIN.slice(SKIN.indexOf('Skinning.unbind = function'),
                             SKIN.indexOf('Skinning.captureSource'));

  check('bind locks the mesh out of viewport selection',
    /mesh\._selectLocked = true;/.test(bindFn), 'flag missing');
  // Only on the SUCCESS path: a refused bind (a joint was selected) must not lock anything.
  check('...only once the bind has succeeded',
    bindFn.indexOf('_selectLocked = true') > bindFn.lastIndexOf("return { ok: false"),
    'a refused bind would lock the mesh it refused');
  check('unbind hands it back',
    /mesh\._selectLocked = false;/.test(unbindFn),
    'a mesh left unselectable after unbind has no way out from inside the headset');

  // AND IT HAS TO SURVIVE A RELOAD. The lock is a runtime flag with no slot in the mesh
  // format, so a reloaded character was pickable again — the ray back to catching the skin
  // instead of the joints inside it. Derived on load from the bind state, which IS in the file.
  {
    const SKEL = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');
    const i = SKEL.indexOf('mesh._skinDirty = true;');
    const near = i === -1 ? '' : SKEL.slice(i, i + 900);
    check('a bound mesh comes back locked after a reload',
      /mesh\._selectLocked = true;/.test(near),
      'the lock is not in the file format, so it has to be re-derived where the skin is restored');
  }

  // The lock is only worth anything because the picking scans already honour it — all three.
  const scans = (PICK.match(/mesh\._selectLocked/g) || []).length;
  check('every picking scan honours the lock', scans >= 3, `${scans} scans`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
