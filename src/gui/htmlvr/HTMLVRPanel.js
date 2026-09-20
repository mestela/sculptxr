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
import { getHostCanvas, registerPanel, unregisterPanel, drainRAF, requestPaintOnce, requestPaintScoped, requestPaintForced, markAllPanelsDirty, notePanelDirty } from './install.js';
import getOptionsURL from '../../misc/getOptionsURL.js';

// ── Menu color grade (brightness / saturation) ──────────────────────────────
// Applied on the GPU to the rasterised panel texture (a brightness multiply + a
// saturation mix around luminance, injected into every panel material), so it costs
// nothing to change — no re-rasterise. Restores the Settings menu brightness/saturation
// sliders that did this in the old canvas GUI (GuiXR.parseColor). Slider values are 0..1
// with 0.5 = neutral; the mapping below matches the legacy behaviour exactly.
// Is this rasterisation empty? An 8x8 draw and the mean alpha of the 64 pixels, which is enough
// to tell "nothing on it" from "a panel". Used only on the paint that would discard a good
// texture; a panel whose content really is blank simply keeps the last frame for one more paint.
let _blankCanvas = null, _blankCtx = null;
function _bitmapIsBlank(bitmap) {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    if (!_blankCanvas) {
      _blankCanvas = new OffscreenCanvas(8, 8);
      _blankCtx = _blankCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!_blankCtx) return false;
    _blankCtx.clearRect(0, 0, 8, 8);
    _blankCtx.drawImage(bitmap, 0, 0, 8, 8);
    const d = _blankCtx.getImageData(0, 0, 8, 8).data;
    let a = 0;
    for (let i = 3; i < d.length; i += 4) a += d[i];
    return (a / 64) < 8;
  } catch (_) {
    return false;   // never let the check itself cost a frame or a texture
  }
}

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
// Above the rig overlay (9996..10002 in Skeleton) and everything else in the scene: a panel is
// UI and nothing in the world should paint over it.
export const VR_PANEL_RENDER_ORDER = 11000;

// MODAL OVERLAYS NEED THEIR OWN BAND, BECAUSE A TIE IS NOT AN ORDER.
//
// Every panel shared VR_PANEL_RENDER_ORDER, so a keyboard and the dialog it is serving tied —
// and three resolves a tie by traversal order, which is effectively the order things happened to
// be added. The keyboard came up BEHIND the browser-save dialog it exists to type into.
//
// Everything here is transparent, so renderOrder is the only lever (there is no depth to fall
// back on). A panel that is summoned BY another panel is by definition in front of it.
//
// THE LADDER, so the next addition does not collide by accident. All relative to this constant:
//   +0  ordinary panels
//   +1  panel-attached furniture (hover quad, resize handle)
//   +2  MODAL OVERLAYS  (keyboard, numpad, confirm)  <- this constant
//   +3  gaze menu button
//   +4  radius preview sphere
//   +5  pointer ray / timeline laser      (pre-existing)
//   +7  fingertip dots
//   +8  ray reticle — the pointer is the top, or it vanishes when aim matters most
//
// 2 rather than a larger number on purpose: the pointer ray already sits at +5, and a modal
// above IT would hide the ray you are aiming with inside the keyboard you are aiming at.
export const VR_MODAL_ORDER_BUMP = 2;

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

// THE Rz(180) COMPENSATION, CONDITIONAL ON THE SCALE THAT CAUSES IT.
//
// Panel meshes normally carry scale.y = -1, and a negative scale makes getWorldQuaternion come
// back with a spurious half turn about Z. Three separate panels — keyboard, numpad, confirm —
// each undid that with a hardcoded multiply, which was correct exactly as long as EVERY panel
// always had that scale.
//
// It stopped being true: the hands-only wrist slot normalises scale to 1 (the placement was
// measured under a decompose, which writes scale, so it only means what it measured with a unit
// scale). The hardcoded undo then introduced the very flip it exists to remove, and the keyboard
// came up upside down. Reading the scale instead of assuming it is correct under both.
// SUPERSEDED BY matchPanelTransform, BECAUSE THE AXIS WAS NEVER THE POINT.
//
// This tested `scale.y < 0`, and so did the mirror-sign copy that each of the keyboard, numpad and
// confirm carried beside it. All four were wrong in the same way: three's Matrix4.decompose folds a
// negative determinant into *sx* by convention, so a panel PLACED by decomposing a matrix comes out
// (-1, 1, 1) rather than (1, -1, 1). Same mirror, different axis, every guard blind to it.
//
// Measured on a pinned main menu: panelScale [-1.0000000224, 0.9999999676, 0.9999999822], and the
// "corrected" quaternion identical to the raw one because no branch fired. matt: "keyboard is drawn
// facing the wrong way, so its mirrored left to right."
//
// Kept only so nothing outside this file breaks on the name; there are no callers left in it.
export function panelWorldQuat(mesh, out) {
  const q = out || new THREE.Quaternion();
  mesh.getWorldQuaternion(q);
  const sy = mesh.scale ? mesh.scale.y : 1;
  if (sy < 0) q.multiply(new THREE.Quaternion(0, 0, 1, 0));
  return q;
}

// MAKE `mesh` SIT THE WAY `panelMesh` SITS -- rotation AND mirror, whichever axis carries it.
//
// The keyboard, the numpad and the confirm dialog are all HTMLVRPanels positioned against another
// HTMLVRPanel, and all three had their own copy of "undo the half turn, then match the mirror
// sign", written against `scale.y`. Three copies of one rule is three chances to be wrong, and
// they were all wrong together.
//
// There is no case analysis to get right: decompose the source's WORLD matrix and take its
// rotation and its scale SIGNS. A transform that renders the source correctly renders the same
// kind of object correctly, in any convention and on any axis. Signs are applied to the target's
// OWN magnitudes, since these panels size themselves from their geometry and a source panel is
// free to be scaled.
//
// Returns the quaternion, because every caller also wants the panel's own axes to offset along.
const _mptQ = new THREE.Quaternion();
const _mptS = new THREE.Vector3();
const _mptP = new THREE.Vector3();
export function matchPanelTransform(mesh, panelMesh, out) {
  const q = out || new THREE.Quaternion();
  panelMesh.updateMatrixWorld(true);
  panelMesh.matrixWorld.decompose(_mptP, _mptQ, _mptS);
  q.copy(_mptQ);
  if (mesh && mesh.scale) {
    const sgn = (v) => (v < 0 ? -1 : 1);
    mesh.scale.set(Math.abs(mesh.scale.x) * sgn(_mptS.x),
                   Math.abs(mesh.scale.y) * sgn(_mptS.y),
                   Math.abs(mesh.scale.z) * sgn(_mptS.z));
  }
  return q;
}

// "IN FRONT OF A PANEL" MEANS ALONG ITS NORMAL, ON THE SIDE YOU ARE ON.
//
// Two overlays float over a panel and each solved this differently. The keyboard steps from the
// panel centre TOWARD THE HEAD; the numpad, which sits beside the edited field rather than on top
// of it, instead set its DISTANCE FROM THE HEAD to the panel's minus a centimetre. Neither is
// clearance from the panel, and the numpad's is not even monotonic in it.
//
// A point offset sideways by s on a panel facing you is sqrt(d^2 + s^2) from your head, so pulling
// it to d - gap leaves it barely proud of the plane -- about 13mm for a 6cm offset at half a metre,
// which reads as coplanar. Pitch the panel and the same rule yields something else entirely.
// matt: "between making the panel face me, to facing the floor, the numpad is coplanar with the
// parent panel. between facing me to making it face the sky, the offset raises from 0 to a given,
// probably correct, offset."
//
// The normal is the answer, and the only thing the viewer is needed for is the SIGN -- a wrist
// panel's +Z can point away from you, which is what the keyboard's toward-the-head rule was
// working around. Signed normal x gap gives the same clearance at every pitch, on either side,
// however far to the side the overlay has been placed.
const _fopN = new THREE.Vector3();
const _fopV = new THREE.Vector3();
export function frontOfPanelOffset(panelQuat, panelWorldPos, viewerPos, gap, out) {
  const o = out || new THREE.Vector3();
  _fopN.set(0, 0, 1).applyQuaternion(panelQuat);
  if (viewerPos) {
    _fopV.copy(viewerPos).sub(panelWorldPos);
    if (_fopN.dot(_fopV) < 0) _fopN.negate();
  }
  return o.copy(_fopN).multiplyScalar(gap);
}

// THE PITCH THAT LIES THE PANEL FLAT AGAINST THE CONTROLLER.
//
// Every wrist panel is CONSTRUCTED with rotation (-90, yaw, 0) — the -90 about X is what turns
// the panel from standing upright to lying back along the controller, the way a watch face lies
// on a wrist. It lived only in the three panels' constructors, so the wrist slot in Scene could
// re-impose position and yaw each frame without ever knowing about it.
//
// That worked while the slot wrote only the components it owned (`position.y`, `rotation.y`).
// When it started writing whole vectors — to reset everything the hands slot writes — it wiped
// the pitch on every frame, and the panels turned to face the floor. matt: "normaly the menus
// rest mostly flat to the back of the controllers. now they slice right through them."
//
// So it is a shared constant now, read by the constructors AND by the slot, rather than a
// number that exists in three places and is known to none of the code that overwrites it.
export const WRIST_PANEL_PITCH = -Math.PI / 2;

export function wristPanelPitch() {
  const live = window._wristPanelPitch;
  return Number.isFinite(live) ? live : WRIST_PANEL_PITCH;
}

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

// THE RASTERISER SIZES ITS CANVAS FROM THE *CLIENT* BOX, NOT THE BORDER BOX.
//
// The polyfill's own line is `const o = t.clientWidth || t.offsetWidth, n = t.clientHeight ||
// t.offsetHeight`, and it builds an SVG that size with the cloned element placed at 0,0 inside
// it. clientWidth/Height exclude the border, so a panel with a 2px border hands the rasteriser
// a viewport 4px shorter and narrower than the element being drawn into it — and the bottom and
// right of the content fall outside it and are cut. The plane, meanwhile, was built from
// offsetWidth/offsetHeight, so it was a slightly different shape from the bitmap it carries and
// stretched whatever survived. matt saw both at once, by different amounts on each runtime:
// "on avp the mainpanel is being clipped at the bottom by around 8-10 pixels... on gxr the
// mainpanel is clipped by about 2 pixels".
//
// So every plane is measured with the same expression the rasteriser uses. The borders on the
// panel roots are inset shadows now (see MainMenuPanel/MiniPanel) so there is nothing outside
// the client box to lose in the first place; this keeps the plane honest for any panel that
// still has a real one.
export function panelPixelSize(el, fallbackW, fallbackH) {
  const w = el.clientWidth  || el.offsetWidth  || fallbackW;
  const h = el.clientHeight || el.offsetHeight || fallbackH;
  return { w, h };
}

export class HTMLVRPanel {
  // EVERY LIVE PANEL, so a probe can ask them questions from the console. The panels do not
  // draw at all under ?renderer=webgpu and there is no desktop preview of them, so the only
  // way to find out why is to ask on the device -- and per the diagnostics rule that answer
  // has to land in the console, where it can be copied out of a headset.
  static _live = new Set();

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
    this._suspectBlank = true;   // a re-layout: the next capture may be of a stale region
    if (want) {
      host.appendChild(this._element);
      // No forced _needsResize here — the panel's size is unchanged while hidden,
      // and forcing a resize disposes the texture (a blank frame = visible flash on
      // swap). syncFromState() sets _needsResize itself when content size changes.
      //
      // ...EXCEPT THAT IT DOES NOT ALWAYS, so the claim above is CHECKED ONCE on the way in.
      // Grab's MiniPanel is rebuilt while hidden — it is the tool whose content depends on state
      // that moves outside the show cycle (bound skin, pin count, RigPending) and the one the
      // animation timeline selects on its own — so its flag is raised and spent before there is
      // an element to measure, and it arrives showing the previous tool's plane under the new
      // tool's texture. See _checkPlaneAspect.
      this._checkAspectOnce = true;
      this.markDirty();
    } else {
      try { host.removeChild(this._element); } catch (_) {}
    }
    // ...AND EVERY OTHER PANEL, because this just moved them. They are block elements in one
    // shared flow, and a re-mount appends rather than restoring position, so both directions of
    // this reorder the host canvas. See markAllPanelsDirty.
    markAllPanelsDirty(this);
  }

  // Compare the plane against the element and raise `_needsResize` if they disagree — armed by
  // _setHostMounted, spent on the first frame the element is real. Only on a genuine mismatch,
  // because a forced resize disposes the texture and a blank frame is a visible flash on swap.
  // Setting the FLAG rather than resizing directly is deliberate: the resize path also disposes
  // the wrongly-sized texture and re-requests the paint, and doing only the plane leaves the
  // other two half-done.
  _checkPlaneAspect() {
    if (!this._checkAspectOnce) return;
    if (!this.mesh?.visible || !this._hostMounted) return;
    const el = this._element;
    if (!el.offsetWidth || !el.offsetHeight) return;   // not laid out yet: try again next frame
    this._checkAspectOnce = false;
    const gp = this.mesh.geometry?.parameters;
    if (!gp) return;
    // Same box the plane was built from, or this check disagrees with itself on any panel
    // whose root has a border and asks for a resize every time it is mounted.
    const _px  = panelPixelSize(el, 1, 1);
    const domA = _px.w / _px.h;
    const geoA = gp.width / gp.height;
    if (Math.abs(domA - geoA) > geoA * 0.01) { this._needsResize = true; this.markDirty(); }
  }

  // THE PANEL CAN CHANGE ITS OWN SIZE, AND UNTIL COLLAPSIBLE SECTIONS NOTHING DID.
  //
  // _checkAspectOnce is armed by _setHostMounted only, on the reasoning written above it: "a
  // panel that changes its own content already raises the flag correctly". That was true while
  // every content change went through a rebuild, which sets _needsResize itself. A collapsible
  // section is the first control that changes the panel's HEIGHT without one -- it toggles a
  // class, repaints, and nothing measures anything. The wrist panel's root is height:auto, so
  // opening Physics grew it 478 -> 510px while the plane kept the old aspect: the texture was
  // stretched onto the wrong-shaped quad and every UV after it resolved to the wrong row. From
  // the outside that reads as "the collapsible does not work".
  //
  // ARMS THE MEASUREMENT, DOES NOT FORCE THE RESIZE. Setting _needsResize directly would dispose
  // the texture on every toggle -- a blank frame, and a flash -- including on the fixed-height
  // panels where the size did not actually change. _checkPlaneAspect measures first and only
  // raises the flag on a genuine mismatch, which is the same one-shot it does on a mount, and
  // deliberately not the per-frame check that froze the main menu (see update()).
  noteContentResized() { this._checkAspectOnce = true; this.markDirty(); }

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
    const { w, h } = panelPixelSize(el, 540, 300);
    const aspect = w / h;
    const meshH  = this._meshWidth / aspect;

    // A MODAL MUST NOT BE Z-SORTED AGAINST THE PANEL THAT SUMMONED IT.
    //
    // Ordinary panels depth-test on purpose (see the note below): a panel behind geometry should
    // be hidden by it. But that is also why raising the keyboard's renderOrder did not bring it
    // to the front — the keyboard is positioned BELOW and slightly behind the dialog it serves,
    // so depth hid it no matter which order it drew in. Render order only decides between things
    // that both survive the depth test.
    //
    // A modal is the one case where the answer is always "in front": it exists because another
    // panel asked for it, it is dismissed when it is done, and there is nothing it could
    // sensibly be occluded by. So for modals only, depth comes off and renderOrder — which is
    // already set to the modal band — becomes the whole of the layering.
    const _modal = !!this._isModalOverlay;
    const _mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: !_modal,  // write depth so the laser and scene geometry are properly
      depthTest: !_modal,   // z-sorted against the panel — no draw-order tricks
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
    // an exception for the UI, so the UI is ordered after it.
    //
    // ABOVE THE RIG OVERLAY TOO. 1000 was enough to clear the grid and nothing else: the whole
    // skeleton family -- bones, joints, capsules, pins, labels -- lives at 9996 to 10002, drawn
    // with depth test off so it reads through the sculpt, and every one of them therefore painted
    // straight through the menu you were reading. matt: "almost all the bones display options
    // (bone solid, bone wireframe, joints, capsules, pins etc) draw over the vr panels."
    //
    // A panel is the nearest thing there is to a HUD, so it goes above the lot. Exported because
    // anything that must sit on a panel (its own close button, the resize handle) has to be able
    // to say "one more than the panel" without knowing the number.
    // A subclass marks itself modal before calling init(); see VR_MODAL_ORDER_BUMP.
    this.mesh.renderOrder = VR_PANEL_RENDER_ORDER + (this._isModalOverlay ? VR_MODAL_ORDER_BUMP : 0);
    // scale.y = -1 compensates for flipY=false in the polyfill-rasterised texture.
    this.mesh.scale.y = -1;

    // NEVER FRUSTUM-CULLED, for the reason the VR cursor is not (see Scene, createVRCursor).
    //
    // Screen recording on the GalaxyXR adds a secondary observer view, so three sees THREE views
    // rather than two, takes its "AR" branch, and builds the culling frustum from the LEFT EYE's
    // projection instead of the union of both eyes. Culling then runs against a narrower,
    // off-centre frustum and discards things that are plainly on screen -- and a WRIST panel
    // lives exactly where that matters, out at the edge of the view. Nudge the hand and it
    // crosses the bogus boundary: on, off, on. matt: "its flashing on and off still... all i was
    // doing was moving the cursor between bones. no buttons were being pressed."
    //
    // This is invisible to every check the panel tracer makes, and to any amount of reading:
    // culling happens inside the renderer, after everything the app can see. It is also why the
    // PINNED main menu looked immune -- pinned, it floats in front of you, nowhere near the
    // frustum edge. The hover quad already opted out; the panel it belongs to never did.
    this.mesh.frustumCulled = false;

    // Subclasses can set this._startHidden = true before calling init()
    // to start the mesh invisible (avoids the frame where both panels are visible).
    if (this._startHidden) this.mesh.visible = false;

    scene.add(this.mesh);
    HTMLVRPanel._live.add(this);

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
    const { w, h } = panelPixelSize(el, 240, 200);
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
      // AN EMPTY CAPTURE IS NEVER AN ANSWER -- on ANY paint, not just a resize.
      //
      // Scoping this to resize paints was too narrow, and the trace showed where the damage
      // actually happens: the panel goes blank while it is HIDDEN. Every registered panel is
      // repainted on the shared canvas's paint event, so when another panel is mounted for a
      // swap, this one is still mounted and gets captured against a host canvas that has just
      // been re-laid out -- and the capture comes back the right size and completely empty. The
      // texture then sits empty for the whole time the panel is hidden, and the panel is shown
      // with nothing on it:
      //
      //   [X] MiniPanel / MiniPanel: shown / MiniPanel: TEXTURE IS EMPTY (mean alpha 0)
      //
      // A panel's background is opaque, so a legitimate capture is never blank; a blank one is
      // always a failed rasterisation, and the last good frame is strictly better than it.
      // ONLY WHEN THERE IS REASON TO SUSPECT ONE.
      //
      // This ran on EVERY paint of EVERY panel, and it is a GPU->CPU readback: drawImage of the
      // full bitmap into an 8x8 canvas, then getImageData. matt's performance recording put
      // getImageData at 251ms of self time, and a readback does not only cost its own time -- it
      // forces the pipeline to flush, which lands on WebGLRenderer.render, the largest single
      // entry in that profile at 31%. That is the mechanism by which MORE PANELS made the
      // RENDERER slower, which is otherwise a strange thing for a panel to do.
      //
      // The blank captures it was written to catch all come from one situation: a re-layout the
      // panel has not repainted since (a mount, an unmount, a resize). So the check arms itself
      // on exactly those, and stays armed while it keeps seeing blanks.
      if (this._texture && this._suspectBlank && _bitmapIsBlank(bitmap)) {
        this._dirty = true;               // come back for a real one
        return;
      }
      this._suspectBlank = false;
      if (this._needsResize) {
        this._needsResize = false;
        this._suspectBlank = true;
        // A size change moves every panel after this one in the shared flow, so their captured
        // regions are stale too — the same rule as mounting. See markAllPanelsDirty.
        markAllPanelsDirty(this);
        this.resizeMesh();
        if (this._texture) {
          // THE GPU TEXTURE GOES; THE THREE.Texture AND THE MATERIAL STAY.
          //
          // This used to null `material.map` and set `material.needsUpdate`, which is a request
          // to RECOMPILE THE MATERIAL'S PROGRAM: a map appearing or disappearing changes the
          // shader, so three throws the program away and builds a new one. On this GPU that
          // takes long enough to see, and with parallel shader compilation the object is simply
          // not drawn until the new program is ready -- so the panel vanishes for a beat and
          // comes back, once per rebuild, with every property of it correct throughout. That is
          // the bug, and it is why nothing about visibility, position, size or texture content
          // ever showed it. matt's bisection settled it: with rebuilds frozen it stops.
          //
          // dispose() still frees the GPU texture, which is what the size change needs (copying
          // a differently-sized bitmap into the old allocation is the GL_INVALID_VALUE this
          // dispose was added for). Keeping the same Texture OBJECT on the same material means
          // the program is untouched: the next assignment re-uploads at the new size.
          this._texture.dispose();
          this._texture.image = bitmap;
          this._texture.needsUpdate = true;
        }
      }

      // Only the FIRST texture changes the material -- going from no map to a map really does
      // change the shader. Every later frame reuses the same Texture object, so the program is
      // compiled once for the life of the panel.
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
    // ONCE PER SHOW, NOT PER FRAME.
    //
    // The first version of this asked every frame, and that broke the main menu: its content
    // changes while you are using it — switching to the outliner, or properties — so the check
    // kept re-flagging a resize mid-interaction, and each one disposes the texture. The panel
    // froze on whatever it had last painted while its DOM, and so its hit regions, moved on
    // underneath. matt: "the tool panel is the ONLY thing that works... i can see they get
    // misaligned with the frozen tool panel."
    //
    // A panel that changes its own content already raises the flag correctly; the only gap is
    // the content that changed while nobody could measure it. So this asks at the one moment that
    // gap can appear — the frame after being shown — and never again until the next show.
    this._checkPlaneAspect();

    if (this._dirty && !this._sliderDragTarget) {
      // Clear dirty only if a paint was actually scheduled. If it was rate-limited away,
      // stay dirty and retry next frame — otherwise the change is lost until the next edit
      // (the bug behind "the menu freezes until you click the other one").
      // COUNTED, because "each paint is slow" and "we paint far too often" are the same
      // milliseconds and completely different fixes. The first needs the panels rewritten onto
      // canvas; the second needs whatever is marking them dirty to stop. xrPerf reports both
      // the count and the total, so one run tells you which.
      if (window._xrPerf) window._panelPaints = (window._panelPaints | 0) + 1;
      // A REBUILD DOES NOT WAIT OUT THE RATE LIMIT.
      //
      // The ambient limit is 200ms, and that is exactly the gap matt measured: "select a joint
      // with the trigger, move controller a tiny amount, minipanel disappears for roughly 0.25
      // seconds, reappears". The trace caught the state it spends that gap in --
      //
      //   MiniPanel: shown
      //   MiniPanel: TEXTURE IS EMPTY (mean alpha 0)
      //   MiniPanel paint: el 240x458  RESIZE -> map 419x800   (97ms later)
      //   MiniPanel: texture has content again
      //
      // -- a panel on screen with a texture that has nothing on it, waiting for a paint the
      // limiter is holding back. The limit exists to stop AMBIENT repaints costing 5fps of SVG
      // rasterisation; a rebuild is not ambient, it is the one paint the user is waiting for.
      // So a resize forces it: the gap becomes a frame instead of a fifth of a second.
      // A resize moves every panel's captured region, so that one stays whole-canvas and
      // forced. An ordinary content change is this panel's business alone -- see
      // requestPaintScoped, and the measurement that a full paint is priced per mounted panel.
      if (this._needsResize) { requestPaintForced(getHostCanvas()); this._dirty = false; }
      else if (requestPaintScoped(this)) this._dirty = false;
    }
  }

  /**
   * Where the viewer's head is, in world space. The XR camera while a session is running (its
   * matrixWorld IS the head), the bound desktop camera otherwise, null if neither exists yet so
   * callers can fall back rather than position against a zero.
   *
   * On the base class because every modal overlay needs it to place itself in front of the panel
   * that summoned it, and a copy per overlay is a copy per overlay to keep in step.
   */
  _viewerPosition() {
    const xr = this._renderer?.xr;
    if (xr?.isPresenting && xr.getCamera) {
      const c = xr.getCamera();
      if (c) { c.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld); }
    }
    const d = this._desktopCamera;
    if (d) { d.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(d.matrixWorld); }
    return null;
  }

  markDirty() {
    notePanelDirty(this);
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
    // A DRAG NEEDS THE MOVES TO REACH THE DISPATCH, and only a slider drag used to.
    //
    // This is why drag-to-scroll did nothing on device while it passed every desktop test: the
    // tests called _vrDispatch directly, and the real path never calls it for a move unless a
    // slider owns the press. Everything else here is hover, which is deliberate — a pointermove
    // into the offscreen DOM activates :hover and costs a full rasterisation — so the scroll
    // drag joins the one existing exception rather than lifting it.
    if (this._sliderDragTarget || this._dragScroll) {
      this._vrDispatch('pointermove', uv, 1, true);
      return;
    }
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
    // NAMED SO TABS CAN BE TOLD APART. Every tab button shares the class `mm-tab-btn` and has no
    // id, so an id-or-class label printed the same string for all eight of them -- which makes
    // the trace useless for the one question it is most often asked: "which button did my ray
    // actually resolve to?" The section (or menu) a button carries is what distinguishes them.
    h.els.add(t ? (t.dataset?.section || t.dataset?.menu || t.id || t.className || t.tagName)
      : '(none)');

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
    // Same for a drag-scroll: a ray that leaves the panel mid-drag must not come back to a
    // scroll still anchored to where it started, which would jump the content on the first move.
    if (this._dragScroll) { this._dragScroll = null; this.markDirty(); }
    // ...and a press whose release will never arrive on this panel must not fire a click later.
    this._pendingClick = null;
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
        // DOUBLE-SIDED, BECAUSE ITS FACING IS DECIDED BY THE PARENT'S MIRROR.
        //
        // Default FrontSide worked only because every panel carried scale.y = -1, which flips
        // the quad's winding toward the viewer. The hands-only wrist slot normalises the panel
        // to +1 and the quad was then back-face culled: found, positioned, marked visible, and
        // invisible. The debug read said it all — hoverable "Wire", quadVisible true, nothing
        // on screen.
        //
        // A one-pixel-thick highlight has no meaningful back, so there is nothing to lose by
        // drawing both sides and one fewer assumption about the parent to get wrong.
        side: THREE.DoubleSide,
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

    // WHAT THIS FUNCTION DECIDED, readable as a value. _hoverStat measures how much the uv is
    // MOVING, which answers a different question entirely — it cannot say whether a hoverable
    // element was found or whether the quad ended up visible, and those are the two ways a
    // highlight goes missing. window._hoverTrace = true, then read window._hoverDbg.
    if (window._hoverTrace) {
      window._hoverDbg = {
        uv: { x: +uv.x.toFixed(3), y: +uv.y.toFixed(3) },
        el: el ? (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')) : null,
        hoverable: target ? (target.tagName.toLowerCase() + ' "' + (target.textContent || '').trim().slice(0, 18) + '"') : null,
        parentScaleY: this.mesh?.scale?.y,
        parentOrder: this.mesh?.renderOrder,
        quadOrder: q?.renderOrder,
        quadInScene: !!q?.parent,
        quadVisible: null,     // filled in below once decided
      };
    }

    if (!target) {
      if (window._hoverDbg) window._hoverDbg.quadVisible = false;
      this._announceHover(null, this._hoverEl);
      q.visible = false; this._hoverEl = null; return;
    }
    // Re-measure when the panel has SCROLLED even though the element is the same: the row is
    // under the ray at a different place than it was, and skipping the measure would leave the
    // highlight behind at the old position.
    const scrolled = this._hoverScrollTop !== this._scrollTopOf(target);
    if (target === this._hoverEl && !scrolled) {
      q.visible = true;
      if (window._hoverDbg) { window._hoverDbg.quadVisible = true; window._hoverDbg.cached = true; }
      return;
    }
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
    //
    // AND IT HOLDS UNDER EITHER PARENT MIRROR, which is worth stating because it looks as though
    // it should not. The quad is a CHILD of the panel mesh, so a negative parent scale.y flips
    // where its local +Y renders — but it flips the TEXTURE by exactly the same amount, and the
    // quad is positioned in the same local space the texture is mapped in. Content and highlight
    // mirror together, so the mapping needs no sign term.
    //
    // One was added here on the theory that the parent mattered, and it inverted every highlight
    // on the hands-only panels. The bug it was chasing was the quad being back-face CULLED (see
    // the DoubleSide note in _hoverMesh) — a different thing that happened to appear at the same
    // time, because both were exposed by the same normalised scale.
    const cx = (left - panelRect.left + (right - left) / 2) / panelRect.width;
    const cy = (top - panelRect.top + (bot - top) / 2) / panelRect.height;
    q.scale.set(this._meshWidth * ((right - left) / panelRect.width),
                meshH * ((bot - top) / panelRect.height), 1);
    q.position.set((cx - 0.5) * this._meshWidth, (cy - 0.5) * meshH, 0.001);
    q.visible = true;
    if (window._hoverDbg) {
      window._hoverDbg.quadVisible = true;
      window._hoverDbg.quadLocal = [+q.position.x.toFixed(4), +q.position.y.toFixed(4), +q.position.z.toFixed(4)];
      window._hoverDbg.quadScale = [+q.scale.x.toFixed(4), +q.scale.y.toFixed(4)];
      window._hoverDbg.quadOpacity = q.material?.opacity;
    }
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

  // WHY A DRAG DID OR DID NOT SCROLL, one line per event, kept on window.
  //
  // Three things can each stop it and they are indistinguishable from inside a headset: the move
  // never reaching _vrDispatch at all (the fault above), the press finding nothing scrollable
  // under it, or the deadzone never being crossed. Each is named here rather than inferred.
  //
  // window._dragTrace = true, then read window._dragLog. Capped, because this is written from
  // the frame loop.
  _dragTraceOut(type, el, absX, absY) {
    if (type === 'pointermove' && !this._dragScroll) return;   // hover noise, nothing to say
    const d = this._dragScroll;
    const sc = d ? d.el : (this._scrollClipEl(el) || this._findScrollable(this._element));
    const line = '[drag] ' + (this.constructor?.name || 'panel') + ' ' + type
      + ' el=' + (el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') : 'none')
      + ' y=' + Math.round(absY)
      + ' scrollable=' + (sc ? (sc.id || sc.className || 'yes') : 'NONE')
      + ' span=' + (sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : 0)
      + ' drag=' + (d ? (d.armed ? 'ARMED' : 'pending') : 'none')
      + (d ? ' dy=' + Math.round(absY - d.y0) + ' top=' + Math.round(d.el.scrollTop) : '')
      + ' pendingClick=' + (this._pendingClick ? 'yes' : 'no')
      + ' slider=' + (this._sliderDragTarget ? 'yes' : 'no');
    console.log(line);
    if (!window._dragLog) window._dragLog = [];
    window._dragLog.push(line);
    if (window._dragLog.length > 80) window._dragLog.shift();
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
    // A DISABLED CONTROL IS ONLY DISABLED IN A REAL BROWSER.
    //
    // Everything below synthesises input: the slider drag writes `value` and dispatches 'input'
    // itself, and the tap dispatches its own MouseEvent. None of that consults `disabled`, and
    // `pointer-events: none` says nothing to _uvToElement either -- that is a geometric walk over
    // rectangles, not a hit test the browser runs. So a dimmed, inert-looking control was fully
    // draggable and fully clickable through a VR ray, which is worse than not dimming it.
    //
    // `:disabled` rather than `.disabled`, because the property reflects the ATTRIBUTE only: a
    // control inside a disabled <fieldset> is disabled and says `.disabled === false`. The
    // fieldset is how whole blocks are switched off here (the shader panel's, and the physics
    // sliders while no flagged joint is selected), so the property would have missed every one.
    const disabledEl = (n) => !!(n && n.matches && n.matches(':disabled'));

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
      if (rangeEl && !disabledEl(rangeEl)) this._sliderDragTarget = rangeEl;
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

    // DRAG THE PANEL TO SCROLL IT, the way 3ds Max let you drag a rollout.
    //
    // A hand has no thumbstick, and the custom scrollbar is a few pixels wide — a target you
    // have to acquire with an unbraced arm. matt: "with pure hands/finger tracking the
    // mainpanels are hard to manpulate, the scrollbar is too narrow."
    //
    // NOT FROM A CONTROL, though, and that is not timidity: in VR the click fires on
    // POINTERDOWN (see the dispatch below — deliberately, so it lands before your aim drifts),
    // so a drag beginning on a button has already pressed it by the time it moves. Backgrounds,
    // labels, headers, row padding and the gaps between rows are all fair game, which on these
    // panels is most of their area.
    //
    // Content follows the finger, as it does on every touch surface: drag down and the content
    // comes down with you, so scrollTop decreases.
    if (window._dragTrace) this._dragTraceOut(type, el, absX, absY);
    if (type === 'pointerdown' && !this._sliderDragTarget && !this._scrollDrag) {
      const sc = this._scrollClipEl(el) || this._findScrollable(this._element);
      // Only a container that actually overflows: on a short panel this would otherwise eat
      // every press and give nothing back.
      if (sc && sc.scrollHeight > sc.clientHeight + 1) {
        this._dragScroll = { el: sc, y0: absY, top0: sc.scrollTop, armed: false };
      }
    }
    if (type === 'pointerup' && this._dragScroll) { this._dragScroll = null; this.markDirty(); }
    if (this._dragScroll && type === 'pointermove') {
      const d = this._dragScroll;
      const dy = absY - d.y0;
      // A DEADZONE, THEN RE-BASE. An unbraced hand wanders a couple of pixels while it holds a
      // pinch; without this the panel creeps. Re-basing at the moment it arms means the content
      // does not jump by the deadzone on the first frame of a real drag.
      const min = window._panelDragScrollMin ?? 18;
      if (!d.armed) {
        if (Math.abs(dy) < min) return;
        d.armed = true;
        d.y0 = absY;
        d.top0 = d.el.scrollTop;
        // THIS IS A DRAG, SO IT IS NOT A CLICK — and it has to be said HERE, because this branch
        // returns before the tap/drag code below ever runs. Without it a drag scrolled the panel
        // and pressed the button it started on, which is the worst of both.
        this._pendingClick = null;
        return;
      }
      this._pendingClick = null;
      const span = Math.max(0, d.el.scrollHeight - d.el.clientHeight);
      d.el.scrollTop = Math.max(0, Math.min(span, d.top0 - (absY - d.y0)));
      this._updateScrollThumb(d.el);
      // Same throttle as the thumbstick path: the scroll position moves every frame (so the DOM
      // and the hit test stay honest) while the rasterisation is rate-limited, with a final
      // repaint once it stops.
      const now = performance.now();
      if (now - (this._scrollRasterTs || 0) > 120) { this._scrollRasterTs = now; this.markDirty(); }
      clearTimeout(this._scrollStopTimer);
      this._scrollStopTimer = setTimeout(() => { this.markDirty(); }, 150);
      return;
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

    // A TAP IS A CLICK; A DRAG IS A SCROLL. The click used to fire on POINTERDOWN in VR, on the
    // reasoning that the press is the moment you meant it and aim drifts afterwards. That is
    // still true of the aim, and it is incompatible with dragging the panel to scroll it: nearly
    // every point on the main panel is a button (measured: only the section headers are not), so
    // a drag-to-scroll that refuses to start on a control cannot start at all, and one that does
    // start has already pressed the button it began on.
    //
    // So the click waits for the release, and is cancelled BY THE SCROLL ARMING — not by its own
    // measure of travel. That distinction is the whole of it: a second threshold, tested
    // independently, cancelled the click at 6px whether or not the scroll had engaged, so any
    // drift lost the press and nothing scrolled. matt: "its impossible to click any buttons, the
    // tiniest drift is interpreted as a scroll."
    //
    // One recogniser owns the threshold and the tap dies only when that recogniser WINS, which is
    // the ordinary touch-slop arrangement (Android's ViewConfiguration, iOS's gesture
    // recognisers): below slop nothing has happened yet, and a press is still a press.
    //
    // window._vrClickOnPress = true restores the old behaviour in a session, without a reload,
    // if this turns out to feel worse in the hand than it reads here.
    if (isVR && type === 'pointerdown' && !drag) {
      const dead = disabledEl(target) || disabledEl(target.closest && target.closest('button, input, select'));
      if (dead) {
        this._pendingClick = null;
      } else if (window._vrClickOnPress === true) {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: absX, clientY: absY }));
      } else {
        this._pendingClick = { target, x: absX, y: absY };
      }
    } else if (isVR && type === 'pointerup') {
      const pc = this._pendingClick;
      this._pendingClick = null;
      // The target from the PRESS, not from wherever the release landed: a hand that slips a few
      // pixels onto the next button between press and release must not press that one instead.
      if (pc && !drag) pc.target.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: absX, clientY: absY }));
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

// ── PANEL PROBE ───────────────────────────────────────────────────────────────
// window._panelProbe() — why is nothing drawing?
//
// Reports the facts that distinguish the candidates, rather than one of them at a time:
//   visible/parent    — is something hiding it (including a sweep of our own)
//   matType/hasMap    — did the material survive conversion, and is a texture bound
//   imgKind/imgSize   — did the rasteriser ever produce pixels (ImageBitmap vs nothing)
//   inScene           — is the mesh still attached to the rendered graph
//   drawCalls         — did the renderer draw ANYTHING near this count
// A panel with pixels, visible, in-scene and still not on screen is a renderer problem;
// one with no image is a rasteriser problem. Those need different fixes.
window._panelProbe = function () {
  const out = [];
  for (const p of HTMLVRPanel._live) {
    const m = p.mesh;
    if (!m) { out.push({ name: p.constructor.name, mesh: null }); continue; }
    let vis = m.visible, o = m.parent, inScene = false, depth = 0;
    while (o) { if (!o.visible) vis = false; if (o.isScene) inScene = true; o = o.parent; depth++; }
    const mat = m.material;
    const img = mat && mat.map && mat.map.image;
    out.push({
      name: p.constructor.name,
      selfVisible: m.visible,
      visibleChain: vis,
      inScene, depth,
      matType: mat && mat.type,
      isNodeMat: !!(mat && mat.isNodeMaterial),
      hasMap: !!(mat && mat.map),
      imgKind: img ? (img.constructor && img.constructor.name) : null,
      imgSize: img ? `${img.width}x${img.height}` : null,
      mapVersion: mat && mat.map ? mat.map.version : null,
      // WHERE IT ACTUALLY IS, not where its local transform says. The panel is submitted
      // (4 draw calls) and an opaque depthTest:false material still shows nothing, so it is
      // not hidden and not occluded -- it is somewhere the eye is not. A NaN anywhere in the
      // parent chain makes geometry vanish silently while every flag stays healthy, which is
      // exactly the shape of this bug.
      world: (() => {
        m.updateMatrixWorld(true);
        const e = m.matrixWorld.elements;
        const bad = e.some((v) => !Number.isFinite(v));
        return {
          pos: [+e[12].toFixed(3), +e[13].toFixed(3), +e[14].toFixed(3)],
          nan: bad,
          parent: m.parent ? (m.parent.name || m.parent.type) : null,
          parentNaN: m.parent ? m.parent.matrixWorld.elements.some((v) => !Number.isFinite(v)) : null,
          scaleW: [+m.matrixWorld.elements[0].toFixed(3), +m.matrixWorld.elements[5].toFixed(3)],
        };
      })(),
      opacity: mat && mat.opacity,
      renderOrder: m.renderOrder,
      pos: m.position.toArray().map(n => +n.toFixed(2)),
      scale: m.scale.toArray().map(n => +n.toFixed(2)),
    });
  }
  console.log('[panelProbe] ' + JSON.stringify(out, null, 1));
  return out.length;
};
