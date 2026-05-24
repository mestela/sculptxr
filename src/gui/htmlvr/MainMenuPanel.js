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
 * _activeMenu:    null | 'files'|'history'|'reference'|'settings'|'about'
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

// ── Dimensions ───────────────────────────────────────────────────────────────
const MM_W         = 480;   // total DOM width  (px)
const MM_TABS_W    = 48;    // left tab-strip width
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
  padding: 6px 0;
  gap: 4px;
  border-right: 2px solid #45475a;
  background: #11111b;
  box-sizing: border-box;
  overflow: hidden;
}
.mm-tab-btn {
  width: 42px;
  padding: 7px 0;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.mm-tab-btn .mm-tab-icon { font-size: 16px; }
.mm-tab-btn:hover, .mm-tab-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-tab-btn.active {
  background: rgba(137,180,250,0.25);
  color: #89b4fa;
  border-color: #89b4fa;
  font-weight: 800;
}

/* ── Content area ────────────────────────────────────────────── */
#mm-content {
  position: absolute;
  top: 0;
  left: ${MM_TABS_W}px;
  right: 0; bottom: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 10px;
  box-sizing: border-box;
}

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

/* Conditional sections (Rendering) */
.mm-if-pbr, .mm-if-matcap, .mm-if-uv { display: none; }
.shader-pbr    .mm-if-pbr    { display: block; }
.shader-matcap .mm-if-matcap { display: block; }
.shader-uv     .mm-if-uv     { display: block; }

/* Scrollable list (many options — controller model) */
.mm-radio-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid #313244;
  border-radius: 5px;
  padding: 3px;
  margin-bottom: 6px;
}
.mm-radio-list .mm-choice {
  text-align: left;
  padding: 5px 8px;
}
`;

let _mmCssInjected = false;
function injectCSS() {
  if (_mmCssInjected) return;
  _mmCssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── Shell HTML (static structure only; content area is filled dynamically) ──
function buildShellHTML() {
  return `
    <div id="mm-menubar">
      <button class="mm-menu-btn" data-menu="files">Files</button>
      <button class="mm-menu-btn" data-menu="history">History</button>
      <button class="mm-menu-btn" data-menu="reference">Reference</button>
      <button class="mm-menu-btn" data-menu="settings">Settings</button>
      <button class="mm-menu-btn" data-menu="about">About</button>
    </div>
    <div id="mm-body">
      <div id="mm-tabstrip">
        <button class="mm-tab-btn active" data-section="scene">
          <span class="mm-tab-icon">🏔</span>Scene
        </button>
        <button class="mm-tab-btn" data-section="topology">
          <span class="mm-tab-icon">🔷</span>Topo
        </button>
        <button class="mm-tab-btn" data-section="rendering">
          <span class="mm-tab-icon">🎨</span>Rndng
        </button>
        <button class="mm-tab-btn" data-section="sculpting">
          <span class="mm-tab-icon">🖌</span>Sculpt
        </button>
      </div>
      <div id="mm-content"></div>
    </div>
  `;
}

// ── Content builders ─────────────────────────────────────────────────────────

function buildMenuHTML_files(main) {
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  const exportAll  = guiFiles?._exportAll ?? true;
  const objZbrush  = guiFiles?._objColorZbrush ?? false;
  const objAppend  = guiFiles?._objColorAppended ?? false;

  return `
    <div class="mm-section-title">Import</div>
    <button class="mm-action-btn" id="mm-import-obj">Add mesh (obj, sgl, ply, stl)</button>
    <button class="mm-toggle${main._autoMatrix ? ' active' : ''}" id="mm-import-scale">Scale & center on import</button>
    <button class="mm-toggle${main._vertexSRGB ? ' active' : ''}" id="mm-import-srgb">sRGB vertex colour</button>

    <div class="mm-section-title">Export scene</div>
    <button class="mm-toggle${exportAll ? ' active' : ''}" id="mm-export-all">Export all meshes</button>
    <button class="mm-action-btn" id="mm-export-sxr">Save .sxr (SculptXR native)</button>
    <button class="mm-action-btn" id="mm-export-glb">Save .glb (Animation DAW)</button>
    <button class="mm-action-btn" id="mm-browser-save">Save to browser storage</button>
    <button class="mm-action-btn" id="mm-browser-load">Load from browser storage</button>
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

function buildMenuHTML_history(main) {
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

function buildMenuHTML_reference() {
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

  // Controller options (value = index into list)
  const ctrlModels  = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
    'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
    'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
  const curCtrl = ctrlModels.indexOf(window._xrControllerOverride ?? 'Auto');

  const wfTypes = [
    { id: 1, label: 'Smooth' },
    { id: 0, label: 'Fast'   },
    { id: 2, label: 'Full'   },
  ];
  const curWfType = main.getMesh?.()?.getWireframeType?.() ?? 1;

  const ctrlRadios = ctrlModels.map((m, i) =>
    `<button class="mm-choice${i === curCtrl ? ' active' : ''}" data-ctrl-idx="${i}">${m}</button>`
  ).join('');

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
    <div class="mm-radio-list" id="mm-ctrl-list">${ctrlRadios}</div>

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

function buildMenuHTML_about() {
  return `
    <div class="mm-section-title">SculptXR</div>
    <div class="mm-info">Version v1.0 (htmlvr)</div>
    <div class="mm-info">WebXR sculpting tool</div>
    <div class="mm-section-title">Credits</div>
    <div class="mm-info">Built with Three.js + SculptGL</div>
  `;
}

// ── Section content builders ─────────────────────────────────────────────────

function buildSectionHTML_scene(main) {
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

function buildSectionHTML_topology(main) {
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

function buildSectionHTML_rendering(main) {
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
    </div>
  `;
}

function buildSectionHTML_sculpting() {
  return `
    <div class="mm-section-title">Sculpting</div>
    <div class="mm-info">Sculpt tool settings are in the BrushPanel — open it via the wrist menu or by pressing the grip button.</div>
    <div class="mm-info">The tool picker is also accessible from the wrist MiniPanel.</div>
  `;
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

    this._main          = main;
    this._activeMenu    = null;     // null | 'files'|'history'|'reference'|'settings'|'about'
    this._activeSection = 'scene'; // 'scene'|'topology'|'rendering'|'sculpting'
    this._lastContentKey = '';      // avoids redundant rebuilds
    this._startHidden   = true;

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire(main);
  }

  get pinned() { return false; }

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
        this._setSection(btn.dataset.section);
      });
    });

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
    const key = this._activeMenu
      ? `menu:${this._activeMenu}`
      : `sec:${this._activeSection}:${shaderType}:${meshCount}`;

    if (key === this._lastContentKey) return;
    this._lastContentKey = key;

    // Build HTML
    const main = this._main;
    let html = '';
    if (this._activeMenu) {
      switch (this._activeMenu) {
        case 'files':     html = buildMenuHTML_files(main);     break;
        case 'history':   html = buildMenuHTML_history(main);   break;
        case 'reference': html = buildMenuHTML_reference();     break;
        case 'settings':  html = buildMenuHTML_settings(main);  break;
        case 'about':     html = buildMenuHTML_about();         break;
      }
    } else {
      switch (this._activeSection) {
        case 'scene':     html = buildSectionHTML_scene(main);     break;
        case 'topology':  html = buildSectionHTML_topology(main);  break;
        case 'rendering': html = buildSectionHTML_rendering(main); break;
        case 'sculpting': html = buildSectionHTML_sculpting();     break;
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
      const guiFiles = main.getGui?.()._ctrlFiles ?? null;

      q('#mm-import-obj')?.addEventListener('click', () => {
        document.getElementById('fileopen')?.click();
      });
      q('#mm-import-scale')?.addEventListener('click', () => {
        main._autoMatrix = !main._autoMatrix;
        q('#mm-import-scale')?.classList.toggle('active', main._autoMatrix);
        paint();
      });
      q('#mm-import-srgb')?.addEventListener('click', () => {
        main._vertexSRGB = !main._vertexSRGB;
        q('#mm-import-srgb')?.classList.toggle('active', main._vertexSRGB);
        paint();
      });
      q('#mm-export-all')?.addEventListener('click', () => {
        if (guiFiles) { guiFiles._exportAll = !guiFiles._exportAll; }
        q('#mm-export-all')?.classList.toggle('active', guiFiles?._exportAll ?? true);
        paint();
      });
      q('#mm-export-sxr')?.addEventListener('click', () => guiFiles?.saveFileAsSGL?.());
      q('#mm-export-glb')?.addEventListener('click', () => guiFiles?.saveFileAsGLB?.());
      q('#mm-browser-save')?.addEventListener('click', () => guiFiles?.saveToBrowserStorage?.());
      q('#mm-browser-load')?.addEventListener('click', () => guiFiles?.refreshBrowserSaves?.()
        .then(() => main.render?.())
      );
      q('#mm-export-obj')?.addEventListener('click', () => guiFiles?.saveFileAsOBJ?.());
      q('#mm-export-ply')?.addEventListener('click', () => guiFiles?.saveFileAsPLY?.());
      q('#mm-export-stl')?.addEventListener('click', () => guiFiles?.saveFileAsSTL?.());

      const texSlider = q('#mm-tex-size');
      const texVal    = q('#mm-tex-size-val');
      if (texSlider && texVal) {
        texSlider.addEventListener('input', () => {
          texVal.textContent = Math.round(Math.pow(2, texSlider.value));
          paint();
        });
        texVal.textContent = Math.round(Math.pow(2, texSlider.value));
      }
      q('#mm-save-diffuse')?.addEventListener('click',    () => guiFiles?.saveTextureDiffuse?.());
      q('#mm-save-roughness')?.addEventListener('click',  () => guiFiles?.saveTextureRoughness?.());
      q('#mm-save-metalness')?.addEventListener('click',  () => guiFiles?.saveTextureMetalness?.());

    } else if (menu === 'history') {
      q('#mm-undo')?.addEventListener('click', () => { main.onKeyUp?.({ keyCode: 90, ctrlKey: true }); paint(); });
      q('#mm-redo')?.addEventListener('click', () => { main.onKeyUp?.({ keyCode: 89, ctrlKey: true }); paint(); });

      const stackSlider = q('#mm-stack-size');
      const stackVal    = q('#mm-stack-val');
      if (stackSlider && stackVal) {
        stackSlider.addEventListener('input', () => {
          const v = parseInt(stackSlider.value, 10);
          stackVal.textContent = v;
          const sm = main.getStateManager?.() ?? main._stateManager;
          if (sm) sm.limit = v;
          paint();
        });
      }

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
      // static, nothing to wire
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
    el.querySelector('#mm-ctrl-list')?.querySelectorAll('[data-ctrl-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ctrlModels = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
          'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
          'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
        const idx = parseInt(btn.dataset.ctrlIdx, 10);
        window._xrControllerOverride = ctrlModels[idx];
        opts.saveOption('controllerModel', ctrlModels[idx]);
        el.querySelectorAll('[data-ctrl-idx]').forEach(b =>
          b.classList.toggle('active', b === btn));
        if (window._reloadControllerModels) window._reloadControllerModels.call(main);
        else main.reloadControllerModels?.();
        main.render?.();
        paint();
      });
    });

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
    const paint = () => { this._lastContentKey = ''; this._rebuildContent(); };

    if (section === 'scene') {
      // Outliner — visibility toggles
      el.querySelectorAll('[data-action="vis"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mesh = this._findMeshById(btn.dataset.meshId);
          if (!mesh) return;
          const cur = mesh.isVisible?.() ?? true;
          mesh.setVisible?.(!cur);
          if (mesh.getThreeMesh?.()) mesh.getThreeMesh().visible = !cur;
          main.render?.();
          paint();
        });
      });

      // Outliner — select mesh
      el.querySelectorAll('[data-action="select"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mesh = this._findMeshById(btn.dataset.meshId);
          if (mesh) { main.setOrUnsetMesh?.(mesh, false); main.render?.(); paint(); }
        });
      });

      el.querySelector('#mm-add-sphere')?.addEventListener('click', () => {
        main.addNewMesh?.('sphere'); main.render?.(); paint();
      });
      el.querySelector('#mm-add-cube')?.addEventListener('click', () => {
        main.addNewMesh?.('cube'); main.render?.(); paint();
      });
      el.querySelector('#mm-clear-scene')?.addEventListener('click', () => {
        if (!main._clearSceneConfirm) {
          main._clearSceneConfirm = true;
          paint(); // re-render button as "Confirm"
          setTimeout(() => { main._clearSceneConfirm = false; }, 3000);
        } else {
          main._clearSceneConfirm = false;
          main.clearScene?.(); main.render?.(); paint();
        }
      });
      el.querySelector('#mm-duplicate')?.addEventListener('click', () => {
        main.duplicateMesh?.(); main.render?.(); paint();
      });
      el.querySelector('#mm-delete-mesh')?.addEventListener('click', () => {
        main.deleteMesh?.(); main.render?.(); paint();
      });

    } else if (section === 'topology') {
      const topo = main.getGui?.()._ctrlTopology ?? null;
      const repaint = () => paint();

      el.querySelector('#mm-level-down')?.addEventListener('click', () => {
        const m = main.getMesh?.();
        if (m?._meshes && m._sel > 0) { topo?.onResolutionChanged?.(m._sel); repaint(); }
      });
      el.querySelector('#mm-level-up')?.addEventListener('click', () => {
        const m = main.getMesh?.();
        if (m?._meshes && m._sel < m._meshes.length - 1) { topo?.onResolutionChanged?.(m._sel + 2); repaint(); }
      });
      el.querySelector('#mm-subdivide')?.addEventListener('click',   () => { topo?.subdivide?.();    main.render?.(); repaint(); });
      el.querySelector('#mm-reverse')?.addEventListener('click',     () => { topo?.reverse?.();      main.render?.(); repaint(); });
      el.querySelector('#mm-del-lower')?.addEventListener('click',   () => { topo?.deleteLower?.();  main.render?.(); repaint(); });
      el.querySelector('#mm-del-higher')?.addEventListener('click',  () => { topo?.deleteHigher?.(); main.render?.(); repaint(); });

      this._wireSlider(
        el.querySelector('#mm-remesh-res'), el.querySelector('#mm-remesh-res-val'),
        (v) => { Remesh.RESOLUTION = v; topo?.remeshResolution?.(v); }
      );
      el.querySelector('#mm-remesh-block')?.addEventListener('click', () => {
        Remesh.BLOCK = !Remesh.BLOCK;
        el.querySelector('#mm-remesh-block')?.classList.toggle('active', Remesh.BLOCK);
        this.markDirty();
      });
      el.querySelector('#mm-remesh')?.addEventListener('click',    () => { topo?.remesh?.();   main.render?.(); repaint(); });
      el.querySelector('#mm-remesh-mc')?.addEventListener('click', () => { topo?.remeshMC?.(); main.render?.(); repaint(); });
      el.querySelector('#mm-remesh-smooth')?.addEventListener('click', () => {
        Remesh.SMOOTHING = !Remesh.SMOOTHING;
        el.querySelector('#mm-remesh-smooth')?.classList.toggle('active', Remesh.SMOOTHING);
        this.markDirty();
      });
      el.querySelector('#mm-dynamic')?.addEventListener('click', () => {
        topo?.dynamicToggleActivate?.(); main.render?.(); repaint();
      });
      el.querySelector('#mm-mesh-to-voxels')?.addEventListener('click', () => {
        topo?.meshToVoxel?.(); main.render?.(); repaint();
      });
      el.querySelector('#mm-validate')?.addEventListener('click', () => {
        topo?.validateMesh?.();
      });
      el.querySelector('#mm-auto-heal')?.addEventListener('click', () => {
        el.querySelector('#mm-auto-heal')?.classList.toggle('active');
        this.markDirty();
      });

    } else if (section === 'rendering') {
      const mesh = main.getMesh?.();
      const root = el.querySelector('#mm-render-root');
      const paint = () => this.markDirty();

      // Shader choice buttons
      el.querySelectorAll('[data-shader]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.shader, 10);
          const meshes = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh];
          meshes?.forEach(m => m.setShaderType?.(id));
          main.render?.();
          // Re-run full rebuild so conditional sections appear/disappear
          this._lastContentKey = '';
          this._rebuildContent();
        });
      });

      // Environment (PBR)
      el.querySelectorAll('[data-env]').forEach(btn => {
        btn.addEventListener('click', () => {
          const ShaderPBR = Shader[Enums.Shader.PBR];
          ShaderPBR.idEnv = parseInt(btn.dataset.env, 10);
          main.render?.();
          el.querySelectorAll('[data-env]').forEach(b => b.classList.toggle('active', b === btn));
          paint();
        });
      });

      // Matcap
      el.querySelectorAll('[data-matcap]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.matcap, 10);
          (main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh])
            ?.forEach(m => m.setMatcap?.(id));
          main.render?.();
          el.querySelectorAll('[data-matcap]').forEach(b => b.classList.toggle('active', b === btn));
          paint();
        });
      });

      el.querySelector('#mm-import-matcap')?.addEventListener('click', () => document.getElementById('matcapopen')?.click());
      el.querySelector('#mm-import-uv')?.addEventListener('click', () => document.getElementById('textureopen')?.click());

      // Display sliders
      const meshes = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh];
      this._wireSlider(el.querySelector('#mm-curvature'), el.querySelector('#mm-curvature-val'), (v) => {
        meshes?.forEach(m => m.setCurvature?.(v / 20)); main.render?.();
      });
      this._wireSlider(el.querySelector('#mm-transparency'), el.querySelector('#mm-transparency-val'), (v) => {
        meshes?.forEach(m => m.setOpacity?.(1 - v / 100)); main.render?.();
      }, (v) => `${v}%`);

      el.querySelector('#mm-flat-shading')?.addEventListener('click', () => {
        const t = !mesh?.getFlatShading?.();
        meshes?.forEach(m => m.setFlatShading?.(t));
        main.render?.();
        el.querySelector('#mm-flat-shading')?.classList.toggle('active', t);
        paint();
      });
      el.querySelector('#mm-wireframe')?.addEventListener('click', () => {
        const t = !mesh?.getShowWireframe?.();
        (main.getMeshes?.() ?? meshes)?.forEach(m => m.setShowWireframe?.(t));
        main.render?.();
        el.querySelector('#mm-wireframe')?.classList.toggle('active', t);
        paint();
      });
      el.querySelector('#mm-solid')?.addEventListener('click', () => {
        meshes?.forEach(m => {
          const mat = m._renderData?._threeMesh?.material;
          if (mat) mat.visible = !mat.visible;
        });
        main.render?.();
        paint();
      });

      // Tone mapping
      el.querySelectorAll('[data-tonemap]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.tonemap, 10);
          main.setToneMapping?.(id);
          el.querySelectorAll('[data-tonemap]').forEach(b => b.classList.toggle('active', b === btn));
          paint();
        });
      });

      // Exposure
      this._wireSlider(el.querySelector('#mm-exposure'), el.querySelector('#mm-exposure-val'), (v) => {
        main.setExposure?.(v / 100); main.render?.();
      }, (v) => (v / 100).toFixed(2));
    }
  }

  // ── Slider helper ──────────────────────────────────────────────────────────
  // Wires input[type=range] → val display span → callback.
  // formatFn(intValue) → string; default is just String(v).

  _wireSlider(sliderEl, valEl, cb, formatFn) {
    if (!sliderEl) return;
    const fmt = formatFn ?? ((v) => String(v));
    const update = () => {
      const v = parseFloat(sliderEl.value);
      if (valEl) valEl.textContent = fmt(v);
      cb(v);
      this.markDirty();
    };
    sliderEl.addEventListener('input', update);
    // Initialise display from current value
    if (valEl) valEl.textContent = fmt(parseFloat(sliderEl.value));
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
