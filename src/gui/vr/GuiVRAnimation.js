import { xfTanPrefix } from '../../editing/xfChannel.js';

let isConfirmingClearAnim = false;
export default function getAnimationWidgets(main, Enums) {
  const widgets = [];

  const col1X = 20;
  const btnH = 50; 
  const gapBtn = 10;
  const gapHeader = 30;

  let y = 130;

  // Global Configuration Options
  window._animArmed = window._animArmed !== undefined ? window._animArmed : true;
  window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
  window._animActiveTool = window._animActiveTool || 'select';
  window._animMarqueeMode = window._animMarqueeMode || 'select_only';
  if (window._animTransformAutoSelect === undefined) window._animTransformAutoSelect = true;
  window._animPlaying = window._animPlaying || false;
  window._animMasterDuration = window._animMasterDuration !== undefined && window._animMasterDuration > 0 ? window._animMasterDuration : 2.0;
  window._animLoopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
  window._animLoopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : window._animMasterDuration;
  window._animPlaybackSpeed = window._animPlaybackSpeed || 1.0;

  window._animWaitForTrigger = window._animWaitForTrigger !== undefined ? window._animWaitForTrigger : true;
  window._animShowTangents = window._animShowTangents || false;

  // 1. Toggles Row
  widgets.push({
    type: 'checkbox', id: 'anim_count_toggle', label: 'Countdown',
    x: col1X, y: y, w: 464, h: 36,
    value: window._animCountIn,
    onInteract: () => {
      window._animCountIn = !window._animCountIn;
      if (window._animCountIn) window._animWaitForTrigger = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  widgets.push({
    type: 'checkbox', id: 'anim_trigger_toggle', label: 'Start on Trigger',
    x: col1X + 464 + 15, y: y, w: 464, h: 36,
    value: window._animWaitForTrigger,
    onInteract: () => {
      window._animWaitForTrigger = !window._animWaitForTrigger;
      if (window._animWaitForTrigger) window._animCountIn = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  // 2. Mode Row (Speed & Capture Rate)
  widgets.push({
    type: 'combobox', id: 'anim_speed', label: `Play at ${window._animPlaybackSpeed}x`,
    x: col1X, y: y, w: 464, h: 36,
    value: window._animPlaybackSpeed,
    options: [
      { id: 0.1, label: 'Play at 0.1x' },
      { id: 0.5, label: 'Play at 0.5x' },
      { id: 1.0, label: 'Play at 1.0x' },
      { id: 1.5, label: 'Play at 1.5x' },
      { id: 1.8, label: 'Play at 1.8x' },
      { id: 2.0, label: 'Play at 2.0x' },
      { id: 4.0, label: 'Play at 4.0x' }
    ],
    onInteract: (val) => {
      window._animPlaybackSpeed = parseFloat(val) || 1.0;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  window._animCaptureRate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.1;
  
  const currentFps = window._animFPS || 24;
  let rateLabel = "Capture at 10fps";
  if (window._animCaptureRate >= 0.9) rateLabel = "Capture at 1fps";
  else if (window._animCaptureRate >= 0.4) rateLabel = "Capture at 2fps";
  else if (window._animCaptureRate === 1 / currentFps) rateLabel = `Capture at ${currentFps}fps`;

  widgets.push({
    type: 'combobox', id: 'anim_capture_rate', label: rateLabel,
    x: col1X + 464 + 15, y: y, w: 464, h: 36,
    value: window._animCaptureRate,
    options: [
      { id: 1 / currentFps, label: `Capture at ${currentFps}fps` },
      { id: 0.1,   label: 'Capture at 10fps' },
      { id: 0.5,   label: 'Capture at 2fps' },
      { id: 1.0,   label: 'Capture at 1fps' }
    ],
    onInteract: (val) => {
      window._animCaptureRate = parseFloat(val) || 0.1;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;


  // 3. Clear All
  if (!isConfirmingClearAnim) {
    widgets.push({
      type: 'button', id: 'anim_reset_all', label: 'Reset',
      x: col1X, y: y, w: 944, h: 36,
      onInteract: () => {
        isConfirmingClearAnim = true;
        if (main._guiXR) main._guiXR.refreshToolsWidget();
      }
    });
    y += 36 + gapBtn;
  } else {
    widgets.push({
      type: 'info', id: 'anim_clear_info', label: 'Clear All Animation? (No Undo)', x: col1X, y: y, w: 944, h: 36, color: '#ff4444'
    });
    y += 36 + gapBtn;

    const halfW = (944 - gapBtn) / 2;
    widgets.push({
      type: 'button', id: 'anim_clear_ok', label: 'OK', x: col1X, y: y, w: halfW, h: 36,
      onInteract: () => {
        isConfirmingClearAnim = false;
        if (!window._animationRegistry) return;
        window._animationRegistry.stopRecording(true);
        window._animationRegistry.tracks.clear();
        // Through seek so the rig is redrawn where the cleared animation leaves it, rather than
        // still showing the pose the deleted keys were holding.
        window._animationRegistry.seek(0);
        if (main._guiXR) main._guiXR.refreshToolsWidget();
      }
    });

    widgets.push({
      type: 'button', id: 'anim_clear_cancel', label: 'Cancel', x: col1X + halfW + gapBtn, y: y, w: halfW, h: 36,
      onInteract: () => {
        isConfirmingClearAnim = false;
        if (main._guiXR) main._guiXR.refreshToolsWidget();
      }
    });
    y += 36 + gapBtn;
  }

  // 3. Standard 8-Button Transport Bar
  const tW = 944 / 8;
  
  // Jump to Start
  widgets.push({
    type: 'button', id: 'anim_to_start', label: '|◀', x: col1X, y: y, w: tW, h: btnH,
    onInteract: () => {
      // Through reg.seek, which also refreshes the DRAWN rig — see AnimationRegistry.seek.
      window._animationRegistry?.seek(0);
    }
  });

  // Previous Frame (Step -0.033s)
  widgets.push({
    type: 'button', id: 'anim_prev_frame', label: '◀◀', x: col1X + tW, y: y, w: tW, h: btnH,
    onInteract: () => {
      window._animationRegistry?.seek(Math.max(0, (window._animCurrentTime || 0) - 0.033));
    }
  });

  // Play Backwards
  widgets.push({
    type: 'button', id: 'anim_play_rev', label: '◀', x: col1X + tW*2, y: y, w: tW, h: btnH,
    data: { tint: (window._animPlaying && window._animationRegistry && window._animationRegistry.playbackDirection === -1) ? '#44ff44' : '#ccc' },
    onInteract: () => {
      const reg = window._animationRegistry;
      if (window._animPlaying && reg && reg.playbackDirection === -1) {
        window._animPlaying = false;
        reg.stopRecording(true);
      } else {
        window._animPlaying = true;
        if (reg) reg.playbackDirection = -1;
      }
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  // Stop
  widgets.push({
    type: 'button', id: 'anim_stop', label: '⬛', x: col1X + tW*3, y: y, w: tW, h: btnH,
    onInteract: () => {
      window._animPlaying = false;
      if (window._animationRegistry) {
        window._animationRegistry.stopRecording(true);
      }
    }
  });

  const isFlashing = window._animWaitingForGrab && (Date.now() % 1000 > 500);

  // Play Forwards
  widgets.push({
    type: 'button', id: 'anim_play_fwd', label: '▶', x: col1X + tW*4, y: y, w: tW, h: btnH,
    data: { tint: (window._animPlaying && window._animationRegistry && window._animationRegistry.playbackDirection !== -1) ? '#44ff44' : (isFlashing ? '#ff8800' : '#ccc') },
    onInteract: () => {
      const reg = window._animationRegistry;
      if (window._animPlaying && reg && reg.playbackDirection === 1) {
        window._animPlaying = false;
        reg.stopRecording(true);
      } else {
        window._animPlaying = true;
        if (reg) reg.playbackDirection = 1;
      }
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  // Next Frame (Step +0.033s)
  widgets.push({
    type: 'button', id: 'anim_next_frame', label: '▶▶', x: col1X + tW*5, y: y, w: tW, h: btnH,
    onInteract: () => {
      const maxLen = window._animMasterDuration || 1.0;
      window._animationRegistry?.seek(Math.min(maxLen, (window._animCurrentTime || 0) + 0.033));
    }
  });

  // Jump to End
  widgets.push({
    type: 'button', id: 'anim_to_end', label: '▶|', x: col1X + tW*6, y: y, w: tW, h: btnH,
    onInteract: () => {
      window._animationRegistry?.seek(window._animMasterDuration || 1.0);
    }
  });

  // Record
  widgets.push({
    type: 'button', id: 'anim_record', label: '⬤', x: col1X + tW*7, y: y, w: tW, h: btnH,
    data: { tint: (window._animationRegistry && (window._animationRegistry.isRecording || window._animationRegistry.isCountingIn)) ? '#ff4444' : (isFlashing ? '#ff8800' : '#ccc') },
    onInteract: () => {
      window._animationRegistry?.toggleRecord?.();
    }
  });

  y += btnH + gapBtn;

  // Desktop GUI defaults to 'transform', but VR sculpting needs 'shape'.
  // On first VR entry only, override to 'shape' so sculpt autokey works out-of-the-box.
  if (!window._animKeyModeVRInitDone) {
    window._animKeyMode = 'shape';
    window._animKeyModeVRInitDone = true;
  }

  const showFeedback = (text) => {
    window._animFeedbackText = text;
    window._animFeedbackTimer = performance.now();
    if (main._guiXR) main._guiXR._needsRedraw = true;
  };

  // 4. Giant Square Keyframe Button & Unified Toolbar
  const kRowW = 944;
  const giantBtnSize = 100;
  const subBtnH = (giantBtnSize - gapBtn) / 2;


  widgets.push({
    type: 'button', id: 'anim_add_key', label: '◆+', x: col1X, y: y, w: giantBtnSize, h: giantBtnSize,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      
      if (targetMesh) {
        const targetTime = window._animCurrentTime || 0;
        const meshId = targetMesh.getID();
        const track = window._animationRegistry.tracks.get(meshId);

        if (window._animKeyMode === 'shape') {
          let keyIdx = -1;
          if (track && track.shapeTimes) {
            for (let i = 0; i < track.shapeTimes.length; i++) {
              if (Math.abs(track.shapeTimes[i] - targetTime) < 0.005) {
                keyIdx = i;
                break;
              }
            }
          }
          const wasUpdate = keyIdx >= 0;
          let oldData = null;
          if (wasUpdate) {
            oldData = new Float32Array(track.shapes[keyIdx]);
          }
          
          const newData = new Float32Array(targetMesh.getVertices());

          window._animationRegistry.addShapeKey(targetMesh, targetTime);

          if (main.getStateManager) {
            main.getStateManager().pushStateCustom(
              () => { // UNDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                if (wasUpdate) {
                  let idx = 0;
                  while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                  if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                    tr.shapes[idx] = oldData;
                  }
                } else {
                  window._animationRegistry.deleteShapeKey(targetMesh, targetTime);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              },
              () => { // REDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                let idx = 0;
                while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                  tr.shapes[idx] = newData;
                } else {
                  tr.shapeTimes.splice(idx, 0, targetTime);
                  tr.shapes.splice(idx, 0, newData);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              }
            );
          }
          showFeedback('◆ Added Shape Key');
        } else {
          let keyIdx = -1;
          if (track && track.times) {
            for (let i = 0; i < track.times.length; i++) {
              if (Math.abs(track.times[i] - targetTime) < 0.005) {
                keyIdx = i;
                break;
              }
            }
          }
          const wasUpdate = keyIdx >= 0;
          let oldData = null;
          if (wasUpdate) {
            oldData = {
              pos: track.positions.slice(keyIdx * 3, keyIdx * 3 + 3),
              q: track.quaternions.slice(keyIdx * 4, keyIdx * 4 + 4),
              s: track.scales.slice(keyIdx * 3, keyIdx * 3 + 3)
            };
          }
          
          const tMat = targetMesh.getMatrix();
          const pos = [tMat[12], tMat[13], tMat[14]];
          const sx = Math.hypot(tMat[0], tMat[1], tMat[2]);
          const sy = Math.hypot(tMat[4], tMat[5], tMat[6]);
          const sz = Math.hypot(tMat[8], tMat[9], tMat[10]);
          
          let qx=0, qy=0, qz=0, qw=1;
          if (sx>0.0001 && sy>0.0001 && sz>0.0001) {
            const r00 = tMat[0]/sx, r01 = tMat[1]/sx, r02 = tMat[2]/sx;
            const r10 = tMat[4]/sy, r11 = tMat[5]/sy, r12 = tMat[6]/sy;
            const r20 = tMat[8]/sz, r21 = tMat[9]/sz, r22 = tMat[10]/sz;
            const trace = r00 + r11 + r22;
            if (trace > 0) {
              const s = 0.5 / Math.sqrt(trace + 1.0);
              qw = 0.25 / s; qx = (r12 - r21) * s; qy = (r20 - r02) * s; qz = (r01 - r10) * s;
            } else if (r00 > r11 && r00 > r22) {
              const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
              qw = (r12 - r21) / s; qx = 0.25 * s; qy = (r01 + r10) / s; qz = (r20 + r02) / s;
            } else if (r11 > r22) {
              const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
              qw = (r20 - r02) / s; qx = (r01 + r10) / s; qy = 0.25 * s; qz = (r12 + r21) / s;
            } else {
              const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
              qw = (r01 - r10) / s; qx = (r20 + r02) / s; qy = (r12 + r21) / s; qz = 0.25 * s;
            }
            const ql = Math.hypot(qx, qy, qz, qw) || 1.0;
            qx /= ql; qy /= ql; qz /= ql; qw /= ql;
          }

          const newData = { pos, q: [qx, qy, qz, qw], s: [sx, sy, sz] };

          window._animationRegistry.addTransformKey(targetMesh, targetTime);

          if (main.getStateManager) {
            main.getStateManager().pushStateCustom(
              () => { // UNDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                if (wasUpdate) {
                  let idx = 0;
                  while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                  if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                    tr.positions.splice(idx*3, 3, ...oldData.pos);
                    tr.quaternions.splice(idx*4, 4, ...oldData.q);
                    tr.scales.splice(idx*3, 3, ...oldData.s);
                  }
                } else {
                  window._animationRegistry.deleteTransformKey(targetMesh, targetTime);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              },
              () => { // REDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                let idx = 0;
                while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                  tr.positions.splice(idx*3, 3, ...newData.pos);
                  tr.quaternions.splice(idx*4, 4, ...newData.q);
                  tr.scales.splice(idx*3, 3, ...newData.s);
                } else {
                  tr.times.splice(idx, 0, targetTime);
                  tr.positions.splice(idx*3, 0, ...newData.pos);
                  tr.quaternions.splice(idx*4, 0, ...newData.q);
                  tr.scales.splice(idx*3, 0, ...newData.s);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              }
            );
          }
          showFeedback('◆ Added Transform Key');
        }
      }
    }
  });

  widgets.push({
    type: 'combobox', id: 'anim_key_mode', label: 'Keying mode: Shape', 
    x: col1X + giantBtnSize + gapBtn, y: y, w: kRowW - giantBtnSize - gapBtn, h: subBtnH,
    value: window._animKeyMode,
    options: [
      { id: 'shape', label: 'Keying mode: Shape' },
      { id: 'transform', label: 'Keying mode: Transform' }
    ],
    onInteract: () => {
      console.log(`[Combobox] onInteract, before toggle: ${window._animKeyMode}`);
      window._animKeyMode = (window._animKeyMode === 'shape') ? 'transform' : 'shape';
      console.log(`[Combobox] onInteract, after toggle: ${window._animKeyMode}`);
      showFeedback(`Switched to ${window._animKeyMode.toUpperCase()}`);
      
      if (window._animKeyMode === 'transform') {
        const sm = main.getSculptManager();
        console.log(`[Combobox] Got SculptManager: ${!!sm}`);
        if (sm) {
          const currTool = sm.getToolIndex();
          console.log(`[Combobox] Current Tool Index: ${currTool}, GRAB: ${Enums.Tools.GRAB}, TRANSFORM: ${Enums.Tools.TRANSFORM}`);
          if (currTool !== Enums.Tools.TRANSFORM && currTool !== Enums.Tools.GRAB) {
            console.log(`[Combobox] Setting tool to GRAB`);
            sm.setToolIndex(Enums.Tools.GRAB);
          }
        }
      }
    }
  });

  const subActW = (kRowW - giantBtnSize - gapBtn - 30) / 3;
  const subY = y + subBtnH + gapBtn;

  widgets.push({
    type: 'button', id: 'anim_copy_key', label: '📋 Copy', 
    x: col1X + giantBtnSize + gapBtn, y: subY, w: subActW, h: subBtnH,
    onInteract: () => {
      if (!window._animationRegistry) return;
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      
      if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
        window._animCopiedKeys = window._animSelectedKeys.map(k => {
          const track = window._animationRegistry.tracks.get(k.meshId);
          if (!track) return null;
          if (k.type === 'transform' && track.times) {
            return {
              meshId: k.meshId,
              type: 'transform',
              time: k.time,
              p: track.positions.slice(k.index*3, k.index*3+3),
              q: track.quaternions.slice(k.index*4, k.index*4+4),
              s: track.scales.slice(k.index*3, k.index*3+3)
            };
          } else if (k.type === 'shape' && track.shapeTimes) {
            return {
              meshId: k.meshId,
              type: 'shape',
              time: k.time,
              shape: new Float32Array(track.shapes[k.index])
            };
          }
          return null;
        }).filter(Boolean);
        showFeedback(`📋 Copied ${window._animCopiedKeys.length} Keys`);
      } else if (targetMesh) {
        if (window._animKeyMode === 'shape') {
          window._animationRegistry.copyShapeKey(targetMesh, window._animCurrentTime || 0);
          showFeedback('📋 Copied Shape Key');
        } else {
          window._animationRegistry.copyTransformKey(targetMesh, window._animCurrentTime || 0);
          showFeedback('📋 Copied Transform Key');
        }
      }
    }
  });

  widgets.push({
    type: 'button', id: 'anim_paste_key', label: '📥 Paste', 
    x: col1X + giantBtnSize + gapBtn + subActW + 15, y: subY, w: subActW, h: subBtnH,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      
      if (window._animCopiedKeys && window._animCopiedKeys.length > 0) {
        const tMin = Math.min(...window._animCopiedKeys.map(k => k.time));
        const pasteTime = window._animCurrentTime || 0;
        
        const commands = [];
        window._animCopiedKeys.forEach(k => {
          let trackMesh = null;
          if (main.getMeshes) trackMesh = main.getMeshes().find(m => m.getID() === k.meshId);
          if (!trackMesh) trackMesh = targetMesh;
          
          const targetTime = pasteTime + (k.time - tMin);
          const id = trackMesh.getID();
          
          if (!window._animationRegistry.tracks.has(id)) {
            window._animationRegistry.tracks.set(id, {
              times: [], positions: [], quaternions: [], scales: [],
              shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
            });
          }
          const track = window._animationRegistry.tracks.get(id);
          
          let wasUpdate = false;
          let oldData = null;
          
          if (k.type === 'transform') {
            let foundIdx = -1;
            if (track.times) {
              for (let i = 0; i < track.times.length; i++) {
                if (Math.abs(track.times[i] - targetTime) < 0.005) {
                  foundIdx = i;
                  break;
                }
              }
            }
            wasUpdate = foundIdx >= 0;
            if (wasUpdate) {
              oldData = {
                pos: track.positions.slice(foundIdx * 3, foundIdx * 3 + 3),
                q: track.quaternions.slice(foundIdx * 4, foundIdx * 4 + 4),
                s: track.scales.slice(foundIdx * 3, foundIdx * 3 + 3)
              };
              track.positions.splice(foundIdx * 3, 3, ...k.p);
              track.quaternions.splice(foundIdx * 4, 4, ...k.q);
              track.scales.splice(foundIdx * 3, 3, ...k.s);
            } else {
              track.times.push(targetTime);
              track.positions.push(...k.p);
              track.quaternions.push(...k.q);
              track.scales.push(...k.s);
            }
            
            commands.push({
              meshId: id,
              type: 'transform',
              time: targetTime,
              wasUpdate,
              oldData,
              newData: { pos: [...k.p], q: [...k.q], s: [...k.s] }
            });
          } else if (k.type === 'shape') {
            let foundIdx = -1;
            if (track.shapeTimes) {
              for (let i = 0; i < track.shapeTimes.length; i++) {
                if (Math.abs(track.shapeTimes[i] - targetTime) < 0.005) {
                  foundIdx = i;
                  break;
                }
              }
            }
            wasUpdate = foundIdx >= 0;
            if (wasUpdate) {
              oldData = new Float32Array(track.shapes[foundIdx]);
              track.shapes[foundIdx] = new Float32Array(k.shape);
            } else {
              track.shapeTimes.push(targetTime);
              if (!track.shapeOutputTimes) track.shapeOutputTimes = [];
              track.shapeOutputTimes.push(targetTime);
              track.shapes.push(new Float32Array(k.shape));
            }
            
            commands.push({
              meshId: id,
              type: 'shape',
              time: targetTime,
              wasUpdate,
              oldData,
              newData: new Float32Array(k.shape)
            });
          }
        });

        const affectedTrackIds = new Set(commands.map(c => c.meshId));
        affectedTrackIds.forEach(id => {
          const tr = window._animationRegistry.tracks.get(id);
          if (tr) {
            window._animationRegistry.sortTrack(tr);
            const mesh = main.getMeshes ? main.getMeshes().find(m => m.getID() === id) : null;
            if (mesh) window._animationRegistry.update(mesh, true);
          }
        });

        if (main.getStateManager && commands.length > 0) {
          main.getStateManager().pushStateCustom(
            () => { // UNDO
              commands.forEach(cmd => {
                const tr = window._animationRegistry.tracks.get(cmd.meshId);
                if (!tr) return;
                
                if (cmd.type === 'transform') {
                  if (cmd.wasUpdate) {
                    let idx = 0;
                    while (idx < tr.times.length && tr.times[idx] < cmd.time) idx++;
                    if (idx < tr.times.length && Math.abs(tr.times[idx] - cmd.time) < 0.005) {
                      tr.positions.splice(idx*3, 3, ...cmd.oldData.pos);
                      tr.quaternions.splice(idx*4, 4, ...cmd.oldData.q);
                      tr.scales.splice(idx*3, 3, ...cmd.oldData.s);
                    }
                  } else {
                    let idx = 0;
                    while (idx < tr.times.length && tr.times[idx] < cmd.time) idx++;
                    if (idx < tr.times.length && Math.abs(tr.times[idx] - cmd.time) < 0.005) {
                      tr.times.splice(idx, 1);
                      tr.positions.splice(idx*3, 3);
                      tr.quaternions.splice(idx*4, 4);
                      tr.scales.splice(idx*3, 3);
                    }
                  }
                } else if (cmd.type === 'shape') {
                  if (cmd.wasUpdate) {
                    let idx = 0;
                    while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < cmd.time) idx++;
                    if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - cmd.time) < 0.005) {
                      tr.shapes[idx] = cmd.oldData;
                    }
                  } else {
                    let idx = 0;
                    while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < cmd.time) idx++;
                    if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - cmd.time) < 0.005) {
                      tr.shapeTimes.splice(idx, 1);
                      if (tr.shapeOutputTimes) tr.shapeOutputTimes.splice(idx, 1);
                      tr.shapes.splice(idx, 1);
                    }
                  }
                }
              });
              
              affectedTrackIds.forEach(id => {
                const tr = window._animationRegistry.tracks.get(id);
                if (tr) window._animationRegistry.sortTrack(tr);
              });
              
              if (main._guiXR) main._guiXR._needsRedraw = true;
            },
            () => { // REDO
              commands.forEach(cmd => {
                const tr = window._animationRegistry.tracks.get(cmd.meshId);
                if (!tr) return;
                
                if (cmd.type === 'transform') {
                  let idx = 0;
                  while (idx < tr.times.length && tr.times[idx] < cmd.time) idx++;
                  
                  if (idx < tr.times.length && Math.abs(tr.times[idx] - cmd.time) < 0.005) {
                    tr.positions.splice(idx*3, 3, ...cmd.newData.pos);
                    tr.quaternions.splice(idx*4, 4, ...cmd.newData.q);
                    tr.scales.splice(idx*3, 3, ...cmd.newData.s);
                  } else {
                    tr.times.splice(idx, 0, cmd.time);
                    tr.positions.splice(idx*3, 0, ...cmd.newData.pos);
                    tr.quaternions.splice(idx*4, 0, ...cmd.newData.q);
                    tr.scales.splice(idx*3, 0, ...cmd.newData.s);
                  }
                } else if (cmd.type === 'shape') {
                  let idx = 0;
                  while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < cmd.time) idx++;
                  
                  if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - cmd.time) < 0.005) {
                    tr.shapes[idx] = cmd.newData;
                  } else {
                    tr.shapeTimes.splice(idx, 0, cmd.time);
                    if (tr.shapeOutputTimes) tr.shapeOutputTimes.splice(idx, 0, cmd.time);
                    tr.shapes.splice(idx, 0, cmd.newData);
                  }
                }
              });
              
              affectedTrackIds.forEach(id => {
                const tr = window._animationRegistry.tracks.get(id);
                if (tr) window._animationRegistry.sortTrack(tr);
              });
              
              if (main._guiXR) main._guiXR._needsRedraw = true;
            }
          );
        }
        showFeedback(`📥 Pasted ${window._animCopiedKeys.length} Keys`);
      } else if (targetMesh) {
        const targetTime = window._animCurrentTime || 0;
        const meshId = targetMesh.getID();
        const track = window._animationRegistry.tracks.get(meshId);

        if (window._animKeyMode === 'shape' && window._animationRegistry.clipboardShape) {
          let keyIdx = -1;
          if (track && track.shapeTimes) {
            for (let i = 0; i < track.shapeTimes.length; i++) {
              if (Math.abs(track.shapeTimes[i] - targetTime) < 0.005) {
                keyIdx = i;
                break;
              }
            }
          }
          const wasUpdate = keyIdx >= 0;
          let oldData = null;
          if (wasUpdate) {
            oldData = new Float32Array(track.shapes[keyIdx]);
          }
          
          window._animationRegistry.pasteShapeKey(targetMesh, targetTime);
          window._animationRegistry.update(targetMesh, true);

          if (main.getStateManager) {
            main.getStateManager().pushStateCustom(
              () => { // UNDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                if (wasUpdate) {
                  let idx = 0;
                  while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                  if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                    tr.shapes[idx] = oldData;
                  }
                } else {
                  window._animationRegistry.deleteShapeKey(targetMesh, targetTime);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              },
              () => { // REDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                let idx = 0;
                while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                  tr.shapes[idx] = newData;
                } else {
                  tr.shapeTimes.splice(idx, 0, targetTime);
                  tr.shapes.splice(idx, 0, newData);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              }
            );
          }
          showFeedback('📥 Pasted Shape Key');
        } else if (window._animationRegistry.clipboardTransform) {
          let keyIdx = -1;
          if (track && track.times) {
            for (let i = 0; i < track.times.length; i++) {
              if (Math.abs(track.times[i] - targetTime) < 0.005) {
                keyIdx = i;
                break;
              }
            }
          }
          const wasUpdate = keyIdx >= 0;
          let oldData = null;
          if (wasUpdate) {
            oldData = {
              pos: track.positions.slice(keyIdx * 3, keyIdx * 3 + 3),
              q: track.quaternions.slice(keyIdx * 4, keyIdx * 4 + 4),
              s: track.scales.slice(keyIdx * 3, keyIdx * 3 + 3)
            };
          }
          
          const newData = {
            pos: [...window._animationRegistry.clipboardTransform.p],
            q: [...window._animationRegistry.clipboardTransform.q],
            s: [...window._animationRegistry.clipboardTransform.s]
          };

          window._animationRegistry.pasteTransformKey(targetMesh, targetTime);
          window._animationRegistry.update(targetMesh, true);

          if (main.getStateManager) {
            main.getStateManager().pushStateCustom(
              () => { // UNDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                if (wasUpdate) {
                  let idx = 0;
                  while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                  if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                    tr.positions.splice(idx*3, 3, ...oldData.pos);
                    tr.quaternions.splice(idx*4, 4, ...oldData.q);
                    tr.scales.splice(idx*3, 3, ...oldData.s);
                  }
                } else {
                  window._animationRegistry.deleteTransformKey(targetMesh, targetTime);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              },
              () => { // REDO
                const tr = window._animationRegistry.tracks.get(meshId);
                if (!tr) return;
                let idx = 0;
                while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                  tr.positions.splice(idx*3, 3, ...newData.pos);
                  tr.quaternions.splice(idx*4, 4, ...newData.q);
                  tr.scales.splice(idx*3, 3, ...newData.s);
                } else {
                  tr.times.splice(idx, 0, targetTime);
                  tr.positions.splice(idx*3, 0, ...newData.pos);
                  tr.quaternions.splice(idx*4, 0, ...newData.q);
                  tr.scales.splice(idx*3, 0, ...newData.s);
                }
                if (main._guiXR) main._guiXR._needsRedraw = true;
              }
            );
          }
          showFeedback('📥 Pasted Transform Key');
        }
      }
    }
  });

  widgets.push({
    type: 'button', id: 'anim_del_key', label: '🗑️ Del', 
    x: col1X + giantBtnSize + gapBtn + (subActW + 15)*2, y: subY, w: subActW, h: subBtnH,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      
      if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
        const keysToDelete = [...window._animSelectedKeys];
        const savedKeysData = [];
        
        keysToDelete.forEach(k => {
          const track = window._animationRegistry.tracks.get(k.meshId);
          if (!track) return;
          
          if (k.type === 'shape' && track.shapeTimes) {
            let foundIdx = -1;
            for (let i = 0; i < track.shapeTimes.length; i++) {
              if (Math.abs(track.shapeTimes[i] - k.time) < 0.005) {
                foundIdx = i;
                break;
              }
            }
            if (foundIdx >= 0) {
              savedKeysData.push({
                meshId: k.meshId,
                type: 'shape',
                time: k.time,
                data: new Float32Array(track.shapes[foundIdx])
              });
            }
          } else if (k.type === 'transform' && track.times) {
            let foundIdx = -1;
            for (let i = 0; i < track.times.length; i++) {
              if (Math.abs(track.times[i] - k.time) < 0.005) {
                foundIdx = i;
                break;
              }
            }
            if (foundIdx >= 0) {
              savedKeysData.push({
                meshId: k.meshId,
                type: 'transform',
                time: k.time,
                data: {
                  pos: track.positions.slice(foundIdx * 3, foundIdx * 3 + 3),
                  q: track.quaternions.slice(foundIdx * 4, foundIdx * 4 + 4),
                  s: track.scales.slice(foundIdx * 3, foundIdx * 3 + 3)
                }
              });
            }
          }
        });

        // Perform deletion
        keysToDelete.forEach(k => {
          let trackMesh = null;
          if (main.getMeshes) trackMesh = main.getMeshes().find(m => m.getID() === k.meshId);
          if (!trackMesh) trackMesh = targetMesh;
          
          if (k.type === 'shape') {
            window._animationRegistry.deleteShapeKey(trackMesh, k.time);
          } else {
            window._animationRegistry.deleteTransformKey(trackMesh, k.time);
          }
        });

        if (main.getStateManager && savedKeysData.length > 0) {
          main.getStateManager().pushStateCustom(
            () => { // UNDO
              const affectedTracks = new Set();
              savedKeysData.forEach(k => {
                const tr = window._animationRegistry.tracks.get(k.meshId);
                if (!tr) return;
                affectedTracks.add(tr);
                
                if (k.type === 'shape') {
                  tr.shapeTimes.push(k.time);
                  tr.shapes.push(k.data);
                } else {
                  tr.times.push(k.time);
                  tr.positions.push(...k.data.pos);
                  tr.quaternions.push(...k.data.q);
                  tr.scales.push(...k.data.s);
                }
              });
              
              affectedTracks.forEach(tr => {
                window._animationRegistry.sortTrack(tr);
              });
              
              if (main._guiXR) main._guiXR._needsRedraw = true;
            },
            () => { // REDO
              savedKeysData.forEach(k => {
                let trackMesh = null;
                if (main.getMeshes) trackMesh = main.getMeshes().find(m => m.getID() === k.meshId);
                if (!trackMesh) trackMesh = targetMesh;
                
                if (k.type === 'shape') {
                  window._animationRegistry.deleteShapeKey(trackMesh, k.time);
                } else {
                  window._animationRegistry.deleteTransformKey(trackMesh, k.time);
                }
              });
              if (main._guiXR) main._guiXR._needsRedraw = true;
            }
          );
        }

        window._animSelectedKeys = [];
        showFeedback(`🗑️ Deleted ${keysToDelete.length} Keys`);
      } else if (targetMesh) {
        const t = window._animLastTouchedKeyTime !== undefined ? window._animLastTouchedKeyTime : (window._animCurrentTime || 0);
        const meshId = targetMesh.getID();
        const track = window._animationRegistry.tracks.get(meshId);
        
        if (window._animKeyMode === 'shape') {
          let foundIdx = -1;
          if (track && track.shapeTimes) {
            for (let i = 0; i < track.shapeTimes.length; i++) {
              if (Math.abs(track.shapeTimes[i] - t) < 0.05) {
                foundIdx = i;
                break;
              }
            }
          }
          
          if (foundIdx >= 0) {
            const savedTime = track.shapeTimes[foundIdx];
            const savedData = new Float32Array(track.shapes[foundIdx]);
            
            window._animationRegistry.deleteShapeKey(targetMesh, t);
            
            if (main.getStateManager) {
              main.getStateManager().pushStateCustom(
                () => { // UNDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (tr) {
                    tr.shapeTimes.push(savedTime);
                    tr.shapes.push(savedData);
                    window._animationRegistry.sortTrack(tr);
                  }
                  if (main._guiXR) main._guiXR._needsRedraw = true;
                },
                () => { // REDO
                  window._animationRegistry.deleteShapeKey(targetMesh, savedTime);
                  if (main._guiXR) main._guiXR._needsRedraw = true;
                }
              );
            }
          }
          showFeedback('🗑️ Deleted Shape Key');
        } else {
          let foundIdx = -1;
          if (track && track.times) {
            for (let i = 0; i < track.times.length; i++) {
              if (Math.abs(track.times[i] - t) < 0.05) {
                foundIdx = i;
                break;
              }
            }
          }
          
          if (foundIdx >= 0) {
            const savedTime = track.times[foundIdx];
            const savedData = {
              pos: track.positions.slice(foundIdx * 3, foundIdx * 3 + 3),
              q: track.quaternions.slice(foundIdx * 4, foundIdx * 4 + 4),
              s: track.scales.slice(foundIdx * 3, foundIdx * 3 + 3)
            };
            
            window._animationRegistry.deleteTransformKey(targetMesh, t);
            
            if (main.getStateManager) {
              main.getStateManager().pushStateCustom(
                () => { // UNDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (tr) {
                    tr.times.push(savedTime);
                    tr.positions.push(...savedData.pos);
                    tr.quaternions.push(...savedData.q);
                    tr.scales.push(...savedData.s);
                    window._animationRegistry.sortTrack(tr);
                  }
                  if (main._guiXR) main._guiXR._needsRedraw = true;
                },
                () => { // REDO
                  window._animationRegistry.deleteTransformKey(targetMesh, savedTime);
                  if (main._guiXR) main._guiXR._needsRedraw = true;
                }
              );
            }
          }
          showFeedback('🗑️ Deleted Transform Key');
        }
        window._animLastTouchedKeyTime = undefined; // Reset
      }
    }
  });

  y += giantBtnSize + gapBtn;

  // --- NEW ORDER ---



  // 6. Timeline FPS & AutoKey Row
  if (window._animAutoKey === undefined) window._animAutoKey = false;

  widgets.push({
    type: 'slider', id: 'anim_fps', label: 'Timeline FPS',
    x: col1X, y: y, w: 464, h: 50,
    value: window._animFPS || 24,
    min: 1, max: 60, step: 1,
    onInput: (val) => {
      window._animFPS = Math.round(val);
      if (main._guiXR) {
        const widgets = main._guiXR._getWidgets();
        if (widgets) {
          const durSlider = widgets.find(w => w.id === 'anim_master_duration');
          if (durSlider) durSlider.step = 1 / window._animFPS;
          const startSlider = widgets.find(w => w.id === 'anim_loop_start');
          if (startSlider) startSlider.step = 1 / window._animFPS;
          const endSlider = widgets.find(w => w.id === 'anim_loop_end');
          if (endSlider) endSlider.step = 1 / window._animFPS;
        }
        main._guiXR._needsRedraw = true;
      }
    }
  });

  widgets.push({
    type: 'checkbox', id: 'anim_autokey', label: 'AutoKey',
    x: col1X + 464 + 15, y: y, w: 464, h: 50,
    value: window._animAutoKey,
    onInteract: (val) => {
      window._animAutoKey = !window._animAutoKey;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 50 + gapBtn;

  // 7. Unified Triple Slider Row (Duration, Start, End)
  const sW = (944 - 30) / 3; // 304px each
  
  widgets.push({
    type: 'slider', id: 'anim_master_duration', label: 'Duration', 
    x: col1X, y: y, w: sW, h: 50,
    min: 1.0, max: 30.0, step: 1 / (window._animFPS || 24),
    value: window._animMasterDuration || 2.0,
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    getDisplayValue: (val) => `${Math.round(val * (window._animFPS || 24))}`,
    fromDisplayValue: (val) => val / (window._animFPS || 24),
    onInput: (val) => {
      window._animMasterDuration = val;
      window._animLoopEnd = val;
      if (window._animLoopStart !== undefined && window._animLoopStart >= val) {
        window._animLoopStart = Math.max(0, val - 0.1);
      }
    }
  });

  widgets.push({
    type: 'slider', id: 'anim_loop_start', label: 'Start', 
    x: col1X + sW + 15, y: y, w: sW, h: 50,
    min: 0.0, max: window._animMasterDuration || 2.0, step: 1 / (window._animFPS || 24),
    value: window._animLoopStart || 0.0,
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    getDisplayValue: (val) => `${Math.round(val * (window._animFPS || 24))}`,
    fromDisplayValue: (val) => val / (window._animFPS || 24),
    onInput: (val) => {
      window._animLoopStart = val;
      if (window._animLoopEnd !== undefined && window._animLoopStart >= window._animLoopEnd) {
        window._animLoopStart = Math.max(0, window._animLoopEnd - 0.1);
      }
      // Dragging the loop start parks the playhead on it, which is a jump like any other.
      window._animationRegistry?.seek(window._animLoopStart);
    }
  });

  widgets.push({
    type: 'slider', id: 'anim_loop_end', label: 'End', 
    x: col1X + (sW + 15)*2, y: y, w: sW, h: 50,
    min: 0.0, max: window._animMasterDuration || 2.0, step: 1 / (window._animFPS || 24),
    value: window._animLoopEnd !== undefined ? window._animLoopEnd : (window._animMasterDuration || 2.0),
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    getDisplayValue: (val) => `${Math.round(val * (window._animFPS || 24))}`,
    fromDisplayValue: (val) => val / (window._animFPS || 24),
    onInput: (val) => {
      window._animLoopEnd = val;
      if (window._animLoopStart !== undefined && window._animLoopEnd <= window._animLoopStart) {
        window._animLoopEnd = window._animLoopStart + 0.1;
      }
    }
  });
  y += 50 + gapBtn;

  // 8. Timeline Mode, Op: Select, Show Tangents, Tie/Break Row
  const reg = window._animationRegistry;
  window._animTimelineMode = window._animTimelineMode || 'dope';
  
  const qW = 228; // Quarter width with 10px gaps
  
  // Timeline Mode
  widgets.push({
    type: 'combobox', id: 'anim_timeline_mode', label: window._animTimelineMode === 'graph' ? 'Graph Editor' : 'Timeline',
    x: col1X, y: y, w: qW, h: 36,
    value: window._animTimelineMode,
    options: [
      { id: 'dope', label: 'Timeline' },
      { id: 'graph', label: 'Graph Editor' }
    ],
    onInteract: (val) => {
      const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'dope');
      window._animTimelineMode = newMode;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    },
    onSelect: (val) => {
      const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'dope');
      window._animTimelineMode = newMode;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  // Op: Select
  widgets.push({
    type: 'combobox', id: 'anim_active_tool', label: `🗜️ ${window._animActiveTool.toUpperCase()}`,
    x: col1X + qW + gapBtn, y: y, w: qW, h: 36,
    value: window._animActiveTool,
    options: [
      { id: 'select', label: 'Op: Select' },
      { id: 'marquee', label: 'Op: Marquee' },
      { id: 'transform', label: 'Op: Transform' }
    ],
    onInteract: (val) => {
      const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'select');
      window._animActiveTool = newMode;
      window._waitingForTriggerReleaseAfterToolChange = true;
      if (newMode !== 'transform') {
        window._animTransformBox = null;
      }
      if (main._guiXR) {
        main._guiXR._marqueeStart = null;
        main._guiXR._marqueeEnd = null;
        main._guiXR._activeTimeline = null;
        main._guiXR._transformBoxDrawing = false;
        main._guiXR._activeTransformHandle = null;
        main._guiXR._animTransformBoxInitialTimes = null;
        main._guiXR._animTransformInitialBox = null;
        main._guiXR._needsRedraw = true;
      }
      if (newMode === 'transform') {
        const sm = main.getSculptManager();
        if (sm) sm.setToolIndex(Enums.Tools.GRAB); 
        
        if (reg && window._animSelectedKeys && window._animSelectedKeys.length > 1) {
          let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
          window._animSelectedKeys.forEach(sk => {
            const tr = reg.tracks.get(sk.meshId);
            if (tr) {
              const t = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
              const val = sk.type === 'transform' ? tr.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)] : 0;
              if (t < minT) minT = t;
              if (t > maxT) maxT = t;
              if (val < minV) minV = val;
              if (val > maxV) maxV = val;
            }
          });
          if (minT !== Infinity && maxT !== Infinity && minV !== Infinity && maxV !== Infinity) {
            window._animTransformBox = { startTime: minT, endTime: maxT, minV, maxV };
          }
        }

        if (main._guiXR) {
          main._guiXR.refreshToolsWidget();
          main._guiXR.syncWidgetValues();
        }
      }
    },
    onSelect: (val) => {
      const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'select');
      window._animActiveTool = newMode;
      window._waitingForTriggerReleaseAfterToolChange = true;
      if (newMode !== 'transform') {
        window._animTransformBox = null;
      }
      if (main._guiXR) {
        main._guiXR._marqueeStart = null;
        main._guiXR._marqueeEnd = null;
        main._guiXR._activeTimeline = null;
        main._guiXR._transformBoxDrawing = false;
        main._guiXR._activeTransformHandle = null;
        main._guiXR._animTransformBoxInitialTimes = null;
        main._guiXR._animTransformInitialBox = null;
        main._guiXR._needsRedraw = true;
      }
      if (newMode === 'transform') {
        const sm = main.getSculptManager();
        if (sm) sm.setToolIndex(Enums.Tools.GRAB); 
        if (window.screenLog) window.screenLog(`[Toolbar] Swapped to Grab Tool Mode!`, 'green');
        
        if (reg && window._animSelectedKeys && window._animSelectedKeys.length > 1) {
          let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
          window._animSelectedKeys.forEach(sk => {
            const tr = reg.tracks.get(sk.meshId);
            if (tr) {
              const t = sk.type === 'transform' ? tr.times[sk.index] : tr.shapeTimes[sk.index];
              const val = sk.type === 'transform' ? tr.positions[sk.index * 3 + (sk.channel !== undefined ? sk.channel : 0)] : 0;
              if (t < minT) minT = t;
              if (t > maxT) maxT = t;
              if (val < minV) minV = val;
              if (val > maxV) maxV = val;
            }
          });
          if (minT !== Infinity && maxT !== Infinity && minV !== Infinity && maxV !== Infinity) {
            window._animTransformBox = { startTime: minT, endTime: maxT, minV, maxV };
          }
        }

        if (main._guiXR) {
          main._guiXR.refreshToolsWidget();
          main._guiXR.syncWidgetValues();
        }
      }
    }
  });

  // Tangent buttons always visible but disabled if not in graph mode
  const isGraphMode = window._animTimelineMode === 'graph';
  
  // Show Tangents
  widgets.push({
    type: 'checkbox', id: 'anim_tangent_toggle', label: 'Show Tangents',
    x: col1X + (qW + gapBtn) * 2, y: y, w: qW, h: 36,
    value: window._animShowTangents,
    disabled: !isGraphMode,
    onInteract: () => {
      window._animShowTangents = !window._animShowTangents;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  // Tie/Break Tangent
  widgets.push({
    type: 'button', id: 'anim_tangent_tied_toggle', label: 'Tie/Break Tangent',
    x: col1X + (qW + gapBtn) * 3, y: y, w: qW, h: 36,
    disabled: !isGraphMode,
    onInteract: () => {
      if (!reg) return;
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;
      if (singleSelected) {
        const track = reg.tracks.get(singleSelected.meshId);
        if (track) {
          if (!track.tangentOffsets) track.tangentOffsets = {};
          const key = `trans_${singleSelected.index}_tied`;
          const cur = track.tangentOffsets[key] !== false;
          track.tangentOffsets[key] = !cur;
          if (main._guiXR) main._guiXR._needsRedraw = true;
          showFeedback(cur ? 'Broken Tangent' : 'Tied Tangent');
        }
      } else {
        showFeedback('Select a single key first');
      }
    }
  });
  y += 36 + gapBtn;

  // Flatten Tangents Row
  widgets.push({
    type: 'button', id: 'anim_flatten_tangents', label: 'Flatten Tangents',
    x: col1X, y: y, w: 464, h: 36,
    disabled: !isGraphMode,
    onInteract: () => {
      if (!isGraphMode) return;
      const reg = window._animationRegistry;
      if (!reg) return;
      
      if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
        const savedData = [];
        
        window._animSelectedKeys.forEach(sk => {
          const track = reg.tracks.get(sk.meshId);
          if (track) {
            if (!track.tangentOffsets) track.tangentOffsets = {};
            const prefix = sk.type === 'transform' ? xfTanPrefix() : '';
            const channel = sk.channel !== undefined ? sk.channel : 0;
            
            const leftKey = `${prefix}${sk.index}_left_dv`;
            const rightKey = `${prefix}${sk.index}_right_dv`;
            const leftChanKey = `${prefix}${sk.index}_left_dv_${channel}`;
            const rightChanKey = `${prefix}${sk.index}_right_dv_${channel}`;

            // Save old values
            savedData.push({
              meshId: sk.meshId,
              prefix,
              index: sk.index,
              channel,
              type: sk.type,
              oldLeftDv: track.tangentOffsets[leftKey],
              oldRightDv: track.tangentOffsets[rightKey],
              oldLeftChanDv: track.tangentOffsets[leftChanKey],
              oldRightChanDv: track.tangentOffsets[rightChanKey]
            });

            // Apply flatten
            track.tangentOffsets[leftKey] = 0;
            track.tangentOffsets[rightKey] = 0;
            if (sk.type === 'transform') {
              track.tangentOffsets[leftChanKey] = 0;
              track.tangentOffsets[rightChanKey] = 0;
            }
          }
        });

        // Push to State Manager for Undo/Redo
        if (main.getStateManager && savedData.length > 0) {
          main.getStateManager().pushStateCustom(
            () => { // UNDO
              savedData.forEach(d => {
                const track = reg.tracks.get(d.meshId);
                if (track && track.tangentOffsets) {
                  const leftKey = `${d.prefix}${d.index}_left_dv`;
                  const rightKey = `${d.prefix}${d.index}_right_dv`;
                  const leftChanKey = `${d.prefix}${d.index}_left_dv_${d.channel}`;
                  const rightChanKey = `${d.prefix}${d.index}_right_dv_${d.channel}`;

                  if (d.oldLeftDv !== undefined) track.tangentOffsets[leftKey] = d.oldLeftDv;
                  else delete track.tangentOffsets[leftKey];
                  
                  if (d.oldRightDv !== undefined) track.tangentOffsets[rightKey] = d.oldRightDv;
                  else delete track.tangentOffsets[rightKey];

                  if (d.type === 'transform') {
                    if (d.oldLeftChanDv !== undefined) track.tangentOffsets[leftChanKey] = d.oldLeftChanDv;
                    else delete track.tangentOffsets[leftChanKey];
                    
                    if (d.oldRightChanDv !== undefined) track.tangentOffsets[rightChanKey] = d.oldRightChanDv;
                    else delete track.tangentOffsets[rightChanKey];
                  }
                }
              });
              if (main._guiXR) main._guiXR._needsRedraw = true;
            },
            () => { // REDO
              savedData.forEach(d => {
                const track = reg.tracks.get(d.meshId);
                if (track && track.tangentOffsets) {
                  const leftKey = `${d.prefix}${d.index}_left_dv`;
                  const rightKey = `${d.prefix}${d.index}_right_dv`;
                  const leftChanKey = `${d.prefix}${d.index}_left_dv_${d.channel}`;
                  const rightChanKey = `${d.prefix}${d.index}_right_dv_${d.channel}`;

                  track.tangentOffsets[leftKey] = 0;
                  track.tangentOffsets[rightKey] = 0;
                  if (d.type === 'transform') {
                    track.tangentOffsets[leftChanKey] = 0;
                    track.tangentOffsets[rightChanKey] = 0;
                  }
                }
              });
              if (main._guiXR) main._guiXR._needsRedraw = true;
            }
          );
        }

        if (main._guiXR) main._guiXR._needsRedraw = true;
        showFeedback(`Flattened ${savedData.length} Tangents`);
      } else {
        showFeedback('Select keys first');
      }
    }
  });

  if (window._animLockTangentAngle === undefined) window._animLockTangentAngle = false;

  widgets.push({
    type: 'checkbox', id: 'anim_lock_tangent_angle', label: 'Lock Angle',
    x: col1X + 464 + 15, y: y, w: 464, h: 36,
    value: window._animLockTangentAngle,
    disabled: !isGraphMode,
    onInteract: () => {
      window._animLockTangentAngle = !window._animLockTangentAngle;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  // 5. Conditional Tool Row (Marquee Mode or Transform Auto Select)
  // 5. Conditional Tool Row (Marquee Mode or Transform Auto Select)
  const toolRowH = 36;
  if (window._animActiveTool === 'marquee') {
    widgets.push({
      type: 'combobox', id: 'anim_marquee_mode', label: `Mode: ${window._animMarqueeMode.toUpperCase()}`,
      x: col1X, y: y, w: 944, h: toolRowH,
      value: window._animMarqueeMode,
      options: [
        { id: 'select_only', label: 'Auto Select & Exit' },
        { id: 'add', label: 'Add to Selection' },
        { id: 'remove', label: 'Remove from Selection' }
      ],
      onInteract: (val) => {
        const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'select_only');
        window._animMarqueeMode = newMode;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      },
      onSelect: (val) => {
        const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'select_only');
        window._animMarqueeMode = newMode;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    });
  } else if (window._animActiveTool === 'transform') {
    widgets.push({
      type: 'checkbox', id: 'anim_transform_auto', label: 'Auto Select Keys',
      x: col1X, y: y, w: 944, h: toolRowH,
      value: window._animTransformAutoSelect,
      onInteract: (val) => {
        window._animTransformAutoSelect = !window._animTransformAutoSelect;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    });
  } else {
    // Fallback: Show marquee mode combobox but disabled to prevent layout shifts
    widgets.push({
      type: 'combobox', id: 'anim_marquee_mode_disabled', label: 'Mode: N/A',
      x: col1X, y: y, w: 944, h: toolRowH,
      value: 'select_only',
      options: [
        { id: 'select_only', label: 'Auto Select & Exit' }
      ],
      disabled: true
    });
  }
  y += toolRowH + gapBtn;

  // 9. Sleek Timeline
  widgets.push({
    type: 'timeline',
    id: 'anim_timeline',
    x: col1X, y: y, w: 944, h: 240
  });

  return widgets;
}
