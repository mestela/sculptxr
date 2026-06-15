/**
 * VrConfirm — floating yes/no confirmation that works inside a headset.
 *
 *   Desktop → the DOM overlay in Gui.js (window._vrConfirm) handles it.
 *   VR      → this floating HTMLVRPanel, ray-interactable, modal like VrNumpad.
 *
 * Gui.js's window._vrConfirm() routes to this panel when an XR session is
 * presenting; otherwise it falls back to its own DOM overlay. So open() here is
 * only ever reached in VR.
 *
 * API
 *   window._vrConfirmPanel.open(message, onOk, onCancel)
 *   window._vrConfirmPanel.close()   — dismiss without confirming
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import * as THREE from 'three';

// ── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
.vrc-root {
  width: 320px;
  background: #1e1e2e;
  border-radius: 12px;
  border: 1px solid #45475a;
  padding: 22px 22px 18px;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  user-select: none;
  text-align: center;
}
.vrc-msg {
  color: #cdd6f4;
  font-size: 16px;
  line-height: 1.45;
  margin-bottom: 20px;
  word-break: break-word;
}
.vrc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.vrc-btn {
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  height: 48px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.07s;
}
.vrc-btn.vrc-cancel { background: #313244; color: #cdd6f4; }
.vrc-btn.vrc-cancel:hover { background: #45475a; }
.vrc-btn.vrc-ok { background: #e64553; color: #fff; }
.vrc-btn.vrc-ok:hover { background: #f17585; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

function buildPanelEl() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="vrc-root">
  <div class="vrc-msg" id="vrc-msg">Are you sure?</div>
  <div class="vrc-row">
    <button class="vrc-btn vrc-cancel" id="vrc-cancel">Cancel</button>
    <button class="vrc-btn vrc-ok" id="vrc-ok">Confirm</button>
  </div>
</div>`;
  return wrap.firstElementChild;
}

// ── Class ─────────────────────────────────────────────────────────────────────
export class VrConfirm extends HTMLVRPanel {
  constructor(scene, camera, renderer, sceneCtrl = null) {
    injectCss();
    const el = buildPanelEl();
    super(el, 320 / VR_PANEL_PX_PER_M);

    this._scene3      = scene;
    this._sceneCtrl   = sceneCtrl;   // Scene instance — used to find the active panel
    this._onOk        = null;
    this._onCancel    = null;
    this._anchorMesh  = null;        // panel mesh we float in front of (for tracking)
    this._closedAt    = 0;
    this._startHidden = true;

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire();
  }

  _waitForMeshThenWire() {
    if (this.mesh) { this._wireVR(); return; }
    const chk = () => { if (this.mesh) this._wireVR(); else requestAnimationFrame(chk); };
    requestAnimationFrame(chk);
  }

  _wireVR() {
    const el = this._element;
    el.querySelector('#vrc-ok')?.addEventListener('click', () => {
      const cb = this._onOk; this.close(); cb?.();
    });
    el.querySelector('#vrc-cancel')?.addEventListener('click', () => {
      const cb = this._onCancel; this.close(); cb?.();
    });
  }

  // ── VR path (only reached while an XR session is presenting) ────────────────
  open(message, onOk, onCancel, okLabel = 'Confirm') {
    this._setHostMounted(true); // remount into host canvas before flushPaint()
    this._onOk     = onOk;
    this._onCancel = onCancel;

    const msg = this._element.querySelector('#vrc-msg');
    if (msg) msg.textContent = message ?? 'Are you sure?';
    const okBtn = this._element.querySelector('#vrc-ok');
    if (okBtn) okBtn.textContent = okLabel;

    this.markDirty();
    if (!this.mesh) return;
    this.resizeMesh?.();

    this._anchorMesh = this._pickAnchorMesh();
    if (this._anchorMesh) this._positionAtPanel(this._anchorMesh);
    else                  this._positionInFront();

    this.mesh.visible = true;
    this.flushPaint();
  }

  // The front-most visible HTML panel to anchor to. Clear All lives in the
  // animation panel inside MainMenuPanel, so prefer that; fall back to a
  // torn-off panel or the files panel.
  _pickAnchorMesh() {
    const s = this._sceneCtrl;
    if (!s) return null;
    if (s._mainMenuPanel?.mesh?.visible) return s._mainMenuPanel.mesh;
    let found = null;
    s._tornOffPanels?.forEach(p => { if (!found && p.mesh?.visible) found = p.mesh; });
    if (found) return found;
    if (s._filesPanel?.mesh?.visible) return s._filesPanel.mesh;
    return null;
  }

  // Float centred just in front of the given panel, inheriting its rotation so
  // the dialog tilts with the panel like a child — same logic as VrNumpad.
  // The Quaternion(0,0,1,0) multiply undoes the Rz(180°) that Matrix4.decompose
  // bakes into every HTMLVRPanel mesh (scale.y=-1, negative determinant);
  // without it the dialog appears upside-down/mirrored.
  _positionAtPanel(panelMesh) {
    if (this.mesh.parent !== this._scene3) this._scene3?.add(this.mesh);
    panelMesh.updateMatrixWorld(true);

    const panelWorldPos = new THREE.Vector3();
    panelMesh.getWorldPosition(panelWorldPos);

    const panelQuat = new THREE.Quaternion();
    panelMesh.getWorldQuaternion(panelQuat);
    panelQuat.multiply(new THREE.Quaternion(0, 0, 1, 0));

    const toUser = new THREE.Vector3(0, 0, 1).applyQuaternion(panelQuat); // panel front normal
    this.mesh.position.copy(panelWorldPos).addScaledVector(toUser, 0.04); // 4 cm in front
    this.mesh.quaternion.copy(panelQuat);
  }

  // Fallback when no panel is visible: float ~0.5 m in front of the VR camera.
  _positionInFront() {
    const cam = window.app?._camera?.getThreeCamera?.();
    if (!cam) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.mesh.position.copy(cam.position).addScaledVector(fwd, 0.5);
    this.mesh.position.y -= 0.03;
    this.mesh.quaternion.copy(cam.quaternion);
    if (!this.mesh.parent) this._scene3?.add(this.mesh);
  }

  // Called each XR frame while visible so the dialog follows its anchor panel
  // (which may be attached to a moving controller).
  _repositionIfTracking() {
    if (this._anchorMesh?.visible && this.mesh?.visible) {
      this._positionAtPanel(this._anchorMesh);
    }
  }

  close() {
    if (this.mesh) this.mesh.visible = false;
    this._onOk      = null;
    this._onCancel  = null;
    this._anchorMesh = null;
    this._closedAt  = performance.now();
  }

  // True while open OR within 400 ms of closing — mirrors VrNumpad so a bouncing
  // trigger can't immediately re-trigger the panel beneath after dismiss.
  get isBlockingOpen() {
    if (this.mesh?.visible) return true;
    return (performance.now() - (this._closedAt ?? 0)) < 400;
  }
}
