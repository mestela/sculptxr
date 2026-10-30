// TOPO TRANSFER's heavy steps off the main thread (editing/TopoTransfer.js posts): Wrap's fit +
// warp and Snap's grid + snap + lip relax locked a headset up for seconds. The target's grid is
// kept between snaps, keyed as TopoTransfer keyed it.
import { fitWarp, warpAll, buildGrid, snapSurface, neighbours, relaxRegion, closestOnGrid } from '../editing/TopoWrap.js';

let grid = null;

self.onmessage = (e) => {
  const d = e.data, id = d.id;
  try {
    if (d.op === 'wrap') {
      const warp = fitWarp(d.src, d.dst);
      const out = warpAll(warp, d.base);
      self.postMessage({ id, out, scale: warp.sim.s }, [out.buffer]);
    } else if (d.op === 'snap') {
      // Grid ~ first 10%, the snap passes to 90%, the lip relax the rest.
      const progress = (f) => self.postMessage({ id, progress: f });
      if (!grid || grid.key !== d.gkey) grid = { key: d.gkey, g: buildGrid(d.ttris, d.tverts) };
      progress(0.1);
      const nb = neighbours(d.tris, d.nv);
      let out = snapSurface(d.inT, d.tris, nb, d.include, grid.g, { maxDist: d.maxDist, progress: (f) => progress(0.1 + f * 0.8) });
      progress(0.9);
      out = relaxRegion(out, d.inT, nb, d.lips, 100);
      if (d.lipFit > 0) lipFit(out, nb, d.lipSkin, grid.g, d.lipFit);
      self.postMessage({ id, out }, [out.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

// LIP FIT (TopoTransfer.snapToSurface, slider topo.lipFit): the relaxed lips keep GNM's own shape and
// stood proud of thinner sculpted lips. Each lip vertex moves by `k` of its distance to the sculpt
// ALONG THE SURFACE'S NORMAL only, the offsets averaged over its neighbours a few times so the lip
// moves as one: GNM's even rows are kept (blending toward the snapped lips brought their tangle
// back -- matt: "way more overall general noise and distortion"). Measured on spork's lower lip:
// blending 75% toward the snapped lips: proud 0.05, lip edge lengths spread 21.9% (off: 4.9%);
// along the normal at 100%: proud 0.01 median, spread 9.1%, no folds.
function lipFit(x, nb, lip, g, k) {
  const n = lip.length, D = new Float32Array(n * 3), at = new Map(lip.map((v, i) => [v, i]));
  lip.forEach((v, i) => {
    const p = [x[v * 3], x[v * 3 + 1], x[v * 3 + 2]], h = closestOnGrid(g, p);
    if (!h) return;
    const T = g.tris, V = g.verts, a = T[h.t * 3] * 3, b = T[h.t * 3 + 1] * 3, c = T[h.t * 3 + 2] * 3;
    const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
    const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    const s = ((h.p[0] - p[0]) * nn[0] + (h.p[1] - p[1]) * nn[1] + (h.p[2] - p[2]) * nn[2]) / (l * l);
    for (let q = 0; q < 3; q++) D[i * 3 + q] = s * nn[q];
  });
  const E = new Float32Array(n * 3);
  for (let pass = 0; pass < 3; pass++) {
    lip.forEach((v, i) => {
      let m = 1, s0 = D[i * 3], s1 = D[i * 3 + 1], s2 = D[i * 3 + 2];
      for (let e = nb.start[v]; e < nb.start[v + 1]; e++) { const j = at.get(nb.list[e]); if (j === undefined) continue; m++; s0 += D[j * 3]; s1 += D[j * 3 + 1]; s2 += D[j * 3 + 2]; }
      E[i * 3] = s0 / m; E[i * 3 + 1] = s1 / m; E[i * 3 + 2] = s2 / m;
    });
    D.set(E);
  }
  lip.forEach((v, i) => { for (let q = 0; q < 3; q++) x[v * 3 + q] += k * D[i * 3 + q]; });
}
