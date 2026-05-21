/**
 * HTMLVRPanel — base class for a Three.js PlaneGeometry whose texture is driven
 * by a live HTML element rendered via the three-html-render polyfill.
 *
 * Texture pipeline (no ThreeHTMLRenderer — avoids WebGL state corruption):
 *   markDirty() → requestPaint() → polyfill rasterises in a rAF callback
 *   → canvas.onpaint fires → _onPaint() → captureElementImage() → texture.needsUpdate
 *
 * In XR mode the rAF never fires natively (Chrome blocks it).  Scene.js must
 * call drainRAF() each frame so the polyfill callback fires synchronously.
 *
 * Caller responsibilities (Scene.js):
 *   panel.update(xrIsPresenting)  — call every frame
 *   panel.onVRMove/Press/Release/Leave(uv)  — from controller raycasts
 *   panel.castController(ctrl)    — Three.js raycaster helper
 *   panel.bindDesktopPointers(renderer, camera)  — once for non-XR use
 */

import * as THREE from 'three';
import { getHostCanvas, registerPanel, unregisterPanel, drainRAF } from './install.js';

/**
 * Shared pixels-per-metre ratio for all htmlvr panels.
 * Set meshWidth = domWidth / VR_PANEL_PX_PER_M to keep perceived font size
 * consistent regardless of panel DOM width.
 *   BrushPanel:  540 / 1800 = 0.30 m  ✓
 *   MiniPanel:   240 / 1800 = 0.133 m → rounded to 0.13 m  ✓
 */
export const VR_PANEL_PX_PER_M = 1800;

export class HTMLVRPanel {
  /**
   * @param {HTMLElement} element   Root DOM element to render.  Not yet in document —
   *                                this constructor appends it to the shared host canvas.
   * @param {number} [meshWidth]    World-space width of the plane mesh in metres.
   */
  constructor(element, meshWidth = 0.30) {
    this._element   = element;
    this._meshWidth = meshWidth;

    // Pointer drag state
    this._sliderDragTarget = null;
    this._hoveredBtn       = null;

    // Texture / dirty flag
    this._texture     = null;
    this._dirty       = true;  // paint on first update
    this._needsResize = false; // set true to defer resizeMesh() until next _onPaint

    // Three.js objects (created in _createMesh after one rAF)
    this.mesh     = null;
    this._renderer = null;

    // Desktop event listeners
    this._desktopPointerDown = null;
    this._desktopPointerMove = null;
    this._desktopPointerUp   = null;

    this._raycaster  = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();
    this._mouse2D    = new THREE.Vector2();

    // Append to the shared layoutsubtree canvas so the polyfill tracks layout.
    getHostCanvas().appendChild(element);

    // Register for onpaint notifications.
    registerPanel(this);
  }

  dispose() {
    unregisterPanel(this);
    this.unbindDesktopPointers();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      if (this._texture) this._texture.dispose();
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Call once after the Three.js scene/renderer are available.
   * The mesh is created asynchronously (one rAF delay for layout to settle).
   */
  init(scene, _camera, _renderer) {
    if (this.mesh) return;
    this._scene    = scene;
    this._renderer = _renderer;
    // Delay mesh creation so the polyfill has time to lay out the element
    // and we can read accurate offsetWidth/offsetHeight values.
    requestAnimationFrame(() => this._createMesh(scene));
  }

  _createMesh(scene) {
    const el     = this._element;
    const w      = el.offsetWidth  || 540;
    const h      = el.offsetHeight || 300;
    const aspect = w / h;
    const meshH  = this._meshWidth / aspect;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this._meshWidth, meshH),
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      })
    );
    // scale.y = -1 compensates for flipY=false in the polyfill-rasterised texture.
    this.mesh.scale.y    = -1;
    this.mesh.renderOrder = 1000; // draw on top of sculpt scene, like existing VRMenu

    // Subclasses can set this._startHidden = true before calling init()
    // to start the mesh invisible (avoids the frame where both panels are visible).
    if (this._startHidden) this.mesh.visible = false;

    scene.add(this.mesh);

    // Trigger first paint
    this.markDirty();

    this._onMeshCreated(scene);
  }

  /** Override in subclasses to run code after the mesh is created. */
  _onMeshCreated(_scene) {}

  /**
   * Rebuild the mesh PlaneGeometry to match the element's current offsetHeight.
   * Call (via requestAnimationFrame) after toggling content that changes panel height,
   * e.g. opening/closing the tool picker overlay in MiniPanel.
   */
  resizeMesh() {
    if (!this.mesh || !this._element) return;
    const el     = this._element;
    const w      = el.offsetWidth  || 240;
    const h      = el.offsetHeight || 200;
    const aspect = w / h;
    const meshH  = this._meshWidth / aspect;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(this._meshWidth, meshH);
  }

  // ── Texture (called by install.js canvas.onpaint) ─────────────────────────

  _onPaint() {
    if (!this.mesh) return;
    try {
      const bitmap = getHostCanvas().captureElementImage(this._element);
      if (!bitmap) return;

      // If a resize was deferred (to avoid stretching old texture on new geometry),
      // update the geometry AND discard the old texture atomically with the fresh
      // bitmap.  We MUST dispose the texture here — if we leave it allocated at the
      // old dimensions Chrome throws GL_INVALID_VALUE / glCopySubTextureCHROMIUM
      // when it tries to copy the new (differently-sized) bitmap into the old slot.
      if (this._needsResize) {
        this._needsResize = false;
        this.resizeMesh();
        if (this._texture) {
          this._texture.dispose();
          this._texture = null;
          this.mesh.material.map = null;
          this.mesh.material.needsUpdate = true;
        }
      }

      if (!this._texture) {
        this._texture = new THREE.Texture(bitmap);
        this._texture.minFilter     = THREE.LinearFilter;
        this._texture.magFilter     = THREE.LinearFilter;
        this._texture.generateMipmaps = false;
        this._texture.flipY         = false; // polyfill renders top-to-bottom
        this.mesh.material.map      = this._texture;
        this.mesh.material.needsUpdate = true;
      } else {
        this._texture.image      = bitmap;
        this._texture.needsUpdate = true;
      }
    } catch (_e) {
      // "no snapshot recorded yet" on the very first frame — expected, ignore.
    }
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Call once per frame.  Pass xrIsPresenting=true when inside an XR session
   * so that pending rAF callbacks (blocked by Chrome) are drained here.
   */
  update(xrIsPresenting) {
    if (!this.mesh) return;

    // Drain any rAF callbacks queued by the previous frame's requestPaint().
    if (xrIsPresenting) drainRAF();

    if (this._dirty) {
      this._dirty = false;
      const canvas = getHostCanvas();
      if (canvas.requestPaint) {
        canvas.requestPaint();
        // Drain immediately so the polyfill rasterises in this same frame
        // rather than waiting until the next update() call.  Without this
        // there is a 2-frame gap between markDirty() and the texture update.
        if (xrIsPresenting) drainRAF();
      }
    }
  }

  markDirty() { this._dirty = true; }

  /**
   * Synchronously request a repaint and drain the polyfill's rAF queue.
   * Use when the texture must be current *before* the mesh becomes visible
   * (e.g. panel swaps) so there is zero visible stale-frame.
   */
  flushPaint() {
    this._dirty = false;
    const canvas = getHostCanvas();
    if (canvas.requestPaint) {
      canvas.requestPaint();
      drainRAF();
    }
  }

  // ── VR interaction (called by Scene.js) ───────────────────────────────────

  onVRMove(uv)    { if (this.mesh) this._vrDispatch('pointermove', uv, 0); }
  onVRPress(uv)   { if (this.mesh) this._vrDispatch('pointerdown', uv, 1); }
  onVRRelease(uv) { if (this.mesh) this._vrDispatch('pointerup',   uv, 0); }

  onVRLeave() {
    if (this._hoveredBtn) {
      this._hoveredBtn.classList.remove('hover', 'active');
      this._hoveredBtn = null;
    }
  }

  /**
   * Raycast a controller target-ray against the panel mesh.
   * @param {THREE.Object3D} ctrl  renderer.xr.getController(i)
   * @returns {THREE.Intersection[]}
   */
  castController(ctrl) {
    if (!this.mesh) return [];
    this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);
    return this._raycaster.intersectObject(this.mesh);
  }

  // ── Desktop pointer binding ────────────────────────────────────────────────

  bindDesktopPointers(renderer, camera) {
    this._desktopCamera   = camera;
    this._desktopRenderer = renderer;

    this._desktopPointerDown = (e) => {
      if (renderer.xr.isPresenting || !this.mesh) return;
      this._screenToRay(e.clientX, e.clientY, camera);
      const hits = this._raycaster.intersectObject(this.mesh);
      if (hits.length) {
        e.target.setPointerCapture?.(e.pointerId);
        this._vrDispatch('pointerdown', hits[0].uv, 1);
      }
    };

    this._desktopPointerMove = (e) => {
      if (renderer.xr.isPresenting || !this.mesh) return;
      this._screenToRay(e.clientX, e.clientY, camera);
      const hits = this._raycaster.intersectObject(this.mesh);
      if (hits.length) {
        this._vrDispatch('pointermove', hits[0].uv, 0);
      } else if (this._sliderDragTarget) {
        this._updateSliderFromScreenX(e.clientX);
      }
    };

    this._desktopPointerUp = (e) => {
      if (renderer.xr.isPresenting || !this.mesh) return;
      if (e.target.hasPointerCapture?.(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }
      this._screenToRay(e.clientX, e.clientY, camera);
      const hits = this._raycaster.intersectObject(this.mesh);
      if (hits.length) {
        this._vrDispatch('pointerup', hits[0].uv, 0);
      } else if (this._sliderDragTarget) {
        this._sliderDragTarget = null;
      }
    };

    window.addEventListener('pointerdown', this._desktopPointerDown);
    window.addEventListener('pointermove', this._desktopPointerMove);
    window.addEventListener('pointerup',   this._desktopPointerUp);
  }

  unbindDesktopPointers() {
    if (this._desktopPointerDown) window.removeEventListener('pointerdown', this._desktopPointerDown);
    if (this._desktopPointerMove) window.removeEventListener('pointermove', this._desktopPointerMove);
    if (this._desktopPointerUp)   window.removeEventListener('pointerup',   this._desktopPointerUp);
    this._desktopPointerDown = this._desktopPointerMove = this._desktopPointerUp = null;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _screenToRay(clientX, clientY, camera) {
    const el = this._desktopRenderer?.domElement || document.querySelector('canvas');
    const w  = el ? el.clientWidth  : window.innerWidth;
    const h  = el ? el.clientHeight : window.innerHeight;
    this._mouse2D.x =  (clientX / w) * 2 - 1;
    this._mouse2D.y = -(clientY / h) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse2D, camera);
  }

  /**
   * Map a UV hit (from Three.js raycaster) to the DOM element at that position.
   *
   * We talk to the polyfill directly (no ThreeHTMLRenderer.addObject), so the
   * DOM element has no scaleY(-1) applied.  With scale.y=-1 on the mesh and
   * flipY=false on the texture, visual top = UV.y=0 = DOM top.  Direct mapping:
   *   relX = uv.x * panelRect.width
   *   relY = uv.y * panelRect.height
   */
  _uvToElement(uv) {
    const root      = this._element;
    const panelRect = root.getBoundingClientRect();
    const relX = uv.x * panelRect.width;
    const relY = uv.y * panelRect.height;

    function walk(node) {
      const r  = node.getBoundingClientRect();
      const rx = r.left - panelRect.left;
      const ry = r.top  - panelRect.top;
      if (relX < rx || relX > rx + r.width || relY < ry || relY > ry + r.height) return null;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const found = walk(node.children[i]);
        if (found) return found;
      }
      return node;
    }

    const el   = walk(root) || root;
    const absX = panelRect.left + relX;
    const absY = panelRect.top  + relY;
    return { el, absX, absY };
  }

  _sliderValueFromAbsX(input, absX) {
    const r   = input.getBoundingClientRect();
    const t   = Math.max(0, Math.min(1, (absX - r.left) / r.width));
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    return min + t * (max - min);
  }

  _updateSliderFromScreenX(clientX) {
    if (!this._sliderDragTarget) return;
    const r   = this._sliderDragTarget.getBoundingClientRect();
    const t   = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const min = parseFloat(this._sliderDragTarget.min) || 0;
    const max = parseFloat(this._sliderDragTarget.max) || 100;
    this._sliderDragTarget.value = min + t * (max - min);
    this._sliderDragTarget.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _vrDispatch(type, uv, buttons) {
    if (!this.mesh) return;
    const { el, absX, absY } = this._uvToElement(uv);

    // Slider drag: walk() may return the parent row if the 8px track isn't hit.
    if (type === 'pointerdown') {
      const rangeEl = (el.tagName === 'INPUT' && el.type === 'range')
        ? el
        : el.querySelector?.('input[type=range]') ?? null;
      if (rangeEl) this._sliderDragTarget = rangeEl;
    }
    if (type === 'pointerup') this._sliderDragTarget = null;

    const drag = this._sliderDragTarget;
    if (drag && (type === 'pointerdown' || type === 'pointermove')) {
      drag.value = this._sliderValueFromAbsX(drag, absX);
      drag.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Button hover/active visual state.
    const btn = el.closest('button');
    if (btn !== this._hoveredBtn) {
      this._hoveredBtn?.classList.remove('hover', 'active');
      this._hoveredBtn = btn;
      btn?.classList.add('hover');
    }
    if (type === 'pointerdown' && btn) btn.classList.add('active');
    if (type === 'pointerup'   && btn) btn.classList.remove('active');

    const target = drag || el;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse',
      clientX: absX, clientY: absY, buttons,
    }));

    if (type === 'pointerup') {
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true, clientX: absX, clientY: absY,
      }));
    }

    // Any interaction should refresh the panel.
    this.markDirty();
  }
}
