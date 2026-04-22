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
    this._isPanningGraph = false;
    this._isZoomingGraph = false;
    this._panStartRy = 0;
    this._panStartOffsetY = 0;
    this._zoomStartRy = 0;
    this._zoomStartScaleY = 100.0;
    this._isResizingPanel = false;
    this._lastMouseX = -1;
    this._lastMouseY = -1;
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
    this._container.appendChild(this._canvas);
    document.body.appendChild(this._container);

    this._ctx = this._canvas.getContext('2d');

    window.addEventListener('resize', this.onResize.bind(this));
    
    // Mouse interactions
    this._canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.onResize();
  }

  onResize() {
    const sidebar = document.querySelector('.gui-sidebar');
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
    const headerH = 50;
    const graphH = this._cssHeight - headerH;
    return headerH + graphH / 2 - (val * this._zoomY + this._panY);
  }

  yToValue(y) {
    const headerH = 50;
    const graphH = this._cssHeight - headerH;
    return (headerH + graphH / 2 - y - this._panY) / this._zoomY;
  }

  drawPlayhead(ctx) {
    const reg = window._animationRegistry;
    if (!reg) return;
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
    const tlX = 200;
    const tlW = this._cssWidth - 220;
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
    const tlW = this._cssWidth - 220;

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
              
              let val = 0;
              // Solve for t using binary search (inline)
              let low = 0;
              let high = 1;
              let t = 0.5;
              for (let j = 0; j < 10; j++) {
                const tSq = t * t;
                const tCu = tSq * t;
                const omt = 1 - t;
                const omtSq = omt * omt;
                const currentAlpha = 3 * omtSq * t * p1x + 3 * omt * tSq * p2x + tCu;
                if (Math.abs(currentAlpha - targetAlpha) < 0.001) break;
                if (currentAlpha < targetAlpha) low = t;
                else high = t;
                t = (low + high) / 2;
              }

              const omt = 1 - t;
              const omtSq = omt * omt;
              const omtCu = omtSq * omt;
              const tSq = t * t;
              const tCu = tSq * t;
              
              const p1y = val1 + dv0;
              const p2y = val2 + dv1;

              val = omtCu * val1 + 3 * omtSq * t * p1y + 3 * omt * tSq * p2y + tCu * val2;
              
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
            const val = track.positions[i * 3 + channel];
            const x = tlX + ((t - loopStart) / visibleDuration) * tlW;
            const y = this.valueToY(val);
            
            const isSelected = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i && k.channel === channel);
            const isHovered = Math.hypot(this._lastMouseX - x, this._lastMouseY - y) < 10;
            
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
              
              const isRightHovered = Math.hypot(this._lastMouseX - (kx + rightXOff), this._lastMouseY - (ky + rightYOff)) < 10;
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
              
              const isLeftHovered = Math.hypot(this._lastMouseX - (kx + leftXOff), this._lastMouseY - (ky + leftYOff)) < 10;
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
      // 6. Draw Shape Key Time Curve (Time Warping)
      if (track && track.shapeTimes) {
        if (track.shapeTimes.length >= 2) {
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
                const omt = 1 - t_bez;
                const omtSq = omt * omt;
                const omtCu = omtSq * omt;
                const tSq = t_bez * t_bez;
                const tCu = tSq * t_bez;
                
                const p1y = v1 + dv0;
                const p2y = v2 + dv1;
                
                warpedTime = omtCu * v1 + 3 * omtSq * t_bez * p1y + 3 * omt * tSq * p2y + tCu * v2;
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
              
              const isRightHovered = Math.hypot(this._lastMouseX - (kx1 + rightXOff), this._lastMouseY - (ky1 + rightYOff)) < 10;
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
              
              const isLeftHovered = Math.hypot(this._lastMouseX - (kx2 + leftXOff), this._lastMouseY - (ky2 + leftYOff)) < 10;
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
          const isHovered = Math.hypot(this._lastMouseX - x, this._lastMouseY - y) < 10;
          
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
            const kxLeft = tlX + ((minT - loopStart) / visibleDuration) * tlW;
            const kxRight = tlX + ((maxT - loopStart) / visibleDuration) * tlW;
            const kyTop = this.valueToY(maxV);
            const kyBottom = this.valueToY(minV);
            
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);
            
            ctx.fillStyle = '#ffff00';
            // Top edge handle
            ctx.fillRect(kxLeft + (kxRight - kxLeft)/2 - 10, kyTop - 5, 20, 5);
            // Bottom edge handle
            ctx.fillRect(kxLeft + (kxRight - kxLeft)/2 - 10, kyBottom, 20, 5);
            // Left edge handle
            ctx.fillRect(kxLeft - 5, kyTop + (kyBottom - kyTop)/2 - 10, 5, 20);
            // Right edge handle
            ctx.fillRect(kxRight, kyTop + (kyBottom - kyTop)/2 - 10, 5, 20);
            // Center handle
            ctx.fillRect(kxLeft + (kxRight - kxLeft)/2 - 5, kyTop + (kyBottom - kyTop)/2 - 5, 10, 10);
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
    const tlW = this._cssWidth - 220;

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
        this._undoTracksBeforeMove.set(mId, this.cloneTrack(tr));
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
        if (Math.abs(rx - kxMid) < 10 && Math.abs(ry - kyMid) < 10) {
          this._activeTransformHandle = 'scale_center';
          this._transformStartRx = rx;
          this._animTransformInitialBox = { startTime: minT, endTime: maxT };
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

          if (Math.hypot(rx - x, ry - y) < 10) {
            this._isDraggingKeyframe = true;
            this._activeKeyframeTrack = track;
            this._activeMeshId = id;
            
            const reg = window._animationRegistry;
            if (reg) {
              this._undoTracksBeforeMove = new Map();
              reg.tracks.forEach((tr, mId) => {
                this._undoTracksBeforeMove.set(mId, this.cloneTrack(tr));
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

        if (Math.hypot(rx - x, ry - y) < 10) {
          this._isDraggingKeyframe = true;
          this._activeKeyframeTrack = track;
          this._activeMeshId = id;
          
          const reg = window._animationRegistry;
          if (reg) {
            this._undoTracksBeforeMove = new Map();
            reg.tracks.forEach((tr, mId) => {
              this._undoTracksBeforeMove.set(mId, this.cloneTrack(tr));
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
          const dist = Math.hypot(rx - (kx + rightXOff), ry - (ky + rightYOff));
          if (dist < 10) {
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
          const dist = Math.hypot(rx - (kx + leftXOff), ry - (ky + leftYOff));
          if (dist < 10) {
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

    if (track.positions && track.times && track.times.length > 0) {
      for (let i = 0; i < track.times.length; i++) {
        for (let c = 0; c < 3; c++) {
          const val = track.positions[i * 3 + c];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
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

  startLoop() {
    const loop = () => {
      if (this._visible) {
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  cloneTrack(track) {
    const cloned = {
      times: track.times ? [...track.times] : [],
      positions: track.positions ? [...track.positions] : [],
      quaternions: track.quaternions ? [...track.quaternions] : [],
      scales: track.scales ? [...track.scales] : [],
      shapeTimes: track.shapeTimes ? [...track.shapeTimes] : [],
      shapes: track.shapes ? track.shapes.map(s => new Float32Array(s)) : [],
      playbackTime: track.playbackTime,
      muted: track.muted,
      tangentOffsets: track.tangentOffsets ? JSON.parse(JSON.stringify(track.tangentOffsets)) : undefined
    };
    if (track.restPos) cloned.restPos = [...track.restPos];
    if (track.restQuat) cloned.restQuat = [...track.restQuat];
    if (track.restScale) cloned.restScale = [...track.restScale];
    return cloned;
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

    if (ry < 50) {
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
          const tlW = this._cssWidth - 220;
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
            if (confirm(`Delete track for Object ${meshId}?`)) {
              window._animationRegistry.deleteTrack(meshId);
              this.draw();
            }
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
        const tlW = this._cssWidth - 220;

        // Check if clicked on Transform Box handles!
        if (window._animShowTransformBox && window._animTransformBox) {
          const tBox = window._animTransformBox;
          const kxLeft = tlX + ((tBox.startTime - loopStart) / visibleDuration) * tlW;
          const kxRight = tlX + ((tBox.endTime - loopStart) / visibleDuration) * tlW;
          const kxMid = (kxLeft + kxRight) / 2;

          const boxSize = 40;
          const by = headerH + (this._cssHeight - headerH) / 2 - boxSize / 2;
          const cyMid = headerH + (this._cssHeight - headerH) / 2;

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
            this._animTransformInitialBox = { startTime: tBox.startTime, endTime: tBox.endTime };
            if (window._animSelectedKeys) {
              this._animTransformBoxInitialTimes = window._animSelectedKeys.map(sk => {
                const tr = reg.tracks.get(sk.meshId);
                const time = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
                return { ...sk, time };
              });
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
                      this._undoTracksBeforeMove.set(mId, this.cloneTrack(tr));
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
    const tlW = this._cssWidth - 220;
    
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
        const tlW = this._cssWidth - 220;
        
        let t = (rx - tlX) / tlW;
        t = Math.max(0, Math.min(1, t));
        const targetTime = this._viewStart + t * this._viewDuration;
        
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
      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));
      const targetTime = loopStart + t * visibleDuration;
      
      const dt = targetTime - this._keyDragStartTime;
      
      if (window._animationRegistry) {
        if (this._mode === 'graph') {
          const targetVal = this.yToValue(ry);
          const dVal = targetVal - this._keyDragStartVal;
          
          if (this._animSelectedKeysInitialTimes) {
            window._animationRegistry.moveSelectedKeys(this._animSelectedKeysInitialTimes, dt, mDurVal);
            window._animationRegistry.moveSelectedKeysValue(this._animSelectedKeysInitialTimes, dVal);
          } else if (this._activeMeshId) {
            const singleKey = [{
              meshId: this._activeMeshId,
              type: this._activeKeyframeType,
              index: this._activeKeyframeIndex,
              time: this._keyDragStartTime,
              channel: this._activeKeyframeChannel,
              startVal: this._keyDragStartVal
            }];
            window._animationRegistry.moveSelectedKeys(singleKey, dt, mDurVal);
            window._animationRegistry.moveSelectedKeysValue(singleKey, dVal);
          }

          if (this._main && this._main._meshes) {
            this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
          }
          if (this._main.render) this._main.render();
        } else {
          if (this._animSelectedKeysInitialTimes) {
            window._animationRegistry.moveSelectedKeys(this._animSelectedKeysInitialTimes, dt, mDurVal);
          } else if (this._activeMeshId) {
            const singleKey = [{
              meshId: this._activeMeshId,
              type: this._activeKeyframeType,
              index: this._activeKeyframeIndex,
              time: this._keyDragStartTime
            }];
            window._animationRegistry.moveSelectedKeys(singleKey, dt, mDurVal);
          }
        }
      }
      
      this.draw();
    } else if (this._isDraggingTangent) {
      let deltaX = rx - this._activeTangentKx;
      const deltaY = ry - this._activeTangentKy;
      
      if (this._activeTangentSide === 'left') {
        deltaX = Math.min(0, deltaX);
      } else {
        deltaX = Math.max(0, deltaX);
      }
      
      if (this._activeTangentTrack) {
        if (!this._activeTangentTrack.tangentOffsets) {
          this._activeTangentTrack.tangentOffsets = {};
        }
        const prefix = this._activeTangentType === 'transform' ? 'trans_' : '';
        const dt = (deltaX / tlW) * visibleDuration;
        const dv = -deltaY / this._zoomY;
        
        const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
        const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

        this._activeTangentTrack.tangentOffsets[`${prefix}${this._activeTangentIndex}_${this._activeTangentSide}_dt`] = dt;
        
        if (this._activeTangentType === 'shape') {
          this._activeTangentTrack.tangentOffsets[`${this._activeTangentIndex}_${this._activeTangentSide}_dv`] = dv;
        } else {
          this._activeTangentTrack.tangentOffsets[`${prefix}${this._activeTangentIndex}_${this._activeTangentSide}_dv_${selChannel}`] = dv;
        }

        const isTied = this._activeTangentTrack.tangentOffsets ? this._activeTangentTrack.tangentOffsets[`${prefix}${this._activeTangentIndex}_tied`] !== false : true;

        if (isTied) {
          const otherSide = this._activeTangentSide === 'right' ? 'left' : 'right';
          this._activeTangentTrack.tangentOffsets[`${prefix}${this._activeTangentIndex}_${otherSide}_dt`] = -dt;
          if (this._activeTangentType === 'shape') {
            this._activeTangentTrack.tangentOffsets[`${this._activeTangentIndex}_${otherSide}_dv`] = -dv;
          } else {
            this._activeTangentTrack.tangentOffsets[`${prefix}${this._activeTangentIndex}_${otherSide}_dv_${selChannel}`] = -dv;
          }
        }
      }
      
      this.draw();
    } else if (this._activeTransformHandle === 'top' || this._activeTransformHandle === 'bottom') {
      const rect = this._canvas.getBoundingClientRect();
      const ry = e.clientY - rect.top;
      
      const targetVal = this.yToValue(ry);
      const initialBox = this._animTransformInitialBox;
      
      let factor = 1.0;
      if (initialBox.maxV !== initialBox.minV) {
        if (this._activeTransformHandle === 'top') {
          factor = (targetVal - initialBox.minV) / (initialBox.maxV - initialBox.minV);
        } else {
          factor = (initialBox.maxV - targetVal) / (initialBox.maxV - initialBox.minV);
        }
      }
      
      const activeMesh = this._main.getMesh();
      if (activeMesh && window._animationRegistry && this._animTransformBoxInitialKeys) {
        const id = activeMesh.getID();
        const track = window._animationRegistry.tracks.get(id);
        if (track) {
          const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
          const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

          this._animTransformBoxInitialKeys.forEach(sk => {
            if (sk.meshId === id && sk.type === 'transform') {
              const initialVal = sk.val;
              let newVal = 0;
              if (this._activeTransformHandle === 'top') {
                newVal = initialBox.minV + (initialVal - initialBox.minV) * factor;
              } else {
                newVal = initialBox.maxV - (initialBox.maxV - initialVal) * factor;
              }
              track.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)] = newVal;
            }
          });
          
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
      const tlW = this._cssWidth - 220;
      
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
  }

  onMouseUp(e) {
    if (this._isDraggingMarquee) {
      this.finalizeMarquee(e);
    } else if (this._isDraggingKeyframe) {
      const reg = window._animationRegistry;
      if (reg) {
        const selectedKeysWithTimes = window._animSelectedKeys ? window._animSelectedKeys.map(key => {
          const track = reg.tracks.get(key.meshId);
          const times = key.type === 'transform' ? track.times : track.shapeTimes;
          return { ...key, time: times ? times[key.index] : 0 };
        }) : [];

        reg.tracks.forEach((track, meshId) => {
          reg.sortTrack(track);
        });

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
        
        if (this._undoTracksBeforeMove) {
          const beforeState = this._undoTracksBeforeMove;
          const afterState = new Map();
          reg.tracks.forEach((track, meshId) => {
            afterState.set(meshId, this.cloneTrack(track));
          });
          
          const cbUndo = () => {
            beforeState.forEach((track, meshId) => {
              reg.tracks.set(meshId, this.cloneTrack(track));
            });
            this._main.render();
            this.draw();
          };
          
          const cbRedo = () => {
            afterState.forEach((track, meshId) => {
              reg.tracks.set(meshId, this.cloneTrack(track));
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
          afterState.set(meshId, this.cloneTrack(track));
        });
        
        const cbUndo = () => {
          beforeState.forEach((track, meshId) => {
            reg.tracks.set(meshId, this.cloneTrack(track));
          });
          this._main.render();
          this.draw();
        };
        
        const cbRedo = () => {
          afterState.forEach((track, meshId) => {
            reg.tracks.set(meshId, this.cloneTrack(track));
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
    const tlW = this._cssWidth - 220;

    if (rx >= tlX && rx <= tlX + tlW) {
      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));



      const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
      const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
      const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
      const visibleDuration = Math.max(0.1, loopEnd - loopStart);

      const targetTime = loopStart + t * visibleDuration;

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

    const loopStart = this._viewStart;
    const visibleDuration = this._viewDuration;
    
    const tlX = 200;
    const tlW = this._cssWidth - 220;

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
          for (let i = 0; i < track.times.length; i++) {
            const t = track.times[i];
            if (t >= tMin && t <= tMax) {
              for (let c = 0; c < 3; c++) {
                const val = track.positions[i * 3 + c];
                if (val >= vMin && val <= vMax) {
                  newKeys.push({ meshId: id, type: 'transform', index: i, channel: c });
                }
              }
            }
          }
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
    
    newKeys.forEach(nk => {
      const alreadySelected = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === nk.meshId && k.type === nk.type && k.index === nk.index);
      if (!alreadySelected) {
        window._animSelectedKeys.push(nk);
      }
    });

    // Automatically create transform box around selection!
    if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
      let minT = Infinity;
      let maxT = -Infinity;
      window._animSelectedKeys.forEach(k => {
        const track = reg.tracks.get(k.meshId);
        if (track) {
          const t = k.type === 'transform' ? track.times[k.index] : track.shapeTimes[k.index];
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
        }
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
    const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDuration = Math.max(0.1, loopEnd - loopStart);

    const tlX = 200; // Width allocated for track names
    const tlW = w.w - 220;

    // --- 1. Draw Top Transport Header Strip (30px tall) ---
    const headerH = 50;
    ctx.fillStyle = '#222';
    ctx.fillRect(w.x, w.y, w.w, headerH);

    // Draw Mode Toggle Button
    ctx.fillStyle = '#444';
    ctx.fillRect(10, 5, 90, 20);
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

      ctx.fillStyle = singleSelected ? '#444' : '#222';
      ctx.fillRect(120, 5, 110, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(isTied ? 'Tangents: Tied' : 'Tangents: Broken', 175, 15);
    }

    const fps = window._animFPS || 24;
    const curT = window._animCurrentTime ? Math.round(window._animCurrentTime * fps) : 0;
    const loopStartF = Math.round(loopStart * fps);
    const loopEndF = Math.round(loopEnd * fps);

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${loopStartF}f`, tlX + 5, w.y + 40);
    ctx.textAlign = 'right';
    ctx.fillText(`${loopEndF}f`, tlX + tlW - 5, w.y + 40);

    // Show status or value of closest key to playhead
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
                  
                  const omt = 1 - t_bez;
                  const omtSq = omt * omt;
                  const omtCu = omtSq * omt;
                  const tSq = t_bez * t_bez;
                  const tCu = tSq * t_bez;
                  
                  const p1y = v1 + dv0;
                  const p2y = v2 + dv1;
                  
                  warpedTime = omtCu * v1 + 3 * omtSq * t_bez * p1y + 3 * omt * tSq * p2y + tCu * v2;
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
    
    if (tracks.length === 0) {
      // Empty timeline message removed as requested
    } else {
      const totalAvailableSlots = Math.max(4, tracks.length); 
      const trackH = laneAreaH / totalAvailableSlots;

      tracks.forEach(([id, track], idx) => {
        const ty = w.y + headerH + (idx * trackH);
        
        // Alternate lane background
        if (idx % 2 === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(w.x, ty, w.w, trackH);
        }

        // Lane Label
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let laneName = `Track ${id}`;
        if (this._main && this._main._meshes) {
          const found = this._main._meshes.find(m => m.getID() === id);
          if (found) {
            laneName = found._permanentStaticLabel || `Object ${id}`;
          }
        }
        ctx.fillText(laneName, w.x + 10, ty + trackH / 2);

        // Draw Eye Icon (Mute)
        const eyeX = w.x + 100;
        ctx.save();
        ctx.translate(eyeX - 12, ty + trackH / 2 - 12); // Match VR translation and alignment
        ctx.strokeStyle = track.muted ? '#888888' : '#00ffcc';
        ctx.lineWidth = 2;
        const eyePath = new Path2D('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z');
        ctx.stroke(eyePath);
        
        // Pupil (missing in previous desktop version)
        ctx.fillStyle = track.muted ? '#888888' : '#00ffcc';
        ctx.beginPath();
        ctx.arc(12, 12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Draw Trash Icon (Delete)
        const trashX = w.x + 140;
        ctx.save();
        ctx.translate(trashX, ty + trackH / 2 - 6); // Correct vertical alignment for trash path
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // Lid
        ctx.moveTo(0, 2);
        ctx.lineTo(12, 2);
        // Handle
        ctx.moveTo(4, 2);
        ctx.lineTo(4, 0);
        ctx.lineTo(8, 0);
        ctx.lineTo(8, 2);
        // Body
        ctx.moveTo(2, 2);
        ctx.lineTo(3, 12);
        ctx.lineTo(9, 12);
        ctx.lineTo(10, 2);
        ctx.stroke();
        ctx.restore();

        // Transform Data Visualization
        if (track && track.times && track.times.length > 0) {
          for (let i = 0; i < track.times.length; i++) {
            const t = track.times[i];
            if (t >= loopStart && t <= loopEnd) {
              const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
              const ky = ty + trackH / 2;
              
              const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i);
              let isSelected = isMultiSel;
              
              if (this._isDraggingMarquee && this._marqueeStart && this._marqueeEnd) {
                const mx1 = Math.min(this._marqueeStart.x, this._marqueeEnd.x);
                const mx2 = Math.max(this._marqueeStart.x, this._marqueeEnd.x);
                const my1 = Math.min(this._marqueeStart.y, this._marqueeEnd.y);
                const my2 = Math.max(this._marqueeStart.y, this._marqueeEnd.y);
                
                if (kx >= mx1 && kx <= mx2 && ky >= my1 && ky <= my2) {
                  isSelected = true;
                }
              }
              
              ctx.fillStyle = track.muted ? '#888888' : '#00ffff';
              ctx.strokeStyle = isSelected ? '#00ff00' : (track.muted ? '#555555' : '#ffffff');
              ctx.lineWidth = isSelected ? 3 : 1.5;
              
              ctx.beginPath();
              ctx.moveTo(kx, ky - (isSelected ? 9 : 7));
              ctx.lineTo(kx + (isSelected ? 9 : 7), ky);
              ctx.lineTo(kx, ky + (isSelected ? 9 : 7));
              ctx.lineTo(kx - (isSelected ? 9 : 7), ky);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        }

        // Shape Data Visualization
        if (track && track.shapeTimes) {
          for (let i = 0; i < track.shapeTimes.length; i++) {
            const st = track.shapeTimes[i];
            if (st >= loopStart && st <= loopEnd) {
              const kx = tlX + ((st - loopStart) / visibleDuration) * tlW;
              const ky = ty + trackH / 2;
              
              const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'shape' && k.index === i);
              let isSelected = isMultiSel;
              
              if (this._isDraggingMarquee && this._marqueeStart && this._marqueeEnd) {
                const mx1 = Math.min(this._marqueeStart.x, this._marqueeEnd.x);
                const mx2 = Math.max(this._marqueeStart.x, this._marqueeEnd.x);
                const my1 = Math.min(this._marqueeStart.y, this._marqueeEnd.y);
                const my2 = Math.max(this._marqueeStart.y, this._marqueeEnd.y);
                
                if (kx >= mx1 && kx <= mx2 && ky >= my1 && ky <= my2) {
                  isSelected = true;
                }
              }
              
              ctx.fillStyle = '#ffcc00';
              ctx.strokeStyle = isSelected ? '#00ff00' : '#ffffff';
              ctx.lineWidth = isSelected ? 3 : 1.5;
              
              // Draw Tangents in Dopesheet (Gray and smaller)
              if (window._animShowTangents) {
                ctx.strokeStyle = '#888888';
                ctx.lineWidth = 1;
                
                const rightVal = track.tangentOffsets ? track.tangentOffsets[`${i}_right`] : undefined;
                const leftVal = track.tangentOffsets ? track.tangentOffsets[`${i}_left`] : undefined;
                const rightXOff = rightVal !== undefined ? rightVal : 25;
                const leftXOff = leftVal !== undefined ? leftVal : -25;
                
                // Draw right handle
                if (i < track.shapeTimes.length - 1) {
                  ctx.beginPath();
                  ctx.moveTo(kx, ky);
                  ctx.lineTo(kx + rightXOff, ky);
                  ctx.stroke();
                  
                  const isRightHovered = Math.hypot(this._lastMouseX - (kx + rightXOff), this._lastMouseY - ky) < 10;
                  const isRightActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'right' && this._activeTangentType === 'shape';
                  
                  if (isRightActive) ctx.fillStyle = '#ffff00'; // Yellow
                  else if (isRightHovered) ctx.fillStyle = '#00ffff'; // Cyan
                  else ctx.fillStyle = '#888888'; // Gray
                  
                  ctx.beginPath();
                  ctx.arc(kx + rightXOff, ky, 2.5, 0, Math.PI * 2);
                  ctx.fill();
                }
                
                // Draw left handle
                if (i > 0) {
                  ctx.beginPath();
                  ctx.moveTo(kx, ky);
                  ctx.lineTo(kx + leftXOff, ky);
                  ctx.stroke();
                  
                  const isLeftHovered = Math.hypot(this._lastMouseX - (kx + leftXOff), this._lastMouseY - ky) < 10;
                  const isLeftActive = this._isDraggingTangent && this._activeTangentIndex === i && this._activeTangentSide === 'left' && this._activeTangentType === 'shape';
                  
                  if (isLeftActive) ctx.fillStyle = '#ffff00'; // Yellow
                  else if (isLeftHovered) ctx.fillStyle = '#00ffff'; // Cyan
                  else ctx.fillStyle = '#888888'; // Gray
                  
                  ctx.beginPath();
                  ctx.arc(kx + leftXOff, ky, 2.5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }

              ctx.beginPath();
              ctx.moveTo(kx, ky - (isSelected ? 7 : 5));
              ctx.lineTo(kx + (isSelected ? 7 : 5), ky);
              ctx.lineTo(kx, ky + (isSelected ? 7 : 5));
              ctx.lineTo(kx - (isSelected ? 7 : 5), ky);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      });
    }

    // Render Transform Box
    if (window._animShowTransformBox && window._animTransformBox) {
      const tBox = window._animTransformBox;
      const kxLeft = tlX + ((tBox.startTime - loopStart) / visibleDuration) * tlW;
      const kxRight = tlX + ((tBox.endTime - loopStart) / visibleDuration) * tlW;

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
      ctx.fillRect(kxLeft, w.y + headerH, kxRight - kxLeft, w.h - headerH);

      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(kxLeft, w.y + headerH, kxRight - kxLeft, w.h - headerH);

      ctx.setLineDash([]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffff00';

      // Left edge handle
      ctx.beginPath();
      ctx.moveTo(kxLeft, w.y + headerH);
      ctx.lineTo(kxLeft, w.y + w.h);
      ctx.stroke();

      // Right edge handle
      ctx.beginPath();
      ctx.moveTo(kxRight, w.y + headerH);
      ctx.lineTo(kxRight, w.y + w.h);
      ctx.stroke();

      // Center line
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
      ctx.lineWidth = 2;
      const kxMid = (kxLeft + kxRight) / 2;
      ctx.beginPath();
      ctx.moveTo(kxMid, w.y + headerH);
      ctx.lineTo(kxMid, w.y + w.h);
      ctx.stroke();

      // Center box handle
      const boxSize = 40;
      const bx = kxMid - boxSize / 2;
      const by = w.y + headerH + (w.h - headerH) / 2 - boxSize / 2;
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, boxSize, boxSize);

      ctx.restore();
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
