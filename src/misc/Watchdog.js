// MAIN-THREAD STALL WATCHDOG.
//
// A frozen tab cannot tell you why it froze: the thing that would answer is the thing that is
// stuck. So the answer is kept by something that is NOT stuck -- a Worker. The main thread tells
// it when a named operation starts and ends (postMessage reaches the worker the moment it is
// sent, not when the main thread next gets a turn) and pings it every 250ms. If the pings stop
// while an operation is open, the worker reports WHICH operation, and for how long, to the console
// while the freeze is still going on, then again when it ends.
//
// Reads like this in DevTools, from any Chrome (a worker's console output joins the page's):
//   [watchdog] MAIN THREAD STALLED 4.0s -- inside: Skinning.onCageEdited > Skinning.resolveWeightsAll
//   [watchdog] main thread recovered after 31.4s -- it was inside: ...
//
// Also left on `window._watchdogLog` (this tab) and localStorage `sxr_watchdog` (survives the tab
// being killed -- read it after a restart). `window._watchdog = false` before load turns it off.
//
// WHAT IT CANNOT DO: say what line was running. That is a Performance trace's job. This narrows a
// hang to an operation, which is the question that comes first.
const STALL_MS = 2000;      // no ping for this long, while visible, is a stall
const PING_MS = 250;
const KEEP = 20;

const workerSrc = `
let stack = [];            // [{label, t}] mirrored from the page
let last = performance.now();
let hidden = false;
let stalledSince = 0, lastReport = 0, stalledIn = '';
const names = () => stack.map((s) => s.label).join(' > ') || '(not inside a tracked operation)';
onmessage = (e) => {
  const m = e.data;
  if (m.k === 'in') stack.push({ label: m.label, t: performance.now() });
  else if (m.k === 'out') { const i = stack.map((s) => s.label).lastIndexOf(m.label); if (i >= 0) stack.length = i; }
  else if (m.k === 'vis') { hidden = !!m.hidden; last = performance.now(); }
  if (m.k === 'ping' || m.k === 'out' || m.k === 'in') {
    const now = performance.now();
    if (stalledSince && now - last > 0 && m.k === 'ping') {
      const rec = { at: Date.now(), seconds: +((now - stalledSince) / 1000).toFixed(1), inside: stalledIn };
      console.warn('[watchdog] main thread recovered after ' + rec.seconds + 's -- it was inside: ' + rec.inside);
      postMessage({ k: 'recovered', rec });
      stalledSince = 0; stalledIn = '';
    }
    last = now;
  }
};
setInterval(() => {
  if (hidden) { last = performance.now(); return; }
  const now = performance.now();
  if (now - last < ${STALL_MS}) return;
  if (!stalledSince) stalledSince = last;
  if (now - lastReport < 5000) return;
  lastReport = now;
  const inner = stack.length ? stack[stack.length - 1] : null;
  stalledIn = names();
  const rec = { at: Date.now(), seconds: +((now - stalledSince) / 1000).toFixed(1), inside: names(),
                innermostFor: inner ? +((now - inner.t) / 1000).toFixed(1) : null, ongoing: true };
  console.error('[watchdog] MAIN THREAD STALLED ' + rec.seconds + 's -- inside: ' + rec.inside
    + (inner ? ' (innermost running ' + rec.innermostFor + 's)' : ''));
  postMessage({ k: 'stall', rec });
}, 500);
`;

let worker = null;
const log = (window._watchdogLog = window._watchdogLog || []);

function remember(rec) {
  log.push(rec);
  if (log.length > KEEP) log.shift();
  try { localStorage.setItem('sxr_watchdog', JSON.stringify(log.filter((r) => !r.ongoing).slice(-KEEP))); } catch (_) {}
}

function start() {
  if (worker || window._watchdog === false || typeof Worker === 'undefined') return;
  try {
    const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch (_) { return; }
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.k === 'recovered') remember(m.rec);
    else if (m.k === 'stall') log.push(m.rec);   // the live one; the recovered record replaces it
  };
  setInterval(() => worker.postMessage({ k: 'ping' }), PING_MS);
  const vis = () => worker.postMessage({ k: 'vis', hidden: document.hidden && !window._watchdogForce });
  document.addEventListener('visibilitychange', vis);
  vis();
}

// Run `fn` as the named operation. Safe to nest; async functions are tracked until they settle.
export function tracked(label, fn) {
  if (!worker) return fn();
  worker.postMessage({ k: 'in', label });
  const out = () => worker.postMessage({ k: 'out', label });
  let r;
  try { r = fn(); } catch (e) { out(); throw e; }
  if (r && typeof r.then === 'function') { r.then(out, out); return r; }
  out();
  return r;
}

window._watchdogTracked = tracked;   // for a console test: _watchdogTracked('x', () => { busy loop })

// Replace obj[name] with a tracked version. Idempotent, and a no-op for anything that is not
// there, so a rename elsewhere cannot break the page.
function wrap(obj, name, label) {
  const f = obj && obj[name];
  if (typeof f !== 'function' || f._wd) return;
  const w = function () { return tracked(label, () => f.apply(this, arguments)); };
  w._wd = true;
  obj[name] = w;
}

async function install() {
  start();
  if (!worker) return;
  const imp = async (p) => { try { return (await import(/* @vite-ignore */ p)).default; } catch (_) { return null; } };
  const Skinning = await imp('../editing/Skinning.js');
  const WeightCage = await imp('../editing/WeightCage.js');
  const Skeleton = await imp('../editing/Skeleton.js');
  const StateManager = await imp('../states/StateManager.js');
  const SculptManager = await imp('../editing/SculptManager.js');
  const GuiFiles = await imp('../gui/GuiFiles.js');
  const Scene = await imp('../Scene.js');
  for (const n of ['bind', 'resolveWeights', 'resolveWeightsAll', 'onCageEdited', 'commitToRest', 'apply', 'unbind']) {
    wrap(Skinning, n, 'Skinning.' + n);
  }
  for (const n of ['bake', 'deleteAll', 'pairMirrors', 'mirrorEdit']) wrap(WeightCage, n, 'WeightCage.' + n);
  wrap(Skeleton, 'createJoint', 'Skeleton.createJoint');
  for (const n of ['undo', 'redo']) wrap(StateManager && StateManager.prototype, n, 'StateManager.' + n);
  for (const n of ['start', 'end']) wrap(SculptManager && SculptManager.prototype, n, 'SculptManager.' + n);
  for (const n of ['saveToBrowserStorage', 'loadFromBrowserStorage']) wrap(GuiFiles && GuiFiles.prototype, n, 'GuiFiles.' + n);
  wrap(Scene && Scene.prototype, 'loadScene', 'Scene.loadScene');
}

// A LOST GRAPHICS CONTEXT LOOKS LIKE A BLANK VIEWPORT, with a UI that still answers. (2026-10-10, after a
// GPU process segfault mid-rig.) The message lives in SculptGL.onContextLost; this keeps the record.
function watchContext() {
  const cv = window.sculptgl_instance && window.sculptgl_instance._canvas;
  if (!cv) { setTimeout(watchContext, 1000); return; }
  // SculptGL.onContextLost says it to the person; this only keeps the record.
  cv.addEventListener('webglcontextlost', () => {
    console.error('[watchdog] WEBGL CONTEXT LOST');
    remember({ at: Date.now(), seconds: 0, inside: 'WEBGL CONTEXT LOST' });
  });
  cv.addEventListener('webglcontextrestored', () => {
    remember({ at: Date.now(), seconds: 0, inside: 'webgl context restored (renderer stays dead)' });
  });
}

install();
watchContext();
