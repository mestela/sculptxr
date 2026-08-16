/**
 * MiniPanel — compact wrist HUD for SculptXR.
 *
 * Replaces the legacy canvas-based MiniHUD with a live HTML panel rendered
 * into a WebGL texture via the three-html-render polyfill.
 *
 * Displays:
 *   • Current tool button (tinted by tool family) → tapping opens BrushPanel
 *   • Radius + Intensity sliders
 *   • Symmetry / Negative / Wireframe toggles
 *   • Tool-specific extras (masking, paint, voxel, extrude/inset)
 *
 * Scene.js wires:
 *   this._miniPanel = new MiniPanel(this, scene, camera, renderer);
 *   this._miniPanel.bindDesktopPointers(renderer, camera);
 *   this._miniPanel._element.addEventListener('mp-show-brush-panel', () => {
 *     this._swapHtmlPanels('brush');
 *   });
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import Enums          from '../../misc/Enums.js';
import getOptionsURL  from '../../misc/getOptionsURL.js';
import Utils          from '../../misc/Utils.js';
import { toolTint }   from './toolTints.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import Skinning       from '../../editing/Skinning.js';
import Skeleton       from '../../editing/Skeleton.js';


// ── Tool name lookup ─────────────────────────────────────────────────────────
const TOOL_NAMES = {
  [Enums.Tools.BRUSH]:        'Brush',
  [Enums.Tools.INFLATE]:      'Inflate',
  [Enums.Tools.TWIST]:        'Twist',
  [Enums.Tools.SMOOTH]:       'Smooth',
  [Enums.Tools.FLATTEN]:      'Flatten',
  [Enums.Tools.PINCH]:        'Pinch',
  [Enums.Tools.CREASE]:       'Crease',
  [Enums.Tools.DRAG]:         'Drag',
  [Enums.Tools.RELAX]:        'Relax',
  [Enums.Tools.PAINT]:        'Paint',
  [Enums.Tools.MOVE]:         'Move',
  [Enums.Tools.MASKING]:      'Masking',
  [Enums.Tools.LOCALSCALE]:   'Scale',
  [Enums.Tools.TRANSFORM]:    'Transform',
  [Enums.Tools.VOXEL]:        'Voxel',
  [Enums.Tools.GRAB]:         'Grab',
  [Enums.Tools.TRANSFORM_VR]: 'Transform',
  [Enums.Tools.SLIDE]:        'Slide',
  [Enums.Tools.DELETE_FACE]:  'Del Face',
  [Enums.Tools.FILL_HOLE]:    'Fill Hole',
  [Enums.Tools.DISSOLVE_EDGE]:'Dis.Edge',
  [Enums.Tools.SPLIT_FACE]:   'Split',
  [Enums.Tools.SPIN_EDGE]:    'Spin',
  [Enums.Tools.COLLAPSE_EDGE]:'Col.Edge',
  [Enums.Tools.DISSOLVE_VERTEX]:'Dis.Vert',
  [Enums.Tools.WELD]:         'Weld',
  [Enums.Tools.CUT_TOOL]:     'Cut',
  [Enums.Tools.EXTRUDE]:      'Extrude',
  [Enums.Tools.INSET]:        'Inset',
  [Enums.Tools.BONE_DRAW]:    'Bones',
};
const toolName = (id) => TOOL_NAMES[id] ?? `Tool ${id}`;

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
/* ── MiniPanel — Catppuccin Mocha ──────────────────────────────────── */
#mp-root {
  width: 240px;
  padding: 10px 12px 12px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid #313244;
  user-select: none;
}

/* ── Tool button ──────────────────────────────────────────────────── */
#mp-tool-btn {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #45475a;
  border-radius: 8px;
  background: #313244;
  color: #cdd6f4;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  outline: none;
  transition: filter 0.1s;
}
#mp-tool-btn:hover,
#mp-tool-btn.hover  { filter: brightness(1.25); }
#mp-tool-btn:active,
#mp-tool-btn.active { filter: brightness(1.45); }
#mp-tool-btn .mp-tool-arrow {
  font-size: 11px;
  color: #6c7086;
  margin-left: 6px;
}

/* ── Divider ──────────────────────────────────────────────────────── */
#mp-root .mp-divider {
  border: none;
  border-top: 1px solid #313244;
  margin: 8px 0;
}

/* ── Sliders ──────────────────────────────────────────────────────── */
#mp-root .mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
#mp-root .mp-lbl {
  width: 62px;
  font-size: 11px;
  color: #a6adc8;
  flex-shrink: 0;
}
#mp-root input[type=range] {
  flex: 1;
  -webkit-appearance: none;
  height: 5px;
  border-radius: 3px;
  background: #45475a;
  outline: none;
  cursor: pointer;
}
#mp-root input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #89b4fa;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(137,180,250,0.25);
}
#mp-root .mp-val {
  width: 32px;
  text-align: right;
  font-size: 11px;
  color: #89b4fa;
  font-variant-numeric: tabular-nums;
}

/* ── Toggle row ───────────────────────────────────────────────────── */
#mp-root .mp-toggles {
  display: flex;
  gap: 6px;
}
#mp-root .mp-toggle-btn {
  flex: 1;
  padding: 6px 4px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #6c7086;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
#mp-root .mp-toggle-btn.active     { background: #313244; color: #89b4fa; border-color: #585b70; }
#mp-root .mp-toggle-btn:hover,
#mp-root .mp-toggle-btn.hover      { background: #24243e; color: #a6adc8; border-color: #45475a; }
#mp-root .mp-toggle-btn:active,
#mp-root .mp-toggle-btn.active.hover { background: #45475a; }

/* ── Extras section ───────────────────────────────────────────────── */
#mp-extras {
  margin-top: 8px;
}

/* Masking buttons */
#mp-extras .mp-btn-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
#mp-extras .mp-action-btn {
  flex: 1;
  padding: 7px 6px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
#mp-extras .mp-action-btn:hover,
#mp-extras .mp-action-btn.hover  { background: #24243e; color: #cdd6f4; border-color: #45475a; }
#mp-extras .mp-action-btn:active,
#mp-extras .mp-action-btn.active { background: #45475a; }

/* Paint colour swatch */
#mp-color-swatch {
  width: 100%;
  height: 20px;
  border-radius: 5px;
  border: 1px solid #45475a;
  margin-bottom: 8px;
  box-sizing: border-box;
}

/* Voxel mode grid */
#mp-extras .mp-voxel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin-bottom: 6px;
}
#mp-extras .mp-voxel-btn {
  padding: 6px 4px;
  border: 1px solid #313244;
  border-radius: 6px;
  background: #181825;
  color: #a6adc8;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
#mp-extras .mp-voxel-btn.active    { background: #313244; color: #cba6f7; border-color: #cba6f7; }
#mp-extras .mp-voxel-btn:hover,
#mp-extras .mp-voxel-btn.hover     { background: #24243e; color: #cdd6f4; border-color: #45475a; }
#mp-extras .mp-voxel-btn:active    { background: #45475a; }

/* Keep-Together toggle */
#mp-extras .mp-keep-btn {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #6c7086;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
#mp-extras .mp-keep-btn.active  { background: #313244; color: #89b4fa; border-color: #585b70; }
#mp-extras .mp-keep-btn:hover,
#mp-extras .mp-keep-btn.hover   { background: #24243e; color: #a6adc8; border-color: #45475a; }
`;

let _mpCssInjected = false;
function injectCSS() {
  if (_mpCssInjected) return;
  _mpCssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Static HTML ───────────────────────────────────────────────────────────────
function buildHTML() {
  return `
    <button id="mp-tool-btn" style="background:${toolTint(0)}">
      <span id="mp-tool-name">Brush</span>
      <span class="mp-tool-arrow">▸ All</span>
    </button>
    <div class="mp-row">
      <span class="mp-lbl">Radius</span>
      <input type="range" id="mp-radius" min="5" max="250" step="1" value="50">
      <span class="mp-val" id="mp-radius-val">50</span>
    </div>
    <div class="mp-row">
      <span class="mp-lbl">Intensity</span>
      <input type="range" id="mp-intensity" min="0" max="100" step="1" value="50">
      <span class="mp-val" id="mp-intensity-val">50%</span>
    </div>
    <hr class="mp-divider">
    <div class="mp-toggles">
      <button class="mp-toggle-btn" id="mp-sym">✓ Sym</button>
      <button class="mp-toggle-btn" id="mp-neg">✓ Neg</button>
      <button class="mp-toggle-btn" id="mp-wire">Wire</button>
    </div>
    <div id="mp-extras"></div>
  `;
}

// ── Colour Wheel widget (pure HTML/CSS) ──────────────────────────────────────
//
// Renders the HSV picker as plain HTML divs + CSS gradients so it works
// through the SVG-foreignObject polyfill.  Canvas pixel content is NOT
// captured by foreignObject, so we use:
//   • conic-gradient div  → hue ring
//   • layered linear-gradient divs → SV square
//   • absolutely-positioned divs   → indicators / swatches
// Interaction is handled by a pointerdown listener on the root div plus
// document-level pointermove/pointerup so drags never "lose" the target.
//
// Layout constants (must match the HTML template in _buildExtrasHTML):
//   Widget: 216 × 216 px
//   Swatch row: 40 px tall at the top
//   Ring div: left 20, top 40, 176 × 176  → outer R = 88, inner R ≈ 68
//   Ring centre in widget: (108, 128)      → ring mid-radius = 78
//   SV square: left 62, top 82, 92 × 92   → half = 46

const _CW_CX = 108, _CW_CY = 128;   // ring centre in widget coords
const _CW_OR = 88,  _CW_IR = 68;    // outer / inner radius
const _CW_MR = 78;                   // mid-radius for indicator placement
const _CW_SX = 62,  _CW_SY = 82;    // SV square top-left
const _CW_SS = 92;                   // SV square side length

class ColorWheel {
  constructor(rootEl, main, onchange) {
    this._root      = rootEl;
    this._main      = main;
    this._onchange  = onchange;
    this._region    = null;    // 'hue' | 'sv' | null
    this._cachedHue = null;
    this._lastSwap  = 0;
    this._lastEye   = 0;

    this._onDown = (e) => this._handleDown(e);
    this._onMove = (e) => { if (this._region) this._handleMove(e); };
    this._onUp   = ()  => { this._region = null; };

    rootEl.addEventListener('pointerdown', this._onDown);
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup',   this._onUp);

    this.draw();
  }

  dispose() {
    this._root.removeEventListener('pointerdown', this._onDown);
    document.removeEventListener('pointermove',   this._onMove);
    document.removeEventListener('pointerup',     this._onUp);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _tool() {
    const sm = this._main.getSculptManager?.();
    let t = sm?.getCurrentTool?.();
    if (!t?._color) t = sm?.getTool?.(Enums.Tools.PAINT);
    return (t?._color) ? t : null;
  }

  _el(id) { return this._root.querySelector('#' + id); }

  _localXY(e) {
    const r = this._root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ── Draw: update inline styles only — no canvas, no encoding ─────────────────

  draw() {
    const tool = this._tool();
    if (!tool) return;

    const [h, s, v] = Utils.rgb2hsv(tool._color[0], tool._color[1], tool._color[2]);
    const aHue = (this._region === 'sv' && this._cachedHue !== null) ? this._cachedHue : h;

    // FG / BG swatches
    const fg = tool._color;
    const elFg = this._el('mp-cw-fg');
    if (elFg) elFg.style.background = `rgb(${fg[0]*255|0},${fg[1]*255|0},${fg[2]*255|0})`;
    const sec = tool._colorSecondary ?? [0, 0, 0];
    const elBg = this._el('mp-cw-bg');
    if (elBg) elBg.style.background = `rgb(${sec[0]*255|0},${sec[1]*255|0},${sec[2]*255|0})`;

    // Eyedropper active state
    const elEye = this._el('mp-cw-eye');
    if (elEye) elEye.style.color = tool._pickColor ? '#89b4fa' : '#6c7086';

    // SV square: hue background layer
    const elSvBg = this._el('mp-cw-sv-bg');
    if (elSvBg) elSvBg.style.background = `hsl(${aHue * 360}deg,100%,50%)`;

    // SV indicator position + contrast border
    const elSvI = this._el('mp-cw-sv-i');
    if (elSvI) {
      elSvI.style.left        = `${s * 100}%`;
      elSvI.style.top         = `${(1 - v) * 100}%`;
      elSvI.style.borderColor = (v > 0.5 && s < 0.5) ? 'black' : 'white';
    }

    // Hue ring indicator: position on ring + matching hue colour
    const elHI = this._el('mp-cw-h-i');
    if (elHI) {
      const ang = aHue * Math.PI * 2;
      elHI.style.left       = `${_CW_CX + Math.cos(ang) * _CW_MR}px`;
      elHI.style.top        = `${_CW_CY + Math.sin(ang) * _CW_MR}px`;
      elHI.style.background = `hsl(${aHue * 360}deg,100%,50%)`;
    }
  }

  // ── Interaction ───────────────────────────────────────────────────────────────

  _handleDown(e) {
    const [lx, ly] = this._localXY(e);

    // Swap button region (left:46, top:10, ~38px wide, ~22px tall)
    if (lx >= 44 && lx <= 86 && ly >= 8 && ly <= 32) {
      const now = performance.now();
      if (now - this._lastSwap > 300) {
        this._lastSwap = now;
        const tool = this._tool();
        if (tool) {
          if (typeof tool.swapColors === 'function') {
            tool.swapColors();
          } else if (tool._colorSecondary) {
            const tmp = [tool._color[0], tool._color[1], tool._color[2]];
            tool._color[0] = tool._colorSecondary[0];
            tool._color[1] = tool._colorSecondary[1];
            tool._color[2] = tool._colorSecondary[2];
            tool._colorSecondary[0] = tmp[0];
            tool._colorSecondary[1] = tmp[1];
            tool._colorSecondary[2] = tmp[2];
          }
          this._main.render?.();
          this.draw(); this._onchange?.();
        }
      }
      return;
    }

    // Eyedropper region (right:8, top:10 → left:~168, ~40px wide)
    if (lx >= 166 && lx <= 210 && ly >= 8 && ly <= 32) {
      const now = performance.now();
      if (now - this._lastEye > 300) {
        this._lastEye = now;
        const tool = this._tool();
        if (tool) {
          tool._pickColor = !tool._pickColor;
          this._main.render?.();
          this.draw(); this._onchange?.();
        }
      }
      return;
    }

    this._handleInteraction(lx, ly);
  }

  _handleMove(e) {
    const [lx, ly] = this._localXY(e);
    this._handleInteraction(lx, ly);
  }

  _handleInteraction(lx, ly) {
    const tool = this._tool();
    if (!tool) return;

    const [h, s, v] = Utils.rgb2hsv(tool._color[0], tool._color[1], tool._color[2]);
    const dx   = lx - _CW_CX, dy = ly - _CW_CY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let inSV  = lx >= _CW_SX - 10 && lx <= _CW_SX + _CW_SS + 10
             && ly >= _CW_SY - 10 && ly <= _CW_SY + _CW_SS + 10;
    let inHue = dist >= _CW_IR - 10 && dist <= _CW_OR + 10;

    if (this._region === 'sv') {
      inSV = true; inHue = false;
      if (this._cachedHue === null) this._cachedHue = h;
    } else if (this._region === 'hue') {
      inSV = false; inHue = true;
      this._cachedHue = null;
    } else {
      this._cachedHue = null;
      // Overlap zone: prefer exact SV interior
      if (inHue && inSV) {
        if (lx >= _CW_SX && lx <= _CW_SX + _CW_SS
         && ly >= _CW_SY && ly <= _CW_SY + _CW_SS) inHue = false;
        else inSV = false;
      }
    }

    if (inSV) {
      this._region = 'sv';
      const newS = Math.max(0, Math.min(1, (lx - _CW_SX) / _CW_SS));
      const newV = Math.max(0, Math.min(1, 1 - (ly - _CW_SY) / _CW_SS));
      const aHue = this._cachedHue !== null ? this._cachedHue : h;
      const rgb  = Utils.hsv2rgb(aHue, newS, newV);
      tool._color[0] = rgb[0]; tool._color[1] = rgb[1]; tool._color[2] = rgb[2];
      this._main.render?.();
      this.draw(); this._onchange?.();
    } else if (inHue) {
      this._region = 'hue';
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      const rgb = Utils.hsv2rgb(ang / (Math.PI * 2), s, v);
      tool._color[0] = rgb[0]; tool._color[1] = rgb[1]; tool._color[2] = rgb[2];
      this._main.render?.();
      this.draw(); this._onchange?.();
    }
  }
}

// ── MiniPanel ─────────────────────────────────────────────────────────────────

export class MiniPanel extends HTMLVRPanel {
  /**
   * @param {object}              main      SculptXR main Scene / app object
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(main, scene, camera, renderer) {
    injectCSS();

    const root = document.createElement('div');
    root.id = 'mp-root';
    root.innerHTML = buildHTML();

    // Width derived from shared px/m ratio so fonts match BrushPanel
    super(root, 240 / VR_PANEL_PX_PER_M); // 0.133 m

    this._main          = main;
    this._pinned        = false;  // always false — no pin button on MiniPanel
    this._colorWheel    = null;
    this._lastExtrasIdx = -1;     // track last-built extras so we never compare innerHTML

    // Initialise the Three.js mesh.
    this.init(scene, camera, renderer);

    // Wire DOM events once mesh is ready (requestAnimationFrame delay in init).
    this._waitForMeshThenWire(main);
  }

  // ── Wait for mesh, then wire events ─────────────────────────────────────────

  _waitForMeshThenWire(main) {
    if (this.mesh) {
      this._wireEvents(main);
    } else {
      const check = () => {
        if (this.mesh) this._wireEvents(main);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }
  }

  // ── Wrist offset ──────────────────────────────────────────────────────────

  _onMeshCreated(_scene) {
    if (this.mesh) {
      // Matches legacy MiniHUD wrist positioning
      this.mesh.position.set(0, 0.05, -0.05);
      this.mesh.rotation.set(-Math.PI / 2, Math.PI / 8, 0);
    }
    // Initial state sync once everything is live.
    requestAnimationFrame(() => this.syncFromState());
  }

  // ── DOM event wiring ───────────────────────────────────────────────────────

  _wireHUDBody(main) {
    const root = this._element;

    // ── Radius slider ────────────────────────────────────────────────────────
    const radiusInput = root.querySelector('#mp-radius');
    const radiusVal   = root.querySelector('#mp-radius-val');
    if (radiusInput) {
      radiusInput.addEventListener('input', () => {
        const val = parseFloat(radiusInput.value);
        if (radiusVal) radiusVal.textContent = Math.round(val);
        const sm  = main.getSculptManager?.();
        const idx = sm?.getToolIndex();
        const t   = sm?.getCurrentTool?.();
        if (t) {
          t._radius = val;
          getOptionsURL.saveOption(`tool_${idx}_radius`, val, 500);
          main.render?.();
        }
        this._requestPaint();
      });
    }

    // ── Intensity slider ─────────────────────────────────────────────────────
    const intensityInput = root.querySelector('#mp-intensity');
    const intensityVal   = root.querySelector('#mp-intensity-val');
    if (intensityInput) {
      intensityInput.addEventListener('input', () => {
        const pct = parseFloat(intensityInput.value);
        const val = pct / 100;
        if (intensityVal) intensityVal.textContent = Math.round(pct) + '%';
        const sm  = main.getSculptManager?.();
        const idx = sm?.getToolIndex();
        const t   = sm?.getCurrentTool?.();
        if (t) {
          t._intensity = val;
          getOptionsURL.saveOption(`tool_${idx}_intensity`, val, 500);
          main.render?.();
        }
        this._requestPaint();
      });
    }

    // ── Toggle helpers ───────────────────────────────────────────────────────
    const makeToggle = (id, getVal, setVal) => {
      const btn = root.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        setVal(!getVal());
        this.syncFromState();
      });
    };

    makeToggle('#mp-sym',
      () => main.getSculptManager?.()._symmetry,
      (v) => { const sm = main.getSculptManager?.(); if (sm) { sm._symmetry = v; main.render?.(); } }
    );
    makeToggle('#mp-neg',
      () => main.getSculptManager?.()._negative,
      (v) => { const sm = main.getSculptManager?.(); if (sm) { sm._negative = v; main.render?.(); } }
    );
    makeToggle('#mp-wire',
      () => main.getMesh?.()?.getShowWireframe?.() ?? false,
      (v) => { const mesh = main.getMesh?.(); if (mesh) { mesh.setShowWireframe(v); main.render?.(); } }
    );
  }

  // ── DOM event wiring (one-time, at mesh-ready) ─────────────────────────────

  _wireEvents(main) {
    // Tool button fires event — Scene.js swaps to ToolPickerPanel
    this._element?.querySelector('#mp-tool-btn')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('mp-show-tool-picker', { bubbles: false }));
    });
    this._wireHUDBody(main);
  }

  // ── Extras wiring (called after syncFromState rebuilds #mp-extras) ─────────

  _wireExtras(main) {
    const extras = this._element?.querySelector('#mp-extras');
    if (!extras) return;

    // Dispose any previous colour wheel before re-wiring
    if (this._colorWheel) {
      this._colorWheel.dispose();
      this._colorWheel = null;
    }

    const sm  = main.getSculptManager?.();
    const idx = sm?.getToolIndex?.() ?? -1;

    // ── Brush extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.BRUSH) {
      const makeToolToggle = (id, prop) => {
        const btn = extras.querySelector(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) { t[prop] = !t[prop]; main.render?.(); }
          this.syncFromState();
        });
      };
      makeToolToggle('#mp-clay',    '_clay');
      makeToolToggle('#mp-culling', '_culling');
    }

    // ── Bones extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.BONE_DRAW) {
      const mode = (id, key) => {
        const btn = extras.querySelector(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
          sm?.getCurrentTool?.()?.setModeKey?.(key);
          this.syncFromState();
        });
      };
      mode('#mp-bone-draw', 'draw');
      mode('#mp-bone-fk',   'fk');
      mode('#mp-bone-free', 'free');
      mode('#mp-bone-pose', 'pose');
      mode('#mp-bone-radius', 'radius');

      // Two flag flavours, and they must not share a toggle: the snaps default ON (stored
      // as "anything but false", so undefined reads as on), Lengths defaults OFF.
      const flag = (id, key, defaultOn) => {
        const btn = extras.querySelector(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
          window[key] = defaultOn ? (window[key] === false) : !window[key];
          this.syncFromState();
          main.render?.();
        });
      };
      flag('#mp-bone-snap', '_boneSnapPlane',   true);
      flag('#mp-bone-axis', '_boneSnapAxis',    true);
      flag('#mp-bone-len',  '_boneShowLengths', false);
      flag('#mp-bone-caps', '_boneShowCapsules', true);
      // Toggling the weight preview has to repaint or restore immediately — the flag alone
      // changes nothing until something re-solves.
      extras.querySelector('#mp-bone-weights')?.addEventListener('click', () => {
        window._boneShowWeights = window._boneShowWeights === false;
        Skinning.refreshWeightColorsAll(main);
        this.syncFromState();
        main.render?.();
      });

      // Re-entering the tool restores the preview that clearPreview() took down on the way
      // out, so the toggle state is what decides whether colours are shown, not tool history.
      Skinning.refreshWeightColorsAll(main);

      // The slider sets the DEFAULT fraction (used by every joint drawn from now on); the
      // button pushes it onto the bones that already exist. Split deliberately: applying live
      // on every drag frame would silently wipe radii that were hand-tuned in Radius mode.
      const radInput = extras.querySelector('#mp-bone-rad');
      const radVal   = extras.querySelector('#mp-bone-rad-val');
      if (radInput) {
        radInput.addEventListener('input', () => {
          const pct = parseFloat(radInput.value);
          window._boneRadiusFrac = pct / 100;
          if (radVal) radVal.textContent = Math.round(pct) + '%';
        });
      }
      extras.querySelector('#mp-bone-rad-all')?.addEventListener('click', () => {
        const before = Skeleton.captureRadii(main);
        Skeleton.setRadiusFraction(main, window._boneRadiusFrac ?? 0.5);
        const after = Skeleton.captureRadii(main);
        const apply = (radii) => {
          Skeleton.restoreRadii(radii);
          Skinning.resolveWeightsAll(main);
          Skeleton.updateVisuals(main);
          main.render();
        };
        Skinning.resolveWeightsAll(main);
        main.getStateManager?.()?.pushStateCustom?.(
          () => apply(before), () => apply(after), false, 'Bone Radii');
        window._boneShowCapsules = true; // an invisible edit is indistinguishable from a no-op
        this.syncFromState();
        main.render?.();
      });

      extras.querySelector('#mp-bone-bind')?.addEventListener('click', () => {
        const res = Skinning.bind(main, main.getMesh?.());
        const msg = res.ok
          ? `Bones: bound ${res.name} — ${res.joints} joints, ${res.verts} verts, ${res.ms}ms`
            + (res.outside ? `, ${res.outside} verts outside every capsule` : '')
          : `Bones: ${res.why}`;
        console.log('[bone] bind:', msg);
        if (window.screenLog) window.screenLog(msg, res.ok ? 'cyan' : '#f38ba8');
        // Rebuild rather than sync: the button set itself changes once bound.
        this._lastExtrasIdx = -1;
        this.syncFromState();
        main.render?.();
      });

      extras.querySelector('#mp-bone-unbind')?.addEventListener('click', () => {
        Skinning.unbind(main.getMesh?.());
        this._lastExtrasIdx = -1;
        this.syncFromState();
        main.render?.();
      });
    }

    // ── Smooth / Relax extras ──────────────────────────────────────────────
    if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      const tangentBtn = extras.querySelector('#mp-tangent');
      if (tangentBtn) {
        tangentBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) { t._tangent = !t._tangent; main.render?.(); }
          this.syncFromState();
        });
      }
      if (idx === Enums.Tools.SMOOTH) {
        const sharpenBtn = extras.querySelector('#mp-sharpen');
        if (sharpenBtn) {
          sharpenBtn.addEventListener('click', () => {
            const t = sm?.getCurrentTool?.();
            if (t) { t._negative = !t._negative; main.render?.(); }
            this.syncFromState();
          });
        }
      }
    }

    // ── Masking extras ─────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const clearBtn   = extras.querySelector('#mp-mask-clear');
      const invertBtn  = extras.querySelector('#mp-mask-invert');
      const hardInput  = extras.querySelector('#mp-hardness');
      const hardVal    = extras.querySelector('#mp-hardness-val');
      const thickInput = extras.querySelector('#mp-thickness');
      const thickVal   = extras.querySelector('#mp-thickness-val');

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t?.clearMask) { t.clearMask(); main.render?.(); }
          this.syncFromState();
        });
      }
      if (invertBtn) {
        invertBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t?.invertMask) { t.invertMask(); main.render?.(); }
          this.syncFromState();
        });
      }
      if (hardInput) {
        hardInput.addEventListener('input', () => {
          const val = parseFloat(hardInput.value) / 100;
          if (hardVal) hardVal.textContent = Math.round(parseFloat(hardInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t) {
            t._hardness = val;
            getOptionsURL.saveOption(`tool_${idx}_hardness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
      if (thickInput) {
        thickInput.addEventListener('input', () => {
          const val = parseFloat(thickInput.value) / 100;
          if (thickVal) thickVal.textContent = Math.round(parseFloat(thickInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t) {
            t._thickness = val;
            getOptionsURL.saveOption(`tool_${idx}_thickness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
    }

    // ── Paint extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
      // Colour wheel
      this._colorWheel?.dispose();
      const cwRoot = extras.querySelector('#mp-cw');
      if (cwRoot) {
        this._colorWheel = new ColorWheel(cwRoot, main, () => this._requestPaint());
      }

      // Roughness / metalness
      const roughInput = extras.querySelector('#mp-roughness');
      const roughVal   = extras.querySelector('#mp-roughness-val');
      const metInput   = extras.querySelector('#mp-metalness');
      const metVal     = extras.querySelector('#mp-metalness-val');

      if (roughInput) {
        roughInput.addEventListener('input', () => {
          const val = parseFloat(roughInput.value) / 100;
          if (roughVal) roughVal.textContent = Math.round(parseFloat(roughInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t?._material) {
            t._material[0] = val;
            getOptionsURL.saveOption(`tool_${idx}_roughness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
      if (metInput) {
        metInput.addEventListener('input', () => {
          const val = parseFloat(metInput.value) / 100;
          if (metVal) metVal.textContent = Math.round(parseFloat(metInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t?._material) {
            t._material[1] = val;
            getOptionsURL.saveOption(`tool_${idx}_metalness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
    }

    // ── Voxel extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.VOXEL) {
      extras.querySelectorAll('.mp-voxel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) {
            if (btn.dataset.voxelShape !== undefined) {
              t._shape = parseInt(btn.dataset.voxelShape, 10); // sphere / box
            } else if (btn.dataset.voxelAlign !== undefined) {
              t._alignToController = !t._alignToController; // box follows controller rotation
            } else if (btn.dataset.voxelBake !== undefined) {
              t.bakeToMesh?.(); // convert voxel object → editable poly mesh
            } else if (btn.dataset.voxelBuildup !== undefined) {
              t._buildUp = !t._buildUp;
              getOptionsURL.saveOption(`tool_${idx}_buildUp`, t._buildUp);
            } else if (btn.dataset.voxelFlat !== undefined) {
              const m = t._voxelMesh; if (m) m.setFlatShading?.(!m.getFlatShading?.());
            } else if (btn.dataset.voxelWire !== undefined) {
              const m = t._voxelMesh; if (m) m.setShowWireframe?.(!m.getShowWireframe?.());
            } else if (btn.dataset.voxelResample !== undefined) {
              t.applyResolution?.(); // re-voxelize at _pendingRes
            } else {
              t._mode     = parseInt(btn.dataset.voxelMode, 10);
              t._negative = btn.dataset.voxelNeg === 'true';
            }
            main.render?.();
          }
          this.syncFromState();
        });
      });
      // Resolution slider: live preview (density overlay) on drag, re-voxelize on release.
      const resSlider = extras.querySelector('#mp-voxel-res');
      if (resSlider) {
        resSlider.addEventListener('input', () => {
          const v = parseInt(resSlider.value, 10);
          const valEl = extras.querySelector('#mp-voxel-res-val'); if (valEl) valEl.textContent = v;
          const t = sm?.getCurrentTool?.();
          t?.setResolutionPreview?.(v);
          if (t?._voxelMesh) VoxelDensityOverlay.enable(t._voxelMesh, v);
          getOptionsURL.saveOption(`tool_${Enums.Tools.VOXEL}_resolution`, v, 500);
        });
        resSlider.addEventListener('change', () => {
          VoxelDensityOverlay.disable();
          sm?.getCurrentTool?.()?.applyResolution?.();
          main.render?.();
        });
      }
    }

    // ── Extrude / Inset extras ─────────────────────────────────────────────
    if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      const keepBtn = extras.querySelector('#mp-keep-together');
      if (keepBtn) {
        keepBtn.addEventListener('click', () => {
          window.keepExtrudeFacesTogether = !(window.keepExtrudeFacesTogether ?? true);
          getOptionsURL.saveOption(`tool_${idx}_keepTogether`, window.keepExtrudeFacesTogether);
          main.render?.();
          this.syncFromState();
        });
      }
    }

    // ── TransformVR extras ─────────────────────────────────────────────────
    if (idx === Enums.Tools.TRANSFORM_VR) {
      extras.querySelectorAll('[data-tvr-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = parseInt(btn.dataset.tvrMode, 10);
          const t    = sm?.getCurrentTool?.();
          if (t) { t._mode = mode; main.render?.(); }
          this.syncFromState();
        });
      });
    }
  }

  // ── Incremental extras-state sync (no innerHTML rebuild) ─────────────────
  // Called by syncFromState() when the tool hasn't changed so we only update
  // toggle-button active classes in-place.  Never touches innerHTML so that
  // _colorWheel.draw()'s inline-style mutations are never disturbed.

  _syncExtrasActive(extrasEl, sm, idx, tool) {
    if (idx === Enums.Tools.BRUSH) {
      extrasEl.querySelector('#mp-clay')   ?.classList.toggle('active', !!tool._clay);
      extrasEl.querySelector('#mp-culling')?.classList.toggle('active', !!tool._culling);

    } else if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      extrasEl.querySelector('#mp-tangent')?.classList.toggle('active', !!tool._tangent);
      if (idx === Enums.Tools.SMOOTH) {
        extrasEl.querySelector('#mp-sharpen')?.classList.toggle('active', !!tool._negative);
      }

    } else if (idx === Enums.Tools.BONE_DRAW) {
      // Radio behaviour: exactly one mode carries .active. Without this branch the classes
      // are only correct at build time (tool switch), so clicking a mode changed behaviour
      // but never moved the highlight.
      const mode = tool.modeKey?.() ?? 'draw';
      extrasEl.querySelector('#mp-bone-draw')?.classList.toggle('active', mode === 'draw');
      extrasEl.querySelector('#mp-bone-fk')  ?.classList.toggle('active', mode === 'fk');
      extrasEl.querySelector('#mp-bone-free')?.classList.toggle('active', mode === 'free');
      extrasEl.querySelector('#mp-bone-pose')?.classList.toggle('active', mode === 'pose');
      extrasEl.querySelector('#mp-bone-radius')?.classList.toggle('active', mode === 'radius');
      extrasEl.querySelector('#mp-bone-snap')?.classList.toggle('active', window._boneSnapPlane !== false);
      extrasEl.querySelector('#mp-bone-axis')?.classList.toggle('active', window._boneSnapAxis !== false);
      extrasEl.querySelector('#mp-bone-len') ?.classList.toggle('active', !!window._boneShowLengths);
      extrasEl.querySelector('#mp-bone-caps')?.classList.toggle('active', window._boneShowCapsules !== false);
      extrasEl.querySelector('#mp-bone-weights')?.classList.toggle('active', window._boneShowWeights !== false);

    } else if (idx === Enums.Tools.TRANSFORM_VR) {
      const mode = tool._mode ?? 0;
      extrasEl.querySelectorAll('[data-tvr-mode]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.tvrMode, 10) === mode);
      });

    } else if (idx === Enums.Tools.VOXEL) {
      const curMode = tool._mode    ?? 0;
      const curNeg  = tool._negative ?? false;
      extrasEl.querySelectorAll('[data-voxel-mode]').forEach(btn => {
        const bMode = parseInt(btn.dataset.voxelMode, 10);
        const bNeg  = btn.dataset.voxelNeg === 'true';
        let active;
        if      (bMode === 0 && !bNeg) active = curMode === 0 && !curNeg;
        else if (bMode === 1 && !bNeg) active = curMode === 1 || (curMode === 0 && curNeg);
        else                           active = bMode === curMode && bNeg === curNeg;
        btn.classList.toggle('active', active);
      });
      const curShape = tool._shape ?? 0;
      extrasEl.querySelectorAll('[data-voxel-shape]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.voxelShape, 10) === curShape);
      });
      extrasEl.querySelectorAll('[data-voxel-align]').forEach(btn => {
        btn.classList.toggle('active', !!(tool._alignToController));
      });
      extrasEl.querySelectorAll('[data-voxel-buildup]').forEach(btn => {
        btn.classList.toggle('active', !!(tool._buildUp));
      });
      const vm = tool._voxelMesh;
      extrasEl.querySelectorAll('[data-voxel-flat]').forEach(btn => {
        btn.classList.toggle('active', !!(vm?.getFlatShading?.()));
      });
      extrasEl.querySelectorAll('[data-voxel-wire]').forEach(btn => {
        btn.classList.toggle('active', !!(vm?.getShowWireframe?.()));
      });

    } else if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      extrasEl.querySelector('#mp-keep-together')
        ?.classList.toggle('active', !!(window.keepExtrudeFacesTogether ?? true));
    }
  }

  // ── Build extras HTML for a given tool index ──────────────────────────────

  _buildExtrasHTML(sm, idx) {
    if (!sm) return '';

    // ── Brush ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.BRUSH) {
      const t       = sm.getCurrentTool?.();
      const clay    = !!(t?._clay);
      const culling = !!(t?._culling);
      return `
        <hr class="mp-divider">
        <div class="mp-toggles">
          <button class="mp-toggle-btn${clay    ? ' active' : ''}" id="mp-clay">Clay</button>
          <button class="mp-toggle-btn${culling ? ' active' : ''}" id="mp-culling">Culling</button>
        </div>
      `;
    }

    // ── Bones ──────────────────────────────────────────────────────────────
    // Mode lives here rather than on a face button: three modes do not fit two buttons
    // without overloading them by mode, which is what made the previous binding opaque.
    if (idx === Enums.Tools.BONE_DRAW) {
      const t    = sm.getCurrentTool?.();
      const mode = t?.modeKey?.() ?? 'draw';
      const snap = window._boneSnapPlane !== false;
      const axis = window._boneSnapAxis !== false;
      const lens = !!window._boneShowLengths;
      const bound = Skinning.isBound(sm._main?.getMesh?.());
      const caps = window._boneShowCapsules !== false;
      const wts  = window._boneShowWeights !== false;
      // The capsule radius default, as a percentage of bone length. Exposed because it was a
      // hard-coded guess that every skin weight inherited: one drag re-proportions the whole
      // rig, which is the only honest way to judge it.
      const radPct = Math.round((window._boneRadiusFrac ?? 0.5) * 100);
      const on   = (k) => (mode === k ? ' active' : '');
      return `
        <hr class="mp-divider">
        <div class="mp-voxel-grid">
          <button class="mp-voxel-btn${on('draw')}" id="mp-bone-draw">Draw</button>
          <button class="mp-voxel-btn${on('fk')}"   id="mp-bone-fk">Tweak FK</button>
          <button class="mp-voxel-btn${on('free')}" id="mp-bone-free">Tweak Free</button>
          <button class="mp-voxel-btn${on('pose')}" id="mp-bone-pose">Pose</button>
          <button class="mp-voxel-btn${on('radius')}" id="mp-bone-radius">Radius</button>
        </div>
        <div class="mp-toggles">
          <button class="mp-toggle-btn${snap ? ' active' : ''}" id="mp-bone-snap">Snap Plane</button>
          <button class="mp-toggle-btn${axis ? ' active' : ''}" id="mp-bone-axis">Snap Axis</button>
        </div>
        <div class="mp-toggles">
          <button class="mp-toggle-btn${lens ? ' active' : ''}" id="mp-bone-len">Lengths</button>
          <button class="mp-toggle-btn${caps ? ' active' : ''}" id="mp-bone-caps">Capsules</button>
          <button class="mp-toggle-btn${wts ? ' active' : ''}" id="mp-bone-weights">Weights</button>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Capsule</span>
          <input type="range" id="mp-bone-rad" min="5" max="120" step="1" value="${radPct}">
          <span class="mp-val" id="mp-bone-rad-val">${radPct}%</span>
        </div>
        <div class="mp-btn-row">
          <button class="mp-action-btn" id="mp-bone-rad-all">Apply To All</button>
        </div>
        <hr class="mp-divider">
        <div class="mp-btn-row">
          <button class="mp-action-btn" id="mp-bone-bind">${bound ? 'Rebind' : 'Bind Mesh'}</button>
          ${bound ? '<button class="mp-action-btn" id="mp-bone-unbind">Unbind</button>' : ''}
        </div>
      `;
    }

    // ── Smooth / Relax ─────────────────────────────────────────────────────
    if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      const t       = sm.getCurrentTool?.();
      const tangent = !!(t?._tangent);
      const sharpen = idx === Enums.Tools.SMOOTH && !!(t?._negative);
      return `
        <hr class="mp-divider">
        <div class="mp-toggles">
          <button class="mp-toggle-btn${tangent ? ' active' : ''}" id="mp-tangent">Tangent</button>
          ${idx === Enums.Tools.SMOOTH
            ? `<button class="mp-toggle-btn${sharpen ? ' active' : ''}" id="mp-sharpen">Sharpen</button>`
            : ''}
        </div>
      `;
    }

    // ── Masking ────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const t        = sm.getCurrentTool?.();
      const hardPct  = Math.round((t?._hardness  ?? 0.5) * 100);
      const thickPct = Math.round((t?._thickness ?? 0.5) * 100);
      return `
        <hr class="mp-divider">
        <div class="mp-btn-row">
          <button class="mp-action-btn" id="mp-mask-clear">Clear Mask</button>
          <button class="mp-action-btn" id="mp-mask-invert">Invert</button>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Hardness</span>
          <input type="range" id="mp-hardness" min="0" max="100" step="1" value="${hardPct}">
          <span class="mp-val" id="mp-hardness-val">${hardPct}%</span>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Thickness</span>
          <input type="range" id="mp-thickness" min="0" max="100" step="1" value="${thickPct}">
          <span class="mp-val" id="mp-thickness-val">${thickPct}%</span>
        </div>
      `;
    }

    // ── Paint ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
      const t        = sm.getCurrentTool?.();
      const roughPct = Math.round((t?._material?.[0] ?? 0.5) * 100);
      const metPct   = Math.round((t?._material?.[1] ?? 0.0) * 100);
      // Pure HTML/CSS colour wheel — no canvas, renders correctly through
      // SVG foreignObject.  Layout constants must match _CW_* at top of file.
      return `
        <hr class="mp-divider">
        <div id="mp-cw" style="position:relative;width:216px;height:216px;background:#1e1e2e;border-radius:8px;overflow:hidden;touch-action:none">
          <!-- BG swatch (behind) -->
          <div id="mp-cw-bg" style="position:absolute;left:22px;top:22px;width:26px;height:26px;border:1.5px solid #585b70;background:#000"></div>
          <!-- FG swatch (front) -->
          <div id="mp-cw-fg" style="position:absolute;left:8px;top:8px;width:26px;height:26px;border:2px solid #89b4fa;background:#fff"></div>
          <!-- Swap FG/BG -->
          <button id="mp-cw-swap" style="position:absolute;left:46px;top:10px;padding:2px 5px;background:#181825;border:1px solid #45475a;border-radius:4px;color:#a6adc8;font-size:13px;cursor:pointer;outline:none;line-height:1">⇄</button>
          <!-- Eyedropper -->
          <button id="mp-cw-eye" style="position:absolute;right:8px;top:10px;padding:2px 5px;background:#181825;border:1px solid #45475a;border-radius:4px;color:#6c7086;font-size:11px;cursor:pointer;outline:none;line-height:1">✦ pick</button>
          <!-- Hue ring: conic-gradient donut via CSS mask -->
          <div id="mp-cw-ring" style="position:absolute;left:20px;top:40px;width:176px;height:176px;border-radius:50%;background:conic-gradient(from 90deg,#f00 0%,#ff0 16.67%,#0f0 33.33%,#0ff 50%,#00f 66.67%,#f0f 83.33%,#f00 100%);-webkit-mask:radial-gradient(circle closest-side,transparent 77%,black 78%);mask:radial-gradient(circle closest-side,transparent 77%,black 78%)"></div>
          <!-- SV square: layered gradients -->
          <div id="mp-cw-sv" style="position:absolute;left:62px;top:82px;width:92px;height:92px;overflow:hidden">
            <div id="mp-cw-sv-bg" style="position:absolute;top:0;right:0;bottom:0;left:0;background:hsl(0deg,100%,50%)"></div>
            <div style="position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(to right,white,transparent)"></div>
            <div style="position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(to bottom,transparent,black)"></div>
            <!-- SV indicator (hollow circle, contrast-aware border) -->
            <div id="mp-cw-sv-i" style="position:absolute;width:12px;height:12px;border-radius:50%;border:2px solid white;box-sizing:border-box;transform:translate(-50%,-50%)"></div>
          </div>
          <!-- Hue ring indicator -->
          <div id="mp-cw-h-i" style="position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,0,0,0.8);box-sizing:border-box;background:red;transform:translate(-50%,-50%)"></div>
        </div>
        <hr class="mp-divider">
        <div class="mp-row">
          <span class="mp-lbl">Roughness</span>
          <input type="range" id="mp-roughness" min="0" max="100" step="1" value="${roughPct}">
          <span class="mp-val" id="mp-roughness-val">${roughPct}%</span>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Metalness</span>
          <input type="range" id="mp-metalness" min="0" max="100" step="1" value="${metPct}">
          <span class="mp-val" id="mp-metalness-val">${metPct}%</span>
        </div>
      `;
    }

    // ── Voxel ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.VOXEL) {
      const t       = sm.getCurrentTool?.();
      const curMode = t?._mode ?? 0;
      const curNeg  = t?._negative ?? false;
      const curShape = t?._shape ?? 0; // 0=Sphere, 1=Box (brush volume shape)
      const curAlign = t?._alignToController ?? false; // Box brush follows controller rotation
      const vmesh    = t?._voxelMesh;                  // flat/wireframe live on the mesh
      const curBuildup = t?._buildUp ?? false;
      const curFlat    = vmesh?.getFlatShading?.() ?? false;
      const curWire    = vmesh?.getShowWireframe?.() ?? false;
      const curRes     = t?._pendingRes ?? t?._res ?? 128;

      // mode 0=Add, 1=Sub, 2=Inflate/Deflate, 3=Smooth, 4=Move
      const modes = [
        { mode: 0, neg: false, label: 'Add'     },
        { mode: 1, neg: false, label: 'Sub'     },
        { mode: 3, neg: false, label: 'Smooth'  },
        { mode: 4, neg: false, label: 'Move'    },
        { mode: 2, neg: false, label: 'Inflate' },
        { mode: 2, neg: true,  label: 'Deflate' },
      ];

      const isActiveMode = (m) => {
        if (m.mode === 0 && !m.neg) return curMode === 0 && !curNeg;
        if (m.mode === 1 && !m.neg) return curMode === 1 || (curMode === 0 && curNeg);
        return m.mode === curMode && m.neg === curNeg;
      };

      // Semantic tints matching toolTints.js / MainMenuPanel: deform (Add/Sub/Inflate/
      // Deflate) = red, Smooth = blue, Move = green.
      const modeTint = (m) => m.mode === 3 ? '#89b4fa' : m.mode === 4 ? '#a6e3a1' : '#f38ba8';
      const btns = modes.map(m =>
        `<button class="mp-voxel-btn${isActiveMode(m) ? ' active' : ''}" data-voxel-mode="${m.mode}" data-voxel-neg="${m.neg}" style="color:${modeTint(m)}">${m.label}</button>`
      ).join('');

      // Brush volume shape (sphere / box) — restored from the old VR menu.
      const shapeBtns = [{ shape: 0, label: 'Sphere' }, { shape: 1, label: 'Box' }].map(s =>
        `<button class="mp-voxel-btn${curShape === s.shape ? ' active' : ''}" data-voxel-shape="${s.shape}">${s.label}</button>`
      ).join('');

      return `
        <hr class="mp-divider">
        <div class="mp-voxel-grid">${btns}</div>
        <div class="mp-voxel-grid">${shapeBtns}</div>
        <div class="mp-voxel-grid"><button class="mp-voxel-btn${curAlign ? ' active' : ''}" data-voxel-align="1" title="Box brush follows controller rotation (Box shape only)">Align to hand</button></div>
        <div class="mp-voxel-grid">
          <button class="mp-voxel-btn${curBuildup ? ' active' : ''}" data-voxel-buildup="1" title="Tapered build-up (gradual stroke accumulation)">Build Up</button>
          <button class="mp-voxel-btn${curFlat ? ' active' : ''}" data-voxel-flat="1" title="Flat shading">Flat</button>
          <button class="mp-voxel-btn${curWire ? ' active' : ''}" data-voxel-wire="1" title="Show wireframe">Wire</button>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Resolution</span>
          <input type="range" id="mp-voxel-res" min="16" max="256" step="16" value="${curRes}">
          <span class="mp-val" id="mp-voxel-res-val">${curRes}</span>
        </div>
        <div class="mp-voxel-grid">
          <button class="mp-voxel-btn" data-voxel-resample="1" title="Re-voxelize at the chosen resolution (no undo)">Resample</button>
          <button class="mp-voxel-btn" data-voxel-bake="1" title="Convert this voxel object into an editable poly mesh">Convert to Mesh</button>
        </div>
      `;
    }

    // ── Extrude / Inset ────────────────────────────────────────────────────
    if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      const isActive = !!(window.keepExtrudeFacesTogether ?? true);
      return `
        <hr class="mp-divider">
        <button class="mp-keep-btn${isActive ? ' active' : ''}" id="mp-keep-together">Keep Together</button>
      `;
    }

    // ── TransformVR ────────────────────────────────────────────────────────
    if (idx === Enums.Tools.TRANSFORM_VR) {
      const t    = sm.getCurrentTool?.();
      const mode = t?._mode ?? 0;
      const modes = [
        { id: 0, label: 'Move'   },
        { id: 1, label: 'Rotate' },
        { id: 2, label: 'Scale'  },
      ];
      const btns = modes.map(m =>
        `<button class="mp-toggle-btn${mode === m.id ? ' active' : ''}" data-tvr-mode="${m.id}">${m.label}</button>`
      ).join('');
      return `
        <hr class="mp-divider">
        <div class="mp-toggles">${btns}</div>
      `;
    }

    return '';
  }

  // ── Sync DOM from app state ────────────────────────────────────────────────

  /**
   * Read the current sculpt manager state and reflect it in the HTML.
   * Safe to call before mesh exists — guards on this._element.
   */
  syncFromState() {
    if (!this._element) return;

    const main = this._main;
    const sm   = main.getSculptManager?.();
    const root = this._element;

    // ── Tool button ────────────────────────────────────────────────────────
    const idx      = sm?.getToolIndex?.() ?? 0;
    const tool     = sm?.getCurrentTool?.();
    const toolBtn  = root.querySelector('#mp-tool-btn');
    const toolName_ = toolName(idx);

    if (toolBtn) {
      toolBtn.style.background = toolTint(idx);
      const nameEl = root.querySelector('#mp-tool-name');
      if (nameEl) nameEl.textContent = toolName_;
    }

    // ── Radius ─────────────────────────────────────────────────────────────
    if (tool) {
      const rInput = root.querySelector('#mp-radius');
      const rVal   = root.querySelector('#mp-radius-val');
      if (rInput && rVal) {
        rInput.value     = tool._radius ?? 50;
        rVal.textContent = Math.round(tool._radius ?? 50);
      }

      // ── Intensity ────────────────────────────────────────────────────────
      const iInput = root.querySelector('#mp-intensity');
      const iVal   = root.querySelector('#mp-intensity-val');
      if (iInput && iVal) {
        const pct        = Math.round((tool._intensity ?? 0.5) * 100);
        iInput.value     = pct;
        iVal.textContent = pct + '%';
      }
    }

    // ── Symmetry ───────────────────────────────────────────────────────────
    root.querySelector('#mp-sym')?.classList.toggle('active', !!sm?._symmetry);

    // ── Negative ───────────────────────────────────────────────────────────
    root.querySelector('#mp-neg')?.classList.toggle('active', !!sm?._negative);

    // ── Wireframe ──────────────────────────────────────────────────────────
    const wf = main.getMesh?.()?.getShowWireframe?.() ?? false;
    root.querySelector('#mp-wire')?.classList.toggle('active', wf);

    // ── Tool-specific extras: rebuild HTML only when tool changes ─────────
    // IMPORTANT: do NOT compare extrasEl.innerHTML to the template string.
    // _colorWheel.draw() modifies inline styles on elements inside #mp-extras
    // (setting background:rgb(...), left:Xpx, etc.).  Those style changes land
    // in innerHTML, so a naive string comparison triggers a rebuild — and a
    // _needsResize / texture dispose — on every single syncFromState() call
    // while on the Paint tool, causing a ~1-second flicker cycle.
    const extrasEl = root.querySelector('#mp-extras');
    if (extrasEl) {
      if (this._lastExtrasIdx !== idx) {
        // Tool changed: rebuild the whole block and re-wire.
        this._lastExtrasIdx = idx;
        extrasEl.innerHTML  = this._buildExtrasHTML(sm, idx);
        this._wireExtras(main);
        // Defer geometry resize until _onPaint fires with the fresh texture.
        this._needsResize = true;
      } else if (tool) {
        // Same tool: only update active-class states in place; never touch innerHTML.
        this._syncExtrasActive(extrasEl, sm, idx, tool);
      }
    }

    // Keep the colour wheel canvas current on periodic syncs
    // (e.g. after eyedropper picks a colour from the scene).
    this._colorWheel?.draw();

    this._requestPaint();
  }

  // ── Paint request ──────────────────────────────────────────────────────────
  // markDirty() is enough — the XR render loop calls update() every frame which
  // drains the polyfill queue.  Calling flushPaint() (synchronous drain) on every
  // interaction was causing heavy per-frame rasterisation work and felt laggy.
  // flushPaint() is still used in _swapHtmlPanels (Scene.js) for the specific
  // case of needing a fresh texture before a panel becomes visible.

  _requestPaint() {
    this.markDirty();
  }

  // ── Pin state accessor ─────────────────────────────────────────────────────

  get pinned() { return this._pinned; }
}
