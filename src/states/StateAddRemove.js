class StateAddRemove {

  constructor(main, addedMeshes, removedMeshes) {
    this._main = main; // main application
    this._addedMeshes = addedMeshes.length !== undefined ? addedMeshes : [addedMeshes]; // the added meshes
    this._removedMeshes = removedMeshes.length !== undefined ? removedMeshes : [removedMeshes]; // the deleted meshes
    this._selectMeshes = main.getSelectedMeshes().slice();
  }

  isNoop() {
    return this._addedMeshes.length === 0 && this._removedMeshes.length === 0;
  }

  undo() {
    var main = this._main;
    var meshesMain = main.getMeshes();
    var addMeshes = this._addedMeshes;
    var i, l;

    if (addMeshes && addMeshes.length) {
      for (i = 0, l = addMeshes.length; i < l; ++i) {
        meshesMain.splice(main.getIndexMesh(addMeshes[i]), 1);
        // Keep the three.js scene graph in sync — otherwise undoing an "add"
        // leaves an orphaned visible mesh.
        if (main.detachMeshThree) main.detachMeshThree(addMeshes[i]);
      }
    }

    var remMeshes = this._removedMeshes;
    if (remMeshes && remMeshes.length) {
      for (i = 0, l = remMeshes.length; i < l; ++i) {
        meshesMain.push(remMeshes[i]);
        // Re-add to the render scene — its absence is why "delete → undo" did
        // nothing (the mesh returned to _meshes but never to _worldGroup).
        if (main.attachMeshThree) main.attachMeshThree(remMeshes[i]);
      }
    }

    for (i = 0, l = meshesMain.length; i < l; ++i) {
      meshesMain[i].initRender();
    }

    var sel = this._selectMeshes;
    main.setMesh(sel[0] ? sel[0] : null);
    var sMeshes = main.getSelectedMeshes();
    sMeshes.length = 0;
    for (i = 0, l = sel.length; i < l; ++i)
      sMeshes.push(sel[i]);
  }

  redo() {
    this.undo();
  }

  createRedo() {
    return new StateAddRemove(this._main, this._removedMeshes, this._addedMeshes);
  }
}

export default StateAddRemove;
