// Node harness for DEFERRING THE OCTREE out of the posing frame.
//
// The skin pass calls updateResolution() on every frame a joint moves, and that ran
// updateGeometry() with no arguments -- which rebuilds the whole octree from scratch. Measured
// on the device, a character bound at the base cage and displayed two levels up:
//
//   29.34ms total | lbs 0.81  mush 1.67  synth 3.80  refresh 23.06 | bound 3106 @L0, showing 49666 @L2
//
// The deformation was 2.5ms of that. The refresh was 23ms, nearly all of it building a spatial
// index for queries nobody was making: you cannot pick a mesh while you are dragging a pin.
//
// So the frame marks it stale and the first QUERY rebuilds it. Everything here is about the one
// way that goes wrong -- a stale tree reaching something that reads it as an answer.
//
// The methods are lifted from the real source, so what is measured is the shipped control flow.
//
// Run: node scratchpad/octreedefer_test.mjs
import fs from 'fs';

const MESH = fs.readFileSync('/Users/mattestela/sculptxr/src/mesh/Mesh.js', 'utf8');
const MULTI = fs.readFileSync('/Users/mattestela/sculptxr/src/mesh/multiresolution/Multimesh.js', 'utf8');
const SKIN = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skinning.js', 'utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

// Lift one method out of the class by brace matching, and run it against a recording stub.
function lift(src, name) {
  const at = src.indexOf('\n  ' + name + '(');
  if (at < 0) throw new Error('no method ' + name);
  let depth = 0, end = -1;
  const open = src.indexOf('{', at);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  // eslint-disable-next-line no-new-func
  return new Function('Utils', 'return function ' + src.slice(src.indexOf('(', at), end) + ';')(
    { getMemory: (n) => new ArrayBuffer(n) });
}

const ensureOctree = lift(MESH, 'ensureOctree');
const intersectRay = lift(MESH, 'intersectRay');
const intersectSphere = lift(MESH, 'intersectSphere');

function stubMesh(stale) {
  const log = [];
  return {
    log: log,
    _meshData: {
      _octreeStale: !!stale,
      _octree: { collectIntersectRay: () => 'ray', collectIntersectSphere: () => 'sphere' },
      _leavesToUpdate: [],
    },
    getNbFaces: () => 4,
    // Recorded, because the ORDER matters: the tree is built from these, so a rebuild that
    // skips them places every face by where it used to be.
    updateFacesAabbAndNormal() { log.push('boxes'); },
    computeOctree() { log.push('build'); this._meshData._octree = { collectIntersectRay: () => 'ray', collectIntersectSphere: () => 'sphere' }; },
    ensureOctree: ensureOctree,
    intersectRay: intersectRay,
    intersectSphere: intersectSphere,
  };
}

// --- 1. a stale tree is rebuilt before it answers ----------------------------------
{
  const m = stubMesh(true);
  m.intersectRay([0, 0, 0], [0, 0, 1], false);
  check('a ray query rebuilds a deferred octree first, boxes before tree',
    m.log.join(',') === 'boxes,build',
    'a stale tree does not throw -- it answers with the pose before last, so the brush picks '
      + 'vertices that are no longer under it');

  const m2 = stubMesh(true);
  m2.intersectSphere([0, 0, 0], 1, false);
  check('...and so does a sphere query', m2.log.join(',') === 'boxes,build');
}

// --- 2. and not rebuilt again until something defers it -----------------------------
{
  const m = stubMesh(true);
  m.intersectRay([0, 0, 0], [0, 0, 1], false);
  m.intersectRay([0, 0, 0], [0, 0, 1], false);
  m.intersectSphere([0, 0, 0], 1, false);
  check('a fresh octree is not rebuilt by every query after it', m.log.length === 2,
    'rebuilding per query would be worse than the per-frame rebuild this replaces; got '
      + (m.log.length / 2) + ' builds');
}

// --- 3. a mesh that never deferred is untouched -------------------------------------
{
  const m = stubMesh(false);
  m.intersectRay([0, 0, 0], [0, 0, 1], false);
  check('an ordinary mesh never enters the rebuild path', m.log.length === 0,
    'the deferral must be invisible to everything that did not opt into it');
}

// --- 4. the wiring, end to end ------------------------------------------------------
check('the pose refresh skips the octree and marks it stale',
  /if \(skipOctree\) \{\n\s*this\._meshData\._octreeStale = true;/.test(MESH)
    && /updateGeometry\(iFaces, iVerts, skipOctree\)/.test(MESH),
  'without the flag the skip is silent and the tree is simply wrong from then on');
check('...and the skin pass is what asks for it',
  /mesh\.updateResolution\(true\);/.test(SKIN)
    && /mesh\.updateGeometry\(undefined, undefined, true\);/.test(SKIN),
  'both branches of the refresh, or a mesh with no stack keeps paying');
// One flag, two meanings, deliberately: "a joint moved" is what licenses BOTH skipping the
// octree and uploading only the buffers a pose can change. Splitting it into two would let a
// caller ask for one and not the other, which is a combination nothing wants.
check('...through updateResolution, which also uploads only what a pose changes',
  /updateResolution\(poseOnly\) \{/.test(MULTI)
    && /this\.updateGeometry\(undefined, undefined, poseOnly\);/.test(MULTI)
    && /if \(poseOnly\) \{\n\s*this\.updateGeometryBuffers\(\);/.test(MULTI),
  'updateBuffers() re-uploads colours, materials, texcoords and the index buffer -- megabytes '
    + 'a frame that posing cannot have changed');
check('...and every other caller still gets the full refresh',
  !/updateResolution\(true\)/.test(MULTI)
    && (MULTI.match(/this\.updateResolution\(\)/g) || []).length >= 7,
  'a level change or a symmetrize DOES change colours and topology');
// The face boxes and centres are skipped with the tree, and the tree is BUILT from them.
check('a deferred rebuild refreshes the face boxes before building on them',
  /ensureOctree\(\) \{[\s\S]{0,400}?this\.updateFacesAabbAndNormal\(\);\n\s*this\.computeOctree\(\);/.test(MESH),
  'building over stale boxes places every face by where it used to be -- a wrong answer, not '
    + 'a slow one');
check('...and a posed frame still computes the normals it skipped the boxes for',
  /this\.updateFacesAabbAndNormal\(iFaces, skipOctree\);/.test(MESH)
    && /if \(normalsOnly\) continue;/.test(MESH)
    && /faceNormals\[idTri \+ 2\] = crz;\n\s*if \(normalsOnly\) continue;/.test(MESH),
  'the normals are what the surface is shaded with and a pose changes them; only the box and '
    + 'centre are for queries');

check('computeOctree clears the flag however it was reached',
  /computeOctree\(\) \{\n\s*this\._meshData\._octreeStale = false;/.test(MESH),
  'a rebuild from any other path must count, or the next query rebuilds a current tree');

// getOctree() is read PER FRAME by Gizmo for nothing but a loose bound. Forcing a rebuild there
// would hand back every millisecond this saves, and a stale loose bound is harmless -- it
// scales a gizmo. This rule exists because "be safe, put it in the accessor too" is the
// obvious next edit and it would silently undo the whole change.
check('getOctree() does NOT force a rebuild',
  /getOctree\(\) \{\n\s*return this\._meshData\._octree;\n\s*\}/.test(MESH),
  'Gizmo reads it every frame for a scale heuristic; rebuilding there restores the old cost');

// An incremental update shuffles faces inside the tree it already has.
check('an incremental octree update refuses to build on a deferred tree',
  /updateOctree\(iFaces\) \{[\s\S]{0,400}?this\.ensureOctree\(\);/.test(MESH),
  'moving the current faces between the previous cells leaves a tree that matches neither');

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
