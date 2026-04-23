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
            const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
            const ky = ty + trackH / 2;
            
            const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(k => k.meshId === id && k.type === 'transform' && k.index === i);
            let isInsideMarquee = false;
            
            if (uiState.isDraggingMarquee && uiState.marqueeStart && uiState.marqueeEnd) {
              const mx1 = Math.min(uiState.marqueeStart.x, uiState.marqueeEnd.x);
              const mx2 = Math.max(uiState.marqueeStart.x, uiState.marqueeEnd.x);
              const my1 = Math.min(uiState.marqueeStart.y, uiState.marqueeEnd.y);
              const my2 = Math.max(uiState.marqueeStart.y, uiState.marqueeEnd.y);
              
              if (kx >= mx1 && kx <= mx2 && ky >= my1 && ky <= my2) {
                isInsideMarquee = true;
              }
            }
            
            const isSelected = isMultiSel || isInsideMarquee;

            if (isSelected) ctx.fillStyle = '#ffff00'; // Yellow
            else ctx.fillStyle = '#888888'; // Muted Gray
            
            ctx.strokeStyle = isSelected ? '#ffff00' : '#888888';
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
            const kx = tlX + ((st - loopStart) / visibleDuration) * tlW;
            const ky = ty + trackH / 2;
            
            const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(sk => sk.meshId === id && sk.type === 'shape' && sk.index === i);
            let isInsideMarquee = false;
            
            if (uiState.isDraggingMarquee && uiState.marqueeStart && uiState.marqueeEnd) {
              const mx1 = Math.min(uiState.marqueeStart.x, uiState.marqueeEnd.x);
              const mx2 = Math.max(uiState.marqueeStart.x, uiState.marqueeEnd.x);
              const my1 = Math.min(uiState.marqueeStart.y, uiState.marqueeEnd.y);
              const my2 = Math.max(uiState.marqueeStart.y, uiState.marqueeEnd.y);
              
              if (kx >= mx1 && kx <= mx2 && ky >= my1 && ky <= my2) {
                isInsideMarquee = true;
              }
            }
            
            const isSelected = isMultiSel || isInsideMarquee;

            if (isSelected) ctx.fillStyle = '#ffff00'; // Yellow
            else ctx.fillStyle = '#888888'; // Muted Gray
            
            ctx.strokeStyle = isSelected ? '#ffff00' : '#888888';
            ctx.lineWidth = 1.5;
            
            ctx.beginPath();
            ctx.arc(kx, ky, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
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
    
    if (activeTangent.type === 'shape') {
      track.tangentOffsets[`${activeTangent.index}_${activeTangent.side}_dv`] = dv;
    } else {
      track.tangentOffsets[`${prefix}${activeTangent.index}_${activeTangent.side}_dv_${selChannel}`] = dv;
    }

    const isTied = track.tangentOffsets[`${prefix}${activeTangent.index}_tied`] !== false;

    if (isTied) {
      const otherSide = activeTangent.side === 'right' ? 'left' : 'right';
      track.tangentOffsets[`${prefix}${activeTangent.index}_${otherSide}_dt`] = -dt;
      if (activeTangent.type === 'shape') {
        track.tangentOffsets[`${activeTangent.index}_${otherSide}_dv`] = -dv;
      } else {
        track.tangentOffsets[`${prefix}${activeTangent.index}_${otherSide}_dv_${selChannel}`] = -dv;
      }
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
      // GRAPH MODE (Bounded Box)
      const kyTop = valueToYFunc(tBox.maxV);
      const kyBottom = valueToYFunc(tBox.minV);
      
      ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
      ctx.fillRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);

      ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);
      
      ctx.fillStyle = '#ffff00';
      const kxMid = (kxLeft + kxRight) / 2;
      const kyMid = (kyTop + kyBottom) / 2;
      
      // Top edge handle
      ctx.fillRect(kxMid - 10, kyTop - 5, 20, 5);
      // Bottom edge handle
      ctx.fillRect(kxMid - 10, kyBottom, 20, 5);
      // Left edge handle
      ctx.fillRect(kxLeft - 5, kyMid - 10, 5, 20);
      // Right edge handle
      ctx.fillRect(kxRight, kyMid - 10, 5, 20);
      // Center handle
      ctx.fillRect(kxMid - 5, kyMid - 5, 10, 10);
      
      ctx.restore();
      return; // Exit early for graph mode
    }

    // DOPESHEET MODE (Full Height)
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
