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
    const defaultLimit = /OculusBrowser/.test(navigator.userAgent) ? 15 : 50;
    try { const s = JSON.parse(localStorage.getItem('sculptxr_settings') || '{}'); this.limit = s.maxUndo || defaultLimit; } catch (_) { this.limit = defaultLimit; }
  }

  pushStateCustom(undocb, redocb, squash, name) {
    var st = new StCustom(undocb, redocb);
    st.squash = squash;
    st.name = name;
    this.pushState(st);
    return st;
  }

  // Called when a state is permanently dropped from the COMMITTED (undo) side — i.e.
  // it can never be undone back to. A state may carry an optional `_disposeCommitted`
  // to free external resources its undo path was holding alive (e.g. the bake-voxel
  // state keeps the source voxel's worker distance-field slots so undo can restore an
  // editable voxel; once it's purged the voxel is gone for good, so free those slots).
  // NOT called on the reverted (redo-cleared / truncated) side: there the original
  // object is live again and must keep its resources.
  _discardCommitted(state) {
    if (state && typeof state._disposeCommitted === 'function') {
      try { state._disposeCommitted(); } catch (e) { console.error('[StateManager] dispose failed', e); }
    }
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
      this._discardCommitted(undos[0]);
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
      this._discardCommitted(undos[0]);
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

  // For the History UI: how many steps can be undone / redone, and whether either
  // is currently possible.
  undoCount() { return Math.max(0, this._curUndoIndex + 1); }
  redoCount() { return this._redos.length; }
  canUndo()   { return this._undos.length > 0 && this._curUndoIndex >= 0; }
  canRedo()   { return this._redos.length > 0; }

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
    console.log("[Undo] " + (state.name || state.constructor.name));
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
    console.log("[Redo] " + (state.name || state.constructor.name));
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
