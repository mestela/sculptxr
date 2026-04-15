export default function getAnimationWidgets(main) {
  const widgets = [];

  const col1X = 20;
  const btnH = 50; 
  const gapBtn = 15;
  const gapHeader = 30;

  let y = 130;

  // Global Configuration Options
  window._animArmed = window._animArmed !== undefined ? window._animArmed : true;
  window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
  window._animPlaying = window._animPlaying || false;
  window._animMasterDuration = window._animMasterDuration !== undefined && window._animMasterDuration > 0 ? window._animMasterDuration : 2.0;
  window._animLoopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
  window._animLoopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : window._animMasterDuration;
  window._animPlaybackSpeed = window._animPlaybackSpeed || 1.0;

  window._animWaitForTrigger = window._animWaitForTrigger !== undefined ? window._animWaitForTrigger : true;
  window._animShowTangents = window._animShowTangents || false;

  // 1. Toggles Row
  widgets.push({
    type: 'checkbox', id: 'anim_count_toggle', label: 'Use 3-Second Countdown',
    x: col1X, y: y, w: 350, h: 36,
    value: window._animCountIn,
    onInteract: () => {
      window._animCountIn = !window._animCountIn;
      if (window._animCountIn) window._animWaitForTrigger = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  widgets.push({
    type: 'checkbox', id: 'anim_trigger_toggle', label: 'Start on Trigger',
    x: col1X + 360, y: y, w: 350, h: 36,
    value: window._animWaitForTrigger,
    onInteract: () => {
      window._animWaitForTrigger = !window._animWaitForTrigger;
      if (window._animWaitForTrigger) window._animCountIn = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  // 2. Mode Row (Tangents & Speed)
  widgets.push({
    type: 'checkbox', id: 'anim_tangent_toggle', label: 'Show Tangent Handles',
    x: col1X, y: y, w: 350, h: 36,
    value: window._animShowTangents,
    onInteract: () => {
      window._animShowTangents = !window._animShowTangents;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  widgets.push({
    type: 'combobox', id: 'anim_speed', label: `Speed: ${window._animPlaybackSpeed}x`,
    x: col1X + 360, y: y, w: 350, h: 36,
    value: window._animPlaybackSpeed,
    options: [
      { id: 0.1, label: 'Speed: 0.1x' },
      { id: 0.5, label: 'Speed: 0.5x' },
      { id: 1.0, label: 'Speed: 1.0x' },
      { id: 1.5, label: 'Speed: 1.5x' },
      { id: 1.8, label: 'Speed: 1.8x' },
      { id: 2.0, label: 'Speed: 2.0x' },
      { id: 4.0, label: 'Speed: 4.0x' }
    ],
    onInteract: (val) => {
      window._animPlaybackSpeed = parseFloat(val) || 1.0;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  window._animCaptureRate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.033;
  let rateLabel = "Dense (~30 fps)";
  if (window._animCaptureRate >= 0.9) rateLabel = "Sparse (1.0s)";
  else if (window._animCaptureRate >= 0.4) rateLabel = "Sparse (0.5s)";
  else if (window._animCaptureRate >= 0.09) rateLabel = "Standard (~10 fps)";

  widgets.push({
    type: 'combobox', id: 'anim_capture_rate', label: `Rec Rate: ${rateLabel}`,
    x: col1X, y: y, w: 710, h: 36,
    value: window._animCaptureRate,
    options: [
      { id: 0.033, label: 'Dense (~30 fps / 0.03s)' },
      { id: 0.1,   label: 'Standard (~10 fps / 0.1s)' },
      { id: 0.5,   label: 'Sparse (2 fps / 0.5s)' },
      { id: 1.0,   label: 'Step Key (1 fps / 1.0s)' }
    ],
    onInteract: (val) => {
      window._animCaptureRate = parseFloat(val) || 0.033;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  // 3. Clear All
  widgets.push({
    type: 'button', id: 'anim_reset_all', label: 'Clear All Animation & Reset Looper Tempo',
    x: col1X, y: y, w: 710, h: 36,
    onInteract: () => {
      if (!window._animationRegistry) return;
      window._animationRegistry.stopRecording(true);
      window._animationRegistry.tracks.clear();
      window._animCurrentTime = 0;
      window._animationRegistry.globalPlaybackTime = 0;
    }
  });
  y += 36 + gapBtn;

  // 3. Standard 8-Button Transport Bar
  const tW = 710 / 8;
  
  // Jump to Start
  widgets.push({
    type: 'button', id: 'anim_to_start', label: '|◀', x: col1X, y: y, w: tW, h: btnH,
    onInteract: () => {
      if (!window._animationRegistry) return;
      window._animCurrentTime = 0;
      window._animationRegistry.globalPlaybackTime = 0;
      if (main._meshes) main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  });

  // Previous Frame (Step -0.033s)
  widgets.push({
    type: 'button', id: 'anim_prev_frame', label: '◀◀', x: col1X + tW, y: y, w: tW, h: btnH,
    onInteract: () => {
      if (!window._animationRegistry) return;
      window._animCurrentTime = Math.max(0, (window._animCurrentTime || 0) - 0.033);
      window._animationRegistry.globalPlaybackTime = window._animCurrentTime;
      if (main._meshes) main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  });

  // Play Backwards
  widgets.push({
    type: 'button', id: 'anim_play_rev', label: '◀', x: col1X + tW*2, y: y, w: tW, h: btnH,
    data: { tint: (window._animPlaying && window._animationRegistry && window._animationRegistry.playbackDirection === -1) ? '#44ff44' : '#aaaaaa' },
    onInteract: () => {
      window._animPlaying = true;
      if (window._animationRegistry) window._animationRegistry.playbackDirection = -1;
    }
  });

  // Stop
  widgets.push({
    type: 'button', id: 'anim_stop', label: '■', x: col1X + tW*3, y: y, w: tW, h: btnH,
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
    data: { tint: (window._animPlaying && window._animationRegistry && window._animationRegistry.playbackDirection !== -1) ? '#44ff44' : (isFlashing ? '#ff8800' : '#aaaaaa') },
    onInteract: () => {
      window._animPlaying = true;
      if (window._animationRegistry) window._animationRegistry.playbackDirection = 1;
    }
  });

  // Next Frame (Step +0.033s)
  widgets.push({
    type: 'button', id: 'anim_next_frame', label: '▶▶', x: col1X + tW*5, y: y, w: tW, h: btnH,
    onInteract: () => {
      if (!window._animationRegistry) return;
      const maxLen = window._animMasterDuration || 1.0;
      window._animCurrentTime = Math.min(maxLen, (window._animCurrentTime || 0) + 0.033);
      window._animationRegistry.globalPlaybackTime = window._animCurrentTime;
      if (main._meshes) main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  });

  // Jump to End
  widgets.push({
    type: 'button', id: 'anim_to_end', label: '▶|', x: col1X + tW*6, y: y, w: tW, h: btnH,
    onInteract: () => {
      if (!window._animationRegistry) return;
      const maxLen = window._animMasterDuration || 1.0;
      window._animCurrentTime = maxLen;
      window._animationRegistry.globalPlaybackTime = maxLen;
      if (main._meshes) main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  });

  // Record
  widgets.push({
    type: 'button', id: 'anim_record', label: '⬤', x: col1X + tW*7, y: y, w: tW, h: btnH,
    data: { tint: (window._animationRegistry && (window._animationRegistry.isRecording || window._animationRegistry.isCountingIn)) ? '#ff4444' : (isFlashing ? '#ff8800' : '#aaaaaa') },
    onInteract: () => {
      if (!window._animationRegistry) return;

      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) {
        targetMesh = main.getMeshes()[0];
      }

      if (!targetMesh) return;
      
      window._animArmed = true;

      if (window._animPlaying) {
        window._animWaitingForGrab = true;
        window._animStatusText = '🟢 Waiting for Trigger Pull...';
        if (main._guiXR) main._guiXR._needsRedraw = true;
        return;
      }

      if (window._animCountIn) {
        window._animationRegistry.startRecording(targetMesh);
        return;
      }

      if (window._animWaitForTrigger) {
        window._animWaitingForGrab = true;
        window._animStatusText = '🟢 Waiting for Trigger Pull...';
        if (main._guiXR) main._guiXR._needsRedraw = true;
        return;
      }

      window._animationRegistry.startRecording(targetMesh);
    }
  });

  y += btnH + gapBtn;

  window._animKeyMode = window._animKeyMode || 'shape';

  const showFeedback = (text) => {
    window._animFeedbackText = text;
    window._animFeedbackTimer = performance.now();
    if (main._guiXR) main._guiXR._needsRedraw = true;
  };

  // 4. Giant Square Keyframe Button & Unified Toolbar
  const kRowW = 710;
  const giantBtnSize = 100;
  const subBtnH = (giantBtnSize - gapBtn) / 2;
  
  const captureTrackState = (mesh) => {
    if (!mesh || !window._animationRegistry) return null;
    const tr = window._animationRegistry.tracks.get(mesh.getID());
    if (!tr) return null;
    return {
      shapeTimes: tr.shapeTimes ? tr.shapeTimes.slice() : [],
      shapes: tr.shapes ? tr.shapes.map(arr => new Float32Array(arr)) : [],
      tangents: tr.tangents ? tr.tangents.slice() : [],
      times: tr.times ? tr.times.slice() : [],
      positions: tr.positions ? tr.positions.slice() : [],
      quaternions: tr.quaternions ? tr.quaternions.slice() : [],
      scales: tr.scales ? tr.scales.slice() : []
    };
  };

  const executeWithUndo = (mesh, actionCb) => {
    if (!mesh) return;
    const snapBefore = captureTrackState(mesh);
    
    actionCb();
    
    const snapAfter = captureTrackState(mesh);
    if (main && main.getStateManager && snapBefore && snapAfter) {
      main.getStateManager().pushStateCustom(
        () => {
          const tr = window._animationRegistry.tracks.get(mesh.getID());
          if (tr) {
            tr.shapeTimes = snapBefore.shapeTimes.slice();
            tr.shapes = snapBefore.shapes.map(arr => new Float32Array(arr));
            tr.tangents = snapBefore.tangents.slice();
            tr.times = snapBefore.times.slice();
            tr.positions = snapBefore.positions.slice();
            tr.quaternions = snapBefore.quaternions.slice();
            tr.scales = snapBefore.scales.slice();
            window._animationRegistry.update(mesh, true);
            if (main._guiXR) main._guiXR._needsRedraw = true;
          }
        },
        () => {
          const tr = window._animationRegistry.tracks.get(mesh.getID());
          if (tr) {
            tr.shapeTimes = snapAfter.shapeTimes.slice();
            tr.shapes = snapAfter.shapes.map(arr => new Float32Array(arr));
            tr.tangents = snapAfter.tangents.slice();
            tr.times = snapAfter.times.slice();
            tr.positions = snapAfter.positions.slice();
            tr.quaternions = snapAfter.quaternions.slice();
            tr.scales = snapAfter.scales.slice();
            window._animationRegistry.update(mesh, true);
            if (main._guiXR) main._guiXR._needsRedraw = true;
          }
        }
      );
    }
  };

  widgets.push({
    type: 'button', id: 'anim_add_key', label: '◆+', x: col1X, y: y, w: giantBtnSize, h: giantBtnSize,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      
      if (targetMesh) {
        if (window._animKeyMode === 'shape') {
          executeWithUndo(targetMesh, () => {
            window._animationRegistry.addShapeKey(targetMesh, window._animCurrentTime || 0);
          });
          showFeedback('◆ Added Shape Key');
        } else {
          executeWithUndo(targetMesh, () => {
            window._animationRegistry.addTransformKey(targetMesh, window._animCurrentTime || 0);
          });
          showFeedback('◆ Added Transform Key');
        }
      }
    }
  });

  widgets.push({
    type: 'combobox', id: 'anim_key_mode', label: 'Mode: Shape', 
    x: col1X + giantBtnSize + gapBtn, y: y, w: kRowW - giantBtnSize - gapBtn, h: subBtnH,
    value: window._animKeyMode,
    options: [
      { id: 'shape', label: 'Mode: Shape' },
      { id: 'transform', label: 'Mode: Transform' }
    ],
    onInteract: () => {
      window._animKeyMode = (window._animKeyMode === 'shape') ? 'transform' : 'shape';
      showFeedback(`Switched to ${window._animKeyMode.toUpperCase()}`);
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
        
        executeWithUndo(targetMesh, () => {
          window._animCopiedKeys.forEach(k => {
            let trackMesh = null;
            if (main.getMeshes) trackMesh = main.getMeshes().find(m => m.getID() === k.meshId);
            if (!trackMesh) trackMesh = targetMesh;
            
            const targetTime = pasteTime + (k.time - tMin);
            
            if (k.type === 'transform') {
              const id = trackMesh.getID();
              if (!window._animationRegistry.tracks.has(id)) {
                window._animationRegistry.tracks.set(id, {
                  times: [], positions: [], quaternions: [], scales: [],
                  shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
                });
              }
              const track = window._animationRegistry.tracks.get(id);
              track.times.push(targetTime);
              track.positions.push(...k.p);
              track.quaternions.push(...k.q);
              track.scales.push(...k.s);
            } else if (k.type === 'shape') {
              const id = trackMesh.getID();
              if (!window._animationRegistry.tracks.has(id)) {
                window._animationRegistry.tracks.set(id, {
                  times: [], positions: [], quaternions: [], scales: [],
                  shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
                });
              }
              const track = window._animationRegistry.tracks.get(id);
              track.shapeTimes.push(targetTime);
              track.shapes.push(new Float32Array(k.shape));
            }
          });
          
          window._animationRegistry.tracks.forEach(track => {
            if (track.times) {
              let arr = track.times;
              for (let i = 0; i < arr.length - 1; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                  if (arr[i] > arr[j]) {
                    let tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
                    let p = track.positions;
                    let px=p[i*3], py=p[i*3+1], pz=p[i*3+2];
                    p[i*3]=p[j*3]; p[i*3+1]=p[j*3+1]; p[i*3+2]=p[j*3+2];
                    p[j*3]=px; p[j*3+1]=py; p[j*3+2]=pz;
                    let q = track.quaternions;
                    let qx=q[i*4], qy=q[i*4+1], qz=q[i*4+2], qw=q[i*4+3];
                    q[i*4]=q[j*4]; q[i*4+1]=q[j*4+1]; q[i*4+2]=q[j*4+2]; q[i*4+3]=q[j*4+3];
                    q[j*4]=qx; q[j*4+1]=qy; q[j*4+2]=qz; q[j*4+3]=qw;
                    let s = track.scales;
                    let sx=s[i*3], sy=s[i*3+1], sz=s[i*3+2];
                    s[i*3]=s[j*3]; s[i*3+1]=s[j*3+1]; s[i*3+2]=s[j*3+2];
                    s[j*3]=sx; s[j*3+1]=sy; s[j*3+2]=sz;
                  }
                }
              }
            }
            if (track.shapeTimes) {
              let arr = track.shapeTimes;
              for (let i = 0; i < arr.length - 1; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                  if (arr[i] > arr[j]) {
                    let tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
                    let shp = track.shapes[i];
                    track.shapes[i] = track.shapes[j];
                    track.shapes[j] = shp;
                  }
                }
              }
            }
          });
        });
        showFeedback(`📥 Pasted ${window._animCopiedKeys.length} Keys`);
      } else if (targetMesh) {
        if (window._animKeyMode === 'shape') {
          executeWithUndo(targetMesh, () => { window._animationRegistry.pasteShapeKey(targetMesh, window._animCurrentTime || 0); });
          showFeedback('📥 Pasted Shape Key');
        } else {
          executeWithUndo(targetMesh, () => { window._animationRegistry.pasteTransformKey(targetMesh, window._animCurrentTime || 0); });
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
        executeWithUndo(targetMesh, () => {
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
        });
        window._animSelectedKeys = [];
        showFeedback(`🗑️ Deleted ${keysToDelete.length} Keys`);
      } else if (targetMesh) {
        const t = window._animLastTouchedKeyTime !== undefined ? window._animLastTouchedKeyTime : (window._animCurrentTime || 0);
        if (window._animKeyMode === 'shape') {
          executeWithUndo(targetMesh, () => { window._animationRegistry.deleteShapeKey(targetMesh, t); });
          showFeedback('🗑️ Deleted Shape Key');
        } else {
          executeWithUndo(targetMesh, () => { window._animationRegistry.deleteTransformKey(targetMesh, t); });
          showFeedback('🗑️ Deleted Transform Key');
        }
        window._animLastTouchedKeyTime = undefined; // Reset
      }
    }
  });

  y += giantBtnSize + gapBtn;

  // 5. Unified Triple Slider Row
  const sW = (710 - 30) / 3; // 226px each
  
  widgets.push({
    type: 'slider', id: 'anim_master_duration', label: 'Duration', 
    x: col1X, y: y, w: sW, h: 50,
    min: 1.0, max: 30.0, step: 1.0,
    value: window._animMasterDuration || 2.0,
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    onInput: (val) => {
      window._animMasterDuration = val;
      if (window._animLoopEnd && window._animLoopEnd > val) {
        window._animLoopEnd = val;
      }
    }
  });

  widgets.push({
    type: 'slider', id: 'anim_loop_start', label: 'Start', 
    x: col1X + sW + 15, y: y, w: sW, h: 50,
    min: 0.0, max: window._animMasterDuration || 2.0, step: 0.1,
    value: window._animLoopStart || 0.0,
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    onInput: (val) => {
      window._animLoopStart = val;
      if (window._animLoopEnd !== undefined && window._animLoopStart >= window._animLoopEnd) {
        window._animLoopStart = Math.max(0, window._animLoopEnd - 0.1);
      }
      window._animCurrentTime = window._animLoopStart;
      if (window._animationRegistry) {
        window._animationRegistry.globalPlaybackTime = window._animLoopStart;
        if (main._meshes) main._meshes.forEach(m => window._animationRegistry.update(m, true));
      }
    }
  });

  widgets.push({
    type: 'slider', id: 'anim_loop_end', label: 'End', 
    x: col1X + (sW + 15)*2, y: y, w: sW, h: 50,
    min: 0.0, max: window._animMasterDuration || 2.0, step: 0.1,
    value: window._animLoopEnd !== undefined ? window._animLoopEnd : (window._animMasterDuration || 2.0),
    sensitivity: 0.5,
    data: { tint: '#ffffff' },
    onInput: (val) => {
      window._animLoopEnd = val;
      if (window._animLoopStart !== undefined && window._animLoopEnd <= window._animLoopStart) {
        window._animLoopEnd = window._animLoopStart + 0.1;
      }
    }
  });

  y += 50 + gapBtn;

  window._animActiveTool = window._animActiveTool || 'select';
  window._animMarqueeMode = window._animMarqueeMode || 'select_only';
  if (window._animTransformAutoSelect === undefined) window._animTransformAutoSelect = true;

  widgets.push({
    type: 'combobox', id: 'anim_active_tool', label: `🗜️ ${window._animActiveTool.toUpperCase()}`,
    x: col1X, y: y, w: 200, h: 36,
    value: window._animActiveTool,
    options: [
      { id: 'select', label: 'SELECT' },
      { id: 'marquee', label: 'MARQUEE' },
      { id: 'transform', label: 'TRANSFORM' }
    ],
    onInteract: (val) => {
      const newMode = typeof val === 'string' ? val : (val && val.id ? val.id : 'select');
      window._animActiveTool = newMode;
      window._waitingForTriggerReleaseAfterToolChange = true;
      console.log(`[Toolbar] ACTIVE TOOL SWAP: ${newMode}`);
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
      // If user swaps to transform mode, automatically select GRAB tool.
      if (newMode === 'transform') {
        const sm = main.getSculptManager();
        if (sm) sm.setToolIndex(Enums.Tools.GRAB); 
        console.log(`[Toolbar] Forced Grab Tool Index assigned successfully: ${Enums.Tools.GRAB}`);
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
      console.log(`[Toolbar] ACTIVE TOOL SWAP (onSelect): ${newMode}`);
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
        console.log(`[Toolbar] Forced Grab Tool Index assigned (onSelect): ${Enums.Tools.GRAB}`);
        if (window.screenLog) window.screenLog(`[Toolbar] Swapped to Grab Tool Mode!`, 'green');
        if (main._guiXR) {
          main._guiXR.refreshToolsWidget();
          main._guiXR.syncWidgetValues();
        }
      }
    }
  });

  if (window._animAutoKey === undefined) window._animAutoKey = false;

  if (window._animActiveTool === 'marquee') {
    widgets.push({
      type: 'combobox', id: 'anim_marquee_mode', label: `Mode: ${window._animMarqueeMode.toUpperCase()}`,
      x: col1X + 220, y: y, w: 230, h: 36,
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
      x: col1X + 220, y: y, w: 200, h: 36,
      value: window._animTransformAutoSelect,
      onInteract: (val) => {
        window._animTransformAutoSelect = !window._animTransformAutoSelect;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    });
  }

  // Global AutoKey Option
  widgets.push({
    type: 'checkbox', id: 'anim_autokey', label: 'AutoKey',
    x: col1X + 460, y: y, w: 180, h: 36,
    value: window._animAutoKey,
    onInteract: (val) => {
      window._animAutoKey = !window._animAutoKey;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  y += 36 + gapBtn;

  // 6. Sleek Timeline
  widgets.push({
    type: 'timeline',
    id: 'anim_timeline',
    x: col1X, y: y, w: 710, h: 300
  });

  return widgets;
}
