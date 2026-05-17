/**
 * HTMLVRPanel — install.js
 *
 * Singleton module.  MUST be imported before any other three-html-render code.
 * On first import it:
 *   1. Intercepts window.requestAnimationFrame so pending callbacks can be drained
 *      manually inside the XR render loop (Chrome pauses window.rAF in immersive mode).
 *   2. Installs the three-html-render polyfill.
 *   3. Creates a hidden <canvas layoutsubtree> as the shared host for panel DOM elements.
 *
 * NOTE: We intentionally do NOT use ThreeHTMLRenderer.  That class's _uploadTextures()
 * uses texElementImage2D (patched onto WebGLRenderingContext by the polyfill), which
 * binds textures directly on the GL context behind Three.js's state machine, causing
 * state corruption and VR freezes.  Instead, panels manage their own Three.js textures
 * via captureElementImage() + texture.needsUpdate = true.
 *
 * Usage (Scene.js):
 *   import { drainRAF } from './gui/htmlvr/install.js';
 *   // In XR render loop:
 *   drainRAF();   // before renderer.render()
 */

import { installHtmlInCanvasPolyfill } from 'three-html-render/polyfill';

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

// ── 2. Install polyfill ──────────────────────────────────────────────────────
installHtmlInCanvasPolyfill();

// ── 3. Hidden host canvas ────────────────────────────────────────────────────
const _hostCanvas = document.createElement('canvas');
_hostCanvas.setAttribute('layoutsubtree', '');
_hostCanvas.id = '_htmlvr_host';
_hostCanvas.style.cssText =
  'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;' +
  'visibility:hidden;pointer-events:none;';
document.body.appendChild(_hostCanvas);

// ── 4. Panel registry — notified when a paint cycle completes ────────────────
const _panels = new Set();
export function registerPanel(panel)   { _panels.add(panel);    }
export function unregisterPanel(panel) { _panels.delete(panel); }

// When the polyfill finishes rasterising, forward to each registered panel
// so they can pull a fresh bitmap and update their Three.js texture.
_hostCanvas.onpaint = () => {
  for (const panel of _panels) {
    try { panel._onPaint(); } catch (e) { console.warn('[HTMLVRPanel] _onPaint error:', e); }
  }
};

export function getHostCanvas() { return _hostCanvas; }

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
