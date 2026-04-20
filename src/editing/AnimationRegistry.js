import { quat, mat4 } from 'gl-matrix';

class AnimationRegistry {
  constructor() {
    this.tracks = new Map(); // Map<MeshID, { times, positions, quaternions, scales, playbackTime, lastUpdate }>
    this.activeRecordingId = -1;
    this.activeMesh = null;
    this.clipboardShape = null; // Floating clipboard buffer for copy/pasting morph keys
    this.isRecording = false;
    this.isCountingIn = false;
    this.startTime = 0;
    this.captureTimer = null;
  }

  resetAll() {
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = null;
    this.tracks.clear();
    this.activeRecordingId = -1;
    this.activeMesh = null;
    this.isRecording = false;
    this.isCountingIn = false;
    window._animPlaying = false;
    window._animMasterDuration = null;
    window._animStatusText = '🔴 Punch In Ready!';
    this.lastCaptureTime = -1;
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
  }

  startRecording(mesh) {
    if (!mesh || !window._animArmed) return;
    
    if (this.isCountingIn || this.isRecording) {
      return; 
    }
    
    if (this.captureTimer) clearInterval(this.captureTimer);

    // Garbage Collection: Clean out any ghost tracks belonging to meshes that have been deleted from the active scene!
    if (window.app && window.app._meshes) {
      const activeIds = new Set(window.app._meshes.map(m => m.getID()));
      for (const existingId of this.tracks.keys()) {
        if (!activeIds.has(existingId)) {
          this.tracks.delete(existingId);
        }
      }
    }

    const id = mesh.getID();
    this.activeRecordingId = id;
    this.activeMesh = mesh;
    this.lastCaptureTime = -1;
    
    // Capture state before recording for Undo!
    const track = this.tracks.get(id);
    this._trackStateBeforeRecording = null;
    if (track) {
      this._trackStateBeforeRecording = {
        times: track.times ? track.times.slice() : [],
        positions: track.positions ? track.positions.slice() : [],
        quaternions: track.quaternions ? track.quaternions.slice() : [],
        scales: track.scales ? track.scales.slice() : [],
        shapeTimes: track.shapeTimes ? track.shapeTimes.slice() : [],
        shapes: track.shapes ? track.shapes.map(s => new Float32Array(s)) : [],
        meshMatrix: mesh.getMatrix ? mesh.getMatrix().slice() : null
      };
    } else {
      this._trackStateBeforeRecording = {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [],
        meshMatrix: mesh.getMatrix ? mesh.getMatrix().slice() : null
      };
    }
    
    // If it is the very first track EVER, or we are resetting it:
    if (!this.tracks.has(id)) {
      let px = 0, py = 0, pz = 0;
      let qx = 0, qy = 0, qz = 0, qw = 1;
      let sx = 1, sy = 1, sz = 1;

      if (mesh.getMatrix) {
        const m = mesh.getMatrix();
        px = m[12]; py = m[13]; pz = m[14];
        
        sx = Math.hypot(m[0], m[1], m[2]);
        sy = Math.hypot(m[4], m[5], m[6]);
        sz = Math.hypot(m[8], m[9], m[10]);
        
        const invSx = 1 / sx, invSy = 1 / sy, invSz = 1 / sz;
        const r00 = m[0]*invSx, r01 = m[1]*invSx, r02 = m[2]*invSx;
        const r10 = m[4]*invSy, r11 = m[5]*invSy, r12 = m[6]*invSy;
        const r20 = m[8]*invSz, r21 = m[9]*invSz, r22 = m[10]*invSz;
        
        const trace = r00 + r11 + r22;
        if (trace > 0) {
          const s = 0.5 / Math.sqrt(trace + 1.0);
          qw = 0.25 / s; qx = (r21 - r12) * s; qy = (r02 - r20) * s; qz = (r10 - r01) * s;
        } else if (r00 > r11 && r00 > r22) {
          const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
          qw = (r21 - r12) / s; qx = 0.25 * s; qy = (r01 + r10) / s; qz = (r02 + r20) / s;
        } else if (r11 > r22) {
          const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
          qw = (r02 - r20) / s; qx = (r01 + r10) / s; qy = 0.25 * s; qz = (r12 + r21) / s;
        } else {
          const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
          qw = (r10 - r01) / s; qx = (r02 + r20) / s; qy = (r12 + r21) / s; qz = 0.25 * s;
        }
      }

      this.tracks.set(id, {
        times: [],
        positions: [],
        quaternions: [],
        scales: [],
        playbackTime: 0,
        restPos: [px, py, pz],
        restQuat: [qx, qy, qz, qw],
        restScale: [sx, sy, sz],
        lastUpdate: performance.now()
      });
    }
    
    if (this.tracks.size <= 1) {
      // Also completely wipe any pre-existing keyframes on this single track so it captures from a fresh zero state!
      const tr = this.tracks.get(id);
      if (tr) {
        tr.times.length = 0;
        tr.positions.length = 0;
        tr.quaternions.length = 0;
        tr.scales.length = 0;
      }
    }

    // Transport will start synchronously when punch in executes!
    
    // If user wants a countdown AND this isn't a rapid layer overdub:
    if (window._animCountIn) {
      this.isCountingIn = true;
      window._animStatusText = '3...';
      if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
      
      let count = 3;
      this.countInTimer = setInterval(() => {
        count--;
        if (count > 0) {
          window._animStatusText = `${count}...`;
          if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
        } else {
          if (this.countInTimer) clearInterval(this.countInTimer);
          this.countInTimer = null;
          this.isCountingIn = false;
          this._executePunchIn(id);
        }
      }, 1000);
    } else {
      // Immediate DAWs Punch In
      this._executePunchIn(id);
    }
  }

  _executePunchIn(id) {
    this.isRecording = true;
    window._animPlaying = true;
    
    const existingTrack = this.tracks.get(id);
    if (window._animMasterDuration && window._animMasterDuration > 0 && existingTrack) {
      // Set our virtual recording start offset precisely to where the global playhead currently is!
      const currentLoopTime = this.globalPlaybackTime || 0;
      this.startTime = performance.now() - (currentLoopTime * 1000.0);
    } else {
      this.startTime = performance.now();
    }

    window._animStatusText = '🔴 RECORDING!';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;

    if (existingTrack) {
      existingTrack.punchInTime = this.globalPlaybackTime || 0;
    }

    this.captureTimer = setInterval(() => {
      this.captureTick();
    }, 33.3);
  }

  captureTick() {
    if (window.app && window.app._mesh) {
      const liveMesh = window.app._mesh;
      if (liveMesh.getID() !== this.activeRecordingId) {
        this.activeRecordingId = liveMesh.getID();
        this.activeMesh = liveMesh;
        if (!this.tracks.has(this.activeRecordingId) && liveMesh.getMatrix) {
          const m = liveMesh.getMatrix();
          const px = m[12], py = m[13], pz = m[14];
          
          const sx = Math.hypot(m[0], m[1], m[2]);
          const sy = Math.hypot(m[4], m[5], m[6]);
          const sz = Math.hypot(m[8], m[9], m[10]);
          
          const invSx = 1 / sx, invSy = 1 / sy, invSz = 1 / sz;
          const r00 = m[0]*invSx, r01 = m[1]*invSx, r02 = m[2]*invSx;
          const r10 = m[4]*invSy, r11 = m[5]*invSy, r12 = m[6]*invSy;
          const r20 = m[8]*invSz, r21 = m[9]*invSz, r22 = m[10]*invSz;
          
          const trace = r00 + r11 + r22;
          let qx, qy, qz, qw;
          if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            qw = 0.25 / s; qx = (r21 - r12) * s; qy = (r02 - r20) * s; qz = (r10 - r01) * s;
          } else if (r00 > r11 && r00 > r22) {
            const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
            qw = (r21 - r12) / s; qx = 0.25 * s; qy = (r01 + r10) / s; qz = (r02 + r20) / s;
          } else if (r11 > r22) {
            const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
            qw = (r02 - r20) / s; qx = (r01 + r10) / s; qy = 0.25 * s; qz = (r12 + r21) / s;
          } else {
            const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
            qw = (r10 - r01) / s; qx = (r02 + r20) / s; qy = (r12 + r21) / s; qz = 0.25 * s;
          }

          console.log(`[Animation] Stored Rest Pose for ${this.activeRecordingId}: Pos[${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}]`);
          if (window.screenLog) window.screenLog(`[Animation] Stored Rest Pose`, "cyan");

          this.tracks.set(this.activeRecordingId, { 
            times: [], positions: [], quaternions: [], scales: [], 
            playbackTime: 0, 
            restPos: [px, py, pz], 
            restQuat: [qx, qy, qz, qw], 
            restScale: [sx, sy, sz] 
          });
        }
      }
    }

    if (!this.isRecording || !this.activeMesh) return;

    const track = this.tracks.get(this.activeRecordingId);
    if (!track) return;

    let elapsed = (performance.now() - this.startTime) / 1000.0;

    if (window._animMasterDuration && window._animMasterDuration > 0) {
      const rawElapsed = elapsed;
      elapsed = elapsed % window._animMasterDuration;
      
      if (this.lastCaptureTime >= 0) {
        const tA = this.lastCaptureTime;
        const tB = elapsed;
        if (tB >= tA) {
          for (let i = track.times.length - 1; i >= 0; i--) {
            if (track.times[i] > tA && track.times[i] <= tB) {
              track.times.splice(i, 1);
              track.positions.splice(i * 3, 3);
              track.quaternions.splice(i * 4, 4);
              track.scales.splice(i * 3, 3);
            }
          }
        } else {
          for (let i = track.times.length - 1; i >= 0; i--) {
            if (track.times[i] > tA || track.times[i] <= tB) {
              track.times.splice(i, 1);
              track.positions.splice(i * 3, 3);
              track.quaternions.splice(i * 4, 4);
              track.scales.splice(i * 3, 3);
            }
          }
        }
      }
      this.lastCaptureTime = elapsed;
    }

    const rate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.033;
    if (this.lastCaptureWriteTime !== undefined) {
      if (elapsed >= this.lastCaptureWriteTime && elapsed - this.lastCaptureWriteTime < rate) return;
    }
    this.lastCaptureWriteTime = elapsed;

    track.times.push(elapsed);

    if (this.activeMesh.getMatrix) {
      const m = mat4.create();
      mat4.mul(m, this.activeMesh.getMatrix(), this.activeMesh.getEditMatrix());
      
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);
      
      const invSx = 1 / sx, invSy = 1 / sy, invSz = 1 / sz;
      const r00 = m[0]*invSx, r01 = m[1]*invSx, r02 = m[2]*invSx;
      const r10 = m[4]*invSy, r11 = m[5]*invSy, r12 = m[6]*invSy;
      const r20 = m[8]*invSz, r21 = m[9]*invSz, r22 = m[10]*invSz;
      
      const trace = r00 + r11 + r22;
      let qx, qy, qz, qw;
      
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

      // Normalize quaternion and clamp NaNs to prevent corruption of the Mesh transform matrix
      let len = Math.hypot(qx, qy, qz, qw);
      if (len > 0.00001 && !isNaN(len)) {
        qx /= len; qy /= len; qz /= len; qw /= len;
      } else {
        qx = 0; qy = 0; qz = 0; qw = 1;
      }

      if (isNaN(m[12]) || isNaN(sx)) {
        track.positions.push(0, 0, 0);
        track.scales.push(1, 1, 1);
        track.quaternions.push(0, 0, 0, 1);
      } else {
        track.positions.push(m[12], m[13], m[14]);
        track.scales.push(sx, sy, sz);
        track.quaternions.push(qx, qy, qz, qw);
      }
    }
    
    // Auto-sort ring buffer so that when overdubbing out of order, interpolation remains stable!
    this._sortRingBuffer(track);
  }

  sortTrack(track) {
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
  }

  _sortRingBuffer(track) {
    if (track.times.length < 2) return;
    const n = track.times.length - 1;
    
    // Bubble the newly inserted frame backwards if it wrapped the loop boundary
    for (let i = n; i > 0; i--) {
      if (track.times[i] < track.times[i - 1]) {
        // Swap time
        let tmp = track.times[i];
        track.times[i] = track.times[i - 1];
        track.times[i - 1] = tmp;
        
        // Swap position
        for(let j=0; j<3; j++) {
          let p = track.positions[i*3 + j];
          track.positions[i*3 + j] = track.positions[(i-1)*3 + j];
          track.positions[(i-1)*3 + j] = p;
        }
        
        // Swap quat
        for(let j=0; j<4; j++) {
          let q = track.quaternions[i*4 + j];
          track.quaternions[i*4 + j] = track.quaternions[(i-1)*4 + j];
          track.quaternions[(i-1)*4 + j] = q;
        }
        
        // Swap scale
        for(let j=0; j<3; j++) {
          let s = track.scales[i*3 + j];
          track.scales[i*3 + j] = track.scales[(i-1)*3 + j];
          track.scales[(i-1)*3 + j] = s;
        }
      } else {
        break; // Already sorted
      }
    }
  }

  stopRecording(isManualAbort = false) {
    if (this.countInTimer) {
      clearInterval(this.countInTimer);
      this.countInTimer = null;
    }

    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = null;

    const track = this.tracks.get(this.activeRecordingId);
    const count = track ? track.times.length : 0;
    
    if (!isManualAbort && track && count > 0 && track.times[count - 1] < 0.5) {
      return;
    }

    this.isRecording = false;
    this.isCountingIn = false;
    
    // If this is the very first finalized recording, lock its duration permanently as the Master Loop Boundary!
    if (track && count > 1 && (!window._animMasterDuration || window._animMasterDuration <= 0)) {
      window._animMasterDuration = track.times[track.times.length - 1];
    } else if (track && count > 1 && window._animMasterDuration && window._animMasterDuration > 0) {
      const lastTime = track.times[track.times.length - 1];
      if (lastTime < window._animMasterDuration - 0.05) {
        // Pad the rest of this track's timeline with the exact same final pose so it correctly spans the full master loop boundary!
        track.times.push(window._animMasterDuration);
        const pIdx = (track.times.length - 2) * 3;
        const qIdx = (track.times.length - 2) * 4;
        track.positions.push(track.positions[pIdx], track.positions[pIdx+1], track.positions[pIdx+2]);
        track.quaternions.push(track.quaternions[qIdx], track.quaternions[qIdx+1], track.quaternions[qIdx+2], track.quaternions[qIdx+3]);
        track.scales.push(track.scales[pIdx], track.scales[pIdx+1], track.scales[pIdx+2]);
      }
    }

    if (track) {
      delete track.punchInTime;
    }

    // Push Undo state for recording!
    if (!isManualAbort && track && count > 0 && this._trackStateBeforeRecording) {
      const stateAfter = {
        times: track.times.slice(),
        positions: track.positions.slice(),
        quaternions: track.quaternions.slice(),
        scales: track.scales.slice(),
        shapeTimes: track.shapeTimes ? track.shapeTimes.slice() : [],
        shapes: track.shapes ? track.shapes.map(s => new Float32Array(s)) : []
      };
      
      const stateBefore = this._trackStateBeforeRecording;
      const meshId = this.activeRecordingId;
      
      if (window.app && window.app.getStateManager()) {
        window.app.getStateManager().pushStateCustom(
          () => { // UNDO
            console.log("[Undo] Restore Track State before Recording");
            const tr = this.tracks.get(meshId);
            if (!tr) return;
            tr.times = stateBefore.times.slice();
            tr.positions = stateBefore.positions.slice();
            tr.quaternions = stateBefore.quaternions.slice();
            tr.scales = stateBefore.scales.slice();
            tr.shapeTimes = stateBefore.shapeTimes.slice();
            tr.shapes = stateBefore.shapes.map(s => new Float32Array(s));
            this.sortTrack(tr);
            
            const msh = window.app.getMesh();
            if (msh && msh.getID() === meshId) {
              if (stateBefore.meshMatrix) {
                msh.setMatrix(stateBefore.meshMatrix);
              }
              this.update(msh, true);
            }
            
            if (window.app.render) window.app.render();
          },
          () => { // REDO
            console.log("[Redo] Restore Recorded Track State");
            const tr = this.tracks.get(meshId);
            if (!tr) return;
            tr.times = stateAfter.times.slice();
            tr.positions = stateAfter.positions.slice();
            tr.quaternions = stateAfter.quaternions.slice();
            tr.scales = stateAfter.scales.slice();
            tr.shapeTimes = stateAfter.shapeTimes.slice();
            tr.shapes = stateAfter.shapes.map(s => new Float32Array(s));
            this.sortTrack(tr);
            if (window.app.render) window.app.render();
          },
          false,
          "Record Motion"
        );
      }
    }

    this.activeRecordingId = -1;
    this.activeMesh = null;
    
    window._animStatusText = window._animArmed ? '🔴 Punch In Ready!' : '⭕ Disarmed';
    if (window.app && window.app._guiXR) {
      if (typeof window.app._guiXR.refreshToolsWidget === 'function') {
        window.app._guiXR.refreshToolsWidget();
      }
      window.app._guiXR._needsRedraw = true;
      window.app._guiXR.draw();
      window.app._guiXR.updateTexture();
    }
    
    if (!isManualAbort && this.tracks.size > 0) {
      this.globalPlaybackTime = 0;
      window._animCurrentTime = 0;
      window._animPlaying = true;
    } else if (isManualAbort) {
      window._animPlaying = false;
    }
  }

  addShapeKey(mesh, time) {
    if (!mesh) return;
    const id = mesh.getID();
    
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [],
        playbackTime: 0,
        lastUpdate: performance.now()
      });
    }
    
    const track = this.tracks.get(id);
    if (!track.shapeTimes) {
      track.shapeTimes = [];
      track.shapes = [];
    }
    
    const v = mesh.getVertices();
    const copy = new Float32Array(v);
    
    let idx = 0;
    while (idx < track.shapeTimes.length && track.shapeTimes[idx] < time) {
      idx++;
    }
    
    if (idx < track.shapeTimes.length && Math.abs(track.shapeTimes[idx] - time) < 0.005) {
      track.shapes[idx] = copy;
    } else {
      track.shapeTimes.splice(idx, 0, time);
      track.shapes.splice(idx, 0, copy);
    }
    
    if (time > (window._animMasterDuration || 0)) {
      window._animMasterDuration = time;
    }
    
    // Always snap the active playback marker to the newly created keyframe so it previews instantly!
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;
    
    console.log(`[Animation] Added Shape Key for ${id} at T=${time.toFixed(2)}s`);
  }

  copyShapeKey(mesh, time) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    
    // If there's an exact keyframe nearby, pull its direct buffer:
    let foundExact = false;
    if (track && track.shapeTimes) {
      for (let i = 0; i < track.shapeTimes.length; i++) {
        if (Math.abs(track.shapeTimes[i] - time) < 0.02) {
          const cached = track.shapes[i];
          this.clipboardShape = new Float32Array(cached);
          foundExact = true;
          window._animStatusText = `📋 Copied key at ${time.toFixed(2)}s`;
          break;
        }
      }
    }
    
    // Otherwise, capture the live calculated interpolation state at this exact timestamp:
    if (!foundExact) {
      const v = mesh.getVertices();
      if (v) {
        this.clipboardShape = new Float32Array(v);
        window._animStatusText = `📋 Snapshotted mesh at ${time.toFixed(2)}s`;
      }
    }
  }

  pasteShapeKey(mesh, time) {
    if (!mesh || !this.clipboardShape) return;
    const id = mesh.getID();
    
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [],
        playbackTime: 0, lastUpdate: performance.now()
      });
    }
    
    const track = this.tracks.get(id);
    if (!track.shapeTimes) {
      track.shapeTimes = [];
      track.shapes = [];
    }
    
    const copy = new Float32Array(this.clipboardShape);
    
    let idx = 0;
    while (idx < track.shapeTimes.length && track.shapeTimes[idx] < time) {
      idx++;
    }
    
    if (idx < track.shapeTimes.length && Math.abs(track.shapeTimes[idx] - time) < 0.005) {
      track.shapes[idx] = copy;
    } else {
      track.shapeTimes.splice(idx, 0, time);
      track.shapes.splice(idx, 0, copy);
    }
    
    if (time > (window._animMasterDuration || 0)) {
      window._animMasterDuration = time;
    }
    
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;
    
    // Trigger immediate refresh so the user sees the newly pasted state!
    if (mesh.updateGeometry) mesh.updateGeometry();
    if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
    if (window.app && window.app.render) window.app.render();
    
    window._animStatusText = `📥 Pasted key at ${time.toFixed(2)}s`;
  }

  deleteShapeKey(mesh, time) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.shapeTimes) return;
    
    for (let i = track.shapeTimes.length - 1; i >= 0; i--) {
      if (Math.abs(track.shapeTimes[i] - time) < 0.05) {
        const singleKey = [{ meshId: mesh.getID(), type: 'shape', index: i }];
        this.deleteSelectedKeys(singleKey);
        window._animStatusText = `🗑️ Deleted Shape key at ${time.toFixed(2)}s`;
        
        if (mesh.updateGeometry) mesh.updateGeometry();
        if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
        if (window.app && window.app.render) window.app.render();
        break;
      }
    }
  }

  addTransformKey(mesh, time) {
    if (!mesh) return;
    const id = mesh.getID();
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
      });
    }
    const track = this.tracks.get(id);
    if (!track.times) track.times = [];
    if (!track.positions) track.positions = [];
    if (!track.quaternions) track.quaternions = [];
    if (!track.scales) track.scales = [];

    // Extract TRS from matrix safely
    const m = mesh.getMatrix ? mesh.getMatrix() : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const px = m[12], py = m[13], pz = m[14];
    const sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);

    let qx=0, qy=0, qz=0, qw=1;
    if (sx>0.0001 && sy>0.0001 && sz>0.0001) {
      const r00 = m[0]/sx, r01 = m[1]/sx, r02 = m[2]/sx;
      const r10 = m[4]/sy, r11 = m[5]/sy, r12 = m[6]/sy;
      const r20 = m[8]/sz, r21 = m[9]/sz, r22 = m[10]/sz;
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

    let idx = 0;
    while (idx < track.times.length && track.times[idx] < time) idx++;

    if (idx < track.times.length && Math.abs(track.times[idx] - time) < 0.005) {
      track.positions.splice(idx*3, 3, px, py, pz);
      track.quaternions.splice(idx*4, 4, qx, qy, qz, qw);
      track.scales.splice(idx*3, 3, sx, sy, sz);
    } else {
      track.times.splice(idx, 0, time);
      track.positions.splice(idx*3, 0, px, py, pz);
      track.quaternions.splice(idx*4, 0, qx, qy, qz, qw);
      track.scales.splice(idx*3, 0, sx, sy, sz);
    }
    if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;
  }

  copyTransformKey(mesh, time) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    if (track && track.times) {
      for (let i = 0; i < track.times.length; i++) {
        if (Math.abs(track.times[i] - time) < 0.02) {
          this.clipboardTransform = {
            p: track.positions.slice(i*3, i*3+3),
            q: track.quaternions.slice(i*4, i*4+4),
            s: track.scales.slice(i*3, i*3+3)
          };
          window._animStatusText = `📋 Copied Transform key`;
          return;
        }
      }
    }
    const m = mesh.getMatrix ? mesh.getMatrix() : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    this.clipboardTransform = { p: [m[12], m[13], m[14]], q: [0,0,0,1], s: [1,1,1] };
  }

  pasteTransformKey(mesh, time) {
    if (!mesh || !this.clipboardTransform) return;
    const id = mesh.getID();
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
      });
    }
    const track = this.tracks.get(id);
    let idx = 0;
    while (idx < track.times.length && track.times[idx] < time) idx++;

    const { p, q, s } = this.clipboardTransform;
    if (idx < track.times.length && Math.abs(track.times[idx] - time) < 0.005) {
      track.positions.splice(idx*3, 3, p[0], p[1], p[2]);
      track.quaternions.splice(idx*4, 4, q[0], q[1], q[2], q[3]);
      track.scales.splice(idx*3, 3, s[0], s[1], s[2]);
    } else {
      track.times.splice(idx, 0, time);
      track.positions.splice(idx*3, 0, p[0], p[1], p[2]);
      track.quaternions.splice(idx*4, 0, q[0], q[1], q[2], q[3]);
      track.scales.splice(idx*3, 0, s[0], s[1], s[2]);
    }
    if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;
  }

  deleteTransformKey(mesh, time) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.times) return;

    for (let i = track.times.length - 1; i >= 0; i--) {
      if (Math.abs(track.times[i] - time) < 0.05) {
        const singleKey = [{ meshId: mesh.getID(), type: 'transform', index: i }];
        this.deleteSelectedKeys(singleKey);
        window._animStatusText = `🗑️ Deleted Transform key`;
        break;
      }
    }
  }

  deleteTrack(meshId) {
    if (this.tracks.has(meshId)) {
      this.tracks.delete(meshId);
      if (this.tracks.size === 0) {
        window._animPlaying = false;
      }
    }
  }

  deleteSelectedKeys(selectedKeys) {
    if (!selectedKeys || selectedKeys.length === 0) return;
    
    const commands = [];
    
    // Capture data before deletion
    selectedKeys.forEach(key => {
      const track = this.tracks.get(key.meshId);
      if (!track) return;
      
      if (key.type === 'transform' && track.times && track.times[key.index] !== undefined) {
        const idx = key.index;
        commands.push({
          meshId: key.meshId,
          type: 'transform',
          time: track.times[idx],
          pos: track.positions.slice(idx * 3, idx * 3 + 3),
          quat: track.quaternions.slice(idx * 4, idx * 4 + 4),
          scale: track.scales.slice(idx * 3, idx * 3 + 3)
        });
      } else if (key.type === 'shape' && track.shapeTimes && track.shapeTimes[key.index] !== undefined) {
        const idx = key.index;
        commands.push({
          meshId: key.meshId,
          type: 'shape',
          time: track.shapeTimes[idx],
          shape: new Float32Array(track.shapes[idx])
        });
      }
    });

    // Proceed with deletion
    const groups = new Map();
    selectedKeys.forEach(key => {
      const groupKey = `${key.meshId}_${key.type}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(key.index);
    });
    
    groups.forEach((indices, groupKey) => {
      const [meshIdStr, type] = groupKey.split('_');
      const meshId = parseInt(meshIdStr, 10);
      const track = this.tracks.get(meshId);
      if (!track) return;
      
      indices.sort((a, b) => b - a);
      
      indices.forEach(idx => {
        if (type === 'transform' && track.times && track.times[idx] !== undefined) {
          track.times.splice(idx, 1);
          track.positions.splice(idx * 3, 3);
          track.quaternions.splice(idx * 4, 4);
          track.scales.splice(idx * 3, 3);
        } else if (type === 'shape' && track.shapeTimes && track.shapeTimes[idx] !== undefined) {
          track.shapeTimes.splice(idx, 1);
          track.shapes.splice(idx, 1);
        }
      });
    });
    
    window._animSelectedKeys = [];
    window._animTransformBox = null;

    // Push to StateManager
    if (window.app && window.app.getStateManager() && commands.length > 0) {
      window.app.getStateManager().pushStateCustom(
        () => { // UNDO
          console.log("[Undo] Restore Deleted Keys (" + commands.length + " keys)");
          commands.forEach(cmd => {
            const tr = this.tracks.get(cmd.meshId);
            if (!tr) return;
            
            if (cmd.type === 'transform') {
              tr.times.push(cmd.time);
              tr.positions.push(...cmd.pos);
              tr.quaternions.push(...cmd.quat);
              tr.scales.push(...cmd.scale);
            } else if (cmd.type === 'shape') {
              tr.shapeTimes.push(cmd.time);
              tr.shapes.push(cmd.shape);
            }
          });
          
          const affectedTrackIds = new Set(commands.map(c => c.meshId));
          affectedTrackIds.forEach(id => {
            const tr = this.tracks.get(id);
            if (tr) this.sortTrack(tr);
          });
          
          if (window.app.render) window.app.render();
        },
        () => { // REDO
          console.log("[Redo] Delete Keys (" + commands.length + " keys)");
          commands.forEach(cmd => {
            const tr = this.tracks.get(cmd.meshId);
            if (!tr) return;
            
            const times = cmd.type === 'transform' ? tr.times : tr.shapeTimes;
            if (!times) return;
            
            let idx = -1;
            for (let i = 0; i < times.length; i++) {
              if (Math.abs(times[i] - cmd.time) < 0.005) {
                idx = i;
                break;
              }
            }
            if (idx !== -1) {
              if (cmd.type === 'transform') {
                tr.times.splice(idx, 1);
                tr.positions.splice(idx * 3, 3);
                tr.quaternions.splice(idx * 4, 4);
                tr.scales.splice(idx * 3, 3);
              } else if (cmd.type === 'shape') {
                tr.shapeTimes.splice(idx, 1);
                tr.shapes.splice(idx, 1);
              }
            }
          });
          
          if (window.app.render) window.app.render();
        },
        false,
        "Delete Keys"
      );
    }
  }

  getKeysInTimeRange(tMin, tMax, laneMin, laneMax) {
    let selected = [];
    const tracks = Array.from(this.tracks.entries());
    
    for (let i = Math.max(0, laneMin); i <= Math.min(tracks.length - 1, laneMax); i++) {
      const [meshId, track] = tracks[i];
      
      if (track.times) {
        for (let j = 0; j < track.times.length; j++) {
          const t = track.times[j];
          if (t >= tMin && t <= tMax) {
            selected.push({ meshId, type: 'transform', index: j });
          }
        }
      }
      if (track.shapeTimes) {
        for (let j = 0; j < track.shapeTimes.length; j++) {
          const t = track.shapeTimes[j];
          if (t >= tMin && t <= tMax) {
            selected.push({ meshId, type: 'shape', index: j });
          }
        }
      }
    }
    return selected;
  }

  moveSelectedKeys(selectedKeys, dt, masterDuration) {
    selectedKeys.forEach(key => {
      const track = this.tracks.get(key.meshId);
      if (!track) return;
      
      if (key.type === 'transform' && track.times && track.times[key.index] !== undefined) {
        const newTime = Math.max(0, Math.min(masterDuration, key.time + dt));
        track.times[key.index] = newTime;
      } else if (key.type === 'shape' && track.shapeTimes && track.shapeTimes[key.index] !== undefined) {
        const newTime = Math.max(0, Math.min(masterDuration, key.time + dt));
        track.shapeTimes[key.index] = newTime;
      }
    });
  }

  moveSelectedKeysValue(selectedKeys, dVal) {
    selectedKeys.forEach(key => {
      const track = this.tracks.get(key.meshId);
      if (!track) return;
      
      if (key.type === 'transform' && track.positions && key.index !== undefined && key.channel !== undefined) {
        track.positions[key.index * 3 + key.channel] = (key.startVal !== undefined ? key.startVal : 0) + dVal;
      }
    });
  }

  scaleSelectedKeys(selectedKeys, pivotTime, scaleFactor, masterDuration) {
    selectedKeys.forEach(initKey => {
      const track = this.tracks.get(initKey.meshId);
      if (!track) return;
      
      const relTime = initKey.time - pivotTime;
      const newTime = pivotTime + relTime * scaleFactor;
      const finalTime = Math.max(0, Math.min(masterDuration, newTime));

      if (initKey.type === 'transform' && track.times && track.times[initKey.index] !== undefined) {
        track.times[initKey.index] = finalTime;
      } else if (initKey.type === 'shape' && track.shapeTimes && track.shapeTimes[initKey.index] !== undefined) {
        track.shapeTimes[initKey.index] = finalTime;
      }
    });
  }

  getInterpolatedPosition(track, time) {
    if (!track || !track.times || track.times.length === 0) return [0, 0, 0];
    if (track.times.length === 1) return [track.positions[0], track.positions[1], track.positions[2]];
    
    let frameIdx = 0;
    while (frameIdx < track.times.length - 1 && track.times[frameIdx + 1] < time) {
      frameIdx++;
    }
    
    if (frameIdx === track.times.length - 1) {
      const idx = frameIdx * 3;
      return [track.positions[idx], track.positions[idx+1], track.positions[idx+2]];
    }
    
    const t1 = track.times[frameIdx];
    const t2 = track.times[frameIdx + 1];
    let alpha = 0;
    if (t2 > t1) alpha = (time - t1) / (t2 - t1);
    
    const pIdx1 = frameIdx * 3, pIdx2 = (frameIdx + 1) * 3;
    const px = track.positions[pIdx1] + (track.positions[pIdx2] - track.positions[pIdx1]) * alpha;
    const py = track.positions[pIdx1 + 1] + (track.positions[pIdx2 + 1] - track.positions[pIdx1 + 1]) * alpha;
    const pz = track.positions[pIdx1 + 2] + (track.positions[pIdx2 + 2] - track.positions[pIdx1 + 2]) * alpha;
    
    return [px, py, pz];
  }

  sortAllTracks() {
    this.tracks.forEach((track) => {
      this.sortTrack(track);
    });
  }

  getBezierT(targetAlpha, p1x, p2x) {
    let low = 0;
    let high = 1;
    let t = 0.5;
    for (let i = 0; i < 10; i++) {
      const tSq = t * t;
      const tCu = tSq * t;
      const omt = 1 - t;
      const omtSq = omt * omt;
      const currentAlpha = 3 * omtSq * t * p1x + 3 * omt * tSq * p2x + tCu;
      if (Math.abs(currentAlpha - targetAlpha) < 0.001) return t;
      if (currentAlpha < targetAlpha) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return t;
  }

  update(mesh, forceScrub = false) {
    if (window._animWaitingForGrab && window.app && window.app._guiXR) {
      window.app._guiXR._needsRedraw = true;
    }

    if (!mesh || (!window._animPlaying && !forceScrub)) return;

    if (this.isRecording && mesh.getID() === this.activeRecordingId) return;

    const now = performance.now();

    if (!window._animPlaying) {
      window._animCurrentTime = this.globalPlaybackTime || 0;
    }

    if (!forceScrub && window._animPlaying) {
      if (!this.lastGlobalTime || (now - this.lastGlobalTime) > 500) {
        this.lastGlobalTime = now;
      }

      const rawDt = now - this.lastGlobalTime;
      if (rawDt >= 8.0) {
        const dt = rawDt / 1000.0;
        this.lastGlobalTime = now;

        if (!this.globalPlaybackTime) this.globalPlaybackTime = 0;
        
        const dir = this.playbackDirection !== undefined ? this.playbackDirection : 1;
        const speed = window._animPlaybackSpeed !== undefined ? window._animPlaybackSpeed : 1.0;
        this.globalPlaybackTime += dt * dir * speed;

        window._animLastDt = dt;

        if (window._animMasterDuration && window._animMasterDuration > 0) {
          const lStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
          const lEnd = (window._animLoopEnd !== undefined && window._animLoopEnd > lStart) ? window._animLoopEnd : window._animMasterDuration;

          if (this.globalPlaybackTime > lEnd) {
            this.globalPlaybackTime = lStart;
          } else if (this.globalPlaybackTime < lStart) {
            this.globalPlaybackTime = lEnd;
          }
        }
        
        window._animCurrentTime = this.globalPlaybackTime;
      }
    }

    const track = this.tracks.get(mesh.getID());
    if (!track || track.muted) {
      if (track && track.muted && track.restPos && mesh.getMatrix) {
        const m = mesh.getMatrix();
        const [px, py, pz] = track.restPos;
        const [qx, qy, qz, qw] = track.restQuat;
        const [sx, sy, sz] = track.restScale;

        const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
        const xx = qx * x2, xy = qx * y2, xz = qx * z2;
        const yy = qy * y2, yz = qy * z2, zz = qz * z2;
        const wx = qw * x2, wy = qw * y2, wz = qw * z2;
        
        m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
        m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
        m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
        m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;

        if (mesh.updateMatrices && window.app && window.app._camera) {
          mesh.updateMatrices(window.app._camera);
        }
      }
      return;
    }

    track.playbackTime = this.globalPlaybackTime || 0;

    if (track.times && track.times.length >= 2) {
      let frameIdx = 0;
      while (frameIdx < track.times.length - 1 && track.times[frameIdx + 1] < track.playbackTime) {
        frameIdx++;
      }

      const t1 = track.times[frameIdx];
      const t2 = track.times[frameIdx + 1];
      const dt = t2 - t1;
      let px = 0, py = 0, pz = 0;
      const singleSelected = window._animSelectedKeys && window._animSelectedKeys.length === 1 ? window._animSelectedKeys[0] : null;

      for (let c = 0; c < 3; c++) {
        const v1 = track.positions[frameIdx * 3 + c];
        const v2 = track.positions[(frameIdx + 1) * 3 + c];
        let alpha = dt > 0 ? (track.playbackTime - t1) / dt : 0;
        const isSelectedChannel = singleSelected && singleSelected.type === 'transform' && singleSelected.meshId === mesh.getID() && singleSelected.channel === c;

        if (window._animShowTangents && track.times.length > 1 && isSelectedChannel) {
          const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dt`] : undefined;
          const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dv_${c}`] : undefined;
          const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dt`] : undefined;
          const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dv_${c}`] : undefined;
          const dt0 = rightDt !== undefined ? rightDt : 0.2;
          const dv0 = rightDv !== undefined ? rightDv : (v2 - v1) * 0.33;
          const dt1 = leftDt !== undefined ? leftDt : -0.2;
          const dv1 = leftDv !== undefined ? leftDv : -(v2 - v1) * 0.33;

          const p1x = dt0 / dt;
          const p2x = 1 + dt1 / dt;
          const t = this.getBezierT(alpha, p1x, p2x);
          const omt = 1 - t;
          const omtSq = omt * omt;
          const omtCu = omtSq * omt;
          const tSq = t * t;
          const tCu = tSq * t;
          const p1y = v1 + dv0;
          const p2y = v2 + dv1;

          const val = omtCu * v1 + 3 * omtSq * t * p1y + 3 * omt * tSq * p2y + tCu * v2;
          if (c === 0) px = val; else if (c === 1) py = val; else if (c === 2) pz = val;
        } else {
          const val = v1 + (v2 - v1) * alpha;
          if (c === 0) px = val; else if (c === 1) py = val; else if (c === 2) pz = val;
        }
      }

      const pIdx1 = frameIdx * 3;
      const pIdx2 = (frameIdx + 1) * 3;
      let alpha = dt > 0 ? (track.playbackTime - t1) / dt : 0;
      const sx = track.scales[pIdx1] + (track.scales[pIdx2] - track.scales[pIdx1]) * alpha;
      const sy = track.scales[pIdx1 + 1] + (track.scales[pIdx2 + 1] - track.scales[pIdx1 + 1]) * alpha;
      const sz = track.scales[pIdx1 + 2] + (track.scales[pIdx2 + 2] - track.scales[pIdx1 + 2]) * alpha;

    const qIdx1 = frameIdx * 4, qIdx2 = (frameIdx + 1) * 4;
    const q1 = [track.quaternions[qIdx1], track.quaternions[qIdx1 + 1], track.quaternions[qIdx1 + 2], track.quaternions[qIdx1 + 3]];
    const q2 = [track.quaternions[qIdx2], track.quaternions[qIdx2 + 1], track.quaternions[qIdx2 + 2], track.quaternions[qIdx2 + 3]];
    
    const outQuat = [0, 0, 0, 1];
    quat.slerp(outQuat, q1, q2, alpha);

    if (mesh.getMatrix) {
      const m = mesh.getMatrix();
      
      const qx = outQuat[0], qy = outQuat[1], qz = outQuat[2], qw = outQuat[3];
      if (isNaN(qx) || isNaN(px) || isNaN(sx)) {
        // Completely drop out to prevent NaN matrix corruption
        return;
      }

      const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
      const xx = qx * x2, xy = qx * y2, xz = qx * z2;
      const yy = qy * y2, yz = qy * z2, zz = qz * z2;
      const wx = qw * x2, wy = qw * y2, wz = qw * z2;
      
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;

      if (mesh.updateMatrices && window.app && window.app._camera) {
        mesh.updateMatrices(window.app._camera);
      }
      if (window.app && window.app.render) window.app.render();
    }

    }

    if (track.shapeTimes && track.shapeTimes.length > 0) {
      let sAlpha = 0;
      let s1 = null;
      let s2 = null;
      let sIdx = 0;

      if (track.shapeTimes.length === 1) {
        s1 = track.shapes[0];
        s2 = track.shapes[0];
        sAlpha = 0;
      } else {
        while (sIdx < track.shapeTimes.length - 1 && track.shapeTimes[sIdx + 1] < track.playbackTime) {
          sIdx++;
        }

        const st1 = track.shapeTimes[sIdx];
        const st2 = track.shapeTimes[sIdx + 1];

        if (st2 > st1) {
          sAlpha = (track.playbackTime - st1) / (st2 - st1);
        }

        s1 = track.shapes[sIdx];
        s2 = track.shapes[sIdx + 1];
      }

      const verts = mesh.getVertices();
      const minLen = Math.min(s1 ? s1.length : 0, s2 ? s2.length : 0, verts ? verts.length : 0);
      const reqLen = mesh.getNbVertices ? mesh.getNbVertices() * 3 : minLen;

      if (verts && s1 && s2 && minLen >= reqLen && reqLen > 0) {
        let blend = sAlpha;

        if (window._animShowTangents && track.shapeTimes.length > 1) {
          let m0 = 1.0;
          let m1 = 1.0;

          if (track.tangentOffsets) {
            const rightVal = track.tangentOffsets[`${sIdx}_right`];
            const leftVal = track.tangentOffsets[`${sIdx + 1}_left`];
            
            const rightHandle = rightVal !== undefined ? rightVal : 25;
            const leftHandle = leftVal !== undefined ? leftVal : -25;

            m0 = rightHandle / 25.0;
            m1 = -leftHandle / 25.0;
          }

          const t = sAlpha;
          const t2 = t * t;
          const t3 = t2 * t;

          blend = (-2 * t3 + 3 * t2) + m0 * (t3 - 2 * t2 + t) + m1 * (t3 - t2);
        }

        for (let i = 0; i < reqLen; i++) {
          verts[i] = s1[i] + (s2[i] - s1[i]) * blend;
        }

        if (mesh.updateGeometry) mesh.updateGeometry();
        if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
        if (window.app && window.app.render) window.app.render();
      }
    }
  }
}

const globalRegistry = new AnimationRegistry();
window._animationRegistry = globalRegistry;

export default globalRegistry;
