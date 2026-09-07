/**
 * HTMLVRPanel — install.js
 *
 * Singleton module.  MUST be imported before any other three-html-render code.
 * On first import it:
 *   1. Intercepts window.requestAnimationFrame so pending callbacks can be drained
 *      manually inside the XR render loop (Chrome pauses window.rAF in immersive mode).
 *   2. Installs the three-html-render polyfill.
 *   3. Lazily creates a hidden <canvas layoutsubtree> as the shared host for panel DOM
 *      elements (on first getHostCanvas() call, which happens after DOMContentLoaded).
 *
 * NOTE: We intentionally do NOT use ThreeHTMLRenderer.  That class's _uploadTextures()
 * uses texElementImage2D (patched onto WebGLRenderingContext by the polyfill), which
 * binds textures directly on the GL context behind Three.js's state machine, causing
 * state corruption and VR freezes.  Instead, panels manage their own Three.js textures
 * via captureElementImage() + texture.needsUpdate = true.
 *
 * Why lazy host canvas creation?
 *   install.js is evaluated at ES-module import time, which on PCVR / Windows Chrome
 *   runs early — before document.body is fully available.  The polyfill's internal
 *   P() registration function calls document.body.appendChild() and checks
 *   hasAttribute('layoutsubtree') at that moment.  If document.body is not yet ready,
 *   P() returns null, the polyfill's onpaint property setter prints
 *   "setting onpaint on a canvas without layoutsubtree" and silently no-ops, so
 *   _onPaint() never fires and panels stay solid white.
 *   Deferring canvas creation to the first getHostCanvas() call (which always happens
 *   inside a panel constructor, called from window.onload) guarantees document.body
 *   is stable and P() succeeds.
 *
 * Why addEventListener('paint') instead of canvas.onpaint?
 *   The polyfill always does both:
 *     state.onpaint?.call(canvas, event)      ← property setter path
 *     canvas.dispatchEvent(new Event('paint')) ← always fires
 *   Using addEventListener is therefore more robust: it works even if the property
 *   setter path fails (e.g. timing edge cases during startup).
 *
 * Usage (Scene.js):
 *   import { drainRAF } from './gui/htmlvr/install.js';
 *   // In XR render loop:
 *   drainRAF();   // before renderer.render()
 */

import { installHtmlInCanvasPolyfill } from 'three-html-render/polyfill';
// Base64 data URL of FA Solid (committed, generated from the package woff2). Imported as a
// plain string so we can inject it SYNCHRONOUSLY below — no runtime fetch, no build-inlining
// into the CSS (which kept the bundle lean and avoided duplicate copies).
import faSolidInline from './faSolidBase64.js';

// REGISTER FA THROUGH THE FontFace API, NOT A <style> ELEMENT.
//
// This used to insert a <style> holding the woff2 as a base64 @font-face, so panel icons would
// survive the rasteriser's trip through an SVG. They did -- and so did the font: the polyfill
// inlines the whole of document.styleSheets into EVERY panel's SVG on EVERY paint, so 206KB of
// base64 rode along each time, per panel. Measured on the dev server, same panel, cold decode:
// 462KB / 36.5ms with it, 256KB / 25.5ms without. matt: "slower and slower the more mainpanels
// i pin" -- each pinned panel was paying for the font separately.
//
// Panel icons are inline SVG paths now (faIcons.js), so nothing in a panel needs the glyphs. The
// font is still wanted for the CANVAS-drawn radial menu, which paints FA codepoints with
// ctx.fillText and therefore needs the family registered with the document. document.fonts.add()
// registers it for canvas and for ordinary DOM without ever appearing in document.styleSheets,
// which is exactly the property we need: available to draw with, invisible to the serialiser.
try {
  const _faFace = new FontFace('Font Awesome 6 Free', `url(${faSolidInline}) format('woff2')`,
    { style: 'normal', weight: '900' });
  document.fonts.add(_faFace);
  // Kick the load now rather than at first paint; the radial menu draws to a canvas the frame it
  // opens, and an unloaded family there silently falls back to the default font.
  _faFace.load().catch((err) => console.warn('[SculptXR] FA font load failed:', err));
} catch (err) { console.warn('[SculptXR] FA font register failed:', err); }

// ── 1. rAF intercept (must run before polyfill install) ─────────────────────
export const _nativeRAF  = window.requestAnimationFrame.bind(window);
export const _nativeCAF  = window.cancelAnimationFrame.bind(window);
export const _pendingRAF = new Map();
let _rafSeq = 1;

window.requestAnimationFrame = (cb) => {
  const id       = _rafSeq++;
  const nativeId = _nativeRAF((ts) => {
    if (_pendingRAF.delete(id)) cb(ts); // only call if not already drained
  });
  _pendingRAF.set(id, { cb, nativeId });
  return id;
};

window.cancelAnimationFrame = (id) => {
  const e = _pendingRAF.get(id);
  if (e) { _pendingRAF.delete(id); _nativeCAF(e.nativeId); }
};

// ── 1b. Patch Image.src: strip crossOrigin for data: URLs ───────────────────
// The three-html-render polyfill always sets crossOrigin="anonymous" before
// setting src on images it creates for SVG rasterisation.  On some PCVR /
// Windows Chrome builds this causes onerror on a data: URL (no server to
// supply CORS headers).  Stripping crossOrigin when src is a data: URL
// prevents this without affecting HTTP(S) image loads.
{
  const _origSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (_origSrcDesc?.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ..._origSrcDesc,
      set(value) {
        if (typeof value === 'string' && value.startsWith('data:') && this.crossOrigin) {
          this.removeAttribute('crossorigin');
        }
        _origSrcDesc.set.call(this, value);
      },
    });
  }
}

// ── 1c. Suppress polyfill CSS-comment URL fetches ───────────────────────────
// The polyfill's getPageStylesCss() uses a greedy URL regex that matches URLs
// inside CSS *comments* (e.g. FontAwesome embeds "https://fontawesome.com/" and
// "https://fontawesome.com/license/free" as copyright notices).  It then tries
// to fetch+inline those as resources, gets CORS errors, logs 6 console errors
// per session, and retries every paint cycle.
// Fix: return an empty 200 response for URLs that are clearly web-page paths
// (no file extension) on external origins.  These are never real assets and
// the polyfill only needs the actual font/image/css file blobs anyway.
{
  const _origFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      try {
        const u    = new URL(url);
        const same = u.origin === location.origin;
        const ext  = /\.\w{1,5}(\?.*)?$/.test(u.pathname);
        // External URL with no recognisable file extension → page URL in a comment
        if (!same && !ext) {
          return Promise.resolve(new Response('', { status: 200,
            headers: { 'Content-Type': 'text/plain' } }));
        }
      } catch { /* malformed URL — let it through */ }
    }
    return _origFetch(url, opts);
  };
}

// ── 2. Install polyfill ──────────────────────────────────────────────────────
// force:true bypasses the native-API detection check.  Newer Chrome builds
// expose stub implementations of requestPaint / onpaint / drawElementImage that
// satisfy the detection heuristic but don't actually work yet (white panels on
// Windows/PCVR).  We depend on the polyfill's SVG foreignObject rasterisation
// path on all platforms, so we always force it on.
installHtmlInCanvasPolyfill({ force: true });

// ── 3. Panel registry ────────────────────────────────────────────────────────
const _panels = new Set();
export function registerPanel(panel)   { _panels.add(panel);    }
export function unregisterPanel(panel) { _panels.delete(panel); }

// EVERY PANEL SHARES ONE LAYOUT, so one panel moving invalidates all the others.
//
// The panel roots are ordinary block elements in the host canvas, stacked in normal flow. So
// mounting or unmounting a panel -- and a re-mount APPENDS, which also reorders them -- or one
// panel's content changing height moves every panel after it. `captureElementImage(el)` reads
// the region the last rasterisation laid that element out at, so a panel that does not repaint
// after someone else's layout change captures the WRONG REGION: blank canvas, or a slice of a
// neighbour. Its texture stays the right size and its every property stays correct, which is
// exactly the state the 30-second tape recorded while the menu was, to matt, not there -- and he
// could still see the hover highlight, which is a separate mesh with no texture at all.
//
// So a layout change dirties everyone. A repaint of the visible panels is the cost, and it only
// happens when something actually moved.
export function markAllPanelsDirty(except) {
  for (const p of _panels) {
    if (p === except || !p._hostMounted) continue;
    p.markDirty();
  }
}

// ── 4. Lazy host canvas ──────────────────────────────────────────────────────
// Created on first getHostCanvas() call (inside panel constructors, post-DOM).
let _hostCanvas = null;
let _firstPaintFired = false;

// Deduplication flag: at most one requestPaint() per drain cycle.
let _paintScheduled = false;

// Rate-limit state.  The limit is enforced by wrapping canvas.requestPaint
// (see _wrapRequestPaint) so it fires BEFORE the polyfill queues its rAF and
// does the expensive work (buildSvg / serializeToString / cloneNode).
// Blocking at _onPaintEvent is too late — the costly work already ran inside
// the rAF callback before the paint event is dispatched.
let _lastPaintTs = 0;
let _forcePaint  = false;
const PAINT_MIN_MS = 200; // ~5 fps ceiling for ambient repaints

/**
 * Wrap canvas.requestPaint once so every caller — our code AND the polyfill's
 * own MutationObserver-triggered calls — goes through the rate limit.
 * Called lazily on first requestPaintOnce() so the polyfill has had time to
 * install requestPaint on the canvas (it does so asynchronously via a
 * MutationObserver on document.body after the canvas is appended).
 */
function _wrapRequestPaint(canvas) {
  if (canvas._rxWrapped || !canvas.requestPaint) return;
  canvas._rxWrapped = true;
  const orig = canvas.requestPaint.bind(canvas);
  canvas.requestPaint = function () {
    const now   = performance.now();
    const force = _forcePaint;
    _forcePaint = false;
    if (!force && now - _lastPaintTs < PAINT_MIN_MS) return; // dropped — _paintScheduled untouched
    _lastPaintTs = now;
    _paintScheduled = true; // set ONLY when a paint is genuinely queued (not pre-emptively)
    _ppRequested();
    orig();
  };
}

// ── PANEL COST INSTRUMENT ────────────────────────────────────────────────────────────────
//
// THE EXISTING FRAME BUCKET CANNOT SEE THIS WORK, and that is not a small caveat -- it is why
// "the menus are not the cost" has been concluded twice from honest measurements.
//
// Scene.js times `panel-paint` around drainRAF(). But the polyfill's paint callback is an ASYNC
// function that awaits Promise.all(dirty.map(rasterise)), so drainRAF() returns at the FIRST
// AWAIT. What it measures is the synchronous prefix -- the clone and the serialise. The rest,
// which the prod-CSS trace already showed to be the expensive half (set src, recalculate style,
// image decode of a ~480KB data URL PER PANEL), resolves later in the microtask queue, outside
// every mark. It is real main-thread time and it shows up as frame gap, never as our work.
//
// So this measures the SPAN: from the moment a paint is requested to the paint event, alongside
// the count of elements actually rasterised, which panel asked, and who made it dirty. Off by
// default; one line a second when on.
const _pp = {
  paints: 0, els: 0, span: 0, worst: 0, worstEls: 0,
  dirty: Object.create(null), causes: Object.create(null),
  rebuilt: Object.create(null), skipped: Object.create(null),
  startedAt: 0, at: 0, seq: 0,
};
export function panelName(p) {
  if (!p) return 'panel';
  return p._sectionId ? 'torn:' + p._sectionId : (p.constructor && p.constructor.name) || 'panel';
}
const _bump = (bag, k) => { bag[k] = (bag[k] || 0) + 1; };

// WHO dirtied it, not just how often. A tally of panels says which panel is being repainted; it
// does not say what is doing the repainting, which is the only part anyone can act on. Sampled
// one frame in eight because building a stack is not free, and a cause that matters at 5 paints
// a second will still be top of the list at one in eight.
export function notePanelDirty(panel) {
  if (!window._panelPerf) return;
  _bump(_pp.dirty, panelName(panel));
  if ((_pp.seq++ & 7) !== 0) return;
  // SKIP THE WRAPPERS, or the cause is always the last wrapper instead of the caller. The first
  // version filtered by FILE, so for the main panel it reported `MainMenuPanel.markDirty` -- the
  // subclass override -- which names the panel we already knew and not what asked it. Filter by
  // what the frame IS: a markDirty/_requestPaint/requestSync/syncFromState frame is plumbing.
  const lines = (new Error().stack || '').split('\n').slice(2);
  const at = lines.find((l) => !/install\.js|HTMLVRPanel\.js/.test(l)
    && !/\.(markDirty|_requestPaint|requestSync|_ppRequested)\b/.test(l));
  if (at) _bump(_pp.causes, at.trim().replace(/^at\s+/, '').replace(/\s*\(.*\)$/, '')
    .replace(/https?:\/\/[^\s)]*\//, '').slice(0, 48));
}
export function notePanelRebuild(panel, changed) {
  if (!window._panelPerf) return;
  _bump(changed ? _pp.rebuilt : _pp.skipped, panelName(panel));
}
function _ppRequested() { if (window._panelPerf && !_pp.startedAt) _pp.startedAt = performance.now(); }
function _ppPainted(count) {
  if (!window._panelPerf) return;
  const now = performance.now();
  const span = _pp.startedAt ? now - _pp.startedAt : 0;
  _pp.startedAt = 0;
  _pp.paints++; _pp.els += count; _pp.span += span;
  if (span > _pp.worst) { _pp.worst = span; _pp.worstEls = count; }
  if (!_pp.at) { _pp.at = now; return; }
  if (now - _pp.at < 1000) return;
  const mounted = [];
  for (const p of _panels) if (p._hostMounted) mounted.push(panelName(p));
  const top = (bag, n) => Object.entries(bag).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => k + ' ' + v).join(', ') || 'none';
  console.log('[panelPerf] mounted ' + mounted.length + ' (' + (mounted.join(', ') || 'none') + ')'
    + ' | ' + _pp.paints + ' paints/s, ' + _pp.els + ' elements ('
    + (_pp.els / Math.max(1, _pp.paints)).toFixed(1) + '/paint)'
    + ' | rasterise ' + _pp.span.toFixed(0) + 'ms/s total, '
    + (_pp.span / Math.max(1, _pp.paints)).toFixed(1) + 'ms/paint, worst '
    + _pp.worst.toFixed(1) + 'ms (' + _pp.worstEls + ' els)');
  console.log('[panelPerf]   dirtied: ' + top(_pp.dirty, 6));
  console.log('[panelPerf]   caused by: ' + top(_pp.causes, 4) + '   (sampled 1 in 8)');
  console.log('[panelPerf]   torn rebuilds: ' + top(_pp.rebuilt, 4)
    + ' | skipped as unchanged: ' + top(_pp.skipped, 4));
  _pp.paints = 0; _pp.els = 0; _pp.span = 0; _pp.worst = 0; _pp.worstEls = 0; _pp.at = now;
  _pp.dirty = Object.create(null); _pp.causes = Object.create(null);
  _pp.rebuilt = Object.create(null); _pp.skipped = Object.create(null);
}

function _onPaintEvent(e) {
  _ppPainted(e && e.changedElements ? e.changedElements.length : 0);
  _paintScheduled = false;
  if (!_firstPaintFired) {
    _firstPaintFired = true;
    console.log('[HTMLVRPanel] polyfill paint fired ✓');
    _nativeRAF(() => {
      if (window.screenLog) window.screenLog('[Panel] polyfill OK ✓', 'lime');
    });
  }
  for (const panel of _panels) {
    try { panel._onPaint(); } catch (e) { console.warn('[HTMLVRPanel] _onPaint error:', e); }
  }
}

/**
 * Schedule a polyfill rasterisation pass for this drain cycle.
 * No-op if one is already queued — _onPaintEvent covers all panels.
 */
export function requestPaintOnce(canvas) {
  _wrapRequestPaint(canvas);
  if (!canvas.requestPaint) return false;
  if (_paintScheduled) return true;     // a paint is already queued — covers all panels
  canvas.requestPaint();                // sets _paintScheduled iff it passes the rate limit
  return _paintScheduled;               // false ⇒ rate-limited away (caller should stay dirty)
}

/**
 * Like requestPaintOnce but bypasses the PAINT_MIN_MS rate limit.
 * Use for immediate visual feedback on user actions (pointerdown/pointerup).
 */
/**
 * Repaint ONE panel, not every mounted one.
 *
 * `canvas.requestPaint()` is all-or-nothing: the polyfill's implementation is
 * `for (const child of state.children) state.dirty.add(child)`, so a single ambient repaint
 * re-clones, re-serialises and re-decodes EVERY panel on the canvas — and each of those
 * carries a full inline copy of the page CSS, which is the expensive part. Measured on the
 * dev server, one requestPaint() with three panels mounted reports `changedElements: 3`.
 *
 * That is the whole of "it gets slower once I tear panels off": the panels are not slow, the
 * repaint is priced per panel and every panel pays for every panel. Posing a rig dirties the
 * main panel continuously (the transform fields really do change), so a pinned Rendering panel
 * that has not altered a pixel is re-rasterised five times a second alongside it.
 *
 * The polyfill already has the mechanism for doing this properly — its MutationObserver adds
 * only the mutated panel to the dirty set — so the scoped path just gives it a mutation to see:
 * one data attribute on that panel's root. No public per-element API exists, and reaching into
 * the polyfill's internal state would break on any update; an attribute touch is ordinary DOM.
 *
 * The whole-canvas paint is still the right answer when the LAYOUT moved (mount, unmount,
 * resize): those really do invalidate every panel's captured region. See markAllPanelsDirty.
 */
let _scopeSeq = 0;
export function requestPaintScoped(panel) {
  const canvas = getHostCanvas();
  _wrapRequestPaint(canvas);
  if (!canvas.requestPaint || !panel?._element) return false;
  // A/B switch, because the honest comparison is a headset with panels torn off and this is
  // the one thing that changes between the two runs. Settings ▸ Scoped Panel Repaint.
  if (window._panelScopedPaint === false) return requestPaintOnce(canvas);

  const now   = performance.now();
  const force = _forcePaint;
  _forcePaint = false;
  if (!force && now - _lastPaintTs < PAINT_MIN_MS) return false; // caller stays dirty, retries
  _lastPaintTs = now;
  // Deliberately NOT setting _paintScheduled: that flag means "a queued paint covers every
  // panel", which a scoped paint does not. Leaving it clear costs at most one extra full paint
  // in the same drain; setting it would silently swallow one that was needed.
  _ppRequested();
  panel._element.setAttribute('data-rx-paint', String(_scopeSeq = (_scopeSeq + 1) & 0xffff));
  return true;
}

export function requestPaintForced(canvas) {
  _forcePaint = true;
  requestPaintOnce(canvas);
}

export function getHostCanvas() {
  if (_hostCanvas) return _hostCanvas;

  // Create the host canvas now — document.body is guaranteed to exist because
  // getHostCanvas() is only called from panel constructors, which run after
  // window.onload (i.e. after full DOM parse + DOMContentLoaded).
  _hostCanvas = document.createElement('canvas');
  _hostCanvas.setAttribute('layoutsubtree', '');
  _hostCanvas.id = '_htmlvr_host';
  _hostCanvas.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;' +
    'visibility:hidden;pointer-events:none;';
  document.body.appendChild(_hostCanvas);

  // Use addEventListener('paint') rather than the onpaint property setter.
  // The polyfill always dispatchEvent(new Event('paint')) on the canvas after
  // rasterising, so this path is guaranteed to fire even if the onpaint setter
  // fails due to timing (polyfill P() registration not yet complete).
  _hostCanvas.addEventListener('paint', _onPaintEvent);

  console.log('[HTMLVRPanel] host canvas created, body ready:', !!document.body);
  return _hostCanvas;
}

/**
 * Drain any pending window.rAF callbacks.
 * Call once per XR frame (before renderer.render) so the polyfill's paint
 * scheduler fires synchronously and textures are ready for the current frame.
 */
export function drainRAF() {
  if (_pendingRAF.size === 0) return;
  const ts    = performance.now();
  const batch = [..._pendingRAF.entries()];
  _pendingRAF.clear();
  batch.forEach(([, { cb, nativeId }]) => {
    try { _nativeCAF(nativeId); cb(ts); } catch (e) { console.warn('[HTMLVRPanel] drainRAF cb error:', e); }
  });
}
