import Utils from '../misc/Utils.js';
import StAddRemove from './StateAddRemove.js';
import StColorAndMaterial from './StateColorAndMaterial.js';
import StGeometry from './StateGeometry.js';
import StDynamic from './StateDynamic.js';
import StMultiresolution from './StateMultiresolution.js';
import StCustom from './StateCustom.js';
import StVoxel from './StateVoxel.js';

class StateManager {

  constructor(main) {
    this._main = main; // main
    this._undos = []; // undo actions
    this._redos = []; // redo actions
    this._curUndoIndex = -1; // current index in undo
    this.limit = /OculusBrowser/.test(navigator.userAgent) ? 15 : 50;
  }

  pushStateCustom(undocb, redocb, squash, name) {
    var st = new StCustom(undocb, redocb);
    st.squash = squash;
    st.name = name;
    this.pushState(st);
  }

  pushStateAddRemove(addMesh, remMesh, squash) {
    var st = new StAddRemove(this._main, addMesh, remMesh);
    st.squash = squash;
    this.pushState(st);
  }

  pushStateRemove(remMesh) {
    this.pushState(new StAddRemove(this._main, [], remMesh));
  }

  pushStateAdd(addMesh) {
    this.pushState(new StAddRemove(this._main, addMesh, []));
  }

  pushStateColorAndMaterial(mesh) {
    if (mesh.isDynamic)
      this.pushState(new StDynamic(this._main, mesh));
    else
      this.pushState(new StColorAndMaterial(this._main, mesh));
  }

  pushStateGeometry(mesh) {
    if (mesh.isDynamic)
      this.pushState(new StDynamic(this._main, mesh));
    else
      this.pushState(new StGeometry(this._main, mesh));
  }

  pushStateMultiresolution(multimesh, type) {
    this.pushState(new StMultiresolution(this._main, multimesh, type));
  }

  pushStateVoxel(tool) {
    this.pushState(new StVoxel(this._main, tool));
  }

  setNewMaxStack(maxStack) {
    this.limit = maxStack;
    var undos = this._undos;
    var redos = this._redos;
    while (this._curUndoIndex >= maxStack) {
      undos.shift();
      --this._curUndoIndex;
    }
    while (undos.length > maxStack) {
      undos.pop();
      redos.shift();
    }
  }

  pushState(state) {
    ++Utils.STATE_FLAG;
    var undos = this._undos;

    if (this._curUndoIndex === -1) undos.length = 0;
    else if (undos.length >= this.limit) {
      undos.shift();
      --this._curUndoIndex;
    }
    this._redos.length = 0;
    ++this._curUndoIndex;
    if (undos.length > 0)
      undos.length = this._curUndoIndex;
    undos.push(state);
  }

  getCurrentState() {
    return this._undos[this._curUndoIndex];
  }

  pushVertices(iVerts) {
    if (iVerts && iVerts.length > 0)
      this.getCurrentState().pushVertices(iVerts);
  }

  pushFaces(iFaces) {
    if (iFaces && iFaces.length > 0)
      this.getCurrentState().pushFaces(iFaces);
  }

  undo() {
    if (!this._undos.length || this._curUndoIndex < 0)
      return;

    var state = this.getCurrentState();
    console.log("[Undo] Operation: " + (state.name || state.constructor.name));
    var redoState = state.createRedo();
    redoState.squash = state.squash;
    this._redos.push(redoState);
    state.undo();

    this._curUndoIndex--;
    if (state.squash === true)
      this.undo();
  }

  redo() {
    if (!this._redos.length)
      return;

    var state = this._redos[this._redos.length - 1];
    console.log("[Redo] Operation: " + (state.name || state.constructor.name));
    state.redo();
    this._curUndoIndex++;
    this._redos.pop();
    if (this._redos.length && this._redos[this._redos.length - 1].squash === true)
      this.redo();
  }

  reset() {
    this._undos.length = 0;
    this._redos.length = 0;
    this._curUndoIndex = -1;
  }

  cleanNoop() {
    while (this._curUndoIndex >= 0 && this.getCurrentState().isNoop()) {
      this._undos.length--;
      this._curUndoIndex--;
      this._redos.length = 0;
    }
  }
}

export default StateManager;
