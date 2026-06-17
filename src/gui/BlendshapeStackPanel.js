// BlendshapeStackPanel — canvas-2D "layer stack" UI for blendshapes (Nomad/Photoshop style).
//
// Mirrors the GuiTimeline canvas pattern: a single <canvas> + getContext('2d'),
// pointer-capture input, and an imperative draw() that only repaints on
// interaction or state change. A canvas redraw is cheap, so it sidesteps the
// per-paint HTML-in-WebXR raster cost that the old HTML blendshape Section 6
// pays on every weight-slider drag — while keeping a single place that shows
// both "what layers exist" and "how much each is on".
//
// Increment 1 (this file): desktop panel — click a row to make it the active
// sculpt layer (blue highlight), double-tap the name to rename, weight slider
// (always live on any layer), numeric value, Base row pinned at the bottom,
// New/Del toolbar. Sculpting into a layer is gated to "visible + weight 1" by
// SculptManager (blocked strokes flash the panel). Mute/solo (increment 2) and
// VR mount (increment 3) land on top of this.
//
// Wiring goes through window._animationRegistry (createBlendshape,
// setBlendshapeWeight, deleteBlendshape, renameBlendshape, enter/exit edit mode)
// against the active mesh (main.getMesh()).

// FontAwesome 6 Free (Solid, weight 900) glyphs — drawn on the canvas, never emoji.
const FA = {
  plus:  '\uf067', // fa-plus
  trash: '\uf1f8', // fa-trash-can
  close:    '\uf00d', // fa-xmark (close VR panel)
  eye:      '\uf06e', // fa-eye (visible)
  eyeSlash: '\uf070', // fa-eye-slash (muted)
};

// Layout constants (CSS px). Two-line rows: header (dot/name/value) + slider.
const PAD       = 10;
const TOOLBAR_H = 38;
const ROW_H     = 46;
const BASE_H    = 30;
const TRACK_H   = 6;
const NAME_X    = PAD + 4;  // name text left edge
const TRACK_X0  = PAD + 4;  // slider track left edge (full row width)

export default class BlendshapeStackPanel {
  constructor(main) {
    this._main   = main;
    this._host   = null;   // DOM element we mount into
    this._canvas = null;
    this._ctx    = null;
    this._cssW   = 280;
    this._cssH   = 200;
    this._dpr    = window.devicePixelRatio || 1;

    // Row layout cache rebuilt every draw(): array of hit-test rects.
    this._rows = [];        // { name, top, isBase, trackX0, trackX1, dotCx, dotCy }
    this._toolbarBtns = []; // { id, x, y, w, h }

    // Active slider drag state.
    this._dragName       = null;
    this._dragStartW     = 0;
    this._dragMoved      = false;

    // dblclick → rename: a floating <input> overlaid on the row.
    this._renameInput    = null;
    this._renameName     = null;

    // Track last tap for manual dblclick detection (pointer events don't give it).
    this._lastTapName    = null;
    this._lastTapTime    = 0;
  }

  // Mount the canvas into a host DOM element (a wa-tab-panel for desktop).
  mount(host) {
    this._host = host;

    this._canvas = document.createElement('canvas');
    this._canvas.style.display = 'block';
    this._canvas.style.width   = '100%';
    // Block iPadOS Scribble / system gestures (same as GuiTimeline).
    this._canvas.style.touchAction = 'none';
    host.appendChild(this._canvas);

    this._ctx = this._canvas.getContext('2d');

    // Pointer-capture on the canvas; move/up on window so a drag that leaves
    // the canvas still tracks.
    this._canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup',   ()  => this._pointerUp());
    window.addEventListener('pointercancel', () => this._pointerUp());
    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Re-layout when the sidebar/panel changes width.
    this._ro = new ResizeObserver(() => this._relayout());
    this._ro.observe(host);

    // Global handle so the SculptManager sculpt-gate can flash the palette.
    window._blendshapeStackPanel = this;

    this._relayout();
    this._startSyncLoop();
    return this;
  }

  // Called when the tab becomes visible — pull latest state.
  onShow() {
    this._relayout();
  }

  // VR mount: build a standalone (non-DOM) canvas at a fixed size for rendering to
  // a texture on a VR panel mesh. Input arrives via vrPointer() in canvas coords;
  // Scene drives texture.needsUpdate. Returns the canvas for the CanvasTexture.
  mountVR(cssW, cssH) {
    this._vrMode = true;
    this._host   = null;
    this._cssW   = cssW;
    this._cssH   = cssH;
    this._canvas = document.createElement('canvas');
    this._canvas.width  = cssW;
    this._canvas.height = cssH;
    this._ctx = this._canvas.getContext('2d');
    this._ctx.setTransform(1, 0, 0, 1, 0, 0);
    window._blendshapeStackPanelVR = this;
    this._startSyncLoop();
    this.draw();
    return this._canvas;
  }

  // Scene calls this when the VR panel mesh is shown/hidden so the sync loop knows
  // to keep redrawing.
  setVRVisible(v) { this._vrVisible = v; if (v) this.draw(); }

  // Keep the panel in lock-step with the timeline: a slider here writes a keyframe
  // at the current playback time, and scrubbing / editing keys in the timeline
  // changes the evaluated weight — so the slider IS the animated value. This loop
  // redraws when the relevant state changes (only while the panel is visible, so
  // it costs nothing on other tabs).
  _startSyncLoop() {
    const loop = () => {
      const visible = this._vrMode ? this._vrVisible
                                   : (this._host && this._host.offsetParent !== null);
      if (visible && !this._dragName) {
        const sig = this._stateSignature();
        if (sig !== this._lastSig) { this._lastSig = sig; this.draw(); }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _stateSignature() {
    const track = this._track();
    if (!track) return 'none';
    let s = (track.playbackTime || 0).toFixed(4) + '|' + (track.editingBlendshape || '') + '|'
          + (track.blendshapes?.size || 0) + '|';
    track.blendshapes?.forEach((d, n) => {
      s += n + ':' + this._weightOf(n).toFixed(4) + (track.blendshapeMuted?.has(n) ? 'm' : '') + ';';
    });
    return s;
  }

  // ── Sizing ──────────────────────────────────────────────────────────────────
  // Canvas height tracks content so the wa-tab-panel scrolls naturally.
  _contentHeight() {
    const track = this._track();
    const n = track?.blendshapes?.size || 0;
    return TOOLBAR_H + n * ROW_H + BASE_H + PAD;
  }

  _relayout() {
    if (!this._host) return;
    const w = this._host.clientWidth || 280;
    this._cssW = w;
    this._cssH = this._contentHeight();
    this._dpr  = window.devicePixelRatio || 1;

    this._canvas.style.height = this._cssH + 'px';
    this._canvas.width  = Math.round(this._cssW * this._dpr);
    this._canvas.height = Math.round(this._cssH * this._dpr);
    this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    this.draw();
  }

  // ── State accessors ──────────────────────────────────────────────────────────
  _mesh() { return this._main?.getMesh?.() || null; }
  _track() {
    const mesh = this._mesh();
    if (!mesh) return null;
    return window._animationRegistry?.tracks.get(mesh.getID()) || null;
  }

  // Photoshop order: newest layer on top. The timeline mirrors this same order
  // (see GuiTimeline._bsOrderedNames). Base is drawn separately, pinned at the
  // bottom. (When drag-to-reorder lands, this becomes an explicit shared order
  // array that both the panel and the timeline read from.)
  _layerNames() {
    const track = this._track();
    if (!track?.blendshapes) return [];
    return [...track.blendshapes.keys()].reverse();
  }

  _weightOf(name) {
    const track = this._track();
    const bTrack = track?.blendshapeTracks?.get(name);
    if (!bTrack || bTrack.times.length === 0) return 0;
    return window._animationRegistry.evaluateScalarTrack(bTrack, track.playbackTime || 0);
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────
  draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._cssW, H = this._cssH;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    this._rows = [];
    this._toolbarBtns = [];

    this._drawToolbar(ctx, W);

    const mesh = this._mesh();
    if (!mesh) {
      ctx.fillStyle = '#777';
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('No mesh selected', PAD, TOOLBAR_H + 20);
      return;
    }

    const track = this._track();
    const editing = track?.editingBlendshape || null;

    const names = this._layerNames();
    let y = TOOLBAR_H;
    for (const name of names) {
      this._drawRow(ctx, W, y, name, this._weightOf(name), name === editing, false);
      y += ROW_H;
    }

    // Base layer pinned at the bottom (no slider; its "select dot" exits edit mode).
    this._drawRow(ctx, W, y, 'Base', 1, editing === null, true);
  }

  _drawToolbar(ctx, W) {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, W, TOOLBAR_H);
    ctx.strokeStyle = '#2d2d2d';
    ctx.beginPath();
    ctx.moveTo(0, TOOLBAR_H - 0.5); ctx.lineTo(W, TOOLBAR_H - 0.5);
    ctx.stroke();

    const bw = 34, bh = 26, by = (TOOLBAR_H - bh) / 2;
    const newBtn = { id: 'new', x: PAD, y: by, w: bw, h: bh };
    const delBtn = { id: 'del', x: PAD + bw + 6, y: by, w: bw, h: bh };
    this._toolbarBtns.push(newBtn, delBtn);

    this._drawIconBtn(ctx, newBtn, FA.plus,  '#3b82f6');
    const canDel = !!this._track()?.editingBlendshape;
    this._drawIconBtn(ctx, delBtn, FA.trash, canDel ? '#e06c6c' : '#555');
    // VR close is a corner mesh owned by Scene (same style as the timeline), not an
    // on-canvas button — see Scene._vrBlendCloseBtn.
  }

  _drawIconBtn(ctx, b, glyph, color) {
    ctx.fillStyle = '#2c2c2c';
    this._roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = '900 14px "Font Awesome 6 Free"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
    ctx.textAlign = 'left';
  }

  _drawRow(ctx, W, top, name, weight, isActive, isBase) {
    const h = isBase ? BASE_H : ROW_H;

    // Whole-row highlight is the only "active" signal (click anywhere to activate).
    if (isActive) {
      ctx.fillStyle = 'rgba(59,130,246,0.16)';
      ctx.fillRect(0, top, W, h);
      // Left accent bar.
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(0, top, 3, h);
    }
    // Row separator.
    ctx.strokeStyle = '#262626';
    ctx.beginPath();
    ctx.moveTo(0, top + h - 0.5); ctx.lineTo(W, top + h - 0.5);
    ctx.stroke();

    const track  = this._track();
    const muted  = !isBase && (track?.blendshapeMuted?.has(name) || false);
    const soloed = !isBase && track?.blendshapeSolo === name;

    // Visibility eye on the LEFT of the header line: amber when this layer is
    // soloed, red-slash when muted, grey when plainly visible. (Base = no eye.)
    const eyeCx = NAME_X + 7;
    const eyeCy = top + 16;
    const nameStart = isBase ? NAME_X : NAME_X + 24;
    if (!isBase) {
      ctx.fillStyle = soloed ? '#f2b53c' : (muted ? '#e06c6c' : '#9aa');
      ctx.font = '900 13px "Font Awesome 6 Free"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(muted ? FA.eyeSlash : FA.eye, eyeCx, eyeCy + 0.5);
      ctx.textAlign = 'left';
    }

    // Name (dimmed when muted).
    ctx.fillStyle = isBase ? '#888' : (muted ? '#666' : (isActive ? '#fff' : '#ddd'));
    ctx.font = (isActive ? '600 ' : '') + '12px sans-serif';
    ctx.textBaseline = 'middle';
    const valW = 40;
    const nameMaxX = W - PAD - valW;
    const nameText = this._ellipsize(ctx, name, nameMaxX - nameStart);
    const nameY = isBase ? h / 2 + top : top + 16;
    ctx.fillText(nameText, nameStart, nameY);
    // Sculpt-lockout flash: paint the name red on top, fading out.
    const fa = isBase ? 0 : this._flashAlpha(name);
    if (fa > 0) {
      ctx.save();
      ctx.globalAlpha = fa;
      ctx.fillStyle = '#ff4d4d';
      ctx.fillText(nameText, nameStart, nameY);
      ctx.restore();
    }

    if (isBase) {
      this._rows.push(this._rowRect(name, top, true));
      return;
    }

    // Numeric value (right-aligned).
    ctx.fillStyle = muted ? '#666' : '#9aa';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(weight.toFixed(2), W - PAD, top + 16);
    ctx.textAlign = 'left';

    // Slider track + fill + handle (second line).
    const trackX0 = TRACK_X0;
    const trackX1 = W - PAD;
    const trackY  = top + 33;
    const tw = trackX1 - trackX0;
    const w01 = Math.max(0, Math.min(1, weight));

    ctx.fillStyle = '#333';
    this._roundRect(ctx, trackX0, trackY - TRACK_H / 2, tw, TRACK_H, TRACK_H / 2);
    ctx.fill();
    ctx.fillStyle = '#3b82f6';
    this._roundRect(ctx, trackX0, trackY - TRACK_H / 2, tw * w01, TRACK_H, TRACK_H / 2);
    ctx.fill();

    const hx = trackX0 + tw * w01;
    ctx.beginPath();
    ctx.arc(hx, trackY, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#e6e6e6';
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.stroke();

    const r = this._rowRect(name, top, false);
    r.trackX0 = trackX0; r.trackX1 = trackX1; r.trackY = trackY;
    // Generous rectangular hit zone covering the eye on the header line.
    r.eye = { x0: 0, x1: nameStart - 2, y0: top, y1: top + 26 };
    this._rows.push(r);
  }

  _rowRect(name, top, isBase) {
    return { name, top, h: isBase ? BASE_H : ROW_H, isBase };
  }

  // ── Pointer handling ─────────────────────────────────────────────────────────
  _local(e) {
    const rect = this._canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitToolbar(p) {
    return this._toolbarBtns.find(b =>
      p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) || null;
  }

  _hitRow(p) {
    return this._rows.find(r => p.y >= r.top && p.y < r.top + r.h) || null;
  }

  // ── DOM event wrappers ───────────────────────────────────────────────────────
  _onDown(e) {
    e.preventDefault();
    try { this._canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this._pointerDown(this._local(e), e.altKey);
  }
  _onMove(e) { this._pointerMove(this._local(e)); }

  // VR entry point: canvas-space coords + a `solo` modifier (secondary trigger).
  // phase ∈ 'down' | 'move' | 'up'.
  vrPointer(x, y, phase, solo = false) {
    if (phase === 'down')      this._pointerDown({ x, y }, solo);
    else if (phase === 'move') this._pointerMove({ x, y });
    else                       this._pointerUp();
  }

  // ── Point-based core (shared by mouse/pen/touch and VR ray) ──────────────────
  _pointerDown(p, solo = false) {
    const btn = this._hitToolbar(p);
    if (btn) { this._onToolbar(btn.id); return; }

    const row = this._hitRow(p);
    if (!row) return;

    // Eye, left of the name: plain click → mute/unmute this layer; modifier
    // (Alt on desktop / secondary trigger in VR) → solo (isolate it; again
    // restores the prior visibility of all).
    if (!row.isBase && row.eye &&
        p.x >= row.eye.x0 && p.x <= row.eye.x1 &&
        p.y >= row.eye.y0 && p.y <= row.eye.y1) {
      const mesh = this._mesh();
      if (mesh) {
        if (solo) window._animationRegistry.toggleBlendshapeSolo(mesh, row.name);
        else      window._animationRegistry.toggleBlendshapeMute(mesh, row.name);
      }
      this.draw();
      return;
    }

    // Slider band (lower line) → begin weight drag. Slider works on ANY layer at
    // any time, regardless of which layer is active.
    if (!row.isBase && row.trackX0 != null && p.y >= row.trackY - 12 && p.y <= row.trackY + 12) {
      this._dragName   = row.name;
      this._dragStartW = this._weightOf(row.name);
      this._dragMoved  = false;
      this._applyWeightFromX(row, p.x);
      return;
    }

    // Click anywhere else on the row → make it the active sculpt layer (Base row
    // deactivates). Double-tap the name to rename (desktop only).
    this._selectLayer(row.isBase ? null : row.name);
    this._handleTapForRename(row);
  }

  _pointerMove(p) {
    if (!this._dragName) return;
    const row = this._rows.find(r => r.name === this._dragName);
    if (!row) return;
    this._dragMoved = true;
    this._applyWeightFromX(row, p.x);
  }

  _pointerUp() {
    if (!this._dragName) return;
    const name = this._dragName;
    const oldW = this._dragStartW;
    const newW = this._weightOf(name);
    this._dragName = null;

    // Push a single undo step for the whole drag if the value actually changed.
    if (this._dragMoved && oldW !== newW && window.app?.getStateManager) {
      const mesh = this._mesh();
      window.app.getStateManager().pushStateCustom(
        () => { window._animationRegistry.setBlendshapeWeight(mesh, name, oldW); this.draw(); },
        () => { window._animationRegistry.setBlendshapeWeight(mesh, name, newW); this.draw(); },
        false,
        'Change Blendshape Weight'
      );
    }
  }

  _applyWeightFromX(row, x) {
    const tw = row.trackX1 - row.trackX0;
    const w = Math.max(0, Math.min(1, (x - row.trackX0) / tw));
    const mesh = this._mesh();
    if (mesh) window._animationRegistry.setBlendshapeWeight(mesh, row.name, w);
    this.draw();
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  _onToolbar(id) {
    const mesh = this._mesh();
    if (!mesh) return;
    const reg = window._animationRegistry;
    if (id === 'new') {
      // No VR keyboard yet — default-name, rename later (dblclick).
      const track = reg.tracks.get(mesh.getID());
      const existing = track?.blendshapes ? [...track.blendshapes.keys()] : [];
      let i = existing.length + 1;
      while (existing.includes(`Layer ${i}`)) i++;
      const name = `Layer ${i}`;
      reg.createBlendshape(mesh, name);
      this._afterStructureChange(); // row count changed → resize canvas (desktop)
      this._selectLayer(name);      // make it active + sculptable (weight 1) immediately
    } else if (id === 'del') {
      const name = track_editing(reg, mesh);
      if (!name) return;
      reg.deleteBlendshape(mesh, name);
      this._afterStructureChange();
    }
  }

  // Layer count changed: desktop resizes the canvas to the new row count (which
  // redraws); VR has a fixed-size canvas, so just redraw.
  _afterStructureChange() {
    if (this._vrMode) this.draw();
    else this._relayout();
  }

  _selectLayer(name) {
    const mesh = this._mesh();
    const reg = window._animationRegistry;
    if (!mesh) return;
    const track = reg.tracks.get(mesh.getID());
    const cur = track?.editingBlendshape || null;

    if (cur) reg.exitBlendshapeEditMode(mesh);
    if (name && name !== cur) {
      reg.enterBlendshapeEditMode(mesh, name);
      // Snap the layer fully on so "click row → sculpt" works immediately.
      // Sculpting is only permitted at weight 1 (see SculptManager gate); a fresh
      // or animated-down layer would otherwise be silently un-sculptable.
      if (Math.abs(this._weightOf(name) - 1) > 1e-4) {
        reg.setBlendshapeWeight(mesh, name, 1);
      }
    }
    this.draw();
  }

  // Signals a blocked sculpt (active layer not at weight 1 / not visible): the
  // active layer's name flashes red and fades back to normal. Non-blocking, no
  // text to translate. Called from the SculptManager gate when a stroke is
  // rejected (and the app reverts to a camera move).
  flash() {
    this._flashName  = this._track()?.editingBlendshape || null;
    if (!this._flashName) return;

    // Desktop only: if the Blendshapes tab isn't the visible panel, the name flash
    // can't be seen — pulse the sidebar tab icon red instead. (In VR the name
    // flash on the mesh is always visible, so fall through to it.)
    if (!this._vrMode && this._host && this._host.offsetParent === null && this._tabEl) {
      this._tabEl.classList.remove('bs-flash');
      void this._tabEl.offsetWidth; // restart the CSS animation
      this._tabEl.classList.add('bs-flash');
      clearTimeout(this._tabFlashTimer);
      this._tabFlashTimer = setTimeout(() => this._tabEl.classList.remove('bs-flash'), 500);
      return;
    }

    this._flashDur   = 450;
    this._flashUntil = performance.now() + this._flashDur;
    if (this._flashRaf) return; // a fade is already running
    const tick = () => {
      this.draw();
      if (this._flashUntil - performance.now() > 0) {
        this._flashRaf = requestAnimationFrame(tick);
      } else {
        this._flashRaf = null;
        this.draw(); // final clean repaint
      }
    };
    this._flashRaf = requestAnimationFrame(tick);
  }

  // 1 → fully red, 0 → no flash, for the currently-flashing layer name.
  _flashAlpha(name) {
    if (name !== this._flashName || !this._flashUntil) return 0;
    return Math.max(0, Math.min(1, (this._flashUntil - performance.now()) / this._flashDur));
  }

  _handleTapForRename(row) {
    if (row.isBase || this._vrMode) return; // no DOM input / VR keyboard yet
    const now = performance.now();
    if (this._lastTapName === row.name && now - this._lastTapTime < 350) {
      this._beginRename(row);
      this._lastTapName = null;
    } else {
      this._lastTapName = row.name;
      this._lastTapTime = now;
    }
  }

  _beginRename(row) {
    if (this._renameInput) this._endRename(false);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = row.name;
    Object.assign(input.style, {
      position: 'absolute', left: (TRACK_X0) + 'px',
      top: (this._canvas.offsetTop + row.top + 4) + 'px',
      width: (this._cssW - TRACK_X0 - PAD) + 'px', height: '20px',
      font: '12px sans-serif', background: '#111', color: '#fff',
      border: '1px solid #3b82f6', borderRadius: '3px', zIndex: '50', padding: '0 4px',
      boxSizing: 'border-box',
    });
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    // Keep keystrokes from reaching the main app's shortcut handler.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._endRename(true);
      else if (e.key === 'Escape') this._endRename(false);
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => this._endRename(true));

    this._host.style.position = this._host.style.position || 'relative';
    this._host.appendChild(input);
    this._renameInput = input;
    this._renameName  = row.name;
    setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
  }

  _endRename(commit) {
    const input = this._renameInput;
    if (!input) return;
    this._renameInput = null;
    const oldName = this._renameName;
    const newName = input.value.trim();
    input.remove();
    if (commit && newName && newName !== oldName) {
      const mesh = this._mesh();
      if (mesh) window._animationRegistry.renameBlendshape(mesh, oldName, newName);
    }
    this.draw();
  }

  // ── Small helpers ────────────────────────────────────────────────────────────
  _ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// Returns the name of the layer currently in edit mode for `mesh`, or null.
function track_editing(reg, mesh) {
  return reg.tracks.get(mesh.getID())?.editingBlendshape || null;
}
