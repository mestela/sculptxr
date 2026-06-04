/**
 * MainMenuPanel — main VR menu for SculptXR, replacing GuiXR + VRMenu.
 *
 * Layout mirrors the desktop sidebar:
 *
 *   ┌─ top menubar ──────────────────────────────────────────┐
 *   │  Files   History   Reference   Settings   About        │
 *   ├──────┬─────────────────────────────────────────────────┤
 *   │  🏔  │                                                 │
 *   │Scene │                                                 │
 *   │  🔷  │  <content area — scrollable, switches per tab>  │
 *   │ Topo │                                                 │
 *   │  🎨  │                                                 │
 *   │Rndng │                                                 │
 *   │  🖌  │                                                 │
 *   │Sculpt│                                                 │
 *   └──────┴─────────────────────────────────────────────────┘
 *
 * _activeMenu:    null | 'history'|'reference'|'settings'|'about'
 * _activeSection: 'scene'|'topology'|'rendering'|'sculpting'
 *
 * When _activeMenu is non-null, content shows the top-menu content.
 * Clicking any side tab closes the menu and shows that section.
 * The panel is fixed height — content scrolls inside the body.
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import Enums        from '../../misc/Enums.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import Shader       from '../../render/ShaderLib.js';
import Remesh       from '../../editing/Remesh.js';
import Picking      from '../../math3d/Picking.js';
import { toolTextTint } from './toolTints.js';
import Tablet from '../../misc/Tablet.js';
import TR from '../GuiTR.js';
import { VERSION } from '../../Version.js';
import releaseText from '../../../docs/releases.md?raw';
import {
  injectAnimCSS,
  buildAnimationSectionHTML,
  wireAnimationSection,
  syncAnimationSection,
  refreshBlendshapesDOM,
} from './AnimationControlPanel.js';

// ── Dimensions ───────────────────────────────────────────────────────────────
export const MM_W  = 480;   // total DOM width  (px)
const MM_TABS_W    = 50;    // left tab-strip width
const MM_MENUBAR_H = 44;    // top menubar height (px) — must match actual rendered height
// Body height is fixed so the mesh never changes dimensions on tab switch.
const MM_BODY_H    = 456;   // height below menubar (scrollable content lives here)

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
#mm-root {
  /* width + height are set as inline styles in the constructor so they survive
     the polyfill's SVG foreignObject serialisation.  The CSS selector here is
     kept for fallback / non-VR use only. */
  width: ${MM_W}px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  border: 2px solid #585b70;
  overflow: hidden;
  user-select: none;
  /* position:absolute is injected by the polyfill; position:relative makes the
     element a containing block for its absolutely-positioned children when it
     renders normally (desktop overlay etc). */
  position: relative;
}

/* ── Top menubar ─────────────────────────────────────────────── */
/* Absolute positioning avoids dependence on display:flex on #mm-body, which
   can fail silently inside Chrome SVG foreignObject rendering. */
#mm-menubar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: ${MM_MENUBAR_H}px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 2px solid #45475a;
  background: #11111b;
  box-sizing: border-box;
}
.mm-menu-btn {
  padding: 5px 11px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
}
.mm-menu-btn:hover, .mm-menu-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-menu-btn.active {
  background: #45475a;
  color: #89b4fa;
  border-color: #89b4fa;
}
.mm-pin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 7px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.mm-pin-btn:hover, .mm-pin-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-pin-btn.active {
  background: rgba(203,166,247,0.15);
  color: #cba6f7;
  border-color: #cba6f7;
}

/* ── Body (tab strip + content) ──────────────────────────────── */
#mm-body {
  position: absolute;
  top: ${MM_MENUBAR_H}px;
  left: 0; right: 0;
  height: ${MM_BODY_H}px;
}

/* ── Left tab strip ──────────────────────────────────────────── */
#mm-tabstrip {
  position: absolute;
  top: 0; left: 0;
  width: ${MM_TABS_W}px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 5px;
  gap: 4px;
  border-right: 2px solid #45475a;
  background: #11111b;
  box-sizing: border-box;
  overflow: hidden;
}
.mm-tab-btn {
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #1e1e2e;
  color: #cdd6f4;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mm-tab-btn svg { pointer-events: none; }
.mm-tab-btn:hover, .mm-tab-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-tab-btn.active {
  background: rgba(137,180,250,0.25);
  color: #89b4fa;
  border-color: #89b4fa;
  font-weight: 800;
}
.mm-tab-btn.torn {
  opacity: 0.3;
  pointer-events: none;
}
.mm-tab-slot {
  position: relative;
  width: 38px;
  flex-shrink: 0;
}
.mm-tab-pin {
  position: absolute;
  bottom: -1px; right: -1px;
  width: 16px; height: 16px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 3px;
  background: #11111b;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.mm-tab-pin:hover, .mm-tab-pin.hover { background: #313244; color: #cba6f7; border-color: #cba6f7; }

/* ── Content area ────────────────────────────────────────────── */
#mm-content {
  position: absolute;
  top: 0;
  left: ${MM_TABS_W}px;
  right: 0; bottom: 0;
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 8px 10px 8px 10px;
  box-sizing: border-box;
  scrollbar-width: thick;
  scrollbar-color: #585b70 #1e1e2e;
}
#mm-content::-webkit-scrollbar { width: 10px; background: #1e1e2e; }
#mm-content::-webkit-scrollbar-thumb { background: #585b70; border-radius: 5px; min-height: 32px; }
#mm-content::-webkit-scrollbar-thumb:hover { background: #7f849c; }
#mm-content::-webkit-scrollbar-track { background: #1e1e2e; }

/* ── Shared content primitives ───────────────────────────────── */
.mm-section-title {
  font-size: 10px;
  font-weight: 700;
  color: #6c7086;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 8px 0 4px;
  border-bottom: 1px solid #313244;
  margin-bottom: 6px;
}
.mm-section-title:first-child { padding-top: 0; }

.mm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.mm-lbl {
  flex: 1;
  font-size: 11px;
  color: #a6adc8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-val {
  width: 34px;
  text-align: right;
  font-size: 10px;
  color: #7f849c;
  flex-shrink: 0;
}
.mm-row input[type=range] {
  flex: 1;
  accent-color: #89b4fa;
  height: 4px;
  cursor: pointer;
  min-width: 0;
}

/* Toggle (checkbox replacement) */
.mm-toggle {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #313244;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  outline: none;
  margin-bottom: 3px;
}
.mm-toggle:hover, .mm-toggle.hover { filter: brightness(1.2); }
.mm-toggle.active {
  background: rgba(137,180,250,0.2);
  color: #89b4fa;
  border-color: #89b4fa;
}

/* Choice grid (combobox replacement) */
.mm-choice-grid {
  display: grid;
  gap: 3px;
  margin-bottom: 6px;
}
.mm-choice-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.mm-choice-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.mm-choice-grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
.mm-choice {
  padding: 6px 4px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #313244;
  color: #a6adc8;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
}
.mm-choice:hover, .mm-choice.hover { filter: brightness(1.2); }
.mm-choice.active {
  background: rgba(137,180,250,0.2);
  color: #89b4fa;
  border-color: #89b4fa;
}

/* Action button */
.mm-action-btn {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #cdd6f4;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  outline: none;
  margin-bottom: 3px;
  box-sizing: border-box;
}
.mm-transport {
  display: flex;
  gap: 3px;
  margin-bottom: 6px;
}
.mm-transport-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #cdd6f4;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  outline: none;
  box-sizing: border-box;
}
.mm-transport-btn:hover, .mm-transport-btn.hover { background: #313244; border-color: #7f849c; }
.mm-transport-btn:active, .mm-transport-btn.active { background: #45475a; }
.mm-transport-btn.record { color: #f38ba8; }
.mm-action-btn:hover, .mm-action-btn.hover { background: #313244; }
.mm-action-btn.danger { color: #f38ba8; border-color: #f38ba8; }
.mm-action-btn.danger:hover, .mm-action-btn.danger.hover { background: rgba(243,139,168,0.15); }

/* Two-button row */
.mm-btn-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 3px;
}
.mm-btn-pair .mm-action-btn { margin-bottom: 0; }

/* ── Custom select (VR-safe dropdown) ──────────────────────────── */
.mm-select { width: 100%; margin-bottom: 3px; }
.mm-select-trigger {
  width: 100%; padding: 5px 8px; box-sizing: border-box;
  background: #2a2a3e; color: #cdd6f4; border: 1px solid #45475a;
  border-radius: 4px; font-size: 11px; cursor: pointer; text-align: left;
  display: flex; justify-content: space-between; align-items: center;
  outline: none;
}
.mm-select-trigger::after { content: ' ▾'; flex-shrink: 0; color: #7f849c; }
.mm-select-trigger:hover, .mm-select-trigger.hover { border-color: #7f849c; }
.mm-select-opts {
  border: 1px solid #45475a; border-top: none;
  border-radius: 0 0 4px 4px; background: #1e1e2e; overflow: hidden;
}
.mm-select-opt {
  display: block; width: 100%; text-align: left; padding: 6px 12px;
  background: transparent; color: #a6adc8; border: none; font-size: 11px;
  cursor: pointer; box-sizing: border-box; outline: none;
}
.mm-select-opt:hover, .mm-select-opt.hover { background: #313244; color: #cdd6f4; }
.mm-select-opt.active { color: #89b4fa; background: rgba(137,180,250,0.08); }

/* Outliner item (scene tab) */
.mm-outliner-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
  border-bottom: 1px solid #313244;
}
.mm-vis-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 1px solid #45475a;
  border-radius: 4px;
  background: #313244;
  color: #cdd6f4;
  font-size: 11px;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.mm-vis-btn.hidden { color: #45475a; }
.mm-mesh-btn {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #a6adc8;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  outline: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-mesh-btn:hover, .mm-mesh-btn.hover { background: #313244; color: #cdd6f4; }
.mm-mesh-btn.active { color: #89b4fa; background: rgba(137,180,250,0.1); border-color: rgba(137,180,250,0.2); }

/* Info / placeholder */
.mm-info {
  font-size: 11px;
  color: #6c7086;
  padding: 6px 0;
  font-style: italic;
}

/* Storage gallery */
.mm-storage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
  margin-bottom: 6px;
}
.mm-storage-item {
  border: 1px solid #313244;
  border-radius: 5px;
  overflow: hidden;
  background: #181825;
}
.mm-storage-item img {
  width: 100%;
  aspect-ratio: 1;
  display: block;
  object-fit: cover;
}
.mm-storage-date {
  display: block;
  font-size: 8px;
  color: #6c7086;
  text-align: center;
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-storage-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
}
.mm-storage-btns .mm-action-btn {
  font-size: 9px;
  padding: 3px 4px;
  margin-bottom: 0;
  text-align: center;
}

/* Conditional sections (Rendering) */
.mm-if-pbr, .mm-if-matcap, .mm-if-uv { display: none; }
.shader-pbr    .mm-if-pbr    { display: block; }
.shader-matcap .mm-if-matcap { display: block; }
.shader-uv     .mm-if-uv     { display: block; }

/* ── TornOffPanel (floating section panels) ───────── */
.mm-torn-root {
  width: 480px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  border: 2px solid #cba6f7;
  overflow: hidden;
  user-select: none;
  position: relative;
}
.mm-torn-header {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: #11111b;
  border-bottom: 2px solid #45475a;
  box-sizing: border-box;
  gap: 6px;
}
.mm-torn-title {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  color: #cba6f7;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mm-torn-redock {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px; height: 26px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.mm-torn-redock:hover, .mm-torn-redock.hover {
  background: #313244;
  color: #cba6f7;
  border-color: #cba6f7;
}
.mm-torn-content {
  background: #1e1e2e;
  color: #cdd6f4;
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 8px 10px;
  box-sizing: border-box;
  scrollbar-width: thick;
  scrollbar-color: #585b70 #1e1e2e;
}
.mm-torn-content::-webkit-scrollbar { width: 10px; background: #1e1e2e; }
.mm-torn-content::-webkit-scrollbar-thumb { background: #585b70; border-radius: 5px; }
`;

let _mmCssInjected = false;
export function injectMMCSS() {
  if (_mmCssInjected) return;
  _mmCssInjected = true;
  injectAnimCSS();
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}
// Internal alias used by the class constructor.
function injectCSS() { injectMMCSS(); }

// ── Custom VR-safe select helpers ──────────────────────────────────────────────
// Replaces native <select> (which can't open inside a WebGL texture) with an
// inline accordion list that responds to the same click/pointer events.

export function buildSelectHTML(id, options, currentVal) {
  const cur = String(currentVal);
  const label = options.find(o => String(o.val) === cur)?.label ?? options[0]?.label ?? '';
  const opts = options.map(o =>
    `<button class="mm-select-opt${String(o.val) === cur ? ' active' : ''}" data-val="${o.val}">${o.label}</button>`
  ).join('');
  return `<div class="mm-select" id="${id}-wrap">
    <button class="mm-select-trigger" id="${id}">${label}</button>
    <div class="mm-select-opts" style="display:none">${opts}</div>
  </div>`;
}

export function wireSelect(el, id, callback, repaintFn) {
  const wrap    = el.querySelector(`#${id}-wrap`);
  if (!wrap) return;
  const trigger = wrap.querySelector(`#${id}`);
  const optsEl  = wrap.querySelector('.mm-select-opts');

  trigger?.addEventListener('click', () => {
    optsEl.style.display = optsEl.style.display === 'none' ? '' : 'none';
    repaintFn?.();
  });

  wrap.querySelectorAll('.mm-select-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      if (trigger) trigger.childNodes[0].textContent = btn.textContent;
      optsEl.style.display = 'none';
      wrap.querySelectorAll('.mm-select-opt').forEach(b => b.classList.toggle('active', b === btn));
      callback(btn.dataset.val);
      repaintFn?.();
    });
  });
}

// ── Shell HTML (static structure only; content area is filled dynamically) ──
function buildShellHTML() {
  return `
    <div id="mm-menubar">
      <button class="mm-menu-btn" data-menu="files">Files</button>
      <button class="mm-menu-btn" data-menu="history">History</button>
      <button class="mm-menu-btn" data-menu="background">Background</button>
      <button class="mm-menu-btn" data-menu="reference">Reference</button>
      <button class="mm-menu-btn" data-menu="settings">Settings</button>
      <button class="mm-menu-btn" data-menu="about">About</button>
      <div style="flex:1"></div>
      <button class="mm-pin-btn" id="mm-pin-btn" title="Pin panel in world space">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
      </button>
    </div>
    <div id="mm-body">
      <div id="mm-tabstrip">
        <div class="mm-tab-slot">
          <button class="mm-tab-btn" data-section="scene" title="Scene">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="3.27" y1="6.96" x2="12" y2="12.01"/><line x1="12" y1="12.01" x2="20.73" y2="6.96"/><line x1="12" y1="22.08" x2="12" y2="12.01"/></svg>
          </button>
          <button class="mm-tab-pin" data-section="scene" title="Float panel">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          </button>
        </div>
        <div class="mm-tab-slot">
          <button class="mm-tab-btn" data-section="rendering" title="Rendering">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <button class="mm-tab-pin" data-section="rendering" title="Float panel">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          </button>
        </div>
        <div class="mm-tab-slot">
          <button class="mm-tab-btn" data-section="topology" title="Topology">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="mm-tab-pin" data-section="topology" title="Float panel">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          </button>
        </div>
        <div class="mm-tab-slot">
          <button class="mm-tab-btn active" data-section="sculpting" title="Sculpting">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3z"/><path d="M9 8c-2 3-4 3.5-7 4l8 8c1-.5 3.5-2 4-7"/><path d="M14.5 17.5 4.5 15"/></svg>
          </button>
          <button class="mm-tab-pin" data-section="sculpting" title="Float panel">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          </button>
        </div>
        <div class="mm-tab-slot">
          <button class="mm-tab-btn" data-section="animation" title="Animation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>
          </button>
          <button class="mm-tab-pin" data-section="animation" title="Float panel">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          </button>
        </div>
      </div>
      <div id="mm-content"></div>
    </div>
  `;
}

// ── Content builders ─────────────────────────────────────────────────────────

export function buildMenuHTML_files(main) {
  const guiFiles  = main.getGui?.()._ctrlFiles ?? null;
  const exportAll = guiFiles?._exportAll ?? true;
  const objZbrush = guiFiles?._objColorZbrush ?? false;
  const objAppend = guiFiles?._objColorAppended ?? false;

  return `
    <button class="mm-action-btn" id="mm-browser-saves">Browser Saves…</button>

    <div class="mm-section-title">Import</div>
    <button class="mm-action-btn" id="mm-import-obj">Add mesh (obj, sgl, ply, stl)</button>
    <button class="mm-toggle${main._autoMatrix ? ' active' : ''}" id="mm-import-scale">Scale & center on import</button>
    <button class="mm-toggle${main._vertexSRGB ? ' active' : ''}" id="mm-import-srgb">sRGB vertex colour</button>

    <div class="mm-section-title">Export</div>
    <button class="mm-toggle${exportAll ? ' active' : ''}" id="mm-export-all">Export all meshes</button>
    <button class="mm-action-btn" id="mm-export-sxr">Save .sxr</button>
    <button class="mm-action-btn" id="mm-export-glb">Save .glb</button>
    <button class="mm-action-btn" id="mm-export-obj">Save .obj</button>
    <button class="mm-action-btn" id="mm-export-ply">Save .ply</button>
    <button class="mm-action-btn" id="mm-export-stl">Save .stl</button>
    <button class="mm-toggle${objZbrush ? ' active' : ''}" id="mm-obj-zbrush">OBJ colour ZBrush mode</button>
    <button class="mm-toggle${objAppend ? ' active' : ''}" id="mm-obj-append">OBJ colour append mode</button>

    <div class="mm-section-title">Export textures</div>
    <div class="mm-row">
      <span class="mm-lbl">Size (2^n)</span>
      <input type="range" id="mm-tex-size" min="8" max="13" step="1" value="10">
      <span class="mm-val" id="mm-tex-size-val">1024</span>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-save-diffuse">Diffuse</button>
      <button class="mm-action-btn" id="mm-save-roughness">Roughness</button>
    </div>
    <button class="mm-action-btn" id="mm-save-metalness">Metalness</button>
  `;
}

export function buildMenuHTML_history(main) {
  const sm  = main.getStateManager?.() ?? main._stateManager;
  const maxV = /OculusBrowser/.test(navigator.userAgent) ? 30 : 500;
  const cur  = sm?.limit ?? 50;
  const pct  = Math.max(0, Math.min(100, ((cur - 3) / (maxV - 3)) * 100));
  return `
    <div class="mm-section-title">History</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-undo">↩ Undo</button>
      <button class="mm-action-btn" id="mm-redo">↪ Redo</button>
    </div>
    <div class="mm-section-title">Settings</div>
    <div class="mm-row">
      <span class="mm-lbl">Max undo steps</span>
      <input type="range" id="mm-stack-size" min="3" max="${maxV}" step="1" value="${cur}">
      <span class="mm-val" id="mm-stack-val">${cur}</span>
    </div>
  `;
}

export function buildMenuHTML_reference() {
  return `
    <div class="mm-section-title">Reference Images</div>
    <button class="mm-action-btn" id="mm-ref-add">Add reference image…</button>
    <button class="mm-action-btn" id="mm-ref-clear">Clear all references</button>
    <button class="mm-toggle" id="mm-ref-show">Show references</button>
  `;
}

function buildMenuHTML_settings(main) {
  const gx  = main._guiXR ?? main.getGuiXR?.();
  const ui  = gx?._uiSettings ?? {};
  const opts = getOptionsURL();

  const triggerCurve  = ui.triggerCurve    ?? opts.triggerCurve    ?? 0.5;
  const stylusLength  = ui.stylusLength    ?? opts.stylusLength    ?? 0.10;
  const stylusOffset  = ui.stylusOffset    ?? opts.stylusOffset    ?? 0.0;
  const stylusTilt    = ui.stylusTilt      ?? opts.stylusTilt      ?? 0;
  const gizmoScale    = opts.gizmoScale    ?? 15.625;
  const offsetY       = ui.offsetY         ?? opts.offsetY         ?? -1.2;
  const wfBias        = ui.wireframeBias   ?? opts.wireframeBias   ?? 0.001;
  const wfAlpha       = ui.wireframeAlpha  ?? opts.wireframeAlpha  ?? 0.2;
  const menuBright    = ui.menuBrightness  ?? 0.5;
  const menuSat       = ui.menuSaturation  ?? 0.5;
  const debugMode     = ui.debugMode       ?? false;

  const isLeft      = main._dominantHand === 'left';
  const isRaycast   = !main._vrUseVolumeIntersect;
  const isAmbi      = !!main._vrAmbidextrousCursors;

  // Controller options
  const ctrlModels = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
    'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
    'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
  const ctrlLabels = ['Auto','Quest+','Quest+ v2','Quest Pro','Touch v3','Touch v2',
    'Index','Vive','GalaxyXR','Odyssey'];
  const curCtrl = Math.max(0, ctrlModels.indexOf(window._xrControllerOverride ?? 'Auto'));

  const wfTypes = [
    { id: 1, label: 'Smooth' },
    { id: 0, label: 'Fast'   },
    { id: 2, label: 'Full'   },
  ];
  const curWfType = main.getMesh?.()?.getWireframeType?.() ?? 1;

  const wfTypeBtns = wfTypes.map(t =>
    `<button class="mm-choice${curWfType === t.id ? ' active' : ''}" data-wf-type="${t.id}">${t.label}</button>`
  ).join('');

  return `
    <div class="mm-section-title">Input</div>
    <button class="mm-toggle${isLeft    ? ' active' : ''}" id="mm-left-hand">Left Hand Mode</button>
    <button class="mm-toggle${isRaycast ? ' active' : ''}" id="mm-raycast">Aim Picking (Raycast)</button>
    <button class="mm-toggle${isAmbi    ? ' active' : ''}" id="mm-ambi">Ambidextrous Cursors</button>

    <div class="mm-row">
      <span class="mm-lbl">Trigger sensitivity</span>
      <input type="range" id="mm-trigger" min="0" max="100" step="5" value="${Math.round(triggerCurve*100)}">
      <span class="mm-val" id="mm-trigger-val">${Math.round(triggerCurve*100)}%</span>
    </div>

    <div class="mm-section-title">Stylus</div>
    <div class="mm-row">
      <span class="mm-lbl">Length</span>
      <input type="range" id="mm-stylus-len" min="0" max="30" step="1" value="${Math.round(stylusLength*100)}">
      <span class="mm-val" id="mm-stylus-len-val">${Math.round(stylusLength*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Z-Shift</span>
      <input type="range" id="mm-stylus-off" min="-15" max="15" step="1" value="${Math.round(stylusOffset*100)}">
      <span class="mm-val" id="mm-stylus-off-val">${Math.round(stylusOffset*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Tilt</span>
      <input type="range" id="mm-stylus-tilt" min="-45" max="45" step="1" value="${Math.round(stylusTilt)}">
      <span class="mm-val" id="mm-stylus-tilt-val">${Math.round(stylusTilt)}°</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Gizmo scale</span>
      <input type="range" id="mm-gizmo-scale" min="5" max="100" step="1" value="${Math.round(gizmoScale)}">
      <span class="mm-val" id="mm-gizmo-val">${Math.round(gizmoScale)}</span>
    </div>

    <div class="mm-section-title">Calibration</div>
    <div class="mm-row">
      <span class="mm-lbl">Head height</span>
      <input type="range" id="mm-head-height" min="-200" max="0" step="10" value="${Math.round(offsetY*100)}">
      <span class="mm-val" id="mm-head-height-val">${offsetY.toFixed(1)}</span>
    </div>

    <div class="mm-section-title">Controller Model</div>
    ${buildSelectHTML('mm-ctrl-model', ctrlModels.map((m, i) => ({ val: i, label: ctrlLabels[i] })), curCtrl)}

    <div class="mm-section-title">Wireframe</div>
    <div class="mm-row">
      <span class="mm-lbl">Bias</span>
      <input type="range" id="mm-wf-bias" min="0" max="50" step="1" value="${Math.round(wfBias*10000)}">
      <span class="mm-val" id="mm-wf-bias-val">${wfBias.toFixed(4)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Opacity</span>
      <input type="range" id="mm-wf-alpha" min="0" max="100" step="5" value="${Math.round(wfAlpha*100)}">
      <span class="mm-val" id="mm-wf-alpha-val">${Math.round(wfAlpha*100)}%</span>
    </div>
    <div class="mm-choice-grid cols-3">${wfTypeBtns}</div>

    <div class="mm-section-title">Menu</div>
    <div class="mm-row">
      <span class="mm-lbl">Brightness</span>
      <input type="range" id="mm-menu-bright" min="0" max="100" step="5" value="${Math.round(menuBright*100)}">
      <span class="mm-val" id="mm-menu-bright-val">${Math.round(menuBright*100)}%</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Saturation</span>
      <input type="range" id="mm-menu-sat" min="0" max="100" step="5" value="${Math.round(menuSat*100)}">
      <span class="mm-val" id="mm-menu-sat-val">${Math.round(menuSat*100)}%</span>
    </div>

    <div class="mm-section-title">Debug</div>
    <button class="mm-toggle${debugMode ? ' active' : ''}" id="mm-debug-mode">Debug Mode (HUD Logs)</button>
    <button class="mm-action-btn" id="mm-perf-profile">Log Perf Profile (120f)</button>
  `;
}

export function buildMenuHTML_about() {
  const releaseHTML = (() => {
    try {
      const lines = releaseText.split('\n');
      let html = '';
      let releases = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('# ')) {
          if (releases >= 3) break;
          releases++;
          html += `<div style="color:#89b4fa;font-weight:600;font-size:12px;margin-top:6px">${line.slice(2)}</div>`;
        } else if (line.startsWith('- ')) {
          html += `<div style="color:#a6adc8;font-size:11px;margin:1px 0 1px 6px">• ${line.slice(2).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</div>`;
        }
      }
      return html;
    } catch { return ''; }
  })();

  return `
    <div class="mm-section-title">About SculptXR ${VERSION}</div>
    <div style="color:#a6adc8;font-size:11px;margin-bottom:4px">Original by Stéphane Ginier<br>VR port by Matt Estela &amp; Antigravity &amp; Claude</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-about-tokeru">tokeru.com/sculptxr</button>
      <button class="mm-action-btn" id="mm-about-github">GitHub</button>
    </div>
    <div class="mm-section-title">Recent Changes</div>
    <div id="mm-release-notes" style="max-height:200px;overflow-y:auto">${releaseHTML}</div>
  `;
}

export function wireMenuAbout(el) {
  el.querySelector('#mm-about-tokeru')?.addEventListener('click', () => window.open('https://tokeru.com/sculptxr', '_blank'));
  el.querySelector('#mm-about-github') ?.addEventListener('click', () => window.open('https://github.com/mestela/sculptxr', '_blank'));
}

// ── Section content builders ─────────────────────────────────────────────────

export function buildSectionHTML_scene(main) {
  const meshes   = main.getMeshes?.() ?? [];
  const selected = main.getSelectedMeshes?.() ?? [];

  let meshRows = '';
  let count = 0;
  for (const m of meshes) {
    if (m._isVoxelChunk) continue;
    count++;
    if (!m._permanentStaticLabel) {
      m._permanentStaticLabel = m.uiName || m._uiName || `${m._typeName || 'Mesh'} ${count}`;
    }
    if (!m._permanentStaticId) {
      m._permanentStaticId = 'm_' + Math.random().toString(36).slice(2, 9);
    }
    const vis   = m.isVisible?.() ?? true;
    const isSel = selected.includes(m);
    meshRows += `
      <div class="mm-outliner-row">
        <button class="mm-vis-btn${vis ? '' : ' hidden'}" data-mesh-id="${m._permanentStaticId}" data-action="vis">
          ${vis ? '👁' : '·'}
        </button>
        <button class="mm-mesh-btn${isSel ? ' active' : ''}" data-mesh-id="${m._permanentStaticId}" data-action="select">
          ${m._permanentStaticLabel}
        </button>
      </div>`;
  }

  if (!meshRows) meshRows = '<div class="mm-info">No meshes in scene</div>';

  const isConfirming = !!main._clearSceneConfirm;
  return `
    <div class="mm-section-title">Outliner</div>
    ${meshRows}
    <div class="mm-section-title">Scene</div>
    <button class="mm-action-btn" id="mm-add-sphere">Add sphere</button>
    <button class="mm-action-btn" id="mm-add-cube">Add cube</button>
    <button class="mm-action-btn danger" id="mm-clear-scene">
      ${isConfirming ? 'Confirm clear (no undo)' : 'Clear scene…'}
    </button>
    <div class="mm-section-title">Mesh</div>
    <button class="mm-action-btn" id="mm-duplicate">Duplicate selected</button>
    <button class="mm-action-btn danger" id="mm-delete-mesh">Delete selected</button>
  `;
}

export function buildSectionHTML_topology(main) {
  const mesh   = main.getMesh?.();
  const isMulti = !!(mesh?._meshes);
  const isDyn   = !!(mesh?.isDynamic);
  const numLvl  = isMulti ? mesh._meshes.length : 0;
  const curLvl  = isMulti ? mesh._sel : 0;

  const res = Remesh.RESOLUTION;

  let multiInfo = isMulti
    ? `<div class="mm-info">Level ${curLvl} of ${numLvl - 1} — ${mesh.getNbVertices?.()?.toLocaleString() ?? '?'} vertices</div>`
    : '';

  return `
    <div class="mm-section-title">Multiresolution</div>
    ${multiInfo}
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-level-down" ${isMulti && curLvl > 0 ? '' : 'disabled'}>Level −</button>
      <button class="mm-action-btn" id="mm-level-up"   ${isMulti && curLvl < numLvl - 1 ? '' : 'disabled'}>Level +</button>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-subdivide" ${mesh ? '' : 'disabled'}>Subdivide</button>
      <button class="mm-action-btn" id="mm-reverse"   ${isMulti && curLvl === 0 ? '' : 'disabled'}>Reverse</button>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn danger" id="mm-del-lower"  ${isMulti && curLvl > 0 ? '' : 'disabled'}>Del Lower</button>
      <button class="mm-action-btn danger" id="mm-del-higher" ${isMulti && curLvl < numLvl - 1 ? '' : 'disabled'}>Del Higher</button>
    </div>

    <div class="mm-section-title">Remesh (SurfaceNets)</div>
    <div class="mm-row">
      <span class="mm-lbl">Resolution</span>
      <input type="range" id="mm-remesh-res" min="8" max="400" step="1" value="${res}">
      <span class="mm-val" id="mm-remesh-res-val">${res}</span>
    </div>
    <button class="mm-toggle${Remesh.BLOCK ? ' active' : ''}" id="mm-remesh-block">Block mode</button>
    <button class="mm-action-btn" id="mm-remesh" ${mesh ? '' : 'disabled'}>Remesh</button>

    <div class="mm-section-title">Remesh (Marching Cubes)</div>
    <button class="mm-toggle${Remesh.SMOOTHING ? ' active' : ''}" id="mm-remesh-smooth">Smoothing</button>
    <button class="mm-action-btn" id="mm-remesh-mc" ${mesh ? '' : 'disabled'}>Remesh MC</button>

    <div class="mm-section-title">Dynamic Topology</div>
    <button class="mm-toggle${isDyn ? ' active' : ''}" id="mm-dynamic">Dynamic Topology</button>

    <div class="mm-section-title">Voxel</div>
    <button class="mm-action-btn" id="mm-mesh-to-voxels" ${mesh ? '' : 'disabled'}>Mesh → Voxels</button>

    <div class="mm-section-title">Mesh Health</div>
    <button class="mm-action-btn" id="mm-validate">Validate Manifold</button>
    <button class="mm-toggle" id="mm-auto-heal">Auto heal on remesh</button>
  `;
}

export function buildSectionHTML_rendering(main) {
  const mesh = main.getMesh?.();
  if (!mesh) return '<div class="mm-info">No mesh selected</div>';

  const ShaderPBR    = Shader[Enums.Shader.PBR];
  const ShaderMATCAP = Shader[Enums.Shader.MATCAP];
  const shaderType   = mesh.getShaderType?.() ?? Enums.Shader.PBR;

  const shaders = [
    { id: Enums.Shader.MATCAP, label: 'Matcap' },
    { id: Enums.Shader.PBR,    label: 'PBR'    },
    { id: Enums.Shader.FLAT,   label: 'Flat'   },
    { id: Enums.Shader.NORMAL, label: 'Normal' },
    { id: Enums.Shader.UV,     label: 'UV'     },
  ];
  const shaderBtns = shaders.map(s =>
    `<button class="mm-choice${shaderType === s.id ? ' active' : ''}" data-shader="${s.id}">${s.label}</button>`
  ).join('');

  const toneMaps = [
    { id: 0, label: 'None' }, { id: 1, label: 'Linear' }, { id: 2, label: 'Reinhard' },
    { id: 3, label: 'Cineon' }, { id: 4, label: 'ACES' },
  ];
  const curTM = main.getToneMapping?.() ?? 0;
  const tmBtns = toneMaps.map(t =>
    `<button class="mm-choice${curTM === t.id ? ' active' : ''}" data-tonemap="${t.id}">${t.label}</button>`
  ).join('');

  const exposure    = main.getExposure?.() ?? 1.0;
  const curvature   = mesh.getCurvature?.() ?? 0;
  const opacity     = mesh.getOpacity?.() ?? 1;
  const isFlat      = mesh.getFlatShading?.() ?? false;
  const isWire      = mesh.getShowWireframe?.() ?? false;
  const isSolid     = mesh._renderData?._threeMesh?.material?.visible ?? true;

  // PBR — environment list
  const envBtns = (ShaderPBR?.environments ?? []).map((env, i) =>
    `<button class="mm-choice${ShaderPBR.idEnv === i ? ' active' : ''}" data-env="${i}">${env.name}</button>`
  ).join('');

  // Matcap list
  const matcapBtns = (ShaderMATCAP?.matcaps ?? []).map((m, i) =>
    `<button class="mm-choice${mesh.getMatcap?.() === i ? ' active' : ''}" data-matcap="${i}">${m.name}</button>`
  ).join('');

  // Shader-class on the root div drives .mm-if-pbr / .mm-if-matcap / .mm-if-uv visibility
  const shaderClass = shaderType === Enums.Shader.PBR    ? 'shader-pbr'
                    : shaderType === Enums.Shader.MATCAP  ? 'shader-matcap'
                    : shaderType === Enums.Shader.UV       ? 'shader-uv'
                    : '';

  // Camera
  const camera  = main.getCamera?.() ?? main._camera;
  const proj    = camera?.getProjectionType?.() ?? 0;
  const fov     = camera?.getFov?.() ?? 45;
  const mode    = camera?.getMode?.() ?? 0;
  const pivot   = camera?.getUsePivot?.() ?? false;
  const vmode   = main._spectatorViewMode ?? 0;
  const skipMap = { 0: 0, 1: 1, 3: 2, 7: 3 };
  const fps     = skipMap[main._spectatorFrameSkip ?? 3] ?? 2;
  const speed   = main._cameraSpeed ?? 0.3;

  return `
    <div id="mm-render-root" class="${shaderClass}">
      <div class="mm-section-title">Shader</div>
      <div class="mm-choice-grid cols-5">${shaderBtns}</div>

      <div class="mm-if-pbr">
        <div class="mm-section-title">Environment</div>
        <div class="mm-choice-grid cols-2" id="mm-env-grid">${envBtns}</div>
      </div>

      <div class="mm-if-matcap">
        <div class="mm-section-title">Matcap</div>
        <div class="mm-choice-grid cols-2" id="mm-matcap-grid">${matcapBtns}</div>
        <button class="mm-action-btn" id="mm-import-matcap">Import matcap…</button>
      </div>

      <div class="mm-if-uv">
        <div class="mm-section-title">Texture</div>
        <button class="mm-action-btn" id="mm-import-uv">Import UV texture…</button>
      </div>

      <div class="mm-section-title">Display</div>
      <button class="mm-toggle${main._showGrid ? ' active' : ''}" id="mm-grid-toggle">
        Ground Plane ${main._showGrid ? '✓ On' : 'Off'}
      </button>
      <div class="mm-row">
        <span class="mm-lbl">Curvature</span>
        <input type="range" id="mm-curvature" min="0" max="100" step="1" value="${Math.round(curvature * 20)}">
        <span class="mm-val" id="mm-curvature-val">${Math.round(curvature * 20)}</span>
      </div>
      <div class="mm-row">
        <span class="mm-lbl">Transparency</span>
        <input type="range" id="mm-transparency" min="0" max="100" step="1" value="${Math.round((1-opacity)*100)}">
        <span class="mm-val" id="mm-transparency-val">${Math.round((1-opacity)*100)}%</span>
      </div>
      <button class="mm-toggle${isFlat  ? ' active' : ''}" id="mm-flat-shading">Flat Shading</button>
      <button class="mm-toggle${isWire  ? ' active' : ''}" id="mm-wireframe">Wireframe</button>
      <button class="mm-toggle${isSolid ? ' active' : ''}" id="mm-solid">Solid Shading</button>

      <div class="mm-section-title">Tone Mapping</div>
      <div class="mm-choice-grid cols-5">${tmBtns}</div>

      <div class="mm-row">
        <span class="mm-lbl">Exposure</span>
        <input type="range" id="mm-exposure" min="0" max="300" step="5" value="${Math.round(exposure*100)}">
        <span class="mm-val" id="mm-exposure-val">${exposure.toFixed(2)}</span>
      </div>

      <div class="mm-section-title">Camera Reset</div>
      <div class="mm-btn-pair">
        <button class="mm-action-btn" id="mm-cam-center">Center</button>
        <button class="mm-action-btn" id="mm-cam-front">Front</button>
      </div>
      <div class="mm-btn-pair">
        <button class="mm-action-btn" id="mm-cam-left">Left</button>
        <button class="mm-action-btn" id="mm-cam-top">Top</button>
      </div>

      <div class="mm-section-title">Projection</div>
      ${buildSelectHTML('mm-cam-proj', [
        { val: 0, label: 'Perspective' },
        { val: 1, label: 'Orthographic' },
      ], proj)}
      <div class="mm-row" id="mm-fov-row"${proj!==0?' style="display:none"':''}>
        <span class="mm-lbl">FOV</span>
        <input type="range" id="mm-cam-fov" min="10" max="90" step="1" value="${fov}">
        <span class="mm-val" id="mm-cam-fov-val">${Math.round(fov)}°</span>
      </div>

      <div class="mm-section-title">Camera Mode</div>
      ${buildSelectHTML('mm-cam-mode', [
        { val: 0, label: 'Orbit' },
        { val: 1, label: 'Spherical' },
        { val: 2, label: 'Plane' },
      ], mode)}
      <button class="mm-toggle${pivot?' active':''}" id="mm-cam-pivot">Pivot</button>
      <div class="mm-row">
        <span class="mm-lbl">Speed</span>
        <input type="range" id="mm-cam-speed" min="0.05" max="1" step="0.001" value="${speed}">
        <span class="mm-val" id="mm-cam-speed-val">${speed.toFixed(2)}</span>
      </div>

      <div class="mm-section-title">Desktop Canvas (VR)</div>
      ${buildSelectHTML('mm-spectator-mode', [
        { val: 0, label: 'Blank (VR active)' },
        { val: 1, label: 'Mirror (headset)' },
        { val: 2, label: 'Desktop free camera' },
        { val: 3, label: 'Spectator (coupled)' },
      ], vmode)}

      <div class="mm-section-title">Spectator FPS</div>
      ${buildSelectHTML('mm-spectator-fps', [
        { val: 0, label: 'Full rate' },
        { val: 1, label: '½ rate' },
        { val: 2, label: '¼ rate (default)' },
        { val: 3, label: '⅛ rate' },
      ], fps)}
    </div>
  `;
}

// Tool definitions mirrored from BrushPanel — single source of truth kept here
// so the Sculpting tab and the BrushPanel grid stay in sync.
const SCULPT_TOOLS = [
  { id: Enums.Tools.BRUSH,        label: 'Brush'     },
  { id: Enums.Tools.INFLATE,      label: 'Inflate'   },
  { id: Enums.Tools.FLATTEN,      label: 'Flatten'   },
  { id: Enums.Tools.PINCH,        label: 'Pinch'     },
  { id: Enums.Tools.CREASE,       label: 'Crease'    },
  { id: Enums.Tools.SMOOTH,       label: 'Smooth'    },
  { id: Enums.Tools.RELAX,        label: 'Relax'     },
  { id: Enums.Tools.PAINT,        label: 'Paint'     },
  { id: Enums.Tools.MOVE,         label: 'Move'      },
  { id: Enums.Tools.GRAB,         label: 'Grab'      },
  { id: Enums.Tools.DRAG,         label: 'Drag'      },
  { id: Enums.Tools.SLIDE,        label: 'Slide'     },
  { id: Enums.Tools.TWIST,        label: 'Twist'     },
  { id: Enums.Tools.TRANSFORM_VR, label: 'Transform' },
  { id: Enums.Tools.MASKING,      label: 'Masking'   },
];
const MESH_TOOLS = [
  { id: Enums.Tools.CUT_TOOL,         label: 'Cut'        },
  { id: Enums.Tools.EXTRUDE,          label: 'Extrude'    },
  { id: Enums.Tools.INSET,            label: 'Inset'      },
  { id: Enums.Tools.DELETE_FACE,      label: 'Del Face'   },
  { id: Enums.Tools.FILL_HOLE,        label: 'Fill Hole'  },
  { id: Enums.Tools.DISSOLVE_EDGE,    label: 'Dis Edge'   },
  { id: Enums.Tools.SPLIT_FACE,       label: 'Split Face' },
  { id: Enums.Tools.SPIN_EDGE,        label: 'Spin Edge'  },
  { id: Enums.Tools.COLLAPSE_EDGE,    label: 'Col Edge'   },
  { id: Enums.Tools.DISSOLVE_VERTEX,  label: 'Dis Vert'   },
  { id: Enums.Tools.WELD,             label: 'Weld'       },
];

// Helper: encode a 0-1 rgb vec3 component as two hex digits.
const _toHex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

export function buildSectionHTML_sculpting(main) {
  const sm  = main.getSculptManager?.() ?? main._sculptManager;
  const cur = sm?.getToolIndex?.() ?? -1;
  const tool = sm?.getCurrentTool?.();
  const symOn  = sm?._symmetry ?? false;
  const contOn = sm?._continuous ?? false;

  const sculptBtns = SCULPT_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : ''}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');
  const meshBtns = MESH_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : ''}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');

  // ── Brush settings (radius + intensity) ─────────────────────────
  let brushHTML = '';
  if (tool && tool._radius !== undefined) {
    const radius    = Math.round(tool._radius ?? 50);
    const intensity = Math.round((tool._intensity ?? 0.5) * 100);
    brushHTML += `
      <div class="mm-section-title">Brush</div>
      <div class="mm-row">
        <span class="mm-lbl">Radius</span>
        <input type="range" id="mm-brush-radius" min="5" max="250" step="1" value="${radius}">
        <span class="mm-val" id="mm-brush-radius-val">${radius}</span>
      </div>
      <div class="mm-row">
        <span class="mm-lbl">Intensity</span>
        <input type="range" id="mm-brush-intensity" min="0" max="100" step="1" value="${intensity}">
        <span class="mm-val" id="mm-brush-intensity-val">${intensity}%</span>
      </div>${tool._hardness !== undefined ? `
      <div class="mm-row">
        <span class="mm-lbl">Hardness</span>
        <input type="range" id="mm-brush-hardness" min="0" max="100" step="1" value="${Math.round(tool._hardness * 100)}">
        <span class="mm-val" id="mm-brush-hardness-val">${Math.round(tool._hardness * 100)}%</span>
      </div>` : ''}`;

    // ── Tool-specific toggles ────────────────────────────────────────
    const hasNegative   = tool._negative !== undefined;
    const hasClay       = tool._clay !== undefined;
    const hasAccumulate = tool._accumulate !== undefined;

    if (hasNegative || hasClay || hasAccumulate) {
      const toggles = [];
      if (hasNegative) {
        // Masking defaults _negative=true to mean "add mask" (subtract from material).
        // Flip label and active state so the button reads as "Erase" = remove existing mask.
        const isMasking = cur === Enums.Tools.MASKING;
        const negLabel  = isMasking ? 'Erase' : 'Negative';
        const negActive = isMasking ? !tool._negative : tool._negative;
        toggles.push(`<button class="mm-choice${negActive ? ' active' : ''}" id="mm-brush-negative">${negLabel}</button>`);
      }
      if (hasClay)       toggles.push(`<button class="mm-choice${tool._clay       ? ' active' : ''}" id="mm-brush-clay"    >Clay      </button>`);
      if (hasAccumulate) toggles.push(`<button class="mm-choice${tool._accumulate ? ' active' : ''}" id="mm-brush-accum"   >Accumulate</button>`);
      const cols = toggles.length <= 2 ? 'cols-2' : 'cols-3';
      brushHTML += `<div class="mm-choice-grid ${cols}" style="margin-top:4px">${toggles.join('')}</div>`;
    }

    // ── Alpha brush texture selector ─────────────────────────────────
    if (tool._idAlpha !== undefined) {
      const alphaNames = Object.keys(Picking.ALPHAS_NAMES);
      const currentAlpha = tool._idAlpha ?? alphaNames[0];
      brushHTML += `
        <div class="mm-section-title">Alpha</div>
        ${buildSelectHTML('mm-alpha-select', alphaNames.map(n => ({ val: n, label: n })), currentAlpha)}
        <button class="mm-action-btn" id="mm-alpha-import" style="margin-top:3px">Import alpha…</button>`;
    }

    // ── Paint-specific controls ──────────────────────────────────────
    if (cur === Enums.Tools.PAINT && tool._color) {
      const hexColor  = '#' + _toHex2(tool._color[0]) + _toHex2(tool._color[1]) + _toHex2(tool._color[2]);
      const roughness = Math.round((tool._material?.[0] ?? 0.5) * 100);
      const metallic  = Math.round((tool._material?.[1] ?? 0.0) * 100);
      brushHTML += `
        <div class="mm-section-title">Paint</div>
        <div class="mm-row">
          <span class="mm-lbl">Color</span>
          <input type="color" id="mm-paint-color" value="${hexColor}"
            style="width:44px;height:22px;padding:1px 2px;border:1px solid #45475a;border-radius:4px;background:#313244;cursor:pointer;flex-shrink:0">
        </div>
        <div class="mm-row">
          <span class="mm-lbl">Roughness</span>
          <input type="range" id="mm-paint-roughness" min="0" max="100" step="1" value="${roughness}">
          <span class="mm-val" id="mm-paint-roughness-val">${roughness}%</span>
        </div>
        <div class="mm-row">
          <span class="mm-lbl">Metallic</span>
          <input type="range" id="mm-paint-metallic" min="0" max="100" step="1" value="${metallic}">
          <span class="mm-val" id="mm-paint-metallic-val">${metallic}%</span>
        </div>
        <div class="mm-choice-grid cols-2" style="margin-top:4px">
          <button class="mm-choice${tool._writeAlbedo ? ' active' : ''}" id="mm-paint-albedo">Write Color</button>
          <button class="mm-choice${tool._pickColor   ? ' active' : ''}" id="mm-paint-pick"  >Pick Color </button>
        </div>`;
    }
  }

  return `
    <div class="mm-section-title">Sculpt</div>
    <div class="mm-choice-grid cols-3">${sculptBtns}</div>
    <div class="mm-section-title">Mesh Edit</div>
    <div class="mm-choice-grid cols-3">${meshBtns}</div>
    ${brushHTML}
    <div class="mm-section-title">Symmetry</div>
    <button class="mm-toggle${symOn ? ' active' : ''}" id="mm-sym-toggle">
      Mirror Symmetry ${symOn ? '✓ On' : 'Off'}
    </button>
    <div class="mm-row" style="gap:6px">
      <button class="mm-action-btn" id="mm-sym-lr" style="flex:1">Symmetrize L→R</button>
      <button class="mm-action-btn" id="mm-sym-rl" style="flex:1">Symmetrize R→L</button>
    </div>
    <button class="mm-toggle${contOn ? ' active' : ''}" id="mm-continuous" style="margin-top:4px">
      Continuous ${contOn ? '✓ On' : 'Off'}
    </button>
  `;
}

export function buildSectionHTML_animation() {
  return buildAnimationSectionHTML();
}

// ── MainMenuPanel class ──────────────────────────────────────────────────────

export class MainMenuPanel extends HTMLVRPanel {
  /**
   * @param {object}              main      SculptXR app / Scene object
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(main, scene, camera, renderer) {
    injectCSS();

    const root = document.createElement('div');
    root.id = 'mm-root';
    // Inline width AND height so they survive SVG foreignObject serialisation.
    // With all children position:absolute they don't contribute to the parent's
    // auto-height, so without the inline height Ee() would capture 0px.
    root.style.width  = MM_W + 'px';
    // border-box total = content (MM_MENUBAR_H + MM_BODY_H) + 2×border (2px each)
    root.style.height = (MM_MENUBAR_H + MM_BODY_H + 4) + 'px';  // = 504px
    root.innerHTML = buildShellHTML();

    super(root, MM_W / VR_PANEL_PX_PER_M);

    this._main           = main;
    this._activeMenu    = null;     // null | 'files'|'history'|'reference'|'settings'|'about'
    this._activeSection = 'sculpting'; // 'scene'|'topology'|'rendering'|'sculpting'
    this._lastContentKey = '';      // avoids redundant rebuilds
    this._startHidden   = true;
    this._pinned        = false;
    this._tornOffSections = new Set(); // sections currently floating as TornOffPanels

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire(main);
  }

  get pinned() { return this._pinned; }

  /** Called by Scene.js when a section has been torn off into a floating panel. */
  notifyTearOff(sectionId) {
    this._tornOffSections.add(sectionId);
    // If the torn-off section is currently active, switch to the first available one.
    if (this._activeSection === sectionId) {
      const sections = ['scene', 'rendering', 'topology', 'sculpting', 'animation'];
      const next = sections.find(s => !this._tornOffSections.has(s));
      if (next) this._setSection(next);
    }
    this._updateTornTabStates();
  }

  /** Called by Scene.js when a floating panel is re-docked. */
  notifyReDock(sectionId) {
    this._tornOffSections.delete(sectionId);
    this._updateTornTabStates();
    this._lastContentKey = ''; // force rebuild if this section is now active again
  }

  _updateTornTabStates() {
    this._element.querySelectorAll('.mm-tab-btn').forEach(btn => {
      btn.classList.toggle('torn', this._tornOffSections.has(btn.dataset.section));
    });
    this.markDirty();
  }

  // ── Mesh placement ─────────────────────────────────────────────────────────

  _onMeshCreated() {
    if (!this.mesh) return;
    // Wrist-relative offset — matches the BrushPanel convention so it sits
    // flat on the non-dominant palm when parented to the controller grip.
    // Scene.js re-parents this mesh to uiGrip every frame in VR.
    this.mesh.position.set(0.10, 0.10, -0.05);
    this.mesh.rotation.set(-Math.PI / 2, 0, 0);
  }

  // ── Wait for mesh, then wire shell events ──────────────────────────────────

  _waitForMeshThenWire(main) {
    const check = () => {
      if (this.mesh) this._wireShell(main);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  _wireShell(main) {
    const root = this._element;

    // Top menubar buttons
    root.querySelectorAll('.mm-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._setMenu(btn.dataset.menu);
      });
    });

    // Side tab strip buttons
    root.querySelectorAll('.mm-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._tornOffSections.has(btn.dataset.section)) {
          this._setSection(btn.dataset.section);
        }
      });
    });

    // Tab tear-off pin buttons
    root.querySelectorAll('.mm-tab-pin').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (!this._tornOffSections.has(section)) {
          this._element.dispatchEvent(
            new CustomEvent('mm-section-tearoff', { detail: { section }, bubbles: false })
          );
        }
      });
    });

    // Pin button
    const pinBtn = root.querySelector('#mm-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        this._pinned = !this._pinned;
        pinBtn.classList.toggle('active', this._pinned);
        this._element.dispatchEvent(
          new CustomEvent('mm-pin-change', { detail: { pinned: this._pinned }, bubbles: false })
        );
        this.markDirty();
      });
    }

    // Scrollbar — the polyfill can't route pointer events to native scrollbar chrome,
    // so we intercept clicks in the right 10 px of #mm-content and jump scrollTop.
    const contentEl = root.querySelector('#mm-content');
    if (contentEl) {
      contentEl.addEventListener('mousedown', (e) => {
        const scrollbarW = 10;
        const inScrollbar = e.offsetX >= contentEl.clientWidth;
        if (!inScrollbar) return;
        // Map click Y to scroll position
        const ratio = e.offsetY / contentEl.clientHeight;
        const scrollH = contentEl.scrollHeight - contentEl.clientHeight;
        contentEl.scrollTop = ratio * scrollH;
        this.markDirty();
        e.stopPropagation();
        e.preventDefault();
      });
    }

    // Populate initial content
    this._rebuildContent();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _setMenu(name) {
    this._activeMenu = (this._activeMenu === name) ? null : name;
    this._rebuildContent();
  }

  _setSection(name) {
    this._activeMenu    = null;
    this._activeSection = name;
    this._rebuildContent();
  }

  _rebuildContent() {
    const root      = this._element;
    const contentEl = root.querySelector('#mm-content');
    if (!contentEl) return;

    // Update top menubar active state
    root.querySelectorAll('.mm-menu-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.menu === this._activeMenu);
    });

    // Update side tab active state (tabs always visible; dim them when a menu is open)
    root.querySelectorAll('.mm-tab-btn').forEach(btn => {
      btn.classList.toggle('active', !this._activeMenu && btn.dataset.section === this._activeSection);
    });

    // Build a cache key to skip redundant rebuilds (e.g. repeated syncFromState calls)
    const mesh = this._main.getMesh?.();
    const shaderType = mesh?.getShaderType?.() ?? -1;
    const meshCount  = this._main.getMeshes?.()?.length ?? 0;
    const sm = this._main.getSculptManager?.() ?? this._main._sculptManager;
    const curTool = sm?.getToolIndex?.() ?? -1;
    const symOn  = sm?._symmetry  ? 1 : 0;
    const contOn = sm?._continuous ? 1 : 0;
    const guiFiles    = this._main.getGui?.()._ctrlFiles ?? null;
    const savesCount  = guiFiles?._browserSaves?.length ?? 0;
    const key = this._activeMenu
      ? `menu:${this._activeMenu}:${savesCount}`
      : `sec:${this._activeSection}:${shaderType}:${meshCount}:${curTool}:${symOn}:${contOn}`;

    if (key === this._lastContentKey) return;
    this._lastContentKey = key;

    // Build HTML
    const main = this._main;
    let html = '';
    if (this._activeMenu) {
      switch (this._activeMenu) {
        case 'files':         html = buildMenuHTML_files(main);     break;
        case 'browser-saves': html = '<button class="mm-action-btn" id="mm-back-to-files" style="margin-bottom:8px">← Back to Files</button>' + buildMenuHTML_browserSaves(main); break;
        case 'history':    html = buildMenuHTML_history(main);    break;
        case 'background': html = buildMenuHTML_background(main); break;
        case 'reference':  html = buildMenuHTML_reference();     break;
        case 'settings':   html = buildMenuHTML_settings(main);  break;
        case 'about':      html = buildMenuHTML_about();         break;
      }
    } else {
      switch (this._activeSection) {
        case 'scene':     html = buildSectionHTML_scene(main);     break;
        case 'topology':  html = buildSectionHTML_topology(main);  break;
        case 'rendering': html = buildSectionHTML_rendering(main); break;
        case 'sculpting': html = buildSectionHTML_sculpting(main); break;
        case 'animation': html = buildSectionHTML_animation();     break;
      }
    }

    contentEl.innerHTML = html;
    this._wireContent();
    this.markDirty();
  }

  // ── Event wiring for dynamic content ──────────────────────────────────────

  _wireContent() {
    const main = this._main;
    if (this._activeMenu) {
      this._wireMenu(this._activeMenu, main);
    } else {
      this._wireSection(this._activeSection, main);
    }
  }

  // ── Menu event wiring ──────────────────────────────────────────────────────

  _wireMenu(menu, main) {
    const el = this._element;
    const q  = (id) => el.querySelector(id);
    const paint = () => this.markDirty();

    if (menu === 'files') {
      wireMenuFiles(el, main, paint, () => {
        this._setMenu('browser-saves');
      });
    } else if (menu === 'browser-saves') {
      wireMenuBrowserSaves(el, main, () => { this._lastContentKey = ''; paint(); });
      q('#mm-back-to-files')?.addEventListener('click', () => this._setMenu('files'));

    } else if (menu === 'history') {
      wireMenuHistory(el, main, paint);
    } else if (menu === 'background') {
      wireMenuBackground(el, main, paint);
    } else if (menu === 'reference') {
      q('#mm-ref-add')?.addEventListener('click', () => document.getElementById('referenceopen')?.click());
      q('#mm-ref-clear')?.addEventListener('click', () => { main.getReferenceManager?.()?.clear?.(); paint(); });
      q('#mm-ref-show')?.addEventListener('click', () => {
        q('#mm-ref-show')?.classList.toggle('active');
        paint();
      });

    } else if (menu === 'settings') {
      this._wireSettings(main);

    } else if (menu === 'about') {
      wireMenuAbout(el);
    }
  }

  _wireSettings(main) {
    const el   = this._element;
    const q    = (id) => el.querySelector(id);
    const gx   = main._guiXR ?? main.getGuiXR?.();
    const ui   = gx?._uiSettings ?? {};
    const opts = getOptionsURL;
    const paint = () => this.markDirty();

    // Input toggles
    q('#mm-left-hand')?.addEventListener('click', () => {
      const newHand = main._dominantHand === 'left' ? 'right' : 'left';
      main.setDominantHand?.(newHand);
      opts.saveOption('leftHandMode', newHand === 'left');
      q('#mm-left-hand')?.classList.toggle('active', newHand === 'left');
      paint();
    });
    q('#mm-raycast')?.addEventListener('click', () => {
      main._vrUseVolumeIntersect = !main._vrUseVolumeIntersect;
      opts.saveOption('aimPickingMode', !main._vrUseVolumeIntersect);
      q('#mm-raycast')?.classList.toggle('active', !main._vrUseVolumeIntersect);
      paint();
    });
    q('#mm-ambi')?.addEventListener('click', () => {
      main._vrAmbidextrousCursors = !main._vrAmbidextrousCursors;
      opts.saveOption('ambidextrousCursors', main._vrAmbidextrousCursors);
      q('#mm-ambi')?.classList.toggle('active', main._vrAmbidextrousCursors);
      paint();
    });

    // Trigger sensitivity
    this._wireSlider(q('#mm-trigger'), q('#mm-trigger-val'), (v) => {
      const f = v / 100;
      if (ui) ui.triggerCurve = f;
      opts.saveOption('triggerCurve', f, 500);
    }, (v) => `${v}%`);

    // Stylus
    this._wireSlider(q('#mm-stylus-len'), q('#mm-stylus-len-val'), (v) => {
      const f = v / 100;
      if (ui) ui.stylusLength = f;
      main.updateStylusLength?.(f);
      opts.saveOption('stylusLength', f, 500);
    });
    this._wireSlider(q('#mm-stylus-off'), q('#mm-stylus-off-val'), (v) => {
      const f = v / 100;
      if (ui) ui.stylusOffset = f;
      main.updateStylusOffset?.(f);
      opts.saveOption('stylusOffset', f, 500);
    });
    this._wireSlider(q('#mm-stylus-tilt'), q('#mm-stylus-tilt-val'), (v) => {
      if (ui) ui.stylusTilt = v;
      main.updateStylusTilt?.(v);
      opts.saveOption('stylusTilt', v, 500);
    }, (v) => `${v}°`);
    this._wireSlider(q('#mm-gizmo-scale'), q('#mm-gizmo-val'), (v) => {
      opts.saveOption('gizmoScale', v, 500);
      const sc = main.getSculptManager?.();
      if (sc) {
        const t = sc.getTool?.(Enums.Tools.TRANSFORM_VR);
        if (t?._gizmo) { t._gizmo._resize(v); t._gizmo._lastScale = v; }
      }
      main.render?.();
    });

    // Calibration
    this._wireSlider(q('#mm-head-height'), q('#mm-head-height-val'), (v) => {
      const f = v / 100;
      if (ui) ui.offsetY = f;
      main.updateVROffsets?.();
      opts.saveOption('offsetY', f, 500);
    }, (v) => (v / 100).toFixed(1));

    // Controller model
    {
      const ctrlModels = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
        'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
        'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
      wireSelect(el, 'mm-ctrl-model', (v) => {
        const idx = parseInt(v, 10);
        window._xrControllerOverride = ctrlModels[idx];
        opts.saveOption('controllerModel', ctrlModels[idx]);
        if (window._reloadControllerModels) window._reloadControllerModels.call(main);
        else main.reloadControllerModels?.();
        main.render?.();
      }, lightRepaint);
    }

    // Wireframe
    this._wireSlider(q('#mm-wf-bias'), q('#mm-wf-bias-val'), (v) => {
      const f = v / 10000;
      if (ui) ui.wireframeBias = f;
      const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
      if (wm?.material?.uniforms) wm.material.uniforms.uBias.value = f;
      opts.saveOption('wireframeBias', f, 500);
    }, (v) => (v / 10000).toFixed(4));
    this._wireSlider(q('#mm-wf-alpha'), q('#mm-wf-alpha-val'), (v) => {
      const f = v / 100;
      if (ui) ui.wireframeAlpha = f;
      const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
      if (wm?.material?.uniforms) wm.material.uniforms.uOpacity.value = f;
      opts.saveOption('wireframeAlpha', f, 500);
    }, (v) => `${v}%`);

    el.querySelectorAll('[data-wf-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = parseInt(btn.dataset.wfType, 10);
        main.getMesh()?.setWireframeType?.(t);
        opts.saveOption('wireframeType', t);
        main.render?.();
        el.querySelectorAll('[data-wf-type]').forEach(b => b.classList.toggle('active', b === btn));
        paint();
      });
    });

    // Menu brightness/saturation
    this._wireSlider(q('#mm-menu-bright'), q('#mm-menu-bright-val'), (v) => {
      const f = v / 100;
      if (ui) ui.menuBrightness = f;
      opts.saveOption('menuBrightness', f, 500);
    }, (v) => `${v}%`);
    this._wireSlider(q('#mm-menu-sat'), q('#mm-menu-sat-val'), (v) => {
      const f = v / 100;
      if (ui) ui.menuSaturation = f;
      opts.saveOption('menuSaturation', f, 500);
    }, (v) => `${v}%`);

    // Debug
    q('#mm-debug-mode')?.addEventListener('click', () => {
      if (ui) ui.debugMode = !ui.debugMode;
      opts.saveOption('debugMode', ui.debugMode ?? false);
      q('#mm-debug-mode')?.classList.toggle('active', ui.debugMode ?? false);
      paint();
    });
    q('#mm-perf-profile')?.addEventListener('click', () => window.debugProfile?.(120));
  }

  // ── Section event wiring ───────────────────────────────────────────────────

  _wireSection(section, main) {
    const el = this._element;
    const fullRepaint = () => { this._lastContentKey = ''; this._rebuildContent(); };
    const lightRepaint = () => this.markDirty();

    if (section === 'scene') {
      wireSectionScene(el, main, fullRepaint);
    } else if (section === 'topology') {
      wireSectionTopology(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'rendering') {
      wireSectionRendering(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'sculpting') {
      wireSectionSculpting(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'animation') {
      this._wireSectionAnimation(el, lightRepaint);
    }
  }

  _wireSectionAnimation(el, repaint) {
    wireAnimationSection(el, this._main, {
      repaint,
      sync: () => { syncAnimationSection(el, this._main); repaint(); },
      refreshBs: (mesh) => { refreshBlendshapesDOM(el, mesh, this._main, repaint); repaint(); },
    });
  }

  // ── Slider helper ──────────────────────────────────────────────────────────
  // Wires input[type=range] → val display span → callback.
  // formatFn(intValue) → string; default is just String(v).

  _wireSlider(sliderEl, valEl, cb, formatFn) {
    wireSlider(sliderEl, valEl, cb, formatFn, () => this.markDirty());
  }

  // ── Outliner helper ────────────────────────────────────────────────────────

  _findMeshById(stableId) {
    return (this._main.getMeshes?.() ?? []).find(m => m._permanentStaticId === stableId) ?? null;
  }

  // ── Public API (called by Scene.js) ───────────────────────────────────────

  /**
   * Refresh the currently displayed content (e.g. after a sculpt operation
   * changes mesh count or shader type).
   */
  syncFromState() {
    this._lastContentKey = '';
    this._rebuildContent();
  }

  /** Toggle the panel visible and refresh content. */
  show(visible) {
    if (!this.mesh) return;
    this.mesh.visible = visible;
    if (visible) {
      this.syncFromState();
      // Start the async polyfill paint chain immediately so the texture is as
      // fresh as possible by the time the renderer draws this frame.
      this.flushPaint();
    }
  }

  /**
   * Override _onPaint: emit a one-time screenLog so the VR mirror confirms
   * the polyfill successfully rendered the panel.
   */
  _onPaint() {
    const hadTexture = !!this._texture;
    super._onPaint();
    if (!hadTexture && this._texture) {
      // First successful paint — visible in VR mirror + remote DevTools.
      console.log('[MainMenuPanel] polyfill first paint OK, canvas size:',
        this._texture.image?.width, '×', this._texture.image?.height);
      if (window.screenLog) window.screenLog('[MainMenu] first paint ✓', 'cyan');
    }
  }
}

// ── Module-level shared wire helpers (used by both VR MainMenuPanel and desktop Gui) ─────

/**
 * Apply explicit pointer-capture drag handling to every input[type=range] inside rootEl.
 * Native range drag breaks inside web-component shadow DOM / overflow containers — this
 * re-implements it with pointerdown/move/up + setPointerCapture so it works reliably.
 * Call once after injecting section HTML into a desktop panel element.
 */
export function fixSliderDrag(rootEl) {
  rootEl.querySelectorAll('input[type=range]').forEach(input => {
    let dragging = false;
    const getVal = (clientX) => {
      const r = input.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || 100;
      const step = parseFloat(input.step) || 1;
      return Math.max(min, Math.min(max, Math.round((min + t * (max - min)) / step) * step));
    };
    input.addEventListener('pointerdown', (e) => {
      dragging = true;
      input.setPointerCapture(e.pointerId);
      input.value = getVal(e.clientX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      input.value = getVal(e.clientX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
      e.stopPropagation();
    });
    input.addEventListener('lostpointercapture', () => { dragging = false; });
  });
}

/**
 * Wire an input[type=range] to a value-display span and a callback.
 * dirtyFn is called after each input event (pass markDirty for VR, or a rebuild fn for desktop).
 */
export function wireSlider(sliderEl, valEl, cb, formatFn, dirtyFn) {
  if (!sliderEl) return;
  const fmt = formatFn ?? String;
  sliderEl.addEventListener('input', () => {
    const v = parseFloat(sliderEl.value);
    if (valEl) valEl.textContent = fmt(v);
    cb(v);
    dirtyFn?.();
  });
  if (valEl) valEl.textContent = fmt(parseFloat(sliderEl.value));
}

/**
 * Wire event handlers for the Rendering section.
 * fullRepaintFn  — called when HTML structure needs to change (shader switch).
 * lightRepaintFn — called for toggle buttons (defaults to fullRepaintFn).
 * sliderDirtyFn  — called on each slider input event, e.g. markDirty for VR
 *                  (defaults to null — desktop DOM renders itself, no rebuild on drag).
 */
/**
 * Wire event handlers for the Scene/Outliner section.
 */
export function wireSectionScene(el, main, repaintFn) {
  const findMesh = id => (main.getMeshes?.() ?? []).find(m => m._permanentStaticId === id) ?? null;

  el.querySelectorAll('[data-action="vis"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mesh = findMesh(btn.dataset.meshId);
      if (!mesh) return;
      const cur = mesh.isVisible?.() ?? true;
      mesh.setVisible?.(!cur);
      if (mesh.getThreeMesh?.()) mesh.getThreeMesh().visible = !cur;
      main.render?.();
      repaintFn();
    });
  });

  el.querySelectorAll('[data-action="select"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mesh = findMesh(btn.dataset.meshId);
      if (mesh) { main.setOrUnsetMesh?.(mesh, false); main.render?.(); repaintFn(); }
    });
  });

  el.querySelector('#mm-add-sphere')?.addEventListener('click', () => {
    main.addSphere?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-add-cube')?.addEventListener('click', () => {
    main.addCube?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-clear-scene')?.addEventListener('click', () => {
    if (!main._clearSceneConfirm) {
      main._clearSceneConfirm = true;
      repaintFn(); // re-render button as "Confirm"
      setTimeout(() => { main._clearSceneConfirm = false; }, 3000);
    } else {
      main._clearSceneConfirm = false;
      main.clearScene?.(); main.render?.(); repaintFn();
    }
  });
  el.querySelector('#mm-duplicate')?.addEventListener('click', () => {
    main.duplicateSelection?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-delete-mesh')?.addEventListener('click', () => {
    main.deleteCurrentSelection?.(); main.render?.(); repaintFn();
  });
}

export function wireSectionRendering(el, main, fullRepaintFn, lightRepaintFn = fullRepaintFn, sliderDirtyFn = null) {
  const mesh   = main.getMesh?.();
  const meshes = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : (mesh ? [mesh] : []);
  const ShaderPBR = Shader[Enums.Shader.PBR];

  el.querySelectorAll('[data-shader]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.shader, 10);
      const ms = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh];
      ms?.forEach(m => { if (m) m.setShaderType?.(id); });
      main.render?.();
      fullRepaintFn(); // sections appear/disappear on shader change
    });
  });

  el.querySelectorAll('[data-env]').forEach(btn => {
    btn.addEventListener('click', () => {
      ShaderPBR.idEnv = parseInt(btn.dataset.env, 10);
      main.render?.();
      el.querySelectorAll('[data-env]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  el.querySelectorAll('[data-matcap]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.matcap, 10);
      (main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh])
        ?.forEach(m => m.setMatcap?.(id));
      main.render?.();
      el.querySelectorAll('[data-matcap]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  el.querySelector('#mm-import-matcap')?.addEventListener('click', () => document.getElementById('matcapopen')?.click());
  el.querySelector('#mm-import-uv')?.addEventListener('click',     () => document.getElementById('textureopen')?.click());

  el.querySelector('#mm-grid-toggle')?.addEventListener('click', () => {
    main._showGrid = !main._showGrid;
    if (main._groundGrid) main._groundGrid.visible = main._showGrid;
    try {
      const s = JSON.parse(localStorage.getItem('sculptxr_settings') || '{}');
      s.grid = main._showGrid;
      localStorage.setItem('sculptxr_settings', JSON.stringify(s));
    } catch (_) {}
    main.render?.();
    lightRepaintFn();
  });

  wireSlider(el.querySelector('#mm-curvature'), el.querySelector('#mm-curvature-val'), (v) => {
    meshes?.forEach(m => m.setCurvature?.(v / 20)); main.render?.();
  }, null, sliderDirtyFn);
  wireSlider(el.querySelector('#mm-transparency'), el.querySelector('#mm-transparency-val'), (v) => {
    meshes?.forEach(m => m.setOpacity?.(1 - v / 100)); main.render?.();
  }, (v) => `${v}%`, sliderDirtyFn);

  el.querySelector('#mm-flat-shading')?.addEventListener('click', () => {
    const t = !mesh?.getFlatShading?.();
    meshes?.forEach(m => m.setFlatShading?.(t));
    main.render?.();
    el.querySelector('#mm-flat-shading')?.classList.toggle('active', t);
    lightRepaintFn();
  });
  el.querySelector('#mm-wireframe')?.addEventListener('click', () => {
    const t = !mesh?.getShowWireframe?.();
    (main.getMeshes?.() ?? meshes)?.forEach(m => m.setShowWireframe?.(t));
    main.render?.();
    el.querySelector('#mm-wireframe')?.classList.toggle('active', t);
    lightRepaintFn();
  });
  el.querySelector('#mm-solid')?.addEventListener('click', () => {
    meshes?.forEach(m => {
      const mat = m._renderData?._threeMesh?.material;
      if (mat) mat.visible = !mat.visible;
    });
    main.render?.();
    lightRepaintFn();
  });

  el.querySelectorAll('[data-tonemap]').forEach(btn => {
    btn.addEventListener('click', () => {
      main.setToneMapping?.(parseInt(btn.dataset.tonemap, 10));
      el.querySelectorAll('[data-tonemap]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  wireSlider(el.querySelector('#mm-exposure'), el.querySelector('#mm-exposure-val'), (v) => {
    main.setExposure?.(v / 100); main.render?.();
  }, (v) => (v / 100).toFixed(2), sliderDirtyFn);

  // Camera controls
  const camera = main.getCamera?.() ?? main._camera;
  el.querySelector('#mm-cam-center')?.addEventListener('click', () => { camera?.resetView?.();       main.render?.(); });
  el.querySelector('#mm-cam-front') ?.addEventListener('click', () => { camera?.toggleViewFront?.(); main.render?.(); });
  el.querySelector('#mm-cam-left')  ?.addEventListener('click', () => { camera?.toggleViewLeft?.();  main.render?.(); });
  el.querySelector('#mm-cam-top')   ?.addEventListener('click', () => { camera?.toggleViewTop?.();   main.render?.(); });

  wireSelect(el, 'mm-cam-proj', (v) => {
    const n = parseInt(v, 10);
    camera?.setProjectionType?.(n);
    const fovRow = el.querySelector('#mm-fov-row');
    if (fovRow) fovRow.style.display = n === 0 ? '' : 'none';
    main.render?.();
  }, lightRepaintFn);
  wireSlider(el.querySelector('#mm-cam-fov'), el.querySelector('#mm-cam-fov-val'),
    (v) => { camera?.setFov?.(v); main.render?.(); },
    v => `${Math.round(v)}°`, sliderDirtyFn);

  wireSelect(el, 'mm-cam-mode', (v) => {
    camera?.setMode?.(parseInt(v, 10)); main.render?.();
  }, lightRepaintFn);
  el.querySelector('#mm-cam-pivot')?.addEventListener('click', (e) => {
    camera?.toggleUsePivot?.();
    e.currentTarget.classList.toggle('active', camera?.getUsePivot?.() ?? false);
    main.render?.();
  });
  wireSlider(el.querySelector('#mm-cam-speed'), el.querySelector('#mm-cam-speed-val'),
    (v) => { main._cameraSpeed = v; },
    v => v.toFixed(2), sliderDirtyFn);

  const skipMap = [0, 1, 3, 7];
  wireSelect(el, 'mm-spectator-mode', (v) => {
    main._spectatorViewMode = parseInt(v, 10); main._spectatorN = 0;
  }, lightRepaintFn);
  wireSelect(el, 'mm-spectator-fps', (v) => {
    main._spectatorFrameSkip = skipMap[parseInt(v, 10)] ?? 3; main._spectatorN = 0;
  }, lightRepaintFn);
}

/**
 * Wire event handlers for the Topology section.
 */
export function wireSectionTopology(el, main, repaintFn, lightRepaintFn = repaintFn, sliderDirtyFn = null) {
  const topo = main.getGui?.()._ctrlTopology ?? null;

  el.querySelector('#mm-level-down')?.addEventListener('click', () => {
    const m = main.getMesh?.();
    if (m?._meshes && m._sel > 0) { topo?.onResolutionChanged?.(m._sel); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-level-up')?.addEventListener('click', () => {
    const m = main.getMesh?.();
    if (m?._meshes && m._sel < m._meshes.length - 1) { topo?.onResolutionChanged?.(m._sel + 2); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-subdivide')?.addEventListener('click',   () => { topo?.subdivide?.();    main.render?.(); repaintFn(); });
  el.querySelector('#mm-reverse')?.addEventListener('click',     () => { topo?.reverse?.();      main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-lower')?.addEventListener('click',   () => { topo?.deleteLower?.();  main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-higher')?.addEventListener('click',  () => { topo?.deleteHigher?.(); main.render?.(); repaintFn(); });

  wireSlider(
    el.querySelector('#mm-remesh-res'), el.querySelector('#mm-remesh-res-val'),
    (v) => { Remesh.RESOLUTION = v; topo?.remeshResolution?.(v); },
    null, sliderDirtyFn
  );
  el.querySelector('#mm-remesh-block')?.addEventListener('click', () => {
    Remesh.BLOCK = !Remesh.BLOCK;
    el.querySelector('#mm-remesh-block')?.classList.toggle('active', Remesh.BLOCK);
    lightRepaintFn();
  });
  el.querySelector('#mm-remesh-smooth')?.addEventListener('click', () => {
    Remesh.SMOOTHING = !Remesh.SMOOTHING;
    el.querySelector('#mm-remesh-smooth')?.classList.toggle('active', Remesh.SMOOTHING);
    lightRepaintFn();
  });
  el.querySelector('#mm-remesh')?.addEventListener('click',    () => { topo?.remesh?.();   main.render?.(); repaintFn(); });
  el.querySelector('#mm-remesh-mc')?.addEventListener('click', () => { topo?.remeshMC?.(); main.render?.(); repaintFn(); });
  el.querySelector('#mm-dynamic')?.addEventListener('click',   () => { topo?.dynamicToggleActivate?.(); main.render?.(); repaintFn(); });
  el.querySelector('#mm-mesh-to-voxels')?.addEventListener('click', () => { topo?.meshToVoxel?.(); main.render?.(); repaintFn(); });
  el.querySelector('#mm-validate')?.addEventListener('click',  () => { topo?.validateMesh?.(); });
  el.querySelector('#mm-auto-heal')?.addEventListener('click', () => {
    el.querySelector('#mm-auto-heal')?.classList.toggle('active');
    lightRepaintFn();
  });
}

/**
 * Wire event handlers for the Sculpting section.
 */
export function wireSectionSculpting(el, main, repaintFn, lightRepaintFn = repaintFn, sliderDirtyFn = null) {
  const sm = main.getSculptManager?.() ?? main._sculptManager;

  el.querySelectorAll('[data-tool-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.toolId, 10);
      main.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(id);
      main.render?.();
      repaintFn();
    });
  });

  // ── Brush settings ─────────────────────────────────────────────────────────
  const tool = sm?.getCurrentTool?.();
  if (tool) {
    const idx = sm?.getToolIndex?.();

    wireSlider(el.querySelector('#mm-brush-radius'), el.querySelector('#mm-brush-radius-val'),
      (v) => {
        tool._radius = v;
        getOptionsURL.saveOption(`tool_${idx}_radius`, v, 500);
        main.render?.();
      }, String, sliderDirtyFn);

    wireSlider(el.querySelector('#mm-brush-intensity'), el.querySelector('#mm-brush-intensity-val'),
      (v) => {
        tool._intensity = v / 100;
        getOptionsURL.saveOption(`tool_${idx}_intensity`, v / 100, 500);
        main.render?.();
      }, (v) => `${v}%`, sliderDirtyFn);

    if (tool._hardness !== undefined) {
      wireSlider(el.querySelector('#mm-brush-hardness'), el.querySelector('#mm-brush-hardness-val'),
        (v) => {
          tool._hardness = v / 100;
          getOptionsURL.saveOption(`tool_${idx}_hardness`, v / 100, 500);
          main.render?.();
        }, (v) => `${v}%`, sliderDirtyFn);
    }

    el.querySelector('#mm-brush-negative')?.addEventListener('click', (e) => {
      tool._negative = !tool._negative;
      const isMasking = sm?.getToolIndex?.() === Enums.Tools.MASKING;
      e.currentTarget.classList.toggle('active', isMasking ? !tool._negative : tool._negative);
      main.render?.();
      lightRepaintFn();
    });
    el.querySelector('#mm-brush-clay')?.addEventListener('click', (e) => {
      tool._clay = !tool._clay;
      e.currentTarget.classList.toggle('active', tool._clay);
      getOptionsURL.saveOption(`tool_${idx}_clay`, tool._clay);
      main.render?.();
      lightRepaintFn();
    });
    el.querySelector('#mm-brush-accum')?.addEventListener('click', (e) => {
      tool._accumulate = !tool._accumulate;
      e.currentTarget.classList.toggle('active', tool._accumulate);
      getOptionsURL.saveOption(`tool_${idx}_accumulate`, tool._accumulate);
      main.render?.();
      lightRepaintFn();
    });

    // ── Paint-specific ────────────────────────────────────────────────────────
    if (tool._color) {
      el.querySelector('#mm-paint-color')?.addEventListener('input', (e) => {
        const h = e.target.value;
        tool._color[0] = parseInt(h.slice(1, 3), 16) / 255;
        tool._color[1] = parseInt(h.slice(3, 5), 16) / 255;
        tool._color[2] = parseInt(h.slice(5, 7), 16) / 255;
        main.render?.();
        sliderDirtyFn?.();
      });
      wireSlider(el.querySelector('#mm-paint-roughness'), el.querySelector('#mm-paint-roughness-val'),
        (v) => { if (tool._material) tool._material[0] = v / 100; main.render?.(); },
        (v) => `${v}%`, sliderDirtyFn);
      wireSlider(el.querySelector('#mm-paint-metallic'), el.querySelector('#mm-paint-metallic-val'),
        (v) => { if (tool._material) tool._material[1] = v / 100; main.render?.(); },
        (v) => `${v}%`, sliderDirtyFn);
      el.querySelector('#mm-paint-albedo')?.addEventListener('click', (e) => {
        tool._writeAlbedo = !tool._writeAlbedo;
        e.currentTarget.classList.toggle('active', tool._writeAlbedo);
        lightRepaintFn();
      });
      el.querySelector('#mm-paint-pick')?.addEventListener('click', (e) => {
        tool._pickColor = !tool._pickColor;
        e.currentTarget.classList.toggle('active', tool._pickColor);
        lightRepaintFn();
      });
    }

    // ── Alpha brush texture ───────────────────────────────────────────────────
    if (tool._idAlpha !== undefined) {
      wireSelect(el, 'mm-alpha-select', (v) => {
        tool._idAlpha = v; main.render?.();
      }, lightRepaintFn);

      el.querySelector('#mm-alpha-import')?.addEventListener('click', () => {
        const input = document.getElementById('alphaopen');
        if (!input) return;
        // Wire a one-shot handler: load the alpha then rebuild this section.
        const onAlphaLoaded = () => {
          input.removeEventListener('change', onAlphaLoaded);
          repaintFn(); // rebuild so the new alpha appears in the buttons
        };
        input.addEventListener('change', onAlphaLoaded);
        input.click();
      });
    }
  }

  // ── Symmetry ────────────────────────────────────────────────────────────────
  const symToggle = el.querySelector('#mm-sym-toggle');
  if (symToggle && sm) {
    symToggle.addEventListener('click', () => {
      sm._symmetry = !sm._symmetry;
      symToggle.classList.toggle('active', sm._symmetry);
      symToggle.textContent = `Mirror Symmetry ${sm._symmetry ? '✓ On' : 'Off'}`;
      main.render?.();
      lightRepaintFn();
    });
  }

  el.querySelector('#mm-sym-lr')?.addEventListener('click', () => {
    main.getGui?.()._ctrlSculpting?.onSymLR?.(); main.render?.();
  });
  el.querySelector('#mm-sym-rl')?.addEventListener('click', () => {
    main.getGui?.()._ctrlSculpting?.onSymRL?.(); main.render?.();
  });

  const contBtn = el.querySelector('#mm-continuous');
  if (contBtn && sm) {
    contBtn.addEventListener('click', () => {
      sm._continuous = !sm._continuous;
      contBtn.classList.toggle('active', sm._continuous);
      contBtn.textContent = `Continuous ${sm._continuous ? '✓ On' : 'Off'}`;
      lightRepaintFn();
    });
  }
}

export function buildMenuHTML_browserSaves(main) {
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  const saves    = guiFiles?._browserSaves ?? [];

  const thumbs = saves.length === 0
    ? '<div class="mm-info">No saves yet</div>'
    : saves.map(s => {
        const key   = s.key ?? s.id ?? '';
        const ts    = s.value?.timestamp ?? 0;
        const thumb = s.value?.thumb ?? '';
        const date  = ts ? new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '—';
        const img   = thumb
          ? `<img src="${thumb}" alt="save">`
          : `<div style="width:100%;aspect-ratio:1;background:#313244;display:flex;align-items:center;justify-content:center;font-size:20px">🗿</div>`;
        return `
          <div class="mm-storage-item">
            ${img}
            <span class="mm-storage-date">${date}</span>
            <div class="mm-storage-btns">
              <button class="mm-action-btn mm-storage-load" data-save-key="${key}">Load</button>
              <button class="mm-action-btn danger mm-storage-del" data-save-key="${key}">Del</button>
            </div>
          </div>`;
      }).join('');

  return `
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-browser-save">Save scene</button>
      <button class="mm-action-btn" id="mm-storage-refresh">↻ Refresh</button>
    </div>
    <div class="mm-storage-grid" id="mm-storage-grid">${thumbs}</div>
  `;
}

export function wireMenuBrowserSaves(el, main, rebuildFn) {
  const q = (sel) => el.querySelector(sel);
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;

  q('#mm-browser-save')?.addEventListener('click', () => {
    guiFiles?.saveToBrowserStorage?.();
    setTimeout(() => {
      guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
    }, 800);
  });
  q('#mm-storage-refresh')?.addEventListener('click', () => {
    guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
  });
  el.querySelectorAll('.mm-storage-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) guiFiles?.loadSpecificBrowserSave?.(key);
    });
  });
  el.querySelectorAll('.mm-storage-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) {
        guiFiles?.deleteBrowserSave?.(key);
        setTimeout(() => rebuildFn(), 300);
      }
    });
  });
}

export function wireMenuFiles(el, main, rebuildFn, onBrowserSavesOpen = null) {
  const q = (sel) => el.querySelector(sel);
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;

  q('#mm-browser-saves')?.addEventListener('click', () => onBrowserSavesOpen?.());

  q('#mm-import-obj')?.addEventListener('click', () => {
    document.getElementById('fileopen')?.click();
  });
  q('#mm-import-scale')?.addEventListener('click', () => {
    main._autoMatrix = !main._autoMatrix;
    q('#mm-import-scale')?.classList.toggle('active', main._autoMatrix);
  });
  q('#mm-import-srgb')?.addEventListener('click', () => {
    main._vertexSRGB = !main._vertexSRGB;
    q('#mm-import-srgb')?.classList.toggle('active', main._vertexSRGB);
  });

  q('#mm-export-all')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._exportAll = !guiFiles._exportAll;
    q('#mm-export-all')?.classList.toggle('active', guiFiles?._exportAll ?? true);
  });
  q('#mm-export-sxr')?.addEventListener('click', () => guiFiles?.saveFileAsSGL?.());
  q('#mm-export-glb')?.addEventListener('click', () => guiFiles?.saveFileAsGLB?.());
  q('#mm-export-obj')?.addEventListener('click', () => guiFiles?.saveFileAsOBJ?.());
  q('#mm-export-ply')?.addEventListener('click', () => guiFiles?.saveFileAsPLY?.());
  q('#mm-export-stl')?.addEventListener('click', () => guiFiles?.saveFileAsSTL?.());

  q('#mm-obj-zbrush')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._objColorZbrush = !guiFiles._objColorZbrush;
    q('#mm-obj-zbrush')?.classList.toggle('active', guiFiles?._objColorZbrush ?? true);
  });
  q('#mm-obj-append')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._objColorAppended = !guiFiles._objColorAppended;
    q('#mm-obj-append')?.classList.toggle('active', guiFiles?._objColorAppended ?? false);
  });

  q('#mm-browser-save')?.addEventListener('click', () => {
    guiFiles?.saveToBrowserStorage?.();
    setTimeout(() => {
      guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
    }, 800);
  });
  q('#mm-storage-refresh')?.addEventListener('click', () => {
    guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
  });

  el.querySelectorAll('.mm-storage-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) guiFiles?.loadSpecificBrowserSave?.(key);
    });
  });
  el.querySelectorAll('.mm-storage-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) {
        guiFiles?.deleteBrowserSave?.(key);
        setTimeout(() => rebuildFn(), 300);
      }
    });
  });

  const texSlider = q('#mm-tex-size');
  const texVal    = q('#mm-tex-size-val');
  if (texSlider && texVal) {
    texSlider.addEventListener('input', () => {
      const v = parseInt(texSlider.value, 10);
      texVal.textContent = Math.round(Math.pow(2, v));
      guiFiles?.onTextureSize?.(v);
    });
    texVal.textContent = Math.round(Math.pow(2, texSlider.value));
    guiFiles?.onTextureSize?.(parseInt(texSlider.value, 10));
  }
  q('#mm-save-diffuse')?.addEventListener('click',   () => guiFiles?.saveTextureDiffuse?.());
  q('#mm-save-roughness')?.addEventListener('click', () => guiFiles?.saveTextureRoughness?.());
  q('#mm-save-metalness')?.addEventListener('click', () => guiFiles?.saveTextureMetalness?.());
}

export function wireMenuHistory(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);

  q('#mm-undo')?.addEventListener('click', () => {
    main.onKeyUp?.({ keyCode: 90, ctrlKey: true });
    repaintFn?.();
  });
  q('#mm-redo')?.addEventListener('click', () => {
    main.onKeyUp?.({ keyCode: 89, ctrlKey: true });
    repaintFn?.();
  });

  const stackSlider = q('#mm-stack-size');
  const stackVal    = q('#mm-stack-val');
  if (stackSlider && stackVal) {
    stackSlider.addEventListener('input', () => {
      const v = parseInt(stackSlider.value, 10);
      stackVal.textContent = v;
      const sm = main.getStateManager?.() ?? main._stateManager;
      if (sm) sm.limit = v;
      repaintFn?.();
    });
  }
}

export function wireMenuReference(el, main, repaintFn) {
  el.querySelector('#mm-ref-add')?.addEventListener('click', () => document.getElementById('referenceopen')?.click());
  el.querySelector('#mm-ref-clear')?.addEventListener('click', () => { main.getReferenceManager?.()?.clear?.(); repaintFn?.(); });
  el.querySelector('#mm-ref-show')?.addEventListener('click', (e) => { e.currentTarget.classList.toggle('active'); repaintFn?.(); });
}

// ── Desktop topbar dropdown menus ─────────────────────────────────────────────
// These build/wire functions power the new HTML topbar introduced when yagui
// was removed.  They follow the same buildMenuHTML_* / wireMenu* pattern used
// by the VR main menu.


export function buildMenuHTML_background(main) {
  const bg   = main.getBackground?.();
  const type = bg?._type ?? 0;
  const blur = bg?._blur ?? 0;
  const fill = bg?._fill ?? false;
  return `
    <div class="mm-section-title">Type</div>
    ${buildSelectHTML('mm-bg-type', [
      { val: 0, label: 'Image' },
      { val: 1, label: 'Environment' },
      { val: 2, label: 'Ambient env' },
    ], type)}
    <div class="mm-row" id="mm-blur-row"${type!==1?' style="display:none"':''}>
      <span class="mm-lbl">Blur</span>
      <input type="range" id="mm-bg-blur" min="0" max="1" step="0.01" value="${blur}">
      <span class="mm-val" id="mm-bg-blur-val">${blur.toFixed(2)}</span>
    </div>
    <div class="mm-section-title">Image</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-bg-reset">Reset</button>
      <button class="mm-action-btn" id="mm-bg-import">Import…</button>
    </div>
    <button class="mm-toggle${fill?' active':''}" id="mm-bg-fill">Fill</button>
  `;
}

export function wireMenuBackground(el, main, repaintFn) {
  const q  = (sel) => el.querySelector(sel);
  const bg = main.getBackground?.();

  wireSelect(el, 'mm-bg-type', (v) => {
    const n = parseInt(v, 10);
    bg?.setType?.(n);
    main.onCanvasResize?.();
    main.render?.();
    const blurRow = q('#mm-blur-row');
    if (blurRow) blurRow.style.display = n === 1 ? '' : 'none';
  });

  wireSlider(q('#mm-bg-blur'), q('#mm-bg-blur-val'),
    (v) => { if (bg) bg._blur = v; main.render?.(); },
    v => v.toFixed(2));

  q('#mm-bg-reset')?.addEventListener('click',  () => { bg?.deleteTexture?.(); main.render?.(); });
  q('#mm-bg-import')?.addEventListener('click', () => document.getElementById('backgroundopen')?.click());

  q('#mm-bg-fill')?.addEventListener('click', (e) => {
    if (bg) bg._fill = !bg._fill;
    e.currentTarget.classList.toggle('active', bg?._fill ?? false);
    main.onCanvasResize?.();
  });

  fixSliderDrag(el);
}

export function buildMenuHTML_tablet(main) {
  const rf    = Tablet.radiusFactor ?? 0.75;
  const ifact = Tablet.intensityFactor ?? 0.0;
  return `
    <div class="mm-section-title">Pen Pressure</div>
    <div class="mm-row">
      <span class="mm-lbl">Radius factor</span>
      <input type="range" id="mm-tablet-radius" min="0" max="1" step="0.01" value="${rf}">
      <span class="mm-val" id="mm-tablet-radius-val">${rf.toFixed(2)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Intensity factor</span>
      <input type="range" id="mm-tablet-intensity" min="0" max="1" step="0.01" value="${ifact}">
      <span class="mm-val" id="mm-tablet-intensity-val">${ifact.toFixed(2)}</span>
    </div>
  `;
}

export function wireMenuTablet(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);
  wireSlider(q('#mm-tablet-radius'),    q('#mm-tablet-radius-val'),
    (v) => { Tablet.radiusFactor    = v; }, v => v.toFixed(2));
  wireSlider(q('#mm-tablet-intensity'), q('#mm-tablet-intensity-val'),
    (v) => { Tablet.intensityFactor = v; }, v => v.toFixed(2));
  fixSliderDrag(el);
}

export function buildMenuHTML_desktopSettings(main) {
  const opts = getOptionsURL();

  const langs   = Object.keys(TR.languages);
  const langIdx = langs.indexOf(TR.select);

  return `
    <div class="mm-section-title">Advanced</div>
    <button class="mm-toggle${opts.debugMode?' active':''}" id="mm-debug-log">Show debug log</button>
    <button class="mm-toggle" id="mm-eruda-console">Show Eruda console</button>
    <button class="mm-action-btn" id="mm-clear-log">Clear log</button>
    <div class="mm-section-title">Language</div>
    ${buildSelectHTML('mm-language', langs.map((l, i) => ({ val: i, label: l })), langIdx)}
  `;
}

export function wireMenuDesktopSettings(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);

  q('#mm-debug-log')?.addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('active');
    e.currentTarget.classList.toggle('active', next);
    window._showDebugLog = next;
    getOptionsURL.saveOption('debugMode', next);
    const log = document.getElementById('log');
    if (log) log.style.display = next ? 'block' : 'none';
    if (next && window.screenLog) window.screenLog('Debug Log Enabled', 'lime');
  });

  q('#mm-eruda-console')?.addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('active');
    e.currentTarget.classList.toggle('active', next);
    if (next) {
      if (!window.eruda) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/eruda';
        script.onload = () => { window.eruda.init(); window.eruda.show(); };
        document.head.appendChild(script);
      } else {
        window.eruda.show();
        const c = document.querySelector('.eruda-container');
        c?.shadowRoot?.querySelector('.eruda-entry-btn')?.style?.setProperty('display', 'block', 'important');
      }
    } else {
      window.eruda?.hide?.();
      const c = document.querySelector('.eruda-container');
      c?.shadowRoot?.querySelector('.eruda-entry-btn')?.style?.setProperty('display', 'none', 'important');
    }
  });

  q('#mm-clear-log')?.addEventListener('click', () => {
    const log = document.getElementById('log');
    if (log) {
      while (log.children.length > 1) log.removeChild(log.lastChild);
      if (window.screenLog) window.screenLog('Log Cleared', 'lime');
    }
  });

  wireSelect(el, 'mm-language', (v) => {
    const langs = Object.keys(TR.languages);
    TR.select = langs[parseInt(v, 10)];
    getOptionsURL.saveOption('language', TR.select);
    main.getGui?.().initGui?.();
  });
}
