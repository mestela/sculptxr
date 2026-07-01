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

import MeshStatic from '../mesh/meshStatic/MeshStatic.js';

export class FrameGroup {
  constructor(main) { this._main = main; }

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
    if (reg) snap.vis.forEach((s, id) => { const tr = reg.tracks.get(id); if (tr) { tr.visTimes = s.t.slice(); tr.visValues = s.v.slice(); reg.tracks.get(id); } });
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
      child = new MeshStatic(main._gl);   // blank/empty frame
      child._typeName = 'Frame';
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
    main.removeMeshes([victim]);
    const reg = this._reg();
    if (reg) reg.tracks.delete(victim.getID());
    this._rebuildVis(group);
    main.setMesh(this.visibleChild(group, time) || this.children(group)[0] || group);
    this._commit(before, 'SR delete frame');
    this._refreshOutliner();
  }
}
