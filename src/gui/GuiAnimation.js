import TR from './GuiTR.js';

class GuiAnimation {
  constructor(guiParent, ctrlGui) {
    this._ctrlGui = ctrlGui;
    this._main = ctrlGui._main;
    this._menu = null;
    this.init(guiParent);
  }

  init(guiParent) {
    window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
    var menu = this._menu = guiParent.addMenu('Animation');
    menu.close();

    menu.addCheckbox('Show Timeline', false, this.toggleTimeline.bind(this));
    
    window._animShowTransformBox = false;
    menu.addCheckbox('Show Transform Box', false, (val) => {
      window._animShowTransformBox = val;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    });

    // Settings
    menu.addTitle('Settings');
    menu.addCheckbox('AutoKey', window, '_animAutoKey');
    menu.addCheckbox('Count-in', window, '_animCountIn');
    menu.addCheckbox('Wait for Trigger', window, '_animWaitForTrigger');
    menu.addCheckbox('Show Tangents', window, '_animShowTangents');

    // Playback
    menu.addTitle('Playback');
    menu.addSlider('FPS', window, '_animFPS', 1, 60, 1);
    
    // Transport
    menu.addTitle('Transport');
    menu.addDualButton('|◀ Jump Start', '▶| Jump End', this, this, 'toStart', 'toEnd');
    menu.addDualButton('◀◀ Prev Frame', '▶▶ Next Frame', this, this, 'prevFrame', 'nextFrame');
    menu.addDualButton('◀ Play Rev', '▶ Play Fwd', this, this, 'playRev', 'playFwd');
    menu.addDualButton('■ Stop', '⬤ Record', this, this, 'stop', 'record');
    menu.addButton('Clear All Animation', this, 'clearAll');

    // Timeline Range
    menu.addTitle('Timeline Range');
    const fps = window._animFPS || 24;
    window._animLoopStart = 0;
    window._animLoopEnd = window._animMasterDuration || 2.0;
    
    menu.addSlider('Duration (Frames)', (window._animMasterDuration || 2.0) * fps, (val) => {
      window._animMasterDuration = val / fps;
    }, 1, 720, 1);
    menu.addSlider('Loop Start (Frames)', window._animLoopStart * fps, (val) => {
      window._animLoopStart = val / fps;
    }, 0, 720, 1);
    menu.addSlider('Loop End (Frames)', window._animLoopEnd * fps, (val) => {
      window._animLoopEnd = val / fps;
    }, 0, 720, 1);

    // Keyframes
    menu.addTitle('Keyframes');
    menu.addCombobox('Key Mode', window, '_animKeyMode', ['shape', 'transform']);
    menu.addButton('Add Keyframe', this, 'addKeyframe');
    
    menu.addDualButton('📋 Copy Key', '📥 Paste Key', this, this, 'copyKey', 'pasteKey');
    menu.addButton('🗑️ Delete Key', this, 'deleteKey');
  }

  // Callbacks
  toggleTimeline(val) {
    console.log('toggleTimeline called with', val);
    const timeline = this._ctrlGui._ctrlTimeline;
    console.log('timeline is', timeline);
    if (timeline) {
      timeline.setVisibility(val);
    }
  }

  toStart() {
    if (!window._animationRegistry) return;
    window._animCurrentTime = 0;
    window._animationRegistry.globalPlaybackTime = 0;
    if (this._main && this._main._meshes) {
      this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  }

  toEnd() {
    if (!window._animationRegistry) return;
    const maxLen = window._animMasterDuration || 1.0;
    window._animCurrentTime = maxLen;
    window._animationRegistry.globalPlaybackTime = maxLen;
    if (this._main && this._main._meshes) {
      this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  }

  prevFrame() {
    if (!window._animationRegistry) return;
    const fps = window._animFPS || 24;
    const step = 1 / fps;
    window._animCurrentTime = Math.max(0, (window._animCurrentTime || 0) - step);
    window._animationRegistry.globalPlaybackTime = window._animCurrentTime;
    if (this._main && this._main._meshes) {
      this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  }

  nextFrame() {
    if (!window._animationRegistry) return;
    const fps = window._animFPS || 24;
    const step = 1 / fps;
    const maxLen = window._animMasterDuration || 1.0;
    window._animCurrentTime = Math.min(maxLen, (window._animCurrentTime || 0) + step);
    window._animationRegistry.globalPlaybackTime = window._animCurrentTime;
    if (this._main && this._main._meshes) {
      this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
    }
  }

  playRev() {
    window._animPlaying = true;
    if (window._animationRegistry) window._animationRegistry.playbackDirection = -1;
  }

  playFwd() {
    window._animPlaying = true;
    if (window._animationRegistry) window._animationRegistry.playbackDirection = 1;
  }

  stop() {
    window._animPlaying = false;
    if (window._animationRegistry) {
      window._animationRegistry.stopRecording(true);
    }
  }

  record() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    window._animArmed = true;
    window._animationRegistry.startRecording(targetMesh);
  }

  clearAll() {
    if (!window._animationRegistry) return;
    if (confirm('Clear all animation tracks?')) {
      window._animationRegistry.stopRecording(true);
      window._animationRegistry.tracks.clear();
      window._animCurrentTime = 0;
      window._animationRegistry.globalPlaybackTime = 0;
    }
  }

  addKeyframe() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    const targetTime = window._animCurrentTime || 0;
    
    if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
      window._animationRegistry.addShapeKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('◆ Added Shape Key', 'lime');
    } else {
      window._animationRegistry.addTransformKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('◆ Added Transform Key', 'lime');
    }
  }

  copyKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    const targetTime = window._animCurrentTime || 0;
    
    if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
      window._animationRegistry.copyShapeKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('📋 Copied Shape Key', 'lime');
    } else {
      window._animationRegistry.copyTransformKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('📋 Copied Transform Key', 'lime');
    }
  }

  pasteKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    const targetTime = window._animCurrentTime || 0;
    
    if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
      window._animationRegistry.pasteShapeKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('📥 Pasted Shape Key', 'lime');
    } else {
      window._animationRegistry.pasteTransformKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('📥 Pasted Transform Key', 'lime');
    }
    window._animationRegistry.update(targetMesh, true);
  }

  deleteKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    const targetTime = window._animCurrentTime || 0;
    
    if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
      window._animationRegistry.deleteShapeKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('🗑️ Deleted Shape Key', 'orange');
    } else {
      window._animationRegistry.deleteTransformKey(targetMesh, targetTime);
      if (window.screenLog) window.screenLog('🗑️ Deleted Transform Key', 'orange');
    }
    window._animationRegistry.update(targetMesh, true);
  }

  updateMesh() {
    // This can be used to update UI when active mesh changes if needed
  }
}

export default GuiAnimation;
