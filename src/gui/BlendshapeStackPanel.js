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

import { arkitByRegion, arkitEntry, arkitUnifiedFor } from '../editing/ArkitBlendshapes.js';
import { Theme } from './theme.js';

// FontAwesome 6 Free (Solid, weight 900) glyphs — drawn on the canvas, never emoji.
const FA = {
  plus:  '\uf067', // fa-plus
  trash: '\uf1f8', // fa-trash-can
  close:    '\uf00d', // fa-xmark (close VR panel)
  eye:      '\uf06e', // fa-eye (visible)
  eyeSlash: '\uf070', // fa-eye-slash (muted)
  lock:     '\uf023', // fa-lock
  lockOpen: '\uf3c1', // fa-lock-open
  split:    '\uf337', // fa-arrows-left-right (split symmetric shape into L/R)
  combine:  '\uf387', // fa-code-merge (combine L/R halves back into one symmetric shape)
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

    // Hovered element { name, part } for hover highlights ('row'|'eye'|'lock'|'slider').
    this._hover = null;

    // ARKit name picker overlay (null = closed). When open it captures all input.
    this._picker = null;
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
    this._canvas.addEventListener('pointerleave', () => this.clearHover());
    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Mouse wheel scrolls the ARKit picker overlay (otherwise it scrolls the sidebar).
    this._canvas.addEventListener('wheel', (e) => {
      if (!this._picker) return;
      e.preventDefault();
      const pk = this._picker;
      pk.scroll = Math.max(0, Math.min(pk.maxScroll, pk.scroll + e.deltaY));
      this.draw();
    }, { passive: false });

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

  // Desktop canvas height while the picker overlay is open (it needs room to show the
  // list; the layer-stack content height is far too short when there are few layers).
  _pickerCanvasH() {
    return Math.min(440, Math.max(220, Math.floor((window.innerHeight || 800) * 0.6)));
  }

  _applyCanvasSize(cssH) {
    this._cssH = cssH;
    this._dpr  = window.devicePixelRatio || 1;
    this._canvas.style.height = cssH + 'px';
    this._canvas.width  = Math.round(this._cssW * this._dpr);
    this._canvas.height = Math.round(this._cssH * this._dpr);
    this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
  }

  _relayout() {
    if (!this._host) return;
    this._cssW = this._host.clientWidth || 280;
    this._applyCanvasSize(this._picker ? this._pickerCanvasH() : this._contentHeight());
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
    ctx.fillStyle = Theme.base; // match the HTML menu panel base (graded the same in VR)
    ctx.fillRect(0, 0, W, H);

    this._rows = [];
    this._toolbarBtns = [];

    this._drawToolbar(ctx, W);

    const mesh = this._mesh();
    if (!mesh) {
      ctx.fillStyle = Theme.overlay0;
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

    if (this._picker) this._drawPicker(ctx, W, H);
  }

  _drawToolbar(ctx, W) {
    ctx.fillStyle = Theme.mantle;
    ctx.fillRect(0, 0, W, TOOLBAR_H);
    ctx.strokeStyle = Theme.surface0;
    ctx.beginPath();
    ctx.moveTo(0, TOOLBAR_H - 0.5); ctx.lineTo(W, TOOLBAR_H - 0.5);
    ctx.stroke();

    const bw = 34, bh = 26, by = (TOOLBAR_H - bh) / 2;
    const newBtn = { id: 'new', x: PAD, y: by, w: bw, h: bh };
    const delBtn = { id: 'del', x: PAD + bw + 6, y: by, w: bw, h: bh };
    this._toolbarBtns.push(newBtn, delBtn);

    this._drawIconBtn(ctx, newBtn, FA.plus,  Theme.blue, this._hover?.btn === 'new');
    const canDel = !!this._track()?.editingBlendshape;
    this._drawIconBtn(ctx, delBtn, FA.trash, canDel ? '#e06c6c' : Theme.surface2, this._hover?.btn === 'del');
    // VR close is a corner mesh owned by Scene (same style as the timeline), not an
    // on-canvas button — see Scene._vrBlendCloseBtn.
  }

  _drawIconBtn(ctx, b, glyph, color, hot = false) {
    ctx.fillStyle = hot ? Theme.surface1 : Theme.surface0;
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
    const track  = this._track();
    const muted  = !isBase && (track?.blendshapeMuted?.has(name) || false);
    const soloed = !isBase && track?.blendshapeSolo === name;
    const locked = isBase ? !!track?.baseLocked : !!track?.blendshapeLocked?.has(name);
    const hov    = (this._hover && this._hover.name === name) ? this._hover.part : null;

    // Row background: active (blue) wins; otherwise a faint hover tint.
    if (isActive) {
      ctx.fillStyle = 'rgba(137,180,250,0.16)'; ctx.fillRect(0, top, W, h);
      ctx.fillStyle = Theme.blue;               ctx.fillRect(0, top, 3, h); // accent bar
    } else if (hov) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, top, W, h);
    }
    ctx.strokeStyle = Theme.surface0;
    ctx.beginPath(); ctx.moveTo(0, top + h - 0.5); ctx.lineTo(W, top + h - 0.5); ctx.stroke();

    const iconCy = isBase ? top + h / 2 : top + 16;
    const r = this._rowRect(name, top, isBase);
    ctx.textBaseline = 'middle';

    // Eye (non-base only) — soloed=amber, muted=red-slash, else grey (white on hover).
    if (!isBase) {
      const eyeHot = hov === 'eye';
      ctx.fillStyle = soloed ? '#f2b53c' : (muted ? '#e06c6c' : (eyeHot ? Theme.text : Theme.overlay1));
      ctx.font = '900 13px "Font Awesome 6 Free"';
      ctx.textAlign = 'center';
      ctx.fillText(muted ? FA.eyeSlash : FA.eye, NAME_X + 7, iconCy + 0.5);
      r.eye = { x0: 0, x1: NAME_X + 16, y0: top, y1: top + 26 };
    }
    // Lock (all rows) — locked=amber, unlocked=dim open-lock (brighten on hover).
    const lockCx  = isBase ? NAME_X + 7 : NAME_X + 25;
    const lockHot = hov === 'lock';
    ctx.fillStyle = locked ? (lockHot ? '#ffd9a0' : '#f2b53c') : (lockHot ? Theme.subtext : Theme.surface1);
    ctx.font = '900 12px "Font Awesome 6 Free"';
    ctx.textAlign = 'center';
    ctx.fillText(locked ? FA.lock : FA.lockOpen, lockCx, iconCy + 0.5);
    r.lock = isBase ? { x0: 0, x1: NAME_X + 18, y0: top, y1: top + h }
                    : { x0: NAME_X + 16, x1: NAME_X + 36, y0: top, y1: top + 26 };
    ctx.textAlign = 'left';

    const nameStart = isBase ? NAME_X + 24 : NAME_X + 40;

    // Name (brightens on row hover; dim when muted/locked-base).
    const nameHot = hov === 'row';
    ctx.fillStyle = isBase ? (locked ? Theme.subtext : Theme.subtext)
                          : (muted ? Theme.overlay0 : (isActive || nameHot ? Theme.text : Theme.text));
    ctx.font = (isActive ? '600 ' : '') + '12px sans-serif';
    const valW = isBase ? PAD : 36;
    const nameMaxX = W - PAD - valW;
    const nameText = this._ellipsize(ctx, name, nameMaxX - nameStart);
    const nameY = isBase ? h / 2 + top : top + 16;
    ctx.fillText(nameText, nameStart, nameY);
    const fa = isBase ? 0 : this._flashAlpha(name);
    if (fa > 0) {
      ctx.save(); ctx.globalAlpha = fa; ctx.fillStyle = '#ff4d4d';
      ctx.fillText(nameText, nameStart, nameY); ctx.restore();
    }

    if (isBase) { this._rows.push(r); return; }

    // Right slot: symmetric ARKit shapes get a split button (→ L/R); a recognised L/R
    // half gets a combine button (→ back to one symmetric shape); everything else keeps
    // the numeric readout (the weight is already shown by the slider).
    const sym  = arkitEntry(name)?.category === 'symmetric';
    const half = !sym ? arkitUnifiedFor(name) : null;
    const sx = W - PAD - 10;
    if (sym) {
      const hot = hov === 'split';
      ctx.fillStyle = hot ? '#cfe1ff' : Theme.surface2;
      ctx.font = '900 13px "Font Awesome 6 Free"'; ctx.textAlign = 'center';
      ctx.fillText(FA.split, sx, top + 16 + 0.5);
      ctx.textAlign = 'left';
      r.split = { x0: W - PAD - 34, x1: W, y0: top, y1: top + 26 };
    } else if (half) {
      const hot = hov === 'combine';
      ctx.fillStyle = hot ? '#d6ffcf' : '#6b865b';
      ctx.font = '900 13px "Font Awesome 6 Free"'; ctx.textAlign = 'center';
      ctx.fillText(FA.combine, sx, top + 16 + 0.5);
      ctx.textAlign = 'left';
      r.combine = { x0: W - PAD - 34, x1: W, y0: top, y1: top + 26 };
    } else {
      ctx.fillStyle = muted ? Theme.overlay0 : Theme.overlay1;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(weight.toFixed(2), W - PAD, top + 16);
      ctx.textAlign = 'left';
    }

    // Slider (second line) — thicker/white thumb on hover.
    const trackX0 = TRACK_X0, trackX1 = W - PAD, trackY = top + 33;
    const tw = trackX1 - trackX0;
    const w01 = Math.max(0, Math.min(1, weight));
    const sliderHot = hov === 'slider';
    ctx.fillStyle = sliderHot ? Theme.surface1 : Theme.surface0;
    this._roundRect(ctx, trackX0, trackY - TRACK_H / 2, tw, TRACK_H, TRACK_H / 2); ctx.fill();
    ctx.fillStyle = Theme.blue;
    this._roundRect(ctx, trackX0, trackY - TRACK_H / 2, tw * w01, TRACK_H, TRACK_H / 2); ctx.fill();
    const hx = trackX0 + tw * w01;
    ctx.beginPath(); ctx.arc(hx, trackY, sliderHot ? 8 : 7, 0, Math.PI * 2);
    ctx.fillStyle = sliderHot ? Theme.text : Theme.text; ctx.fill();
    ctx.strokeStyle = Theme.blue; ctx.stroke();

    r.trackX0 = trackX0; r.trackX1 = trackX1; r.trackY = trackY;
    this._rows.push(r);
  }

  // Which sub-element of a row a point lands on: 'lock' | 'eye' | 'slider' | 'row'.
  _classifyHit(p) {
    const row = this._hitRow(p);
    if (!row) return { row: null, part: null };
    const inRect = (z) => z && p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1;
    if (inRect(row.lock))  return { row, part: 'lock' };
    if (inRect(row.eye))   return { row, part: 'eye' };
    if (inRect(row.split))   return { row, part: 'split' };
    if (inRect(row.combine)) return { row, part: 'combine' };
    if (!row.isBase && row.trackX0 != null && p.y >= row.trackY - 12 && p.y <= row.trackY + 12)
      return { row, part: 'slider' };
    return { row, part: 'row' };
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
    if (this._picker) { this._pickerDown(p); return; }
    const btn = this._hitToolbar(p);
    if (btn) { this._onToolbar(btn.id); return; }

    const { row, part } = this._classifyHit(p);
    if (!row) return;
    const mesh = this._mesh();
    const reg  = window._animationRegistry;

    // Lock toggle (all rows incl. Base) — a locked layer/cage can't be sculpted.
    if (part === 'lock') {
      if (mesh) reg.toggleBlendshapeLock(mesh, row.isBase ? 'Base' : row.name);
      this.draw();
      return;
    }
    // Eye (non-base): plain → mute/unmute; modifier (Alt / secondary trigger) → solo.
    if (part === 'eye' && !row.isBase) {
      if (mesh) (solo ? reg.toggleBlendshapeSolo : reg.toggleBlendshapeMute).call(reg, mesh, row.name);
      this.draw();
      return;
    }
    // Split (symmetric layers) → generate the two ARKit L/R halves, replacing this layer.
    if (part === 'split' && !row.isBase) {
      if (mesh) {
        const ok = reg.splitBlendshapeLR(mesh, row.name);
        if (ok) this._afterStructureChange();
        else this.flash();
      }
      return;
    }
    // Combine (L/R half) → merge the pair back into one symmetric shape.
    if (part === 'combine' && !row.isBase) {
      if (mesh) {
        const ok = reg.combineBlendshapeLR(mesh, row.name);
        if (ok) this._afterStructureChange();
        else this.flash();
      }
      return;
    }
    // Slider band → begin weight drag (works on any layer regardless of active).
    if (part === 'slider' && !row.isBase) {
      this._dragName   = row.name;
      this._dragStartW = this._weightOf(row.name);
      this._dragMoved  = false;
      this._applyWeightFromX(row, p.x);
      return;
    }
    // Row body → make it the active sculpt layer (Base deactivates). Double-tap → rename.
    this._selectLayer(row.isBase ? null : row.name);
    this._handleTapForRename(row);
  }

  _pointerMove(p) {
    if (this._picker) { this._pickerMove(p); return; }
    if (this._dragName) {
      const row = this._rows.find(r => r.name === this._dragName);
      if (!row) return;
      this._dragMoved = true;
      this._applyWeightFromX(row, p.x);
      return;
    }
    // Not dragging → hover feedback. Redraw only when the hovered element changes.
    let h;
    const btn = this._hitToolbar(p);
    if (btn) {
      h = { btn: btn.id };
    } else {
      const { row, part } = this._classifyHit(p);
      h = row ? { name: row.name, part } : null;
    }
    if (this._hoverChanged(h)) { this._hover = h; this.draw(); }
  }

  _hoverChanged(h) {
    const a = this._hover;
    if (!a && !h) return false;
    if (!a || !h) return true;
    return a.btn !== h.btn || a.name !== h.name || a.part !== h.part;
  }

  // Clear hover (DOM pointerleave, or VR ray leaving the panel — called by Scene).
  clearHover() { if (this._hover) { this._hover = null; this.draw(); } }

  _pointerUp() {
    if (this._picker) { this._pickerUp(); return; }
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
      this._openPicker();           // ARKit name picker (with a Blank-layer quick option)
    } else if (id === 'del') {
      const name = track_editing(reg, mesh);
      if (!name) return;
      reg.deleteBlendshape(mesh, name);
      this._afterStructureChange();
    }
  }

  // ── ARKit name picker ─────────────────────────────────────────────────────────
  // Create an unnamed "Layer N" (the old quick-new behaviour); user renames via dblclick.
  _createBlankLayer() {
    const mesh = this._mesh();
    if (!mesh) return null;
    const reg = window._animationRegistry;
    const track = reg.tracks.get(mesh.getID());
    const existing = track?.blendshapes ? [...track.blendshapes.keys()] : [];
    let i = existing.length + 1;
    while (existing.includes(`Layer ${i}`)) i++;
    const name = `Layer ${i}`;
    reg.createBlendshape(mesh, name);
    this._afterStructureChange();
    this._selectLayer(name);
    return name;
  }

  _openPicker() {
    if (!this._mesh()) return;
    this._picker = { scroll: 0, items: [], contentH: 0, maxScroll: 0, listTop: 0,
                     pressActive: false, pressItem: null, pressY: 0, scrollStart: 0,
                     dragMoved: false, closeHit: false, hover: null };
    this._buildPickerItems();
    if (this._host) this._relayout(); else this.draw(); // desktop: grow canvas to fit list
  }

  _closePicker() {
    this._picker = null;
    if (this._host) this._relayout(); else this.draw(); // desktop: restore content height
  }

  // VR thumbstick scroll — Scene routes here when the ray is on this panel. Drives the
  // picker overlay's internal scroll when open (matches the mouse-wheel path).
  onVRScroll(delta) {
    const pk = this._picker;
    if (!pk) return;
    pk.scroll = Math.max(0, Math.min(pk.maxScroll, pk.scroll + delta));
    this.draw();
  }

  // Build the scrollable content list (content-space y). Marks already-created names.
  _buildPickerItems() {
    const pk = this._picker;
    const track = this._track();
    const have = new Set(track?.blendshapes ? track.blendshapes.keys() : []);
    const HEAD = 20, ENT = 24;
    const items = [];
    let cy = 0;
    items.push({ kind: 'blank', label: '+  Blank layer', cy0: cy, cy1: cy + ENT }); cy += ENT + 4;
    for (const { region, entries } of arkitByRegion()) {
      items.push({ kind: 'header', label: region, cy0: cy, cy1: cy + HEAD }); cy += HEAD;
      for (const e of entries) {
        items.push({ kind: 'entry', name: e.name, category: e.category,
                     exists: have.has(e.name), cy0: cy, cy1: cy + ENT }); cy += ENT;
      }
    }
    pk.items = items;
    pk.contentH = cy;
  }

  _drawPicker(ctx, W, H) {
    const pk = this._picker;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);

    const TITLE_H = 28;
    ctx.fillStyle = Theme.surface0; ctx.fillRect(0, 0, W, TITLE_H);
    ctx.fillStyle = Theme.text; ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Add shape', PAD, TITLE_H / 2);
    ctx.fillStyle = pk.hover === 'close' ? Theme.text : Theme.subtext;
    ctx.font = '900 14px "Font Awesome 6 Free"'; ctx.textAlign = 'center';
    ctx.fillText(FA.close, W - PAD - 8, TITLE_H / 2 + 0.5);
    pk.closeRect = { x0: W - PAD - 22, x1: W, y0: 0, y1: TITLE_H };
    ctx.textAlign = 'left';

    const listTop = TITLE_H;
    pk.listTop = listTop;
    const viewH = H - listTop;
    pk.maxScroll = Math.max(0, pk.contentH - viewH);
    pk.scroll = Math.max(0, Math.min(pk.scroll, pk.maxScroll));

    ctx.save();
    ctx.beginPath(); ctx.rect(0, listTop, W, viewH); ctx.clip();
    ctx.fillStyle = Theme.mantle; ctx.fillRect(0, listTop, W, viewH);

    const catColor = { symmetric: Theme.blue, center: Theme.subtext, directional: '#f2b53c' };
    for (const it of pk.items) {
      const y0 = listTop + it.cy0 - pk.scroll;
      const y1 = listTop + it.cy1 - pk.scroll;
      if (y1 < listTop || y0 > H) continue;
      const midY = (y0 + y1) / 2;
      if (it.kind === 'header') {
        ctx.fillStyle = Theme.crust; ctx.fillRect(0, y0, W, it.cy1 - it.cy0);
        ctx.fillStyle = Theme.overlay1; ctx.font = '700 10px sans-serif';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(it.label.toUpperCase(), PAD, midY);
        continue;
      }
      if (pk.pressItem === it && !pk.dragMoved) {
        ctx.fillStyle = 'rgba(137,180,250,0.18)'; ctx.fillRect(0, y0, W, it.cy1 - it.cy0);
      }
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      if (it.kind === 'blank') {
        ctx.fillStyle = '#cfe1ff'; ctx.font = '600 12px sans-serif';
        ctx.fillText(it.label, PAD, midY);
        continue;
      }
      const col = catColor[it.category] || Theme.subtext;
      ctx.fillStyle = it.exists ? Theme.surface1 : col;
      ctx.beginPath(); ctx.arc(PAD + 3, midY, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = it.exists ? Theme.surface2 : Theme.text;
      ctx.font = '12px sans-serif';
      ctx.fillText(it.name, PAD + 14, midY);
      if (it.exists) {
        ctx.fillStyle = '#5a9a5a'; ctx.font = '900 11px "Font Awesome 6 Free"';
        ctx.textAlign = 'right'; ctx.fillText('', W - PAD, midY + 0.5);
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();

    if (pk.maxScroll > 0) {
      const trackH = viewH;
      const thumbH = Math.max(24, trackH * viewH / pk.contentH);
      const thumbY = listTop + (trackH - thumbH) * (pk.scroll / pk.maxScroll);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      this._roundRect(ctx, W - 5, thumbY, 3, thumbH, 1.5); ctx.fill();
    }
  }

  _pickerItemAt(p) {
    const pk = this._picker;
    const cr = pk.closeRect;
    if (cr && p.x >= cr.x0 && p.x <= cr.x1 && p.y >= cr.y0 && p.y <= cr.y1) return { kind: 'close' };
    if (p.y < pk.listTop) return null;
    const contentY = p.y - pk.listTop + pk.scroll;
    return pk.items.find(it => it.kind !== 'header' && contentY >= it.cy0 && contentY < it.cy1) || null;
  }

  _pickerDown(p) {
    const pk = this._picker;
    const it = this._pickerItemAt(p);
    pk.closeHit  = !!(it && it.kind === 'close');
    pk.pressItem = (it && it.kind !== 'close') ? it : null;
    pk.pressActive = true; pk.pressY = p.y; pk.scrollStart = pk.scroll; pk.dragMoved = false;
    this.draw();
  }

  _pickerMove(p) {
    const pk = this._picker;
    if (pk.pressActive) {
      const dy = p.y - pk.pressY;
      if (Math.abs(dy) > 6) pk.dragMoved = true;
      if (pk.dragMoved && pk.maxScroll > 0) pk.scroll = Math.max(0, Math.min(pk.maxScroll, pk.scrollStart - dy));
      this.draw();
    } else {
      const it = this._pickerItemAt(p);
      const h = it ? (it.kind === 'close' ? 'close' : null) : null;
      if (h !== pk.hover) { pk.hover = h; this.draw(); }
    }
  }

  _pickerUp() {
    const pk = this._picker;
    const wasDrag = pk.dragMoved, closeHit = pk.closeHit, item = pk.pressItem;
    pk.pressActive = false; pk.pressItem = null; pk.closeHit = false;
    if (wasDrag) { this.draw(); return; }
    if (closeHit) { this._closePicker(); return; }
    if (item) { this._pickerActivate(item); return; }
    this.draw();
  }

  _pickerActivate(it) {
    const mesh = this._mesh();
    if (!mesh) { this._closePicker(); return; }
    if (it.kind === 'blank') { this._createBlankLayer(); this._closePicker(); return; }
    // ARKit entry — if it already exists just select it, else create it.
    if (it.exists) { this._selectLayer(it.name); this._closePicker(); return; }
    window._animationRegistry.createBlendshape(mesh, it.name);
    this._afterStructureChange();
    this._selectLayer(it.name);
    this._closePicker();
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
      font: '12px sans-serif', background: Theme.crust, color: Theme.text,
      border: '1px solid #89b4fa', borderRadius: '3px', zIndex: '50', padding: '0 4px',
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
