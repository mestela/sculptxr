// TOPO TRANSFER's heavy steps off the main thread (editing/TopoTransfer.js posts): Wrap's fit +
// warp and Snap's grid + snap + lip relax locked a headset up for seconds. The target's grid is
// kept between snaps, keyed as TopoTransfer keyed it.
import { fitWarp, warpAll, buildGrid, snapSurface, neighbours, relaxRegion } from '../editing/TopoWrap.js';

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
      self.postMessage({ id, out }, [out.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
