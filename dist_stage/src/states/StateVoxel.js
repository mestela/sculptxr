
class StateVoxel {

  constructor(main, tool) {
    this._main = main;
    this._tool = tool; // Store reference to tool (which holds the worker)
  }

  isNoop() {
    return false;
  }

  undo() {
    if (this._tool && this._tool._worker) {
      this._tool._worker.postMessage({ type: 'UNDO' });
    }
  }

  redo() {
    if (this._tool && this._tool._worker) {
      this._tool._worker.postMessage({ type: 'REDO' });
    }
  }

  createRedo() {
    return new StateVoxel(this._main, this._tool);
  }
}

export default StateVoxel;
