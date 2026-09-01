import { xfRead, xfWrite, xfTanPrefix, xfVisible, xfChanVisible,
         xfWeightTrack } from '../editing/xfChannel.js';

export default class TimelineHelper {

  // LANE HEIGHT, IN ONE PLACE. The rule was written out at five call sites — the drawing
  // below, and four hit-testing/marquee paths in GuiTimeline — which is four chances for a
  // click to land on a different row than the one it was drawn on.
  //
  // Lanes SHARE the panel height, with a floor of four slots so a single object does not get a
  // full-height row. They are also CAPPED: without that, a tall panel with two or three tracks
  // stretched each row to several times the height its text and keys need, which is what a
  // resized VR timeline (and a tall desktop one) looked like. Filling the space was never the
  // intent — the floor of four was.
  //
  // LANE_H_MAX is a taste value, not a derived one: it wants to fit a key marker centred on a
  // label, with room for the blendshape/layer sub-rows that stack below at 18px.
  static laneHeight(laneAreaH, nTracks) {
    const LANE_H_MAX = 34;
    return Math.min(LANE_H_MAX, laneAreaH / Math.max(4, nTracks));
  }


  // Canonical blendshape display order, shared by the timeline and the canvas
  // BlendshapeStackPanel: Photoshop order — newest layer first (top). Every place
  // that lays out blendshape rows / maps a row index back to a name MUST go
  // through this so draw, hit-test, colour and scroll all agree. Drag-to-reorder
  // (AnimationRegistry.setBlendshapeOrder) reorders the backing Map itself, so this
  // reverse() naturally reflects the user's order.
  static bsNames(track) {
    if (!track?.blendshapeTracks) return [];
    return [...track.blendshapeTracks.keys()].reverse();
  }

  static bsEntries(track) {
    if (!track?.blendshapeTracks) return [];
    return [...track.blendshapeTracks].reverse();
  }

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

    // Per-type display filters (XF/SH/BS/SR toggles). Default all-on.
    const show = (typeof window !== 'undefined' && window._animKeyShow) || { transform: true, shape: true, blendshape: true, shaperep: true };

    const trackH = TimelineHelper.laneHeight(laneAreaH, tracks.length);

    // Vertical scroll (mouse-wheel): stacked blendshape + shape-layer sub-rows can extend
    // past a lane's slot, so measure the deepest content and let the user scroll to it.
    let contentBottom = 0;
    tracks.forEach(([id, track], idx) => {
      const bs = track.blendshapeTracks ? track.blendshapeTracks.size : 0;
      const ly = track.shapeLayers ? track.shapeLayers.length : 0;
      const laneContent = Math.max(trackH, trackH / 2 + 22 + (bs + ly) * 18 + 12);
      contentBottom = Math.max(contentBottom, idx * trackH + laneContent);
    });
    uiState._dopeMaxScroll = Math.max(0, contentBottom - laneAreaH);
    // Clamp through the SAME accessor the hit tests use, now that _dopeMaxScroll is known for
    // this frame — drawing at one offset while hit-testing at another is what made the keys
    // highlight and then refuse to be picked.
    const scrollY = uiState._dopeScroll ? uiState._dopeScroll()
                                        : Math.min(uiState._dopeScrollY || 0, uiState._dopeMaxScroll);

    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y + headerH, w.w, laneAreaH);
    ctx.clip();

    tracks.forEach(([id, track], idx) => {
      const ty = w.y + headerH + (idx * trackH) - scrollY;
      const tyBottom = ty + trackH;
      
      // Alternate lane background
      if (idx % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(w.x, ty, w.w, trackH);
      }

      let laneName = `Track ${id}`;
      let laneMesh = null;
      if (main && main._meshes) {
        laneMesh = main._meshes.find(m => m.getID() === id);
        if (laneMesh) laneName = laneMesh._permanentStaticLabel || `Object ${id}`;
      }
      // Rig rows have no real track behind them, so there is nothing to mute — same reason
      // frame-group rows skip the toggle.
      const isGroupRow = !!(laneMesh && laneMesh._isFrameGroup);

      // Lane label — clipped so it never runs under the mute toggle.
      const nameRight = w.x + 176;
      ctx.save();
      ctx.beginPath();
      ctx.rect(w.x, ty, nameRight - w.x, trackH);
      ctx.clip();
      // THE GRAPH TARGET'S NAME IS YELLOW — the same yellow a selected key is drawn in, so the
      // row and the keys read as one selection. Without it the target is invisible: you click a
      // row, switch to the graph, and have to infer from the curves whether it took.
      const isGraphTarget = uiState && uiState._graphMeshId === id;
      ctx.fillStyle = isGraphTarget ? '#ffff00' : (track.muted ? '#6c7086' : '#cdd6f4');
      ctx.font = isGraphTarget ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(laneName, w.x + 10, ty + trackH / 2);
      ctx.restore();

      // Mute toggle — right-aligned "M"; mutes this object's animation in playback.
      // Not shown for SR group rows (their visibility is keyframe-driven, not muted).
      if (!isGroupRow) {
        ctx.fillStyle = track.muted ? '#f38ba8' : '#585b70';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', w.x + 186, ty + trackH / 2);
      }

      // Transform Data Visualization
      if (show.transform && track && track.times && track.times.length > 0) {
        for (let i = 0; i < track.times.length; i++) {
          const t = track.times[i];
          if (t >= loopStart && t <= loopEnd) {
            const kx = w.x + tlX + ((t - loopStart) / visibleDuration) * tlW;
            const ky = ty + trackH / 2; // centred on the lane (aligned with ruler/SR markers)
            
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
            
            const isMoving = isSelected && !!uiState._isDraggingKeyframe;
            ctx.fillStyle = TimelineHelper.keyFill(isSelected, isMoving, track.muted);
            ctx.strokeStyle = ctx.fillStyle;
            TimelineHelper.keyRing(ctx, isHovered);

            ctx.beginPath();
            ctx.moveTo(kx, ky - 3.5);
            ctx.lineTo(kx + 3.5, ky);
            ctx.lineTo(kx, ky + 3.5);
            ctx.lineTo(kx - 3.5, ky);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Draw Shape Keys (Circles)
      if (show.shape && track && track.shapeTimes) {
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
            
            const isMoving = isSelected && !!uiState._isDraggingKeyframe;
            ctx.fillStyle = TimelineHelper.keyFill(isSelected, isMoving, track.muted);
            ctx.strokeStyle = ctx.fillStyle;
            TimelineHelper.keyRing(ctx, isHovered);

            ctx.beginPath();
            ctx.arc(kx, ky, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Draw Blendshape Keys (Squares). Newest-first row order (shared with hit-test).
      if (show.blendshape && track && track.blendshapeTracks) {
        let bIdx = 0;
        const reg = (typeof window !== 'undefined') ? window._animationRegistry : null;
        TimelineHelper.bsEntries(track).forEach(([name, bTrack]) => {
          const subRowY = ty + trackH / 2 + 22 + (bIdx * 18);
          // Per-blendshape gutter label — same size as the object title, just indented, so
          // the stacked rows are legible. Muted layers dim; clipped so long ARKit names
          // don't bleed onto the M/× controls.
          const bsMuted = !!(laneMesh && reg?.isBlendshapeMuted?.(laneMesh, name));
          ctx.save();
          ctx.beginPath();
          ctx.rect(w.x + 22, subRowY - 8, 130, 16);
          ctx.clip();
          ctx.fillStyle = bsMuted ? '#6c7086' : '#00ff88';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(name, w.x + 22, subRowY);
          ctx.restore();
          // Per-row M (mute layer) + × (delete this track's animation), kept well left of the
          // key area. Hit-testing mirrors these x-bands in GuiTimeline.onMouseDown.
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = bsMuted ? '#f38ba8' : '#585b70';
          ctx.fillText('M', w.x + 162, subRowY);
          ctx.fillStyle = '#585b70';
          ctx.fillText('×', w.x + 178, subRowY);
          if (bTrack && bTrack.times) {
            for (let i = 0; i < bTrack.times.length; i++) {
              const bt = bTrack.times[i];
              if (bt >= loopStart && bt <= loopEnd) {
                const kx = w.x + tlX + ((bt - loopStart) / visibleDuration) * tlW;
                const ky = ty + trackH / 2 + 22 + (bIdx * 18); // Offset by index
                
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
                
                const isMoving = isSelected && !!uiState._isDraggingKeyframe;
                ctx.fillStyle = TimelineHelper.keyFill(isSelected, isMoving, bsMuted);
                ctx.strokeStyle = ctx.fillStyle;
                TimelineHelper.keyRing(ctx, isHovered);
                
                ctx.beginPath();
                ctx.fillRect(kx - 3, ky - 3, 6, 6); // Square!
                ctx.strokeRect(kx - 3, ky - 3, 6, 6);
              }
            }
          }
          bIdx++;
        });
      }

      // Shape LAYERS (#34): rows below the blendshape rows — same layout (name + M + ×), blue
      // keys. The ACTIVE layer (recording target) is marked with ● and highlighted. Click the
      // name to arm it; M mutes; × deletes the layer. Hit-testing mirrors this in GuiTimeline.
      if (show.shape && track.shapeLayers && track.shapeLayers.length) {
        const bsCount = track.blendshapeTracks ? track.blendshapeTracks.size : 0;
        const activeIdx = track.activeShapeLayerIdx;
        const selSet = (uiState._selShapeLayerMesh === id) ? uiState._selShapeLayerIdxs : null;
        for (let li = 0; li < track.shapeLayers.length; li++) {
          const L = track.shapeLayers[li];
          const rowY = ty + trackH / 2 + 22 + (bsCount + li) * 18;
          const isActive = (activeIdx === li);
          const isSel = !!(selSet && selSet.has(li));
          // Multiselect dot (left) — click to toggle; 2+ selected → "Combine layers" in the … menu.
          ctx.beginPath();
          ctx.arc(w.x + 11, rowY, 4, 0, Math.PI * 2);
          ctx.fillStyle = isSel ? '#f9e2af' : '#313244';
          ctx.fill();
          ctx.strokeStyle = isSel ? '#f9e2af' : '#585b70';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.save();
          ctx.beginPath(); ctx.rect(w.x + 22, rowY - 8, 130, 16); ctx.clip();
          ctx.fillStyle = L.muted ? '#6c7086' : (isActive ? '#f9e2af' : '#89b4fa');
          ctx.font = (isActive ? 'bold ' : '') + '12px sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText((isActive ? '● ' : '') + L.name, w.x + 22, rowY);
          ctx.restore();
          ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = L.muted ? '#f38ba8' : '#585b70'; ctx.fillText('M', w.x + 162, rowY);
          ctx.fillStyle = '#585b70'; ctx.fillText('×', w.x + 178, rowY);
          if (L.shapeTimes) {
            for (let i = 0; i < L.shapeTimes.length; i++) {
              const st = L.shapeTimes[i];
              if (st < loopStart || st > loopEnd) continue;
              const kx = w.x + tlX + ((st - loopStart) / visibleDuration) * tlW;

              // #34: layer keys are now selectable/movable/deletable like base shape keys.
              const isMultiSel = window._animSelectedKeys && window._animSelectedKeys.some(
                sk => sk.meshId === id && sk.type === 'shapeLayer' && sk.layer === li && sk.index === i);
              let isInsideMarquee = false;
              if (uiState._marqueeStart && uiState._marqueeEnd) {
                const mx1 = Math.min(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
                const mx2 = Math.max(uiState._marqueeStart.x, uiState._marqueeEnd.x) + w.x;
                const my1 = Math.min(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
                const my2 = Math.max(uiState._marqueeStart.y, uiState._marqueeEnd.y) + w.y;
                if (kx >= mx1 && kx <= mx2 && rowY >= my1 && rowY <= my2) isInsideMarquee = true;
              }
              const isHovered = TimelineHelper.isKeyHovered(kx, rowY, uiState._lastMouseX, uiState._lastMouseY, 5);
              const isSelected = isMultiSel || isInsideMarquee;

              const isMoving = isSelected && !!uiState._isDraggingKeyframe;
              ctx.fillStyle = TimelineHelper.keyFill(isSelected, isMoving, L.muted);
              ctx.fillRect(kx - 3, rowY - 3, 6, 6);
              // The ARMED layer keeps a marker of its own: it is where a NEW key will land,
              // which selection has nothing to say about.
              if (isActive || isSelected || isHovered) {
                ctx.strokeStyle = isActive ? '#f9e2af' : ctx.fillStyle;
                TimelineHelper.keyRing(ctx, isHovered);
                ctx.strokeRect(kx - 3.5, rowY - 3.5, 7, 7);
              }
            }
          }
        }
      }

      // SR frame-group markers: one uniform diamond per child frame at its
      // _srFrameTime. One row = the whole flipbook. No active/dim state — the playhead
      // already shows which frame is live, so per-key highlighting is just clutter.
      const _fg = (typeof window !== 'undefined') ? window._frameGroup : null;
      const _grp = (_fg && main && main._meshes) ? main._meshes.find(m => m.getID() === id && m._isFrameGroup) : null;
      if (_grp && show.shaperep) {
        const kids = _fg.children(_grp);
        const fy = ty + trackH / 2;
        const selKeys = (typeof window !== 'undefined' && window._animSelectedKeys) || [];
        // Collect each visible frame's screen X plus its shared-data identity so that,
        // when a linked (instanced) frame is SELECTED, we can arc to its siblings — the
        // frames sharing that _meshData that an edit would also change.
        const pts = [];
        for (let i = 0; i < kids.length; i++) {
          const ft = kids[i]._srFrameTime || 0;
          if (ft < loopStart || ft > loopEnd) continue;
          const fx = w.x + tlX + ((ft - loopStart) / visibleDuration) * tlW;
          const md = kids[i].getMeshData && kids[i].getMeshData();
          pts.push({ x: fx, md, isSel: selKeys.some(k => k.type === 'sr' && k.childId === kids[i].getID()) });
        }
        // Dashed arcs only for the link set(s) of the SELECTED frame(s): highlight exactly
        // the other keys that editing the selection would also affect. Different instance
        // sets stay visually independent (no shared tint) — the arc appears on demand.
        const selData = new Set(pts.filter(p => p.isSel && p.md).map(p => p.md));
        if (selData.size) {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(137,220,235,0.7)'; // teal, matches the frame colour
          selData.forEach((md) => {
            const g = pts.filter(p => p.md === md).sort((a, b) => a.x - b.x);
            if (g.length < 2) return;
            for (let i = 0; i < g.length - 1; i++) {
              const x0 = g[i].x, x1 = g[i + 1].x;
              // A "square bracket on its side" (staple): straight down from each key, a
              // flat run across the bottom, back up to the next key — with the two sharp
              // bottom corners beveled by a small radius. Reads as an explicit connector,
              // not a soft curve. Fixed depth (same for every arc, independent of the gap);
              // the corner radius only shrinks for very narrow gaps so it can't overlap.
              const depth = 20;
              const r = Math.max(0, Math.min(7, (x1 - x0) / 2 - 2, depth - 2));
              const yb = fy + depth;
              ctx.beginPath();
              ctx.moveTo(x0, fy);
              ctx.arcTo(x0, yb, x0 + r, yb, r);   // down + bevel the bottom-left corner
              ctx.lineTo(x1 - r, yb);              // flat run across the bottom
              ctx.arcTo(x1, yb, x1, yb - r, r);    // bevel the bottom-right corner
              ctx.lineTo(x1, fy);                  // back up to the next key
              ctx.stroke();
            }
          });
          ctx.restore();
        }
        // Diamonds — teal, amber when selected.
        for (const p of pts) {
          ctx.save();
          ctx.translate(p.x, fy);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = p.isSel ? '#f9e2af' : '#89dceb';
          ctx.fillRect(-2.5, -2.5, 5, 5);
          if (p.isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(-3.5, -3.5, 7, 7); }
          ctx.restore();
        }
      }
    });
    ctx.restore(); // dopesheet vertical-scroll clip
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
    const prefix = activeTangent.type === 'transform' ? xfTanPrefix() : '';
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
      // EVERY VISIBLE GROUP, and the key REMEMBERS which one it came from.
      //
      // Read ungrouped, the marquee measured every key against the ACTIVE group's values and
      // tagged none of them -- so a rotation key came back untagged, defaulted to 'pos' when the
      // highlight asked which curve it belonged to, and drew unhighlighted on the rotation
      // curve. matt: "rotation keys ... they're selected, i can move them, but they're not
      // yellow." The move worked for the same reason the highlight failed: an untagged key
      // falls back to the active group, which happened to be the right one.
      for (const grp of xfVisible()) {
        if (grp === 'weight') continue;
        for (let i = 0; i < track.times.length; i++) {
          const t = track.times[i];
          if (t < tMin || t > tMax) continue;
          for (let c = 0; c < 3; c++) {
            if (!xfChanVisible(grp, c)) continue;
            const raw = xfRead(track, i, c, grp);
            if (typeof raw !== 'number' || !isFinite(raw)) continue;
            // The marquee's bounds come from SCREEN Y, so under Normalise they are in
            // normalised space and the key has to be compared there too -- otherwise the box
            // you drew and the keys it catches are measured in different units.
            const nr = window._animXfNorm && window._animXfNormRanges
              ? window._animXfNormRanges[grp] : null;
            const val = nr ? (raw - nr.mid) / nr.half : raw;
            if (val >= vMin && val <= vMax) {
              newKeys.push({ meshId: trackId, type: 'transform', index: i, channel: c,
                             group: grp, time: t });
            }
          }
        }
      }
      // The weight channel has its own keys, on its own times, so it cannot ride the loop above.
      if (xfVisible().indexOf('weight') >= 0) {
        const wT = xfWeightTrack(track);
        for (let i = 0; wT && i < wT.times.length; i++) {
          const t = wT.times[i];
          const nrw = window._animXfNorm && window._animXfNormRanges
            ? window._animXfNormRanges.weight : null;
          const wv = nrw ? (wT.values[i] - nrw.mid) / nrw.half : wT.values[i];
          if (t >= tMin && t <= tMax && wv >= vMin && wv <= vMax) {
            newKeys.push({ meshId: trackId, type: 'transform', index: i, channel: 0,
                           group: 'weight', time: t });
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

  // THREE STATES, ONE PALETTE, EVERY KEY TYPE.
  //
  // Keys used to be coloured by KIND — orange transform, blue shape, teal blendshape, another
  // blue for layer keys, each with its own selected and hovered variants. That is five hues
  // before anything is even selected, and the thing you need to read at a glance is not what
  // KIND a key is (its row already says that) but what STATE it is in.
  //
  //   white   nothing doing
  //   yellow  selected
  //   cyan    moving right now
  //
  // Muted keeps its grey: it means "this will not play", which is orthogonal to selection and
  // is the one distinction worth keeping.
  static keyFill(isSelected, isMoving, isMuted) {
    if (isMuted) return '#585b70';
    if (isMoving) return '#00ffff';   // before selected: a key being moved is also selected
    if (isSelected) return '#ffff00';
    return '#ffffff';
  }

  // Hover no longer has a hue of its own — cyan means "moving" now. A heavier outline keeps
  // preselection readable (you still need to see what the press will take) without putting a
  // fourth colour back.
  static keyRing(ctx, isHovered) {
    ctx.lineWidth = isHovered ? 3 : 1.5;
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
    // Shape layers (#34): deep-clone so the snapshot/undo paths that REPLACE the track
    // object (keyframe-move, transform-box) preserve layer keys + their vertex deltas.
    // _layerBase (the rest pose the deltas ride on) must ride along too, or playback loses
    // its reference after an undo.
    if (track.shapeLayers) {
      cloned.shapeLayers = track.shapeLayers.map(L => ({
        name: L.name, muted: L.muted,
        shapeTimes: L.shapeTimes ? [...L.shapeTimes] : [],
        shapes: L.shapes ? L.shapes.map(s => new Float32Array(s)) : [],
        shapeOutputTimes: L.shapeOutputTimes ? [...L.shapeOutputTimes] : []
      }));
      cloned.activeShapeLayerIdx = track.activeShapeLayerIdx;
      if (track._layerBase) cloned._layerBase = new Float32Array(track._layerBase);
    }
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

  // `fromDisp(displayValue, group)` converts back out of the space the graph is drawn in. The
  // box, its extent, its handles and the captured start values are ALL in display space -- so
  // the arithmetic below is one consistent space, and only the final write leaves it. With
  // Normalise off the caller passes the identity and nothing about raw mode changes.
  static scaleKeysVertical(track, initialKeys, initialBox, targetVal, handle, tBox, fromDisp) {
    const back = fromDisp || ((v) => v);
    let factor = 1.0;
    if (initialBox.maxV !== initialBox.minV) {
      if (handle === 'top') {
        factor = (targetVal - initialBox.minV) / (initialBox.maxV - initialBox.minV);
      } else {
        factor = (initialBox.maxV - targetVal) / (initialBox.maxV - initialBox.minV);
      }
    }
    
    // ONE PIVOT FOR EVERYTHING: the box's own edge, shared by every selected key.
    //
    // This briefly scaled each group about its own edge, on my reasoning that a shared pivot in
    // raw units maps one group's values through another's origin. That reasoning was about
    // units and matt's is about the GESTURE: "it would be common to scale all the keys to their
    // midpoint, and then move all the keys to zero." Collapsing a mixed selection onto one line
    // is the point of the move, and per-group pivots make it impossible -- each group collapses
    // onto its own line instead.
    //
    // The bug that per-group pivots appeared to fix was really the CENTRE drag writing keys
    // ungrouped (see _setKeyVal), so every key landed in the active group and the other curves
    // never moved. That is fixed at its source; the box behaves like a box again.
    initialKeys.forEach(sk => {
      const initialVal = sk.val ?? 0;
      let newVal = 0;
      if (handle === 'top') {
        newVal = initialBox.minV + (initialVal - initialBox.minV) * factor;
      } else {
        newVal = initialBox.maxV - (initialBox.maxV - initialVal) * factor;
      }
      if (sk.type === 'transform') {
        xfWrite(track, sk.index, sk.channel !== undefined ? sk.channel : 0,
                back(newVal, sk.group), sk.group);
      } else if (sk.type === 'shape' && track.shapeOutputTimes) {
        track.shapeOutputTimes[sk.index] = back(newVal, sk.group);
      } else if (sk.type === 'blendshape') {
        const bt = track.blendshapeTracks?.get(sk.name);
        // No 0..1 clamp — overshoot (below 0 / above 1) is intentionally allowed.
        if (bt?.values) bt.values[sk.index] = back(newVal, sk.group);
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

  // Multi-key manipulator. One consistent palette (accent blue), distinct handle
  // SHAPES matched to their hit zones: solid edge bars = resize (±10px), centre
  // square = scale-from-centre (±20px), faint body fill = move (grab anywhere),
  // top/bottom bars = value scale (graph only).
  static drawTransformBox(ctx, tBox, w, headerH, tlX, tlW, loopStart, visibleDuration, valueToYFunc = null) {
    const kxLeft = tlX + ((tBox.startTime - loopStart) / visibleDuration) * tlW;
    const kxRight = tlX + ((tBox.endTime - loopStart) / visibleDuration) * tlW;

    let kyTop = w.y + headerH;
    let kyBottom = w.y + w.h;
    const graph = !!(valueToYFunc && tBox.minV !== undefined && tBox.maxV !== undefined);
    if (graph) { kyTop = valueToYFunc(tBox.maxV); kyBottom = valueToYFunc(tBox.minV); }

    const kxMid = (kxLeft + kxRight) / 2;
    const kyMid = (kyTop + kyBottom) / 2;
    const ACCENT = '#89b4fa', INK = '#11111b';

    ctx.save();

    // Body — faint fill (grab anywhere to MOVE).
    ctx.fillStyle = 'rgba(137,180,250,0.10)';
    ctx.fillRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);

    // Bounds — subtle dashed outline.
    ctx.strokeStyle = 'rgba(137,180,250,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(kxLeft, kyTop, kxRight - kxLeft, kyBottom - kyTop);
    ctx.setLineDash([]);

    // Left/right RESIZE handles — solid grip bars (±10px hit zone).
    const gw = 8;
    ctx.fillStyle = ACCENT;
    ctx.fillRect(kxLeft - gw / 2, kyTop, gw, kyBottom - kyTop);
    ctx.fillRect(kxRight - gw / 2, kyTop, gw, kyBottom - kyTop);
    // grip ticks so the bars read as grabbable
    ctx.strokeStyle = 'rgba(17,17,27,0.5)';
    ctx.lineWidth = 1;
    [kxLeft, kxRight].forEach(gx => {
      for (let o = -5; o <= 5; o += 5) { ctx.beginPath(); ctx.moveTo(gx - 2, kyMid + o); ctx.lineTo(gx + 2, kyMid + o); ctx.stroke(); }
    });

    // Centre SCALE handle — filled square with outward arrows (±20px hit zone).
    const cs = 24;
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.fillRect(kxMid - cs / 2, kyMid - cs / 2, cs, cs);
    ctx.strokeRect(kxMid - cs / 2, kyMid - cs / 2, cs, cs);
    ctx.beginPath(); // ⤢ diagonal scale arrows
    ctx.moveTo(kxMid - 7, kyMid - 7); ctx.lineTo(kxMid + 7, kyMid + 7);
    ctx.moveTo(kxMid - 7, kyMid - 3); ctx.lineTo(kxMid - 7, kyMid - 7); ctx.lineTo(kxMid - 3, kyMid - 7);
    ctx.moveTo(kxMid + 3, kyMid + 7); ctx.lineTo(kxMid + 7, kyMid + 7); ctx.lineTo(kxMid + 7, kyMid + 3);
    ctx.stroke();

    // Value (top/bottom) handles — graph mode only.
    if (graph) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(kxMid - 12, kyTop - gw / 2, 24, gw);
      ctx.fillRect(kxMid - 12, kyBottom - gw / 2, 24, gw);
    }

    ctx.restore();
  }
}
