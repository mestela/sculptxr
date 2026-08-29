// THE HUMAN BASE MESH, loaded on demand.
//
// MakeHuman's base mesh, CC0. Not a procedural primitive like the others — it is 13,378 quads
// of authored topology — so it lives as a binary asset fetched the first time someone asks for
// it rather than as 366 KB welded into the JS bundle for the sessions nobody adds a figure.
//
// PROVENANCE, because "where did this mesh come from" is exactly the question a licence audit
// asks and the answer should not have to be reconstructed:
//
//   makehumancommunity/makehuman — makehuman/data/3dobjs/base.obj
//   The file's own header: "This asset was explicitly released as CC0 in september 2020."
//   LICENSE.md section C names "The base mesh and proxies" among the CC0 assets, separately
//   from the AGPL source. Copyright holders at the point of release: Data Collection AB,
//   Joel Palmius, Jonas Hauquier.
//
// CC0 requires no attribution. This note is here because provenance is worth more than the
// obligation is — see tools/make_humanbase.mjs for the conversion, which is reproducible.
//
// WHY A BASE MESH AT ALL. Quad remeshing a sculpted head is still not solved well by anything
// open (Instant Meshes is a field method and cannot be steered; autoremesher's results were
// poor in testing), and for the two things people sculpt most — heads and bodies — conforming a
// known-good topology sidesteps the problem entirely rather than trying to win at it.
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';

const ASSET = 'humanbase.bin';
const MAGIC = 0x53584842;   // 'SXHB'

let _cache = null;   // the decoded arrays, so a second add costs no fetch and no parse

function decode(buf) {
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== MAGIC) throw new Error('humanbase: not a SXHB file');
  if (head[1] !== 1) throw new Error('humanbase: unsupported version ' + head[1]);
  const nv = head[2], nf = head[3];
  // Copied out rather than viewed in place: MeshStatic keeps these arrays and edits them, and a
  // view into the fetched buffer would make every added figure share one set of vertices.
  const vertices = new Float32Array(buf, 16, nv * 3).slice();
  const faces = new Uint32Array(buf, 16 + nv * 12, nf * 4).slice();
  return { vertices, faces, nv, nf };
}

// Resolved against the module URL so it works under a base path, the same way the workers are.
function assetURL() {
  try { return new URL(ASSET, document.baseURI).href; } catch (_) { return ASSET; }
}

export function humanBaseReady() { return !!_cache; }

export async function loadHumanBase() {
  if (_cache) return _cache;
  const res = await fetch(assetURL());
  if (!res.ok) throw new Error('humanbase: ' + res.status + ' fetching ' + assetURL());
  _cache = decode(await res.arrayBuffer());
  return _cache;
}

// Build a fresh MeshStatic from the cached arrays. `loadHumanBase` must have resolved first —
// kept separate so the caller owns the await and can say "loading" rather than freezing.
export function buildHumanBase(gl) {
  if (!_cache) throw new Error('humanbase: call loadHumanBase() first');
  const mesh = new MeshStatic(gl);
  mesh.setVertices(_cache.vertices.slice());
  mesh.setFaces(_cache.faces.slice());
  mesh.init();
  if (gl) mesh.initRender();
  return mesh;
}

export default { load: loadHumanBase, build: buildHumanBase, ready: humanBaseReady, url: assetURL };
