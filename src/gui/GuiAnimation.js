import TR from './GuiTR.js';
import TimelineHelper from './TimelineHelper.js';

class GuiAnimation {
  constructor(guiParent, ctrlGui) {
    this._ctrlGui = ctrlGui;
    this._main = ctrlGui._main;
    this._menu = null;
    this.init(guiParent);
  }

  init(guiParent) {
    // Create a folder in the yagui sidebar
    const menu = guiParent.addMenu('Animation');
    menu.open();
    this._menu = menu;

    window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
    window._animAutoKey = window._animAutoKey !== undefined ? window._animAutoKey : false;
    window._animWaitForTrigger = window._animWaitForTrigger !== undefined ? window._animWaitForTrigger : true;
    window._animShowTangents = window._animShowTangents !== undefined ? window._animShowTangents : false;
    window._animShowTransformBox = false;
    window._animCaptureRate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.1;
    window._animFPS = window._animFPS || 24;
    window._animPlaybackSpeed = window._animPlaybackSpeed || 1.0;
    window._animKeyMode = window._animKeyMode || 'transform';

    // 1. View Options
    menu.addTitle('View Options');
    menu.addCheckbox('Show Timeline', false, (val) => this.toggleTimeline(val));
    menu.addCheckbox('Show Transform Box', false, (val) => {
      window._animShowTransformBox = val;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    });

    // 2. Transport
    menu.addTitle('Transport');
    menu.addButton('|< To Start', () => this.toStart());
    menu.addButton('<< Prev Frame', () => this.prevFrame());
    menu.addButton('< Play Rev', () => this.playRev());
    menu.addButton('[] Stop', () => this.stop());
    menu.addButton('> Play Fwd', () => this.playFwd());
    menu.addButton('>> Next Frame', () => this.nextFrame());
    menu.addButton('>| To End', () => this.toEnd());
    menu.addButton('O Record', () => this.record());

    menu.addCheckbox('Count-in', window._animCountIn, (val) => { window._animCountIn = val; });
    menu.addCheckbox('Wait for Trigger', window._animWaitForTrigger, (val) => { window._animWaitForTrigger = val; });

    // Sliders
    menu.addSlider('FPS', window._animFPS, (val) => { window._animFPS = val; }, 1, 60, 1);
    menu.addSlider('Playback Speed', window._animPlaybackSpeed, (val) => { window._animPlaybackSpeed = val; }, 0.1, 4.0, 0.1);

    // 3. Keyframes
    menu.addTitle('Keyframes');
    menu.addCombobox('Key Mode', window._animKeyMode, (val) => { window._animKeyMode = val; }, ['shape', 'transform']);
    menu.addButton('Add Keyframe', () => this.addKeyframe());
    menu.addButton('Copy Key', () => this.copyKey());
    menu.addButton('Paste Key', () => this.pasteKey());
    menu.addButton('Delete Key', () => this.deleteKey());
    menu.addCheckbox('AutoKey', window._animAutoKey, (val) => { this.toggleAutoKey(val); });
    menu.addCheckbox('Show Tangents', window._animShowTangents, (val) => {
      window._animShowTangents = val;
      const timeline = this._ctrlGui._ctrlTimeline;
      if (timeline) timeline.draw();
    });

    menu.addButton('Clear All', () => this.clearAll());
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
    if (confirm('Clear all animation and reset tempo?')) {
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
    } else {
      const targetTime = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
        window._animationRegistry.copyShapeKey(targetMesh, targetTime);
        if (window.screenLog) window.screenLog('📋 Copied Shape Key', 'lime');
      } else {
        window._animationRegistry.copyTransformKey(targetMesh, targetTime);
        if (window.screenLog) window.screenLog('📋 Copied Transform Key', 'lime');
      }
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
      
      const firstMeshId = window._animCopiedKeys[0].meshId;
      const allSameMesh = window._animCopiedKeys.every(k => k.meshId === firstMeshId);
      
      window._animCopiedKeys.forEach(k => {
        let trackMesh = null;
        if (allSameMesh) {
          trackMesh = targetMesh;
        } else {
          if (main.getMeshes) trackMesh = main.getMeshes().find(m => m.getID() === k.meshId);
          if (!trackMesh) trackMesh = targetMesh;
        }
        
        const targetTime = pasteTime + (k.time - tMin);
        if (targetTime > (window._animMasterDuration || 0)) {
          window._animMasterDuration = targetTime;
        }
        if (targetTime > (window._animLoopEnd || 0)) {
          window._animLoopEnd = targetTime;
        }
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
    } else {
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
