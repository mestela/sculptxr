import TimelineHelper from './TimelineHelper.js';
import { xfGroup, xfRead, xfWrite, xfTanPrefix, xfTanGet,
         XF_GROUPS, xfVisible, xfIsVisible, xfToggleVisible,
         xfWeightTrack, xfChanVisible, xfSetChanVisible,
         xfTimes } from '../editing/xfChannel.js';
import { Theme } from './theme.js';
import IKSolver from '../editing/IKSolver.js';
import PhysicsBones from '../editing/PhysicsBones.js';

// Darker, higher-contrast blue (matches the desktop sidebar sliders) for active buttons
// and the playhead — Theme.blue (#89b4fa) is too light against white text to read in VR.
const TL_ACCENT = '#3b82f6';


// Deep trace for the graph editor, off by default. `window._tlTrace = true` in the console and
// every key hit-test reports what it compared against what, which is the only way to tell
// "the key is not where it is drawn" from "the click never arrived" from "nothing is selected".
const tlLog = (...a) => { if (window._tlTrace) console.log('[tl]', ...a); };

// Timeline header height (toolbar row + gutter key-mode row + frame ruler). Single
// source of truth — referenced everywhere the lanes/ruler/hit-tests offset from the
// header. Bump this alone to resize the header.
const HEADER_H = 90;
const TOOLBAR_BOTTOM = 55;
const KEY_DRAG_FREE_THRESHOLD = 50;
const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];

// Height of the T|R|S strip at the top of the graph editor's gutter. The channel rows start
// below it, so every place that maps a row index to a y — drawing, hit-testing and
// scroll-into-view alike — offsets by this. One constant, or they drift apart and clicking a
// row selects its neighbour.
const XF_SEG_H = 20;
// Half what it was. At 4px the dots crowded a dense curve and hid the shape they sit on; the
// HIT radius is separate (isKeyHovered uses its own tolerance), so they stay just as easy to
// grab. matt: "keyframe circles are too big, make them half their current size."
const KEY_R = 2;

export default class GuiTimeline {
  constructor(main) {
    this._main = main;
    this._container = null;
    this._canvas = null;
    this._ctx = null;
    this._visible = false;
    this._isDraggingPlayhead = false;
    this._isDraggingMarquee = false;
    this._isDraggingKeyframe = false;
    this._speedMenuOpen = false;
    this._contextMenuOpen = false;
    this._activeKeyframeTrack = null;
    this._activeKeyframeIndex = undefined;
    this._activeKeyframeType = null;
    this._keyDragStartRx = 0;
    this._keyDragStartRy = 0;
    this._keyDragStartTime = 0;
    this._animSelectedKeysInitialTimes = null;
    this._marqueeStart = null;
    this._marqueeEnd = null;
    this._activeTransformHandle = null;
    this._transformStartRx = 0;
    this._animTransformInitialBox = null;

    // 'dope' or 'graph' — restored from the persisted preference if set.
    // Default to the graph editor on all platforms (VR already preferred it);
    // the persisted vrTimelineMode pref still overrides if the user picked dope.
    this._mode = (window.getOptionsURL?.().vrTimelineMode) || 'graph';
    this._panY = 0;
    this._zoomY = 100.0; // Default scale: 1 unit = 100 pixels
    this._activeKeyframeChannel = null;
    this._keyDragStartVal = 0;
    this._isDraggingTangent = false;
    this._activeTangentTrack = null;
    this._activeTangentIndex = undefined;
    this._activeTangentSide = null;
    this._activeTangentKx = 0;
    this._activeTangentKy = 0;
    this._activeTangentType = null;
    this._activeTangentBsName = null;
    this._isPanningGraph = false;
    this._isPanningDope = false;
    this._layerDotDrag = null;
    this._isZoomingGraph = false;
    this._panStartRy = 0;
    this._panStartOffsetY = 0;
    this._zoomStartRy = 0;
    this._zoomStartScaleY = 100.0;
    this._isResizingPanel = false;
    this._touchMap = new Map(); // [Step 1] pointerId → {x,y} for multi-touch scroll
    this._isTouchScrolling = false;
    // Shape-layer multiselect (#34) — set of layer indices for _selShapeLayerMesh; 2+ → Combine.
    this._selShapeLayerMesh = null;
    this._selShapeLayerIdxs = new Set();
    // Gutter scroll (graph editor channel list)
    this._gutterScrollY = 0;
    this._gutterMaxScroll = 0;
    this._isDraggingGutter = false;
    this._gutterDragStartY = 0;
    this._gutterDragStartScroll = 0;
    this._lastMouseX = -1;
    this._lastMouseY = -1;
    this._isMouseOver = false;
    window._animTiedTangents = true;
    this._viewStart = undefined;
    this._viewDuration = undefined;
    // Blendshape value scrub (click+drag horizontal on channel label)
    this._bsScrubName        = null;
    this._bsScrubMesh        = null;
    this._bsScrubActive      = false;
    this._bsScrubZone        = null; // 'eye' | 'name'
    this._bsScrubStartX      = 0;
    this._bsScrubStartWeight = 0;
    this._bsScrubSnapBefore  = null; // bsTrack snapshot before scrub gesture, for undo
    // Graph XY pan — left-drag on empty graph space (no key/tangent hit)
    this._isPanningGraphXY    = false;
    this._panXYStartRx        = 0;
    this._panXYStartRy        = 0;
    this._panXYStartViewStart = 0;
    this._panXYStartPanY      = 0;
    this.initDOM();
    this.startLoop();
  }

  initDOM() {
    this._container = document.createElement('div');
    // Named so other on-screen controls can keep out from under it — the modifier button rides
    // above this panel, and a querySelector on inline styles would break the first time one of
    // them changed.
    this._container.id = 'timeline-panel';
    this._container.style.position = 'fixed';
    this._container.style.bottom = '0';
    this._container.style.left = '0';
    this._container.style.height = '150px'; // Slightly shorter for desktop
    this._container.style.backgroundColor = Theme.base;
    this._container.style.zIndex = '2000'; // High z-index to be on top
    this._container.style.display = 'none'; // Hidden by default
    this._container.style.borderTop = '2px solid #45475a';

    this._canvas = document.createElement('canvas');
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    // Prevent iPadOS from intercepting pen/touch events for Scribble or scroll.
    // Must be on both container and canvas so no ancestor triggers system gestures.
    this._canvas.style.touchAction    = 'none';
    this._container.style.touchAction = 'none';
    this._container.appendChild(this._canvas);
    document.body.appendChild(this._container);

    this._ctx = this._canvas.getContext('2d');

    window.addEventListener('resize', this.onResize.bind(this));

    // Use Pointer Events for all input (mouse, pen, touch) — they fire for every
    // device type so we don't need separate mouse-vs-touch paths.  `button` and
    // `clientX/Y` have the same meaning as on MouseEvent, so the existing
    // onMouseDown/Move/Up handlers work without modification.
    this._canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { this._canvas.setPointerCapture(e.pointerId); } catch (_) {} // keep move/up on this element
      this._isMouseOver = true;
      // [Step 1] Track touch pointers for 2-finger scroll/zoom.
      if (e.pointerType === 'touch') {
        this._touchMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._touchMap.size === 2) {
          this._cancelActiveAction();
          this._isTouchScrolling = true;
          this._touchScrollPrev = this._getTouchCentroidAndDist();
          return; // don't pass 2nd finger down to onMouseDown
        }
        if (this._isTouchScrolling) return; // already scroll mode
      }
      this.onMouseDown(e);
    });
    // Move and Up on window so drags that leave the canvas still register.
    window.addEventListener('pointermove', (e) => { this.onMouseMove(e); });
    window.addEventListener('pointerup',   (e) => { this.onMouseUp(e);   });
    window.addEventListener('pointercancel', (e) => { this.onMouseUp(e); });

    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // hover tracking for isMouseOver() (used to block sculpt-canvas scroll while
    // the pointer is inside the timeline).
    this._canvas.addEventListener('pointerenter', () => { this._isMouseOver = true;  });
    this._canvas.addEventListener('pointerleave', () => { this._isMouseOver = false; });

    // [Step 1] Trackpad / mouse-wheel scroll: pan time axis (X) and value axis (Y in graph mode).
    // ctrlKey=true is sent by the OS for pinch-to-zoom gestures on trackpad.
    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._ensureViewInit();
      const tlX = 200;
      const tlW = this._cssWidth - tlX;
      if (e.ctrlKey) {
        // Pinch-to-zoom: zoom time axis around cursor pivot.
        const rect = this._canvas.getBoundingClientRect();
        const rx = e.clientX - rect.left;
        const pivotT = this._viewStart + ((rx - tlX) / tlW) * this._viewDuration;
        const factor = Math.pow(1.004, e.deltaY);
        const newDuration = Math.max(0.01, this._viewDuration * factor);
        this._viewStart = pivotT - (pivotT - this._viewStart) * (newDuration / this._viewDuration);
        this._viewDuration = newDuration;
      } else {
        // Horizontal scroll (trackpad deltaX) → pan time.
        const secsPerPx = this._viewDuration / tlW;
        this._viewStart += e.deltaX * secsPerPx;
        const wheelRx = e.clientX - this._canvas.getBoundingClientRect().left;
        if (this._mode === 'graph' && wheelRx < 200) {
          this._gutterScrollY = Math.max(0, Math.min(this._gutterMaxScroll, this._gutterScrollY + e.deltaY));
        } else if (this._mode === 'graph') {
          this._panY += e.deltaY;
        } else {
          // Dopesheet: vertical wheel scrolls the LANES vertically (through the stacked
          // tracks/layers) — never pans time. Clamped to the content height (set in draw).
          this._dopeScrollY = Math.max(0, Math.min(this._dopeMaxScroll || 0, (this._dopeScrollY || 0) + e.deltaY));
        }
      }
      this.draw();
    }, { passive: false });

    // Toolbar tooltip element — shown on button hover.
    this._tooltip = document.createElement('div');
    Object.assign(this._tooltip.style, {
      position: 'absolute', background: Theme.crust, color: Theme.text,
      padding: '3px 8px', borderRadius: '3px', font: '11px sans-serif',
      pointerEvents: 'none', display: 'none', zIndex: '30', whiteSpace: 'nowrap',
      border: '1px solid #45475a', bottom: '100%', marginBottom: '4px', transform: 'translateX(-50%)',
    });
    this._container.appendChild(this._tooltip);

    // ── Numeric entry input for gutter value badges ──
    // type=text (not number) so no up/down spinner buttons; narrow + right
    // aligned since values are at most a few digits (blendshape weights 0–1).
    this._valInput = document.createElement('input');
    this._valInput.type = 'text';
    this._valInput.inputMode = 'decimal';
    Object.assign(this._valInput.style, {
      position: 'absolute', left: '144px', width: '30px',
      font: '9px monospace', padding: '1px 4px', textAlign: 'right',
      background: '#1a2a1a', border: '1px solid #446644', color: '#88ddaa',
      borderRadius: '2px', outline: 'none', display: 'none', zIndex: '50',
    });
    this._valInputChannel = null; // null | 'bs:<name>'
    this._editingBsName = null;   // blendshape channel currently being edited (bold + scrolled-to)
    this._lastSelBsSig = null;    // signature of selected blendshape channels (auto-scroll guard)
    this._hoverCurve = null;      // graph-mode curve under the cursor (hover highlight)
    this._valInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._commitValInput(); this._valInput.style.display = 'none'; }
      if (e.key === 'Escape') { this._valInput.style.display = 'none'; this._valInputChannel = null; this._editingBsName = null; this.draw(); }
      e.stopPropagation();
    });
    this._valInput.addEventListener('blur', () => {
      this._commitValInput();
      this._valInput.style.display = 'none';
    });
    this._container.appendChild(this._valInput);

    // ── Frame-number entry for the toolbar field (set/shift selected key time) ──
    // type=text so expressions like "+=10" / "-=5" work for shifting a multi-selection.
    this._frameInput = document.createElement('input');
    this._frameInput.type = 'text';
    this._frameInput.inputMode = 'numeric';
    Object.assign(this._frameInput.style, {
      position: 'absolute', height: '18px', font: '10px monospace',
      padding: '1px 4px', textAlign: 'right',
      background: '#1a2a1a', border: '1px solid #446644', color: '#88ddaa',
      borderRadius: '3px', outline: 'none', display: 'none', zIndex: '50',
    });
    this._frameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { this._applyFrameExpr(this._frameInput.value); this._frameInput.style.display = 'none'; }
      if (e.key === 'Escape') { this._frameInput.style.display = 'none'; }
      e.stopPropagation();
    });
    this._frameInput.addEventListener('blur', () => {
      if (this._frameInput.style.display !== 'none') {
        this._applyFrameExpr(this._frameInput.value);
        this._frameInput.style.display = 'none';
      }
    });
    this._container.appendChild(this._frameInput);

    // Playback-range entry shared by the Start/End fields in the second toolbar row.
    this._rangeInput = document.createElement('input');
    this._rangeInput.type = 'text';
    this._rangeInput.inputMode = 'numeric';
    Object.assign(this._rangeInput.style, {
      position: 'absolute', height: '18px', font: '10px monospace',
      padding: '1px 4px', textAlign: 'right',
      background: '#1a2a1a', border: '1px solid #446644', color: '#88ddaa',
      borderRadius: '3px', outline: 'none', display: 'none', zIndex: '50',
    });
    this._rangeInputKind = null;
    this._rangeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._commitRangeInput(); this._rangeInput.style.display = 'none'; }
      if (e.key === 'Escape') { this._rangeInput.style.display = 'none'; this._rangeInputKind = null; }
      e.stopPropagation();
    });
    this._rangeInput.addEventListener('blur', () => {
      if (this._rangeInput.style.display !== 'none') this._commitRangeInput();
      this._rangeInput.style.display = 'none';
    });
    this._container.appendChild(this._rangeInput);

    // ── Value entry for the toolbar value field (set/shift selected key values) ──
    this._valueInput = document.createElement('input');
    this._valueInput.type = 'text';
    this._valueInput.inputMode = 'decimal';
    Object.assign(this._valueInput.style, {
      position: 'absolute', height: '18px', font: '10px monospace',
      padding: '1px 4px', textAlign: 'right',
      background: '#1a2a1a', border: '1px solid #446644', color: '#88ddaa',
      borderRadius: '3px', outline: 'none', display: 'none', zIndex: '50',
    });
    this._valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { this._applyValueExpr(this._valueInput.value); this._valueInput.style.display = 'none'; }
      if (e.key === 'Escape') { this._valueInput.style.display = 'none'; }
      e.stopPropagation();
    });
    this._valueInput.addEventListener('blur', () => {
      if (this._valueInput.style.display !== 'none') {
        this._applyValueExpr(this._valueInput.value);
        this._valueInput.style.display = 'none';
      }
    });
    this._container.appendChild(this._valueInput);

    this.onResize();
  }

  // Apply a numeric value typed into the gutter value badge input.
  _commitValInput() {
    const _done = () => { this._valInputChannel = null; this._editingBsName = null; };
    if (!this._valInputChannel) { _done(); return; }
    const v = parseFloat(this._valInput.value);
    if (isNaN(v)) { _done(); return; }
    const reg  = window._animationRegistry;
    const mesh = this._main?.getMesh?.();
    if (!reg || !mesh) { _done(); return; }

    if (this._valInputChannel.startsWith('bs:')) {
      const bsName = this._valInputChannel.slice(3);
      // Typed entry is NOT clamped — overshoot (e.g. 5.0, -1) is allowed.
      reg.setBlendshapeWeight(mesh, bsName, v);
      if (window.app?.render) window.app.render();
    }
    _done();
  }

  _setPlaybackRangeFrame(kind, frame) {
    const fps = window._animFPS || 24;
    const minGap = 1 / fps;
    const t = Math.max(0, Math.round(Number(frame) || 0) / fps);
    if (kind === 'start') {
      window._animLoopStart = Math.min(t, (window._animLoopEnd ?? t + minGap) - minGap);
    } else {
      window._animLoopEnd = Math.max(t, (window._animLoopStart ?? 0) + minGap);
    }
    window._animSyncKeyInspector?.();
    this.draw();
  }

  _commitRangeInput() {
    if (this._rangeInputKind) this._setPlaybackRangeFrame(this._rangeInputKind, this._rangeInput.value);
    this._rangeInputKind = null;
  }

  _editPlaybackRange(kind, btn) {
    const fps = window._animFPS || 24;
    const value = Math.round((kind === 'start' ? (window._animLoopStart ?? 0)
      : (window._animLoopEnd ?? window._animMasterDuration ?? 2)) * fps);
    if (window._vrNumpad?.shouldUse?.()) {
      if (window._vrNumpad.isBlockingOpen) return;
      window._vrNumpad.open(value, { label: kind === 'start' ? 'Playback Start' : 'Playback End', integer: true },
        (v) => this._setPlaybackRangeFrame(kind, v), null, null, this._main?._vrTimelineMesh || null);
      return;
    }
    this._rangeInputKind = kind;
    this._rangeInput.style.left = Math.round(btn.x) + 'px';
    this._rangeInput.style.top = Math.round(btn.y) + 'px';
    this._rangeInput.style.width = (btn.w - 10) + 'px';
    this._rangeInput.style.display = 'block';
    this._rangeInput.value = String(value);
    this._rangeInput.focus();
    this._rangeInput.select();
  }

  _speedMenuRect() {
    const btn = this._toolbarBtnDefs().find(b => b.id === 'speed');
    return btn ? { x: btn.x, y: TOOLBAR_BOTTOM, w: btn.w * 2, h: 60, cellW: btn.w, cellH: 20 } : null;
  }

  _drawSpeedMenu(ctx) {
    if (!this._speedMenuOpen) return;
    const r = this._speedMenuRect();
    if (!r) return;
    ctx.save();
    ctx.fillStyle = Theme.crust;
    ctx.strokeStyle = Theme.surface1;
    ctx.lineWidth = 1;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    const current = window._animPlaybackSpeed || 1;
    PLAYBACK_SPEEDS.forEach((speed, i) => {
      const x = r.x + (i % 2) * r.cellW;
      const y = r.y + Math.floor(i / 2) * r.cellH;
      const hov = this._lastMouseX >= x && this._lastMouseX <= x + r.cellW
        && this._lastMouseY >= y && this._lastMouseY < y + r.cellH;
      if (speed === current || hov) {
        ctx.fillStyle = speed === current ? TL_ACCENT : Theme.surface1;
        ctx.fillRect(x + 1, y + 1, r.cellW - 2, r.cellH - 2);
      }
      ctx.fillStyle = Theme.text;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${speed}x`, x + r.cellW / 2, y + r.cellH / 2);
    });
    ctx.restore();
  }

  // THE RECORD CHANNEL MENU. Same canvas-native construction as the "..." menu — one draw, one
  // hit test — and it reaches the synthetic VR timeline events as well as desktop pointers,
  // which a DOM popup would not.
  //
  // It STAYS OPEN as you click, unlike "...": those are commands and these are switches, and
  // flipping two of them should not cost two trips to the menu. matt: "the menu should stay
  // active, and only clear if the user clicks elsewhere."
  _recOptCommands() {
    const reg = window._animationRegistry;
    const ch = reg ? reg.recordChannels() : { translate: true, rotate: true, scale: true };
    const row = (label, on, liveKey, savedKey) => ({
      label: (on ? '\u2713  ' : '\u2003  ') + label, on: on,
      run: () => { window[liveKey] = !on; window.saveOption?.(savedKey, !on); },
    });
    return [
      row('Translate', ch.translate, '_recTranslate', 'recTranslate'),
      row('Rotate', ch.rotate, '_recRotate', 'recRotate'),
      row('Scale', ch.scale, '_recScale', 'recScale'),
    ];
  }

  _recOptRect() {
    const btn = this._toolbarBtnDefs().find(b => b.id === 'recopts');
    // Right-aligned under the arrow, so a 140px menu hanging off a 16px button cannot run past
    // the edge of a narrow timeline.
    return btn ? { x: Math.max(2, btn.x + btn.w - 140), y: btn.y + btn.h,
      w: 140, h: 3 * 24, cellH: 24 } : null;
  }

  _drawRecOptMenu(ctx) {
    if (!this._recOptMenuOpen) return;
    const r = this._recOptRect();
    if (!r) return;
    ctx.save();
    ctx.fillStyle = Theme.crust; ctx.strokeStyle = Theme.surface1; ctx.lineWidth = 1;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    this._recOptCommands().forEach((cmd, i) => {
      const y = r.y + i * r.cellH;
      const hov = this._lastMouseX >= r.x && this._lastMouseX <= r.x + r.w
        && this._lastMouseY >= y && this._lastMouseY < y + r.cellH;
      if (hov) { ctx.fillStyle = Theme.surface1; ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.cellH - 2); }
      ctx.fillStyle = cmd.on ? Theme.text : Theme.overlay0;
      ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(cmd.label, r.x + 10, y + r.cellH / 2);
    });
    ctx.restore();
  }

  _contextMenuCommands() {
    const main = this._main;
    return [...this._shapeLayerMenuCommands(), ...(main?._resolveRadialCommands?.() || [])];
  }

  _contextMenuRect() {
    const btn = this._toolbarBtnDefs().find(b => b.id === 'ctxmenu');
    const count = this._contextMenuCommands().length;
    return btn && count ? { x: btn.x, y: btn.y + btn.h, w: 190, h: count * 24, cellH: 24 } : null;
  }

  _drawContextMenu(ctx) {
    if (!this._contextMenuOpen) return;
    const r = this._contextMenuRect();
    if (!r) return;
    const cmds = this._contextMenuCommands();
    ctx.save();
    ctx.fillStyle = Theme.crust; ctx.strokeStyle = Theme.surface1; ctx.lineWidth = 1;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    cmds.forEach((cmd, i) => {
      const y = r.y + i * r.cellH;
      const hov = this._lastMouseX >= r.x && this._lastMouseX <= r.x + r.w
        && this._lastMouseY >= y && this._lastMouseY < y + r.cellH;
      if (hov && cmd.enabled !== false) {
        ctx.fillStyle = Theme.surface1; ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.cellH - 2);
      }
      ctx.fillStyle = cmd.enabled === false ? Theme.overlay0 : Theme.text;
      ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(cmd.label, r.x + 10, y + r.cellH / 2);
    });
    ctx.restore();
  }

  // Selection changed — let the panel re-read whether Delete has anything to act on. Called
  // rather than polled: syncFromState is not on a frame timer, so a button left to notice on
  // its own would stay wrong until something else happened to repaint it.
  _notifySelectionChanged() {
    try { window._animPanel?.syncDeleteButton?.(); } catch (_) {}
  }

  selectedAnimationIds() {
    // A DELIBERATE MULTI-SELECTION IS THE STATEMENT, and it outranks everything below.
    //
    // This used to answer with the PRIMARY mesh only, so with three objects selected the
    // dopesheet still highlighted one row and Delete still acted on one track — the selection
    // was multi and nothing here could see it. matt: "holding shift and selecting channel names
    // does not multiselect."
    //
    // Only when there is genuinely more than one: a single selection keeps the last-click rule
    // below, which exists so a stale key selection from another row cannot make Delete affect
    // two things at once.
    const _sel = this._main.getSelectedMeshes?.() || [];
    if (_sel.length > 1) return _sel.map((m) => m.getID());

    const active = this._main.getMesh?.();
    const activeId = active?.getID?.();
    const keyIds = new Set();
    for (const key of window._animSelectedKeys || []) {
      if (key.meshId != null) keyIds.add(key.meshId);
      if (key.childId != null) keyIds.add(key.childId);
    }
    // Last-click wins. A row or scene click changes the active object; stale key selections
    // from another row must not make Delete affect both. A genuine multi-key selection whose
    // active object is one of its rows still targets every represented channel.
    if (activeId != null && (!keyIds.size || !keyIds.has(activeId))) return [activeId];
    if (keyIds.size) return [...keyIds];
    if (activeId != null) return [activeId];
    return this._graphMeshId != null ? [this._graphMeshId] : [];
  }

  deleteAnimationFromSelectedObjects() {
    const reg = window._animationRegistry;
    const ids = this.selectedAnimationIds().filter((id) => reg?.tracks.has(id));
    if (!ids.length) {
      window._animStatusText = 'No animation on selected objects';
      window.screenLog?.(window._animStatusText, 'orange');
      this.draw();
      return false;
    }
    const run = () => {
      if (!reg.deleteAnimationForIds(ids)) return;
      window._animSelectedKeys = [];
      if (ids.includes(this._graphMeshId)) this._graphMeshId = null;
      window._animStatusText = `Deleted animation from ${ids.length} object${ids.length === 1 ? '' : 's'}`;
      this.draw();
    };
    run();
    return true;
  }

  // Scroll the gutter (if needed) so the given absolute row index is fully
  // visible. Used to bring the channel being edited into view (desktop + VR).
  _ensureGutterRowVisible(rowIdx) {
    const headerH = HEADER_H;
    const gutterY = headerH + 4 + XF_SEG_H;
    const rowH    = 22;
    const rowTopAbs = gutterY + rowIdx * rowH;
    const maxScroll = rowTopAbs - headerH;                       // keep row top below header
    const minScroll = rowTopAbs + rowH - this._cssHeight;        // keep row bottom above edge
    let s = this._gutterScrollY;
    if (s > maxScroll) s = maxScroll;
    if (s < minScroll) s = minScroll;
    this._gutterScrollY = Math.max(0, Math.min(this._gutterMaxScroll || 0, s));
  }

  // Blend a #rrggbb color toward white (for hovered-curve highlight).
  _lightenHex(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return Theme.text;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * 0.55);
    return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  }

  // Solo a channel (hide all others). Shift-click an eye icon. Re-soloing the
  // already-soloed channel restores full visibility.
  _soloChannel(target) {
    const reg = window._animationRegistry;
    const mesh = this._main?.getMesh?.();
    const track = mesh ? reg?.tracks.get(mesh.getID()) : null;
    const maxCh = (track && track.shapeTimes && track.shapeTimes.length >= 2) ? 4 : 3;
    if (!window._animChannelVisible) window._animChannelVisible = [true, true, true, true];
    if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
    const bsNames = track?.blendshapeTracks ? [...track.blendshapeTracks.keys()] : [];

    const isTargetCh = (i) => target.kind === 'shape' ? (i === 3)
                            : target.kind === 'transform' ? (i === target.channel) : false;
    const isTargetBs = (n) => target.kind === 'blendshape' && n === target.name;

    // Already soloed to target? (target visible, everything else hidden)
    let othersHidden = true, targetVisible = true;
    for (let i = 0; i < maxCh; i++) {
      const vis = window._animChannelVisible[i] !== false;
      if (isTargetCh(i)) { if (!vis) targetVisible = false; }
      else if (vis) othersHidden = false;
    }
    bsNames.forEach(n => {
      const vis = window._animBsChannelVisible[n] !== false;
      if (isTargetBs(n)) { if (!vis) targetVisible = false; }
      else if (vis) othersHidden = false;
    });
    const restore = targetVisible && othersHidden; // toggle solo off → show all

    for (let i = 0; i < maxCh; i++) window._animChannelVisible[i] = restore ? true : isTargetCh(i);
    bsNames.forEach(n => { window._animBsChannelVisible[n] = restore ? true : isTargetBs(n); });
    this._pruneSelectionToVisible();
    this.draw();
  }

  // Drop any selected keys whose channel is now hidden, so hidden channels can't
  // be edited via the value/frame fields or the transform box.
  _pruneSelectionToVisible() {
    const sel = window._animSelectedKeys;
    if (!sel?.length) return;
    const chVis = window._animChannelVisible || [true, true, true, true];
    const bsVis = window._animBsChannelVisible || {};
    const kept = sel.filter(k => {
      if (k.type === 'transform') return chVis[k.channel ?? 0] !== false;
      if (k.type === 'shape')     return chVis[3] !== false;
      if (k.type === 'blendshape') return bsVis[k.name] !== false;
      return true;
    });
    if (kept.length !== sel.length) {
      window._animSelectedKeys = kept;
      if (kept.length <= 1) window._animTransformBox = null;
    }
  }

  // Toolbar frame field rect (right-aligned in the toolbar row).
  _frameFieldRect() {
    const w = 64, h = 20, margin = 10;
    return { x: Math.round(this._cssWidth - w - margin), y: 5, w, h };
  }

  // Snapshot all tracks (for undo). Deep-copies keyframe arrays via cloneTrack.
  _snapshotTracks() {
    const m = new Map();
    window._animationRegistry?.tracks.forEach((tr, id) => m.set(id, TimelineHelper.cloneTrack(tr)));
    return m;
  }

  // Restore tracks IN PLACE from a snapshot — mutates the live track's keyframe
  // arrays rather than replacing the track object, so each track's live
  // `blendshapes` vertex-delta Map (too large to snapshot) is preserved.
  _restoreTracksInPlace(stateMap) {
    const reg = window._animationRegistry;
    if (!reg) return;
    stateMap.forEach((snap, mId) => {
      const live = reg.tracks.get(mId);
      if (!live) return;
      live.times            = snap.times            ? [...snap.times]            : [];
      live.positions        = snap.positions        ? [...snap.positions]        : [];
      live.quaternions      = snap.quaternions      ? [...snap.quaternions]      : [];
      live.scales           = snap.scales           ? [...snap.scales]           : [];
      live.shapeTimes       = snap.shapeTimes       ? [...snap.shapeTimes]       : [];
      live.shapes           = snap.shapes           ? snap.shapes.map(s => new Float32Array(s)) : [];
      live.shapeOutputTimes = snap.shapeOutputTimes ? [...snap.shapeOutputTimes] : [];
      live.tangentOffsets   = snap.tangentOffsets   ? JSON.parse(JSON.stringify(snap.tangentOffsets)) : undefined;
      if (snap.shapeLayers) live.shapeLayers = snap.shapeLayers.map(L => ({
        name: L.name, muted: L.muted,
        shapeTimes: L.shapeTimes ? [...L.shapeTimes] : [],
        shapes: L.shapes ? L.shapes.map(s => new Float32Array(s)) : [],
        shapeOutputTimes: L.shapeOutputTimes ? [...L.shapeOutputTimes] : []
      }));
      if (snap.blendshapeTracks) {
        if (!live.blendshapeTracks) live.blendshapeTracks = new Map();
        live.blendshapeTracks.clear();
        snap.blendshapeTracks.forEach((bt, name) => {
          live.blendshapeTracks.set(name, {
            times: bt.times ? [...bt.times] : [],
            values: bt.values ? [...bt.values] : [],
            tangentOffsets: bt.tangentOffsets ? JSON.parse(JSON.stringify(bt.tangentOffsets)) : undefined
          });
        });
      }
    });
    const m = this._main?.getMesh?.();
    if (m) reg.update(m, true);
    if (this._main?.render) this._main.render();
    this.draw();
  }

  // Apply a frame expression to the selected key(s) from the toolbar field.
  //   plain number → set the reference key to that whole frame; others shift rigidly.
  //   += / -= / *= / /= → shift ALL selected keys by the resulting frame delta
  //                       (preserving their relative spacing/offsets).
  _applyFrameExpr(rawVal) {
    const reg = window._animationRegistry;
    const sel = window._animSelectedKeys;
    if (!reg || !sel?.length) return;
    const fps  = window._animFPS || 24;
    const mDur = (window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const s = String(rawVal ?? '').trim();
    if (!s) return;

    const keyTime  = (k, tr) => k.type === 'transform' ? (tr.times?.[k.index] ?? 0)
                            : k.type === 'shape'     ? (tr.shapeTimes?.[k.index] ?? 0)
                            : (tr.blendshapeTracks?.get(k.name)?.times?.[k.index] ?? 0);
    const keyTimes = (k, tr) => k.type === 'transform' ? tr.times
                            : k.type === 'shape'     ? tr.shapeTimes
                            : tr.blendshapeTracks?.get(k.name)?.times;
    const parseExpr = (raw, cur) => {
      const op = raw.slice(0, 2); const n = parseFloat(raw.slice(2));
      if (op === '+=' && !isNaN(n)) return cur + n;
      if (op === '-=' && !isNaN(n)) return cur - n;
      if (op === '*=' && !isNaN(n)) return cur * n;
      if (op === '/=' && !isNaN(n) && n !== 0) return cur / n;
      const d = parseFloat(raw); return isNaN(d) ? null : d;
    };

    const ref = sel[0];
    const refTrack = reg.tracks.get(ref.meshId); if (!refTrack) return;
    const refTime  = keyTime(ref, refTrack);
    const refFrame = Math.round(refTime * fps);
    const newFrame = parseExpr(s, refFrame);
    if (newFrame == null) return;
    const isRel = /^[+\-*/]=/.test(s);
    const dt = isRel ? (newFrame - refFrame) / fps : (Math.round(newFrame) / fps) - refTime;
    if (Math.abs(dt) < 0.0001) return;

    const before = this._snapshotTracks();
    const moves = sel.map(k => { const tr = reg.tracks.get(k.meshId); return tr ? { ...k, time: keyTime(k, tr) } : null; }).filter(Boolean);
    TimelineHelper.moveKeys(reg, moves, dt, undefined, mDur, this._main);
    const touched = new Set(moves.map(m => m.meshId));
    touched.forEach(id => { const tr = reg.tracks.get(id); if (tr) reg.sortTrack(tr); });
    window._animSelectedKeys = moves.map(m => {
      const tr = reg.tracks.get(m.meshId); if (!tr) return m;
      const times = keyTimes(m, tr);
      const want  = m.time + dt;
      const idx   = times?.findIndex(t => Math.abs(t - want) < 0.005) ?? -1;
      const { time: _drop, ...rest } = m;
      return idx !== -1 ? { ...rest, index: idx } : rest;
    });
    const after = this._snapshotTracks();
    this._main.getStateManager().pushStateCustom(
      () => { window._animSelectedKeys = []; this._restoreTracksInPlace(before); },
      () => { window._animSelectedKeys = []; this._restoreTracksInPlace(after); },
      false, 'Set Keyframe Time'
    );
    const m = this._main?.getMesh?.();
    if (m) reg.update(m, true);
    if (this._main?.render) this._main.render();
    this.draw();
  }

  // Delete the current key selection (any mix of transform/shape/shapeLayer/blendshape),
  // as ONE undo step. Shared by the toolbar × button, the Delete key, and cut. Deletes
  // directly (not reg.deleteSelectedKeys — that pushes its own undo and skips several types).
  deleteSelectedKeys() {
    const reg = window._animationRegistry;
    if (!reg || !window._animSelectedKeys?.length) return;

    const before = this._snapshotTracks();

    // Group by mesh+type; delete highest-index-first so earlier indices stay valid.
    const trGroups = new Map();  // "meshId_type" -> [indices]         (transform/shape)
    const slGroups = new Map();  // "meshId:layer" -> {meshId,layer,indices[]}   (#34 layers)
    const bsGroups = new Map();  // "meshId:name"  -> {meshId,name,indices[]}    (blendshape)
    window._animSelectedKeys.forEach(k => {
      if (k.type === 'blendshape') {
        const gk = `${k.meshId}:${k.name}`;
        if (!bsGroups.has(gk)) bsGroups.set(gk, { meshId: k.meshId, name: k.name, indices: [] });
        bsGroups.get(gk).indices.push(k.index);
      } else if (k.type === 'shapeLayer') {
        const gk = `${k.meshId}:${k.layer}`;
        if (!slGroups.has(gk)) slGroups.set(gk, { meshId: k.meshId, layer: k.layer, indices: [] });
        slGroups.get(gk).indices.push(k.index);
      } else if (k.type === 'transform' || k.type === 'shape') {
        const gk = `${k.meshId}_${k.type}`;
        if (!trGroups.has(gk)) trGroups.set(gk, []);
        trGroups.get(gk).push(k.index);
      }
    });

    trGroups.forEach((indices, gk) => {
      const us = gk.lastIndexOf('_');
      const tr = reg.tracks.get(parseInt(gk.slice(0, us), 10));
      const type = gk.slice(us + 1);
      if (!tr) return;
      indices.sort((a, b) => b - a).forEach(idx => {
        if (type === 'transform' && tr.times?.[idx] !== undefined) {
          tr.times.splice(idx, 1); tr.positions.splice(idx * 3, 3);
          tr.quaternions.splice(idx * 4, 4); tr.scales.splice(idx * 3, 3);
        } else if (type === 'shape' && tr.shapeTimes?.[idx] !== undefined) {
          tr.shapeTimes.splice(idx, 1); tr.shapes.splice(idx, 1);
          if (tr.shapeOutputTimes) tr.shapeOutputTimes.splice(idx, 1);
        }
      });
      reg.sortTrack(tr);
    });
    slGroups.forEach(({ meshId, layer, indices }) => {
      const tr = reg.tracks.get(meshId);
      const L = tr?.shapeLayers?.[layer];
      if (!L) return;
      indices.sort((a, b) => b - a).forEach(idx => {
        if (L.shapeTimes?.[idx] !== undefined) {
          L.shapeTimes.splice(idx, 1);
          if (L.shapes) L.shapes.splice(idx, 1);
          if (L.shapeOutputTimes) L.shapeOutputTimes.splice(idx, 1);
        }
      });
      reg.sortTrack(tr);
    });
    bsGroups.forEach(({ meshId, name, indices }) => {
      const bt = reg.tracks.get(meshId)?.blendshapeTracks?.get(name);
      if (!bt) return;
      indices.sort((a, b) => b - a).forEach(idx => {
        if (idx >= 0 && idx < bt.times.length) { bt.times.splice(idx, 1); bt.values.splice(idx, 1); }
      });
    });

    window._animSelectedKeys = [];
    window._animTransformBox = null;
    const after = this._snapshotTracks();
    this._main.getStateManager().pushStateCustom(
      () => { window._animSelectedKeys = []; this._restoreTracksInPlace(before); },
      () => { window._animSelectedKeys = []; this._restoreTracksInPlace(after); },
      false, 'Delete Keys'
    );
    const m = this._main?.getMesh?.();
    if (m) reg.update(m, true);
    this._main?.render?.();
    this.draw();
  }

  // Cut = copy the selection to the clipboard, then delete it (one gesture, two undo steps).
  cutSelectedKeys() {
    if (!window._animSelectedKeys?.length) return;
    this.copySelectedKeys();
    this.deleteSelectedKeys();
  }

  // ── Key clipboard (desktop Ctrl-C / Ctrl-V) ────────────────────────────────
  // Copy the current key selection (any mix of transform/shape/blendshape) into
  // window._animKeyClipboard, capturing each key's VALUE payload + its time. The
  // clipboard anchor = the earliest copied time, so paste lands the earliest key at
  // the playhead and preserves the others' relative offsets.
  copySelectedKeys() {
    const reg = window._animationRegistry;
    const sel = window._animSelectedKeys;
    if (!reg || !sel?.length) return;
    const keys = [];
    for (const k of sel) {
      if (k.type === 'sr') {
        // Frame (shape-replacement): the "key" is a child mesh of a FrameGroup — no reg
        // track. Keep a reference: paste duplicates its geometry, paste-linked shares it.
        const child = this._main.getMeshes?.().find(m => m.getID() === k.childId);
        if (!child || !child._parentMesh?._isFrameGroup) continue;
        keys.push({ type: 'sr', childId: k.childId, time: child._srFrameTime || 0, srMesh: child });
        continue;
      }
      const tr = reg.tracks.get(k.meshId);
      if (!tr) continue;
      if (k.type === 'transform') {
        const t = tr.times?.[k.index]; if (t === undefined) continue;
        keys.push({ meshId: k.meshId, type: 'transform', time: t, payload: {
          pos:   tr.positions.slice(k.index * 3, k.index * 3 + 3),
          quat:  tr.quaternions.slice(k.index * 4, k.index * 4 + 4),
          scale: tr.scales.slice(k.index * 3, k.index * 3 + 3),
        } });
      } else if (k.type === 'shape') {
        const t = tr.shapeTimes?.[k.index]; if (t === undefined) continue;
        keys.push({ meshId: k.meshId, type: 'shape', time: t, payload: {
          verts: new Float32Array(tr.shapes[k.index]),
          outDelta: (tr.shapeOutputTimes?.[k.index] ?? t) - t,
        } });
      } else if (k.type === 'shapeLayer') {
        const L = tr.shapeLayers?.[k.layer]; const t = L?.shapeTimes?.[k.index];
        if (t === undefined) continue;
        keys.push({ meshId: k.meshId, type: 'shapeLayer', layer: k.layer, time: t, payload: {
          verts: new Float32Array(L.shapes[k.index]),   // the layer's vertex-delta snapshot
          outDelta: (L.shapeOutputTimes?.[k.index] ?? t) - t,
        } });
      } else if (k.type === 'blendshape') {
        const bt = tr.blendshapeTracks?.get(k.name); const t = bt?.times?.[k.index];
        if (t === undefined) continue;
        keys.push({ meshId: k.meshId, type: 'blendshape', name: k.name, time: t, payload: { value: bt.values[k.index] } });
      }
    }
    if (!keys.length) return;
    const anchor = Math.min(...keys.map(k => k.time));
    window._animKeyClipboard = { anchor, keys };
    window.screenLog?.(`Copied ${keys.length} key${keys.length > 1 ? 's' : ''}`, '#a6e3a1');
  }

  // Paste the clipboard at the playhead: earliest key lands on the playhead, the rest
  // keep their relative offsets. Keys go back onto their ORIGINAL mesh/track/name.
  // `linked` is reserved for frame (shape-replacement) keys — for scalar keyframes a
  // paste is always a value copy, so it's currently a no-op distinction here.
  pasteKeys(linked = false) {
    const reg = window._animationRegistry;
    const clip = window._animKeyClipboard;
    if (!reg || !clip?.keys?.length) return;
    const playhead = window._animCurrentTime || 0;
    const fps = window._animFPS || 24;
    const snap = (t) => (window._animSnapToFrame !== false) ? Math.round(t * fps) / fps : t;

    const before = this._snapshotTracks();
    const targets = []; // scalar keys — for the scalar undo + selection rebuild
    let srCount = 0;
    for (const k of clip.keys) {
      const time = snap(playhead + (k.time - clip.anchor));
      if (k.type === 'sr') {
        // Frame (shape-replacement): paste a new frame. linked=true → shared-data
        // instance (reuse a phoneme). FrameGroup.pasteFrame handles its own undo.
        if (window._frameGroup?.pasteFrame?.(k.srMesh, time, linked)) srCount++;
        continue;
      }
      const tr = reg.tracks.get(k.meshId);
      if (!tr) continue; // paste requires the source track to still exist
      if (k.type === 'transform')      this._insertTransformKeyAt(tr, time, k.payload);
      else if (k.type === 'shape')     this._insertShapeKeyAt(tr, time, k.payload);
      else if (k.type === 'shapeLayer') { if (!this._insertShapeLayerKeyAt(tr, k.layer, time, k.payload)) continue; }
      else if (k.type === 'blendshape') this._insertBlendshapeKeyAt(tr, k.name, time, k.payload.value);
      else continue;
      if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;
      targets.push({ meshId: k.meshId, type: k.type, name: k.name, layer: k.layer, time });
    }

    // Scalar keys: one undo entry + rebuild the selection onto them. (SR frames carry
    // their own undo via FrameGroup, so they're excluded here.)
    if (targets.length) {
      window._animSelectedKeys = targets.map(t => {
        const tr = reg.tracks.get(t.meshId);
        const times = t.type === 'transform' ? tr.times
                    : t.type === 'shape'     ? tr.shapeTimes
                    : t.type === 'shapeLayer' ? tr.shapeLayers?.[t.layer]?.shapeTimes
                    : tr.blendshapeTracks?.get(t.name)?.times;
        const idx = times?.findIndex(x => Math.abs(x - t.time) < 0.005) ?? -1;
        if (idx < 0) return null;
        if (t.type === 'blendshape') return { meshId: t.meshId, type: 'blendshape', name: t.name, index: idx };
        if (t.type === 'shapeLayer') return { meshId: t.meshId, type: 'shapeLayer', layer: t.layer, index: idx };
        return { meshId: t.meshId, type: t.type, index: idx };
      }).filter(Boolean);
      const after = this._snapshotTracks();
      this._main.getStateManager().pushStateCustom(
        () => { window._animSelectedKeys = []; this._restoreTracksInPlace(before); },
        () => { window._animSelectedKeys = []; this._restoreTracksInPlace(after); },
        false, 'Paste Keyframe'
      );
    }
    const m = this._main?.getMesh?.();
    if (m) reg.update(m, true);
    this._main?.render?.();
    this.draw();
    const n = targets.length + srCount;
    window.screenLog?.(`Pasted ${n} ${linked && srCount ? 'linked ' : ''}key${n > 1 ? 's' : ''}`, '#a6e3a1');
  }

  // Insert a key with EXPLICIT copied values (not captured from the live mesh), replacing
  // any key already within an epsilon of `time`. Parallel-array splice, sorted by time.
  _insertTransformKeyAt(tr, time, { pos, quat, scale }) {
    tr.times = tr.times || []; tr.positions = tr.positions || []; tr.quaternions = tr.quaternions || []; tr.scales = tr.scales || [];
    let idx = 0; while (idx < tr.times.length && tr.times[idx] < time) idx++;
    if (idx < tr.times.length && Math.abs(tr.times[idx] - time) < 0.005) {
      tr.positions.splice(idx * 3, 3, ...pos); tr.quaternions.splice(idx * 4, 4, ...quat); tr.scales.splice(idx * 3, 3, ...scale);
    } else {
      tr.times.splice(idx, 0, time); tr.positions.splice(idx * 3, 0, ...pos); tr.quaternions.splice(idx * 4, 0, ...quat); tr.scales.splice(idx * 3, 0, ...scale);
    }
  }

  _insertShapeKeyAt(tr, time, { verts, outDelta }) {
    tr.shapeTimes = tr.shapeTimes || []; tr.shapes = tr.shapes || []; tr.shapeOutputTimes = tr.shapeOutputTimes || [];
    const copy = new Float32Array(verts);
    let idx = 0; while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < time) idx++;
    if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - time) < 0.005) {
      tr.shapes[idx] = copy; tr.shapeOutputTimes[idx] = time + (outDelta || 0);
    } else {
      tr.shapeTimes.splice(idx, 0, time); tr.shapes.splice(idx, 0, copy); tr.shapeOutputTimes.splice(idx, 0, time + (outDelta || 0));
    }
  }

  // Paste a copied layer key back into a specific layer (#34). Returns false if that layer
  // no longer exists (e.g. it was deleted after the copy).
  _insertShapeLayerKeyAt(tr, layer, time, { verts, outDelta }) {
    const L = tr.shapeLayers?.[layer];
    if (!L) return false;
    L.shapeTimes = L.shapeTimes || []; L.shapes = L.shapes || []; L.shapeOutputTimes = L.shapeOutputTimes || [];
    const copy = new Float32Array(verts);
    let idx = 0; while (idx < L.shapeTimes.length && L.shapeTimes[idx] < time) idx++;
    if (idx < L.shapeTimes.length && Math.abs(L.shapeTimes[idx] - time) < 0.005) {
      L.shapes[idx] = copy; L.shapeOutputTimes[idx] = time + (outDelta || 0);
    } else {
      L.shapeTimes.splice(idx, 0, time); L.shapes.splice(idx, 0, copy); L.shapeOutputTimes.splice(idx, 0, time + (outDelta || 0));
    }
    return true;
  }

  _insertBlendshapeKeyAt(tr, name, time, value) {
    const bt = tr.blendshapeTracks?.get(name);
    if (!bt) return; // the target mesh must already have this blendshape
    bt.times = bt.times || []; bt.values = bt.values || [];
    let idx = 0; while (idx < bt.times.length && bt.times[idx] < time) idx++;
    if (idx < bt.times.length && Math.abs(bt.times[idx] - time) < 0.005) bt.values[idx] = value;
    else { bt.times.splice(idx, 0, time); bt.values.splice(idx, 0, value); }
  }

  // The edited value of a key (transform → the channel of the group on show, shape → output
  // time, blendshape → weight). undefined if not resolvable.
  _keyValue(k, tr) {
    if (!tr) return undefined;
    if (k.type === 'transform')  return xfRead(tr, k.index, k.channel ?? 0, k.group);
    if (k.type === 'shape')      return tr.shapeOutputTimes?.[k.index];
    if (k.type === 'blendshape') return tr.blendshapeTracks?.get(k.name)?.values?.[k.index];
    return undefined;
  }

  // Switch the graph editor between translate / rotate / scale.
  //
  // The vertical view is REMEMBERED PER GROUP. Degrees and scene units are not the same kind
  // of number — a rotation curve at 90 sits far off a view framed for a 1.5-unit translation —
  // so carrying one group's zoom into another shows an empty graph and reads as a bug. Each
  // group keeps its own framing, and a group being visited for the first time is framed to its
  // own keys rather than to a guess.
  // Toggle one channel group in or out of the graph.
  //
  // The remembered per-group framing survives, but it now belongs to the ACTIVE group only --
  // with several on screen there is one Y axis, and which group's framing it carries is
  // whichever one you last switched on. Normalise is the answer when that is not enough.
  _switchXfGroup(g) {
    const wasActive = xfGroup();
    const wasOn = xfIsVisible(g);

    xfToggleVisible(g);
    if (xfIsVisible(g) === wasOn) return;   // refused (would have emptied the set)

    // A selection made against one group must not silently re-point at another. Keys now CARRY
    // their group, so only the ones whose group just went away are dropped -- switching a second
    // channel ON no longer costs you the selection you were working with.
    const vis = xfVisible();
    window._animSelectedKeys = (window._animSelectedKeys || [])
      .filter((k) => k.type !== 'transform' || vis.indexOf(k.group || wasActive) >= 0);

    // THE VIEW DOES NOT MOVE. Remembering a zoom per group made sense while the strip was a
    // RADIO -- you were changing what the graph was OF, and degrees and scene units want
    // different framings. As a FILTER it is wrong: adding or removing a curve is not a reason
    // to re-frame the ones already on screen, and matt saw exactly that -- "if normalise is
    // off, the zoom shouldn't change. right now if i toggle TRS, the vertical zoom seems to
    // jump around." Fit All is the explicit way to reframe, and Normalise is the way to make
    // different units share an axis.
    tlLog(`toggle group ${g} -> ${xfIsVisible(g) ? 'on' : 'off'}`,
      `visible=${vis.join(',')} active=${xfGroup()}`);
  }

  // Fit the vertical view to the visible keys of the group on show. Falls back to leaving the
  // view alone when there is nothing to measure — a blank graph is not worth reframing for.
  _frameXfGroup() {
    const reg = window._animationRegistry;
    const mesh = this._main?.getMesh?.();
    const tr = reg && mesh ? reg.tracks.get(mesh.getID()) : null;
    const n = tr?.times?.length || 0;
    if (!n) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        // The ACTIVE group on purpose: this frames the group you just switched to.
        const v = xfRead(tr, i, c, xfGroup());
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    tlLog(`frame ${xfGroup()}: keys=${n} range ${lo} .. ${hi}`);
    if (!isFinite(lo) || !isFinite(hi)) return;
    const graphH = Math.max(1, this._cssHeight - HEADER_H);
    // A CONSTANT CURVE HAS NO RANGE TO FRAME. The old floor of 1e-3 meant a channel whose keys
    // are all the same value -- scale on anything that has never been scaled, which is most
    // things -- was framed to a thousandth of a unit, i.e. zoomed some hundred thousand times.
    // At that magnification any wobble at all fills the graph, so a flat curve looked wild.
    //
    // So: a range that is genuinely flat gets a comfortable default window in the group's OWN
    // units, and anything with a real range is still framed to it. Degrees and scene units are
    // not the same kind of number, which is the same reason the view is remembered per group.
    const FLAT_SPAN = { pos: 1, rot: 90, scale: 1 };
    const measured = hi - lo;
    const span = measured > 1e-6 ? Math.max(measured, 1e-3)
                                 : (FLAT_SPAN[xfGroup()] || 1);
    this._zoomY = (graphH * 0.7) / span;          // leave a margin rather than filling edge to edge
    this._panY = -((lo + hi) / 2) * this._zoomY;  // centre the range in the graph band
  }

  // The three segments of the T|R|S strip, in canvas CSS coords. Drawing and hit-testing both
  // read this, which is the only way they stay in step.
  // FOUR FILTERS AND A NORMALISE. The strip was a radio -- one transform group at a time -- and
  // is now a set: matt, "sometimes it would be good to see all the channels, or just translation
  // and rotation, or just rotation and activation."
  //
  // `norm` sits apart from the four because it is not a channel. Mixed units cannot share a Y
  // axis -- rotation is degrees, translation scene units, weight is 0..1, so a weight curve
  // drawn raw against a view framed for rotation is a flat line on the floor -- and matt chose
  // an explicit toggle over the view silently changing mode when a second group is switched on.
  _xfSegRects() {
    const pad = 6, gap = 3, n = XF_GROUPS.length;
    const w = (200 - pad * 2 - gap * n) / (n + 1);
    const LABEL = { pos: 'T', rot: 'R', scale: 'S', weight: 'W' };
    const rects = XF_GROUPS.map((g, i) => ({
      g, x: pad + i * (w + gap), y: HEADER_H + 5, w, h: XF_SEG_H - 6, label: LABEL[g],
    }));
    rects.push({ g: null, norm: true, x: pad + n * (w + gap), y: HEADER_H + 5,
                 w, h: XF_SEG_H - 6, label: 'N' });
    return rects;
  }

  // Normalise each visible group to its own vertical range, so groups in different units can be
  // read against each other for TIMING and SHAPE. Off by default: raw units are the truth, and
  // this is the comparison view.
  _xfNorm() { return !!window._animXfNorm; }

  // Toolbar value field rect — sits just left of the frame field.
  _valueFieldRect() {
    const fr = this._frameFieldRect();
    const w = 64, gap = 6;
    return { x: fr.x - w - gap, y: 5, w, h: 20 };
  }

  // Apply a value expression to the selected key(s) from the toolbar value field.
  //   plain number → set EVERY selected key's value to it (e.g. "0" zeroes them all).
  //   += / -= / *= / /= → adjust each key's value by the expression. No clamping.
  _applyValueExpr(rawVal) {
    const reg = window._animationRegistry;
    const sel = window._animSelectedKeys;
    tlLog(`applyValue "${rawVal}" selected=${sel?.length ?? 0} group=${xfGroup()}`,
      sel?.length ? JSON.stringify(sel.map((k) => ({ t: k.type, i: k.index, ch: k.channel }))) : '');
    if (!reg || !sel?.length) return;
    const s = String(rawVal ?? '').trim();
    if (!s) return;
    const parseExpr = (raw, cur) => {
      const op = raw.slice(0, 2); const n = parseFloat(raw.slice(2));
      if (op === '+=' && !isNaN(n)) return cur + n;
      if (op === '-=' && !isNaN(n)) return cur - n;
      if (op === '*=' && !isNaN(n)) return cur * n;
      if (op === '/=' && !isNaN(n) && n !== 0) return cur / n;
      const d = parseFloat(raw); return isNaN(d) ? null : d;
    };
    const before = this._snapshotTracks();
    let changed = false;
    sel.forEach(k => {
      const tr = reg.tracks.get(k.meshId); if (!tr) return;
      const cur = this._keyValue(k, tr) ?? 0;
      const nv = parseExpr(s, cur);
      if (nv == null) return;
      if (k.type === 'transform') {
        xfWrite(tr, k.index, k.channel ?? 0, nv, k.group);
      } else if (k.type === 'shape') {
        if (!tr.shapeOutputTimes) tr.shapeOutputTimes = [...(tr.shapeTimes || [])];
        tr.shapeOutputTimes[k.index] = nv;
      } else if (k.type === 'blendshape') {
        const bt = tr.blendshapeTracks?.get(k.name);
        if (bt?.values) bt.values[k.index] = nv; // no clamp
      }
      changed = true;
    });
    if (!changed) return;
    const after = this._snapshotTracks();
    const selSnap = sel.map(k => ({ ...k }));
    this._main.getStateManager().pushStateCustom(
      () => { window._animSelectedKeys = selSnap.map(k => ({ ...k })); this._restoreTracksInPlace(before); },
      () => { window._animSelectedKeys = selSnap.map(k => ({ ...k })); this._restoreTracksInPlace(after); },
      false, 'Set Keyframe Value'
    );
    const m = this._main?.getMesh?.();
    if (m) reg.update(m, true);
    if (this._main?.render) this._main.render();
    this.draw();
  }

  isMouseOver() {
    return this._isMouseOver;
  }

  onResize() {
    const sidebar = document.querySelector('#gui-sidebar');
    if (sidebar) {
      this._container.style.right = sidebar.offsetWidth + 'px';
      this._container.style.width = 'auto';
      
      if (!this._sidebarObserver) {
        this._sidebarObserver = new ResizeObserver(entries => {
          for (let entry of entries) {
            this._container.style.right = entry.contentRect.width + 'px';
            this.onResize();
          }
        });
        this._sidebarObserver.observe(sidebar);
      }
    } else {
      this._container.style.width = '100%';
    }

    const rect = this._container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = rect.width * dpr;
    this._canvas.height = rect.height * dpr;
    
    this._cssWidth = rect.width;
    this._cssHeight = rect.height;
    
    this._ctx.scale(dpr, dpr);
    this.draw();
  }

  valueToY(val) {
    return TimelineHelper.valueToY(val, this._cssHeight, HEADER_H, this._zoomY, this._panY);
  }

  // A value in group `grp`, expressed on the NORMALISED axis: each group's own min..max across
  // X, Y and Z maps onto -1..1, so every curve fills the same band whatever its units.
  //
  // The first version mapped straight to SCREEN pixels, which looked like normalising and was
  // not: the axis, the gridlines and the drag maths all still spoke raw units, so the view read
  // as "position half fitted, rotation and scale barely touched". Going through valueToY means
  // the whole graph -- ruler included -- is in the same -1..1 space, which is what matt asked
  // for: "i'd expect the graph zoom range to jump to -1 to 1 vertically."
  _normVal(val, grp, ranges) {
    const r = ranges && ranges[grp];
    if (!r) return val;
    return (val - r.mid) / r.half;
  }

  _valY(val, grp, ranges) {
    if (!this._xfNorm() || !ranges) return this.valueToY(val);
    return this.valueToY(this._normVal(val, grp, ranges));
  }

  // THE VALUE AS THE GRAPH SHOWS IT, and the way back.
  //
  // The transform box is a box IN THE VIEW: dragging its top edge scales about its bottom edge,
  // whatever the curves inside it are made of. That only works if the box and the keys are
  // measured in the same space -- and with Normalise on they were not, because the box's extent
  // was built from RAW values while the curves were drawn normalised. So the box sat somewhere
  // the keys were not, and the scale mixed a normalised target with raw values.
  //
  // Everything about the box now happens in DISPLAY space, converted back on the way into the
  // key. With Normalise off both are the identity, so raw mode is untouched -- it was already
  // scaling about the box edges correctly, which is what the UI implies and what it did.
  _dispVal(raw, grp) {
    if (!this._xfNorm()) return raw;
    return this._normVal(raw, grp, this._liveNormRanges());
  }

  _rawVal(disp, grp) {
    if (!this._xfNorm()) return disp;
    const r = this._liveNormRanges();
    const g = r && r[grp];
    return g ? disp * g.half + g.mid : disp;
  }

  _liveNormRanges() {
    if (!this._xfNorm()) return null;
    const reg = window._animationRegistry;
    const mesh = this._graphMesh && this._graphMesh();
    const tr = reg && mesh ? reg.tracks.get(mesh.getID()) : null;
    return this._xfNormRanges(tr);
  }

  // Each visible group's centre and half-range, measured once per draw across ALL THREE of its
  // channels together -- so X, Y and Z keep their relative proportions inside the group and only
  // the group as a whole is rescaled.
  _xfNormRanges(track) {
    if (!this._xfNorm() || !track) return null;
    const out = {};
    // A group with no variation still needs a defined mapping, or it falls through to raw units
    // and reads as "normalise did nothing to this one" -- which is exactly how the missing
    // `scales` array showed up.
    const FLAT = { pos: 1, rot: 90, scale: 1, weight: 1 };
    for (const g of xfVisible()) {
      let lo = Infinity, hi = -Infinity;
      if (g === 'weight') {
        const st = xfWeightTrack(track);
        for (const v of (st ? st.values : [])) { if (v < lo) lo = v; if (v > hi) hi = v; }
      } else {
        const n = track.times ? track.times.length : 0;
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
          const v = xfRead(track, i, c, g);
          if (typeof v !== 'number' || !isFinite(v)) continue;
          if (v < lo) lo = v; if (v > hi) hi = v;
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 0; }
      const span = (hi - lo) > 1e-6 ? (hi - lo) : (FLAT[g] || 1);
      out[g] = { mid: (lo + hi) / 2, half: span / 2 };
    }
    return out;
  }

  // Turning Normalise on frames the view on -1..1, because that is the range everything is now
  // in; turning it off puts back whatever the raw view was, rather than leaving a zoom that
  // meant something else.
  _applyNormView(on) {
    const band = Math.max(1, this._cssHeight - HEADER_H);
    if (on) {
      this._rawView = { zoomY: this._zoomY, panY: this._panY };
      this._zoomY = (band * 0.8) / 2;   // -1..1 across 80% of the band
      this._panY = 0;
    } else if (this._rawView) {
      this._zoomY = this._rawView.zoomY;
      this._panY = this._rawView.panY;
      this._rawView = null;
    }
  }

  yToValue(y) {
    return TimelineHelper.yToValue(y, this._cssHeight, HEADER_H, this._zoomY, this._panY);
  }

  drawPlayhead(ctx) {
    const reg = window._animationRegistry;
    if (!reg) return;
    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDurationReal = Math.max(0.1, loopEndReal - loopStartReal);
    const currentTimeVal = window._animCurrentTime !== undefined ? window._animCurrentTime : 0;

    let loopStart = loopStartReal;
    let visibleDuration = visibleDurationReal;
    if (this._viewDuration === undefined) {
      this._viewStart = loopStart;
      this._viewDuration = visibleDuration;
    }
    if (this._viewDuration !== undefined) {
      loopStart = this._viewStart;
      visibleDuration = this._viewDuration;
    }
    const tlX = 200;
    const tlW = this._cssWidth - 200;
    const headerH = HEADER_H;
    const fps = window._animFPS || 24;
    const snappedTime = Math.round(currentTimeVal * fps) / fps;
    const playheadAlpha = (snappedTime - loopStart) / visibleDuration;
    const playheadX = tlX + playheadAlpha * tlW;

    if (playheadX >= tlX && playheadX <= tlX + tlW) {
      const capStartY = TOOLBAR_BOTTOM;
      const phHovered = Math.abs(this._lastMouseX - playheadX) < 10
                     && this._lastMouseY >= capStartY && this._lastMouseY <= this._cssHeight;
      const phColor = phHovered ? '#88bbff' : TL_ACCENT;

      ctx.strokeStyle = phColor;
      ctx.lineWidth = phHovered ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, headerH);
      ctx.lineTo(playheadX, this._cssHeight);
      ctx.stroke();

      ctx.fillStyle = phColor;
      ctx.beginPath();
      ctx.moveTo(playheadX - 8, capStartY);
      ctx.lineTo(playheadX + 8, capStartY);
      ctx.lineTo(playheadX + 8, headerH - 5);
      ctx.lineTo(playheadX, headerH);
      ctx.lineTo(playheadX - 8, headerH - 5);
      ctx.closePath();
      ctx.fill();

      const curT = Math.round(currentTimeVal * fps);
      ctx.fillStyle = Theme.text;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(curT, playheadX, Math.round((capStartY + headerH) / 2));
    }
  }

  // Track entries [meshId, track] for the dopesheet/graph lanes, EXCLUDING shape-
  // replacement (SR) group child frames — those are real objects with vis tracks but
  // are authored via the collapsed group + New/Dup/Del, not as individual rows.
  // Used everywhere lane layout matters so draw and hit-test stay aligned.
  _dopesheetTracks() {
    const reg = window._animationRegistry;
    if (!reg) return [];
    const meshes = this._main.getMeshes?.() || [];
    const liveIds = new Set(meshes.map(m => m.getID()));
    const srChildIds = new Set(
      meshes.filter(m => m._parentMesh && m._parentMesh._isFrameGroup).map(m => m.getID())
    );
    // Only show tracks for meshes still IN the scene — a deleted mesh's track lingers
    // in the registry (kept so undo can restore it) but must not draw a phantom row.
    let entries = Array.from(reg.tracks.entries()).filter(([id]) => liveIds.has(id) && !srChildIds.has(id));

    // A KEYED BONE GETS A ROW OF ITS OWN, like every other object.
    //
    // These were folded into one synthetic row per skeleton, with the real joint entries
    // removed. That was right when Key Pose was the only way in: thirty joints keyed
    // identically, one row saying where the poses are, per-key editing deferred. The row
    // carried the joints' key TIMES, so it drew keys and they highlighted — but its id was
    // deliberately not a real mesh id, so nothing downstream could resolve it to a track and
    // hit-testing, dragging and deleting all no-op'd on it.
    //
    // Keying is now per CONTROL — a pin here, the hips there — so the rows it folded away are
    // the ones you authored and want to edit, and "highlights but will not select" was the
    // whole of it. Pins never folded (they are _isPinTarget, not _isBone), which is why they
    // behaved and bones did not.
    //
    // The cost is back: a Key Pose on a thirty-joint rig is thirty rows. If that becomes the
    // common case again, the fix is to make the summary row RESOLVE to its joints (click
    // selects the pose, drag retimes it together) rather than to hide them.

    // One synthetic row per frame GROUP (the whole flipbook on a single lane), unless
    // it already has a real track (e.g. group transform animation). drawDopeSheet draws
    // its frame markers from the children's _srFrameTime.
    meshes.filter(m => m._isFrameGroup).forEach(g => {
      if (!entries.some(([id]) => id === g.getID())) entries.push([g.getID(), { _srGroupRow: true }]);
    });
    return entries;
  }

  // Delete a blendshape's ANIMATION track (its weight keyframes). The layer itself stays
  // in the blendshape stack — only its timeline animation is removed. Undoable.
  _deleteBlendshapeTrack(mesh, name) {
    const reg = window._animationRegistry;
    if (!reg || !mesh) return;
    const bt = reg.tracks.get(mesh.getID())?.blendshapeTracks?.get(name);
    if (!bt || !bt.times || bt.times.length === 0) return;
    const meshId = mesh.getID();
    const before = { times: bt.times.slice(), values: bt.values.slice() };
    const setKeys = (times, values) => {
      const b = reg.tracks.get(meshId)?.blendshapeTracks?.get(name);
      if (b) { b.times = times.slice(); b.values = values.slice(); }
      // Drop any selection that pointed at this track so nothing dangles.
      if (window._animSelectedKeys) {
        window._animSelectedKeys = window._animSelectedKeys.filter(
          k => !(k.type === 'blendshape' && k.meshId === meshId && k.name === name));
      }
      reg.applyBlendshapes?.(mesh);
      if (window.app?.render) window.app.render();
      this.draw();
    };
    setKeys([], []);
    window.app?.getStateManager?.()?.pushStateCustom?.(
      () => setKeys(before.times, before.values),   // undo
      () => setKeys([], []),                          // redo
      false, 'Delete Blendshape Track');
  }

  // Move the playhead to an explicit time and apply it (stop playback, re-evaluate
  // every mesh so visibility/transform tracks update, refresh outliner eyes).
  _setPlayhead(t) {
    // The same seek the animation panel's transport buttons use — evaluate every mesh, reset any
    // physics chain (a jump in time has no "previous frame"), refresh the DRAWN rig, render.
    // Two copies of this is what let the panel's rewind move the data and not the skeleton.
    const reg = window._animationRegistry;
    if (reg) reg.seek(t);
    else { window._animPlaying = false; window._animCurrentTime = t; }
    this.draw();
  }

  drawGraph(ctx) {
    const headerH = HEADER_H;
    const graphH = this._cssHeight - headerH;
    const tlX = 200;
    const tlW = this._cssWidth - 200;
    const fps = window._animFPS || 24;

    const reg = window._animationRegistry;
    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDurationReal = Math.max(0.1, loopEndReal - loopStartReal);

    if (this._viewDuration === undefined) {
      this._viewStart = loopStartReal;
      this._viewDuration = visibleDurationReal;
    }

    const loopStart = this._viewStart;
    const visibleDuration = this._viewDuration;
    const loopEnd = loopStart + visibleDuration;

    // Draw Gutter Content (Channel List) for Graph Editor
    ctx.save();
    const gutterY = headerH + 4 + XF_SEG_H;
    const rowH = 22; // 25% smaller than original 30
    const XYZ_COLORS = ['#ff4444', '#44ff44', '#4444ff'];
    // ONE LABELLED TRIPLE PER VISIBLE GROUP. The gutter listed a single X/Y/Z trio for the
    // ACTIVE group, which was right while the strip was a radio and became a lie the moment two
    // groups could be drawn at once -- matt: "if i have combinations of TRS displayed, the
    // gutter should show them all as channel names, right now it only shows a single triple."
    //
    // `rowMeta` runs alongside so drawing, the eye toggles and the click hit-test all agree on
    // which row is which group's which channel; the row INDEX is no longer the channel number.
    const PREFIX = { pos: 'T', rot: 'R', scale: 'S' };
    const colors = [];
    const labels = [];
    const rowMeta = [];
    for (const g of xfVisible()) {
      if (g === 'weight') continue;
      for (let c = 0; c < 3; c++) {
        labels.push(PREFIX[g] + 'XYZ'[c]);
        colors.push(XYZ_COLORS[c]);
        rowMeta.push({ kind: 'xf', group: g, channel: c });
      }
    }
    if (xfIsVisible('weight')) {
      labels.push('Weight');
      colors.push('#f9e2af');
      rowMeta.push({ kind: 'weight' });
    }

    const activeMeshForGutter = this._graphMesh();
    const idForGutter = activeMeshForGutter ? activeMeshForGutter.getID() : null;
    const trackForGutter = idForGutter ? reg.tracks.get(idForGutter) : null;

    if (trackForGutter && trackForGutter.shapeTimes && trackForGutter.shapeTimes.length >= 2) {
      colors.push('#ff00ff');
      labels.push('Shot');
      rowMeta.push({ kind: 'shape' });
    }
    // Published for the click handler, which has to turn a row index back into a group and a
    // channel. Derived in one place so the two cannot drift.
    this._gutterRowMeta = rowMeta;

    if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];
    if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
    const bsColors = ['#ff8844', '#44ffcc', '#ffdd44', '#aa44ff', '#ff44bb', '#44bbff'];
    const bsCount = trackForGutter?.blendshapeTracks?.size ?? 0;
    const totalRows = labels.length + bsCount;
    const visibleGutterH = this._cssHeight - headerH;
    this._gutterMaxScroll = Math.max(0, totalRows * rowH - visibleGutterH + 8);
    this._gutterScrollY = Math.min(this._gutterScrollY, this._gutterMaxScroll);

    // The T|R|S strip. Drawn BEFORE the clip below, so it stays put while the channel rows
    // scroll under it — it is a mode switch, not a row.
    {
      for (const r of this._xfSegRects()) {
        const on = r.norm ? this._xfNorm() : xfIsVisible(r.g);
        const hov = this._lastMouseX >= r.x && this._lastMouseX <= r.x + r.w
                 && this._lastMouseY >= r.y && this._lastMouseY <= r.y + r.h;
        ctx.fillStyle = on ? TL_ACCENT : (hov ? Theme.surface1 : Theme.surface0);
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 3);
        ctx.fill();
        ctx.fillStyle = on ? '#ffffff' : Theme.text;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // Clip to gutter column so scrolled rows don't bleed into header or outside
    ctx.beginPath();
    ctx.rect(0, headerH, 200, visibleGutterH);
    ctx.clip();

    // Helper: draw one gutter row.  valStr (optional) is shown as a right-aligned
    // numeric badge; editable = true marks the badge as click-to-edit.
    const _drawRow = (rowIdx, label, color, isVisible, valStr = null, editable = false, highlight = false) => {
      const ry = gutterY + rowIdx * rowH - this._gutterScrollY;
      if (ry + rowH < headerH || ry > this._cssHeight) return; // culled

      // Gutter-row hover: cursor (mouse or VR ray) over the left gutter band of this
      // row. Highlights the channel name + visibility eye.
      const rowHov = this._lastMouseX >= 0 && this._lastMouseX < 200
                  && this._lastMouseY >= ry && this._lastMouseY <= ry + rowH;

      // Highlight a channel that is selected/being edited (green) or hovered (white).
      if (highlight) {
        ctx.fillStyle = 'rgba(80,150,100,0.20)';
        ctx.fillRect(0, ry, 200, rowH);
      } else if (rowHov) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, ry, 200, rowH);
      }

      // Color bar (4 × 14 px)
      ctx.fillStyle = color;
      ctx.fillRect(4, ry + 4, 4, 14);

      // Eye icon at 60% scale (brightens on hover)
      const eyeCol = rowHov ? Theme.text : (isVisible ? color : Theme.surface1);
      ctx.save();
      ctx.translate(16, ry + 2);
      ctx.scale(0.6, 0.6);
      ctx.strokeStyle = eyeCol;
      ctx.lineWidth = 1.5;
      const eyePath = new Path2D('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z');
      ctx.stroke(eyePath);
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.fillStyle = eyeCol;
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = (highlight || rowHov) ? Theme.text : (isVisible ? Theme.text : Theme.surface1);
      ctx.font = (highlight || rowHov) ? 'bold 10px sans-serif' : '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Truncate label so it doesn't bleed into the value badge
      ctx.fillText(label, 36, ry + rowH / 2);

      // Numeric value badge (right-aligned, x:140-184) — narrow, values are ≤4 chars
      if (valStr !== null) {
        const vx = 140, vw = 44, vh = rowH - 6;
        const vy = Math.round(ry + 3);
        const hovVal = this._lastMouseX >= vx && this._lastMouseX <= vx + vw
                    && this._lastMouseY >= vy && this._lastMouseY <= vy + vh;
        ctx.fillStyle = hovVal && editable ? '#3a4a3a' : Theme.surface0;
        ctx.beginPath();
        ctx.roundRect(vx, vy, vw, vh, 2);
        ctx.fill();
        ctx.fillStyle = hovVal && editable ? '#88ddaa' : Theme.subtext;
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(valStr, vx + vw - 4, vy + vh / 2);
        if (editable) {
          ctx.strokeStyle = hovVal ? '#446644' : Theme.surface0;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    };

    // Which channels are selected in the graph editor → highlight them in the
    // gutter (bold + row tint), plus the channel being edited. Transform keys
    // map to channel rows 0-2, shape keys to the 'Shot' row, blendshape by name.
    const _sel = window._animSelectedKeys || [];
    const selBsNames = new Set();
    const selXfCh = new Set();
    let selHasShape = false;
    for (const k of _sel) {
      if (k.type === 'blendshape' && k.name) selBsNames.add(k.name);
      else if (k.type === 'transform' && k.channel !== undefined) selXfCh.add(k.channel);
      else if (k.type === 'shape') selHasShape = true;
    }
    if (this._editingBsName) selBsNames.add(this._editingBsName);

    // When the set of selected channels changes, pan the gutter to reveal the
    // first selected blendshape (it may be scrolled out of view). Guarded by a
    // signature so manual scrolling isn't fought on every frame.
    const _selSig = [...selBsNames].sort().join('|');
    if (_selSig !== this._lastSelBsSig) {
      this._lastSelBsSig = _selSig;
      if (selBsNames.size && trackForGutter?.blendshapeTracks) {
        const _bsKeys = TimelineHelper.bsNames(trackForGutter);
        for (let i = 0; i < _bsKeys.length; i++) {
          if (selBsNames.has(_bsKeys[i])) { this._ensureGutterRowVisible(labels.length + i); break; }
        }
      }
    }

    // Hovered curve also highlights its gutter row (added AFTER the auto-scroll
    // signature so hovering doesn't pan the gutter — only selection does).
    const _hc = this._hoverCurve;

    // Current-time values for display — read from mesh matrix (already animated by reg.update)
    const _gMatrix = activeMeshForGutter?.getMatrix?.();
    const _gPosVals = _gMatrix ? [_gMatrix[12], _gMatrix[13], _gMatrix[14]] : null;
    for (let ch = 0; ch < labels.length; ch++) {
      const m = rowMeta[ch] || { kind: 'shape' };
      // The value badge is read off the matrix TRANSLATION, so it is only true for the
      // translation rows. It used to be shown against whichever group was active, which meant
      // the rotation rows displayed position numbers.
      const _gVal = (m.kind === 'xf' && m.group === 'pos' && _gPosVals)
        ? _gPosVals[m.channel].toFixed(2) : null;
      const _vis = m.kind === 'xf' ? xfChanVisible(m.group, m.channel)
        : (m.kind === 'weight' ? true : window._animChannelVisible[3] !== false);
      const _hl = m.kind === 'xf'
        ? (selXfCh.has(m.channel) || (_hc && _hc.kind === 'transform' && _hc.channel === m.channel))
        : (m.kind === 'shape' ? (selHasShape || (_hc && _hc.kind === 'shape')) : false);
      _drawRow(ch, labels[ch], colors[ch], _vis, _gVal, false, _hl);
    }

    if (trackForGutter?.blendshapeTracks) {
      let bsIdx = 0;
      TimelineHelper.bsEntries(trackForGutter).forEach(([name, bTrack]) => {
        const color     = bsColors[bsIdx % bsColors.length];
        const isVisible = window._animBsChannelVisible[name] !== false;
        // Evaluate current weight for display in the value badge
        const _bsW = window._animationRegistry?.evaluateScalarTrack?.(bTrack, trackForGutter.playbackTime || 0) ?? 0;
        const _bsValStr = this._bsScrubName === name ? _bsW.toFixed(2) : _bsW.toFixed(2);
        const _bsHl = selBsNames.has(name) || (_hc && _hc.kind === 'blendshape' && _hc.name === name);
        _drawRow(labels.length + bsIdx, name, color, isVisible, _bsValStr, true, _bsHl);

        bsIdx++;
      });
    }

    // Scroll indicator bar
    if (this._gutterMaxScroll > 0) {
      const barW = 13;
      const barX = 200 - barW - 1;
      const barH = Math.max(20, visibleGutterH * visibleGutterH / (totalRows * rowH));
      const barY = headerH + (this._gutterScrollY / this._gutterMaxScroll) * (visibleGutterH - barH);
      // Cache for hover hit test
      this._gutterBarRect = { x: barX, y: barY, w: barW, h: barH };
      const hovered = this._lastMouseX >= barX && this._lastMouseX <= barX + barW
                   && this._lastMouseY >= barY && this._lastMouseY <= barY + barH;
      ctx.fillStyle = hovered ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.20)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 3);
      ctx.fill();
    }

    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(tlX, headerH, tlW, this._cssHeight - headerH);
    ctx.clip();

    // [Step 4] Draw vertical grid lines — density matches ruler tick logic.
    {
      const totalFrames = visibleDuration * fps;
      const pxPerFrame = tlW / Math.max(1, totalFrames);
      let gridMajorInt, gridMinorInt;
      if      (pxPerFrame >= 16) { gridMajorInt = 1;        gridMinorInt = 0; }
      else if (pxPerFrame >= 8)  { gridMajorInt = 5;        gridMinorInt = 1; }
      else if (pxPerFrame >= 4)  { gridMajorInt = 10;       gridMinorInt = 5; }
      else if (pxPerFrame >= 2)  { gridMajorInt = fps;      gridMinorInt = Math.max(1, Math.round(fps / 4)); }
      else if (pxPerFrame >= 0.5){ gridMajorInt = fps * 2;  gridMinorInt = fps; }
      else                       { gridMajorInt = fps * 5;  gridMinorInt = fps; }
      const fStart = Math.ceil(loopStart * fps);
      const fEnd   = Math.floor(loopEnd   * fps);
      ctx.lineWidth = 1;
      for (let f = fStart; f <= fEnd; f++) {
        const isMajor = gridMajorInt > 0 && (f % gridMajorInt === 0);
        const isMinor = gridMinorInt > 0 && (f % gridMinorInt === 0);
        if (!isMajor && !isMinor) continue;
        const gx = tlX + ((f / fps - loopStart) / visibleDuration) * tlW;
        ctx.strokeStyle = isMajor ? Theme.surface0 : Theme.mantle;
        ctx.beginPath();
        ctx.moveTo(gx, headerH);
        ctx.lineTo(gx, this._cssHeight);
        ctx.stroke();
      }
    }

    // [Step 4] Horizontal value grid lines in graph mode.
    {
      const graphH = this._cssHeight - headerH;
      const pxPerUnit = this._zoomY;
      // Pick a round value interval that gives roughly 30-80px spacing.
      const rawInterval = 60 / Math.max(1, pxPerUnit);
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(0.0001, rawInterval))));
      const normalised = rawInterval / magnitude;
      const niceStep = normalised < 1.5 ? 1 : normalised < 3.5 ? 2 : normalised < 7.5 ? 5 : 10;
      const valueStep = niceStep * magnitude;
      const topVal    = this.yToValue(headerH);
      const botVal    = this.yToValue(this._cssHeight);
      const vMin = Math.min(topVal, botVal);
      const vMax = Math.max(topVal, botVal);
      const vStart = Math.ceil(vMin / valueStep) * valueStep;
      ctx.lineWidth = 1;
      for (let v = vStart; v <= vMax + 1e-9; v += valueStep) {
        const gy = this.valueToY(v);
        if (gy < headerH || gy > this._cssHeight) continue;
        const isZero = Math.abs(v) < valueStep * 0.01;
        ctx.strokeStyle = isZero ? Theme.surface1 : Theme.surface0;
        ctx.lineWidth = isZero ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(tlX, gy);
        ctx.lineTo(tlX + tlW, gy);
        ctx.stroke();
        // Value label on left edge of grid area
        if (!isZero) {
          ctx.fillStyle = Theme.surface1;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(v.toPrecision(3).replace(/\.?0+$/, ''), tlX + 4, gy);
        }
      }
      ctx.lineWidth = 1;
    }

    // Draw Zero Axis (kept as slightly stronger line, drawn after grid)
    const zeroY = this.valueToY(0);
    if (zeroY >= headerH && zeroY <= this._cssHeight) {
      ctx.strokeStyle = Theme.overlay0;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tlX, zeroY);
      ctx.lineTo(tlX + tlW, zeroY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }



    // WHOSE CURVES ARE THESE? The graph shows one object at a time and never said which, so a
    // graph full of curves was unattributed — and with the target now settable from four places
    // (row name, key, marquee, the 3D selection as fallback) that is a real question. Drawn in
    // the same yellow the dopesheet gives the target row, so the two read as one selection.
    {
      const _gm = this._graphMesh();
      const _gname = _gm ? (_gm._permanentStaticLabel || `Object ${_gm.getID()}`) : 'nothing selected';
      ctx.save();
      ctx.fillStyle = _gm ? '#ffff00' : '#6c7086';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(_gname, 208, HEADER_H + 6);
      ctx.restore();
    }

    // 5. Draw Curves for Active Mesh
    const activeMesh = this._graphMesh();
    if (activeMesh) {
      const id = activeMesh.getID();
      const track = reg.tracks.get(id);
      if (track && track.times && track.times.length >= 2) {
        // Draw Position X, Y, Z
        const colors = ['#ff4444', '#44ff44', '#4444ff']; // R, G, B
        
        // EVERY VISIBLE GROUP, not just the active one -- the strip is a filter now.
        //
        // ALL SOLID. The three groups share the same red/green/blue for X/Y/Z, so they were
        // dashed to tell them apart. Once the gutter started naming every row that cue was
        // redundant, and a dashed curve is harder to read the shape of: matt, "dashed lines are
        // distracting." Which curve is which is answered by the gutter, which can say it in
        // words instead of in a pattern you have to learn.
        const normR = this._xfNormRanges(track);
        // Published for the value DRAG. Under normalise a vertical drag is measured in
        // normalised units, so writing it straight into the key would scale every edit by
        // whatever the group's range happens to be -- a 2-degree nudge on a 180-degree curve
        // would land as 180. The drag scales by the group's half-range to get back to real
        // units, and this is where that number lives.
        window._animXfNormRanges = normR;
        ctx.setLineDash([]);
        for (const grp of xfVisible()) {
          if (grp === 'weight') continue;   // one channel, its own track -- drawn below
        for (let channel = 0; channel < 3; channel++) {
          if (!xfChanVisible(grp, channel)) continue;

          const _hovC = this._hoverCurve?.kind === 'transform' && this._hoverCurve.channel === channel;
          ctx.strokeStyle = _hovC ? this._lightenHex(colors[channel]) : colors[channel];
          ctx.lineWidth = _hovC ? 3.5 : 2;
          ctx.beginPath();
          
          for (let i = 0; i < track.times.length - 1; i++) {
            const t1 = track.times[i];
            const t2 = track.times[i + 1];
            
            const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
            const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

            const isSelectedChannel = selChannel === channel;

            let m0 = 1.0;
            let m1 = 1.0;
            
            const dt = t2 - t1;
            
            const val1 = xfRead(track, i, channel, grp);
            const val2 = xfRead(track, i + 1, channel, grp);

            // Per GROUP as well as per channel -- see xfTanGet. Reading these ungrouped is what
            // put a translation tangent on the scale curve.
            const rightDt = xfTanGet(track, `${i}_right_dt`, grp);
            const rightDv = xfTanGet(track, `${i}_right_dv_${channel}`, grp);
            const leftDt = xfTanGet(track, `${i + 1}_left_dt`, grp);
            const leftDv = xfTanGet(track, `${i + 1}_left_dv_${channel}`, grp);

            const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
            const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;

            let slope0 = 0;
            if (i === 0) {
              slope0 = (xfRead(track, 1, channel, grp) - xfRead(track, 0, channel, grp)) / (track.times[1] - track.times[0]);
            } else if (i === track.times.length - 1) {
              slope0 = (xfRead(track, i, channel, grp) - xfRead(track, i - 1, channel, grp)) / (track.times[i] - track.times[i - 1]);
            } else {
              const pIdx = (i - 1) * 3;
              const nIdx = (i + 1) * 3;
              const dt_seg = track.times[i + 1] - track.times[i - 1];
              slope0 = dt_seg !== 0 ? (xfRead(track, nIdx / 3, channel, grp) - xfRead(track, pIdx / 3, channel, grp)) / dt_seg : 0;
            }

            let slope1 = 0;
            const i1 = i + 1;
            if (i1 === 0) {
              slope1 = (xfRead(track, 1, channel, grp) - xfRead(track, 0, channel, grp)) / (track.times[1] - track.times[0]);
            } else if (i1 === track.times.length - 1) {
              const pIdx = (i1 - 1) * 3;
              const cIdx = i1 * 3;
              slope1 = (xfRead(track, cIdx / 3, channel, grp) - xfRead(track, pIdx / 3, channel, grp)) / (track.times[i1] - track.times[i1 - 1]);
            } else {
              const pIdx = (i1 - 1) * 3;
              const nIdx = (i1 + 1) * 3;
              const dt_seg = track.times[i1 + 1] - track.times[i1 - 1];
              slope1 = dt_seg !== 0 ? (xfRead(track, nIdx / 3, channel, grp) - xfRead(track, pIdx / 3, channel, grp)) / dt_seg : 0;
            }

            const dv0 = rightDv !== undefined ? rightDv : slope0 * dt0;
            const dv1 = leftDv !== undefined ? leftDv : slope1 * dt1;

            const p1x = dt0 / dt;
            const p2x = 1 + dt1 / dt;

            const hasTangents = xfTanGet(track, `${i}_right_dv_${channel}`, grp) !== undefined
              || xfTanGet(track, `${i + 1}_left_dv_${channel}`, grp) !== undefined;

            const steps = 20;
            for (let s = 0; s <= steps; s++) {
              const targetAlpha = s / steps;
              
              const t = TimelineHelper.getBezierT(targetAlpha, p1x, p2x);
              const val = TimelineHelper.evaluateBezier(t, val1, val2, dv0, dv1);
              
              const time = t1 + targetAlpha * (t2 - t1);
              
              const x = tlX + ((time - loopStart) / visibleDuration) * tlW;
              const y = this._valY(val, grp, normR);
              
              if (i === 0 && s === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
          }
          // STROKE INSIDE THE CHANNEL LOOP. When the group wrapper was added, its closing brace
          // landed BEFORE this line -- so the braces still balanced and the file still parsed,
          // but stroke() ran once per GROUP instead of once per channel, and only the last
          // channel to call beginPath() was ever drawn. matt: "it only shows Z values ... it
          // always seems to only show a single value across all." A brace in the wrong place
          // with the right count is invisible to a syntax check.
          ctx.stroke();
        }
        }
        ctx.setLineDash([]);

        // Draw dots at keyframes
        for (const grp of xfVisible()) {
          if (grp === 'weight') continue;
        for (let i = 0; i < track.times.length; i++) {
          const t = track.times[i];
          for (let channel = 0; channel < 3; channel++) {
            if (!xfChanVisible(grp, channel)) continue;

            const val = xfRead(track, i, channel, grp);
            const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
            const y = this._valY(val, grp, normR);
            
            const isSelected = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i && k.channel === channel
              && (k.group || 'pos') === grp);
            const isHovered = TimelineHelper.isKeyHovered(x, y, this._lastMouseX, this._lastMouseY, 10);
            
            const isInsideMarquee = this._isDraggingMarquee && this._marqueeStart && this._marqueeEnd &&
                                    x >= Math.min(this._marqueeStart.x, this._marqueeEnd.x) &&
                                    x <= Math.max(this._marqueeStart.x, this._marqueeEnd.x) &&
                                    y >= Math.min(this._marqueeStart.y, this._marqueeEnd.y) &&
                                    y <= Math.max(this._marqueeStart.y, this._marqueeEnd.y);

            if (isSelected || isInsideMarquee) ctx.fillStyle = '#ffff00'; // Yellow
            else if (isHovered) ctx.fillStyle = '#00ffff'; // Cyan
            else ctx.fillStyle = Theme.subtext; // Gray

            const isTied = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_tied`] !== false : true;
            ctx.beginPath();
            if (isTied) {
              ctx.arc(x, y, KEY_R, 0, Math.PI * 2);
            } else {
              ctx.fillRect(x - KEY_R, y - KEY_R, KEY_R * 2, KEY_R * 2);
            }
            // Same trap as the stroke above: the group wrapper's closing brace landed BEFORE
            // this fill, so it ran once per group and only the last dot's path was ever filled.
            ctx.fill();
          }
        }
        }

        // ── THE PIN WEIGHT CURVE ──────────────────────────────────────────────────────
        //
        // One channel, not three, and its keys are its OWN -- they do not line up with the
        // transform keys, so it cannot ride the loops above. Drawn through the same evaluator
        // the blendshape weight curves use, because it is the same kind of track.
        if (xfIsVisible('weight')) {
          const wTrack = xfWeightTrack(track);
          if (wTrack && wTrack.times.length) {
            const WCOL = '#f9e2af';
            ctx.setLineDash([]);
            if (wTrack.times.length >= 2) {
              const _hovW = this._hoverCurve?.kind === 'weight';
              ctx.strokeStyle = _hovW ? this._lightenHex(WCOL) : WCOL;
              ctx.lineWidth = _hovW ? 3.5 : 2;
              ctx.beginPath();
              for (let i = 0; i < wTrack.times.length - 1; i++) {
                const t1 = wTrack.times[i], t2 = wTrack.times[i + 1];
                const v1 = wTrack.values[i], v2 = wTrack.values[i + 1];
                const dt = t2 - t1;
                const s0 = reg.getBsSlope(wTrack, i);
                const s1 = reg.getBsSlope(wTrack, i + 1);
                const dt0 = dt * 0.33, dt1 = -dt * 0.33;
                const dv0 = s0 * dt0, dv1 = s1 * dt1;
                const p1x = dt0 / dt, p2x = 1 + dt1 / dt;
                for (let st = 0; st <= 20; st++) {
                  const alpha = st / 20;
                  const bt = TimelineHelper.getBezierT(alpha, p1x, p2x);
                  const val = TimelineHelper.evaluateBezier(bt, v1, v2, dv0, dv1);
                  const x = tlX + ((t1 + alpha * dt - loopStart) / visibleDuration) * tlW;
                  const y = this._valY(val, 'weight', normR);
                  if (i === 0 && st === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
              }
              ctx.stroke();
            }
            for (let i = 0; i < wTrack.times.length; i++) {
              const x = tlX + ((wTrack.times[i] - loopStart) / visibleDuration) * tlW;
              const y = this._valY(wTrack.values[i], 'weight', normR);
              const sel = (window._animSelectedKeys || []).some((k) => k.meshId === id
                && k.type === 'transform' && k.group === 'weight' && k.index === i);
              ctx.fillStyle = sel ? '#ffff00'
                : (TimelineHelper.isKeyHovered(x, y, this._lastMouseX, this._lastMouseY, 10)
                    ? '#00ffff' : WCOL);
              ctx.beginPath();
              ctx.arc(x, y, KEY_R, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Draw Tangent Handles for Position Keys
        if (window._animShowTangents) {
          const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
          const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

          ctx.strokeStyle = Theme.subtext; // Revert to gray!
          ctx.lineWidth = 1.5;

          for (let i = 0; i < track.times.length; i++) {
            const t = track.times[i];
            const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
            
            // Handles belong to the SELECTED key's group -- reading them ungrouped is the bug
            // that put a translation tangent on the scale curve.
            const selGrp = (singleSelected && singleSelected.group) || xfGroup();
            const val = xfRead(track, i, selChannel, selGrp);
            const ky = this.valueToY(val);

            const rightDt = xfTanGet(track, `${i}_right_dt`, selGrp);
            const rightDv = xfTanGet(track, `${i}_right_dv_${selChannel}`, selGrp);
            const leftDt = xfTanGet(track, `${i}_left_dt`, selGrp);
            const leftDv = xfTanGet(track, `${i}_left_dv_${selChannel}`, selGrp);

            const slope = reg.getCurveSlope ? reg.getCurveSlope(track, i, selChannel) : 0;
            const dt_right = (i < track.times.length - 1) ? track.times[i + 1] - track.times[i] : 0.2;
            const dt_left = (i > 0) ? track.times[i] - track.times[i - 1] : 0.2;

            const rightXOff = rightDt !== undefined ? (rightDt / visibleDuration) * tlW : 25;
            const rightYOff = rightDv !== undefined ? -rightDv * this._zoomY : -slope * (rightDt !== undefined ? rightDt : dt_right * 0.33) * this._zoomY;
            
            const leftXOff = leftDt !== undefined ? (leftDt / visibleDuration) * tlW : -25;
            const leftYOff = leftDv !== undefined ? -leftDv * this._zoomY : -slope * (leftDt !== undefined ? leftDt : -dt_left * 0.33) * this._zoomY;

            // Draw right handle
            if (i < track.times.length - 1) {
              ctx.beginPath();
              ctx.moveTo(kx, ky);
              ctx.lineTo(kx + rightXOff, ky + rightYOff);
              ctx.stroke();
              
              const isRightHovered = TimelineHelper.isKeyHovered(kx + rightXOff, ky + rightYOff, this._lastMouseX, this._lastMouseY, 10);
              const isRightActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'right';

              if (isRightActive) ctx.fillStyle = '#ffff00'; // Yellow
              else if (isRightHovered) ctx.fillStyle = '#00ffff'; // Cyan
              else ctx.fillStyle = Theme.subtext; // Gray
              
              ctx.beginPath();
              ctx.arc(kx + rightXOff, ky + rightYOff, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
            
            // Draw left handle
            if (i > 0) {
              ctx.beginPath();
              ctx.moveTo(kx, ky);
              ctx.lineTo(kx + leftXOff, ky + leftYOff);
              ctx.stroke();
              
              const isLeftHovered = TimelineHelper.isKeyHovered(kx + leftXOff, ky + leftYOff, this._lastMouseX, this._lastMouseY, 10);
              const isLeftActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'left';

              if (isLeftActive) ctx.fillStyle = '#ffff00'; // Yellow
              else if (isLeftHovered) ctx.fillStyle = '#00ffff'; // Cyan
              else ctx.fillStyle = Theme.subtext; // Gray
              
              ctx.beginPath();
              ctx.arc(kx + leftXOff, ky + leftYOff, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // 6. Draw Shape Key Time Curve (Time Warping)
      if (track && track.shapeTimes) {
        if (track.shapeTimes.length >= 2) {
          const isVisible = window._animChannelVisible ? window._animChannelVisible[3] !== false : true;
          if (isVisible) {
            const _hovS = this._hoverCurve?.kind === 'shape';
            ctx.strokeStyle = _hovS ? this._lightenHex('#ff00ff') : '#ff00ff'; // Magenta for Time Curve
          ctx.lineWidth = _hovS ? 3.5 : 2;
          
          for (let i = 0; i < track.shapeTimes.length - 1; i++) {
            const t1 = track.shapeTimes[i];
            const t2 = track.shapeTimes[i + 1];
            const v1 = track.shapeOutputTimes ? track.shapeOutputTimes[i] : t1;
            const v2 = track.shapeOutputTimes ? track.shapeOutputTimes[i + 1] : t2;
            
            const ky1 = this.valueToY(v1);
            const ky2 = this.valueToY(v2);
            
            ctx.beginPath();
            
            const dt = t2 - t1;
            const rightDt = track.tangentOffsets ? track.tangentOffsets[`${i}_right_dt`] : undefined;
            const rightDv = track.tangentOffsets ? track.tangentOffsets[`${i}_right_dv`] : undefined;
            const leftDt = track.tangentOffsets ? track.tangentOffsets[`${i + 1}_left_dt`] : undefined;
            const leftDv = track.tangentOffsets ? track.tangentOffsets[`${i + 1}_left_dv`] : undefined;
            
            const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
            const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
            
            const slope = dt > 0 ? (v2 - v1) / dt : 0;
            
            const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
            const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
            
            const p1x = dt0 / dt;
            const p2x = 1 + dt1 / dt;

            const steps = 20;
            for (let s = 0; s <= steps; s++) {
              const alpha = s / steps;
              let warpedTime = v1 + (v2 - v1) * alpha;
              
              if (window._animShowTangents && track.tangentOffsets) {
                const t_bez = window._animationRegistry.getBezierT(alpha, p1x, p2x);
                warpedTime = TimelineHelper.evaluateBezier(t_bez, v1, v2, dv0, dv1);
              }
              
              const time = t1 + alpha * (t2 - t1);
              const x = tlX + ((time - loopStart) / visibleDuration) * tlW;
              const y = this.valueToY(warpedTime);
              
              if (s === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
            
            // Draw Tangent Handles
            if (window._animShowTangents) {
              ctx.strokeStyle = Theme.subtext;
              ctx.lineWidth = 1;
              
              const kx1 = tlX + ((t1 - loopStart) / visibleDuration) * tlW;
              const kx2 = tlX + ((t2 - loopStart) / visibleDuration) * tlW;
              
              const rightXOff = (dt0 / visibleDuration) * tlW;
              const rightYOff = -dv0 * this._zoomY;
              
              const leftXOff = (dt1 / visibleDuration) * tlW;
              const leftYOff = -dv1 * this._zoomY;

              // Draw right handle at start of segment
              ctx.beginPath();
              ctx.moveTo(kx1, ky1);
              ctx.lineTo(kx1 + rightXOff, ky1 + rightYOff);
              ctx.stroke();
              
              const isRightHovered = TimelineHelper.isKeyHovered(kx1 + rightXOff, ky1 + rightYOff, this._lastMouseX, this._lastMouseY, 10);
              const isRightActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'right' && this._activeTangentType === 'shape';
              
              if (isRightActive) ctx.fillStyle = '#ffff00'; // Yellow
              else if (isRightHovered) ctx.fillStyle = '#00ffff'; // Cyan
              else ctx.fillStyle = Theme.subtext; // Gray
              
              ctx.beginPath();
              ctx.arc(kx1 + rightXOff, ky1 + rightYOff, 2.5, 0, Math.PI * 2);
              ctx.fill();
              
              // Draw left handle at end of segment
              ctx.beginPath();
              ctx.moveTo(kx2, ky2);
              ctx.lineTo(kx2 + leftXOff, ky2 + leftYOff);
              ctx.stroke();
              
              const isLeftHovered = TimelineHelper.isKeyHovered(kx2 + leftXOff, ky2 + leftYOff, this._lastMouseX, this._lastMouseY, 10);
              const isLeftActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'left' && this._activeTangentType === 'shape';
              
              if (isLeftActive) ctx.fillStyle = '#ffff00'; // Yellow
              else if (isLeftHovered) ctx.fillStyle = '#00ffff'; // Cyan
              else ctx.fillStyle = Theme.subtext; // Gray
              
              ctx.beginPath();
              ctx.arc(kx2 + leftXOff, ky2 + leftYOff, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        
        // Draw Shape Keys (Points) on the Time Curve
        for (let i = 0; i < track.shapeTimes.length; i++) {
          const t = track.shapeTimes[i];
          const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
          const val = track.shapeOutputTimes ? track.shapeOutputTimes[i] : t;
          const y = this.valueToY(val);
          
          const isSelected = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'shape' && k.index === i);
          const isHovered = TimelineHelper.isKeyHovered(x, y, this._lastMouseX, this._lastMouseY, 10);
          
          const isInsideMarquee = this._isDraggingMarquee && this._marqueeStart && this._marqueeEnd &&
                                  x >= Math.min(this._marqueeStart.x, this._marqueeEnd.x) &&
                                  x <= Math.max(this._marqueeStart.x, this._marqueeEnd.x) &&
                                  y >= Math.min(this._marqueeStart.y, this._marqueeEnd.y) &&
                                  y <= Math.max(this._marqueeStart.y, this._marqueeEnd.y);

          if (isSelected || isInsideMarquee) ctx.fillStyle = '#ffff00'; // Yellow
          else if (isHovered) ctx.fillStyle = '#00ffff'; // Cyan
          else ctx.fillStyle = '#ff00ff'; // Magenta (to match curve)
          
          ctx.beginPath();
          ctx.moveTo(x, y - 2.5);
          ctx.lineTo(x + 2.5, y);
          ctx.lineTo(x, y + 2.5);
          ctx.lineTo(x - 2.5, y);
          ctx.closePath();
          ctx.fill();
          
          if (isSelected || isInsideMarquee) {
            ctx.strokeStyle = Theme.text;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        }
      }

      // Draw blendshape weight curves (newest-first, shared order)
      if (track && track.blendshapeTracks) {
        let bsIdx = 0;
        TimelineHelper.bsEntries(track).forEach(([name, bTrack]) => {
          const isVisible = window._animBsChannelVisible?.[name] !== false;
          if (!isVisible || !bTrack.times || bTrack.times.length === 0) { bsIdx++; return; }
          const color = bsColors[bsIdx % bsColors.length];

          // Curve line — bezier segments
          if (bTrack.times.length >= 2) {
            const _hovBs = this._hoverCurve?.kind === 'blendshape' && this._hoverCurve.name === name;
            ctx.strokeStyle = _hovBs ? this._lightenHex(color) : color;
            ctx.lineWidth = _hovBs ? 3.5 : 2;
            ctx.beginPath();
            for (let i = 0; i < bTrack.times.length - 1; i++) {
              const t1 = bTrack.times[i], t2 = bTrack.times[i + 1];
              const v1 = bTrack.values[i], v2 = bTrack.values[i + 1];
              const dt = t2 - t1;
              const to = bTrack.tangentOffsets;
              const rDt = to?.[`${i}_right_dt`];
              const rDv = to?.[`${i}_right_dv`];
              const lDt = to?.[`${i + 1}_left_dt`];
              const lDv = to?.[`${i + 1}_left_dv`];
              const s0 = reg.getBsSlope(bTrack, i);
              const s1 = reg.getBsSlope(bTrack, i + 1);
              const dt0 = rDt !== undefined ? rDt : dt * 0.33;
              const dt1 = lDt !== undefined ? lDt : -dt * 0.33;
              const dv0 = rDv !== undefined ? rDv : s0 * dt0;
              const dv1 = lDv !== undefined ? lDv : s1 * dt1;
              const p1x = dt0 / dt, p2x = 1 + dt1 / dt;
              const steps = 20;
              for (let s = 0; s <= steps; s++) {
                const alpha = s / steps;
                const bt = TimelineHelper.getBezierT(alpha, p1x, p2x);
                const val = TimelineHelper.evaluateBezier(bt, v1, v2, dv0, dv1);
                const time = t1 + alpha * dt;
                const x = tlX + ((time - loopStart) / visibleDuration) * tlW;
                const y = this.valueToY(val);
                if (i === 0 && s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
          }

          // Keyframe diamonds
          for (let i = 0; i < bTrack.times.length; i++) {
            const t = bTrack.times[i];
            const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
            const y = this.valueToY(bTrack.values[i]);
            const isSelected = window._animSelectedKeys &&
              window._animSelectedKeys.some(k => k.meshId === id && k.type === 'blendshape' && k.name === name && k.index === i);
            const isHovered = TimelineHelper.isKeyHovered(x, y, this._lastMouseX, this._lastMouseY, 10);

            ctx.fillStyle = isSelected ? '#ffff00' : (isHovered ? Theme.text : color);
            ctx.beginPath();
            ctx.moveTo(x, y - 2.5);
            ctx.lineTo(x + 2.5, y);
            ctx.lineTo(x, y + 2.5);
            ctx.lineTo(x - 2.5, y);
            ctx.closePath();
            ctx.fill();
            if (isSelected) { ctx.strokeStyle = Theme.text; ctx.lineWidth = 1; ctx.stroke(); }
          }

          // Tangent handles
          if (window._animShowTangents && bTrack.times.length >= 2) {
            ctx.lineWidth = 1.5;
            for (let i = 0; i < bTrack.times.length; i++) {
              const t = bTrack.times[i];
              const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
              const ky = this.valueToY(bTrack.values[i]);
              const to = bTrack.tangentOffsets;
              const rightDt = to?.[`${i}_right_dt`];
              const rightDv = to?.[`${i}_right_dv`];
              const leftDt  = to?.[`${i}_left_dt`];
              const leftDv  = to?.[`${i}_left_dv`];
              const slope    = reg.getBsSlope(bTrack, i);
              const dtR = i < bTrack.times.length - 1 ? bTrack.times[i + 1] - bTrack.times[i] : 0.2;
              const dtL = i > 0                        ? bTrack.times[i] - bTrack.times[i - 1] : 0.2;
              const rightXOff = rightDt !== undefined ? (rightDt / visibleDuration) * tlW : 25;
              const rightYOff = rightDv !== undefined ? -rightDv * this._zoomY : -slope * (rightDt !== undefined ? rightDt : dtR * 0.33) * this._zoomY;
              const leftXOff  = leftDt  !== undefined ? (leftDt  / visibleDuration) * tlW : -25;
              const leftYOff  = leftDv  !== undefined ? -leftDv  * this._zoomY : -slope * (leftDt  !== undefined ? leftDt  : -dtL * 0.33) * this._zoomY;

              if (i < bTrack.times.length - 1) {
                const isActive  = this._isDraggingTangent && this._activeTangentBsName === name && this._activeTangentIndex === i && this._activeTangentSide === 'right';
                const isHovered = TimelineHelper.isKeyHovered(kx + rightXOff, ky + rightYOff, this._lastMouseX, this._lastMouseY, 10);
                ctx.strokeStyle = isActive ? '#ffff00' : isHovered ? '#00ffff' : color;
                ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + rightXOff, ky + rightYOff); ctx.stroke();
                ctx.fillStyle = isActive ? '#ffff00' : isHovered ? '#00ffff' : color;
                ctx.beginPath(); ctx.arc(kx + rightXOff, ky + rightYOff, 3, 0, Math.PI * 2); ctx.fill();
              }
              if (i > 0) {
                const isActive  = this._isDraggingTangent && this._activeTangentBsName === name && this._activeTangentIndex === i && this._activeTangentSide === 'left';
                const isHovered = TimelineHelper.isKeyHovered(kx + leftXOff, ky + leftYOff, this._lastMouseX, this._lastMouseY, 10);
                ctx.strokeStyle = isActive ? '#ffff00' : isHovered ? '#00ffff' : color;
                ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + leftXOff, ky + leftYOff); ctx.stroke();
                ctx.fillStyle = isActive ? '#ffff00' : isHovered ? '#00ffff' : color;
                ctx.beginPath(); ctx.arc(kx + leftXOff, ky + leftYOff, 3, 0, Math.PI * 2); ctx.fill();
              }
            }
          }

          bsIdx++;
        });
      }
    }

    // Draw Transform Box in Graph Mode!
    if (window._animShowTransformBox && window._animSelectedKeys && window._animSelectedKeys.length > 1) {
      const activeMesh = this._graphMesh();
      if (activeMesh) {
        const id = activeMesh.getID();
        const track = reg.tracks.get(id);
        if (track) {
          let minT = Infinity;
          let maxT = -Infinity;
          let minV = Infinity;
          let maxV = -Infinity;

          window._animSelectedKeys.forEach(sk => {
            if (sk.meshId !== id) return;
            let t, val;
            if (sk.type === 'transform') {
              t   = xfTimes(track, sk.group)?.[sk.index];
              val = this._dispVal(sk.group === 'weight'
                ? xfWeightTrack(track)?.values?.[sk.index]
                : xfRead(track, sk.index, sk.channel !== undefined ? sk.channel : 0, sk.group),
                sk.group);
            } else if (sk.type === 'shape') {
              t   = track.shapeTimes?.[sk.index];
              val = track.shapeOutputTimes?.[sk.index] ?? track.shapes?.[sk.index];
            } else if (sk.type === 'blendshape') {
              const bt = track.blendshapeTracks?.get(sk.name);
              if (bt) { t = bt.times?.[sk.index]; val = bt.values?.[sk.index]; }
            }
            if (t  != null && t  < minT) minT = t;
            if (t  != null && t  > maxT) maxT = t;
            if (val != null && val < minV) minV = val;
            if (val != null && val > maxV) maxV = val;
          });

          if (minT !== Infinity && maxT !== -Infinity) {
            // If all values are identical (flat selection), give a small padding so box is visible
            {
        // Minimum on-screen box height (~60px) so vertical handles stay usable even
        // when all selected keys share one value (e.g. all 0) — lets you drag them.
        const _minHalf = 30 / Math.max(1, this._zoomY);
        if ((maxV - minV) / 2 < _minHalf) { const _c = (minV + maxV) / 2; minV = _c - _minHalf; maxV = _c + _minHalf; }
      }
            const wObj = { x: 0, y: 0, w: this._cssWidth, h: this._cssHeight };
            const tBox = { startTime: minT, endTime: maxT, minV, maxV };
            TimelineHelper.drawTransformBox(ctx, tBox, wObj, HEADER_H, 200, this._cssWidth - 200, this._viewStart, this._viewDuration, (val) => this.valueToY(val));
          }
        }
      }
    }

    ctx.restore();

    this.drawPlayhead(ctx);

    // 5. Render Marquee Box in Graph Mode
    if (this._isDraggingMarquee && this._marqueeStart && this._marqueeEnd) {
      ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1;
      const x = Math.min(this._marqueeStart.x, this._marqueeEnd.x);
      const y = Math.min(this._marqueeStart.y, this._marqueeEnd.y);
      const w = Math.abs(this._marqueeEnd.x - this._marqueeStart.x);
      const h = Math.abs(this._marqueeEnd.y - this._marqueeStart.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  }

  getInitialKeysForTransform(selectedKeys, reg, selChannel) {
    return selectedKeys.map(sk => {
      const tr = reg.tracks.get(sk.meshId);
      let time, val;
      if (sk.type === 'transform') {
        time = xfTimes(tr, sk.group)?.[sk.index];
        // In DISPLAY space, like the box that is about to scale it.
        val  = this._dispVal(sk.group === 'weight'
          ? (xfWeightTrack(tr)?.values?.[sk.index])
          : (tr ? xfRead(tr, sk.index, sk.channel !== undefined ? sk.channel : 0, sk.group) : undefined),
          sk.group);
      } else if (sk.type === 'shape') {
        time = tr?.shapeTimes?.[sk.index];
        val  = tr?.shapeOutputTimes?.[sk.index] ?? 0;
      } else if (sk.type === 'shapeLayer') {
        time = tr?.shapeLayers?.[sk.layer]?.shapeTimes?.[sk.index];
        val  = 0; // layer keys are vertex deltas — no scalar value to scale (dopesheet only)
      } else if (sk.type === 'blendshape') {
        const bt = tr?.blendshapeTracks?.get(sk.name);
        time = bt?.times?.[sk.index];
        val  = bt?.values?.[sk.index] ?? 0;
      }
      return { ...sk, time, val };
    });
  }

  getInitialTimesForTransform(selectedKeys, reg) {
    return selectedKeys.map(sk => {
      const tr = reg.tracks.get(sk.meshId);
      let time;
      if (sk.type === 'transform') {
        time = xfTimes(tr, sk.group)?.[sk.index];
      } else if (sk.type === 'shape') {
        time = tr?.shapeTimes?.[sk.index];
      } else if (sk.type === 'blendshape') {
        const bt = tr?.blendshapeTracks?.get(sk.name);
        time = bt?.times?.[sk.index];
      }
      return { ...sk, time };
    });
  }

  // Hit-test the graph curves (straight segments between keys) at (rx,ry).
  // Returns a channel descriptor { kind:'transform', channel } | { kind:'shape' }
  // | { kind:'blendshape', name }, or null. Shared by curve-click and hover.
  _hitTestCurve(rx, ry) {
    const reg = window._animationRegistry;
    const mesh = this._main?.getMesh?.();
    if (!reg || !mesh) return null;
    const track = reg.tracks.get(mesh.getID());
    if (!track) return null;
    const tlX = 200, tlW = this._cssWidth - 200;
    if (rx <= tlX || ry <= HEADER_H) return null;
    this._ensureViewInit();
    const loopStart = this._viewStart, visibleDuration = this._viewDuration;
    const xOf = (t) => tlX + ((t - loopStart) / visibleDuration) * tlW;
    const vis = window._animChannelVisible || [true, true, true, true];
    const TH = 6;
    const dSeg = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let u = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u));
      return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    };
    const test = (pts) => {
      if (pts.length === 1) return Math.hypot(rx - xOf(pts[0].t), ry - this.valueToY(pts[0].v)) <= TH;
      for (let i = 0; i + 1 < pts.length; i++)
        if (dSeg(rx, ry, xOf(pts[i].t), this.valueToY(pts[i].v), xOf(pts[i + 1].t), this.valueToY(pts[i + 1].v)) <= TH) return true;
      return false;
    };
    // Every visible group, and the answer NAMES the group -- clicking a rotation curve must
    // select rotation keys, and an untagged hit falls back to whichever group is active.
    if (track.times) {
      const _nr = this._xfNormRanges(track);
      for (const grp of xfVisible()) {
        if (grp === 'weight') continue;
        for (let c = 0; c < 3; c++) {
          if (!xfChanVisible(grp, c)) continue;
          if (test(track.times.map((t, i) => ({ t, v: this._normVal(xfRead(track, i, c, grp), grp, _nr) }))))
            return { kind: 'transform', channel: c, group: grp };
        }
      }
    }
    if (track.shapeTimes && track.shapeOutputTimes && vis[3]) {
      if (test(track.shapeTimes.map((t, i) => ({ t, v: track.shapeOutputTimes[i] })))) return { kind: 'shape' };
    }
    if (track.blendshapeTracks) {
      for (const [name, bt] of track.blendshapeTracks) {
        if (window._animBsChannelVisible?.[name] === false || !bt.times) continue;
        if (test(bt.times.map((t, i) => ({ t, v: bt.values[i] })))) return { kind: 'blendshape', name };
      }
    }
    return null;
  }

  // Expand a channel descriptor into the full set of selectable keys for it.
  _channelKeys(desc, id, track) {
    if (desc.kind === 'transform') return track.times.map((_, i) => ({ meshId: id, type: 'transform', index: i, channel: desc.channel, group: desc.group }));
    if (desc.kind === 'shape')     return track.shapeTimes.map((_, i) => ({ meshId: id, type: 'shape', index: i }));
    if (desc.kind === 'blendshape') {
      const bt = track.blendshapeTracks.get(desc.name);
      return bt ? bt.times.map((_, i) => ({ meshId: id, type: 'blendshape', name: desc.name, index: i })) : [];
    }
    return [];
  }

  // True when (cx,cy) is usable background for the VR two-controller zoom.
  // Graph mode excludes curves; dopesheet mode accepts the lane area so the same
  // time-zoom gesture is available there too.
  isEmptyGraphSpaceAt(cx, cy) {
    if (cx < 200 || cy < HEADER_H) return false;
    return this._mode === 'graph' ? !this._hitTestCurve(cx, cy) : this._mode === 'dope';
  }

  // ── Two-pointer zoom (VR, both controllers in empty space) ──────────────────
  // Horizontal controller separation → time (X) zoom; vertical → value (Y) zoom;
  // both pivot around the midpoint between the controllers.
  beginTwoPointerZoom(cx1, cy1, cx2, cy2) {
    this._ensureViewInit();
    const tlX = 200, tlW = this._cssWidth - 200;
    const midCx = (cx1 + cx2) / 2, midCy = (cy1 + cy2) / 2;
    this._tpZoom = {
      viewDuration: this._viewDuration,
      zoomY: this._zoomY,
      // SIGNED initial separations (controller-1 minus controller-2) — using the
      // signed value (not abs) means crossing the hands over doesn't bounce the
      // zoom back up; the factor just pins at its floor.
      dx0: cx1 - cx2,
      dy0: cy1 - cy2,
      pivotT: this._viewStart + ((midCx - tlX) / tlW) * this._viewDuration,
      pivotVal: this.yToValue(midCy),
      mode: this._mode,
    };
  }

  updateTwoPointerZoom(cx1, cy1, cx2, cy2) {
    const z = this._tpZoom; if (!z) return;
    const tlX = 200, tlW = this._cssWidth - 200;
    const midCx = (cx1 + cx2) / 2, midCy = (cy1 + cy2) / 2;
    const dx = cx1 - cx2, dy = cy1 - cy2;
    // An axis only zooms if the controllers started with real separation on it
    // (otherwise the ratio is undefined); the midpoint still pans either way.
    // No upper clamp — graph values can span any range; only a tiny floor to
    // avoid degenerate (zero/negative) scales.
    if (Math.abs(z.dx0) > 20) {
      const fx = Math.max(0.02, dx / z.dx0); // wider apart → fx>1 → zoom in (shorter)
      this._viewDuration = Math.max(1e-4, z.viewDuration / fx);
    }
    this._viewStart = z.pivotT - ((midCx - tlX) / tlW) * this._viewDuration;
    if (z.mode === 'graph' && Math.abs(z.dy0) > 20) {
      const fy = Math.max(0.02, dy / z.dy0); // taller apart → fy>1 → larger zoomY (zoom in)
      this._zoomY = Math.max(1e-4, z.zoomY * fy);
    }
    if (z.mode === 'graph') {
      const graphH = this._cssHeight - HEADER_H;
      this._panY = (HEADER_H + graphH / 2 - midCy) - z.pivotVal * this._zoomY;
    }
    this.draw();
  }

  endTwoPointerZoom() { this._tpZoom = null; }

  handleGraphMouseDown(rx, ry) {
    const reg = window._animationRegistry;
    if (!reg) return;

    const activeMesh = this._graphMesh();
    if (!activeMesh) return;
    const id = activeMesh.getID();
    const track = reg.tracks.get(id);
    if (!track) return;

    const headerH = HEADER_H;
    const tlX = 200;
    const tlW = this._cssWidth - 200;

    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDurationReal = Math.max(0.1, loopEndReal - loopStartReal);

    if (this._viewDuration === undefined) {
      this._viewStart = loopStartReal;
      this._viewDuration = visibleDurationReal;
    }

    const loopStart = this._viewStart;
    const visibleDuration = this._viewDuration;

    // Check Position Keys
    if (window._animShowTransformBox && window._animSelectedKeys && window._animSelectedKeys.length > 1) {
      
      this._undoTracksBeforeMove = new Map();
      reg.tracks.forEach((tr, mId) => {
        this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
      });

      let minT = Infinity;
      let maxT = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;

      window._animSelectedKeys.forEach(sk => {
        if (sk.meshId !== id) return;
        let t, val;
        if (sk.type === 'transform') {
          t   = xfTimes(track, sk.group)?.[sk.index];
          val = this._dispVal(sk.group === 'weight'
            ? xfWeightTrack(track)?.values?.[sk.index]
            : xfRead(track, sk.index, sk.channel !== undefined ? sk.channel : 0, sk.group),
            sk.group);
        } else if (sk.type === 'shape') {
          t   = track.shapeTimes?.[sk.index];
          val = track.shapeOutputTimes?.[sk.index] ?? track.shapes?.[sk.index];
        } else if (sk.type === 'blendshape') {
          const bt = track.blendshapeTracks?.get(sk.name);
          if (bt) { t = bt.times?.[sk.index]; val = bt.values?.[sk.index]; }
        }
        if (t  != null && t  < minT) minT = t;
        if (t  != null && t  > maxT) maxT = t;
        if (val != null && val < minV) minV = val;
        if (val != null && val > maxV) maxV = val;
      });
      {
        // Minimum on-screen box height (~60px) so vertical handles stay usable even
        // when all selected keys share one value (e.g. all 0) — lets you drag them.
        const _minHalf = 30 / Math.max(1, this._zoomY);
        if ((maxV - minV) / 2 < _minHalf) { const _c = (minV + maxV) / 2; minV = _c - _minHalf; maxV = _c + _minHalf; }
      }

      if (minT !== Infinity && maxT !== -Infinity) {
        const kxLeft = tlX + ((minT - loopStart) / visibleDuration) * tlW;
        const kxRight = tlX + ((maxT - loopStart) / visibleDuration) * tlW;
        const kyTop = this.valueToY(maxV);
        const kyBottom = this.valueToY(minV);
        
        // Check Top handle
        if (Math.abs(rx - (kxLeft + (kxRight - kxLeft)/2)) < 10 && Math.abs(ry - kyTop) < 10) {
          this._activeTransformHandle = 'top';
          this._transformStartRy = ry;
          this._animTransformInitialBox = { minV, maxV };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
        // Check Bottom handle
        if (Math.abs(rx - (kxLeft + (kxRight - kxLeft)/2)) < 10 && Math.abs(ry - kyBottom) < 10) {
          this._activeTransformHandle = 'bottom';
          this._transformStartRy = ry;
          this._animTransformInitialBox = { minV, maxV };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
        // Check Left handle
        if (Math.abs(rx - kxLeft) < 10 && ry >= kyTop && ry <= kyBottom) {
          this._activeTransformHandle = 'left';
          this._transformStartRx = rx;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
        // Check Right handle
        if (Math.abs(rx - kxRight) < 10 && ry >= kyTop && ry <= kyBottom) {
          this._activeTransformHandle = 'right';
          this._transformStartRx = rx;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
        // Check Center Scale handle
        const kxMid = (kxLeft + kxRight) / 2;
        const kyMid = (kyTop + kyBottom) / 2;
        if (Math.abs(rx - kxMid) < 20 && Math.abs(ry - kyMid) < 20) {
          this._activeTransformHandle = 'scale_center';
          this._transformStartRx = rx;
          this._transformStartRy = ry;
          this._scaleCenterLock = null;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT, minV, maxV };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
        // Check Translate Box
        if (rx >= kxLeft && rx <= kxRight && ry >= kyTop && ry <= kyBottom) {
          this._activeTransformHandle = 'center';
          this._transformStartRx = rx;
          this._transformStartRy = ry;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT, minV, maxV };
          this._keyDragStartVal = this.yToValue(ry);
          this._keyDragStartTime = loopStart + ((rx - tlX) / tlW) * visibleDuration;
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
          return;
        }
      }
    }

    if (track.times && track.positions) {
      const _chVis = window._animChannelVisible || [true, true, true, true];
      tlLog(`mousedown rx=${rx.toFixed(1)} ry=${ry.toFixed(1)} group=${xfGroup()}`,
        `keys=${track.times.length} zoomY=${this._zoomY} panY=${this._panY}`,
        `chVis=[${_chVis.slice(0, 3).join(',')}]`);
      for (let i = 0; i < track.times.length; i++) {
        const t = track.times[i];
        const x = tlX + ((t - loopStart) / visibleDuration) * tlW;

        // EVERY VISIBLE GROUP, and the winner remembers WHICH. Without the group on the key,
        // a click on the rotation curve selects a key that later reads and writes translation --
        // the exact class of bug xfChannel was created to end, back when the group was global.
        const _normR = this._xfNormRanges(track);
        for (const grp of xfVisible()) {
        if (grp === 'weight') continue;
        for (let c = 0; c < 3; c++) {
          if (!xfChanVisible(grp, c)) continue; // hidden channel — not selectable
          const val = xfRead(track, i, c, grp);
          const y = this._valY(val, grp, _normR);
          tlLog(`  key ${i} ch${c} val=${val} x=${x.toFixed(1)} y=${y.toFixed(1)}`,
            `dist=${Math.hypot(x - rx, y - ry).toFixed(1)}`,
            TimelineHelper.isKeyHovered(x, y, rx, ry, 10) ? 'HIT' : '');

          if (TimelineHelper.isKeyHovered(x, y, rx, ry, 10)) {
            this._isDraggingKeyframe = true;
            this._activeKeyframeTrack = track;
            this._activeMeshId = id;
            
            const reg = window._animationRegistry;
            if (reg) {
              this._undoTracksBeforeMove = new Map();
              reg.tracks.forEach((tr, mId) => {
                this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
              });
            }
            this._activeKeyframeIndex = i;
            this._activeKeyframeType = 'transform';
            this._activeKeyframeChannel = c;
            this._keyDragStartRx = rx;
            this._keyDragStartRy = ry;
            this._keyDragStartTime = loopStart + ((rx - tlX) / tlW) * visibleDuration;
            this._keyDragStartVal = this.yToValue(ry);

            const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(
              k => k.meshId === id && k.type === 'transform' && k.index === i && k.channel === c
                && (k.group || 'pos') === grp);

            if (isPartSelection) {
              this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
                const tr = reg.tracks.get(k.meshId);
                const time = k.type === 'transform' ? tr.times[k.index] : tr.shapeTimes[k.index];
                // IN THE KEY'S OWN GROUP. Read ungrouped, every selected key took its start
                // value from the ACTIVE group -- so a rotation X key began the drag holding
                // translation X's value, and `startVal + delta` landed every X key on the same
                // number. matt: "all the x values snap together across translate and rotate,
                // same for y, same for z."
                const startVal = k.type === 'transform'
                  ? xfRead(tr, k.index, k.channel !== undefined ? k.channel : 0, k.group)
                  : 0;
                return { ...k, time, startVal };
              });
            } else {
              this._animSelectedKeysInitialTimes = null;
              
              const beforeSelection = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({...k})) : [];
              
              // Select only this key!
              window._animSelectedKeys = [{ meshId: id, type: 'transform', index: i, channel: c,
                                            group: grp, startVal: val }];
              window._animTransformBox = null;
              
              const afterSelection = [...window._animSelectedKeys];
              const cbUndo = () => {
                console.log("[Graph Debug] Undo Click Selection. Before:", beforeSelection);
                window._animSelectedKeys = beforeSelection;
                this.draw();
              };
              const cbRedo = () => {
                window._animSelectedKeys = afterSelection;
                this.draw();
              };
              this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, 'graph editor multikeys selection');
            }
            
            this.draw();
            return;
          }
        }
        }
      }
    }

    // Check Shape Keys in Graph Mode
    if (track.shapeTimes && track.shapeOutputTimes && (window._animChannelVisible?.[3] !== false)) {
      for (let i = 0; i < track.shapeTimes.length; i++) {
        const t = track.shapeTimes[i];
        const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
        const val = track.shapeOutputTimes[i];
        const y = this.valueToY(val);

        if (TimelineHelper.isKeyHovered(x, y, rx, ry, 10)) {
          this._isDraggingKeyframe = true;
          this._activeKeyframeTrack = track;
          this._activeMeshId = id;
          
          const reg = window._animationRegistry;
          if (reg) {
            this._undoTracksBeforeMove = new Map();
            reg.tracks.forEach((tr, mId) => {
              this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
            });
          }
          this._activeKeyframeIndex = i;
          this._activeKeyframeType = 'shape';
          this._activeKeyframeChannel = 0;
          this._keyDragStartRx = rx;
          this._keyDragStartRy = ry;
          this._keyDragStartTime = loopStart + ((rx - tlX) / tlW) * visibleDuration;
          this._keyDragStartVal = val;

          const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'shape' && k.index === i);
          
          if (isPartSelection) {
            this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
              const tr = reg.tracks.get(k.meshId);
              const time = k.type === 'transform' ? tr.times[k.index] : tr.shapeTimes[k.index];
              const startVal = k.type === 'shape' ? tr.shapeOutputTimes[k.index] : 0;
              return { ...k, time, startVal };
            });
          } else {
            this._animSelectedKeysInitialTimes = null;
            
            const beforeSelection = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({...k})) : [];
            
            window._animSelectedKeys = [{ meshId: id, type: 'shape', index: i, startVal: val }];
            window._animTransformBox = null;
            
            const afterSelection = [...window._animSelectedKeys];
            const cbUndo = () => {
              window._animSelectedKeys = beforeSelection;
              this.draw();
            };
            const cbRedo = () => {
              window._animSelectedKeys = afterSelection;
              this.draw();
            };
            this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, 'graph editor multikeys selection');
          }
          
          this.draw();
          return;
        }
      }
    }

    // Check Blendshape Keys in Graph Mode (newest-first, shared order)
    if (track.blendshapeTracks) {
      let bsIdx = 0;
      let found = false;
      TimelineHelper.bsEntries(track).forEach(([name, bTrack]) => {
        if (found) { bsIdx++; return; }
        if (!bTrack.times || window._animBsChannelVisible?.[name] === false) { bsIdx++; return; } // hidden — not selectable
        for (let i = 0; i < bTrack.times.length; i++) {
          const t = bTrack.times[i];
          const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
          const y = this.valueToY(bTrack.values[i]);
          if (TimelineHelper.isKeyHovered(x, y, rx, ry, 10)) {
            this._isDraggingKeyframe = true;
            this._activeKeyframeTrack = bTrack;
            this._activeMeshId = id;
            this._activeKeyframeIndex = i;
            this._activeKeyframeType = 'blendshape';
            this._activeBlendshapeName = name;
            this._keyDragStartRx = rx;
            this._keyDragStartRy = ry;
            this._keyDragStartTime = loopStart + ((rx - tlX) / tlW) * visibleDuration;

            if (window._animationRegistry) {
              this._undoTracksBeforeMove = new Map();
              window._animationRegistry.tracks.forEach((tr, mId) => {
                this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
              });
            }

            const isPartSelection = window._animSelectedKeys &&
              window._animSelectedKeys.some(k => k.meshId === id && k.type === 'blendshape' && k.name === name && k.index === i);
            if (!isPartSelection) {
              window._animSelectedKeys = [{ meshId: id, type: 'blendshape', name, index: i }];
              window._animTransformBox = null;
            }
            this.draw();
            found = true;
            return;
          }
        }
        bsIdx++;
      });
      if (found) return;
    }

    // Check Position Key Tangents
    if (track.times && window._animShowTangents) {
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
      const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

      for (let i = 0; i < track.times.length; i++) {
        const t = track.times[i];
        const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
        
        const _selGrp2 = (window._animSelectedKeys && window._animSelectedKeys.length === 1
          && window._animSelectedKeys[0].group) || xfGroup();
        const val = xfRead(track, i, selChannel, _selGrp2);
        const ky = this.valueToY(val);

        const rightDt = xfTanGet(track, `${i}_right_dt`, _selGrp2);
        const rightDv = xfTanGet(track, `${i}_right_dv_${selChannel}`, _selGrp2);
        const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_left_dt`] : undefined;
        const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_left_dv_${selChannel}`] : undefined;

        const slope = reg.getCurveSlope ? reg.getCurveSlope(track, i, selChannel) : 0;
        const dt_right = (i < track.times.length - 1) ? track.times[i + 1] - track.times[i] : 0.2;
        const dt_left = (i > 0) ? track.times[i] - track.times[i - 1] : 0.2;

        const rightXOff = rightDt !== undefined ? (rightDt / visibleDuration) * tlW : 25;
        const rightYOff = rightDv !== undefined ? -rightDv * this._zoomY : -slope * (rightDt !== undefined ? rightDt : dt_right * 0.33) * this._zoomY;
        
        const leftXOff = leftDt !== undefined ? (leftDt / visibleDuration) * tlW : -25;
        const leftYOff = leftDv !== undefined ? -leftDv * this._zoomY : -slope * (leftDt !== undefined ? leftDt : -dt_left * 0.33) * this._zoomY;

        // Check right handle
        if (i < track.times.length - 1) {
          if (TimelineHelper.isKeyHovered(kx + rightXOff, ky + rightYOff, rx, ry, 10)) {
            this._isDraggingTangent = true;
            this._activeTangentTrack = track;
            this._activeTangentIndex = i;
            this._activeTangentSide = 'right';
            this._activeTangentKx = kx;
            this._activeTangentKy = ky;
            this._activeTangentType = 'transform';
            return;
          }
        }
        
        // Check left handle
        if (i > 0) {
          if (TimelineHelper.isKeyHovered(kx + leftXOff, ky + leftYOff, rx, ry, 10)) {
            this._isDraggingTangent = true;
            this._activeTangentTrack = track;
            this._activeTangentIndex = i;
            this._activeTangentSide = 'left';
            this._activeTangentKx = kx;
            this._activeTangentKy = ky;
            this._activeTangentType = 'transform';
            return;
          }
        }
      }
    }

    // Check Shape Key Tangents
    if (track.shapeTimes && window._animShowTangents) {
      for (let i = 0; i < track.shapeTimes.length - 1; i++) {
        const t1 = track.shapeTimes[i];
        const t2 = track.shapeTimes[i + 1];
        const v1 = track.shapeOutputTimes ? track.shapeOutputTimes[i] : t1;
        const v2 = track.shapeOutputTimes ? track.shapeOutputTimes[i + 1] : t2;
        
        const ky1_val = this.valueToY(v1);
        const ky2_val = this.valueToY(v2);
        
        const kx1 = tlX + ((t1 - loopStart) / visibleDuration) * tlW;
        const kx2 = tlX + ((t2 - loopStart) / visibleDuration) * tlW;
        
        const rightDt = track.tangentOffsets ? track.tangentOffsets[`${i}_right_dt`] : undefined;
        const rightDv = track.tangentOffsets ? track.tangentOffsets[`${i}_right_dv`] : undefined;
        const leftDt = track.tangentOffsets ? track.tangentOffsets[`${i + 1}_left_dt`] : undefined;
        const leftDv = track.tangentOffsets ? track.tangentOffsets[`${i + 1}_left_dv`] : undefined;
        
        const dt = t2 - t1;
        const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
        const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
        
        const slope = dt > 0 ? (v2 - v1) / dt : 0;
        
        const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
        const dv1 = leftDv !== undefined ? leftDv : slope * dt1;

        const rightXOff = (dt0 / visibleDuration) * tlW;
        const rightYOff = -dv0 * this._zoomY;
        
        const leftXOff = (dt1 / visibleDuration) * tlW;
        const leftYOff = -dv1 * this._zoomY;

        // Check right handle
        if (Math.abs(rx - (kx1 + rightXOff)) < 10 && Math.abs(ry - (ky1_val + rightYOff)) < 10) {
          this._isDraggingTangent = true;
          this._activeTangentTrack = track;
          this._activeTangentIndex = i;
          this._activeTangentSide = 'right';
          this._activeTangentKx = kx1;
          this._activeTangentKy = ky1_val + rightYOff;
          this._activeTangentType = 'shape';
          return;
        }
        // Check left handle
        if (Math.abs(rx - (kx2 + leftXOff)) < 10 && Math.abs(ry - (ky2_val + leftYOff)) < 10) {
          this._isDraggingTangent = true;
          this._activeTangentTrack = track;
          this._activeTangentIndex = i + 1;
          this._activeTangentSide = 'left';
          this._activeTangentKx = kx2;
          this._activeTangentKy = ky2_val + leftYOff;
          this._activeTangentType = 'shape';
          return;
        }
      }
    }

    // Check Blendshape Tangents
    if (track.blendshapeTracks && window._animShowTangents) {
      for (const [name, bTrack] of track.blendshapeTracks) {
        if (!bTrack.times || bTrack.times.length < 2) continue;
        if (window._animBsChannelVisible?.[name] === false) continue;
        for (let i = 0; i < bTrack.times.length; i++) {
          const t = bTrack.times[i];
          const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
          const ky = this.valueToY(bTrack.values[i]);
          const to = bTrack.tangentOffsets;
          const rightDt = to?.[`${i}_right_dt`];
          const rightDv = to?.[`${i}_right_dv`];
          const leftDt  = to?.[`${i}_left_dt`];
          const leftDv  = to?.[`${i}_left_dv`];
          const slope    = reg.getBsSlope(bTrack, i);
          const dtR = i < bTrack.times.length - 1 ? bTrack.times[i + 1] - bTrack.times[i] : 0.2;
          const dtL = i > 0                        ? bTrack.times[i] - bTrack.times[i - 1] : 0.2;
          const rightXOff = rightDt !== undefined ? (rightDt / visibleDuration) * tlW : 25;
          const rightYOff = rightDv !== undefined ? -rightDv * this._zoomY : -slope * (rightDt !== undefined ? rightDt : dtR * 0.33) * this._zoomY;
          const leftXOff  = leftDt  !== undefined ? (leftDt  / visibleDuration) * tlW : -25;
          const leftYOff  = leftDv  !== undefined ? -leftDv  * this._zoomY : -slope * (leftDt  !== undefined ? leftDt  : -dtL * 0.33) * this._zoomY;

          if (i < bTrack.times.length - 1 && TimelineHelper.isKeyHovered(kx + rightXOff, ky + rightYOff, rx, ry, 10)) {
            this._isDraggingTangent = true;
            this._activeTangentTrack = bTrack;
            this._activeTangentIndex = i;
            this._activeTangentSide = 'right';
            this._activeTangentKx = kx;
            this._activeTangentKy = ky;
            this._activeTangentType = 'blendshape';
            this._activeTangentBsName = name;
            return;
          }
          if (i > 0 && TimelineHelper.isKeyHovered(kx + leftXOff, ky + leftYOff, rx, ry, 10)) {
            this._isDraggingTangent = true;
            this._activeTangentTrack = bTrack;
            this._activeTangentIndex = i;
            this._activeTangentSide = 'left';
            this._activeTangentKx = kx;
            this._activeTangentKy = ky;
            this._activeTangentType = 'blendshape';
            this._activeTangentBsName = name;
            return;
          }
        }
      }
    }

    // Curve click — select a whole channel by clicking its line (not just a key),
    // so the gutter highlight/scroll updates.
    {
      const desc = this._hitTestCurve(rx, ry);
      const picked = desc ? this._channelKeys(desc, id, track) : null;
      if (picked && picked.length) {
        const before = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({ ...k })) : [];
        window._animSelectedKeys = picked;
        window._animTransformBox = null;
        const after = [...picked];
        this._main.getStateManager().pushStateCustom(
          () => { window._animSelectedKeys = before; this.draw(); },
          () => { window._animSelectedKeys = after;  this.draw(); },
          false, 'Select Channel'
        );
        this.draw();
        return;
      }
    }

    // Nothing hit — pan by default; fall back to marquee when the marquee toggle is on.
    if (window._animMarqueeMode) {
      this._isDraggingMarquee = true;
      this._marqueeStart = { x: rx, y: ry };
      this._marqueeEnd   = { x: rx, y: ry };
      this._undoSelectionBeforeMarquee = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({...k})) : [];
    } else {
      this._ensureViewInit();
      this._isPanningGraphXY    = true;
      this._panXYStartRx        = rx;
      this._panXYStartRy        = ry;
      this._panXYStartViewStart = this._viewStart;
      this._panXYStartPanY      = this._panY;
    }
  }

  // WHY DID THAT CLICK MISS? (window._tlTrace = true)
  //
  // Reports the geometry the hit test is working from and, crucially, the NEAREST key to the
  // cursor with its offset — so a miss says how far off it was and in which axis, which is
  // what separates the possibilities:
  //
  //   dy large, dx small ....... the lane maths disagree (height, scroll, or which lane)
  //   dx large, dy small ....... the time-to-x mapping disagrees (view range vs drawn range)
  //   both large ............... the pointer coordinates themselves are wrong (VR mapping)
  //   both small, still a miss .. the tolerance, or an earlier branch swallowed the click
  //
  // Runs before the hit loop and changes nothing, so it reports on hits and misses alike.
  _traceKeyPick(rx, ry, tracks, trackH, dsScroll, tlX, tlW, loopStart, visibleDuration) {
    if (!window._tlTrace) return;
    const headerH = HEADER_H;
    let best = null;
    tracks.forEach(([meshId, trackObj], laneIdx) => {
      const ty = headerH + laneIdx * trackH - dsScroll;
      const ky = ty + trackH / 2;
      const times = trackObj.times || [];
      for (let i = 0; i < times.length; i++) {
        const kx = tlX + ((times[i] - loopStart) / visibleDuration) * tlW;
        const d = Math.hypot(rx - kx, ry - ky);
        if (!best || d < best.d) {
          best = { d: d, dx: rx - kx, dy: ry - ky, lane: laneIdx, meshId: meshId, i: i, t: times[i] };
        }
      }
    });
    console.log(`[tl] click rx=${rx.toFixed(1)} ry=${ry.toFixed(1)}`
      + ` css=${this._cssWidth}x${this._cssHeight} lanes=${tracks.length}`
      + ` trackH=${trackH.toFixed(1)} scroll=${dsScroll.toFixed(1)}/${(this._dopeMaxScroll || 0).toFixed(1)}`
      + ` view=[${loopStart.toFixed(2)}+${visibleDuration.toFixed(2)}] tlX=${tlX} tlW=${tlW.toFixed(0)}`
      + ` | gates marquee=${!!window._animMarqueeMode}`
      + ` xbox=${!!(window._animShowTransformBox && window._animTransformBox)}`
      + ` showTransform=${(window._animKeyShow || {}).transform !== false}`
      + (best
          ? ` | nearest key lane=${best.lane} mesh=${best.meshId} t=${best.t.toFixed(3)}`
            + ` dx=${best.dx.toFixed(1)} dy=${best.dy.toFixed(1)} dist=${best.d.toFixed(1)}`
            + ` (click tolerance is 12 in x AND y; hover ring is 10)`
          : ' | NO TRANSFORM KEYS in any lane'));
  }

  // THE DOPESHEET SCROLL, CLAMPED, IN ONE PLACE.
  //
  // The DRAW clamped it (to _dopeMaxScroll, which the draw itself computes) and wrote the
  // clamped value back; every hit test read the raw field. Whenever the raw value sat outside
  // the range — which is exactly what making the panel TALLER does, since more visible rows
  // means a smaller maximum scroll — the two disagreed until the next frame wrote the clamp
  // back. In that window the keys DREW where the clamp put them and were HIT-TESTED where the
  // raw value put them, so they highlighted under the cursor and then would not select.
  //
  // That is the whole of "sometimes I can drag them, sometimes I can't select them at all",
  // and why it followed a resize: the redraw silently repaired it, so it came and went.
  _dopeScroll() {
    const max = this._dopeMaxScroll || 0;
    const v = Math.min(Math.max(0, this._dopeScrollY || 0), max);
    this._dopeScrollY = v;
    return v;
  }

  // WHAT THE GRAPH EDITOR GRAPHS.
  //
  // It used to read _main.getMesh() — the 3D-VIEW selection — in eight places, so the only way
  // to graph a track was to go and select its object in the scene, even though you had just
  // clicked its row. The timeline now owns its own target, set by clicking a row name or a key,
  // and falls back to the scene selection when it has none (which is exactly the old
  // behaviour, so nothing changes until you click something).
  //
  // Timeline focus and scene selection are deliberately unified: the last row, key or scene
  // object clicked is the selected object everywhere, avoiding two contradictory highlights.
  _setGraphTarget(meshId) {
    if (meshId == null || meshId < 0) return; // synthetic rows (the folded rig lane) have no track
    this._graphMeshId = meshId;
    const mesh = this._main._meshes?.find((m) => m.getID() === meshId);
    // Unify timeline focus with the scene selection, but pass keepTool: setOrUnsetMesh runs
    // tool-context switching, and looking at a curve must not change your active tool.
    // MULTI-SELECT on a dopesheet name, same modifier as everywhere else: the secondary
    // trigger in VR, Ctrl/Shift with a mouse. `keepTool` stays true for the reason above —
    // looking at a curve must not change your active tool, and that is just as true when you
    // are adding a second object to the selection.
    const _multi = !!this._main.multiSelectHeld?.() || !!this._lastModifierDown;
    if (mesh && (_multi || this._main.getMesh?.() !== mesh)) {
      this._main.setOrUnsetMesh?.(mesh, _multi, true);
    }
    // This IS the selection changing — the row, the scene object and Delete's target are all
    // one thing (see the note above), so the button has to be re-read here.
    this._notifySelectionChanged();
  }

  _graphMesh() {
    const id = this._graphMeshId;
    if (id != null) {
      const m = this._main._meshes?.find((x) => x.getID() === id);
      if (m) return m;
      this._graphMeshId = null; // the object went away — fall back rather than graph nothing
    }
    return this._main.getMesh();
  }

  autoFitGraph() {
    const reg = window._animationRegistry;
    if (!reg) return;

    const activeMesh = this._graphMesh();
    if (!activeMesh) return;
    const id = activeMesh.getID();
    const track = reg.tracks.get(id);
    if (!track) return;

    let minVal = Infinity;
    let maxVal = -Infinity;

    const channelsVisible = window._animChannelVisible || [true, true, true, true];

    // EVERY VISIBLE GROUP, not just the active one. Measured ungrouped, Fit All framed the
    // active group and left the others running off the top of the graph -- matt: "the fit all
    // button seems to only fit on x, not on Y." It was fitting Y, to a third of the curves.
    if (track.times && track.times.length > 0) {
      for (const grp of xfVisible()) {
        if (grp === 'weight') continue;
        for (let i = 0; i < track.times.length; i++) {
          for (let c = 0; c < 3; c++) {
            if (!xfChanVisible(grp, c)) continue;
            const val = xfRead(track, i, c, grp);
            if (typeof val !== 'number' || !isFinite(val)) continue;
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
          }
        }
      }
    }
    // ...and the weight channel, which has its own track and its own keys.
    if (xfIsVisible('weight')) {
      const wT = xfWeightTrack(track);
      for (const v of (wT ? wT.values : [])) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }

    if (track.shapeOutputTimes && track.shapeTimes && track.shapeTimes.length > 0) {
      if (channelsVisible[3]) {
        for (let i = 0; i < track.shapeTimes.length; i++) {
          const val = track.shapeOutputTimes[i];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
    }

    if (track.blendshapeTracks) {
      track.blendshapeTracks.forEach((bTrack, name) => {
        if (window._animBsChannelVisible?.[name] === false) return;
        for (let i = 0; i < bTrack.values.length; i++) {
          const val = bTrack.values[i];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      });
    }

    if (minVal === Infinity) {
      minVal = 0;
      maxVal = 1;
    }

    const range = maxVal - minVal;
    const headerH = HEADER_H;
    const graphH = this._cssHeight - headerH;

    const midVal = (minVal + maxVal) / 2;

    if (range > 0.0001) {
      this._zoomY = (graphH * 0.8) / range;
      this._panY = -midVal * this._zoomY;
    } else {
      this._zoomY = 100.0;
      this._panY = -midVal * this._zoomY;
    }

    // Horizontal Auto-Fit
    let minT = Infinity;
    let maxT = -Infinity;
    
    const anyTransformVisible = channelsVisible[0] || channelsVisible[1] || channelsVisible[2];
    
    if (anyTransformVisible && track.times && track.times.length > 0) {
      minT = Math.min(minT, track.times[0]);
      maxT = Math.max(maxT, track.times[track.times.length - 1]);
    }
    
    if (channelsVisible[3] && track.shapeTimes && track.shapeTimes.length > 0) {
      minT = Math.min(minT, track.shapeTimes[0]);
      maxT = Math.max(maxT, track.shapeTimes[track.shapeTimes.length - 1]);
    }

    if (track.blendshapeTracks) {
      track.blendshapeTracks.forEach((bTrack) => {
        if (bTrack.times && bTrack.times.length > 0) {
          minT = Math.min(minT, bTrack.times[0]);
          maxT = Math.max(maxT, bTrack.times[bTrack.times.length - 1]);
        }
      });
    }

    if (minT !== Infinity && maxT !== Infinity) {
      const duration = maxT - minT;
      const mDur = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
      const ls = window._animLoopStart ?? 0;
      const le = window._animLoopEnd ?? mDur;
      this._viewStart    = Math.min(ls, Math.max(0, minT - duration * 0.1));
      // Never show less than 1s or the loop range — prevents "stuck at frames 1-2"
      // when all keys are tightly clustered near t=0.
      this._viewDuration = Math.max(le - ls, duration * 1.2, 1.0);
    }
  }

  setVisibility(visible) {
    this._visible = visible;
    this._container.style.display = visible ? 'block' : 'none';
    this._container.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) {
      this.onResize(); // Ensure size is correct
      this.draw();
    }
  }

  // Called by Scene.js when opening the VR timeline.
  // Sizes the canvas to a fixed 900×150 px and positions the container off-screen
  // (but still display:block) so getBoundingClientRect() returns real values for
  // controller hit → mouse-event coordinate mapping.
  // We do NOT call onResize() here because it would override our width/right styles
  // with the sidebar offset, producing a giant canvas.
  openVRView(cssW = 900, cssH = 150) {
    // Size the 2D canvas directly — no DOM display changes that could trigger
    // a window-resize event and inadvertently call renderer.setSize() in XR mode.
    // cssW/cssH come from the persisted panel size so the texture matches the
    // mesh geometry (no stretching / low-res on first open or reopen).
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width  = Math.round(cssW) * dpr;
    this._canvas.height = Math.round(cssH) * dpr;
    this._cssWidth  = Math.round(cssW);
    this._cssHeight = Math.round(cssH);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._visible = true;
    this.draw();
  }

  resizeVRCanvas(newCssW, newCssH) {
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width  = Math.round(newCssW) * dpr;
    this._canvas.height = Math.round(newCssH) * dpr;
    this._cssWidth  = Math.round(newCssW);
    this._cssHeight = Math.round(newCssH);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  closeVRView() {
    this._visible = false;
  }

  startLoop() {
    // [Step Bug2] Let external code (ACP Clear All) reset the view to time 0.
    window._animOnClearAll = () => {
      this._viewStart = undefined;
      this._viewDuration = undefined;
      this._gutterScrollY = 0;
    };
    const loop = () => {
      if (this._visible) {
        const now = performance.now();
        const inXR = !!window.app?._renderer?.xr?.isPresenting;
        // A full-size canvas upload is expensive on a standalone headset. The playhead does
        // not need to refresh at 72/90 Hz to read smoothly, while the rig itself absolutely
        // does. Cap only the floating VR editor at 30 Hz; desktop retains native rAF cadence.
        if (!inXR || !this._lastVRDrawAt || now - this._lastVRDrawAt >= 33) {
          this.draw();
          if (inXR) this._lastVRDrawAt = now;
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // [Step 1] Helpers for 2-finger scroll and wheel zoom.
  _ensureViewInit() {
    if (this._viewDuration !== undefined) return;
    const mDur = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const ls = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const le = window._animLoopEnd !== undefined ? window._animLoopEnd : mDur;
    this._viewStart = ls;
    this._viewDuration = Math.max(0.1, le - ls);
  }

  // Project loads replace the authored playback range, so their editor should open framed to
  // that range rather than retaining the pan/zoom window from the previously open scene.
  framePlaybackRange() {
    const mDur = (window._animMasterDuration !== undefined && window._animMasterDuration > 0)
      ? window._animMasterDuration : 2.0;
    const start = window._animLoopStart ?? 0;
    const end = window._animLoopEnd ?? mDur;
    this._viewStart = start;
    this._viewDuration = Math.max(0.1, end - start);
    this.draw();
  }

  _getTouchCentroidAndDist() {
    const pts = [...this._touchMap.values()];
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return { cx, cy, dist: Math.sqrt(dx * dx + dy * dy) };
  }

  // [Step 2] Ensure the first selected key's channel is visible in the graph gutter.
  // Called each draw in graph mode — cheap, idempotent.
  _followSelectedKeyChannel() {
    // Intentionally a no-op: previously this force-revealed the selected key's
    // channel every frame, which fought solo/hide (a stale selection on a hidden
    // channel would make it pop back into view). Visibility is now purely
    // user-controlled; selection can't target hidden channels in the first place.
  }

  _cancelActiveAction() {
    this._isDraggingPlayhead = false;
    this._isDraggingKeyframe = false;
    this._isDraggingMarquee = false;
    this._isDraggingTangent = false;
    this._isPanningGraph = false;
    this._isPanningGraphXY = false;
    this._isZoomingGraph = false;
    this._isResizingPanel = false;
    this._activeTransformHandle = null;
    this._activeKeyframeTrack = null;
    this._undoTracksBeforeMove = null;
  }

  // Returns toolbar button definitions — shared by draw() and onMouseDown().
  _toolbarBtnDefs() {
    const isGraph = this._mode === 'graph';
    const tanOn  = !!window._animShowTangents;
    const tboxOn = !!window._animShowTransformBox;
    const snapOn = window._animSnapToFrame !== false;
    const reg = window._animationRegistry;
    const sel = window._animSelectedKeys;
    const single = sel && sel.length === 1 ? sel[0] : null;
    let isTied = true;
    if (single && reg) {
      const tr = reg.tracks.get(single.meshId);
      if (tr?.tangentOffsets) {
        const pfx = single.type === 'transform' ? xfTanPrefix() : '';
        isTied = tr.tangentOffsets[`${pfx}${single.index}_tied`] !== false;
      }
    }
    const marqOn = !!window._animMarqueeMode;
    const btns = [];
    let bx = 10;
    // Mode toggle — two FA icons
    btns.push({ id: 'mode', x: bx, y: 5, w: 46, h: 20, icon: 'mode', tooltip: 'Toggle Dopesheet / Graph' });
    bx += 54;
    // ORDER: show tangents, tangent mode, marquee, fit all, transform box, snap.
    //
    // The two tangent controls were split either side of Fit All, reading as two unrelated
    // buttons rather than a switch and its mode -- matt: "the split of the tangents seems
    // silly." Showing them comes first because it gates the other: Tied/Free means nothing
    // while the handles are hidden.
    // Tangents show/hide (graph only, text)
    if (isGraph) {
      btns.push({ id: 'tangents', x: bx, y: 5, w: 70, h: 20,
        label: 'Tangents', active: tanOn, tooltip: 'Show tangent handles' });
      bx += 78;
    }
    // Tied tangents (graph only, text)
    if (isGraph) {
      btns.push({ id: 'tangents-tied', x: bx, y: 5, w: 105, h: 20,
        label: isTied ? 'Tangents: Tied' : 'Tangents: Free',
        disabled: !single, tooltip: 'Toggle tied / free tangents' });
      bx += 113;
    }
    // Drag vs Marquee toggle (icon drawn programmatically in draw())
    btns.push({ id: 'marquee', x: bx, y: 5, w: 28, h: 20, active: marqOn, tooltip: marqOn ? 'Marquee Selection on — click for Drag mode' : 'Drag Mode on — click for Marquee Selection' });
    bx += 36;
    // Fit All
    btns.push({ id: 'fit', x: bx, y: 5, w: 28, h: 20, icon: '', tooltip: 'Fit All (X + Y)' });
    bx += 36;
    // T.Box
    btns.push({ id: 'tbox', x: bx, y: 5, w: 28, h: 20, icon: '', active: tboxOn, tooltip: 'Transform Box' });
    bx += 36;
    // Snap
    btns.push({ id: 'snap', x: bx, y: 5, w: 28, h: 20, icon: '', active: snapOn, tooltip: 'Snap to Frames' });
    bx += 36;
    // Autokey — a mirror of the AnimationControlPanel toggle so it's reachable while
    // working in the dopesheet. Global flag (window._animAutoKey); keys on sculpt-end
    // (see SculptGL.js / Scene.js autokey blocks).
    btns.push({ id: 'autokey', x: bx, y: 5, w: 40, h: 20, label: 'Auto', active: !!window._animAutoKey, tooltip: 'Autokey: auto-key the active object on edit' });
    bx += 48;
    // "…" context menu — the flatscreen (desktop/iPad) skin of the VR radial's command
    // model (Scene._resolveRadialCommands): Copy / Paste / Paste Link / Dup / Make Unique
    // / Delete on the current key/frame selection. Opens a DOM popup on click.
    btns.push({ id: 'ctxmenu', x: bx, y: 5, w: 28, h: 20, label: '...', tooltip: 'More: Copy / Paste / Paste Link / Dup / Make Unique / Delete' });
    // Transport — centered but guaranteed not to overlap the left-side buttons.
    // _leftSafeEnd = right edge of the "…" button plus a 12px breathing room.
    const _leftSafeEnd = bx + 28 + 12;
    const playing = !!window._animPlaying;
    const armed   = !!(window._animArmed || window._animWaitingForGrab || reg?.isRecording || reg?.isCountingIn);
    const _tbDefs = [
      { id: 'rewind',    icon: '',                                             tooltip: 'Go to start' },
      { id: 'stepback',  icon: '',                                             tooltip: 'Previous frame' },
      { id: 'playpause', icon: playing ? '' : '', active: playing, tooltip: playing ? 'Pause' : 'Play' },
      { id: 'stepfwd',   icon: '',                                             tooltip: 'Next frame' },
      { id: 'end',       icon: '',                                             tooltip: 'Go to end' },
      { id: 'record',    icon: '',    active: armed,                           tooltip: armed ? 'Disarm recording' : 'Arm recording' },
    ];
    const _tbBtnW = 38, _tbBtnGap = 6;
    // The channel dropdown rides directly on Record, narrow and with no gap before it, so it
    // reads as part of that button rather than as a seventh transport control.
    const _recOptW = 16;
    const _tbTotal = _tbDefs.length * _tbBtnW + (_tbDefs.length - 1) * _tbBtnGap + _recOptW;
    let _tbX = Math.max(_leftSafeEnd, Math.round((this._cssWidth - _tbTotal) / 2));
    _tbDefs.forEach(def => {
      btns.push({ ...def, x: _tbX, y: 5, w: _tbBtnW, h: 20 });
      _tbX += _tbBtnW + _tbBtnGap;
      if (def.id === 'record') {
        _tbX -= _tbBtnGap;
        const _reg = window._animationRegistry;
        const _ch = _reg ? _reg.recordChannels() : null;
        btns.push({ id: 'recopts', x: _tbX, y: 5, w: _recOptW, h: 20, label: '\u25be',
          // Lit only when a channel is OFF, so the arrow is a quiet affordance normally and a
          // warning when a take is about to ignore something.
          active: !!_ch && !(_ch.translate && _ch.rotate && _ch.scale),
          tooltip: 'Which channels a take records: translate / rotate / scale' });
        _tbX += _recOptW + _tbBtnGap;
      }
    });

    // Recording row. Kept in the timeline itself because this is the surface visible while
    // posing; the main Animation panel mirrors the same globals and lifecycle.
    if (window._animLoopEnabled === undefined) window._animLoopEnabled = true;
    let rx = 205;
    const recMode = [
      { id: 'loop', label: 'Loop', w: 50, active: window._animLoopEnabled !== false,
        tooltip: 'Loop playback and recording through the range' },
      { id: 'trigger', label: 'On Grab', w: 68, active: !!window._animWaitForTrigger,
        tooltip: 'Arm now; begin recording on the next Grab or TransformVR drag' },
      { id: 'countin', label: '3-2-1', w: 54, active: !!window._animCountIn,
        tooltip: 'Begin recording after a countdown' },
      { id: 'reset-rig', label: 'Reset Rig + Pins', w: 112,
        tooltip: 'Return the skeleton and pin controls to their rest pose' },
      { id: 'range-start', label: `Start ${Math.round((window._animLoopStart ?? 0) * (window._animFPS || 24))}`, w: 68,
        tooltip: 'Playback range start frame' },
      { id: 'range-end', label: `End ${Math.round((window._animLoopEnd ?? window._animMasterDuration ?? 2) * (window._animFPS || 24))}`, w: 68,
        tooltip: 'Playback range end frame' },
      { id: 'speed', label: `Speed ${window._animPlaybackSpeed || 1}x ▾`, w: 78,
        tooltip: 'Playback speed' },
    ];
    for (const def of recMode) {
      btns.push({ ...def, x: rx, y: 31, h: 20 });
      rx += def.w + 7;
    }
    return btns;
  }

  // Flatscreen "…" context menu — the desktop/iPad skin of the VR radial. Reads the same
  // command model (Scene._resolveRadialCommands) and shows it as a DOM popup anchored under
  // the toolbar button. VR uses the radial; this is the flatscreen counterpart.
  // Which shape-layer row (if any) the cursor is over → {meshId, li}. Used by drag-through
  // multiselect. Mirrors the dopesheet lane/sub-row layout (with vertical scroll).
  _shapeLayerRowAt(ry) {
    const tracks = this._dopesheetTracks();
    const headerH = HEADER_H;
    const trackH = TimelineHelper.laneHeight(this._cssHeight - headerH, tracks.length);
    const dsScroll = this._dopeScroll();
    for (let laneIdx = 0; laneIdx < tracks.length; laneIdx++) {
      const [meshId, trackObj] = tracks[laneIdx];
      if (!trackObj.shapeLayers || !trackObj.shapeLayers.length) continue;
      const ty2 = headerH + laneIdx * trackH - dsScroll;
      const bsCount = trackObj.blendshapeTracks ? trackObj.blendshapeTracks.size : 0;
      for (let li = 0; li < trackObj.shapeLayers.length; li++) {
        if (Math.abs(ry - (ty2 + trackH / 2 + 22 + (bsCount + li) * 18)) <= 9) return { meshId, li };
      }
    }
    return null;
  }

  // Extra "…" menu commands from the shape-layer multiselect (#34): Combine when 2+ selected.
  _shapeLayerMenuCommands() {
    const reg = window._animationRegistry;
    const idxs = this._selShapeLayerIdxs;
    if (!reg || !idxs || idxs.size < 2) return [];
    const mesh = this._main._meshes?.find(m => m.getID() === this._selShapeLayerMesh);
    if (!mesh) return [];
    return [{
      label: `Combine ${idxs.size} layers`,
      run: () => {
        reg.combineShapeLayers?.(mesh, [...idxs]);
        this._selShapeLayerMesh = null;
        this._selShapeLayerIdxs = new Set();
        this.draw();
      },
    }];
  }

  // ── Gutter header buttons (key ops + mode) — single row, y:27-47 ──
  _gutterBtnDefs() {
    const mode   = window._animKeyMode || 'transform';
    const hasSel = !!(window._animSelectedKeys?.length);
    // A SELECTED TRACK COUNTS TOO. Clicking a row name already selects that object — in the
    // dopesheet, in the graph and in the 3D view, which are deliberately one selection — so the
    // row is a thing Delete can act on and the button has no business being dead over it.
    // matt: "i select a track name in the dopesheet, the name goes yellow, the delete icon
    // doesn't get activated."
    const _delReg = window._animationRegistry;
    const hasTrackSel = !hasSel && !!_delReg
      && this.selectedAnimationIds().some((id) => _delReg.tracks?.has(id));
    const btns   = [];
    const GUTTER_W = 196;
    const by = 27, bh = 20;
    const r2BtnW = 28, r2Gap = 4;
    // XF/SH/BS/SR are DISPLAY toggles (multi-select): each shows/hides that key type
    // in the sheet. The active add-type (last-activated, drawn brightest) is what the
    // "+" adds; when SR is active the "+" is replaced by New/Dup/Del. This row sits
    // above the lanes so it can span wider than the 196px gutter.
    const show = window._animKeyShow || (window._animKeyShow = { transform: true, shape: true, blendshape: true, shaperep: true });
    // Compact layout so all 7 buttons (SR mode) fit inside the gutter clip.
    let x = 4;
    const gap = 2, bw = 24;
    if (mode === 'shaperep') {
      // Consistent with the other modes: + = new, trash = delete. 'Dup' stays text so
      // it isn't confused with the copy/paste workflow coming next.
      btns.push({ id: 'sr_new', icon: '', x, y: by, w: bw, h: bh, tooltip: 'New blank frame' }); x += bw + gap;
      btns.push({ id: 'sr_dup', label: 'Dup', x, y: by, w: bw, h: bh, tooltip: 'Duplicate frame' }); x += bw + gap;
      btns.push({ id: 'sr_del', icon: '', x, y: by, w: bw, h: bh, tooltip: 'Delete frame' }); x += bw + gap;
    } else {
      btns.push({ id: 'addkey', icon: '', x, y: by, w: bw, h: bh, tooltip: 'Add key at playhead' }); x += bw + gap;
      btns.push({ id: 'delkey', icon: '', x, y: by, w: bw, h: bh,
        disabled: !hasSel && !hasTrackSel,
        // Says WHICH of the two it would do, so a destructive button is never a guess.
        tooltip: hasTrackSel ? 'Delete this object\u2019s animation'
          : 'Delete selected key(s)' }); x += bw + gap;
      // Shape mode: New shape layer (#34). Recording arms the new layer; click a layer's
      // name in a lane to (re)arm it, click the active one again → back to the base track.
      if (mode === 'shape') {
        btns.push({ id: 'newlayer', label: '+L', x, y: by, w: bw + 4, h: bh, tooltip: 'New shape layer (recording targets it)' }); x += bw + 4 + gap;
      }
    }
    // XF/SH/BS/SR are TALLER split buttons: top 60% = keying state (which mode the
    // +/New adds — a radio, one active), bottom 40% = visibility (is this key-type
    // drawn in the sheet). The keyed mode is always visible (its strip is locked on).
    // Click top of the already-keyed mode → SOLO (hide all others). Click a bottom
    // strip → toggle that type's visibility (no-op on the keyed mode).
    // RIGHT-aligned to the gutter so they hold position when the left-aligned add-ops
    // change count (SR = New/Dup/Del, others = add/del key).
    const modeBtnH = 34;
    const GUTTER_CLIP = 196;
    const modeCount = 4;
    let mx = GUTTER_CLIP - (modeCount * bw + (modeCount - 1) * gap) - 2;
    [['keymode_transform', 'XF', 'transform'], ['keymode_shape', 'SH', 'shape'], ['keymode_blendshape', 'BS', 'blendshape'], ['keymode_shaperep', 'SR', 'shaperep']].forEach(([id, label, type]) => {
      const isActive = mode === type;
      const isShown = isActive || !!show[type]; // keyed mode is implicitly always visible
      btns.push({ id, label, x: mx, y: by, w: bw, h: modeBtnH, split: true, shown: isShown, active: isActive,
        tooltip: isActive
          ? label + ' - keyed (+/New adds this; click top again to solo)'
          : label + ' - top: key this / bottom: ' + (isShown ? 'shown (click to hide)' : 'hidden (click to show)') });
      mx += bw + gap;
    });
    return btns;
  }

  // [Step F] Compute infobar state for the selected key.
  // Returns { frame, keyType, vals[], labels[], label, hasSelection }
  // keyType: 'transform' | 'blendshape' | 'shape' | null
  // vals / labels: parallel arrays for v1/v2/v3 inputs

  onMouseDown(e) {
    // The desktop half of the multi-select modifier, captured here because the row handlers
    // downstream are reached through several paths and none of them carry the event. The VR
    // half is read live from Scene.multiSelectHeld and needs no capture.
    this._lastModifierDown = !!(e && (e.ctrlKey || e.metaKey || e.shiftKey));
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    // Shared canvas-native "…" menu. This path receives both desktop pointer events and the
    // synthetic VR timeline events, unlike the old DOM popup.
    // The channel menu first, and a hit does NOT close it: these are switches, not commands.
    if (this._recOptMenuOpen) {
      const rr = this._recOptRect();
      if (rr && rx >= rr.x && rx <= rr.x + rr.w && ry >= rr.y && ry < rr.y + rr.h) {
        const cmd = this._recOptCommands()[Math.floor((ry - rr.y) / rr.cellH)];
        try { cmd?.run?.(); } catch (err) { console.error('[TL recopts] toggle failed', err); }
        this.draw();
        return;
      }
      this._recOptMenuOpen = false;
      // Deliberately no `return`: the click that dismisses the menu still lands on whatever it
      // was over, which is what makes closing it feel free rather than like a wasted click.
      this.draw();
    }

    if (this._contextMenuOpen) {
      const mr = this._contextMenuRect();
      if (mr && rx >= mr.x && rx <= mr.x + mr.w && ry >= mr.y && ry < mr.y + mr.h) {
        const cmd = this._contextMenuCommands()[Math.floor((ry - mr.y) / mr.cellH)];
        if (cmd && cmd.enabled !== false) {
          try { cmd.run?.(); } catch (err) { console.error('[TL ctxmenu] command failed', err); }
        }
      }
      this._contextMenuOpen = false;
      this.draw();
      return;
    }

    // Canvas-native playback-speed dropdown. Handle it before ruler/key hit tests
    // because the menu intentionally overlays the timeline below the toolbar.
    if (this._speedMenuOpen) {
      const sr = this._speedMenuRect();
      if (sr && rx >= sr.x && rx <= sr.x + sr.w && ry >= sr.y && ry < sr.y + sr.h) {
        const col = Math.floor((rx - sr.x) / sr.cellW);
        const row = Math.floor((ry - sr.y) / sr.cellH);
        const idx = row * 2 + col;
        const speed = PLAYBACK_SPEEDS[idx];
        if (speed !== undefined) {
          window._animPlaybackSpeed = speed;
          window.saveOption?.('animPlaybackSpeed', speed);
          window._animSyncKeyInspector?.();
        }
        this._speedMenuOpen = false;
        this.draw();
        return;
      }
      this._speedMenuOpen = false;
      this.draw();
      return;
    }

    // Any new pointer interaction dismisses an open value-entry field and its
    // channel highlight (click elsewhere = lose focus). The value-badge handler
    // below re-sets the highlight for a freshly clicked channel.
    if (this._valInput && this._valInput.style.display !== 'none') {
      this._commitValInput();
      this._valInput.style.display = 'none';
    }
    if (this._frameInput && this._frameInput.style.display !== 'none') {
      this._applyFrameExpr(this._frameInput.value);
      this._frameInput.style.display = 'none';
    }
    if (this._valueInput && this._valueInput.style.display !== 'none') {
      this._applyValueExpr(this._valueInput.value);
      this._valueInput.style.display = 'none';
    }
    if (this._rangeInput && this._rangeInput.style.display !== 'none') {
      this._commitRangeInput();
      this._rangeInput.style.display = 'none';
    }
    const _hadEdit = this._editingBsName != null;
    this._editingBsName = null;
    if (_hadEdit) this.draw();

    if (ry < 5) {
      this._isResizingPanel = true;
      this._resizeStartScreenY = e.clientY;
      this._resizeStartHeight = this._cssHeight;
      return;
    }

    // Ruler strip + playhead cap (below both toolbar rows, in the timeline column).
    // Must be checked before toolbar buttons — several buttons extend into rx >= 200
    // but are drawn only at y 5-25, so the ruler row has priority here.
    const _tlX = 200;
    const _tlW = this._cssWidth - 220;
    if (ry >= TOOLBAR_BOTTOM && ry < HEADER_H && rx >= _tlX && rx <= _tlX + _tlW) {
      this._isDraggingPlayhead = true;
      this.handleInteraction(e);
      return;
    }

    if (ry < HEADER_H) {
      // Gutter header buttons (x:0-195, y:27-47) — key ops + mode.
      if (rx < 196) {
        const gbBtns = this._gutterBtnDefs();
        const gbHit = gbBtns.find(b => rx >= b.x && rx <= b.x + b.w && ry >= b.y && ry <= b.y + b.h);
        if (gbHit) {
          const reg = window._animationRegistry;
          const mesh = this._main?.getMesh?.();
          const t = window._animCurrentTime || 0;
          switch (gbHit.id) {
            case 'sr_new':
              window._frameGroup?.addFrame?.(false); // blank frame
              this.draw();
              return;
            case 'newlayer':
              if (reg && mesh) reg.addShapeLayer?.(mesh);   // creates + arms a shape layer (#34)
              this.draw();
              return;
            case 'sr_dup':
              window._frameGroup?.addFrame?.(true);  // duplicate held frame
              this.draw();
              return;
            case 'sr_del':
              window._frameGroup?.deleteFrame?.();
              this.draw();
              return;
            case 'addkey':
              if (reg && mesh) {
                const km = window._animKeyMode || 'transform';
                if (km === 'shape') {
                  reg.addShapeKey(mesh, t);
                } else if (km === 'blendshape') {
                  const tr = reg.tracks.get(mesh.getID());
                  tr?.blendshapeTracks?.forEach((bTrack, name) => {
                    const w = reg.evaluateScalarTrack(bTrack, t);
                    reg.setBlendshapeWeight(mesh, name, w);
                  });
                } else {
                  reg.addTransformKey(mesh, t);
                }
              }
              break;
            case 'delkey':
              // Keys first: a key selection is the narrower statement, and the other way round
              // wipes a whole object's animation while keys are selected. The track case only
              // runs when there are no keys — deleteAnimationFromSelectedObjects pushes its own
              // undo entry, so redo comes with it.
              if (window._animSelectedKeys?.length) this.deleteSelectedKeys();
              else this.deleteAnimationFromSelectedObjects();
              break;
            default:
              if (gbHit.id.startsWith('keymode_')) {
                const type = gbHit.id.replace('keymode_', '');
                const show = window._animKeyShow || (window._animKeyShow = { transform: true, shape: true, blendshape: true, shaperep: true });
                const types = ['transform', 'shape', 'blendshape', 'shaperep'];
                // Split button: top 60% = keying state, bottom 40% = visibility.
                const inTop = (ry - gbHit.y) < gbHit.h * 0.60;
                if (inTop) {
                  if (window._animKeyMode === type) {
                    // Already the keyed mode → SOLO: hide every other type.
                    types.forEach(t => { if (t !== type) show[t] = false; });
                  } else {
                    window._animKeyMode = type; // make it the keyed mode (always visible)
                    show[type] = true;
                  }
                } else {
                  // Bottom strip = visibility toggle; the keyed mode can't be hidden.
                  if (window._animKeyMode !== type) show[type] = !show[type];
                }
              }
          }
          this.draw();
          return;
        }
      }
      // Frame field (right-aligned toolbar badge) — set/shift the selected key frame(s).
      {
        const fr = this._frameFieldRect();
        if (rx >= fr.x && rx <= fr.x + fr.w && ry >= fr.y && ry <= fr.y + fr.h) {
          const sel = window._animSelectedKeys || [];
          if (!sel.length) return; // nothing selected — no-op
          const reg2 = window._animationRegistry;
          const fps  = window._animFPS || 24;
          const k0   = sel[0];
          const tr0  = reg2?.tracks.get(k0.meshId);
          const t0   = tr0 ? (k0.type === 'transform' ? tr0.times?.[k0.index]
                            : k0.type === 'shape'     ? tr0.shapeTimes?.[k0.index]
                            : tr0.blendshapeTracks?.get(k0.name)?.times?.[k0.index]) : undefined;
          const curFrame = (t0 !== undefined) ? Math.round(t0 * fps) : 0;

          // VR / numpad preference → numpad (digits only, so absolute frame set).
          if (window._vrNumpad && window._vrNumpad.shouldUse()) {
            if (window._vrNumpad.isBlockingOpen) return;
            window._vrNumpad.open(curFrame, { label: sel.length > 1 ? 'Frame (all)' : 'Frame', integer: true, relativeExpr: true }, (val) => {
              this._applyFrameExpr(String(val));
              this.draw();
            }, null, null, this._main?._vrTimelineMesh || null);
            return;
          }
          // Desktop: typed entry — supports "+=10" / "-=5" to shift a multi-selection.
          this._frameInput.style.left  = Math.round(fr.x) + 'px';
          this._frameInput.style.top   = Math.round(fr.y) + 'px';
          this._frameInput.style.width = (fr.w - 10) + 'px';
          this._frameInput.style.display = 'block';
          this._frameInput.value = sel.length > 1 ? '' : String(curFrame);
          this._frameInput.placeholder = sel.length > 1 ? '+=N' : '';
          this._frameInput.focus();
          this._frameInput.select();
          return;
        }
      }
      // Value field (left of the frame field) — set/shift the selected key value(s).
      {
        const vr2 = this._valueFieldRect();
        if (rx >= vr2.x && rx <= vr2.x + vr2.w && ry >= vr2.y && ry <= vr2.y + vr2.h) {
          const sel = window._animSelectedKeys || [];
          if (!sel.length) return;
          const reg2 = window._animationRegistry;
          const cur0 = this._keyValue(sel[0], reg2?.tracks.get(sel[0].meshId));
          const curVal = (cur0 !== undefined) ? Math.round(cur0 * 1000) / 1000 : 0;

          if (window._vrNumpad && window._vrNumpad.shouldUse()) {
            if (window._vrNumpad.isBlockingOpen) return;
            // No min/max → no clamp; relativeExpr enables += / -= for shifting.
            window._vrNumpad.open(curVal, { label: sel.length > 1 ? 'Value (all)' : 'Value', integer: false, relativeExpr: true }, (val) => {
              this._applyValueExpr(String(val));
              this.draw();
            }, null, null, this._main?._vrTimelineMesh || null);
            return;
          }
          this._valueInput.style.left  = Math.round(vr2.x) + 'px';
          this._valueInput.style.top   = Math.round(vr2.y) + 'px';
          this._valueInput.style.width = (vr2.w - 10) + 'px';
          this._valueInput.style.display = 'block';
          this._valueInput.value = sel.length > 1 ? '' : String(curVal);
          this._valueInput.placeholder = sel.length > 1 ? '0 or +=N' : '';
          this._valueInput.focus();
          this._valueInput.select();
          return;
        }
      }
      // Dispatch toolbar clicks via _toolbarBtnDefs() so positions stay in sync with draw().
      // Transport buttons are positioned with a safe left-margin (see _toolbarBtnDefs) so
      // they never overlap the left-side buttons — a single find() is sufficient.
      const tbBtns = this._toolbarBtnDefs();
      const hit = tbBtns.find(b => !b.disabled && rx >= b.x && rx <= b.x + b.w && ry >= b.y && ry <= b.y + b.h);
      if (hit) {
        console.log('[TL] toolbar hit:', hit.id, 'rx:', Math.round(rx), 'ry:', Math.round(ry));
        switch (hit.id) {
          case 'mode': {
            this._mode = this._mode === 'graph' ? 'dope' : 'graph';
            window.saveOption?.('vrTimelineMode', this._mode);
            if (this._mode === 'graph') {
              this.autoFitGraph();
              if (this._viewDuration === undefined) {
                const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
                const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
                const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
                this._viewStart = loopStart;
                this._viewDuration = Math.max(0.1, loopEnd - loopStart);
              }
            }
            break;
          }
          case 'tangents-tied': {
            const reg = window._animationRegistry;
            const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
            if (singleSelected) {
              const track = reg.tracks.get(singleSelected.meshId);
              if (track) {
                if (!track.tangentOffsets) track.tangentOffsets = {};
                const prefix = singleSelected.type === 'transform' ? xfTanPrefix() : '';
                const key = `${prefix}${singleSelected.index}_tied`;
                const cur = track.tangentOffsets[key] !== false;
                track.tangentOffsets[key] = !cur;
              }
            }
            break;
          }
          case 'fit': {
            // Fit All: auto-fit Y to value range, X to loop range.
            // Minimum view is 1 second so we don't zoom in to 2 frames when
            // keys are tightly clustered or the loop range is tiny.
            this.autoFitGraph();
            const mDur = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
            const ls = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
            const le = window._animLoopEnd !== undefined ? window._animLoopEnd : mDur;
            this._viewStart = ls;
            this._viewDuration = Math.max(le - ls, 1.0);
            break;
          }
          case 'tangents':
            window._animShowTangents = !window._animShowTangents;
            break;
          case 'tbox':
            window._animShowTransformBox = !window._animShowTransformBox;
            break;
          case 'snap':
            window._animSnapToFrame = window._animSnapToFrame === false ? true : false;
            break;
          case 'autokey': {
            window._animAutoKey = !window._animAutoKey;
            // Keep the AnimationControlPanel's Autokey button in sync (same global).
            const _ak = document.querySelector('#acp-autokey-btn');
            if (_ak) _ak.classList.toggle('active', !!window._animAutoKey);
            break;
          }
          case 'marquee':
            window._animMarqueeMode = !window._animMarqueeMode;
            break;
          case 'ctxmenu':
            this._contextMenuOpen = !this._contextMenuOpen;
            this._speedMenuOpen = false;
            this._recOptMenuOpen = false;
            this.draw();
            return;
          case 'recopts':
            this._recOptMenuOpen = !this._recOptMenuOpen;
            this._contextMenuOpen = false;
            this._speedMenuOpen = false;
            this.draw();
            return;
          case 'rewind': {
            const _reg = window._animationRegistry;
            const _mesh = this._main?.getMesh?.();
            const _t0 = window._animLoopStart ?? 0;
            window._animPlaying = false;
            window._animCurrentTime = _t0;
            if (_reg) _reg.globalPlaybackTime = _t0;
            if (_reg && _mesh) _reg.update(_mesh, true);
            break;
          }
          case 'stepback': {
            const _fps2 = window._animFPS || 24;
            const _t2 = Math.max(window._animLoopStart ?? 0,
              Math.round(((window._animCurrentTime || 0) * _fps2 - 1)) / _fps2);
            window._animPlaying = false;
            window._animCurrentTime = _t2;
            const _r2 = window._animationRegistry; const _m2 = this._main?.getMesh?.();
            if (_r2) _r2.globalPlaybackTime = _t2;
            if (_r2 && _m2) _r2.update(_m2, true);
            break;
          }
          case 'playpause': {
            const _playReg = window._animationRegistry;
            if (window._animPlaying) {
              window._animPlaying = false;
              if (_playReg) _playReg.lastGlobalTime = null;
            } else {
              _playReg?.startPlayback?.(1);
            }
            break;
          }
          case 'stepfwd': {
            const _fps3 = window._animFPS || 24;
            const _end3 = window._animLoopEnd ?? (window._animMasterDuration ?? 2);
            const _t3 = Math.min(_end3,
              Math.round(((window._animCurrentTime || 0) * _fps3 + 1)) / _fps3);
            window._animPlaying = false;
            window._animCurrentTime = _t3;
            const _r3 = window._animationRegistry; const _m3 = this._main?.getMesh?.();
            if (_r3) _r3.globalPlaybackTime = _t3;
            if (_r3 && _m3) _r3.update(_m3, true);
            break;
          }
          case 'end': {
            const _tEnd = window._animLoopEnd ?? (window._animMasterDuration ?? 2);
            window._animPlaying = false;
            window._animCurrentTime = _tEnd;
            const _r4 = window._animationRegistry; const _m4 = this._main?.getMesh?.();
            if (_r4) _r4.globalPlaybackTime = _tEnd;
            if (_r4 && _m4) _r4.update(_m4, true);
            break;
          }
          case 'record':
            // Same toggle lifecycle as the ACP Record button (start/stop + arm/disarm),
            // so the two record controls agree instead of doing different things.
            window._animationRegistry?.toggleRecord?.(this._main?.getMesh?.());
            break;
          case 'loop':
            window._animLoopEnabled = window._animLoopEnabled === false;
            window.saveOption?.('animLoopEnabled', window._animLoopEnabled);
            break;
          case 'trigger':
            window._animWaitForTrigger = !window._animWaitForTrigger;
            if (window._animWaitForTrigger) window._animCountIn = false;
            window.saveOption?.('animStartOnClick', !!window._animWaitForTrigger);
            window.saveOption?.('animCountIn', !!window._animCountIn);
            break;
          case 'countin':
            window._animCountIn = !window._animCountIn;
            if (window._animCountIn) window._animWaitForTrigger = false;
            window.saveOption?.('animCountIn', !!window._animCountIn);
            window.saveOption?.('animStartOnClick', !!window._animWaitForTrigger);
            break;
          case 'reset-rig':
            IKSolver.resetRigAndPins(this._main);
            break;
          case 'range-start':
            this._editPlaybackRange('start', hit);
            return;
          case 'range-end':
            this._editPlaybackRange('end', hit);
            return;
          case 'speed':
            this._speedMenuOpen = !this._speedMenuOpen;
            this._contextMenuOpen = false;
            this.draw();
            return;
        }
        this.draw();
        return;
      }
      this._isDraggingPlayhead = true;
      this.handleInteraction(e);
    } else {
      // Gutter click/drag for Graph Editor channels in Desktop Timeline
      if (this._mode === 'graph' && rx < 200 && ry > HEADER_H) {
        // The T|R|S strip sits above row 0, so it has to be answered before the row math —
        // otherwise a click on it lands on a negative row index.
        const seg = this._xfSegRects().find((r) => rx >= r.x && rx <= r.x + r.w
                                                && ry >= r.y && ry <= r.y + r.h);
        if (seg) {
          if (seg.norm) {
            window._animXfNorm = !this._xfNorm();
            this._applyNormView(this._xfNorm());
          }
          else this._switchXfGroup(seg.g);
          this.draw();
          return;
        }
        const gutterY = HEADER_H + 4 + XF_SEG_H;
        const rowH = 22;
        // ROW INDEX IS NO LONGER THE CHANNEL NUMBER. With several groups listed, row 4 might be
        // rotation's Y -- so the row is resolved through the same meta the drawing built, and
        // the two cannot disagree about what a row means.
        const channel = Math.floor((ry - gutterY + this._gutterScrollY) / rowH);

        const reg = window._animationRegistry;
        const activeMesh = this._graphMesh();
        const track = activeMesh ? reg.tracks.get(activeMesh.getID()) : null;
        const meta = this._gutterRowMeta || [];
        const maxChannels = meta.length;

        if (channel >= 0 && channel < maxChannels) {
          const m = meta[channel];
          if (rx < 36) { // eye icon zone (widened for VR — easier to hit)
            if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];
            if (m && m.kind === 'xf') {
              if (e.shiftKey) this._soloChannel({ kind: 'transform', channel: m.channel });
              else xfSetChanVisible(m.group, m.channel, !xfChanVisible(m.group, m.channel));
            } else if (m && m.kind === 'shape') {
              if (e.shiftKey) this._soloChannel({ kind: 'shape', channel: 3 });
              else window._animChannelVisible[3] = !window._animChannelVisible[3];
            } else if (m && m.kind === 'weight') {
              // The weight row's eye is the W filter itself -- one channel, one switch, rather
              // than two controls that can disagree about whether it is showing.
              this._switchXfGroup('weight');
            }
            this._pruneSelectionToVisible();
            this.draw();
            return;
          }
        }

        // Blendshape channel: start a potential scrub.
        // Short horizontal movement → treated as visibility toggle on mouseup.
        // Blendshape row: left zone (rx < 150) = visibility toggle, right zone = weight scrub.
        const bsOffset = channel - maxChannels;
        if (bsOffset >= 0 && track && track.blendshapeTracks && rx >= 5) {
          const bsNames = TimelineHelper.bsNames(track);
          const bsName = bsNames[bsOffset];
          if (bsName !== undefined) {
            if (rx < 36) {
              // Eye icon zone (widened for VR). Toggle immediately on press — no
              // click-vs-drag deferral, which was impossible to satisfy with a
              // jittery VR controller. Shift (secondary trigger) → solo.
              if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
              if (e.shiftKey) {
                this._soloChannel({ kind: 'blendshape', name: bsName });
              } else {
                window._animBsChannelVisible[bsName] = window._animBsChannelVisible[bsName] === false ? true : false;
                this._pruneSelectionToVisible();
                this.draw();
              }
              return;
            }
            // Value badge zone (x:140-185): enter a weight directly.
            if (rx >= 140 && rx <= 185) {
              const bTrack = track.blendshapeTracks.get(bsName);
              const curW = reg.evaluateScalarTrack(bTrack, track.playbackTime || 0);
              // Mark this channel as being edited: bold name + scroll it into view
              // (rendered on the shared canvas, so it shows on desktop and in VR).
              this._editingBsName = bsName;
              this._ensureGutterRowVisible(channel);
              // VR (no keyboard) or the 'always use numpad' preference → bring up
              // the floating numpad instead of the DOM input overlay.
              if (window._vrNumpad && window._vrNumpad.shouldUse()) {
                if (window._vrNumpad.isBlockingOpen) { this._editingBsName = null; return; }
                this.draw();
                // No min/max → numpad does not clamp; typing 5.0 keeps 5.0.
                window._vrNumpad.open(curW, { label: bsName, integer: false }, (val) => {
                  reg.setBlendshapeWeight(activeMesh, bsName, val);
                  if (window.app?.render) window.app.render();
                  this._editingBsName = null;
                  this.draw();
                }, null, null, this._main?._vrTimelineMesh || null);
                return;
              }
              // Desktop: inline numeric input overlay, right-aligned in the badge.
              // Row y in canvas CSS coords: gutterY + abs-row-index * rowH − scroll
              // (computed after _ensureGutterRowVisible may have adjusted scroll).
              const _gutterRowTop = (HEADER_H + 4 + XF_SEG_H) + channel * rowH - this._gutterScrollY;
              this._valInput.style.top  = Math.round(_gutterRowTop + 3) + 'px';
              this._valInput.style.display = 'block';
              this._valInput.value = curW.toFixed(2);
              this._valInputChannel = 'bs:' + bsName;
              this._valInput.focus();
              this._valInput.select();
              this.draw();
              return;
            }
            if (rx >= 32 && rx < 140) {
              // Scrub zone (x:32-139): defer decision to mouseup.
              // drag → scrub weight; click (no drag) → do nothing.
              const bTrack = track.blendshapeTracks.get(bsName);
              this._bsScrubName        = bsName;
              this._bsScrubMesh        = activeMesh;
              this._bsScrubZone        = 'name';
              this._bsScrubActive      = false;
              this._bsScrubStartX      = rx;
              this._bsScrubStartWeight = reg.evaluateScalarTrack(bTrack, track.playbackTime || 0);
              // Snapshot the bsTrack state before any modifications so we can push a single
              // undo entry covering the entire gesture when the pointer is released.
              this._bsScrubSnapBefore  = { times: bTrack.times.slice(), values: bTrack.values.slice() };
              return;
            }
          }
        }

        // No toggle hit — start a gutter scroll drag
        this._isDraggingGutter = true;
        this._gutterDragStartY = ry;
        this._gutterDragStartScroll = this._gutterScrollY;
        return;
      }

      // Dopesheet: middle-mouse drag pans (vertical scroll through the stacked tracks +
      // horizontal time), matching the graph editor. Left mouse stays marquee.
      if (this._mode !== 'graph' && e.button === 1) {
        this._isPanningDope = true;
        this._panStartRx = rx; this._panStartRy = ry;
        this._panStartDopeScroll = this._dopeScrollY || 0;
        if (this._viewDuration === undefined) {
          const mD = (window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
          this._viewStart = window._animLoopStart ?? 0.0;
          this._viewDuration = Math.max(0.1, (window._animLoopEnd ?? mD) - this._viewStart);
        }
        this._panStartViewStart = this._viewStart;
        e.preventDefault();
        return;
      }

      if (this._mode === 'graph') {
        if (e.button === 1) { // Middle click
          this._isPanningGraph = true;
          this._panStartRy = ry;
          this._panStartOffsetY = this._panY;
          e.preventDefault();
          return;
        } else if (e.button === 2) { // Right click
          this._isZoomingGraph = true;
          this._zoomStartRy = ry;
          this._zoomStartRx = rx;
          this._zoomStartScaleY = this._zoomY;
          this._zoomStartPanY = this._panY;
          
          const tlX = 200;
          const tlW = this._cssWidth - 200;
          const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
          const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
          const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
          const visibleDuration = Math.max(0.1, loopEnd - loopStart);
          
          if (this._viewDuration === undefined) {
            this._viewStart = loopStart;
            this._viewDuration = visibleDuration;
          }
          
          this._zoomStartDuration = this._viewDuration;
          this._zoomStartViewStart = this._viewStart;
          
          this._zoomPivotTime = this._viewStart + ((rx - tlX) / tlW) * this._viewDuration;
          this._zoomPivotValue = this.yToValue(ry);
          
          e.preventDefault();
          return;
        }
        this.handleGraphMouseDown(rx, ry);
        return;
      }
      // Check if clicked on Mute or Delete!
      const reg = window._animationRegistry;
      if (reg) {
        const tracks = this._dopesheetTracks();
        const headerH = HEADER_H;
        const laneAreaH = this._cssHeight - headerH;
        const trackH = TimelineHelper.laneHeight(laneAreaH, tracks.length);
        const dsScroll = this._dopeScroll();
        // Loop lanes and match by ACTUAL row Y — the blendshape/layer sub-rows extend below a
        // lane's slot (with one object, trackH is a quarter-height but the rows stack past it),
        // so a slot-based clickedLaneIdx pointed at the wrong/empty lane and the clicks missed.
        for (let laneIdx = 0; laneIdx < tracks.length; laneIdx++) {
          const [meshId, trackObj] = tracks[laneIdx];
          const laneMesh = this._main._meshes?.find(m => m.getID() === meshId);
          const ty2 = headerH + laneIdx * trackH - dsScroll;

          // Blendshape sub-rows: M (mute layer) / × (delete this track's animation).
          if (rx >= 154 && rx < 188 && trackObj.blendshapeTracks && laneMesh) {
            const bsNames = TimelineHelper.bsNames(trackObj);
            for (let bIdx = 0; bIdx < bsNames.length; bIdx++) {
              if (Math.abs(ry - (ty2 + trackH / 2 + 22 + bIdx * 18)) > 9) continue;
              if (rx < 170) reg.toggleBlendshapeMute?.(laneMesh, bsNames[bIdx]); // M ≈ x162
              else this._deleteBlendshapeTrack(laneMesh, bsNames[bIdx]);          // × ≈ x178
              this.draw();
              return;
            }
          }
          // Shape-LAYER rows (#34): dot (< x20) = multiselect; name (< x150) = arm; M mute; × delete.
          if (trackObj.shapeLayers && trackObj.shapeLayers.length && laneMesh && rx >= 4 && rx < 188) {
            const bsCount = trackObj.blendshapeTracks ? trackObj.blendshapeTracks.size : 0;
            for (let li = 0; li < trackObj.shapeLayers.length; li++) {
              if (Math.abs(ry - (ty2 + trackH / 2 + 22 + (bsCount + li) * 18)) > 9) continue;
              if (rx < 20) {                                       // multiselect dot
                if (this._selShapeLayerMesh !== meshId) { this._selShapeLayerMesh = meshId; this._selShapeLayerIdxs = new Set(); }
                const setTo = !this._selShapeLayerIdxs.has(li);    // paint the same state while dragging
                if (setTo) this._selShapeLayerIdxs.add(li); else this._selShapeLayerIdxs.delete(li);
                this._layerDotDrag = { meshId, setTo };            // drag-through select/deselect
              }
              else if (rx >= 154 && rx < 170) reg.toggleShapeLayerMute?.(laneMesh, li);   // M
              else if (rx >= 170 && rx < 188) reg.removeShapeLayer?.(laneMesh, li);        // ×
              else if (rx < 150) reg.setActiveShapeLayer?.(laneMesh, trackObj.activeShapeLayerIdx === li ? -1 : li); // arm
              else continue;
              this.draw();
              return;
            }
          }
          // CLICKING A ROW NAME POINTS THE GRAPH EDITOR AT THAT TRACK. The row you clicked is
          // the thing whose curves you want; having to go and select its object in the 3D view
          // first was the whole complaint. Sub-rows above have already had their chance, so
          // this only catches a click on the lane's own name strip.
          if (rx < 176 && ry >= ty2 && ry < ty2 + trackH) {
            this._setGraphTarget(meshId);
            this.draw();
            return; // a deliberate pick, not the start of a marquee
          }

          // Object-level M mute (lane-centre row, right column).
          if (rx >= 176 && rx < 200 && ry >= ty2 && ry < ty2 + trackH && !(laneMesh && laneMesh._isFrameGroup)) {
            trackObj.muted = !trackObj.muted;
            this.draw();
            return; // Don't start marquee
          }
        }
      }

      // Check if clicked on a key!
      if (reg) {
        const tracks = this._dopesheetTracks();
        const headerH = HEADER_H;
        const laneAreaH = this._cssHeight - headerH;
        const trackH = TimelineHelper.laneHeight(laneAreaH, tracks.length);
        const dsScroll = this._dopeScroll();

        const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
        const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
        const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
        // [Step Bug3] Use _viewStart/_viewDuration when defined so hit test matches draw.
        let loopStart = loopStartReal;
        let visibleDuration = Math.max(0.1, loopEndReal - loopStartReal);
        if (this._viewDuration !== undefined) {
          loopStart = this._viewStart;
          visibleDuration = this._viewDuration;
        }

        const tlX = 200;
        const tlW = this._cssWidth - 200;

        this._traceKeyPick(rx, ry, tracks, trackH, dsScroll, tlX, tlW, loopStart, visibleDuration);

        // Check if clicked on Transform Box handles!
        if (window._animShowTransformBox && window._animTransformBox) {
          const tBox = window._animTransformBox;
          const kxLeft = tlX + ((tBox.startTime - loopStart) / visibleDuration) * tlW;
          const kxRight = tlX + ((tBox.endTime - loopStart) / visibleDuration) * tlW;
          const kxMid = (kxLeft + kxRight) / 2;

          let minV = Infinity;
          let maxV = -Infinity;
          if (window._animSelectedKeys) {
            window._animSelectedKeys.forEach(sk => {
              const tr = reg.tracks.get(sk.meshId);
              if (tr && sk.type === 'transform' && tr.positions) {
                const val = xfRead(tr, sk.index, sk.channel !== undefined ? sk.channel : 0, sk.group);
                if (val < minV) minV = val;
                if (val > maxV) maxV = val;
              }
            });
          }
          
          let kyTop = headerH;
          let kyBottom = this._cssHeight;
          if (minV !== Infinity && maxV !== Infinity && this._mode === 'graph') {
            kyTop = this.valueToY(maxV);
            kyBottom = this.valueToY(minV);
          }
          
          const cyMid = (kyTop + kyBottom) / 2;

          if (Math.abs(rx - kxLeft) < 10) {
            this._activeTransformHandle = 'left';
            this._transformStartRx = rx;
            this._animTransformInitialBox = { startTime: tBox.startTime, endTime: tBox.endTime };
            if (window._animSelectedKeys) {
              // The drag retimes via _animTransformBoxInitialKeys (handles every key
              // type incl. 'frame'); _animTransformBoxInitialTimes feeds the
              // transform/shape undo-command builder only.
              this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
              this._animTransformBoxInitialTimes = window._animSelectedKeys.map(sk => {
                const tr = reg.tracks.get(sk.meshId);
                const time = this._keyTimeOf(tr, sk);
                return { ...sk, time };
              });
            }
            return;
          } else if (Math.abs(rx - kxRight) < 10) {
            this._activeTransformHandle = 'right';
            this._transformStartRx = rx;
            this._animTransformInitialBox = { startTime: tBox.startTime, endTime: tBox.endTime };
            if (window._animSelectedKeys) {
              this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
              this._animTransformBoxInitialTimes = window._animSelectedKeys.map(sk => {
                const tr = reg.tracks.get(sk.meshId);
                const time = this._keyTimeOf(tr, sk);
                return { ...sk, time };
              });
            }
            return;
          } else if (Math.abs(rx - kxMid) < 20 && Math.abs(ry - cyMid) < 20) {
            this._activeTransformHandle = 'scale_center';
            this._transformStartRx = rx;
            this._transformStartRy = ry;
            this._scaleCenterLock = null;
            this._animTransformInitialBox = { startTime: tBox.startTime, endTime: tBox.endTime };
            if (window._animSelectedKeys) {
              const singleSelected = window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
              const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;
              this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
              
              // Calculate minV and maxV for vertical scaling
              let minV = Infinity;
              let maxV = -Infinity;
              this._animTransformBoxInitialKeys.forEach(sk => {
                if (sk.val !== undefined) {
                  if (sk.val < minV) minV = sk.val;
                  if (sk.val > maxV) maxV = sk.val;
                }
              });
              if (minV !== Infinity && maxV !== Infinity) {
                this._animTransformInitialBox.minV = minV;
                this._animTransformInitialBox.maxV = maxV;
              }
            }
            return;
          } else if (rx >= kxLeft && rx <= kxRight) {
            const boxWidth = kxRight - kxLeft;
            const twoThirdsStart = kxLeft + boxWidth * (1 / 6);
            const twoThirdsEnd = kxLeft + boxWidth * (5 / 6);

            if (rx >= twoThirdsStart && rx <= twoThirdsEnd) {
              this._activeTransformHandle = 'center';
              this._transformStartRx = rx;
              this._animTransformInitialBox = { startTime: tBox.startTime, endTime: tBox.endTime };
              if (window._animSelectedKeys) {
                this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, 0);
                this._animTransformBoxInitialTimes = window._animSelectedKeys.map(sk => {
                  const tr = reg.tracks.get(sk.meshId);
                  const time = this._keyTimeOf(tr, sk);
                  return { ...sk, time };
                });
              }
              return;
            }
          }
        }

        let keyFound = false;
        // Hidden key types (bottom-strip visibility off) are not selectable — a hidden
        // key must not be picked/marqueed alongside a visible one at the same time.
        const _keyShow = window._animKeyShow || { transform: true, shape: true, blendshape: true, shaperep: true };

        // In marquee mode, skip key-drag detection — always start marquee.
        if (window._animMarqueeMode) {
          if (window._tlTrace) console.log('[tl] -> MARQUEE MODE is on: key detection skipped entirely');
          this._isDraggingMarquee = true;
          this._marqueeStart = { x: rx, y: ry };
          this._marqueeEnd   = { x: rx, y: ry };
          return;
        }

        tracks.forEach(([meshId, trackObj], laneIdx) => {
          const ty = headerH + (laneIdx * trackH) - dsScroll;
          const kyTransform = ty + trackH / 2; // centred (matches drawDopeSheet)
          const kyShape     = ty + trackH / 2 + 10; // matches drawDopeSheet offset

          if (ry >= ty && ry <= ty + trackH) {
            if (_keyShow.transform !== false && trackObj.times) {
              for (let i = 0; i < trackObj.times.length; i++) {
                const t = trackObj.times[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 12 && Math.abs(ry - kyTransform) < 12) {
                  this._isDraggingKeyframe = true;
                  this._activeKeyframeTrack = trackObj;
                  this._activeMeshId = meshId;
                  this._setGraphTarget(meshId); // the key you grabbed is the curve you want
                  
                  const reg = window._animationRegistry;
                  if (reg) {
                    this._undoTracksBeforeMove = new Map();
                    reg.tracks.forEach((tr, mId) => {
                      this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
                    });
                  }
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'transform';
                  this._keyDragStartRx = rx;
                  this._keyDragStartRy = ry;
                  this._keyDragStartTime = t;
                  
                  const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === meshId && k.type === 'transform' && k.index === i);
                  if (isPartSelection) {
                    this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
                      const tr = reg.tracks.get(k.meshId);
                      const time = k.type === 'transform' ? tr.times[k.index] : tr.shapeTimes[k.index];
                      return { ...k, time };
                    });
                  } else {
                    this._animSelectedKeysInitialTimes = null;
                    // Select only this key!
                    window._animSelectedKeys = [{ meshId, type: 'transform', index: i }];
                    window._animTransformBox = null;
                  }
                  
                  keyFound = true;
                  break;
                }
              }
            }
            // Check Shape Key Tangents in Dopesheet
            if (!keyFound && _keyShow.shape !== false && trackObj.shapeTimes && window._animShowTangents) {
              for (let i = 0; i < trackObj.shapeTimes.length; i++) {
                const t = trackObj.shapeTimes[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;

                const rightVal = trackObj.tangentOffsets ? trackObj.tangentOffsets[`${i}_right`] : undefined;
                const leftVal = trackObj.tangentOffsets ? trackObj.tangentOffsets[`${i}_left`] : undefined;
                const rightXOff = rightVal !== undefined ? rightVal : 25;
                const leftXOff = leftVal !== undefined ? leftVal : -25;

                // Check right handle
                if (i < trackObj.shapeTimes.length - 1) {
                  if (Math.abs(rx - (kx + rightXOff)) < 12 && Math.abs(ry - kyShape) < 12) {
                    this._isDraggingTangent = true;
                    this._activeTangentTrack = trackObj;
                    this._activeTangentIndex = i;
                    this._activeTangentSide = 'right';
                    this._activeTangentKx = kx;
                    this._activeTangentKy = kyShape;
                    this._activeTangentType = 'shape';
                    return;
                  }
                }

                // Check left handle
                if (i > 0) {
                  if (Math.abs(rx - (kx + leftXOff)) < 12 && Math.abs(ry - kyShape) < 12) {
                    this._isDraggingTangent = true;
                    this._activeTangentTrack = trackObj;
                    this._activeTangentIndex = i;
                    this._activeTangentSide = 'left';
                    this._activeTangentKx = kx;
                    this._activeTangentKy = kyShape;
                    this._activeTangentType = 'shape';
                    return;
                  }
                }
              }
            }

            if (!keyFound && _keyShow.shape !== false && trackObj.shapeTimes) {
              for (let i = 0; i < trackObj.shapeTimes.length; i++) {
                const t = trackObj.shapeTimes[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 12 && Math.abs(ry - kyShape) < 12) {
                  this._isDraggingKeyframe = true;
                  this._activeKeyframeTrack = trackObj;
                  this._activeMeshId = meshId;
                  this._setGraphTarget(meshId); // the key you grabbed is the curve you want
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'shape';
                  this._keyDragStartRx = rx;
                  this._keyDragStartRy = ry;
                  this._keyDragStartTime = t;

                  const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === meshId && k.type === 'shape' && k.index === i);
                  if (isPartSelection) {
                    this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
                      const tr = reg.tracks.get(k.meshId);
                      const time = k.type === 'transform' ? tr.times[k.index] : tr.shapeTimes[k.index];
                      return { ...k, time };
                    });
                  } else {
                    this._animSelectedKeysInitialTimes = null;
                    // Select only this key!
                    window._animSelectedKeys = [{ meshId, type: 'shape', index: i }];
                    window._animTransformBox = null;
                  }

                  keyFound = true;
                  break;
                }
              }
            }

            // SR frame-group markers — uniform diamonds; click jumps the playhead to
            // that frame, drag retimes it. Mirrors the cel keys above.
            if (!keyFound && window._frameGroup && this._main._meshes) {
              const grp = this._main._meshes.find(m => m.getID() === meshId && m._isFrameGroup);
              if (grp) {
                const kids = window._frameGroup.children(grp);
                const fy = ty + trackH / 2;
                for (let i = 0; i < kids.length; i++) {
                  const t = kids[i]._srFrameTime || 0;
                  const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                  if (Math.abs(rx - kx) < 12 && Math.abs(ry - fy) < 12) {
                    const cid = kids[i].getID();
                    const already = window._animSelectedKeys?.some(k => k.type === 'sr' && k.childId === cid);
                    const skey = { meshId, type: 'sr', childId: cid };
                    if (e.shiftKey) {
                      window._animSelectedKeys = window._animSelectedKeys || [];
                      if (!already) window._animSelectedKeys.push(skey);
                    } else if (!already) {
                      // Fresh single-select. Re-clicking an already-selected marker keeps the
                      // multi-selection so a drag moves all of them.
                      window._animSelectedKeys = [skey];
                      window._animTransformBox = null;
                    }
                    // Capture every selected SR marker + its start time for a group drag.
                    const selIds = new Set((window._animSelectedKeys || []).filter(k => k.type === 'sr').map(k => k.childId));
                    const items = this._main._meshes.filter(m => selIds.has(m.getID())).map(c => ({ child: c, startTime: c._srFrameTime || 0 }));
                    this._srDrag = { child: kids[i], group: grp, startRx: rx, startTime: t, moved: false, before: window._frameGroup._snapshot(), items };
                    keyFound = true;
                    break;
                  }
                }
              }
            }

          }
        });
        // Blendshape keys render below lane centre — check outside the lane-bounds gate
        if (!keyFound) {
          const bsTracks = this._dopesheetTracks();
          bsTracks.forEach(([meshId, trackObj]) => {
            if (keyFound) return;
            if (!trackObj.blendshapeTracks) return;
            const laneIdx = bsTracks.findIndex(([id]) => id === meshId);
            const ty2 = headerH + (laneIdx * trackH) - dsScroll;
            let bIdx = 0;
            TimelineHelper.bsEntries(trackObj).forEach(([name, bTrack]) => {
              if (keyFound || !bTrack.times || _keyShow.blendshape === false) { bIdx++; return; }
              const bKy = ty2 + trackH / 2 + 22 + bIdx * 18;
              for (let i = 0; i < bTrack.times.length; i++) {
                const t = bTrack.times[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 10 && Math.abs(ry - bKy) < 10) {
                  this._isDraggingKeyframe = true;
                  this._activeKeyframeTrack = bTrack;
                  this._activeMeshId = meshId;
                  this._setGraphTarget(meshId); // the key you grabbed is the curve you want
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'blendshape';
                  this._activeBlendshapeName = name;
                  this._keyDragStartRx = rx;
                  this._keyDragStartRy = ry;
                  this._keyDragStartTime = t;
                  if (window._animationRegistry) {
                    this._undoTracksBeforeMove = new Map();
                    window._animationRegistry.tracks.forEach((tr, mId) => {
                      this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr));
                    });
                  }
                  const isPartSelection = window._animSelectedKeys &&
                    window._animSelectedKeys.some(k => k.meshId === meshId && k.type === 'blendshape' && k.name === name && k.index === i);
                  if (!isPartSelection) {
                    window._animSelectedKeys = [{ meshId, type: 'blendshape', name, index: i }];
                    window._animTransformBox = null;
                  }
                  keyFound = true;
                  break;
                }
              }
              bIdx++;
            });
          });
        }

        // Shape-LAYER keys (#34): sub-rows below the blendshape rows — same layout maths as
        // drawDopeSheet. Selectable/movable/deletable like base shape keys, with shift-click
        // to accumulate a cross-layer multi-selection.
        if (!keyFound && _keyShow.shape !== false) {
          tracks.forEach(([meshId, trackObj], laneIdx) => {
            if (keyFound || !trackObj.shapeLayers || !trackObj.shapeLayers.length) return;
            const ty2 = headerH + (laneIdx * trackH) - dsScroll;
            const bsCount = trackObj.blendshapeTracks ? trackObj.blendshapeTracks.size : 0;
            for (let li = 0; li < trackObj.shapeLayers.length; li++) {
              const L = trackObj.shapeLayers[li];
              if (!L.shapeTimes) continue;
              const rowY = ty2 + trackH / 2 + 22 + (bsCount + li) * 18;
              for (let i = 0; i < L.shapeTimes.length; i++) {
                const t = L.shapeTimes[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 8 && Math.abs(ry - rowY) < 8) {
                  this._isDraggingKeyframe = true;
                  this._activeKeyframeTrack = trackObj;
                  this._activeMeshId = meshId;
                  this._setGraphTarget(meshId); // the key you grabbed is the curve you want
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'shapeLayer';
                  this._activeKeyframeLayer = li;
                  this._keyDragStartRx = rx;
                  this._keyDragStartRy = ry;
                  this._keyDragStartTime = t;
                  if (reg) {
                    this._undoTracksBeforeMove = new Map();
                    reg.tracks.forEach((tr, mId) => this._undoTracksBeforeMove.set(mId, TimelineHelper.cloneTrack(tr)));
                  }
                  const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(
                    k => k.meshId === meshId && k.type === 'shapeLayer' && k.layer === li && k.index === i);
                  if (e.shiftKey && !isPartSelection) {
                    // Shift-click: add this key to the running cross-layer selection.
                    window._animSelectedKeys = window._animSelectedKeys || [];
                    window._animSelectedKeys.push({ meshId, type: 'shapeLayer', layer: li, index: i });
                  } else if (!isPartSelection) {
                    window._animSelectedKeys = [{ meshId, type: 'shapeLayer', layer: li, index: i }];
                    window._animTransformBox = null;
                  }
                  // Capture times for every selected key so a drag moves the whole group rigidly.
                  this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
                    const tr = reg.tracks.get(k.meshId);
                    return { ...k, time: this._keyTimeOf(tr, k) };
                  });
                  // Refresh the transform box for a multi-selection (shift-click across
                  // non-contiguous layers can't be done with a marquee).
                  this._recomputeTransformBox();
                  keyFound = true;
                  break;
                }
              }
              if (keyFound) break;
            }
          });
        }

        if (keyFound) {
          if (window._tlTrace) console.log('[tl] -> KEY TAKEN, dragging');
          return;
        }
      }

      // Falling through to a marquee IS the failure the user reports as "it will not select":
      // the click was in the lane, near the key, and nothing claimed it.
      if (window._tlTrace) console.log('[tl] -> no key claimed the click; starting a marquee');
      this._isDraggingMarquee = true;
      this._marqueeStart = { x: rx, y: ry };
      this._marqueeEnd = { x: rx, y: ry };
    }
  }

  // Read a key's current time from its track, for any dopesheet key type. Shared by the
  // layer-key drag capture and reindex paths.
  _keyTimeOf(tr, k) {
    if (!tr) return 0;
    // Through xfTimes, because the weight channel keeps its own times -- reading a weight key
    // out of `tr.times` returns whatever transform key sits at that index.
    if (k.type === 'transform') return xfTimes(tr, k.group)?.[k.index] ?? 0;
    if (k.type === 'shape') return tr.shapeTimes?.[k.index] ?? 0;
    if (k.type === 'shapeLayer') return tr.shapeLayers?.[k.layer]?.shapeTimes?.[k.index] ?? 0;
    if (k.type === 'blendshape' && k.name) return tr.blendshapeTracks?.get(k.name)?.times?.[k.index] ?? 0;
    return 0;
  }

  // Fit window._animTransformBox to the current key selection's time span (2+ keys), or
  // clear it. Editable dopesheet key types only (SR frames retime via their own drag).
  _recomputeTransformBox() {
    const reg = window._animationRegistry;
    const sel = window._animSelectedKeys;
    if (!reg || !sel || sel.length < 2) { window._animTransformBox = null; return; }
    let minT = Infinity, maxT = -Infinity;
    sel.forEach(k => {
      if (k.type === 'sr') return;
      const t = this._keyTimeOf(reg.tracks.get(k.meshId), k);
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    });
    window._animTransformBox = (minT !== Infinity) ? { startTime: minT, endTime: maxT } : null;
  }

  onMouseMove(e) {
    // Shape-layer multiselect drag-through (#34): paint the same select/deselect state onto
    // each layer row the cursor passes over (same mesh).
    if (this._layerDotDrag) {
      const rect = this._canvas.getBoundingClientRect();
      const hit = this._shapeLayerRowAt(e.clientY - rect.top);
      if (hit && hit.meshId === this._layerDotDrag.meshId) {
        if (this._layerDotDrag.setTo) this._selShapeLayerIdxs.add(hit.li);
        else this._selShapeLayerIdxs.delete(hit.li);
        this.draw();
      }
      return;
    }

    // SR frame marker drag → retime the grabbed frame AND every other selected marker
    // by the same delta (live; sort + vis rebuild happen on release).
    if (this._srDrag) {
      const rect = this._canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const tlX = 200, tlW = this._cssWidth - 200;
      const loopStart = this._viewStart ?? 0;
      const visibleDuration = this._viewDuration ?? 1;
      let t = loopStart + ((rx - tlX) / tlW) * visibleDuration;
      t = Math.max(0, t);
      if (window._animSnapToFrame !== false) { const fps = window._animFPS || 24; t = Math.round(t * fps) / fps; }
      if (Math.abs(rx - this._srDrag.startRx) > 3) this._srDrag.moved = true;
      if (this._srDrag.moved) {
        const dt = t - this._srDrag.startTime;
        this._srDrag.items.forEach(it => { it.child._srFrameTime = Math.max(0, it.startTime + dt); });
      }
      this.draw();
      return;
    }

    // [Step 1] 2-finger touch scroll — update stored position and compute pan/zoom.
    if (e.pointerType === 'touch' && this._touchMap.has(e.pointerId)) {
      this._touchMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._isTouchScrolling && this._touchMap.size === 2) {
        const cur = this._getTouchCentroidAndDist();
        const prev = this._touchScrollPrev;
        this._ensureViewInit();
        const tlX = 200;
        const tlW = this._cssWidth - tlX;
        // Pan: centroid delta → time/value shift.
        const secsPerPx = this._viewDuration / tlW;
        this._viewStart -= (cur.cx - prev.cx) * secsPerPx;
        if (this._mode === 'graph') {
          this._panY -= (cur.cy - prev.cy);
        }
        // Zoom: distance ratio → scale time axis around centroid.
        if (prev.dist > 1) {
          const pivotT = this._viewStart + ((prev.cx - tlX) / tlW) * this._viewDuration;
          const factor = prev.dist / cur.dist;
          const newDuration = Math.max(0.01, this._viewDuration * factor);
          this._viewStart = pivotT - (pivotT - this._viewStart) * (newDuration / this._viewDuration);
          this._viewDuration = newDuration;
        }
        this._touchScrollPrev = cur;
        this.draw();
        return;
      }
    }

    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    this._lastMouseX = rx;
    this._lastMouseY = ry;

    // Update toolbar tooltip.
    if (this._tooltip && ry >= 5 && ry <= TOOLBAR_BOTTOM) {
      const hovered = this._toolbarBtnDefs().find(b => rx >= b.x && rx <= b.x + b.w
        && ry >= b.y && ry <= b.y + b.h);
      if (hovered?.tooltip) {
        this._tooltip.textContent = hovered.tooltip;
        this._tooltip.style.left = (hovered.x + hovered.w / 2) + 'px';
        this._tooltip.style.display = 'block';
      } else {
        this._tooltip.style.display = 'none';
      }
    } else if (this._tooltip) {
      this._tooltip.style.display = 'none';
    }

    if (ry < 5 && !this._isDraggingKeyframe && !this._isDraggingTangent && !this._isPanningGraph && !this._isZoomingGraph) {
      this._canvas.style.cursor = 'ns-resize';
    } else {
      this._canvas.style.cursor = 'default';
    }

    if (this._isResizingPanel) {
      const dy = e.clientY - this._resizeStartScreenY;
      const newHeight = Math.max(100, this._resizeStartHeight - dy);
      this._container.style.height = newHeight + 'px';
      this.onResize();
      return;
    }

    const tlX = 200;
    const tlW = this._cssWidth - 200;
    
    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDurationReal = Math.max(0.1, loopEndReal - loopStartReal);

    if (this._viewDuration === undefined) {
      this._viewStart = loopStartReal;
      this._viewDuration = visibleDurationReal;
    }

    const loopStart = this._viewStart;
    const visibleDuration = this._viewDuration;

    if (this._isPanningGraphXY) {
      const rect = this._canvas.getBoundingClientRect();
      const curRx = e.clientX - rect.left;
      const curRy = e.clientY - rect.top;
      const dx = curRx - this._panXYStartRx;
      const dy = curRy - this._panXYStartRy;
      const tlW = Math.max(1, this._cssWidth - 200);
      const secsPerPx = this._viewDuration / tlW;
      this._viewStart = this._panXYStartViewStart - dx * secsPerPx;
      this._panY = this._panXYStartPanY - dy;
      this.draw();
      return;
    }

    if (this._isPanningDope) {
      const rect = this._canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      const dy = ry - this._panStartRy;
      this._dopeScrollY = Math.max(0, Math.min(this._dopeMaxScroll || 0, this._panStartDopeScroll - dy));
      const tlW = this._cssWidth - 200;
      const secsPerPx = (this._viewDuration || 1) / tlW;
      this._viewStart = this._panStartViewStart - (rx - this._panStartRx) * secsPerPx;
      this.draw();
      return;
    }

    if (this._isPanningGraph) {
      const rect = this._canvas.getBoundingClientRect();
      const ry = e.clientY - rect.top;
      const dy = ry - this._panStartRy;
      this._panY = this._panStartOffsetY - dy;
      this.draw();
      return;
    } else if (this._isZoomingGraph) {
      const rect = this._canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      
      const dx = rx - this._zoomStartRx;
      const dy = ry - this._zoomStartRy;
      
      // Vertical Zoom (Y)
      const factorY = Math.pow(1.01, -dy);
      const newZoomY = this._zoomStartScaleY * factorY;
      
      // Update panY to keep pivot value fixed!
      this._panY = this._zoomStartPanY + this._zoomPivotValue * (this._zoomStartScaleY - newZoomY);
      this._zoomY = newZoomY;

      // Horizontal Zoom (X)
      const factorX = Math.pow(1.01, dx);
      const newDuration = Math.max(0.1, this._zoomStartDuration / factorX);
      
      // Update viewStart to keep pivot time fixed!
      this._viewStart = this._zoomPivotTime - (this._zoomPivotTime - this._zoomStartViewStart) * (newDuration / this._zoomStartDuration);
      this._viewDuration = newDuration;
      
      this.draw();
      return;
    }

    if (this._isDraggingGutter) {
      const dy = ry - this._gutterDragStartY;
      this._gutterScrollY = Math.max(0, Math.min(this._gutterMaxScroll, this._gutterDragStartScroll + dy));
      this.draw();
      return;
    }

    // Blendshape scrub — horizontal drag on channel label ('name' zone only; eye drags do nothing)
    if (this._bsScrubName && this._bsScrubMesh) {
      const dx = rx - this._bsScrubStartX;
      if (!this._bsScrubActive && Math.abs(dx) > 4) this._bsScrubActive = true;
      if (this._bsScrubActive && this._bsScrubZone === 'name') {
        // 200px = full 0→1 range; drag slowly for fine control
        const newW = Math.max(0, Math.min(1, this._bsScrubStartWeight + dx / 200));
        window._animationRegistry?.setBlendshapeWeight(this._bsScrubMesh, this._bsScrubName, newW);
        this.draw();
      }
      return;
    }

    if (this._isDraggingPlayhead) {
      if (this._mode === 'graph') {
        const rect = this._canvas.getBoundingClientRect();
        const rx = e.clientX - rect.left;
        const tlX = 200;
        const tlW = this._cssWidth - 200;
        
        let t = (rx - tlX) / tlW;
        t = Math.max(0, Math.min(1, t));
        const fps = window._animFPS || 24;
        const targetTime = Math.round((this._viewStart + t * this._viewDuration) * fps) / fps;

        window._animPlaying = false;
        window._animCurrentTime = targetTime;
        if (window._animationRegistry) {
          window._animationRegistry.globalPlaybackTime = targetTime;
          
          if (this._main && this._main._meshes) {
            this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
          }
          if (this._main.render) this._main.render();
        }
        
        this.draw();
        return;
      }
      this.handleInteraction(e);
    } else if (this._isDraggingKeyframe) {
      // [Step Bug3] Use the same view window as draw() — loopStart/visibleDuration
      // already resolved above via _viewStart/_viewDuration.
      const loopStart = this._viewStart;
      const visibleDuration = this._viewDuration;

      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));
      const targetTime = loopStart + t * visibleDuration;

      let dt = targetTime - this._keyDragStartTime;
      // Sticky graph drag: favour the dominant axis until the pointer has travelled
      // at least 10px on BOTH axes. At that point the gesture deliberately becomes free.
      const dragDX = rx - this._keyDragStartRx;
      const dragDY = ry - this._keyDragStartRy;
      const freeDrag = Math.abs(dragDX) >= KEY_DRAG_FREE_THRESHOLD
        && Math.abs(dragDY) >= KEY_DRAG_FREE_THRESHOLD;
      const dragAxis = this._mode !== 'graph' || freeDrag ? 'free'
        : (Math.abs(dragDX) >= Math.abs(dragDY) ? 'time' : 'value');
      if (dragAxis === 'value') dt = 0;

      if (dragAxis !== 'value' && window._animSnapToFrame !== false) {
        const fps = window._animFPS || 24;
        // Snap the GRABBED key's resulting time to a whole frame (not the raw
        // delta) — a key at 6.2 moves to 7.0, not 7.2. Other selected keys shift
        // rigidly by the same dt so their relative spacing is preserved.
        // grabbedBase = the time moveKeys uses as the grabbed key's origin:
        // its exact initial time when a multi-selection snapshot exists, else
        // the drag-start time (which is also moveKeys' base for a lone key).
        let grabbedBase = this._keyDragStartTime;
        const inits = this._animSelectedKeysInitialTimes;
        if (inits && inits.length) {
          const g = inits.find(k =>
            k.type === this._activeKeyframeType &&
            k.index === this._activeKeyframeIndex &&
            (this._activeKeyframeType !== 'transform' || k.channel === this._activeKeyframeChannel) &&
            (this._activeKeyframeType !== 'shapeLayer' || k.layer === this._activeKeyframeLayer) &&
            (this._activeKeyframeType !== 'blendshape' || k.name === this._activeBlendshapeName));
          if (g && g.time !== undefined) grabbedBase = g.time;
        }
        dt = (Math.round((grabbedBase + dt) * fps) / fps) - grabbedBase;
      }
      
      if (window._animationRegistry) {
        if (this._mode === 'graph') {
          const targetVal = this.yToValue(ry);
          const dVal = dragAxis === 'time' ? 0 : targetVal - this._keyDragStartVal;
          
          const keysToMove = this._animSelectedKeysInitialTimes || [{
            meshId: this._activeMeshId,
            type: this._activeKeyframeType,
            index: this._activeKeyframeIndex,
            name: this._activeBlendshapeName,
            time: this._keyDragStartTime,
            channel: this._activeKeyframeChannel,
            startVal: this._keyDragStartVal
          }];

          TimelineHelper.moveKeys(window._animationRegistry, keysToMove, dt, dVal, mDurVal, this._main);
          if (this._main.render) this._main.render();
        } else {
          const keysToMove = this._animSelectedKeysInitialTimes || [{
            meshId: this._activeMeshId,
            type: this._activeKeyframeType,
            index: this._activeKeyframeIndex,
            name: this._activeBlendshapeName,
            time: this._keyDragStartTime
          }];

          TimelineHelper.moveKeys(window._animationRegistry, keysToMove, dt, undefined, mDurVal, this._main);
        }
      }
      
      this.draw();
    } else if (this._isDraggingTangent) {
      const activeTangent = {
        kx: this._activeTangentKx,
        ky: this._activeTangentKy,
        side: this._activeTangentSide,
        type: this._activeTangentType,
        index: this._activeTangentIndex
      };
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
      
      TimelineHelper.updateTangent(this._activeTangentTrack, activeTangent, rx, ry, tlW, visibleDuration, this._zoomY, singleSelected);
      
      this.draw();
    } else if (this._activeTransformHandle === 'top' || this._activeTransformHandle === 'bottom') {
      const rect = this._canvas.getBoundingClientRect();
      const ry = e.clientY - rect.top;
      
      const targetVal = this.yToValue(ry);
      const initialBox = this._animTransformInitialBox;
      
      const activeMesh = this._graphMesh();
      if (activeMesh && window._animationRegistry && this._animTransformBoxInitialKeys) {
        const id = activeMesh.getID();
        const track = window._animationRegistry.tracks.get(id);
        if (track) {
          TimelineHelper.scaleKeysVertical(track, this._animTransformBoxInitialKeys, initialBox,
            targetVal, this._activeTransformHandle, window._animTransformBox,
            (v, g) => this._rawVal(v, g));
          
          if (this._main && this._main._meshes) {
            this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
          }
          if (this._main.render) this._main.render();
        }
      }
      this.draw();
      return;
    } else if (this._activeTransformHandle) {
      const rect = this._canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;

      const tlX = 200;
      const tlW = this._cssWidth - 200;

      const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
      // Use the SAME time→x mapping as the hit-test and draw (the graph view
      // window, not the raw loop range) — otherwise, after any zoom/pan, the
      // horizontal (left/right) and center moves compute against the wrong scale
      // and appear not to work, while top/bottom (value-based) still do.
      this._ensureViewInit();
      const loopStart = this._viewStart;
      const visibleDuration = this._viewDuration;

      const vDur = visibleDuration;

      // Helpers — write time/value back to the correct array for any key type.
      const _setKeyTime = (track, initKey, newTime) => {
        let t = Math.max(0, newTime);
        // Respect snap-to-integer for the WHOLE transform box (edge/center/scale) —
        // the single-key drag already snapped, the box math didn't.
        if (window._animSnapToFrame !== false) { const fps = window._animFPS || 24; t = Math.round(t * fps) / fps; }
        const _times = initKey.type === 'transform' ? xfTimes(track, initKey.group) : null;
        if (_times) {
          _times[initKey.index] = t;
        } else if (initKey.type === 'shape' && track.shapeTimes) {
          track.shapeTimes[initKey.index] = t;
        } else if (initKey.type === 'shapeLayer') {
          const st = track.shapeLayers?.[initKey.layer]?.shapeTimes;
          if (st) st[initKey.index] = t;
        } else if (initKey.type === 'blendshape') {
          const bt = track.blendshapeTracks?.get(initKey.name);
          if (bt?.times) bt.times[initKey.index] = t;
        }
        window._animationRegistry?._extendDurationForTime?.(t);
      };
      // THE KEY'S OWN GROUP, and back out of display space.
      //
      // This wrote `xfWrite(track, index, channel, newVal)` with no group, so every key landed
      // in whichever group was ACTIVE -- with T and R both showing and R active, translation
      // keys were written into rotation and the translation curves never moved at all. matt:
      // "still ignoring curves when i scale vertically with the toolbox." A second vertical
      // path, separate from scaleKeysVertical, which is why fixing that one changed nothing
      // here. `track.positions` was also required, which is false for a weight key.
      const _setKeyVal = (track, initKey, newVal) => {
        if (initKey.type === 'transform' && initKey.channel !== undefined) {
          xfWrite(track, initKey.index, initKey.channel,
                  this._rawVal(newVal, initKey.group), initKey.group);
        } else if (initKey.type === 'shape' && track.shapeOutputTimes) {
          track.shapeOutputTimes[initKey.index] = newVal;
        } else if (initKey.type === 'blendshape') {
          const bt = track.blendshapeTracks?.get(initKey.name);
          // No 0..1 clamp — overshoot is intentionally allowed.
          if (bt?.values) bt.values[initKey.index] = newVal;
        }
      };
      
      const tBox = window._animTransformBox;
      const initBox = this._animTransformInitialBox;

      if (tBox && initBox) {
        const dx = rx - this._transformStartRx;
        const dt = (dx / tlW) * vDur;
        
        const baseDur = initBox.endTime - initBox.startTime;
        
        if (this._activeTransformHandle === 'left') {
          const newStartTime = Math.max(0, initBox.startTime + dt);
          tBox.startTime = newStartTime;
          const newDur = initBox.endTime - newStartTime;
          const scaleFactor = baseDur > 0.001 ? (newDur / baseDur) : 1;
          
          if (this._animTransformBoxInitialKeys) {
            this._animTransformBoxInitialKeys.forEach((initKey) => {
              const track = window._animationRegistry.tracks.get(initKey.meshId);
              if (!track) return;
              const relTime = initKey.time - initBox.endTime;
              _setKeyTime(track, initKey, initBox.endTime + relTime * scaleFactor);
            });
          }
        } else if (this._activeTransformHandle === 'right') {
          const newEndTime = initBox.endTime + dt;
          tBox.endTime = newEndTime;

          const newDur = newEndTime - initBox.startTime;
          const scaleFactor = baseDur > 0.001 ? (newDur / baseDur) : 1;

          if (this._animTransformBoxInitialKeys) {
            this._animTransformBoxInitialKeys.forEach(initKey => {
              const track = window._animationRegistry.tracks.get(initKey.meshId);
              if (!track) return;
              const relTime = initKey.time - initBox.startTime;
              _setKeyTime(track, initKey, initBox.startTime + relTime * scaleFactor);
            });
          }
        } else if (this._activeTransformHandle === 'scale_center') {
          const initMid  = (initBox.startTime + initBox.endTime) / 2;
          const initMidV = (initBox.minV !== undefined && initBox.maxV !== undefined) ? (initBox.minV + initBox.maxV) / 2 : 0;

          const dx = rx - this._transformStartRx;
          const dy = ry - this._transformStartRy;

          if (!this._scaleCenterLock) {
            if (Math.abs(dy) > 10) {
              this._scaleCenterLock = 'vertical';
            } else if (Math.abs(dx) > 10 || this._mode === 'dope') {
              this._scaleCenterLock = 'horizontal';
            }
          }

          if (this._scaleCenterLock === 'horizontal') {
            const scaleFactor = 1.0 + dx / 150.0;
            tBox.startTime = initMid - (initMid - initBox.startTime) * scaleFactor;
            tBox.endTime   = initMid + (initBox.endTime - initMid)   * scaleFactor;

            if (this._animTransformBoxInitialKeys) {
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (!track) return;
                const relTime = initKey.time - initMid;
                _setKeyTime(track, initKey, initMid + relTime * scaleFactor);
              });
            }
          } else if (this._scaleCenterLock === 'vertical' && initBox.minV !== undefined) {
            const scaleFactorY = 1.0 - dy / 150.0;

            if (this._animTransformBoxInitialKeys) {
              // ONE midpoint, shared by every key -- the box's own centre. Scaling a mixed
              // selection onto a single line is the gesture ("scale all the keys to their
              // midpoint, then move them all to zero"), and per-group midpoints make it
              // impossible: each group collapses onto its own line instead.
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (!track) return;
                const relVal = initKey.val - initMidV;
                _setKeyVal(track, initKey, initMidV + relVal * scaleFactorY);
              });
            }
          }
        } else if (this._activeTransformHandle === 'center') {
          const dtClamped = Math.max(-initBox.startTime, dt);
          tBox.startTime = initBox.startTime + dtClamped;
          tBox.endTime   = initBox.endTime   + dtClamped;

          if (this._animTransformBoxInitialKeys) {
            this._animTransformBoxInitialKeys.forEach(initKey => {
              const track = window._animationRegistry.tracks.get(initKey.meshId);
              if (!track) return;
              _setKeyTime(track, initKey, initKey.time + dtClamped);
            });

            if (this._mode === 'graph' && this._keyDragStartVal !== undefined) {
              const targetVal = this.yToValue(this._lastMouseY);
              const dVal = targetVal - this._keyDragStartVal;

              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (!track) return;
                _setKeyVal(track, initKey, (initKey.val !== undefined ? initKey.val : 0) + dVal);
              });
            }
          }
          
          if (this._main && this._main._meshes) {
            this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
          }
          if (this._main.render) this._main.render();
        }
      }
      this.draw();
    } else if (this._isDraggingMarquee) {
      const rect = this._canvas.getBoundingClientRect();
      this._marqueeEnd = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.draw();
    }

    // Curve hover highlight (graph mode, idle) — shows which curve a click selects.
    const _idle = !this._isDraggingKeyframe && !this._isDraggingMarquee && !this._isDraggingTangent
               && !this._isPanningGraph && !this._isPanningGraphXY && !this._isZoomingGraph
               && !this._activeTransformHandle && !this._isDraggingGutter && !this._isDraggingPlayhead;
    this._hoverCurve = (this._mode === 'graph' && _idle) ? this._hitTestCurve(rx, ry) : null;

    if (rx >= tlX && rx <= tlX + tlW && ry >= HEADER_H) {
      this.draw();
    }
  }

  // MOUSE-UP MUST ALWAYS RELEASE, whatever happens inside it.
  //
  // A throw in here leaves every drag flag set — _isDraggingMarquee, _isDraggingKeyframe, the
  // playhead — because nothing clears them on the way out. The pointer is then held down
  // forever from the UI's point of view: the marquee never closes, the key never drops, the
  // playhead follows the cursor. That is a dead timeline, and in a headset there is no easy way
  // back from it.
  //
  // Defensive, and deliberately so: this is not a hypothetical. A ReferenceError in
  // finalizeMarquee produced exactly that stuck state, and the error itself was the easy half
  // to fix. _cancelActiveAction already exists and clears the lot.
  onMouseUp(e) {
    try {
      this._onMouseUpBody(e);
    } catch (err) {
      console.error('[TL] mouse-up failed; releasing the drag so the timeline stays usable:', err);
      this._cancelActiveAction();
      try { this.draw(); } catch (_) { /* a failed repaint must not re-trap the pointer */ }
    }
  }

  _onMouseUpBody(e) {
    // SR frame marker release: no-move = click → jump playhead to that frame; moved =
    // retime → sort children + rebuild the flipbook vis, as one undo step.
    if (this._srDrag) {
      const d = this._srDrag;
      this._srDrag = null;
      const fg = window._frameGroup;
      if (!d.moved) {
        // Click (no drag) = select only (already done on mousedown). No playhead jump.
        this.draw();
      } else if (fg) {
        fg._rebuildVis(d.group);
        fg._refreshOutliner?.();
        const after = fg._snapshot();
        const sm = this._main.getStateManager && this._main.getStateManager();
        if (sm && sm.pushStateCustom) {
          sm.pushStateCustom(() => fg._restore(d.before), () => fg._restore(after), false, 'SR retime frame');
        }
        this.draw();
      }
      return;
    }

    // [Step 1] 2-finger touch scroll cleanup.
    if (e.pointerType === 'touch') {
      this._touchMap.delete(e.pointerId);
      if (this._touchMap.size < 2) {
        this._isTouchScrolling = false;
        this._touchScrollPrev = null;
      }
      if (this._isTouchScrolling) return; // still scrolling with remaining finger
    }

    // Blendshape scrub finalize
    if (this._bsScrubName) {
      const _zone = this._bsScrubZone;
      if (_zone === 'eye') {
        // Eye icon: click (no drag) → toggle visibility; drag → nothing.
        if (!this._bsScrubActive) {
          if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
          window._animBsChannelVisible[this._bsScrubName] =
            window._animBsChannelVisible[this._bsScrubName] === false ? true : false;
          this.draw();
        }
      } else if (_zone === 'name') {
        // Channel label: drag → commit scrub with undo; click (no drag) → nothing.
        if (this._bsScrubActive) {
          const _bsName     = this._bsScrubName;
          const _meshId     = this._bsScrubMesh?.getID?.();
          const _snapBefore = this._bsScrubSnapBefore;
          const reg = window._animationRegistry;
          if (reg && _meshId !== undefined && _snapBefore && window.app?.getStateManager?.()) {
            const track = reg.tracks.get(_meshId);
            const bTrack = track?.blendshapeTracks?.get(_bsName);
            if (bTrack) {
              const _snapAfter = { times: bTrack.times.slice(), values: bTrack.values.slice() };
              window.app.getStateManager().pushStateCustom(
                () => { // UNDO
                  const tr = reg.tracks.get(_meshId);
                  const bt = tr?.blendshapeTracks?.get(_bsName);
                  if (bt) { bt.times = _snapBefore.times.slice(); bt.values = _snapBefore.values.slice(); }
                  const msh = window.app?.getMesh?.();
                  if (msh?.getID?.() === _meshId) reg.applyBlendshapes(msh);
                  if (window.app?.render) window.app.render();
                },
                () => { // REDO
                  const tr = reg.tracks.get(_meshId);
                  const bt = tr?.blendshapeTracks?.get(_bsName);
                  if (bt) { bt.times = _snapAfter.times.slice(); bt.values = _snapAfter.values.slice(); }
                  const msh = window.app?.getMesh?.();
                  if (msh?.getID?.() === _meshId) reg.applyBlendshapes(msh);
                  if (window.app?.render) window.app.render();
                },
                false,
                'Blendshape Scrub'
              );
            }
          }
        }
      }
      this._bsScrubName        = null;
      this._bsScrubMesh        = null;
      this._bsScrubZone        = null;
      this._bsScrubActive      = false;
      this._bsScrubSnapBefore  = null;
      return;
    }

    // Clear XY pan state
    if (this._isPanningGraphXY) {
      this._isPanningGraphXY = false;
      return;
    }

    if (this._isDraggingMarquee) {
      this.finalizeMarquee(e);
    } else if (this._isDraggingKeyframe) {
      const reg = window._animationRegistry;
      if (reg) {
        const selectedKeysWithTimes = window._animSelectedKeys ? window._animSelectedKeys.map(key => {
          const track = reg.tracks.get(key.meshId);
          if (!track) return { ...key, time: 0 };
          return { ...key, time: this._keyTimeOf(track, key) };
        }) : [];

        reg.tracks.forEach((track) => reg.sortTrack(track));

        if (window._animSelectedKeys) {
          window._animSelectedKeys = selectedKeysWithTimes.map(key => {
            const track = reg.tracks.get(key.meshId);
            if (!track) return key;

            if (key.type === 'blendshape' && key.name) {
              const bTrack = track.blendshapeTracks?.get(key.name);
              if (!bTrack) return { ...key, index: -1 };
              const newIdx = bTrack.times.findIndex(t => Math.abs(t - key.time) < 0.005);
              return { ...key, index: newIdx };
            }

            const times = key.type === 'transform' ? track.times
                        : key.type === 'shapeLayer' ? track.shapeLayers?.[key.layer]?.shapeTimes
                        : track.shapeTimes;
            if (!times) return key;
            let newIdx = -1;
            for (let i = 0; i < times.length; i++) {
              if (Math.abs(times[i] - key.time) < 0.005) { newIdx = i; break; }
            }
            return { ...key, index: newIdx };
          }).filter(k => k.index !== -1);
        }

        if (this._undoTracksBeforeMove) {
          const beforeState = this._undoTracksBeforeMove;
          const afterState = new Map();
          reg.tracks.forEach((track, meshId) => {
            afterState.set(meshId, TimelineHelper.cloneTrack(track));
          });
          
          const cbUndo = () => {
            beforeState.forEach((track, meshId) => {
              reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
            });
            this._main.render();
            this.draw();
          };
          
          const cbRedo = () => {
            afterState.forEach((track, meshId) => {
              reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
            });
            this._main.render();
            this.draw();
          };
          
          this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, 'graph editor multikeys move');
          this._undoTracksBeforeMove = null;
        }

      }
      this._isDraggingKeyframe = false;
      this._activeKeyframeTrack = null;
      this._activeKeyframeIndex = undefined;
      this._activeKeyframeType = null;
      this._animSelectedKeysInitialTimes = null;
    } else if (this._isDraggingTangent) {
      this._isDraggingTangent = false;
      this._activeTangentTrack = null;
      this._activeTangentIndex = undefined;
      this._activeTangentSide = null;
      this._activeTangentKx = 0;
    } else if (this._activeTransformHandle) {
      const reg = window._animationRegistry;
      if (reg) {
        // 1. Capture times for index update later
        const selectedKeysWithTimes = window._animSelectedKeys ? window._animSelectedKeys.map(key => {
          const track = reg.tracks.get(key.meshId);
          return { ...key, time: this._keyTimeOf(track, key) };
        }) : [];

        // 2. Calculate commands for undo/redo
        const commands = [];
        if (this._animTransformBoxInitialTimes) {
          this._animTransformBoxInitialTimes.forEach(initKey => {
            const track = reg.tracks.get(initKey.meshId);
            if (!track) return;

            let curTime = undefined;
            if (initKey.type === 'transform' && track.times) {
              curTime = track.times[initKey.index];
            } else if (initKey.type === 'shape' && track.shapeTimes) {
              curTime = track.shapeTimes[initKey.index];
            } else if (initKey.type === 'shapeLayer') {
              curTime = track.shapeLayers?.[initKey.layer]?.shapeTimes?.[initKey.index];
            }

            if (curTime !== undefined && Math.abs(curTime - initKey.time) > 0.001) {
              commands.push({
                meshId: initKey.meshId,
                type: initKey.type,
                layer: initKey.layer,
                oldTime: initKey.time,
                newTime: curTime,
                oldPos: track.positions ? track.positions.slice(initKey.index * 3, initKey.index * 3 + 3) : null,
                oldQuat: track.quaternions ? track.quaternions.slice(initKey.index * 4, initKey.index * 4 + 4) : null,
                oldScale: track.scales ? track.scales.slice(initKey.index * 3, initKey.index * 3 + 3) : null
              });
            }
          });
        }

        // 3. Push custom state to StateManager
        if (commands.length > 0 && this._main && this._main.getStateManager()) {
          this._main.getStateManager().pushStateCustom(
            () => { // UNDO
              commands.forEach(cmd => {
                const tr = reg.tracks.get(cmd.meshId);
                if (!tr) return;
                const times = cmd.type === 'transform' ? tr.times
                            : cmd.type === 'shapeLayer' ? tr.shapeLayers?.[cmd.layer]?.shapeTimes
                            : tr.shapeTimes;
                if (!times) return;

                let idx = -1;
                for (let i = 0; i < times.length; i++) {
                  if (Math.abs(times[i] - cmd.newTime) < 0.005) {
                    idx = i;
                    break;
                  }
                }
                if (idx !== -1) {
                  times[idx] = cmd.oldTime;
                  if (cmd.type === 'transform' && tr.positions && cmd.oldPos) {
                    tr.positions.splice(idx * 3, 3, ...cmd.oldPos);
                    tr.quaternions.splice(idx * 4, 4, ...cmd.oldQuat);
                    tr.scales.splice(idx * 3, 3, ...cmd.oldScale);
                  }
                }
              });
              const affectedTrackIds = new Set(commands.map(c => c.meshId));
              affectedTrackIds.forEach(id => {
                const tr = reg.tracks.get(id);
                if (tr) reg.sortTrack(tr);
              });
              if (this._main && this._main._meshes) {
                this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
              }
              this.draw();
            },
            () => { // REDO
              commands.forEach(cmd => {
                const tr = reg.tracks.get(cmd.meshId);
                if (!tr) return;
                const times = cmd.type === 'transform' ? tr.times
                            : cmd.type === 'shapeLayer' ? tr.shapeLayers?.[cmd.layer]?.shapeTimes
                            : tr.shapeTimes;
                if (!times) return;

                let idx = -1;
                for (let i = 0; i < times.length; i++) {
                  if (Math.abs(times[i] - cmd.oldTime) < 0.005) {
                    idx = i;
                    break;
                  }
                }
                if (idx !== -1) {
                  times[idx] = cmd.newTime;
                }
              });
              const affectedTrackIds = new Set(commands.map(c => c.meshId));
              affectedTrackIds.forEach(id => {
                const tr = reg.tracks.get(id);
                if (tr) reg.sortTrack(tr);
              });
              if (this._main && this._main._meshes) {
                this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
              }
              this.draw();
            },
            false,
            "Transform Box Edit"
          );
        }

        // 4. Sort tracks
        reg.tracks.forEach((track, meshId) => {
          reg.sortTrack(track);
        });

        // 5. Update indices after sorting
        if (window._animSelectedKeys) {
          window._animSelectedKeys = selectedKeysWithTimes.map(key => {
            const track = reg.tracks.get(key.meshId);
            if (!track) return key;
            let times;
            if (key.type === 'transform') times = track.times;
            else if (key.type === 'shape')  times = track.shapeTimes;
            else if (key.type === 'shapeLayer') times = track.shapeLayers?.[key.layer]?.shapeTimes;
            else if (key.type === 'blendshape') times = track.blendshapeTracks?.get(key.name)?.times;
            if (!times) return key;

            let newIdx = -1;
            for (let i = 0; i < times.length; i++) {
              if (Math.abs(times[i] - key.time) < 0.005) {
                newIdx = i;
                break;
              }
            }
            return { ...key, index: newIdx };
          }).filter(k => k.index !== -1);
        }
      }
      // Normalize transform box if scaled negative
      const tBox = window._animTransformBox;
      if (tBox && tBox.startTime > tBox.endTime) {
        const tmp = tBox.startTime;
        tBox.startTime = tBox.endTime;
        tBox.endTime = tmp;
      }

      // Push undo state for Transform Box!
      if (reg && this._undoTracksBeforeMove) {
        const beforeState = this._undoTracksBeforeMove;
        const afterState = new Map();
        reg.tracks.forEach((track, meshId) => {
          afterState.set(meshId, TimelineHelper.cloneTrack(track));
        });
        
        const cbUndo = () => {
          beforeState.forEach((track, meshId) => {
            reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
          });
          this._main.render();
          this.draw();
        };
        
        const cbRedo = () => {
          afterState.forEach((track, meshId) => {
            reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
          });
          this._main.render();
          this.draw();
        };
        
        this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, 'graph editor transform box');
        this._undoTracksBeforeMove = null;
      }

      this._activeTransformHandle = null;
      this._animTransformInitialBox = null;
      this._animTransformBoxInitialTimes = null;
    }
    this._isDraggingTangent = false;
    this._activeTangentTrack = null;
    this._activeTangentIndex = undefined;
    this._activeTangentSide = null;
    
    const _wasPlayheadDrag = this._isDraggingPlayhead;
    this._isDraggingPlayhead = false;
    this._isDraggingMarquee = false;
    this._marqueeStart = null;
    this._marqueeEnd = null;
    this._isPanningGraph = false;
    this._isPanningDope = false;
    this._layerDotDrag = null;
    this._isZoomingGraph = false;
    this._isResizingPanel = false;
    this._isDraggingGutter = false;
    // [Step Bug1] Notify ACP to sync key inspector after any interaction.
    window._animSyncKeyInspector?.();
    this.draw();
  }

  handleInteraction(e) {
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    const tlX = 200; // Matching the VR layout for now
    const tlW = this._cssWidth - 200;

    if (rx >= tlX && rx <= tlX + tlW) {
      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));



      const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
      let loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
      let loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
      let visibleDuration = Math.max(0.1, loopEnd - loopStart);
      
      loopStart = this._viewStart !== undefined ? this._viewStart : loopStart;
      visibleDuration = this._viewDuration !== undefined ? this._viewDuration : visibleDuration;
      
      const fps = window._animFPS || 24;
      const targetTime = Math.round((loopStart + t * visibleDuration) * fps) / fps;

      window._animPlaying = false;
      window._animCurrentTime = targetTime;

      if (window._animationRegistry) {
        window._animationRegistry.globalPlaybackTime = targetTime;
        if (this._main && this._main._meshes) {
          this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
        }
        if (this._main.render) this._main.render();
      }
    }
  }

  finalizeMarquee(e) {
    if (!this._marqueeStart || !this._marqueeEnd) return;
    
    const x1 = Math.min(this._marqueeStart.x, this._marqueeEnd.x);
    const x2 = Math.max(this._marqueeStart.x, this._marqueeEnd.x);
    const y1 = Math.min(this._marqueeStart.y, this._marqueeEnd.y);
    const y2 = Math.max(this._marqueeStart.y, this._marqueeEnd.y);

    const addMode = e && e.shiftKey;
    if (!addMode) {
      window._animSelectedKeys = [];
    }
    
    const reg = window._animationRegistry;
    if (!reg) return;
    
    const headerH = HEADER_H;

    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDurationReal = Math.max(0.1, loopEndReal - loopStartReal);

    if (this._viewDuration === undefined) {
      this._viewStart = loopStartReal;
      this._viewDuration = visibleDurationReal;
    }

    let loopStart = this._viewStart;
    let visibleDuration = this._viewDuration;

    const tlX = 200;
    const tlW = this._cssWidth - 200;

    // A KEY IS A DRAWN MARKER, NOT A POINT, and the marquee tests its CENTRE — so a rectangle
    // that visually covers a key could still miss it. That is unreachable rather than merely
    // fiddly at the two ends: the first key sits at exactly tlX, and everything left of tlX is
    // the row-name gutter where a press is claimed before any marquee can start; the last key
    // sits at the right-hand edge of the canvas, with nowhere further to drag. So the first and
    // last keys in time could not be marqueed at all, however carefully you dragged — the
    // middle ones always worked, which is exactly the reported shape.
    //
    // Padding the rectangle by the marker's own radius before converting to time fixes both
    // ends and makes the selection match what the rectangle looks like it covers.
    const MARQ_PAD = 8;
    const tMin = loopStart + ((x1 - MARQ_PAD - tlX) / tlW) * visibleDuration;
    const tMax = loopStart + ((x2 + MARQ_PAD - tlX) / tlW) * visibleDuration;

    if (this._mode === 'graph') {
      const vMax = this.yToValue(y1);
      const vMin = this.yToValue(y2);
      
      const beforeSelection = this._undoSelectionBeforeMarquee || [];
      
      const newKeys = [];
      const activeMesh = this._graphMesh();
      if (activeMesh) {
        const id = activeMesh.getID();
        const track = reg.tracks.get(id);
        if (track) {
          newKeys.push(...TimelineHelper.getKeysInGraphRange(reg, id, tMin, tMax, vMin, vMax));
        }
      }
      if (!addMode) window._animSelectedKeys = [];
      window._animSelectedKeys.push(...newKeys);

      if (window._animSelectedKeys && window._animSelectedKeys.length > 1) {
        let minT = Infinity;
        let maxT = -Infinity;
        window._animSelectedKeys.forEach(k => {
          const tr = reg.tracks.get(k.meshId);
          if (!tr) return;
          let t;
          if (k.type === 'transform') t = tr.times?.[k.index];
          else if (k.type === 'shape')  t = tr.shapeTimes?.[k.index];
          else if (k.type === 'blendshape') t = tr.blendshapeTracks?.get(k.name)?.times?.[k.index];
          if (t != null && t < minT) minT = t;
          if (t != null && t > maxT) maxT = t;
        });
        window._animTransformBox = (minT !== Infinity) ? { startTime: minT, endTime: maxT } : null;
      } else {
        window._animTransformBox = null;
      }

      const afterSelection = [...window._animSelectedKeys];
      const cbUndo = () => {
        console.log("[Graph Debug] Undo Marquee Selection. Before:", beforeSelection);
        window._animSelectedKeys = beforeSelection;
        this.draw();
      };
      const cbRedo = () => {
        window._animSelectedKeys = afterSelection;
        this.draw();
      };
      this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, 'graph editor multikeys selection');

      this.draw();
      return;
    }
    const tracks = this._dopesheetTracks();
    const laneAreaH = this._cssHeight - headerH;
    const trackH = TimelineHelper.laneHeight(laneAreaH, tracks.length);


    
    // Lane bounds must carry the SCROLL, like every other lane computation in this file —
    // without it a scrolled dopesheet marquees the wrong rows.
    // Padded in y for the same reason: the first row's keys sit half a lane below the header
    // and the last row's are the bottom-most thing on the canvas.
    const _marqScroll = this._dopeScroll();
    const laneMin = Math.floor((y1 - MARQ_PAD - headerH + _marqScroll) / trackH);
    const laneMax = Math.floor((y2 + MARQ_PAD - headerH + _marqScroll) / trackH);

    // TRANSFORM KEYS, GATHERED THE SAME WAY AS EVERY OTHER KIND BELOW.
    //
    // This used to call reg.getKeysInTimeRange(tMin, tMax, laneMin, laneMax), which indexes
    // `Array.from(this.tracks.entries())` — the REGISTRY's own map. `laneMin`/`laneMax` are row
    // numbers in the DOPESHEET, and the two lists are neither the same order nor the same
    // membership: the dopesheet drops dead tracks and frame-group children and appends group
    // rows. So the lane range selected whichever registry entries happened to sit at those
    // indices. The blendshape, SR and shape-layer collectors below always iterated `tracks`
    // directly; this one was the odd path out, and removing the rig-row fold shifted the row
    // numbering enough to make the mismatch bite.
    const newKeys = [];
    tracks.forEach(([meshId, trackObj], laneIdx) => {
      if (laneIdx < laneMin || laneIdx > laneMax) return;
      if (trackObj.times) {
        for (let j = 0; j < trackObj.times.length; j++) {
          const t = trackObj.times[j];
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'transform', index: j });
        }
      }
      if (trackObj.shapeTimes) {
        for (let j = 0; j < trackObj.shapeTimes.length; j++) {
          const t = trackObj.shapeTimes[j];
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'shape', index: j });
        }
      }
    });

    // Add blendshape keys in the marquee time range
    tracks.forEach(([meshId, trackObj], laneIdx) => {
      if (laneIdx < laneMin || laneIdx > laneMax) return;
      if (!trackObj.blendshapeTracks) return;
      trackObj.blendshapeTracks.forEach((bTrack, name) => {
        if (!bTrack.times || window._animBsChannelVisible?.[name] === false) return; // hidden — not selectable
        for (let i = 0; i < bTrack.times.length; i++) {
          const t = bTrack.times[i];
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'blendshape', name, index: i });
        }
      });
    });

    // Add SR frame-group markers in range (keyed by child id — stable across retime resort).
    if (window._frameGroup) {
      tracks.forEach(([meshId], laneIdx) => {
        if (laneIdx < laneMin || laneIdx > laneMax) return;
        const grp = this._main._meshes?.find(m => m.getID() === meshId && m._isFrameGroup);
        if (!grp) return;
        window._frameGroup.children(grp).forEach(child => {
          const t = child._srFrameTime || 0;
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'sr', childId: child.getID() });
        });
      });
    }

    // Shape-LAYER keys in range (#34): precise per-sub-row Y test so a box over layers
    // 1/3/7 picks exactly those. Mirrors drawDopeSheet's row layout.
    tracks.forEach(([meshId, trackObj], laneIdx) => {
      if (!trackObj.shapeLayers || !trackObj.shapeLayers.length) return;
      const ty2 = headerH + (laneIdx * trackH) - this._dopeScroll();
      const bsCount = trackObj.blendshapeTracks ? trackObj.blendshapeTracks.size : 0;
      for (let li = 0; li < trackObj.shapeLayers.length; li++) {
        const L = trackObj.shapeLayers[li];
        if (!L.shapeTimes) continue;
        const rowY = ty2 + trackH / 2 + 22 + (bsCount + li) * 18;
        if (rowY < y1 || rowY > y2) continue;
        for (let i = 0; i < L.shapeTimes.length; i++) {
          const t = L.shapeTimes[i];
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'shapeLayer', layer: li, index: i });
        }
      }
    });

    // Hidden key types (bottom-strip visibility off) are not marquee-selectable — a
    // hidden transform/shape/etc. key must not be swept up alongside a visible one.
    const _mShow = window._animKeyShow || { transform: true, shape: true, blendshape: true, shaperep: true };
    const _typeVisible = (t) => t === 'transform' ? _mShow.transform !== false
                             : t === 'shape'     ? _mShow.shape !== false
                             : t === 'shapeLayer' ? _mShow.shape !== false
                             : t === 'blendshape' ? _mShow.blendshape !== false
                             : t === 'sr'        ? _mShow.shaperep !== false
                             : true; // 'frame' (voxel cel) has no filter yet
    newKeys.forEach(nk => {
      if (!_typeVisible(nk.type)) return;
      const alreadySelected = window._animSelectedKeys && window._animSelectedKeys.some(k =>
        k.meshId === nk.meshId && k.type === nk.type &&
        (nk.type === 'sr' ? k.childId === nk.childId : k.index === nk.index) &&
        (nk.type !== 'blendshape' || k.name === nk.name) &&
        (nk.type !== 'shapeLayer' || k.layer === nk.layer));
      if (!alreadySelected) window._animSelectedKeys.push(nk);
    });

    // A MARQUEE IS A SELECTION TOO, so it points the graph editor at what it caught. Clicking
    // a row name or a single key already did this; sweeping a rectangle over the same keys did
    // not, which left the graph showing whatever was selected in the 3D view — the exact thing
    // the per-click version was added to stop.
    //
    // The FIRST caught key decides. A marquee can span several objects and the graph shows one
    // at a time; the first in row order is the one nearest the top of the rectangle, which is
    // the one you were reaching for. It is also a no-op when the sweep caught nothing, so an
    // empty marquee leaves the graph where it was rather than blanking it.
    if (newKeys.length) this._setGraphTarget(newKeys[0].meshId);

    // Automatically create transform box around selection!
    if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
      let minT = Infinity;
      let maxT = -Infinity;
      window._animSelectedKeys.forEach(k => {
        const track = reg.tracks.get(k.meshId);
        if (!track) return;
        let t;
        if (k.type === 'transform') t = track.times?.[k.index];
        else if (k.type === 'shape') t = track.shapeTimes?.[k.index];
        else if (k.type === 'shapeLayer') t = track.shapeLayers?.[k.layer]?.shapeTimes?.[k.index];
        else if (k.type === 'blendshape' && k.name) t = track.blendshapeTracks?.get(k.name)?.times?.[k.index];
        if (t !== undefined && t < minT) minT = t;
        if (t !== undefined && t > maxT) maxT = t;
      });
      window._animTransformBox = { startTime: minT, endTime: maxT };
    } else {
      window._animTransformBox = null;
    }
  }

  draw() {
    // Re-read whether Delete has anything to act on. Cheap: syncDeleteButton compares a
    // signature and returns before touching the DOM unless the answer changed.
    this._notifySelectionChanged();
    const ctx = this._ctx;
    const w = {
      x: 0,
      y: 0,
      w: this._cssWidth,
      h: this._cssHeight
    };

    // 1. Dark Graph Container
    ctx.fillStyle = Theme.base; // match the HTML menu panel base (graded the same in VR)
    ctx.fillRect(w.x, w.y, w.w, w.h);
    
    if (!window._animationRegistry) {
      ctx.fillStyle = Theme.subtext;
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No Animation Registry found.', w.w / 2, w.h / 2);
      return;
    }

    const reg = window._animationRegistry;
    const tracks = this._dopesheetTracks();
    
    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStartReal = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEndReal = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    
    let loopStart = loopStartReal;
    let visibleDuration = Math.max(0.1, loopEndReal - loopStartReal);
    
    if (this._mode === 'graph') {
      if (this._viewDuration === undefined) {
        this._viewStart = loopStart;
        this._viewDuration = visibleDuration;
      }
      loopStart = this._viewStart;
      visibleDuration = this._viewDuration;
      // [Step 2] Follow selected key: ensure the selected key's channel is visible.
      this._followSelectedKeyChannel();
    } else if (this._viewDuration !== undefined) {
      // Dope sheet with user scroll/zoom applied — honour the view window.
      loopStart = this._viewStart;
      visibleDuration = this._viewDuration;
    }
    const loopEnd = loopStart + visibleDuration;

    const tlX = 200; // Width allocated for track names
    const tlW = w.w - 200;

    // --- 1. Draw Top Transport Header Strip ---
    const headerH = HEADER_H;
    ctx.fillStyle = Theme.mantle;
    ctx.fillRect(w.x, w.y, w.w, headerH);

    // Resize grip — 3 dots centred at top edge. Desktop only: in VR it sits under the
    // transport bar and wedges the timeline if grabbed (VR resizes via _vrResizeHandle).
    if (!this._main?._renderer?.xr?.isPresenting) {
      ctx.fillStyle = Theme.surface1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(w.w / 2 + i * 8, 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- helper: draw a rounded toolbar button ---
    const _drawBtn = (bx, by, bw, bh, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 3);
      ctx.fill();
    };

    // Toolbar buttons — driven by _toolbarBtnDefs() so draw and hit-test stay in sync.
    const _faReady = document.fonts.check('900 12px "Font Awesome 6 Free"');
    const _tbBtns = this._toolbarBtnDefs();
    _tbBtns.forEach(btn => {
      const hov = this._lastMouseX >= btn.x && this._lastMouseX <= btn.x + btn.w
               && this._lastMouseY >= btn.y && this._lastMouseY <= btn.y + btn.h;
      const fill = btn.disabled  ? Theme.surface0
                 : btn.id === 'record' && btn.active ? '#cc2244'  // record armed → red
                 : btn.active   ? TL_ACCENT
                 : hov          ? Theme.surface1
                                : Theme.surface1;
      _drawBtn(btn.x, btn.y, btn.w, btn.h, fill);
      ctx.textAlign = 'center';
      // cy: integer pixel center for geometry and FA glyphs (textBaseline:'middle', even px = integer midpoint).
      // ty: alphabetic baseline snapped to whole pixel for plain-text labels (avoids subpixel blur on 1x displays).
      const cy = Math.round(btn.y + btn.h / 2);
      const ty = Math.round(btn.y + btn.h * 0.68);
      const cx = Math.round(btn.x + btn.w / 2);
      if (btn.id === 'marquee') {
        // Dashed-rectangle selection-box icon — drawn directly, no font needed.
        const ic = btn.active ? Theme.text : Theme.subtext;
        ctx.strokeStyle = ic; ctx.fillStyle = ic; ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 1.5]);
        const ix = btn.x + btn.w / 2 - 7, iy = cy - 4;
        ctx.strokeRect(ix, iy, 14, 9);
        ctx.setLineDash([]);
        [[0, 0], [14, 0], [0, 9], [14, 9]].forEach(([dx, dy]) => {
          ctx.beginPath(); ctx.arc(ix + dx, iy + dy, 1.5, 0, Math.PI * 2); ctx.fill();
        });
      } else if (btn.id === 'fit') {
        // FIT ALL: a magnifier with arrows into the four corners of its bounding box. Drawn
        // rather than a glyph, because the three 28px buttons were a marquee rectangle, a
        // magnifier and a grid -- three small outlined squares that read as the same button at
        // a glance. matt: "the icons for marquee, fit all, toolbox are too similar."
        const ic = Theme.subtext;
        ctx.strokeStyle = ic; ctx.fillStyle = ic; ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(cx - 1, cy - 1, 4, 0, Math.PI * 2); ctx.stroke();
        // Handle stops well short of the corner arrow: at 5.5 it ran into the arrow's shaft,
        // which starts 3.2 back from the tip at 8.5.
        ctx.beginPath(); ctx.moveTo(cx + 2, cy + 2); ctx.lineTo(cx + 4, cy + 4); ctx.stroke();
        // Four corner arrows, pointing outward into the corners of the button's box.
        const R = 8.5;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const ax = cx + sx * R, ay = cy + sy * R;
          ctx.beginPath();
          ctx.moveTo(ax - sx * 3.2, ay - sy * 3.2);
          ctx.lineTo(ax, ay);
          ctx.stroke();
          // barbs
          ctx.beginPath();
          ctx.moveTo(ax, ay); ctx.lineTo(ax - sx * 3, ay);
          ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - sy * 3);
          ctx.stroke();
        }
      } else if (btn.id === 'tbox') {
        // TRANSFORM BOX: a transform handle -- a square with grab dots at its corners and at
        // the N/S/E/W midpoints, which is what the thing actually looks like on the graph.
        const ic = btn.active ? Theme.text : Theme.subtext;
        ctx.strokeStyle = ic; ctx.fillStyle = ic; ctx.lineWidth = 1.3;
        ctx.setLineDash([]);
        const hw = 6, hh = 5;
        ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
        for (const [dx, dy] of [[-hw, -hh], [0, -hh], [hw, -hh],
                                [-hw, 0],            [hw, 0],
                                [-hw, hh], [0, hh], [hw, hh]]) {
          ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      } else if (btn.id === 'snap') {
        // SNAP TO FRAMES: a ruler of fractional ticks with a taller one at the centre and a
        // small 1 above it -- the whole point being that a value lands on a WHOLE frame rather
        // than between two. matt's sketch.
        const ic = btn.active ? Theme.text : Theme.subtext;
        ctx.strokeStyle = ic; ctx.fillStyle = ic; ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        const base = cy + 6;
        for (const dx of [-9, -6, -3, 3, 6, 9]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx, base);
          ctx.lineTo(cx + dx, base - 3);
          ctx.stroke();
        }
        // The whole-frame tick, taller than the fractions either side of it.
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx, base);
        ctx.lineTo(cx, base - 7);
        ctx.stroke();
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('1', cx, base - 8.5);
      } else if (btn.id === 'mode') {
        // Two icons: chart-column (flipped V) = dopesheet, bezier-curve = graph.
        ctx.textBaseline = 'middle';
        const dopeActive = this._mode === 'dope';
        const graphActive = this._mode === 'graph';
        if (_faReady) {
          ctx.font = '900 12px "Font Awesome 6 Free"';
          // Chart-column flipped vertically.
          ctx.save();
          ctx.fillStyle = dopeActive ? Theme.text : Theme.overlay0;
          ctx.translate(Math.round(btn.x + 13), cy);
          ctx.scale(1, -1);
          ctx.fillText('', 0, 0);
          ctx.restore();
          ctx.fillStyle = graphActive ? Theme.text : Theme.overlay0;
          ctx.fillText('', Math.round(btn.x + 33), cy);
        } else {
          ctx.textBaseline = 'alphabetic'; ctx.font = '13px sans-serif'; ctx.fillStyle = Theme.text;
          ctx.fillText('D/G', cx, ty);
        }
      } else if (btn.id === 'record') {
        // Solid red dot (no hole), matching the ACP record button — the FA record glyph
        // is a ring, which reads confusingly. White on the red active bg, red otherwise.
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = btn.active ? '#ffffff' : '#f38ba8';
        ctx.fill();
      } else if (btn.icon) {
        ctx.fillStyle = btn.disabled ? Theme.surface1 : Theme.text;
        if (_faReady) {
          ctx.textBaseline = 'middle';
          // Wide transport buttons (w ≥ 40) get a larger icon.
          const _faSize = btn.w >= 40 ? 14 : 12;
          ctx.font = `900 ${_faSize}px "Font Awesome 6 Free"`;
          ctx.fillText(btn.icon, cx, cy);
        } else {
          ctx.textBaseline = 'alphabetic';
          ctx.font = '13px sans-serif';
          ctx.fillText(btn.id[0].toUpperCase(), cx, ty);
        }
      } else {
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = btn.disabled ? Theme.surface1 : Theme.text;
        ctx.font = '13px sans-serif';
        ctx.fillText(btn.label, cx, ty);
      }
    });

    // --- Gutter header buttons (two rows, x:0-195) ---
    // Clipped to the gutter column so it never bleeds into the ruler.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 196, headerH);
    ctx.clip();
    const _gbBtns = this._gutterBtnDefs();
    _gbBtns.forEach(btn => {
      const hov = this._lastMouseX >= btn.x && this._lastMouseX <= btn.x + btn.w
               && this._lastMouseY >= btn.y && this._lastMouseY <= btn.y + btn.h;
      // Split mode/vis button (XF/SH/BS/SR): top 75% = keying state (accent when this
      // is the keyed mode), bottom 25% = a visibility strip (green = shown / dark =
      // hidden; the keyed mode is always shown so its strip stays lit).
      if (btn.split) {
        const topH = Math.round(btn.h * 0.60);
        const cx2 = Math.round(btn.x + btn.w / 2);
        // Top zone (keying)
        ctx.fillStyle = btn.active ? TL_ACCENT : (hov ? Theme.surface0 : Theme.surface1);
        ctx.beginPath();
        ctx.roundRect(btn.x, btn.y, btn.w, topH, [3, 3, 0, 0]);
        ctx.fill();
        // Bottom zone (visibility)
        ctx.fillStyle = btn.shown ? Theme.green : Theme.mantle;
        ctx.beginPath();
        ctx.roundRect(btn.x, btn.y + topH, btn.w, btn.h - topH, [0, 0, 3, 3]);
        ctx.fill();
        // Label in the top zone (dark on the accent fill for contrast).
        ctx.fillStyle = btn.active ? Theme.base : Theme.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(btn.label, cx2, Math.round(btn.y + topH / 2));
        return;
      }
      // Display toggles (XF/SH/BS/SR) carry a `shown` flag → three visual states:
      // active add-type = accent, shown = normal, hidden = dim.
      const isToggle = btn.shown !== undefined;
      const dimHidden = isToggle && !btn.shown && !btn.active;
      const fill = btn.disabled ? Theme.surface0
                 : btn.active   ? TL_ACCENT
                 : dimHidden    ? Theme.surface0
                 : hov          ? Theme.surface1
                                : Theme.surface1;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 3);
      ctx.fill();
      const cx = Math.round(btn.x + btn.w / 2);
      const cy = Math.round(btn.y + btn.h / 2);
      if (btn.icon) {
        ctx.fillStyle = btn.disabled ? Theme.surface1 : Theme.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (_faReady) {
          // Larger font for wide transport buttons (row 1), normal for row 2.
          const faSize = btn.w >= 40 ? 14 : 11;
          ctx.font = `900 ${faSize}px "Font Awesome 6 Free"`;
          ctx.fillText(btn.icon, cx, cy);
        } else {
          ctx.font = '11px sans-serif';
          ctx.fillText(btn.id[0].toUpperCase(), cx, cy);
        }
      } else if (btn.label) {
        ctx.fillStyle = btn.disabled ? Theme.surface1 : (dimHidden ? Theme.subtext : Theme.text);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(btn.label, cx, cy);
      }
    });
    ctx.restore();

    const fps = window._animFPS || 24;
    const curT = window._animCurrentTime ? Math.round(window._animCurrentTime * fps) : 0;
    const loopStartF = Math.round(loopStart * fps);
    const loopEndF = Math.round(loopEnd * fps);

    // --- Frame ruler strip (below both toolbar rows) ---
    // Keep this tied to the toolbar hit-test boundary. A hardcoded y=28 here used
    // to repaint the ruler over the recording controls even though HEADER_H had
    // already been expanded for them.
    const rulerY = TOOLBAR_BOTTOM;
    const rulerH = headerH - rulerY;
    ctx.fillStyle = Theme.mantle;
    ctx.fillRect(tlX, w.y + rulerY, tlW, rulerH);

    // Adaptive tick interval based on pixels-per-frame
    const totalFrames = visibleDuration * fps;
    const pxPerFrame = tlW / Math.max(1, totalFrames);
    let majorInt, minorInt;
    if      (pxPerFrame >= 16) { majorInt = 1;        minorInt = 0; }
    else if (pxPerFrame >= 8)  { majorInt = 5;        minorInt = 1; }
    else if (pxPerFrame >= 4)  { majorInt = 10;       minorInt = 5; }
    else if (pxPerFrame >= 2)  { majorInt = fps;      minorInt = Math.max(1, Math.round(fps / 4)); }
    else if (pxPerFrame >= 0.5){ majorInt = fps * 2;  minorInt = fps; }
    else                       { majorInt = fps * 5;  minorInt = fps; }

    const fStart = Math.ceil(loopStart * fps);
    const fEnd   = Math.floor(loopEnd   * fps);

    ctx.lineWidth = 1;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let f = fStart; f <= fEnd; f++) {
      const isMajor = majorInt > 0 && (f % majorInt === 0);
      const isMinor = minorInt > 0 && (f % minorInt === 0);
      if (!isMajor && !isMinor) continue;
      const rx = tlX + ((f / fps - loopStart) / visibleDuration) * tlW;
      const tickH = isMajor ? rulerH * 0.55 : rulerH * 0.28;
      ctx.strokeStyle = isMajor ? Theme.overlay0 : Theme.surface1;
      ctx.beginPath();
      ctx.moveTo(rx, w.y + headerH - tickH);
      ctx.lineTo(rx, w.y + headerH);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = Theme.subtext;
        ctx.fillText(`${f}`, rx, w.y + rulerY + 2);
      }
    }

    // Ruler border line
    ctx.strokeStyle = Theme.surface1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tlX, w.y + rulerY);
    ctx.lineTo(tlX + tlW, w.y + rulerY);
    ctx.stroke();

    // Show status or value of closest key to playhead
    ctx.textBaseline = 'middle';
    if (reg.isCountingIn) {
      // Count-in: red-tint the whole timeline + a big centred countdown number so it's
      // unmistakable the take is about to roll.
      ctx.save();
      ctx.fillStyle = 'rgba(220,40,40,0.18)';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      const _n = (window._animStatusText || '').replace(/\D/g, '') || (window._animStatusText || '');
      const _cs = Math.max(32, Math.min(72, w.h * 0.5));
      ctx.fillStyle = '#ff6b6b';
      ctx.font = `bold ${_cs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(_n, w.x + w.w / 2, w.y + w.h / 2);
      ctx.restore();
    } else if (reg.isRecording) {
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      const _txt = window._animStatusText || '';
      ctx.fillText(_txt, w.w / 2, w.y + 40);
      // Solid REC dot to the left of the label (replaces the old emoji, drawn on canvas).
      const _tw = ctx.measureText(_txt).width;
      ctx.beginPath();
      ctx.arc(w.w / 2 - _tw / 2 - 12, w.y + 40, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Frame field (right-aligned in toolbar): shows the selected key's frame and
    // is click-to-edit. Drawn here (shared by both modes, before the mode branch).
    {
      const fr = this._frameFieldRect();
      const sel = window._animSelectedKeys || [];
      let label = '—';
      if (sel.length === 1) {
        const k = sel[0]; const tr = reg.tracks.get(k.meshId);
        const t = tr ? (k.type === 'transform' ? tr.times?.[k.index]
                     : k.type === 'shape'     ? tr.shapeTimes?.[k.index]
                     : tr.blendshapeTracks?.get(k.name)?.times?.[k.index]) : undefined;
        if (t !== undefined) label = String(Math.round(t * fps));
      } else if (sel.length > 1) {
        label = `${sel.length} keys`;
      }
      const hasSel = sel.length > 0;
      const hovF = this._lastMouseX >= fr.x && this._lastMouseX <= fr.x + fr.w
                && this._lastMouseY >= fr.y && this._lastMouseY <= fr.y + fr.h;
      ctx.fillStyle = !hasSel ? Theme.surface0 : (hovF ? '#3a4a3a' : Theme.surface0);
      ctx.beginPath(); ctx.roundRect(fr.x, fr.y, fr.w, fr.h, 3); ctx.fill();
      ctx.strokeStyle = hasSel ? (hovF ? '#446644' : Theme.surface1) : Theme.surface0;
      ctx.lineWidth = 0.5; ctx.stroke();
      ctx.fillStyle = Theme.overlay0; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('F', fr.x + 5, fr.y + fr.h / 2 + 0.5);
      ctx.fillStyle = hasSel ? (hovF ? '#88ddaa' : Theme.subtext) : Theme.surface1;
      ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(label, fr.x + fr.w - 5, fr.y + fr.h / 2 + 0.5);

      // Value field — just left of the frame field. Sets/shifts selected key values.
      const vr2 = this._valueFieldRect();
      let vlabel = '—';
      if (sel.length === 1) {
        const v = this._keyValue(sel[0], reg.tracks.get(sel[0].meshId));
        if (v !== undefined) vlabel = String(Math.round(v * 1000) / 1000);
      } else if (sel.length > 1) {
        vlabel = `${sel.length} keys`;
      }
      const hovV = this._lastMouseX >= vr2.x && this._lastMouseX <= vr2.x + vr2.w
                && this._lastMouseY >= vr2.y && this._lastMouseY <= vr2.y + vr2.h;
      ctx.fillStyle = !hasSel ? Theme.surface0 : (hovV ? '#3a4a3a' : Theme.surface0);
      ctx.beginPath(); ctx.roundRect(vr2.x, vr2.y, vr2.w, vr2.h, 3); ctx.fill();
      ctx.strokeStyle = hasSel ? (hovV ? '#446644' : Theme.surface1) : Theme.surface0;
      ctx.lineWidth = 0.5; ctx.stroke();
      ctx.fillStyle = Theme.overlay0; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('V', vr2.x + 5, vr2.y + vr2.h / 2 + 0.5);
      ctx.fillStyle = hasSel ? (hovV ? '#88ddaa' : Theme.subtext) : Theme.surface1;
      ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(vlabel, vr2.x + vr2.w - 5, vr2.y + vr2.h / 2 + 0.5);
    }

    if (this._mode === 'graph') {
      this.drawGraph(ctx);
      this._drawSpeedMenu(ctx);
      this._drawContextMenu(ctx);
      this._drawRecOptMenu(ctx);
      // Graph mode returns before the dopesheet tail below. Still publish the completed
      // draw so Scene uploads its changed canvas texture in VR (transport state included).
      this._drawRevision = (this._drawRevision || 0) + 1;
      return;
    }

    // [Step 4] Vertical grid lines — density matches ruler tick logic.
    {
      const totalFrames2 = visibleDuration * fps;
      const pxPerFrame2 = tlW / Math.max(1, totalFrames2);
      let gMajor, gMinor;
      if      (pxPerFrame2 >= 16) { gMajor = 1;        gMinor = 0; }
      else if (pxPerFrame2 >= 8)  { gMajor = 5;        gMinor = 1; }
      else if (pxPerFrame2 >= 4)  { gMajor = 10;       gMinor = 5; }
      else if (pxPerFrame2 >= 2)  { gMajor = fps;      gMinor = Math.max(1, Math.round(fps / 4)); }
      else if (pxPerFrame2 >= 0.5){ gMajor = fps * 2;  gMinor = fps; }
      else                        { gMajor = fps * 5;  gMinor = fps; }
      const fS2 = Math.ceil(loopStart * fps);
      const fE2 = Math.floor((loopStart + visibleDuration) * fps);
      ctx.lineWidth = 1;
      for (let f = fS2; f <= fE2; f++) {
        const isMaj = gMajor > 0 && (f % gMajor === 0);
        const isMin = gMinor > 0 && (f % gMinor === 0);
        if (!isMaj && !isMin) continue;
        const gx = tlX + ((f / fps - loopStart) / visibleDuration) * tlW;
        ctx.strokeStyle = isMaj ? Theme.surface0 : Theme.mantle;
        ctx.beginPath();
        ctx.moveTo(gx, w.y + headerH);
        ctx.lineTo(gx, w.y + w.h);
        ctx.stroke();
      }
    }

    // Track Column Border
    ctx.strokeStyle = Theme.overlay0;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tlX, w.y + headerH);
    ctx.lineTo(tlX, w.y + w.h);
    ctx.stroke();

    // 3. Render Track Lanes
    const laneAreaH = w.h - headerH;
    
    TimelineHelper.drawDopeSheet(ctx, tracks, w, headerH, tlX, tlW, loopStart, visibleDuration, this._main, this);

    // Render Transform Box
    if (window._animShowTransformBox && window._animTransformBox) {
      const tBox = window._animTransformBox;
      TimelineHelper.drawTransformBox(ctx, tBox, w, headerH, tlX, tlW, loopStart, visibleDuration);
    }

    this.drawPlayhead(ctx);

    // 5. Render Marquee Box
    if (this._marqueeStart && this._marqueeEnd) {
      ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1;
      const x = Math.min(this._marqueeStart.x, this._marqueeEnd.x);
      const y = Math.min(this._marqueeStart.y, this._marqueeEnd.y);
      const w = Math.abs(this._marqueeEnd.x - this._marqueeStart.x);
      const h = Math.abs(this._marqueeEnd.y - this._marqueeStart.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    this._drawSpeedMenu(ctx);
    this._drawContextMenu(ctx);
    this._drawRecOptMenu(ctx);
    this._drawRevision = (this._drawRevision || 0) + 1;
  }
}
