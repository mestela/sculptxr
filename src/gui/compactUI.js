import getOptionsURL from '../misc/getOptionsURL.js';
import { faIcon } from './htmlvr/faIcons.js';

// THE COMPACT (PHONE) LAYOUT.
//
// The desktop chrome is a 380px sidebar plus a top bar, and on a 393px iPhone that left the
// canvas 13px wide. Compact gives the viewport the whole screen and turns both into sheets that
// come up only when asked for: two buttons float over the canvas, Menu (the top-bar menus) and
// Panels (the sidebar).
//
// A RESTYLE, NOT A SEVENTH HOST. The section builders already render through six hosts and
// changes keep landing on some of them and not the rest, so compact moves the EXISTING sidebar and
// top-bar dropdowns with CSS under body.ui-compact. Same DOM, same wiring, different placement.
//
// Settings > Layout: auto (default) / on / off. Auto is any window with a short side under 500px
// or a width under 700px, so a narrowed desktop window shows it too, which is how it gets tested.

const PREF = 'compactUI';
const SHEET_CLASSES = ['cmp-menu-open', 'cmp-panels-open', 'cmp-panels-full'];

let _gui = null;
let _installed = false;

export function compactPref() {
  const v = getOptionsURL()[PREF] ?? getOptionsURL()._rawSaved?.[PREF];
  return v === 'on' || v === 'off' ? v : 'auto';
}

export const isCompact = () => document.body.classList.contains('ui-compact');

// What the docked sidebar takes off the right of the canvas. In compact it is a sheet over the
// canvas, so nothing, even while its (translated, off-screen) rect still has a width.
export function dockedSidebarWidth() {
  if (isCompact()) return 0;
  const sb = document.getElementById('gui-sidebar');
  if (!sb || sb.style.display === 'none') return 0;
  return sb.getBoundingClientRect().width;
}

function wanted() {
  const p = compactPref();
  if (p !== 'auto') return p === 'on';
  return Math.min(window.innerWidth, window.innerHeight) < 500 || window.innerWidth < 700;
}

export function closeCompactSheets() {
  document.body.classList.remove(...SHEET_CLASSES);
  _gui?._closeAllDropdowns?.();
  syncButtons();
}

function syncButtons() {
  const b = document.body.classList;
  document.getElementById('cmp-menu-btn')?.classList.toggle('on', b.contains('cmp-menu-open'));
  document.getElementById('cmp-panels-btn')?.classList.toggle('on', b.contains('cmp-panels-open'));
}

// Re-evaluates the layout. Called on resize and when the Settings choice changes.
export function refreshCompact() {
  const on = wanted();
  if (on === isCompact()) return;
  document.body.classList.toggle('ui-compact', on);
  closeCompactSheets();
  _gui?._onCompactChanged?.(on);
  // Every consumer of the chrome's size (canvas, timeline, modifier button) already listens here.
  window.dispatchEvent(new Event('resize'));
}

function toggleSheet(cls) {
  const was = document.body.classList.contains(cls);
  closeCompactSheets();
  if (!was) document.body.classList.add(cls);
  syncButtons();
}

const CSS = `
#cmp-bar, .cmp-grip { display: none; }
body.ui-compact #cmp-bar { display: block; }
.cmp-btn {
  position: fixed; top: calc(env(safe-area-inset-top) + 6px); z-index: 1200;
  width: 44px; height: 44px; padding: 0; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: #cdd6f4; background: rgba(30, 30, 46, 0.82);
  border: 1px solid rgba(205, 214, 244, 0.28); border-radius: 10px;
  cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none;
}
.cmp-btn.on { color: #89b4fa; background: #313244; }
#cmp-menu-btn { left: calc(env(safe-area-inset-left) + 6px); }
#cmp-panels-btn { right: calc(env(safe-area-inset-right) + 6px); }

/* Top bar: hidden until Menu, then a strip across the top between the two buttons. */
body.ui-compact:not(.cmp-menu-open) #gui-topbar { display: none !important; }
body.ui-compact #gui-topbar {
  left: 0 !important; right: 0 !important; height: auto !important; flex-wrap: wrap;
  padding: calc(env(safe-area-inset-top) + 6px) calc(env(safe-area-inset-right) + 56px) 6px
           calc(env(safe-area-inset-left) + 56px) !important;
  gap: 4px !important;
}
body.ui-compact .desktop-menu-btn { height: 44px; font-size: 14px; flex: 1 1 auto; border-radius: 8px; }
body.ui-compact #desktop-mesh-stats, body.ui-compact #build-version { display: none !important; }

/* A menu opens as a sheet from under the strip (its top is set inline from the button) to the
   bottom of the screen, full width. */
body.ui-compact .desktop-dropdown {
  left: calc(env(safe-area-inset-left) + 6px) !important;
  right: calc(env(safe-area-inset-right) + 6px) !important;
  bottom: calc(env(safe-area-inset-bottom) + 6px);
  max-width: none !important; max-height: none !important; min-width: 0 !important;
}

/* Floating is a desktop arrangement; on a phone a floated section would sit over the model. */
body.ui-compact .mm-section-pin-btn, body.ui-compact .gui-sidebar-grip { display: none !important; }

/* Sidebar: a bottom sheet in portrait. Translated off screen rather than display:none, so its
   sections stay built and wired and it can slide. */
body.ui-compact #gui-sidebar {
  top: auto !important; bottom: 0 !important; left: 0 !important; right: 0 !important;
  width: auto !important; height: 55vh; height: 55dvh;
  display: flex; flex-direction: column; box-sizing: border-box;
  padding-bottom: env(safe-area-inset-bottom);
  border-left: none !important; border-top: 1px solid #2d2d2d; border-radius: 12px 12px 0 0;
  transform: translateY(105%); transition: transform 0.2s ease, height 0.2s ease;
}
body.ui-compact.cmp-panels-open #gui-sidebar { transform: none; }
body.ui-compact.cmp-panels-full #gui-sidebar {
  height: calc(100vh - env(safe-area-inset-top) - 56px);
  height: calc(100dvh - env(safe-area-inset-top) - 56px);
}
body.ui-compact #gui-sidebar > .sidebar-tab-group { flex: 1; min-height: 0; height: auto !important; }
body.ui-compact .cmp-grip {
  display: flex; flex: 0 0 22px; align-items: center; justify-content: center;
  touch-action: none; cursor: grab;
}
.cmp-grip::after { content: ''; width: 40px; height: 5px; border-radius: 3px; background: #585b70; }

/* Landscape phone: too short for a bottom sheet, so it comes in from the right instead. */
@media (orientation: landscape) {
  body.ui-compact #gui-sidebar, body.ui-compact.cmp-panels-full #gui-sidebar {
    top: 0 !important; left: auto !important; height: auto;
    width: min(380px, 60vw) !important; padding-right: env(safe-area-inset-right);
    border-top: none; border-left: 1px solid #2d2d2d !important; border-radius: 0;
    transform: translateX(105%);
  }
  body.ui-compact.cmp-panels-open #gui-sidebar { transform: none; }
  body.ui-compact .cmp-grip { display: none; }
}
`;

// Drag the grip down to put the sheet away, up to take the full height; a tap toggles height.
function wireGrip(grip) {
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    grip.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    const b = document.body.classList;
    if (dy > 40) { if (b.contains('cmp-panels-full')) b.remove('cmp-panels-full'); else closeCompactSheets(); }
    else if (dy < -40) b.add('cmp-panels-full');
    else b.toggle('cmp-panels-full');
    syncButtons();
  });
  grip.addEventListener('pointercancel', () => { y0 = null; });
}

// Called from Gui.initGui once the sidebar exists, and again on every rebuild of the GUI.
export function installCompactUI(gui) {
  _gui = gui;

  if (!document.getElementById('cmp-css')) {
    const style = document.createElement('style');
    style.id = 'cmp-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  if (!document.getElementById('cmp-bar')) {
    const bar = document.createElement('div');
    bar.id = 'cmp-bar';
    bar.innerHTML = `<button class="cmp-btn" id="cmp-menu-btn" title="Menu">${faIcon('bars')}</button>`
      + `<button class="cmp-btn" id="cmp-panels-btn" title="Panels">${faIcon('sliders')}</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#cmp-menu-btn').addEventListener('click', () => toggleSheet('cmp-menu-open'));
    bar.querySelector('#cmp-panels-btn').addEventListener('click', () => toggleSheet('cmp-panels-open'));
  }

  const sb = gui._sidebarEl;
  if (sb && !sb.querySelector('.cmp-grip')) {
    const grip = document.createElement('div');
    grip.className = 'cmp-grip';
    sb.prepend(grip);
    wireGrip(grip);
  }

  if (!_installed) {
    _installed = true;
    let raf = 0;
    window.addEventListener('resize', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; refreshCompact(); });
    });
    // A press on the model while a sheet is up puts the sheet away and is CONSUMED, so the tap
    // meant to dismiss does not also leave a dab on the sculpt. Capture phase on the document runs
    // before the canvas's own handlers; touchstart too, for the gesture recogniser.
    // pointerdown arrives first and closes the sheet, so the touchstart of the SAME press is
    // remembered and eaten too.
    let eatTouch = false;
    const dismiss = (e) => {
      const eat = e.type === 'touchstart' && eatTouch;
      if (e.type === 'touchstart') eatTouch = false;
      if (!eat) {
        if (!isCompact() || !SHEET_CLASSES.some((c) => document.body.classList.contains(c))) return;
        if (e.target?.id !== 'canvas') return;
        closeCompactSheets();
        if (e.type === 'pointerdown' && e.pointerType === 'touch') eatTouch = true;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('touchstart', dismiss, { capture: true, passive: false });
  }

  document.body.classList.toggle('ui-compact', wanted());
}

export function setCompactBarVisible(on) {
  const bar = document.getElementById('cmp-bar');
  if (bar) bar.style.visibility = on ? '' : 'hidden';
}

export function removeCompactBar() {
  document.getElementById('cmp-bar')?.remove();
}
