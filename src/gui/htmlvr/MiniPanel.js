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

import { HTMLVRPanel } from './HTMLVRPanel.js';
import Enums          from '../../misc/Enums.js';
import getOptionsURL  from '../../misc/getOptionsURL.js';

// ── Tool tints (Catppuccin Mocha-compatible dark tones) ──────────────────────
const TOOL_TINTS = {
  // sculpt (red-ish)
  0:'#6b4040', 1:'#6b4040', 4:'#6b4040', 5:'#6b4040', 6:'#6b4040', 14:'#6b4040',
  // smooth (blue)
  3:'#404d6b', 8:'#404d6b',
  // move / transform (green)
  7:'#406b40', 10:'#406b40', 12:'#406b40', 15:'#406b40', 16:'#406b40', 17:'#406b40',
  2:'#406b40', 13:'#406b40',
  // paint (purple)
  9:'#5a406b',
  // masking (orange)
  11:'#6b5440',
  // LP tools (yellow)
  18:'#5a5540', 19:'#5a5540', 20:'#5a5540', 21:'#5a5540', 22:'#5a5540',
  23:'#5a5540', 24:'#5a5540', 25:'#5a5540', 29:'#5a5540', 30:'#5a5540', 31:'#5a5540',
};
const toolTint = (id) => TOOL_TINTS[id] ?? '#313244';

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
};
const toolName = (id) => TOOL_NAMES[id] ?? `Tool ${id}`;

// ── Picker tool lists (mirrors BrushPanel's lists) ───────────────────────────
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
const LP_TOOLS = [
  { id: Enums.Tools.CUT_TOOL,        label: 'Cut'       },
  { id: Enums.Tools.EXTRUDE,         label: 'Extrude'   },
  { id: Enums.Tools.INSET,           label: 'Inset'     },
  { id: Enums.Tools.DELETE_FACE,     label: 'Del Face'  },
  { id: Enums.Tools.FILL_HOLE,       label: 'Fill Hole' },
  { id: Enums.Tools.DISSOLVE_EDGE,   label: 'Dis.Edge'  },
  { id: Enums.Tools.SPLIT_FACE,      label: 'Split'     },
  { id: Enums.Tools.SPIN_EDGE,       label: 'Spin'      },
  { id: Enums.Tools.COLLAPSE_EDGE,   label: 'Col.Edge'  },
  { id: Enums.Tools.DISSOLVE_VERTEX, label: 'Dis.Vert'  },
  { id: Enums.Tools.WELD,            label: 'Weld'      },
].filter(t => t.id !== undefined);

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
  position: relative;
  overflow: hidden;
}

/* ── Tool picker overlay ──────────────────────────────────────────── */
/* Sits above #mp-main-body; sized to fit within the mesh's fixed height */
#mp-picker {
  display: none;
  position: absolute;
  top: 50px;     /* below the tool-btn; ~51px = btn height + margin */
  left: 0; right: 0; bottom: 0;
  padding: 0 2px 4px;
  background: #1e1e2e;
  overflow: hidden;
  z-index: 10;
  box-sizing: border-box;
}
#mp-picker.open { display: block; }

/* 4-column sculpt grid — 15 tools = 4 rows, tight spacing */
#mp-picker .mp-pick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  margin-bottom: 4px;
}
#mp-picker .mp-pick-btn {
  padding: 5px 2px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #313244;
  color: #cdd6f4;
  font-size: 9px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: filter 0.1s;
}
#mp-picker .mp-pick-btn:hover,
#mp-picker .mp-pick-btn.hover  { filter: brightness(1.3); }
#mp-picker .mp-pick-btn.active { box-shadow: 0 0 0 2px #89b4fa; }

/* "Full Menu" button at bottom of picker */
#mp-picker .mp-pick-more {
  width: 100%;
  padding: 5px 6px;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #181825;
  color: #6c7086;
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
  box-sizing: border-box;
}
#mp-picker .mp-pick-more:hover,
#mp-picker .mp-pick-more.hover { background: #24243e; color: #a6adc8; }

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
  // Build sculpt picker grid (4 columns, tight — fits within panel height)
  const sculptBtns = SCULPT_TOOLS.map(t =>
    `<button class="mp-pick-btn" data-tool-id="${t.id}" style="background:${toolTint(t.id)}">${t.label}</button>`
  ).join('');

  return `
    <!-- Tool header button — always visible, toggles picker -->
    <button id="mp-tool-btn" style="background:${toolTint(0)}">
      <span id="mp-tool-name">Brush</span>
      <span class="mp-tool-arrow" id="mp-tool-arrow">▸ All</span>
    </button>

    <!-- Tool picker overlay (shown when header is tapped) -->
    <div id="mp-picker">
      <div class="mp-pick-grid" id="mp-pick-sculpt">${sculptBtns}</div>
      <button class="mp-pick-more" id="mp-pick-full">Low Poly &amp; Full Menu ▸</button>
    </div>

    <!-- Main HUD body (hidden when picker is open) -->
    <div id="mp-main-body">
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
    </div>
  `;
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

    // 0.13m wide — compact wrist-HUD (reduced from 0.20 — 1/3 smaller)
    super(root, 0.13);

    this._main       = main;
    this._pinned     = false;  // always false — no pin button on MiniPanel
    this._pickerOpen = false;

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

  // ── Picker open/close ─────────────────────────────────────────────────────

  _openPicker() {
    this._pickerOpen = true;
    const root = this._element;
    root.querySelector('#mp-picker')?.classList.add('open');
    const arrow = root.querySelector('#mp-tool-arrow');
    if (arrow) arrow.textContent = '× Close';
    this._requestPaint();
  }

  _closePicker() {
    this._pickerOpen = false;
    const root = this._element;
    root.querySelector('#mp-picker')?.classList.remove('open');
    const arrow = root.querySelector('#mp-tool-arrow');
    if (arrow) arrow.textContent = '▸ All';
    this._requestPaint();
  }

  // ── DOM event wiring ───────────────────────────────────────────────────────

  _wireEvents(main) {
    const root = this._element;

    // ── Tool button → toggle picker ──────────────────────────────────────────
    const toolBtn = root.querySelector('#mp-tool-btn');
    if (toolBtn) {
      toolBtn.addEventListener('click', () => {
        if (this._pickerOpen) this._closePicker();
        else                  this._openPicker();
      });
    }

    // ── Picker tool buttons ──────────────────────────────────────────────────
    root.querySelectorAll('#mp-picker .mp-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.toolId, 10);
        const sm = main.getSculptManager?.();
        if (sm) {
          sm.setToolIndex(id);
          try { main.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(id); } catch (_) {}
        }
        this._closePicker();
        this.syncFromState();
      });
    });

    // ── "Full Menu" button — open BrushPanel (LP tools + all settings) ───────
    root.querySelector('#mp-pick-full')?.addEventListener('click', () => {
      this._closePicker();
      this._element.dispatchEvent(
        new CustomEvent('mp-show-brush-panel', { bubbles: false })
      );
    });

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
        this._requestPaint();
      });
    };

    // Symmetry
    makeToggle('#mp-sym',
      () => main.getSculptManager?.()._symmetry,
      (v) => {
        const sm = main.getSculptManager?.();
        if (sm) { sm._symmetry = v; main.render?.(); }
      }
    );

    // Negative (subtract mode)
    makeToggle('#mp-neg',
      () => main.getSculptManager?.()._negative,
      (v) => {
        const sm = main.getSculptManager?.();
        if (sm) { sm._negative = v; main.render?.(); }
      }
    );

    // Wireframe
    makeToggle('#mp-wire',
      () => main.getMesh?.()?.getShowWireframe?.() ?? false,
      (v) => {
        const mesh = main.getMesh?.();
        if (mesh) { mesh.setShowWireframe(v); main.render?.(); }
      }
    );
  }

  // ── Extras wiring (called after syncFromState rebuilds #mp-extras) ─────────

  _wireExtras(main) {
    const extras = this._element?.querySelector('#mp-extras');
    if (!extras) return;

    const sm  = main.getSculptManager?.();
    const idx = sm?.getToolIndex?.() ?? -1;

    // ── Masking extras ─────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const clearBtn  = extras.querySelector('#mp-mask-clear');
      const invertBtn = extras.querySelector('#mp-mask-invert');
      const hardInput = extras.querySelector('#mp-hardness');
      const hardVal   = extras.querySelector('#mp-hardness-val');

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
    }

    // ── Paint extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
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
          const mode = parseInt(btn.dataset.voxelMode, 10);
          const neg  = btn.dataset.voxelNeg === 'true';
          const t    = sm?.getCurrentTool?.();
          if (t) {
            t._mode     = mode;
            t._negative = neg;
            main.render?.();
          }
          this.syncFromState();
        });
      });
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
  }

  // ── Build extras HTML for a given tool index ──────────────────────────────

  _buildExtrasHTML(sm, idx) {
    if (!sm) return '';

    // ── Masking ────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const t       = sm.getCurrentTool?.();
      const hardPct = Math.round((t?._hardness ?? 0.5) * 100);
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
      `;
    }

    // ── Paint ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
      const t        = sm.getCurrentTool?.();
      const r        = t?._color?.[0] ?? 1;
      const g        = t?._color?.[1] ?? 1;
      const b        = t?._color?.[2] ?? 1;
      const roughPct = Math.round((t?._material?.[0] ?? 0.5) * 100);
      const metPct   = Math.round((t?._material?.[1] ?? 0.0) * 100);
      return `
        <hr class="mp-divider">
        <div id="mp-color-swatch" style="background:rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})"></div>
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
      const t         = sm.getCurrentTool?.();
      const curMode   = t?._mode ?? 0;
      const curNeg    = t?._negative ?? false;

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

      const btns = modes.map(m => {
        return `<button class="mp-voxel-btn${isActiveMode(m) ? ' active' : ''}" data-voxel-mode="${m.mode}" data-voxel-neg="${m.neg}">${m.label}</button>`;
      }).join('');

      return `
        <hr class="mp-divider">
        <div class="mp-voxel-grid">${btns}</div>
      `;
    }

    // ── Extrude / Inset ────────────────────────────────────────────────────
    if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      const t          = sm.getCurrentTool?.();
      const isActive   = !!(window.keepExtrudeFacesTogether ?? true);
      return `
        <hr class="mp-divider">
        <button class="mp-keep-btn${isActive ? ' active' : ''}" id="mp-keep-together">Keep Together</button>
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

    // ── Tool-specific extras: rebuild HTML then re-wire ────────────────────
    const extrasEl = root.querySelector('#mp-extras');
    if (extrasEl) {
      const newHTML = this._buildExtrasHTML(sm, idx);
      if (extrasEl.innerHTML !== newHTML) {
        extrasEl.innerHTML = newHTML;
        // Re-wire the newly inserted buttons/sliders
        this._wireExtras(main);
      }
    }

    // ── Picker: update active highlight on the currently selected tool ─────
    root.querySelectorAll('#mp-picker .mp-pick-btn').forEach(btn => {
      const btnId = parseInt(btn.dataset.toolId, 10);
      btn.classList.toggle('active', btnId === idx);
    });

    this._requestPaint();
  }

  // ── Paint request ──────────────────────────────────────────────────────────

  _requestPaint() {
    this.markDirty();
  }

  // ── Pin state accessor ─────────────────────────────────────────────────────

  get pinned() { return this._pinned; }
}
