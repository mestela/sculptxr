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

import { HTMLVRPanel, VR_PANEL_PX_PER_M, matchPanelTransform, frontOfPanelOffset } from './HTMLVRPanel.js';
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
/* THE SHARED COMMAND ROW -- same three buttons, same order, same size, same place as the
   numpad's. Equal thirds rather than the keys' flex:1, so Cancel, Clear and Confirm are the same
   width as each other regardless of how many keys the row above happens to hold. */
.vrk-cmdrow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
}
.vrk-cmd {
  background: #313244;
  border: none;
  border-radius: 7px;
  color: #cdd6f4;
  font-size: 15px;
  font-weight: 500;
  height: 44px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.07s;
}
.vrk-cmd:hover, .vrk-cmd.hover { background: #45475a; }
.vrk-cmd.vrk-ok { background: #40a02b; color: #fff; }
.vrk-cmd.vrk-ok:hover, .vrk-cmd.vrk-ok.hover { background: #4ec33a; }
.vrk-cmd.vrk-cancel { background: #e64553; color: #fff; }
.vrk-cmd.vrk-cancel:hover, .vrk-cmd.vrk-cancel.hover { background: #f05e6c; }

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
  ${/* PUNCTUATION HERE, COMMANDS BELOW. Cancel and Confirm used to flank this row with Clear
       tucked in beside them, so the three commands were interleaved with keys and sat in a
       different place from the numpad's copies. See the command row below. */ ''}
  <div class="vrk-row">
    <button class="vrk-key" data-k="-">-</button>
    <button class="vrk-key" data-k="_">_</button>
    <button class="vrk-key vrk-wide" id="vrk-space">space</button>
    <button class="vrk-key" data-k=".">.</button>
  </div>
  <div class="vrk-cmdrow">
    <button class="vrk-cmd vrk-cancel" id="vrk-cancel">Cancel</button>
    <button class="vrk-cmd" id="vrk-clear">Clear</button>
    <button class="vrk-cmd vrk-ok" id="vrk-ok">Confirm</button>
  </div>
  <div id="vrk-choices" style="display:none"></div>
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

    // Summoned BY another panel, so it draws in front of one. See VR_MODAL_ORDER_BUMP.
    this._isModalOverlay = true;
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
  // ── A LIST OF SUGGESTIONS, IN THE SAME FLOATING PANEL ───────────────────────
  //
  // Typing a name one pinch at a time is a lot of work for a word the app already knows, so the
  // list comes first and the keys are the way out of it. matt: "lets offer a list first, and
  // keyboard as a last option... center axis names in one column, other names in another, the
  // 'keyboard...' option at the bottom."
  //
  // THE SAME PANEL, not a new one, and that is the whole reason it is here rather than in
  // bonePanel: this class already knows how to place itself in front of the panel that summoned
  // it (see _positionForSource). A second floating panel would be a second copy of that, and the
  // placement is exactly the thing that has been wrong.
  openChoices(config = {}, onPick, sourcePanel = null) {
    const cols = config.columns || [];
    if (!this.shouldUse() || !cols.length) {
      // No headset: the keyboard's own desktop overlay is a better answer than a list of twelve
      // buttons in a DOM modal, and it is already built.
      this.open(config.current ?? '', config, onPick, null, sourcePanel);
      return;
    }
    this._config    = config;
    this._onConfirm = onPick;
    this._onCancel  = config.onCancel ?? null;
    this._str       = config.current != null ? String(config.current) : '';

    const host = this._element.querySelector('#vrk-choices');
    if (host) {
      const col = (list) => `<div style="flex:1;display:flex;flex-direction:column;gap:6px">` +
        list.map((nm) => `<button class="vrk-key" data-choice="${escapeHtml(nm)}">${escapeHtml(nm)}</button>`).join('') +
        `</div>`;
      host.innerHTML = `
        <div style="display:flex;gap:6px">${cols.map(col).join('')}</div>
        <div class="vrk-row" style="margin-top:8px">
          <button class="vrk-key vrk-cancel" id="vrk-ch-cancel">&#x2715;</button>
          <button class="vrk-key vrk-wide" id="vrk-ch-keys">Keyboard</button>
        </div>`;
      host.querySelectorAll('[data-choice]').forEach((b) => {
        b.addEventListener('click', () => {
          const cb = this._onConfirm; const v = b.dataset.choice;
          this._onCancel = null;
          this.close();
          cb?.(v);
        });
      });
      host.querySelector('#vrk-ch-cancel')?.addEventListener('click', () => this.close());
      // The long way round, reusing everything below: same panel, same placement, same confirm.
      host.querySelector('#vrk-ch-keys')?.addEventListener('click', () => {
        this._showChoices(false);
        this._refresh();
        this.markDirty();
      });
    }
    this.open(this._str, config, onPick, null, sourcePanel);
    this._showChoices(true);
    this.markDirty();
    this.flushPaint();
  }

  // Which half of the panel is live. The keys stay in the DOM so switching costs no rebuild.
  _showChoices(on) {
    const el = this._element;
    if (!el) return;
    el.querySelectorAll('.vrk-row, .vrk-display').forEach((r) => {
      if (r.closest('#vrk-choices')) return;
      r.style.display = on ? 'none' : '';
    });
    const host = el.querySelector('#vrk-choices');
    if (host) host.style.display = on ? '' : 'none';
  }

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
    // A plain open() is always the KEYS. openChoices calls this and then swaps, so this default
    // is what puts the panel back for the next caller.
    this._showChoices(false);
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

    // MATCH THE PANEL'S WORLD TRANSFORM. DO NOT REASON ABOUT WHICH AXIS THE MIRROR IS ON.
    //
    // Two compensations used to live here -- panelWorldQuat's conditional Rz(180) undo and a
    // sign-copy of the source panel's scale.y -- and BOTH tested `scale.y < 0`. That is not where
    // the mirror necessarily is: three's Matrix4.decompose expresses a negative determinant as a
    // negative *sx* by convention, so any panel placed by decomposing a matrix comes out
    // (-1, 1, 1) rather than (1, -1, 1). Same mirror, different axis, and every guard misses it.
    //
    // Measured on matt's repro -- pin the main panel, Files > Save:
    //   panelScale=[-1.0000000224, 0.9999999676, 0.9999999822]   kbScale=[1,1,1]
    //   panelWorldQuat = corrected = -0.081,0.320,0.938,0.108     (no compensation ran)
    //
    // Which lands the keyboard at correct x diag(-1,1,1): mirrored left to right, his words
    // exactly. Forcing the keyboard to its own -1 instead gives correct x diag(-1,-1,1), a half
    // turn -- "that command flipped it vertically, not horizontally". Two wrong answers either
    // side of the same missing mirror.
    //
    // So: decompose the panel's WORLD matrix and take its rotation and its scale SIGNS. The
    // keyboard is the same kind of object with the same texture convention, so a transform that
    // renders the panel correctly renders the keyboard correctly, whatever convention it is in
    // and whichever axis carries the flip. Nothing to keep in step, and nothing to get wrong the
    // next time a placement writes scale.
    //
    // Signs onto the keyboard's OWN magnitudes rather than copying the scale outright: the
    // keyboard sizes itself from its geometry and a panel is free to be scaled.
    const panelQuat = matchPanelTransform(this.mesh, pMesh);


    // (No vertical term. The keyboard takes the parent's pose exactly; see below. The field
    // position used to shift it up or down, which made it land somewhere different depending on
    // which input you touched.)
    // SAME POSE AS THE PARENT, THEN 1cm TOWARD THE HEADSET. That is the whole rule.
    //
    // Three attempts got this wrong by adding cleverness on top of a simple spec. The first
    // nudged along the panel's own normal, which is only "in front" if the panel faces you. The
    // second pushed toward the head, which on a panel below eye level also threw it upward. The
    // third read matt's "above/below" as vertical when he meant STACKING ORDER — sheets of
    // paper, not height — and sent it toward the floor. His words, once he restated them
    // precisely: "start in the same position and rotation as the browser save panel, move it 1cm
    // in-front, towards the VR headset."
    //
    // No vertical term at all. Copy the pose, step toward the viewer, done. The panel normal
    // remains the fallback for when there is no camera to ask.
    this.mesh.position.copy(panelWorldPos);

    // THE SAME RULE THE NUMPAD USES -- see frontOfPanelOffset. Stepping toward the HEAD instead
    // of along the normal gives a clearance of gap x cos(angle between them), so it thins out as
    // the panel is angled away. Concentric with the panel, as this is, that was never visible;
    // beside it, as the numpad is, it was the whole bug. One rule for both.
    this.mesh.position.add(frontOfPanelOffset(
      panelQuat, panelWorldPos, this._viewerPosition(), window._kbFrontGap ?? 0.01));

    this.mesh.quaternion.copy(panelQuat);

    if (window._kbTrace) {
      const _r = (q) => [q.x, q.y, q.z, q.w].map((n) => n.toFixed(3)).join(',');
      const _wq = new THREE.Quaternion(); pMesh.getWorldQuaternion(_wq);
      console.log('[kb] panel=' + (sourcePanel.constructor?.name || '?')
        + ' pinned=' + !!sourcePanel.pinned
        + ' panelScale=[' + pMesh.scale.x + ',' + pMesh.scale.y + ',' + pMesh.scale.z + ']'
        + ' kbScale=[' + this.mesh.scale.x + ',' + this.mesh.scale.y + ',' + this.mesh.scale.z + ']'
        + ' panelWorldQuat=' + _r(_wq)
        + ' applied=' + _r(panelQuat));
    }
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
    if (!this.mesh?.visible) return;
    // THE PARENT GOING AWAY TAKES THIS WITH IT.
    //
    // These overlays are modal and they float in world space rather than being parented to the
    // panel that summoned them, so closing that panel used to leave the keyboard or numpad
    // hanging in mid-air over nothing -- still capturing presses, with no way back to the field
    // it was editing. matt: "if the user presses the X button to close the parent mainpanel, the
    // popup keyboard/numpad should also close."
    //
    // Checked here rather than wired to the X, because this runs every frame the overlay is
    // visible and so covers EVERY way a parent can leave: the close button, a swap to the wrist
    // panel, a torn-off section being put away, a panel that is never rebuilt. One test, no list
    // of exits to keep up to date. Closing (rather than merely hiding) is right: the edit is
    // abandoned, so the cancel callback should fire exactly as if you had pressed Cancel.
    // NO DEBOUNCE. The first version waited fifteen frames in case a hide was transient, on the
    // strength of Scene's restorable "wrist hide episode" (_updateWristHide). That episode fires
    // only while the off-hand trigger is held AND Grab is holding a pin or a bone -- a state you
    // cannot be in with a modal keyboard open, doubly so now that a stroke owns the controller
    // outright. matt: "why the delay? it serves no purpose i can see." He was right: it was
    // guarding a case that cannot arise, which is a cost with no benefit and a thing to explain
    // to the next reader. If a real transient ever turns up, THAT is when to wait for it.
    const _parent = this._sourcePanel ? this._sourcePanel.mesh : this._anchorMesh;
    if (_parent && !_parent.visible) { this.close(); return; }

    if (this._sourcePanel?.mesh?.visible) {
      this._positionForSource(this._sourcePanel, this._sourceEl);
    } else if (this._anchorMesh?.visible) {
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
