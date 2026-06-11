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
import faSolidUrl from '@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?url';

// Pre-fetch the FA Solid woff2 and inject it as a base64 @font-face <style> so
// the polyfill's SVG foreignObject renderer always has the font available without
// needing a network fetch at render time (which fails on Quest in immersive mode).
// Production builds already inline fonts via assetsInlineLimit; this covers dev.
fetch(faSolidUrl)
  .then(r => r.blob())
  .then(blob => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  }))
  .then(dataUri => {
    const style = document.createElement('style');
    style.textContent = `@font-face{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:900;src:url('${dataUri}') format('woff2');}`;
    document.head.insertBefore(style, document.head.firstChild);
  })
  .catch(err => console.warn('[SculptXR] FA font preload failed:', err));

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
    if (!force && now - _lastPaintTs < PAINT_MIN_MS) return;
    _lastPaintTs = now;
    orig();
  };
}

function _onPaintEvent() {
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
  if (_paintScheduled || !canvas.requestPaint) return;
  _paintScheduled = true;
  canvas.requestPaint();
}

/**
 * Like requestPaintOnce but bypasses the PAINT_MIN_MS rate limit.
 * Use for immediate visual feedback on user actions (pointerdown/pointerup).
 */
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
