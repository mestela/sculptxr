// A LOG IN A PER-FRAME PATH IS A PERFORMANCE BUG, and this is where that is made survivable.
//
// computeWorldBound, computeBoundingBoxMeshes and computeRadiusFromBoundingBox all run for every
// mesh every frame, and all three reported a NaN by calling console.error with typed arrays
// attached. Once anything in a rig goes NaN that is thousands of messages a second: measured on
// the desktop, 436,819 console messages dropped from the buffer in a single session, and a
// 40-joint rig at 18ms a frame of which none was drawing -- hiding every rig object changed
// nothing, while taking the joints out of the mesh list took the frame to 0.28ms.
//
// It is far worse in a headset, which is how matt met it: "on the gxr, crazy slow", desktop
// fine, and slow in every draw mode because the cost never had anything to do with what was
// drawn. A console.error into closed devtools is cheap-ish; over Chrome remote debugging, which
// is how the GalaxyXR is read, every one is serialised and shipped across the wire.
//
// The diagnostics are worth keeping -- a NaN matrix is a real fault. What they must not do is
// cost more than the bug they report.

const state = new Map();   // key -> { count, suppressed, firstAt, lastLogAt }

/**
 * Log once, then at most once per `everyMs` with a count of what was suppressed.
 * Returns true if this call actually logged.
 */
export function guardedError(key, everyMs, ...args) {
  const now = Date.now();
  let s = state.get(key);
  if (!s) { s = { count: 0, suppressed: 0, firstAt: now, lastLogAt: 0 }; state.set(key, s); }
  s.count++;
  if (!s.lastLogAt) {
    s.lastLogAt = now;
    console.error(key, ...args, '(further reports throttled)');
    return true;
  }
  if (now - s.lastLogAt >= everyMs) {
    const skipped = s.count - s.suppressed - 1;
    s.suppressed = s.count;
    s.lastLogAt = now;
    console.error(key + ' x' + s.count + ' (' + skipped + ' since last report)');
    return true;
  }
  return false;
}

/**
 * WHAT IS SHOUTING, AND HOW OFTEN. `logSpamReport()` in the console, headset included: one line
 * per guarded site with its total and its rate. A site running at hundreds a second IS the
 * frame budget, and this says so in one screen instead of half a million messages.
 */
export function logSpamReport() {
  const now = Date.now();
  const rows = [...state.entries()].map(([k, s]) => ({
    what: k,
    total: s.count,
    perSec: +(s.count / Math.max(0.001, (now - s.firstAt) / 1000)).toFixed(1),
  })).sort((a, b) => b.perSec - a.perSec);
  if (!rows.length) { console.log('[logSpam] nothing guarded has fired'); return rows; }
  console.log('[logSpam] guarded diagnostics, worst first:');
  for (const r of rows) console.log('  ' + r.perSec + '/s  x' + r.total + '  ' + r.what);
  return rows;
}

export function logSpamReset() { state.clear(); }

/**
 * WHAT THE FRAME IS ACTUALLY DRAWING. `drawReport(scene)` -- or `drawReport()` once Scene has
 * registered itself -- lists every VISIBLE drawable grouped by parent, with instance counts and
 * triangles, worst first.
 *
 * It exists because xrPerf can say `gl-render 60ms` and nothing more, and on a GalaxyXR that 60ms
 * came with 99 draw calls and 28,449 triangles -- so neither geometry nor draw count explains it
 * (measured on the desktop: fifty extra draws, shared or unique materials, cost 0.07ms). The next
 * question is always "which objects", and answering it by hand in a headset is not practical.
 */
export function drawReport(scene) {
  const sc = scene || (typeof window !== 'undefined' && window.sculptgl_instance
    && window.sculptgl_instance._scene);
  if (!sc) { console.log('[draw] no scene'); return []; }
  const rows = [];
  let hidden = 0;
  sc.traverse((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints)) return;
    let p = o, vis = true;
    while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
    const g = o.geometry;
    if (!g) return;
    if (!vis) { hidden++; return; }
    const idx = g.index ? g.index.count
      : (g.getAttribute && g.getAttribute('position') ? g.getAttribute('position').count : 0);
    const n = o.isInstancedMesh ? (o.count || 0) : 1;
    if (n === 0) return;
    const chain = [];
    let q = o.parent;
    while (q && chain.length < 2) { chain.push(q.name || q.type); q = q.parent; }
    rows.push({ name: o.name || o.type, under: chain.join('<'), inst: n,
      tris: Math.round(idx / 3 * n), mat: o.material && o.material.type,
      transparent: !!(o.material && o.material.transparent), order: o.renderOrder });
  });
  rows.sort((a, b) => b.tris - a.tris);
  const byParent = {};
  for (const r of rows) byParent[r.under] = (byParent[r.under] || 0) + 1;
  console.log('[draw] ' + rows.length + ' visible drawables (' + hidden + ' hidden), '
    + rows.reduce((a, b) => a + b.tris, 0) + ' tris');
  console.log('[draw] by parent: ' + JSON.stringify(byParent));
  for (const r of rows.slice(0, 12)) {
    console.log('  ' + r.tris + ' tris  x' + r.inst + '  ' + r.name + ' under ' + r.under
      + '  ' + r.mat + (r.transparent ? ' transparent' : '') + ' order=' + r.order);
  }
  return rows;
}

if (typeof window !== 'undefined') {
  window.logSpamReport = logSpamReport;
  window.logSpamReset = logSpamReset;
  window.drawReport = drawReport;
}

export default { guardedError, logSpamReport, logSpamReset, drawReport };
