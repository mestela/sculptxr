export default function getAnimationWidgets(main) {
  const widgets = [];

  const col1X = 20;
  const btnH = 50; 
  const gapBtn = 15;
  const gapHeader = 30;

  let y = 130;

  widgets.push({ type: 'info', label: 'Mocap Overdub Looper', x: col1X, y: y });
  y += gapHeader;

  // Global Configuration Options
  window._animArmed = window._animArmed !== undefined ? window._animArmed : true;
  window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
  window._animPlaying = window._animPlaying || false;



  window._animWaitForTrigger = window._animWaitForTrigger !== undefined ? window._animWaitForTrigger : true;

  // 2. Countdown Toggle
  widgets.push({
    type: 'checkbox',
    id: 'anim_count_toggle',
    label: 'Use 3-Second Countdown Delay',
    x: col1X, y: y, w: 350, h: 36,
    value: window._animCountIn,
    onInteract: () => {
      window._animCountIn = !window._animCountIn;
      if (window._animCountIn) window._animWaitForTrigger = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });

  widgets.push({
    type: 'checkbox',
    id: 'anim_trigger_toggle',
    label: 'Start on Trigger',
    x: col1X + 360, y: y, w: 350, h: 36,
    value: window._animWaitForTrigger,
    onInteract: () => {
      window._animWaitForTrigger = !window._animWaitForTrigger;
      if (window._animWaitForTrigger) window._animCountIn = false;
      if (main._guiXR) main._guiXR._needsRedraw = true;
    }
  });
  y += 36 + gapBtn;

  // 2.5 Reset All
  widgets.push({
    type: 'button', id: 'anim_reset_all', label: 'Clear All Animation & Reset Looper Tempo', x: col1X, y: y, w: 710, h: 36,
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

  // 4. Shape Animation
  widgets.push({
    type: 'button', id: 'anim_add_shape_key', label: 'Add Shape Key at Playhead', x: col1X, y: y, w: 710, h: 42,
    onInteract: () => {
      if (!window._animationRegistry) return;
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) {
        targetMesh = main.getMeshes()[0];
      }
      if (targetMesh) {
        window._animationRegistry.addShapeKey(targetMesh, window._animCurrentTime || 0);
      }
    }
  });

  y += 42 + gapBtn;

  // Shape Key Copy/Paste Action Bar
  const cW = 710 / 3;
  widgets.push({
    type: 'button', id: 'anim_copy_key', label: '📋 Copy Key/Shape', x: col1X, y: y, w: cW - 5, h: 42,
    onInteract: () => {
      if (!window._animationRegistry) return;
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      if (targetMesh) window._animationRegistry.copyShapeKey(targetMesh, window._animCurrentTime || 0);
    }
  });

  widgets.push({
    type: 'button', id: 'anim_paste_key', label: '📥 Paste Key', x: col1X + cW, y: y, w: cW - 5, h: 42,
    onInteract: () => {
      if (!window._animationRegistry) return;
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      if (targetMesh) window._animationRegistry.pasteShapeKey(targetMesh, window._animCurrentTime || 0);
    }
  });

  widgets.push({
    type: 'button', id: 'anim_del_key', label: '🗑️ Delete Key', x: col1X + cW*2, y: y, w: cW - 5, h: 42,
    onInteract: () => {
      if (!window._animationRegistry) return;
      let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
      if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) targetMesh = main.getMeshes()[0];
      if (targetMesh) window._animationRegistry.deleteShapeKey(targetMesh, window._animCurrentTime || 0);
    }
  });

  y += 42 + gapBtn;

  widgets.push({
    type: 'slider', id: 'anim_master_duration', label: 'Scene Duration (s)', x: col1X, y: y, w: 710, h: 50,
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
  y += 50 + gapBtn;

  widgets.push({
    type: 'slider', id: 'anim_loop_start', label: 'Loop Start', x: col1X, y: y, w: 350, h: 50,
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
    type: 'slider', id: 'anim_loop_end', label: 'Loop End', x: col1X + 360, y: y, w: 350, h: 50,
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
