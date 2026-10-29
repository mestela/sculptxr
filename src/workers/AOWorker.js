// VERTEX AO BAKE off the main thread (editing/VertexAO.js posts, AOTrace.js traces).
import { traceAO } from '../editing/AOTrace.js';

self.onmessage = (e) => {
  const { id, v, n, tris, nbTri, nbV, keep } = e.data;
  const ao = traceAO(v, n, tris, nbTri, nbV, keep, (progress) => self.postMessage({ id, progress }));
  self.postMessage({ id, ao }, [ao.buffer]);
};
