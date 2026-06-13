export default class TimelineHelper {
  
  static getBezierT(targetAlpha, p1x, p2x) {
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
    return t;
  }

  static evaluateBezier(t, v1, v2, dv0, dv1) {
    const omt = 1 - t;
    const omtSq = omt * omt;
    const omtCu = omtSq * omt;
    const tSq = t * t;
    const tCu = tSq * t;
    
    const p1y = v1 + dv0;
    const p2y = v2 + dv1;
    
    return omtCu * v1 + 3 * omtSq * t * p1y + 3 * omt * tSq * p2y + tCu * v2;
  }

  static valueToY(val, height, headerH, zoomY, panY, yOffset = 0) {
    const graphH = height - headerH;
    return yOffset + headerH + graphH / 2 - (val * zoomY + panY);
  }

  static yToValue(y, height, headerH, zoomY, panY, yOffset = 0) {
    const graphH = height - headerH;
    return (yOffset + headerH + graphH / 2 - y - panY) / zoomY;
  }

  static drawDopeSheet(ctx, tracks, w, headerH, tlX, tlW, loopStart, visibleDuration, main, uiState) {
    const laneAreaH = w.h - headerH;
    const loopEnd = loopStart + visibleDuration;
    
    if (tracks.length === 0) return;

    const totalAvailableSlots = Math.max(4, tracks.length); 
    const trackH = laneAreaH / totalAvailableSlots;

    tracks.forEach(([id, track], idx) => {
      const ty = w.y + headerH + (idx * trackH);
      const tyBottom = ty + trackH;
      
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
      if (main && main._meshes) {
        const found = main._meshes.find(m => m.getID() === id);
        if (found) {
          laneName = found._permanentStaticLabel || `Object ${id}`;
        }
      }
      ctx.fillText(laneName, w.x + 10, ty + trackH / 2);

      // Draw Eye Icon (Mute)
      const eyeX = w.x + 100;
      ctx.save();
      ctx.translate(eyeX - 12, ty + trackH / 2 - 12);
      ctx.strokeStyle = track.muted ? '#888888' : '#00ffcc';
      ctx.lineWidth = 2;
      const eyePath = new Path2D('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z');
      ctx.stroke(eyePath);
      
      ctx.fillStyle = track.muted ? '#888888' : '#00ffcc';
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw Trash Icon (Delete)
      const trashX = w.x + 140;
      ctx.save();
      ctx.translate(trashX, ty + trackH / 2 - 6);
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
            const kx = w.x + tlX + ((t - loopStart) / visibleDuration) * tlW;
            const ky = ty + trackH / 2 - 10; // Offset higher to avoid overlap with shape keys
            
            const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i);
            let isInsideMarquee = false;
            
            if (uiState._marqueeStart && uiState._marqueeEnd) {
              const mx1 = Math.min(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
              const mx2 = Math.max(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
              const my1 = Math.min(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
              const my2 = Math.max(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
              
              const laneOverlap = (my1 <= tyBottom && my2 >= ty);
              
              if (laneOverlap && kx >= mx1 && kx <= mx2) {
                isInsideMarquee = true;
              }
            }
            
            const isHovered = TimelineHelper.isKeyHovered(kx, ky, uiState._lastMouseX, uiState._lastMouseY, 10);
            const isSelected = isMultiSel || isInsideMarquee;
            
            if (isSelected) ctx.fillStyle = '#ffff00';
            else if (isHovered) ctx.fillStyle = '#00ffff';
            else ctx.fillStyle = '#ff9944'; // Orange for transform keys

            ctx.strokeStyle = isSelected ? '#ffff00' : (isHovered ? '#00ffff' : '#ff9944');
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            ctx.moveTo(kx, ky - 7);
            ctx.lineTo(kx + 7, ky);
            ctx.lineTo(kx, ky + 7);
            ctx.lineTo(kx - 7, ky);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Draw Shape Keys (Circles)
      if (track && track.shapeTimes) {
        for (let i = 0; i < track.shapeTimes.length; i++) {
          const st = track.shapeTimes[i];
          if (st >= loopStart && st <= loopEnd) {
            const kx = w.x + tlX + ((st - loopStart) / visibleDuration) * tlW;
            const ky = ty + trackH / 2 + 10; // Offset lower to avoid overlap with transform keys
            
            const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(sk => sk.meshId === id && sk.type === 'shape' && sk.index === i);
            let isInsideMarquee = false;
            
            if (uiState._marqueeStart && uiState._marqueeEnd) {
              const mx1 = Math.min(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
              const mx2 = Math.max(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
              const my1 = Math.min(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
              const my2 = Math.max(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
              
              const laneOverlap = (my1 <= tyBottom && my2 >= ty);
              
              if (laneOverlap && kx >= mx1 && kx <= mx2) {
                isInsideMarquee = true;
              }
            }
            
            const isHovered = TimelineHelper.isKeyHovered(kx, ky, uiState._lastMouseX, uiState._lastMouseY, 10);
            const isSelected = isMultiSel || isInsideMarquee;
            
            if (isSelected) ctx.fillStyle = '#ffff00';
            else if (isHovered) ctx.fillStyle = '#00ffff';
            else ctx.fillStyle = '#44aaff'; // Blue for shape keys

            ctx.strokeStyle = isSelected ? '#ffff00' : (isHovered ? '#00ffff' : '#44aaff');
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            ctx.arc(kx, ky, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Draw Blendshape Keys (Squares)
      if (track && track.blendshapeTracks) {
        let bIdx = 0;
        track.blendshapeTracks.forEach((bTrack, name) => {
          if (bTrack && bTrack.times) {
            for (let i = 0; i < bTrack.times.length; i++) {
              const bt = bTrack.times[i];
              if (bt >= loopStart && bt <= loopEnd) {
                const kx = w.x + tlX + ((bt - loopStart) / visibleDuration) * tlW;
                const ky = ty + trackH / 2 + 20 + (bIdx * 10); // Offset by index
                
                const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(sk => sk.meshId === id && sk.type === 'blendshape' && sk.name === name && sk.index === i);
                let isInsideMarquee = false;
                
                if (uiState._marqueeStart && uiState._marqueeEnd) {
                  const mx1 = Math.min(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
                  const mx2 = Math.max(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
                  const my1 = Math.min(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
                  const my2 = Math.max(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
                  
                  const laneOverlap = (my1 <= tyBottom && my2 >= ty);
                  
                  if (laneOverlap && kx >= mx1 && kx <= mx2) {
                    isInsideMarquee = true;
                  }
                }
                
                const isHovered = TimelineHelper.isKeyHovered(kx, ky, uiState._lastMouseX, uiState._lastMouseY, 5);
                const isSelected = isMultiSel || isInsideMarquee;
                
                if (isSelected) ctx.fillStyle = '#ffff00'; // Yellow
                else if (isHovered) ctx.fillStyle = '#00ffff'; // Cyan
                else ctx.fillStyle = '#00ff88'; // Teal/Green for blendshapes
                
                ctx.strokeStyle = isSelected ? '#ffff00' : (isHovered ? '#00ffff' : '#00ff88');
                ctx.lineWidth = 1.5;
                
                ctx.beginPath();
                ctx.fillRect(kx - 3, ky - 3, 6, 6); // Square!
                ctx.strokeRect(kx - 3, ky - 3, 6, 6);
              }
            }
          }
          bIdx++;
        });
      }
    });
  }

  static moveKeys(reg, keys, dt, dVal, mDurVal, main) {
    reg.moveSelectedKeys(keys, dt, mDurVal);
    if (dVal !== undefined) {
      reg.moveSelectedKeysValue(keys, dVal);
    }
    if (main && main._meshes) {
      main._meshes.forEach(m => reg.update(m, true));
    }
  }

  static updateTangent(track, activeTangent, rx, ry, tlW, visibleDuration, zoomY, singleSelected) {
    let deltaX = rx - activeTangent.kx;
    const deltaY = ry - activeTangent.ky;
    
    if (activeTangent.side === 'left') deltaX = Math.min(0, deltaX);
    else deltaX = Math.max(0, deltaX);
    
    if (!track.tangentOffsets) track.tangentOffsets = {};
    const prefix = activeTangent.type === 'transform' ? 'trans_' : '';
    const dt = (deltaX / tlW) * visibleDuration;
    const dv = -deltaY / zoomY;
    
    const selChannel = (singleSelected && singleSelected.type === 'transform') ? (singleSelected.channel !== undefined ? singleSelected.channel : 0) : 0;

    track.tangentOffsets[`${prefix}${activeTangent.index}_${activeTangent.side}_dt`] = dt;
    
    if (activeTangent.type === 'shape' || activeTangent.type === 'blendshape') {
      track.tangentOffsets[`${activeTangent.index}_${activeTangent.side}_dv`] = dv;
    } else {
      track.tangentOffsets[`${prefix}${activeTangent.index}_${activeTangent.side}_dv_${selChannel}`] = dv;
    }

    const isTied = track.tangentOffsets[`${prefix}${activeTangent.index}_tied`] !== false;

    if (isTied) {
      const otherSide = activeTangent.side === 'right' ? 'left' : 'right';
      track.tangentOffsets[`${prefix}${activeTangent.index}_${otherSide}_dt`] = -dt;
      if (activeTangent.type === 'shape' || activeTangent.type === 'blendshape') {
        track.tangentOffsets[`${activeTangent.index}_${otherSide}_dv`] = -dv;
      } else {
        track.tangentOffsets[`${prefix}${activeTangent.index}_${otherSide}_dv_${selChannel}`] = -dv;
      }
    }
  }

  static getKeysInGraphRange(reg, trackId, tMin, tMax, vMin, vMax) {
    const newKeys = [];
    const track = reg.tracks.get(trackId);
    
    const channelsVisible = window._animChannelVisible || [true, true, true, true];
    
    if (track && track.times) {
      for (let i = 0; i < track.times.length; i++) {
        const t = track.times[i];
        if (t >= tMin && t <= tMax) {
          for (let c = 0; c < 3; c++) {
            if (channelsVisible[c]) {
              const val = track.positions[i * 3 + c];
              if (val >= vMin && val <= vMax) {
                newKeys.push({ meshId: trackId, type: 'transform', index: i, channel: c, time: t });
              }
            }
          }
        }
      }
    }
    
    if (track && track.shapeTimes && track.shapeOutputTimes) {
      if (channelsVisible[3]) {
        for (let i = 0; i < track.shapeTimes.length; i++) {
          const t = track.shapeTimes[i];
          if (t >= tMin && t <= tMax) {
            const val = track.shapeOutputTimes[i];
            if (val >= vMin && val <= vMax) {
              newKeys.push({ meshId: trackId, type: 'shape', index: i, time: t });
            }
          }
        }
      }
    }

    if (track && track.blendshapeTracks) {
      track.blendshapeTracks.forEach((bTrack, name) => {
        if (!bTrack.times || !bTrack.values) return;
        if (window._animBsChannelVisible?.[name] === false) return; // hidden — not selectable
        for (let i = 0; i < bTrack.times.length; i++) {
          const t = bTrack.times[i];
          if (t >= tMin && t <= tMax) {
            const val = bTrack.values[i];
            if (val >= vMin && val <= vMax) {
              newKeys.push({ meshId: trackId, type: 'blendshape', name, index: i, time: t });
            }
          }
        }
      });
    }

    return newKeys;
  }

  static isKeyHovered(keyX, keyY, cursorX, cursorY, threshold) {
    return Math.hypot(cursorX - keyX, cursorY - keyY) < threshold;
  }

  static cloneTrack(track) {
    const cloned = {
      times: track.times ? [...track.times] : [],
      positions: track.positions ? [...track.positions] : [],
      quaternions: track.quaternions ? [...track.quaternions] : [],
      scales: track.scales ? [...track.scales] : [],
      shapeTimes: track.shapeTimes ? [...track.shapeTimes] : [],
      shapes: track.shapes ? track.shapes.map(s => new Float32Array(s)) : [],
      shapeOutputTimes: track.shapeOutputTimes ? [...track.shapeOutputTimes] : [],
      playbackTime: track.playbackTime,
      muted: track.muted,
      tangentOffsets: track.tangentOffsets ? JSON.parse(JSON.stringify(track.tangentOffsets)) : undefined
    };
    if (track.restPos) cloned.restPos = [...track.restPos];
    if (track.restQuat) cloned.restQuat = [...track.restQuat];
    if (track.restScale) cloned.restScale = [...track.restScale];
    // Clone blendshape tracks (Map<string, {times, values, tangentOffsets}>)
    if (track.blendshapeTracks) {
      cloned.blendshapeTracks = new Map();
      track.blendshapeTracks.forEach((bt, name) => {
        cloned.blendshapeTracks.set(name, {
          times: bt.times ? [...bt.times] : [],
          values: bt.values ? [...bt.values] : [],
          tangentOffsets: bt.tangentOffsets ? JSON.parse(JSON.stringify(bt.tangentOffsets)) : undefined
        });
      });
    }
    return cloned;
  }

  static scaleKeysVertical(track, initialKeys, initialBox, targetVal, handle, tBox) {
    let factor = 1.0;
    if (initialBox.maxV !== initialBox.minV) {
      if (handle === 'top') {
        factor = (targetVal - initialBox.minV) / (initialBox.maxV - initialBox.minV);
      } else {
        factor = (initialBox.maxV - targetVal) / (initialBox.maxV - initialBox.minV);
      }
    }
    
    initialKeys.forEach(sk => {
      const initialVal = sk.val ?? 0;
      let newVal = 0;
      if (handle === 'top') {
        newVal = initialBox.minV + (initialVal - initialBox.minV) * factor;
      } else {
        newVal = initialBox.maxV - (initialBox.maxV - initialVal) * factor;
      }
      if (sk.type === 'transform' && track.positions) {
        track.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)] = newVal;
      } else if (sk.type === 'shape' && track.shapeOutputTimes) {
        track.shapeOutputTimes[sk.index] = newVal;
      } else if (sk.type === 'blendshape') {
        const bt = track.blendshapeTracks?.get(sk.name);
        // No 0..1 clamp — overshoot (below 0 / above 1) is intentionally allowed.
        if (bt?.values) bt.values[sk.index] = newVal;
      }
    });
    
    if (handle === 'top') {
      tBox.maxV = targetVal;
    } else {
      tBox.minV = targetVal;
    }
  }

  static drawMarqueeBox(ctx, marqueeStart, marqueeEnd, offsetX = 0, offsetY = 0, lineWidth = 1) {
    if (!marqueeStart || !marqueeEnd) return;
    ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = lineWidth;
    const x = Math.min(marqueeStart.x, marqueeEnd.x) + offsetX;
    const y = Math.min(marqueeStart.y, marqueeEnd.y) + offsetY;
    const w = Math.abs(marqueeEnd.x - marqueeStart.x);
    const h = Math.abs(marqueeEnd.y - marqueeStart.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  static drawTransformBox(ctx, tBox, w, headerH, tlX, tlW, loopStart, visibleDuration, valueToYFunc = null) {
    const kxLeft = tlX + ((tBox.startTime - loopStart) / visibleDuration) * tlW;
    const kxRight = tlX + ((tBox.endTime - loopStart) / visibleDuration) * tlW;
    
    let kyTop = w.y + headerH;
    let kyBottom = w.y + w.h;
    
    if (valueToYFunc && tBox.minV !== undefined && tBox.maxV !== undefined) {
      kyTop = valueToYFunc(tBox.maxV);
      kyBottom = valueToYFunc(tBox.minV);
      
      // Draw top/bottom handles for graph mode
      ctx.fillStyle = '#ffff00';
      const kxMid = (kxLeft + kxRight) / 2;
      ctx.fillRect(kxMid - 10, kyTop - 5, 20, 5);
      ctx.fillRect(kxMid - 10, kyBottom, 20, 5);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
    ctx.fillRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);

    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);

    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffff00';

    // Left edge handle
    ctx.beginPath();
    ctx.moveTo(kxLeft, kyTop);
    ctx.lineTo(kxLeft, kyBottom);
    ctx.stroke();

    // Right edge handle
    ctx.beginPath();
    ctx.moveTo(kxRight, kyTop);
    ctx.lineTo(kxRight, kyBottom);
    ctx.stroke();

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    const kxMid = (kxLeft + kxRight) / 2;
    ctx.beginPath();
    ctx.moveTo(kxMid, kyTop);
    ctx.lineTo(kxMid, kyBottom);
    ctx.stroke();

    // Center box handle
    const boxSize = 40;
    const bx = kxMid - boxSize / 2;
    const by = kyTop + (kyBottom - kyTop) / 2 - boxSize / 2;
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, boxSize, boxSize);

    ctx.restore();
  }
}
