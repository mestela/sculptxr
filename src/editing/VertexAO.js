// VERTEX AMBIENT OCCLUSION, baked once by ray casting, one value per vertex (1 = open sky).
//
// What it is for is SPECULAR occlusion: the environment map reflects the whole sky off every
// surface, so a tongue or the inside of the lips -- which in reality see only the mouth around
// them -- caught a full bright fresnel rim. three's physical lighting model already applies
// Frostbite's specular occlusion (Lagarde 2014) to the env reflection when a material has an
// aoNode, and the same value darkens the env diffuse. This supplies the value (Mesh.setOcclusion).
//
// PER VERTEX, so it rides blendshapes and the rig at no cost, which a screen-space AO pass in VR
// would not. Self-occlusion only -- other objects do not shadow it.
//
// BAKED IN THE POSE ON SCREEN: open the mouth before baking, or the teeth and inside of the
// mouth come out black when it opens. (v4.5.68 baked the rest shape plus a jaw-open shape and
// blended them by the jaw, on a misread of a reload bug; matt preferred baking what he sees.)

// OFF THE MAIN THREAD (AOTrace.js in workers/AOWorker.js): a 2 s bake locked the headset up
// (matt: "very uncomfortable"). Only the vertices the bake keeps are traced; every triangle still
// occludes.

import { isGnm, regionCodes } from './GnmRegions.js';
import { GNM_REGION_NAMES } from './gnmRegionData.js';
import { workerClient } from '../misc/workerClient.js';
import AOWorker from '../workers/AOWorker.js?worker';

// Float32Array(nbVertices), 1 = unoccluded, of the pose on screen, smoothed. A Promise, traced in
// a worker; `onProgress(f)` hears how far it is. Positions are copied at the call, so posing on
// while it runs does not touch the bake.
const traceInWorker = workerClient(AOWorker);
export async function bakeVertexAO(mesh, onProgress = null) {
  const nbV = mesh.getNbVertices(), nbTri = mesh.getNbTriangles();
  const v = Float32Array.from(mesh.getVertices().subarray(0, nbV * 3));
  const n = Float32Array.from(mesh.getNormals().subarray(0, nbV * 3));
  const tris = Uint32Array.from(mesh.getTriangles().subarray(0, nbTri * 3));
  const keep = mouthMask(mesh, v, nbV);
  const xfer = [v.buffer, n.buffer, tris.buffer];
  if (keep) xfer.push(keep.buffer);
  const { ao } = await traceInWorker({ v, n, tris, nbTri, nbV, keep }, xfer, onProgress);
  return smooth(mesh, ao, 2);
}

// GNM HEADS: THE MOUTH ONLY -- lips, mouth bag, and the pieces inside it (teeth, tongue). Baked
// whole, the eyes and corneas came out shaded (matt: "definitely not wanted"). The skin vertices
// have GNM's regions; the parts beyond them are kept when they sit within the lips-and-bag box
// (padded a fifth), which the eyes are well above. Only these are traced; masked before the
// smoothing, so the edge onto the skin is soft. Null (bake everything) on any other head.
function mouthMask(mesh, v, nbV) {
  if (!isGnm(mesh)) return null;
  const codes = regionCodes();
  const want = new Set(['upper_lip', 'lower_lip', 'mouth_sock'].map((n) => GNM_REGION_NAMES.indexOf(n)));
  const keep = new Uint8Array(nbV);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < Math.min(nbV, codes.length); i++) {
    if (!want.has(codes[i])) continue;
    keep[i] = 1;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i * 3 + k]); hi[k] = Math.max(hi[k], v[i * 3 + k]); }
  }
  for (let k = 0; k < 3; k++) { const pad = (hi[k] - lo[k]) * 0.2; lo[k] -= pad; hi[k] += pad; }
  for (let i = codes.length; i < nbV; i++) {
    const p = i * 3;
    if (v[p] >= lo[0] && v[p] <= hi[0] && v[p + 1] >= lo[1] && v[p + 1] <= hi[1] && v[p + 2] >= lo[2] && v[p + 2] <= hi[2]) keep[i] = 1;
  }
  return keep;
}

// Half toward the ring average, `passes` times.
function smooth(mesh, ao, passes) {
  const vrv = mesh.getVerticesRingVert(), sc = mesh.getVerticesRingVertStartCount();
  if (!vrv) return ao;
  const nbV = ao.length;
  let src = ao, dst = new Float32Array(nbV);
  for (let it = 0; it < passes; it++) {
    for (let i = 0; i < nbV; i++) {
      const ring = Array.isArray(vrv) ? vrv[i] : vrv.subarray(sc[i * 2], sc[i * 2] + sc[i * 2 + 1]);
      if (!ring.length) { dst[i] = src[i]; continue; }
      let s = 0;
      for (let j = 0; j < ring.length; j++) s += src[ring[j]];
      dst[i] = 0.5 * src[i] + 0.5 * s / ring.length;
    }
    const t = src; src = dst; dst = t === ao ? new Float32Array(nbV) : t;
  }
  return src;
}

export default { bakeVertexAO };
