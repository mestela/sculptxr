// Node harness for the REUSED BUFFERS in src/mesh/multiresolution/MeshResolution.js.
//
// Analysis used to run only when the user stepped down a level by hand, so allocating six fresh
// Float32Arrays per call cost nothing. Skinning now folds a stroke down the stack at every
// stroke END (so that sculpting above the bound level is kept), and at that rate the garbage is
// the cost. The arrays are reused -- and reuse turns "left at zero" into "left at whatever the
// last stroke put there", which is the entire risk and the reason this file exists.
//
// The methods are LIFTED from the real source rather than reimplemented: what is under test is
// whether every element that used to be freshly zeroed is now explicitly written, and a
// reimplementation would be written from the same belief that is being checked.
//
// Run: node scratchpad/multires_test.mjs
import fs from 'fs';

const PATH = '/Users/mattestela/sculptxr/src/mesh/multiresolution/MeshResolution.js';
const SRC = fs.readFileSync(PATH, 'utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

// Pull one method out of the class by matching braces from its signature.
function lift(name) {
  const at = SRC.indexOf('\n  ' + name + '(');
  if (at < 0) throw new Error('no method ' + name);
  let i = SRC.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const body = SRC.slice(SRC.indexOf('(', at), end);
  // eslint-disable-next-line no-new-func
  return new Function('Subdivision', 'return function ' + body + ';')(SubdivisionStub);
}

// partialSubdivision writes the whole of every array it is given -- lifting it too would drag
// in the topology; what matters here is only that its OUTPUT is complete, so it is stubbed with
// something that fills every element with a recognisable value.
const SubdivisionStub = {
  partialSubdivision(mesh, v, c, m) {
    for (let i = 0; i < v.length; i++) { v[i] = 100 + i; c[i] = 200 + i; m[i] = 300 + i; }
  },
};

const computeDetails = lift('computeDetails');
const computePartialSubdivision = lift('computePartialSubdivision');

// --- 1. computePartialSubdivision leaves nothing behind, mapped or not -------------
//
// The scratch it fills is now reused, so any element it SKIPS keeps the previous resolution's
// value instead of a zero -- and the mapped branch writes through a permutation, which is
// exactly the shape of code that quietly misses one.
for (const mapped of [false, true]) {
  for (const even of [false, true]) {
    const nbDown = 4, nbUp = 8;
    // A REALISTIC mapping. With the even vertices aligned (evenMapping false) the first
    // nbDown are copied straight across and only the ODD ones are mapped -- onto the indices
    // the even ones do not occupy. Feeding it a mapping that lands two vertices on the same
    // index measures the fixture, not the code; that mistake cost a round here.
    const map = new Uint32Array(nbUp);
    const lo = even ? 0 : nbDown;
    for (let i = lo; i < nbUp; i++) map[i] = lo + ((i - lo) * 3 + 1) % (nbUp - lo);
    const self = {
      getVerticesMapping: () => (mapped ? map : null),
      getEvenMapping: () => even,
      getNbVertices: () => nbDown,
    };
    const v = new Float32Array(nbUp * 3).fill(NaN);
    const c = new Float32Array(nbUp * 3).fill(NaN);
    const m = new Float32Array(nbUp * 3).fill(NaN);
    computePartialSubdivision.call(self, v, c, m, nbUp);
    const holes = [v, c, m].reduce((n, a) => n + a.reduce((k, x) => k + (Number.isNaN(x) ? 1 : 0), 0), 0);
    check('partial subdivision fills every element (mapped=' + mapped + ' even=' + even + ')',
      holes === 0, holes + ' element(s) left untouched, which a reused buffer would keep');
  }
}

// --- 2. computeDetails zeroes the vertices it skips ---------------------------------
//
// A degenerate normal or a tangent that collapses onto it skips the detail write. On a fresh
// array that left a zero; on a reused one it would leave the PREVIOUS stroke's detail sitting
// on a vertex nobody sculpted, and it would ride every pose from then on.
{
  // THREE VERTICES, ONE PER PATH, and all three matter: vertex 0 is ordinary, vertex 1 has a
  // ZERO NORMAL, and vertex 2's neighbour sits straight along its normal so the projected
  // TANGENT collapses. Two separate `continue`s skip the detail write, and a fixture that
  // reaches only one of them lets the other keep the last stroke's detail for ever -- which is
  // exactly what this fixture did on its first draft, and the injection test caught it.
  const nb = 3;
  const self = {
    getVerticesRingVertStartCount: () => new Uint32Array([0, 1, 2, 1, 4, 1]),
    getVerticesRingVert: () => new Uint32Array([1, 0, 0, 0, 1, 0]),
    getVertices: () => new Float32Array([0, 0, 0,  1, 0, 0,  2, 0, 0]),
    getNormals: () => new Float32Array([0, 0, 1,  0, 0, 0,  0, 0, 1]),
    getColors: () => new Float32Array(nb * 3),
    getMaterials: () => new Float32Array(nb * 3),
    getNbVertices: () => nb,
  };
  // vertex 2 subdivides to (2,0,0) with its one neighbour at (2,0,0.5): straight up its normal
  const subdV = new Float32Array([0, 0, 0.5,  2, 0, 0.5,  2, 0, 0]);
  const subdC = new Float32Array(nb * 3), subdM = new Float32Array(nb * 3);

  // nbVerticesUp is `this`'s OWN count: the loop is over this mesh's vertices, so the buffer
  // it sizes and the range it fills are the same number. Rule 4 pins that at the call site --
  // if they ever diverge, reuse would leave the tail of the array holding the last stroke.
  computeDetails.call(self, subdV, subdC, subdM, nb);
  const fresh = Float32Array.from(self._detailsXYZ);

  // Now the reuse: the SAME object runs again, so the arrays it wrote last time are still there.
  self._detailsXYZ.fill(999); self._detailsRGB.fill(999); self._detailsPBR.fill(999);
  const held = self._detailsXYZ;
  computeDetails.call(self, subdV, subdC, subdM, nb);

  check('details: the buffer really is reused', self._detailsXYZ === held,
    'reallocating each call is the cost this change exists to remove');
  check('details: a reused run matches a fresh one, element for element',
    fresh.every((x, i) => x === self._detailsXYZ[i]),
    'fresh ' + Array.from(fresh).join(',') + '  reused ' + Array.from(self._detailsXYZ).join(','));

  const deg = [3, 4, 5, 6, 7, 8];   // vertices 1 and 2: both skip the detail write
  check('details: the skipped vertices are zeroed, not left holding the last stroke',
    deg.every((i) => self._detailsXYZ[i] === 0),
    Array.from(self._detailsXYZ).join(','));
  check('details: an ordinary vertex still gets a detail',
    self._detailsXYZ[0] !== 0 || self._detailsXYZ[1] !== 0 || self._detailsXYZ[2] !== 0,
    'the fixture has to exercise the normal path too, or the zero check proves nothing');
}

// --- 3. a resolution change reallocates -------------------------------------------
{
  check('src: the buffers are re-made when the vertex count changes',
    /this\._detailsXYZ\.length !== nbVerticesUp \* 3/.test(SRC)
      && /this\._subdScratch\.length !== n \* 3/.test(SRC),
    'a kept buffer from a different resolution is worse than a fresh one');
  check('src: the per-frame subdivision scratch is kept too',
    /this\._subdMapScratch\.length !== nUp \* 3/.test(SRC)
      && /var verts = ms\.subarray\(0, nUp\);/.test(SRC),
    'higherSynthesis runs for every level above the bound one on every frame a joint moves, so '
      + 'this allocation is per level PER FRAME while posing -- the hottest of the three');
  check('src: one scratch allocation, sliced three ways',
    /var subdVerts = sc\.subarray\(0, n\);/.test(SRC)
      && /var subdMaterials = sc\.subarray\(n \* 2, n \* 3\);/.test(SRC));
  check('src: computeDetails is sized by the mesh it loops over',
    /var nbVertices = meshUp\.getNbVertices\(\);/.test(SRC)
      && /meshUp\.computeDetails\(subdVerts, subdColors, subdMaterials, nbVertices\);/.test(SRC),
    'the buffer is nbVerticesUp long and the loop runs to this.getNbVertices(); they are the '
      + 'same number only because the caller passes the up mesh its own count, and reuse turns '
      + 'any gap between them into stale detail on vertices nobody sculpted');
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
