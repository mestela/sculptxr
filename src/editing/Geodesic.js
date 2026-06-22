// Geodesic distance on the mesh surface — the shared foundation for posing (POC #1:
// two-ended geodesic muscle) and rigging (POC #2: geodesic-nearest cage weighting).
//
// computeGeodesicField(mesh, sources) runs single/multi-source Dijkstra over the mesh's
// vertex-ring adjacency (edge weight = Euclidean length), returning a per-vertex distance
// field (Infinity where unreached). The field from an anchor is computed ONCE on placement;
// a moving controller is then just a cheap lookup into it.
//
// Debug: window._geoViz(srcVertId) colours the active mesh by the field (contour-banded
// so iso-distance rings are visible); window._geoVizRestore() puts the colours back.

// Lazy-deletion binary min-heap (dist, id). Dijkstra pushes duplicates on relax and
// skips stale entries on pop — simpler than decrease-key and plenty fast here.
class MinHeap {
  constructor() { this._d = []; this._i = []; }
  get size() { return this._d.length; }
  push(d, i) {
    const D = this._d, I = this._i;
    let n = D.length; D.push(d); I.push(i);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (D[p] <= D[n]) break;
      const td = D[p]; D[p] = D[n]; D[n] = td;
      const ti = I[p]; I[p] = I[n]; I[n] = ti;
      n = p;
    }
  }
  pop() {
    const D = this._d, I = this._i;
    const rd = D[0], ri = I[0];
    const last = D.length - 1;
    D[0] = D[last]; I[0] = I[last]; D.pop(); I.pop();
    let n = 0; const len = D.length;
    while (true) {
      const l = 2 * n + 1, r = l + 1; let s = n;
      if (l < len && D[l] < D[s]) s = l;
      if (r < len && D[r] < D[s]) s = r;
      if (s === n) break;
      const td = D[s]; D[s] = D[n]; D[n] = td;
      const ti = I[s]; I[s] = I[n]; I[n] = ti;
      n = s;
    }
    return { dist: rd, id: ri };
  }
}

// Vertex adjacency built from the faces (ground-truth topology; the lazy vertex-ring
// cache only encodes correct global connectivity for local ops, not full traversal).
// Quad faces have 4 indices; triangles store an out-of-range sentinel in the 4th slot.
function adjacencyFromFaces(mesh) {
  const nbV = mesh.getNbVertices(), nbF = mesh.getNbFaces(), fAr = mesh.getFaces();
  const adj = new Array(nbV);
  for (let i = 0; i < nbV; i++) adj[i] = [];
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  for (let f = 0; f < nbF; f++) {
    const o = f * 4, i0 = fAr[o], i1 = fAr[o + 1], i2 = fAr[o + 2], i3 = fAr[o + 3];
    link(i0, i1); link(i1, i2);
    if (i3 < nbV) { link(i2, i3); link(i3, i0); } else { link(i2, i0); } // quad vs triangle
  }
  return adj;
}

// Single/multi-source geodesic distance field over the mesh surface.
// `sources` = array of vertex indices (each starts at distance 0).
// Returns Float32Array(nbVertices); unreached verts are +Infinity.
export function computeGeodesicField(mesh, sources) {
  const nbV = mesh.getNbVertices();
  const verts = mesh.getVertices();
  const adj = adjacencyFromFaces(mesh);

  // float64 (NOT float32): storing in f32 but comparing in f64 creates phantom
  // "improvements" from rounding that never converge in dense near-equal regions.
  const dist = new Float64Array(nbV).fill(Infinity);
  const heap = new MinHeap();
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    if (s >= 0 && s < nbV) { dist[s] = 0; heap.push(0, s); }
  }

  while (heap.size) {
    const { dist: d, id } = heap.pop();
    if (d > dist[id]) continue; // stale entry
    const ax = verts[id * 3], ay = verts[id * 3 + 1], az = verts[id * 3 + 2];
    const ns = adj[id];
    for (let j = 0; j < ns.length; j++) {
      const nb = ns[j];
      const dx = verts[nb * 3] - ax, dy = verts[nb * 3 + 1] - ay, dz = verts[nb * 3 + 2] - az;
      const nd = d + Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (nd < dist[nb]) { dist[nb] = nd; heap.push(nd, nb); }
    }
  }
  return dist;
}

// Vertex index nearest to a 3D point, among a face's vertices (cheap anchor pick from a
// surface hit). `faceVerts` = [iv0, iv1, iv2(, iv3)] of the picked face.
export function nearestVertexInFace(mesh, point, faceVerts) {
  const verts = mesh.getVertices();
  let best = faceVerts[0], bestD = Infinity;
  for (let k = 0; k < faceVerts.length; k++) {
    const iv = faceVerts[k];
    const dx = verts[iv * 3] - point[0], dy = verts[iv * 3 + 1] - point[1], dz = verts[iv * 3 + 2] - point[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = iv; }
  }
  return best;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hk(h + 1 / 3), hk(h), hk(h - 1 / 3)];
}

// Debug: paint the mesh by a distance field (blue=near → red=far), with dark contour
// lines at iso-distance bands so the geodesic rings are visible. Saves the original
// colours for debugRestoreColors().
export function debugColorByField(mesh, field) {
  const nbV = mesh.getNbVertices();
  const colors = mesh.getColors();
  if (!mesh._geoSavedColors) mesh._geoSavedColors = new Float32Array(colors.subarray(0, nbV * 3));

  let maxD = 0;
  for (let i = 0; i < nbV; i++) { const d = field[i]; if (isFinite(d) && d > maxD) maxD = d; }
  if (maxD <= 0) maxD = 1;

  for (let i = 0; i < nbV; i++) {
    const d = field[i];
    const rgb = isFinite(d) ? hslToRgb((1 - d / maxD) * (240 / 360), 0.85, 0.5) // blue(near)→red(far)
      : [0.08, 0.08, 0.08]; // unreached island = near-black
    colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2];
  }
  mesh.updateDuplicateColorsAndMaterials();
  mesh.updateColorBuffer();
}

export function debugRestoreColors(mesh) {
  if (!mesh._geoSavedColors) return;
  mesh.getColors().set(mesh._geoSavedColors);
  mesh._geoSavedColors = null;
  mesh.updateDuplicateColorsAndMaterials();
  mesh.updateColorBuffer();
}

// Console test harness. _geoViz(srcVertId=0): field from a source vertex, painted on the
// active mesh, with timing/stats logged. _geoVizRestore(): restore original colours.
if (typeof window !== 'undefined') {
  window._geoViz = (srcId = 0) => {
    const mesh = window.app && window.app.getMesh && window.app.getMesh();
    if (!mesh) { console.warn('[geo] no active mesh'); return; }
    const t0 = performance.now();
    const field = computeGeodesicField(mesh, [srcId | 0]);
    const t1 = performance.now();
    let maxD = 0, reached = 0;
    for (let i = 0; i < field.length; i++) { const d = field[i]; if (isFinite(d)) { reached++; if (d > maxD) maxD = d; } }
    debugColorByField(mesh, field);
    if (window.app.render) window.app.render();
    console.log(`[geo] src=${srcId} nbV=${field.length} reached=${reached} maxDist=${maxD.toFixed(3)} in ${(t1 - t0).toFixed(1)}ms`);
    return field;
  };
  window._geoVizRestore = () => {
    const mesh = window.app && window.app.getMesh && window.app.getMesh();
    if (mesh) { debugRestoreColors(mesh); if (window.app.render) window.app.render(); }
  };
}
