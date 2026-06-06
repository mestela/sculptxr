/**
 * VrNumpad — floating number-pad that works everywhere.
 *
 *   Desktop → DOM overlay (like _vrConfirm), keyboard-accessible
 *   VR      → floating HTMLVRPanel, ray-interactable
 *
 * API
 *   window._vrNumpad.open(currentValue, config, onConfirm)
 *     currentValue  number | string — pre-filled value
 *     config        { label?: string, integer?: boolean, min?: number, max?: number }
 *     onConfirm     (value: number) => void — called with clamped value on OK
 *
 *   window._vrNumpad.close()  — dismiss without confirming
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import * as THREE from 'three';

// ── Shared CSS ────────────────────────────────────────────────────────────────

const CSS = `
.vrn-root {
  width: 260px;
  background: #1e1e2e;
  border-radius: 12px;
  border: 1px solid #45475a;
  padding: 14px;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  user-select: none;
}
.vrn-label {
  color: #a6adc8;
  font-size: 12px;
  text-align: center;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.vrn-display {
  background: #11111b;
  border: 1px solid #45475a;
  border-radius: 8px;
  color: #cdd6f4;
  font-size: 26px;
  font-weight: 600;
  text-align: right;
  padding: 8px 12px;
  min-height: 46px;
  margin-bottom: 12px;
  letter-spacing: 1px;
  word-break: break-all;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.vrn-display.vrn-invalid { color: #f38ba8; }
.vrn-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
}
.vrn-btn {
  background: #313244;
  border: none;
  border-radius: 7px;
  color: #cdd6f4;
  font-size: 18px;
  font-weight: 500;
  height: 46px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.07s;
}
.vrn-btn:hover  { background: #45475a; }
.vrn-btn.active { background: #585b70; }
.vrn-btn.vrn-ok {
  background: #40a02b;
  color: #fff;
  font-size: 20px;
}
.vrn-btn.vrn-ok:hover { background: #4ec33a; }
.vrn-btn.vrn-cancel {
  background: #e64553;
  color: #fff;
  font-size: 20px;
}
.vrn-btn.vrn-cancel:hover { background: #f05e6c; }
.vrn-btn.vrn-back {
  background: #3d2e40;
  color: #f5c2e7;
}
.vrn-btn.vrn-back:hover { background: #5a3d5e; }
.vrn-btn.vrn-dim {
  opacity: 0.3;
  cursor: default;
  pointer-events: none;
}
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── Shared HTML builder ───────────────────────────────────────────────────────

function buildPanelEl() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="vrn-root">
  <div class="vrn-label" id="vrn-label">Value</div>
  <div class="vrn-display" id="vrn-display">0</div>
  <div class="vrn-grid">
    <button class="vrn-btn" data-vrn="7">7</button>
    <button class="vrn-btn" data-vrn="8">8</button>
    <button class="vrn-btn" data-vrn="9">9</button>
    <button class="vrn-btn vrn-back" id="vrn-back">&#x2190;</button>

    <button class="vrn-btn" data-vrn="4">4</button>
    <button class="vrn-btn" data-vrn="5">5</button>
    <button class="vrn-btn" data-vrn="6">6</button>
    <button class="vrn-btn" id="vrn-neg">±</button>

    <button class="vrn-btn" data-vrn="1">1</button>
    <button class="vrn-btn" data-vrn="2">2</button>
    <button class="vrn-btn" data-vrn="3">3</button>
    <button class="vrn-btn vrn-ok" id="vrn-ok">✓</button>

    <button class="vrn-btn" id="vrn-dot">.</button>
    <button class="vrn-btn" data-vrn="0">0</button>
    <button class="vrn-btn" style="visibility:hidden"></button>
    <button class="vrn-btn vrn-cancel" id="vrn-cancel">✕</button>
  </div>
</div>`;
  return wrap.firstElementChild;
}

// ── Shared button logic (works on any .vrn-root element) ─────────────────────

function wireNumpadEl(el, config, getStr, setStr, onConfirm, onCancel) {
  const refresh = () => {
    const disp = el.querySelector('#vrn-display');
    if (!disp) return;
    const str = getStr();
    disp.textContent = str || '0';
    const val = parseFloat(str);
    const valid = !isNaN(val)
      && (config.min === undefined || val >= config.min)
      && (config.max === undefined || val <= config.max);
    disp.classList.toggle('vrn-invalid', !valid);
  };

  const press = (d) => {
    let s = getStr();
    if (s === '0' || s === '')                 s = d;
    else if (s === '-0' || s === '-')          s = '-' + d;
    else if (s.replace(/[^0-9]/g, '').length < 7) s += d;
    setStr(s); refresh();
  };

  const backspace = () => {
    let s = getStr();
    if (s.length <= 1)  s = '0';
    else {
      s = s.slice(0, -1);
      if (s === '-')    s = '0';
      if (s.endsWith('.')) s = s.slice(0, -1);
    }
    setStr(s); refresh();
  };

  const confirm = () => {
    let val = parseFloat(getStr());
    if (isNaN(val)) return;
    if (config.integer) val = Math.round(val);
    if (config.min !== undefined) val = Math.max(config.min, val);
    if (config.max !== undefined) val = Math.min(config.max, val);
    onConfirm(val);
  };

  el.querySelectorAll('[data-vrn]').forEach(btn =>
    btn.addEventListener('click', () => press(btn.dataset.vrn))
  );

  el.querySelector('#vrn-dot')?.addEventListener('click', () => {
    if (config.integer) return;
    let s = getStr();
    if (!s.includes('.')) { if (!s || s === '-') s += '0'; s += '.'; setStr(s); refresh(); }
  });

  el.querySelector('#vrn-neg')?.addEventListener('click', () => {
    if (config.min !== undefined && config.min >= 0) return;
    let s = getStr();
    s = s.startsWith('-') ? s.slice(1) : '-' + s;
    if (s === '-0') s = '0';
    setStr(s); refresh();
  });

  el.querySelector('#vrn-back')?.addEventListener('click', backspace);
  el.querySelector('#vrn-ok')?.addEventListener('click', confirm);
  el.querySelector('#vrn-cancel')?.addEventListener('click', onCancel);

  refresh();
  return { refresh, confirm, backspace };
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class VrNumpad extends HTMLVRPanel {
  constructor(scene, camera, renderer) {
    injectCss();

    const el = buildPanelEl();

    // 260px wide → ~0.144 m in VR
    super(el, 260 / VR_PANEL_PX_PER_M);

    this._scene3     = scene;
    this._str        = '0';
    this._config     = {};
    this._onConfirm  = null;
    this._desktopEl  = null; // DOM overlay element when open on desktop
    this._startHidden = true;

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire();
  }

  // ── VR panel setup ────────────────────────────────────────────────────────

  _waitForMeshThenWire() {
    if (this.mesh) { this._wireVR(); return; }
    const chk = () => { if (this.mesh) this._wireVR(); else requestAnimationFrame(chk); };
    requestAnimationFrame(chk);
  }

  _wireVR() {
    // Wire directly — always reads this._config live so open() can swap configs.
    const el = this._element;

    const press = (d) => {
      let s = this._str;
      if (s === '0' || s === '')                s = d;
      else if (s === '-0' || s === '-')         s = '-' + d;
      else if (s.replace(/[^0-9]/g, '').length < 7) s += d;
      this._str = s; this._refreshVR();
    };

    const backspace = () => {
      let s = this._str;
      if (s.length <= 1) { s = '0'; }
      else {
        s = s.slice(0, -1);
        if (s === '-') s = '0';
        if (s.endsWith('.')) s = s.slice(0, -1);
      }
      this._str = s; this._refreshVR();
    };

    const confirm = () => {
      let val = parseFloat(this._str);
      if (isNaN(val)) return;
      const cfg = this._config;
      if (cfg.integer) val = Math.round(val);
      if (cfg.min !== undefined) val = Math.max(cfg.min, val);
      if (cfg.max !== undefined) val = Math.min(cfg.max, val);
      const cb = this._onConfirm;
      this.close();
      cb?.(val);
    };

    el.querySelectorAll('[data-vrn]').forEach(btn =>
      btn.addEventListener('click', () => press(btn.dataset.vrn))
    );

    el.querySelector('#vrn-dot')?.addEventListener('click', () => {
      if (this._config.integer) return;
      let s = this._str;
      if (!s.includes('.')) { if (!s || s === '-') s += '0'; s += '.'; }
      this._str = s; this._refreshVR();
    });

    el.querySelector('#vrn-neg')?.addEventListener('click', () => {
      if (this._config.min !== undefined && this._config.min >= 0) return;
      let s = this._str;
      s = s.startsWith('-') ? s.slice(1) : '-' + s;
      if (s === '-0') s = '0';
      this._str = s; this._refreshVR();
    });

    el.querySelector('#vrn-back')?.addEventListener('click', backspace);
    el.querySelector('#vrn-ok')?.addEventListener('click', confirm);
    el.querySelector('#vrn-cancel')?.addEventListener('click', () => this.close());
  }

  _refreshVR() {
    const disp = this._element.querySelector('#vrn-display');
    if (!disp) return;
    disp.textContent = this._str || '0';
    const val = parseFloat(this._str);
    const cfg = this._config;
    const valid = !isNaN(val)
      && (cfg.min === undefined || val >= cfg.min)
      && (cfg.max === undefined || val <= cfg.max);
    disp.classList.toggle('vrn-invalid', !valid);
    this.markDirty();
  }

  // ── Desktop DOM overlay ───────────────────────────────────────────────────

  _openDesktop(currentValue, config, onConfirm, sourceEl) {
    this._closeDesktop();

    let str = _initStr(currentValue, config);

    // ── Transparent full-screen backdrop (captures click-outside) ────────────
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:999997;';

    // ── Numpad panel ─────────────────────────────────────────────────────────
    const panel = buildPanelEl();
    panel.style.cssText += ';position:absolute;box-shadow:0 8px 40px rgba(0,0,0,.9);animation:vrn-pop .1s ease-out;';

    // ── Inject pop animation once ─────────────────────────────────────────────
    if (!document.getElementById('vrn-anim')) {
      const s = document.createElement('style');
      s.id = 'vrn-anim';
      s.textContent = '@keyframes vrn-pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}';
      document.head.appendChild(s);
    }

    // ── Position near source element ──────────────────────────────────────────
    const PW = 260, PH = 318, MARGIN = 8;
    let left, top;
    if (sourceEl) {
      const r = sourceEl.getBoundingClientRect();
      // Prefer right of the field; fall back to left if it overflows
      left = r.right + MARGIN;
      if (left + PW > window.innerWidth - MARGIN) left = r.left - PW - MARGIN;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth  - PW - MARGIN));
      // Align top with the field; push up if it would go off the bottom
      top  = r.top;
      if (top  + PH > window.innerHeight - MARGIN) top = r.bottom - PH;
      top  = Math.max(MARGIN, Math.min(top,  window.innerHeight - PH - MARGIN));
    } else {
      left = Math.max(MARGIN, (window.innerWidth  - PW) / 2);
      top  = Math.max(MARGIN, (window.innerHeight - PH) / 2);
    }
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';

    // Stop panel clicks from bubbling through to the backdrop
    panel.addEventListener('click', e => e.stopPropagation());

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    this._desktopEl = backdrop;

    // Label + dim states
    panel.querySelector('#vrn-label').textContent = config.label ?? 'Value';
    panel.querySelector('#vrn-dot')?.classList.toggle('vrn-dim', !!config.integer);
    panel.querySelector('#vrn-neg')?.classList.toggle('vrn-dim', config.min !== undefined && config.min >= 0);

    const dismiss = () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      this._closeDesktop();
    };

    const { refresh, confirm, backspace } = wireNumpadEl(
      panel, config,
      () => str,
      (v) => { str = v; },
      (val) => { dismiss(); onConfirm?.(val); },
      dismiss
    );

    // Keyboard support
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') { panel.querySelector(`[data-vrn="${e.key}"]`)?.click(); }
      else if (e.key === 'Backspace')    { backspace(); }
      else if (e.key === 'Enter')        { confirm(); }
      else if (e.key === 'Escape')       { dismiss(); }
      else if (e.key === '.')            { panel.querySelector('#vrn-dot')?.click(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });

    // Click anywhere on backdrop (outside panel) dismisses
    backdrop.addEventListener('click', dismiss);

    refresh();
  }

  _closeDesktop() {
    if (this._desktopEl) {
      this._desktopEl.parentNode?.removeChild(this._desktopEl);
      this._desktopEl = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Open the numpad.
   *   Desktop → DOM popover anchored near sourceEl.
   *   VR      → 3D panel parented to the same parent as sourcePanel (follows
   *             controller or world pin) and positioned to the right of it,
   *             vertically aligned with sourceEl's DOM position on the panel.
   *
   * @param {number|string}   currentValue
   * @param {{ label?: string, integer?: boolean, min?: number, max?: number }} config
   * @param {(value: number) => void} onConfirm
   * @param {HTMLElement|null}      [sourceEl]     DOM input — desktop anchor / VR vertical hint
   * @param {HTMLVRPanel|null}      [sourcePanel]  VR panel the input lives on
   */
  open(currentValue, config = {}, onConfirm, sourceEl = null, sourcePanel = null) {
    const inVR = !!window.app?._renderer?.xr?.isPresenting;

    if (!inVR) {
      this._openDesktop(currentValue, config, onConfirm, sourceEl);
      return;
    }

    // ── VR path ──────────────────────────────────────────────────────────────
    this._config    = config;
    this._onConfirm = onConfirm;
    this._str       = _initStr(currentValue, config);

    // Update the label and button dim-states in the VR element
    const label = this._element.querySelector('#vrn-label');
    if (label) label.textContent = config.label ?? 'Value';

    const dotBtn = this._element.querySelector('#vrn-dot');
    if (dotBtn) dotBtn.classList.toggle('vrn-dim', !!config.integer);

    const negBtn = this._element.querySelector('#vrn-neg');
    if (negBtn) negBtn.classList.toggle('vrn-dim', config.min !== undefined && config.min >= 0);

    this._refreshVR();

    if (!this.mesh) return;

    if (sourcePanel?.mesh) {
      this._positionNextToPanel(sourcePanel, sourceEl);
    } else {
      // Fallback: float 0.65 m in front of the VR camera
      const cam = window.app?._camera?.getThreeCamera?.();
      if (cam) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        this.mesh.position.copy(cam.position).addScaledVector(fwd, 0.65);
        this.mesh.position.y -= 0.04;
        this.mesh.quaternion.copy(cam.quaternion);
      }
      if (!this.mesh.parent) this._scene3?.add(this.mesh);
    }

    this.mesh.visible = true;
    this.flushPaint();
  }

  // ── VR panel positioning ──────────────────────────────────────────────────

  /**
   * Parent the numpad mesh to the same parent as `sourcePanel.mesh` and
   * position it to the right of the source panel, vertically aligned with
   * `sourceEl`'s position in the panel's DOM.
   *
   * Parenting ensures the numpad follows the panel if it is attached to a
   * controller grip or pinned to the world — no per-frame update needed.
   */
  _positionNextToPanel(sourcePanel, sourceEl) {
    const animMesh = sourcePanel.mesh;

    // ── Re-parent to the same parent object as the source panel ──────────────
    // This is the key: if the panel is a child of a controller group,
    // the numpad inherits that attachment and moves with it.
    const targetParent = animMesh.parent ?? this._scene3;
    if (this.mesh.parent !== targetParent) {
      targetParent.add(this.mesh); // THREE.js removes from previous parent automatically
    }

    const animW = animMesh.geometry.parameters.width;
    const numW  = this.mesh.geometry.parameters.width;
    const GAP   = 0.015; // 15 mm gap between panels

    // Local axes of the source panel in the parent's coordinate space
    const rightInParent = new THREE.Vector3(1, 0, 0).applyQuaternion(animMesh.quaternion);
    const upInParent    = new THREE.Vector3(0, 1, 0).applyQuaternion(animMesh.quaternion);

    // ── Vertical alignment from sourceEl's DOM position ─────────────────────
    // The panel uses scale.y = -1 to compensate for the polyfill texture flip.
    // That means DOM top (y_dom=0) visually sits at geometry y = –meshH/2,
    // which after scale.y=-1 maps to parent-space offset = +meshH/2 in the
    // upInParent direction.  Formula: yOffset = (0.5 – relY) * meshH
    let yOffset = 0;
    if (sourceEl && sourcePanel._element) {
      const panelEl = sourcePanel._element;
      const domH    = panelEl.offsetHeight || 300;
      const meshH   = animMesh.geometry.parameters.height;

      // Walk up the offsetParent chain to get cumulative offsetTop
      let top = 0, cur = sourceEl;
      while (cur && cur !== panelEl) { top += cur.offsetTop; cur = cur.offsetParent; }
      const elCenterDomY = top + (sourceEl.offsetHeight || 20) / 2;
      const relY = elCenterDomY / domH; // 0 = DOM top, 1 = DOM bottom

      yOffset = (0.5 - relY) * meshH;
    }

    // ── Place numpad to the right of the source panel at the input's height ──
    this.mesh.position
      .copy(animMesh.position)
      .addScaledVector(rightInParent, (animW + numW) / 2 + GAP)
      .addScaledVector(upInParent, yOffset);

    this.mesh.quaternion.copy(animMesh.quaternion);
  }

  /** Dismiss without confirming (both modes). */
  close() {
    if (this.mesh) this.mesh.visible = false;
    this._onConfirm = null;
    this._closeDesktop();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _initStr(currentValue, config) {
  const num = Number(currentValue);
  if (isNaN(num)) return '0';
  return config.integer ? String(Math.round(num)) : String(num);
}
