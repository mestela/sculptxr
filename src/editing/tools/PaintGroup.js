import SculptBase from './SculptBase.js';

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
  }

  setGroup(id) {
    this._group = id | 0;
  }

  getGroup() {
    return this._group;
  }

  start(ctrl) {
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

    // Rebuild the crisp group-colour overlay from the updated _facesGroups.
    mesh.updateGroupOverlay();
  }

  // Group painting only changes the overlay, not the base mesh geometry/colours.
  updateMeshBuffers() {
    var mesh = this.getMesh();
    if (!mesh) return;
    mesh.updateGroupOverlay();
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
}

export default PaintGroup;
