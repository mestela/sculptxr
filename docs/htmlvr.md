# HTMLVRPanel — HTML-Based Spatial VR Menus

This document covers the complete replacement of SculptXR's GuiXR canvas-based VR menu system with an HTML/CSS panel system rendered into WebGL textures via the `three-html-render` polyfill. Written after the initial implementation session; intended to be sufficient to recreate the system from scratch.

---

## Motivation

The old `GuiXR` system was a ~6,500-line custom 2D canvas renderer. Every widget — buttons, sliders, checkboxes — was hand-drawn to an `OffscreenCanvas` at fixed pixel coordinates, then uploaded as a Three.js texture via `texSubImage2D`. It worked, but had fundamental ceilings:

- Adding any new control required manual layout math
- Dynamic sizing, text wrapping, scrollable lists were extremely difficult
- The code was opaque — only understandable by whoever wrote it
- The "Tools" tab alone was 1,250 lines of drawing code

The replacement uses real HTML/CSS for layout and styling, rendered into a WebGL texture via the `three-html-render` polyfill. The result is maintainable, extensible, and visually richer. The spatial panel model (panels floating in world space, pinnable from the wrist) would have been very difficult to implement in the old system.

---

## Architecture Overview

Three new files plus modifications to `Scene.js`:

```
src/gui/htmlvr/
  install.js        — rAF intercept + polyfill setup + panel registry
  HTMLVRPanel.js    — base class: Three.js mesh + texture pipeline + interaction
  BrushPanel.js     — concrete panel: HTML template + SculptXR state wiring
```

### How a panel works end-to-end

1. **DOM element** is created and appended to a hidden `<canvas layoutsubtree>` (the "host canvas"). The polyfill tracks all children of layoutsubtree canvases.
2. **`requestPaint()`** is called on the host canvas when content is dirty. This schedules a rAF callback that rasterises the element via SVG `<foreignObject>` → OffscreenCanvas → ImageBitmap.
3. **`canvas.onpaint`** fires after rasterisation. The panel's `_onPaint()` handler calls `captureElementImage(element)` to retrieve the fresh bitmap and updates a Three.js `Texture` (`texture.needsUpdate = true`).
4. **Three.js** uploads the texture on the next `renderer.render()` call.
5. The texture is mapped to a **`PlaneGeometry` mesh** sized to match the panel's aspect ratio, parented to the non-dominant controller grip.
6. **Raycasting** (Three.js `Raycaster.intersectObject`) detects controller hits. UV coordinates are mapped back to DOM coordinates and forwarded as synthetic `PointerEvent`s.

---

## `install.js` — Singleton Setup

**Must be the first `three-html-render`-related import.** Its top-level code runs at module load time, which is the correct moment for both the rAF intercept and polyfill install.

### rAF Intercept

Chrome pauses `window.requestAnimationFrame` inside WebXR immersive sessions. The `three-html-render` polyfill schedules its rasterisation work via `window.rAF`, guarded by a single-pending flag (`if (!e.rafHandle)`). In XR mode this callback never fires, so the texture freezes permanently.

**Fix:** intercept `window.requestAnimationFrame` before the polyfill is installed. Track all pending callbacks in a `Map`. In the XR render loop, call `drainRAF()` to fire them manually.

```js
// Must run BEFORE installHtmlInCanvasPolyfill()
const _nativeRAF  = window.requestAnimationFrame.bind(window);
const _nativeCAF  = window.cancelAnimationFrame.bind(window);
const _pendingRAF = new Map();
let   _rafSeq     = 1;

window.requestAnimationFrame = (cb) => {
  const id       = _rafSeq++;
  const nativeId = _nativeRAF((ts) => {
    if (_pendingRAF.delete(id)) cb(ts); // only call if not already drained
  });
  _pendingRAF.set(id, { cb, nativeId });
  return id;
};
window.cancelAnimationFrame = (id) => {
  const e = _pendingRAF.get(id);
  if (e) { _pendingRAF.delete(id); _nativeCAF(e.nativeId); }
};
```

In non-XR mode the native rAF fires normally, calls the callback, and removes it from `_pendingRAF`. `drainRAF()` finds nothing to do. Zero overhead.

In XR mode the native rAF is blocked. `drainRAF()` (called once per XR frame before `renderer.render()`) fires all pending callbacks synchronously. The polyfill rasterises, `onpaint` fires, `_onPaint()` updates the texture — all in the same frame.

### Why Not ThreeHTMLRenderer

`three-html-render` ships a `ThreeHTMLRenderer` convenience class. **Do not use it.** Its `_uploadTextures()` method checks for `"texElementImage2D" in gl` — and this is **always true** because the polyfill patches `WebGLRenderingContext.prototype.texElementImage2D` globally on install. The WebGL-direct path then calls:

```js
gl.bindTexture(gl.TEXTURE_2D, texture.__webglTexture);
gl.texElementImage2D(...);
```

This binds a texture directly on the WebGL context without going through Three.js's state machine. Three.js caches its bound-texture state, so after this call it no longer knows what's bound. On the next draw call it may skip a re-bind it thinks is unnecessary, rendering with the wrong texture. On GXR with the Qualcomm Adreno driver this causes a full VR render freeze within seconds.

**The fix:** bypass `ThreeHTMLRenderer` entirely. Call `canvas.captureElementImage(element)` directly from `_onPaint()`, and set `texture.needsUpdate = true`. Three.js handles the upload safely on its own render pass.

### Panel Registry

`install.js` maintains a `Set` of registered `HTMLVRPanel` instances. `canvas.onpaint` is set once on the host canvas and dispatches `_onPaint()` to every registered panel. Panels register in their constructor and deregister in `dispose()`.

### Host Canvas

A single `<canvas layoutsubtree>` element is created and appended to `document.body` at module load time (positioned offscreen at `-9999px`). All panel DOM elements are appended to this canvas. The polyfill's overridden `appendChild` intercepts this and registers each element in its tracking state.

**Timing note:** The MutationObserver that sets up the polyfill's per-canvas state is async. However, panels are only constructed from `initVRControllers()`, which fires long after module load — the observer has definitely fired by then.

---

## `HTMLVRPanel.js` — Base Class

### Mesh Creation

Mesh creation is deferred one `requestAnimationFrame` after `init()` so that `offsetWidth`/`offsetHeight` are available (the element must be laid out by the polyfill before you can read its size). Aspect ratio is computed from these values so the mesh geometry matches the rendered panel exactly — if they don't match, UV→DOM hit mapping will be horizontally misaligned.

```js
const aspect = offsetWidth / offsetHeight;
const meshH  = this._meshWidth / aspect;
const mesh   = new THREE.Mesh(
  new THREE.PlaneGeometry(this._meshWidth, meshH),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false })
);
mesh.scale.y    = -1;
mesh.renderOrder = 1000; // draw on top of sculpt scene
```

`scale.y = -1` compensates for the texture being uploaded with `flipY = false`. The polyfill rasterises top-to-bottom; without any flip, UV.y=0 maps to visual top of the mesh, which is the correct orientation.

`renderOrder = 1000` matches the existing `VRMenu` so the panel draws over the sculpt geometry.

### Texture Pipeline

```
markDirty()
  → update() sets _dirty=false, calls canvas.requestPaint()
    → polyfill schedules rAF
      → (XR: drainRAF() fires it synchronously; non-XR: fires next native frame)
        → SVG foreignObject rasterisation
          → canvas.onpaint
            → _onPaint() → captureElementImage(element)
              → texture.image = bitmap; texture.needsUpdate = true
                → Three.js uploads on next renderer.render()
```

Only call `requestPaint()` when `_dirty` is true. Do not call it every frame — SVG rasterisation of a complex panel (15+ buttons, sliders, toggles) takes 20-80ms. At 90fps that would consume the entire frame budget.

Set `_dirty = true` (via `markDirty()`) whenever:
- The panel is first created
- DOM state changes (button clicked, slider moved)
- App state sync (`syncFromState()`) detects a value change

### UV → DOM Coordinate Mapping

Since we bypass `ThreeHTMLRenderer.addObject()`, the DOM element does **not** receive the `scaleY(-1)` transform that ThreeHTMLRenderer's CSS3D overlay renderer would apply. The element renders naturally: DOM y=0 at visual top.

Combined with `scale.y=-1` on the mesh and `flipY=false` on the texture:
- UV.y=0 → visual top → DOM top
- UV.y=1 → visual bottom → DOM bottom

Correct mapping (no inversion needed):
```js
const relX = uv.x * panelRect.width;
const relY = uv.y * panelRect.height;
```

**Historical note:** the prototype test (`htmltex/index.html`) used `ThreeHTMLRenderer.addObject()`, which DID apply `scaleY(-1)` to the DOM element. In that context the correct formula was `relY = (1 - uv.y) * panelRect.height`. When migrating to the direct polyfill path, this inversion must be removed or hits will be vertically mirrored. This will manifest as clicks registering on the wrong element — e.g. clicking the top button activates the bottom button.

The subtree walk uses `getBoundingClientRect()` throughout (post-transform space), not `offsetWidth`/`offsetHeight` (pre-transform CSS pixels). Mixing these spaces causes the walk to miss all children and return the root panel element for every hit.

### Slider Drag Handling

Slider `<input type="range">` tracks are typically 4-8px tall. The subtree walk will often return the parent `.row` div rather than the input itself when the user clicks near but not exactly on the track. Fix: on `pointerdown`, check the hit element for a range input; if not found, try `el.querySelector('input[type=range]')` as a fallback.

Slider values are computed directly from the raycast X position:
```js
const t   = Math.max(0, Math.min(1, (absX - r.left) / r.width));
const val = min + t * (max - min);
input.value = val;
input.dispatchEvent(new Event('input', { bubbles: true }));
```

Synthetic pointer events alone do not move the native thumb (browser doesn't trust them for security reasons). Direct value assignment is required.

On desktop, pointer capture (`e.target.setPointerCapture(e.pointerId)`) is essential for slider dragging. Without it the browser's scroll gesture steals the touch stream after ~300ms of horizontal movement.

### Desktop Pointer Events

Desktop uses `window.addEventListener('pointerdown/move/up', ...)` with raycasting against the panel mesh. Use `pointer*` events (not `mouse*`) — GXR desktop mode uses touch events, and `pointermove` covers touch, mouse, and stylus.

---

## `BrushPanel.js` — Concrete Panel

### HTML Structure

Built as a static string in `_buildHTML()`, injected as `div.innerHTML`. A companion CSS block is injected once into `document.head` via `injectCSS()`.

```
#bp-root
  h2 (title + pin button)
  .bp-tabs (Sculpting | Low Poly)
  #bp-grid-sculpt (.bp-tool-btn × 15)
  #bp-grid-lp (.bp-tool-btn × 11, hidden by default)
  hr.bp-divider
  .bp-row (Radius slider + value readout)
  .bp-row (Intensity slider + value readout)
  hr.bp-divider
  .bp-toggles
    #bp-sym   (Symmetry)
    #bp-clay  (Clay)
    #bp-accum (Accumulate)
    #bp-wire  (Wireframe)
```

Palette: Catppuccin Mocha. Base `#1e1e2e`, surface `#181825`, overlay `#313244`, text `#cdd6f4`, muted `#a6adc8`, accent blue `#89b4fa`, accent mauve `#cba6f7`.

### Mesh Size

`meshWidth = 0.30` metres — matches the existing `VRMenu` pixel density (`1024px / (1024 / 0.30m) = 0.30m`). This sets the physical scale of the panel in world space.

### Wrist Offset

```js
mesh.position.set(0.10, 0.10, -0.05);
mesh.rotation.set(-Math.PI / 2, 0, 0);
```

Matches `VRMenu`'s default offset/rotation. The `-Math.PI/2` rotation makes the panel face roughly upward from the palm (like a tablet resting on the back of the hand).

### State Wiring

`syncFromState()` reads from `main.getSculptManager()` and updates all inputs. Called approximately every 30 XR frames from Scene.js. Also called after any interaction that might change state.

Tool buttons use `data-tool-id` attributes. Tool selection routes through `main.getGui()._ctrlSculpting._ctrlSculpt.setValue(id)` when the desktop GUI control exists, falling back to `sm.setToolIndex(id)` — this matches the existing VR menu approach and ensures both UI systems stay in sync.

Radius: `activeTool._radius` (5–250). Intensity: `activeTool._intensity` (0.0–1.0, displayed as 0–100%). Symmetry: `sm._symmetry`. Clay/Accumulate/Culling: `activeTool._clay` etc. Values saved via `getOptionsURL.saveOption()` with a 500ms debounce, matching the existing GuiXR pattern.

### Pin / Unpin

The panel fires a `CustomEvent('bp-pin-change', { detail: { pinned } })` on the root element when the pin button is clicked. Scene.js listens and calls `_onBrushPanelPinChange(pinned)`.

**Pinning:** captures the panel's current `matrixWorld`, removes it from the wrist grip, re-parents to `this._scene`, and applies the captured world matrix. The panel stays exactly where it was in space.

**Unpinning:** removes from scene. `handleXRInput` detects `!panel.pinned` and re-adds it to `uiGrip` next frame.

---

## `Scene.js` Integration

### Imports

```js
import { drainRAF } from './gui/htmlvr/install.js';
import { BrushPanel } from './gui/htmlvr/BrushPanel.js';
```

The `install.js` import is a side-effect import — its top-level code (rAF intercept + polyfill install) runs at module load time. This must happen before any rendering begins. Importing it here (at the top of Scene.js) guarantees correct ordering.

### Initialisation (`initVRControllers`)

```js
if (!this._brushPanel && this._scene && this._camera && this._renderer) {
  this._brushPanel = new BrushPanel(
    this, this._scene, this._camera.getThreeCamera(), this._renderer
  );
  this._brushPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
  this._brushPanel._element.addEventListener('bp-pin-change', (e) => {
    this._onBrushPanelPinChange(e.detail.pinned);
  });
}
```

### Per-Frame Update (`applyRender`, XR path)

```js
if (this._brushPanel) {
  try {
    drainRAF();
    this._brushPanel.update(true);
  } catch (e) {
    console.warn('[HTMLVRPanel] update error:', e);
  }
}
```

`drainRAF()` must be called **before** `renderer.render()`. Wrap in try/catch — an error here would otherwise break the XR render loop.

### Wrist Attachment (`handleXRInput`)

```js
if (this._brushPanel && this._brushPanel.mesh && !this._brushPanel.pinned) {
  if (this._brushPanel.mesh.parent !== uiGrip) {
    uiGrip.add(this._brushPanel.mesh);
  }
}
```

The panel follows the same dominant-hand mount logic as `_vrMenu` and `_vrMiniHUD`: it is added to the non-dominant hand grip (`uiGrip`). The `pinned` check prevents re-parenting when the user has pinned the panel in world space.

### Raycasting (`handleXRInput`, per-source loop)

The XR input loop already computes `origin` and `dir` (gl-matrix `vec3`) from the controller's pose. These are forwarded to a dedicated `THREE.Raycaster`:

```js
this._bpRayOrigin.set(origin[0], origin[1], origin[2]);
this._bpRayDir.set(dir[0], dir[1], dir[2]).normalize();
this._bpRaycaster.set(this._bpRayOrigin, this._bpRayDir);

const bpHits = this._bpRaycaster.intersectObject(this._brushPanel.mesh);
if (bpHits.length > 0) {
  const uv      = bpHits[0].uv;
  const pressed = source.gamepad?.buttons[0]?.value > 0.1
               || source.gamepad?.buttons[0]?.pressed;
  const justDown = pressed && !this._bpWasPressed;
  const justUp   = !pressed && this._bpWasPressed;

  if (justDown)       this._brushPanel.onVRPress(uv);
  else if (justUp)    this._brushPanel.onVRRelease(uv);
  else                this._brushPanel.onVRMove(uv);

  this._bpWasPressed     = pressed;
  this._isPointingAtMenu = true; // suppresses sculpt tool while pointing at panel
} else {
  if (this._bpWasPressed) {
    this._brushPanel.onVRRelease({ x: 0.5, y: 0.5 });
    this._bpWasPressed = false;
  }
  this._brushPanel.onVRLeave();
}
```

State sync is rate-limited:
```js
this._bpSyncCounter = (this._bpSyncCounter || 0) + 1;
if (this._bpSyncCounter % 30 === 0) this._brushPanel.syncFromState();
```

---

## Known Issues at Time of Writing

- **GXR immersive mode**: Hits not yet confirmed working on device (session ended before full test). The rAF drain mechanism was validated in the prototype and should transfer.
- **Teething on pin/unpin**: Some positional jitter on first pin; matrix capture timing may need one frame of buffer.
- **No Low Poly tab test**: Tool buttons in the Low Poly tab are wired but untested in VR.
- **GuiXR coexistence**: The old `_vrMenu`/`_guiXR` system still runs alongside BrushPanel. MiniHUD and Popup panels have not been migrated. Full replacement is the goal but not yet done.

---

## Files Created / Modified

| File | Status | Notes |
|------|--------|-------|
| `src/gui/htmlvr/install.js` | New | rAF intercept, polyfill, host canvas, panel registry |
| `src/gui/htmlvr/HTMLVRPanel.js` | New | Base class — mesh, texture, hit detection, interaction |
| `src/gui/htmlvr/BrushPanel.js` | New | Brush/Tools panel HTML + state wiring |
| `src/Scene.js` | Modified | Imports, `_brushPanel` init, wrist attach, raycasting, `drainRAF`, `_onBrushPanelPinChange` |
| `htmltex/index.html` | Existing | Prototype/test page — not used in production, kept for reference |
| `docs/galaxyxr.md` | Existing | GXR-specific bugs documented separately |
