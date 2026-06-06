import TimelineHelper from './TimelineHelper.js';
import TR from './GuiTR.js';

// Web Awesome Imports
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/components/details/details.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/number-input/number-input.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

class GuiAnimation {
  constructor(guiParent, ctrlGui) {
    this._ctrlGui = ctrlGui;
    this._main = ctrlGui._main;
    this._menu = null;
    this.init(guiParent);
  }

  init(guiParent) {
    const sidebarDom = guiParent.domSidebar || guiParent.domContainer || guiParent.domMain || guiParent;
    if (!sidebarDom || !sidebarDom.appendChild) {
      console.error("Cannot find a valid DOM element to attach Web Awesome UI!");
      return;
    }

    window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
    window._animAutoKey = window._animAutoKey !== undefined ? window._animAutoKey : false;
    window._animWaitForTrigger = window._animWaitForTrigger !== undefined ? window._animWaitForTrigger : true;
    window._animShowTangents = window._animShowTangents !== undefined ? window._animShowTangents : false;
    window._animShowTransformBox = false;
    window._animCaptureRate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.1;
    window._animFPS = window._animFPS || 24;
    window._animPlaybackSpeed = window._animPlaybackSpeed || 1.0;
    window._animKeyMode = window._animKeyMode || 'transform';
    window._animMasterDuration = window._animMasterDuration || 2.0;
    window._animLoopStart = window._animLoopStart || 0.0;
    window._animLoopEnd = window._animLoopEnd || window._animMasterDuration;

    const fps = window._animFPS;

    const animContainer = document.createElement('div');
    animContainer.className = 'wa-animation-section wa-dark';
    animContainer.style.padding = '0';
    animContainer.style.background = 'transparent';
    animContainer.style.color = '#fff';

    // Stop keyboard events from bubbling up to the main app
    animContainer.addEventListener('keydown', (e) => e.stopPropagation());
    animContainer.addEventListener('keyup', (e) => e.stopPropagation());

    const style = document.createElement('style');
    style.innerHTML = `
      .compact-details::part(header) { padding: 4px 8px; }
      .compact-details::part(content) { padding: 8px; }
      .wa-stack { display: flex; flex-direction: column; gap: 8px; }
      wa-input.compact-input { --wa-input-height: 24px; font-size: 12px; }
      wa-button.compact-btn { --wa-button-height: 24px; font-size: 12px; }
      wa-number-input.compact-number { --wa-input-height: 24px; font-size: 12px; }
      wa-select.compact-select { --wa-input-height: 24px; font-size: 12px; }
      .btn-grid { display: flex; gap: 2px; width: 100%; box-sizing: border-box; }
      .btn-grid wa-button { flex: 1; --wa-button-height: 28px; min-width: 0 !important; }
      .btn-grid wa-button::part(base) { padding: 0 !important; min-width: 0 !important; }
      .reverse-icon { transform: scaleX(-1); }
    `;
    animContainer.appendChild(style);

    const createSection = (title) => {
      const container = document.createElement('div');
      container.className = 'wa-stack';
      container.style.gap = '12px';
      container.style.marginTop = '8px';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'group-title';
      titleDiv.innerText = title;
      titleDiv.style.fontSize = '12px';
      titleDiv.style.fontWeight = '600';
      titleDiv.style.color = '#888';
      titleDiv.style.textTransform = 'uppercase';
      titleDiv.style.borderBottom = '1px solid #2d2d2d';
      titleDiv.style.paddingBottom = '4px';
      titleDiv.style.marginTop = '8px';
      container.appendChild(titleDiv);

      const cont = document.createElement('div');
      cont.className = 'wa-stack';
      cont.style.gap = '12px';
      container.appendChild(cont);

      return { details: container, content: cont };
    };

    // 1. Animation Section
    const animSection = createSection('Animation', true);
    
    const cbTimeline = document.createElement('wa-checkbox');
    cbTimeline.innerText = 'Show Timeline';
    cbTimeline.addEventListener('change', (e) => { this.toggleTimeline(e.target.checked); });
    animSection.content.appendChild(cbTimeline);

    const cbTransformBox = document.createElement('wa-checkbox');
    cbTransformBox.innerText = 'Show transform box';
    cbTransformBox.addEventListener('change', (e) => {
      window._animShowTransformBox = e.target.checked;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    });
    animSection.content.appendChild(cbTransformBox);

    // FPS Slider with value display
    const fpsLabel = document.createElement('div');
    fpsLabel.innerText = `FPS: ${window._animFPS}`;
    fpsLabel.style.fontSize = '12px';
    animSection.content.appendChild(fpsLabel);

    const sliderFPS = document.createElement('wa-slider');
    sliderFPS.setAttribute('value', window._animFPS.toString());
    sliderFPS.setAttribute('min', '1');
    sliderFPS.setAttribute('max', '60');
    sliderFPS.setAttribute('step', '1');
    sliderFPS.addEventListener('input', (e) => {
      fpsLabel.innerText = `FPS: ${e.target.value}`;
      window._animFPS = parseInt(e.target.value);
    });
    animSection.content.appendChild(sliderFPS);

    // Playback Speed Slider with value display
    const speedLabel = document.createElement('div');
    speedLabel.innerText = `Playback Speed: ${window._animPlaybackSpeed.toFixed(1)}x`;
    speedLabel.style.fontSize = '12px';
    animSection.content.appendChild(speedLabel);

    const sliderSpeed = document.createElement('wa-slider');
    sliderSpeed.setAttribute('value', window._animPlaybackSpeed.toString());
    sliderSpeed.setAttribute('min', '0.1');
    sliderSpeed.setAttribute('max', '4.0');
    sliderSpeed.setAttribute('step', '0.1');
    sliderSpeed.addEventListener('input', (e) => {
      speedLabel.innerText = `Playback Speed: ${parseFloat(e.target.value).toFixed(1)}x`;
      window._animPlaybackSpeed = parseFloat(e.target.value);
    });
    animSection.content.appendChild(sliderSpeed);

    const createFrameField = (label, value, min, onChange) => {
      const group = document.createElement('div');
      group.style.display = 'flex';
      group.style.alignItems = 'center';
      group.style.justifyContent = 'space-between';
      const lbl = document.createElement('span');
      lbl.innerText = label;
      lbl.style.fontSize = '12px';
      group.appendChild(lbl);
      const num = document.createElement('wa-number-input');
      num.className = 'compact-number';
      num.setAttribute('value', value.toString());
      num.setAttribute('step', '1');
      num.setAttribute('min', min.toString());
      num.setAttribute('without-steppers', '');
      num.style.width = '80px'; // Increased to prevent clipping
      num.addEventListener('input', onChange);
      group.appendChild(num);
      return group;
    };

    const currentDurationFrames = Math.round(window._animMasterDuration * fps);
    animSection.content.appendChild(createFrameField('Duration', currentDurationFrames, 1, (e) => {
      const frames = parseInt(e.target.value, 10) || 1;
      window._animMasterDuration = frames / window._animFPS;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    }));

    const currentLoopStartFrames = Math.round(window._animLoopStart * fps);
    animSection.content.appendChild(createFrameField('Loop Start', currentLoopStartFrames, 0, (e) => {
      const frames = parseInt(e.target.value, 10) || 0;
      window._animLoopStart = frames / window._animFPS;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    }));

    const currentLoopEndFrames = Math.round(window._animLoopEnd * fps);
    animSection.content.appendChild(createFrameField('Loop End', currentLoopEndFrames, 1, (e) => {
      const frames = parseInt(e.target.value, 10) || 1;
      window._animLoopEnd = frames / window._animFPS;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    }));

    animContainer.appendChild(animSection.details);

    // 2. Transport Section
    const transportSection = createSection('Transport', true);

    const transportGrid = document.createElement('div');
    transportGrid.className = 'btn-grid';

    const transportButtons = [
      { icon: 'backward-step', method: 'toStart' },
      { icon: 'chevron-left', method: 'prevFrame' },
      { icon: 'play', method: 'playRev', class: 'reverse-icon' },
      { icon: 'stop', method: 'stop' },
      { icon: 'play', method: 'playFwd' },
      { icon: 'chevron-right', method: 'nextFrame' },
      { icon: 'forward-step', method: 'toEnd' },
      { icon: 'circle', method: 'record' }
    ];

    transportButtons.forEach(btn => {
      const b = document.createElement('wa-button');
      b.setAttribute('variant', 'primary'); // Dark gray background
      b.setAttribute('size', 'small');
      
      const icon = document.createElement('wa-icon');
      icon.setAttribute('name', btn.icon);
      if (btn.class) icon.className = btn.class;
      
      b.appendChild(icon);
      b.addEventListener('click', () => this[btn.method]());
      transportGrid.appendChild(b);
    });
    transportSection.content.appendChild(transportGrid);

    const btnClearAll = document.createElement('wa-button');
    btnClearAll.innerText = 'Clear all animation';
    btnClearAll.setAttribute('variant', 'danger');
    btnClearAll.addEventListener('click', () => this.clearAll());
    transportSection.content.appendChild(btnClearAll);

    animContainer.appendChild(transportSection.details);

    // 3. Record Section
    const recordSection = createSection('Record', true);

    const cbCountIn = document.createElement('wa-checkbox');
    cbCountIn.innerText = 'Count in';
    cbCountIn.setAttribute('checked', window._animCountIn ? '' : 'false');
    cbCountIn.addEventListener('change', (e) => { window._animCountIn = e.target.checked; });
    recordSection.content.appendChild(cbCountIn);

    const cbTrigger = document.createElement('wa-checkbox');
    cbTrigger.innerText = 'Wait for Trigger';
    cbTrigger.setAttribute('checked', window._animWaitForTrigger ? '' : 'false');
    cbTrigger.addEventListener('change', (e) => { window._animWaitForTrigger = e.target.checked; });
    recordSection.content.appendChild(cbTrigger);

    const selectRate = document.createElement('wa-select');
    selectRate.setAttribute('label', 'Bake rate');
    selectRate.setAttribute('value', window._animCaptureRate.toString());
    selectRate.className = 'compact-select';
    
    const rateModes = [0.033, 0.1, 0.5, 1.0];
    const rateLabels = ['Dense (~30 fps)', 'Standard (~10 fps)', 'Sparse (2 fps)', 'Step Key (1 fps)'];
    rateModes.forEach((mode, idx) => {
      const opt = document.createElement('wa-option');
      opt.setAttribute('value', mode.toString());
      opt.innerText = rateLabels[idx];
      selectRate.appendChild(opt);
    });
    selectRate.addEventListener('change', (e) => { window._animCaptureRate = parseFloat(e.target.value); });
    recordSection.content.appendChild(selectRate);

    animContainer.appendChild(recordSection.details);

    // 4. Keyframes Section
    const keyframesSection = createSection('Keyframes', true);

    const selectKeyMode = document.createElement('wa-select');
    selectKeyMode.setAttribute('label', 'Key mode');
    selectKeyMode.setAttribute('value', window._animKeyMode);
    selectKeyMode.className = 'compact-select';
    
    ['shape', 'transform', 'blendshape'].forEach(mode => {
      const opt = document.createElement('wa-option');
      opt.setAttribute('value', mode);
      opt.innerText = mode;
      selectKeyMode.appendChild(opt);
    });
    selectKeyMode.addEventListener('change', (e) => { window._animKeyMode = e.target.value; });
    keyframesSection.content.appendChild(selectKeyMode);

    const btnAddKey = document.createElement('wa-button');
    btnAddKey.innerText = 'Add Key';
    btnAddKey.setAttribute('variant', 'primary');
    btnAddKey.addEventListener('click', () => this.addKeyframe());
    keyframesSection.content.appendChild(btnAddKey);

    const keyGrid = document.createElement('div');
    keyGrid.className = 'btn-grid';

    const keyButtons = [
      { label: 'Copy', method: 'copyKey' },
      { label: 'Paste', method: 'pasteKey' },
      { label: 'Cut', method: 'cutKey' },
      { label: 'Delete', method: 'deleteKey' }
    ];

    keyButtons.forEach(btn => {
      const b = document.createElement('wa-button');
      b.innerText = btn.label;
      b.setAttribute('size', 'small');
      b.setAttribute('variant', 'primary');
      if (btn.method === 'deleteKey') b.setAttribute('variant', 'danger');
      b.addEventListener('click', () => this[btn.method]());
      keyGrid.appendChild(b);
    });
    keyframesSection.content.appendChild(keyGrid);

    const cbAutoKey = document.createElement('wa-checkbox');
    cbAutoKey.innerText = 'Autokey';
    cbAutoKey.setAttribute('checked', window._animAutoKey ? '' : 'false');
    cbAutoKey.addEventListener('change', (e) => { this.toggleAutoKey(e.target.checked); });
    keyframesSection.content.appendChild(cbAutoKey);

    const cbTangents = document.createElement('wa-checkbox');
    cbTangents.innerText = 'Show Tangents';
    cbTangents.setAttribute('checked', window._animShowTangents ? '' : 'false');
    cbTangents.addEventListener('change', (e) => {
      window._animShowTangents = e.target.checked;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    });
    keyframesSection.content.appendChild(cbTangents);

    animContainer.appendChild(keyframesSection.details);

    // 5. Blendshapes Section
    const blendshapesSection = createSection('Blendshapes', true);
    animContainer.appendChild(blendshapesSection.details);
    this._blendshapesContent = blendshapesSection.content;

    sidebarDom.appendChild(animContainer);
  }

  toggleTimeline(val) {
    const timeline = this._ctrlGui._ctrlTimeline;
    if (timeline) {
      timeline.setVisibility(val);
    }
  }
  
  toggleAutoKey(val) {
    window._animAutoKey = val;
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
    const reg = window._animationRegistry;
    if (window._animPlaying && reg && reg.playbackDirection === -1) {
      window._animPlaying = false;
      reg.stopRecording(true);
    } else {
      window._animPlaying = true;
      if (reg) reg.playbackDirection = -1;
    }
  }

  playFwd() {
    const reg = window._animationRegistry;
    if (window._animPlaying && reg && reg.playbackDirection === 1) {
      window._animPlaying = false;
      reg.stopRecording(true);
    } else {
      window._animPlaying = true;
      if (reg) reg.playbackDirection = 1;
    }
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

    if (window._animCountIn) {
      window._animationRegistry.startRecording(targetMesh);
      return;
    }

    if (window._animWaitForTrigger) {
      window._animWaitingForGrab = true;
      window._animStatusText = '🟢 Waiting for Click...';
      
      const canvas = this._main.getCanvas();
      const onClick = (e) => {
        if (e.button !== 0) return; // Only left click
        canvas.removeEventListener('mousedown', onClick);
        if (window._animWaitingForGrab) {
          window._animWaitingForGrab = false;
          window._animationRegistry.startRecording(targetMesh);
        }
      };
      canvas.addEventListener('mousedown', onClick);
      return;
    }

    window._animationRegistry.startRecording(targetMesh);
  }

  clearAll() {
    if (!window._animationRegistry) return;
    window._vrConfirm('Clear all animation and reset tempo?', () => {
      window._animationRegistry.stopRecording(true);
      window._animationRegistry.tracks.clear();
      window._animCurrentTime = 0;
      window._animationRegistry.globalPlaybackTime = 0;
    });
  }

  printTracks() {
    const reg = window._animationRegistry;
    if (!reg) { console.log("No animation registry"); return; }
    const tracks = Array.from(reg.tracks.entries());
    console.log("Total Tracks:", tracks.length);
    tracks.forEach(([id, track]) => {
      console.log(`Track ID: ${id}, Keys count: ${track.times ? track.times.length : 0}`);
      console.log("Times:", JSON.stringify(track.times));
    });
  }

  addKeyframe() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    
    const reg = window._animationRegistry;
    const beforeState = new Map();
    reg.tracks.forEach((track, meshId) => {
      beforeState.set(meshId, TimelineHelper.cloneTrack(track));
    });

    const fps = window._animFPS || 24;
    const targetTime = Math.round((window._animCurrentTime || 0) * fps) / fps;
    
    window._animCurrentTime = targetTime;
    window._animationRegistry.globalPlaybackTime = targetTime;
    
    let actionName = '';
    if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
      window._animationRegistry.addShapeKey(targetMesh, targetTime);
      actionName = 'add shape key';
      if (window.screenLog) window.screenLog('◆ Added Shape Key', 'lime');
    } else if (window._animKeyMode === 'blendshape') {
      const track = reg.tracks.get(targetMesh.getID());
      const name = track ? track.editingBlendshape : null;
      if (name) {
        const weight = reg.evaluateScalarTrack(track.blendshapeTracks.get(name), targetTime);
        reg.setBlendshapeWeight(targetMesh, name, weight);
        actionName = 'add blendshape key';
        if (window.screenLog) window.screenLog(`◆ Added Blendshape Key [${name}]`, 'lime');
      } else {
        if (window.screenLog) window.screenLog('◆ No active blendshape to key!', 'orange');
        return;
      }
    } else {
      window._animationRegistry.addTransformKey(targetMesh, targetTime);
      actionName = 'add transform key';
      if (window.screenLog) window.screenLog('◆ Added Transform Key', 'lime');
    }

    const afterState = new Map();
    reg.tracks.forEach((track, meshId) => {
      afterState.set(meshId, TimelineHelper.cloneTrack(track));
    });

    const cbUndo = () => {
      beforeState.forEach((track, meshId) => {
        reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
      });
      this._main.render();
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    };

    const cbRedo = () => {
      afterState.forEach((track, meshId) => {
        reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
      });
      this._main.render();
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    };

    this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, actionName);
  }

  copyKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    
    if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
      window._animCopiedKeys = window._animSelectedKeys.map(k => {
        const track = window._animationRegistry.tracks.get(k.meshId);
        if (!track) return null;
        
        let kTime = k.time;
        if (kTime === undefined) {
          const times = k.type === 'transform' ? track.times : track.shapeTimes;
          kTime = times ? times[k.index] : undefined;
        }
        if (kTime === undefined) return null;

        if (k.type === 'transform' && track.times) {
          return {
            meshId: k.meshId,
            type: 'transform',
            time: kTime,
            p: track.positions.slice(k.index * 3, k.index * 3 + 3),
            q: track.quaternions.slice(k.index * 4, k.index * 4 + 4),
            s: track.scales.slice(k.index * 3, k.index * 3 + 3)
          };
        } else if (k.type === 'shape' && track.shapeTimes) {
          return {
            meshId: k.meshId,
            type: 'shape',
            time: kTime,
            shape: new Float32Array(track.shapes[k.index])
          };
        }
        return null;
      }).filter(Boolean);
      if (window.screenLog) window.screenLog(`📋 Copied ${window._animCopiedKeys.length} Keys`, 'lime');
    }
  }

  pasteKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;
    
    if (window._animCopiedKeys && window._animCopiedKeys.length > 0) {
      const tMin = Math.min(...window._animCopiedKeys.map(k => k.time));
      const pasteTime = window._animCurrentTime || 0;
      
      const commands = [];
      const main = this._main;
      
      window._animCopiedKeys.forEach(k => {
        const targetTime = pasteTime + (k.time - tMin);
        const id = targetMesh.getID();
        
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
          window._animationRegistry.update(targetMesh, true);
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
            
            main.render();
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
            
            main.render();
          },
          false,
          "Paste Keys"
        );
      }
      if (window.screenLog) window.screenLog(`📥 Pasted ${window._animCopiedKeys.length} Keys`, 'lime');
    }
  }

  cutKey() {
    this.copyKey();
    this.deleteKey();
  }

  deleteKey() {
    if (!window._animationRegistry) return;
    let targetMesh = this._main.getMesh();
    if (!targetMesh) return;

    const reg = window._animationRegistry;
    const beforeState = new Map();
    reg.tracks.forEach((track, meshId) => {
      beforeState.set(meshId, TimelineHelper.cloneTrack(track));
    });

    let actionName = '';

    if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
      window._animationRegistry.deleteSelectedKeys(window._animSelectedKeys);
      actionName = 'delete selected keys';
      if (window.screenLog) window.screenLog('🗑️ Deleted Selected Keys', 'orange');
    } else {
      const targetTime = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
        window._animationRegistry.deleteShapeKey(targetMesh, targetTime);
        actionName = 'delete shape key';
        if (window.screenLog) window.screenLog('🗑️ Deleted Shape Key', 'orange');
      } else {
        window._animationRegistry.deleteTransformKey(targetMesh, targetTime);
        actionName = 'delete transform key';
        if (window.screenLog) window.screenLog('🗑️ Deleted Transform Key', 'orange');
      }
    }

    window._animationRegistry.update(targetMesh, true);

    const afterState = new Map();
    reg.tracks.forEach((track, meshId) => {
      afterState.set(meshId, TimelineHelper.cloneTrack(track));
    });

    const cbUndo = () => {
      beforeState.forEach((track, meshId) => {
        reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
      });
      this._main.render();
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    };

    const cbRedo = () => {
      afterState.forEach((track, meshId) => {
        reg.tracks.set(meshId, TimelineHelper.cloneTrack(track));
      });
      this._main.render();
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    };

    this._main.getStateManager().pushStateCustom(cbUndo, cbRedo, false, actionName);
  }

  updateMesh() {
  }
}

export default GuiAnimation;
