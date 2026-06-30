/**
 * VrKeyboard — floating on-screen keyboard that works everywhere.
 *
 *   Desktop → DOM overlay (also accepts the physical keyboard)
 *   VR      → floating HTMLVRPanel, ray-interactable (the only way to type in immersive)
 *
 * Modelled on VrNumpad.js (same lifecycle + positioning approach); the differences are a
 * QWERTY layout with a Shift toggle and TEXT (not numeric) accumulation. Layout is kept
 * deliberately simple — letters, digits and the few symbols names need (- _ .) on one
 * layer — which covers the file/object-name use case (#5). Add a symbols layer later if
 * needed.
 *
 * API
 *   window._vrKeyboard.open(currentValue, config, onConfirm, sourceEl?, sourcePanel?, anchorMesh?)
 *     config  { label?: string, maxLength?: number }
 *     onConfirm (text: string) => void
 *   window._vrKeyboard.close()
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import * as THREE from 'three';

// ── Layout ────────────────────────────────────────────────────────────────────
const ROWS = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  'zxcvbnm'.split(''),
];

// ── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
.vrk-root {
  width: 440px;
  background: #1e1e2e;
  border-radius: 12px;
  border: 1px solid #45475a;
  padding: 12px;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  user-select: none;
}
.vrk-label {
  color: #a6adc8;
  font-size: 12px;
  text-align: center;
  margin-bottom: 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.vrk-display {
  background: #11111b;
  border: 1px solid #45475a;
  border-radius: 8px;
  color: #cdd6f4;
  font-size: 22px;
  font-weight: 600;
  text-align: left;
  padding: 9px 12px;
  min-height: 42px;
  margin-bottom: 10px;
  word-break: break-all;
  line-height: 1.15;
  display: flex;
  align-items: center;
}
.vrk-display .vrk-caret { color: #89b4fa; font-weight: 400; margin-left: 1px; }
.vrk-display.vrk-empty { color: #585b70; }
.vrk-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  justify-content: center;
}
.vrk-key {
  flex: 1 1 0;
  background: #313244;
  border: none;
  border-radius: 7px;
  color: #cdd6f4;
  font-size: 18px;
  font-weight: 500;
  height: 44px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.07s;
}
.vrk-key:hover, .vrk-key.hover { background: #45475a; }
.vrk-key.active { background: #585b70; }
.vrk-key.vrk-wide  { flex: 4 1 0; }
.vrk-key.vrk-shift { flex: 1.6 1 0; background: #3d3a52; color: #b4befe; }
.vrk-key.vrk-shift.active { background: #585b70; color: #fff; }
.vrk-key.vrk-back  { flex: 1.6 1 0; background: #3d2e40; color: #f5c2e7; }
.vrk-key.vrk-back:hover, .vrk-key.vrk-back.hover { background: #5a3d5e; }
.vrk-key.vrk-ok {
  flex: 1.6 1 0; background: #40a02b; color: #fff; font-size: 20px;
}
.vrk-key.vrk-ok:hover, .vrk-key.vrk-ok.hover { background: #4ec33a; }
.vrk-key.vrk-cancel {
  flex: 1.6 1 0; background: #e64553; color: #fff; font-size: 20px;
}
.vrk-key.vrk-cancel:hover, .vrk-key.vrk-cancel.hover { background: #f05e6c; }
.vrk-key.vrk-clear { flex: 1.5 1 0; background: #3d2e40; color: #f5c2e7; font-size: 14px; }
.vrk-key.vrk-clear:hover, .vrk-key.vrk-clear.hover { background: #5a3d5e; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildPanelEl() {
  const wrap = document.createElement('div');
  const keyRows = ROWS.map((row, i) => {
    const keys = row.map(ch => `<button class="vrk-key" data-k="${ch}">${ch}</button>`).join('');
    // Shift + backspace flank the last letter row so they're reachable.
    if (i === 3) {
      return `<div class="vrk-row">
        <button class="vrk-key vrk-shift" id="vrk-shift">&#x21E7;</button>
        ${keys}
        <button class="vrk-key vrk-back" id="vrk-back">&#x232B;</button>
      </div>`;
    }
    return `<div class="vrk-row">${keys}</div>`;
  }).join('');

  wrap.innerHTML = `<div class="vrk-root">
  <div class="vrk-label" id="vrk-label">Name</div>
  <div class="vrk-display" id="vrk-display"></div>
  ${keyRows}
  <div class="vrk-row">
    <button class="vrk-key vrk-cancel" id="vrk-cancel">&#x2715;</button>
    <button class="vrk-key vrk-clear" id="vrk-clear">Clear</button>
    <button class="vrk-key" data-k="-">-</button>
    <button class="vrk-key" data-k="_">_</button>
    <button class="vrk-key vrk-wide" id="vrk-space">space</button>
    <button class="vrk-key" data-k=".">.</button>
    <button class="vrk-key vrk-ok" id="vrk-ok">&#x2713;</button>
  </div>
</div>`;
  return wrap.firstElementChild;
}

// ── Class ─────────────────────────────────────────────────────────────────────
export class VrKeyboard extends HTMLVRPanel {
  constructor(scene, camera, renderer) {
    injectCss();
    const el = buildPanelEl();
    super(el, 440 / VR_PANEL_PX_PER_M);

    this._scene3      = scene;
    this._str         = '';
    this._shift       = false;
    this._config      = {};
    this._onConfirm   = null;
    this._onCancel    = null;
    this._desktopEl   = null;
    this._activeEl    = null; // element currently receiving refreshes (VR panel or desktop panel)
    this._startHidden = true;

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire();
  }

  _waitForMeshThenWire() {
    if (this.mesh) { this._wire(this._element); return; }
    const chk = () => { if (this.mesh) this._wire(this._element); else requestAnimationFrame(chk); };
    requestAnimationFrame(chk);
  }

  // ── Key logic (instance-level so desktop + VR share one code path) ──────────
  _press(ch) {
    const max = this._config.maxLength ?? 64;
    if (this._str.length >= max) return;
    this._str += (this._shift && ch >= 'a' && ch <= 'z') ? ch.toUpperCase() : ch;
    if (this._shift) { this._shift = false; } // one-shot shift, like a phone keyboard
    this._refresh();
  }

  _backspace() { this._str = this._str.slice(0, -1); this._refresh(); }
  _toggleShift() { this._shift = !this._shift; this._refresh(); }

  _confirm() {
    const cb = this._onConfirm;
    const val = this._str;
    this._onCancel = null; // confirming — suppress the cancel callback
    this.close();
    cb?.(val);
  }

  /** Attach click handlers to a freshly-built .vrk-root element (VR panel or desktop). */
  _wire(el) {
    if (!el) return;
    el.querySelectorAll('[data-k]').forEach(btn =>
      btn.addEventListener('click', () => this._press(btn.dataset.k)));
    el.querySelector('#vrk-space') ?.addEventListener('click', () => this._press(' '));
    el.querySelector('#vrk-back')  ?.addEventListener('click', () => this._backspace());
    el.querySelector('#vrk-clear') ?.addEventListener('click', () => { this._str = ''; this._refresh(); });
    el.querySelector('#vrk-shift') ?.addEventListener('click', () => this._toggleShift());
    el.querySelector('#vrk-ok')    ?.addEventListener('click', () => this._confirm());
    el.querySelector('#vrk-cancel')?.addEventListener('click', () => this.close());
  }

  /** Redraw the display + shift state + letter casing on the active element. */
  _refresh() {
    const el = this._activeEl;
    if (!el) return;
    const disp = el.querySelector('#vrk-display');
    if (disp) {
      if (this._str) {
        disp.classList.remove('vrk-empty');
        disp.innerHTML = `${escapeHtml(this._str)}<span class="vrk-caret">|</span>`;
      } else {
        disp.classList.add('vrk-empty');
        disp.textContent = this._config.placeholder ?? 'Type a name…';
      }
    }
    el.querySelector('#vrk-shift')?.classList.toggle('active', this._shift);
    // Reflect shift on the letter keys so the user sees the case they'll get.
    el.querySelectorAll('[data-k]').forEach(btn => {
      const ch = btn.dataset.k;
      if (ch >= 'a' && ch <= 'z') btn.textContent = this._shift ? ch.toUpperCase() : ch;
    });
    if (el === this._element) this.markDirty();
  }

  // ── Desktop DOM overlay ─────────────────────────────────────────────────────
  _openDesktop(currentValue, config, onConfirm, sourceEl) {
    this._closeDesktop();
    this._config    = config;
    this._onConfirm = onConfirm;
    this._onCancel  = config.onCancel ?? null;
    this._str       = currentValue != null ? String(currentValue) : '';
    this._shift     = false;

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:999997;';

    const panel = buildPanelEl();
    panel.style.cssText += ';position:absolute;box-shadow:0 8px 40px rgba(0,0,0,.9);';

    // Position near the source field; clamp to viewport.
    const PW = 440, PH = 320, MARGIN = 8;
    let left, top;
    if (sourceEl) {
      const r = sourceEl.getBoundingClientRect();
      left = r.left;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - PW - MARGIN));
      top  = r.bottom + MARGIN;
      if (top + PH > window.innerHeight - MARGIN) top = r.top - PH - MARGIN;
      top  = Math.max(MARGIN, Math.min(top, window.innerHeight - PH - MARGIN));
    } else {
      left = Math.max(MARGIN, (window.innerWidth  - PW) / 2);
      top  = Math.max(MARGIN, (window.innerHeight - PH) / 2);
    }
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
    panel.addEventListener('click', e => e.stopPropagation());
    panel.querySelector('#vrk-label').textContent = config.label ?? 'Name';

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    this._desktopEl = backdrop;
    this._activeEl  = panel;
    this._wire(panel);
    this._refresh();

    // Physical keyboard passthrough. e.key is already cased, so _press appends it verbatim.
    const onKey = (e) => {
      if (e.key.length === 1 && e.key >= ' ') { this._press(e.key); }
      else if (e.key === 'Backspace') { this._backspace(); }
      else if (e.key === 'Enter')     { this._confirm(); return; }
      else if (e.key === 'Escape')    { this.close();    return; }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    this._desktopKeyHandler = onKey;
    window.addEventListener('keydown', onKey, { capture: true });
    backdrop.addEventListener('click', () => this.close()); // click-outside cancels (fires onCancel)
  }

  _closeDesktop() {
    if (this._desktopKeyHandler) {
      window.removeEventListener('keydown', this._desktopKeyHandler, { capture: true });
      this._desktopKeyHandler = null;
    }
    if (this._desktopEl) {
      this._desktopEl.parentNode?.removeChild(this._desktopEl);
      this._desktopEl = null;
    }
    if (this._activeEl && this._activeEl !== this._element) this._activeEl = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  open(currentValue, config = {}, onConfirm, sourceEl = null, sourcePanel = null, anchorMesh = null) {
    const xrPresenting = !!window.app?._renderer?.xr?.isPresenting;
    const panelVisible = sourcePanel ? !!sourcePanel.mesh?.visible : true;
    const inVR = xrPresenting && panelVisible;

    if (!inVR) { this._openDesktop(currentValue, config, onConfirm, sourceEl); return; }

    // ── VR path ──
    this._setHostMounted(true);
    this._config      = config;
    this._onConfirm   = onConfirm;
    this._onCancel    = config.onCancel ?? null;
    this._str         = currentValue != null ? String(currentValue) : '';
    this._shift       = false;
    this._sourcePanel = sourcePanel;
    this._sourceEl    = sourceEl;
    this._anchorMesh  = anchorMesh;
    this._activeEl    = this._element;

    const label = this._element.querySelector('#vrk-label');
    if (label) label.textContent = config.label ?? 'Name';
    this._refresh();

    if (!this.mesh) return;

    if (sourcePanel?.mesh)   this._positionForSource(sourcePanel, sourceEl);
    else if (anchorMesh)     this._positionAtMesh(anchorMesh);
    else {
      const cam = window.app?._camera?.getThreeCamera?.();
      if (cam) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        this.mesh.position.copy(cam.position).addScaledVector(fwd, 0.7);
        this.mesh.position.y -= 0.05;
        this.mesh.quaternion.copy(cam.quaternion);
      }
      if (!this.mesh.parent) this._scene3?.add(this.mesh);
    }

    this.mesh.visible = true;
    this.flushPaint();
  }

  // ── VR positioning ────────────────────────────────────────────────────────
  /**
   * Float the keyboard centred horizontally on the source panel, just BELOW the
   * edited field, tilted to match the panel. Same quaternion-decomposition fix as
   * VrNumpad (HTMLVRPanel meshes carry scale.y=-1, which adds a spurious Rz(180°)
   * to the extracted world quaternion).
   */
  _positionForSource(sourcePanel, sourceEl) {
    if (this.mesh.parent !== this._scene3) this._scene3.add(this.mesh);

    const pMesh = sourcePanel.mesh;
    pMesh.updateMatrixWorld(true);

    const panelWorldPos = new THREE.Vector3();
    pMesh.getWorldPosition(panelWorldPos);

    const panelQuat = new THREE.Quaternion();
    pMesh.getWorldQuaternion(panelQuat);
    panelQuat.multiply(new THREE.Quaternion(0, 0, 1, 0)); // undo the scale.y=-1 Rz180

    const up     = new THREE.Vector3(0, 1, 0).applyQuaternion(panelQuat);
    const toUser = new THREE.Vector3(0, 0, 1).applyQuaternion(panelQuat);

    // Vertical: drop to just below the field (or panel centre if no field hint).
    let yField = 0;
    const meshH = pMesh.geometry?.parameters?.height ?? 0;
    if (sourceEl && sourcePanel._element && meshH) {
      const panelRect = sourcePanel._element.getBoundingClientRect();
      const elRect    = sourceEl.getBoundingClientRect();
      if (panelRect.width > 0 && panelRect.height > 0) {
        const relY = (elRect.top + elRect.height / 2 - panelRect.top) / panelRect.height;
        yField = (0.5 - relY) * meshH;
      }
    }
    const kbH = this.mesh.geometry?.parameters?.height ?? 0.18;
    const GAP = 0.02;

    this.mesh.position
      .copy(panelWorldPos)
      .addScaledVector(up,     yField - kbH / 2 - GAP)
      .addScaledVector(toUser, 0.04);
    this.mesh.quaternion.copy(panelQuat);
  }

  /** Match a plain (non-HTMLVRPanel) anchor mesh, floating toward the user. */
  _positionAtMesh(anchorMesh) {
    if (!this.mesh || !anchorMesh) return;
    if (this.mesh.parent !== this._scene3) this._scene3?.add(this.mesh);
    anchorMesh.updateMatrixWorld(true);
    const pos  = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    anchorMesh.getWorldPosition(pos);
    anchorMesh.getWorldQuaternion(quat);
    const toUser = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const up     = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    // Float ABOVE the anchor panel so it doesn't cover it, tilted to match, nudged toward
    // the user so it's clearly in front.
    const anchorH = anchorMesh.geometry?.parameters?.height ?? 0.2;
    const kbH     = this.mesh.geometry?.parameters?.height ?? 0.2;
    this.mesh.position.copy(pos)
      .addScaledVector(up,     anchorH / 2 + kbH / 2 + 0.02)
      .addScaledVector(toUser, 0.04);
    this.mesh.quaternion.copy(quat);
  }

  /** Called each XR frame while visible — follows a controller-attached source panel. */
  _repositionIfTracking() {
    if (this._sourcePanel?.mesh?.visible && this.mesh?.visible) {
      this._positionForSource(this._sourcePanel, this._sourceEl);
    } else if (this._anchorMesh?.visible && this.mesh?.visible) {
      this._positionAtMesh(this._anchorMesh);
    }
  }

  close() {
    const wasOpen  = !!this.mesh?.visible || !!this._desktopEl;
    const onCancel = this._onCancel;
    if (this.mesh) this.mesh.visible = false;
    this._onConfirm   = null;
    this._onCancel    = null;
    this._sourcePanel = null;
    this._sourceEl    = null;
    this._anchorMesh  = null;
    this._closedAt    = performance.now();
    this._closeDesktop();
    if (wasOpen && onCancel) { try { onCancel(); } catch (_) {} }
  }

  /** True while open OR within 400 ms of closing (debounce against re-open). */
  get isBlockingOpen() {
    if (this.mesh?.visible) return true;
    return (performance.now() - (this._closedAt ?? 0)) < 400;
  }

  /** Text inputs always route here in VR (no physical keyboard). */
  shouldUse() {
    return !!window.app?._renderer?.xr?.isPresenting;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
