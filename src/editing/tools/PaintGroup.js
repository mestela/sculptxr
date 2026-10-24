import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';

// Brush that paints a per-face group id onto the mesh. Groups are genuine per-face data
// (Mesh._facesGroups) and steer the quad remesher along their borders. Painting never
// changes topology; it only writes group ids for the faces under the brush.
class PaintGroup extends SculptBase {

  constructor(main) {
    super(main);
    this._radius = 50;
    this._group = 1; // active group id being painted (0 = unpainted/neutral)
    this._negative = false; // "Erase" mode: paint group 0 instead of the active group
    this._preGroups = null; // snapshot of groups at stroke start, for undo
    this._pick = false; // armed: the next click reads the group under it instead of painting
    this._onPicked = null; // panel callback, to show the picked group
  }

  setGroup(id) {
    this._group = id | 0;
  }

  getGroup() {
    return this._group;
  }

  start(ctrl) {
    if (this._pick) return this.pickGroup();
    var res = super.start(ctrl);
    // Make painting visible: force the group-view tint on while this tool is active.
    if (res) {
      var mesh = this.getMesh();
      if (mesh) mesh.setShowFacesGroups(true);
    }
    return res;
  }

  // Called by SculptBase.start() before the stroke begins. We don't push a geometry state;
  // instead we snapshot the group array and register the undo/redo entry in end().
  pushState() {
    var mesh = this.getMesh();
    if (!mesh) return;
    var groups = mesh.getFacesGroups();
    this._preGroups = groups ? new Int32Array(groups) : null;
  }

  stroke(picking) {
    var mesh = this.getMesh();
    if (!mesh) return;
    var groups = mesh.getFacesGroups();
    if (!groups) return;

    var iVerts = picking.getPickedVertices();
    if (!iVerts || iVerts.length === 0) return;

    var iFaces = mesh.getFacesFromVertices(iVerts);
    var g = this._negative ? 0 : this._group; // Erase mode paints group 0
    for (var i = 0, n = iFaces.length; i < n; ++i)
      groups[iFaces[i]] = g;

    // Only these faces' colours changed; positions did not move during a paint stroke.
    mesh.updateGroupOverlayFaces(iFaces);
  }

  // Group painting only changes the overlay, not the base mesh geometry/colours, and stroke()
  // has already recoloured the touched faces -- so no overlay rebuild here.
  updateMeshBuffers() {
    var mesh = this.getMesh();
    if (!mesh) return;
    this._main.refreshLinkedSiblings?.(mesh);
  }

  end() {
    super.end();
    var mesh = this.getMesh();
    var pre = this._preGroups;
    this._preGroups = null;
    if (!mesh || !pre) return;

    var post = mesh.getFacesGroups();
    if (!post || post.length !== pre.length) return;

    var changed = false;
    for (var i = 0; i < pre.length; ++i) {
      if (pre[i] !== post[i]) { changed = true; break; }
    }
    if (!changed) return;

    var preCopy = new Int32Array(pre);
    var postCopy = new Int32Array(post);
    var self = this;
    this._main.getStateManager().pushStateCustom(
      function () { self.applyGroups(mesh, preCopy); },
      function () { self.applyGroups(mesh, postCopy); }
    );
  }

  applyGroups(mesh, groups) {
    mesh.setFacesGroups(new Int32Array(groups));
    mesh.updateGroupOverlay();
    this._main.render();
  }

  // One-shot: make the group under the pointer the active group. Never a stroke.
  pickGroup() {
    this._pick = false;
    var picking = this._main.getPicking();
    if (!this._main._vrSculpting) picking.intersectionMouseMeshes();
    var mesh = picking.getMesh();
    var face = picking.getPickedFace();
    var groups = mesh && mesh.getFacesGroups();
    if (groups && face >= 0) this._group = groups[face];
    if (this._onPicked) this._onPicked();
    return false;
  }

  // One group per connected piece, numbered by size so the biggest (the skin) is 1.
  groupsFromIslands() {
    var mesh = this.getMesh();
    var groups = mesh && mesh.getFacesGroups();
    if (!groups) return;
    var fAr = mesh.getFaces();
    var nbFaces = mesh.getNbFaces();
    var parent = new Uint32Array(mesh.getNbVertices());
    for (var v = 0; v < parent.length; ++v) parent[v] = v;
    var find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (var f = 0; f < nbFaces; ++f) {
      var a = find(fAr[f * 4]);
      for (var k = 1; k < 4; ++k) {
        var id = fAr[f * 4 + k];
        if (id === Utils.TRI_INDEX) continue;
        var b = find(id);
        if (a !== b) parent[b] = a;
      }
    }
    var count = new Map();
    for (f = 0; f < nbFaces; ++f) {
      var r = find(fAr[f * 4]);
      count.set(r, (count.get(r) || 0) + 1);
    }
    var ids = new Map();
    Array.from(count.keys()).sort((x, y) => count.get(y) - count.get(x)).forEach((r, i) => ids.set(r, i + 1));

    var pre = new Int32Array(groups);
    var post = new Int32Array(nbFaces);
    for (f = 0; f < nbFaces; ++f) post[f] = ids.get(find(fAr[f * 4]));
    var self = this;
    var apply = (g) => { mesh.setHiddenGroups(null); self.applyGroups(mesh, g); };
    this._main.getStateManager().pushStateCustom(() => apply(pre), () => apply(post));
    apply(post);
    mesh.setShowFacesGroups(true);
  }

  getMaxGroup() {
    var groups = this.getMesh()?.getFacesGroups();
    var max = 0;
    for (var i = 0, n = groups ? this.getMesh().getNbFaces() : 0; i < n; ++i)
      if (groups[i] > max) max = groups[i];
    return max;
  }

  // mode: 'hide' adds the active group, 'isolate' hides every other group, 'show' clears.
  hideGroups(mode) {
    var mesh = this.getMesh();
    var groups = mesh && mesh.getFacesGroups();
    if (!groups) return;
    var pre = mesh.getHiddenGroups();
    var next = new Set(mode === 'hide' && pre ? pre : []);
    if (mode === 'hide') next.add(this._group);
    if (mode === 'isolate') {
      for (var i = 0, n = mesh.getNbFaces(); i < n; ++i) next.add(groups[i]);
      next.delete(this._group);
    }
    var preCopy = pre ? new Set(pre) : null;
    var main = this._main;
    var apply = (set) => { mesh.setHiddenGroups(set); main.render(); };
    main.getStateManager().pushStateCustom(() => apply(preCopy), () => apply(next));
    apply(next);
  }

  // others=false masks the active group; others=true masks everything else and frees the group.
  maskGroup(others) {
    var mesh = this.getMesh();
    var groups = mesh && mesh.getFacesGroups();
    if (!groups) return;
    var fAr = mesh.getFaces();
    var mAr = mesh.getMaterials();
    var g = this._group;
    var nbVerts = mesh.getNbVertices();
    var all = new Uint32Array(nbVerts);
    for (var v = 0; v < nbVerts; ++v) all[v] = v;
    this._main.getStateManager().pushStateColorAndMaterial(mesh);
    this._main.getStateManager().pushVertices(all);
    if (others) for (v = 0; v < nbVerts; ++v) mAr[v * 3 + 2] = 0.0;
    for (var f = 0, n = mesh.getNbFaces(); f < n; ++f) {
      if (groups[f] !== g) continue;
      for (var k = 0; k < 4; ++k) {
        var id = fAr[f * 4 + k];
        if (id !== Utils.TRI_INDEX) mAr[id * 3 + 2] = others ? 1.0 : 0.0;
      }
    }
    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateDrawArrays();
    if (mesh.isDynamic) mesh.updateBuffers();
    else mesh.updateMaterialBuffer();
    this._main.render();
  }
}

export default PaintGroup;
