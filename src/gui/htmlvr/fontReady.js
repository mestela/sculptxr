/**
 * fontReady — fixes intermittent "icons fall off" on the HTML VR panels.
 *
 * The three-html-render polyfill rasterises panels through an SVG <foreignObject>,
 * which only shows FontAwesome glyphs if the web-font is loaded at rasterise time.
 * On a cold load a panel can bake its texture before the woff2 finishes
 * downloading → blank icons that persist (static panels don't re-rasterise).
 * Restarting the dev server just re-rolls the timing + warms the cache.
 *
 * Fix: explicitly load the FA faces, and once they (or any later font) are ready,
 * force every mounted panel to re-rasterise so the glyphs bake in.
 *
 * Also exposes window._repaintAllPanels() as a manual escape hatch.
 */

import { getHostCanvas, requestPaintForced } from './install.js';

// The FontAwesome Free families/weights the icons actually use.
const FA_FONTS = [
  '900 1em "Font Awesome 6 Free"',   // fa-solid
  '400 1em "Font Awesome 6 Free"',   // fa-regular
  '400 1em "Font Awesome 6 Brands"', // fa-brands
];

/** Re-rasterise every mounted HTML panel (host requestPaint dirties all children). */
export function repaintAllPanels() {
  try { requestPaintForced(getHostCanvas()); } catch (_) {}
}

let _wired = false;
export function installFontReadyRepaint() {
  if (_wired) return;
  _wired = true;

  // 1. Force the FA faces to load, then repaint as each set resolves. Without an
  //    explicit load() the browser may defer the font until first paint — exactly
  //    the race we're fixing.
  if (document.fonts?.load) {
    Promise.all(FA_FONTS.map(f => document.fonts.load(f).catch(() => {})))
      .then(repaintAllPanels);
  }

  // 2. Whole font set ready (covers anything loaded after step 1 kicked off).
  document.fonts?.ready?.then?.(repaintAllPanels);

  // 3. Any later font load (HMR reload, late cache miss) → repaint again.
  document.fonts?.addEventListener?.('loadingdone', repaintAllPanels);

  // 4. Manual escape hatch — call from the console if icons ever drop.
  window._repaintAllPanels = repaintAllPanels;
}
