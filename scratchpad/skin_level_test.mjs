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
  check('bind always targets the lowest control cage',
    /mesh\._skinLevel = 0;/.test(bindFn)
      && /mesh\._skinLevelMesh = mesh\._meshes \? mesh\._meshes\[0\]/.test(bindFn),
    'bind still follows the selected subdivision level');
  check('binding a higher displayed level analyses detail down without changing selection',
    /for \(let i = mesh\._sel \|\| 0; i > 0; i--\) mesh\._meshes\[i - 1\]\.lowerAnalysis\(mesh\._meshes\[i\]\)/.test(bindFn)
      && !/setSelection\(/.test(bindFn),
    'the visible sculpt was not transferred safely to level 0');
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


// ── A SCULPT HAS TO REACH REST SPACE ──────────────────────────────────────────────────────
//
// apply() rebuilds the bound level from `_skinSrc` on every pose change, and `_skinSrc` was
// written at bind, on a blendshape recomposite and on load -- never after a stroke. Measured on
// walkwave: 200 vertices edited at rest pose, one joint nudged, 0 survived, silently.
{
  check('a stroke is committed back to rest space',
    /Skinning\.commitToRest = function/.test(SRC)
      && /mesh\._skinSrc\.set\(v\.subarray\(0, nbV \* 3\)\);/.test(SRC),
    'without this the skin pass reverts every sculpt at the next pose change');
  check('...and the bind shape follows it',
    /mesh\._skinRest\.set\(v\.subarray\(0, nbV \* 3\)\);/.test(SRC),
    '_skinRest is what weights re-solve from and what unbind puts back');
  check('...by COPYING only when the skin matrices really are the identity',
    /Skinning\.atBindPose = function/.test(SRC)
      && /if \(!Skinning\.atBindPose\(main, mesh\)\) return commitPosed\(main, mesh, level, nbV\);/.test(SRC),
    'copying a POSED shape into the rest shape corrupts the bind irreversibly; posed strokes '
      + 'go through commitPosed, which is measured in restwrite_test.mjs');
  check('...and never from a level the weights are not for',
    /mesh\._meshes\[mesh\._sel \|\| 0\] !== level/.test(SRC),
    'above the bound level the shape lives in detail vectors this cannot see');
  check('...nor while a blendshape layer is contributing',
    /reg\.otherLayersOffset\(track, null\)/.test(SRC),
    'the level is base + deltas there, and adopting it would bake the shape into the neutral');
  check('a refused commit is said out loud and reverted, not left to die at the next scrub',
    /function restRefused/.test(SRC) && /mesh\._skinDirty = true;/.test(SRC)
      && /screenLog\('Sculpt not saved: '/.test(SRC),
    'the failure this replaces was silent, which is what cost the trust');

  // Three call sites: the stroke, and both directions of undo -- the places geometry changes
  // with no skin pass to notice.
  const SM = fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8');
  const ST = fs.readFileSync(path.join(REPO, 'src/states/StateManager.js'), 'utf8');
  check('stroke end commits', /Skinning\.commitToRest\(this\._main, this\._main\.getMesh\?\.\(\)\);/.test(SM));
  check('...and so do undo and redo',
    (ST.match(/Skinning\.commitToRest\(/g) || []).length === 2,
    'undo rewrites the level with no stroke to end, so the skin pass would put the sculpt back');
}

// ── THE BIND POSE IS A PLACE YOU CAN GO, AND STAY ────────────────────────────────────────
//
// `_ikRest` (the rig's rest) and `_skinInvBind` (the pose the mesh was bound in) are different
// things that nothing keeps in sync -- on walkwave they differ by 0.47 in the basis and 16 units
// in translation. And the rig has live drivers: physics alone moved 16 of 33 joints off the bind
// pose inside ONE frame.
{
  check('the bind pose is derived from the inverse-bind matrix, not searched for',
    /_mSkin\.copy\(inv\)\.invert\(\)\.premultiply\(_mMesh\);/.test(SRC),
    'joint = mesh x invBind-inverse is exact; the rig rest pose is a different pose');
  check('...parents first, since local is derived through the parent\'s current world matrix',
    /order\.sort\(\(a, b\) => depth\(a\[0\]\) - depth\(b\[0\]\)\);/.test(SRC));
  check('holding it stands the rig drivers down',
    /Skinning\.enterBindPose = function/.test(SRC) && /window\._bindPoseHold = true;/.test(SRC));
  const PB = fs.readFileSync(path.join(REPO, 'src/editing/PhysicsBones.js'), 'utf8');
  const IK = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');
  const AR = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
  check('...physics, which is the one that actually moved the joints',
    (PB.match(/if \(window\._bindPoseHold\) return/g) || []).length === 2,
    'the step AND the reset: a seek runs reset, and reset writes joints');
  check('...the pin solve',  /if \(window\._bindPoseHold\) return;/.test(IK));
  check('...and the keys, for the rig only',
    /if \(window\._bindPoseHold && \(mesh\._isBone \|\| mesh\._isPinTarget\)\) return;/.test(AR),
    'blendshapes and every other mesh carry on evaluating');
  check('leaving puts back exactly what was there, joints AND pins',
    /window\._bindPoseReturn = Skeleton\.joints\(main\)\.concat\(pins\)/.test(SRC)
      && /Skinning\.exitBindPose = function/.test(SRC),
    'a pin left behind hauls the rig off the restored pose on the first solve');
  check('...and asks physics to re-seed rather than resuming from parked particles',
    /window\._physicsNeedsInit = true;[\s\S]{0,200}?_skinDirty = true;/.test(SRC));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
