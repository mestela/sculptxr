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
import { getHostCanvas, registerPanel, unregisterPanel, drainRAF, requestPaintOnce, requestPaintForced } from './install.js';
import getOptionsURL from '../../misc/getOptionsURL.js';

// ── Menu color grade (brightness / saturation) ──────────────────────────────
// Applied on the GPU to the rasterised panel texture (a brightness multiply + a
// saturation mix around luminance, injected into every panel material), so it costs
// nothing to change — no re-rasterise. Restores the Settings menu brightness/saturation
// sliders that did this in the old canvas GUI (GuiXR.parseColor). Slider values are 0..1
// with 0.5 = neutral; the mapping below matches the legacy behaviour exactly.
const _gradeMats = new Set();
function _gradeFactors(b01, s01, g01) {
  const bright = (b01 ?? 0.5) * 2.0;                                  // 0.5 → 1.0 (neutral)
  const s = (s01 ?? 0.5);
  const sat = s <= 0.5 ? s * 2.0 : (s - 0.5) * 8.0 + 1.0;             // 0.5 → 1.0; up to 5.0
  const gamma = Math.pow(2.0, (0.5 - (g01 ?? 0.5)) * 2.0);           // 0.5 → 1.0; up=brighter (0.5), down=darker (2.0)
  return { bright, sat, gamma };
}
let _grade = (() => { const o = getOptionsURL(); return _gradeFactors(o.menuBrightness, o.menuSaturation, o.menuGamma); })();

// Inject the brightness/saturation/gamma grade into a MeshBasicMaterial's fragment (after the
// texture sample) and register it so setMenuColorGrade can update it. Used by HTMLVRPanel's own
// material and by registerGradeMaterial() for external canvas panels (timeline / blendshapes).
function _installGrade(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPanelBright = { value: _grade.bright };
    shader.uniforms.uPanelSat    = { value: _grade.sat };
    shader.uniforms.uPanelGamma  = { value: _grade.gamma };
    shader.fragmentShader =
      'uniform float uPanelBright;\nuniform float uPanelSat;\nuniform float uPanelGamma;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>',
        'vec3 _pc = gl_FragColor.rgb * uPanelBright;\n' +
        'float _plum = dot(_pc, vec3(0.299, 0.587, 0.114));\n' +
        '_pc = clamp(vec3(_plum) + (_pc - vec3(_plum)) * uPanelSat, 0.0, 1.0);\n' +
        'gl_FragColor.rgb = pow(_pc, vec3(uPanelGamma));\n' +
        '#include <dithering_fragment>');
    mat.userData.gradeShader = shader;
  };
  _gradeMats.add(mat);
  return mat;
}

// Apply the menu colour grade to a non-HTMLVRPanel material (the canvas-textured timeline and
// blendshape panels live as their own meshes in Scene.js, so they don't get it automatically).
export function registerGradeMaterial(mat) {
  if (!mat || mat.userData?.gradeShader || _gradeMats.has(mat)) return mat;
  _installGrade(mat);
  mat.needsUpdate = true;
  return mat;
}

// Set the menu brightness/saturation from the Settings sliders (0..1 each).
let _gradeRecompileTimer = null;
export function setMenuColorGrade(b01, s01, g01) {
  _grade = _gradeFactors(b01, s01, g01);
  for (const m of _gradeMats) {
    const sh = m.userData.gradeShader;
    if (sh) {
      sh.uniforms.uPanelBright.value = _grade.bright;
      sh.uniforms.uPanelSat.value   = _grade.sat;
      sh.uniforms.uPanelGamma.value = _grade.gamma;
    }
  }
  // Custom onBeforeCompile uniforms on a built-in material don't reliably re-upload after the
  // first compile (Three only does it when the material's program is "refreshed"), so the in-place
  // value write above can silently no-op. Force a recompile — onBeforeCompile re-reads _grade, the
  // same path that works on load. Debounced so a continuous slider drag coalesces to one recompile
  // (per-input recompile would stutter in VR).
  clearTimeout(_gradeRecompileTimer);
  _gradeRecompileTimer = setTimeout(() => { for (const m of _gradeMats) m.needsUpdate = true; }, 60);
}

/**
 * Shared pixels-per-metre ratio for all htmlvr panels.
 * Set meshWidth = domWidth / VR_PANEL_PX_PER_M to keep perceived font size
 * consistent regardless of panel DOM width.
 *   MiniPanel:   240 / 1800 = 0.133 m → rounded to 0.13 m  ✓
 */
export const VR_PANEL_PX_PER_M = 1800;

// HOW HIGH A WRIST PANEL SITS ABOVE THE CONTROLLER — ONE NUMBER FOR ALL OF THEM.
//
// The main menu sat at 0.10 and the mini panel and tool picker at 0.05, which nobody chose:
// they were written at different times. matt noticed them jumping height as they swapped —
// "this is the first time i've noticed the mainpanel and minipanel are at different heights.
// i think find the midpoint and make both panels appear at that height." 0.075 is that midpoint.
export const WRIST_PANEL_Y = 0.075;

// AND AN EXTRA LIFT, because a Quest 2 controller has a large tracking ring exactly where the
// panel sits and the panels clip through it — the offsets above were tuned on ringless hardware
// (Quest 3, GalaxyXR). matt, with a Quest 2 in hand: "its simply a matter of lifting the
// minipanel away from the controller."
//
// Live and persisted rather than a constant, so the right number comes from a headset instead
// of from me guessing at a controller I cannot hold: set `window._wristPanelLift` in a session,
// and it applies on the next frame because Scene re-seats the wrist panels as it re-parents
// them. Defaults to 0, so nothing moves for anyone who does not need it.
// AND THE SAME FOR THE ANGLE. The mini panel and the tool picker — the two that share one
// wrist slot — both used a 22.5 degree yaw, matched to the legacy MiniHUD placement so the
// panel faces you rather than the ceiling. The main menu used 0, which reads as a default
// nobody set rather than a decision: sighting along the controller, the panels visibly turn as
// they swap. matt: "if i look along the axis of the controller the minipanel and mainpanel are
// at different angles, can you conform that too?"
//
// Conformed to the value the OTHER TWO already share, not to a midpoint — this one has a right
// answer rather than two equally-arbitrary ends.
export const WRIST_PANEL_YAW = Math.PI / 8;

export function wristPanelYaw() {
  const live = window._wristPanelYaw;
  return Number.isFinite(live) ? live : WRIST_PANEL_YAW;
}

export function wristPanelY() {
  const live = window._wristPanelLift;
  const lift = Number.isFinite(live) ? live
    : (Number.isFinite(window._wristPanelLiftSaved) ? window._wristPanelLiftSaved : 0);
  return WRIST_PANEL_Y + lift;
}

// A switch that answers back, for the same reason ikPerf and xrPerf have one: silence from an
// instrument and silence from the thing it measures are indistinguishable otherwise, and this
// session has now lost two headset sessions to exactly that.
if (typeof window !== 'undefined') {
  window.hoverTrace = function (on) {
    window._hoverTrace = on !== false;
    console.log('[hover] ' + (window._hoverTrace ? 'ON' : 'off') +
      (window._hoverTrace ? ' — one line a second per visible panel, even if it saw no events.' : ''));
    return window._hoverTrace;
  };
}

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
    this._hostMounted = true; // whether our DOM is currently in the host canvas

    // Register for onpaint notifications.
    registerPanel(this);
  }

  // Mount/unmount our DOM in the shared host canvas. The polyfill re-rasterises
  // EVERY child of the host canvas on every paint (requestPaint dirties them all),
  // so keeping hidden panels out of it makes each paint proportional to what's
  // actually visible — a big saving when several panels are registered but hidden.
  _setHostMounted(want) {
    if (want === this._hostMounted) return;
    this._hostMounted = want;
    const host = getHostCanvas();
    if (want) {
      host.appendChild(this._element);
      // No forced _needsResize here — the panel's size is unchanged while hidden,
      // and forcing a resize disposes the texture (a blank frame = visible flash on
      // swap). syncFromState() sets _needsResize itself when content size changes.
      this.markDirty();
    } else {
      try { host.removeChild(this._element); } catch (_) {}
    }
  }

  dispose() {
    unregisterPanel(this);
    this.unbindDesktopPointers();
    if (this.mesh) {
      _gradeMats.delete(this.mesh.material);
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

    const _mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,  // write depth so the laser and scene geometry are properly
      depthTest: true,   // z-sorted against the panel — no draw-order tricks
    });
    _installGrade(_mat); // brightness/saturation/gamma grade from the Settings sliders
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this._meshWidth, meshH), _mat);
    // UI DRAWS AFTER THE WORLD. Depth testing still decides what is in front -- the flags above
    // are untouched, so a panel behind geometry is still hidden by it. This only fixes the
    // ORDER within the transparent pass, where the panel used to sit at 0 alongside the meshes.
    //
    // The ground grid's occluded pass is drawn with `depthFunc: GreaterDepth`, i.e. "show me
    // wherever something is NEARER than the grid" -- and a menu floating in front of the floor
    // is exactly that, so the floor was painted over the menu. A ghost cannot be told to make
    // an exception for the UI, so the UI is ordered after it. 1000 is the number VRMenu already
    // used for this, with the same reasoning.
    this.mesh.renderOrder = 1000;
    // scale.y = -1 compensates for flipY=false in the polyfill-rasterised texture.
    this.mesh.scale.y = -1;

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
    if (!this.mesh || !this._hostMounted) return; // unmounted (hidden) → no snapshot to capture
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
        // Clamp to edge so any sub-pixel mesh/texture size mismatch doesn't
        // show a thin repeat strip at the panel edges.
        this._texture.wrapS         = THREE.ClampToEdgeWrapping;
        this._texture.wrapT         = THREE.ClampToEdgeWrapping;
        this.mesh.material.map      = this._texture;
        this.mesh.material.needsUpdate = true;
      } else {
        this._texture.image      = bitmap;
        this._texture.needsUpdate = true;
      }
    } catch (e) {
      // "no snapshot recorded yet" on the very first frame — expected, ignore.
      // Log anything else so it shows in remote debugger + VR screenLog.
      if (e?.name !== 'InvalidStateError') {
        console.warn('[HTMLVRPanel] _onPaint unexpected error:', e?.message ?? e);
        if (!this._paintErrLogged) {
          this._paintErrLogged = true;
          if (window.screenLog) window.screenLog(`[Panel] paint err: ${e?.message ?? e}`, 'red');
        }
      }
    }
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Call once per frame.  Pass xrIsPresenting=true when inside an XR session.
   * Scene.js is responsible for calling drainRAF() once after all panel
   * updates — do not drain per-panel (that causes O(N²) rasterisations when
   * multiple panels are dirty in the same frame).
   */
  update(_xrIsPresenting) {
    if (!this.mesh) return;
    if (window._hoverTrace && this.mesh.visible) this._hoverTick();
    // Keep our host-canvas membership in sync with visibility — hidden panels are
    // unmounted so they don't get re-rasterised on every paint.
    this._setHostMounted(!!this.mesh.visible);
    if (!this._hostMounted) { this._dirty = false; return; }
    // Suppress panel rasterisation during an active slider drag.  The mesh
    // deformation (applyBlendshapes) still runs every frame so the user sees
    // the sculpt change in real time; the panel texture catching up 200 ms late
    // is imperceptible compared to the dropped-frame cost of SVG rasterising
    // (the polyfill re-serialises the *entire* host-canvas DOM tree) at 5 fps.
    // pointerup already calls requestPaintForced + clears _dirty, so the final
    // slider position appears exactly one frame after release.
    if (this._dirty && !this._sliderDragTarget) {
      // Clear dirty only if a paint was actually scheduled. If it was rate-limited away,
      // stay dirty and retry next frame — otherwise the change is lost until the next edit
      // (the bug behind "the menu freezes until you click the other one").
      // COUNTED, because "each paint is slow" and "we paint far too often" are the same
      // milliseconds and completely different fixes. The first needs the panels rewritten onto
      // canvas; the second needs whatever is marking them dirty to stop. xrPerf reports both
      // the count and the total, so one run tells you which.
      if (window._xrPerf) window._panelPaints = (window._panelPaints | 0) + 1;
      if (requestPaintOnce(getHostCanvas())) this._dirty = false;
    }
  }

  markDirty() {
    this._dirty = true;
    // A repaint usually means the markup was rebuilt, and the element the highlight is sized
    // to may no longer exist. Drop it rather than leave a quad over a gap.
    this._hoverEl = null;
  }

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

  // HOVER IS DRAWN IN 3D, NOT RASTERISED.
  //
  // A pointermove into the offscreen DOM changes CSS :hover, the polyfill's observer sees the
  // mutation, and the WHOLE PANEL re-rasterises — DOM to SVG to texture upload — for a
  // highlight. Crossing a row of buttons is one full repaint per button, which is what made
  // the controller feel like it was dragging through treacle: every one of those landed inside
  // a committed frame.
  //
  // So a plain hover no longer touches the DOM at all. The hit test already knows which
  // element the ray is on and where it is, so the highlight is a quad laid over that rect on
  // the panel's own plane. One draw call, no rasterisation, and the controller stops stalling.
  //
  // A DRAG still dispatches, because a slider genuinely needs the DOM to move. That path was
  // already suppressing rasterisation for the same reason, on the same argument.
  onVRMove(uv, hand, rayOrigin) {
    if (!this.mesh) return;
    if (window._hoverTrace) this._hoverStat(uv, hand, rayOrigin);
    if (this._sliderDragTarget) { this._vrDispatch('pointermove', uv, 0, true); return; }
    this._hoverHand = hand;
    this._lastUV = uv;          // where the ray is, for onVRScroll to decide WHAT to scroll
    this._showHover(uv);
  }

  // WHAT THE UV IS ACTUALLY DOING, summarised once a second rather than logged per frame — at
  // 70Hz a line per event is unreadable and changes the timing it is reporting.
  //
  // matt's description is that a fraction of a millimetre of hand movement produces a large
  // jump, "as if micromotions are translated into large motions", and that holding perfectly
  // still locks onto one element. That is a testable claim: if the uv is genuinely jumping
  // then the SPREAD per second will be large while the hand is nearly still, and the count of
  // distinct elements will be high. If instead the uv is steady and the ELEMENT still changes,
  // the fault is in the walk that turns a uv into an element, not in the uv at all.
  //
  // Both hands are counted separately, because "two sources disagreeing" and "one source that
  // is noisy" look identical in a merged number and have nothing else in common.
  _hoverStat(uv, hand, rayOrigin) {
    const st = this._hoverStats || (this._hoverStats = { at: 0 });
    const key = hand || 'none';
    const h = st[key] || (st[key] = { n: 0, minX: 9, maxX: -9, minY: 9, maxY: -9, els: new Set(),
      last: null, jump: 0, lastO: null, oJump: 0, pJump: 0, lastP: null });
    h.n++;
    h.minX = Math.min(h.minX, uv.x); h.maxX = Math.max(h.maxX, uv.x);
    h.minY = Math.min(h.minY, uv.y); h.maxY = Math.max(h.maxY, uv.y);
    if (h.last) h.jump = Math.max(h.jump, Math.abs(uv.x - h.last.x) + Math.abs(uv.y - h.last.y));
    h.last = { x: uv.x, y: uv.y };

    // THE TWO THINGS THAT COULD BE MOVING, measured separately. A uv jump can come from the RAY
    // swinging or from the PANEL swinging, and the fixes have nothing in common — so record how
    // far each moved between frames, in metres, alongside the uv jump they produced.
    //
    // Steady ray, steady panel, jumping uv means neither is moving and the intersection maths is
    // reading something else. A jumping ray means the pose is noisy upstream. A jumping panel
    // means the thing it is carried by is.
    if (rayOrigin) {
      if (h.lastO) {
        h.oJump = Math.max(h.oJump, Math.abs(rayOrigin.x - h.lastO.x)
          + Math.abs(rayOrigin.y - h.lastO.y) + Math.abs(rayOrigin.z - h.lastO.z));
      }
      h.lastO = { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z };
    }
    const mw = this.mesh.matrixWorld.elements;
    if (h.lastP) {
      h.pJump = Math.max(h.pJump, Math.abs(mw[12] - h.lastP.x)
        + Math.abs(mw[13] - h.lastP.y) + Math.abs(mw[14] - h.lastP.z));
    }
    h.lastP = { x: mw[12], y: mw[13], z: mw[14] };
    const t = this._hoverable(this._uvToElement(uv).el);
    h.els.add(t ? (t.id || t.className || t.tagName) : '(none)');

  }

  // TICKED FROM update(), NOT FROM THE EVENT. Reporting from inside onVRMove means silence when
  // onVRMove never fires — and then "the hover code is not running" is indistinguishable from
  // "this build does not have the hover code". That exact mistake was made and fixed once
  // already this session, on the solver counter, and then repeated here.
  //
  // Ticking from update() makes ZERO EVENTS a finding rather than an absence: if the panel is
  // visible, the ray is on it, and this prints "0 events", then the dispatch is not arriving —
  // which is worth more than any uv statistic.
  _hoverTick() {
    const st = this._hoverStats || (this._hoverStats = { at: 0 });
    const now = performance.now();
    if (!st.at) { st.at = now; return; }
    if (now - st.at < 1000) return;
    st.at = now;

    const hands = Object.keys(st).filter((k) => k !== 'at');
    const who = (this.constructor && this.constructor.name) || 'panel';
    if (!hands.length) {
      console.log('[hover] ' + who + ': 0 events — nothing is calling onVRMove on this panel');
      return;
    }
    for (const k of hands) {
      const d = st[k];
      console.log('[hover] ' + who + ' ' + k + ': ' + d.n + ' events, uv x ' +
        d.minX.toFixed(3) + '-' + d.maxX.toFixed(3) + ' y ' + d.minY.toFixed(3) + '-' + d.maxY.toFixed(3) +
        ' | uv jump ' + d.jump.toFixed(4) +
        ' | ray moved ' + d.oJump.toFixed(4) + 'm, panel moved ' + d.pJump.toFixed(4) + 'm' +
        ' | ' + d.els.size + ' distinct: ' + [...d.els].slice(0, 6).join(' / '));
      delete st[k];
    }
  }
  onVRPress(uv)   { if (this.mesh) this._vrDispatch('pointerdown', uv, 1, true); }
  onVRRelease(uv) { if (this.mesh) this._vrDispatch('pointerup',   uv, 0, true); }

  /**
   * Scroll the panel's first overflow-y scrollable descendant by `deltaPx`.
   * Positive delta scrolls down.  Called from Scene.js thumbstick handler.
   */
  onVRScroll(deltaPx) {
    if (!this.mesh || !this._element) return;
    // WHAT IS UNDER THE RAY DECIDES WHAT MOVES. The panel used to have exactly one scroll
    // surface, so "the panel's scrollable" was the same answer as "the one you are pointing
    // at". The outliner now scrolls on its own, and with a single answer the thumbstick moved
    // the panel underneath a list that stayed put. So: nearest scrollable ANCESTOR of the
    // element under the ray, which is the outliner when you are in it and the panel body when
    // you are anywhere else. _scrollClipEl only accepts a container that actually overflows,
    // so a short outliner falls straight through to the panel rather than eating the input.
    const at = this._lastUV ? this._uvToElement(this._lastUV).el : null;
    const el = (at && this._scrollClipEl(at)) || this._findScrollable(this._element);
    if (!el) return;
    // Move the scroll position immediately (keeps the DOM/hit-test correct), but
    // THROTTLE the expensive re-rasterisation during a continuous scroll so it
    // doesn't tank the VR framerate. A debounced "final" repaint snaps the texture
    // sharp once scrolling stops.
    el.scrollTop = Math.max(0, el.scrollTop + deltaPx);
    // Update the custom scrollbar thumb directly — the panels wire it to the DOM
    // 'scroll' event, which doesn't fire for this offscreen programmatic scroll.
    this._updateScrollThumb(el);
    const now = performance.now();
    if (now - (this._scrollRasterTs || 0) > 300) {
      this._scrollRasterTs = now;
      this.markDirty();
    }
    clearTimeout(this._scrollStopTimer);
    this._scrollStopTimer = setTimeout(() => { this.markDirty(); }, 150);
  }

  // Position the custom scrollbar thumb to reflect a scroll container's position.
  _updateScrollThumb(scrollEl) {
    // The thumb belonging to THIS container — its own, when it has one (the outliner carries a
    // track inside its wrapper), otherwise the panel's. A blind panel-wide query moved the
    // panel's thumb while the outliner scrolled, which reads as the scroll going astray.
    const thumb = (scrollEl.parentElement
                   && scrollEl.parentElement.querySelector(':scope > .mm-scrollbar-track > .mm-scrollbar-thumb'))
                  || this._element.querySelector('.mm-scrollbar-thumb');
    if (!thumb || !scrollEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    if (scrollHeight > clientHeight) {
      thumb.style.display = '';
      const thumbH = Math.max(32, (clientHeight / scrollHeight) * clientHeight);
      const ratio  = scrollTop / (scrollHeight - clientHeight);
      thumb.style.height = thumbH + 'px';
      thumb.style.top    = Math.round(ratio * (clientHeight - thumbH)) + 'px';
    } else {
      thumb.style.display = 'none';
    }
  }

  _findScrollable(root) {
    // BFS — return the OUTERMOST (shallowest) overflow:auto/scroll element, i.e. the
    // panel's own scroll body. Thumbstick scroll should move the whole panel, not a
    // nested list (e.g. the outliner's .mm-outliner-list), which would otherwise win
    // as the deepest match and leave the controls below it unreachable.
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      if (node !== root) {
        const style = getComputedStyle(node);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return node;
        }
      }
      for (let i = 0; i < node.children.length; i++) queue.push(node.children[i]);
    }
    return null;
  }

  onVRLeave(hand) {
    // ONLY THE HAND THAT WAS HOVERING MAY END THE HOVER.
    //
    // Scene runs its dispatch once per CONTROLLER. The hand pointing at this panel calls
    // onVRMove, and the other hand — whose winner is some other panel, or none — calls
    // onVRLeave on this one. Every frame. Set, then cleared, then set again: the highlight
    // flickered across every panel on screen and looked like a hit-test fault.
    //
    // A leave with no hand named is a real teardown (panel hidden, session ended) and still
    // clears, so nothing can be left lit by a panel that has gone away.
    if (hand === undefined || hand === this._hoverHand) this.clearHover();
    if (this._hoveredBtn) {
      this._hoveredBtn.classList.remove('hover'); // never strip .active — it may be the selection state
      this._hoveredBtn = null;
    }
    // End any in-progress drag when the ray leaves — otherwise an overshot release
    // (or a release while the numpad is open) leaves _sliderDragTarget stuck, which
    // suppresses repaint (update() skips paint while dragging) and captures input.
    if (this._sliderDragTarget) { this._sliderDragTarget = null; this.markDirty(); }
    if (this._scrollDrag) this._scrollDrag = null;
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
      // Desktop panel interaction is mouse-only. Pen (Apple Pencil) and touch
      // events must not go through the VR panel raycast path — doing so causes
      // setPointerCapture + synthetic PointerEvent dispatch that fight with the
      // sculpt pointer handler on iPad.
      if (e.pointerType !== 'mouse') return;
      if (renderer.xr.isPresenting || !this.mesh?.visible || window._htmlvrOverlayOpen) return;
      this._screenToRay(e.clientX, e.clientY, camera);
      const hits = this._raycaster.intersectObject(this.mesh);
      if (hits.length) {
        e.target.setPointerCapture?.(e.pointerId);
        this._vrDispatch('pointerdown', hits[0].uv, 1);
      }
    };

    this._desktopPointerMove = (e) => {
      if (e.pointerType !== 'mouse') return;
      if (renderer.xr.isPresenting || !this.mesh?.visible || window._htmlvrOverlayOpen) return;
      this._screenToRay(e.clientX, e.clientY, camera);
      const hits = this._raycaster.intersectObject(this.mesh);
      if (hits.length) {
        this._vrDispatch('pointermove', hits[0].uv, 0);
      } else if (this._sliderDragTarget) {
        this._updateSliderFromScreenX(e.clientX);
      }
    };

    this._desktopPointerUp = (e) => {
      if (e.pointerType !== 'mouse') return;
      if (renderer.xr.isPresenting || !this.mesh?.visible || window._htmlvrOverlayOpen) return;
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

  // The highlight quad, made once per panel and parented to it so it inherits the panel's
  // transform — a panel that is grabbed and moved takes its hover with it for free.
  _hoverMesh() {
    if (this._hoverQuad) return this._hoverQuad;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.16,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
    m.renderOrder = (this.mesh.renderOrder || 0) + 1;
    m.frustumCulled = false;
    m.visible = false;

    // INVISIBLE TO RAYCASTS, and this is not belt-and-braces — it is the whole bug.
    //
    // three's Raycaster.intersectObject defaults to recursive = TRUE, so every hit test against
    // a panel also tests this quad. It is a child of the panel and sits 1mm in FRONT of it, so
    // it wins the hit outright, and the returned uv is the quad's own 0-1 across a button-sized
    // rectangle rather than the panel's across the whole panel. That uv resolves to some
    // unrelated element, which moves the quad, which changes the next hit — a feedback loop
    // that walks the buttons in order, at frame rate, from a completely stationary hand.
    //
    // matt described it as "cycling through all the button elements in order", which is what a
    // feedback loop looks like from the outside and is what named it. The trace confirmed it:
    // ray moved 0.0002m, panel moved 0.0003m, uv jump 0.2537 — neither the ray nor the panel
    // was moving, so the intersection had to be reading something that was.
    //
    // isPickable = false does NOT do this. That is a SculptXR convention its own picking code
    // honours; three's raycaster has never heard of it. Overriding raycast is the three way,
    // and it applies to anything ever parented to a panel mesh, not just this quad.
    m.raycast = () => {};
    m.isPickable = false;
    this.mesh.add(m);
    this._hoverQuad = m;
    return m;
  }

  // Only things you can actually press get a highlight. Without this the quad lands on
  // whatever container happened to be under the ray, which reads as a random rectangle
  // appearing over the panel rather than as "this is the thing you would click".
  _hoverable(el) {
    const root = this._element;
    for (let n = el; n && n !== root; n = n.parentElement) {
      if (n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'SELECT'
          || n.getAttribute?.('role') === 'button' || n.dataset?.hover === '1') return n;
    }
    return null;
  }

  // THE HOVER QUAD KNOWS WHAT IS UNDER THE RAY; THE DOM DOES NOT.
  //
  // Hover stopped being a DOM event on purpose — dispatching pointermove into the offscreen DOM
  // changes CSS :hover, which repaints the whole panel, which is what made the menus lag. The
  // quad replaced all of that. But it also means anything that wants to know what is hovered
  // can no longer listen for a pointer event, because there is not one: matt's outliner-row
  // highlight never fired, and could not have.
  //
  // So the quad announces it instead. A CustomEvent does not touch :hover and does not repaint
  // anything, so the reason the quad exists survives — this just stops the knowledge being
  // trapped inside it.
  _announceHover(next, prev) {
    if (next === prev) return;
    try {
      if (prev) prev.dispatchEvent(new CustomEvent('vrhoverout', { bubbles: true }));
      if (next) next.dispatchEvent(new CustomEvent('vrhover', { bubbles: true }));
    } catch (_) { /* an overlay mid-teardown is not worth taking the frame down for */ }
  }

  _showHover(uv) {
    const q = this._hoverMesh();
    const { el } = this._uvToElement(uv);
    const target = this._hoverable(el);
    if (!target) {
      this._announceHover(null, this._hoverEl);
      q.visible = false; this._hoverEl = null; return;
    }
    // Re-measure when the panel has SCROLLED even though the element is the same: the row is
    // under the ray at a different place than it was, and skipping the measure would leave the
    // highlight behind at the old position.
    const scrolled = this._hoverScrollTop !== this._scrollTopOf(target);
    if (target === this._hoverEl && !scrolled) { q.visible = true; return; }
    this._announceHover(target, this._hoverEl);
    this._hoverScrollTop = this._scrollTopOf(target);
    this._hoverEl = target;

    const panelRect = this._element.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (!panelRect.width || !panelRect.height) { q.visible = false; return; }

    // CLIPPED TO WHAT IS ACTUALLY ON SCREEN. A tall panel scrolls, and getBoundingClientRect
    // happily reports an element that has scrolled out of its container — so without this the
    // highlight lands beyond the end of the panel, floating in the air next to it. Clipping to
    // the scroll container also gives the half-scrolled case for free: a button crossing the
    // boundary gets a highlight cut off at exactly the same line the button is.
    const clip = this._scrollClipRect(target) || panelRect;
    const top = Math.max(r.top, clip.top, panelRect.top);
    const bot = Math.min(r.bottom, clip.bottom, panelRect.bottom);
    const left = Math.max(r.left, clip.left, panelRect.left);
    const right = Math.min(r.right, clip.right, panelRect.right);
    if (bot - top <= 0.5 || right - left <= 0.5) { q.visible = false; return; }

    const meshH = this._meshWidth * (panelRect.height / panelRect.width);
    // The panel's texture is mapped without inversion (see the UV note in the class header), so
    // DOM-down and plane-up already agree here. Negating this is the obvious-looking thing and
    // it is wrong: it puts every highlight on the mirrored row, which looks plausible enough
    // that a check asserting it passed for a whole version.
    const cx = (left - panelRect.left + (right - left) / 2) / panelRect.width;
    const cy = (top - panelRect.top + (bot - top) / 2) / panelRect.height;
    q.scale.set(this._meshWidth * ((right - left) / panelRect.width),
                meshH * ((bot - top) / panelRect.height), 1);
    q.position.set((cx - 0.5) * this._meshWidth, (cy - 0.5) * meshH, 0.001);
    q.visible = true;
  }

  // The nearest ancestor that actually scrolls, as a rect. Null when nothing does, in which
  // case the panel's own bounds are the only clip needed.
  _scrollClipRect(el) {
    const c = this._scrollClipEl(el);
    return c ? c.getBoundingClientRect() : null;
  }

  _scrollTopOf(el) {
    const c = this._scrollClipEl(el);
    return c ? c.scrollTop : 0;
  }

  _scrollClipEl(el) {
    const root = this._element;
    for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
      const st = n.ownerDocument?.defaultView?.getComputedStyle?.(n);
      if (!st) continue;
      const oy = st.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  }

  clearHover() {
    if (this._hoverQuad) this._hoverQuad.visible = false;
    // Tell whoever was listening: the ray has left, and a highlight that outlives the thing
    // pointing at it is worse than no highlight.
    this._announceHover(null, this._hoverEl);
    this._hoverEl = null;
    this._hoverHand = undefined;
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

  _vrDispatch(type, uv, buttons, isVR = false) {
    if (!this.mesh) return;
    const { el, absX, absY } = this._uvToElement(uv);

    // Slider drag: walk() may return the parent row if the thin track isn't hit.
    //
    // ...BUT ONLY A SLIDER ON THE ROW YOU PRESSED. The fallback used to search the whole
    // SUBTREE of whatever element was hit, and walk() returns a big ancestor whenever the point
    // lands in padding or a gap between children -- so pressing empty space anywhere in the
    // bone panel found the FIRST range in the entire panel and started dragging it. matt: "the
    // earlier capsule slider keeps stealing focus, even though its at least 4 button rows
    // away." Which is exactly what "first slider in the subtree" means from the outside.
    //
    // Two conditions now: the search is limited to the nearest ROW, and the slider it finds has
    // to be vertically under the ray. A row has one slider, so this can only ever grab the one
    // you are pointing at.
    if (type === 'pointerdown') {
      let rangeEl = null;
      if (el.tagName === 'INPUT' && el.type === 'range') {
        rangeEl = el;
      } else {
        const row = el.closest?.('.mp-row, .mm-row, .acp-row, [data-row]') || null;
        const cand = row ? row.querySelector('input[type=range]') : null;
        if (cand) {
          const r = cand.getBoundingClientRect();
          // Generous vertically -- the track is a few px tall and the point of this branch is
          // to catch a press that MISSED it -- but bounded by the row, not by the panel.
          const pad = Math.max(10, r.height);
          if (absY >= r.top - pad && absY <= r.bottom + pad) rangeEl = cand;
        }
      }
      if (rangeEl) this._sliderDragTarget = rangeEl;
    }
    if (type === 'pointerup') this._sliderDragTarget = null;

    const drag = this._sliderDragTarget;
    if (drag && (type === 'pointerdown' || type === 'pointermove')) {
      drag.value = this._sliderValueFromAbsX(drag, absX);
      drag.dispatchEvent(new Event('input', { bubbles: true }));
      // On pointermove, we've fully handled the slider — return early so the
      // PointerEvent below never fires.  If it did, setupRangeDrag's pointermove
      // listener would call applyBlendshapes a second time per frame, doubling
      // the vertex computation + GPU upload cost.
      if (type === 'pointermove') return;
    }

    // Custom scrollbar drag — the thumb/track use pointer-capture which _vrDispatch
    // doesn't honour, so scroll directly from the ray's Y over the track.
    if (type === 'pointerdown') {
      const sbThumb = el.closest?.('.mm-scrollbar-thumb');
      const sbTrack = (sbThumb && sbThumb.closest('.mm-scrollbar-track')) || el.closest?.('.mm-scrollbar-track');
      if (sbTrack) {
        const scrollEl = this._findScrollable(this._element);
        if (scrollEl) this._scrollDrag = { track: sbTrack, scrollEl };
      }
    }
    if (type === 'pointerup' && this._scrollDrag) { this._scrollDrag = null; this.markDirty(); }
    if (this._scrollDrag && (type === 'pointerdown' || type === 'pointermove')) {
      const { track, scrollEl } = this._scrollDrag;
      const tr = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (absY - tr.top) / Math.max(1, tr.height)));
      scrollEl.scrollTop = ratio * Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      this._updateScrollThumb(scrollEl);
      const now = performance.now();
      if (now - (this._scrollRasterTs || 0) > 120) { this._scrollRasterTs = now; this.markDirty(); }
      if (type === 'pointermove') return;
    }

    // Button hover/active visual state — track whether anything visual changed.
    let changed = (type === 'pointerdown' || type === 'pointerup');
    const btn = el.closest('button');
    if (btn !== this._hoveredBtn) {
      this._hoveredBtn?.classList.remove('hover');
      if (!isVR) this._hoveredBtn?.classList.remove('active'); // desktop: clear press state
      this._hoveredBtn = btn;
      btn?.classList.add('hover');
      changed = true;
    }
    // Desktop only: transient press-state highlight.
    // In VR, click fires on pointerdown which can rebuild the DOM; we must not
    // clobber the newly-set selection .active class on the rebuilt element.
    if (!isVR) {
      if (type === 'pointerdown' && btn) btn.classList.add('active');
      if (type === 'pointerup'   && btn) btn.classList.remove('active');
    }

    const target = drag || el;

    // Skip DOM pointermove dispatch when nothing visual changed and no drag is
    // active.  Dispatching pointermove unconditionally causes the browser to
    // synthesize pointerover/pointerout events as the UV crosses element
    // boundaries, which activates CSS :hover rules, which the polyfill detects
    // and responds to by calling requestPaint() from its own internal observer —
    // bypassing our requestPaintOnce dedup and triggering a full rasterisation
    // every XR frame.  pointerdown/pointerup always dispatch so click targets fire.
    if (type !== 'pointermove' || changed || drag) {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 1, pointerType: 'mouse',
        clientX: absX, clientY: absY, buttons,
      }));
    }

    // VR: fire click immediately on pointerdown (at the ~10% threshold moment, before aim drifts).
    // Desktop: fire click on pointerup — standard mouse press-release semantics.
    if (isVR && type === 'pointerdown' && !drag) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: absX, clientY: absY }));
    } else if (!isVR && type === 'pointerup') {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: absX, clientY: absY }));
    }

    if (type === 'pointerdown' || type === 'pointerup') {
      // Immediate repaint for press/release — bypasses rate limit so active/hover
      // class changes appear on the frame the user clicks, not 200ms later.
      requestPaintForced(getHostCanvas());
      this._dirty = false; // consumed by force paint
    } else if (changed || drag) {
      this.markDirty();
    }
  }
}
