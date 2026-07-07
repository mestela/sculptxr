import { quat, mat4 } from 'gl-matrix';
import { arkitEntry, arkitSplitTargets, arkitUnifiedFor } from './ArkitBlendshapes.js';
import Enums from '../misc/Enums.js';

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
    window._animStatusText = 'Punch In Ready';
    this.lastCaptureTime = -1;
    if (window.app && window.app._guiXR) window.app._guiXR._needsRedraw = true;
  }

  // Deep-clones the timing and keyframe data of a track so it can be pushed as
  // an undo/redo snapshot.  Blendshape tracks and shape buffers are also cloned.
  _snapshotTrack(track) {
    if (!track) return null;
    const snap = {
      times:            track.times            ? track.times.slice()                              : [],
      positions:        track.positions        ? track.positions.slice()                          : [],
      quaternions:      track.quaternions      ? track.quaternions.slice()                        : [],
      scales:           track.scales           ? track.scales.slice()                             : [],
      shapeTimes:       track.shapeTimes       ? track.shapeTimes.slice()                         : [],
      shapes:           track.shapes           ? track.shapes.map(s => new Float32Array(s))       : [],
      shapeOutputTimes: track.shapeOutputTimes ? track.shapeOutputTimes.slice()                   : [],
      visTimes:         track.visTimes         ? track.visTimes.slice()                           : [],
      visValues:        track.visValues        ? track.visValues.slice()                          : [],
      tangentOffsets:   track.tangentOffsets   ? JSON.parse(JSON.stringify(track.tangentOffsets)) : undefined,
    };
    if (track.blendshapeTracks) {
      snap.blendshapeTracks = new Map();
      track.blendshapeTracks.forEach((bt, name) => {
        snap.blendshapeTracks.set(name, { times: bt.times.slice(), values: bt.values.slice() });
      });
    }
    return snap;
  }

  // Restores a track's timing and keyframe data from a snapshot produced by
  // _snapshotTrack, then re-evaluates the animation for the given mesh.
  _restoreTrack(track, snap, mesh) {
    if (!track || !snap) return;
    track.times            = snap.times.slice();
    track.positions        = snap.positions.slice();
    track.quaternions      = snap.quaternions.slice();
    track.scales           = snap.scales.slice();
    track.shapeTimes       = snap.shapeTimes.slice();
    track.shapes           = snap.shapes.map(s => new Float32Array(s));
    track.shapeOutputTimes = snap.shapeOutputTimes.slice();
    track.visTimes         = snap.visTimes  ? snap.visTimes.slice()  : [];
    track.visValues        = snap.visValues ? snap.visValues.slice() : [];
    track.tangentOffsets   = snap.tangentOffsets ? JSON.parse(JSON.stringify(snap.tangentOffsets)) : undefined;
    if (snap.blendshapeTracks) {
      if (!track.blendshapeTracks) track.blendshapeTracks = new Map();
      snap.blendshapeTracks.forEach((bSnap, name) => {
        const bt = track.blendshapeTracks.get(name);
        if (bt) { bt.times = bSnap.times.slice(); bt.values = bSnap.values.slice(); }
      });
    }
    this.sortTrack(track);
    if (mesh) this.update(mesh, true);
    if (window.app?.render) window.app.render();
  }

  // Single entry point for the Record button (ACP + timeline toolbar) so both agree and
  // it acts as a proper toggle. Idle → arm + (wait-for-grab, or start; startRecording does
  // its own count-in). Recording / counting-in / waiting → stop and disarm. No selection →
  // a nudge instead of a silent no-op. Returns true if now armed/recording.
  // Best-guess "object to record" when a caller doesn't pass one: current selection →
  // active mesh → first mesh in the scene. Mirrors AnimationControlPanel's _getTargetMesh.
  _resolveTargetMesh() {
    const app = window.app;
    if (!app) return null;
    return app._selectMeshes?.[0] || app._mesh || app.getMeshes?.()?.[0] || null;
  }

  toggleRecord(mesh) {
    // Active = any part of a record session (armed / waiting / counting-in / recording, or a
    // live timer). Pressing Record in ANY of these turns it off — so it's a true toggle and
    // can't silently re-arm. (`_animArmed` stays true for the whole session.)
    const active = this.isRecording || this.isCountingIn || window._animWaitingForGrab
                || window._animArmed || this.captureTimer || this.countInTimer;
    if (active) {
      window._animWaitingForGrab = false;
      window._animArmed = false;
      this.stopRecording(false);   // finalize the take (keeps it + pushes undo)
      // Force the flags off in case stopRecording early-returned (its <0.5s "discard tiny
      // take" guard leaves isRecording set otherwise → the button would re-arm on next press).
      this.isRecording = false;
      this.isCountingIn = false;
      // AFTER stopRecording: its finalize tail auto-plays the take (sets _animPlaying=true).
      // Turning record OFF must not start playback — override it here. (The Escape handler
      // re-enables play for the "review a real take" case it wants.)
      window._animPlaying = false;
      window._animStatusText = '';
      if (window.app?._guiXR) window.app._guiXR._needsRedraw = true;
      return false;
    }
    // Resolve the target robustly when the caller didn't hand us one. The timeline record
    // button passed only `getMesh()` (== app._mesh), which can be null in VR when nothing is
    // the actively-picked mesh — so it nudged instead of arming while the ACP button (which
    // falls back through _selectMeshes / getMeshes) worked. Mirror that fallback here so both
    // record controls behave identically.
    if (!mesh) mesh = this._resolveTargetMesh();
    if (!mesh) { window.screenLog?.('Select an object to record', 'orange'); return false; }
    window._animArmed = true;
    // Wait-for-Trigger (without count-in) arms and defers the capture to the next Grab.
    if (window._animWaitForTrigger && !window._animCountIn) {
      window._animWaitingForGrab = true;
      window._animStatusText = 'Grab an object to record';
      if (window.app?._guiXR) window.app._guiXR._needsRedraw = true;
    } else {
      this.startRecording(mesh);
    }
    return true;
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
    this._shapeCaptureLen = -1;        // #30: re-latch the vertex-topology length per take
    this._shapeCaptureWarned = false;
    this._shapeStrokeSnap = null;
    this._shapeLayerStrokeSnap = null;
    this._lastGridFrame = -1;
    this._shapeWasStroking = false;

    // #30: vertex recording needs a fixed vertex count across the take. Warn upfront if
    // dyntopo is live (the mesh will re-tessellate under the brush and poison the lerp).
    if (window._animKeyMode === 'shape' && mesh.isDynamic) {
      window.screenLog?.('Heads up: turn dyntopo off for vertex recording', 'orange');
    }
    
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

    window._animStatusText = 'Recording';
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

    // #30 unify (2026-07-06): shape (vertex) capture no longer runs on this setInterval —
    // it moved into update()'s render-loop rebase so display + capture share ONE clock
    // (killed a two-clock race) and keys snap to a fixed frame grid (killed per-loop
    // rolling drift). See `_captureShapeKeyGridded`. captureTick now handles transform only.
    if (window._animKeyMode === 'shape') return;

    if (window._animMasterDuration && window._animMasterDuration > 0) {
      const rawElapsed = elapsed;
      elapsed = elapsed % window._animMasterDuration;

      if (this.lastCaptureTime >= 0) {
        const tA = this.lastCaptureTime;
        const tB = elapsed;
        // Punch-in overwrite: drop any prior transform keys in the time window we just
        // re-passed so overdubbing replaces instead of piling up.
        const inWindow = (t) => (tB >= tA) ? (t > tA && t <= tB) : (t > tA || t <= tB);
        for (let i = track.times.length - 1; i >= 0; i--) {
          if (inWindow(track.times[i])) {
            track.times.splice(i, 1);
            track.positions.splice(i * 3, 3);
            track.quaternions.splice(i * 4, 4);
            track.scales.splice(i * 3, 3);
          }
        }
      }
      this.lastCaptureTime = elapsed;
    }

    const rate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.1;
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
            if (track.shapeOutputTimes) {
              let tmpOut = track.shapeOutputTimes[i];
              track.shapeOutputTimes[i] = track.shapeOutputTimes[j];
              track.shapeOutputTimes[j] = tmpOut;
            }
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

  // Shape-track counterpart of _sortRingBuffer: keeps shapeTimes/shapes (and the
  // parallel shapeOutputTimes) ordered when a wrapped-loop overdub inserts a key
  // out of order. Swaps whole Float32Array snapshots by reference (cheap).
  _sortShapeRingBuffer(track) {
    const st = track.shapeTimes;
    if (!st || st.length < 2) return;
    for (let i = st.length - 1; i > 0; i--) {
      if (st[i] < st[i - 1]) {
        let tmp = st[i]; st[i] = st[i - 1]; st[i - 1] = tmp;
        let shp = track.shapes[i]; track.shapes[i] = track.shapes[i - 1]; track.shapes[i - 1] = shp;
        if (track.shapeOutputTimes) {
          let so = track.shapeOutputTimes[i];
          track.shapeOutputTimes[i] = track.shapeOutputTimes[i - 1];
          track.shapeOutputTimes[i - 1] = so;
        }
      } else {
        break;
      }
    }
  }

  // Evaluate a frozen shape-track snapshot ({times, shapes}) at time t into a fresh
  // Float32Array of length nb (clamped-linear, matching the ShotSculpt playback lerp).
  // Returns null if the snapshot has no keys. Used by #30 additive-wave recording to get
  // the prior waves' composite at the playhead without touching the live track.
  _evalShapeSnapshot(snap, t, nb) {
    const times = snap && snap.times;
    const shapes = snap && snap.shapes;
    if (!times || !shapes || times.length === 0) return null;
    if (times.length === 1 || shapes.length === 1) {
      return shapes[0] ? new Float32Array(shapes[0].subarray(0, nb)) : null;
    }
    let i = 0;
    const last = Math.min(times.length, shapes.length) - 1;
    while (i < last && times[i + 1] < t) i++;
    const s1 = shapes[i], s2 = shapes[i + 1] || shapes[i];
    if (!s1 || !s2 || s1.length < nb || s2.length < nb) return null;
    const t1 = times[i], t2 = times[i + 1] ?? t1;
    let a = (t2 > t1) ? (t - t1) / (t2 - t1) : 0;
    if (a < 0) a = 0; else if (a > 1) a = 1;
    const out = new Float32Array(nb);
    for (let k = 0; k < nb; k++) out[k] = s1[k] + (s2[k] - s1[k]) * a;
    return out;
  }

  // Layer-ready shape-key writer: write `keyVerts` into `track` at the (already grid-snapped)
  // `keyTime`, overwriting the exact slot on a re-pass. Kept generic (takes the track) so the
  // planned per-layer recording can reuse it verbatim, pointing at the active layer's track.
  _captureShapeKeyGridded(track, keyTime, keyVerts) {
    if (!track.shapeTimes) { track.shapeTimes = []; track.shapes = []; }
    const eps = 1e-4; // times are grid-snapped, so a tight window hits only the same slot
    for (let i = track.shapeTimes.length - 1; i >= 0; i--) {
      if (Math.abs(track.shapeTimes[i] - keyTime) < eps) {
        track.shapeTimes.splice(i, 1);
        track.shapes.splice(i, 1);
        if (track.shapeOutputTimes) track.shapeOutputTimes.splice(i, 1);
      }
    }
    track.shapeTimes.push(keyTime);
    track.shapes.push(keyVerts);
    if (track.shapeOutputTimes) track.shapeOutputTimes.push(keyTime);
    this._sortShapeRingBuffer(track);
  }

  // ── Shape-animation LAYERS (#34) ──────────────────────────────────────────────────────
  // A track's base shape animation lives in `shapeTimes`/`shapes` (absolute snapshots). On
  // top sit named LAYERS, each holding per-time DELTAS in the same {shapeTimes, shapes,
  // shapeOutputTimes} shape. Playback = base + Σ unmuted layer deltas, so a later layer's
  // edit RIDES the earlier motion (mouth rides jaw). The active layer is where recording
  // writes (activeShapeLayerIdx: -1 = the base track, ≥0 = a layer).
  _shapeLayers(track) {
    if (track && !track.shapeLayers) track.shapeLayers = [];
    return track ? track.shapeLayers : [];
  }

  addShapeLayer(mesh, name) {
    if (!mesh) return -1;
    const id = mesh.getID();
    if (!this.tracks.has(id)) {
      this.tracks.set(id, { times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], shapeOutputTimes: [], playbackTime: 0 });
    }
    const track = this.tracks.get(id);
    // The rest pose the layer deltas ride on when there's no base shape animation — snapshot
    // the current (base) mesh once, so playback can reset to it before adding deltas.
    if (!track._layerBase && mesh.getVertices) {
      const v = mesh.getVertices();
      const nb = (mesh.getNbVertices ? mesh.getNbVertices() : v.length / 3) * 3;
      track._layerBase = new Float32Array(v.subarray(0, nb));
    }
    const layers = this._shapeLayers(track);
    layers.push({ name: name || `Layer ${layers.length + 1}`, muted: false,
                  shapeTimes: [], shapes: [], shapeOutputTimes: [] });
    track.activeShapeLayerIdx = layers.length - 1; // record into the new layer
    return track.activeShapeLayerIdx;
  }

  setActiveShapeLayer(mesh, idx) {
    const track = mesh && this.tracks.get(mesh.getID());
    if (track) track.activeShapeLayerIdx = idx; // -1 = base shape track
  }

  toggleShapeLayerMute(mesh, idx) {
    const L = mesh && this.tracks.get(mesh.getID())?.shapeLayers?.[idx];
    if (!L) return;
    L.muted = !L.muted;
    if (window.app?.getMesh) this.update(window.app.getMesh(), true);
    if (window.app?.render) window.app.render();
  }

  // Remove a shape layer entirely (its animation goes with it). Undoable.
  removeShapeLayer(mesh, idx) {
    const track = mesh && this.tracks.get(mesh.getID());
    const layers = track && track.shapeLayers;
    if (!layers || idx < 0 || idx >= layers.length) return;
    const removed = layers[idx];
    const meshId = mesh.getID();
    const prevActive = track.activeShapeLayerIdx;
    const refresh = () => {
      const msh = window.app?.getMesh?.();
      if (msh && msh.getID() === meshId) this.update(msh, true);
      if (window.app?.render) window.app.render();
    };
    const doRemove = () => {
      const ls = this.tracks.get(meshId)?.shapeLayers;
      const at = ls ? ls.indexOf(removed) : -1;
      if (at >= 0) ls.splice(at, 1);
      const t = this.tracks.get(meshId); if (t) t.activeShapeLayerIdx = -1;
      refresh();
    };
    const undoRemove = () => {
      const t = this.tracks.get(meshId);
      if (t) { t.shapeLayers = t.shapeLayers || []; t.shapeLayers.splice(Math.min(idx, t.shapeLayers.length), 0, removed); t.activeShapeLayerIdx = prevActive; }
      refresh();
    };
    doRemove();
    window.app?.getStateManager?.()?.pushStateCustom?.(undoRemove, doRemove, false, 'Delete Shape Layer');
  }

  // Combine several shape layers into ONE (their deltas are additive, so the merged layer's
  // delta at t = Σ of the selected layers' deltas at t). Keys land at the union of the
  // sources' key times. The merged layer takes the lowest selected slot; the rest are removed.
  // Undoable (snapshots the whole layer list). Returns the new layer's index, or -1.
  combineShapeLayers(mesh, indices) {
    const track = mesh && this.tracks.get(mesh.getID());
    const layers = track && track.shapeLayers;
    if (!layers || !indices || indices.length < 2) return -1;
    const idxs = [...new Set(indices)].filter(i => i >= 0 && i < layers.length).sort((a, b) => a - b);
    if (idxs.length < 2) return -1;
    const meshId = mesh.getID();
    const nb = (mesh.getNbVertices ? mesh.getNbVertices() : mesh.getVertices().length / 3) * 3;
    const sel = idxs.map(i => layers[i]);

    // Union of key times across the selected layers, then sum each layer's delta at each time.
    const timeSet = new Set();
    sel.forEach(L => (L.shapeTimes || []).forEach(t => timeSet.add(Math.round(t * 1e5) / 1e5)));
    const times = [...timeSet].sort((a, b) => a - b);
    const shapes = times.map(t => {
      const d = new Float32Array(nb);
      sel.forEach(L => {
        const e = this._evalShapeSnapshot({ times: L.shapeTimes, shapes: L.shapes }, t, nb);
        if (e) for (let k = 0; k < nb; k++) d[k] += e[k];
      });
      return d;
    });
    const combined = { name: sel[0].name + ' +' + (sel.length - 1), muted: false,
      shapeTimes: times.slice(), shapes: shapes.slice(), shapeOutputTimes: times.slice() };

    const before = layers.slice();          // shallow snapshot of the layer list
    const prevActive = track.activeShapeLayerIdx;
    const targetIdx = idxs[0];
    const refresh = () => {
      const msh = window.app?.getMesh?.();
      if (msh && msh.getID() === meshId) this.update(msh, true);
      if (window.app?.render) window.app.render();
    };
    const apply = () => {
      const t = this.tracks.get(meshId); if (!t) return;
      t.shapeLayers = before.filter(L => !sel.includes(L));
      t.shapeLayers.splice(Math.min(targetIdx, t.shapeLayers.length), 0, combined);
      t.activeShapeLayerIdx = -1;
      refresh();
    };
    const revert = () => {
      const t = this.tracks.get(meshId); if (!t) return;
      t.shapeLayers = before.slice();
      t.activeShapeLayerIdx = prevActive;
      refresh();
    };
    apply();
    window.app?.getStateManager?.()?.pushStateCustom?.(revert, apply, false, 'Combine Shape Layers');
    return Math.min(targetIdx, (this.tracks.get(meshId)?.shapeLayers?.length || 1) - 1);
  }

  // The layer object currently armed for recording, or null (= the base shape track).
  _activeShapeLayer(track) {
    const idx = track && track.activeShapeLayerIdx;
    if (idx === undefined || idx === null || idx < 0) return null;
    const layers = track.shapeLayers;
    return (layers && idx < layers.length) ? layers[idx] : null;
  }

  // Add each unmuted shape-layer's delta at time t into `verts` (in place). `excludeIdx`
  // skips one layer — used while recording it (its own delta isn't part of the base it
  // rides on). nb = vertex-count × 3.
  _addShapeLayerDeltas(track, t, nb, verts, excludeIdx = -1) {
    const layers = track && track.shapeLayers;
    if (!layers || !layers.length) return;
    for (let li = 0; li < layers.length; li++) {
      if (li === excludeIdx) continue;
      const L = layers[li];
      if (L.muted || !L.shapeTimes || !L.shapeTimes.length) continue;
      const d = this._evalShapeSnapshot({ times: L.shapeTimes, shapes: L.shapes }, t, nb);
      if (d) for (let k = 0; k < nb; k++) verts[k] += d[k];
    }
  }

  // Per-wave undo for shape recording: on trigger release, push a state that restores the
  // shape track to its pre-stroke snapshot (`before`). `squash=true` chains it with the
  // sculpt's own geometry state (pushed at stroke start) so ONE undo removes both the
  // recorded keys and the mesh deformation of that wave. No-op if the stroke captured nothing.
  _pushShapeWaveUndo(meshId, before) {
    const track = this.tracks.get(meshId);
    const sm = window.app?.getStateManager?.();
    if (!track || !sm) return;
    const after = {
      times:  (track.shapeTimes || []).slice(),
      shapes: (track.shapes || []).slice(),
      outs:   track.shapeOutputTimes ? track.shapeOutputTimes.slice() : null,
    };
    const b = { times: before.times || [], shapes: before.shapes || [], outs: before.outs || null };
    const changed = b.times.length !== after.times.length
      || b.times.some((t, i) => t !== after.times[i])
      || b.shapes.some((s, i) => s !== after.shapes[i]);
    if (!changed) return;
    const restore = (snap) => {
      const tr = this.tracks.get(meshId);
      if (!tr) return;
      tr.shapeTimes = (snap.times || []).slice();
      tr.shapes = (snap.shapes || []).slice();
      if (snap.outs) tr.shapeOutputTimes = snap.outs.slice();
      else if (tr.shapeOutputTimes) tr.shapeOutputTimes = (snap.times || []).slice();
      this.sortTrack(tr);
      const msh = window.app?.getMesh?.();
      if (msh && msh.getID() === meshId) this.update(msh, true);
      if (window.app?.render) window.app.render();
    };
    sm.pushStateCustom(() => restore(b), () => restore(after), true, 'Record Wave');
  }

  // Per-wave undo for a shape-LAYER stroke (#34): restore that layer's keys to the pre-stroke
  // snapshot. squash=true chains with the sculpt's geometry state so one undo removes both.
  _pushShapeLayerWaveUndo(meshId, snap) {
    const sm = window.app?.getStateManager?.();
    const layer = snap && snap.layer;
    if (!sm || !layer) return;
    const after = {
      times:  (layer.shapeTimes || []).slice(),
      shapes: (layer.shapes || []).slice(),
      outs:   layer.shapeOutputTimes ? layer.shapeOutputTimes.slice() : null,
    };
    const b = snap.before;
    const changed = b.times.length !== after.times.length
      || b.times.some((t, i) => t !== after.times[i])
      || b.shapes.some((s, i) => s !== after.shapes[i]);
    if (!changed) return;
    const restore = (s) => {
      layer.shapeTimes = (s.times || []).slice();
      layer.shapes = (s.shapes || []).slice();
      if (s.outs) layer.shapeOutputTimes = s.outs.slice();
      else if (layer.shapeOutputTimes) layer.shapeOutputTimes = (s.times || []).slice();
      const msh = window.app?.getMesh?.();
      if (msh && msh.getID() === meshId) this.update(msh, true);
      if (window.app?.render) window.app.render();
    };
    sm.pushStateCustom(() => restore(b), () => restore(after), true, 'Record Layer Wave');
  }

  stopRecording(isManualAbort = false) {
    if (this.countInTimer) {
      clearInterval(this.countInTimer);
      this.countInTimer = null;
    }

    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = null;

    const track = this.tracks.get(this.activeRecordingId);
    // #30: a shape take writes shapeTimes, a transform take writes times. Measure the
    // finalize (discard-tiny-take, duration lock, end-pad, undo) against whichever this
    // take actually recorded.
    const isShape = window._animKeyMode === 'shape';
    const seqTimes = isShape ? (track && track.shapeTimes) : (track && track.times);
    const count = seqTimes ? seqTimes.length : 0;

    if (!isManualAbort && count > 0 && seqTimes[count - 1] < 0.5) {
      return;
    }

    this.isRecording = false;
    this.isCountingIn = false;

    // If this is the very first finalized recording, lock its duration permanently as the Master Loop Boundary!
    if (track && count > 1 && (!window._animMasterDuration || window._animMasterDuration <= 0)) {
      window._animMasterDuration = seqTimes[count - 1];
    } else if (track && count > 1 && window._animMasterDuration && window._animMasterDuration > 0) {
      const lastTime = seqTimes[count - 1];
      if (lastTime < window._animMasterDuration - 0.05) {
        // Pad the rest of this track's timeline with the exact same final pose so it correctly spans the full master loop boundary!
        if (isShape) {
          track.shapeTimes.push(window._animMasterDuration);
          track.shapes.push(new Float32Array(track.shapes[count - 1]));
          if (track.shapeOutputTimes) track.shapeOutputTimes.push(window._animMasterDuration);
        } else {
          track.times.push(window._animMasterDuration);
          const pIdx = (track.times.length - 2) * 3;
          const qIdx = (track.times.length - 2) * 4;
          track.positions.push(track.positions[pIdx], track.positions[pIdx+1], track.positions[pIdx+2]);
          track.quaternions.push(track.quaternions[qIdx], track.quaternions[qIdx+1], track.quaternions[qIdx+2], track.quaternions[qIdx+3]);
          track.scales.push(track.scales[pIdx], track.scales[pIdx+1], track.scales[pIdx+2]);
        }
      }
    }

    if (track) {
      delete track.punchInTime;
    }

    // Push Undo state for recording! (Transform takes only — shape takes push a per-wave
    // undo on each trigger release via _pushShapeWaveUndo, so a take-level undo here would
    // double up and fight the per-wave steps.)
    if (!isManualAbort && !isShape && track && count > 0 && this._trackStateBeforeRecording) {
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
    
    window._animStatusText = window._animArmed ? 'Punch In Ready' : 'Disarmed';
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
        shapeTimes: [], shapes: [], shapeOutputTimes: [],
        playbackTime: 0,
        lastUpdate: performance.now()
      });
    }
    
    const track = this.tracks.get(id);
    if (!track.shapeTimes) {
      track.shapeTimes = [];
      track.shapes = [];
    }
    if (!track.shapeOutputTimes) {
      track.shapeOutputTimes = [];
    }
    
    if (isNaN(time)) {
      console.error("[Animation] Attempted to add shape key at NaN time!");
      return;
    }

    // Snapshot track state BEFORE insertion for undo.
    const _snapBefore = this._snapshotTrack(track);
    const _meshId = id;

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
      track.shapeOutputTimes.splice(idx, 0, time); // Default output time is input time
      track.shapes.splice(idx, 0, copy);

      // Shift tangent offsets up for keys after idx
      if (track.tangentOffsets) {
        const newOffsets = {};
        for (const k in track.tangentOffsets) {
          const parts = k.split('_');
          const kIdx = parseInt(parts[0], 10);
          if (!isNaN(kIdx)) {
            if (kIdx >= idx) {
              parts[0] = (kIdx + 1).toString();
              const newKey = parts.join('_');
              newOffsets[newKey] = track.tangentOffsets[k];
            } else {
              newOffsets[k] = track.tangentOffsets[k];
            }
          } else {
            newOffsets[k] = track.tangentOffsets[k];
          }
        }
        track.tangentOffsets = newOffsets;
      }
    }

    if (time > (window._animMasterDuration || 0)) {
      window._animMasterDuration = time;
    }

    // Always snap the active playback marker to the newly created keyframe so it previews instantly!
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;

    // Push atomic undo entry.
    const _snapAfter = this._snapshotTrack(track);
    if (window.app?.getStateManager?.()) {
      window.app.getStateManager().pushStateCustom(
        () => { // UNDO
          const tr = this.tracks.get(_meshId);
          if (!tr) return;
          const msh = window.app?.getMesh?.();
          this._restoreTrack(tr, _snapBefore, msh?.getID?.() === _meshId ? msh : null);
        },
        () => { // REDO
          const tr = this.tracks.get(_meshId);
          if (!tr) return;
          const msh = window.app?.getMesh?.();
          this._restoreTrack(tr, _snapAfter, msh?.getID?.() === _meshId ? msh : null);
        },
        false,
        'Add Shape Key'
      );
    }
  }

  // ---- Visibility track (step-held boolean per object) ----------------------
  // Drives which object is shown at a given time. Step function, BOTH ends
  // clamped (before the first key holds the first value, after the last holds
  // the last). No keys → returns null: the object isn't vis-animated, so the
  // caller leaves its manual/static visibility untouched.
  evaluateVisibility(track, t) {
    const times = track && track.visTimes;
    if (!times || times.length === 0) return null;
    if (t <= times[0]) return track.visValues[0] > 0.5;
    let idx = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] <= t + 1e-6) idx = i; else break;
    }
    return track.visValues[idx] > 0.5;
  }

  hasVisibilityKeys(mesh) {
    const tr = mesh && this.tracks.get(mesh.getID());
    return !!(tr && tr.visTimes && tr.visTimes.length);
  }

  // Insert/replace a visibility keyframe (value truthy = shown). Undoable via the
  // same snapshot/restore path as the other key types.
  setVisibilityKey(mesh, time, value) {
    if (!mesh || isNaN(time)) return;
    const id = mesh.getID();
    const _meshId = id;
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], shapeOutputTimes: [],
        visTimes: [], visValues: [],
        playbackTime: 0, lastUpdate: performance.now(),
      });
    }
    const track = this.tracks.get(id);
    if (!track.visTimes)  track.visTimes = [];
    if (!track.visValues) track.visValues = [];

    const v = value ? 1 : 0;
    const _snapBefore = this._snapshotTrack(track);

    let idx = 0;
    while (idx < track.visTimes.length && track.visTimes[idx] < time) idx++;
    if (idx < track.visTimes.length && Math.abs(track.visTimes[idx] - time) < 0.005) {
      track.visValues[idx] = v;
    } else {
      track.visTimes.splice(idx, 0, time);
      track.visValues.splice(idx, 0, v);
    }

    if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;

    const _snapAfter = this._snapshotTrack(track);
    if (window.app?.getStateManager?.()) {
      window.app.getStateManager().pushStateCustom(
        () => { const tr = this.tracks.get(_meshId); if (!tr) return; const msh = window.app?.getMesh?.(); this._restoreTrack(tr, _snapBefore, msh?.getID?.() === _meshId ? msh : null); },
        () => { const tr = this.tracks.get(_meshId); if (!tr) return; const msh = window.app?.getMesh?.(); this._restoreTrack(tr, _snapAfter,  msh?.getID?.() === _meshId ? msh : null); },
        false, 'Set Visibility Key'
      );
    }
    this.update(mesh, true);
    if (window.app?.render) window.app.render();
  }

  // Convenience: read the current keyed visibility of a mesh at the playhead, flip
  // it, and write a key there (used by a keyframable outliner eye).
  toggleVisibilityKeyAtPlayhead(mesh) {
    if (!mesh) return;
    const t = window._animCurrentTime || 0;
    const track = this.tracks.get(mesh.getID());
    const cur = this.evaluateVisibility(track, t);
    // First key records the object's CURRENT visibility (so it doesn't vanish on the
    // first click); later clicks flip whatever is keyed at the playhead.
    const next = (cur === null) ? (mesh.isVisible?.() ?? true) : !cur;
    this.setVisibilityKey(mesh, t, next);
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
          window._animStatusText = `Copied key at ${time.toFixed(2)}s`;
          break;
        }
      }
    }
    
    // Otherwise, capture the live calculated interpolation state at this exact timestamp:
    if (!foundExact) {
      const v = mesh.getVertices();
      if (v) {
        this.clipboardShape = new Float32Array(v);
        window._animStatusText = `Snapshotted mesh at ${time.toFixed(2)}s`;
      }
    }
  }

  pasteShapeKey(mesh, time) {
    if (!mesh || !this.clipboardShape) return;
    const id = mesh.getID();
    
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], shapeOutputTimes: [],
        playbackTime: 0, lastUpdate: performance.now()
      });
    }
    
    if (isNaN(time)) {
      console.error("[Animation] Attempted to paste shape key at NaN time!");
      return;
    }
    const track = this.tracks.get(id);
    if (!track.shapeTimes) {
      track.shapeTimes = [];
      track.shapes = [];
    }
    if (!track.shapeOutputTimes) {
      track.shapeOutputTimes = [];
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
      track.shapeOutputTimes.splice(idx, 0, time);
      track.shapes.splice(idx, 0, copy);
      
      // Shift tangent offsets up for keys after idx
      if (track.tangentOffsets) {
        const newOffsets = {};
        for (const k in track.tangentOffsets) {
          const parts = k.split('_');
          const kIdx = parseInt(parts[0], 10);
          if (!isNaN(kIdx)) {
            if (kIdx >= idx) {
              parts[0] = (kIdx + 1).toString();
              const newKey = parts.join('_');
              newOffsets[newKey] = track.tangentOffsets[k];
            } else {
              newOffsets[k] = track.tangentOffsets[k];
            }
          } else {
            newOffsets[k] = track.tangentOffsets[k];
          }
        }
        track.tangentOffsets = newOffsets;
      }
    }
    
    if (time > (window._animMasterDuration || 0)) {
      window._animMasterDuration = time;
    }
    
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;
    
    // Trigger immediate refresh so the user sees the newly pasted state!
    this.update(mesh, true);
    
    window._animStatusText = `Pasted key at ${time.toFixed(2)}s`;
  }

  deleteShapeKey(mesh, time) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.shapeTimes) return;
    
    for (let i = track.shapeTimes.length - 1; i >= 0; i--) {
      if (Math.abs(track.shapeTimes[i] - time) < 0.05) {
        const singleKey = [{ meshId: mesh.getID(), type: 'shape', index: i }];
        this.deleteSelectedKeys(singleKey);
        window._animStatusText = `Deleted Shape key at ${time.toFixed(2)}s`;
        
        if (mesh.updateGeometry) mesh.updateGeometry();
        if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
        if (window.app && window.app.render) window.app.render();
        break;
      }
    }
  }

  createBlendshape(mesh, name) {
    if (!mesh || !name) return;
    const id = mesh.getID();
    
    if (!this.tracks.has(id)) {
      this.tracks.set(id, {
        times: [], positions: [], quaternions: [], scales: [],
        shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
      });
    }
    
    const track = this.tracks.get(id);
    if (!track.blendshapes) track.blendshapes = new Map();
    if (!track.blendshapeTracks) track.blendshapeTracks = new Map();
    
    const v = mesh.getVertices();

    if (!track.baseShape) {
      // First blendshape ever — snapshot the current mesh as the base.
      // Temporarily clear any active edit so baseShape captures the true base.
      const wasEditing = track.editingBlendshape;
      if (wasEditing) {
        track.editingBlendshape = null;
        this.applyBlendshapes(mesh);
        track.editingBlendshape = wasEditing;
      }
      track.baseShape = new Float32Array(mesh.getVertices());
      // Protect the cage by default once blendshapes exist — accidental base
      // sculpting is otherwise easy and corrupts every layer's reference.
      if (track.baseLocked === undefined) track.baseLocked = true;
    }

    // New layers always start with a zero delta — they are empty relative to
    // the base cage. The user sculpts into them after creation.
    const delta = new Float32Array(track.baseShape.length);

    track.blendshapes.set(name, delta);
    track.blendshapeTracks.set(name, { times: [], values: [] });
    
    console.log(`[Animation] Created Blendshape ${name} for mesh ${id}`);

    // Undo/Redo support
    if (window.app && window.app.getStateManager()) {
      const tr = track;
      const meshId = id;
      const d = delta;
      
      window.app.getStateManager().pushStateCustom(
        () => { // UNDO
          tr.blendshapes.delete(name);
          tr.blendshapeTracks.delete(name);
          this.applyBlendshapes(mesh);
          window._animPanel?.refreshBlendshapes(mesh, window.app);
        },
        () => { // REDO
          tr.blendshapes.set(name, d);
          tr.blendshapeTracks.set(name, { times: [], values: [] });
          this.applyBlendshapes(mesh);
          window._animPanel?.refreshBlendshapes(mesh, window.app);
        },
        false,
        "Create Blendshape"
      );
    }
  }

  _refreshBlendPanels(mesh) {
    window._animPanel?.refreshBlendshapes?.(mesh, window.app);
    window._blendshapeStackPanel?._afterStructureChange?.();
    window._blendshapeStackPanelVR?._afterStructureChange?.();
  }

  // Split a sculpted SYMMETRIC blendshape (e.g. eyeBlink) into its two ARKit halves
  // (eyeBlinkLeft + eyeBlinkRight) by blending the delta across the symmetry plane
  // (local x = 0). left+right at weight 1 reproduce the original. The symmetric source
  // layer is replaced by the pair. Convention: x < 0 → Left (call again / flip if the
  // mesh faces the other way and L/R come out swapped).
  splitBlendshapeLR(mesh, name) {
    if (!mesh || !name) return false;
    const entry = arkitEntry(name);
    const targets = arkitSplitTargets(name);
    if (!entry || entry.category !== 'symmetric' || !targets || targets.length !== 2) return false;
    const [leftName, rightName] = targets;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes || !track.blendshapes.has(name) || !track.baseShape) return false;

    const base = track.baseShape;
    const delta = track.blendshapes.get(name);
    const n = delta.length;

    // Smooth falloff band on EACH side of the midline so the two halves feather into
    // each other instead of seaming at x = 0. Width = bleedFrac of the mesh x-extent;
    // live-tunable via window._bsSplitBleed (default 0.06 ≈ 6% each side).
    let xMin = Infinity, xMax = -Infinity;
    for (let i = 0; i < n; i += 3) { const x = base[i]; if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    const bleedFrac = (typeof window !== 'undefined' && window._bsSplitBleed != null) ? window._bsSplitBleed : 0.06;
    const band = Math.max((xMax - xMin) * bleedFrac, 1e-4);
    const leftWeight = (x) => {
      if (x <= -band) return 1;
      if (x >= band) return 0;
      const t = (band - x) / (2 * band); // 1 at -band, 0 at +band
      return t * t * (3 - 2 * t);
    };

    const leftDelta = new Float32Array(n), rightDelta = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      const lw = leftWeight(base[i]), rw = 1 - lw;
      leftDelta[i] = delta[i] * lw;       rightDelta[i] = delta[i] * rw;
      leftDelta[i + 1] = delta[i + 1] * lw; rightDelta[i + 1] = delta[i + 1] * rw;
      leftDelta[i + 2] = delta[i + 2] * lw; rightDelta[i + 2] = delta[i + 2] * rw;
    }

    // Snapshot for undo: the source layer + anything already occupying the target names.
    const prevSource = delta;
    const prevLeft = track.blendshapes.get(leftName) || null;
    const prevRight = track.blendshapes.get(rightName) || null;
    const wasEditing = track.editingBlendshape;

    const removeLayer = (nm) => {
      track.blendshapes.delete(nm);
      track.blendshapeTracks?.delete(nm);
      track.blendshapeMuted?.delete(nm);
      track.blendshapeLocked?.delete(nm);
      if (track.blendshapeSolo === nm) track.blendshapeSolo = null;
      if (track.editingBlendshape === nm) track.editingBlendshape = null;
    };
    const addLayer = (nm, d) => {
      track.blendshapes.set(nm, d);
      if (!track.blendshapeTracks) track.blendshapeTracks = new Map();
      if (!track.blendshapeTracks.has(nm)) track.blendshapeTracks.set(nm, { times: [], values: [] });
    };

    const apply = () => {
      removeLayer(name);
      addLayer(leftName, leftDelta);
      addLayer(rightName, rightDelta);
      this.applyBlendshapes(mesh);
      this._refreshBlendPanels(mesh);
    };
    const revert = () => {
      removeLayer(leftName); removeLayer(rightName);
      if (prevLeft) addLayer(leftName, prevLeft);
      if (prevRight) addLayer(rightName, prevRight);
      addLayer(name, prevSource);
      track.editingBlendshape = wasEditing;
      this.applyBlendshapes(mesh);
      this._refreshBlendPanels(mesh);
    };

    apply();
    if (window.app && window.app.getStateManager()) {
      window.app.getStateManager().pushStateCustom(revert, apply, false, 'Split Blendshape L/R');
    }
    return true;
  }

  // Inverse of splitBlendshapeLR: recombine an ARKit L/R pair (eyeBlinkLeft +
  // eyeBlinkRight) back into the single symmetric shape (eyeBlink) so it can be sculpted
  // in symmetry again. Combined delta = leftDelta + rightDelta (reconstructs the original
  // when unedited; sums whatever's there otherwise). `name` is either half. One undo step.
  combineBlendshapeLR(mesh, name) {
    if (!mesh || !name) return false;
    const info = arkitUnifiedFor(name);
    if (!info) return false;
    const { unified, left, right } = info;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) return false;

    const dL = track.blendshapes.get(left) || null;
    const dR = track.blendshapes.get(right) || null;
    if (!dL && !dR) return false;

    const len = (dL || dR).length;
    const combined = new Float32Array(len);
    if (dL) for (let i = 0; i < len; i++) combined[i] += dL[i];
    if (dR) for (let i = 0; i < len; i++) combined[i] += dR[i];

    const prevL = dL, prevR = dR;
    const prevUnified = track.blendshapes.get(unified) || null;
    const wasEditing = track.editingBlendshape;

    const removeLayer = (nm) => {
      track.blendshapes.delete(nm);
      track.blendshapeTracks?.delete(nm);
      track.blendshapeMuted?.delete(nm);
      track.blendshapeLocked?.delete(nm);
      if (track.blendshapeSolo === nm) track.blendshapeSolo = null;
      if (track.editingBlendshape === nm) track.editingBlendshape = null;
    };
    const addLayer = (nm, d) => {
      track.blendshapes.set(nm, d);
      if (!track.blendshapeTracks) track.blendshapeTracks = new Map();
      if (!track.blendshapeTracks.has(nm)) track.blendshapeTracks.set(nm, { times: [], values: [] });
    };

    const apply = () => {
      removeLayer(left); removeLayer(right);
      addLayer(unified, combined);
      this.applyBlendshapes(mesh);
      this._refreshBlendPanels(mesh);
    };
    const revert = () => {
      removeLayer(unified);
      if (prevUnified) addLayer(unified, prevUnified);
      if (prevL) addLayer(left, prevL);
      if (prevR) addLayer(right, prevR);
      track.editingBlendshape = wasEditing;
      this.applyBlendshapes(mesh);
      this._refreshBlendPanels(mesh);
    };

    apply();
    if (window.app && window.app.getStateManager()) {
      window.app.getStateManager().pushStateCustom(revert, apply, false, 'Combine Blendshape L/R');
    }
    return true;
  }

  setBlendshapeWeight(mesh, name, value) {
    if (!mesh || !name) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes || !track.blendshapes.has(name)) return;

    // Quantize to the current FPS grid so keyframes always land on whole-frame
    // boundaries regardless of where the playhead happened to stop.
    const fps  = window._animFPS || 24;
    const time = Math.round((track.playbackTime || 0) * fps) / fps;
    const bTrack = track.blendshapeTracks.get(name);

    // Binary search for insertion point — O(log n) vs O(n) linear scan.
    // Matters when tracks have many keys (e.g. recorded at 60 fps).
    let lo = 0, hi = bTrack.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (bTrack.times[mid] < time) lo = mid + 1; else hi = mid;
    }
    let idx = lo;
    
    if (idx < bTrack.times.length && Math.abs(bTrack.times[idx] - time) < 0.005) {
      bTrack.values[idx] = value;
    } else {
      bTrack.times.splice(idx, 0, time);
      bTrack.values.splice(idx, 0, value);
    }
    
    this.applyBlendshapes(mesh);
  }

  applyBlendshapes(mesh, baseVerts) {
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) return;

    const v = mesh.getVertices();
    if (baseVerts) {
      v.set(baseVerts);
    } else if (track.baseShape) {
      v.set(track.baseShape);
    }

    // Always show the true weighted composition so every weight slider is live,
    // regardless of which layer is active for editing. (We used to isolate the
    // active layer at 1.0 and zero the rest, which made the sliders look dead
    // while a layer was selected.) A muted layer contributes 0. Correct delta
    // capture while editing a non-isolated view is handled by otherLayersOffset()
    // in Mesh.updateGeometry, which subtracts these other-layer contributions.
    const muted = track.blendshapeMuted;
    track.blendshapes.forEach((delta, name) => {
      const bTrack = track.blendshapeTracks.get(name);
      if (!bTrack || bTrack.times.length === 0) return;
      if (muted && muted.has(name)) return;

      const weight = this.evaluateScalarTrack(bTrack, track.playbackTime);
      if (weight !== 0) {
        for (let i = 0; i < v.length; i++) {
          v[i] += delta[i] * weight;
        }
      }
    });

    // Guard: prevent the updateGeometry intercept from treating this recomposition
    // as a sculpt stroke and incorrectly rebasing baseShape or layer deltas.
    track._applyingBS = true;
    if (mesh.updateGeometry) mesh.updateGeometry();
    if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
    track._applyingBS = false;
  }

  // Per-layer LOCK (Photoshop-style): a locked layer (or the Base cage) can't be
  // sculpted into — the SculptManager gate blocks it. The Base is locked by default
  // (set when baseShape is first snapshotted) so it's hard to wreck the cage by
  // accident. name === null / 'Base' targets the base lock. Non-destructive.
  isBlendshapeLocked(mesh, name) {
    const track = this.tracks.get(mesh.getID());
    if (!track) return false;
    if (!name || name === 'Base') return !!track.baseLocked;
    return !!track.blendshapeLocked?.has(name);
  }

  toggleBlendshapeLock(mesh, name) {
    const track = this.tracks.get(mesh.getID());
    if (!track) return;
    if (!name || name === 'Base') { track.baseLocked = !track.baseLocked; return; }
    if (!track.blendshapeLocked) track.blendshapeLocked = new Set();
    if (track.blendshapeLocked.has(name)) track.blendshapeLocked.delete(name);
    else track.blendshapeLocked.add(name);
  }

  // Per-layer visibility: a muted layer keeps its stored weight but contributes 0
  // to the composition (applyBlendshapes / otherLayersOffset skip it) and cannot be
  // sculpted into (SculptManager gate). Toggleable, non-destructive.
  isBlendshapeMuted(mesh, name) {
    return !!this.tracks.get(mesh.getID())?.blendshapeMuted?.has(name);
  }

  toggleBlendshapeMute(mesh, name) {
    if (!mesh || !name) return;
    const track = this.tracks.get(mesh.getID());
    if (!track) return;
    if (!track.blendshapeMuted) track.blendshapeMuted = new Set();
    if (track.blendshapeMuted.has(name)) track.blendshapeMuted.delete(name);
    else track.blendshapeMuted.add(name);
    // A manual mute change breaks the solo invariant; drop the solo marker but keep
    // the new visibility as-is (don't restore the snapshot).
    track.blendshapeSolo = null;
    track._mutedBeforeSolo = null;
    this.applyBlendshapes(mesh);
  }

  isBlendshapeSoloed(mesh, name) {
    return this.tracks.get(mesh.getID())?.blendshapeSolo === name;
  }

  // Solo: isolate one layer (it visible, all others muted). Toggling the same
  // layer again restores the exact visibility state from before the solo. Soloing
  // a different layer while one is already soloed just switches the target and
  // keeps the original pre-solo snapshot for the eventual restore.
  toggleBlendshapeSolo(mesh, name) {
    if (!mesh || !name) return;
    const track = this.tracks.get(mesh.getID());
    if (!track?.blendshapes) return;
    if (!track.blendshapeMuted) track.blendshapeMuted = new Set();

    if (track.blendshapeSolo === name) {
      // Un-solo → restore the snapshot taken when solo began.
      track.blendshapeMuted = track._mutedBeforeSolo ? new Set(track._mutedBeforeSolo) : new Set();
      track.blendshapeSolo = null;
      track._mutedBeforeSolo = null;
    } else {
      if (track.blendshapeSolo === null) {
        track._mutedBeforeSolo = new Set(track.blendshapeMuted); // snapshot once
      }
      track.blendshapeSolo = name;
      track.blendshapeMuted = new Set([...track.blendshapes.keys()].filter((n) => n !== name));
    }
    this.applyBlendshapes(mesh);
  }

  // Sum of every layer's contribution EXCEPT `activeName` (and except muted ones),
  // at their current evaluated weights. Used by Mesh.updateGeometry to recover the
  // active layer's pure delta when the live view is the full weighted composition
  // (verts = base + activeDelta*1 + others). Returns null when nothing else
  // contributes (the common one-layer-at-a-time case → zero overhead, plain
  // verts - base capture).
  otherLayersOffset(track, activeName) {
    if (!track?.blendshapes) return null;
    const muted = track.blendshapeMuted;
    let out = null;
    track.blendshapes.forEach((delta, name) => {
      if (name === activeName) return;
      if (muted && muted.has(name)) return;
      const bTrack = track.blendshapeTracks.get(name);
      if (!bTrack || bTrack.times.length === 0) return;
      const weight = this.evaluateScalarTrack(bTrack, track.playbackTime);
      if (weight === 0) return;
      if (!out) out = new Float32Array(delta.length);
      for (let i = 0; i < out.length; i++) out[i] += delta[i] * weight;
    });
    return out;
  }

  getBsSlope(bTrack, i) {
    const n = bTrack.times.length;
    if (n < 2) return 0;
    if (i === 0) return (bTrack.values[1] - bTrack.values[0]) / (bTrack.times[1] - bTrack.times[0]);
    if (i === n - 1) return (bTrack.values[n - 1] - bTrack.values[n - 2]) / (bTrack.times[n - 1] - bTrack.times[n - 2]);
    const dt = bTrack.times[i + 1] - bTrack.times[i - 1];
    return dt !== 0 ? (bTrack.values[i + 1] - bTrack.values[i - 1]) / dt : 0;
  }

  evaluateScalarTrack(bTrack, time) {
    if (bTrack.times.length === 0) return 0;
    if (bTrack.times.length === 1) return bTrack.values[0];
    // Constant extrapolation outside key range
    if (time <= bTrack.times[0]) return bTrack.values[0];

    // Binary search for the segment containing `time` — O(log n).
    let lo = 0, hi = bTrack.times.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (bTrack.times[mid] <= time) lo = mid; else hi = mid;
    }
    let idx = lo;

    if (idx === bTrack.times.length - 1) return bTrack.values[idx];

    const t1 = bTrack.times[idx];
    const t2 = bTrack.times[idx + 1];
    const v1 = bTrack.values[idx];
    const v2 = bTrack.values[idx + 1];
    const dt = t2 - t1;
    const alpha = (time - t1) / dt;

    const to = bTrack.tangentOffsets;
    const rightDt = to?.[`${idx}_right_dt`];
    const rightDv = to?.[`${idx}_right_dv`];
    const leftDt  = to?.[`${idx + 1}_left_dt`];
    const leftDv  = to?.[`${idx + 1}_left_dv`];

    const slope0 = this.getBsSlope(bTrack, idx);
    const slope1 = this.getBsSlope(bTrack, idx + 1);
    const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
    const dt1 = leftDt  !== undefined ? leftDt  : -dt * 0.33;
    const dv0 = rightDv !== undefined ? rightDv : slope0 * dt0;
    const dv1 = leftDv  !== undefined ? leftDv  : slope1 * dt1;

    const p1x = dt0 / dt;
    const p2x = 1 + dt1 / dt;
    const t = this.getBezierT(alpha, p1x, p2x);
    const omt = 1 - t;
    return omt*omt*omt*v1 + 3*omt*omt*t*(v1+dv0) + 3*omt*t*t*(v2+dv1) + t*t*t*v2;
  }

  deleteBlendshape(mesh, name) {
    if (!mesh || !name) return;
    const track = this.tracks.get(mesh.getID());
    if (!track) return;
    
    const delta = track.blendshapes ? track.blendshapes.get(name) : null;
    const bTrack = track.blendshapeTracks ? track.blendshapeTracks.get(name) : null;
    
    if (window.app && window.app.getStateManager()) {
      const tr = track;
      
      window.app.getStateManager().pushStateCustom(
        () => { // UNDO
          if (delta) tr.blendshapes.set(name, delta);
          if (bTrack) tr.blendshapeTracks.set(name, bTrack);
          this.applyBlendshapes(mesh);
          window._animPanel?.refreshBlendshapes(mesh, window.app);
        },
        () => { // REDO
          tr.blendshapes.delete(name);
          tr.blendshapeTracks.delete(name);
          this.applyBlendshapes(mesh);
          window._animPanel?.refreshBlendshapes(mesh, window.app);
        },
        false,
        "Delete Blendshape"
      );
    }
    
    if (track.blendshapes) track.blendshapes.delete(name);
    if (track.blendshapeTracks) track.blendshapeTracks.delete(name);

    this.applyBlendshapes(mesh);
  }

  // Re-order the blendshape layers. `displayNames` is the desired top-to-bottom
  // (newest-first) order shown in the stack panel / timeline. We rebuild the
  // backing Maps in place so every consumer that reads `[...keys].reverse()`
  // (panel _layerNames, TimelineHelper.bsNames/bsEntries) picks it up, and
  // save/load preserves it for free (Export/Import iterate Map order). Maps are
  // oldest-first, so the stored order is the reverse of the display order.
  setBlendshapeOrder(mesh, displayNames) {
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) return;
    const desired = [...displayNames].reverse();
    const reorder = (map) => {
      if (!map) return;
      const ordered = [];
      for (const n of desired) if (map.has(n)) ordered.push(n);
      // Any names not in displayNames (defensive) keep their relative position up top.
      for (const n of map.keys()) if (!ordered.includes(n)) ordered.unshift(n);
      const saved = ordered.map(n => [n, map.get(n)]);
      map.clear();
      for (const [n, v] of saved) map.set(n, v);
    };
    reorder(track.blendshapes);
    reorder(track.blendshapeTracks);
  }

  renameBlendshape(mesh, oldName, newName) {
    if (!mesh || !oldName || !newName || oldName === newName) return;
    const track = this.tracks.get(mesh.getID());
    if (!track?.blendshapes?.has(oldName)) return;
    if (track.blendshapes.has(newName)) return;

    // Rebuild both maps preserving insertion order.
    const newBS = new Map();
    track.blendshapes.forEach((d, n) => newBS.set(n === oldName ? newName : n, d));
    track.blendshapes = newBS;

    if (track.blendshapeTracks) {
      const newBT = new Map();
      track.blendshapeTracks.forEach((bt, n) => newBT.set(n === oldName ? newName : n, bt));
      track.blendshapeTracks = newBT;
    }

    if (track.editingBlendshape === oldName) track.editingBlendshape = newName;
  }


  enterBlendshapeEditMode(mesh, name) {
    if (!mesh || !name) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.blendshapes || !track.blendshapes.has(name)) return;
    track.editingBlendshape = name;
    // Snapshot the delta at session start so exit can build a correct undo pair.
    // The live delta is maintained by Mesh.updateGeometry() on every stroke, so
    // we must NOT recompute from verts on exit (weight may be ≠1 at that point).
    const currentDelta = track.blendshapes.get(name);
    track.editingBlendshapeOriginalDelta = currentDelta ? new Float32Array(currentDelta) : null;
    // Show current weighted composition — slider is free to move at any value.
    this.applyBlendshapes(mesh);
  }

  exitBlendshapeEditMode(mesh) {
    if (!mesh) return;
    const track = this.tracks.get(mesh.getID());
    if (!track || !track.editingBlendshape) return;

    const name     = track.editingBlendshape;
    // The delta has been kept live by the updateGeometry intercept — use it directly.
    const newDelta = track.blendshapes.get(name);
    const oldDelta = track.editingBlendshapeOriginalDelta;

    if (window.app && window.app.getStateManager()) {
      const tr = track;
      const savedNew = newDelta ? new Float32Array(newDelta) : null;
      const savedOld = oldDelta ? new Float32Array(oldDelta) : null;
      window.app.getStateManager().pushStateCustom(
        () => { if (savedOld) tr.blendshapes.set(name, savedOld); this.applyBlendshapes(mesh); },
        () => { if (savedNew) tr.blendshapes.set(name, savedNew); this.applyBlendshapes(mesh); },
        false,
        'Edit Blendshape Geometry'
      );
    }

    track.editingBlendshape = null;
    track.editingBlendshapeOriginalDelta = null;
    this.applyBlendshapes(mesh);
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

    // Snapshot track state BEFORE insertion for undo.
    const _snapBeforeTK = this._snapshotTrack(track);
    const _meshIdTK = id;

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

      // Shift tangent offsets up for keys after idx
      if (track.tangentOffsets) {
        const newOffsets = {};
        for (const k in track.tangentOffsets) {
          const parts = k.split('_');
          if (parts[0] === 'trans') {
            const kIdx = parseInt(parts[1], 10);
            if (kIdx >= idx) {
              parts[1] = (kIdx + 1).toString();
              const newKey = parts.join('_');
              newOffsets[newKey] = track.tangentOffsets[k];
            } else {
              newOffsets[k] = track.tangentOffsets[k];
            }
          } else {
            newOffsets[k] = track.tangentOffsets[k];
          }
        }
        track.tangentOffsets = newOffsets;
      }
    }
    if (time > (window._animMasterDuration || 0)) window._animMasterDuration = time;
    window._animCurrentTime = time;
    this.globalPlaybackTime = time;

    // Push atomic undo entry.
    const _snapAfterTK = this._snapshotTrack(track);
    if (window.app?.getStateManager?.()) {
      window.app.getStateManager().pushStateCustom(
        () => { // UNDO
          const tr = this.tracks.get(_meshIdTK);
          if (!tr) return;
          const msh = window.app?.getMesh?.();
          this._restoreTrack(tr, _snapBeforeTK, msh?.getID?.() === _meshIdTK ? msh : null);
        },
        () => { // REDO
          const tr = this.tracks.get(_meshIdTK);
          if (!tr) return;
          const msh = window.app?.getMesh?.();
          this._restoreTrack(tr, _snapAfterTK, msh?.getID?.() === _meshIdTK ? msh : null);
        },
        false,
        'Add Transform Key'
      );
    }
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
          window._animStatusText = `Copied Transform key`;
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
      
      // Shift tangent offsets up for keys after idx
      if (track.tangentOffsets) {
        const newOffsets = {};
        for (const k in track.tangentOffsets) {
          const parts = k.split('_');
          if (parts[0] === 'trans') {
            const kIdx = parseInt(parts[1], 10);
            if (kIdx >= idx) {
              parts[1] = (kIdx + 1).toString();
              const newKey = parts.join('_');
              newOffsets[newKey] = track.tangentOffsets[k];
            } else {
              newOffsets[k] = track.tangentOffsets[k];
            }
          } else {
            newOffsets[k] = track.tangentOffsets[k];
          }
        }
        track.tangentOffsets = newOffsets;
      }
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
        window._animStatusText = `Deleted Transform key`;
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
          outputTime: track.shapeOutputTimes ? track.shapeOutputTimes[idx] : track.shapeTimes[idx],
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
          if (track.shapeOutputTimes) track.shapeOutputTimes.splice(idx, 1);
          track.shapes.splice(idx, 1);
        }
      });

      // Update tangent offsets after all deletions for this track
      if (track.tangentOffsets) {
        const newOffsets = {};
        for (const k in track.tangentOffsets) {
          const parts = k.split('_');
          let kIdx = NaN;
          let isTransform = false;
          
          if (parts[0] === 'trans') {
            kIdx = parseInt(parts[1], 10);
            isTransform = true;
          } else {
            kIdx = parseInt(parts[0], 10);
          }
          
          if (!isNaN(kIdx)) {
            if (indices.includes(kIdx)) {
              continue; // Delete
            }
            // Count how many deleted indices are less than kIdx
            const shift = indices.filter(idx => idx < kIdx).length;
            const newIdx = kIdx - shift;
            
            if (isTransform) {
              parts[1] = newIdx.toString();
            } else {
              parts[0] = newIdx.toString();
            }
            const newKey = parts.join('_');
            newOffsets[newKey] = track.tangentOffsets[k];
          } else {
            newOffsets[k] = track.tangentOffsets[k];
          }
        }
        track.tangentOffsets = newOffsets;
      }
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
              if (tr.shapeOutputTimes) tr.shapeOutputTimes.push(cmd.outputTime);
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
                if (tr.shapeOutputTimes) tr.shapeOutputTimes.splice(idx, 1);
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
      } else if (key.type === 'blendshape' && key.name && track.blendshapeTracks) {
        const bTrack = track.blendshapeTracks.get(key.name);
        if (bTrack && bTrack.times[key.index] !== undefined) {
          bTrack.times[key.index] = Math.max(0, Math.min(masterDuration, key.time + dt));
          // Keep times sorted
          const idx = key.index;
          while (idx > 0 && bTrack.times[idx] < bTrack.times[idx - 1]) {
            [bTrack.times[idx], bTrack.times[idx-1]] = [bTrack.times[idx-1], bTrack.times[idx]];
            [bTrack.values[idx], bTrack.values[idx-1]] = [bTrack.values[idx-1], bTrack.values[idx]];
          }
        }
      }
    });
  }

  moveSelectedKeysValue(selectedKeys, dVal) {
    selectedKeys.forEach(key => {
      const track = this.tracks.get(key.meshId);
      if (!track) return;
      
      if (key.type === 'transform' && track.positions && key.index !== undefined && key.channel !== undefined) {
        track.positions[key.index * 3 + key.channel] = (key.startVal !== undefined ? key.startVal : 0) + dVal;
      } else if (key.type === 'shape' && track.shapeOutputTimes && key.index !== undefined) {
        track.shapeOutputTimes[key.index] = (key.startVal !== undefined ? key.startVal : 0) + dVal;
      } else if (key.type === 'blendshape' && key.name && track.blendshapeTracks) {
        const bTrack = track.blendshapeTracks.get(key.name);
        // No 0..1 clamp — overshoot (below 0 / above 1) is intentionally allowed.
        if (bTrack && key.index !== undefined) {
          bTrack.values[key.index] = (key.startVal !== undefined ? key.startVal : 0) + dVal;
        }
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

  getCurveSlope(track, keyIdx, channel) {
    if (!track.times || track.times.length < 2) return 0;
    const i = keyIdx;
    const c = channel;
    if (i === 0) {
      return (track.positions[3 + c] - track.positions[c]) / (track.times[1] - track.times[0]);
    }
    if (i === track.times.length - 1) {
      const pIdx = (i - 1) * 3;
      const cIdx = i * 3;
      return (track.positions[cIdx + c] - track.positions[pIdx + c]) / (track.times[i] - track.times[i - 1]);
    }
    const pIdx = (i - 1) * 3;
    const nIdx = (i + 1) * 3;
    const dt = track.times[i + 1] - track.times[i - 1];
    if (dt === 0) return 0;
    return (track.positions[nIdx + c] - track.positions[pIdx + c]) / dt;
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

    // Recording mesh: normally fully suppressed so the live performance isn't stomped by
    // playback. EXCEPT a shape (vertex) take — there the loop must keep playing so you
    // can see prior waves and puppeteer new ones on top; we only suppress the ShotSculpt
    // vertex-write WHILE a stroke is actively deforming this mesh (below).
    let liveShapeStroke = false;
    if (this.isRecording && mesh.getID() === this.activeRecordingId) {
      if (window._animKeyMode !== 'shape') return;
      const app = window.app;
      liveShapeStroke = !!(app && (app._vrSculpting || app._action === Enums.Action.SCULPT_EDIT));
      // Stroke ended → drop the per-stroke rebase baseline + capture latches so the next
      // stroke re-begins cleanly (topology re-latched, first grid cell writes).
      if (!liveShapeStroke) {
        // Falling edge: a wave just finished. Push a per-wave undo (using the pre-stroke
        // snapshot as the "before") so releasing the trigger + undo removes exactly that
        // last recorded motion — squashed so it also reverts the sculpt's geometry state.
        if (this._shapeWasStroking && this._shapeStrokeSnap) {
          this._pushShapeWaveUndo(mesh.getID(), this._shapeStrokeSnap);
        }
        // Same, for a LAYER stroke (restores that layer's keys, squashed with the sculpt).
        if (this._shapeWasStroking && this._shapeLayerStrokeSnap) {
          this._pushShapeLayerWaveUndo(mesh.getID(), this._shapeLayerStrokeSnap);
        }
        this._shapeStrokeSnap = null; this._dynBase = null; this._shapeLayerStrokeSnap = null;
        this._lastGridFrame = -1; this._shapeCaptureLen = -1;
      }
      this._shapeWasStroking = liveShapeStroke;
    }

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

        const lStart = window._animLoopStart ?? 0.0;
        const lEnd   = window._animLoopEnd ?? window._animMasterDuration ?? 0;
        if (lEnd > lStart) {
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

    // Visibility track: drive the object's shown/hidden state from its keyed
    // timeline. Step-held, both ends clamped. Null = not vis-animated → leave the
    // object's manual/static visibility alone. This is what makes a frame group's
    // "only one child visible at a time" fall out of a general per-object primitive.
    {
      const vis = this.evaluateVisibility(track, track.playbackTime);
      if (vis !== null && mesh.setVisible) {
        mesh.setVisible(vis);
        // setVisible only flips an internal flag — the Three renderer still draws the
        // threeMesh unless we also toggle its .visible (same as the manual eye toggle).
        const tm = mesh.getThreeMesh && mesh.getThreeMesh();
        if (tm) tm.visible = vis;
      }
    }

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
        if (track.times.length > 1) {
          const rightDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dt`] : undefined;
          const rightDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx}_right_dv_${c}`] : undefined;
          const leftDt = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dt`] : undefined;
          const leftDv = track.tangentOffsets ? track.tangentOffsets[`trans_${frameIdx + 1}_left_dv_${c}`] : undefined;
          const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
          const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
          
          const slope0 = this.getCurveSlope(track, frameIdx, c);
          const slope1 = this.getCurveSlope(track, frameIdx + 1, c);
          
          const dv0 = rightDv !== undefined ? rightDv : slope0 * dt0;
          const dv1 = leftDv !== undefined ? leftDv : slope1 * dt1;

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

    let baseForBlendshapes = null;
    const verts = mesh.getVertices();

    // #30 unified shape recording (rebase + capture share this one render-loop pass):
    //  - REBASE keeps the PRIOR waves playing under the live stroke (no freeze) by re-laying
    //    the brush's contribution on top of their composite at the playhead.
    //  - CAPTURE writes the resulting pose to a fixed FRAME GRID so keys land on the same
    //    frames every loop (no rolling drift) and re-passing a slot overwrites it cleanly.
    // Both use `track.playbackTime` as the single clock. Guarded: a fault here must never
    // propagate and kill rendering — fall back to leaving the live sculpt untouched.
    if (liveShapeStroke) {
      try {
        if (!track.shapeTimes || !track.shapes) { track.shapeTimes = track.shapeTimes || []; track.shapes = track.shapes || []; }
        const nb = (mesh.getNbVertices ? mesh.getNbVertices() : verts.length / 3) * 3;

        // Topology must stay constant across a stroke (equal-length ShotSculpt lerp).
        if (this._shapeCaptureLen === undefined || this._shapeCaptureLen < 0) {
          this._shapeCaptureLen = nb; this._shapeCaptureWarned = false;
        }
        const topoOK = (nb === this._shapeCaptureLen && verts.length >= nb);
        if (!topoOK) {
          if (!this._shapeCaptureWarned) {
            this._shapeCaptureWarned = true;
            window.screenLog?.('Vertex recording needs a fixed topology — turn dyntopo off', 'orange');
          }
          return;
        }

        const fps = window._animFPS || 24;
        const rate = window._animCaptureRate !== undefined ? window._animCaptureRate : 0.1;
        const frameStep = Math.max(1, Math.round(rate * fps));
        const gridFrame = Math.round((track.playbackTime * fps) / frameStep) * frameStep;
        const activeLayer = this._activeShapeLayer(track);

        if (activeLayer) {
          // ── Recording into a LAYER (#34), "pose that rides" ───────────────────────────
          // The base FREEZES for the duration of the stroke (it resumes on release): freeze
          // the composite at stroke start and capture just the brush's DELTA vs that frozen
          // pose. On playback the delta is added back on top of the LIVE base → it rides it,
          // seamlessly (the grabbed verts and their neighbours all sat on the same frozen
          // base, so there's no tear). The moving-reference "perform on top" version pins the
          // Move brush's grabbed verts on desktop (tool only re-applies on mouse-move) → seams
          // and garbage, so we use the frozen approach.
          if (!this._dynBase) {
            this._dynBase = new Float32Array(verts.subarray(0, nb));
            // Snapshot the layer's pre-stroke keys for per-wave undo (see the falling-edge
            // handler + _pushShapeLayerWaveUndo). Shallow — stored key arrays aren't mutated.
            this._shapeLayerStrokeSnap = {
              layer: activeLayer,
              before: {
                times: (activeLayer.shapeTimes || []).slice(),
                shapes: (activeLayer.shapes || []).slice(),
                outs: activeLayer.shapeOutputTimes ? activeLayer.shapeOutputTimes.slice() : null,
              },
            };
          }
          if (gridFrame !== this._lastGridFrame && this._dynBase.length === nb) {
            this._lastGridFrame = gridFrame;
            const delta = new Float32Array(nb);
            for (let i = 0; i < nb; i++) delta[i] = verts[i] - this._dynBase[i];
            if (!activeLayer.shapeOutputTimes) activeLayer.shapeOutputTimes = [];
            this._captureShapeKeyGridded(activeLayer, gridFrame / fps, delta);
          }
        } else {
          // ── Recording into the BASE track (existing #30 additive-wave behaviour) ───────
          // Freeze the PRE-STROKE base once so the rebase composites only PRIOR waves (never
          // this stroke's own just-laid keys → no feedback). Empty first wave → rebase no-ops.
          if (!this._shapeStrokeSnap) {
            this._shapeStrokeSnap = {
              times: track.shapeTimes.slice(),
              shapes: track.shapes.slice(),
              outs: track.shapeOutputTimes ? track.shapeOutputTimes.slice() : null,
            };
            this._dynBase = this._evalShapeSnapshot(this._shapeStrokeSnap, track.playbackTime, nb);
          }
          const comp = this._evalShapeSnapshot(this._shapeStrokeSnap, track.playbackTime, nb);
          if (comp && comp.length === nb && this._dynBase && this._dynBase.length === nb) {
            for (let i = 0; i < nb; i++) verts[i] = comp[i] + (verts[i] - this._dynBase[i]);
            this._dynBase = comp;
            if (mesh.updateGeometry) mesh.updateGeometry();
            if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
          }
          if (gridFrame !== this._lastGridFrame) {
            this._lastGridFrame = gridFrame;
            this._captureShapeKeyGridded(track, gridFrame / fps, new Float32Array(verts.subarray(0, nb)));
          }
        }
      } catch (e) {
        if (!this._rebaseErrLogged) {
          this._rebaseErrLogged = true;
          console.error('[#30 shape capture] failed:', e);
          window.screenLog?.('vertex-rec error (see console)', 'red');
        }
      }
      return; // handled the verts for this frame
    }

    // 1. ShotSculpt (Old Shape Key System)
    // While a stroke is live on the shape-recording mesh the branch above owns the verts;
    // otherwise play back the recorded shape keys normally.
    if (track.shapeTimes && track.shapeTimes.length > 0 && !liveShapeStroke) {
      let sAlpha = 0;
      let s1 = null;
      let s2 = null;
      let sIdx = 0;

      // Evaluate Time Curve to get warpedTime
      let warpedTime = track.playbackTime;
      if (track.shapeOutputTimes && track.shapeOutputTimes.length >= 2) {
        let idx = 0;
        while (idx < track.shapeTimes.length - 2 && track.shapeTimes[idx + 1] < track.playbackTime) {
          idx++;
        }
        const t1 = track.shapeTimes[idx];
        const t2 = track.shapeTimes[idx + 1];
        const dt = t2 - t1;
        const v1 = (track.shapeOutputTimes && idx < track.shapeOutputTimes.length) ? track.shapeOutputTimes[idx] : t1;
        const v2 = (track.shapeOutputTimes && (idx + 1) < track.shapeOutputTimes.length) ? track.shapeOutputTimes[idx + 1] : t2;
        
        let alpha = dt > 0 ? (track.playbackTime - t1) / dt : 0;
        
        const hasShapeTangents = track.tangentOffsets && (track.tangentOffsets[`${idx}_right_dt`] !== undefined || track.tangentOffsets[`${idx + 1}_left_dt`] !== undefined);
        
        if (dt > 0.0001 && hasShapeTangents) {
          const rightDt = track.tangentOffsets[`${idx}_right_dt`];
          const rightDv = track.tangentOffsets[`${idx}_right_dv`];
          const leftDt = track.tangentOffsets[`${idx + 1}_left_dt`];
          const leftDv = track.tangentOffsets[`${idx + 1}_left_dv`];
          
          const dt0 = rightDt !== undefined ? rightDt : dt * 0.33;
          const dt1 = leftDt !== undefined ? leftDt : -dt * 0.33;
          
          const slope = dt > 0 ? (v2 - v1) / dt : 0;
          
          const dv0 = rightDv !== undefined ? rightDv : slope * dt0;
          const dv1 = leftDv !== undefined ? leftDv : slope * dt1;
          
          const p1x = dt0 / dt;
          const p2x = 1 + dt1 / dt;
          
          const t_bez = this.getBezierT(alpha, p1x, p2x);
          
          const omt = 1 - t_bez;
          const omtSq = omt * omt;
          const omtCu = omtSq * omt;
          const tSq = t_bez * t_bez;
          const tCu = tSq * t_bez;
          
          const p1y = v1 + dv0;
          const p2y = v2 + dv1;
          
          warpedTime = omtCu * v1 + 3 * omtSq * t_bez * p1y + 3 * omt * tSq * p2y + tCu * v2;
        } else {
          warpedTime = v1 + (v2 - v1) * alpha;
        }
        
        // Clamp warped time to valid range
        const minTime = track.shapeTimes[0];
        const maxTime = track.shapeTimes[track.shapeTimes.length - 1];
        warpedTime = Math.max(minTime, Math.min(maxTime, warpedTime));
        
        if (isNaN(warpedTime)) {
          const rv = track.tangentOffsets ? track.tangentOffsets[`${idx}_right`] : 'N/A';
          const lv = track.tangentOffsets ? track.tangentOffsets[`${idx + 1}_left`] : 'N/A';
          console.log(`[Animation Debug] warpedTime is NaN! idx=${idx}, t1=${t1}, t2=${t2}, v1=${v1}, v2=${v2}, alpha=${alpha}, rightVal=${rv}, leftVal=${lv}`);
        }
      }

      if (track.shapeTimes.length === 1) {
        s1 = track.shapes[0];
        s2 = track.shapes[0];
        sAlpha = 0;
      } else {
        while (sIdx < track.shapeTimes.length - 1 && track.shapeTimes[sIdx + 1] < warpedTime) {
          sIdx++;
        }

        const st1 = track.shapeTimes[sIdx];
        const st2 = track.shapeTimes[sIdx + 1];

        if (st2 > st1) {
          sAlpha = (warpedTime - st1) / (st2 - st1);
        }

        s1 = track.shapes[sIdx];
        s2 = track.shapes[sIdx + 1];
      }

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
          const val = s1[i] + (s2[i] - s1[i]) * blend;
          if (isNaN(val)) {
            console.error(`[Animation] NaN detected in interpolated vertex ${i}! blend=${blend}, s1=${s1[i]}, s2=${s2[i]}`);
            return; // Stop updating to prevent console explosion
          }
          verts[i] = val;
        }

        // #34: add shape-LAYER deltas into the SAME write so they upload with the base.
        this._addShapeLayerDeltas(track, track.playbackTime, reqLen, verts, -1);

        if (mesh.updateGeometry) mesh.updateGeometry();
        if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
        if (window.app && window.app.render) window.app.render();

        baseForBlendshapes = new Float32Array(verts); // Copy ShotSculpt result
      }
    }

    // 2. New Blendshape System (Layered on top)
    if (track.blendshapes && track.blendshapes.size > 0) {
      this.applyBlendshapes(mesh, baseForBlendshapes);
    }

    // 3. Shape LAYERS (#34) — for the NO-base-shape-animation case only (when a base shape
    //    animation exists, the ShotSculpt block above already folded the layer deltas into
    //    its own vertex write so they upload together). Here we reset to the rest pose (or
    //    blendshape result) and add the layer deltas. We only reach this point when NOT
    //    mid-stroke (the live-stroke rebase returns earlier), so it also composites BETWEEN
    //    strokes while recording — which is what makes a just-recorded layer play on release.
    if (track.shapeLayers && track.shapeLayers.length
        && !(track.shapeTimes && track.shapeTimes.length > 0)) {
      const lv = mesh.getVertices();
      const lnb = (mesh.getNbVertices ? mesh.getNbVertices() : lv.length / 3) * 3;
      // Reset to the base the deltas ride on so they don't accumulate frame-over-frame. If
      // blendshapes recomputed the verts this frame, that already IS the base; otherwise
      // restore the rest pose captured when the first layer was created.
      const recomputed = (track.blendshapes && track.blendshapes.size > 0);
      if (!recomputed && track._layerBase && track._layerBase.length >= lnb) {
        lv.set(track._layerBase.subarray(0, lnb));
      }
      this._addShapeLayerDeltas(track, track.playbackTime, lnb, lv, -1);
      if (mesh.updateGeometry) mesh.updateGeometry();
      if (mesh.updateGeometryBuffers) mesh.updateGeometryBuffers();
      if (window.app && window.app.render) window.app.render();
    }
  }
}

const globalRegistry = new AnimationRegistry();
window._animationRegistry = globalRegistry;

// Manual safety net for blendshape work — snapshot/restore ALL layer deltas + the
// base for the active mesh. Use before risky sequences; recover if a delta ever
// looks corrupt. Independent of the undo stack (which doesn't cover every path).
//   window.bsBackup()   → take a snapshot
//   window.bsRestore()  → restore the last snapshot
window.bsBackup = () => {
  const reg = window._animationRegistry;
  const mesh = window.app?.getMesh?.();
  const track = mesh ? reg.tracks.get(mesh.getID()) : null;
  if (!track) { console.warn('[Blendshapes] bsBackup: no active mesh/track'); return; }
  const snap = { base: track.baseShape ? new Float32Array(track.baseShape) : null, layers: new Map() };
  track.blendshapes?.forEach((d, n) => snap.layers.set(n, new Float32Array(d)));
  reg._bsBackup = snap;
  console.log(`[Blendshapes] bsBackup: ${snap.layers.size} layer(s) + base saved`);
};
window.bsRestore = () => {
  const reg = window._animationRegistry;
  const mesh = window.app?.getMesh?.();
  const track = mesh ? reg.tracks.get(mesh.getID()) : null;
  const snap = reg._bsBackup;
  if (!track || !snap) { console.warn('[Blendshapes] bsRestore: no backup or no active mesh'); return; }
  if (snap.base) {
    if (!track.baseShape || track.baseShape.length !== snap.base.length) track.baseShape = new Float32Array(snap.base);
    else track.baseShape.set(snap.base);
  }
  snap.layers.forEach((d, n) => {
    const cur = track.blendshapes?.get(n);
    if (cur && cur.length === d.length) cur.set(d);
    else track.blendshapes?.set(n, new Float32Array(d));
  });
  reg.applyBlendshapes(mesh);
  console.log(`[Blendshapes] bsRestore: ${snap.layers.size} layer(s) + base restored`);
};

export default globalRegistry;
