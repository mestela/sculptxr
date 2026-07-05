import TimelineHelper from './TimelineHelper.js';
import { Theme } from './theme.js';

// Darker, higher-contrast blue (matches the desktop sidebar sliders) for active buttons
// and the playhead — Theme.blue (#89b4fa) is too light against white text to read in VR.
const TL_ACCENT = '#3b82f6';

// Timeline header height (toolbar row + gutter key-mode row + frame ruler). Single
// source of truth — referenced everywhere the lanes/ruler/hit-tests offset from the
// header. Bump this alone to resize the header.
const HEADER_H = 64;

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
    this._activeKeyframeTrack = null;
    this._activeKeyframeIndex = undefined;
    this._activeKeyframeType = null;
    this._keyDragStartRx = 0;
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
    this._isZoomingGraph = false;
    this._panStartRy = 0;
    this._panStartOffsetY = 0;
    this._zoomStartRy = 0;
    this._zoomStartScaleY = 100.0;
    this._isResizingPanel = false;
    this._touchMap = new Map(); // [Step 1] pointerId → {x,y} for multi-touch scroll
    this._isTouchScrolling = false;
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
        // Horizontal scroll → pan time.
        const secsPerPx = this._viewDuration / tlW;
        this._viewStart += e.deltaX * secsPerPx;
        // Vertical scroll: gutter if cursor is in gutter column, else value/time axis.
        const wheelRx = e.clientX - this._canvas.getBoundingClientRect().left;
        if (this._mode === 'graph' && wheelRx < 200) {
          this._gutterScrollY = Math.max(0, Math.min(this._gutterMaxScroll, this._gutterScrollY + e.deltaY));
        } else if (this._mode === 'graph') {
          this._panY += e.deltaY;
        } else {
          this._viewStart += e.deltaY * secsPerPx;
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

  // Scroll the gutter (if needed) so the given absolute row index is fully
  // visible. Used to bring the channel being edited into view (desktop + VR).
  _ensureGutterRowVisible(rowIdx) {
    const headerH = HEADER_H;
    const gutterY = headerH + 4;
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
      else if (k.type === 'blendshape') this._insertBlendshapeKeyAt(tr, k.name, time, k.payload.value);
      else continue;
      if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;
      targets.push({ meshId: k.meshId, type: k.type, name: k.name, time });
    }

    // Scalar keys: one undo entry + rebuild the selection onto them. (SR frames carry
    // their own undo via FrameGroup, so they're excluded here.)
    if (targets.length) {
      window._animSelectedKeys = targets.map(t => {
        const tr = reg.tracks.get(t.meshId);
        const times = t.type === 'transform' ? tr.times
                    : t.type === 'shape'     ? tr.shapeTimes
                    : tr.blendshapeTracks?.get(t.name)?.times;
        const idx = times?.findIndex(x => Math.abs(x - t.time) < 0.005) ?? -1;
        return idx < 0 ? null : (t.type === 'blendshape'
          ? { meshId: t.meshId, type: 'blendshape', name: t.name, index: idx }
          : { meshId: t.meshId, type: t.type, index: idx });
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

  _insertBlendshapeKeyAt(tr, name, time, value) {
    const bt = tr.blendshapeTracks?.get(name);
    if (!bt) return; // the target mesh must already have this blendshape
    bt.times = bt.times || []; bt.values = bt.values || [];
    let idx = 0; while (idx < bt.times.length && bt.times[idx] < time) idx++;
    if (idx < bt.times.length && Math.abs(bt.times[idx] - time) < 0.005) bt.values[idx] = value;
    else { bt.times.splice(idx, 0, time); bt.values.splice(idx, 0, value); }
  }

  // The edited value of a key (transform → position channel, shape → output time,
  // blendshape → weight). undefined if not resolvable.
  _keyValue(k, tr) {
    if (!tr) return undefined;
    if (k.type === 'transform')  return tr.positions?.[k.index * 3 + (k.channel ?? 0)];
    if (k.type === 'shape')      return tr.shapeOutputTimes?.[k.index];
    if (k.type === 'blendshape') return tr.blendshapeTracks?.get(k.name)?.values?.[k.index];
    return undefined;
  }

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
      if (k.type === 'transform' && tr.positions) {
        tr.positions[k.index * 3 + (k.channel ?? 0)] = nv;
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

    let loopStart = loopStartReal;
    let visibleDuration = visibleDurationReal;
    if (this._mode === 'graph') {
      if (this._viewDuration === undefined) {
        this._viewStart = loopStart;
        this._viewDuration = visibleDuration;
      }
      loopStart = this._viewStart;
      visibleDuration = this._viewDuration;
    }
    const tlX = 200;
    const tlW = this._cssWidth - 200;
    const headerH = HEADER_H;
    const fps = window._animFPS || 24;
    const currentTimeVal = window._animCurrentTime !== undefined ? window._animCurrentTime : 0;
    const snappedTime = Math.round(currentTimeVal * fps) / fps;
    const playheadAlpha = (snappedTime - loopStart) / visibleDuration;
    const playheadX = tlX + playheadAlpha * tlW;

    if (playheadX >= tlX && playheadX <= tlX + tlW) {
      const capStartY = 25;
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
      ctx.fillText(curT, playheadX, 37);
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
    // One synthetic row per frame GROUP (the whole flipbook on a single lane), unless
    // it already has a real track (e.g. group transform animation). drawDopeSheet draws
    // its frame markers from the children's _srFrameTime.
    meshes.filter(m => m._isFrameGroup).forEach(g => {
      if (!entries.some(([id]) => id === g.getID())) entries.push([g.getID(), { _srGroupRow: true }]);
    });
    return entries;
  }

  // Move the playhead to an explicit time and apply it (stop playback, re-evaluate
  // every mesh so visibility/transform tracks update, refresh outliner eyes).
  _setPlayhead(t) {
    window._animPlaying = false;
    window._animCurrentTime = t;
    const reg = window._animationRegistry;
    if (reg) {
      reg.globalPlaybackTime = t;
      if (this._main && this._main._meshes) this._main._meshes.forEach(m => reg.update(m, true));
    }
    if (this._main.render) this._main.render();
    window._updateOutlinerVisIcons?.();
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
    const gutterY = headerH + 4;
    const rowH = 22; // 25% smaller than original 30
    const colors = ['#ff4444', '#44ff44', '#4444ff'];
    const labels = ['X', 'Y', 'Z'];

    const activeMeshForGutter = this._main.getMesh();
    const idForGutter = activeMeshForGutter ? activeMeshForGutter.getID() : null;
    const trackForGutter = idForGutter ? reg.tracks.get(idForGutter) : null;

    if (trackForGutter && trackForGutter.shapeTimes && trackForGutter.shapeTimes.length >= 2) {
      colors.push('#ff00ff');
      labels.push('Shot');
    }

    if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];
    if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
    const bsColors = ['#ff8844', '#44ffcc', '#ffdd44', '#aa44ff', '#ff44bb', '#44bbff'];
    const bsCount = trackForGutter?.blendshapeTracks?.size ?? 0;
    const totalRows = labels.length + bsCount;
    const visibleGutterH = this._cssHeight - headerH;
    this._gutterMaxScroll = Math.max(0, totalRows * rowH - visibleGutterH + 8);
    this._gutterScrollY = Math.min(this._gutterScrollY, this._gutterMaxScroll);

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
      const _gVal = ch < 3 && _gPosVals ? _gPosVals[ch].toFixed(2) : null;
      const _hl = (ch < 3 ? selXfCh.has(ch) : selHasShape)
               || (_hc && (ch < 3 ? (_hc.kind === 'transform' && _hc.channel === ch) : _hc.kind === 'shape'));
      _drawRow(ch, labels[ch], colors[ch], window._animChannelVisible[ch] !== false, _gVal, false, _hl);
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



    // 5. Draw Curves for Active Mesh
    const activeMesh = this._main.getMesh();
    if (activeMesh) {
      const id = activeMesh.getID();
      const track = reg.tracks.get(id);
      if (track && track.times && track.times.length >= 2) {
        // Draw Position X, Y, Z
        const colors = ['#ff4444', '#44ff44', '#4444ff']; // R, G, B
        
        for (let channel = 0; channel < 3; channel++) {
          const isVisible = window._animChannelVisible ? window._animChannelVisible[channel] !== false : true;
          if (!isVisible) continue;

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
            
            const val1 = track.positions[i * 3 + channel];
            const val2 = track.positions[(i + 1) * 3 + channel];

            const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dt`] : undefined;
            const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dv_${channel}`] : undefined;
            const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i + 1}_left_dt`] : undefined;
            const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i + 1}_left_dv_${channel}`] : undefined;

            const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
            const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;

            let slope0 = 0;
            if (i === 0) {
              slope0 = (track.positions[3 + channel] - track.positions[channel]) / (track.times[1] - track.times[0]);
            } else if (i === track.times.length - 1) {
              const pIdx = (i - 1) * 3;
              const cIdx = i * 3;
              slope0 = (track.positions[cIdx + channel] - track.positions[pIdx + channel]) / (track.times[i] - track.times[i - 1]);
            } else {
              const pIdx = (i - 1) * 3;
              const nIdx = (i + 1) * 3;
              const dt_seg = track.times[i + 1] - track.times[i - 1];
              slope0 = dt_seg !== 0 ? (track.positions[nIdx + channel] - track.positions[pIdx + channel]) / dt_seg : 0;
            }

            let slope1 = 0;
            const i1 = i + 1;
            if (i1 === 0) {
              slope1 = (track.positions[3 + channel] - track.positions[channel]) / (track.times[1] - track.times[0]);
            } else if (i1 === track.times.length - 1) {
              const pIdx = (i1 - 1) * 3;
              const cIdx = i1 * 3;
              slope1 = (track.positions[cIdx + channel] - track.positions[pIdx + channel]) / (track.times[i1] - track.times[i1 - 1]);
            } else {
              const pIdx = (i1 - 1) * 3;
              const nIdx = (i1 + 1) * 3;
              const dt_seg = track.times[i1 + 1] - track.times[i1 - 1];
              slope1 = dt_seg !== 0 ? (track.positions[nIdx + channel] - track.positions[pIdx + channel]) / dt_seg : 0;
            }

            const dv0 = rightDv !== undefined ? rightDv : slope0 * dt0;
            const dv1 = leftDv !== undefined ? leftDv : slope1 * dt1;

            const p1x = dt0 / dt;
            const p2x = 1 + dt1 / dt;

            const hasTangents = track.tangentOffsets && (track.tangentOffsets[`trans_${i}_right_dv_${channel}`] !== undefined || track.tangentOffsets[`trans_${i + 1}_left_dv_${channel}`] !== undefined);

            const steps = 20;
            for (let s = 0; s <= steps; s++) {
              const targetAlpha = s / steps;
              
              const t = TimelineHelper.getBezierT(targetAlpha, p1x, p2x);
              const val = TimelineHelper.evaluateBezier(t, val1, val2, dv0, dv1);
              
              const time = t1 + targetAlpha * (t2 - t1);
              
              const x = tlX + ((time - loopStart) / visibleDuration) * tlW;
              const y = this.valueToY(val);
              
              if (i === 0 && s === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
          }
          ctx.stroke();
        }

        // Draw dots at keyframes
        for (let i = 0; i < track.times.length; i++) {
          const t = track.times[i];
          for (let channel = 0; channel < 3; channel++) {
            const isVisible = window._animChannelVisible ? window._animChannelVisible[channel] !== false : true;
            if (!isVisible) continue;
            
            const val = track.positions[i * 3 + channel];
            const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
            const y = this.valueToY(val);
            
            const isSelected = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i && k.channel === channel);
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
              ctx.arc(x, y, 4, 0, Math.PI * 2);
            } else {
              ctx.fillRect(x - 4, y - 4, 8, 8);
            }
            ctx.fill();
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
            
            const val = track.positions[i * 3 + selChannel];
            const ky = this.valueToY(val);
            
            const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dt`] : undefined;
            const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dv_${selChannel}`] : undefined;
            const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_left_dt`] : undefined;
            const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_left_dv_${selChannel}`] : undefined;

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
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 5, y);
          ctx.lineTo(x, y + 5);
          ctx.lineTo(x - 5, y);
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
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x + 5, y);
            ctx.lineTo(x, y + 5);
            ctx.lineTo(x - 5, y);
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
      const activeMesh = this._main.getMesh();
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
              t   = track.times?.[sk.index];
              val = track.positions?.[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
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
        time = tr?.times?.[sk.index];
        val  = tr?.positions?.[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
      } else if (sk.type === 'shape') {
        time = tr?.shapeTimes?.[sk.index];
        val  = tr?.shapeOutputTimes?.[sk.index] ?? 0;
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
        time = tr?.times?.[sk.index];
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
    if (track.times && track.positions) {
      for (let c = 0; c < 3; c++) {
        if (!vis[c]) continue;
        if (test(track.times.map((t, i) => ({ t, v: track.positions[i * 3 + c] })))) return { kind: 'transform', channel: c };
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
    if (desc.kind === 'transform') return track.times.map((_, i) => ({ meshId: id, type: 'transform', index: i, channel: desc.channel }));
    if (desc.kind === 'shape')     return track.shapeTimes.map((_, i) => ({ meshId: id, type: 'shape', index: i }));
    if (desc.kind === 'blendshape') {
      const bt = track.blendshapeTracks.get(desc.name);
      return bt ? bt.times.map((_, i) => ({ meshId: id, type: 'blendshape', name: desc.name, index: i })) : [];
    }
    return [];
  }

  // True when (cx,cy) in canvas px is open graph background — not the gutter,
  // not the header, and not on a curve. Used by the VR two-handed zoom gesture
  // to require both controllers to point at empty space.
  isEmptyGraphSpaceAt(cx, cy) {
    if (this._mode !== 'graph') return false;
    if (cx < 200 || cy < HEADER_H) return false;
    return !this._hitTestCurve(cx, cy);
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
    if (Math.abs(z.dy0) > 20) {
      const fy = Math.max(0.02, dy / z.dy0); // taller apart → fy>1 → larger zoomY (zoom in)
      this._zoomY = Math.max(1e-4, z.zoomY * fy);
    }
    const graphH = this._cssHeight - 50;
    this._panY = (HEADER_H + graphH / 2 - midCy) - z.pivotVal * this._zoomY;
    this.draw();
  }

  endTwoPointerZoom() { this._tpZoom = null; }

  handleGraphMouseDown(rx, ry) {
    const reg = window._animationRegistry;
    if (!reg) return;

    const activeMesh = this._main.getMesh();
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
          t   = track.times?.[sk.index];
          val = track.positions?.[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
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
      for (let i = 0; i < track.times.length; i++) {
        const t = track.times[i];
        const x = tlX + ((t - loopStart) / visibleDuration) * tlW;

        for (let c = 0; c < 3; c++) {
          if (_chVis[c] === false) continue; // hidden channel — not selectable
          const val = track.positions[i * 3 + c];
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
            this._activeKeyframeType = 'transform';
            this._activeKeyframeChannel = c;
            this._keyDragStartRx = rx;
            this._keyDragStartTime = loopStart + ((rx - tlX) / tlW) * visibleDuration;
            this._keyDragStartVal = this.yToValue(ry);

            const isPartSelection = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i && k.channel === c);
            
            if (isPartSelection) {
              this._animSelectedKeysInitialTimes = window._animSelectedKeys.map(k => {
                const tr = reg.tracks.get(k.meshId);
                const time = k.type === 'transform' ? tr.times[k.index] : tr.shapeTimes[k.index];
                const startVal = k.type === 'transform' ? tr.positions[k.index * 3 + (k.channel !== undefined ? k.channel : 0)] : 0;
                return { ...k, time, startVal };
              });
            } else {
              this._animSelectedKeysInitialTimes = null;
              
              const beforeSelection = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({...k})) : [];
              
              // Select only this key!
              window._animSelectedKeys = [{ meshId: id, type: 'transform', index: i, channel: c, startVal: val }];
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
        
        const val = track.positions[i * 3 + selChannel];
        const ky = this.valueToY(val);
        
        const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dt`] : undefined;
        const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${i}_right_dv_${selChannel}`] : undefined;
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

  autoFitGraph() {
    const reg = window._animationRegistry;
    if (!reg) return;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;
    const id = activeMesh.getID();
    const track = reg.tracks.get(id);
    if (!track) return;

    let minVal = Infinity;
    let maxVal = -Infinity;

    const channelsVisible = window._animChannelVisible || [true, true, true, true];

    if (track.positions && track.times && track.times.length > 0) {
      for (let i = 0; i < track.times.length; i++) {
        for (let c = 0; c < 3; c++) {
          if (channelsVisible[c]) {
            const val = track.positions[i * 3 + c];
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
          }
        }
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
        this.draw();
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
        const pfx = single.type === 'transform' ? 'trans_' : '';
        isTied = tr.tangentOffsets[`${pfx}${single.index}_tied`] !== false;
      }
    }
    const marqOn = !!window._animMarqueeMode;
    const btns = [];
    let bx = 10;
    // Mode toggle — two FA icons
    btns.push({ id: 'mode', x: bx, y: 5, w: 46, h: 20, icon: 'mode', tooltip: 'Toggle Dopesheet / Graph' });
    bx += 54;
    // Drag vs Marquee toggle (icon drawn programmatically in draw())
    btns.push({ id: 'marquee', x: bx, y: 5, w: 28, h: 20, active: marqOn, tooltip: marqOn ? 'Marquee Selection on — click for Drag mode' : 'Drag Mode on — click for Marquee Selection' });
    bx += 36;
    // Tied tangents (graph only, text)
    if (isGraph) {
      btns.push({ id: 'tangents-tied', x: bx, y: 5, w: 105, h: 20,
        label: isTied ? 'Tangents: Tied' : 'Tangents: Free',
        disabled: !single, tooltip: 'Toggle tied / free tangents' });
      bx += 113;
    }
    // Fit All
    btns.push({ id: 'fit', x: bx, y: 5, w: 28, h: 20, icon: '', tooltip: 'Fit All (X + Y)' });
    bx += 36;
    // Tangents show/hide (graph only, text)
    if (isGraph) {
      btns.push({ id: 'tangents', x: bx, y: 5, w: 70, h: 20,
        label: 'Tangents', active: tanOn, tooltip: 'Show tangent handles' });
      bx += 78;
    }
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
    const _tbTotal = _tbDefs.length * _tbBtnW + (_tbDefs.length - 1) * _tbBtnGap;
    let _tbX = Math.max(_leftSafeEnd, Math.round((this._cssWidth - _tbTotal) / 2));
    _tbDefs.forEach(def => {
      btns.push({ ...def, x: _tbX, y: 5, w: _tbBtnW, h: 20 });
      _tbX += _tbBtnW + _tbBtnGap;
    });
    return btns;
  }

  // Flatscreen "…" context menu — the desktop/iPad skin of the VR radial. Reads the same
  // command model (Scene._resolveRadialCommands) and shows it as a DOM popup anchored under
  // the toolbar button. VR uses the radial; this is the flatscreen counterpart.
  _openContextMenu(btn) {
    // Toggle: a re-click on the button is caught by the outside-dismiss listener (which
    // closes + timestamps), so debounce a reopen from that same click.
    if (performance.now() - (this._ctxMenuClosedAt || 0) < 200) return;
    const main = this._main;
    const cmds = main?._resolveRadialCommands?.() || [];
    if (!cmds.length) return;

    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'fixed', zIndex: '100000', minWidth: '176px',
      background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '8px',
      padding: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      font: '13px system-ui, sans-serif', userSelect: 'none',
    });
    cmds.forEach((cmd) => {
      const disabled = cmd.enabled === false;
      const item = document.createElement('button');
      item.textContent = cmd.label;
      Object.assign(item.style, {
        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
        background: 'none', borderRadius: '5px', textAlign: 'left',
        color: disabled ? '#6c7086' : '#cdd6f4',
        cursor: disabled ? 'default' : 'pointer', boxSizing: 'border-box',
        opacity: disabled ? '0.6' : '1',
      });
      if (!disabled) {
        item.addEventListener('pointerenter', () => { item.style.background = '#313244'; });
        item.addEventListener('pointerleave', () => { item.style.background = 'none'; });
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          cleanup();
          try { cmd.run?.(); } catch (e) { console.error('[TL ctxmenu] command failed', e); }
          this.draw();
        });
      }
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    // Anchor under the toolbar button (button coords are CSS-space on the canvas).
    const rect = this._canvas.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = rect.left + btn.x;
    let top  = rect.top + btn.y + btn.h + 4;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = rect.top + btn.y - mh - 4;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = Math.max(8, top) + 'px';

    const onDown = (ev) => { if (!menu.contains(ev.target)) cleanup(); };
    const onKey  = (ev) => { if (ev.key === 'Escape') cleanup(); };
    const cleanup = () => {
      this._ctxMenuClosedAt = performance.now();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      menu.remove();
    };
    setTimeout(() => { // defer so this opening click doesn't self-dismiss
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey, true);
    }, 0);
  }

  // ── Gutter header buttons (key ops + mode) — single row, y:27-47 ──
  _gutterBtnDefs() {
    const mode   = window._animKeyMode || 'transform';
    const hasSel = !!(window._animSelectedKeys?.length);
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
      btns.push({ id: 'delkey', icon: '', x, y: by, w: bw, h: bh, disabled: !hasSel, tooltip: 'Delete selected key(s)' }); x += bw + gap;
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
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

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
    const _hadEdit = this._editingBsName != null;
    this._editingBsName = null;
    if (_hadEdit) this.draw();

    if (ry < 5) {
      this._isResizingPanel = true;
      this._resizeStartScreenY = e.clientY;
      this._resizeStartHeight = this._cssHeight;
      return;
    }

    // Ruler strip + playhead cap (y 25-HEADER_H, x in timeline column).
    // Must be checked before toolbar buttons — several buttons extend into rx >= 200
    // but are drawn only at y 5-25, so the ruler row has priority here.
    const _tlX = 200;
    const _tlW = this._cssWidth - 220;
    if (ry >= 25 && ry < HEADER_H && rx >= _tlX && rx <= _tlX + _tlW) {
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
            case 'delkey': {
              if (reg && window._animSelectedKeys?.length) {
                // Snapshot full track state BEFORE deletion (all meshes, like keyframe-move undo).
                const _beforeState = new Map();
                reg.tracks.forEach((tr, mId) => { _beforeState.set(mId, TimelineHelper.cloneTrack(tr)); });

                // Perform deletion for ALL key types directly (no reg.deleteSelectedKeys —
                // that would push its own undo entry and doesn't handle blendshape).
                const _keysToDelete = window._animSelectedKeys.slice();
                // Group by meshId+type (for transform/shape) and meshId+name (for blendshape).
                const _trGroups = new Map(); // "meshId_type" -> [indices]
                const _bsGroups = new Map(); // "meshId:bsName" -> {meshId, name, indices[]}
                _keysToDelete.forEach(k => {
                  if (k.type === 'blendshape') {
                    const gk = `${k.meshId}:${k.name}`;
                    if (!_bsGroups.has(gk)) _bsGroups.set(gk, { meshId: k.meshId, name: k.name, indices: [] });
                    _bsGroups.get(gk).indices.push(k.index);
                  } else {
                    const gk = `${k.meshId}_${k.type}`;
                    if (!_trGroups.has(gk)) _trGroups.set(gk, []);
                    _trGroups.get(gk).push(k.index);
                  }
                });
                // Delete transform / shape keys (highest index first to keep indices stable)
                _trGroups.forEach((indices, gk) => {
                  const [meshIdStr, type] = gk.split('_');
                  const tr = reg.tracks.get(parseInt(meshIdStr, 10));
                  if (!tr) return;
                  indices.sort((a, b) => b - a);
                  indices.forEach(idx => {
                    if (type === 'transform' && tr.times && tr.times[idx] !== undefined) {
                      tr.times.splice(idx, 1);
                      tr.positions.splice(idx * 3, 3);
                      tr.quaternions.splice(idx * 4, 4);
                      tr.scales.splice(idx * 3, 3);
                    } else if (type === 'shape' && tr.shapeTimes && tr.shapeTimes[idx] !== undefined) {
                      tr.shapeTimes.splice(idx, 1);
                      if (tr.shapeOutputTimes) tr.shapeOutputTimes.splice(idx, 1);
                      tr.shapes.splice(idx, 1);
                    }
                  });
                  if (tr) reg.sortTrack(tr);
                });
                // Delete blendshape keys
                _bsGroups.forEach(({ meshId, name, indices }) => {
                  const tr = reg.tracks.get(meshId);
                  const bt = tr?.blendshapeTracks?.get(name);
                  if (!bt) return;
                  indices.sort((a, b) => b - a);
                  indices.forEach(idx => {
                    if (idx >= 0 && idx < bt.times.length) {
                      bt.times.splice(idx, 1);
                      bt.values.splice(idx, 1);
                    }
                  });
                });

                window._animSelectedKeys = [];
                window._animTransformBox = null;

                // Snapshot AFTER deletion
                const _afterState = new Map();
                reg.tracks.forEach((tr, mId) => { _afterState.set(mId, TimelineHelper.cloneTrack(tr)); });

                // Restore keyframe arrays in-place so non-keyframe data (blendshapes vertex
                // deltas, restPos, etc.) stays intact on the live track object.
                const _applyState = (stateMap) => {
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
                    // Restore blendshape keyframe tracks (times/values) without touching
                    // the vertex-delta Map (live.blendshapes) which is too large to snapshot.
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
                  const _m = this._main?.getMesh?.();
                  if (_m) reg.update(_m, true);
                  if (this._main?.render) this._main.render();
                  this.draw();
                };
                this._main.getStateManager().pushStateCustom(
                  () => { window._animSelectedKeys = []; _applyState(_beforeState); },
                  () => { window._animSelectedKeys = []; _applyState(_afterState); },
                  false,
                  'Delete Keys'
                );

                const _dm = this._main?.getMesh?.();
                if (_dm) reg.update(_dm, true);
              }
              break;
            }
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
                const prefix = singleSelected.type === 'transform' ? 'trans_' : '';
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
            this._openContextMenu(hit);
            break;
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
          case 'playpause':
            window._animPlaying = !window._animPlaying;
            if (!window._animPlaying && window._animationRegistry)
              window._animationRegistry.lastGlobalTime = null; // reset dt accumulator on pause
            break;
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
        }
        this.draw();
        return;
      }
      this._isDraggingPlayhead = true;
      this.handleInteraction(e);
    } else {
      // Gutter click/drag for Graph Editor channels in Desktop Timeline
      if (this._mode === 'graph' && rx < 200 && ry > HEADER_H) {
        const gutterY = HEADER_H + 4;
        const rowH = 22;
        const channel = Math.floor((ry - gutterY + this._gutterScrollY) / rowH);

        const reg = window._animationRegistry;
        const activeMesh = this._main.getMesh();
        const track = activeMesh ? reg.tracks.get(activeMesh.getID()) : null;
        const maxChannels = (track && track.shapeTimes && track.shapeTimes.length >= 2) ? 4 : 3;

        if (channel >= 0 && channel < maxChannels) {
          if (rx < 36) { // eye icon zone (widened for VR — easier to hit)
            if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];
            if (e.shiftKey) {
              this._soloChannel({ kind: channel === 3 ? 'shape' : 'transform', channel });
            } else {
              window._animChannelVisible[channel] = !window._animChannelVisible[channel];
              this._pruneSelectionToVisible();
              this.draw();
            }
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
              const _gutterRowTop = (HEADER_H + 4) + channel * rowH - this._gutterScrollY;
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
        const totalSlots = Math.max(4, tracks.length);
        const trackH = laneAreaH / totalSlots;
        const clickedLaneIdx = Math.floor((ry - headerH) / trackH);

        if (clickedLaneIdx >= 0 && clickedLaneIdx < tracks.length) {
          const [meshId, trackObj] = tracks[clickedLaneIdx];
          const laneMesh = this._main._meshes?.find(m => m.getID() === meshId);
          // Right-aligned "M" mute toggle (not on SR group rows). Trash removed —
          // select keys + Delete is the safe way to remove them.
          if (rx >= 176 && rx < 200 && !(laneMesh && laneMesh._isFrameGroup)) {
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
        const totalSlots = Math.max(4, tracks.length);
        const trackH = laneAreaH / totalSlots;

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
                const val = tr.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
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
                const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
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
                const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
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
                  const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
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
          this._isDraggingMarquee = true;
          this._marqueeStart = { x: rx, y: ry };
          this._marqueeEnd   = { x: rx, y: ry };
          return;
        }

        tracks.forEach(([meshId, trackObj], laneIdx) => {
          const ty = headerH + (laneIdx * trackH);
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
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'shape';
                  this._keyDragStartRx = rx;
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
            const ty2 = headerH + (laneIdx * trackH);
            let bIdx = 0;
            TimelineHelper.bsEntries(trackObj).forEach(([name, bTrack]) => {
              if (keyFound || !bTrack.times || _keyShow.blendshape === false) { bIdx++; return; }
              const bKy = ty2 + trackH / 2 + 20 + bIdx * 10;
              for (let i = 0; i < bTrack.times.length; i++) {
                const t = bTrack.times[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 10 && Math.abs(ry - bKy) < 10) {
                  this._isDraggingKeyframe = true;
                  this._activeKeyframeTrack = bTrack;
                  this._activeMeshId = meshId;
                  this._activeKeyframeIndex = i;
                  this._activeKeyframeType = 'blendshape';
                  this._activeBlendshapeName = name;
                  this._keyDragStartRx = rx;
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

        if (keyFound) return;
      }

      this._isDraggingMarquee = true;
      this._marqueeStart = { x: rx, y: ry };
      this._marqueeEnd = { x: rx, y: ry };
    }
  }

  onMouseMove(e) {
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
    if (this._tooltip && ry >= 5 && ry <= 25) {
      const hovered = this._toolbarBtnDefs().find(b => rx >= b.x && rx <= b.x + b.w);
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
      if (window._animSnapToFrame !== false) {
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
            (this._activeKeyframeType !== 'blendshape' || k.name === this._activeBlendshapeName));
          if (g && g.time !== undefined) grabbedBase = g.time;
        }
        dt = (Math.round((grabbedBase + dt) * fps) / fps) - grabbedBase;
      }
      
      if (window._animationRegistry) {
        if (this._mode === 'graph') {
          const targetVal = this.yToValue(ry);
          const dVal = targetVal - this._keyDragStartVal;
          
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
      
      const activeMesh = this._main.getMesh();
      if (activeMesh && window._animationRegistry && this._animTransformBoxInitialKeys) {
        const id = activeMesh.getID();
        const track = window._animationRegistry.tracks.get(id);
        if (track) {
          TimelineHelper.scaleKeysVertical(track, this._animTransformBoxInitialKeys, initialBox, targetVal, this._activeTransformHandle, window._animTransformBox);
          
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
        let t = Math.max(0, Math.min(mDurVal, newTime));
        // Respect snap-to-integer for the WHOLE transform box (edge/center/scale) —
        // the single-key drag already snapped, the box math didn't.
        if (window._animSnapToFrame !== false) { const fps = window._animFPS || 24; t = Math.round(t * fps) / fps; }
        if (initKey.type === 'transform' && track.times) {
          track.times[initKey.index] = t;
        } else if (initKey.type === 'shape' && track.shapeTimes) {
          track.shapeTimes[initKey.index] = t;
        } else if (initKey.type === 'blendshape') {
          const bt = track.blendshapeTracks?.get(initKey.name);
          if (bt?.times) bt.times[initKey.index] = t;
        }
      };
      const _setKeyVal = (track, initKey, newVal) => {
        if (initKey.type === 'transform' && track.positions && initKey.channel !== undefined) {
          track.positions[initKey.index * 3 + initKey.channel] = newVal;
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
          const newStartTime = Math.max(0, Math.min(mDurVal, initBox.startTime + dt));
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

          if (newEndTime > mDurVal) {
            window._animMasterDuration = newEndTime;
            window._animLoopEnd = newEndTime;
          }

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
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (!track) return;
                const relVal = initKey.val - initMidV;
                _setKeyVal(track, initKey, initMidV + relVal * scaleFactorY);
              });
            }
          }
        } else if (this._activeTransformHandle === 'center') {
          const dtClamped = Math.max(-initBox.startTime, Math.min(mDurVal - initBox.endTime, dt));
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

  onMouseUp(e) {
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
        const _getKeyTime = (key, track) => {
          if (key.type === 'transform') return track.times?.[key.index] ?? 0;
          if (key.type === 'shape') return track.shapeTimes?.[key.index] ?? 0;
          if (key.type === 'blendshape' && key.name) return track.blendshapeTracks?.get(key.name)?.times?.[key.index] ?? 0;
          return 0;
        };

        const selectedKeysWithTimes = window._animSelectedKeys ? window._animSelectedKeys.map(key => {
          const track = reg.tracks.get(key.meshId);
          if (!track) return { ...key, time: 0 };
          return { ...key, time: _getKeyTime(key, track) };
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

            const times = key.type === 'transform' ? track.times : track.shapeTimes;
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
          let t;
          if (key.type === 'transform') t = track?.times?.[key.index];
          else if (key.type === 'shape')  t = track?.shapeTimes?.[key.index];
          else if (key.type === 'blendshape') t = track?.blendshapeTracks?.get(key.name)?.times?.[key.index];
          return { ...key, time: t ?? 0 };
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
            }
            
            if (curTime !== undefined && Math.abs(curTime - initKey.time) > 0.001) {
              commands.push({
                meshId: initKey.meshId,
                type: initKey.type,
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
                const times = cmd.type === 'transform' ? tr.times : tr.shapeTimes;
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
                const times = cmd.type === 'transform' ? tr.times : tr.shapeTimes;
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
      
      if (this._mode === 'graph') {
        loopStart = this._viewStart !== undefined ? this._viewStart : loopStart;
        visibleDuration = this._viewDuration !== undefined ? this._viewDuration : visibleDuration;
      }
      
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

    if (this._mode === 'dope') {
      loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
      const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
      visibleDuration = Math.max(0.1, loopEnd - loopStart);
    }
    
    const tlX = 200;
    const tlW = this._cssWidth - 200;

    const tMin = loopStart + ((x1 - tlX) / tlW) * visibleDuration;
    const tMax = loopStart + ((x2 - tlX) / tlW) * visibleDuration;

    if (this._mode === 'graph') {
      const vMax = this.yToValue(y1);
      const vMin = this.yToValue(y2);
      
      const beforeSelection = this._undoSelectionBeforeMarquee || [];
      
      const newKeys = [];
      const activeMesh = this._main.getMesh();
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
    const totalSlots = Math.max(4, tracks.length);
    const trackH = laneAreaH / totalSlots;


    
    const laneMin = Math.floor((y1 - headerH) / trackH);
    const laneMax = Math.floor((y2 - headerH) / trackH);

    const newKeys = reg.getKeysInTimeRange(tMin, tMax, laneMin, laneMax);

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

    // Hidden key types (bottom-strip visibility off) are not marquee-selectable — a
    // hidden transform/shape/etc. key must not be swept up alongside a visible one.
    const _mShow = window._animKeyShow || { transform: true, shape: true, blendshape: true, shaperep: true };
    const _typeVisible = (t) => t === 'transform' ? _mShow.transform !== false
                             : t === 'shape'     ? _mShow.shape !== false
                             : t === 'blendshape' ? _mShow.blendshape !== false
                             : t === 'sr'        ? _mShow.shaperep !== false
                             : true; // 'frame' (voxel cel) has no filter yet
    newKeys.forEach(nk => {
      if (!_typeVisible(nk.type)) return;
      const alreadySelected = window._animSelectedKeys && window._animSelectedKeys.some(k =>
        k.meshId === nk.meshId && k.type === nk.type &&
        (nk.type === 'sr' ? k.childId === nk.childId : k.index === nk.index) &&
        (nk.type !== 'blendshape' || k.name === nk.name));
      if (!alreadySelected) window._animSelectedKeys.push(nk);
    });

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
               && this._lastMouseY >= 5    && this._lastMouseY <= 25;
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

    // --- Frame ruler strip (y 28..50) ---
    const rulerY = 28;
    const rulerH = headerH - rulerY; // 22px
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
  }
}
