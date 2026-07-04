/**
 * FrameGroup — frame-by-frame animation as REAL outliner objects with keyframed
 * visibility. Each frame is a child mesh of an auto-created group (a null parent); a
 * per-child visibility track (AnimationRegistry) shows exactly ONE child at each frame
 * time (the flipbook invariant). Voxel frames additionally own a worker distance-field
 * slot (child._voxelSlot) — the field is the truth, the surface mesh a display cache.
 *
 * Entry: dopesheet SR keymode → New/Dup/Delete. First New/Dup on a plain mesh turns
 * it into frame 0 of a new group (create null, reparent, key it visible). Later
 * New/Dup add child frames; Delete removes them. `_rebuildVis` re-derives every
 * child's visibility keys so one shows per frame, re-run whenever frames change.
 */

import * as THREE from 'three';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Enums from '../misc/Enums.js';

// Magic for the persisted frame-group structure block (see serialize/deserialize).
const FGRP_MAGIC = 0x46475250; // 'FGRP'

export class FrameGroup {
  constructor(main) {
    this._main = main;
    this._ghosts = [];       // onion-skin THREE.Mesh ghosts
    this._onion = true;      // global toggle (shares the ACP onion checkbox)
    this._onionLoop = false; // wrap neighbours around the ends
    this._lastOnionKey = null;
  }

  _reg() { return window._animationRegistry; }
  _now() { return (typeof window !== 'undefined') ? (window._animCurrentTime || 0) : 0; }

  // --- Voxel frames (field-is-truth) ------------------------------------------
  // A voxel frame is a normal FrameGroup child whose surface mesh is the DISPLAY
  // cache; the truth is a worker distance-field slot (child._voxelSlot). The active
  // frame's child IS the voxel tool's live _voxelMesh; parked frames are cached
  // surfaces shown via the visibility track (same as any SR frame).
  _voxelTool() {
    const sm = this._main.getSculptManager && this._main.getSculptManager();
    return sm ? sm.getTool(Enums.Tools.VOXEL) : null;
  }
  // Disjoint slot range so we never collide with FrameAnimation's slots during the
  // transition (it allocates from 0).
  _newVoxelSlot() { this._voxelSlotSeq = (this._voxelSlotSeq || 1000000) + 1; return this._voxelSlotSeq; }

  // The active group iff it's a voxel frame group (its children carry field slots).
  activeVoxelGroup() {
    const g = this.activeGroup();
    return (g && this.children(g).some(c => c._isVoxel)) ? g : null;
  }

  // Keep the voxel tool's live _voxelMesh pointed at the HELD frame's child as the
  // playhead moves, so the hover cursor + draw plane (which parent to _voxelMesh) follow
  // the scrub and any frame is instantly editable. Cheap: no field load (that happens
  // lazily on stroke start via prepareVoxelSculpt). Called every parked frame.
  syncActiveVoxelFrame() {
    const group = this.activeVoxelGroup();
    if (!group) return;
    const child = this.visibleChild(group, this._now());
    const vt = this._voxelTool();
    if (child && vt && vt._voxelMesh !== child && vt.setActiveVoxelMesh) {
      vt.setActiveVoxelMesh(child);
    }
  }

  // Before a voxel stroke: bind the held frame's field to the live grid so the stroke
  // edits that frame's slot + child. No-op when the active object isn't a voxel group.
  prepareVoxelSculpt() {
    const group = this.activeVoxelGroup();
    if (!group) return;
    const child = this.visibleChild(group, this._now());
    const vt = this._voxelTool();
    if (child && vt && child._voxelSlot != null) {
      vt.beginVoxelFrame(child, child._voxelSlot);
      if (this._main.getMesh() !== child) this._main.setMesh(child);
    }
  }

  // Rebuild the outliner (desktop sidebar + VR panel) so new groups/frames + the
  // keyframe-driven eye colours show immediately after an SR op.
  _refreshOutliner() {
    const gui = this._main.getGui && this._main.getGui();
    if (gui && gui._desktopSceneEl && gui._buildDesktopScene) gui._buildDesktopScene(gui._desktopSceneEl);
    this._main._mainMenuPanel?.markDirty?.();
  }

  // The frame group a mesh belongs to (its parent, if that's a group), or the mesh
  // itself if it IS a group, else null.
  groupOf(mesh) {
    if (!mesh) return null;
    if (mesh._isFrameGroup) return mesh;
    const p = mesh._parentMesh;
    return (p && p._isFrameGroup) ? p : null;
  }

  activeGroup() { return this.groupOf(this._main.getMesh && this._main.getMesh()); }

  // Remove a child frame mesh cleanly. SR children are reparented UNDER the group's
  // Three mesh, so removeMeshes (which only detaches from the world group) leaves the
  // Three mesh rendering — detach it from its actual parent too.
  _removeChild(v) {
    this._main.removeMeshes([v]);
    const t = v.getThreeMesh && v.getThreeMesh();
    if (t && t.parent) t.parent.remove(t);
    this._reg()?.tracks.delete(v.getID());
    // Free the worker field slot — but only if no OTHER live frame still shares it (a
    // linked voxel frame shares its source's slot). v is already out of _meshes here.
    if (v._isVoxel && v._voxelSlot != null) {
      const stillUsed = this._main.getMeshes().some(m => m._voxelSlot === v._voxelSlot);
      if (!stillUsed) { const vt = this._voxelTool(); if (vt) vt.frameDeleteField(v._voxelSlot); }
    }
  }

  // Children of a group, ordered by their frame time.
  children(group) {
    if (!group) return [];
    return this._main.getMeshes().filter(m => m._parentMesh === group)
      .sort((a, b) => (a._srFrameTime || 0) - (b._srFrameTime || 0));
  }

  // The child held at `time` (latest frame at or before it) — the flipbook-visible one.
  visibleChild(group, time) {
    const kids = this.children(group);
    if (!kids.length) return null;
    let held = kids[0];
    for (const k of kids) { if ((k._srFrameTime || 0) <= time + 1e-6) held = k; else break; }
    return held;
  }

  // True when the timeline's New/Dup/Delete buttons should show for SR mode: the
  // active object is a frame group or one of its children, OR SR keymode is active
  // and a plain mesh is selected (so the first New/Dup can bootstrap a group).
  activeIsSRCtx() {
    const m = this._main.getMesh && this._main.getMesh();
    if (!m) return false;
    if (this.groupOf(m)) return true;
    return window._animKeyMode === 'shaperep' && !m._isFrameGroup;
  }

  // Re-derive every child's step-held visibility keys so exactly one shows per frame.
  // Child Ci (time ti) gets a key at EVERY frame time: 1 at ti, 0 elsewhere — with
  // both-ends clamp this yields a clean flipbook. Also updates the master duration.
  _rebuildVis(group) {
    const reg = this._reg();
    if (!reg) return;
    const kids = this.children(group);
    const times = kids.map(k => k._srFrameTime || 0);
    // Evaluate visibility at the current playhead so exactly ONE child shows the instant
    // a frame op finishes. reg.update() applies vis at reg.globalPlaybackTime; if that had
    // drifted from the playhead (e.g. paste via keyboard without a fresh scrub), two frames
    // could briefly show. Pin it to the playhead here (parked only — don't fight playback).
    if (!window._animPlaying) reg.globalPlaybackTime = this._now();
    kids.forEach((child, i) => {
      const id = child.getID();
      let tr = reg.tracks.get(id);
      if (!tr) {
        tr = { times: [], positions: [], quaternions: [], scales: [],
               shapeTimes: [], shapes: [], shapeOutputTimes: [],
               playbackTime: 0, lastUpdate: performance.now() };
        reg.tracks.set(id, tr);
      }
      tr.visTimes = times.slice();
      tr.visValues = times.map((_, j) => (j === i ? 1 : 0));
      reg.update(child, true);
    });
    const maxT = times.length ? times[times.length - 1] : 0;
    if (maxT > (window._animMasterDuration || 0)) window._animMasterDuration = maxT;
    this._main.getGui?.()?._ctrlTimeline?.draw?.();
    this._main.render?.(); // repaint immediately so corrected visibility shows this frame
  }

  // Snapshot enough scene state to make a group op one undo step: the meshes list,
  // each mesh's parent + srFrameTime, and every track's vis arrays.
  _snapshot() {
    const meshes = this._main.getMeshes().slice();
    const reg = this._reg();
    const vis = new Map();
    if (reg) reg.tracks.forEach((tr, id) => vis.set(id, { t: (tr.visTimes || []).slice(), v: (tr.visValues || []).slice() }));
    return {
      meshes,
      parents: meshes.map(m => m._parentMesh || null),
      frameTimes: meshes.map(m => m._srFrameTime),
      selected: this._main.getMesh && this._main.getMesh(),
      vis,
    };
  }

  _restore(snap) {
    const main = this._main;
    // Restore the meshes array (add-backs / removals) by rebuilding the scene list.
    const cur = main.getMeshes();
    // Remove meshes not in the snapshot.
    cur.slice().forEach(m => { if (!snap.meshes.includes(m)) { main.removeMeshes([m]); } });
    // Re-add meshes that were removed since.
    snap.meshes.forEach(m => { if (!cur.includes(m)) { main._meshes.push(m); main.attachMeshThree?.(m); } });
    // Restore parenting + frame times.
    snap.meshes.forEach((m, i) => {
      m._srFrameTime = snap.frameTimes[i];
      const p = snap.parents[i];
      if ((m._parentMesh || null) !== p) main.setMeshParent(m.getID(), p ? p.getID() : null);
    });
    // Restore vis tracks.
    const reg = this._reg();
    if (reg) snap.vis.forEach((s, id) => {
      let tr = reg.tracks.get(id);
      // Recreate the track if it was deleted (e.g. by a frame delete we're now undoing),
      // else the restored frame has no vis keys and doubles up.
      if (!tr) {
        tr = { times: [], positions: [], quaternions: [], scales: [], shapeTimes: [], shapes: [], shapeOutputTimes: [], playbackTime: 0, lastUpdate: performance.now() };
        reg.tracks.set(id, tr);
      }
      tr.visTimes = s.t.slice();
      tr.visValues = s.v.slice();
    });
    if (snap.selected) main.setMesh(snap.selected);
    if (reg) main.getMeshes().forEach(m => reg.update(m, true));
    main.render?.();
    main.getGui?.()?._ctrlTimeline?.draw?.();
  }

  _commit(before, name) {
    const after = this._snapshot();
    const sm = this._main.getStateManager && this._main.getStateManager();
    if (sm && sm.pushStateCustom) {
      sm.pushStateCustom(() => this._restore(before), () => this._restore(after), false, name);
    }
  }

  // Build a sculptable duplicate of a mesh (MeshStatic + copyData, like Scene.duplicateSelection).
  _dupMesh(src) {
    const copy = new MeshStatic(src.getGL());
    copy.copyData(src);
    copy.getMatrix().set(src.getMatrix()); // copyData doesn't copy the transform — keep it
    copy._typeName = src._typeName;
    return copy;
  }

  // First New/Dup on a plain mesh: wrap it in a new group as frame 0.
  _enable(seed, time) {
    const main = this._main;
    const group = main.addNull();
    // The group is a logical container — force IDENTITY so reparenting doesn't bake
    // the null's normalise+0.03 scale into the child. Also hide the null cruciform.
    group.getMatrix().set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const gtm = group.getThreeMesh && group.getThreeMesh();
    if (gtm) { gtm.matrix.identity(); gtm.matrixAutoUpdate = false; gtm.updateMatrixWorld(true); gtm.children.forEach(c => { c.visible = false; }); }
    group._isFrameGroup = true;
    group._typeName = 'FrameGroup';
    group._outlinerCollapsed = true; // collapsed by default — interact via the timeline
    group._permanentStaticLabel = (seed._permanentStaticLabel || seed._typeName || 'Shape') + '_animSR';
    main.setMeshParent(seed.getID(), group.getID());
    seed._srFrameTime = time;
    // Voxel seed → frame 0 owns a field slot; the seed stays the live _voxelMesh.
    if (seed._isVoxel) {
      const vt = this._voxelTool();
      const slot = this._newVoxelSlot();
      seed._voxelSlot = slot;
      if (vt) { vt.frameStoreField(slot); vt._activeVoxelSlot = slot; }
    }
    this._rebuildVis(group);
    main.setMesh(seed);
    return group;
  }

  // New frame at the playhead. dup=true copies the currently-held frame; else a blank
  // (empty) child = a stop-motion beat of nothing.
  addFrame(dup) {
    const main = this._main;
    const time = this._now();
    const before = this._snapshot();

    let group = this.activeGroup();
    if (!group) {
      const m = main.getMesh();
      if (!m || m._isFrameGroup) return;
      this._enable(m, time);            // first press just seeds frame 0
      this._commit(before, 'SR enable');
      this._refreshOutliner();
      return;
    }

    const cur = this.visibleChild(group, time);
    const isVoxel = !!(cur && cur._isVoxel);
    const vt = isVoxel ? this._voxelTool() : null;
    let child, voxelSlot = null;
    if (isVoxel) {
      // Sync the live field to the frame we're branching from (scrub is lazy, so the live
      // field can lag the playhead) and PERSIST it BEFORE allocating the new slot —
      // frameBlankField clobbers the live field, so a store after it would save blank over
      // the frame we came from.
      if (vt && cur && cur._voxelSlot != null) { vt.beginVoxelFrame(cur, cur._voxelSlot); vt.storeActiveVoxelFrame(); }
      // Allocate the new slot: Dup copies the source frame's field, New blanks it. The
      // child surface is a display cache (a copy of `cur` for Dup, empty for New) that
      // beginVoxelFrame() refreshes from the loaded field below.
      voxelSlot = this._newVoxelSlot();
      if (dup && cur) { child = this._dupMesh(cur); if (vt) vt.frameCopyField(cur._voxelSlot, voxelSlot); }
      else            { child = new MeshStatic(main._gl); if (vt) vt.frameBlankField(voxelSlot); }
      child._isVoxel = true;
      child._voxelSlot = voxelSlot;
      child._typeName = 'VoxelFrame';
    } else if (dup && cur) {
      child = this._dupMesh(cur);
    } else {
      child = new MeshStatic(main._gl);   // blank/empty frame — a "beat of nothing"
      child._typeName = 'blank';
      child._permanentStaticLabel = 'blank'; // reads clearly as an intentional empty
      // frame; replaced by the primitive's name when one is added to fill it.
    }
    child._srFrameTime = time;
    main._meshes.push(child);
    if (child.initThreeMesh) child.initThreeMesh();
    main.attachMeshThree?.(child);
    // Sync the Three matrix from the copied _matrix BEFORE reparenting, or
    // setMeshParent's world-preservation reads a stale identity and shrinks the dup.
    const ctm = child.getThreeMesh && child.getThreeMesh();
    if (ctm) { ctm.matrix.fromArray(child.getMatrix()); ctm.matrixAutoUpdate = false; ctm.updateMatrixWorld(true); }
    main.setMeshParent(child.getID(), group.getID());
    this._rebuildVis(group);
    main.setMesh(child);
    // Make the new voxel frame the live edit target (loads its slot into the grid). Skip
    // the outgoing-store — we already persisted it above, and the live field is now the
    // new frame's (blanked/copied), so storing would clobber the source frame.
    if (isVoxel && vt) vt.beginVoxelFrame(child, voxelSlot, true);
    this._commit(before, dup ? 'SR dup frame' : 'SR new frame');
    this._refreshOutliner();
  }

  // Paste a copied frame (its source child mesh `src`) into a group at `time`.
  // linked=true makes a LINKED instance sharing src's geometry (_meshData) — editing any
  // occurrence updates them all (the "reuse a phoneme" case); else an independent copy.
  // Replaces any frame already sitting at `time`. Returns the new child (or null).
  pasteFrame(src, time, linked) {
    const main = this._main;
    if (!src) return null;
    // Target the source's own group if it's still live, else the active group.
    let group = (src._parentMesh && src._parentMesh._isFrameGroup && main.getMeshes().includes(src._parentMesh))
      ? src._parentMesh : this.activeGroup();
    if (!group) return null;
    const before = this._snapshot();
    const isVox = !!src._isVoxel;
    const vt = isVox ? this._voxelTool() : null;
    let child;
    if (linked) {
      child = new MeshStatic(main._gl);
      child.shareData(src);          // linked instance — shares _meshData (surface)
      child._typeName = src._typeName;
      // Linked voxel frame shares the SAME field slot (edit one → both update — the
      // phoneme-reuse case). _removeChild only frees a slot no live child still references.
      if (isVox) { child._isVoxel = true; child._voxelSlot = src._voxelSlot; }
    } else {
      child = this._dupMesh(src);    // independent copy
      // Independent voxel frame gets its own field slot (a copy of the source's field).
      if (isVox && vt && src._voxelSlot != null) {
        const slot = this._newVoxelSlot();
        vt.frameCopyField(src._voxelSlot, slot);
        child._isVoxel = true;
        child._voxelSlot = slot;
      }
    }
    child._srFrameTime = time;
    main._meshes.push(child);
    if (child.initThreeMesh) child.initThreeMesh();
    main.attachMeshThree?.(child);
    // Sync the Three matrix from _matrix BEFORE reparenting (setMeshParent's world-
    // preservation reads a stale identity otherwise and shrinks the frame).
    const ctm = child.getThreeMesh && child.getThreeMesh();
    if (ctm) { ctm.matrix.fromArray(child.getMatrix()); ctm.matrixAutoUpdate = false; ctm.updateMatrixWorld(true); }
    main.setMeshParent(child.getID(), group.getID());
    // Paste over any frame already at this time.
    const existing = this.children(group).find(c => c !== child && Math.abs((c._srFrameTime || 0) - time) < 0.005);
    if (existing) this._removeChild(existing);
    this._rebuildVis(group);
    main.setMesh(child);
    // Bind the pasted voxel frame's field as the live edit target (loads its slot + grid),
    // so it's a proper voxel frame and holds up on scrub — same as addFrame.
    if (isVox && vt && child._voxelSlot != null) vt.beginVoxelFrame(child, child._voxelSlot, true);
    this._commit(before, linked ? 'SR paste linked frame' : 'SR paste frame');
    this._refreshOutliner();
    return child;
  }

  // Adopt a freshly-added mesh (e.g. a primitive) into `group` as the frame at the
  // playhead — replacing whatever frame already sits there (typically the blank one
  // from a "New"), else adding a new frame. This is the "New → add a primitive to
  // fill the empty slot" flow. Returns true if adopted.
  adoptAsFrame(mesh, group) {
    group = group || this.activeGroup();
    if (!group || !mesh || mesh._isFrameGroup || mesh._isNull) return false;
    const main = this._main;
    const time = this._now();
    const before = this._snapshot();
    // Replace the frame already at this time (the blank "New" slot).
    const existing = this.children(group).find(c => c !== mesh && Math.abs((c._srFrameTime || 0) - time) < 0.005);
    if (existing) this._removeChild(existing);
    mesh._srFrameTime = time;
    // Sync the Three matrix from _matrix before reparenting, or setMeshParent's
    // world-preservation reads a stale identity and flattens the primitive to scale 1.
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (tm) { tm.matrix.fromArray(mesh.getMatrix()); tm.matrixAutoUpdate = false; tm.updateMatrixWorld(true); }
    main.setMeshParent(mesh.getID(), group.getID());
    this._rebuildVis(group);
    main.setMesh(mesh);
    this._commit(before, 'SR add primitive frame');
    this._refreshOutliner();
    return true;
  }

  // Delete a set of frames by their child mesh ids (from dopesheet selection). Keeps
  // at least one frame per group. One undo step.
  deleteFramesByChildIds(ids) {
    const main = this._main;
    const idSet = new Set(ids);
    const victims = main.getMeshes().filter(m => idSet.has(m.getID()) && m._parentMesh && m._parentMesh._isFrameGroup);
    if (!victims.length) return;
    const byGroup = new Map();
    victims.forEach(v => { const g = v._parentMesh; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(v); });
    const before = this._snapshot();
    let changed = false;
    byGroup.forEach((vics, group) => {
      const total = this.children(group).length;
      const toRemove = (vics.length >= total) ? vics.slice(0, total - 1) : vics; // never empty a group
      toRemove.forEach(v => { this._removeChild(v); changed = true; });
      this._rebuildVis(group);
    });
    if (changed) {
      main.setMesh(main.getMeshes()[main.getMeshes().length - 1] || null);
      this._commit(before, 'SR delete frames');
      this._refreshOutliner();
      main.render?.();
    }
  }

  // Delete the frame held at the playhead (its child + keys). Keeps ≥1 frame.
  deleteFrame() {
    const main = this._main;
    const group = this.activeGroup();
    if (!group) return;
    const kids = this.children(group);
    if (kids.length <= 1) return;       // don't empty the group
    const time = this._now();
    const victim = this.visibleChild(group, time);
    if (!victim) return;
    const before = this._snapshot();
    this._removeChild(victim);
    this._rebuildVis(group);
    main.setMesh(this.visibleChild(group, time) || this.children(group)[0] || group);
    this._commit(before, 'SR delete frame');
    this._refreshOutliner();
  }

  // ---- Onion skin -----------------------------------------------------------
  // Ghost the neighbouring frames (prev = blue, next = red) at low opacity when
  // parked on a frame, so you can pose against the surrounding frames.
  setOnion(on) { this._onion = !!on; this._lastOnionKey = null; this.refreshOnion(); }
  setOnionLoop(on) { this._onionLoop = !!on; this._lastOnionKey = null; this.refreshOnion(); }
  isOnionOn() { return this._onion; }

  clearOnion() {
    for (const g of this._ghosts) {
      if (g.parent) g.parent.remove(g);
      if (g.geometry) g.geometry.dispose();
      if (g.material) g.material.dispose();
    }
    this._ghosts.length = 0;
    this._lastOnionKey = null;
  }

  // Cheap to call every frame — only rebuilds when the visible frame actually changes.
  refreshOnion() {
    const group = this.activeGroup();
    if (!group || !this._onion) { if (this._ghosts.length) this.clearOnion(); return; }
    const cur = this.visibleChild(group, this._now());
    const key = cur ? cur.getID() : -1;
    if (key === this._lastOnionKey) return;
    this._lastOnionKey = key;
    this._buildGhosts(group, cur);
  }

  _buildGhosts(group, cur) {
    for (const g of this._ghosts) { if (g.parent) g.parent.remove(g); g.geometry?.dispose(); g.material?.dispose(); }
    this._ghosts.length = 0;
    const kids = this.children(group);
    if (kids.length < 2 || !cur) return;
    const i = kids.indexOf(cur);
    if (i < 0) return;
    const n = kids.length;
    const prevIdx = this._onionLoop ? ((i - 1 + n) % n) : (i - 1);
    const nextIdx = this._onionLoop ? ((i + 1) % n) : (i + 1);
    const prev = kids[prevIdx];
    const next = (nextIdx !== prevIdx) ? kids[nextIdx] : null;
    if (prev && prev !== cur) this._makeGhost(prev, 0x4aa3ff);
    if (next && next !== cur) this._makeGhost(next, 0xff6a4a);
  }

  // Clone the child's already-triangulated render geometry into a transparent ghost,
  // as a sibling of the child (same parent + local matrix → same world position).
  _makeGhost(child, color) {
    const tm = child.getThreeMesh && child.getThreeMesh();
    if (!tm || !tm.geometry) return;
    const geo = tm.geometry.clone();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const ghost = new THREE.Mesh(geo, mat);
    ghost.matrixAutoUpdate = false;
    ghost.matrix.copy(tm.matrix);
    ghost.renderOrder = -1;
    ghost.frustumCulled = false;
    (tm.parent || this._main._scene).add(ghost);
    this._ghosts.push(ghost);
  }

  // ---- Persistence ----------------------------------------------------------
  // Frame-group STRUCTURE is not covered by the core .sxr mesh format (no hierarchy,
  // no _srFrameTime, no group flags). Save it as an independent footer-located block
  // appended after the mesh data (same decoupled pattern as FrameAnimation's FANM), so
  // old importers ignore it and the fragile core byte-math is untouched. Keyed by mesh
  // INDEX in the exported `meshes` list (import recreates meshes in the same order).
  // NOTE: 3a persists structure only; voxel field bytes are added in 3b (voxFlag is
  // written now so the format is forward-stable).
  // Fetch each voxel frame's field from the worker (RLE-compressed) into _saveFieldMap so
  // the sync serialize() can embed them. Async — call + await before exporting.
  async prepareFieldsForSave(meshes) {
    const vt = this._voxelTool();
    this._saveFieldMap = null;
    if (!vt || !meshes) return;
    vt.storeActiveVoxelFrame?.(); // flush the live frame's edits to its slot first (FIFO)
    const slots = [];
    meshes.forEach(m => { if (m && m._isVoxel && m._voxelSlot != null) slots.push([m, m._voxelSlot]); });
    if (!slots.length) return;
    const map = new Map();
    for (const [, slot] of slots) {
      const rle = await vt.getCompressedField(slot);
      if (rle && rle.length) map.set(slot, rle);
    }
    this._saveFieldMap = map;
  }
  clearSaveFields() { this._saveFieldMap = null; }

  serialize(meshes) {
    if (!meshes || !meshes.length) return null;
    const idxOf = (m) => meshes.indexOf(m);
    const nameOf = (m) => (m && m._permanentStaticLabel) || '';
    const fieldMap = this._saveFieldMap;
    const entries = meshes.filter(m => m && m._isFrameGroup).map(g => ({
      gi: idxOf(g), gname: nameOf(g),
      kids: this.children(g).map(c => ({
        ci: idxOf(c), t: c._srFrameTime || 0, vox: c._isVoxel ? 1 : 0, name: nameOf(c),
        rle: (c._isVoxel && fieldMap) ? fieldMap.get(c._voxelSlot) : null, // v3 compressed field
      })).filter(k => k.ci >= 0),
    })).filter(e => e.gi >= 0 && e.kids.length);

    // Linked instances (v4): meshes sharing the same _meshData object, recorded as index
    // groups. The core format writes each mesh's geometry independently, so without this
    // they reload as separate/unique meshes and the link is lost.
    const dataGroups = new Map();
    meshes.forEach((m, i) => {
      const md = m && m.getMeshData && m.getMeshData();
      if (!md) return;
      if (!dataGroups.has(md)) dataGroups.set(md, []);
      dataGroups.get(md).push(i);
    });
    const links = [...dataGroups.values()].filter(g => g.length > 1);

    if (!entries.length && !links.length) return null;

    // Names (v2): UTF-16 code units, length-prefixed. Voxel fields (v3): RLE floats,
    // length-prefixed. Instance links (v4): index groups.
    const strSlots = (s) => 1 + s.length;
    let slots = 3; // magic, version, nbGroups
    for (const e of entries) {
      slots += 1 + strSlots(e.gname) + 1; // gi + gname + nbKids
      for (const k of e.kids) slots += 3 + strSlots(k.name) + 1 + (k.rle ? k.rle.length : 0); // + rleLen + rle
    }
    slots += 1; // nbLinks
    for (const lk of links) slots += 1 + lk.length; // count + indices
    const buf = new ArrayBuffer((slots + 2) * 4); // + 2-slot footer
    const u = new Uint32Array(buf); const f = new Float32Array(buf);
    let o = 0;
    const writeStr = (s) => { u[o++] = s.length; for (let i = 0; i < s.length; i++) u[o++] = s.charCodeAt(i); };
    u[o++] = FGRP_MAGIC; u[o++] = 4; u[o++] = entries.length;
    for (const e of entries) {
      u[o++] = e.gi; writeStr(e.gname); u[o++] = e.kids.length;
      for (const k of e.kids) {
        u[o++] = k.ci; f[o++] = k.t; u[o++] = k.vox; writeStr(k.name);
        const rl = k.rle ? k.rle.length : 0;
        u[o++] = rl;
        if (rl) { f.set(k.rle, o); o += rl; }
      }
    }
    u[o++] = links.length;
    for (const lk of links) { u[o++] = lk.length; for (const idx of lk) u[o++] = idx; }
    u[o++] = FGRP_MAGIC; u[o++] = slots * 4; // footer: magic + block byte length
    return buf;
  }

  deserialize(buffer, meshes) {
    try {
      const bytes = buffer.byteLength;
      if (bytes < 8 || !meshes) return;
      const foot = new Uint32Array(buffer, bytes - 8, 2);
      if (foot[0] !== FGRP_MAGIC) return; // no frame-group block in this file
      const blockLen = foot[1];
      const start = bytes - 8 - blockLen;
      if (start < 0 || (start & 3)) return;
      const u = new Uint32Array(buffer, start, blockLen / 4);
      const f = new Float32Array(buffer, start, blockLen / 4);
      let o = 0;
      if (u[o++] !== FGRP_MAGIC) return;
      const ver = u[o++]; const nbGroups = u[o++];
      const readStr = () => { const n = u[o++]; let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u[o++]); return s; };
      const main = this._main;
      for (let gi = 0; gi < nbGroups; gi++) {
        const groupIdx = u[o++];
        const gname = ver >= 2 ? readStr() : '';
        const nbKids = u[o++];
        const kids = [];
        for (let k = 0; k < nbKids; k++) {
          const mesh = meshes[u[o++]]; const t = f[o++]; const vox = u[o++] === 1;
          const name = ver >= 2 ? readStr() : '';
          let rle = null;
          if (ver >= 3) { const rl = u[o++]; if (rl) { rle = f.slice(o, o + rl); o += rl; } }
          kids.push({ mesh, t, vox, name, rle });
        }
        const group = meshes[groupIdx];
        if (!group) continue;
        // Restore the group container (mirrors _enable's group setup).
        group._isFrameGroup = true;
        group._isNull = true;               // it's a null/locator → gnomon icon, not a cube
        group._typeName = 'FrameGroup';
        group._outlinerCollapsed = true;
        if (gname) group._permanentStaticLabel = gname;
        group.getMatrix().set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        const gtm = group.getThreeMesh && group.getThreeMesh();
        if (gtm) {
          gtm.matrix.identity(); gtm.matrixAutoUpdate = false; gtm.updateMatrixWorld(true);
          gtm.children.forEach(c => { c.visible = false; });
          // The null's placeholder sphere isn't drawn in-session (addNull gives it a
          // colorWrite:false material) but that material isn't serialized — so hide it
          // here too, else a low-res sphere shows at the origin after load.
          gtm.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        }
        const vt = this._voxelTool();
        for (const kd of kids) {
          if (!kd.mesh) continue;
          kd.mesh._srFrameTime = kd.t;
          if (kd.vox) {
            kd.mesh._isVoxel = true;
            // Restore the frame's distance field into a fresh worker slot so it's
            // re-sculptable (the surface already loaded as normal mesh geometry).
            if (kd.rle && vt) { const slot = this._newVoxelSlot(); vt.putCompressedField(slot, kd.rle); kd.mesh._voxelSlot = slot; }
          }
          if (kd.name) kd.mesh._permanentStaticLabel = kd.name;
          // Sync the child's Three matrix from its loaded _matrix BEFORE reparenting, so
          // setMeshParent's world-preservation (attach) reads the real world transform —
          // otherwise it preserves a stale identity and the children collapse to origin.
          const ctm = kd.mesh.getThreeMesh && kd.mesh.getThreeMesh();
          if (ctm) { ctm.matrix.fromArray(kd.mesh.getMatrix()); ctm.matrixAutoUpdate = false; ctm.updateMatrixWorld(true); }
          if ((kd.mesh._parentMesh || null) !== group) main.setMeshParent(kd.mesh.getID(), group.getID());
        }
        this._rebuildVis(group); // re-derive step-held visibility from the restored times
      }

      // Linked instances (v4): re-share _meshData so the meshes read as one linked group
      // again (edit-propagation + chain glyph + make-unique). Geometry is already
      // identical (saved from shared data), so this just re-points the data reference.
      if (ver >= 4) {
        const nbLinks = u[o++];
        for (let li = 0; li < nbLinks; li++) {
          const cnt = u[o++];
          const idxs = [];
          for (let c = 0; c < cnt; c++) idxs.push(u[o++]);
          const src = meshes[idxs[0]];
          const srcData = src && (src.getCurrentMesh ? src.getCurrentMesh().getMeshData() : src.getMeshData?.());
          if (!srcData) continue;
          for (let c = 1; c < cnt; c++) {
            const tgt = meshes[idxs[c]];
            if (!tgt) continue;
            if (tgt.getCurrentMesh) tgt.getCurrentMesh().setMeshData(srcData);
            tgt.setMeshData?.(srcData);
            tgt.updateBuffers?.();
          }
        }
      }

      main.render?.();
      this._refreshOutliner();
    } catch (e) { console.error('[FrameGroup] deserialize failed', e); }
  }
}
