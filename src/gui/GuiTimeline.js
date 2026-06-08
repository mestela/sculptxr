import TimelineHelper from './TimelineHelper.js';

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

    this._mode = 'dope'; // 'dope' or 'graph'
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
    this._lastMouseX = -1;
    this._lastMouseY = -1;
    this._isMouseOver = false;
    window._animTiedTangents = true;
    this._viewStart = undefined;
    this._viewDuration = undefined;
    this.initDOM();
    this.startLoop();
  }

  initDOM() {
    this._container = document.createElement('div');
    this._container.style.position = 'fixed';
    this._container.style.bottom = '0';
    this._container.style.left = '0';
    this._container.style.height = '150px'; // Slightly shorter for desktop
    this._container.style.backgroundColor = '#181818';
    this._container.style.zIndex = '2000'; // High z-index to be on top
    this._container.style.display = 'none'; // Hidden by default
    this._container.style.borderTop = '2px solid #444';

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
      this._canvas.setPointerCapture(e.pointerId); // keep move/up on this element
      this._isMouseOver = true;
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

    this.onResize();
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
    return TimelineHelper.valueToY(val, this._cssHeight, 50, this._zoomY, this._panY);
  }

  yToValue(y) {
    return TimelineHelper.yToValue(y, this._cssHeight, 50, this._zoomY, this._panY);
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
    const headerH = 50;
    const fps = window._animFPS || 24;
    const currentTimeVal = window._animCurrentTime !== undefined ? window._animCurrentTime : 0;
    const snappedTime = Math.round(currentTimeVal * fps) / fps;
    const playheadAlpha = (snappedTime - loopStart) / visibleDuration;
    const playheadX = tlX + playheadAlpha * tlW;

    if (playheadX >= tlX && playheadX <= tlX + tlW) {
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, headerH);
      ctx.lineTo(playheadX, this._cssHeight);
      ctx.stroke();

      const capStartY = 25;
      ctx.fillStyle = '#4488ff';
      ctx.beginPath();
      ctx.moveTo(playheadX - 8, capStartY);
      ctx.lineTo(playheadX + 8, capStartY);
      ctx.lineTo(playheadX + 8, headerH - 5);
      ctx.lineTo(playheadX, headerH);
      ctx.lineTo(playheadX - 8, headerH - 5);
      ctx.closePath();
      ctx.fill();

      const curT = Math.round(currentTimeVal * fps);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(curT, playheadX, 37);
    }
  }

  drawGraph(ctx) {
    const headerH = 50;
    const graphH = this._cssHeight - headerH;
    const tlX = 200;
    const tlW = this._cssWidth - 200;

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
    const gutterY = headerH + 10;
    const rowH = 30;
    const colors = ['#ff4444', '#44ff44', '#4444ff'];
    const labels = ['X Location', 'Y Location', 'Z Location'];
    
    const activeMeshForGutter = this._main.getMesh();
    const idForGutter = activeMeshForGutter ? activeMeshForGutter.getID() : null;
    const trackForGutter = idForGutter ? reg.tracks.get(idForGutter) : null;
    
    if (trackForGutter && trackForGutter.shapeTimes && trackForGutter.shapeTimes.length >= 2) {
      colors.push('#ff00ff');
      labels.push('ShotSculpt');
    }
    
    if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];

    for (let channel = 0; channel < labels.length; channel++) {
      const ry = gutterY + channel * rowH;
      
      // Color bar
      ctx.fillStyle = colors[channel];
      ctx.fillRect(5, ry + 5, 5, 20);
      
      // Eye Icon
      const isVisible = window._animChannelVisible[channel];
      
      ctx.save();
      ctx.translate(20, ry + 3);
      ctx.scale(0.8, 0.8); // Scale down a bit
      ctx.strokeStyle = isVisible ? '#00ffff' : '#555';
      ctx.lineWidth = 1.5;
      const eyePath = new Path2D('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z');
      ctx.stroke(eyePath);
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.fillStyle = isVisible ? '#00ffff' : '#555';
      ctx.fill();
      ctx.restore();
      
      // Label
      ctx.fillStyle = isVisible ? '#ccc' : '#666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[channel], 50, ry + 15);
    }

    // Blendshape channel rows
    if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
    const bsColors = ['#ff8844', '#44ffcc', '#ffdd44', '#aa44ff', '#ff44bb', '#44bbff'];
    if (trackForGutter && trackForGutter.blendshapeTracks) {
      let bsIdx = 0;
      trackForGutter.blendshapeTracks.forEach((_, name) => {
        const rowIdx = labels.length + bsIdx;
        const ry = gutterY + rowIdx * rowH;
        const color = bsColors[bsIdx % bsColors.length];
        const isVisible = window._animBsChannelVisible[name] !== false;

        ctx.fillStyle = color;
        ctx.fillRect(5, ry + 5, 5, 20);

        ctx.save();
        ctx.translate(20, ry + 3);
        ctx.scale(0.8, 0.8);
        ctx.strokeStyle = isVisible ? color : '#555';
        ctx.lineWidth = 1.5;
        const eyePath = new Path2D('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z');
        ctx.stroke(eyePath);
        ctx.beginPath();
        ctx.arc(12, 12, 3, 0, Math.PI * 2);
        ctx.fillStyle = isVisible ? color : '#555';
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = isVisible ? '#ccc' : '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 50, ry + 15);
        bsIdx++;
      });
    }


    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(tlX, headerH, tlW, this._cssHeight - headerH);
    ctx.clip();

    // 1. Draw Vertical Grid Lines (Time)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const totalSeconds = Math.ceil(mDurVal);
    for (let s = 0; s <= totalSeconds; s++) {
      if (s >= loopStart && s <= loopEnd) {
        const gridX = tlX + ((s - loopStart) / visibleDuration) * tlW;
        ctx.beginPath();
        ctx.moveTo(gridX, headerH);
        ctx.lineTo(gridX, this._cssHeight);
        ctx.stroke();
      }
    }



    // 3. Draw Zero Axis
    const zeroY = this.valueToY(0);
    if (zeroY >= headerH && zeroY <= this._cssHeight) {
      ctx.strokeStyle = '#666';
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
          
          ctx.strokeStyle = colors[channel];
          ctx.lineWidth = 2;
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
            else ctx.fillStyle = '#888888'; // Gray

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

          ctx.strokeStyle = '#888888'; // Revert to gray!
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
              else ctx.fillStyle = '#888888'; // Gray
              
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
              else ctx.fillStyle = '#888888'; // Gray
              
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
            ctx.strokeStyle = '#ff00ff'; // Magenta for Time Curve
          ctx.lineWidth = 2;
          
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
              ctx.strokeStyle = '#888888';
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
              else ctx.fillStyle = '#888888'; // Gray
              
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
              else ctx.fillStyle = '#888888'; // Gray
              
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
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        }
      }

      // Draw blendshape weight curves
      if (track && track.blendshapeTracks) {
        let bsIdx = 0;
        track.blendshapeTracks.forEach((bTrack, name) => {
          const isVisible = window._animBsChannelVisible?.[name] !== false;
          if (!isVisible || !bTrack.times || bTrack.times.length === 0) { bsIdx++; return; }
          const color = bsColors[bsIdx % bsColors.length];

          // Curve line — bezier segments
          if (bTrack.times.length >= 2) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
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

            ctx.fillStyle = isSelected ? '#ffff00' : (isHovered ? '#ffffff' : color);
            ctx.beginPath();
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x + 5, y);
            ctx.lineTo(x, y + 5);
            ctx.lineTo(x - 5, y);
            ctx.closePath();
            ctx.fill();
            if (isSelected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke(); }
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
        if (track && track.times) {
          let minT = Infinity;
          let maxT = -Infinity;
          let minV = Infinity;
          let maxV = -Infinity;
          
          const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
          const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

          window._animSelectedKeys.forEach(sk => {
            if (sk.meshId === id && sk.type === 'transform') {
              const t = track.times[sk.index];
              const val = track.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
              
              if (t < minT) minT = t;
              if (t > maxT) maxT = t;
              if (val < minV) minV = val;
              if (val > maxV) maxV = val;
            }
          });
          
          if (minT !== Infinity && maxT !== Infinity && minV !== Infinity && maxV !== Infinity) {
            const wObj = { x: 0, y: 0, w: this._cssWidth, h: this._cssHeight };
            const tBox = { startTime: minT, endTime: maxT, minV, maxV };
            TimelineHelper.drawTransformBox(ctx, tBox, wObj, 50, 200, this._cssWidth - 200, this._viewStart, this._viewDuration, (val) => this.valueToY(val));
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
      const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
      const val = sk.type === 'transform' ? tr.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)] : 0;
      return { ...sk, time, val };
    });
  }

  getInitialTimesForTransform(selectedKeys, reg) {
    return selectedKeys.map(sk => {
      const tr = reg.tracks.get(sk.meshId);
      const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
      return { ...sk, time };
    });
  }

  handleGraphMouseDown(rx, ry) {
    const reg = window._animationRegistry;
    if (!reg) return;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;
    const id = activeMesh.getID();
    const track = reg.tracks.get(id);
    if (!track) return;

    const headerH = 50;
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
      
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
      const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

      window._animSelectedKeys.forEach(sk => {
        if (sk.meshId === id && sk.type === 'transform') {
          const t = track.times[sk.index];
          const val = track.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)];
          
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
          if (val < minV) minV = val;
          if (val > maxV) maxV = val;
        }
      });
      
      if (minT !== Infinity && maxT !== Infinity && minV !== Infinity && maxV !== Infinity) {
        const kxLeft = tlX + ((minT - loopStart) / visibleDuration) * tlW;
        const kxRight = tlX + ((maxT - loopStart) / visibleDuration) * tlW;
        const kyTop = this.valueToY(maxV);
        const kyBottom = this.valueToY(minV);
        
        // Check Top handle
        if (Math.abs(rx - (kxLeft + (kxRight - kxLeft)/2)) < 10 && Math.abs(ry - kyTop) < 10) {
          this._activeTransformHandle = 'top';
          this._transformStartRy = ry;
          this._animTransformInitialBox = { minV, maxV };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
          return;
        }
        // Check Bottom handle
        if (Math.abs(rx - (kxLeft + (kxRight - kxLeft)/2)) < 10 && Math.abs(ry - kyBottom) < 10) {
          this._activeTransformHandle = 'bottom';
          this._transformStartRy = ry;
          this._animTransformInitialBox = { minV, maxV };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
          return;
        }
        // Check Left handle
        if (Math.abs(rx - kxLeft) < 10 && ry >= kyTop && ry <= kyBottom) {
          this._activeTransformHandle = 'left';
          this._transformStartRx = rx;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
          return;
        }
        // Check Right handle
        if (Math.abs(rx - kxRight) < 10 && ry >= kyTop && ry <= kyBottom) {
          this._activeTransformHandle = 'right';
          this._transformStartRx = rx;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT };
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
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
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
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
          this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
          return;
        }
      }
    }

    if (track.times && track.positions) {
      for (let i = 0; i < track.times.length; i++) {
        const t = track.times[i];
        const x = tlX + ((t - loopStart) / visibleDuration) * tlW;

        for (let c = 0; c < 3; c++) {
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
    if (track.shapeTimes && track.shapeOutputTimes) {
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

    // Check Blendshape Keys in Graph Mode
    if (track.blendshapeTracks) {
      let bsIdx = 0;
      let found = false;
      track.blendshapeTracks.forEach((bTrack, name) => {
        if (found) { bsIdx++; return; }
        if (!bTrack.times) { bsIdx++; return; }
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

    this._isDraggingMarquee = true;
    this._marqueeStart = { x: rx, y: ry };
    this._marqueeEnd = { x: rx, y: ry };
    this._undoSelectionBeforeMarquee = window._animSelectedKeys ? window._animSelectedKeys.map(k => ({...k})) : [];
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
    const headerH = 50;
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
      this._viewStart = Math.max(0, minT - duration * 0.1);
      this._viewDuration = Math.max(0.1, duration * 1.2);
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
  openVRView() {
    const VR_W = 900, VR_H = 150;
    // Size the 2D canvas directly — no DOM display changes that could trigger
    // a window-resize event and inadvertently call renderer.setSize() in XR mode.
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width  = VR_W * dpr;
    this._canvas.height = VR_H * dpr;
    this._cssWidth  = VR_W;
    this._cssHeight = VR_H;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._visible = true;
    this.draw();
  }

  closeVRView() {
    this._visible = false;
  }

  startLoop() {
    const loop = () => {
      if (this._visible) {
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }



  onMouseDown(e) {
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    if (ry < 5) {
      this._isResizingPanel = true;
      this._resizeStartScreenY = e.clientY;
      this._resizeStartHeight = this._cssHeight;
      return;
    }

    // Ruler strip + playhead cap (y 25-50, x in timeline column).
    // Must be checked before toolbar buttons — several buttons extend into rx >= 200
    // but are drawn only at y 5-25, so the ruler row has priority here.
    const _tlX = 200;
    const _tlW = this._cssWidth - 220;
    if (ry >= 25 && ry < 50 && rx >= _tlX && rx <= _tlX + _tlW) {
      this._isDraggingPlayhead = true;
      this.handleInteraction(e);
      return;
    }

    if (ry < 50) {
      // Fit View button
      const fitBtnX = this._mode === 'graph' ? 245 : 115;
      if (rx >= fitBtnX && rx <= fitBtnX + 60) {
        this.autoFitGraph();
        this.draw();
        return;
      }
      // Frame Timeline button — snap view to full loop range
      const frameBtnX = fitBtnX + 68;
      if (rx >= frameBtnX && rx <= frameBtnX + 80) {
        const mDur = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
        const ls = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
        const le = window._animLoopEnd !== undefined ? window._animLoopEnd : mDur;
        this._viewStart = ls;
        this._viewDuration = Math.max(0.1, le - ls);
        this.draw();
        return;
      }
      // Tangents toggle (graph mode only)
      if (this._mode === 'graph') {
        const tanBtnX = frameBtnX + 88;
        if (rx >= tanBtnX && rx <= tanBtnX + 65) {
          window._animShowTangents = !window._animShowTangents;
          this.draw();
          return;
        }
      }
      // Transform Box toggle (both modes)
      const tboxBtnX = frameBtnX + 88 + (this._mode === 'graph' ? 73 : 0);
      if (rx >= tboxBtnX && rx <= tboxBtnX + 60) {
        window._animShowTransformBox = !window._animShowTransformBox;
        this.draw();
        return;
      }
      const snapBtnX = tboxBtnX + 68;
      if (rx >= snapBtnX && rx <= snapBtnX + 55) {
        window._animSnapToFrame = window._animSnapToFrame === false ? true : false;
        this.draw();
        return;
      }
      if (rx >= 10 && rx <= 100) {
        this._mode = this._mode === 'graph' ? 'dope' : 'graph';
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
        this.draw();
        return;
      }
      if (rx >= 120 && rx <= 230) {
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
            this.draw();
          }
        }
        return;
      }
      this._isDraggingPlayhead = true;
      this.handleInteraction(e);
    } else {
      // Gutter click for Graph Editor channels in Desktop Timeline
      if (this._mode === 'graph' && rx < 200 && ry > 50) {
        // Fit View button moved to toolbar — handled in ry < 50 block below

        const gutterY = 50 + 10;
        const rowH = 30;
        const channel = Math.floor((ry - gutterY) / rowH);
        
        const reg = window._animationRegistry;
        const activeMesh = this._main.getMesh();
        const track = activeMesh ? reg.tracks.get(activeMesh.getID()) : null;
        const maxChannels = (track && track.shapeTimes && track.shapeTimes.length >= 2) ? 4 : 3;

        if (channel >= 0 && channel < maxChannels) {
          if (rx >= 5 && rx <= 150) {
            if (window._animChannelVisible === undefined) window._animChannelVisible = [true, true, true, true];
            window._animChannelVisible[channel] = !window._animChannelVisible[channel];
            this.draw();
            return;
          }
        }

        // Blendshape channel visibility toggle
        const bsOffset = channel - maxChannels;
        if (bsOffset >= 0 && track && track.blendshapeTracks && rx >= 5 && rx <= 150) {
          if (!window._animBsChannelVisible) window._animBsChannelVisible = {};
          const bsNames = [...track.blendshapeTracks.keys()];
          const bsName = bsNames[bsOffset];
          if (bsName !== undefined) {
            window._animBsChannelVisible[bsName] = window._animBsChannelVisible[bsName] === false ? true : false;
            this.draw();
            return;
          }
        }
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
        const tracks = Array.from(reg.tracks.entries());
        const headerH = 50;
        const laneAreaH = this._cssHeight - headerH;
        const totalSlots = Math.max(4, tracks.length);
        const trackH = laneAreaH / totalSlots;
        const clickedLaneIdx = Math.floor((ry - headerH) / trackH);

        if (clickedLaneIdx >= 0 && clickedLaneIdx < tracks.length) {
          const [meshId, trackObj] = tracks[clickedLaneIdx];
          if (rx >= 80 && rx < 120) {
            trackObj.muted = !trackObj.muted;
            this.draw();
            return; // Don't start marquee
          } else if (rx >= 120 && rx <= 160) {
            window._vrConfirm(`Delete track for Object ${meshId}?`, () => {
              window._animationRegistry.deleteTrack(meshId);
              this.draw();
            });
            return; // Don't start marquee
          }
        }
      }

      // Check if clicked on a key!
      if (reg) {
        const tracks = Array.from(reg.tracks.entries());
        const headerH = 50;
        const laneAreaH = this._cssHeight - headerH;
        const totalSlots = Math.max(4, tracks.length);
        const trackH = laneAreaH / totalSlots;

        const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
        const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
        const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
        const visibleDuration = Math.max(0.1, loopEnd - loopStart);
        
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
              this._animTransformBoxInitialKeys = this.getInitialKeysForTransform(window._animSelectedKeys, reg, selChannel);
              
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

        tracks.forEach(([meshId, trackObj], laneIdx) => {
          const ty = headerH + (laneIdx * trackH);
          const ky = ty + trackH / 2;
          
          if (ry >= ty && ry <= ty + trackH) {
            if (trackObj.times) {
              for (let i = 0; i < trackObj.times.length; i++) {
                const t = trackObj.times[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 10 && Math.abs(ry - ky) < 10) {
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
            if (!keyFound && trackObj.shapeTimes && window._animShowTangents) {
              const ky = ty + trackH / 2;
              for (let i = 0; i < trackObj.shapeTimes.length; i++) {
                const t = trackObj.shapeTimes[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                
                const rightVal = trackObj.tangentOffsets ? trackObj.tangentOffsets[`${i}_right`] : undefined;
                const leftVal = trackObj.tangentOffsets ? trackObj.tangentOffsets[`${i}_left`] : undefined;
                const rightXOff = rightVal !== undefined ? rightVal : 25;
                const leftXOff = leftVal !== undefined ? leftVal : -25;
                
                // Check right handle
                if (i < trackObj.shapeTimes.length - 1) {
                  if (Math.abs(rx - (kx + rightXOff)) < 10 && Math.abs(ry - ky) < 10) {
                    this._isDraggingTangent = true;
                    this._activeTangentTrack = trackObj;
                    this._activeTangentIndex = i;
                    this._activeTangentSide = 'right';
                    this._activeTangentKx = kx;
                    this._activeTangentKy = ky;
                    this._activeTangentType = 'shape';
                    return;
                  }
                }
                
                // Check left handle
                if (i > 0) {
                  if (Math.abs(rx - (kx + leftXOff)) < 10 && Math.abs(ry - ky) < 10) {
                    this._isDraggingTangent = true;
                    this._activeTangentTrack = trackObj;
                    this._activeTangentIndex = i;
                    this._activeTangentSide = 'left';
                    this._activeTangentKx = kx;
                    this._activeTangentKy = ky;
                    this._activeTangentType = 'shape';
                    return;
                  }
                }
              }
            }

            if (!keyFound && trackObj.shapeTimes) {
              for (let i = 0; i < trackObj.shapeTimes.length; i++) {
                const t = trackObj.shapeTimes[i];
                const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
                if (Math.abs(rx - kx) < 10 && Math.abs(ry - ky) < 10) {
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

          }
        });
        // Blendshape keys render below lane centre — check outside the lane-bounds gate
        if (!keyFound) {
          const bsTracks = Array.from(reg.tracks.entries());
          bsTracks.forEach(([meshId, trackObj]) => {
            if (keyFound) return;
            if (!trackObj.blendshapeTracks) return;
            const laneIdx = bsTracks.findIndex(([id]) => id === meshId);
            const ty2 = headerH + (laneIdx * trackH);
            let bIdx = 0;
            trackObj.blendshapeTracks.forEach((bTrack, name) => {
              if (keyFound || !bTrack.times) { bIdx++; return; }
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
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    
    this._lastMouseX = rx;
    this._lastMouseY = ry;
    

    
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
      let loopStart = this._viewStart;
      let visibleDuration = this._viewDuration;
      
      if (this._mode === 'dope') {
        loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
        const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
        const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
        visibleDuration = Math.max(0.1, loopEnd - loopStart);
      }

      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));
      const targetTime = loopStart + t * visibleDuration;

      let dt = targetTime - this._keyDragStartTime;
      if (window._animSnapToFrame !== false) {
        const fps = window._animFPS || 24;
        dt = Math.round(dt * fps) / fps;
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
      const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
      const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
      const visibleDuration = Math.max(0.1, loopEnd - loopStart);
      
      const vDur = visibleDuration;
      
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
            this._animTransformBoxInitialKeys.forEach((initKey, idx) => {
              const track = window._animationRegistry.tracks.get(initKey.meshId);
              if (track && initKey.type === 'transform' && track.times) {
                const relTime = initKey.time - initBox.endTime;
                const newTime = initBox.endTime + relTime * scaleFactor;
                const finalTime = Math.max(0, Math.min(mDurVal, newTime));
                
                track.times[initKey.index] = finalTime;
              }
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
              if (track && initKey.type === 'transform' && track.times) {
                const relTime = initKey.time - initBox.startTime;
                const newTime = initBox.startTime + relTime * scaleFactor;
                track.times[initKey.index] = Math.max(0, Math.min(mDurVal, newTime));
              }
            });
          }
        } else if (this._activeTransformHandle === 'scale_center') {
          const initMid = (initBox.startTime + initBox.endTime) / 2;
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
            tBox.endTime = initMid + (initBox.endTime - initMid) * scaleFactor;
            
            if (this._animTransformBoxInitialKeys) {
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (track && initKey.type === 'transform' && track.times) {
                  const relTime = initKey.time - initMid;
                  const newTime = initMid + relTime * scaleFactor;
                  track.times[initKey.index] = Math.max(0, Math.min(mDurVal, newTime));
                }
              });
            }
          } else if (this._scaleCenterLock === 'vertical' && initBox.minV !== undefined) {
            const scaleFactorY = 1.0 - dy / 150.0;
            
            if (this._animTransformBoxInitialKeys) {
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (track && initKey.type === 'transform' && track.positions) {
                  const relVal = initKey.val - initMidV;
                  const newVal = initMidV + relVal * scaleFactorY;
                  track.positions[initKey.index * 3 + (initKey.channel !== undefined ? initKey.channel : 0)] = newVal;
                }
              });
            }
          }
        } else if (this._activeTransformHandle === 'center') {
          const dtClamped = Math.max(-initBox.startTime, Math.min(mDurVal - initBox.endTime, dt));
          tBox.startTime = initBox.startTime + dtClamped;
          tBox.endTime = initBox.endTime + dtClamped;
          
          if (this._animTransformBoxInitialKeys) {
            this._animTransformBoxInitialKeys.forEach(initKey => {
              const track = window._animationRegistry.tracks.get(initKey.meshId);
              if (track && initKey.type === 'transform' && track.times) {
                track.times[initKey.index] = Math.max(0, Math.min(mDurVal, initKey.time + dtClamped));
              }
            });
            
            if (this._mode === 'graph' && this._keyDragStartVal !== undefined) {
              const targetVal = this.yToValue(this._lastMouseY);
              const dVal = targetVal - this._keyDragStartVal;
              
              this._animTransformBoxInitialKeys.forEach(initKey => {
                const track = window._animationRegistry.tracks.get(initKey.meshId);
                if (track && initKey.type === 'transform' && track.positions && initKey.channel !== undefined) {
                  track.positions[initKey.index * 3 + initKey.channel] = (initKey.val !== undefined ? initKey.val : 0) + dVal;
                }
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
    
    if (rx >= tlX && rx <= tlX + tlW && ry >= 50) {
      this.draw();
    }
  }

  onMouseUp(e) {
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
          const times = key.type === 'transform' ? track.times : track.shapeTimes;
          return { ...key, time: times ? times[key.index] : 0 };
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
            const times = key.type === 'transform' ? track.times : track.shapeTimes;
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
    
    this._isDraggingPlayhead = false;
    this._isDraggingMarquee = false;
    this._marqueeStart = null;
    this._marqueeEnd = null;
    this._isPanningGraph = false;
    this._isZoomingGraph = false;
    this._isResizingPanel = false;
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
    
    const headerH = 50;

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
        if (track && track.times) {
          newKeys.push(...TimelineHelper.getKeysInGraphRange(reg, id, tMin, tMax, vMin, vMax));
        }
      }
      if (!addMode) window._animSelectedKeys = [];
      window._animSelectedKeys.push(...newKeys);
      
      if (window._animSelectedKeys && window._animSelectedKeys.length > 1) {
        let minT = Infinity;
        let maxT = -Infinity;
        window._animSelectedKeys.forEach(k => {
          const track = reg.tracks.get(k.meshId);
          if (track && track.times) {
            const t = track.times[k.index];
            if (t < minT) minT = t;
            if (t > maxT) maxT = t;
          }
        });
        if (minT !== Infinity && maxT !== Infinity) {
          window._animTransformBox = { startTime: minT, endTime: maxT };
        }
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
    const tracks = Array.from(reg.tracks.entries());
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
        if (!bTrack.times) return;
        for (let i = 0; i < bTrack.times.length; i++) {
          const t = bTrack.times[i];
          if (t >= tMin && t <= tMax) newKeys.push({ meshId, type: 'blendshape', name, index: i });
        }
      });
    });

    newKeys.forEach(nk => {
      const alreadySelected = window._animSelectedKeys && window._animSelectedKeys.some(k =>
        k.meshId === nk.meshId && k.type === nk.type && k.index === nk.index &&
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
    ctx.fillStyle = '#181818';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    
    if (!window._animationRegistry) {
      ctx.fillStyle = '#aaa';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No Animation Registry found.', w.w / 2, w.h / 2);
      return;
    }

    const reg = window._animationRegistry;
    const tracks = Array.from(reg.tracks.entries());
    
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
    }
    const loopEnd = loopStart + visibleDuration;

    const tlX = 200; // Width allocated for track names
    const tlW = w.w - 200;

    // --- 1. Draw Top Transport Header Strip ---
    const headerH = 50;
    ctx.fillStyle = '#222';
    ctx.fillRect(w.x, w.y, w.w, headerH);

    // Resize grip — 3 dots centred at top edge
    ctx.fillStyle = '#555';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(w.w / 2 + i * 8, 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- helper: draw a rounded toolbar button ---
    const _drawBtn = (bx, by, bw, bh, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 3);
      ctx.fill();
    };

    // Draw Mode Toggle Button
    _drawBtn(10, 5, 90, 20, '#444');
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._mode === 'graph' ? 'Mode: Graph' : 'Mode: Dope', 55, 15);

    // Tied Tangents Toggle
    if (this._mode === 'graph') {
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
      let isTied = true;
      if (singleSelected) {
        const track = reg.tracks.get(singleSelected.meshId);
        if (track && track.tangentOffsets) {
          const prefix = singleSelected.type === 'transform' ? 'trans_' : '';
          isTied = track.tangentOffsets[`${prefix}${singleSelected.index}_tied`] !== false;
        }
      }

      _drawBtn(120, 5, 110, 20, singleSelected ? '#444' : '#2a2a2a');
      ctx.fillStyle = '#fff';
      ctx.fillText(isTied ? 'Tangents: Tied' : 'Tangents: Broken', 175, 15);
    }

    // Fit View button (toolbar, always visible)
    const fitBtnX = this._mode === 'graph' ? 245 : 115;
    const fitHovered = this._lastMouseX >= fitBtnX && this._lastMouseX <= fitBtnX + 60 &&
                       this._lastMouseY >= 5 && this._lastMouseY <= 25;
    _drawBtn(fitBtnX, 5, 60, 20, fitHovered ? '#666' : '#444');
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Fit View', fitBtnX + 30, 15);

    // Frame Timeline button — resets view to full loop range
    const frameBtnX = fitBtnX + 68;
    const frameHovered = this._lastMouseX >= frameBtnX && this._lastMouseX <= frameBtnX + 80 &&
                         this._lastMouseY >= 5 && this._lastMouseY <= 25;
    _drawBtn(frameBtnX, 5, 80, 20, frameHovered ? '#666' : '#444');
    ctx.fillStyle = '#fff';
    ctx.fillText('Frame Timeline', frameBtnX + 40, 15);

    // Tangents toggle button (graph mode only)
    if (this._mode === 'graph') {
      const tanBtnX = frameBtnX + 88;
      const tanOn = !!window._animShowTangents;
      const tanHovered = this._lastMouseX >= tanBtnX && this._lastMouseX <= tanBtnX + 65 &&
                         this._lastMouseY >= 5 && this._lastMouseY <= 25;
      _drawBtn(tanBtnX, 5, 65, 20, tanOn ? '#4488ff' : (tanHovered ? '#666' : '#444'));
      ctx.fillStyle = '#fff';
      ctx.fillText('Tangents', tanBtnX + 32, 15);
    }

    // Transform Box toggle (both modes)
    const tboxBtnX = frameBtnX + 88 + (this._mode === 'graph' ? 73 : 0);
    const tboxOn = !!window._animShowTransformBox;
    const tboxHovered = this._lastMouseX >= tboxBtnX && this._lastMouseX <= tboxBtnX + 60 &&
                        this._lastMouseY >= 5 && this._lastMouseY <= 25;
    _drawBtn(tboxBtnX, 5, 60, 20, tboxOn ? '#4488ff' : (tboxHovered ? '#666' : '#444'));
    ctx.fillStyle = '#fff';
    ctx.fillText('T.Box', tboxBtnX + 30, 15);

    // Snap to Frames toggle (both modes, default on)
    const snapBtnX = tboxBtnX + 68;
    const snapOn = window._animSnapToFrame !== false;
    const snapHovered = this._lastMouseX >= snapBtnX && this._lastMouseX <= snapBtnX + 55 &&
                        this._lastMouseY >= 5 && this._lastMouseY <= 25;
    _drawBtn(snapBtnX, 5, 55, 20, snapOn ? '#4488ff' : (snapHovered ? '#666' : '#444'));
    ctx.fillStyle = '#fff';
    ctx.fillText('Snap', snapBtnX + 27, 15);

    const fps = window._animFPS || 24;
    const curT = window._animCurrentTime ? Math.round(window._animCurrentTime * fps) : 0;
    const loopStartF = Math.round(loopStart * fps);
    const loopEndF = Math.round(loopEnd * fps);

    // --- Frame ruler strip (y 28..50) ---
    const rulerY = 28;
    const rulerH = headerH - rulerY; // 22px
    ctx.fillStyle = '#1a1a1a';
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
      ctx.strokeStyle = isMajor ? '#666' : '#3a3a3a';
      ctx.beginPath();
      ctx.moveTo(rx, w.y + headerH - tickH);
      ctx.lineTo(rx, w.y + headerH);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = '#888';
        ctx.fillText(`${f}`, rx, w.y + rulerY + 2);
      }
    }

    // Ruler border line
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tlX, w.y + rulerY);
    ctx.lineTo(tlX + tlW, w.y + rulerY);
    ctx.stroke();

    // Show status or value of closest key to playhead
    ctx.textBaseline = 'middle';
    if (reg.isCountingIn || reg.isRecording) {
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(window._animStatusText || '', w.w / 2, w.y + 40);
    } else {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        const id = activeMesh.getID();
        const track = reg.tracks.get(id);
        if (track) {
          const fps = window._animFPS || 24;
          const curTime = window._animCurrentTime || 0;
          const snappedTime = Math.round(curTime * fps) / fps;
          
          // Check if a SINGLE key is selected!
          const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
          
          if (singleSelected && singleSelected.meshId === id) {
            const kIdx = singleSelected.index;
            const t = singleSelected.type === 'transform' ? track.times[kIdx] : track.shapeTimes[kIdx];
            const frame = Math.round(t * fps);
            
            if (singleSelected.type === 'shape') {
              const outTime = track.shapeOutputTimes ? track.shapeOutputTimes[kIdx] : t;
              ctx.fillStyle = '#ffcc00';
              ctx.font = '12px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`key ${frame}: Output Frame = ${(outTime * fps).toFixed(2)}`, w.w / 2, w.y + headerH / 2);
            } else {
              let px = 0, py = 0, pz = 0;
              if (singleSelected.type === 'transform' && track.positions && (kIdx * 3 + 2) < track.positions.length) {
                px = track.positions[kIdx * 3];
                py = track.positions[kIdx * 3 + 1];
                pz = track.positions[kIdx * 3 + 2];
              }
              px = px || 0;
              py = py || 0;
              pz = pz || 0;
              ctx.fillStyle = '#ffcc00';
              ctx.font = '12px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`key ${frame}: (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)})`, w.w / 2, w.y + headerH / 2);
            }
          } else {
            // No key selected, show interpolated value at playhead!
            const frame = Math.round(curTime * fps);
            
            if (this._mode === 'graph' && track.shapeTimes && track.shapeTimes.length > 0) {
              // Calculate warpedTime just like in AnimationRegistry.update!
              let warpedTime = curTime;
              if (track.shapeOutputTimes && track.shapeOutputTimes.length >= 2) {
                let idx = 0;
                while (idx < track.shapeTimes.length - 2 && track.shapeTimes[idx + 1] < curTime) {
                  idx++;
                }
                const t1 = track.shapeTimes[idx];
                const t2 = track.shapeTimes[idx + 1];
                const dt = t2 - t1;
                const v1 = (track.shapeOutputTimes && idx < track.shapeOutputTimes.length) ? track.shapeOutputTimes[idx] : t1;
                const v2 = (track.shapeOutputTimes && (idx + 1) < track.shapeOutputTimes.length) ? track.shapeOutputTimes[idx + 1] : t2;
                
                let alpha = dt > 0 ? (curTime - t1) / dt : 0;
                
                if (window._animShowTangents && track.tangentOffsets) {
                  const rightDt = track.tangentOffsets[`${idx}_right_dt`];
                  const rightDv = track.tangentOffsets[`${idx}_right_dv`];
                  const leftDt = track.tangentOffsets[`${idx + 1}_left_dt`];
                  const leftDv = track.tangentOffsets[`${idx + 1}_left_dv`];
                  
                  const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
                  const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
                  const slope = dt > 0 ? (v2 - v1) / dt : 0;
                  const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
                  const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
                  
                  const p1x = dt0 / dt;
                  const p2x = 1 + dt1 / dt;
                  
                  const t_bez = reg.getBezierT(alpha, p1x, p2x);
                  
                  warpedTime = TimelineHelper.evaluateBezier(t_bez, v1, v2, dv0, dv1);
                } else {
                  warpedTime = v1 + (v2 - v1) * alpha;
                }
                const minTime = track.shapeTimes[0];
                const maxTime = track.shapeTimes[track.shapeTimes.length - 1];
                warpedTime = Math.max(minTime, Math.min(maxTime, warpedTime));
              }
              
              ctx.fillStyle = '#ffcc00';
              ctx.font = '12px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`frame ${frame}: Output Frame = ${(warpedTime * fps).toFixed(2)}`, w.w / 2, w.y + headerH / 2);
            } else {
              const [px, py, pz] = reg.getInterpolatedPosition(track, snappedTime);
              
              ctx.fillStyle = '#ffcc00';
              ctx.font = '12px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`${frame}: (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)})`, w.w / 2, w.y + headerH / 2);
            }
          }
        }
      }
    }

    if (this._mode === 'graph') {
      this.drawGraph(ctx);
      return;
    }

    // 2. Draw Vertical Grid Lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const totalSeconds = Math.ceil(mDurVal);
    for (let s = 0; s <= totalSeconds; s++) {
      if (s >= loopStart && s <= loopEnd) {
        const gridX = tlX + ((s - loopStart) / visibleDuration) * tlW;
        ctx.beginPath();
        ctx.moveTo(gridX, w.y + headerH);
        ctx.lineTo(gridX, w.y + w.h);
        ctx.stroke();
      }
    }

    // Track Column Border
    ctx.strokeStyle = '#666';
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
