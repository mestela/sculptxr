import { quat } from 'gl-matrix';

class AnimationRegistry {
  constructor() {
    this.tracks = new Map(); // Map<MeshID, { times, positions, quaternions, scales, playbackTime, lastUpdate }>
    this.activeRecordingId = -1;
    this.activeMesh = null;
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
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
    console.log('[Puppeteer] All tracks and master tempo reset.');
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
    
    // If it is the very first track EVER, or we are resetting it:
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [],
        positions: [],
        quaternions: [],
        scales: [],
        playbackTime: 0,
        lastUpdate: performance.now()
      });
    }
    
    if (this.tracks.size <= 1) {
      window._animMasterDuration = 0;
      // Also completely wipe any pre-existing keyframes on this single track so it captures from a fresh zero state!
      const tr = this.tracks.get(id);
      if (tr) {
        tr.times.length = 0;
        tr.positions.length = 0;
        tr.quaternions.length = 0;
        tr.scales.length = 0;
      }
    }

    window._animPlaying = true;
    
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
    
    // If we already have a Master DAW Duration running, we synchronize the recording timestamp 
    // so it drops perfectly into the moving playback buffer loop!
    const existingTrack = this.tracks.get(id);
    if (window._animMasterDuration && window._animMasterDuration > 0 && existingTrack) {
      // Set our virtual recording start offset precisely to where the global playhead currently is!
      this.startTime = performance.now() - (existingTrack.playbackTime * 1000.0);
      console.log(`[Puppeteer] Overdub Punch-In at loop time: ${existingTrack.playbackTime.toFixed(2)}s`);
    } else {
      this.startTime = performance.now();
      console.log(`[Puppeteer] Capturing Master Tempo Track for Mesh ${id}...`);
    }

    window._animStatusText = '🔴 RECORDING!';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;

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
        if (!this.tracks.has(this.activeRecordingId)) {
          this.tracks.set(this.activeRecordingId, { times: [], positions: [], quaternions: [], scales: [], playbackTime: 0 });
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
      if (Math.abs(rawElapsed - elapsed) > 0.01) {
        console.log(`[Looper Overwrite] Track ${this.activeRecordingId} wrapped around master tempo boundary! Raw Time: ${rawElapsed.toFixed(2)}s -> Modulo Time: ${elapsed.toFixed(2)}s`);
      }
      
      // Audio Looper Style: Overwrite any keyframes in this specific track that lie within a 0.05s neighborhood of our new modulo timestamp!
      for (let i = track.times.length - 1; i >= 0; i--) {
        if (Math.abs(track.times[i] - elapsed) < 0.05) {
          track.times.splice(i, 1);
          track.positions.splice(i * 3, 3);
          track.quaternions.splice(i * 4, 4);
          track.scales.splice(i * 3, 3);
        }
      }
    }

    track.times.push(elapsed);

    if (this.activeMesh.getMatrix) {
      const m = this.activeMesh.getMatrix();
      
      track.positions.push(m[12], m[13], m[14]);
      
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);
      track.scales.push(sx, sy, sz);
      
      const invSx = 1 / sx, invSy = 1 / sy, invSz = 1 / sz;
      const r00 = m[0]*invSx, r01 = m[1]*invSx, r02 = m[2]*invSx;
      const r10 = m[4]*invSy, r11 = m[5]*invSy, r12 = m[6]*invSy;
      const r20 = m[8]*invSz, r21 = m[9]*invSz, r22 = m[10]*invSz;
      
      const trace = r00 + r11 + r22;
      let qx, qy, qz, qw;
      
      if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1.0);
        qw = 0.25 / s;
        qx = (r12 - r21) * s;
        qy = (r20 - r02) * s;
        qz = (r01 - r10) * s;
      } else {
        if (r00 > r11 && r00 > r22) {
          const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
          qw = (r12 - r21) / s;
          qx = 0.25 * s;
          qy = (r01 + r10) / s;
          qz = (r20 + r02) / s;
        } else if (r11 > r22) {
          const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
          qw = (r20 - r02) / s;
          qx = (r01 + r10) / s;
          qy = 0.25 * s;
          qz = (r12 + r21) / s;
        } else {
          const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
          qw = (r01 - r10) / s;
          qx = (r20 + r02) / s;
          qy = (r12 + r21) / s;
          qz = 0.25 * s;
        }
      }
      track.quaternions.push(qx, qy, qz, qw);
    }
    
    // Auto-sort ring buffer so that when overdubbing out of order, interpolation remains stable!
    this._sortRingBuffer(track);
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
      console.log(`[Puppeteer] Debouncing trigger release (Duration only ${track.times[count - 1].toFixed(2)}s) - Keeping capture alive!`);
      return;
    }

    this.isRecording = false;
    this.isCountingIn = false;
    
    // If this is the very first finalized recording, lock its duration permanently as the Master Loop Boundary!
    if (track && count > 1 && (!window._animMasterDuration || window._animMasterDuration <= 0)) {
      window._animMasterDuration = track.times[track.times.length - 1];
      console.log(`[Puppeteer] Locked Global Master Loop Tempo to: ${window._animMasterDuration.toFixed(2)}s`);
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

    console.log(`[Puppeteer] Take finalized. Total ring-buffer frames: ${count}`);

    this.activeRecordingId = -1;
    this.activeMesh = null;
    
    window._animStatusText = window._animArmed ? '🔴 Punch In Ready!' : '⭕ Disarmed';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
    
    if (!isManualAbort && this.tracks.size > 0) {
      this.globalPlaybackTime = 0;
      window._animCurrentTime = 0;
      window._animPlaying = true;
    } else if (isManualAbort) {
      window._animPlaying = false;
    }
  }

  update(mesh, forceScrub = false) {
    if (!mesh || (!window._animPlaying && !forceScrub)) return;

    // If we are actively recording this specific mesh, completely bypass playback overrides so the user's live Grab motion isn't overwritten by pre-existing looping track data!
    if (this.isRecording && mesh.getID() === this.activeRecordingId) return;

    const now = performance.now();

    if (!forceScrub) {
      if (!this.lastGlobalTime || (now - this.lastGlobalTime) > 500) {
        this.lastGlobalTime = now;
      }

      const rawDt = now - this.lastGlobalTime;
      if (rawDt >= 8.0) {
        const dt = rawDt / 1000.0;
        this.lastGlobalTime = now;

        if (!this.globalPlaybackTime) this.globalPlaybackTime = 0;
        
        const dir = this.playbackDirection !== undefined ? this.playbackDirection : 1;
        this.globalPlaybackTime += dt * dir;

        window._animLastDt = dt;

        if (window._animMasterDuration && window._animMasterDuration > 0) {
          if (this.globalPlaybackTime < 0) {
            this.globalPlaybackTime = window._animMasterDuration + (this.globalPlaybackTime % window._animMasterDuration);
          } else {
            this.globalPlaybackTime = this.globalPlaybackTime % window._animMasterDuration;
          }
        }
        
        window._animCurrentTime = this.globalPlaybackTime;
      }
    }

    const track = this.tracks.get(mesh.getID());
    if (!track || track.times.length < 2) return;

    // Force the individual track to scrub precisely to the unified global clock
    track.playbackTime = this.globalPlaybackTime || 0;

    let frameIdx = 0;
    while (frameIdx < track.times.length - 1 && track.times[frameIdx + 1] < track.playbackTime) {
      frameIdx++;
    }

    const t1 = track.times[frameIdx];
    const t2 = track.times[frameIdx + 1];
    
    let alpha = 0;
    if (t2 > t1) {
      alpha = (track.playbackTime - t1) / (t2 - t1);
    }

    const pIdx1 = frameIdx * 3, pIdx2 = (frameIdx + 1) * 3;
    const px = track.positions[pIdx1] + (track.positions[pIdx2] - track.positions[pIdx1]) * alpha;
    const py = track.positions[pIdx1 + 1] + (track.positions[pIdx2 + 1] - track.positions[pIdx1 + 1]) * alpha;
    const pz = track.positions[pIdx1 + 2] + (track.positions[pIdx2 + 2] - track.positions[pIdx1 + 2]) * alpha;

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
      const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
      const xx = qx * x2, xy = qx * y2, xz = qx * z2;
      const yy = qy * y2, yz = qy * z2, zz = qz * z2;
      const wx = qw * x2, wy = qw * y2, wz = qw * z2;
      
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    }
  }
}

const globalRegistry = new AnimationRegistry();
window._animationRegistry = globalRegistry;

export default globalRegistry;
