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
    window._animStatusText = '🔴 Record Track';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
    console.log('[Puppeteer] All tracks and state reset.');
  }

  startRecording(mesh) {
    if (!mesh) return;
    
    if (this.isCountingIn || this.isRecording) {
      return; // Debounce overlapping VR trigger signals!
    }
    
    if (this.captureTimer) clearInterval(this.captureTimer);

    const id = mesh.getID();
    this.activeRecordingId = id;
    this.activeMesh = mesh;
    
    // Initialize track
    this.tracks.set(id, {
      times: [],
      positions: [],
      quaternions: [],
      scales: [],
      playbackTime: 0,
      lastUpdate: performance.now()
    });
    
    console.log(`[Puppeteer] Initializing countdown for Mesh ${id}...`);
    
    this.isCountingIn = true;
    window._animStatusText = '3...';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
    
    let count = 3;
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        window._animStatusText = `${count}...`;
        if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
      } else {
        clearInterval(interval);
        this.isCountingIn = false;
        this.isRecording = true;
        this.startTime = performance.now();
        
        window._animStatusText = '🔴 RECORDING!';
        if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
        console.log(`[Puppeteer] Standalone capture loop started at 30fps for Mesh ${id}!`);

        // --- STANDALONE CAPTURE LOOP (30fps) ---
        this.captureTimer = setInterval(() => {
          this.captureTick();
        }, 33.3);
      }
    }, 1000);
  }

  captureTick() {
    if (!this.isRecording || !this.activeMesh) return;

    const track = this.tracks.get(this.activeRecordingId);
    if (!track) return;

    const elapsed = performance.now() - this.startTime;
    track.times.push(elapsed / 1000.0);

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
  }

  stopRecording() {
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = null;

    this.isRecording = false;
    this.isCountingIn = false;
    
    const track = this.tracks.get(this.activeRecordingId);
    const count = track ? track.times.length : 0;
    console.log(`[Puppeteer] Standalone capture loop stopped. Recorded frames: ${count}`);

    this.activeRecordingId = -1;
    this.activeMesh = null;
    
    window._animStatusText = '🔴 Record Track';
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
    
    if (this.tracks.size > 0) {
      window._animPlaying = true;
    }
  }

  update(mesh) {
    if (!mesh || !window._animPlaying) return;

    const track = this.tracks.get(mesh.getID());
    if (!track || track.times.length < 2 || mesh.getID() === this.activeRecordingId) return;

    const now = performance.now();
    const dt = (now - track.lastUpdate) / 1000.0;
    track.lastUpdate = now;
    track.playbackTime += dt;

    const maxTime = track.times[track.times.length - 1];
    if (track.playbackTime > maxTime) {
      track.playbackTime = 0;
    }

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
