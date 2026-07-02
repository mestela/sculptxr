/**
 * FrameGroup — shape-replacement (SR) animation as REAL outliner objects with
 * keyframed visibility. Each frame is a child mesh of an auto-created group (a null
 * parent); a per-child visibility track (AnimationRegistry) shows exactly ONE child
 * at each frame time (the flipbook invariant). Contrast FrameAnimationManager
 * (voxel/cel: frames hidden inside a single object).
 *
 * Entry: dopesheet SR keymode → New/Dup/Delete. First New/Dup on a plain mesh turns
 * it into frame 0 of a new group (create null, reparent, key it visible). Later
 * New/Dup add child frames; Delete removes them. `_rebuildVis` re-derives every
 * child's visibility keys so one shows per frame, re-run whenever frames change.
 */

import * as THREE from 'three';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';

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
    let child;
    if (dup && cur) {
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
    this._commit(before, dup ? 'SR dup frame' : 'SR new frame');
    this._refreshOutliner();
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
}
