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

  // 3. Clear All
  widgets.push({
    type: 'button', id: 'anim_reset_all', label: 'Clear All Animation & Reset Looper Tempo',
    x: col1X, y: y, w: 710, h: 36,
    onInteract: () => {
      if (!window._animationRegistry) return;
      window._animationRegistry.stopRecording(true);
      window._animationRegistry.tracks.clear();
      window._animMasterDuration = 0;
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
      tangents: tr.tangents ? tr.tangents.slice() : []
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
      if (targetMesh) {
        window._animationRegistry.copyShapeKey(targetMesh, window._animCurrentTime || 0);
        showFeedback('📋 Copied Key');
      }
    }
  });

  widgets.push({
    type: 'button', id: 'anim_paste_key', label: '📥 Paste', 
    x: col1X + giantBtnSize + gapBtn + subActW + 15, y: subY, w: subActW, h: subBtnH,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      if (targetMesh) {
        executeWithUndo(targetMesh, () => {
          window._animationRegistry.pasteShapeKey(targetMesh, window._animCurrentTime || 0);
        });
        showFeedback('📥 Pasted Key');
      }
    }
  });

  widgets.push({
    type: 'button', id: 'anim_del_key', label: '🗑️ Del', 
    x: col1X + giantBtnSize + gapBtn + (subActW + 15)*2, y: subY, w: subActW, h: subBtnH,
    onInteract: () => {
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      if (targetMesh) {
        executeWithUndo(targetMesh, () => {
          window._animationRegistry.deleteShapeKey(targetMesh, window._animCurrentTime || 0);
        });
        showFeedback('🗑️ Deleted Key');
      }
    }
  });

  y += giantBtnSize + gapBtn;

  // 5. Unified Triple Slider Row
  const sW = (710 - 30) / 3; // 226px each
  
  widgets.push({
    type: 'slider', id: 'anim_master_duration', label: 'Duration', 
    x: col1X, y: y, w: sW, h: 50,
    min: 1.0, max: 60.0, step: 1.0,
    value: window._animMasterDuration || 2.0,
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
    data: { tint: '#ffffff' },
    onInput: (val) => {
      window._animLoopEnd = val;
      if (window._animLoopStart !== undefined && window._animLoopEnd <= window._animLoopStart) {
        window._animLoopEnd = window._animLoopStart + 0.1;
      }
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
