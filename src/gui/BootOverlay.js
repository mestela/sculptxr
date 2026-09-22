/**
 * HOLD THE DESKTOP VIEW BACK UNTIL THE SHADERS ARE BUILT.
 *
 * matt: "even for desktop, i would rather the display NOT appear, and show 'compiling shaders',
 * than for it to appear early, and be stuttery and laggy. i saw that once the desktop display
 * appeared, the console still kept reporting on shader compilation for several seconds
 * afterwards."
 *
 * The app renders as soon as it has something to draw, which on this renderer means the first
 * seconds are spent compiling pipelines one object at a time -- so the scene appears, then
 * stutters through its own warm-up in front of the user. A loading screen is the honest version
 * of the same wait.
 *
 * WHAT IT WAITS FOR IS "NOTHING NEW WAS BUILT FOR A WHILE", not a count. There is no list of
 * what must compile: objects appear as the app boots (the environment's PMREM, the VR panels,
 * the menu's first paint), and each one compiles when it is first drawn. Watching
 * renderer._pipelines for a quiet period covers all of them without anyone maintaining a
 * manifest -- the same counter the compile trace reads.
 *
 * A HARD CEILING, because the failure mode of a loading screen that waits for a condition is a
 * loading screen that never leaves. If the ceiling is hit it says so and gets out of the way.
 */
const BootOverlay = {};

// How long nothing may be built before the wait is over. Long enough to bridge the gap between
// one object appearing and the next -- the boot sequence has real pauses in it, for the .hdr
// fetch above all.
const QUIET_MS = 600;
// Never hold the view longer than this, whatever the counter says.
const CEILING_MS = 20000;

let el = null;
let startedAt = 0;
let lastBuildAt = 0;
let lastCount = -1;
let done = false;
let total = 0;
let doneCount = 0;

function build() {
  const d = document.createElement('div');
  d.id = 'sxr-boot';
  // Inline, because this has to be correct before any stylesheet is guaranteed to have loaded --
  // it is the thing covering up the app while the app is getting ready.
  d.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#0d0d0d', 'color:#c8c8c8',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:500 15px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'letter-spacing:0.02em', 'transition:opacity 220ms ease',
  ].join(';');
  d.innerHTML = '<div style="text-align:center"><div id="sxr-boot-msg">Compiling shaders...</div>'
    + '<div style="margin-top:14px;width:240px;height:3px;background:#262626;border-radius:2px;'
    + 'overflow:hidden"><div id="sxr-boot-bar" style="width:0%;height:100%;background:#6b8cff;'
    + 'transition:width 120ms linear"></div></div></div>';
  return d;
}

/** Put the cover up. Safe to call more than once; only the node renderer needs it. */
BootOverlay.show = function () {
  if (done || el || typeof document === 'undefined' || !document.body) return;
  try {
    el = build();
    document.body.appendChild(el);
    startedAt = lastBuildAt = performance.now();
  } catch (e) { el = null; }
};

/**
 * HOW MANY THERE ARE TO DO, counted before any of it starts.
 *
 * matt: "surely there's a way to tell in advance how many shaders need to be compiled." Not
 * shaders -- how many a given object needs is decided inside three, and some objects share while
 * others build two. But the DRAWABLE OBJECTS are all knowable up front: they are the scene
 * graph, hidden ones included. That is the honest denominator, and it is the one the work is
 * actually done in units of.
 *
 * So the bar measures objects warmed, not pipelines built. An object that shares a pipeline with
 * one already done costs nothing and the bar jumps; one that needs two costs double and it
 * crawls. That is a fair picture of the wait even though it is not a count of shaders.
 */
BootOverlay.setTotal = function (n) {
  total = n | 0;
  BootOverlay.setProgress(0);
};

BootOverlay.setProgress = function (i) {
  doneCount = i | 0;
  if (!el || !total) return;
  try {
    const bar = el.querySelector('#sxr-boot-bar');
    const msg = el.querySelector('#sxr-boot-msg');
    if (bar) bar.style.width = Math.round(100 * Math.min(1, doneCount / total)) + '%';
    if (msg) msg.textContent = 'Compiling shaders... ' + Math.min(doneCount, total) + ' / ' + total;
  } catch (e) { /* the bar is a courtesy; never let it break a frame */ }
};

/**
 * Once a frame. Returns true while the cover is still up.
 *
 * `ready` is the caller's own precondition -- the startup warm having run -- so this cannot lift
 * before the work it is waiting for has even started. Without it, a quiet 600ms early in boot
 * (waiting on the .hdr, say) would read as "finished".
 */
BootOverlay.tick = function (renderer, ready) {
  if (done || !el) return !done;
  const now = performance.now();
  const pl = renderer && renderer._pipelines;
  const n = (pl && pl.caches && typeof pl.caches.size === 'number') ? pl.caches.size : -1;
  if (n >= 0 && n !== lastCount) { lastCount = n; lastBuildAt = now; }

  const quiet = ready && (now - lastBuildAt) > QUIET_MS;
  const expired = (now - startedAt) > CEILING_MS;
  if (!quiet && !expired) return true;

  done = true;
  const ms = Math.round(now - startedAt);
  console.log('[boot] view held ' + ms + 'ms while ' + (lastCount < 0 ? '?' : lastCount)
    + ' pipelines were built'
    + (expired && !quiet ? ' — CEILING HIT, something is still compiling' : ''));
  try {
    el.style.opacity = '0';
    const gone = el;
    el = null;
    setTimeout(() => { try { gone.remove(); } catch (e) { /* already gone */ } }, 260);
  } catch (e) { el = null; }
  return false;
};

/** For the console: is the cover still up, and why. */
BootOverlay.state = function () {
  return { up: !!el, done: done, lastCount: lastCount, total: total, progress: doneCount,
           quietFor: el ? Math.round(performance.now() - lastBuildAt) : null };
};

export default BootOverlay;
