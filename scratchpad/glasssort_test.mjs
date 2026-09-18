// Node harness for WHY A NESTED GLASS EYE CANNOT BE DEPTH-SORTED.
//
// matt: "lots of depth/transparency sorting issues with the eyes. they're nested spheres, an
// outer transparent sphere, an inner solid one... as soon as its skinned and i start to move the
// head around, the inner eye tends to go hidden."
//
// THE OLD COMMENT IN ShaderManager SAID THERE WAS NOTHING TO DO -- "Three sorts the transparent
// pass back to front already, so dropping the depth write is the whole fix, no render order to
// negotiate". Three sorts that pass by the z of each object's ORIGIN, and both halves of that
// fail here at once. Measured in the browser on matt's camel:
//
//   NESTED OBJECTS SHARE AN ORIGIN. eyeouter and eyeinner both sit at [5.7, 5.6, 8.1] -- z ties
//   EXACTLY, so three falls through to its internal object id, i.e. the order the meshes were
//   created in. His two eyes were authored in opposite order, so one drew inner-then-outer
//   (right) and the other outer-then-inner (the iris painted over the glass). Sorting by centre
//   can never separate two spheres about one centre.
//
//   A SKINNED MESH NEVER MOVES ITS ORIGIN. Skinning writes VERTICES; the object matrix stays at
//   bind. Across one head rotation the eye's origin did not move at all while its geometry went
//   from [3.9, -37.1, 52.9] to [32.9, -28.2, 11.3]. The sort key stops describing where the mesh
//   is the moment the rig is posed -- exactly when matt sees it.
//
// Run: node scratchpad/glasssort_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = fs.readFileSync(path.join(REPO, 'src/render/ShaderManager.js'), 'utf8');
const MESH = fs.readFileSync(path.join(REPO, 'src/mesh/Mesh.js'), 'utf8');

let failures = 0;
const check = (name, ok, got = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + got));
  if (!ok) failures++;
};

check('a transmissive surface is ordered explicitly, not left to the sort',
  /threeMesh\.renderOrder = \(mesh\.getTransmission && mesh\.getTransmission\(\) > 0\) \? 0\.9 : 0;/.test(SM),
  'two spheres about one centre tie on z, and the tie-break is creation order');

// It is the one mesh whose result depends on WHEN it is drawn rather than on the depth test.
check('...and it is still the one that does not write depth',
  /per\[shaderId\]\.depthWrite = !\(mesh\.getTransmission && mesh\.getTransmission\(\) > 0\);/.test(SM),
  'writing depth is what hid the iris inside the glass in the first place');

// Set every frame, in the per-frame uniform pass, so it survives a material swap or a rebuild
// and follows transmission being turned off again.
check('...written on the per-frame path, so turning transmission off puts it back',
  SM.indexOf('threeMesh.renderOrder =') < SM.indexOf('var material = threeMesh.material;'),
  'set once at material creation it would go stale the moment transmission changed');

// 0.9 has to sit inside the documented band or it fights the overlays: base mesh 0, group
// overlay 0.5, wireframe 1, ground grid 200.
check('...at an order inside the documented band',
  /renderOrder = 0\.5; \/\/ above the base mesh, below the wireframe \(1\)/.test(MESH)
    && /\? 0\.9 : 0;/.test(SM),
  'above the base mesh and the group overlay, below the wireframe and the grid');

// The stale comment actively told the next person not to look here.
check('the claim that sorting handles this is gone from the source',
  !/so dropping the depth write is the whole fix -- no render order to negotiate/.test(SM),
  'a wrong comment at the scene of the bug costs the next reader the same day');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
