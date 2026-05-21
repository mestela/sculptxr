/**
 * BrushPanel — HTML-based VR tools panel.
 *
 * Replaces GuiXR's "Tools" tab with a live HTML panel rendered into a
 * WebGL texture via three-html-render.  Catppuccin Mocha palette.
 *
 * Usage in Scene.js:
 *   import { BrushPanel } from './gui/htmlvr/BrushPanel.js';
 *   // in initVRControllers:
 *   this._brushPanel = new BrushPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
 *   this._brushPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
 *   // in handleXRInput (dominant-hand ray loop):
 *   const hits = this._brushPanel.castController(controller);
 *   if (hits.length) {
 *     this._brushPanel.onVRMove(hits[0].uv);
 *     if (pressed) this._brushPanel.onVRPress(hits[0].uv);
 *     else         this._brushPanel.onVRRelease(hits[0].uv);
 *   } else {
 *     this._brushPanel.onVRLeave();
 *   }
 *   // in applyRender (XR path):
 *   this._brushPanel.update(true);
 *   this._brushPanel.syncFromState();
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import Enums          from '../../misc/Enums.js';
import getOptionsURL  from '../../misc/getOptionsURL.js';
import { getHostCanvas } from './install.js';

// ── CSS injected once into the document head ─────────────────────────────────
const CSS = `
/* ── BrushPanel — Catppuccin Mocha ─────────────────────────────────── */
#bp-root {
  width: 560px;
  padding: 22px 24px 24px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 14px;
  border: 1px solid #313244;
  user-select: none;
}
#bp-root h2 {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 600;
  color: #cba6f7;
  letter-spacing: 0.03em;
  display: flex;
  align-items: center;
  gap: 8px;
}
#bp-root h2 button.bp-pin {
  margin-left: auto;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.6;
  padding: 2px 8px;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #181825;
  color: #a6adc8;
  transition: opacity 0.15s;
}
#bp-root h2 button.bp-pin:hover,
#bp-root h2 button.bp-pin.hover,
#bp-root h2 button.bp-pin.active { opacity: 1; background: #313244; color: #cba6f7; }

/* ── Tab row ──────────────────────────────────────────────────────── */
#bp-root .bp-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #313244;
}
#bp-root .bp-tab {
  flex: 1;
  padding: 7px 0;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: #181825;
  color: #6c7086;
  transition: background 0.15s, color 0.15s;
  border: none;
  outline: none;
}
#bp-root .bp-tab.active { background: #313244; color: #cba6f7; }
#bp-root .bp-tab:hover:not(.active), #bp-root .bp-tab.hover:not(.active) { background: #24243e; color: #a6adc8; }

/* ── Tool grid ────────────────────────────────────────────────────── */
#bp-root .bp-tool-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 14px;
}
#bp-root .bp-tool-btn {
  padding: 9px 4px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  outline: none;
}
#bp-root .bp-tool-btn.active        { background: #313244; color: #cba6f7; border-color: #cba6f7; }
#bp-root .bp-tool-btn:hover,
#bp-root .bp-tool-btn.hover         { background: #24243e; color: #cdd6f4; border-color: #585b70; }
#bp-root .bp-tool-btn:active,
#bp-root .bp-tool-btn.active.hover,
#bp-root .bp-tool-btn.bp-pressing   { background: #45475a; }

/* ── Sliders ──────────────────────────────────────────────────────── */
#bp-root .bp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
#bp-root .bp-lbl {
  width: 76px;
  font-size: 12px;
  color: #a6adc8;
  flex-shrink: 0;
}
#bp-root input[type=range] {
  flex: 1;
  -webkit-appearance: none;
  height: 5px;
  border-radius: 3px;
  background: #45475a;
  outline: none;
  cursor: pointer;
}
#bp-root input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #89b4fa;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(137,180,250,0.25);
}
#bp-root .bp-val {
  width: 36px;
  text-align: right;
  font-size: 12px;
  color: #89b4fa;
  font-variant-numeric: tabular-nums;
}

/* ── Divider ──────────────────────────────────────────────────────── */
#bp-root .bp-divider {
  border: none;
  border-top: 1px solid #313244;
  margin: 12px 0;
}

/* ── Toggle rows ──────────────────────────────────────────────────── */
#bp-root .bp-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#bp-root .bp-toggle-btn {
  flex: 1 1 calc(50% - 8px);
  padding: 8px 10px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #a6adc8;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
#bp-root .bp-toggle-btn .bp-check {
  width: 14px; height: 14px;
  border: 1.5px solid #585b70;
  border-radius: 3px;
  background: #181825;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px;
  color: transparent;
  transition: all 0.15s;
}
#bp-root .bp-toggle-btn.active .bp-check {
  background: #89b4fa; border-color: #89b4fa; color: #1e1e2e;
}
#bp-root .bp-toggle-btn.active { color: #cdd6f4; border-color: #585b70; }
#bp-root .bp-toggle-btn:hover,
#bp-root .bp-toggle-btn.hover  { background: #24243e; border-color: #585b70; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Tool definitions ─────────────────────────────────────────────────────────
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

// Low-poly tools — only if they exist in Enums (older builds may not have all)
const LP_TOOLS = [
  { id: Enums.Tools.CUT_TOOL,         label: 'Cut'        },
  { id: Enums.Tools.EXTRUDE,          label: 'Extrude'    },
  { id: Enums.Tools.INSET,            label: 'Inset'      },
  { id: Enums.Tools.DELETE_FACE,      label: 'Del Face'   },
  { id: Enums.Tools.FILL_HOLE,        label: 'Fill Hole'  },
  { id: Enums.Tools.DISSOLVE_EDGE,    label: 'Dis. Edge'  },
  { id: Enums.Tools.SPLIT_FACE,       label: 'Split Face' },
  { id: Enums.Tools.SPIN_EDGE,        label: 'Spin Edge'  },
  { id: Enums.Tools.COLLAPSE_EDGE,    label: 'Col. Edge'  },
  { id: Enums.Tools.DISSOLVE_VERTEX,  label: 'Dis. Vert'  },
  { id: Enums.Tools.WELD,             label: 'Weld'       },
].filter(t => t.id !== undefined);

// ── BrushPanel class ─────────────────────────────────────────────────────────

export class BrushPanel extends HTMLVRPanel {
  /**
   * @param {object}  main      SculptXR main Scene / app object
   * @param {THREE.Scene}      scene
   * @param {THREE.Camera}     camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(main, scene, camera, renderer) {
    injectCSS();

    const root = document.createElement('div');
    root.id = 'bp-root';
    root.innerHTML = BrushPanel._buildHTML();

    // Width derived from shared px/m ratio so fonts match MiniPanel
    super(root, 540 / VR_PANEL_PX_PER_M); // 0.30 m

    this._main   = main;
    this._tab    = 0; // 0 = Sculpting, 1 = Low Poly
    this._pinned = false;

    // BrushPanel starts hidden — MiniPanel is the default wrist view.
    // This hides the mesh immediately on creation to avoid a one-frame flash.
    this._startHidden = true;

    // Initialise the Three.js mesh.
    this.init(scene, camera, renderer);

    // Wire DOM events once mesh is ready (requestAnimationFrame delay in init).
    // We use a short poll to know when this.mesh is ready.
    this._waitForMeshThenWire(main);
  }

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

  // ── Static HTML builder ───────────────────────────────────────────────────

  static _buildHTML() {
    // Tool grid for tab 0
    const sculptBtns = SCULPT_TOOLS.map(t =>
      `<button class="bp-tool-btn" data-tool-id="${t.id}">${t.label}</button>`
    ).join('');

    const lpBtns = LP_TOOLS.map(t =>
      `<button class="bp-tool-btn" data-tool-id="${t.id}">${t.label}</button>`
    ).join('');

    return `
      <h2>
        Brush &amp; Tools
        <button class="bp-pin" id="bp-pin-btn" title="Pin panel in world space">📌 Pin</button>
      </h2>

      <div class="bp-tabs">
        <button class="bp-tab active" data-tab="0">Sculpting</button>
        <button class="bp-tab"        data-tab="1">Low Poly</button>
      </div>

      <div class="bp-tool-grid" id="bp-grid-sculpt">${sculptBtns}</div>
      <div class="bp-tool-grid" id="bp-grid-lp" style="display:none">${lpBtns}</div>

      <hr class="bp-divider">

      <div class="bp-row">
        <span class="bp-lbl">Radius</span>
        <input type="range" id="bp-radius" min="5" max="250" step="1" value="50">
        <span class="bp-val" id="bp-radius-val">50</span>
      </div>
      <div class="bp-row">
        <span class="bp-lbl">Intensity</span>
        <input type="range" id="bp-intensity" min="0" max="100" step="1" value="50">
        <span class="bp-val" id="bp-intensity-val">50%</span>
      </div>

      <hr class="bp-divider">

      <div class="bp-toggles">
        <button class="bp-toggle-btn" id="bp-sym">
          <span class="bp-check">✓</span> Symmetry
        </button>
        <button class="bp-toggle-btn" id="bp-clay">
          <span class="bp-check">✓</span> Clay
        </button>
        <button class="bp-toggle-btn" id="bp-accum">
          <span class="bp-check">✓</span> Accumulate
        </button>
        <button class="bp-toggle-btn" id="bp-wire">
          <span class="bp-check">✓</span> Wireframe
        </button>
      </div>
    `;
  }

  // ── DOM event wiring ──────────────────────────────────────────────────────

  _wireEvents(main) {
    const root = this._element;

    // ── Tab buttons ────────────────────────────────────────────────────────
    root.querySelectorAll('.bp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = parseInt(btn.dataset.tab, 10);
        root.querySelectorAll('.bp-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        root.querySelector('#bp-grid-sculpt').style.display = this._tab === 0 ? '' : 'none';
        root.querySelector('#bp-grid-lp').style.display     = this._tab === 1 ? '' : 'none';
        this._requestPaint();
      });
    });

    // ── Tool buttons ───────────────────────────────────────────────────────
    root.querySelectorAll('.bp-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.toolId, 10);
        if (isNaN(id)) return;
        const sm = main.getSculptManager?.();
        if (!sm) return;
        // Always drive via SculptManager directly — avoids the yagui setValue(0)
        // falsy-check bug that silently drops BRUSH (id=0).
        sm.setToolIndex(id);
        // Best-effort sync of the desktop combobox (purely cosmetic, non-critical).
        try { main.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(id); } catch (_) {}
        main.render?.();
        this.syncFromState();
      });
    });

    // ── Radius slider ──────────────────────────────────────────────────────
    const radiusInput = root.querySelector('#bp-radius');
    const radiusVal   = root.querySelector('#bp-radius-val');
    radiusInput.addEventListener('input', () => {
      const val = parseFloat(radiusInput.value);
      radiusVal.textContent = Math.round(val);
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

    // ── Intensity slider ───────────────────────────────────────────────────
    const intensityInput = root.querySelector('#bp-intensity');
    const intensityVal   = root.querySelector('#bp-intensity-val');
    intensityInput.addEventListener('input', () => {
      const pct = parseFloat(intensityInput.value);
      const val = pct / 100;
      intensityVal.textContent = Math.round(pct) + '%';
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

    // ── Toggle buttons (symmetry, clay, accumulate, wireframe) ────────────
    const makeToggle = (id, getVal, setVal) => {
      const btn = root.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        setVal(!getVal());
        this.syncFromState();
        this._requestPaint();
      });
    };

    makeToggle('#bp-sym',
      () => main.getSculptManager?.()._symmetry,
      (v) => { const sm = main.getSculptManager?.(); if (sm) { sm._symmetry = v; main.render?.(); } }
    );

    makeToggle('#bp-clay',
      () => main.getSculptManager?.().getCurrentTool?.()?._clay,
      (v) => {
        const sm  = main.getSculptManager?.();
        const t   = sm?.getCurrentTool?.();
        const idx = sm?.getToolIndex();
        if (t) {
          t._clay = v;
          getOptionsURL.saveOption(`tool_${idx}_clay`, v);
          main.render?.();
        }
      }
    );

    makeToggle('#bp-accum',
      () => main.getSculptManager?.().getCurrentTool?.()?._accumulate,
      (v) => {
        const sm  = main.getSculptManager?.();
        const t   = sm?.getCurrentTool?.();
        const idx = sm?.getToolIndex();
        if (t) {
          t._accumulate = v;
          getOptionsURL.saveOption(`tool_${idx}_accumulate`, v);
          main.render?.();
        }
      }
    );

    makeToggle('#bp-wire',
      () => main.getMesh?.()?.getShowWireframe?.() ?? false,
      (v) => {
        const mesh = main.getMesh?.();
        if (mesh) { mesh.setShowWireframe(v); main.render?.(); }
      }
    );

    // ── Pin button ─────────────────────────────────────────────────────────
    const pinBtn = root.querySelector('#bp-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        this._pinned = !this._pinned;
        pinBtn.classList.toggle('active', this._pinned);
        pinBtn.textContent = this._pinned ? '📌 Unpin' : '📌 Pin';
        // Dispatch a custom event so Scene.js can act on pin/unpin.
        this._element.dispatchEvent(
          new CustomEvent('bp-pin-change', { detail: { pinned: this._pinned }, bubbles: false })
        );
        this._requestPaint();
      });
    }
  }

  // ── Sync DOM from current app state ──────────────────────────────────────

  /**
   * Read the current sculpt manager state and reflect it in the HTML.
   * Call once per frame (or whenever state changes) to keep the panel in sync.
   */
  syncFromState() {
    const sm  = this._main.getSculptManager?.();
    if (!sm) return;

    const idx    = sm.getToolIndex();
    const tool   = sm.getCurrentTool?.();
    const root   = this._element;

    // Active tool button highlight.
    root.querySelectorAll('.bp-tool-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.toolId, 10) === idx);
    });

    // Radius.
    if (tool) {
      const rInput = root.querySelector('#bp-radius');
      const rVal   = root.querySelector('#bp-radius-val');
      if (rInput && rVal) {
        rInput.value       = tool._radius ?? 50;
        rVal.textContent   = Math.round(tool._radius ?? 50);
      }

      // Intensity.
      const iInput = root.querySelector('#bp-intensity');
      const iVal   = root.querySelector('#bp-intensity-val');
      if (iInput && iVal) {
        const pct          = Math.round((tool._intensity ?? 0.5) * 100);
        iInput.value       = pct;
        iVal.textContent   = pct + '%';
      }

      // Clay.
      root.querySelector('#bp-clay')?.classList.toggle('active', !!tool._clay);
      // Accumulate.
      root.querySelector('#bp-accum')?.classList.toggle('active', !!tool._accumulate);
    }

    // Symmetry.
    root.querySelector('#bp-sym')?.classList.toggle('active', !!sm._symmetry);

    // Wireframe.
    const wf = this._main.getMesh?.()?.getShowWireframe?.() ?? false;
    root.querySelector('#bp-wire')?.classList.toggle('active', wf);

    // Trigger repaint.
    this._requestPaint();
  }

  _requestPaint() {
    this.markDirty();
  }

  // ── Pin state accessor ────────────────────────────────────────────────────

  get pinned() { return this._pinned; }

  // ── Wrist offset (set by Scene.js based on dominant hand) ────────────────

  /** Position + rotation relative to the controller grip. */
  setWristOffset(position, euler) {
    if (!this.mesh) return;
    if (position) this.mesh.position.copy(position);
    if (euler)    this.mesh.rotation.copy(euler);
  }

  // ── Overrides ─────────────────────────────────────────────────────────────

  _onMeshCreated(_scene) {
    // Wrist offset: matches existing VRMenu positioning.
    // Rotation -Math.PI/2 on X makes the panel face roughly upward from the palm.
    // Position lifts it slightly above and in front of the grip.
    if (this.mesh) {
      this.mesh.position.set(0.10, 0.10, -0.05);
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
    }
    // Initial state sync once everything is live.
    requestAnimationFrame(() => this.syncFromState());
  }
}
