import * as THREE from 'three';
import Enums from '../misc/Enums.js';
import Utils from '../misc/Utils.js';

// Frame-by-frame (cel) animation, Quill-style.
//
// A "sequence" is an ordered list of frames attached to one object (by mesh id).
// Each frame holds a geometry snapshot (vertices/faces/colors/materials/normals)
// used for playback + onion skinning with NO worker involvement. Voxel frames
// additionally own a worker distance-field slot so the frame can be re-sculpted
// losslessly: exactly one frame is "live" in the worker at a time.
//
// This is orthogonal to the transform-keyframe registry (AnimationRegistry):
// an object can cycle drawn frames AND be transform-animated across the scene.
//
// POC scope (decided 2026-06-28): full field per frame, no compression; cap
// frame-mode voxel resolution; voxel solid, regular-mesh best-effort.

const TRI = Utils.TRI_INDEX; // 4294967295 sentinel for the 4th index of a triangle
const FRAME_MAGIC = 0x4D4E4146; // 'FANM' little-endian — frame-block sentinel in .sxr
const MODE_CODES = { loop: 0, hold: 1, pingpong: 2 };
const MODE_NAMES = ['loop', 'hold', 'pingpong'];

class FrameAnimationManager {
  constructor(main) {
    this._main = main;
    this.sequences = new Map(); // meshId -> Sequence
    this._slotCounter = 1;      // unique voxel field-slot ids

    // playback
    this._playing = false;
    this._playSeq = null;
    this._playStartMs = 0;
    this._playDisplayIdx = -1;

    // onion-skin ghosts (THREE.Mesh)
    this._ghosts = [];

    this._ui = null;
  }

  // ---------------------------------------------------------------- helpers
  _voxelTool() {
    const sm = this._main.getSculptManager && this._main.getSculptManager();
    return sm ? sm.getTool(Enums.Tools.VOXEL) : null;
  }

  _newSlot() { return this._slotCounter++; }

  getActiveSeq() {
    const m = this._main.getMesh && this._main.getMesh();
    if (!m) return null;
    return this.sequences.get(m.getID()) || null;
  }

  _redraw() {
    this._main._drawFullScene = true;
    if (this._main.render) this._main.render();
  }

  _cloneTyped(a) { return a ? new a.constructor(a) : null; }

  _captureGeom(mesh) {
    return {
      vertices:  this._cloneTyped(mesh.getVertices()),
      faces:     this._cloneTyped(mesh.getFaces()),
      colors:    this._cloneTyped(mesh.getColors()),
      materials: this._cloneTyped(mesh.getMaterials()),
      normals:   (() => { const n = mesh.getNormals(); return (n && n.length) ? this._cloneTyped(n) : null; })(),
    };
  }

  _cloneGeom(g) {
    return {
      vertices:  this._cloneTyped(g.vertices),
      faces:     this._cloneTyped(g.faces),
      colors:    this._cloneTyped(g.colors),
      materials: this._cloneTyped(g.materials),
      normals:   this._cloneTyped(g.normals),
    };
  }

  _isEmptyGeom(g) { return !g || !g.vertices || g.vertices.length === 0; }

  // Push a geometry snapshot onto a live MeshStatic and re-upload to the GPU.
  // Mirrors SculptVoxel.updateVoxelMesh's buffer path so it works for voxel and
  // (best-effort) for regular meshes too.
  _applyGeom(mesh, geom) {
    // setVisible only flips an internal flag; the Three renderer draws the
    // threeMesh geometry. For an empty frame clear the drawn triangles rather
    // than hiding the object, so any children (voxel draw plane / cursor) keep
    // rendering. A later non-empty apply rebuilds the index via updateBuffers.
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (this._isEmptyGeom(geom)) {
      mesh.setVisible(false);
      if (tm && tm.geometry) tm.geometry.setIndex([]);
      return;
    }
    mesh.setVisible(true);
    mesh.setVertices(this._cloneTyped(geom.vertices));
    mesh.setFaces(this._cloneTyped(geom.faces));
    if (geom.colors)    mesh.setColors(this._cloneTyped(geom.colors));
    if (geom.materials) mesh.setMaterials(this._cloneTyped(geom.materials));
    mesh.setNormals(geom.normals ? this._cloneTyped(geom.normals) : null);
    mesh.initColorsAndMaterials();
    mesh.allocateArrays();
    mesh.initFaceRings();
    mesh.initRenderTriangles();
    mesh.updateFacesAabb();
    mesh.updateOctree();
    mesh.updateBuffers();
    mesh.initRender();
  }

  // ------------------------------------------------------------- lifecycle
  enableForActive() {
    const m = this._main.getMesh && this._main.getMesh();
    if (!m) { console.warn('[FrameAnim] No active object'); return null; }
    const id = m.getID();
    if (this.sequences.has(id)) { this._ensureUI(); this._refreshUI(); return this.sequences.get(id); }

    const isVoxel = !!m._isVoxel;
    const seq = {
      meshId: id, mesh: m, isVoxel,
      frames: [], current: 0,
      mode: 'loop', fps: 8, onion: true, timeOffset: 0,
    };
    const slot = isVoxel ? this._newSlot() : -1;
    if (isVoxel) this._voxelTool() && this._voxelTool().frameStoreField(slot);
    seq.frames.push({ geom: this._captureGeom(m), slot, time: 0 });
    this.sequences.set(id, seq);
    this._ensureRegistryTrack(m); // so the object shows as a timeline/dopesheet row

    this._ensureUI();
    this._refreshUI();
    console.log(`[FrameAnim] Enabled on #${id} (${isVoxel ? 'voxel' : 'mesh'})`);
    return seq;
  }

  // Frame-mode objects need a presence in the AnimationRegistry so the timeline
  // dopesheet (which iterates reg.tracks) draws a row for them. An empty track is
  // inert for transform/shape/blendshape evaluation.
  _ensureRegistryTrack(mesh) {
    const reg = (typeof window !== 'undefined') ? window._animationRegistry : null;
    if (!reg || !reg.tracks || reg.tracks.has(mesh.getID())) return;
    reg.tracks.set(mesh.getID(), {
      times: [], positions: [], quaternions: [], scales: [],
      shapeTimes: [], shapes: [], shapeOutputTimes: [],
      playbackTime: 0, lastUpdate: (typeof performance !== 'undefined') ? performance.now() : 0,
    });
  }

  disableActive() {
    const seq = this.getActiveSeq();
    if (!seq) return;
    this.stop();
    this._clearGhosts();
    if (seq.isVoxel) {
      const vt = this._voxelTool();
      if (vt) seq.frames.forEach(f => vt.frameDeleteField(f.slot));
    }
    this.sequences.delete(seq.meshId);
    this._refreshUI();
    this._redraw();
  }

  // Save the live display (and voxel field) back into the current frame.
  _commitCurrent(seq) {
    const fr = seq.frames[seq.current];
    if (!fr) return;
    fr.geom = this._captureGeom(seq.mesh);
    if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameStoreField(fr.slot);
  }

  // Make frame idx the live/editable one.
  _loadFrame(seq, idx, loadField = true) {
    idx = Math.max(0, Math.min(idx, seq.frames.length - 1));
    seq.current = idx;
    seq._dispIdx = idx; // keep the dopesheet highlight in sync with DOM-panel nav
    const fr = seq.frames[idx];
    if (seq.isVoxel && loadField && this._voxelTool()) {
      // Worker repaints _voxelMesh via MESH_UPDATE; geom display also set for
      // immediate feedback before the async repaint lands.
      this._voxelTool().frameLoadField(fr.slot);
    }
    this._applyGeom(seq.mesh, fr.geom);
    this._updateOnion(seq);
    // Voxels repaint async from the worker (matrix settles a frame later); rebuild
    // ghosts next frame so they pick up the final transform/geometry.
    this._scheduleOnion(seq);
    this._refreshUI();
    this._redraw();
  }

  _scheduleOnion(seq) {
    if (typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => { if (!this._playing && this.getActiveSeq() === seq) this._updateOnion(seq); });
  }

  refreshOnion() { const s = this.getActiveSeq(); if (s) this._updateOnion(s); this._redraw(); }

  // ---------------------------------------------------------------- frames
  gotoFrame(idx) {
    const seq = this.getActiveSeq();
    if (!seq) return;
    this._loadFrame(seq, idx);
  }
  nextFrame() { const s = this.getActiveSeq(); if (s) this.gotoFrame(s.current + 1 >= s.frames.length ? 0 : s.current + 1); }
  prevFrame() { const s = this.getActiveSeq(); if (s) this.gotoFrame(s.current - 1 < 0 ? s.frames.length - 1 : s.current - 1); }

  addFrame(duplicate = true) {
    const seq = this.getActiveSeq();
    if (!seq) { this.enableForActive(); return; }
    const src = seq.frames[seq.current];
    const slot = seq.isVoxel ? this._newSlot() : -1;
    let geom;
    if (duplicate) {
      geom = this._cloneGeom(src.geom);
      if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameCopyField(src.slot, slot);
    } else {
      geom = { vertices: new Float32Array(0), faces: null, colors: null, materials: null, normals: null };
      if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameBlankField(slot);
    }
    seq.frames.splice(seq.current + 1, 0, { geom, slot });
    seq.current = seq.current + 1;
    if (duplicate) {
      this._loadFrame(seq, seq.current, seq.isVoxel);
    } else {
      // Clear the display synchronously — don't wait on the async worker repaint,
      // or the prior frame lingers and the "blank" looks like a duplicate.
      // frameBlankField already cleared the live field for drawing into.
      seq._dispIdx = seq.current;
      this._applyGeom(seq.mesh, geom);
      this._updateOnion(seq);
      this._scheduleOnion(seq);
      this._refreshUI();
      this._redraw();
    }
  }

  deleteFrame() {
    const seq = this.getActiveSeq();
    if (!seq || seq.frames.length <= 1) return;
    const fr = seq.frames[seq.current];
    if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameDeleteField(fr.slot);
    seq.frames.splice(seq.current, 1);
    this._loadFrame(seq, Math.min(seq.current, seq.frames.length - 1));
  }

  // ----------------------------------------- time-keyed frames (held model)
  // Frames are keyed at explicit times and HELD: the frame shown at time t is the
  // one with the greatest time <= t. Created/deleted at the timeline playhead.
  _heldIndex(seq, t) {
    let idx = 0;
    for (let i = 0; i < seq.frames.length; i++) {
      if (seq.frames[i].time <= t + 1e-6) idx = i; else break;
    }
    return idx;
  }

  _frameAtTime(seq, t) {
    return seq.frames.findIndex(f => Math.abs(f.time - t) < 1e-4);
  }

  _sortFrames(seq) { seq.frames.sort((a, b) => a.time - b.time); }

  // Timeline entry points (playhead time supplied by the caller). Auto-enables a
  // sequence on the active object if there isn't one yet, so New/Dup is also the
  // way you "turn on" frames for an object.
  addFrameAt(time, blank = false) {
    let seq = this.getActiveSeq();
    if (!seq) { seq = this.enableForActive(); if (!seq) return; }
    // NB: do NOT _commitCurrent here. The live mesh may be showing a scrubbed
    // (held) frame while seq.current still points at the last-edited frame, so a
    // commit would write the wrong geometry into that frame. Edits are already
    // saved deterministically at stroke end (requestActiveFrameCommit).
    const held = this._heldIndex(seq, time);
    const existing = this._frameAtTime(seq, time);
    const slot = seq.isVoxel ? this._newSlot() : -1;
    let geom;
    if (blank) {
      geom = { vertices: new Float32Array(0), faces: null, colors: null, materials: null, normals: null };
      if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameBlankField(slot);
    } else {
      geom = this._cloneGeom(seq.frames[held].geom); // Dup = copy the held (left) frame
      if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameCopyField(seq.frames[held].slot, slot);
    }
    if (existing >= 0) {
      // Replace the frame already sitting at this time.
      if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameDeleteField(seq.frames[existing].slot);
      seq.frames[existing] = { geom, slot, time };
      seq.current = existing;
    } else {
      seq.frames.push({ geom, slot, time });
      this._sortFrames(seq);
      seq.current = this._frameAtTime(seq, time);
    }
    if (blank) {
      seq._dispIdx = seq.current;
      this._applyGeom(seq.mesh, geom);
      this._updateOnion(seq); this._scheduleOnion(seq); this._redraw();
    } else {
      this._loadFrame(seq, seq.current, seq.isVoxel);
    }
  }

  deleteFrameAt(time) {
    const seq = this.getActiveSeq();
    if (!seq || seq.frames.length <= 1) return;
    const idx = this._heldIndex(seq, time);
    if (seq.isVoxel && this._voxelTool()) this._voxelTool().frameDeleteField(seq.frames[idx].slot);
    seq.frames.splice(idx, 1);
    this._loadFrame(seq, Math.min(idx, seq.frames.length - 1));
  }

  // Deterministic frame commit. Record the exact frame object to capture into,
  // then ask SculptVoxel for a TAGGED mesh. Because the worker is FIFO and scrub
  // no longer changes the field, that response reflects exactly this frame's
  // settled field — its forCommit handler calls captureCommit() below. This
  // avoids the old race where a global flag was consumed by an unrelated update.
  requestActiveFrameCommit() {
    const seq = this.getActiveSeq();
    if (!seq || !seq.isVoxel) return;
    const fr = seq.frames[seq.current];
    const vt = this._voxelTool();
    if (!fr || !vt || !vt.frameRequestCommit) return;
    // FIFO queue of target frames — worker responses arrive in request order, so
    // multiple in-flight commits (stroke then a quick scrub-release) stay matched.
    (this._commitQueue || (this._commitQueue = [])).push(fr);
    vt.frameRequestCommit();
  }
  captureCommit() {
    const fr = this._commitQueue && this._commitQueue.shift();
    if (!fr) return;
    const mesh = this._main.getMesh && this._main.getMesh();
    if (!mesh) return;
    // The live mesh was just set to this frame's settled field by updateVoxelMesh.
    fr.geom = this._captureGeom(mesh);
    if (fr.slot >= 0 && this._voxelTool()) this._voxelTool().frameStoreField(fr.slot);
    this._redraw();
  }

  // Sculpting is only allowed when the playhead sits exactly on a frame key.
  // Off-frame (held between keys) it's blocked, so an edit is never ambiguous
  // (no "does this make a new frame / modify the dup" decision). Objects without
  // a frame sequence sculpt freely.
  canSculptActive() {
    const seq = this.getActiveSeq();
    if (!seq) return true;
    const t = (typeof window !== 'undefined') ? (window._animCurrentTime || 0) : 0;
    return this._frameAtTime(seq, t) >= 0;
  }

  // ---------------------------------------- dopesheet key drag (retime/reorder)
  // Mirror of AnimationRegistry.moveSelectedKeys for frame keys: shift each
  // selected frame's keyed time by dt from its captured initial time. No sort
  // mid-drag (indices must stay stable); finalize sorts + reindexes.
  moveFrameKeys(keys, dt, masterDuration) {
    if (!keys) return;
    keys.forEach(key => {
      if (key.type !== 'frame') return;
      const seq = this.sequences.get(key.meshId);
      if (!seq || !seq.frames[key.index]) return;
      let nt = (key.time || 0) + dt;
      nt = Math.max(0, nt);
      if (masterDuration) nt = Math.min(masterDuration, nt);
      seq.frames[key.index].time = nt;
    });
  }

  // The keyed time of frame `index` on a sequence (for capturing drag snapshots).
  frameKeyTime(meshId, index) {
    const seq = this.sequences.get(meshId);
    return seq && seq.frames[index] ? seq.frames[index].time : 0;
  }

  // After a drag, re-sort frames by time and repair the selection + current
  // indices (which referred to pre-sort positions) by object identity.
  sortActiveAndReindex() {
    const seq = this.getActiveSeq();
    if (!seq) return;
    const sel = (typeof window !== 'undefined' && window._animSelectedKeys) || [];
    const selObjs = sel.map(k => (k.type === 'frame' && k.meshId === seq.meshId) ? seq.frames[k.index] : null);
    const curObj = seq.frames[seq.current];
    this._sortFrames(seq);
    sel.forEach((k, i) => { if (selObjs[i]) k.index = seq.frames.indexOf(selObjs[i]); });
    if (curObj) { seq.current = seq.frames.indexOf(curObj); seq._dispIdx = seq.current; }
    this._redraw();
  }

  // Undo support: snapshot / restore every sequence's frame times.
  snapshotFrameTimes() {
    const m = new Map();
    this.sequences.forEach((s, id) => m.set(id, s.frames.map(f => f.time)));
    return m;
  }
  restoreFrameTimes(snap) {
    if (!snap) return;
    snap.forEach((times, id) => {
      const s = this.sequences.get(id);
      if (!s) return;
      times.forEach((t, i) => { if (s.frames[i]) s.frames[i].time = t; });
      this._sortFrames(s);
    });
    this._redraw();
  }

  // True when the active object is a voxel being frame-animated (or eligible to be).
  // Drives the timeline's modal New/Dup/Delete gutter buttons.
  activeIsVoxelFrameCtx() {
    const m = this._main.getMesh && this._main.getMesh();
    if (!m || !m._isVoxel) return false;
    const sm = this._main.getSculptManager && this._main.getSculptManager();
    return !!(sm && sm.getToolIndex && sm.getToolIndex() === Enums.Tools.VOXEL);
  }

  // -------------------------------------------------------------- settings
  setMode(mode) { const s = this.getActiveSeq(); if (s) { s.mode = mode; this._refreshUI(); } }
  setFps(fps) {
    const s = this.getActiveSeq(); if (!s) return;
    const newFps = Math.max(0.5, fps || 8);
    if (this._playing && this._playSeq === s) {
      // Rebase the playback clock so the current frame index stays continuous.
      const frameFloat = ((performance.now() - this._playStartMs) / 1000) * s.fps;
      s.fps = newFps;
      this._playStartMs = performance.now() - (frameFloat / s.fps) * 1000;
    } else {
      s.fps = newFps;
    }
    this._refreshUI();
  }
  toggleOnion() { const s = this.getActiveSeq(); if (s) this.setOnion(!s.onion); }
  setOnion(on) {
    // Apply to all sequences so the panel checkbox is a global onion toggle.
    this.sequences.forEach(s => { s.onion = !!on; });
    const a = this.getActiveSeq(); if (a) this._updateOnion(a);
    this._refreshUI(); this._redraw();
  }
  setOnionLoop(on) {
    this._onionLoop = !!on;
    const a = this.getActiveSeq(); if (a) this._updateOnion(a);
    this._redraw();
  }
  isOnionOn() { const s = this.getActiveSeq(); return s ? !!s.onion : true; }

  // ------------------------------------------------------------- onion skin
  _clearGhosts() {
    for (const g of this._ghosts) {
      if (g.parent) g.parent.remove(g);
      if (g.geometry) g.geometry.dispose();
      if (g.material) g.material.dispose();
    }
    this._ghosts.length = 0;
  }

  _triIndexFromQuads(faces) {
    const idx = [];
    for (let i = 0; i < faces.length; i += 4) {
      const a = faces[i], b = faces[i + 1], c = faces[i + 2], d = faces[i + 3];
      idx.push(a, b, c);
      if (d !== TRI) idx.push(a, c, d);
    }
    return idx;
  }

  _makeGhost(seq, geom, color) {
    if (this._isEmptyGeom(geom) || !geom.faces) return null;
    const tm = seq.mesh.getThreeMesh && seq.mesh.getThreeMesh();
    if (!tm) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this._cloneTyped(geom.vertices), 3));
    g.setIndex(this._triIndexFromQuads(geom.faces));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    });
    const ghost = new THREE.Mesh(g, mat);
    ghost.matrixAutoUpdate = false;
    ghost.matrix.copy(tm.matrix);
    ghost.renderOrder = -1;
    (tm.parent || this._main._scene).add(ghost);
    return ghost;
  }

  _updateOnion(seq) {
    this._clearGhosts();
    if (!seq || !seq.onion || seq.frames.length < 2) return;
    // No onion during playback.
    if (this._playing || (typeof window !== 'undefined' && window._animPlaying)) return;
    // Ghost the neighbours of the frame actually on screen (tracks scrubbing).
    // Loop-aware onion wraps around: on the last frame, "next" is the first frame
    // (and vice-versa) so a cyclic animation reads continuously.
    const cur = (seq._dispIdx != null) ? seq._dispIdx : seq.current;
    const n = seq.frames.length;
    const prevIdx = this._onionLoop ? ((cur - 1 + n) % n) : (cur - 1);
    const nextIdx = this._onionLoop ? ((cur + 1) % n) : (cur + 1);
    const prev = seq.frames[prevIdx];
    const next = (nextIdx !== prevIdx) ? seq.frames[nextIdx] : undefined;
    if (prev) { const gh = this._makeGhost(seq, prev.geom, 0x4aa3ff); if (gh) this._ghosts.push(gh); }
    if (next) { const gh = this._makeGhost(seq, next.geom, 0xff6a4a); if (gh) this._ghosts.push(gh); }
  }

  // --------------------------------------------------------------- playback
  togglePlay() { this._playing ? this.stop() : this.play(); }

  play() {
    const seq = this.getActiveSeq();
    if (!seq || seq.frames.length < 2) return;
    this._clearGhosts();
    this._playSeq = seq;
    this._playing = true;
    this._playStartMs = performance.now();
    this._playDisplayIdx = -1;
    this._refreshUI();
  }

  stop() {
    if (!this._playing) return;
    this._playing = false;
    const seq = this._playSeq;
    this._playSeq = null;
    if (seq) {
      const idx = this._playDisplayIdx >= 0 ? this._playDisplayIdx : seq.current;
      this._loadFrame(seq, idx, true); // restore editable state on the landed frame
    }
    this._refreshUI();
  }

  _mapFrame(seq, frameFloat) {
    const n = seq.frames.length;
    if (n <= 1) return 0;
    const fi = Math.floor(frameFloat);
    if (seq.mode === 'hold') return Math.min(fi, n - 1);
    if (seq.mode === 'pingpong') {
      const period = 2 * (n - 1);
      let p = ((fi % period) + period) % period;
      return p < n ? p : period - p;
    }
    // loop
    return ((fi % n) + n) % n;
  }

  tick() {
    if (!this._playing) return;
    const seq = this._playSeq;
    if (!seq || seq.frames.length < 2) { this.stop(); return; }
    const elapsed = (performance.now() - this._playStartMs) / 1000;
    const idx = this._mapFrame(seq, elapsed * seq.fps);
    if (idx !== this._playDisplayIdx) {
      this._playDisplayIdx = idx;
      seq._dispIdx = idx; // keep the dopesheet highlight synced during panel Play
      this._applyGeom(seq.mesh, seq.frames[idx].geom);
      this._main._drawFullScene = true;
      this._refreshTransport();
    }
  }

  // -------------------------------------------------- timeline-driven display
  // The dopesheet marker time of frame i (its keyed time).
  frameTime(seq, i) { return seq.frames[i] ? seq.frames[i].time : 0; }

  // Held: the frame shown at time t is the latest keyed at or before t.
  frameIndexAtTime(seq, t) { return this._heldIndex(seq, t); }

  // Drive every sequence's DISPLAY from the shared timeline playhead (play AND
  // scrub) using the stored per-frame geometry only — NO commit, NO worker field
  // load. The voxel mesh is repainted by the worker asynchronously, so capturing
  // it mid-scrub would write half-updated geometry into the wrong frame (the bug
  // where playback showed the wrong drawing). Edits are already saved at stroke
  // end; the field is (re)loaded for editing only on playhead release — see
  // loadFieldForPlayhead.
  syncToTime(globalTime) {
    if (!this.sequences.size) return;
    const playing = (typeof window !== 'undefined') && window._animPlaying;
    let activeChanged = false;
    this.sequences.forEach((seq) => {
      if (!seq.frames.length) return;
      const idx = this.frameIndexAtTime(seq, globalTime);
      if (idx === seq._dispIdx) return;
      seq._dispIdx = idx;
      this._applyGeom(seq.mesh, seq.frames[idx].geom);
      this._main._drawFullScene = true;
      if (seq === this.getActiveSeq()) activeChanged = true;
    });
    if (playing) {
      if (this._ghosts.length) this._clearGhosts(); // onion off during playback
    } else if (activeChanged) {
      this._updateOnion(this.getActiveSeq());        // track the scrubbed frame
    }
  }

  // Called when the playhead is released (scrub end): if it landed exactly on a
  // frame, make that frame the editable one (load its voxel field). One field
  // load per gesture — avoids the per-step worker churn/races of live scrubbing.
  loadFieldForPlayhead() {
    const seq = this.getActiveSeq();
    if (!seq) return;
    const t = (typeof window !== 'undefined') ? (window._animCurrentTime || 0) : 0;
    const idx = this._frameAtTime(seq, t);
    if (idx < 0) return; // off-frame: nothing editable here
    this._loadFrame(seq, idx, true);
    // Re-sync the frame's stored geometry from its (authoritative) field — heals
    // any geom left wrong by earlier issues. _loadFrame set seq.current = idx.
    if (seq.isVoxel) this.requestActiveFrameCommit();
  }

  // Light per-frame update used during playback: never touches the fps/mode
  // inputs, so they stay editable while the animation runs.
  _refreshTransport() {
    const ui = this._ui; if (!ui) return;
    const seq = this._playing ? this._playSeq : this.getActiveSeq();
    if (!seq) return;
    const cur = this._playing ? this._playDisplayIdx : seq.current;
    ui.counter.textContent = `${(cur < 0 ? 0 : cur) + 1} / ${seq.frames.length}`;
    ui.playBtn.textContent = this._playing ? 'Stop' : 'Play';
    ui.playBtn.style.color = this._playing ? '#9fe' : '#ddd';
  }

  // --------------------------------------------------------- persistence
  // v1 stores per-frame GEOMETRY only (playback across sessions). The voxel
  // distance fields are NOT saved: re-editing a loaded voxel frame is blocked
  // by the single-worker limitation regardless, so the fields would be dead
  // weight (8.4MB/frame). Add them when voxel-object worker reconnection lands.
  //
  // The block is appended to the .sxr Blob after the mesh data with an 8-byte
  // footer [magic, blockByteLen] at the very end, so it is located from the end
  // and never depends on the (fragile) mesh byte-accounting. Sequences are keyed
  // by mesh INDEX in the exported list, since import reassigns mesh ids.
  serialize(meshes) {
    if (!this.sequences.size || !meshes || !meshes.length) return null;
    // (Frames are already committed at stroke end; no live-mesh capture here —
    // the live mesh may be a scrubbed frame, which would corrupt seq.current.)

    const entries = [];
    this.sequences.forEach((seq) => {
      const idx = meshes.findIndex(m => m.getID() === seq.meshId);
      if (idx >= 0) entries.push({ idx, seq });
    });
    if (!entries.length) return null;

    const len = a => (a ? a.length : 0);
    let slots = 3; // magic, version, nbSeq
    for (const { seq } of entries) {
      slots += 7; // meshIndex,isVoxel,mode,fps,current,onion,nbFrames
      for (const fr of seq.frames) {
        const g = fr.geom || {};
        slots += 6 + len(g.vertices) + len(g.faces) + len(g.colors) + len(g.materials) + len(g.normals); // +1 for frame time
      }
    }
    const blockSlots = slots;
    const buf = new ArrayBuffer((blockSlots + 2) * 4); // + 2-slot footer
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    let o = 0;
    u[o++] = FRAME_MAGIC;
    u[o++] = 2; // format version (2 = per-frame time)
    u[o++] = entries.length;
    const writeArr = (view, a) => { const n = len(a); u[o++] = n; if (n) { view.set(a, o); o += n; } };
    for (const { idx, seq } of entries) {
      u[o++] = idx;
      u[o++] = seq.isVoxel ? 1 : 0;
      u[o++] = MODE_CODES[seq.mode] ?? 0;
      f[o++] = seq.fps;
      u[o++] = seq.current;
      u[o++] = seq.onion ? 1 : 0;
      u[o++] = seq.frames.length;
      for (const fr of seq.frames) {
        const g = fr.geom || {};
        f[o++] = fr.time || 0;
        writeArr(f, g.vertices);
        writeArr(u, g.faces);
        writeArr(f, g.colors);
        writeArr(f, g.materials);
        writeArr(f, g.normals);
      }
    }
    // footer
    u[o++] = FRAME_MAGIC;
    u[o++] = blockSlots * 4;
    return buf;
  }

  deserialize(buffer, meshes) {
    try {
      const bytes = buffer.byteLength;
      if (bytes < 8 || !meshes) return;
      const foot = new Uint32Array(buffer, bytes - 8, 2);
      if (foot[0] !== FRAME_MAGIC) return; // no frame block in this file
      const blockLen = foot[1];
      const start = bytes - 8 - blockLen;
      if (start < 0 || (start & 3)) return;
      const u = new Uint32Array(buffer, start, blockLen / 4);
      const f = new Float32Array(buffer, start, blockLen / 4);
      let o = 0;
      if (u[o++] !== FRAME_MAGIC) return;
      const fmtVer = u[o++]; // 1 = no per-frame time, 2 = per-frame time
      const nbSeq = u[o++];
      // Count prefix is always a u32; the payload is read with the typed view
      // appropriate to the field (faces u32, the rest f32).
      const readArr = (view) => { const n = u[o++]; const a = n ? view.slice(o, o + n) : null; o += n; return a; };
      let restoredActive = false;
      for (let s = 0; s < nbSeq; s++) {
        const idx = u[o++];
        const isVoxel = u[o++] === 1;
        const mode = MODE_NAMES[u[o++]] || 'loop';
        const fps = f[o++];
        const current = u[o++];
        const onion = u[o++] === 1;
        const nbFrames = u[o++];
        const frames = [];
        for (let i = 0; i < nbFrames; i++) {
          // v1 files had no per-frame time; key them off the (defunct) 8fps grid.
          const time = (fmtVer >= 2) ? f[o++] : (i / 8);
          const vertices  = readArr(f);
          const faces     = readArr(u);
          const colors    = readArr(f);
          const materials = readArr(f);
          const normals   = readArr(f);
          frames.push({ geom: { vertices, faces, colors, materials, normals }, slot: -1, time });
        }
        const mesh = meshes[idx];
        if (!mesh || !frames.length) continue;
        const seq = {
          meshId: mesh.getID(), mesh, isVoxel, frames,
          current: Math.min(current, frames.length - 1),
          mode, fps, onion, timeOffset: 0,
        };
        this.sequences.set(seq.meshId, seq);
        this._ensureRegistryTrack(mesh); // show as a timeline/dopesheet row
        // No need to apply geometry: the imported mesh already loads as its
        // saved current frame. Scrub/play will swap frames from here.
        if (this._main.getMesh && this._main.getMesh() === mesh) restoredActive = true;
      }
      if (restoredActive) { this._ensureUI(); this._refreshUI(); this.refreshOnion(); }
      this._redraw();
      console.log(`[FrameAnim] Loaded ${nbSeq} frame sequence(s)`);
    } catch (e) {
      console.error('[FrameAnim] deserialize failed', e);
    }
  }

  // -------------------------------------------------------------------- UI
  _ensureUI() {
    // Floating panel retired — frame controls now live in the timeline gutter
    // (New/Dup/Delete) and the animation panel (Onion). Kept as an opt-in debug
    // panel via window._frameAnimPanel=true.
    if (typeof window !== 'undefined' && !window._frameAnimPanel) return;
    if (this._ui || typeof document === 'undefined') return;
    const wrap = document.createElement('div');
    wrap.id = '_frameanim_panel';
    wrap.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
      'z-index:99999', 'background:#1b1b1bee', 'border:1px solid #333',
      'border-radius:8px', 'padding:8px 10px', 'display:flex', 'gap:6px',
      'align-items:center', 'font:12px/1.3 system-ui,sans-serif', 'color:#ddd',
      'box-shadow:0 4px 18px #000a', 'user-select:none',
    ].join(';');

    const btn = (label, title, fn, w) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title || label;
      b.style.cssText = `min-width:${w || 26}px;height:26px;padding:0 7px;background:#2a2a2a;color:#ddd;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer;font:12px system-ui`;
      b.onmouseenter = () => b.style.background = '#3a3a3a';
      b.onmouseleave = () => b.style.background = '#2a2a2a';
      b.onclick = fn;
      return b;
    };

    const counter = document.createElement('span');
    counter.style.cssText = 'min-width:54px;text-align:center;color:#9fe;font-variant-numeric:tabular-nums';

    const modeSel = document.createElement('select');
    modeSel.style.cssText = 'height:26px;background:#2a2a2a;color:#ddd;border:1px solid #3a3a3a;border-radius:5px';
    ['loop', 'hold', 'pingpong'].forEach(m => {
      const o = document.createElement('option'); o.value = m; o.textContent = m; modeSel.appendChild(o);
    });
    modeSel.onchange = () => this.setMode(modeSel.value);

    const fps = document.createElement('input');
    fps.type = 'number'; fps.min = '1'; fps.max = '60'; fps.value = '8';
    fps.style.cssText = 'width:42px;height:26px;background:#2a2a2a;color:#ddd;border:1px solid #3a3a3a;border-radius:5px;text-align:center';
    fps.title = 'frames per second';
    fps.onchange = () => this.setFps(parseFloat(fps.value));

    const playBtn = btn('Play', 'Play / Stop', () => this.togglePlay(), 44);
    const onionBtn = btn('Onion', 'Toggle onion skinning', () => this.toggleOnion(), 50);

    const sep = () => { const s = document.createElement('span'); s.style.cssText = 'width:1px;height:18px;background:#3a3a3a;margin:0 2px'; return s; };

    wrap.appendChild(btn('Off', 'Disable frames on this object', () => this.disableActive(), 32));
    wrap.appendChild(sep());
    wrap.appendChild(btn('|<', 'First frame', () => this.gotoFrame(0)));
    wrap.appendChild(btn('<', 'Previous frame', () => this.prevFrame()));
    wrap.appendChild(counter);
    wrap.appendChild(btn('>', 'Next frame', () => this.nextFrame()));
    wrap.appendChild(playBtn);
    wrap.appendChild(sep());
    wrap.appendChild(btn('+Dup', 'Add duplicate frame', () => this.addFrame(true), 44));
    wrap.appendChild(btn('+New', 'Add blank frame', () => this.addFrame(false), 44));
    wrap.appendChild(btn('Del', 'Delete current frame', () => this.deleteFrame(), 34));
    wrap.appendChild(sep());
    wrap.appendChild(onionBtn);
    wrap.appendChild(modeSel);
    wrap.appendChild(fps);

    document.body.appendChild(wrap);
    this._ui = { wrap, counter, modeSel, fps, playBtn, onionBtn };
  }

  _refreshUI() {
    const ui = this._ui; if (!ui) return;
    const seq = this._playing ? this._playSeq : this.getActiveSeq();
    if (!seq) { ui.wrap.style.display = 'none'; return; }
    ui.wrap.style.display = 'flex';
    const cur = this._playing ? this._playDisplayIdx : seq.current;
    ui.counter.textContent = `${(cur < 0 ? 0 : cur) + 1} / ${seq.frames.length}`;
    // Don't stomp a control the user is actively editing.
    const active = (typeof document !== 'undefined') ? document.activeElement : null;
    if (active !== ui.modeSel) ui.modeSel.value = seq.mode;
    if (active !== ui.fps) ui.fps.value = String(seq.fps);
    ui.playBtn.textContent = this._playing ? 'Stop' : 'Play';
    ui.playBtn.style.color = this._playing ? '#9fe' : '#ddd';
    ui.onionBtn.style.background = seq.onion ? '#37506a' : '#2a2a2a';
  }
}

export default FrameAnimationManager;
